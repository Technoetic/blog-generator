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
		document.getElementById("pipeline").className = "pipeline active";
		PipelineUI.resetPipeline();
		this.results = {};
		this.totalTokens = 0;
		this.totalCost = 0;
		this.startTime = Date.now();

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

		document.getElementById("generateBtn").disabled = false;
	}

	_track(usage) {
		this.totalTokens += usage.total_tokens || 0;
		this.totalCost += usage.cost || 0;
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
					console.log(`웹 검색: ${webResults.length}건, canonical=${canonicalName}`);
					if (canonicalName) {
						// 사용자 입력 topic을 검색 결과 기반 정식 명칭으로 강제 교체
						topic = `${canonicalName} (사용자 입력: ${topic})`;
					}
				}
			} catch (e) {
				console.warn("웹 검색 실패:", e.message);
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

	// Phase 2a: 비유설계 + 검증
	async _phase2a() {
		await PipelineUI.timed("phase2a", async () => {
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

중요: 모든 출력(confirmed_analogy, worldview, structure_mapping 등)은 반드시 한국어로 작성하라.`,
				[JSON.stringify(this.results.contextPacket)],
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

			if (verifyResult.data.verdict === "FAIL") {
				throw new Error(
					`Phase 2a 검증 FAIL: ${verifyResult.data.fail_summary.join(", ")}`,
				);
			}
		});
	}

	// Phase 2b: 글작성 + 이미지프롬프트 (병렬)
	async _phase2b(tone, ratio) {
		const [writerResult, imageResult] = await PipelineUI.timed("phase2b", () =>
			Promise.all([
				ApiClient.callAgent(
					`당신은 비유 블로그 전문 작가입니다. 풍부한 시각 요소가 포함된 한국어 블로그를 작성합니다.
## 소제목 규칙: 기계적 라벨("핵심 정리","대응표","마무리") 금지. 비유 스토리에서 자연스러운 한국어 제목 사용.
## 시각화: 테이블 2+, ASCII 다이어그램 2+, 인용블록 3+, 구분선 4+, 소제목 6+
## 분량: 친근 3000~5000 / 전문 4000~6000 / 유머 2500~4000

## 절대 규칙 (렌더링 깨짐 방지)
- ASCII 다이어그램(화살표, 박스, 파이프 문자 등)은 반드시 코드블록으로 감싸라. 코드블록 밖에 | 문자를 다이어그램 용도로 사용 금지.
- 마크다운 테이블은 반드시 헤더행 + 구분행(|---|---|) + 데이터행 형식을 지켜라.
- 모든 본문은 한국어로 작성하라. 기술 용어만 영문 병기 허용.

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
		if (!body) return 0;
		const codeBlocks = body.match(/```[a-zA-Z]*\n[\s\S]*?```/g) || [];
		let count = 0;
		for (const cb of codeBlocks) {
			const inner = cb.replace(/```[a-zA-Z]*\n/, "").replace(/```$/, "");
			const asciiChars = (inner.match(/[─━│┃┌┐└┘├┤┬┴┼+|\->=<^v↑↓→←]/g) || []).length;
			const hasBox = /[+\-]{3,}/.test(inner) || /[─━]{3,}/.test(inner);
			const hasArrow = inner.includes("->") || inner.includes("-->") || inner.includes("→");
			if (asciiChars >= 8 && (hasBox || hasArrow)) count++;
		}
		return count;
	}

	async _validateAndRetryWriter(tone) {
		for (let attempt = 0; attempt < 2; attempt++) {
			const body = this.results.blog.body || "";
			const bodyLen = body.length;
			const ascii = this._countAsciiDiagrams(body);
			console.log(`Phase 2b 검증 (attempt ${attempt}): body=${bodyLen}자, ascii=${ascii}`);

			const tooShort = bodyLen < 2500;
			const noAscii = ascii < 2;
			if (!tooShort && !noAscii) return; // 모두 통과
			if (attempt === 1 && noAscii && !tooShort) {
				// 마지막 시도도 ASCII 부족 → 결정론적 fallback 삽입 (100% 보장)
				console.warn("재시도 2회 후에도 ASCII 부족 → 결정론적 fallback 삽입");
				this.results.blog.body = BlogAssembler.ensureAsciiDiagrams(
					body,
					this.results.contextPacket,
				);
				return;
			}

			const reasons = [];
			if (tooShort) reasons.push(`본문이 너무 짧음(${bodyLen}자, 최소 4000자 필요)`);
			if (noAscii) reasons.push(`ASCII 다이어그램 부족(${ascii}개, 최소 2개 필요)`);
			console.warn(`재실행 사유: ${reasons.join(", ")}`);

			const retry = await ApiClient.callAgent(
				`이전 글이 검증 실패. 사유: ${reasons.join(" / ")}.

🚨 절대 규칙 (이번엔 반드시 지킬 것):
1. body는 최소 4000자 이상.
2. 코드블록(\`\`\` \`\`\`)으로 감싼 ASCII 다이어그램을 정확히 2개 이상 포함.
   예시:
   \`\`\`
   +-------------+      +-------------+
   |  사용자 입력  | ---> |   처리 단계   |
   +-------------+      +-------------+
                              |
                              v
                       +-------------+
                       |   최종 결과   |
                       +-------------+
   \`\`\`
3. 마크다운 테이블 2개 이상.
4. 톤: ${tone}.`,
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

	// Phase 3b: 팩트체크
	async _phase3b() {
		const result = await PipelineUI.timed("phase3b", () =>
			ApiClient.callAgent(
				`당신은 기술 팩트체크 전문가입니다. 기술 주장을 CORRECT/INACCURATE/MISLEADING로 판정.`,
				[
					JSON.stringify(this.results.blog),
					JSON.stringify(this.results.design),
				],
				{
					thinking_budget: 4096,
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

	// Phase 3c: 이미지 생성 + 조립
	async _phase3c(ratio) {
		await PipelineUI.timed("phase3c", async () => {
			const [introImg, middleImg, outroImg] = await Promise.all([
				ApiClient.generateImage(this.results.prompts.intro_prompt, ratio),
				ApiClient.generateImage(this.results.prompts.middle_prompt, ratio),
				ApiClient.generateImage(this.results.prompts.outro_prompt, ratio),
			]);
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
				const htmlContent = BlogAssembler.markdownToHtml(
					this.results.assembledPublish || this.results.assembledText || "",
				);
				const title = `${this.results.design?.confirmed_analogy || "비유"} — ${this.results.contextPacket?.topic || "기술 블로그"}`;
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
						window.open(post.url, "_blank");
						const btn = document.getElementById("publishBtn");
						if (btn) {
							btn.textContent = "발행 완료 — 새 탭으로 보기";
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
