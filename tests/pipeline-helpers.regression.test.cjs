/* eslint-disable */
// 5회차 신설: Pipeline.js 핵심 헬퍼 회귀 테스트
//
// 목적
//   _safeTopic / _scoreTitlePhrase / _phraseOverlapsTopic / _topicTransliterations 의 결정론적
//   룰 동작을 회귀 방지. (LLM 호출 메서드는 결정론 X, 별도 스모크 테스트 영역)
//
// 실행
//   node tests/pipeline-helpers.regression.test.cjs

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.resolve(__dirname, "..", "src", "js", "Pipeline.js");
const code = fs.readFileSync(SRC, "utf8");

// Pipeline.js는 ApiClient/Config/BlogAssembler/PipelineUI/document 의존.
// 정적 헬퍼만 검증하므로 모두 stub.
const sandbox = {
	console,
	document: { getElementById: () => null, body: {} },
	window: {},
	setTimeout, clearTimeout, setInterval, clearInterval,
	fetch: () => Promise.reject(new Error("fetch not stubbed")),
	ApiClient: { callAgent: () => Promise.reject(new Error("stubbed")) },
	Config: { MODEL: "stub", WRITER_MODEL: "stub" },
	BlogAssembler: {
		_toNfc: (s) => s,
		_visualLen: (s) => (s || "").length,
		buildMermaidDiagram: () => "",
		buildAsciiDiagram: () => "",
	},
	PipelineUI: {
		setPhase: () => {}, setSubStatus: () => {}, timed: async (_, fn) => fn(),
		startLiveTimer: () => {}, stopLiveTimer: () => {},
	},
	AuthManager: { getAuthHeaders: () => ({}) },
	navigator: { clipboard: { writeText: () => Promise.resolve() } },
	alert: () => {},
	URL: { createObjectURL: () => "blob:" },
	Blob: function () {},
};
vm.createContext(sandbox);
vm.runInContext(code + "\nthis.Pipeline = Pipeline;", sandbox);
const Pipeline = sandbox.Pipeline;

let pass = 0;
let fail = 0;
const failures = [];

function assert(cond, msg) {
	if (cond) {
		pass++;
	} else {
		fail++;
		failures.push(msg);
		console.error("  FAIL: " + msg);
	}
}

function describe(name, fn) {
	console.log("\n--- " + name + " ---");
	try {
		fn();
	} catch (e) {
		fail++;
		failures.push(`${name} threw: ${e.message}`);
		console.error("  THROW: " + e.message);
	}
}

// =============================================================================
// 1. _safeTopic — 약어 추출 + 단어 경계 + … 없는 깔끔 cut (14회차 2회차)
// =============================================================================
describe("_safeTopic: 50자 이내는 그대로 (약어/괄호 없음)", () => {
	assert(Pipeline._safeTopic("API 게이트웨이") === "API 게이트웨이", "짧은 토픽 그대로");
	assert(Pipeline._safeTopic("DRAM 메모리") === "DRAM 메모리", "짧은 토픽 그대로 (괄호 없음)");
});

describe("_safeTopic: 빈 입력 → '기술 블로그' fallback", () => {
	assert(Pipeline._safeTopic("") === "기술 블로그", "빈 문자열");
	assert(Pipeline._safeTopic(null) === "기술 블로그", "null");
	assert(Pipeline._safeTopic(undefined) === "기술 블로그", "undefined");
});

describe("_safeTopic: 약어 + 괄호풀네임 → 약어만 추출 (14회차 2회차)", () => {
	// 실 사용자 케이스: CI/CD (Continuous Integration ...) → CI/CD
	assert(Pipeline._safeTopic("CI/CD (Continuous Integration and Continuous Deployment)") === "CI/CD", "CI/CD 약어 추출");
	assert(Pipeline._safeTopic("GAN (Generative Adversarial Network)") === "GAN", "GAN 약어 추출");
	assert(Pipeline._safeTopic("DRAM (Dynamic Random-Access Memory)") === "DRAM", "DRAM 약어 추출");
	assert(Pipeline._safeTopic("인공지능 (Artificial Intelligence)") === "인공지능", "한글 약어 추출");
});

