// BlogAssembler.js — 마크다운 → HTML 변환, 블로그 조립
class BlogAssembler {
	// Excalidraw 라이브러리 캐시 (한 번만 로드)
	// 5회차 보강: 레이스 안전 in-flight Promise 캐시.
	//   기존: `if (_excalidrawLibs) return ...` — 첫 호출 진행 중 두 번째 호출이 들어오면
	//          두 번째도 null을 보고 또 fetch → 중복 import (네트워크/메모리 낭비).
	//   변경: 진행 중인 Promise를 _excalidrawLibsPromise에 저장 → 동시 호출이 같은 Promise를 await.
	static _excalidrawLibs = null;
	static _excalidrawLibsPromise = null;
	// 14회차 신설: elkjs 라이브러리 캐시 (직교 라우팅 보장).
	static _elkLib = null;
	static _elkLibPromise = null;

	// 14회차 신설: elkjs 0.9.x를 CDN에서 로드. 실패 시 throw → 호출자가 visibility graph로 폴백.
	static async _loadElkLib() {
		if (BlogAssembler._elkLib) return BlogAssembler._elkLib;
		if (BlogAssembler._elkLibPromise) return BlogAssembler._elkLibPromise;
		BlogAssembler._elkLibPromise = (async () => {
			const sources = [
				"https://esm.sh",
				"https://esm.sh/v135",
				"https://unpkg.com",
			];
			let lastErr = null;
			for (const base of sources) {
				try {
					// elkjs는 ES module + CommonJS 둘 다 노출. esm.sh는 default export로 ELK 클래스 제공.
					const mod = await import(/* @vite-ignore */ `${base}/elkjs@0.9.3/lib/elk.bundled.js`);
					const ELK = mod.default || mod.ELK || mod;
					if (typeof ELK !== "function") throw new Error("ELK 생성자 없음");
					const elk = new ELK();
					if (typeof elk.layout !== "function") throw new Error("ELK.layout 없음");
					BlogAssembler._elkLib = elk;
					console.log(`elkjs loaded from ${base}`);
					return elk;
				} catch (e) {
					lastErr = e;
					console.warn(`${base} elk 실패: ${e.message}`);
				}
			}
			BlogAssembler._elkLibPromise = null;
			throw lastErr || new Error("elkjs 로드 실패");
		})();
		return BlogAssembler._elkLibPromise;
	}

	static async _loadExcalidrawLibs() {
		if (BlogAssembler._excalidrawLibs) return BlogAssembler._excalidrawLibs;
		if (BlogAssembler._excalidrawLibsPromise) return BlogAssembler._excalidrawLibsPromise;
		BlogAssembler._excalidrawLibsPromise = (async () => {
			// 5회차 보강: esm.sh 다운 시 unpkg.com mirror로 fallback
			const sources = [
				"https://esm.sh",
				"https://esm.sh/v135",
				"https://unpkg.com",
			];
			let lastErr = null;
			for (const base of sources) {
				try {
					const mte = await import(/* @vite-ignore */ `${base}/@excalidraw/mermaid-to-excalidraw@1.1.2`);
					const ex = await import(/* @vite-ignore */ `${base}/@excalidraw/excalidraw@0.17.6`);
					const api = ex.default || ex;
					if (typeof api.exportToCanvas !== "function") throw new Error("exportToCanvas 없음");
					BlogAssembler._excalidrawLibs = { mte, api };
					console.log(`Excalidraw libs loaded from ${base}`);
					return BlogAssembler._excalidrawLibs;
				} catch (e) {
					lastErr = e;
					console.warn(`${base} 실패: ${e.message}`);
				}
			}
			// 실패 시 promise 캐시도 비워서 다음 호출이 재시도 가능하도록 함
			BlogAssembler._excalidrawLibsPromise = null;
			throw lastErr || new Error("Excalidraw libs 로드 실패");
		})();
		return BlogAssembler._excalidrawLibsPromise;
	}

	// 파스텔 팔레트 (박스 배경 로테이션용)
	static _PALETTE = [
		{ bg: "#dbeafe", stroke: "#1e40af" }, // blue
		{ bg: "#fef3c7", stroke: "#92400e" }, // amber
		{ bg: "#dcfce7", stroke: "#166534" }, // green
		{ bg: "#fce7f3", stroke: "#9d174d" }, // pink
		{ bg: "#e0e7ff", stroke: "#3730a3" }, // indigo
		{ bg: "#ffedd5", stroke: "#9a3412" }, // orange
	];

	// 사각형이 다른 shape를 공간적으로 포함하면 "컨테이너(subgraph)"로 판단
	static _isContainer(el, allShapes) {
		if (el.type !== "rectangle") return false;
		const pad = 2;
		for (const other of allShapes) {
			if (other === el) continue;
			if (other.type !== "rectangle" && other.type !== "ellipse" && other.type !== "diamond") continue;
			if (
				other.x >= el.x - pad &&
				other.y >= el.y - pad &&
				other.x + other.width <= el.x + el.width + pad &&
				other.y + other.height <= el.y + el.height + pad
			) {
				return true;
			}
		}
		return false;
	}

	// 4회차 보강: 한글 NFC 정규화 — macOS에서 복사된 한글이나 일부 입력기는
	// 한글을 NFD(자모 분리: 'ㅎ'+'ㅏ'+'ㄴ')로 보낸다. for...of 루프와 정규식
	// [가-힣]은 NFD 자모를 단일 글자로 처리하지 못해 visualLen이 부풀려지고
	// 박스 width 계산이 무너진다. 모든 라벨/코드 진입 직후 NFC로 통일.
	static _toNfc(s) {
		try { return (s || "").normalize("NFC"); } catch { return s || ""; }
	}

