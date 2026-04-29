// Pipeline.js — 파이프라인 오케스트레이터 (Phase 1~5)
class Pipeline {
	constructor() {
		this.results = {};
		this.totalTokens = 0;
		this.totalCost = 0;
		this.startTime = 0;
	}

	async run() {
		let topic = document.getElementById("topic").value.trim();
		if (!topic) {
			alert("기술 주제를 입력하세요.");
			return;
		}

		// A. 모호 토픽 감지 → 도메인 선택 모달
		const ambiguous = Pipeline._detectAmbiguousTopic(topic);
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
			await this._phase2a();
			await this._phase2b(tone, ratio);
			await this._phase3a(tone);
			await this._phase3b();
			await this._phase3c(ratio);
			await this._phase4();
			// 제목 미리 생성
			this.results.title = await Pipeline._buildTitleAsync(
				this.results.design,
				this.results.contextPacket?.topic,
			);
			// 발행 전 강제 확인 모달 — 사용자 거부권 진짜 100% 회피 보장
			// 모달이 사용자 응답까지 await — '확인' 또는 '🔄 다시 생성' 선택
			if (publishMode !== "local") {
				const finalTitle = await Pipeline._showTitleConfirmModal(this.results.title, this.results.design, this.results.contextPacket?.topic);
				if (finalTitle === null) {
					// 사용자가 취소 (publishMode를 local로 변경)
					publishMode = "local";
				} else {
					this.results.title = finalTitle;
				}
			}
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

	// 결정론적 룰 필터 R1~R7: title_phrase 후보의 어색함을 자동 차단.
	// 반환: { ok: boolean, score: number, reasons: string[] }
	// 이 함수는 룰 기반 평가만. LLM-as-Judge는 별도 호출.
	static _scoreTitlePhrase(phrase, topic) {
		const reasons = [];
		let score = 100;
		if (!phrase || typeof phrase !== "string") return { ok: false, score: 0, reasons: ["빈 문자열"] };
		const p = phrase.trim();
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

	// 모호 토픽 감지 — 일반 용어 짧은 입력은 도메인이 명시되지 않으면 잘못 해석될 수 있음
	// 반환: null (모호 아님) 또는 { word, domains: [{label, value, hint}] }
	static _detectAmbiguousTopic(topic) {
		const t = topic.trim().toLowerCase().replace(/[^a-z가-힣]/g, "");
		// 입력에 도메인 힌트(영문 정식명/한글 도메인)가 이미 있으면 모호 아님
		// 예: "Chrome 확장", "Redis 캐시"는 통과 — 이미 도메인 명시
		if (topic.split(/\s+/).length >= 2 && /[가-힣]/.test(topic) && /[a-zA-Z]/.test(topic)) {
			// 한글+영문 혼합 = 사용자가 명시적으로 도메인 표기한 것으로 간주
			return null;
		}
		// 모호 키워드 사전 (도메인 분기가 큰 일반 용어)
		const ambiguousMap = {
			"플러그인": {
				word: "플러그인",
				domains: [
					{ label: "🌐 브라우저 확장 (Chrome/Firefox)", value: "Chrome 확장 프로그램" },
					{ label: "💻 IDE 확장 (VSCode/IntelliJ)", value: "VSCode 확장 플러그인" },
					{ label: "📝 WordPress 플러그인", value: "WordPress 플러그인" },
					{ label: "🎮 게임 플러그인 (Minecraft 등)", value: "Minecraft 게임 플러그인" },
					{ label: "🎵 VST 오디오 플러그인", value: "VST 오디오 플러그인" },
				],
			},
			"plugin": {
				word: "plugin",
				domains: [
					{ label: "🌐 브라우저 확장", value: "Chrome 확장 프로그램" },
					{ label: "💻 IDE 확장", value: "VSCode 확장 플러그인" },
					{ label: "📝 WordPress 플러그인", value: "WordPress 플러그인" },
				],
			},
			"확장": {
				word: "확장",
				domains: [
					{ label: "🌐 브라우저 확장 (Chrome/Firefox)", value: "Chrome 확장 프로그램" },
					{ label: "💻 IDE 확장 (VSCode/IntelliJ)", value: "VSCode 확장 플러그인" },
				],
			},
			"캐시": {
				word: "캐시",
				domains: [
					{ label: "🖥 CPU 캐시 (L1/L2/L3)", value: "CPU 캐시 메모리" },
					{ label: "📦 Redis 인메모리 캐시", value: "Redis 캐시" },
					{ label: "🌐 브라우저 캐시", value: "브라우저 캐시" },
					{ label: "🔄 CDN 캐시", value: "CDN 캐시" },
				],
			},
			"cache": {
				word: "cache",
				domains: [
					{ label: "🖥 CPU 캐시", value: "CPU 캐시 메모리" },
					{ label: "📦 Redis 인메모리 캐시", value: "Redis 캐시" },
					{ label: "🌐 브라우저 캐시", value: "브라우저 캐시" },
				],
			},
			"큐": {
				word: "큐",
				domains: [
					{ label: "📨 메시지 큐 (RabbitMQ/Kafka)", value: "메시지 큐 (RabbitMQ)" },
					{ label: "🔁 작업 큐 (Job Queue)", value: "작업 큐 (Job Queue)" },
					{ label: "📊 자료구조 큐 (FIFO)", value: "자료구조 큐 FIFO" },
				],
			},
			"queue": {
				word: "queue",
				domains: [
					{ label: "📨 메시지 큐 (RabbitMQ/Kafka)", value: "메시지 큐 RabbitMQ" },
					{ label: "📊 자료구조 큐 (FIFO)", value: "자료구조 큐 FIFO" },
				],
			},
			"reflow": {
				word: "Reflow",
				domains: [
					{ label: "🌐 CSS 브라우저 레이아웃 재계산", value: "CSS 리플로우" },
					{ label: "🔧 SMT 솔더링 공정", value: "SMT 리플로우 솔더링" },
				],
			},
			"deadlock": {
				word: "Deadlock",
				domains: [
					{ label: "🔒 멀티스레드 교착 상태", value: "스레드 데드락" },
					{ label: "🎮 Valve 게임 Deadlock", value: "Valve 게임 Deadlock" },
				],
			},
			"overhaul": {
				word: "Overhaul",
				domains: [
					{ label: "🚗 자동차 엔진 정비", value: "자동차 엔진 오버홀" },
					{ label: "🔄 시스템 전면 재설계", value: "소프트웨어 시스템 오버홀" },
				],
			},
			"pipeline": {
				word: "pipeline",
				domains: [
					{ label: "⚙ CI/CD 빌드 파이프라인", value: "CI/CD 파이프라인" },
					{ label: "📊 데이터 파이프라인", value: "데이터 파이프라인" },
					{ label: "🖥 CPU 명령어 파이프라이닝", value: "CPU 명령어 파이프라인" },
				],
			},
		};
		return ambiguousMap[t] || null;
	}

	// 도메인 선택 모달 — 모호 토픽 감지 시 사용자가 명시적 선택
	static _showDomainPickerModal(originalTopic, ambiguous) {
		return new Promise((resolve) => {
			const existing = document.getElementById("domainPickerModal");
			if (existing) existing.remove();
			const overlay = document.createElement("div");
			overlay.id = "domainPickerModal";
			overlay.className = "title-confirm-overlay";
			overlay.innerHTML = `
				<div class="title-confirm-modal">
					<div class="tcm-header">
						<span class="tcm-icon">🤔</span>
						<span class="tcm-title-label">어느 분야의 "${ambiguous.word}"인가요?</span>
					</div>
					<div class="tcm-body">
						<div class="tcm-prompt">"${originalTopic}"는 여러 분야에서 쓰여요. 의도하신 도메인을 선택해주세요.</div>
						<div class="domain-options">
							${ambiguous.domains.map((d, i) => `
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
			overlay.querySelectorAll(".domain-option").forEach((btn) => {
				btn.addEventListener("click", () => {
					overlay.remove();
					resolve(btn.dataset.value);
				});
			});
			overlay.querySelector("#dpmKeepBtn").addEventListener("click", () => {
				overlay.remove();
				resolve(originalTopic); // 사용자 입력 그대로
			});
			overlay.querySelector("#dpmCancelBtn").addEventListener("click", () => {
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
	// L6 사용자 거부권을 100% 발동시키는 핵심 게이트. 작은 버튼이 아닌 큰 모달로 강제 노출.
	// 반환: 최종 제목(string) — 사용자 OK / null — 취소(local로 저장만)
	static _showTitleConfirmModal(initialTitle, design, topic) {
		return new Promise((resolve) => {
			const existing = document.getElementById("titleConfirmModal");
			if (existing) existing.remove();
			const overlay = document.createElement("div");
			overlay.id = "titleConfirmModal";
			overlay.className = "title-confirm-overlay";
			overlay.innerHTML = `
				<div class="title-confirm-modal">
					<div class="tcm-header">
						<span class="tcm-icon">📝</span>
						<span class="tcm-title-label">발행 전 제목 확인</span>
					</div>
					<div class="tcm-body">
						<div class="tcm-prompt">이 제목으로 발행할까요?</div>
						<div class="tcm-title-display" id="tcmTitleDisplay">${initialTitle}</div>
						<div class="tcm-hint">어색하면 🔄 버튼으로 다른 제목을 생성하세요. 마음에 들 때까지 무한 재생성 가능.</div>
					</div>
					<div class="tcm-actions">
						<button type="button" class="tcm-btn tcm-btn-regen" id="tcmRegenBtn">🔄 다시 생성</button>
						<button type="button" class="tcm-btn tcm-btn-cancel" id="tcmCancelBtn">취소 (로컬만 저장)</button>
						<button type="button" class="tcm-btn tcm-btn-ok" id="tcmOkBtn">✓ 이 제목으로 발행</button>
					</div>
				</div>
			`;
			document.body.appendChild(overlay);
			let currentTitle = initialTitle;
			const display = overlay.querySelector("#tcmTitleDisplay");
			const regenBtn = overlay.querySelector("#tcmRegenBtn");
			const okBtn = overlay.querySelector("#tcmOkBtn");
			const cancelBtn = overlay.querySelector("#tcmCancelBtn");
			regenBtn.addEventListener("click", async () => {
				regenBtn.disabled = true;
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
					regenBtn.textContent = "🔄 다시 생성";
				}
			});
			okBtn.addEventListener("click", () => {
				overlay.remove();
				resolve(currentTitle);
			});
			cancelBtn.addEventListener("click", () => {
				overlay.remove();
				resolve(null); // 취소 → publishMode = local
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
- **비유는 기술 본질의 "구조"를 매핑하라.** 표면적 단어 일치(예: 게임 이름이 같다고 게임으로 비유)는 비유가 아니다.
  예: "Deadlock"이면 4가지 조건(상호배제/점유대기/비선점/순환대기)을 매핑할 비유 — 식당에서 두 손님이 서로 상대방 메뉴를 기다리는 상황 같은 구조.
  ❌ 게임 Deadlock 자체를 설명 (그건 비유가 아님)
  ❌ 단어 표면 일치 (deadlock=막힘=교통체증?)
  ✅ 4조건 구조 매핑이 자연스러운 일상 비유 (식당/주차장/철도 분기점 등)

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
				if (attempt < 2) PipelineUI.markRetry("phase2a", attempt + 1, 3, lastFailSummary);
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

중요: 모든 출력(confirmed_analogy, title_phrase, worldview, structure_mapping 등)은 반드시 한국어로 작성하라.`,
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

🚨 절대 규칙 3 — 비유 세계관 충실:
- design.worldview의 공간/소품을 그대로 영문으로 옮겨라.
- 본문에 "공책"이 등장하면 이미지에도 "open notebook" — 추상화 금지.

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
			this._track(writerResult.usage);
			this._track(imageResult.usage);

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
			this._track(retry.usage);
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
B1~B14 검증. 톤: ${tone}. B2: 비유 용어는 기술 용어 아님. B4: 동의어 허용. B6: ±20% 허용.
B13(title_phrase 자연성): design.title_phrase_candidates의 5개 후보 중 어색한 한국어가 1개라도 있으면 FAIL.
어색 기준: (a) 동사+명사 직역체 (예: "빵을 조립", "데이터를 처리") (b) topic 음역 포함 (Overhaul→오버홀, Reflow→리플로우 등) (c) ~의 ~ 2회 이상 (d) 일반 추상어 종결("시스템/방식/프로세스") (e) 6자 미만 또는 14자 초과.
B14(비유 본질 매핑): structure_mapping이 기술의 핵심 작동 원리/구조를 매핑하는가, 단순히 표면 단어 일치로 게임/제품을 비유로 가져왔는가 검증.
  ❌ 표면 일치 사례: topic="Deadlock"인데 Valve 게임 Deadlock으로 비유 (게임 자체가 비유 아님)
  ❌ 표면 일치 사례: topic="Reflow"인데 SMT 솔더링 베이킹 공정 (CSS reflow의 본질 X)
  ✅ 본질 매핑: topic="Deadlock"이면 4조건(상호배제/점유대기/비선점/순환대기)이 일상 비유의 4요소와 매핑
  판정 기준: (a) 매핑 5개 이상 모두 기술 작동 원리를 반영하는가, (b) topic이 제품/게임/명사일 때 그 제품 자체가 아닌 그것의 동작 메커니즘을 비유로 풀었는가.
  FAIL 시 fail_summary에 "비유가 기술 본질이 아닌 표면 일치 — Phase 1 주제 재해석 필요" 명시 (Phase 1 롤백 신호).
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
		this._track(verifyResult.usage);

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