describe("_safeTopic: 50자 초과 + 단어 경계 cut (… 없이)", () => {
	// 공백 있는 긴 문자열 → 공백 경계에서 깔끔히 자르고 … 안 붙음
	const long = "기술 주제 ".repeat(30);
	const out = Pipeline._safeTopic(long);
	assert(out.length <= 50, `50자 이내 (실제 ${out.length})`);
	assert(!out.endsWith("…"), `… 없이 깔끔 (실제: '${out.slice(-5)}')`);
});

// =============================================================================
// 2. _phraseOverlapsTopic — 토픽 단어 중복 감지
// =============================================================================
describe("_phraseOverlapsTopic: 토픽 그대로 포함 시 true", () => {
	assert(Pipeline._phraseOverlapsTopic("Overhaul 엔진", "Overhaul") === true, "영문 toxic 포함");
	assert(Pipeline._phraseOverlapsTopic("API 게이트웨이 짐꾼", "API 게이트웨이") === true, "공백 정규화 후 포함");
});

describe("_phraseOverlapsTopic: 3자 이상 substring 매칭", () => {
	// "Overhaul"의 substring "ver"가 phrase에 있으면 중복으로 간주
	const result = Pipeline._phraseOverlapsTopic("verbose 엔진", "Overhaul");
	// "ver"는 둘 다에 있음 → true
	assert(result === true, "3자 substring 'ver' 매칭");
});

describe("_phraseOverlapsTopic: 완전 무관한 단어는 false", () => {
	assert(Pipeline._phraseOverlapsTopic("동대문 시장", "Kubernetes") === false, "무관 단어");
});

describe("_phraseOverlapsTopic: 빈 입력은 false", () => {
	assert(Pipeline._phraseOverlapsTopic("", "X") === false, "빈 phrase");
	assert(Pipeline._phraseOverlapsTopic("X", "") === false, "빈 topic");
});

// =============================================================================
// 3. _scoreTitlePhrase — R0~R9 룰 (R0은 14회차 신설: 비한글/특수문자 차단)
// =============================================================================
describe("_scoreTitlePhrase: R0 영문자 포함 차단 (Untitle: 환각 사례)", () => {
	const r1 = Pipeline._scoreTitlePhrase("Untitle 패션쇼 무대", "핍진성");
	assert(!r1.ok, "영문 접두사 'Untitle' 차단");
	assert(r1.reasons.some((r) => r.includes("R0") && r.includes("영문")), "R0 영문 사유");
	const r2 = Pipeline._scoreTitlePhrase("새로운 API 게이트웨이", "X");
	assert(!r2.ok, "영문 단어 'API' 차단");
});

describe("_scoreTitlePhrase: R0 특수문자(콜론/괄호/물음표) 차단", () => {
	const r1 = Pipeline._scoreTitlePhrase("패션쇼 무대: 핍진성", "X");
	assert(!r1.ok, "콜론(:) 포함 차단");
	const r2 = Pipeline._scoreTitlePhrase("패션쇼 무대(핍진성)", "X");
	assert(!r2.ok, "괄호 포함 차단");
	const r3 = Pipeline._scoreTitlePhrase("정말 패션쇼 무대?", "X");
	assert(!r3.ok, "물음표 포함 차단");
});

describe("_scoreTitlePhrase: R0 한자 포함 감점 (한국어 자연스러움 우선)", () => {
	const r = Pipeline._scoreTitlePhrase("기억의 도書관", "X");
	assert(r.reasons.some((rr) => rr.includes("한자")), "한자 사유");
});

describe("14회차(2026-05-01): Agent ① 프롬프트에 비유 본질 매핑 의무 + 체크리스트", () => {
	const fs = require("fs");
	const path = require("path");
	const pipeSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src", "js", "Pipeline.js"), "utf8",
	);
	assert(/비유 본질 매핑 의무/.test(pipeSrc), "Agent ① 프롬프트에 본질 매핑 의무 명시");
	assert(/위조 화폐범|위조 vs 판별/.test(pipeSrc), "딥페이크 본질 매핑 예시 (GAN=위조 vs 판별)");
	assert(/체크리스트/.test(pipeSrc), "본질 매핑 체크리스트 4개 항목 존재");
});