	// 4회차 보강: visualLen — NFC 정규화 + 이모지/한자/일본어 혼용 라벨 폭 측정.
	// 한글/한자/일본어/전각문자 = 2폭, 이모지(VS16/ZWJ 시퀀스 포함) = 2폭, ASCII = 1폭.
	// Intl.Segmenter로 grapheme 단위 카운팅 → emoji 결합 시퀀스(👨‍👩‍👧)도 1글자로 인식.
	static _visualLen(s) {
		const norm = BlogAssembler._toNfc(s);
		if (!norm) return 0;
		let len = 0;
		// Intl.Segmenter 사용 가능 시 grapheme 단위, 아니면 코드포인트 단위
		const iter = (typeof Intl !== "undefined" && Intl.Segmenter)
			? Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(norm), s => s.segment)
			: Array.from(norm);
		for (const g of iter) {
			const cp = g.codePointAt(0) || 0;
			// 이모지/픽토그램(U+1F300~U+1FAFF, U+2600~U+27BF) → 2
			if (cp >= 0x1F300 && cp <= 0x1FAFF) { len += 2; continue; }
			if (cp >= 0x2600 && cp <= 0x27BF) { len += 2; continue; }
			// 한글 음절(가-힣) + 한글 자모 결합형 보호
			if ((cp >= 0xAC00 && cp <= 0xD7A3) || (cp >= 0x1100 && cp <= 0x11FF) || (cp >= 0x3130 && cp <= 0x318F)) { len += 2; continue; }
			// CJK 통합한자 + 호환한자
			if ((cp >= 0x3400 && cp <= 0x9FFF) || (cp >= 0xF900 && cp <= 0xFAFF)) { len += 2; continue; }
			// 일본어 히라가나/가타카나
			if (cp >= 0x3040 && cp <= 0x30FF) { len += 2; continue; }
			// 전각 ASCII/기호
			if (cp >= 0xFF00 && cp <= 0xFF60) { len += 2; continue; }
			// 그 외(라틴/숫자/기호) → 1
			len += 1;
		}
		return len;
	}

	// 14회차 2회차(2026-05-01): 본문 메타 코멘트(LLM 자기검토) sanitize.
	//   문제: LLM이 본문에 "Mermaid diagram check: 4 nodes... All good" 같은 자기검토 텍스트를
	//     <em>/<i> 태그나 인용블록으로 박아 발행됨. 사용자에게 노출되면 안 되는 메타데이터.
	//   변경: BlogAssembler 단계에서 정규식으로 결정론적 제거. 패턴:
	//     1) "Mermaid diagram check: ... All good" / "Node labels: ... All good" 형태
	//     2) <em>/<i>로 감싼 LLM 자기검토 ("max ... chars", "format check", "node count")
	//     3) "(self-check: ...)" / "[self-check] ..." 류
	//   주의: 정상 본문의 <em>/<i> (강조)는 보존 — 메타 키워드 매칭 시만 제거.
	static _stripMetaComments(body) {
		if (!body) return body;
		let out = body;
		// 패턴 1: "Mermaid diagram check: ..." / "Node labels: ..." 한 줄 메타
		out = out.replace(
			/^.*?(Mermaid diagram check|Node labels?|Diagram check|Label format|Node count)[\s\S]{0,300}?(All good|All clear|✓|OK)\b.*$/gim,
			"",
		);
		// 패턴 2: <em>/<i> 안에 메타 키워드가 들어있으면 통째로 제거
		out = out.replace(
			/<(em|i)>[^<]*?(Mermaid|Node label|diagram check|format check|node count|self-check|max \d+ chars|All good)[^<]*?<\/\1>/gi,
			"",
		);
		// 패턴 3: 괄호/대괄호로 감싼 self-check 메타
		out = out.replace(/\((self-check|메타|검토)[:\s][^)]{0,200}\)/gi, "");
		out = out.replace(/\[(self-check|메타|검토)[:\s][^\]]{0,200}\]/gi, "");
		// 결과 정리: 빈 줄 3+ → 2줄로 압축
		out = out.replace(/\n{3,}/g, "\n\n");
		return out.trim();
	}

	// mermaid 노드 sanitize — 라벨 내 특수문자 제거 + 다이아몬드/원 강제 사각형화 + em-dash 중복 정규화.
	// 3회차 보강: 방향 강제 (LR/BT/RL → TD) — 후처리는 y 기반 행 그룹화를 가정하므로
	// LR/BT/RL이 들어오면 행 분류가 무너진다. graph/flowchart 모두 첫 줄을 TD로 강제 변환.
	// 4회차 보강: 입력 코드 자체를 NFC로 먼저 정규화 — 자모 분리형이 들어와도 안정.
	static _sanitizeMermaid(code) {
		const clean = (s) => s.replace(/[()"'`:<>]/g, " ").replace(/\s+/g, " ").trim();
		let out = BlogAssembler._toNfc(code);
		// 0) 방향 강제: graph/flowchart LR|RL|BT|TB → graph TD (TB는 TD와 동일하지만 통일)
		//    multiline 첫 줄만 검사 (Mermaid 문법상 방향 선언은 첫 비어있지 않은 줄)
		out = out.replace(
			/^(\s*)(graph|flowchart)\s+(LR|RL|BT|TB|TD)\b/im,
			(_m, lead, kw) => `${lead}${kw} TD`,
		);
		// 1) 다이아몬드 {...} → 사각형 [...] 강제 변환 (LLM이 규칙 위반 시 방어)
		out = out.replace(/\{([^{}]*)\}/g, (_, inner) => `[${clean(inner)}]`);
		// 2) 이중 원 ((...)) → 사각형 [...] 강제 변환
		out = out.replace(/\(\(([^()]*)\)\)/g, (_, inner) => `[${clean(inner)}]`);
		// 3) [text] 라벨 내부 특수문자 정리
		out = out.replace(/\[([^\[\]]*)\]/g, (_, inner) => `[${clean(inner)}]`);
		// 4) em-dash 중복 (—\s*—) → 단일 em-dash
		out = out.replace(/—\s*—+/g, "—");
		// 5) hyphen-em-dash 혼용 (- —, — -) → 단일 em-dash
		out = out.replace(/\s+-\s+—|—\s+-\s+/g, " — ");
		// 6) 시퀀스/클래스 다이어그램 등 비-flowchart는 graph TD 빈 다이어그램으로 대체
		//    (후처리 가정 위반 → 깨진 출력 차라리 fallback)
		if (/^\s*(sequenceDiagram|classDiagram|stateDiagram|erDiagram|gantt|pie|journey|gitGraph)\b/im.test(out)) {
			out = "graph TD\n  N0[다이어그램 변환 실패 — 본문 참고]";
		}
		return out;
	}

	// 8회차 신설: 화살표 boundary-to-boundary endpoint 계산 (회귀 테스트용 export).
	// 두 박스 g1(출발), g2(도착) 의 새 geometry({x, y, w, h, cx, cy}) 와 gap(경계 간격, 기본 6px) 를 받아
	// {sx, sy, ex, ey} 를 반환한다.
	// 라우팅 규칙:
	//   - |dx| > |dy| → 수평(좌우 변) 사용. g2가 오른쪽이면 g1.우변 → g2.좌변, 왼쪽이면 반대.
	//   - 그 외(수직 우선) → 상하 변 사용. g2가 아래면 g1.하변 → g2.상변, 위면 반대.
	// 결과 endpoint는 박스 경계에서 gap만큼 떨어져 있어 화살표가 박스 내부로 들어가지 않는다.
	static _computeArrowEndpoints(g1, g2, gap = 6) {
		const dx = g2.cx - g1.cx;
		const dy = g2.cy - g1.cy;
		let sx, sy, ex, ey;
		if (Math.abs(dx) > Math.abs(dy)) {
			if (dx >= 0) { sx = g1.x + g1.w + gap; ex = g2.x - gap; }
			else { sx = g1.x - gap; ex = g2.x + g2.w + gap; }
			sy = g1.cy;
			ey = g2.cy;
		} else {
			if (dy >= 0) { sy = g1.y + g1.h + gap; ey = g2.y - gap; }
			else { sy = g1.y - gap; ey = g2.y + g2.h + gap; }
			sx = g1.cx;
			ex = g2.cx;
		}
		return { sx, sy, ex, ey };
	}

	// 박스 geometry 객체 헬퍼 (회귀 테스트용)
	static _makeBoxGeom(x, y, w, h) {
		return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
	}

	// 9회차(직교 라우팅) 신설: 선분이 박스 영역과 겹치는지 검사.
	// p1, p2: {x, y}, box: {x, y, w, h}
	// 반환: true면 선분이 박스 내부를 통과(또는 양 끝점 중 하나가 박스 안)
	// 알고리즘: Cohen-Sutherland 영역 코드 + AABB-segment 교차 검사를 단순화한 버전.
	//   1) 양 끝점이 모두 박스 한쪽 변 바깥(같은 영역)이면 false (분리)
	//   2) 끝점 중 하나라도 박스 안이면 true
	//   3) 박스 4변 각각과 선분 교차 검사
	static _segmentIntersectsBox(p1, p2, box, margin = 1) {
		const x1 = box.x - margin, y1 = box.y - margin;
		const x2 = box.x + box.w + margin, y2 = box.y + box.h + margin;
		// 양 끝점 박스 내부 검사
		const inside = (p) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
		if (inside(p1) || inside(p2)) return true;
		// 같은 영역 분리 (둘 다 박스 왼쪽/오른쪽/위/아래)
		if (p1.x < x1 && p2.x < x1) return false;
		if (p1.x > x2 && p2.x > x2) return false;
		if (p1.y < y1 && p2.y < y1) return false;
		if (p1.y > y2 && p2.y > y2) return false;
		// Liang-Barsky 알고리즘 — AABB와 선분의 교차 검사 (코너 통과/대각선 모두 정확)
		const dx = p2.x - p1.x;
		const dy = p2.y - p1.y;
		let tMin = 0, tMax = 1;
		const clip = (p, q) => {
			if (Math.abs(p) < 1e-9) {
				// 선분이 해당 변과 평행
				if (q < 0) return false; // 박스 바깥
				return true;
			}
			const t = q / p;
			if (p < 0) {
				if (t > tMax) return false;
				if (t > tMin) tMin = t;
			} else {
				if (t < tMin) return false;
				if (t < tMax) tMax = t;
			}
			return true;
		};
		if (!clip(-dx, p1.x - x1)) return false;
		if (!clip(dx, x2 - p1.x)) return false;
		if (!clip(-dy, p1.y - y1)) return false;
		if (!clip(dy, y2 - p1.y)) return false;
		// tMin < tMax 이면 박스 내부를 통과
		return tMin < tMax;
	}

	// 9회차(직교 라우팅) 신설: 폴리라인(여러 점)이 박스를 관통하는지 검사
	static _polylineIntersectsBox(points, box, margin = 1) {
		for (let i = 0; i < points.length - 1; i++) {
			if (BlogAssembler._segmentIntersectsBox(points[i], points[i + 1], box, margin)) return true;
		}
		return false;
	}

	// 9회차(직교 라우팅) 신설: 폴리라인이 otherBoxes 중 하나라도 관통하는지
	static _polylineHitsAny(points, otherBoxes, margin = 1) {
		for (const b of otherBoxes) {
			if (BlogAssembler._polylineIntersectsBox(points, b, margin)) return true;
		}
		return false;
	}

	// 11회차(visibility graph + Dijkstra) 신설:
	// 출발/도착 박스의 4면 중점 + 다른 모든 박스의 8개 inflated 노드(4 코너 + 4 중점)를 그래프 노드로,
	// 두 노드 사이를 잇는 직선이 어떤 otherBox도 관통하지 않으면 간선(가중치 = 유클리드 거리)을 추가.
	// Dijkstra 최단 경로 → simplifyPath(연속 동방향 합치기) → polyline.
	//
	// 12회차 보강: clearance(시각 여유) 파라미터 추가 — 다른 박스(otherBoxes) 노드는 clearance만큼
	//   더 떨어진 곳에 배치하고, 간선 박스 관통 검사도 동일 clearance margin으로 수행.
	//   roughness=2 sketchy 렌더링은 폴리라인을 ±5~8px 흔들림 → 박스 경계에서 충분히 떨어진
	//   경로가 아니면 시각적으로 박스를 침범. clearance=12 → 시각적 박스 관통 0건 보장.
	//
	// _buildVisibilityGraph(g1, g2, otherBoxes, gap, clearance):
	//   반환: { nodes: [{x,y}], edges: Map<idx, [{to, w}]>, startIdxs: [], endIdxs: [] }
	static _buildVisibilityGraph(g1, g2, otherBoxes, gap = 6, clearance = 12) {
		const nodes = [];
		const startIdxs = [];
		const endIdxs = [];
		// 출발/도착 박스 4면 중점 — 화살표 시작/종착점이므로 gap(=6)만 적용 (시각적 부착감)
		const sideMid = (g, off) => [
			{ x: g.cx, y: g.y - off },               // 상
			{ x: g.cx, y: g.y + g.h + off },          // 하
			{ x: g.x - off, y: g.cy },               // 좌
			{ x: g.x + g.w + off, y: g.cy },         // 우
		];
		for (const p of sideMid(g1, gap)) {
			startIdxs.push(nodes.length);
			nodes.push(p);
		}
		for (const p of sideMid(g2, gap)) {
			endIdxs.push(nodes.length);
			nodes.push(p);
		}
		// 다른 박스의 inflated corner + side mid (8개) — clearance만큼 떨어뜨려 시각 여유 확보
		for (const ob of otherBoxes) {
			const ix1 = ob.x - clearance, iy1 = ob.y - clearance;
			const ix2 = ob.x + ob.w + clearance, iy2 = ob.y + ob.h + clearance;
			const cx = ob.x + ob.w / 2, cy = ob.y + ob.h / 2;
			const candidates = [
				{ x: ix1, y: iy1 }, // top-left inflated corner
				{ x: ix2, y: iy1 }, // top-right
				{ x: ix1, y: iy2 }, // bottom-left
				{ x: ix2, y: iy2 }, // bottom-right
				{ x: cx, y: iy1 },  // top-mid
				{ x: cx, y: iy2 },  // bottom-mid
				{ x: ix1, y: cy },  // left-mid
				{ x: ix2, y: cy },  // right-mid
			];
			for (const p of candidates) nodes.push(p);
		}
		// 간선: 두 노드 사이 직선이 otherBoxes를 clearance만큼 inflated된 영역도 침범하면 차단.
		// 자기 자신을 둘러싼 corner/mid 노드들의 첫 hop은 박스 경계와 clearance 거리만큼 떨어져 있어
		// 자기 박스 인플레이션 영역에는 들어가지 않는다 → 모든 박스를 동일 margin으로 검사 가능.
		// 단, 출발/도착 박스(g1/g2)는 화살표 endpoint 위치가 gap(<clearance)이므로 검사 제외.
		const edges = new Map();
		for (let i = 0; i < nodes.length; i++) edges.set(i, []);
		// 박스 관통 margin: clearance - 2 (경계에 정확히 닿는 노드는 통과 허용, 침범만 차단)
		const blockMargin = Math.max(1, clearance - 2);
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i], b = nodes[j];
				let blocked = false;
				for (const ob of otherBoxes) {
					if (BlogAssembler._segmentIntersectsBox(a, b, ob, blockMargin)) { blocked = true; break; }
				}
				if (blocked) continue;
				const dx = a.x - b.x, dy = a.y - b.y;
				const w = Math.sqrt(dx * dx + dy * dy);
				edges.get(i).push({ to: j, w });
				edges.get(j).push({ to: i, w });
			}
		}
		return { nodes, edges, startIdxs, endIdxs };
	}

	// _dijkstra: 그래프 + 출발 노드 인덱스 집합 → 가장 가까운 endIdx까지의 경로(노드 인덱스 배열)
	static _dijkstra(graph, startIdxs, endIdxs) {
		const { nodes, edges } = graph;
		const dist = new Array(nodes.length).fill(Infinity);
		const prev = new Array(nodes.length).fill(-1);
		// min-heap 흉내 — 노드 수가 작으므로 단순 선형 탐색
		const visited = new Array(nodes.length).fill(false);
		const endSet = new Set(endIdxs);
		for (const s of startIdxs) dist[s] = 0;
		while (true) {
			// 미방문 중 최소 dist 노드 선택
			let u = -1, best = Infinity;
			for (let k = 0; k < nodes.length; k++) {
				if (!visited[k] && dist[k] < best) { best = dist[k]; u = k; }
			}
			if (u === -1) break;
			visited[u] = true;
			if (endSet.has(u)) {
				// 경로 복원
				const path = [];
				let cur = u;
				while (cur !== -1) { path.push(cur); cur = prev[cur]; }
				path.reverse();
				return { path, cost: dist[u] };
			}
			for (const e of edges.get(u)) {
				if (visited[e.to]) continue;
				const nd = dist[u] + e.w;
				if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = u; }
			}
		}
		return null; // 도달 불가
	}

	// _simplifyPath: 동일 방향 연속 세그먼트 합치기 (불필요한 중간점 제거)
	static _simplifyPath(points) {
		if (points.length <= 2) return points.slice();
		const out = [points[0]];
		for (let i = 1; i < points.length - 1; i++) {
			const a = out[out.length - 1], b = points[i], c = points[i + 1];
			// (a→b)와 (b→c)가 같은 방향이면 b 제거
			const dx1 = b.x - a.x, dy1 = b.y - a.y;
			const dx2 = c.x - b.x, dy2 = c.y - b.y;
			// 외적 0 + 같은 부호 → 같은 방향
			const cross = dx1 * dy2 - dy1 * dx2;
			const dot = dx1 * dx2 + dy1 * dy2;
			if (Math.abs(cross) < 1e-6 && dot >= 0) {
				continue; // b를 건너뛴다
			}
			out.push(b);
		}
		out.push(points[points.length - 1]);
		return out;
	}

	// _routeArrowVisibility: visibility graph + Dijkstra 기반 라우팅.
	// 실패(도달 불가) 시 null 반환.
	// 12회차 보강: clearance 파라미터 단계적 완화 — 첫 시도 clearance=12 (시각 여유 충분),
	//   실패 시 clearance=8, 그래도 실패 시 clearance=4. 좁은 그래프에서도 라우팅 가능.
	static _routeArrowVisibility(g1, g2, otherBoxes, gap = 6) {
		const tries = [20, 14, 10, 6, 3]; // 13회차: 시각 여유 더 크게 시도. roughness=1로 흔들림은 줄었지만 화살표 머리+꼬리 시각 침범 차단.
		for (const clearance of tries) {
			const graph = BlogAssembler._buildVisibilityGraph(g1, g2, otherBoxes, gap, clearance);
			const result = BlogAssembler._dijkstra(graph, graph.startIdxs, graph.endIdxs);
			if (!result) continue;
			const rawPoints = result.path.map(idx => graph.nodes[idx]);
			const simplified = BlogAssembler._simplifyPath(rawPoints);
			// 안전 검증: 결과 폴리라인이 박스를 실제로 침범하지 않는지 (margin=1 — 경계 허용)
			if (BlogAssembler._polylineHitsAny(simplified, otherBoxes, 1)) continue;
			return { points: simplified, kind: `visibility-${simplified.length}-c${clearance}` };
		}
		return null;
	}

	// 9회차(직교 라우팅) 신설: g1 → g2 화살표 라우팅.
	// 다른 박스(otherBoxes)를 관통하지 않는 폴리라인을 반환.
	// 반환: { points: [{x,y}, ...] } — 첫 점이 시작 절대좌표, 마지막이 도착 절대좌표
	// 11회차 변경: visibility graph + Dijkstra 우선 시도 → 실패시 기존 직교 우회 fallback.
	// 전략 (순서대로 시도, 박스 관통 없으면 채택):
	//   0) Visibility graph + Dijkstra (모든 박스 코너/측중점 노드 + 박스 미관통 간선)
	//   1) 직선 (boundary-to-boundary)
	//   2) L-shape 수직 우회: g1 하변/상변 → 수평이동 → g2 좌변/우변 (시작은 수직, 끝은 수평)
	//   3) L-shape 수평 우회: g1 좌변/우변 → 수직이동 → g2 상변/하변 (시작은 수평, 끝은 수직)
	//   4) 큰 우회 (ㄹ-shape): 다른 박스 옆으로 빠져나감
	static _routeArrow(g1, g2, otherBoxes, gap = 6) {
		// 0) Visibility graph + Dijkstra 우선 시도 — 다단 그리드(11박스 이상)에서도 박스 관통 0건 보장.
		try {
			const vis = BlogAssembler._routeArrowVisibility(g1, g2, otherBoxes, gap);
			if (vis) return vis;
		} catch (e) {
			// 그래프 라우팅 실패 시 기존 fallback으로 진행 (절대 throw 금지)
			console.warn("visibility graph routing 실패, fallback 사용:", e && e.message);
		}

		// 1) 직선 시도
		const direct = BlogAssembler._computeArrowEndpoints(g1, g2, gap);
		const directPoints = [{ x: direct.sx, y: direct.sy }, { x: direct.ex, y: direct.ey }];
		if (!BlogAssembler._polylineHitsAny(directPoints, otherBoxes, 2)) {
			return { points: directPoints, kind: "straight" };
		}

		// 2) L-shape 수직 우회 (시작은 수직 출구, 끝은 수평 입구) — g2가 위/아래 영역에 있을 때
		//    sx = g1.cx, sy = g1 하변(또는 상변) + gap → midY = sy 와 ey 중간 → ex = g2 좌변/우변
		//    실제로는: 수직으로 빠져나간 뒤 도착 박스의 측면으로 들어간다 (3점)
		const lVertical = (() => {
			// g1 출구: 위 또는 아래
			let sx = g1.cx;
			let sy;
			if (g2.cy >= g1.cy) sy = g1.y + g1.h + gap;       // g2가 아래쪽 → g1 아래로 출구
			else sy = g1.y - gap;                              // g2가 위쪽 → g1 위로 출구
			// g2 입구: 왼쪽 또는 오른쪽
			let ex, ey = g2.cy;
			if (g2.cx >= g1.cx) ex = g2.x - gap;               // g2가 오른쪽 → 좌변 입구
			else ex = g2.x + g2.w + gap;                       // g2가 왼쪽 → 우변 입구
			// 3점 폴리라인: 시작 → 꺾임점(sx, ey) → 도착
			return [{ x: sx, y: sy }, { x: sx, y: ey }, { x: ex, y: ey }];
		})();
		if (!BlogAssembler._polylineHitsAny(lVertical, otherBoxes, 2)) {
			return { points: lVertical, kind: "L-vertical" };
		}

		// 3) L-shape 수평 우회 (시작은 수평 출구, 끝은 수직 입구)
		const lHorizontal = (() => {
			let sx, sy = g1.cy;
			if (g2.cx >= g1.cx) sx = g1.x + g1.w + gap;
			else sx = g1.x - gap;
			let ex = g2.cx, ey;
			if (g2.cy >= g1.cy) ey = g2.y - gap;
			else ey = g2.y + g2.h + gap;
			return [{ x: sx, y: sy }, { x: ex, y: sy }, { x: ex, y: ey }];
		})();
		if (!BlogAssembler._polylineHitsAny(lHorizontal, otherBoxes, 2)) {
			return { points: lHorizontal, kind: "L-horizontal" };
		}

		// 3.5) Z-shape (5점) — 출발과 도착 사이 임의의 mid-x/mid-y 시도.
		//      특히 같은 행/열에 박스 여러 개가 있어 단순 L-shape 두 종류가 모두 막힐 때
		//      "출발 박스 한쪽으로 빠져나가서 → 다른 행 → 도착 박스로 진입" 형태.
		//      여러 후보 mid 위치를 시도 (도착 박스 좌/우 변 바깥, 출발 박스 좌/우 변 바깥).
		const zShapeCandidates = [];
		// (a) 출발 박스 우측으로 빠져나가서 → mid-x → 도착으로 (mid-x를 도착 박스 좌측 바로 옆 등)
		const horizGap = 18;
		const candidateXs = [
			g2.x - horizGap, g2.x + g2.w + horizGap,
			g1.x - horizGap, g1.x + g1.w + horizGap,
		];
		for (const midX of candidateXs) {
			// 출발 박스 측면 → midX 수평이동 → midX y 따라 수직이동 → 도착 박스 측면 진입
			const sxRight = g1.x + g1.w + gap, sxLeft = g1.x - gap;
			const exRight = g2.x + g2.w + gap, exLeft = g2.x - gap;
			for (const sx of [sxRight, sxLeft]) {
				for (const ex of [exRight, exLeft]) {
					const sy = g1.cy, ey = g2.cy;
					// 5점: (sx,sy) → (midX, sy) → (midX, ey) → (ex, ey)
					const poly = [
						{ x: sx, y: sy },
						{ x: midX, y: sy },
						{ x: midX, y: ey },
						{ x: ex, y: ey },
					];
					zShapeCandidates.push({ poly, kind: `Z-h-mid${Math.round(midX)}` });
				}
			}
		}
		const candidateYs = [
			g2.y - horizGap, g2.y + g2.h + horizGap,
			g1.y - horizGap, g1.y + g1.h + horizGap,
		];
		for (const midY of candidateYs) {
			const syTop = g1.y - gap, syBot = g1.y + g1.h + gap;
			const eyTop = g2.y - gap, eyBot = g2.y + g2.h + gap;
			for (const sy of [syTop, syBot]) {
				for (const ey of [eyTop, eyBot]) {
					const sx = g1.cx, ex = g2.cx;
					const poly = [
						{ x: sx, y: sy },
						{ x: sx, y: midY },
						{ x: ex, y: midY },
						{ x: ex, y: ey },
					];
					zShapeCandidates.push({ poly, kind: `Z-v-mid${Math.round(midY)}` });
				}
			}
		}
		for (const cand of zShapeCandidates) {
			if (!BlogAssembler._polylineHitsAny(cand.poly, otherBoxes, 2)) {
				return { points: cand.poly, kind: cand.kind };
			}
		}

		// 4) 큰 우회 (Z/ㄹ-shape): 박스 그룹 좌측 또는 우측으로 빠져나간다
		//    모든 otherBoxes의 bounding box 좌/우 끝을 구해 그 바깥으로 우회
		if (otherBoxes.length > 0) {
			const allLeft = Math.min(...otherBoxes.map(b => b.x), g1.x, g2.x);
			const allRight = Math.max(...otherBoxes.map(b => b.x + b.w), g1.x + g1.w, g2.x + g2.w);
			const detourGap = 24;
			// (a) 우측 우회: g1 우변 → 멀리 우측 → 같은 y → g2 우변/좌변 입구
			const rightDetour = (() => {
				const sx = g1.x + g1.w + gap;
				const sy = g1.cy;
				const farX = allRight + detourGap;
				const ex = (g2.cx >= g1.cx) ? g2.x - gap : g2.x + g2.w + gap;
				const ey = g2.cy;
				// 5점: 시작 → (farX, sy) → (farX, ey) → (ex, ey) ; 단 ex가 우변 입구면 5점 의미 없음
				// 안전하게: 시작 → (farX, sy) → (farX, ey) → 도착
				// 도착이 우측 우회 경로에서 더 가까우면 좌변 입구가 자연 (ex = g2.x - gap)
				return [
					{ x: sx, y: sy },
					{ x: farX, y: sy },
					{ x: farX, y: ey },
					{ x: ex, y: ey },
				];
			})();
			if (!BlogAssembler._polylineHitsAny(rightDetour, otherBoxes, 2)) {
				return { points: rightDetour, kind: "detour-right" };
			}
			// (b) 좌측 우회: g1 좌변 → 멀리 좌측 → 같은 y → g2 입구
			const leftDetour = (() => {
				const sx = g1.x - gap;
				const sy = g1.cy;
				const farX = allLeft - detourGap;
				const ex = (g2.cx >= g1.cx) ? g2.x - gap : g2.x + g2.w + gap;
				const ey = g2.cy;
				return [
					{ x: sx, y: sy },
					{ x: farX, y: sy },
					{ x: farX, y: ey },
					{ x: ex, y: ey },
				];
			})();
			if (!BlogAssembler._polylineHitsAny(leftDetour, otherBoxes, 2)) {
				return { points: leftDetour, kind: "detour-left" };
			}
			// (c) 하단 우회 (g1 아래 → 박스군 아래 → g2 아래에서 위로 진입)
			const allTop = Math.min(...otherBoxes.map(b => b.y), g1.y, g2.y);
			const allBottom = Math.max(...otherBoxes.map(b => b.y + b.h), g1.y + g1.h, g2.y + g2.h);
			const bottomDetour = (() => {
				const sx = g1.cx;
				const sy = g1.y + g1.h + gap;
				const farY = allBottom + detourGap;
				const ex = g2.cx;
				const ey = (g2.cy >= g1.cy) ? g2.y - gap : g2.y + g2.h + gap;
				return [
					{ x: sx, y: sy },
					{ x: sx, y: farY },
					{ x: ex, y: farY },
					{ x: ex, y: ey },
				];
			})();
			if (!BlogAssembler._polylineHitsAny(bottomDetour, otherBoxes, 2)) {
				return { points: bottomDetour, kind: "detour-bottom" };
			}
			// (d) 상단 우회
			const topDetour = (() => {
				const sx = g1.cx;
				const sy = g1.y - gap;
				const farY = allTop - detourGap;
				const ex = g2.cx;
				const ey = (g2.cy >= g1.cy) ? g2.y - gap : g2.y + g2.h + gap;
				return [
					{ x: sx, y: sy },
					{ x: sx, y: farY },
					{ x: ex, y: farY },
					{ x: ex, y: ey },
				];
			})();
			if (!BlogAssembler._polylineHitsAny(topDetour, otherBoxes, 2)) {
				return { points: topDetour, kind: "detour-top" };
			}
		}

		// 모든 시도 실패 — 직선 fallback (최소 시각 손상)
		return { points: directPoints, kind: "fallback-direct" };
	}

	// mermaid 코드 → PNG dataURL (Canvas 경로)
	static async mermaidToPngDataUrl(mermaidCode, scale = 3) {
		const { mte, api } = await BlogAssembler._loadExcalidrawLibs();
		// sanitize를 항상 1차에 적용 (다이아몬드/em-dash 중복 등 LLM 실수 사전 차단)
		const cleaned1 = BlogAssembler._sanitizeMermaid(mermaidCode);
		let elements;
		try {
			const r = await mte.parseMermaidToExcalidraw(cleaned1);
			elements = r.elements;
		} catch (e1) {
			// 7회차 보강 (DD11): mermaid 파싱 실패 시 디버깅 정보를 충분히 남긴다.
			//   기존: e1.message만 출력 → 어떤 입력이 깨졌는지/sanitize가 무엇을 변경했는지 추적 불가.
			//   변경: 원본 + 1차 sanitize 결과 + stack을 console.group으로 묶어 출력. 운영자가 DevTools에서 한눈에 비교 가능.
			console.group("mermaid 파싱 1차 실패 — 디버그 정보");
			console.warn("error message:", e1.message);
			if (e1.stack) console.warn("stack:", e1.stack);
			console.warn("원본 mermaid 코드 (first 500 chars):", String(mermaidCode).slice(0, 500));
			console.warn("1차 sanitize 결과 (first 500 chars):", cleaned1.slice(0, 500));
			console.groupEnd();
			console.warn("추가 sanitize 후 재시도");
			const cleaned2 = BlogAssembler._sanitizeMermaid(cleaned1);
			try {
				const r = await mte.parseMermaidToExcalidraw(cleaned2);
				elements = r.elements;
			} catch (e2) {
				// 2차 실패 시 호출자가 원본 코드를 즉시 볼 수 있도록 message에 snippet을 부착해 throw.
				console.group("mermaid 파싱 2차 실패 — 최종 fallback 진입");
				console.error("2차 error:", e2.message);
				if (e2.stack) console.error("stack:", e2.stack);
				console.error("2차 sanitize 결과 (first 500 chars):", cleaned2.slice(0, 500));
				console.groupEnd();
				const snippet = String(mermaidCode).slice(0, 120).replace(/\s+/g, " ");
				throw new Error(`mermaid 파싱 2회 실패: ${e2.message} | code="${snippet}..."`);
			}
		}
		const shapeEls = elements.filter((e) => ["rectangle", "ellipse", "diamond"].includes(e.type));

		// ── 레이아웃 후처리: "글자가 꽉 참 / 세로 간격 좁음 / 횡 4개 나열 / 위계 없음" 4대 불편 해결 ──
		// (a) 박스 인플레이션: 라벨 길이 기반으로 width/height 확대 → 내부 여백 확보
		// (b) y 좌표 확장: 행 간 간격을 1.55배 → 세로 화살표가 충분히 길어짐
		// (c) 같은 y의 잎노드(자식 없음)가 3개 이상이면 2열 그리드로 재배치 → 좁은 화면에서도 가독
		// (d) 시각 위계: 루트(in-degree 0) > 일반 노드 > 잎노드(out-degree 0) 순으로 fontSize/strokeWidth 차등
		const arrowEls = elements.filter((e) => e.type === "arrow");
		// 9회차 핵심 수정: mermaid-to-excalidraw 1.1.2는 박스 식별자를 startBinding이 아니라
		// start.id / end.id 로 넘긴다. 둘 다 fallback 으로 검사한다.
		const _sIdOf = (a) =>
			(a.start && a.start.id) ||
			(a.startBinding && a.startBinding.elementId) || null;
		const _eIdOf = (a) =>
			(a.end && a.end.id) ||
			(a.endBinding && a.endBinding.elementId) || null;
		const inDeg = new Map();
		const outDeg = new Map();
		for (const a of arrowEls) {
			const sId = _sIdOf(a);
			const eId = _eIdOf(a);
			if (sId) outDeg.set(sId, (outDeg.get(sId) || 0) + 1);
			if (eId) inDeg.set(eId, (inDeg.get(eId) || 0) + 1);
		}
		// 14회차(2026-05-01): 고립 노드 (in/out degree 모두 0) 제거.
		//   결함: mermaid 코드에 노드만 선언되고 어떤 화살표 source/target도 안 된 박스가
		//        다이어그램에 떠 있어 시각 노이즈 + "GAN 박스 화살표 누락" 결함 유발.
		//   해결: degree=0 박스는 skeleton 빌드 단계에서 제외. 컨테이너(subgraph)는 자식이 있으니 보존.
		const isolatedIds = new Set();
		for (const el of shapeEls) {
			if (BlogAssembler._isContainer(el, shapeEls)) continue;
			const id = el.id;
			const ii = inDeg.get(id) || 0;
			const oi = outDeg.get(id) || 0;
			if (ii === 0 && oi === 0) {
				isolatedIds.add(id);
				console.warn(`[고립 노드 제거] "${(el.label && el.label.text) || id}" — 어떤 화살표와도 연결 없음`);
			}
		}
		// 14회차(2026-05-01): cycle 검출 + 마지막 엣지 자동 제거 (DAG 강제).
		//   결함: LLM이 cycle 그리면 elkjs가 layered 알고리즘으로 풀면서 시각 흐름이 거꾸로 보임 (베테랑 탐정이 루트로 올라가는 등).
		//   해결: DFS로 cycle 검출 → cycle을 닫는 마지막 엣지(back edge)의 arrow를 무효화 → 그래프가 DAG가 됨.
		const removedArrowIds = new Set();
		try {
			// adjacency 구성 (id → 자식 id 배열)
			const adj = new Map();
			for (const el of shapeEls) adj.set(el.id, []);
			for (const a of arrowEls) {
				const sId = _sIdOf(a);
				const eId = _eIdOf(a);
				if (sId && eId && adj.has(sId)) adj.get(sId).push({ to: eId, arrowId: a.id });
			}
			// DFS로 back edge 검출 (gray-set 알고리즘)
			const WHITE = 0, GRAY = 1, BLACK = 2;
			const color = new Map();
			for (const id of adj.keys()) color.set(id, WHITE);
			const dfs = (u) => {
				color.set(u, GRAY);
				for (const { to, arrowId } of adj.get(u) || []) {
					if (removedArrowIds.has(arrowId)) continue;
					const c = color.get(to);
					if (c === GRAY) {
						// back edge — cycle 닫는 엣지. 무효화.
						removedArrowIds.add(arrowId);
						console.warn(`[cycle 제거] "${u}" → "${to}" 엣지 무효화 (DAG 강제)`);
					} else if (c === WHITE || c === undefined) {
						dfs(to);
					}
				}
				color.set(u, BLACK);
			};
			for (const id of adj.keys()) {
				if (color.get(id) === WHITE) dfs(id);
			}
		} catch (cycleErr) {
			console.warn(`[cycle 검출 실패] ${cycleErr.message}`);
		}
		// 잎/루트 분류 (컨테이너 제외)
		const tierOf = (el) => {
			if (BlogAssembler._isContainer(el, shapeEls)) return "container";
			const id = el.id;
			const oi = outDeg.get(id) || 0;
			const ii = inDeg.get(id) || 0;
			if (ii === 0 && oi > 0) return "root";        // 출발점
			if (oi === 0 && ii > 0) return "leaf";        // 도착점
			if (oi === 0 && ii === 0) return "isolated";  // 고립
			return "mid";
		};

		// (a) 박스 인플레이션 — 한글 라벨 visible width 기반 + 최소 패딩 확보
		// 4회차 보강: NFC 정규화 + grapheme 단위 visualLen (BlogAssembler._visualLen)
		const visualLen = BlogAssembler._visualLen;
		// 노드별 목표 width/height 계산 후 좌표 보정
		// 단순 비례 인플레이션이 아니라 "max(원본, 라벨 기반 최소치)"로 처리해
		// 짧은 라벨 박스가 과도하게 커지는 부작용 방지.
		const inflated = new Map(); // id → { dx, dy } 변경량
		for (const el of shapeEls) {
			if (BlogAssembler._isContainer(el, shapeEls)) continue;
			const text = (el.label && el.label.text) || "";
			const vlen = visualLen(text);
			// 한글 1글자 ≈ 14px (fontSize 20 기준) — 좌우 32px 패딩 추가
			const targetW = Math.max(el.width, vlen * 14 + 64);
			const targetH = Math.max(el.height, 64);
			const dx = targetW - el.width;
			const dy = targetH - el.height;
			inflated.set(el.id, { dx, dy, newW: targetW, newH: targetH });
		}

		// 14회차 신설: elkjs 직교 라우팅 우선 시도.
		// elk가 박스 좌표 + 직교 화살표 경로를 한 번에 계산 → 박스 관통 0건 보장.
		// 실패 시(라이브러리 로드 실패, 결과 sections 없음 등) 기존 visibility graph 파이프라인으로 자동 폴백.
		// elk 결과가 있으면 elkXMap/elkYMap이 채워지고 elkArrowPoints에 화살표별 절대좌표 폴리라인이 저장됨.
		const elkXMap = new Map();
		const elkYMap = new Map();
		const elkArrowPoints = new Map(); // arrow.id → [{x,y}, ...]
		let elkUsed = false;
		// elk는 컨테이너/subgraph가 없는 단순 그래프에서만 적용 (컨테이너는 자체 레이아웃 로직 사용)
		const hasContainer = shapeEls.some((s) => BlogAssembler._isContainer(s, shapeEls));
		const _nonContainerForElk = shapeEls.filter((s) => !BlogAssembler._isContainer(s, shapeEls));
		if (!hasContainer && _nonContainerForElk.length >= 2 && arrowEls.length >= 1) {
			try {
				const elk = await BlogAssembler._loadElkLib();
				const elkChildren = _nonContainerForElk.map((s) => {
					const inf = inflated.get(s.id);
					return {
						id: s.id,
						width: Math.max(80, inf ? inf.newW : s.width),
						height: Math.max(50, inf ? inf.newH : s.height),
					};
				});
				const elkEdges = [];
				for (let i = 0; i < arrowEls.length; i++) {
					const a = arrowEls[i];
					if (removedArrowIds.has(a.id)) continue; // cycle back edge 제거
					const sId = _sIdOf(a);
					const eId = _eIdOf(a);
					if (!sId || !eId) continue;
					if (!elkChildren.find((c) => c.id === sId)) continue;
					if (!elkChildren.find((c) => c.id === eId)) continue;
					elkEdges.push({ id: `e${i}`, sources: [sId], targets: [eId], _origIdx: i });
				}
				if (elkEdges.length >= 1) {
					const elkGraph = {
						id: "root",
						layoutOptions: {
							"elk.algorithm": "layered",
							"elk.direction": "DOWN",
							"elk.layered.spacing.nodeNodeBetweenLayers": "90",
							"elk.spacing.nodeNode": "70",
							"elk.edgeRouting": "ORTHOGONAL",
							"elk.layered.crossingMinimization.semiInteractive": "true",
							"elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
							"elk.spacing.edgeNode": "100", // 14회차(2026-05-01): 80→100. bend 직선이 박스 외곽선과 ~5px 평행 라우팅 결함 차단.
							"elk.spacing.edgeEdge": "40",  // 30→40. 인접 화살표 시각 분리.
							"elk.edgeLabels.placement": "HEAD",  // edge label을 화살표 머리 부근에 배치 → 박스 코너 겹침 차단.
							"elk.spacing.edgeLabel": "20",  // edge label과 화살표 path 사이 간격 확보.
						},
						children: elkChildren,
						edges: elkEdges.map((e) => ({ id: e.id, sources: e.sources, targets: e.targets })),
					};
					const layouted = await Promise.race([
						elk.layout(elkGraph),
						new Promise((_, reject) => setTimeout(() => reject(new Error("elk timeout 5000ms")), 5000)),
					]);
					// 박스 좌표 추출
					if (layouted && Array.isArray(layouted.children)) {
						for (const c of layouted.children) {
							if (typeof c.x === "number" && typeof c.y === "number") {
								elkXMap.set(c.id, c.x);
								elkYMap.set(c.id, c.y);
							}
						}
					}
					// 화살표 경로 추출 (sections 기반)
					// 14회차 정정(2026-05-01): 이전 ARROW_GAP=24는 endpoint를 박스 외부 24px로 끌어내
					//   화살표가 박스에서 출발/도착하지 않고 공중에서 끊겨 보이는 결함을 만들었다.
					//   엣지는 노드(박스 경계)에서 정확히 출발/도착해야 한다.
					//   해결: clamp는 *박스 안 침범만 차단*하고 박스 경계에 정확히 붙도록(gap=0).
					//   그래도 화살표 머리가 박스 안으로 1~4px 들어가는 시각 결함이 보이면 별도 처리(머리 길이 축소).
					const childById = new Map();
					if (layouted && Array.isArray(layouted.children)) {
						for (const c of layouted.children) childById.set(c.id, c);
					}
					// pt가 박스 안 *내부*에 있으면 박스 경계로 끌어냄. 박스 경계 위/외부면 그대로.
					const clampOutsideBox = (pt, child) => {
						if (!child) return pt;
						const bx = child.x, by = child.y;
						const bw = child.width, bh = child.height;
						// 박스 *내부* (경계 포함 안 함) 검사
						const inside = pt.x > bx && pt.x < bx + bw &&
							pt.y > by && pt.y < by + bh;
						if (!inside) return pt; // 경계 위 또는 외부면 그대로 — 노드에서 정확히 출발/도착
						// 박스 4면 중 점에서 가장 가까운 변으로 끌어냄 (gap=0, 경계에 정확히 붙음)
						const dxLeft = Math.abs(pt.x - bx);
						const dxRight = Math.abs(pt.x - (bx + bw));
						const dyTop = Math.abs(pt.y - by);
						const dyBottom = Math.abs(pt.y - (by + bh));
						const minD = Math.min(dxLeft, dxRight, dyTop, dyBottom);
						if (minD === dxLeft) return { x: bx, y: pt.y };
						if (minD === dxRight) return { x: bx + bw, y: pt.y };
						if (minD === dyTop) return { x: pt.x, y: by };
						return { x: pt.x, y: by + bh };
					};
					if (layouted && Array.isArray(layouted.edges)) {
						for (let k = 0; k < layouted.edges.length; k++) {
							const ed = layouted.edges[k];
							const origIdx = elkEdges[k] ? elkEdges[k]._origIdx : -1;
							if (origIdx < 0) continue;
							const sec = ed.sections && ed.sections[0];
							if (!sec || !sec.startPoint || !sec.endPoint) continue;
							const srcChild = childById.get(elkEdges[k].sources[0]);
							const tgtChild = childById.get(elkEdges[k].targets[0]);
							let startPt = { x: sec.startPoint.x, y: sec.startPoint.y };
							let endPt = { x: sec.endPoint.x, y: sec.endPoint.y };
							// startPt: 박스 안 침범만 차단 (gap=0, 박스 경계에 정확히 붙음 — 머리 없으니 침범 없음)
							startPt = clampOutsideBox(startPt, srcChild);
							// endPt: 박스 안 침범 차단 + 화살표 머리 길이만큼 박스 외부로 추가 마진(HEAD_GAP=12).
							//   strokeWidth=2~3에서 화살표 머리 길이 ≈ 10~12px → 머리 끝이 박스 경계에 정확히 닿음.
							//   gap=0이면 머리가 박스 안 ~10px 침범, gap=24는 너무 멀어 화살표 끊겨 보임.
							endPt = clampOutsideBox(endPt, tgtChild);
							if (tgtChild) {
								const HEAD_GAP = 12;
								const tx = tgtChild.x, ty = tgtChild.y;
								const tw = tgtChild.width, th = tgtChild.height;
								// 도착점이 박스 변 위에 정확히 있으면 변 외부로 HEAD_GAP만큼 밀어냄
								const onLeft = Math.abs(endPt.x - tx) < 0.5;
								const onRight = Math.abs(endPt.x - (tx + tw)) < 0.5;
								const onTop = Math.abs(endPt.y - ty) < 0.5;
								const onBottom = Math.abs(endPt.y - (ty + th)) < 0.5;
								if (onLeft) endPt = { x: endPt.x - HEAD_GAP, y: endPt.y };
								else if (onRight) endPt = { x: endPt.x + HEAD_GAP, y: endPt.y };
								else if (onTop) endPt = { x: endPt.x, y: endPt.y - HEAD_GAP };
								else if (onBottom) endPt = { x: endPt.x, y: endPt.y + HEAD_GAP };
							}
							const pts = [startPt];
							if (Array.isArray(sec.bendPoints)) {
								for (const bp of sec.bendPoints) pts.push({ x: bp.x, y: bp.y });
							}
							pts.push(endPt);
							const arrow = arrowEls[origIdx];
							if (arrow && arrow.id) elkArrowPoints.set(arrow.id, pts);
						}
					}
					if (elkXMap.size === _nonContainerForElk.length && elkArrowPoints.size === elkEdges.length) {
						elkUsed = true;
						console.log(`elkjs 라우팅 성공: 박스 ${elkXMap.size}개, 화살표 ${elkArrowPoints.size}개`);
					} else {
						console.warn(`elkjs 결과 불완전: 박스 ${elkXMap.size}/${_nonContainerForElk.length}, 화살표 ${elkArrowPoints.size}/${elkEdges.length} → visibility graph 폴백`);
						elkXMap.clear();
						elkYMap.clear();
						elkArrowPoints.clear();
					}
				}
			} catch (elkErr) {
				console.warn("elkjs 라우팅 실패, visibility graph 폴백:", elkErr && elkErr.message);
				elkXMap.clear();
				elkYMap.clear();
				elkArrowPoints.clear();
			}
		}

		// (b) 행 간격 확장: y 좌표를 행 단위로 묶어 1.55배 stretching
		// 행 = y 좌표가 ±20px 이내로 가까운 노드 그룹
		const nonContainer = shapeEls.filter((s) => !BlogAssembler._isContainer(s, shapeEls));
		const rows = [];
		const sorted = [...nonContainer].sort((a, b) => a.y - b.y);
		for (const s of sorted) {
			let row = rows.find((r) => Math.abs(r.y - s.y) < 20);
			if (!row) { row = { y: s.y, items: [] }; rows.push(row); }
			row.items.push(s);
		}
		rows.sort((a, b) => a.y - b.y);
		// 각 행의 새 y 위치 계산 (간격 1.55배)
		const yMap = new Map(); // shape.id → newY
		if (rows.length > 0) {
			let cursor = rows[0].y;
			for (let i = 0; i < rows.length; i++) {
				const r = rows[i];
				if (i === 0) {
					for (const s of r.items) yMap.set(s.id, cursor);
				} else {
					const prev = rows[i - 1];
					const origGap = r.y - prev.y;
					const newGap = Math.max(origGap * 1.9, origGap + 90); // 13회차: 1.55→1.9, +60→+90. 화살표가 박스에서 충분히 멀리 떨어질 공간.
					cursor = cursor + newGap;
					for (const s of r.items) yMap.set(s.id, cursor);
				}
			}
		}

		// 3회차 엣지케이스 가드: 노드 0개 또는 화살표 0개일 때 그리드/시프트 스킵
		// (단일 노드 / 모든 노드가 isolated인 mermaid → 위계 분류 불가, 그리드 트리거 X)
		const NO_GRID = nonContainer.length <= 2 || arrowEls.length === 0;
		// (c) 같은 행의 잎노드가 3개 이상이면 그리드로 재배치 (2열 또는 3열)
		// (페퍼로니+올리브, 페퍼로니+양파, 버섯+올리브, 버섯+양파 같은 4조합 케이스)
		// 2회차 보강:
		//   - 잎 6~9개도 비례를 유지하도록 cols 동적 결정 (5개 이상이면 3열)
		//   - 라벨이 매우 긴 경우 maxW 상한(280px) 적용 — 모바일 가독성 확보
		//   - 그리드로 인해 행이 늘어나면 그 아래 모든 비-잎 행을 추가 y만큼 밀어 충돌 방지
		//   - 가로 중앙 = 원래 leaves의 좌우 끝(min x, max x+width) 평균 — leaves[last] 가정 제거
		const xMap = new Map(); // shape.id → newX
		const ROW_INDEX = new Map(); // row 객체 → 인덱스 (충돌 보정용)
		rows.forEach((r, idx) => ROW_INDEX.set(r, idx));
		const yShiftAfter = new Array(rows.length).fill(0); // i행 이후에 추가될 누적 y
		for (let ri = 0; ri < rows.length; ri++) {
			if (NO_GRID) break; // 단일 노드/엣지 없음 → 그리드 스킵
			const r = rows[ri];
			const leaves = r.items.filter((s) => tierOf(s) === "leaf");
			if (leaves.length >= 3 && leaves.length === r.items.length) {
				// cols 동적: 5개 이상은 3열, 그 외 2열 (4조합·6조합·9조합 모두 비율 합리적)
				const cols = leaves.length >= 5 ? 3 : 2;
				// 박스 너비 상한: 280px (한글 16자 ≈ 224px + 패딩)
				const MAX_BOX_W = 280;
				const widths = leaves.map((s) => Math.min(MAX_BOX_W, (inflated.get(s.id)?.newW) || s.width));
				const maxW = Math.max(...widths);
				const colGap = 50;
				const rowGap = 70;
				// 가로 중앙 = 원래 잎노드 좌우 끝점 평균 (정확)
				const lefts = leaves.map((s) => s.x);
				const rights = leaves.map((s) => s.x + s.width);
				const center = (Math.min(...lefts) + Math.max(...rights)) / 2;
				const gridW = cols * maxW + (cols - 1) * colGap;
				const startX = center - gridW / 2;
				const baseY = yMap.get(leaves[0].id) ?? r.y;
				let extraRows = 0;
				for (let i = 0; i < leaves.length; i++) {
					const c = i % cols;
					const rr = Math.floor(i / cols);
					if (rr > extraRows) extraRows = rr;
					const wOrig = (inflated.get(leaves[i].id)?.newW) || leaves[i].width;
					const w = Math.min(MAX_BOX_W, wOrig);
					const h = (inflated.get(leaves[i].id)?.newH) || leaves[i].height;
					// 폭 상한 적용 → inflated 갱신 (이후 skeleton 단계에서 newW로 사용)
					if (wOrig > MAX_BOX_W && inflated.has(leaves[i].id)) {
						const cur = inflated.get(leaves[i].id);
						inflated.set(leaves[i].id, { ...cur, newW: MAX_BOX_W });
					}
					xMap.set(leaves[i].id, startX + c * (maxW + colGap) + (maxW - w) / 2);
					yMap.set(leaves[i].id, baseY + rr * (h + rowGap));
				}
				// 그리드로 늘어난 행 수만큼 이후 모든 행을 아래로 밀기 (충돌 방지)
				if (extraRows > 0) {
					const sampleH = (inflated.get(leaves[0].id)?.newH) || leaves[0].height;
					const shift = extraRows * (sampleH + rowGap);
					for (let k = ri + 1; k < rows.length; k++) yShiftAfter[k] += shift;
				}
			}
		}
		// 그리드로 인한 누적 shift를 비-잎 노드(다음 행)에 반영
		for (let ri = 0; ri < rows.length; ri++) {
			if (yShiftAfter[ri] === 0) continue;
			for (const s of rows[ri].items) {
				const cur = yMap.get(s.id);
				if (cur != null) yMap.set(s.id, cur + yShiftAfter[ri]);
			}
		}

		// 14회차: elk가 성공했으면 grid/inflation 좌표를 elk 결과로 덮어쓴다.
		// elk 결과는 원점(0,0) 기준이므로 그대로 사용해도 무방.
		if (elkUsed) {
			for (const [id, x] of elkXMap) xMap.set(id, x);
			for (const [id, y] of elkYMap) yMap.set(id, y);
		}

		// 컨테이너(subgraph)는 내부 자식들의 새 bounding box를 감싸도록 재계산
		// (자식 박스 인플레이션 + 그리드 재배치 후에도 컨테이너가 자식을 잘라먹지 않도록)
		const containerBounds = new Map(); // containerId → {x,y,w,h}
		for (const el of shapeEls) {
			if (!BlogAssembler._isContainer(el, shapeEls)) continue;
			let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
			let any = false;
			for (const child of shapeEls) {
				if (child === el) continue;
				if (BlogAssembler._isContainer(child, shapeEls)) continue;
				// 원본 좌표 기준으로 컨테이너에 속하는지 확인
				if (
					child.x >= el.x - 2 &&
					child.y >= el.y - 2 &&
					child.x + child.width <= el.x + el.width + 2 &&
					child.y + child.height <= el.y + el.height + 2
				) {
					any = true;
					const inf = inflated.get(child.id);
					const cx = xMap.has(child.id) ? xMap.get(child.id) : child.x;
					const cy = yMap.has(child.id) ? yMap.get(child.id) : child.y;
					const cw = inf ? inf.newW : child.width;
					const ch = inf ? inf.newH : child.height;
					if (cx < minX) minX = cx;
					if (cy < minY) minY = cy;
					if (cx + cw > maxX) maxX = cx + cw;
					if (cy + ch > maxY) maxY = cy + ch;
				}
			}
			if (any) {
				const PAD = 24;
				containerBounds.set(el.id, {
					x: minX - PAD,
					y: minY - PAD - 16, // 라벨 공간
					w: (maxX - minX) + PAD * 2,
					h: (maxY - minY) + PAD * 2 + 16,
				});
			}
		}

		// 8회차 보강: 화살표 좌표 재계산을 위해 모든 박스의 새 geometry를 미리 계산한다.
		// (이전 회차 — 2회차에서 points를 의도적으로 미전달하고 Excalidraw 자동 라우팅에 의존했지만,
		//  실제 출력에서는 화살표가 박스 내부로 파고들거나 끊어지는 결함이 발생.
		//  근본 원인: convertToExcalidrawElements는 start/end의 elementId를 받아도 박스의 *원본 좌표*를
		//  찾지 못하면 fallback으로 임의 위치에 endpoint를 찍는다. 그리고 박스 인플레이션/y stretching
		//  적용 후의 새 좌표를 모르므로 깔끔한 boundary-to-boundary 라우팅이 불가능.)
		// 해결: 박스별 새 geometry를 boxGeom Map에 저장 → 각 화살표 출발/도착 박스의
		//       경계점(상하좌우 4면 중 가장 가까운 면 중앙)을 직접 계산 → arrow.x/y/points 명시.
		const boxGeom = new Map(); // id → { x, y, w, h, cx, cy }
		for (const el of shapeEls) {
			const isContainer = BlogAssembler._isContainer(el, shapeEls);
			if (isContainer) continue; // 컨테이너는 화살표 endpoint로 쓰이지 않음
			const inf = inflated.get(el.id);
			const nx = xMap.has(el.id) ? xMap.get(el.id) : el.x;
			const ny = yMap.has(el.id) ? yMap.get(el.id) : el.y;
			const nw = inf ? inf.newW : el.width;
			const nh = inf ? inf.newH : el.height;
			boxGeom.set(el.id, { x: nx, y: ny, w: nw, h: nh, cx: nx + nw / 2, cy: ny + nh / 2 });
		}

		// 각 shape를 파스텔 컬러 + 손그림 스타일로 재구성 (한글 라벨 포함)
		// 3회차 보강: 결정론적 seed — 동일 mermaid 코드 → 동일 PNG 보장.
		//   roughness=2 의 손그림 효과는 내부적으로 시드 기반 노이즈를 사용하므로
		//   seed를 명시하지 않으면 매 호출마다 박스 외곽선이 미세하게 달라진다 → diff 노이즈.
		//   인덱스 기반 결정론적 시드(0xCAFE + idx)로 재현 가능한 출력 확보.
		const SEED_BASE = 0xcafe;
		const skeleton = [];
		let shapeIdx = 0;
		for (const el of elements) {
			if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
				// 14회차(2026-05-01): 고립 노드는 skeleton에 포함 안 함 → 다이어그램에서 사라짐
				if (isolatedIds.has(el.id)) continue;
				const isContainer = BlogAssembler._isContainer(el, shapeEls);
				const color = BlogAssembler._PALETTE[shapeIdx % BlogAssembler._PALETTE.length];
				shapeIdx++;
				const tier = tierOf(el);
				// 후처리된 좌표/크기 적용 (컨테이너는 별도 bounding box)
				const inf = inflated.get(el.id);
				const cb = containerBounds.get(el.id);
				const newX = cb ? cb.x : (xMap.has(el.id) ? xMap.get(el.id) : el.x);
				const newY = cb ? cb.y : (yMap.has(el.id) ? yMap.get(el.id) : el.y);
				const newW = cb ? cb.w : (inf ? inf.newW : el.width);
				const newH = cb ? cb.h : (inf ? inf.newH : el.height);
				// (d) 시각 위계: tier별 fontSize/strokeWidth 차등
				let fontSize = 20;
				let strokeWidth = 2;
				if (isContainer) { fontSize = 16; strokeWidth = 1; }
				else if (tier === "root") { fontSize = 24; strokeWidth = 3; }
				else if (tier === "leaf") { fontSize = 18; strokeWidth = 2; }
				const item = {
					type: el.type,
					x: newX, y: newY,
					width: newW, height: newH,
					id: el.id,
					strokeColor: isContainer ? "#94a3b8" : color.stroke,
					backgroundColor: isContainer ? "transparent" : color.bg,
					fillStyle: isContainer ? "solid" : "hachure",
					strokeWidth: strokeWidth,
					roughness: isContainer ? 1 : 2,
					strokeStyle: isContainer ? "dashed" : "solid",
					seed: SEED_BASE + skeleton.length, // 결정론적 시드 (idx 기반)
				};
				if (el.label && el.label.text) {
					// 3회차 보강:
					//  - textAlign/verticalAlign 명시 (Excalidraw 기본은 "left/top" → 박스 인플레이션 후 좌상단 쏠림)
					//  - em-dash 양옆에 zero-width-space(​) 삽입 → 자동 줄바꿈 시 단어 단위 wrap
					//    (mermaid가 만드는 "기술용어 — 비유" 라벨이 한 줄에 안 들어갈 때 — 기준으로 깔끔하게 끊김)
					let labelText = el.label.text;
					labelText = labelText.replace(/\s*—\s*/g, " ​—​ ");
					item.label = {
						text: labelText,
						fontFamily: 1, // Virgil은 한글 미지원 → 1번(Cascadia)이 SVG 단계에서 Gaegu로 교체됨
						fontSize: fontSize,
						strokeColor: isContainer ? "#64748b" : color.stroke,
						textAlign: "center",
						verticalAlign: "middle",
					};
				}
				skeleton.push(item);
			} else if (el.type === "arrow") {
				// 14회차(2026-05-01): cycle back edge로 검출된 화살표는 skeleton에 포함 안 함
				if (removedArrowIds.has(el.id)) continue;
				// 9회차 근본 해결:
				// 1) mermaid-to-excalidraw 1.1.2 는 박스 식별자를 *start.id / end.id* 로 넘긴다 (startBinding 아님).
				//    8회차 코드는 startBinding.elementId만 봐서 sId/eId가 항상 null 이었고
				//    boxGeom 분기를 한 번도 타지 않았다 → 모든 화살표가 원본 좌표 그대로 = 박스 침범.
				// 2) binding 식별자(start.id/end.id)를 살린 채로 명시 points를 함께 넘기면
				//    Excalidraw가 binding 우선으로 자체 라우팅 → 명시 points 덮어쓴다.
				//    따라서 식별자는 박스 매칭 *용도로만* 쓰고, item.start/end 는 생략한다.
				const sId = _sIdOf(el);
				const eId = _eIdOf(el);
				const g1 = sId ? boxGeom.get(sId) : null;
				const g2 = eId ? boxGeom.get(eId) : null;
				const item = {
					type: "arrow",
					strokeColor: "#1e293b", // 3회차: #475569 → #1e293b (배경 #fafafa 대비 12.6:1, AAA)
					strokeWidth: 2.5,        // 가독성 강화 (2 → 2.5)
					roughness: 1,            // 13회차: 2→1. sketchy 흔들림 ±5~8 → ±2~3. 좁은 그래프 박스 침범 시각 결함 차단.
					seed: SEED_BASE + skeleton.length,
				};
				if (g1 && g2) {
					// 14회차: elkjs가 라우팅한 직교 경로가 있으면 우선 사용.
					let pts = null;
					if (elkUsed && elkArrowPoints.has(el.id)) {
						const elkPts = elkArrowPoints.get(el.id);
						// elk 결과 안전 검증: 다른 박스 관통하지 않는지 polylineHits로 한 번 더 확인.
						const otherBoxesCheck = [];
						for (const [bid, bg] of boxGeom) {
							if (bid === sId || bid === eId) continue;
							otherBoxesCheck.push(bg);
						}
						if (!BlogAssembler._polylineHitsAny(elkPts, otherBoxesCheck, 1)) {
							pts = elkPts;
						} else {
							console.warn(`elk 화살표 ${el.id} 박스 관통 감지 → visibility graph 폴백`);
						}
					}
					if (!pts) {
						// 10회차 직교 라우팅 (elk 미사용 또는 elk 결과 박스 관통 시 폴백):
						// 직선/L-vertical/L-horizontal/큰 우회 순으로 시도하여 박스 관통 없는 경로 선택.
						const otherBoxes = [];
						for (const [bid, bg] of boxGeom) {
							if (bid === sId || bid === eId) continue;
							otherBoxes.push(bg);
						}
						const route = BlogAssembler._routeArrow(g1, g2, otherBoxes, 6);
						pts = route.points;
					}
					const sx = pts[0].x, sy = pts[0].y;
					item.x = sx;
					item.y = sy;
					// 절대 좌표 → 시작점 [0,0] 기준 상대 좌표
					item.points = pts.map(p => [p.x - sx, p.y - sy]);
					// bbox 계산 — 모든 점 기준
					const xs = pts.map(p => p.x - sx);
					const ys = pts.map(p => p.y - sy);
					item.width = Math.max(...xs.map(Math.abs)) || 1;
					item.height = Math.max(...ys.map(Math.abs)) || 1;
					// 9회차: item.start / item.end 를 의도적으로 *생략* — binding 없으면 자동 라우팅 발동 X.
				} else {
					// 한쪽 endpoint가 컨테이너거나 바인딩 없는 경우 — 원본 좌표 그대로
					item.x = el.x;
					item.y = el.y;
					item.width = el.width;
					item.height = el.height;
					// 9회차: 여기서도 binding 제거 — Excalidraw 자체 라우팅이 박스 새 좌표를 못 찾음.
				}
				// 14회차(2026-05-01) 변경: edge label 시각 결함(박스 외곽선 겹침/회전/박스 안 박힘) 누적 발견.
				//   해결책: edge label을 다이어그램에 그리지 않고 의미만 alt 텍스트로 보존(_buildAltFromMermaid 처리).
				//   사용자가 본 결함: "진짜로 판정"/"가짜로 판정" 라벨이 박스 코너에 박혀 시각 노이즈 유발.
				//   trade-off: 분기 조건(예: "진짜/가짜 판정") 정보가 다이어그램에서 빠지지만 alt와 본문에서 설명되므로 정보 손실은 미미.
				// if (el.label && el.label.text) { ... }  ← 의도적으로 비활성화
				skeleton.push(item);
			} else if (el.type === "text") {
				// 3회차 보강: 박스에 바인딩 안 된 자유 텍스트 (예: 일부 mermaid 구현의 edge label).
				// containerId가 화살표에 바인딩돼 있으면 화살표 라벨로 간주하고 그대로 둔다 — Excalidraw가 재배치.
				// 그 외 자유 텍스트는 좌표 그대로 통과 (인플레이션 영향 받지 않음).
				// 14회차(2026-05-01): mermaid가 수직 화살표 edge label을 90도 회전(angle=π/2)으로 만들면
				//   세로로 회전된 한글이 박힘. 한글은 가로 쓰기가 자연스러우므로 angle 강제 0.
				const item = {
					type: "text",
					x: el.x, y: el.y,
					text: el.text || "",
					fontFamily: 1,
					fontSize: el.fontSize || 14,
					strokeColor: "#1e293b",
					textAlign: el.textAlign || "center",
					verticalAlign: el.verticalAlign || "middle",
					angle: 0, // edge label 회전 차단 (한글 세로 텍스트 결함 방지)
				};
				if (el.containerId) item.containerId = el.containerId;
				skeleton.push(item);
			}
		}
		const rebuilt = api.convertToExcalidrawElements(skeleton);

		// SVG 경로 시도 (한글 폰트 Gaegu 주입)
		try {
			const svg = await api.exportToSvg({
				elements: rebuilt,
				appState: {
					exportBackground: true,
					viewBackgroundColor: "#fafafa",
					exportPadding: 30,
				},
				files: {},
			});
			// 한글이 포함된 text에 Gaegu 적용
			const texts = svg.querySelectorAll("text");
			for (const t of texts) {
				const c = t.textContent || "";
				if (/[\uAC00-\uD7A3]/.test(c)) {
					t.setAttribute("font-family", "'Gaegu', 'Jua', 'Malgun Gothic', sans-serif");
					const s = t.getAttribute("style") || "";
					t.setAttribute("style", s + "; font-family: 'Gaegu', 'Jua', 'Malgun Gothic', sans-serif !important; font-weight: 700;");
				}
			}
			// @font-face 주입
			const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
			styleEl.textContent = "@import url('https://fonts.googleapis.com/css2?family=Gaegu:wght@700&family=Jua&display=swap'); text { font-family: 'Gaegu', 'Jua', 'Malgun Gothic', sans-serif !important; }";
			svg.insertBefore(styleEl, svg.firstChild);

			// SVG → PNG 래스터화 (Gaegu 로드 후)
			await (document.fonts?.load?.("20px Gaegu") ?? Promise.resolve());
			const svgStr = new XMLSerializer().serializeToString(svg);
			const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
			const url = URL.createObjectURL(svgBlob);
			const img = new Image();
			img.crossOrigin = "anonymous";
			await new Promise((resolve, reject) => {
				img.onload = resolve;
				img.onerror = reject;
				img.src = url;
			});
			const w = parseInt(svg.getAttribute("width")) || 800;
			const h = parseInt(svg.getAttribute("height")) || 600;
			const canvas = document.createElement("canvas");
			canvas.width = w * scale;
			canvas.height = h * scale;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = "#fafafa";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
			URL.revokeObjectURL(url);
			return canvas.toDataURL("image/png");
		} catch (e) {
			console.warn("SVG 경로 실패, Canvas fallback:", e.message);
			const canvas = await api.exportToCanvas({
				elements: rebuilt,
				appState: { exportBackground: true, viewBackgroundColor: "#fafafa" },
				files: {},
				getDimensions: (w, h) => ({ width: w * scale, height: h * scale, scale }),
			});
			return canvas.toDataURL("image/png");
		}
	}

	// 3회차 보강: 스크린리더용 의미 있는 alt 생성.
	// mermaid 코드에서 모든 [라벨]을 순서대로 추출해 "A → B → C 흐름도" 형식 작성.
	// 라벨이 길면 5개로 잘라 "...등 N단계 흐름도"로 축약.
	static _buildAltFromMermaid(code) {
		try {
			// 4회차: NFC 정규화 — alt 텍스트가 NFD로 나가면 스크린리더가 자모 단위 발음
			code = BlogAssembler._toNfc(code);
			const labels = [];
			const re = /\[([^\[\]]+)\]/g;
			let m;
			while ((m = re.exec(code)) !== null) {
				const label = m[1].trim();
				if (label && !labels.includes(label)) labels.push(label);
			}
			if (labels.length === 0) return "diagram";
			// 라벨에서 비유 부분만 추출 ("기술 — 비유" → "비유")해 자연스러운 한국어 alt
			const concise = labels.map((l) => {
				const dashSplit = l.split(/\s*—\s*/);
				return dashSplit.length === 2 ? dashSplit[1].trim() : l;
			});
			if (concise.length <= 5) return concise.join(" → ") + " 흐름도";
			return concise.slice(0, 5).join(" → ") + ` 등 ${concise.length}단계 흐름도`;
		} catch {
			return "diagram";
		}
	}

	// mermaid 코드에서 A[...] --> B[...] 패턴을 추출해 bullet 목록으로 변환.
	// 4회차 보강: id-라벨 매핑을 먼저 수집 → 'A --> B[label]' 또는 'A --> B' 같은 bare id 참조도
	// 라벨로 해석. 이전엔 두 endpoint 모두 [..] 인 경우만 잡혀 fallback이 누락되었음.
	static _mermaidToTextList(code) {
		const norm = BlogAssembler._toNfc(code);
		const lines = norm.split("\n");
		// 1) id → label 사전 수집
		const idLabel = new Map();
		const idLabelRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\[([^\]]+)\]/g;
		let im;
		while ((im = idLabelRe.exec(norm)) !== null) {
			idLabel.set(im[1], im[2].trim());
		}
		// 2) edge 추출
		const bullets = [];
		const edgeRe = /([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?)\s*-->\s*([A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?)/;
		const idOnly = (s) => {
			const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)/);
			return m ? m[1] : "";
		};
		const labelOf = (s) => {
			const m = s.match(/\[([^\]]+)\]/);
			if (m) return m[1].trim();
			const id = idOnly(s);
			return idLabel.get(id) || id;
		};
		for (const line of lines) {
			const m = line.match(edgeRe);
			if (!m) continue;
			const a = labelOf(m[1]);
			const b = labelOf(m[2]);
			if (a && b) bullets.push(`- **${a}** → ${b}`);
		}
		if (bullets.length === 0) return "";
		return bullets.join("\n");
	}

	// 본문 안 ```mermaid 블록을 imgur URL로 변환 후 마크다운 이미지로 치환
	// 4회차 보강: 본문 전체를 NFC 정규화 — LLM이 NFD로 한글을 반환해도 mermaid/라벨이 안정.
	static async replaceMermaidBlocksWithImages(body) {
		if (!body) return body;
		body = BlogAssembler._toNfc(body);
		const blocks = [];
		const re = /```mermaid\s*\n([\s\S]*?)```/g;
		let m;
		while ((m = re.exec(body)) !== null) {
			blocks.push({ full: m[0], code: m[1].trim(), index: m.index });
		}
		if (blocks.length === 0) return body;
		console.log(`mermaid 블록 ${blocks.length}개 변환 시작 (병렬, 동시성=2)`);

		// 5회차 보강: PNG 생성 + imgur 업로드를 직렬에서 병렬로 전환.
		//   기존: for (const b of blocks) { await mermaidToPng + await imgur } — N개면 N×(2~5초) 직렬
		//   변경: Promise.all로 모든 블록 동시 처리. 단 Imgur 무료 등급 rate limit 고려해
		//          내부적으로 동시성 2로 제한 (N개 PNG가 동시에 캔버스 메모리 점유하는 것도 방지).
		//   Excalidraw lib 로드는 race-safe (위 _loadExcalidrawLibs Promise 캐시) — 첫 블록이 로드 중이면
		//   동시 호출은 같은 Promise를 await.
		const CONCURRENCY = 2;
		const indexed = blocks.map((b, idx) => ({ ...b, idx }));
		const results = new Array(blocks.length);

		const processOne = async (b) => {
			try {
				let dataUrl = await BlogAssembler.mermaidToPngDataUrl(b.code, 3);
				const SIZE_LIMIT = 9 * 1024 * 1024; // 9MB (Imgur 안전 마진)
				if (dataUrl.length > SIZE_LIMIT) {
					console.warn(`PNG dataURL ${(dataUrl.length / 1024 / 1024).toFixed(1)}MB 초과 → scale 3→2 재생성`);
					dataUrl = await BlogAssembler.mermaidToPngDataUrl(b.code, 2);
				}
				let imageUrl = dataUrl;
				try {
					const res = await fetch("/api/imgur-upload", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ image: dataUrl.replace(/^data:image\/\w+;base64,/, "") }),
					});
					if (res.ok) {
						const data = await res.json();
						if (data.link) imageUrl = data.link;
					}
				} catch (e) {
					console.warn("imgur 업로드 실패, dataURL 사용:", e.message);
				}
				const altText = BlogAssembler._buildAltFromMermaid(b.code);
				const safeAlt = altText.replace(/[\[\]()]/g, " ").replace(/\s+/g, " ").trim() || "diagram";
				return { full: b.full, replacement: `![diagram-${safeAlt}](${imageUrl})` };
			} catch (e) {
				// 7회차 보강 (DD11): 블록 단위 실패 시에도 원본 코드 snippet을 함께 출력.
				//   기존: e.message만 → 다중 블록 환경에서 어떤 입력이 문제인지 즉시 식별 불가.
				const codeSnippet = String(b.code || "").slice(0, 200).replace(/\s+/g, " ");
				console.warn(`mermaid 변환 실패 (블록 #${b.idx}): ${e.message} | code="${codeSnippet}..."`);
				let textFallback = BlogAssembler._mermaidToTextList(b.code);
				if (!textFallback) {
					const labels = [];
					const re2 = /\[([^\[\]]+)\]/g;
					let m2;
					while ((m2 = re2.exec(b.code)) !== null) {
						const t = m2[1].trim();
						if (t && !labels.includes(t)) labels.push(t);
					}
					if (labels.length >= 2) {
						textFallback = labels.map((l) => `- ${l}`).join("\n");
					} else if (labels.length === 1) {
						textFallback = `- ${labels[0]}`;
					}
				}
				if (!textFallback) {
					textFallback = "> 다이어그램을 표시할 수 없습니다 — 본문의 매핑 표를 참고하세요.";
				}
				return { full: b.full, replacement: textFallback };
			}
		};

		// 동시성 제한 풀링 (CONCURRENCY개 워커가 큐에서 작업 pull)
		let cursor = 0;
		const worker = async () => {
			while (true) {
				const my = cursor++;
				if (my >= indexed.length) return;
				results[my] = await processOne(indexed[my]);
			}
		};
		await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indexed.length) }, worker));

		let result = body;
		for (const r of results) {
			result = result.replace(r.full, r.replacement);
		}
		return result;
	}

	// GFM 테이블 헤더/구분선 누락 자동 보정 + 깨진 separator 수리.
	// sentinel은 marked bold(`__`) 문법과 충돌 피하려 언더스코어 없는 토큰 사용.
	static _fixTables(md) {
		const HIDE_TOKEN = "zhdrsntz"; // 마크다운이 건드리지 않는 lowercase 토큰
		const isRowLoose = (s) => /^\s*\|.*\|?\s*$/.test(s) && s.includes("|");
		const isSeparatorLoose = (s) => /-/.test(s) && /^\s*\|?[\s:|-]+\|?\s*$/.test(s);

		const countCols = (line) => {
			const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
			return t.split("|").length;
		};

		const lines = md.split("\n");
		const out = [];
		let i = 0;
		while (i < lines.length) {
			const line = lines[i];
			if (isRowLoose(line)) {
				const block = [];
				let j = i;
				while (j < lines.length && isRowLoose(lines[j])) {
					block.push(lines[j]);
					j++;
				}
				// 깨진 separator 보정: block[1]이 separator 후보인데 컬럼 수가 block[0]와 다르면 재생성
				if (block.length >= 2 && isSeparatorLoose(block[1])) {
					const headerCols = countCols(block[0]);
					const sepCols = countCols(block[1]);
					if (sepCols !== headerCols) {
						block[1] = "|" + Array(headerCols).fill("---").join("|") + "|";
					}
				}
				const hasSeparator = block.length >= 2 && isSeparatorLoose(block[1]);
				const cols = countCols(block[0]);
				// 단일 컬럼 테이블 → 불릿 리스트로 변환 (시각 낭비 방지)
				if (cols === 1) {
					const cleanCell = (s) => s.trim().replace(/^\|/, "").replace(/\|$/, "").trim();
					// separator 있으면 첫 행이 헤더, 없으면 모두 데이터
					const dataStart = hasSeparator ? 2 : 0;
					const headerText = hasSeparator ? cleanCell(block[0]) : "";
					const items = block.slice(dataStart).map((r) => cleanCell(r)).filter(Boolean);
					if (items.length > 0) {
						if (headerText) out.push(`**${headerText}**`, "");
						for (const it of items) out.push(`- ${it}`);
						out.push("");
						i = j;
						continue;
					}
				}
				if (!hasSeparator && block.length >= 2) {
					const sep = "|" + Array(cols).fill("---").join("|") + "|";
					const hiddenHeader = "|" + Array(cols).fill(HIDE_TOKEN).join("|") + "|";
					out.push(hiddenHeader, sep, ...block);
				} else {
					out.push(...block);
				}
				i = j;
				continue;
			}
			out.push(line);
			i++;
		}
		return out.join("\n");
	}

	static markdownToHtml(md) {
		marked.setOptions({ breaks: true, gfm: true });

		let processed = md.replace(
			/<!--\s*IMAGE:\s*(\w+)\s*-->/g,
			'<div style="text-align:center;padding:16px 0;"><span style="background:#667eea22;border:1px dashed #667eea;border-radius:8px;padding:8px 20px;font-size:13px;color:#667eea;">🖼️ Image: $1</span></div>',
		);
		processed = BlogAssembler._fixTables(processed);

		// 한글-** 경계 보정: marked의 GFM은 단어 경계를 ASCII 기준으로 봄.
		// "**한글**한글" 같은 패턴은 변환 안 되므로 marked 호출 전에 직접 strong 치환.
		// (코드블록 보호: 코드블록 위치를 마스킹 후 변환 후 복원)
		const codeBlockPlaceholders = [];
		let preprocessed = processed.replace(/```[\s\S]*?```/g, (m) => {
			codeBlockPlaceholders.push(m);
			return `\u0000CB${codeBlockPlaceholders.length - 1}\u0000`;
		});
		preprocessed = preprocessed.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
		preprocessed = preprocessed.replace(/\u0000CB(\d+)\u0000/g, (_, i) => codeBlockPlaceholders[Number(i)]);

		// Blogger는 <style> 태그를 sanitize해서 CSS가 본문 텍스트로 노출됨.
		// 인라인 style 속성만 통과되므로 marked 출력 후 주요 태그에 직접 주입.
		// marked는 종종 align 같은 속성을 붙이므로 정규식이 속성 유무 모두 매칭해야 함.
		let html = marked.parse(preprocessed);
		const inject = (tag, style) => {
			// <tag> 또는 <tag attr="..."> 둘 다 매칭. 이미 style 있으면 건드리지 않음.
			const re = new RegExp(`<${tag}(\\s+[^>]*)?>`, "g");
			html = html.replace(re, (match, attrs) => {
				if (match.includes("style=")) return match;
				return `<${tag}${attrs || ""} style="${style}">`;
			});
		};
		inject("h2", "font-size:1.5em;margin:1.5em 0 0.5em;padding-bottom:0.3em;border-bottom:2px solid #667eea;color:#333;");
		inject("h3", "font-size:1.2em;margin:1.2em 0 0.4em;color:#555;");
		inject("table", "width:100%;border-collapse:collapse;margin:1em 0;font-size:0.95em;");
		inject("th", "background:#667eea;color:#fff;padding:10px 14px;text-align:left;font-weight:600;border:1px solid #e0e0e0;");
		inject("td", "padding:10px 14px;border:1px solid #e0e0e0;");
		// 테이블 정리:
		// 1) <th> 내부의 <strong> 제거 (th는 이미 font-weight:600, 이중 굵게 redundant)
		html = html.replace(/<th([^>]*)>(\s*)<strong>([\s\S]*?)<\/strong>(\s*)<\/th>/g, "<th$1>$2$3$4</th>");
		// 2) 빈 <td></td>를 em-dash로 채워 시각적 안정 (Agent ②가 셀 누락 시)
		html = html.replace(/<td([^>]*)>\s*<\/td>/g, '<td$1><span style="color:rgba(255,255,255,0.3);">—</span></td>');
		// 3) <ul> 안의 <li>가 모두 'X | Y' 매핑 패턴이면 → <table>로 변환 (Agent ②가 불릿+|로 표 흉내낸 케이스)
		html = html.replace(/<ul([^>]*)>([\s\S]*?)<\/ul>/g, (match, _ulAttrs, ulContent) => {
			const lis = ulContent.match(/<li[^>]*>[\s\S]*?<\/li>/g) || [];
			if (lis.length < 2) return match;
			// 모든 li가 'X | Y' 패턴(중간에 | 1개) 인지 검사
			const rows = [];
			for (const li of lis) {
				const inner = li.replace(/^<li[^>]*>/, "").replace(/<\/li>$/, "").trim();
				const parts = inner.split(/\s*\|\s*/);
				if (parts.length !== 2) return match; // 패턴 미매치 → 원본 ul 유지
				rows.push(parts);
			}
			// 모든 li가 패턴 매치 → table로 변환
			const tableStyle = "width:100%;border-collapse:collapse;margin:1em 0;font-size:0.95em;";
			const thStyle = "background:#667eea;color:#fff;padding:10px 14px;text-align:left;font-weight:600;border:1px solid #e0e0e0;";
			const tdStyle = "padding:10px 14px;border:1px solid #e0e0e0;";
			const tableRows = rows.map(([a, b]) =>
				`<tr><td style="${tdStyle}">${a}</td><td style="${tdStyle}">${b}</td></tr>`
			).join("");
			return `<table style="${tableStyle}"><thead><tr><th style="${thStyle}">비유</th><th style="${thStyle}">기술</th></tr></thead><tbody>${tableRows}</tbody></table>`;
		});
		inject("pre", "background:#1e1e2e;color:#cdd6f4;padding:16px 20px;border-radius:10px;overflow-x:auto;font-size:0.9em;line-height:1.6;margin:1em 0;");
		// 인라인 <code>: 순한글/한글+공백+기호만 들어 있으면 단순 라벨로 보고 본문 폰트 + 옅은 배경만 적용.
		// 진짜 코드(영문/숫자/특수문자 포함)는 모노스페이스 유지.
		// pre 내부 code는 건드리지 않기 위해 lookbehind로 제외.
		// 분류 기준 3단계:
		//   (a) 진짜 코드 신호(연산자/식별자 호출/특수 기호)가 있으면 → monospace 코드
		//   (b) 한글이 포함되거나 단일 영문 단어/약어(SQL/VIEW/REST 등)는 → 본문 폰트 라벨 (시각 일관성)
		//   (c) camelCase 식별자(fadeIn/QueryKey)는 monospace 유지
		html = html.replace(/<code(\s[^>]*)?>([^<]*)<\/code>/g, (match, attrs, inner) => {
			if (match.includes("style=")) return match;
			const hasHangul = /[가-힣]/.test(inner);
			// 진짜 코드 신호 감지
			const codeSignals = [
				/[{};=<>!]/,                  // 중괄호/세미콜론/대입/비교
				/\(\)/,                        // 함수 호출 ()
				/\.\w+\(/,                     // .method(
				/=>|->|::/,                    // 화살표/스코프
				/[$@#%&^*]/,                   // jQuery $, decorator @, hashtag #
				/^\w+\([^)]*\)$/,              // 단일 호출 foo(bar)
				/[a-z][A-Z]/,                  // camelCase (fadeIn, QueryKey)
				/\bvar\b|\bconst\b|\blet\b|\bfunction\b|\breturn\b/,
				/\d+(\.\d+)?(px|em|rem|%|ms|s)\b/, // CSS 단위
				/\/[a-z]/,                     // 경로 또는 정규식
			];
			const looksLikeCode = codeSignals.some((re) => re.test(inner));
			// 단일 영문 약어/단어 감지: 공백 없음 + 대문자만 OR 첫 글자만 대문자 + 짧음(≤8자)
			// 예: "SQL", "VIEW", "REST", "API", "GET" → 라벨 처리 (테이블 헤더에서 굵게 표시되는 SQL과 시각 통일)
			// camelCase는 codeSignals에서 이미 코드로 잡히므로 여기 안 옴.
			const isShortEngAcronym =
				!looksLikeCode &&
				/^[A-Za-z]+$/.test(inner) &&
				inner.length >= 2 &&
				inner.length <= 8 &&
				(/^[A-Z]+$/.test(inner) || /^[A-Z][a-z]+$/.test(inner));
			const isLabel = (hasHangul && !looksLikeCode) || isShortEngAcronym;
			// 폰트 순서 핵심: 한글 명시 폰트(Malgun Gothic 등)를 generic 'monospace' 앞에 배치.
			// 'monospace' generic 키워드를 만나면 OS 한글 fallback이 바탕체(Batang)로 매칭되는 함정 회피.
			const style = isLabel
				? "background:#f1f3f5;color:#495057;padding:1px 6px;border-radius:4px;font-family:inherit;font-weight:600;"
				: "font-family:'Consolas','Monaco','Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR','Nanum Gothic',monospace,sans-serif;";
			return `<code${attrs || ""} style="${style}">${inner}</code>`;
		});
		inject("blockquote", "border-left:4px solid #667eea;background:#f8f9ff;padding:12px 20px;margin:1em 0;border-radius:0 8px 8px 0;color:#444;");
		inject("hr", "border:none;border-top:1px solid #e0e0e0;margin:2em 0;");
		inject("img", "max-width:100%;height:auto;border-radius:12px;margin:1.5em auto;display:block;box-shadow:0 4px 20px rgba(0,0,0,0.15);");
		// 2회차 보강: alt이 "diagram"으로 시작하는 이미지(mermaid PNG)는 모바일에서 가로 스크롤 컨테이너로 감싸
		// 최소 720px 폭을 보장 → 작은 화면에서도 글씨가 5~6px로 짜부라지지 않는다.
		// (Blogger는 <style> 제거하므로 인라인 div로 처리)
		// inject("img")가 이미 style을 붙였으므로 alt="diagram*" 이미지의 기존 style/속성을 제거하고 재구성.
		// 3회차 보강:
		//   - alt="diagram-XXX" (3회차 의미 있는 alt) 도 트리거되도록 prefix 매칭
		//   - <figure>/<figcaption> 시맨틱 마크업으로 감싸 스크린리더에 "다이어그램, 캡션은…" 으로 읽힘
		html = html.replace(
			/<img\s+([^>]*?)\s*\/?\s*>/g,
			(match, attrs) => {
				const altMatch = attrs.match(/alt="(diagram(?:-[^"]*)?)"/);
				if (!altMatch) return match;
				const fullAlt = altMatch[1]; // "diagram" 또는 "diagram-XXX"
				// 캡션: prefix 제거 → 사용자에게 의미 있는 부분만 표시
				const caption = fullAlt.startsWith("diagram-")
					? fullAlt.substring("diagram-".length)
					: ""; // legacy "diagram" alt → 캡션 없음
				// 스크린리더용 의미 있는 alt로 attrs 재작성
				const semanticAlt = caption || "다이어그램";
				const cleaned = attrs
					.replace(/\sstyle="[^"]*"/g, "")
					.replace(/\salt="[^"]*"/, ` alt="${semanticAlt}"`)
					.trim();
				// 모바일 대응: min-width 제거 → 부모 폭에 맞춰 자유 축소.
				//   기존 min-width:720px는 모바일(폰 320~430px)에서 가로 스크롤 강제 유발.
				//   다이어그램 폰트는 elkjs가 박스 크기를 라벨 visual length 기반으로 산출하므로,
				//   축소된 PNG도 글씨가 비례 축소되어 읽힘. 그래도 작게 느껴지면 사용자가 핀치 줌으로 확대.
				const diagramStyle = "max-width:100%;height:auto;border-radius:12px;display:block;margin:0 auto;box-shadow:0 4px 20px rgba(0,0,0,0.15);background:#fafafa;";
				const captionHtml = caption
					? `<figcaption style="text-align:center;font-size:0.85em;color:#6b7280;margin-top:0.5em;font-style:italic;">${caption}</figcaption>`
					: "";
				return (
					`<figure style="margin:1.5em 0;">` +
					`<img ${cleaned} style="${diagramStyle}">` +
					captionHtml +
					`</figure>`
				);
			},
		);
		inject("p", "line-height:1.8;margin:0.8em 0;");

		// 합성된 빈 헤더 행(zhdrsntz) 숨김 처리 — 마크다운이 건드리지 않는 토큰
		html = html.replace(
			/<thead>\s*<tr[^>]*>(\s*<th[^>]*>\s*zhdrsntz\s*<\/th>\s*)+<\/tr>\s*<\/thead>/g,
			"",
		);

		return `<div class="blog-content">${html}</div>`;
	}

	// structure_mapping → mermaid 다이어그램 (결정론적 fallback).
	// 노드 형식: A[기술용어 — 비유대상] (em-dash 연결). LLM 실패 시에도 기술/비유 매핑 유지.
	static buildMermaidDiagram(structureMapping) {
		if (!structureMapping || structureMapping.length === 0) return "";
		const lines = ["```mermaid", "graph TD"];
		const clean = (s) => (s || "").replace(/[\[\]()"'`:<>{}]/g, " ").replace(/\s+/g, " ").trim();
		const items = structureMapping.slice(0, 5);
		for (let i = 0; i < items.length; i++) {
			const m = items[i];
			const tech = clean(m.tech);
			const ana = clean(m.analogy);
			const next = items[i + 1] ? `N${i + 1}` : null;
			const label = `N${i}[${tech} — ${ana}]`;
			if (next) lines.push(`  ${label} --> N${i + 1}[${clean(items[i + 1].tech)} — ${clean(items[i + 1].analogy)}]`);
			else if (i === 0) lines.push(`  ${label}`);
		}
		lines.push("```");
		return lines.join("\n");
	}

	// structure_mapping → ASCII 박스 다이어그램 마크다운 (구 fallback, 호환용).
	// 4회차 보강: NFC 정규화 + grapheme 단위 visualLen 일관 적용.
	static buildAsciiDiagram(structureMapping) {
		if (!structureMapping || structureMapping.length === 0) return "";
		const visualLen = BlogAssembler._visualLen;
		const pad = (s, n) => s + " ".repeat(Math.max(0, n - visualLen(s)));
		const maxTech = Math.min(20, Math.max(...structureMapping.map((m) => visualLen(m.tech || ""))));
		const maxAna = Math.min(20, Math.max(...structureMapping.map((m) => visualLen(m.analogy || ""))));
		const techBorder = "+" + "-".repeat(maxTech + 2) + "+";
		const anaBorder = "+" + "-".repeat(maxAna + 2) + "+";
		const lines = [];
		for (const m of structureMapping.slice(0, 5)) {
			const tech = (m.tech || "").substring(0, 20);
			const ana = (m.analogy || "").substring(0, 20);
			lines.push(`${techBorder}      ${anaBorder}`);
			lines.push(`| ${pad(tech, maxTech)} | ---> | ${pad(ana, maxAna)} |`);
			lines.push(`${techBorder}      ${anaBorder}`);
			lines.push("");
		}
		return "```\n" + lines.join("\n") + "\n```";
	}

	// 본문에 mermaid 다이어그램이 부족하면 결정론적 fallback 삽입.
	static ensureAsciiDiagrams(body, contextPacket) {
		if (!body) return body;
		const mermaidBlocks = body.match(/```mermaid\s*\n[\s\S]*?```/g) || [];
		const mermaidCount = mermaidBlocks.length;
		if (mermaidCount >= 2) return body;

		const need = 2 - mermaidCount;
		const mapping = contextPacket?.structure_mapping || [];
		if (mapping.length === 0) return body;

		const fallbackDiagrams = [];
		const half = Math.ceil(mapping.length / 2);
		for (let i = 0; i < need; i++) {
			const slice = i === 0 ? mapping.slice(0, half) : mapping.slice(half);
			if (slice.length === 0) continue;
			fallbackDiagrams.push("\n\n### 한눈에 보는 매핑\n\n" + BlogAssembler.buildMermaidDiagram(slice));
		}

		// 코드블록 외부의 ## 헤딩만 후보 (코드블록 안 ##은 마크다운 헤딩이 아님)
		const codeRanges = [];
		const codeRegex = /```[a-zA-Z]*\n[\s\S]*?```/g;
		let cm;
		while ((cm = codeRegex.exec(body)) !== null) {
			codeRanges.push([cm.index, cm.index + cm[0].length]);
		}
		const inCode = (idx) => codeRanges.some(([s, e]) => idx >= s && idx < e);
		const headings = [...body.matchAll(/^##\s/gm)].filter((m) => !inCode(m.index));
		if (headings.length >= 2) {
			const insertPos = headings[headings.length - 1].index;
			return body.slice(0, insertPos) + fallbackDiagrams.join("\n") + "\n\n" + body.slice(insertPos);
		}
		return body + fallbackDiagrams.join("\n");
	}

	// 본문을 글자 수 중간점에서 가장 가까운 ## 또는 ### 헤딩으로 분할.
	// front_half/back_half 둘 다 비어있지 않도록 보장.
	static splitBody(body) {
		if (!body) return { front: "", back: "" };
		const lines = body.split("\n");
		// 헤딩 위치 수집
		const headingLines = [];
		for (let i = 0; i < lines.length; i++) {
			if (/^##\s/.test(lines[i]) || /^###\s/.test(lines[i])) {
				headingLines.push(i);
			}
		}
		if (headingLines.length === 0) {
			// 헤딩 없음 → 줄 중간에서 분할
			const mid = Math.floor(lines.length / 2);
			return {
				front: lines.slice(0, mid).join("\n"),
				back: lines.slice(mid).join("\n"),
			};
		}
		// 글자 수 중간점 계산
		const midChar = body.length / 2;
		let bestLine = headingLines[0];
		let bestDiff = Infinity;
		let charCount = 0;
		for (let i = 0; i < lines.length; i++) {
			if (headingLines.includes(i) && i > 0) {
				const diff = Math.abs(charCount - midChar);
				if (diff < bestDiff) {
					bestDiff = diff;
					bestLine = i;
				}
			}
			charCount += lines[i].length + 1;
		}
		return {
			front: lines.slice(0, bestLine).join("\n"),
			back: lines.slice(bestLine).join("\n"),
		};
	}

	static assemble(blog, _prompts, images, imageUrls) {
		const introImg = images?.intro;
		const middleImg = images?.middle;
		const outroImg = images?.outro;
		const introUrl = imageUrls?.intro;
		const middleUrl = imageUrls?.middle;
		const outroUrl = imageUrls?.outro;

		// 이미지 누락 가드 — 발행용 URL 3개가 모두 없으면 발행 불가 (이미지 없이 발행 차단)
		const missing = [];
		if (!introUrl) missing.push("intro");
		if (!middleUrl) missing.push("middle");
		if (!outroUrl) missing.push("outro");
		if (missing.length > 0) {
			throw new Error(`이미지 누락 (${missing.join(", ")}) — 발행 차단. Phase 3c 실패 가능성.`);
		}

		// 신: blog.body 단일 필드. 구: front_half/back_half (호환).
		let front, back;
		if (blog.body) {
			const split = BlogAssembler.splitBody(blog.body);
			front = split.front;
			back = split.back;
		} else {
			front = blog.front_half || "";
			back = blog.back_half || "";
		}

		// 미리보기용: base64. 이미지 없으면 블록 자체 생략(프롬프트 노출 차단).
		const introBlock = introImg ? `![인트로](${introImg})\n\n` : "";
		const middleBlock = middleImg ? `![중간](${middleImg})\n\n` : "";
		const outroBlock = outroImg ? `\n\n![아웃트로](${outroImg})` : "";
		const assembled = `${introBlock}${front}\n\n${middleBlock}${back}${outroBlock}`;

		// Blogger 발행용: Imgur URL
		const introPub = introUrl ? `![인트로](${introUrl})\n\n` : "";
		const middlePub = middleUrl ? `![중간](${middleUrl})\n\n` : "";
		const outroPub = outroUrl ? `\n\n![아웃트로](${outroUrl})` : "";
		const assembledPublish = `${introPub}${front}\n\n${middlePub}${back}${outroPub}`;

		// 평가용: 텍스트만 — 이미지 프롬프트 대신 본문만
		const assembledText = `${front}\n\n${back}`;

		return { assembled, assembledPublish, assembledText };
	}

	static copyBlog(results) {
		navigator.clipboard
			.writeText(results.assembled || "")
			.then(() => alert("블로그가 클립보드에 복사되었습니다."));
	}

	static downloadAll(results) {
		const blob = new Blob([JSON.stringify(results, null, 2)], {
			type: "application/json",
		});
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${results.contextPacket?.topic || "blog"}_results.json`;
		a.click();
	}
}
