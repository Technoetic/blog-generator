// Pipeline.js — 파이프라인 오케스트레이터 (Phase 1~5)
class Pipeline {
	constructor() {
		this.results = {};
		this.totalTokens = 0;
		this.totalCost = 0;
		this.startTime = 0;
	}

	async run() {
		const topic = document.getElementById("topic").value.trim();
		if (!topic) {
			alert("기술 주제를 입력하세요.");
			return;
		}

		const tone = document.getElementById("tone").value;
		const ratio = document.getElementById("ratio").value;
		const publishMode = document.getElementById("publish").value;

		document.getElementById("generateBtn").disabled = true;
		document.getElementById("cancelBtn").style.display = "inline-flex";
		document.getElementById("pipeline").className = "pipeline active";
		PipelineUI.resetPipeline();
		this.results = {};
		this.totalTokens = 0;
		this.totalCost = 0;
		this.startTime = Date.now();
		this._cancelled = false;
		PipelineUI.startLiveTimer(this.startTime);

		this._pendingWindow = null;

		try {
			await this._phase1(topic, tone, ratio);
			await this._phase2a();
			await this._phase2b(tone, ratio);
			await this._phase3a(tone);
			await this._phase3b();
			await this._phase3c(ratio);
			await this._phase4();
			await this._phase5(publishMode);

			PipelineUI.showCost(
				this.totalTokens,
				this.totalCost,
				(Date.now() - this.startTime) / 1000,
			);
			PipelineUI.showResults(this.results);
		} catch (e) {
			PipelineUI.showError(e.message);
		}

		document.getElementById("cancelBtn").style.display = "none";
		PipelineUI.stopLiveTimer();
		document.getElementById("generateBtn").disabled = false;
	}

	_track(usage) {
		this.totalTokens += usage.total_tokens || 0;
		this.totalCost += usage.cost || 0;
		// 실시간 비용 누적 표시
		PipelineUI.updateCost(this.totalTokens, this.totalCost);
	}

	// 외부에서 호출 — 진행 중 파이프라인 취소
	cancel() {
		this._cancelled = true;
		if (this._abortController) {
			try { this._abortController.abort(); } catch (_) {}
		}
	}

	_checkCancelled() {
		if (this._cancelled) throw new Error("사용자가 취소했습니다");
	}

	// 블로그 제목 합성 + 명사구 추출 + 길이 하드컷.
	// LLM이 confirmed_analogy에 문장 전체를 넣는 케이스 방어.
	static _buildTitle(analogy, topic) {
		const safeTopic = (topic || "기술 블로그").substring(0, 30);
		let s = (analogy || "비유").trim().replace(/\s+/g, " ");
		// 1) 문장 종결부에서 자름
		s = s.split(/[.!?。]/)[0].trim();
		// 2) 한국어 종결 어미/연결 어미 패턴에서 자름 (명사구만 추출)
		const cutPatterns = [
			/처럼\s.*$/,
			/같은\s.*$/,
			/같이\s.*$/,
			/와\s같은.*$/,
			/하는\s시스템.*$/,
			/하는\s방식.*$/,
			/하는\s것.*$/,
			/입니다.*$/,
			/이다.*$/,
			/에요.*$/,
			/예요.*$/,
		];
		for (const pat of cutPatterns) {
			const m = s.match(pat);
			if (m) s = s.substring(0, m.index).trim();
		}
		// 3) 콤마/세미콜론 앞에서도 자름 (긴 부연설명 차단)
		s = s.split(/[,;]/)[0].trim();
		// 4) 20자 하드컷
		if (s.length > 20) s = s.substring(0, 18) + "…";
		if (s.length < 2) s = "비유";
		return `${s} — ${safeTopic}`;
	}

	// 게임 필살기 발동 스타일 모달 — 컨페티 + 슬램 + 골드 텍스트 + stat 결산
	static _showOpenModal(url, stats = {}) {
		const existing = document.getElementById("blogOpenModal");
		if (existing) existing.remove();

		const overlay = document.createElement("div");
		overlay.id = "blogOpenModal";

		// 컨페티 40개 (색상/위치/지연 랜덤)
		const colors = ["#ffd166", "#06d6a0", "#ef476f", "#118ab2", "#a78bfa", "#f97316", "#22d3ee", "#fb7185"];
		let confetti = "";
		for (let i = 0; i < 40; i++) {
			const c = colors[i % colors.length];
			const left = Math.random() * 100;
			const delay = Math.random() * 0.4;
			const dur = 2.2 + Math.random() * 1.2;
			const rot = Math.random() * 720 - 360;
			const tx = (Math.random() - 0.5) * 600;
			const ty = 400 + Math.random() * 300;
			confetti += `<div class="bgm-confetti" style="left:${left}%;background:${c};animation-delay:${delay}s;animation-duration:${dur}s;--tx:${tx}px;--ty:${ty}px;--rot:${rot}deg"></div>`;
		}

		// 별빛 광선
		const rays = Array.from({ length: 12 }, (_, i) => {
			const rot = i * 30;
			return `<div class="bgm-ray" style="transform:rotate(${rot}deg)"></div>`;
		}).join("");

		// stat 카드
		const tokens = (stats.tokens || 0).toLocaleString();
		const cost = `₩${Math.round(stats.cost || 0).toLocaleString()}`;
		const time = `${Math.round((stats.timeMs || 0) / 1000)}s`;

		overlay.innerHTML = `
			<div class="bgm-flash"></div>
			<div class="bgm-overlay"></div>
			<div class="bgm-rays">${rays}</div>
			<div class="bgm-confetti-wrap">${confetti}</div>
			<div class="bgm-modal">
				<div class="bgm-banner">
					<div class="bgm-banner-sub">QUEST CLEAR</div>
					<div class="bgm-banner-main">BLOG PUBLISHED!</div>
				</div>
				<div class="bgm-stats">
					<div class="bgm-stat">
						<div class="bgm-stat-label">TOKENS</div>
						<div class="bgm-stat-value">${tokens}</div>
					</div>
					<div class="bgm-stat">
						<div class="bgm-stat-label">COST</div>
						<div class="bgm-stat-value">${cost}</div>
					</div>
					<div class="bgm-stat">
						<div class="bgm-stat-label">TIME</div>
						<div class="bgm-stat-value">${time}</div>
					</div>
				</div>
				<button id="blogOpenBtn" class="bgm-cta">🚀 블로그 열기</button>
				<a id="blogCloseLink" class="bgm-close" href="#">닫기</a>
			</div>
		`;
		document.body.appendChild(overlay);
		document.getElementById("blogOpenBtn").onclick = () => {
			window.open(url, "_blank");
			overlay.classList.add("bgm-out");
			setTimeout(() => overlay.remove(), 300);
		};
		document.getElementById("blogCloseLink").onclick = (e) => {
			e.preventDefault();
			overlay.classList.add("bgm-out");
			setTimeout(() => overlay.remove(), 300);
		};
	}