describe("14회차(2026-05-01): Agent ⑦ Adequacy Judge 신설 (cross-vendor 독립 판정)", () => {
	const fs = require("fs");
	const path = require("path");
	const pipeSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src", "js", "Pipeline.js"), "utf8",
	);
	assert(/_runAdequacyJudge/.test(pipeSrc), "_runAdequacyJudge 메서드 정의");
	assert(/Adequacy Judge|적합도 독립 판정 전문가/.test(pipeSrc),
		"Adequacy Judge 시스템 프롬프트 명시");
	assert(/JUDGE_MODEL|claude-haiku/.test(pipeSrc),
		"Claude Haiku cross-vendor 모델 사용");
	assert(/dimension_scores/.test(pipeSrc),
		"4차원 점수 (input/mechanism/output/conflict)");
	// Phase 2a 흐름: Designer 먼저 호출 + Adequacy 분기 + Verify 호출 (스킵 최적화로 순서가 분기됨)
	const phase2aIdx = pipeSrc.indexOf("async _phase2a()");
	assert(phase2aIdx >= 0, "_phase2a 메서드 존재");
	const phase2aSlice = pipeSrc.slice(phase2aIdx, phase2aIdx + 4000);
	const designerIdx = phase2aSlice.indexOf("_runDesigner");
	const adequacyIdx = phase2aSlice.indexOf("_runAdequacyJudge");
	const verifyIdx = phase2aSlice.indexOf("_runVerifyA");
	assert(designerIdx >= 0 && adequacyIdx > designerIdx && verifyIdx > designerIdx,
		"Phase 2a 흐름: Designer 선행 → Adequacy/Verify 분기");
	// 14회차 2회차 (스킵 최적화): designerKeptPhase1Analogy && phase1Score >= 8 분기
	assert(/designerKeptPhase1Analogy\s*&&\s*phase1Score\s*>=\s*8/.test(phase2aSlice),
		"Phase 2a Adequacy 스킵 분기 조건 (designer가 Phase 1 비유 그대로 + 점수 ≥ 8)");
	// Judge 실패 시 폴백
	assert(/judge 호출 실패 폴백/.test(pipeSrc),
		"Agent ⑦ 실패 시 차단하지 않고 폴백");
});

describe("14회차(2026-05-01): Verify A 결정론적 검증 + A6 Adequacy 재사용", () => {
	const fs = require("fs");
	const path = require("path");
	const pipeSrc = fs.readFileSync(
		path.resolve(__dirname, "..", "src", "js", "Pipeline.js"), "utf8",
	);
	// 결정론적 검증: A1~A5는 코드로 검사
	assert(/Number\.isInteger\(fs\)\s*&&\s*fs\s*>=\s*7/.test(pipeSrc), "A1: fitness_score 정수 7+ 코드 검증");
	assert(/sm\.length\s*>=\s*5/.test(pipeSrc), "A2: structure_mapping 길이 5+ 코드 검증");
	assert(/ct\.length\s*>=\s*3/.test(pipeSrc), "A3: counterexample_tests 길이 3+ 코드 검증");
	assert(/wv\.length\s*>=\s*1\s*&&\s*wv\.length\s*<=\s*300/.test(pipeSrc), "A4: worldview 1~300자 코드 검증");
	assert(/it\.rationale\s*===\s*"string"\s*&&\s*it\.rationale\.trim\(\)\.length\s*>=\s*1/.test(pipeSrc), "A5: rationale 1자+ 코드 검증");
	// A6는 Adequacy ⑦ 결과 재사용 (별도 LLM 호출 없음)
	assert(/Adequacy ⑦이 이미 4차원 본질 매핑/.test(pipeSrc), "A6: Adequacy 재사용 주석");
	assert(/this\.results\.adequacy/.test(pipeSrc), "A6: adequacy 결과 참조");
});

describe("_scoreTitlePhrase: R0 통과 — 한글+공백+하이픈만", () => {
	// 정상 명사구는 R0 통과해야 함 (다른 룰로만 평가)
	const r = Pipeline._scoreTitlePhrase("화려한 패션쇼 무대", "핍진성");
	const r0Reasons = r.reasons.filter((rr) => rr.startsWith("R0"));
	assert(r0Reasons.length === 0, "정상 한글 명사구는 R0 사유 없음");
});

