// BlogAssembler.js — 마크다운 → HTML 변환, 블로그 조립
class BlogAssembler {
	// Excalidraw 라이브러리 캐시 (한 번만 로드)
	static _excalidrawLibs = null;

	static async _loadExcalidrawLibs() {
		if (BlogAssembler._excalidrawLibs) return BlogAssembler._excalidrawLibs;
		const sources = [
			"https://esm.sh",
			"https://esm.sh/v135",
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
		throw lastErr || new Error("Excalidraw libs 로드 실패");
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

	// mermaid 노드 sanitize — 라벨 내 특수문자 제거 + 다이아몬드/원 강제 사각형화 + em-dash 중복 정규화.
	static _sanitizeMermaid(code) {
		const clean = (s) => s.replace(/[()"'`:<>]/g, " ").replace(/\s+/g, " ").trim();
		let out = code;
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
		return out;
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
			console.warn("mermaid 파싱 1차 실패, 추가 sanitize 후 재시도:", e1.message);
			const cleaned2 = BlogAssembler._sanitizeMermaid(cleaned1);
			const r = await mte.parseMermaidToExcalidraw(cleaned2);
			elements = r.elements;
		}
		const shapeEls = elements.filter((e) => ["rectangle", "ellipse", "diamond"].includes(e.type));
		// 각 shape를 파스텔 컬러 + 손그림 스타일로 재구성 (한글 라벨 포함)
		const skeleton = [];
		let shapeIdx = 0;
		for (const el of elements) {
			if (el.type === "rectangle" || el.type === "ellipse" || el.type === "diamond") {
				const isContainer = BlogAssembler._isContainer(el, shapeEls);
				const color = BlogAssembler._PALETTE[shapeIdx % BlogAssembler._PALETTE.length];
				shapeIdx++;
				const item = {
					type: el.type,
					x: el.x, y: el.y,
					width: el.width, height: el.height,
					id: el.id,
					strokeColor: isContainer ? "#94a3b8" : color.stroke,
					backgroundColor: isContainer ? "transparent" : color.bg,
					fillStyle: isContainer ? "solid" : "hachure",
					strokeWidth: isContainer ? 1 : 2,
					roughness: isContainer ? 1 : 2,
					strokeStyle: isContainer ? "dashed" : "solid",
				};
				if (el.label && el.label.text) {
					item.label = {
						text: el.label.text,
						fontFamily: 1,
						fontSize: isContainer ? 16 : 20,
						strokeColor: isContainer ? "#64748b" : color.stroke,
					};
				}
				skeleton.push(item);
			} else if (el.type === "arrow") {
				const item = {
					type: "arrow",
					x: el.x, y: el.y,
					width: el.width, height: el.height,
					strokeColor: "#475569",
					strokeWidth: 2,
					roughness: 2,
				};
				if (el.startBinding) item.start = { id: el.startBinding.elementId };
				if (el.endBinding) item.end = { id: el.endBinding.elementId };
				if (el.points) item.points = el.points;
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

	// mermaid 코드에서 A[...] --> B[...] 패턴을 추출해 bullet 목록으로 변환.
	static _mermaidToTextList(code) {
		const lines = code.split("\n");
		const bullets = [];
		for (const line of lines) {
			const m = line.match(/\[([^\]]+)\][^\[]*?-->[^\[]*?\[([^\]]+)\]/);
			if (m) {
				bullets.push(`- **${m[1].trim()}** → ${m[2].trim()}`);
			}
		}
		if (bullets.length === 0) return "";
		return bullets.join("\n");
	}

	// 본문 안 ```mermaid 블록을 imgur URL로 변환 후 마크다운 이미지로 치환
	static async replaceMermaidBlocksWithImages(body) {
		if (!body) return body;
		const blocks = [];
		const re = /```mermaid\s*\n([\s\S]*?)```/g;
		let m;
		while ((m = re.exec(body)) !== null) {
			blocks.push({ full: m[0], code: m[1].trim(), index: m.index });
		}
		if (blocks.length === 0) return body;
		console.log(`mermaid 블록 ${blocks.length}개 변환 시작`);

		const replacements = [];
		for (const b of blocks) {
			try {
				const dataUrl = await BlogAssembler.mermaidToPngDataUrl(b.code, 2);
				// imgur 업로드
				let imageUrl = dataUrl; // fallback
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
				replacements.push({ full: b.full, replacement: `![diagram](${imageUrl})` });
			} catch (e) {
				console.warn(`mermaid 변환 실패 (블록 #${replacements.length}):`, e.message);
				// 실패 시 텍스트 목록으로 대체 (raw 코드 노출 방지)
				const textFallback = BlogAssembler._mermaidToTextList(b.code);
				replacements.push({ full: b.full, replacement: textFallback });
			}
		}

		let result = body;
		for (const r of replacements) {
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
		html = html.replace(/<ul([^>]*)>([\s\S]*?)<\/ul>/g, (match, ulAttrs, ulContent) => {
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
	static buildAsciiDiagram(structureMapping) {
		if (!structureMapping || structureMapping.length === 0) return "";
		const visualLen = (s) => {
			let len = 0;
			for (const ch of s) len += /[가-힣ㄱ-ㅎㅏ-ㅣ一-龯]/.test(ch) ? 2 : 1;
			return len;
		};
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

	static assemble(blog, prompts, images, imageUrls) {
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