	// DuckDuckGo 실패 시 fallback — Perplexity Sonar(내장 웹 검색)로 실제 웹 검색.
	async _searchWithSonarFallback(query) {
		const result = await ApiClient.callAgent(
			`당신은 검색 보조 에이전트입니다. 사용자 쿼리를 웹에서 검색한 결과를 바탕으로 JSON을 반환합니다.

🚨 규칙:
1. 사용자 쿼리가 한국어 표기(예: "오픈클로")면 정식 영문 명칭(OpenClaw)을 canonical_name에 기입.
2. 이미 영문 정식 명칭(예: "Playwright")이면 canonical_name을 null로.
3. results 배열에 4~6건의 검색 결과를 title + snippet 쌍으로 담아라.
4. 각주 인용번호([1], [2] 등) 금지.`,
			[`쿼리: ${query}`],
			{
				model: "perplexity/sonar", // 내장 웹 검색
				temperature: 0.0,
				schema_name: "sonar_search",
				response_schema: {
					type: "object",
					properties: {
						canonical_name: { type: ["string", "null"] },
						results: {
							type: "array",
							items: {
								type: "object",
								properties: {
									title: { type: "string" },
									snippet: { type: "string" },
								},
								required: ["title", "snippet"],
							},
						},
					},
					required: ["canonical_name", "results"],
				},
			},
		);
		this._track(result.usage);
		const data = result.data || {};
		return {
			canonical_name: data.canonical_name || null,
			results: Array.isArray(data.results) ? data.results : [],
		};
	}