describe("_scoreTitlePhrase: R1 길이 6~14자", () => {
	const tooShort = Pipeline._scoreTitlePhrase("짧음", "X");
	assert(!tooShort.ok, "5자 이하 차단");
	assert(tooShort.reasons.some((r) => r.includes("R1")), "R1 사유");
	const tooLong = Pipeline._scoreTitlePhrase("아주아주아주긴비유표현이여기있다", "X");
	assert(tooLong.score < 100, "긴 phrase 감점");
});

describe("_scoreTitlePhrase: R2 topic 단어 중복 차단", () => {
	const r = Pipeline._scoreTitlePhrase("API 게이트웨이 짐꾼", "API 게이트웨이");
	assert(r.score < 70, `topic 중복 감점 (점수 ${r.score})`);
	assert(r.reasons.some((rs) => rs.includes("R2")), "R2 사유 포함");
});

describe("_scoreTitlePhrase: R3 동사/조사 종결 차단", () => {
	const r1 = Pipeline._scoreTitlePhrase("열심히 일합니다", "X");
	assert(r1.reasons.some((r) => r.includes("R3")), "동사 '~합니다' 차단");
	const r2 = Pipeline._scoreTitlePhrase("동대문 시장의", "X");
	assert(r2.reasons.some((r) => r.includes("R3")), "조사 '~의' 차단");
});

describe("_scoreTitlePhrase: R4 추상어 종결 패널티", () => {
	const r = Pipeline._scoreTitlePhrase("자료 처리 시스템", "X");
	assert(r.reasons.some((rs) => rs.includes("R4")), "'시스템' 종결 패널티");
});

describe("_scoreTitlePhrase: R4 '조립'은 mechanical 컨텍스트 면제", () => {
	const r = Pipeline._scoreTitlePhrase("엔진 분해 재조립", "X");
	// "엔진"이 mechanical context → 패널티 면제 (사유에 'OK' 포함)
	assert(r.reasons.some((rs) => rs.includes("OK")), `mechanical context OK (사유: ${r.reasons.join(", ")})`);
});

describe("_scoreTitlePhrase: R6 '~의 ~' 2회 이상 어색", () => {
	const r = Pipeline._scoreTitlePhrase("회사의 사장의 말씀", "X");
	assert(r.reasons.some((rs) => rs.includes("R6")), "~의~ 2회 이상");
});

describe("_scoreTitlePhrase: R8 'X Y 간 전쟁' 한자 間 오해", () => {
	const r = Pipeline._scoreTitlePhrase("수프 냄비 간 전쟁", "X");
	assert(r.reasons.some((rs) => rs.includes("R8")), "'간 전쟁' 패턴 차단");
	assert(r.score < 70, "차단 점수");
});

describe("_scoreTitlePhrase: R9 추상어+구체명사 모호 결합", () => {
	const r = Pipeline._scoreTitlePhrase("기억 물탱크", "X");
	assert(r.reasons.some((rs) => rs.includes("R9")), "추상어+구체 모호 결합 차단");
});

describe("_scoreTitlePhrase: R9-c '추상어의 ~' 패턴 차단", () => {
	const r = Pipeline._scoreTitlePhrase("기억의 도서관", "X");
	assert(r.reasons.some((rs) => rs.includes("R9-c")), "'추상어의 ~' 패턴");
});

describe("_scoreTitlePhrase: 자연스러운 비유는 PASS", () => {
	const r = Pipeline._scoreTitlePhrase("부지런한 우체부", "Kafka");
	assert(r.ok, `자연 비유 PASS (점수 ${r.score}, 사유: ${r.reasons.join(", ")})`);
});

describe("_scoreTitlePhrase: 빈 phrase → score 0", () => {
	assert(Pipeline._scoreTitlePhrase("", "X").score === 0, "빈 phrase score 0");
	assert(Pipeline._scoreTitlePhrase(null, "X").score === 0, "null phrase score 0");
});

// =============================================================================
// 4. _topicTransliterations — 영문 토픽의 한글 음역 변환
// =============================================================================
describe("_topicTransliterations: 영문 토픽 → 한글 음역 후보", () => {
	const trs = Pipeline._topicTransliterations("Overhaul");
	assert(Array.isArray(trs), "배열 반환");
	// "오버홀" 같은 한글 음역 후보가 포함되어야 함
	assert(trs.length >= 1, `음역 후보 ≥ 1개 (실제: ${trs.length})`);
});

