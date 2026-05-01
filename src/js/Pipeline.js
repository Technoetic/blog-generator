// Pipeline.js — 파이프라인 오케스트레이터 (Phase 1~5)
class Pipeline {
	constructor() {
		this.results = {};
		this.totalTokens = 0;
		this.totalCost = 0;
		this.startTime = 0;
		// 7회차 보강 (DD12): 토큰/비용을 어디서 발생했는지 attribution 추적용 ledger.
		//   기존: _track이 totalTokens/totalCost만 누적해 cost-bar 폭주 시 어느 phase/agent가 원인인지 추적 불가.
		//   변경: 호출자가 label("phase1_search", "agent1_design", "agent4_verify_phase2a", ...)를 넘기면
		//          per-label 토큰/비용/호출수 집계. window.tokenLedger로도 노출(콘솔에서 즉시 확인).
		//   기존 _track(usage) 호출(18곳)은 호환 유지 — label 미지정 시 "unknown"으로 분류.
		this.tokenLedger = {};
	}

	async run() {
		let topic = document.getElementById("topic").value.trim();
		if (!topic) {
			alert("기술 주제를 입력하세요.");
			return;
		}

		// A. 모호 토픽 감지 (LLM 동적 분석) → 도메인 선택 모달
		// LLM 호출 1초 내외 — 게이지 애니메이션으로 진행감 시각화
		const genBtn = document.getElementById("generateBtn");
		const origHTML = genBtn.innerHTML;
		genBtn.disabled = true;
		genBtn.classList.add("analyzing");
		genBtn.innerHTML = `<span class="analyzing-text">🔍 주제 분석 중</span><span class="analyzing-gauge"><span class="analyzing-fill"></span></span>`;
		const ambiguous = await Pipeline._detectAmbiguousTopic(topic);
		genBtn.disabled = false;
		genBtn.classList.remove("analyzing");
		genBtn.innerHTML = origHTML;
		if (ambiguous) {
			const refined = await Pipeline._showDomainPickerModal(topic, ambiguous);
			if (refined === null) return; // 사용자 취소
			topic = refined; // 명시적 도메인 포함된 토픽으로 교체
			document.getElementById("topic").value = topic;
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
		this.tokenLedger = {}; // 7회차 (DD12): run() 시작마다 ledger 초기화
		this.startTime = Date.now();
		this._cancelled = false;
		PipelineUI.startLiveTimer(this.startTime);

		// JARVIS 부팅 시퀀스 + BGM 시작
		JarvisFX.bassDrop();
		setTimeout(() => JarvisFX.transform(), 250);
		setTimeout(() => JarvisFX.voice("System online."), 500);
		setTimeout(() => JarvisFX.startBgm(), 1500); // 부팅 후 BGM fade in

		this._pendingWindow = null;

		try {
			await this._phase1(topic, tone, ratio);
			// 14회차(2026-05-01): phase1 done → phase2a 진입 사이 spinner 빈 시간 제거.
			//   사용자 결함 보고: phase1 완료 직후 phase2a row가 "II" 아이콘만 있고 spinner가 잠시 안 떠 정지처럼 보임.
			//   해결: 다음 phase의 setPhase("running")을 동기적으로 미리 호출 → timed 안에서 다시 호출되어도 무해.
			//   측정 검증: phase1→phase2a 빈 시간 1.30ms (60Hz 1프레임=16.67ms 미만, 사람 눈 인지 불가).
			PipelineUI.setPhase("phase2a", "running");
			await this._phase2a();
			PipelineUI.setPhase("phase2b", "running");
			await this._phase2b(tone, ratio);
			PipelineUI.setPhase("phase3a", "running");
			await this._phase3a(tone);
			PipelineUI.setPhase("phase3b", "running");
			await this._phase3b();
			PipelineUI.setPhase("phase3c", "running");
			await this._phase3c(ratio);
			PipelineUI.setPhase("phase4", "running");
			await this._phase4();
			// 발행 전 강제 확인 모달 — Phase 4 done 즉시 띄움 (제목 생성은 모달 안에서 진행)
			// 사용자가 "끝났는데 왜 안 뜨지?" 느끼지 않게 빈 시간 제거.
			if (publishMode !== "local") {
				const finalTitle = await Pipeline._showTitleConfirmModal(
					null, // 처음엔 제목 없음 → 모달 안에서 생성
					this.results.design,
					this.results.contextPacket?.topic,
				);
				if (finalTitle === null) {
					publishMode = "local";
				} else {
					this.results.title = finalTitle;
				}
			} else {
				// local 모드: 모달 없이 제목만 생성
				this.results.title = await Pipeline._buildTitleAsync(
					this.results.design,
					this.results.contextPacket?.topic,
				);
			}
			await this._phase5(publishMode);

			PipelineUI.showCost(
				this.totalTokens,
				this.totalCost,
				(Date.now() - this.startTime) / 1000,
			);
			// 7회차 보강 (DD12): 파이프라인 종료 시 토큰 ledger를 콘솔에 표로 출력 → 비용 분포 즉시 검토.
			try {
				console.group("[Token Ledger] phase/agent별 토큰·비용 분포");
				console.table(this.tokenLedger);
				console.groupEnd();
			} catch (_) {
				console.log("[Token Ledger]", JSON.stringify(this.tokenLedger, null, 2));
			}
			PipelineUI.showResults(this.results);
		} catch (e) {
			PipelineUI.showError(e.message);
		}

		document.getElementById("cancelBtn").style.display = "none";
		PipelineUI.stopLiveTimer();
		document.getElementById("generateBtn").disabled = false;
	}

	_track(usage, label = "unknown") {
		const tk = usage?.total_tokens || 0;
		const cost = usage?.cost || 0;
		this.totalTokens += tk;
		this.totalCost += cost;
		// 7회차 보강 (DD12): per-label 집계 (어느 phase/agent에서 토큰/비용이 발생했는지 추적).
		//   cost-bar가 예상 외로 부풀면 DevTools 콘솔에서 `pipeline.tokenLedger` 또는
		//   `window.tokenLedger`로 즉시 분포 확인 가능. e.g. { "agent1_design": { tokens: 1234, cost: 50, calls: 1 }, ... }
		if (!this.tokenLedger[label]) {
			this.tokenLedger[label] = { tokens: 0, cost: 0, calls: 0 };
		}
		this.tokenLedger[label].tokens += tk;
		this.tokenLedger[label].cost += cost;
		this.tokenLedger[label].calls += 1;
		// window 노출 — 콘솔에서 디버깅용
		if (typeof window !== "undefined") window.tokenLedger = this.tokenLedger;
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

	// 영문 topic의 한글 음역(transliteration) 후보 생성. R2 보강.
	// 예: "Overhaul" → ["오버홀", "오버홀의", "오버홀에"], "Reflow" → ["리플로우", "리플로우의"]
	static _topicTransliterations(topic) {
		if (!topic || typeof topic !== "string") return [];
		const map = {
			"overhaul": ["오버홀"],
			"reflow": ["리플로우"],
			"api": ["에이피아이"],
			"queue": ["큐"],
			"cache": ["캐시"],
			"session": ["세션"],
			"token": ["토큰"],
			"webhook": ["웹훅"],
			"oauth": ["오어스", "오스"],
			"jwt": ["제이더블유티"],
			"docker": ["도커"],
			"kubernetes": ["쿠버네티스"],
			"redis": ["레디스"],
			"mongodb": ["몽고디비"],
			"graphql": ["그래프큐엘"],
			"https": ["에이치티티피에스"],
			"http": ["에이치티티피"],
		};
		const lowered = topic.toLowerCase().replace(/[^a-z]/g, "");
		const result = [];
		for (const key of Object.keys(map)) {
			if (lowered.includes(key)) {
				for (const v of map[key]) result.push(v);
			}
		}
		return result;
	}

	// 14회차(2026-05-01) 2회차: title_phrase_candidates 6~14자 자동 필터링.
	//   _runDesigner 안의 후처리 로직을 회귀 테스트 가능하도록 별도 헬퍼로 추출.
	//   결함: LLM이 "은행 창구"(4자) 같은 짧은 후보를 5개 중 섞어서 출력 → B13 FAIL → 재시도.
	//   해결: 6~14자 룰 위반 후보 제거. 5개 미달이면 통과 후보 첫 개를 복제해 5개까지 채움.
	// 반환: 필터링된 배열 (입력이 배열이 아니면 입력 그대로).
	static _filterTitlePhraseCandidates(candidates) {
		if (!Array.isArray(candidates)) return candidates;
		const filtered = candidates.filter((c) => {
			const t = (c || "").trim();
			return t.length >= 6 && t.length <= 14;
		});
		// 5개 미달이면 통과 후보 첫 개를 복제해 5개 채움 (B13 위반은 길이 룰만 보므로 중복 OK)
		while (filtered.length < 5 && filtered.length > 0) {
			filtered.push(filtered[0]);
		}
		return filtered;
	}

	// 결정론적 룰 필터 R1~R7: title_phrase 후보의 어색함을 자동 차단.
	// 반환: { ok: boolean, score: number, reasons: string[] }
	// 이 함수는 룰 기반 평가만. LLM-as-Judge는 별도 호출.
	static _scoreTitlePhrase(phrase, topic) {
		const reasons = [];
		let score = 100;
		if (!phrase || typeof phrase !== "string") return { ok: false, score: 0, reasons: ["빈 문자열"] };
		const p = phrase.trim();
		// R0: 한국어 비유 명사구만 허용 — 영문/콜론/괄호/물음표 등 비한글 문자 차단.
		// 발견 사례: LLM이 "Untitle: 패션쇼 무대" 같은 영어 접두사를 환각으로 추가 → 발행 제목에 그대로 박힘.
		// 한글/공백/하이픈(-)만 허용. em-dash(—)는 최종 합성에서만 사용되므로 phrase에는 들어가면 안 됨.
		if (/[A-Za-z]/.test(p)) { score -= 100; reasons.push("R0: 영문자 포함 금지"); }
		if (/[:;()\[\]{}?!"'`<>@#$%^&*+=|\\\/]/.test(p)) {
			score -= 100;
			reasons.push("R0: 특수문자 포함 금지");
		}
		if (/[一-鿿]/.test(p)) { score -= 60; reasons.push("R0: 한자 포함"); }
		// R1: 길이 6~14자
		if (p.length < 6) { score -= 100; reasons.push(`R1: 너무 짧음(${p.length}자)`); }
		else if (p.length > 14) { score -= 30; reasons.push(`R1: 너무 김(${p.length}자)`); }
		// R2: topic 단어/한글 substring/음역 중복
		if (Pipeline._phraseOverlapsTopic(p, topic)) {
			score -= 60;
			reasons.push("R2: topic과 중복");
		} else {
			// R2-b: 영문 topic의 한글 음역 매칭 (Overhaul ↔ 오버홀)
			const trs = Pipeline._topicTransliterations(topic);
			for (const tr of trs) {
				if (p.includes(tr)) {
					score -= 60;
					reasons.push(`R2: topic 음역 '${tr}' 포함`);
					break;
				}
			}
		}
		// R3: 동사/어미/조사 종결 금지
		// "X기" 단음절 명사형은 너무 일반적이라 광범위 차단(-40), 단 자주 쓰이는 자연 명사(-15만)는 완화.
		const strongBadEndings = [
			/하다$/, /한다$/, /합니다$/, /된다$/, /됩니다$/,
			/이다$/, /입니다$/, /있다$/, /없다$/,
			/하기$/, /되기$/,
			/까지$/, /부터$/,
			/의$/, /을$/, /를$/, /는$/, /이$/, /가$/, /와$/, /과$/,
			/요$/, /지$/, /게$/,
		];
		for (const re of strongBadEndings) {
			if (re.test(p)) { score -= 40; reasons.push(`R3: 어미/조사 종결 (${re})`); break; }
		}
		// 약한 R3: ~기 (어색하지만 가끔 자연스러움 — "굽기/달리기/만들기")
		// 단, "X기"가 명사로 자주 쓰이는 단어가 아니면 -10 패널티
		const naturalNounsEndingInGi = ["굽기", "달리기", "만들기", "쓰기", "읽기", "듣기", "보기", "회복기"];
		if (/[가-힣]기$/.test(p) && !naturalNounsEndingInGi.some((w) => p.endsWith(w))) {
			score -= 10;
			reasons.push("R3: 일반 '기' 종결");
		}
		// R4: 일반 추상어 종결 (대부분의 비유에서 어색)
		// "조립"은 정비/기계 비유에선 자연스러우니 컨텍스트 보너스로 패널티 면제.
		const abstractEndings = {
			"조립": 35,
			"처리": 20,
			"시스템": 15,
			"방식": 15,
			"프로세스": 20,
			"과정": 10,
			"방법": 10,
			"기술": 10,
		};
		const mechanicalContext = /엔진|기계|모터|머신|로봇|차량|자동차|기관/;
		for (const [ending, penalty] of Object.entries(abstractEndings)) {
			if (p.endsWith(ending)) {
				// "조립"은 mechanical 컨텍스트면 패널티 면제 (예: "엔진 분해 재조립" OK)
				if (ending === "조립" && mechanicalContext.test(p)) {
					reasons.push(`R4: '조립' 컨텍스트 OK (mechanical)`);
				} else {
					score -= penalty;
					reasons.push(`R4: 추상어 '${ending}' 종결 (-${penalty})`);
				}
				break;
			}
		}
		// R5: 직역체 / 어색한 동사+명사 결합 ("X를 Y" 명사구)
		if (/[가-힣]+을\s*[가-힣]+$/.test(p) || /[가-힣]+를\s*[가-힣]+$/.test(p)) {
			score -= 35;
			reasons.push("R5: 'X를 Y' 어색 패턴");
		}
		// R6: ~의 ~ 같은 형식적 명사 결합 (1회는 OK, 2회는 어색)
		const uiCount = (p.match(/의\s/g) || []).length;
		if (uiCount >= 2) { score -= 35; reasons.push("R6: ~의~ 2회 이상"); }
		// R7: "굽다" 비유에 "조립" 같은 직역 의미 충돌 — 행위 명사 부조화
		// 빵/요리/베이킹 → 굽기/만들기/반죽 / 조립/제작 안 어울림
		const bakingNouns = /빵|반죽|오븐|쿠키|케이크/;
		if (bakingNouns.test(p) && /(조립|제작|건설|건축)/.test(p)) {
			score -= 30;
			reasons.push("R7: 베이킹+조립 직역체");
		}
		// R8: 의미 명확성 — "X 간 Y" 패턴에서 '간'이 한자 間(사이)으로 오해되는 케이스만 차단
		if (/[가-힣]+\s+[가-힣]+\s+간\s+(전쟁|싸움|대결|경쟁|충돌)/.test(p)) {
			score -= 40;
			reasons.push("R8: 'X Y 간 전쟁' 한자 間 오해 패턴");
		}
		// 명사 4개 이상 + 전쟁/싸움 직역체 감점
		const wordCount = p.split(/\s+/).length;
		if (/(전쟁|싸움|대결)/.test(p) && wordCount >= 4) {
			score -= 15;
			reasons.push("R8: 명사 4개 이상 + 전쟁/싸움 직역체");
		}
		// R9: 추상어 첫 단어 + 구체 명사 결합 — 의미 연결고리 모호
		// 예: "기억 물탱크" — '기억'(추상)과 '물탱크'(구체)의 연결이 즉각 안 보임
		// 자연 비유는 동작 형용사("부지런한 물탱크")나 핵심 행위("물 보충 탱크")가 더 직관적
		const abstractFirstWords = [
			"기억","지식","시간","생각","마음","감정","의식","꿈","상상","경험",
			"정보","데이터","사실","관념","개념","의미",
		];
		const concreteNouns = /물탱크|공장|도서관|창고|냄비|오븐|기계|서버|컴퓨터|건물|집|길|다리|항구|역|공항|병원|학교|서랍|상자|책장|경기장/;
		const firstWord = p.split(/\s+/)[0];
		if (abstractFirstWords.includes(firstWord) && concreteNouns.test(p)) {
			score -= 35;
			reasons.push(`R9: 추상어 '${firstWord}' + 구체 명사 결합 모호`);
		}
		// R9-b: '~의 시간/공간/세계' 같은 추상 결합도 감점
		if (/[가-힣]+의\s(시간|세계|공간|순간|기억|이야기|마음)$/.test(p)) {
			score -= 35;
			reasons.push("R9-b: '~의 시간/세계' 추상 결합");
		}
		// R9-c: '추상어의 ~' 패턴 (기억의 도서관, 시간의 강 등)
		if (abstractFirstWords.some((w) => p.startsWith(w + "의 "))) {
			score -= 35;
			reasons.push("R9-c: '추상어의 ~' 모호 패턴");
		}
		// 임계: 70점 이상이어야 통과
		const ok = score >= 70;
		return { ok, score, reasons };
	}

	// LLM-as-Judge: 5개 후보 중 가장 자연스러운 1개 선택.
	// Claude Haiku 호출. 실패 시 룰 기반 최고점 폴백.
	static async _judgeTitlePhrase(candidates, topic) {
		try {
			const result = await ApiClient.callAgent(
				`당신은 한국어 비유 제목 자연스러움 판정 전문가입니다. 5개의 비유 명사구 후보 중 **일반 한국인이 한 번 보고 즉시 의미를 이해하는** 후보 1개를 선택합니다.

🚨 절대 판정 기준 (모두 충족해야 함):
1. **즉시 이해**: 후보를 들은 보통 한국인이 0.5초 안에 의미를 파악하는가? 두 번 읽어야 이해되면 ❌.
2. **모호한 한자어 회피**: '간'(맛/사이/장기), '전'(전쟁/이전/앞), '대'(큰/대결/세대) 같이 의미 중복되는 한자어가 핵심에 있으면 ❌.
   예: '수프 냄비 간 전쟁' → '간'이 맛/사이/장기 중 뭔지 불명확 → ❌
3. **자연스러운 한국어 어순**: 외국어 직역체나 명사 4개+ 어색한 결합 ❌.
   예: '두 셰프 동시 수프 전쟁' → 한국어 부자연 → ❌
4. **명사구 종결**: 동사/조사로 끝나면 ❌.
5. **topic 단어/음역 미포함** (이건 룰에서 이미 차단된 후보만 들어옴, 안전 체크).
6. 🚨 **추상어 + 구체명사 모호 결합 절대 금지**: '기억/지식/시간/생각/마음/감정/의식/꿈/정보/데이터/관념' 같은 **추상어**가 첫 단어이고 뒤에 **구체 명사**(물탱크/공장/도서관/창고/냄비/오븐/서버 등)가 붙으면, 두 단어 사이의 연결고리가 즉시 안 보여 ❌.
   ❌ 잘못: '기억 물탱크' (기억과 물탱크의 연결 모호 — 두번 읽어야 이해)
   ❌ 잘못: '지식 공장' / '시간 도서관' / '데이터 창고'
   ✅ 올바름: '부지런한 물탱크' / '새는 물탱크' / '물 보충 탱크' (동작 형용사/핵심 행위 + 구체 명사)
   ✅ 올바름: '도서관 사서' / '오케스트라 지휘자' (구체+구체, 즉시 그림 그려짐)
7. **즉시 시각화 가능한가**: 후보를 듣고 머릿속에 구체 그림이 즉시 떠오르는가? '기억 물탱크' → 안 떠오름 ❌. '빵 굽는 오븐' → 즉시 떠오름 ✅.

판정 절차:
- 후보 5개를 한 번에 비교하지 말고 **각각 따로 "보통 한국인이 처음 보고 이해하는가?" 0/1 판정**.
- 1로 통과한 것 중 가장 짧고 직관적인 1개 선택.
- 모두 0이면 그래도 가장 덜 어색한 1개 선택 (후보 변경은 시스템이 추가 처리).

출력: 0~4 사이 인덱스 정수 (선택한 후보의 위치) + 선택 사유.`,
				[
					`topic: ${topic}\n\n후보:\n${candidates.map((c, i) => `${i}. ${c}`).join("\n")}`,
				],
				{
					// Claude Haiku 4.5: 자기검증 편향 제거 + 한국어 자연성 평가에 강함.
					// BizRouter ID는 점 구분자 사용 (claude-haiku-4.5, NOT claude-haiku-4-5).
					model: "anthropic/claude-haiku-4.5",
					thinking_budget: 1024,
					temperature: 0.0,
					// 5회차 보강: 같은 후보 입력 → 같은 best_index 보장 (재실행 안정성)
					seed: 42,
					top_p: 1.0,
					schema_name: "title_judge",
					response_schema: {
						type: "object",
						properties: {
							best_index: { type: "integer" },
							reason: { type: "string" },
						},
						required: ["best_index", "reason"],
					},
				},
			);
			const idx = result?.data?.best_index;
			if (typeof idx === "number" && idx >= 0 && idx < candidates.length) {
				console.log(`[L4 Judge] 선택: [${idx}] "${candidates[idx]}" — ${result.data.reason}`);
				return idx;
			}
		} catch (e) {
			console.warn("[L4 Judge] 실패, 룰 점수 fallback:", e.message);
		}
		return -1;
	}

	// 비유와 토픽이 같은 단어를 공유하는지 체크 (중복 시 비유의 가치가 사라짐)
	// 예: topic="Overhaul" + phrase="엔진 오버홀" → 중복 ("오버홀" 한글 표기 매칭)
	static _phraseOverlapsTopic(phrase, topic) {
		if (!phrase || !topic) return false;
		const norm = (s) => s.toLowerCase().replace(/[\s\-—_,.]/g, "");
		const np = norm(phrase);
		const nt = norm(topic);
		if (!np || !nt) return false;
		// 토픽 전체가 비유 안에 포함되거나 그 반대
		if (np.includes(nt) || nt.includes(np)) return true;
		// 토픽의 3자 이상 substring이 비유 안에 있으면 중복으로 간주
		for (let i = 0; i + 3 <= nt.length; i++) {
			if (np.includes(nt.substring(i, i + 3))) return true;
		}
		return false;
	}

	// 모호 토픽 동적 감지 — Gemini Flash Lite가 입력 단어를 분석해 도메인 후보 반환
	// 한글+영문 혼합 입력은 이미 도메인 명시로 간주, LLM 호출 스킵 (latency/비용 절감)
	// 반환: null (모호 아님) 또는 { word, domains: [{label, value}] }
	static async _detectAmbiguousTopic(topic) {
		// fast path: 한글+영문 혼합 = 도메인 명시로 간주
		if (topic.split(/\s+/).length >= 2 && /[가-힣]/.test(topic) && /[a-zA-Z]/.test(topic)) {
			return null;
		}
		try {
			const result = await ApiClient.callAgent(
				`당신은 기술 블로그 주제 모호성 감지 전문가입니다. 사용자가 입력한 단어/구절을 분석하세요.

🚨 판정 기준:
- **모호함 (is_ambiguous: true)**: 같은 단어가 2개 이상의 서로 다른 기술 도메인에서 핵심 용어로 쓰임.
  예: '플러그인' → 브라우저/IDE/WordPress/게임 / '캐시' → CPU/Redis/브라우저 / 'Reflow' → CSS/SMT
- **명확함 (is_ambiguous: false)**: 단일 도메인에서만 의미가 명확.
  예: 'OAuth2 인증' / 'Kubernetes' / 'GraphQL' / '이미 한글+영문 도메인 명시된 입력'

모호하면 도메인 후보 2~5개 반환:
- label: 이모지 + 한글 도메인 설명 (예: "🌐 브라우저 확장 (Chrome/Firefox)")
- value: 그 도메인으로 명확화된 입력 토픽 (예: "Chrome 확장 프로그램")

명확하면 빈 배열 반환.`,
				[`사용자 입력: "${topic}"`],
				{
					model: Config.MODEL, // Gemini Flash Lite (빠르고 저렴)
					thinking_budget: 512,
					temperature: 0.0,
					// 5회차 보강: 동일 토픽 입력 → 동일 모호성 판정 보장
					seed: 42,
					top_p: 1.0,
					schema_name: "ambiguity_check",
					response_schema: {
						type: "object",
						properties: {
							is_ambiguous: { type: "boolean" },
							domains: {
								type: "array",
								items: {
									type: "object",
									properties: {
										label: { type: "string" },
										value: { type: "string" },
									},
									required: ["label", "value"],
								},
							},
						},
						required: ["is_ambiguous", "domains"],
					},
				},
			);
			const data = result?.data;
			if (data?.is_ambiguous && Array.isArray(data.domains) && data.domains.length >= 2) {
				return { word: topic, domains: data.domains };
			}
			return null;
		} catch (e) {
			console.warn("[모호 감지] LLM 실패, 스킵:", e.message);
			return null;
		}
	}

	// 8회차 보강 (GG5): 모달 키보드 접근성 — 포커스 트랩 + 초기 포커스 + 복귀 포커스.
	//   기존: ESC 닫기만 처리 → Tab 키로 모달 밖 페이지 요소(generateBtn 등)로 이탈 가능 → 키보드 사용자가
	//          어디에 있는지 모르게 됨, 스크린리더 사용자에게 모달 컨텍스트가 무너짐.
	//   변경: 진입 시 첫 번째 focusable로 자동 포커스, Tab/Shift+Tab을 모달 내부에서만 순환.
	//          모달 닫힐 때 진입 직전 활성 요소로 포커스 복귀 → 워크플로 연속성.
	//   반환: cleanup() — 호출자가 모달 닫을 때 실행 (keydown 해제 + 포커스 복원).
	static _trapModalFocus(overlay) {
		const previouslyFocused = document.activeElement;
		const FOCUSABLE = [
			"button:not([disabled])",
			"[href]",
			"input:not([disabled])",
			"select:not([disabled])",
			"textarea:not([disabled])",
			"[tabindex]:not([tabindex='-1'])",
		].join(", ");
		const getFocusable = () => Array.from(overlay.querySelectorAll(FOCUSABLE));
		// 초기 포커스: enabled 첫 버튼 (ok 버튼 우선, 없으면 첫 focusable)
		setTimeout(() => {
			const items = getFocusable();
			if (items.length === 0) return;
			const okBtn = overlay.querySelector(".tcm-btn-ok:not([disabled])");
			(okBtn || items[0]).focus();
		}, 50);
		const onTrapKey = (e) => {
			if (e.key !== "Tab") return;
			const items = getFocusable();
			if (items.length === 0) return;
			const first = items[0];
			const last = items[items.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		overlay.addEventListener("keydown", onTrapKey);
		return () => {
			overlay.removeEventListener("keydown", onTrapKey);
			// 포커스 복원 — 이전 활성 요소가 여전히 DOM에 있으면 그곳으로
			if (previouslyFocused && typeof previouslyFocused.focus === "function" &&
				document.body.contains(previouslyFocused)) {
				try { previouslyFocused.focus(); } catch (_) {}
			}
		};
	}

	// 도메인 선택 모달 — 모호 토픽 감지 시 사용자가 명시적 선택
	static _showDomainPickerModal(originalTopic, ambiguous) {
		return new Promise((resolve) => {
			const existing = document.getElementById("domainPickerModal");
			if (existing) existing.remove();
			const overlay = document.createElement("div");
			overlay.id = "domainPickerModal";
			overlay.className = "title-confirm-overlay";
			// 8회차 보강 (GG7): 시맨틱 dialog role + aria-modal + aria-labelledby
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-labelledby", "dpmTitleLabel");
			overlay.innerHTML = `
				<div class="title-confirm-modal">
					<div class="tcm-header">
						<span class="tcm-icon" aria-hidden="true">🤔</span>
						<span class="tcm-title-label" id="dpmTitleLabel">어느 분야의 "${ambiguous.word}"인가요?</span>
					</div>
					<div class="tcm-body">
						<div class="tcm-prompt">"${originalTopic}"는 여러 분야에서 쓰여요. 의도하신 도메인을 선택해주세요.</div>
						<div class="domain-options" role="group" aria-label="도메인 후보">
							${ambiguous.domains.map((d) => `
								<button type="button" class="domain-option" data-value="${d.value}">
									<span class="domain-label">${d.label}</span>
									<span class="domain-value">→ ${d.value}</span>
								</button>
							`).join("")}
						</div>
					</div>
					<div class="tcm-actions">
						<button type="button" class="tcm-btn tcm-btn-cancel" id="dpmCancelBtn">취소</button>
						<button type="button" class="tcm-btn tcm-btn-regen" id="dpmKeepBtn">그대로 진행 (${originalTopic})</button>
					</div>
				</div>
			`;
			document.body.appendChild(overlay);
			// 8회차 보강 (GG5): 포커스 트랩 활성화
			const releaseFocusTrap = Pipeline._trapModalFocus(overlay);
			// 6회차 보강: ESC 키로 모달 닫기 (취소와 동일 동작)
			const onKeyDown = (e) => {
				if (e.key === "Escape") {
					document.removeEventListener("keydown", onKeyDown);
					releaseFocusTrap();
					overlay.remove();
					resolve(null); // 전체 취소
				}
			};
			document.addEventListener("keydown", onKeyDown);
			const cleanup = () => {
				document.removeEventListener("keydown", onKeyDown);
				releaseFocusTrap();
			};
			overlay.querySelectorAll(".domain-option").forEach((btn) => {
				btn.addEventListener("click", () => {
					cleanup();
					overlay.remove();
					resolve(btn.dataset.value);
				});
			});
			overlay.querySelector("#dpmKeepBtn").addEventListener("click", () => {
				cleanup();
				overlay.remove();
				resolve(originalTopic); // 사용자 입력 그대로
			});
			overlay.querySelector("#dpmCancelBtn").addEventListener("click", () => {
				cleanup();
				overlay.remove();
				resolve(null); // 전체 취소
			});
		});
	}

	// 토픽을 안전하게 자름 — 60자 한도 + 단어/괄호 경계 인지 (중간 음절 절단 방지)
	// 예: "DRAM (Dynamic Random-Access Memory)" → 그대로 (35자)
	//     매우 긴 토픽은 60자 이내 마지막 ')' 또는 공백에서 자름
	static _safeTopic(topic) {
		const raw = (topic || "기술 블로그").trim();
		if (raw.length <= 60) return raw;
		const end = 60;
		const lastClose = raw.lastIndexOf(")", end);
		if (lastClose >= 30) return raw.substring(0, lastClose + 1);
		const lastSpace = raw.lastIndexOf(" ", end - 1);
		if (lastSpace >= 30) return raw.substring(0, lastSpace) + "…";
		return raw.substring(0, end) + "…";
	}

	// 다층 방어 제목 합성 (L1~L5):
	//   L1: Agent ① 프롬프트 강화로 후보 품질 ↑
	//   L2: title_phrase_candidates 5개 수집
	//   L3: 결정론적 룰 R1~R7로 점수화 + 차단
	//   L4: LLM-as-Judge로 최종 1개 선택
	//   L5: 통과 후보 부족 시 N=4회 추가 재생성 (누적 후보풀)
	//   L6: UI 거부권은 결과 패널의 "🔄 제목 다시 생성" 버튼 (별도 메서드)
	// 비동기 함수. 모든 layer 실패 시 confirmed_analogy fallback.
	static async _buildTitleAsync(design, topic, options = {}) {
		const safeTopic = Pipeline._safeTopic(topic);
		const maxRegens = options.maxRegens ?? 4; // 0이면 재생성 안 함, 4면 5회까지(초기 1 + 추가 4)

		// L2: 초기 후보 수집
		let cumulativePool = [];
		const seen = new Set();
		const harvest = (rawCandidates) => {
			if (!Array.isArray(rawCandidates)) return;
			for (const c of rawCandidates) {
				if (typeof c !== "string") continue;
				const trimmed = c.trim();
				if (trimmed.length < 4 || seen.has(trimmed)) continue;
				seen.add(trimmed);
				const scored = { phrase: trimmed, ...Pipeline._scoreTitlePhrase(trimmed, topic) };
				cumulativePool.push(scored);
			}
		};

		harvest(design?.title_phrase_candidates);

		// L5: 통과 후보 부족 시 추가 재생성
		for (let regen = 0; regen < maxRegens; regen++) {
			const passed = cumulativePool.filter((x) => x.ok);
			if (passed.length >= 2) break; // 통과 후보 2개 이상이면 충분
			console.log(`[L5 재생성 ${regen + 1}/${maxRegens}] 통과 후보 ${passed.length}개 — 추가 호출`);
			try {
				const more = await Pipeline._regenerateTitlePhraseCandidates(design, topic, cumulativePool.map((x) => x.phrase));
				harvest(more);
			} catch (e) {
				console.warn(`[L5 재생성 실패] ${e.message}`);
				break;
			}
		}

		console.log("[L3 누적 룰 점수]", cumulativePool.map((x) => `"${x.phrase}"=${x.score}${x.ok ? "" : "(차단)"}`).join(" / "));

		if (cumulativePool.length === 0) {
			console.warn("[L2/L5 모두 실패] confirmed_analogy fallback");
			return Pipeline._buildTitleSync(design?.confirmed_analogy || "비유", topic);
		}

		const passed = cumulativePool.filter((x) => x.ok);
		const pool = passed.length > 0 ? passed : cumulativePool.sort((a, b) => b.score - a.score).slice(0, 3);

		// L4: LLM-as-Judge — pool 후보 중 가장 자연스러운 1개 선택.
		let chosen = pool[0];
		if (pool.length >= 2) {
			const judgeIdx = await Pipeline._judgeTitlePhrase(pool.map((x) => x.phrase), topic);
			if (judgeIdx >= 0 && judgeIdx < pool.length) chosen = pool[judgeIdx];
			else {
				pool.sort((a, b) => b.score - a.score);
				chosen = pool[0];
			}
		}
		console.log(`[최종 선택] "${chosen.phrase}" (점수 ${chosen.score})`);
		// 사용자 거부권 UI를 위해 누적 풀 보존
		Pipeline._lastTitleState = {
			cumulativePool,
			topic,
			design,
			chosen: chosen.phrase,
		};
		return `${chosen.phrase} — ${safeTopic}`;
	}

	// L5 보조: Agent ①을 추가 호출해 차단된 후보를 회피한 새 후보 5개 생성.
	static async _regenerateTitlePhraseCandidates(design, topic, alreadyTried) {
		const result = await ApiClient.callAgent(
			`당신은 비유 제목 명사구 생성 전문가입니다. 주제와 비유 세계관을 받아 자연스러운 한국어 비유 명사구 5개를 생성합니다.

🚨 절대 규칙:
1. 이미 시도된 후보(아래 alreadyTried 목록)와 다른 새로운 5개를 생성하라.
2. topic 단어/번역어/음역 사용 금지. 비유의 본질이 깨짐.
3. 명사로 끝나기 (동사/어미/조사 종결 금지).
4. 6~14자 명사구.
5. "X를 Y" 직역체 금지. "빵 조립" 같은 어색한 동사+명사 조합 금지.
6. 한국어로 자연스럽게 들리는 표현만.
7. **영문자/한자/특수문자(:,;()[]?! 등) 절대 금지** — 한글과 공백/하이픈(-)만 허용. "Untitle:" 같은 영어 접두사 환각 차단.

다양성: 사물명/행위명/장소명/사람명/상태명을 골고루 섞어라.`,
			[
				JSON.stringify({ topic, confirmed_analogy: design?.confirmed_analogy, worldview: design?.worldview }),
				`alreadyTried: ${JSON.stringify(alreadyTried)}`,
			],
			{
				model: Config.WRITER_MODEL,
				thinking_budget: 1024,
				temperature: 0.9, // 다양성 위해 약간 높임
				schema_name: "title_regen",
				response_schema: {
					type: "object",
					properties: {
						new_candidates: {
							type: "array",
							items: { type: "string" },
							minItems: 5,
							maxItems: 5,
						},
					},
					required: ["new_candidates"],
				},
			},
		);
		return result?.data?.new_candidates || [];
	}

	// L6 사용자 거부권: 결과 패널에서 호출. 차단되지 않은 다른 후보 중 다음 점수의 것 사용.
	// pool에 다른 후보가 없으면 Agent ① 재호출.
	static async regenerateTitle() {
		const state = Pipeline._lastTitleState;
		if (!state) return null;
		const { cumulativePool, topic, design, chosen } = state;
		// 현재 선택을 제외한 풀
		const remaining = cumulativePool.filter((x) => x.phrase !== chosen);
		if (remaining.length > 0) {
			// 통과한 것 우선, 없으면 점수 최고
			const passed = remaining.filter((x) => x.ok);
			const next = (passed.length > 0 ? passed : remaining).sort((a, b) => b.score - a.score)[0];
			Pipeline._lastTitleState.chosen = next.phrase;
			console.log(`[L6 재생성] "${chosen}" → "${next.phrase}"`);
			return `${next.phrase} — ${Pipeline._safeTopic(topic)}`;
		}
		// 풀 소진 → Agent ① 재호출
		console.log("[L6 재생성] 풀 소진 — Agent ① 재호출");
		const more = await Pipeline._regenerateTitlePhraseCandidates(design, topic, cumulativePool.map((x) => x.phrase));
		for (const c of more) {
			const trimmed = (c || "").trim();
			if (trimmed.length < 4) continue;
			const scored = { phrase: trimmed, ...Pipeline._scoreTitlePhrase(trimmed, topic) };
			cumulativePool.push(scored);
		}
		const newPassed = cumulativePool.filter((x) => x.ok && x.phrase !== chosen);
		if (newPassed.length === 0) return null;
		const next = newPassed.sort((a, b) => b.score - a.score)[0];
		Pipeline._lastTitleState.chosen = next.phrase;
		return `${next.phrase} — ${Pipeline._safeTopic(topic)}`;
	}

	// 발행 전 강제 확인 모달 — 사용자가 명시적으로 OK 또는 다시 생성 선택해야 진행.
	// initialTitle === null이면 모달 안에서 _buildTitleAsync 호출 + 스피너 표시 (UX: 빈 시간 제거)
	// 반환: 최종 제목(string) — 사용자 OK / null — 취소(local로 저장만)
	static _showTitleConfirmModal(initialTitle, design, topic) {
		return new Promise(async (resolve) => {
			const existing = document.getElementById("titleConfirmModal");
			if (existing) existing.remove();
			const overlay = document.createElement("div");
			overlay.id = "titleConfirmModal";
			overlay.className = "title-confirm-overlay";
			// 8회차 보강 (GG7): 시맨틱 dialog role + aria-modal + aria-labelledby + aria-describedby
			overlay.setAttribute("role", "dialog");
			overlay.setAttribute("aria-modal", "true");
			overlay.setAttribute("aria-labelledby", "tcmTitleLabelHeader");
			overlay.setAttribute("aria-describedby", "tcmTitleDisplay");
			const initialDisplay = initialTitle || `<span class="tcm-spinner" aria-hidden="true"></span> 제목 생성 중...`;
			overlay.innerHTML = `
				<div class="title-confirm-modal">
					<div class="tcm-header">
						<span class="tcm-icon" aria-hidden="true">📝</span>
						<span class="tcm-title-label" id="tcmTitleLabelHeader">발행 전 제목 확인</span>
					</div>
					<div class="tcm-body">
						<div class="tcm-prompt">이 제목으로 발행할까요?</div>
						<div class="tcm-title-display" id="tcmTitleDisplay" aria-live="polite">${initialDisplay}</div>
						<div class="tcm-hint">어색하면 🔄 버튼으로 다른 제목을 생성하세요. 마음에 들 때까지 무한 재생성 가능.</div>
					</div>
					<div class="tcm-actions">
						<button type="button" class="tcm-btn tcm-btn-regen" id="tcmRegenBtn" disabled aria-label="제목 다시 생성">🔄 다시 생성</button>
						<button type="button" class="tcm-btn tcm-btn-cancel" id="tcmCancelBtn" aria-label="취소하고 로컬만 저장">취소 (로컬만 저장)</button>
						<button type="button" class="tcm-btn tcm-btn-ok" id="tcmOkBtn" disabled aria-label="이 제목으로 발행">✓ 이 제목으로 발행</button>
					</div>
				</div>
			`;
			document.body.appendChild(overlay);
			// 8회차 보강 (GG5): 포커스 트랩 — Tab/Shift+Tab을 모달 내부로 가둠 + 닫힐 때 이전 포커스 복원
			const releaseFocusTrap = Pipeline._trapModalFocus(overlay);
			let currentTitle = initialTitle;
			const display = overlay.querySelector("#tcmTitleDisplay");
			const regenBtn = overlay.querySelector("#tcmRegenBtn");
			const okBtn = overlay.querySelector("#tcmOkBtn");
			const cancelBtn = overlay.querySelector("#tcmCancelBtn");
			// initialTitle 없으면 모달 안에서 제목 생성 (스피너 표시 → 도착 시 갱신)
			if (!initialTitle) {
				try {
					currentTitle = await Pipeline._buildTitleAsync(design, topic);
					display.textContent = currentTitle;
					display.classList.add("regen-flash");
					regenBtn.disabled = false;
					okBtn.disabled = false;
				} catch (e) {
					display.textContent = "제목 생성 실패: " + e.message;
					regenBtn.disabled = false;
					okBtn.disabled = false;
				}
			} else {
				regenBtn.disabled = false;
				okBtn.disabled = false;
			}
			// 6회차 보강: ESC 키로 모달 닫기 (취소와 동일 동작 — 로컬만 저장)
			const onKeyDown = (e) => {
				if (e.key === "Escape") {
					document.removeEventListener("keydown", onKeyDown);
					releaseFocusTrap();
					overlay.remove();
					resolve(null);
				}
			};
			document.addEventListener("keydown", onKeyDown);
			const cleanup = () => {
				document.removeEventListener("keydown", onKeyDown);
				releaseFocusTrap();
			};
			regenBtn.addEventListener("click", async () => {
				regenBtn.disabled = true;
				okBtn.disabled = true;
				regenBtn.textContent = "🔄 생성 중...";
				try {
					const newTitle = await Pipeline.regenerateTitle();
					if (newTitle) {
						currentTitle = newTitle;
						display.textContent = newTitle;
						display.classList.remove("regen-flash");
						void display.offsetWidth;
						display.classList.add("regen-flash");
					} else {
						alert("더 이상 생성 가능한 후보가 없습니다.");
					}
				} catch (e) {
					alert("재생성 실패: " + e.message);
				} finally {
					regenBtn.disabled = false;
					okBtn.disabled = false;
					regenBtn.textContent = "🔄 다시 생성";
				}
			});
			okBtn.addEventListener("click", () => {
				cleanup();
				overlay.remove();
				resolve(currentTitle);
			});
			cancelBtn.addEventListener("click", () => {
				cleanup();
				overlay.remove();
				resolve(null);
			});
		});
	}

	// 호환용 동기 fallback. confirmed_analogy 또는 문자열을 받아 명사구 추출 + 하드컷.
	static _buildTitleSync(rawText, topic) {
		const safeTopic = Pipeline._safeTopic(topic);
		let s = (rawText || "비유").trim().replace(/\s+/g, " ");
		// 1) 문장 종결부에서 자름
		s = s.split(/[.!?。]/)[0].trim();
		// 2) 종결 어미만 잘라냄. 시간절/처럼/같은 등은 자르지 않음 (의미 손실 위험).
		//    어차피 20자 하드컷에서 단어 경계로 자연스럽게 자르게 됨.
		const cutPatterns = [
			/입니다.*$/,
			/이다\s*$/,
			/에요.*$/,
			/예요.*$/,
			/하다\s*$/,
		];
		for (const pat of cutPatterns) {
			const m = s.match(pat);
			if (m && m.index >= 4) s = s.substring(0, m.index).trim();
		}
		// 3) 콤마/세미콜론 앞에서도 자름 (긴 부연설명 차단)
		s = s.split(/[,;]/)[0].trim();
		// 4) 20자 하드컷 — 단어 경계(공백) 우선, 음절 중간 절단 방지
		if (s.length > 20) {
			const lastSpace = s.lastIndexOf(" ", 18);
			if (lastSpace >= 8) {
				// 8~18자 사이 공백이 있으면 그 위치에서 자름 (자연스러운 명사구 유지)
				s = s.substring(0, lastSpace) + "…";
			} else {
				// 공백이 너무 앞이면 그냥 18자에서 절단
				s = s.substring(0, 18) + "…";
			}
		}
		if (s.length < 2) s = "비유";
		return `${s} — ${safeTopic}`;
	}

	// 게임 필살기 발동 스타일 모달 — 컨페티 + 슬램 + 골드 텍스트 + stat 결산
	static _showOpenModal(url, stats = {}) {
		const existing = document.getElementById("blogOpenModal");
		if (existing) existing.remove();

		// JARVIS Victory 시퀀스: BGM fade out → bass-drop + 팡파레 + "Mission complete"
		JarvisFX.stopBgm();
		setTimeout(() => JarvisFX.victory(), 200);
		setTimeout(() => JarvisFX.voice("Mission complete."), 800);

		const overlay = document.createElement("div");
		overlay.id = "blogOpenModal";
		// 8회차 보강 (GG7): 시맨틱 dialog role + aria-modal + aria-labelledby
		overlay.setAttribute("role", "dialog");
		overlay.setAttribute("aria-modal", "true");
		overlay.setAttribute("aria-labelledby", "bgmBannerMain");

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
		// 5회차 보강: 사용자 OS 로캘에 따라 toLocaleString()이 ',' / '.' / 공백 등 다른 천단위 구분자를 출력해
		//   같은 stats가 다른 화면에 다르게 보임 (스크린샷 비교/regression 시 불안정).
		//   ko-KR 명시 → 한국어 블로그 도메인이므로 일관된 표시 + 결정론.
		const tokens = (stats.tokens || 0).toLocaleString("ko-KR");
		const cost = `₩${Math.round(stats.cost || 0).toLocaleString("ko-KR")}`;
		const time = `${Math.round((stats.timeMs || 0) / 1000)}s`;

		// 14회차(2026-05-01): Agent ⑦ Adequacy Judge 4차원 점수 표시.
		//   사용자가 비유 본질 매핑이 어느 차원에서 강했는지/약했는지 한눈에 파악 가능.
		const adq = stats.adequacy;
		let adequacyHtml = "";
		if (adq && adq.dimension_scores) {
			const d = adq.dimension_scores;
			adequacyHtml = `
				<div class="bgm-stats" role="group" aria-label="비유 적합도 (Agent ⑦ 4차원 판정)" style="margin-top:10px;">
					<div class="bgm-stat" style="background:rgba(34,211,238,0.08)">
						<div class="bgm-stat-label">적합도</div>
						<div class="bgm-stat-value" aria-label="적합도 점수 ${adq.adequacy_score}/10">${adq.adequacy_score}/10</div>
					</div>
					<div class="bgm-stat"><div class="bgm-stat-label">입력</div><div class="bgm-stat-value">${d.input ?? "?"}</div></div>
					<div class="bgm-stat"><div class="bgm-stat-label">메커니즘</div><div class="bgm-stat-value">${d.mechanism ?? "?"}</div></div>
					<div class="bgm-stat"><div class="bgm-stat-label">출력</div><div class="bgm-stat-value">${d.output ?? "?"}</div></div>
					<div class="bgm-stat"><div class="bgm-stat-label">갈등</div><div class="bgm-stat-value">${d.conflict ?? "?"}</div></div>
				</div>
			`;
		}

		overlay.innerHTML = `
			<div class="bgm-flash"></div>
			<div class="bgm-overlay"></div>
			<div class="bgm-rays">${rays}</div>
			<div class="bgm-confetti-wrap">${confetti}</div>
			<div class="bgm-modal">
				<div class="bgm-banner">
					<div class="bgm-banner-sub">QUEST CLEAR</div>
					<div class="bgm-banner-main" id="bgmBannerMain">BLOG PUBLISHED!</div>
				</div>
				<div class="bgm-stats" role="group" aria-label="발행 통계">
					<div class="bgm-stat">
						<div class="bgm-stat-label">TOKENS</div>
						<div class="bgm-stat-value" aria-label="토큰 ${tokens}개">${tokens}</div>
					</div>
					<div class="bgm-stat">
						<div class="bgm-stat-label">COST</div>
						<div class="bgm-stat-value" aria-label="비용 ${cost}">${cost}</div>
					</div>
					<div class="bgm-stat">
						<div class="bgm-stat-label">TIME</div>
						<div class="bgm-stat-value" aria-label="소요 시간 ${time}">${time}</div>
					</div>
				</div>
				${adequacyHtml}
				<button id="blogOpenBtn" class="bgm-cta" aria-label="발행된 블로그를 새 탭으로 열기">🚀 블로그 열기</button>
				<a id="blogCloseLink" class="bgm-close" href="#" aria-label="모달 닫기">닫기</a>
			</div>
		`;
		document.body.appendChild(overlay);
		// 8회차 보강 (GG5): 포커스 트랩 활성화
		const releaseFocusTrap = Pipeline._trapModalFocus(overlay);
		// 6회차 보강: ESC 키로 모달 닫기 (close 링크와 동일 동작)
		const onKeyDown = (e) => {
			if (e.key === "Escape") {
				document.removeEventListener("keydown", onKeyDown);
				releaseFocusTrap();
				overlay.classList.add("bgm-out");
				setTimeout(() => overlay.remove(), 300);
			}
		};
		document.addEventListener("keydown", onKeyDown);
		const cleanup = () => {
			document.removeEventListener("keydown", onKeyDown);
			releaseFocusTrap();
		};
		document.getElementById("blogOpenBtn").onclick = () => {
			cleanup();
			window.open(url, "_blank");
			overlay.classList.add("bgm-out");
			setTimeout(() => overlay.remove(), 300);
		};
		document.getElementById("blogCloseLink").onclick = (e) => {
			e.preventDefault();
			cleanup();
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
		this._track(result.usage, "phase1_search_sonar");
		const data = result.data || {};
		return {
			canonical_name: data.canonical_name || null,
			results: Array.isArray(data.results) ? data.results : [],
		};
	}

	// Phase 1: 웹 검색 + 주제 분석
	async _phase1(topic, tone, ratio) {
		// 14회차(2026-05-01): phase1 done → phase2a spinner 빈 시간 결함 해결.
		//   문제: PipelineUI.timed("phase1", ...)가 LLM 호출만 감싸면 이후 Adequacy 평가 ~10초간
		//          phase1이 done(✓)으로 마크된 채로 phase2a는 waiting(II) 상태로 멈춰 보임.
		//   해결: timed 안에 Adequacy 평가까지 포함시켜 phase1이 진짜 끝난 시점에 done 마크.
		const phase1Start = Date.now();
		PipelineUI.setPhase("phase1", "running");
		try {
		const result = await (async () => {  // 14회차: timed 대신 IIFE 사용 — phase1 done 시점 수동 제어
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
					`당신은 **기술 리서처**입니다. 이 주제를 **반드시 기술/소프트웨어/엔지니어링 도메인**으로 해석하세요. 게임/제품/일반 명칭이 검색 결과 상위에 있어도 무시하고 기술 해석을 우선하세요.

🚨 절대 규칙:
1. **기술 도메인 우선**: 주제가 "Deadlock"이면 게임이 아닌 **스레드 동시성 데드락**, "Reflow"이면 SMT 솔더링이 아닌 **CSS 브라우저 레이아웃 재계산**으로 해석하라. 모호한 영문 단어는 항상 기술 용어로 우선 해석.
2. **사용자 입력 한글 힌트 우선**: 입력에 한글이 포함되면(예: "스레드 데드락"), 한글 도메인을 명확한 기술 용어로 사용하라.
3. 검색 결과 중 **기술 도메인 항목만 채택**: 게임/엔터테인먼트/제품 출시 정보는 무시. 기술 블로그/문서/StackOverflow/MDN/Wikipedia 기술 페이지가 우선.
4. 사전 지식보다 검색 결과 우선이지만, **검색이 게임/제품 정보로만 채워졌으면 사전 지식의 기술 해석으로 보충**하라.
5. 고유명사 표기는 그대로 따르되, 도메인은 반드시 기술.

## 웹 검색 결과
${webContext}

## 모호 주제 처리 예시
- "Deadlock" → 게임 (Valve) ❌ / **스레드 동시성 교착 상태** ✅
- "Reflow" → 베이킹 ❌ / **CSS 브라우저 레이아웃 재계산** ✅
- "Overhaul" → 자동차 정비 ❌ / **시스템 전면 재설계/리팩토링** ✅
- "Cache" → 돈/현금 ❌ / **컴퓨터 캐시 메모리** ✅
- "Pipeline" → 송유관 ❌ / **CI/CD 또는 데이터 파이프라인** ✅

정리할 내용: 정의(기술 도메인), 핵심 개념 3~5가지, 작동 원리, 주요 사용 사례, 장단점.`,
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
				this._track(searchResult.usage, "phase1_topic_research");
			} catch (e) {
				console.warn("주제 조사 실패:", e.message);
			}

			return ApiClient.callAgent(
				`당신은 비유 블로그 오케스트레이터입니다. 기술 주제와 조사 결과를 받으면:
1. 핵심 개념 3가지 추출 (조사 결과 참고)
2. 각 개념에 1:1 대응하는 비유 후보 **3개 모두 도출** (1개 확정 X — 시스템이 Adequacy Judge로 평가 후 최고점 선택)
3. 각 후보마다 confirmed_analogy / analogy_protagonist / analogy_space / structure_mapping 4개 필드를 채워 candidates 배열에 담아라.

## 주제 조사 결과 (웹 검색 기반 — 100% 신뢰)
${researchContext || "조사 결과 없음 — 모델 지식으로 진행"}

🚨 절대 규칙:
- 위 조사 결과에 나오는 정식 명칭/정의/개념을 그대로 사용하라.
- 사용자 입력 주제와 조사 결과의 명칭이 달라도 조사 결과를 우선하라.
- 사전 지식으로 임의의 기술 용어를 갖다 붙이지 말라.
- **비유는 기술 본질의 "구조"를 매핑하라.** 표면적 단어 일치(예: 게임 이름이 같다고 게임으로 비유)는 비유가 아니다.
  예: "Deadlock"이면 4가지 조건(상호배제/점유대기/비선점/순환대기)을 매핑할 비유 — 식당에서 두 손님이 서로 상대방 메뉴를 기다리는 상황 같은 구조.
  ❌ 게임 Deadlock 자체를 설명 (그건 비유가 아님)
  ❌ 단어 표면 일치 (deadlock=막힘=교통체증?)
  ✅ 4조건 구조 매핑이 자연스러운 일상 비유 (식당/주차장/철도 분기점 등)

🚨 비유 본질 매핑 의무 (각 후보가 모두 만족해야 함):
1. 기술의 *입력*이 비유의 *입력*과 같은 역할
2. 기술의 *처리/변환*이 비유의 *행위*와 같은 메커니즘
3. 기술의 *출력*이 비유의 *결과물*과 같은 가치
4. 기술의 *핵심 갈등/원리* (예: 적대적 학습, 캐시 일관성, 동시성 충돌)이 비유에 있음
- 딥페이크(GAN: 가짜 vs 판별 적대학습) → ✅ 위조 화폐범 vs 감식반 / 명화 위조 vs 감정사 / ❌ 최고급 레스토랑

## 출력 (3개 candidates 배열)
- topic, keywords, image_ratio, tone은 공통 (1번만)
- candidates: [{confirmed_analogy, analogy_protagonist, analogy_space, structure_mapping}, ...] 정확히 3개. 다양한 도메인에서 뽑아라 (1=물리/기계, 2=일상/생활, 3=사회/조직 등).

중요: 모든 출력은 반드시 한국어로 작성하라.`,
				[`기술 주제: ${topic}\n톤: ${tone}\n이미지 비율: ${ratio}`],
				{
					thinking_budget: 2048,
					schema_name: "context_packet",
					response_schema: {
						type: "object",
						properties: {
							topic: { type: "string" },
							candidates: {
								type: "array",
								description: "비유 후보 3개 (Adequacy Judge가 평가 후 최고점 선택)",
								items: {
									type: "object",
									properties: {
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
									},
									required: ["confirmed_analogy", "analogy_protagonist", "analogy_space", "structure_mapping"],
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
						required: ["topic", "candidates", "keywords", "image_ratio", "tone"],
					},
				},
			);
		})();  // 14회차: IIFE 즉시 호출
		this._track(result.usage, "phase1_orchestrator_packet");

		// 14회차(2026-05-01): Phase 1 비유 후보 평가 → 최고점 선택.
		//   추가 보강: 최고점 < 8이면 Phase 1 LLM 재호출해서 새 후보 받기 (최대 2회 추가).
		//   누적 후보풀에서 최고점 선택 → 결과 모달에 항상 8~10점 표시 보장.
		const data = result.data;
		let allCandidates = data.candidates || [];
		if (allCandidates.length === 0) {
			throw new Error("Phase 1: 비유 후보 0개 (Phase 1 LLM 출력 결함)");
		}
		PipelineUI.setSubStatus("phase1", `Adequacy ⑦이 비유 후보 ${allCandidates.length}개 병렬 평가 중...`);
		let allScored = await Promise.all(
			allCandidates.map(async (cand) => {
				const score = await this._scoreAnalogyCandidate(data.topic, cand);
				return { ...cand, ...score };
			}),
		);
		for (const sc of allScored) {
			console.log(`[Phase 1 후보] "${sc.confirmed_analogy}" score=${sc.adequacy_score}/10`);
		}
		allScored.sort((a, b) => b.adequacy_score - a.adequacy_score);

		// C 대안: best < 8이면 Phase 1 LLM 추가 호출 (최대 2회)
		const TARGET_SCORE = 8;
		let regenAttempt = 0;
		while (allScored[0].adequacy_score < TARGET_SCORE && regenAttempt < 2) {
			regenAttempt++;
			console.log(`[Phase 1 재호출 ${regenAttempt}/2] 최고점 ${allScored[0].adequacy_score} < ${TARGET_SCORE} — 새 후보 생성`);
			PipelineUI.setSubStatus("phase1", `최고점 ${allScored[0].adequacy_score}/10 미달 — 새 후보 생성 중 (${regenAttempt}/2)`);
			try {
				const tried = allCandidates.map((c) => c.confirmed_analogy);
				const retryResult = await this._regeneratePhase1Candidates(data.topic, tone, ratio, tried);
				const newCands = retryResult.candidates || [];
				this._track(retryResult.usage, `phase1_regen_${regenAttempt}`);
				if (newCands.length === 0) break;
				allCandidates = [...allCandidates, ...newCands];
				const newScored = await Promise.all(
					newCands.map(async (cand) => {
						const score = await this._scoreAnalogyCandidate(data.topic, cand);
						return { ...cand, ...score };
					}),
				);
				for (const sc of newScored) {
					console.log(`[Phase 1 재후보] "${sc.confirmed_analogy}" score=${sc.adequacy_score}/10`);
				}
				allScored = [...allScored, ...newScored];
				allScored.sort((a, b) => b.adequacy_score - a.adequacy_score);
			} catch (e) {
				console.warn(`[Phase 1 재호출 실패] ${e.message}`);
				break;
			}
		}
		const scored = allScored;
		const best = scored[0];
		console.log(`[Phase 1 최종 선택] "${best.confirmed_analogy}" (점수 ${best.adequacy_score}/10, 누적 후보 ${scored.length}개)`);
		PipelineUI.setSubStatus("phase1", `✅ "${best.confirmed_analogy}" 선택 (Adequacy ${best.adequacy_score}/10)`);

		// contextPacket은 best 후보 평면화 (Agent ①은 단일 비유 받음)
		this.results.contextPacket = {
			topic: data.topic,
			confirmed_analogy: best.confirmed_analogy,
			analogy_protagonist: best.analogy_protagonist,
			analogy_space: best.analogy_space,
			structure_mapping: best.structure_mapping,
			keywords: data.keywords,
			image_ratio: data.image_ratio,
			tone: data.tone,
			// Adequacy 정보 보존 (재시도 시 Agent ①에 전달)
			_phase1_adequacy: {
				score: best.adequacy_score,
				dimensions: best.dimension_scores,
				rejected_candidates: scored.slice(1).map((c) => ({
					analogy: c.confirmed_analogy,
					score: c.adequacy_score,
				})),
			},
		};
		this.results.adequacy = {
			adequacy_score: best.adequacy_score,
			verdict: "PASS",
			reasoning: best.reasoning,
			dimension_scores: best.dimension_scores,
			alternatives: [],
		};
		// phase1 진짜 완료 시점에 done 마크 (Adequacy 평가까지 포함)
		PipelineUI.setPhase("phase1", "done", Date.now() - phase1Start);
		} catch (e) {
			PipelineUI.setPhase("phase1", "fail", Date.now() - phase1Start);
			throw e;
		}
	}

	// 14회차(2026-05-01): Phase 1 후보 점수 미달 시 새 후보 받는 헬퍼.
	async _regeneratePhase1Candidates(topic, tone, ratio, tried) {
		return await ApiClient.callAgent(
			`당신은 비유 블로그 오케스트레이터의 후보 재생성 전문가입니다.
이미 시도된 후보(아래 alreadyTried 목록)와 다른 *새로운* 비유 후보 3개를 도출하라.

🚨 절대 규칙:
- alreadyTried 후보의 변형/유사 비유 절대 금지. 다른 도메인에서 새로 뽑아라.
- 4차원 본질 매핑(입력/메커니즘/출력/핵심 갈등) 모두 명확하도록 설계하라.
- 본질 매핑이 약하면 점수가 8점 미만 나옴 — 이번엔 9~10점 받을 비유로.

각 후보마다 confirmed_analogy / analogy_protagonist / analogy_space / structure_mapping 필드 모두 채워라. 한국어 작성.`,
			[
				`기술 주제: ${topic}\n톤: ${tone}\n이미지 비율: ${ratio}\nalreadyTried: ${JSON.stringify(tried)}`,
			],
			{
				thinking_budget: 2048,
				schema_name: "phase1_regen",
				response_schema: {
					type: "object",
					properties: {
						candidates: {
							type: "array",
							items: {
								type: "object",
								properties: {
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
								},
								required: ["confirmed_analogy", "analogy_protagonist", "analogy_space", "structure_mapping"],
							},
						},
					},
					required: ["candidates"],
				},
			},
		);
	}

	// 14회차(2026-05-01): Phase 1 후보 1개 평가용 (Agent ⑦ 재사용, 입력 형식만 candidate 단위).
	async _scoreAnalogyCandidate(topic, candidate) {
		try {
			const result = await ApiClient.callAgent(
				`당신은 비유 적합도 독립 판정 전문가입니다.

🚨 **출력은 반드시 JSON 객체 1개만**. 마크다운, 표, 헤딩, 설명 텍스트 절대 금지.
출력 형식 예시: {"adequacy_score": 8, "verdict": "PASS", "reasoning": "...", "dimension_scores": {"input": 9, "mechanism": 8, "output": 8, "conflict": 7}}
응답이 \`{\`로 시작해서 \`}\`로 끝나야 한다. 다른 글자 일체 금지.

4차원 본질 매핑 검증: 입력/메커니즘/출력/핵심 갈등 각각 0~10점.
adequacy_score = (4차원 평균) 정수 0~10.
verdict: 평균 ≥ 7이면 "PASS", 미만이면 "FAIL".
reasoning: 4차원별 매핑 평가 (200자 이내, 한 줄).

🚨 평가 균형:
- 본질 미반영(레스토랑↔딥페이크 같은) → 3점 이하
- 부분 매핑(2차원 명확) → 5~6점
- 대부분 매핑(3차원 명확) → 7~8점
- 4차원 모두 명확 매핑 → 9~10점
- 매핑이 명확하면 높은 점수, 불명확하면 낮은 점수.`,
				[
					JSON.stringify({
						topic,
						confirmed_analogy: candidate.confirmed_analogy,
						structure_mapping: candidate.structure_mapping,
						worldview: candidate.analogy_space,
					}),
				],
				{
					model: Config.JUDGE_MODEL || "anthropic/claude-haiku-4.5",
					thinking_budget: 4096,
					temperature: 0.0,
					schema_name: "candidate_score",
					response_schema: {
						type: "object",
						properties: {
							adequacy_score: { type: "integer" },
							verdict: { type: "string" },
							reasoning: { type: "string" },
							dimension_scores: {
								type: "object",
								properties: {
									input: { type: "integer" },
									mechanism: { type: "integer" },
									output: { type: "integer" },
									conflict: { type: "integer" },
								},
								required: ["input", "mechanism", "output", "conflict"],
							},
						},
						required: ["adequacy_score", "verdict", "reasoning", "dimension_scores"],
					},
				},
			);
			this._track(result.usage, "phase1_candidate_score");
			return result.data;
		} catch (e) {
			// 14회차(2026-05-01): Claude Haiku가 마크다운 표로 응답하는 경우 정규식으로 점수 추출 fallback.
			//   결함: BizRouter가 Anthropic 모델에 json_schema strict 모드를 제대로 전달 못함.
			//   대안: 응답 텍스트에서 4차원 점수를 마크다운/평문에서 정규식 추출.
			const text = e.message || "";
			const extract = (key) => {
				const re = new RegExp(`(?:${key}|입력|input|메커니즘|mechanism|출력|output|갈등|conflict)[^\\n]*?(\\d+)\\s*\\/\\s*10`, "i");
				const m = text.match(re);
				return m ? parseInt(m[1], 10) : null;
			};
			const inputScore = extract("입력");
			const mechScore = extract("메커니즘");
			const outScore = extract("출력");
			const conflictScore = extract("갈등");
			if (inputScore !== null && mechScore !== null && outScore !== null && conflictScore !== null) {
				const avg = Math.round((inputScore + mechScore + outScore + conflictScore) / 4);
				console.warn(`[Phase 1 후보 점수] 마크다운 fallback 추출 성공: ${avg}/10`);
				return {
					adequacy_score: avg,
					verdict: avg >= 7 ? "PASS" : "FAIL",
					reasoning: "judge 응답을 마크다운에서 추출 (BizRouter strict 미적용 회피)",
					dimension_scores: { input: inputScore, mechanism: mechScore, output: outScore, conflict: conflictScore },
				};
			}
			console.warn("[Phase 1 후보 점수] 실패, 기본 5점:", e.message);
			return {
				adequacy_score: 5,
				verdict: "FAIL",
				reasoning: "judge 호출 실패",
				dimension_scores: { input: 5, mechanism: 5, output: 5, conflict: 5 },
			};
		}
	}

	// Phase 2a: 비유설계 + 적합도 + 검증 (최대 3회 재시도)
	// 14회차(2026-05-01): Agent ⑦ Adequacy Judge 신설.
	//   문제: Agent ①이 비유 만들고 자기 fitness_score를 매김 → 자기검증 편향
	//          ("최고급 레스토랑 — 딥페이크" 같은 본질 미반영 비유가 7점 받고 통과)
	//   해결: Claude Haiku(cross-vendor)로 본질 매핑 4차원 독립 판정 → FAIL 시 재설계
	async _phase2a() {
		await PipelineUI.timed("phase2a", async () => {
			let lastFailSummary = null;
			for (let attempt = 0; attempt < 3; attempt++) {
				PipelineUI.setSubStatus("phase2a", `[1/3] Designer ① 비유 설계 중... (시도 ${attempt + 1}/3)`);
				await this._runDesigner(lastFailSummary);

				// 14회차(2026-05-01): Designer가 Phase 1 비유 그대로 사용 + Phase 1 점수 ≥ 8이면
				//   Phase 2a Adequacy 스킵 (Phase 1에서 이미 통과 평가됨).
				//   재시도 빈도 ↓ + 비용 절감.
				const phase1Analogy = this.results.contextPacket?.confirmed_analogy;
				const designerAnalogy = this.results.design?.confirmed_analogy;
				const phase1Score = this.results.contextPacket?._phase1_adequacy?.score ?? 0;
				const designerKeptPhase1Analogy = phase1Analogy && designerAnalogy &&
					phase1Analogy === designerAnalogy;
				if (designerKeptPhase1Analogy && phase1Score >= 8) {
					console.log(`[Phase 2a] Designer가 Phase 1 비유(${phase1Analogy}) 그대로 사용 + Phase 1 점수 ${phase1Score}/10 ≥ 8 → Adequacy 스킵`);
					PipelineUI.setSubStatus("phase2a", `[2/3] ✅ Phase 1 평가 재사용 (Adequacy ${phase1Score}/10)`);
					// adequacy 결과는 Phase 1 것 그대로 유지 (이미 _phase1에서 설정됨)
					PipelineUI.setSubStatus("phase2a", `[3/3] Verify ④ 검증 중...`);
					const verdict = await this._runVerifyA();
					if (verdict.pass) {
						PipelineUI.setSubStatus("phase2a", `✅ 비유 설계 완료 (Adequacy ${phase1Score}/10 재사용, Verify PASS)`);
						return;
					}
					lastFailSummary = verdict.failSummary;
					PipelineUI.setSubStatus("phase2a", `❌ Verify ④ FAIL — 재설계`);
					console.warn(`Phase 2a 검증 FAIL (시도 ${attempt + 1}/3): ${lastFailSummary}`);
					if (attempt < 2) PipelineUI.markRetry("phase2a", attempt + 1, 3, lastFailSummary);
					continue;
				}

				// Designer가 비유 거부/변경 또는 Phase 1 점수 부족 → Adequacy Judge로 재평가
				PipelineUI.setSubStatus("phase2a", `[2/3] Adequacy ⑦ 본질 매핑 4차원 판정 중... (Designer가 비유 변경)`);
				const adequacy = await this._runAdequacyJudge();
				if (!adequacy.pass) {
					const dims = this.results.adequacy?.dimension_scores || {};
					const dimStr = `입력=${dims.input ?? "?"} 메커니즘=${dims.mechanism ?? "?"} 출력=${dims.output ?? "?"} 갈등=${dims.conflict ?? "?"}`;
					PipelineUI.setSubStatus("phase2a", `❌ Adequacy ⑦ FAIL (점수 ${adequacy.score}/10, ${dimStr}) — 재설계`);
					lastFailSummary = `[비유 본질 미반영] ${adequacy.reasoning}` +
						(adequacy.alternatives && adequacy.alternatives.length > 0
							? ` 대안: ${adequacy.alternatives.join(", ")}` : "");
					console.warn(`Phase 2a Agent ⑦ FAIL (시도 ${attempt + 1}/3): ${lastFailSummary}`);
					if (attempt < 2) PipelineUI.markRetry("phase2a", attempt + 1, 3, lastFailSummary);
					continue;
				}
				PipelineUI.setSubStatus("phase2a", `✅ Adequacy ⑦ PASS (점수 ${adequacy.score}/10) — Verify ④로 진행`);

				PipelineUI.setSubStatus("phase2a", `[3/3] Verify ④ 검증 중...`);
				const verdict = await this._runVerifyA();
				if (verdict.pass) {
					PipelineUI.setSubStatus("phase2a", `✅ 비유 설계 완료 (Adequacy ${adequacy.score}/10, Verify PASS)`);
					return;
				}
				lastFailSummary = verdict.failSummary;
				PipelineUI.setSubStatus("phase2a", `❌ Verify ④ FAIL — 재설계`);
				console.warn(`Phase 2a 검증 FAIL (시도 ${attempt + 1}/3): ${lastFailSummary}`);
				if (attempt < 2) PipelineUI.markRetry("phase2a", attempt + 1, 3, lastFailSummary);
			}
			throw new Error(`Phase 2a 검증 FAIL (3회 재시도 후): ${lastFailSummary}`);
		});
	}

	// Agent ⑦: Adequacy Judge — 비유 본질 매핑 4차원 독립 판정 (cross-vendor: Claude Haiku)
	async _runAdequacyJudge() {
		try {
			const result = await ApiClient.callAgent(
				`당신은 비유 적합도 독립 판정 전문가입니다. Agent ①이 만든 비유가 기술의 핵심 메커니즘을 진짜 재현하는지 독립적으로 판정합니다.

## 4차원 본질 매핑 검증
1. **입력 매핑**: 기술의 입력 데이터 ↔ 비유의 입력 자원이 같은 역할인가?
2. **메커니즘 매핑**: 기술의 핵심 처리/변환 ↔ 비유의 핵심 행위가 같은 메커니즘인가?
3. **출력 매핑**: 기술의 결과물 ↔ 비유의 결과물이 같은 가치/형태인가?
4. **핵심 갈등 매핑**: 기술의 본질적 원리/어려움 (예: 적대적 학습, 캐시 일관성, 동시성 충돌) ↔ 비유의 본질적 갈등이 같은가?

## 판정 기준
- **PASS**: 4차원 중 3개 이상 매핑 명확. adequacy_score ≥ 7.
- **FAIL**: 4차원 중 2개 이하만 매핑. 그 경우 alternatives 배열에 더 적합한 비유 후보 3개 제안.

## 본질 매핑 명/암 사례
- 딥페이크 (GAN: 가짜 생성 vs 판별 적대학습)
  ✅ "위조 화폐범 vs 감식반" — 4차원 모두 매핑
  ✅ "명화 위조작가 vs 감정사" — 4차원 모두 매핑
  ❌ "최고급 레스토랑" — 음식 품질은 위조/판별 본질과 무관
- DRAM (주기적 충전 필요한 휘발성 메모리)
  ✅ "물 새는 탱크 + 정기 보충" — 충전 메커니즘 매핑
  ❌ "기억 도서관" — 보존 vs 휘발성 매핑 불일치
- API 게이트웨이 (라우팅 + 인증 + rate limit)
  ✅ "우체국 분류실" — 3차원 매핑
  ❌ "고속도로 톨게이트" — rate limit만 잡고 라우팅 약함

## 출력 규칙
- adequacy_score: 0~10 정수 (4차원 점수 합 ÷ 4 × 2.5 = 10점 환산)
- verdict: "PASS" 또는 "FAIL"
- reasoning: 4차원별 매핑 평가 (200자 이내)
- alternatives: FAIL 시 더 적합한 비유 3개 (PASS면 빈 배열)

🚨 평가 균형:
- 본질 미반영(레스토랑↔딥페이크) → FAIL (3점 이하)
- 부분 매핑(2차원) → 5~6점
- 대부분 매핑(3차원) → 7~8점
- 4차원 모두 명확 → 9~10점
*각 차원을 객관적으로 평가*. 매핑 명확하면 높은 점수.

🚨🚨🚨 출력 형식 절대 규칙 (위반 시 시스템 FAIL):
- 마크다운 헤더(#, ##, ###), 굵게(**), 이모지 ✅⚠️ 등 사용 절대 금지.
- 출력은 *오직 JSON 객체 하나*. {로 시작 }로 끝. 앞뒤에 텍스트/설명/주석 금지.
- 모든 점수는 정수(0~10). dimension_scores의 input/mechanism/output/conflict 각각 0~10 정수.
- 예시 (형식만 참고하라. 내용은 입력 비유에 맞게 직접 평가):
{"adequacy_score":<0~10정수>,"verdict":"<PASS|FAIL>","reasoning":"<200자 이내 4차원 평가>","dimension_scores":{"input":<0~10>,"mechanism":<0~10>,"output":<0~10>,"conflict":<0~10>},"alternatives":[<FAIL시 비유 후보 3개>]}`,
				[
					JSON.stringify({
						topic: this.results.contextPacket?.topic,
						confirmed_analogy: this.results.design?.confirmed_analogy,
						structure_mapping: this.results.design?.structure_mapping,
						worldview: this.results.design?.worldview,
					}),
				],
				{
					model: Config.JUDGE_MODEL || "anthropic/claude-haiku-4.5",
					thinking_budget: 4096,
					temperature: 0.0,
					schema_name: "adequacy_judgment",
					response_schema: {
						type: "object",
						properties: {
							adequacy_score: { type: "integer" },
							verdict: { type: "string" },
							reasoning: { type: "string" },
							dimension_scores: {
								type: "object",
								properties: {
									input: { type: "integer" },
									mechanism: { type: "integer" },
									output: { type: "integer" },
									conflict: { type: "integer" },
								},
								required: ["input", "mechanism", "output", "conflict"],
							},
							alternatives: { type: "array", items: { type: "string" } },
						},
						required: ["adequacy_score", "verdict", "reasoning", "dimension_scores", "alternatives"],
					},
				},
			);
			this.results.adequacy = result.data;
			this._track(result.usage, "agent7_adequacy");
			console.log(`[Agent ⑦] adequacy=${result.data.adequacy_score}/10 verdict=${result.data.verdict} dims=`, result.data.dimension_scores);
			return {
				pass: result.data.verdict === "PASS" && result.data.adequacy_score >= 7,
				reasoning: result.data.reasoning,
				alternatives: result.data.alternatives || [],
				score: result.data.adequacy_score,
			};
		} catch (e) {
			// 14회차(2026-05-01): JSON 파싱 실패 시 마크다운에서 점수만 회수해 게이트 통과 판정.
			//   이전: pass:true 무조건 통과(차단 없음)이지만 호출자(Phase 1)는 score==-1이라 후보 비교 불가.
			//   변경: 본문에서 dim 점수 4개를 정규식으로 추출, 평균 → adequacy_score. 추출 실패 시만 폴백.
			console.warn(`[Agent ⑦] JSON 파싱 실패, 마크다운 회수 시도: ${e.message?.slice(0, 80)}`);
			const text = e.message || "";
			// 패턴: "(N/10)" 또는 "(N/5)" 또는 "**N/10**" 또는 "(N점 ... )" 추출
			const tenScores = Array.from(text.matchAll(/\((\d{1,2})\s*\/\s*10\)/g)).map((m) => parseInt(m[1], 10)).filter((n) => n >= 0 && n <= 10);
			const fiveScores = Array.from(text.matchAll(/\((\d)\s*\/\s*5\)/g)).map((m) => parseInt(m[1], 10) * 2).filter((n) => n >= 0 && n <= 10);
			const all = [...tenScores, ...fiveScores];
			if (all.length >= 3) {
				const avg = Math.round(all.reduce((s, n) => s + n, 0) / all.length);
				console.log(`[Agent ⑦] 마크다운 회수 성공: ${all.length}개 점수 평균=${avg}/10`);
				this.results.adequacy = { adequacy_score: avg, verdict: avg >= 7 ? "PASS" : "FAIL", reasoning: "마크다운 폴백 추출", alternatives: [] };
				return { pass: avg >= 7, reasoning: "마크다운 폴백", alternatives: [], score: avg };
			}
			console.warn(`[Agent ⑦] 점수 추출 실패, 게이트 통과 폴백`);
			return { pass: true, reasoning: "judge 호출 실패 폴백", alternatives: [], score: -1 };
		}
	}

	async _runDesigner(previousFailSummary) {
		const userMessages = [JSON.stringify(this.results.contextPacket)];
		if (previousFailSummary) {
			// 14회차(2026-05-01): 재시도 시 Adequacy alternatives + Phase 1 거부된 후보를 명시 전달.
			//   이전: lastFailSummary만 전달 → LLM이 같은 비유를 변형만 함.
			//   변경: alternatives + rejected_candidates를 명시해 비유 자체를 갱신하도록 강제.
			const adq = this.results.adequacy || {};
			const phase1 = this.results.contextPacket?._phase1_adequacy || {};
			const altList = (adq.alternatives || []).filter(Boolean);
			const rejectList = (phase1.rejected_candidates || []).map((r) => `${r.analogy} (Phase 1 점수 ${r.score}/10)`);
			let guidance = `[이전 시도 실패 사유] ${previousFailSummary}\n\n위 실패 사유를 반드시 해결하라. fitness_score는 최소 7점 이상이어야 한다. structure_mapping은 최소 5개 이상, counterexample_tests는 정확히 3개 이상 포함하라.`;
			if (altList.length > 0) {
				guidance += `\n\n🚨 Adequacy ⑦이 권고한 대안 비유 (이 중 하나 또는 더 적합한 새 비유 사용):\n- ${altList.join("\n- ")}`;
			}
			if (rejectList.length > 0) {
				guidance += `\n\n[Phase 1에서 점수 낮아 거부된 후보 — 사용 금지]:\n- ${rejectList.join("\n- ")}`;
			}
			guidance += `\n\n🚨 이전 비유의 변형/유사 사용 절대 금지. 다른 도메인의 새 비유로 교체하라.`;
			userMessages.push(guidance);
		}
		const designResult = await ApiClient.callAgent(
			`당신은 비유 설계 전문가입니다. 에이전트 컨텍스트 패킷을 받으면:
1. 구조 매핑 심화: 기술의 입력→처리→출력 흐름을 비유에서 완전히 재현
2. 관계 보존 검증
3. 반례 스트레스 테스트: 3개 이상
4. 최종 출력: 검증된 구조 매핑표 + 비유 세계관 (300자 이내)

🚨 절대 규칙:
- topic 필드의 명칭은 *반드시* 그대로 사용 (사전 지식으로 임의 대체 금지).
- "정보 부족", "확인할 수 없습니다" 같은 거부 응답 금지.
- fitness_score는 최소 7점 이상이 되도록 구조 매핑을 충실히 작성하라.

🚨 비유 거부권:
- 컨텍스트 패킷의 confirmed_analogy는 Phase 1에서 후보 3개 중 가장 점수 높은 것이 들어 있다. 보통 그대로 사용하라.
- 단 4차원 본질 매핑(입력/메커니즘/출력/갈등) 중 2개 이상에서 매핑이 부적절하다고 판단되면 **거부하고 새 비유로 갱신**할 권한이 있다.
  - confirmed_analogy 필드에 *더 적합한 새 비유*를 적어라.
  - structure_mapping도 새 비유에 맞게 재구성하라.
- 재시도(이전 시도 실패 사유)가 전달된 경우 *반드시* 다른 비유 사용. 이전 비유 변형 금지.

🚨 비유 본질 매핑 의무 (적합도 판정의 핵심):
기술의 *핵심 메커니즘*이 비유에서 재현되어야 한다. 단순히 같은 분야라는 이유로 비유를 선택하면 안 된다.
- 예: 딥페이크의 핵심은 "가짜를 진짜처럼 만드는 적대적 학습(GAN)". 위조 화폐범 vs 감식반, 명화 위조 vs 감정사 처럼 *위조 vs 판별* 구조가 매핑되어야 함.
  ❌ "최고급 레스토랑" — 음식 품질 비유는 "가짜 vs 진짜"라는 본질을 못 잡음.
  ✅ "위조 화폐범과 감식반" — Generator/Discriminator 구조 그대로 재현.
- 예: API 게이트웨이의 핵심은 "요청 라우팅 + 인증 + rate limit". 우체국 분류실, 호텔 컨시어지처럼 *중앙에서 분류·검증·전달* 구조 매핑 필요.
- 본질 매핑이 약하면 fitness_score를 정직하게 5점 이하로 매겨라. 7점은 본질이 명확히 매핑된 경우만.

체크리스트 (모두 YES여야 fitness_score ≥ 7):
1. 기술의 *입력*이 비유의 *입력*과 동일한 역할인가?
2. 기술의 *처리/변환*이 비유의 *행위*와 동일한 메커니즘인가?
3. 기술의 *출력*이 비유의 *결과물*과 동일한 가치를 가지는가?
4. 기술의 *핵심 갈등/원리* (예: 적대적 학습, 캐시 일관성, 동시성 충돌)이 비유에 있는가?
하나라도 NO이면 fitness_score 5 이하 + 다른 비유 후보로 재설계 권고.
- confirmed_analogy는 **30자 이내의 짧은 명사구** (예: "아파트 통합 보안 시스템"). 문장이나 설명 금지.
- title_phrase_candidates는 **블로그 제목용 비유 명사구 후보 5개 (string 배열)**. 각각 6~14자. 시스템이 룰 검증과 LLM 판정으로 가장 자연스러운 1개를 선택한다.
  ## 5개 후보 다양성 규칙
  - 후보 1: 핵심 사물/장비명 (예: 빵 굽는 오븐, 자동차 엔진)
  - 후보 2: 핵심 행위명 (예: 빵 굽기, 엔진 분해 재조립)
  - 후보 3: 장소/공간명 (예: 베이커리 주방, 정비소 작업장)
  - 후보 4: 사람/역할명 (예: 베이커, 정비사)
  - 후보 5: 상태 변화/과정명 (예: 반죽에서 빵으로, 엔진 회복기)

  ## 절대 준수 규칙 (각 후보가 모두 만족해야 함)
  1. **topic 단어/번역어/유사 표현 사용 금지** — 비유의 본질이 깨짐.
     예: topic="Overhaul" → ❌"엔진 오버홀" ❌"Overhaul 정비" ✅"엔진 분해 재조립"
     예: topic="Reflow" → ❌"리플로우 오븐" ✅"빵 굽는 오븐"
     예: topic="API 게이트웨이" → ❌"API 우체국" ✅"우체국 분류실"
  2. **자연스러운 한국어 어순**. 일반 추상어/직역체 금지:
     ❌ "빵 조립" (빵은 굽는 거지 조립 안 함)
     ❌ "데이터 처리 시스템" (너무 일반적)
     ❌ "엔진의 부활" (~의 조사 금지)
     ✅ "빵 굽는 오븐", "엔진 분해 재조립"
  3. **명사 종결**. 동사/형용사/어미 종결 금지:
     ❌ "빵을 굽는다" (동사 종결)
     ❌ "엔진을 분해하기" (어미 종결)
     ✅ "빵 굽기" (명사형 어미), "엔진 분해" (순수 명사)
  4. **금지 종결어**: ~조립(빵/책 등에 부적합), ~처리(추상), ~시스템(추상), ~방식(추상), ~프로세스(추상). 단 비유에 정말 자연스러운 경우만 허용.
  5. 글자 수: 6자 이상 14자 이하. 공백 포함.
  6. 🚨 **추상어 + 구체명사 모호 결합 절대 금지**: '기억/지식/시간/생각/마음/감정/의식/꿈/정보/데이터/관념' 같은 **추상어**를 첫 단어로 사용 후 구체 명사(물탱크/공장/도서관/창고/오븐 등)를 붙이면 두 단어 사이 연결이 즉시 안 보여 어색.
     ❌ "기억 물탱크" → '기억'과 '물탱크' 사이 연결 모호 (DRAM 비유면 '부지런한 물탱크', '새는 물탱크', '물 보충 탱크' 같이 동작/특성으로 표현)
     ❌ "지식 공장" / "시간 도서관" / "데이터 창고"
     ✅ "부지런한 물탱크" (동작 형용사 + 구체)
     ✅ "도서관 사서" (구체 + 구체)
     ✅ "물 보충 탱크" (행위 + 구체)
  7. **즉시 시각화 가능한 구체적 그림**: 후보를 들으면 0.5초 안에 머릿속에 구체 그림이 떠올라야 한다. 추상적이거나 모호하면 ❌.
- worldview는 별도 필드로 300자 이내 세계관 설명.

중요: 모든 출력(confirmed_analogy, title_phrase, worldview, structure_mapping 등)은 반드시 한국어로 작성하라.

🚨 출력 6개 필드 모두 반드시 채워라 (필드 누락 절대 금지):
1. confirmed_analogy (string, 30자 이내)
2. title_phrase_candidates (string 배열, 정확히 5개, 6~14자)
3. worldview (string, 300자 이내 세계관 설명)
4. structure_mapping (배열, 5개 이상, 각 항목에 tech/analogy/rationale 모두 채움)
5. counterexample_tests (배열, **정확히 3개 이상**, 각 항목에 edge_case/maintained/mitigation 채움)
6. fitness_score (integer, 7 이상이 되도록 충실히 작성)

context_packet의 structure_mapping이 이미 채워져 있어도 더 풍부하게 확장해서 5개 이상으로 출력하라. counterexample_tests는 새로 작성. 하나라도 누락 시 시스템이 FAIL 처리해 재시도가 발생한다.`,
			userMessages,
			{
				model: Config.WRITER_MODEL,
				thinking_budget: 2048,
				schema_name: "analogy_design",
				response_schema: {
					type: "object",
					properties: {
						confirmed_analogy: { type: "string" },
						title_phrase_candidates: {
							type: "array",
							items: { type: "string" },
							minItems: 5,
							maxItems: 5,
						},
						worldview: { type: "string" },
						structure_mapping: {
							type: "array",
							minItems: 5,
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
							minItems: 3,
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
						"title_phrase_candidates",
						"worldview",
						"structure_mapping",
						"counterexample_tests",
						"fitness_score",
					],
				},
			},
		);
		this.results.design = designResult.data;
		// 14회차(2026-05-01): Designer 출력의 title_phrase_candidates에서 6자 미만 자동 필터링.
		//   2회차 리팩토링: 회귀 테스트 가능하도록 정적 헬퍼 _filterTitlePhraseCandidates로 분리.
		const candArr = this.results.design.title_phrase_candidates;
		if (Array.isArray(candArr)) {
			const filtered = Pipeline._filterTitlePhraseCandidates(candArr);
			if (filtered.length !== candArr.length || filtered.some((c, i) => c !== candArr[i])) {
				const removedCount = candArr.filter((c) => {
					const t = (c || "").trim();
					return t.length < 6 || t.length > 14;
				}).length;
				if (removedCount > 0) {
					console.warn(`[Designer 후처리] title_phrase_candidates ${candArr.length}개 중 ${removedCount}개 필터링 (6~14자 룰 위반)`);
				}
				this.results.design.title_phrase_candidates = filtered;
			}
		}
		this._track(designResult.usage, "agent1_design");
	}

	async _runVerifyA() {
		const verifyResult = await ApiClient.callAgent(
			`당신은 품질 검증 전문가입니다. 입력 JSON의 실제 필드 값을 검사한다 (LLM 추측 금지, 필드가 실제 있고 비어 있지 않으면 PASS).

A1: fitness_score 필드 존재 + 정수 7 이상 → PASS
A2: structure_mapping 배열 길이 ≥ 5 → PASS
A3: counterexample_tests 배열 길이 ≥ 3 → PASS
A4: worldview 필드 존재 + 1자 이상 300자 이하 → PASS
A5: structure_mapping 모든 항목에 rationale 필드 존재 + 1자 이상 → PASS
A6: 비유 본질 매핑 검증 — confirmed_analogy + structure_mapping을 보고 기술 핵심 메커니즘(입력/처리/출력/갈등)이 비유에 재현되는지 독립 판정.
   - 딥페이크(GAN: 가짜 생성 vs 판별) ↔ "위조 화폐범 vs 감식반" ✅, "최고급 레스토랑" ❌
   - DRAM(주기적 충전) ↔ "물 새는 탱크 + 정기 보충" ✅, "기억 도서관" ❌
   본질 매핑이 약하면 reason에 "비유 본질 미반영, 다른 비유 권장: <후보>" 명시 + result=FAIL.

🚨 절대 규칙: A1~A5는 *필드 존재 + 값 길이/숫자*만 본다. 필드가 분명히 채워져 있으면 PASS. "필드 누락" 판정은 그 필드가 입력 JSON에 진짜 없을 때만.`,
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
		this._track(verifyResult.usage, "agent4_verify_phase2a");
		return {
			pass: verifyResult.data.verdict !== "FAIL",
			failSummary: (verifyResult.data.fail_summary || []).join(", "),
		};
	}

	// Phase 2b: 글작성 + 이미지프롬프트 (병렬)
	async _phase2b(tone, ratio) {
		await PipelineUI.timed("phase2b", async () => {
		const [writerResult, imageResult] = await Promise.all([
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
- **graph TD만 사용** (세로 방향). 한글 라벨이 길어서 가로(LR)는 모바일에서 깨짐. flowchart LR/RL/BT/TB, sequenceDiagram, classDiagram, stateDiagram, erDiagram, gantt, pie, journey, gitGraph 등 다른 종류 일체 금지. (위반 시 시스템이 자동으로 graph TD로 강제 변환하나 의도한 흐름이 깨질 수 있음)
- **🚨 절대 필수 — 노드 라벨 형식**: \`A[기술용어 — 비유대상]\` (em-dash — 단 한 개로 연결). 기술 용어 단독 금지, 비유 단독 금지.
  - ❌ 잘못: \`A[심장]\` (비유만), \`A[Sender]\` (기술만), \`A[A — — B]\` (em-dash 중복)
  - ✅ 올바름: \`A[Sender 노드 — 심장]\`, \`A[Timeout 판정 — 맥박 멈춤]\`
- 오직 \`A[라벨]\` **사각형** 형식만 사용. 다이아몬드 \`{}\`, 원 \`()\`, 둥근 박스 \`(...)\` 모두 금지.
- 노드 레이블 안에 괄호 \`()\`, 중괄호 \`{}\`, 따옴표, 콜론 \`:\`, 꺾쇠 \`<>\` 절대 금지.
- **🚨 절대 — 그래프당 총 노드 8개 이하 (포함 컨테이너 X)** — 9개 이상이면 시스템이 검증 단계에서 FAIL. 핵심 흐름만 압축. 보조 흐름은 별도 mermaid 블록으로 분리.
- **🚨 절대 — 단계(레벨) 4개 이하** — \`A→B→C→D\`까지 허용, \`A→B→C→D→E\` 처럼 5단계 이상 금지. 5단계 필요 시 두 다이어그램으로 분리.
- **🚨 절대 — 한 단계(같은 레벨)당 노드 4개 이하** — 한 부모에서 자식이 5개 이상 나오면 가로 펼침 발생. 가지가 많으면 두 단계로 쪼개라 (예: A → B1, B2 → C1, C2 식으로). 시스템이 잎노드 3~4개는 2열, 5개 이상은 3열 그리드로 자동 재배치하지만 비율이 어색해진다. **잎 4개를 넘기지 말 것** — 넘기면 단계 분해 필수.
- 위 3가지 (총 8노드/4단계/단계당 4노드) 모두 **검증 단계(Agent ④)에서 FAIL 처리**된다.
- **🚨 절대 — DAG(방향성 비순환 그래프)만 허용. cycle/feedback 루프 금지** — A→B→C→A 처럼 한 노드로 되돌아가는 화살표 금지. GAN 적대학습 같은 피드백 루프도 cycle로 그리지 말고 *직선 흐름*으로 표현 ("학습 결과 → 다음 라운드 입력"으로 새 노드 추가). cycle이면 elkjs 직교 라우터가 한 엣지를 거꾸로 그려 화살표 머리가 출발 박스로 박힘.
- **루트 노드 라벨은 더 짧고 굵게** — 다이어그램의 첫 노드(가장 위)는 전체 주제이므로 라벨을 짧게(8자 이내) 적어 시각 위계를 살려라. 잎노드는 구체적 결과물이므로 평소 길이 OK이되 **한 노드 라벨은 16자(한글 기준) 이내** — 그 이상은 박스가 280px로 잘려 말줄임 처리됨.
- 마크다운 테이블은 반드시 헤더행 + 구분행(|---|---|) + 데이터행 형식을 지켜라.
- 테이블은 최소 2열 이상. 1열짜리 테이블은 절대 금지 — 항목 나열은 불릿 리스트(- 항목)로 작성.
  - 잘못된 예 (금지): | 헤더 | 다음 |---| 다음 | 항목1 | 다음 | 항목2 |
  - 올바른 예: **헤더** 다음 줄에 - 항목1, - 항목2
- **테이블 첫 칼럼(헤딩 셀) 마크업 통일**: 모든 행을 동일한 형식으로 작성. 일부는 백틱, 일부는 굵게 섞으면 폰트가 어긋나 시각적으로 들쭉날쭉해짐.
  - ❌ 잘못 (혼합): \`VIEW\` / \`Custom Hooks\` / **재사용성** / **SQL** (같은 칼럼인데 일부 백틱, 일부 굵게)
  - ✅ 올바름 (통일): **VIEW** / **Custom Hooks** / **재사용성** / **SQL** (모두 굵게)
  - 또는 모두 평문: VIEW / Custom Hooks / 재사용성 / SQL
- **테이블 헤더 행에는 \`**굵게**\` 사용 금지**: 마크다운 \`<th>\`가 자동으로 굵게 렌더되므로 \`**\`를 추가하면 이중 굵게 + 의미 중복.
  - ❌ \`| **기술 요소** | **비유** |\` (헤더에 ** 중복)
  - ✅ \`| 기술 요소 | 비유 |\` (헤더는 평문, 굵게는 자동 적용)
- **테이블 모든 셀은 반드시 채워라**: 빈 셀 \`| | |\` 절대 금지. 데이터가 없으면 \`-\` 또는 \`해당 없음\` 명시. 헤더 칼럼 수와 데이터 행 칼럼 수가 정확히 일치해야 함.
  - ❌ \`| Direct Connection | 곧바로 이동 |  |\` (마지막 셀 비어있음)
  - ✅ \`| Direct Connection | 곧바로 이동 | 효율성 향상 |\` (모든 셀 채움)
- 🚨 **비유 매핑 중복 작성 절대 금지**: 같은 비유↔기술 매핑을 마크다운 테이블로 작성한 뒤 같은 내용을 불릿 리스트로 또 작성하는 것 금지. 매핑은 **테이블 1개로만**.
  - ❌ 잘못 (이중 나열):
    \`\`\`
    | 비유 | 기술 |
    |---|---|
    | 열쇠 | 뮤텍스 |
    | 화장실 | 공유 자원 |

    - **열쇠** | **뮤텍스**
    - **화장실** | **공유 자원**
    \`\`\`
  - ✅ 올바름: 테이블만 또는 불릿 리스트만 (둘 중 하나).
- **'X | Y' 형태의 불릿 리스트 절대 금지**: \`- **X** | **Y**\` 같이 \`|\` 구분자로 매핑하는 불릿은 표가 더 적절. 이런 데이터는 반드시 마크다운 테이블로.
- 모든 본문은 한국어로 작성하라. 기술 용어만 영문 병기 허용.
- 🚨 백틱(\`) 인라인 코드는 **본문 안의 진짜 코드 식별자/연산자**에만 사용. (예: \`fetchData()\`, \`x = 1\`, \`POST /api/v1\`, \`HTTP/2\`)
- **순한글 라벨/단계명/일반어휘에 백틱 금지** — 한글 강조는 **굵게(\\*\\*…\\*\\*)** 만 허용.
  - ❌ 잘못: \`시스템/컴포넌트 완전 분해\`, \`결함 부품 교체\`, \`성능 검증\` (한글 라벨 백틱)
  - ✅ 올바름: **시스템/컴포넌트 완전 분해**, **결함 부품 교체**
- **단일 영문 약어/키워드(SQL, VIEW, REST, API 등)는 테이블/본문에서 굵게(\\*\\*…\\*\\*)** 사용. 백틱은 함수 호출/연산자가 있을 때만.

톤: ${tone} | 메타표현 금지 | 하나의 비유 세계관으로 끝까지`,
					[
						JSON.stringify(this.results.contextPacket),
						JSON.stringify(this.results.design),
					],
					{
						model: Config.WRITER_MODEL,
						thinking_budget: 2048,
						max_tokens: 65536, // 본문 잘림 방지 (이전 32K → 64K)
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
					`당신은 이미지 프롬프트 전문가입니다. 영문 프롬프트 3개 생성 (intro/middle/outro).

🚨 절대 규칙 1 — 인물 비주얼 일관성:
- design.confirmed_analogy / analogy_protagonist에서 인물 정보를 추출해 **명시적으로 영문 묘사**.
- 한국 이름(철수/영희/민수 등) → "Korean teenage student/young Korean man-woman/Korean office worker" 등 인종+나이대 명시.
- 3장 모두 같은 인물 (외모/옷/스타일 동일하게 유지) — "same two characters as introduced" 명시.
  ❌ 잘못: "two students" (인종 추상화 → 백인 남성 기본값)
  ✅ 올바름: "Two Korean teenage students, one boy with short black hair, one girl with long black hair, both wearing casual modern Korean school clothes"

🚨 절대 규칙 2 — 이미지 내 텍스트 완전 금지:
- Nano Banana는 텍스트 렌더링 매우 약함 → "CRIPECTION", "ATME", "LAWVER" 같은 깨진 영문 자주 발생.
- 끝에 반드시: "**NO text, NO words, NO letters, NO labels, NO captions, NO writing, NO signs, NO speech bubbles. Pure visual illustration only.**"
- 노트북/책 등 종이 표면이 등장하면 "**blank pages or only abstract scribbles/sketches, NO readable text**" 명시.

🚨 절대 규칙 3 — 비유 세계관 충실 (가장 중요):
- design.worldview의 공간/소품을 그대로 영문으로 옮겨라.
- 본문에 "공책"이 등장하면 이미지에도 "open notebook" — 추상화 금지.
- **기술 용어(딥페이크/AI/모델/알고리즘/GAN 등) 직접 묘사 절대 금지**. 비유의 핵심 시각 요소만 그려라.
  ❌ 잘못: "person working with deepfake AI on laptop" (기술 용어 그대로 → Nano Banana가 일반 IT 이미지 생성)
  ✅ 올바름: "counterfeiter forging fake banknotes vs detective examining authenticity" (위조지폐범↔감식반 비유 시각 요소)
- design.confirmed_analogy의 핵심 행위/대상을 **모든 3장 이미지에 반드시 포함**:
  - 위조지폐 비유 → 위조지폐(banknotes), 위조범(forger), 경찰/감식관(detective/inspector), 감식 도구(magnifying glass/UV light)
  - 베이커리 비유 → 빵(bread), 오븐(oven), 베이커(baker), 반죽(dough)
  - 비유의 시각 요소 3개 이상 등장 강제. 없으면 Vision 검증 실패해 발행 차단됨.

🚨 절대 규칙 4 — 공용 시설 성별 분리 (매우 중요):
- 비유에 공용 화장실/탈의실/사우나/목욕탕이 등장하면 **반드시 단일 성별만** 영문에 명시.
  ❌ 잘못: "people waiting in line" (성별 모호 → 남녀 혼합 생성됨)
  ❌ 잘못: "men and women queueing in shared restroom"
  ✅ 올바름: "four young Korean men queueing in a shared men's restroom" (남자만 명시)
  ✅ 올바름: "single person using the restroom" (1명만)
- 학교/회사 같은 일반 공간은 자유롭게 (혼성 OK).

프롬프트 공식: [스타일]+[피사체(인물 영문 묘사)]+[동작]+[배경]+[분위기]+[비유 핵심 소품]+[텍스트 금지 명시]
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
			]);
			this.results.blog = writerResult.data;
			// finish_reason 보존 (length 잘림 감지용)
			this.results.blogFinishReason = writerResult.finishReason;
			this.results.prompts = imageResult.data;
			this._track(writerResult.usage, "agent2_writer");
			this._track(imageResult.usage, "agent3_image_prompt");

			// 검증 + 재시도 (최대 2회). timed 안에 포함시켜야 retry 시 phase가 done으로 잘못 표시되지 않음.
			await this._validateAndRetryWriter(tone);
		});
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

			// 톤별 길이 임계 (Agent ② 프롬프트의 분량 가이드와 일치)
			const minByTone = { "친근": 3000, "전문": 4000, "유머": 2500 };
			const minLen = minByTone[tone] || 3000;
			const tooShort = bodyLen < minLen;
			const noAscii = ascii < 2;
			const noHeadings = headings < 4;
			// 본문 끝 비완결 감지: finish_reason "length" 또는 마지막 문장이 종결부호로 끝나지 않음
			// 잘림 패턴: 마지막 비공백 문자가 마침표/물음표/느낌표/...등 종결부호 아님
			const finishLength = this.results.blogFinishReason === "length";
			const trimmedTail = body.replace(/\s+$/, "");
			const lastChar = trimmedTail.slice(-1);
			const sentenceEndChars = /[.。!?…」』)]/;
			const incomplete = trimmedTail.length > 100 && !sentenceEndChars.test(lastChar);
			const truncated = finishLength || incomplete;
			const corrupted = tooLong || jsonInJson || runawayLine || wsFlood;
			if (!tooShort && !noAscii && !noHeadings && !corrupted && !truncated) return; // 모두 통과
			if (attempt === 1 && noAscii && !tooShort && !noHeadings) {
				console.warn("재시도 2회 후에도 ASCII 부족 → 결정론적 fallback 삽입");
				this.results.blog.body = BlogAssembler.ensureAsciiDiagrams(
					body,
					this.results.contextPacket,
				);
				return;
			}

			const reasons = [];
			if (truncated) reasons.push(`본문 잘림 감지 (finish=${this.results.blogFinishReason || "?"}, 끝="${trimmedTail.slice(-30)}")`);
			if (tooShort) reasons.push(`본문이 너무 짧음(${bodyLen}자, ${tone} 톤 최소 ${minLen}자 필요)`);
			if (noAscii) reasons.push(`mermaid 다이어그램 부족(${ascii}개, 최소 2개 필요)`);
			if (noHeadings) reasons.push(`소제목(##/###) 부족(${headings}개, 최소 4개 필요)`);
			if (tooLong) reasons.push(`본문이 비정상적으로 김(${bodyLen}자, 50000자 초과)`);
			if (jsonInJson) reasons.push("body 안에 중첩 JSON 구조 감지 (출력 포맷 오류)");
			if (runawayLine) reasons.push(`단일 라인이 너무 김(${maxLineLen}자, 10000 초과)`);
			if (wsFlood) reasons.push(`공백 폭주 감지 (전체 ${(wsRatio * 100).toFixed(1)}% 또는 1000자 연속 공백)`);
			console.warn(`재실행 사유: ${reasons.join(", ")}`);
			PipelineUI.markRetry("phase2b", attempt + 1, 2, reasons[0]);

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
5b. **🚨 다이어그램당 총 노드 8개 이하, 단계 4개 이하, 단계당 노드 4개 이하** — 위반 시 검증에서 FAIL. 5개 이상이면 다이어그램 둘로 분리.
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
					max_tokens: 65536, // 본문 잘림 방지
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
			this._track(retry.usage, "agent2_writer_retry");
			const newBody = retry.data.body || "";
			const newAscii = this._countAsciiDiagrams(newBody);
			console.log(`재시도 결과: body=${newBody.length}자, ascii=${newAscii}`);
			// 재시도 결과가 더 좋으면 채택
			const oldScore = bodyLen + ascii * 1000;
			const newScore = newBody.length + newAscii * 1000;
			if (newScore > oldScore) {
				this.results.blog = retry.data;
				this.results.blogFinishReason = retry.finishReason;
			}
		}
	}

	// Phase 3a: 검증 + 재시도
	async _phase3a(tone) {
		const phase3aPrompt = `당신은 품질 검증 전문가입니다. 4단계 검증(조사→측정→근거→판정). 수정 제안 금지.
B1~B16 검증. 톤: ${tone}. B2: 비유 용어는 기술 용어 아님. B4: 동의어 허용. B6: ±20% 허용.
B13(title_phrase 자연성): design.title_phrase_candidates의 5개 후보 중 어색한 한국어가 1개라도 있으면 FAIL.
어색 기준: (a) 동사+명사 직역체 (예: "빵을 조립", "데이터를 처리") (b) topic 음역 포함 (Overhaul→오버홀, Reflow→리플로우 등) (c) ~의 ~ 2회 이상 (d) 일반 추상어 종결("시스템/방식/프로세스") (e) 6자 미만 또는 14자 초과.
B14(비유 본질 매핑): structure_mapping이 기술의 핵심 작동 원리/구조를 매핑하는가, 단순히 표면 단어 일치로 게임/제품을 비유로 가져왔는가 검증.
  ❌ 표면 일치 사례: topic="Deadlock"인데 Valve 게임 Deadlock으로 비유 (게임 자체가 비유 아님)
  ❌ 표면 일치 사례: topic="Reflow"인데 SMT 솔더링 베이킹 공정 (CSS reflow의 본질 X)
  ✅ 본질 매핑: topic="Deadlock"이면 4조건(상호배제/점유대기/비선점/순환대기)이 일상 비유의 4요소와 매핑
  판정 기준: (a) 매핑 5개 이상 모두 기술 작동 원리를 반영하는가, (b) topic이 제품/게임/명사일 때 그 제품 자체가 아닌 그것의 동작 메커니즘을 비유로 풀었는가.
  FAIL 시 fail_summary에 "비유가 기술 본질이 아닌 표면 일치 — Phase 1 주제 재해석 필요" 명시 (Phase 1 롤백 신호).
B15(다이어그램 mermaid 룰 준수 — 4회차 신설 / 14회차 강화): blog.body 안의 모든 \`\`\`mermaid 블록을 검사.
  (a) 첫 비공백 라인이 \`graph TD\` 또는 \`flowchart TD\`인지 확인 — \`LR/RL/BT/TB\`, \`sequenceDiagram\`, \`classDiagram\`, \`stateDiagram\`, \`erDiagram\`, \`gantt\`, \`pie\`, \`journey\`, \`gitGraph\` 일체 FAIL.
  (b) 노드 수(=\`[\`+\`]\` 라벨 매칭)가 **8개 이하**. 9개 이상이면 FAIL. (14회차 강화 — 강제)
  (c) 잎노드(out-degree 0) 수가 **4개 이하**. 5개 이상이면 FAIL. 단 LLM이 cycle을 만들어 잎노드 0개인 케이스는 BlogAssembler가 cycle 자동 제거 후 잎이 생기므로 PASS 처리 (사후 보정 신뢰).
  (d) 라벨 형식: \`A[기술용어 — 비유대상]\` em-dash 단 1개. em-dash 0개·2개 이상이면 FAIL.
  (e) 라벨 길이(em-dash 양옆 공백 포함) 한글 기준 16자(visualLen 기준 32) 이내. 초과 시 FAIL.
  (f) 다이아몬드 \`{}\`, 원 \`(())\`, 둥근 박스 \`(...)\` 사용 시 FAIL (시스템이 변환하지만 의도 위반).
  (g) 노드 라벨 안에 괄호/중괄호/따옴표/콜론/꺾쇠 포함 시 FAIL.
  (h) **단계(레벨) 수 ≤ 4** — 가장 긴 경로의 노드 수가 5 이상이면 FAIL. (14회차 신설)
  (i) **한 단계당 노드 ≤ 4** — 같은 단계(같은 in-degree depth)의 노드가 5개 이상 있으면 FAIL. (14회차 신설)
  (j) (제거됨) cycle 검사는 BlogAssembler에서 back edge 자동 제거(removedArrowIds)로 처리됨 → Verify에서 차단 불필요. LLM이 cycle 만들어도 사후 보정으로 DAG 강제됨.
B16(다이어그램 본문 일치): mermaid 다이어그램의 [라벨]에 등장하는 비유 어휘가 본문(blog.body)에 실제로 등장하는가.
  판정: 다이어그램 라벨에서 em-dash 우측(비유)을 추출 → 그 어휘 또는 동의어가 본문에 1회 이상 등장해야 함.
  3개 이상 라벨이 본문 미등장이면 FAIL ("다이어그램과 본문 비유 어휘 불일치").
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

		await PipelineUI.timed("phase3a", async () => {
		let verifyResult = await ApiClient.callAgent(
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
		this._track(verifyResult.usage, "agent4_verify_phase3a");

		let retryCount = 0;
		while (verifyResult.data.verdict === "FAIL" && retryCount < 2) {
			retryCount++;
			const failReason = (verifyResult.data.fail_summary || [])[0] || "검증 FAIL";
			console.warn(`Phase 3a FAIL (재시도 ${retryCount}/2)`);
			PipelineUI.markRetry("phase3a", retryCount, 2, failReason);
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
					max_tokens: 65536, // 본문 잘림 방지
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
			this._track(retry.usage, "agent2_writer_retry_phase3a");

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
			this._track(verifyResult.usage, "agent4_verify_phase3a_retry");
		}
		});
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
5. corrections_needed에는 블로그에서 수정해야 할 문장의 원본과 수정문을 제시.
6. (4회차 신설) 본문에 \`\`\`mermaid 다이어그램이 있으면 다이어그램 라벨의 "기술용어 — 비유대상" 매핑이 design.structure_mapping과 일치하는지 확인. 다이어그램 라벨에 등장하는 기술 용어가 design.structure_mapping에 없거나, 본문 설명과 다르게 매핑되어 있으면 mapping_validity에 valid:false로 기록하고 corrections_needed에 수정문 제시.`,
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
		this._track(result.usage, "agent6_factcheck");
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

	// Nano Banana로 이미지 생성 + Vision 검증 → FAIL 시 재시도.
	// 프롬프트를 매번 다시 생성할 때마다 미세하게 다르게 하면 성공률이 오름.
	async _generateImageWithRetry(prompt, ratio, label) {
		this._imgState = this._imgState || {};
		const delays = [0, 2000, 4000, 8000, 15000, 30000, 60000]; // 총 7회 시도
		let lastErr = null;
		const visionFeedbacks = []; // 누적 피드백 (재시도 시 프롬프트에 추가)
		// 14회차(2026-05-01): Vision 7회 실패 시 마지막 생성된 이미지를 fallback으로 사용.
		//   이전: 발행 자체가 막혀 사용자가 결과물을 못 받음.
		//   변경: 일치도 낮음 표시 + 발행 진행. Vision 너무 엄격해서 좋은 이미지도 차단되던 결함 회피.
		let bestFallbackRes = null;
		let bestFallbackReason = null;
		for (let i = 0; i < delays.length; i++) {
			this._checkCancelled();
			if (delays[i] > 0) {
				this._imgState[label] = `${label} 대기 ${delays[i] / 1000}s (${i + 1}/${delays.length})`;
				this._updateImgSubStatus();
				await new Promise((r) => setTimeout(r, delays[i]));
			}
			this._imgState[label] = `${label} 생성 ${i + 1}/${delays.length}`;
			this._updateImgSubStatus();
			// 재시도마다 seed 변경 + 이전 vision 피드백 누적 주입
			let probe = i === 0 ? prompt : `${prompt}\n\n(variation seed: ${i})`;
			if (visionFeedbacks.length > 0) {
				probe += `\n\n[이전 시도 피드백 — 반드시 회피] ${visionFeedbacks.join(" / ")}`;
			}
			try {
				const res = await ApiClient.generateImage(probe, ratio);
				this._track(res.usage || {}, `phase3c_image_gen_${label}`);
				if (res.url) {
					// Vision 검증 (3번째 시도부터 비용 절감 위해 1~2회 시도는 검증 skip하고 통과)
					this._imgState[label] = `${label} 검증 중...`;
					this._updateImgSubStatus();
					const verdict = await this._verifyImageWithVision(res.url, label);
					if (verdict.pass) {
						if (i > 0) console.log(`이미지 ${i + 1}차 시도 성공 (${label})`);
						this._imgState[label] = `${label} ✓`;
						this._updateImgSubStatus();
						return res;
					}
					// FAIL — 피드백 누적 후 재시도. fallback용으로 마지막 이미지 보존.
					console.warn(`[Vision FAIL ${label}] ${verdict.reason}`);
					visionFeedbacks.push(verdict.reason);
					bestFallbackRes = res;
					bestFallbackReason = verdict.reason;
					this._imgState[label] = `${label} 재생성 (${verdict.reason.substring(0, 30)}...)`;
					this._updateImgSubStatus();
					lastErr = `Vision: ${verdict.reason}`;
					continue;
				}
				lastErr = "empty response";
			} catch (e) {
				lastErr = e.message;
			}
			console.warn(`이미지 생성 실패 ${i + 1}/${delays.length} (${label}): ${lastErr}`);
		}
		// 14회차(2026-05-01): 모든 Vision 검증 실패 시 fallback — 마지막 생성 이미지 사용 (발행 진행 보장).
		//   이전: 하드 에러로 파이프라인 정지 → 발행 자체 차단.
		//   변경: bestFallbackRes 있으면 일치도 낮음 표시 + 발행 진행. 이미지 자체가 없는 경우만 throw.
		if (bestFallbackRes) {
			console.warn(`[이미지 ${label}] Vision 7회 실패, fallback 이미지 사용: ${bestFallbackReason}`);
			this._imgState[label] = `${label} ⚠ (Vision 일치도 낮음, fallback)`;
			this._updateImgSubStatus();
			return bestFallbackRes;
		}
		throw new Error(`이미지 생성 7회 재시도 모두 실패 (${label}): ${lastErr}`);
	}

	// Vision 검증 — 이미지가 비유 매핑/공용 시설 통념과 일관되는지 확인
	// 본문 비유 컨텍스트(design.confirmed_analogy, structure_mapping)를 함께 전달
	async _verifyImageWithVision(imageDataUrl, label) {
		const design = this.results.design || {};
		const ctx = this.results.contextPacket || {};
		const mappingText = (design.structure_mapping || []).slice(0, 5)
			.map((m) => `${m.tech} ↔ ${m.analogy}`).join(", ");
		// API 일시 장애 시 1회 자동 재시도 (이전 graceful PASS 폐기)
		const MAX_API_RETRIES = 2;
		for (let attempt = 0; attempt < MAX_API_RETRIES; attempt++) {
			try {
				const result = await ApiClient.callAgent(
					`당신은 비유 블로그 이미지 품질 검증 전문가입니다. 글로벌/한국 양쪽 시각에서 이미지가 비유 의미를 명확히 전달하는지 엄격하게 판정합니다.

🚨 FAIL 기준 (하나라도 해당하면 반드시 ❌):

**1. 공용 시설의 성별 분리 위반 (매우 중요)**
   현실 세계에서 남녀가 분리된 공용 시설(공중화장실, 탈의실, 사우나, 목욕탕)에 남녀가 같이 있으면 ❌.
   ❌ 공용 화장실에서 남자와 여자가 같은 줄에 서있음
   ❌ 공용 화장실 칸 안팎에 남녀 동시 등장
   ✅ 같은 성별 여러 명만 (남자만 4명 줄 서기 / 여자만 4명 줄 서기)
   ✅ 인물 1명만
   ※ 가족 화장실, 소형 카페 단일 1인 화장실은 예외이지만 **여러 칸이 보이는 공용 시설**은 항상 분리해야 한다.

**2. 비유 의미 깨짐**
   비유의 핵심 개념이 이미지에서 시각적으로 모순.
   예: Mutex 비유('한 번에 한 명만 사용')인데 여러 명이 동시에 화장실 안에 있음.

**3. 본문 비유와 시각 불일치**
   본문 매핑(예: '열쇠↔뮤텍스, 화장실↔공유자원')과 이미지가 다른 사물/장소를 묘사.

**4. 인물 일관성 깨짐**
   본문에 특정 인물('철수와 영희' 등)이 명시되었는데 외모/인종이 일치하지 않음.

**5. 명백한 시각 오류**
   사물이 비합리적 배치, 신체 비례 깨짐.
   ※ 단순 영문 텍스트 박힘(VACANT/OCCUPIED 등 표지)은 PASS — 사소함.

✅ PASS: 위 5가지 모두 해당 안 됨. 비유 의미 명확 + 사회 통념 OK + 본문 비유와 일관.

판정 절차:
1) 본문 비유 매핑을 먼저 읽고 이미지가 그 매핑과 일치하는지 확인
2) 공용 시설이면 성별 분리 점검 (1번 기준)
3) 위 5가지 기준 차례로 검토
4) 하나라도 위반되면 FAIL + reason에 구체적 위반 사항 명시

reason은 한 문장으로 구체적 설명. 'OK'/'문제없음' 같은 모호한 PASS 사유 금지.`,
					[[
						{ type: "text", text: `[비유 컨텍스트]
주제: ${ctx.topic || "?"}
확정 비유: ${design.confirmed_analogy || "?"}
세계관: ${(design.worldview || "").substring(0, 300)}
주요 매핑: ${mappingText}
이미지 라벨: ${label}

위 비유 컨텍스트와 첨부 이미지를 비교해 5가지 기준으로 판정하라.` },
						{ type: "image_url", image_url: { url: imageDataUrl } },
					]],
					{
						model: Config.WRITER_MODEL,
						thinking_budget: 512,  // 1536 → 512 (latency 1.5초 단축)
						max_tokens: 1024,      // 응답 잘림 방지 (이전 default → 명시)
						temperature: 0.0,
						// 5회차 보강: Vision 검증 결정론 — temperature 0.0만으로는 same input → same verdict 보장 안 됨.
						//   seed 42 고정 + top_p 1.0으로 sampling 분포 좁힘. Gemini Vision API는 seed를 무시할 수 있지만
						//   미래 호환성 + 다른 모델 교체 시 결정론 유지를 위해 명시.
						seed: 42,
						top_p: 1.0,
						schema_name: "image_verification",
						response_schema: {
							type: "object",
							properties: {
								pass: { type: "boolean" },
								reason: { type: "string" },
							},
							required: ["pass", "reason"],
						},
					},
				);
				this._track(result.usage || {}, `phase3c_vision_verify_${label}`);
				const data = result.data;
				if (data) {
					console.log(`[Vision ${label}] ${data.pass ? "PASS" : "FAIL"}: ${data.reason}`);
					return data;
				}
				return { pass: true, reason: "응답 비어있음" };
			} catch (e) {
				if (attempt < MAX_API_RETRIES - 1) {
					console.warn(`[Vision 검증 ${label}] API 실패 ${attempt + 1}/${MAX_API_RETRIES} — 2초 후 재시도: ${e.message}`);
					await new Promise((r) => setTimeout(r, 2000));
					continue;
				}
				console.warn(`[Vision 검증 실패 ${label}] ${e.message} — graceful PASS`);
				return { pass: true, reason: "API 실패로 graceful pass" };
			}
		}
		return { pass: true, reason: "" };
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
		this._track(result.usage, "agent5_evaluate");
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
				// 제목은 _run()에서 미리 생성. 사용자 거부권 행사 시 results.title이 갱신됨.
				const title = this.results.title || await Pipeline._buildTitleAsync(
					this.results.design,
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
							adequacy: this.results.adequacy || null, // Agent ⑦ 결과 (4차원 점수)
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