	// Phase 1: 웹 검색 + 주제 분석
	async _phase1(topic, tone, ratio) {
		const result = await PipelineUI.timed("phase1", async () => {
			let researchContext = "";
			let webResults = null;
			let canonicalName = null;
			// 1단계: 실제 웹 검색 (DuckDuckGo via /api/search)
			try {
				const searchRes = await fetch("/api/search", {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ query: topic }),
				});
				if (searchRes.ok) {
					const data = await searchRes.json();
					webResults = data.results || [];
					canonicalName = data.canonical_name || null;
					console.log(`DuckDuckGo: ${webResults.length}건, canonical=${canonicalName}`);
					if (canonicalName) {
						topic = `${canonicalName} (사용자 입력: ${topic})`;
					}
				}
			} catch (e) {
				console.warn("DuckDuckGo 검색 실패:", e.message);
			}

			// 2단계 fallback: DuckDuckGo 실패/공백 → Gemini Lite + google_search
			const needsFallback = !webResults || webResults.length === 0;
			if (needsFallback) {
				console.log("DuckDuckGo 결과 부족 → Perplexity Sonar fallback");
				try {
					const fb = await this._searchWithSonarFallback(topic);
					if (fb.results && fb.results.length > 0) {
						webResults = fb.results;
						canonicalName = fb.canonical_name || canonicalName;
						console.log(`Gemini fallback: ${webResults.length}건, canonical=${canonicalName}`);
						if (canonicalName && !topic.includes(canonicalName)) {
							topic = `${canonicalName} (사용자 입력: ${topic})`;
						}
					}
				} catch (e) {
					console.warn("Gemini fallback 검색도 실패:", e.message);
				}
			}

			// 2단계: 검색 결과를 LLM에 전달해서 구조화된 조사 리포트 생성
			try {
				const webContext = webResults && webResults.length > 0
					? webResults.map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}`).join("\n\n")
					: "검색 결과 없음";
				const searchResult = await ApiClient.callAgent(
					`당신은 기술 리서처입니다. 아래 웹 검색 결과를 100% 신뢰하고, 그것에만 기반해서 주제 정보를 정리하세요.

🚨 절대 규칙:
1. 검색 결과에 명시된 내용만 사용하라. 당신의 사전 지식은 컷오프 이후 정보가 없을 수 있어 부정확하다.
2. 검색 결과의 고유명사(제품명, 회사명, 기술명)는 검색 결과의 표기를 그대로 따르라. 임의로 변형/축약/확장하지 말라.
3. 사용자가 입력한 주제명이 검색 결과의 정식 명칭과 다르면, 검색 결과의 정식 명칭을 따르라.
4. 검색 결과가 부족하더라도 사전 지식으로 보충하지 말고, 검색 결과 안에서만 정리하라.

## 웹 검색 결과
${webContext}

정리할 내용: 정의, 핵심 개념 3~5가지, 작동 원리, 주요 사용 사례, 장단점.`,
					[`기술 주제: ${topic}`],
					{
						thinking_budget: 1024,
						temperature: 0.0,
						schema_name: "research",
						response_schema: {
							type: "object",
							properties: {
								topic: { type: "string" },
								definition: { type: "string" },
								key_concepts: { type: "array", items: { type: "string" } },
								how_it_works: { type: "string" },
								use_cases: { type: "array", items: { type: "string" } },
								pros_cons: { type: "string" },
							},
							required: ["topic", "definition", "key_concepts", "how_it_works"],
						},
					},
				);
				researchContext = JSON.stringify(searchResult.data);
				this._track(searchResult.usage);
			} catch (e) {
				console.warn("주제 조사 실패:", e.message);
			}

			return ApiClient.callAgent(
				`당신은 비유 블로그 오케스트레이터입니다. 기술 주제와 조사 결과를 받으면:
1. 핵심 개념 3가지 추출 (조사 결과 참고)
2. 각 개념에 1:1 대응하는 비유 후보 3개 도출
3. 최적 비유 1개 확정
4. 에이전트 컨텍스트 패킷을 JSON으로 생성

## 주제 조사 결과 (웹 검색 기반 — 100% 신뢰)
${researchContext || "조사 결과 없음 — 모델 지식으로 진행"}

🚨 절대 규칙:
- 위 조사 결과에 나오는 정식 명칭/정의/개념을 그대로 사용하라.
- 사용자 입력 주제와 조사 결과의 명칭이 달라도 조사 결과를 우선하라.
- 사전 지식으로 임의의 기술 용어를 갖다 붙이지 말라.

중요: 모든 출력(confirmed_analogy, analogy_protagonist, analogy_space, structure_mapping 등)은 반드시 한국어로 작성하라.`,
				[`기술 주제: ${topic}\n톤: ${tone}\n이미지 비율: ${ratio}`],
				{
					thinking_budget: 2048,
					schema_name: "context_packet",
					response_schema: {
						type: "object",
						properties: {
							topic: { type: "string" },
							confirmed_analogy: { type: "string" },
							analogy_protagonist: { type: "string" },
							analogy_space: { type: "string" },
							structure_mapping: {
								type: "array",
								items: {
									type: "object",
									properties: {
										tech: { type: "string" },
										analogy: { type: "string" },
									},
									required: ["tech", "analogy"],
								},
							},
							keywords: {
								type: "array",
								items: { type: "string" },
								description: "IT/CS 기술 전문 용어만",
							},
							image_ratio: { type: "string" },
							tone: { type: "string" },
						},
						required: [
							"topic",
							"confirmed_analogy",
							"analogy_protagonist",
							"analogy_space",
							"structure_mapping",
							"keywords",
							"image_ratio",
							"tone",
						],
					},
				},
			);
		});
		this.results.contextPacket = result.data;
		this._track(result.usage);
	}

	// Phase 2a: 비유설계 + 검증 (최대 3회 재시도)
	async _phase2a() {
		await PipelineUI.timed("phase2a", async () => {
			let lastFailSummary = null;
			for (let attempt = 0; attempt < 3; attempt++) {
				await this._runDesigner(lastFailSummary);
				const verdict = await this._runVerifyA();
				if (verdict.pass) return;
				lastFailSummary = verdict.failSummary;
				console.warn(`Phase 2a 검증 FAIL (시도 ${attempt + 1}/3): ${lastFailSummary}`);
			}
			throw new Error(`Phase 2a 검증 FAIL (3회 재시도 후): ${lastFailSummary}`);
		});
	}

	async _runDesigner(previousFailSummary) {
		const userMessages = [JSON.stringify(this.results.contextPacket)];
		if (previousFailSummary) {
			userMessages.push(
				`[이전 시도 실패 사유] ${previousFailSummary}\n\n위 실패 사유를 반드시 해결하라. fitness_score는 최소 7점 이상이어야 한다. structure_mapping은 최소 5개 이상, counterexample_tests는 정확히 3개 이상 포함하라.`,
			);
		}
		const designResult = await ApiClient.callAgent(
			`당신은 비유 설계 전문가입니다. 에이전트 컨텍스트 패킷을 받으면:
1. 구조 매핑 심화: 기술의 입력→처리→출력 흐름을 비유에서 완전히 재현
2. 관계 보존 검증
3. 반례 스트레스 테스트: 3개 이상
4. 최종 출력: 검증된 구조 매핑표 + 비유 세계관 (300자 이내)

🚨 절대 규칙:
- 컨텍스트 패킷의 topic/confirmed_analogy/structure_mapping을 그대로 신뢰하고 활용하라.
- "정보 부족", "확인할 수 없습니다" 같은 거부 응답 금지. 컨텍스트 패킷에 모든 정보가 있다.
- 사전 지식으로 임의의 기술 용어(OpenCL 등)로 대체 금지. topic 필드의 명칭을 그대로 사용하라.
- fitness_score는 최소 7점 이상이 되도록 구조 매핑을 충실히 작성하라.
- confirmed_analogy는 **30자 이내의 짧은 명사구** (예: "아파트 통합 보안 시스템"). 문장이나 설명 금지. 블로그 제목으로 쓰임.
- worldview는 별도 필드로 300자 이내 세계관 설명.

중요: 모든 출력(confirmed_analogy, worldview, structure_mapping 등)은 반드시 한국어로 작성하라.`,
			userMessages,
			{
				model: Config.WRITER_MODEL,
				thinking_budget: 2048,
				schema_name: "analogy_design",
				response_schema: {
					type: "object",
					properties: {
						confirmed_analogy: { type: "string" },
						worldview: { type: "string" },
						structure_mapping: {
							type: "array",
							items: {
								type: "object",
								properties: {
									tech: { type: "string" },
									analogy: { type: "string" },
									rationale: { type: "string" },
								},
								required: ["tech", "analogy", "rationale"],
							},
						},
						counterexample_tests: {
							type: "array",
							items: {
								type: "object",
								properties: {
									edge_case: { type: "string" },
									maintained: { type: "boolean" },
									mitigation: { type: "string" },
								},
								required: ["edge_case", "maintained", "mitigation"],
							},
						},
						fitness_score: { type: "integer" },
					},
					required: [
						"confirmed_analogy",
						"worldview",
						"structure_mapping",
						"counterexample_tests",
						"fitness_score",
					],
				},
			},
		);
		this.results.design = designResult.data;
		this._track(designResult.usage);
	}

	async _runVerifyA() {
		const verifyResult = await ApiClient.callAgent(
			`당신은 품질 검증 전문가입니다. 4단계 검증(조사→측정→근거→판정).
A1: fitness_score 7이상, A2: mapping 완전성, A3: 반례 3개이상, A4: 세계관 300자이내, A5: rationale 존재`,
			[
				JSON.stringify(this.results.design),
				JSON.stringify(this.results.contextPacket),
			],
			{
				thinking_budget: 2048,
				temperature: 0.0,
				schema_name: "verify_a",
				response_schema: {
					type: "object",
					properties: {
						phase: { type: "string" },
						verdict: { type: "string" },
						items: {
							type: "array",
							items: {
								type: "object",
								properties: {
									id: { type: "string" },
									name: { type: "string" },
									inspect: { type: "string" },
									measure: { type: "string" },
									evidence: { type: "string" },
									result: { type: "string" },
									reason: { type: "string" },
								},
								required: [
									"id",
									"name",
									"inspect",
									"measure",
									"evidence",
									"result",
									"reason",
								],
							},
						},
						fail_summary: { type: "array", items: { type: "string" } },
					},
					required: ["phase", "verdict", "items", "fail_summary"],
				},
			},
		);
		this.results.verifyA = verifyResult.data;
		this._track(verifyResult.usage);
		return {
			pass: verifyResult.data.verdict !== "FAIL",
			failSummary: (verifyResult.data.fail_summary || []).join(", "),
		};
	}

	// Phase 2b: 글작성 + 이미지프롬프트 (병렬)
	async _phase2b(tone, ratio) {
		const [writerResult, imageResult] = await PipelineUI.timed("phase2b", () =>
			Promise.all([
				ApiClient.callAgent(
					`당신은 비유 블로그 전문 작가입니다. 풍부한 시각 요소가 포함된 한국어 블로그를 작성합니다.
## 소제목 규칙: 기계적 라벨("핵심 정리","대응표","마무리") 금지. 비유 스토리에서 자연스러운 한국어 제목 사용.
## 시각화: 테이블 2+, mermaid 다이어그램 2+, 인용블록 3+, 구분선 4+, 소제목 6+
## 분량: 친근 3000~5000 / 전문 4000~6000 / 유머 2500~4000

## 절대 규칙 (렌더링 깨짐 방지)
- 시각 다이어그램은 반드시 mermaid 코드블록으로 작성하라:
  \`\`\`mermaid
  graph TD
    A[Sender 노드 — 심장] --> B[Heartbeat 신호 — 맥박]
    B --> C[Receiver 모니터 — 뇌]
    C --> D[Timeout 판정 — 진단]
  \`\`\`
- **graph TD만 사용** (세로 방향). 한글 라벨이 길어서 가로(LR)는 모바일에서 깨짐. sequenceDiagram, classDiagram 등 다른 종류 금지.
- **🚨 절대 필수 — 노드 라벨 형식**: \`A[기술용어 — 비유대상]\` (em-dash — 단 한 개로 연결). 기술 용어 단독 금지, 비유 단독 금지.
  - ❌ 잘못: \`A[심장]\` (비유만), \`A[Sender]\` (기술만), \`A[A — — B]\` (em-dash 중복)
  - ✅ 올바름: \`A[Sender 노드 — 심장]\`, \`A[Timeout 판정 — 맥박 멈춤]\`
- 오직 \`A[라벨]\` **사각형** 형식만 사용. 다이아몬드 \`{}\`, 원 \`()\`, 둥근 박스 \`(...)\` 모두 금지.
- 노드 레이블 안에 괄호 \`()\`, 중괄호 \`{}\`, 따옴표, 콜론 \`:\`, 꺾쇠 \`<>\` 절대 금지.
- **그래프당 노드 8개 이하** — 노드가 많으면 mermaid가 가로 펼침. 핵심 흐름만 압축.
- 마크다운 테이블은 반드시 헤더행 + 구분행(|---|---|) + 데이터행 형식을 지켜라.
- 테이블은 최소 2열 이상. 1열짜리 테이블은 절대 금지 — 항목 나열은 불릿 리스트(- 항목)로 작성.
  - 잘못된 예 (금지): | 헤더 | 다음 |---| 다음 | 항목1 | 다음 | 항목2 |
  - 올바른 예: **헤더** 다음 줄에 - 항목1, - 항목2
- 모든 본문은 한국어로 작성하라. 기술 용어만 영문 병기 허용.
- 🚨 백틱(\`) 인라인 코드는 **영문/숫자/기호로만 된 진짜 코드**(예: \`POST\`, \`x = 1\`, \`foo()\`, \`HTTP/2\`)에만 사용. **순한글 라벨/단계명/일반어휘에 백틱 금지** — 한글 강조는 **굵게(\\*\\*…\\*\\*)** 만 허용.
  - ❌ 잘못: \`시스템/컴포넌트 완전 분해\`, \`결함 부품 교체\`, \`성능 검증\` (한글 라벨 백틱)
  - ✅ 올바름: **시스템/컴포넌트 완전 분해**, **결함 부품 교체**, \`POST /api/v1\`, \`HTTP 200\`

톤: ${tone} | 메타표현 금지 | 하나의 비유 세계관으로 끝까지`,
					[
						JSON.stringify(this.results.contextPacket),
						JSON.stringify(this.results.design),
					],
					{
						model: Config.WRITER_MODEL,
						thinking_budget: 2048,
						schema_name: "blog_content",
						response_schema: {
							type: "object",
							properties: {
								body: { type: "string" },
								char_count: { type: "integer" },
							},
							required: ["body", "char_count"],
						},
					},
				),
				ApiClient.callAgent(
					`당신은 이미지 프롬프트 전문가입니다. 영문 프롬프트 3개 생성.
프롬프트 공식: [스타일]+[피사체]+[동작]+[배경]+[분위기]+[기술 요소 시각화]
텍스트 규칙: 영문만 허용. 한글 금지. 끝에 "English text only, no Korean" 추가.
톤: ${tone} | 비율: ${ratio}`,
					[
						JSON.stringify(this.results.contextPacket),
						JSON.stringify(this.results.design),
					],
					{
						thinking_budget: 0,
						schema_name: "image_prompts",
						response_schema: {
							type: "object",
							properties: {
								intro_prompt: { type: "string" },
								middle_prompt: { type: "string" },
								outro_prompt: { type: "string" },
							},
							required: ["intro_prompt", "middle_prompt", "outro_prompt"],
						},
					},
				),
			]),
		);
		this.results.blog = writerResult.data;
		this.results.prompts = imageResult.data;
		this._track(writerResult.usage);
		this._track(imageResult.usage);

		// 검증 + 재시도 (최대 2회)
		await this._validateAndRetryWriter(tone);
	}

	_countAsciiDiagrams(body) {
		// 신: mermaid 블록 카운트. 구 ASCII 검증과 호환되는 이름 유지.
		if (!body) return 0;
		const mermaidBlocks = body.match(/```mermaid\s*\n[\s\S]*?```/g) || [];
		return mermaidBlocks.length;
	}

	_countHeadings(body) {
		// ## 또는 ### 마크다운 헤딩 (코드블록 내부 제외)
		if (!body) return 0;
		const codeRanges = [];
		const codeRe = /```[a-zA-Z]*\n[\s\S]*?```/g;
		let m;
		while ((m = codeRe.exec(body)) !== null) {
			codeRanges.push([m.index, m.index + m[0].length]);
		}
		const inCode = (idx) => codeRanges.some(([s, e]) => idx >= s && idx < e);
		const headings = [...body.matchAll(/^#{2,3}\s/gm)].filter((h) => !inCode(h.index));
		return headings.length;
	}

	async _validateAndRetryWriter(tone) {
		for (let attempt = 0; attempt < 2; attempt++) {
			this._checkCancelled();
			const body = this.results.blog.body || "";
			const bodyLen = body.length;
			const ascii = this._countAsciiDiagrams(body);
			const headings = this._countHeadings(body);
			// 이상 출력 감지 (JSON-in-JSON, 과도한 패딩, 단일 라인 폭주, 공백 폭증)
			const tooLong = bodyLen > 50000; // 정상 블로그는 5~15K, 50K 초과 시 깨짐
			const jsonInJson = /```?json[\s\S]{0,50}["']?body["']?\s*:/.test(body);
			const maxLineLen = Math.max(0, ...body.split("\n").map((l) => l.length));
			const runawayLine = maxLineLen > 10000;
			// 공백 폭주 감지: 전체 공백 비율 80% 초과 OR 1000자 연속 공백/탭
			const nonWs = body.replace(/\s/g, "").length;
			const wsRatio = bodyLen > 0 ? (bodyLen - nonWs) / bodyLen : 0;
			const wsFlood = wsRatio > 0.8 || / {1000,}|\t{1000,}/.test(body);
			console.log(`Phase 2b 검증 (attempt ${attempt}): body=${bodyLen}자, ascii=${ascii}, 헤딩=${headings}, 최장줄=${maxLineLen}자, 공백비율=${(wsRatio * 100).toFixed(1)}%`);

			const tooShort = bodyLen < 2500;
			const noAscii = ascii < 2;
			const noHeadings = headings < 4;
			const corrupted = tooLong || jsonInJson || runawayLine || wsFlood;
			if (!tooShort && !noAscii && !noHeadings && !corrupted) return; // 모두 통과
			if (attempt === 1 && noAscii && !tooShort && !noHeadings) {
				console.warn("재시도 2회 후에도 ASCII 부족 → 결정론적 fallback 삽입");
				this.results.blog.body = BlogAssembler.ensureAsciiDiagrams(
					body,
					this.results.contextPacket,
				);
				return;
			}

			const reasons = [];
			if (tooShort) reasons.push(`본문이 너무 짧음(${bodyLen}자, 최소 4000자 필요)`);
			if (noAscii) reasons.push(`mermaid 다이어그램 부족(${ascii}개, 최소 2개 필요)`);
			if (noHeadings) reasons.push(`소제목(##/###) 부족(${headings}개, 최소 4개 필요)`);
			if (tooLong) reasons.push(`본문이 비정상적으로 김(${bodyLen}자, 50000자 초과)`);
			if (jsonInJson) reasons.push("body 안에 중첩 JSON 구조 감지 (출력 포맷 오류)");
			if (runawayLine) reasons.push(`단일 라인이 너무 김(${maxLineLen}자, 10000 초과)`);
			if (wsFlood) reasons.push(`공백 폭주 감지 (전체 ${(wsRatio * 100).toFixed(1)}% 또는 1000자 연속 공백)`);
			console.warn(`재실행 사유: ${reasons.join(", ")}`);
			PipelineUI.setSubStatus("phase2b", `재시도 ${attempt + 1}/2 — ${reasons[0]}`);

			const retry = await ApiClient.callAgent(
				`이전 글이 검증 실패. 사유: ${reasons.join(" / ")}.

🚨 절대 규칙 (이번엔 반드시 지킬 것):
1. body는 최소 4000자 이상.
2. mermaid 다이어그램을 정확히 2개 이상 포함:
   \`\`\`mermaid
   graph TD
     A[Sender 노드 — 심장] --> B[Heartbeat 신호 — 맥박]
     B --> C[Receiver 모니터 — 뇌]
   \`\`\`
3. **graph TD만 사용** (세로). 모바일 호환.
4. **🚨 노드 라벨 형식 절대 필수: A[기술용어 — 비유대상]**. em-dash(—)로 기술 개념과 비유를 함께 표기.
   - ❌ 금지: A[심장] (비유만), A[Sender] (기술만)
   - ✅ 올바름: A[Sender 노드 — 심장], A[Timeout — 맥박 멈춤]
5. 오직 A[라벨] 형식만 (다이아몬드/원 금지). 라벨 안에 괄호/중괄호/따옴표/콜론/꺾쇠 절대 금지.
4. 마크다운 테이블 2개 이상. **필수 형식:** 첫 줄은 헤더, 둘째 줄은 반드시 \`|---|---|---|\` 구분선, 셋째 줄부터 데이터.
   예:
   \`\`\`
   | 특징 | 설명 | 비유 |
   |---|---|---|
   | 보안 | ... | ... |
   \`\`\`
5. 소제목(##/###) 최소 4개 이상. 비유 스토리에 맞는 자연스러운 한국어 제목 사용.
   예: "## 주방의 첫 풍경", "### 조리사의 판단"
6. 백틱(\`) 인라인 코드는 영문/숫자/기호로만 된 진짜 코드에만 사용. 순한글 라벨/단계명/일반어휘에 백틱 절대 금지 — 한글 강조는 **굵게** 만.
   - ❌ \`시스템 분해\`, \`결함 교체\`  ✅ **시스템 분해**, \`POST /api\`, \`HTTP 200\`
7. 톤: ${tone}.`,
				[
					JSON.stringify(this.results.contextPacket),
					JSON.stringify(this.results.design),
				],
				{
					model: Config.WRITER_MODEL,
					thinking_budget: 2048,
					schema_name: "blog_content",
					response_schema: {
						type: "object",
						properties: {
							body: { type: "string" },
							char_count: { type: "integer" },
						},
						required: ["body", "char_count"],
					},
				},
			);
			this._track(retry.usage);
			const newBody = retry.data.body || "";
			const newAscii = this._countAsciiDiagrams(newBody);
			console.log(`재시도 결과: body=${newBody.length}자, ascii=${newAscii}`);
			// 재시도 결과가 더 좋으면 채택
			const oldScore = bodyLen + ascii * 1000;
			const newScore = newBody.length + newAscii * 1000;
			if (newScore > oldScore) {
				this.results.blog = retry.data;
			}
		}
	}

	// Phase 3a: 검증 + 재시도
	async _phase3a(tone) {
		const phase3aPrompt = `당신은 품질 검증 전문가입니다. 4단계 검증(조사→측정→근거→판정). 수정 제안 금지.
B1~B12 검증. 톤: ${tone}. B2: 비유 용어는 기술 용어 아님. B4: 동의어 허용. B6: ±20% 허용.
모든 항목에 inspect/measure/evidence 필수.`;
		const phase3aSchema = {
			type: "object",
			properties: {
				phase: { type: "string" },
				verdict: { type: "string" },
				items: {
					type: "array",
					items: {
						type: "object",
						properties: {
							id: { type: "string" },
							name: { type: "string" },
							inspect: { type: "string" },
							measure: { type: "string" },
							evidence: { type: "string" },
							result: { type: "string" },
							reason: { type: "string" },
						},
						required: [
							"id",
							"name",
							"inspect",
							"measure",
							"evidence",
							"result",
							"reason",
						],
					},
				},
				fail_summary: { type: "array", items: { type: "string" } },
			},
			required: ["phase", "verdict", "items", "fail_summary"],
		};
		const phase3aOpts = {
			thinking_budget: 2048,
			temperature: 0.0,
			schema_name: "verification",
			response_schema: phase3aSchema,
		};

		let verifyResult = await PipelineUI.timed("phase3a", () =>
			ApiClient.callAgent(
				phase3aPrompt,
				[
					JSON.stringify(this.results.design),
					JSON.stringify(this.results.blog),
					JSON.stringify(this.results.prompts),
					JSON.stringify(this.results.contextPacket),
				],
				phase3aOpts,
			),
		);
		this.results.verify = verifyResult.data;
		this._track(verifyResult.usage);

		let retryCount = 0;
		while (verifyResult.data.verdict === "FAIL" && retryCount < 2) {
			retryCount++;
			console.warn(`Phase 3a FAIL (재시도 ${retryCount}/2)`);
			const retry = await ApiClient.callAgent(
				`이전 글이 검증 실패. FAIL 사유: ${(verifyResult.data.fail_summary || []).join(", ")}. FAIL 항목만 수정. 톤: ${tone}`,
				[
					JSON.stringify(this.results.contextPacket),
					JSON.stringify(this.results.design),
					JSON.stringify(this.results.blog),
				],
				{
					model: Config.WRITER_MODEL,
					thinking_budget: 2048,
					schema_name: "blog_content",
					response_schema: {
						type: "object",
						properties: {
							body: { type: "string" },
							char_count: { type: "integer" },
						},
						required: ["body", "char_count"],
					},
				},
			);
			this.results.blog = retry.data;
			this._track(retry.usage);

			verifyResult = await ApiClient.callAgent(
				phase3aPrompt,
				[
					JSON.stringify(this.results.design),
					JSON.stringify(this.results.blog),
					JSON.stringify(this.results.prompts),
					JSON.stringify(this.results.contextPacket),
				],
				phase3aOpts,
			);
			this.results.verify = verifyResult.data;
			this._track(verifyResult.usage);
		}
	}

	// Phase 3b: 팩트체크 (Perplexity Sonar 내장 웹 검색)
	async _phase3b() {
		const result = await PipelineUI.timed("phase3b", () =>
			ApiClient.callAgent(
				`당신은 기술 팩트체크 전문가다. 블로그 본문의 모든 기술 주장을 **실제 웹 검색**으로 검증하고, 각 주장을 CORRECT/INACCURATE/MISLEADING으로 판정한다.

🚨 절대 규칙:
1. 검색 결과에 기반해서만 판정한다. 학습 지식보다 검색 결과가 우선.
2. 각 주장의 judgment에는 판정만, reason에는 검증 근거(검색에서 찾은 사실)를 서술.
3. 각주 인용번호 [1] 등은 응답에서 제거.
4. 비유 적절성(mapping_validity)은 구조 매핑이 기술 개념을 왜곡하지 않는지 평가.
5. corrections_needed에는 블로그에서 수정해야 할 문장의 원본과 수정문을 제시.`,
				[
					JSON.stringify(this.results.blog),
					JSON.stringify(this.results.design),
				],
				{
					model: "perplexity/sonar", // 내장 웹 검색 grounding
					temperature: 0.0,
					schema_name: "factcheck",
					response_schema: {
						type: "object",
						properties: {
							verdict: { type: "string" },
							total_claims: { type: "integer" },
							claims: {
								type: "array",
								items: {
									type: "object",
									properties: {
										quote: { type: "string" },
										judgment: { type: "string" },
										reason: { type: "string" },
										correction: { type: "string" },
									},
									required: ["quote", "judgment", "reason"],
								},
							},
							mapping_validity: {
								type: "array",
								items: {
									type: "object",
									properties: {
										tech: { type: "string" },
										analogy: { type: "string" },
										valid: { type: "boolean" },
										reason: { type: "string" },
									},
									required: ["tech", "analogy", "valid", "reason"],
								},
							},
							corrections_needed: {
								type: "array",
								items: {
									type: "object",
									properties: {
										original: { type: "string" },
										corrected: { type: "string" },
									},
									required: ["original", "corrected"],
								},
							},
						},
						required: [
							"verdict",
							"total_claims",
							"claims",
							"mapping_validity",
							"corrections_needed",
						],
					},
				},
			),
		);
		this.results.factcheck = result.data;
		this._track(result.usage);
	}

	// 3개 이미지 병렬 진행 상태를 합쳐서 sub-status에 한 줄로 표시
	_updateImgSubStatus() {
		this._imgState = this._imgState || {};
		const order = ["intro", "middle", "outro"];
		const parts = order
			.map((k) => this._imgState[k])
			.filter(Boolean);
		PipelineUI.setSubStatus("phase3c", parts.join(" · "));
	}

	// Nano Banana로 이미지 생성 — 성공할 때까지 끝까지 재시도. Fallback 없음.
	// 프롬프트를 매번 다시 생성할 때마다 미세하게 다르게 하면 성공률이 오름.
	async _generateImageWithRetry(prompt, ratio, label) {
		this._imgState = this._imgState || {};
		const delays = [0, 2000, 4000, 8000, 15000, 30000, 60000]; // 총 7회 시도, 최장 ~2분
		let lastErr = null;
		for (let i = 0; i < delays.length; i++) {
			this._checkCancelled();
			if (delays[i] > 0) {
				this._imgState[label] = `${label} 대기 ${delays[i] / 1000}s (${i + 1}/${delays.length})`;
				this._updateImgSubStatus();
				await new Promise((r) => setTimeout(r, delays[i]));
			}
			this._imgState[label] = `${label} 생성 ${i + 1}/${delays.length}`;
			this._updateImgSubStatus();
			// 재시도마다 seed 변경을 유도 (프롬프트 꼬리에 invisible 노이즈)
			const probe = i === 0 ? prompt : `${prompt}\n\n(variation seed: ${i})`;
			try {
				const res = await ApiClient.generateImage(probe, ratio);
				this._track(res.usage || {});
				if (res.url) {
					if (i > 0) console.log(`이미지 생성 ${i + 1}차 시도 성공 (${label})`);
					this._imgState[label] = `${label} ✓`;
					this._updateImgSubStatus();
					return res;
				}
				lastErr = "empty response";
			} catch (e) {
				lastErr = e.message;
			}
			console.warn(`이미지 생성 실패 ${i + 1}/${delays.length} (${label}): ${lastErr}`);
		}
		// 모든 재시도 실패 — 하드 에러로 파이프라인 정지 (fallback 금지)
		throw new Error(`이미지 생성 7회 재시도 모두 실패 (${label}): ${lastErr}`);
	}

	// Phase 3c: 이미지 생성 + 조립
	async _phase3c(ratio) {
		this._imgState = { intro: "intro 대기", middle: "middle 대기", outro: "outro 대기" };
		await PipelineUI.timed("phase3c", async () => {
			this._updateImgSubStatus();
			const [introRes, middleRes, outroRes] = await Promise.all([
				this._generateImageWithRetry(this.results.prompts.intro_prompt, ratio, "intro"),
				this._generateImageWithRetry(this.results.prompts.middle_prompt, ratio, "middle"),
				this._generateImageWithRetry(this.results.prompts.outro_prompt, ratio, "outro"),
			]);

			const introImg = introRes.url;
			const middleImg = middleRes.url;
			const outroImg = outroRes.url;
			this.results.images = {
				intro: introImg,
				middle: middleImg,
				outro: outroImg,
			};

			const [introUrl, middleUrl, outroUrl] = await Promise.all([
				introImg ? ApiClient.uploadToImgur(introImg) : null,
				middleImg ? ApiClient.uploadToImgur(middleImg) : null,
				outroImg ? ApiClient.uploadToImgur(outroImg) : null,
			]);
			this.results.imageUrls = {
				intro: introUrl,
				middle: middleUrl,
				outro: outroUrl,
			};

			const assembled = BlogAssembler.assemble(
				this.results.blog,
				this.results.prompts,
				this.results.images,
				this.results.imageUrls,
			);
			this.results.assembled = assembled.assembled;
			this.results.assembledPublish = assembled.assembledPublish;
			this.results.assembledText = assembled.assembledText;
		});
	}

	// Phase 4: 평가
	async _phase4() {
		const result = await PipelineUI.timed("phase4", () =>
			ApiClient.callAgent(
				`당신은 기술 블로그 편집자입니다. 독자 관점 품질 채점.
E1 비유 명확성(30%), E2 기술 깊이(25%), E3 가독성(20%), E4 흡인력(15%), E5 이미지-글 조화(10%). 통과: 3.5+`,
				[this.results.assembledText, JSON.stringify(this.results.design)],
				{
					thinking_budget: 2048,
					temperature: 0.0,
					schema_name: "evaluation",
					response_schema: {
						type: "object",
						properties: {
							weighted_average: { type: "number" },
							verdict: { type: "string" },
							scores: {
								type: "array",
								items: {
									type: "object",
									properties: {
										id: { type: "string" },
										dimension: { type: "string" },
										score: { type: "integer" },
										rationale: { type: "string" },
									},
									required: ["id", "dimension", "score", "rationale"],
								},
							},
							improvements: {
								type: "array",
								items: {
									type: "object",
									properties: {
										what: { type: "string" },
										how: { type: "string" },
										why: { type: "string" },
									},
									required: ["what", "how", "why"],
								},
							},
						},
						required: ["weighted_average", "verdict", "scores", "improvements"],
					},
				},
			),
		);
		this.results.eval = result.data;
		this._track(result.usage);
	}

	// Phase 5: 발행 (서버 프록시 경유)
	async _phase5(publishMode) {
		await PipelineUI.timed("phase5", async () => {
			if (publishMode === "local") {
				this.results.published = { status: "local_only" };
				return;
			}
			try {
				let bodyMd = this.results.assembledPublish || this.results.assembledText || "";
				try {
					bodyMd = await BlogAssembler.replaceMermaidBlocksWithImages(bodyMd);
				} catch (e) {
					console.warn("mermaid 변환 실패, 원본 사용:", e.message);
				}
				const htmlContent = BlogAssembler.markdownToHtml(bodyMd);
				const title = Pipeline._buildTitle(
					this.results.design?.confirmed_analogy,
					this.results.contextPacket?.topic,
				);
				const isDraft = publishMode === "draft";

				const res = await fetch("/api/blogger/post", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...AuthManager.getAuthHeaders(),
					},
					body: JSON.stringify({
						title,
						content: htmlContent,
						labels: [
							"기술블로그",
							"비유",
							this.results.contextPacket?.topic || "",
						],
						isDraft,
					}),
				});

				if (res.ok) {
					const post = await res.json();
					this.results.published = {
						status: "published",
						url: post.url,
						postId: post.id,
					};
					if (post.url) {
						// 게임 필살기 발동 모달 — 무조건 표시 (자동 새 탭 X, 사용자가 직접 클릭)
						const stats = {
							tokens: this.totalTokens,
							cost: this.totalCost,
							timeMs: Date.now() - this.startTime,
						};
						Pipeline._showOpenModal(post.url, stats);
						const btn = document.getElementById("publishBtn");
						if (btn) {
							btn.textContent = "발행 완료 — 다시 열기";
							btn.onclick = () => window.open(post.url, "_blank");
						}
					}
				} else {
					const err = await res.text();
					this.results.published = {
						status: "ready",
						message: `발행 실패 (${res.status}): ${err.substring(0, 100)}`,
					};
				}
			} catch (e) {
				this.results.published = { status: "ready", message: e.message };
			}
		});
	}
}