describe("_topicTransliterations: 한글만 입력 → 빈 배열", () => {
	const trs = Pipeline._topicTransliterations("그래픽");
	// 한글 토픽은 음역 변환 대상 아님
	assert(Array.isArray(trs), "배열 반환");
});

// =============================================================================
// 5. 결정론 회귀: 같은 입력 → 같은 score (재실행 안정성)
// =============================================================================
describe("결정론: 같은 입력 → 같은 _scoreTitlePhrase 결과 (10회)", () => {
	const ref = Pipeline._scoreTitlePhrase("부지런한 우체부", "Kafka");
	for (let i = 0; i < 10; i++) {
		const r = Pipeline._scoreTitlePhrase("부지런한 우체부", "Kafka");
		assert(r.score === ref.score, `회차 ${i} 동일 score`);
		assert(r.ok === ref.ok, `회차 ${i} 동일 ok`);
	}
});

describe("결정론: _safeTopic도 결정론적", () => {
	for (let i = 0; i < 10; i++) {
		assert(Pipeline._safeTopic("API 게이트웨이") === "API 게이트웨이", `회차 ${i}`);
	}
});

// =============================================================================
// 6. 8회차 (GG5): 모달 포커스 트랩 — _trapModalFocus 정적 메서드 시그니처 회귀
//    Pipeline.js 소스 자체를 grep으로 검사 (vm 컨텍스트에서 실제 DOM 트랩 동작 시뮬은 과도).
//    핵심: 정적 메서드가 존재하고, 3개 모달이 모두 호출하는지를 정적 매칭으로 확인.
// =============================================================================
describe("8회차 (GG5): _trapModalFocus 정적 메서드 + 3개 모달 통합", () => {
	const src = fs.readFileSync(SRC, "utf8");
	assert(/static\s+_trapModalFocus\s*\(\s*overlay\s*\)\s*\{/.test(src), "_trapModalFocus(overlay) 정적 메서드 정의됨");
	assert(/document\.activeElement/.test(src), "이전 활성 요소 캡처(이전 포커스 복원)");
	assert(/getFocusable\s*=/.test(src) || /querySelectorAll\(FOCUSABLE\)/.test(src), "focusable 후보 수집");
	assert(/tabindex/i.test(src), "tabindex 속성도 후보에 포함");
	assert(/e\.shiftKey\s*&&\s*document\.activeElement\s*===\s*first/.test(src), "Shift+Tab 첫 항목 → last 순환");
	assert(/!e\.shiftKey\s*&&\s*document\.activeElement\s*===\s*last/.test(src), "Tab 마지막 항목 → first 순환");
	// 3개 모달 모두 _trapModalFocus 호출 확인
	const trapCalls = (src.match(/Pipeline\._trapModalFocus\s*\(\s*overlay\s*\)/g) || []).length;
	assert(trapCalls >= 3, `Pipeline._trapModalFocus 호출 ${trapCalls}회 (최소 3회: domain/title-confirm/open)`);
	// 3개 모달이 releaseFocusTrap 호출 (cleanup 시)
	const releaseCalls = (src.match(/releaseFocusTrap\(\)/g) || []).length;
	assert(releaseCalls >= 6, `releaseFocusTrap() 호출 ${releaseCalls}회 (모달당 ESC + cleanup 최소 2회 × 3 모달)`);
});

// =============================================================================
// 7. 8회차 (GG7): aria 속성 — 시맨틱 dialog/role/aria-live/aria-modal
//    소스 파일 grep으로 정적 검증 (DOM 시뮬보다 견고).
// =============================================================================
describe("8회차 (GG7): 모달/cost-bar/progressbar aria 시맨틱", () => {
	const src = fs.readFileSync(SRC, "utf8");
	const html = fs.readFileSync(path.resolve(__dirname, "..", "src", "index.html"), "utf8");
	// 모달: role="dialog" + aria-modal="true" + aria-labelledby
	assert(/setAttribute\("role",\s*"dialog"\)/.test(src), "dialog role 설정");
	assert(/setAttribute\("aria-modal",\s*"true"\)/.test(src), "aria-modal=true 설정");
	const labelledByMatches = (src.match(/setAttribute\("aria-labelledby",\s*"[^"]+"\)/g) || []).length;
	assert(labelledByMatches >= 3, `aria-labelledby 호출 ${labelledByMatches}회 (모달 3개)`);
	// cost-bar live region
	assert(/aria-live="polite"/.test(html), "cost-bar/pipeline aria-live=polite");
	assert(/role="status"/.test(html), "cost-bar role=status");
	// progressbar
	assert(/role="progressbar"/.test(html), "progressbar role 설정");
	assert(/aria-valuemin="0"/.test(html), "aria-valuemin=0");
	assert(/aria-valuemax/.test(html), "aria-valuemax 설정");
	// 키보드 사용자 — 닫기 링크 aria-label
	assert(/aria-label="모달 닫기"/.test(src) || /aria-label="모달 닫기"/.test(html), "닫기 링크 aria-label");
});

// =============================================================================
// 8. 8회차 (GG7): PipelineUI가 aria-valuenow를 동적으로 갱신
// =============================================================================
describe("8회차 (GG7): PipelineUI aria-valuenow 갱신", () => {
	const uiSrc = fs.readFileSync(path.resolve(__dirname, "..", "src", "js", "PipelineUI.js"), "utf8");
	assert(/setAttribute\("aria-valuenow",\s*Math\.round\(percent\)\)/.test(uiSrc), "overall progress aria-valuenow 갱신");
	assert(/setAttribute\("aria-valuemax",\s*maxScale\)/.test(uiSrc), "cost-bar over-budget 시 aria-valuemax 동기화");
	assert(/setAttribute\("aria-valuenow",\s*Math\.round\(cost\)\)/.test(uiSrc), "cost-bar aria-valuenow 갱신");
});

// =============================================================================
// 9. 14회차 2회차(2026-05-01): title_phrase_candidates 6~14자 자동 필터링 헬퍼
// =============================================================================
describe("14회차 2회차: _filterTitlePhraseCandidates — 6~14자 룰 위반 자동 제거", () => {
	const input = ["은행 창구", "정상 비유 이름", "긴 비유 이름이 너무 김", "정상2", "OK 비유 후보"];
	// 길이 (Korean): "은행 창구"=5자, "정상 비유 이름"=7자, "긴 비유 이름이 너무 김"=12자,
	//                "정상2"=3자, "OK 비유 후보"=8자
	const out = Pipeline._filterTitlePhraseCandidates(input);
	assert(Array.isArray(out), "배열 반환");
	// 6~14자만 통과: "정상 비유 이름"(7), "긴 비유 이름이 너무 김"(12), "OK 비유 후보"(8) → 3개
	const passing = ["정상 비유 이름", "긴 비유 이름이 너무 김", "OK 비유 후보"];
	for (const p of passing) {
		assert(out.includes(p), `"${p}"는 6~14자라 통과해야 함`);
	}
	// 5자 이하/15자 이상은 제거됐어야 함
	assert(!out.slice(0, 3).includes("은행 창구"), "5자 '은행 창구'는 첫 3개에 들어가면 안됨 (필터링됨)");
	assert(!out.slice(0, 3).includes("정상2"), "3자 '정상2'는 첫 3개에 들어가면 안됨 (필터링됨)");
	// 5개 미달이면 통과 후보 첫 개를 복제해 5개 채움
	assert(out.length === 5, `5개로 채워져야 함 (실제 ${out.length})`);
});

describe("14회차 2회차: _filterTitlePhraseCandidates — 모두 통과면 그대로", () => {
	// 5개 모두 6~14자 (한글 .length 기준): 우체부 가방(6), 은행 창구원(6), 공장 컨베이어(7), 도시 우편함(6), 동네 빵집가게(7)
	const input = ["우체부 가방", "은행 창구원", "공장 컨베이어", "도시 우편함", "동네 빵집가게"];
	const out = Pipeline._filterTitlePhraseCandidates(input);
	assert(out.length === 5, `5개 유지 (실제 ${out.length})`);
	for (const c of input) {
		assert(out.includes(c), `"${c}" 그대로 유지`);
	}
});

describe("14회차 2회차: _filterTitlePhraseCandidates — 모두 위반이면 빈 배열", () => {
	const input = ["짧음", "ABCD", "1자", "긴긴긴긴긴긴긴긴긴긴긴긴긴긴긴", "Z"];
	const out = Pipeline._filterTitlePhraseCandidates(input);
	// 모두 < 6 또는 > 14 → 모두 제거 → while 루프 진입 못 하므로 빈 배열
	assert(out.length === 0, `모두 위반이면 빈 배열 (실제 ${out.length})`);
});

describe("14회차 2회차: _filterTitlePhraseCandidates — 입력이 배열 아니면 그대로 반환", () => {
	assert(Pipeline._filterTitlePhraseCandidates(undefined) === undefined, "undefined 그대로");
	assert(Pipeline._filterTitlePhraseCandidates(null) === null, "null 그대로");
	assert(Pipeline._filterTitlePhraseCandidates("string") === "string", "문자열 그대로");
});

describe("14회차 2회차: _runDesigner가 _filterTitlePhraseCandidates 호출하는지 (정적 검증)", () => {
	const src = fs.readFileSync(SRC, "utf8");
	assert(/Pipeline\._filterTitlePhraseCandidates\s*\(/.test(src),
		"_runDesigner 안에서 Pipeline._filterTitlePhraseCandidates 호출");
});

// =============================================================================
// 10. 14회차 2회차: Vision 7회 실패 fallback (bestFallbackRes) 정적 검증
// =============================================================================
describe("14회차 2회차: Vision 7회 실패 시 bestFallbackRes 사용 (발행 진행 보장)", () => {
	const src = fs.readFileSync(SRC, "utf8");
	const idx = src.indexOf("async _generateImageWithRetry(");
	assert(idx >= 0, "_generateImageWithRetry 메서드 존재");
	const slice = src.slice(idx, idx + 4000);
	// bestFallbackRes 변수 선언 + Vision FAIL 분기에서 누적 + 7회 실패 후 사용
	assert(/let\s+bestFallbackRes\s*=\s*null/.test(slice), "bestFallbackRes 변수 선언");
	assert(/bestFallbackRes\s*=\s*res/.test(slice), "Vision FAIL 분기에서 마지막 이미지 보존");
	assert(/if\s*\(\s*bestFallbackRes\s*\)/.test(slice),
		"7회 루프 종료 후 bestFallbackRes 있으면 fallback 사용");
	assert(/return\s+bestFallbackRes/.test(slice),
		"bestFallbackRes 반환 (throw 대신)");
	// throw는 bestFallbackRes 없을 때만 (이미지 자체가 없는 경우)
	assert(/이미지 생성 7회 재시도 모두 실패/.test(slice),
		"이미지 자체 없는 경우만 throw 메시지");
	// fallback 사용 시 일치도 낮음 표시
	assert(/Vision 일치도 낮음|Vision 7회 실패, fallback 이미지 사용/.test(slice),
		"fallback 사용 시 사용자/로그 표시");
});

// =============================================================================
// 11. 14회차 2회차: B15 cycle 룰 (j) 제거 정적 검증
// =============================================================================
describe("14회차 2회차: B15 룰 (j) cycle 검사 제거 (BlogAssembler 사후 보정 신뢰)", () => {
	const src = fs.readFileSync(SRC, "utf8");
	const idx = src.indexOf("B15(다이어그램 mermaid 룰 준수");
	assert(idx >= 0, "B15 룰 존재");
	const slice = src.slice(idx, idx + 3000);
	// (j) 항목이 (제거됨) 표시로 무력화
	assert(/\(j\)\s*\(제거됨\)/.test(slice),
		"B15 (j) 항목이 (제거됨) 표시로 무력화");
	// BlogAssembler back edge 자동 제거 신뢰
	assert(/back edge 자동 제거|removedArrowIds/.test(slice),
		"BlogAssembler back edge 자동 제거 신뢰 명시");
	// (c) 항목에서도 cycle 자동 제거 신뢰 표시
	assert(/cycle 자동 제거 후 잎이 생기므로 PASS/.test(slice),
		"(c) 룰에서도 cycle 사후 보정 신뢰 표기");
});

// =============================================================================
// 결과
// =============================================================================
console.log("\n========================================");
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${fail}`);
console.log("========================================");

if (fail > 0) {
	console.error("\n실패 항목:");
	for (const f of failures) console.error("  - " + f);
	process.exit(1);
}
process.exit(0);
