// app.js — 엔트리포인트, 이벤트 바인딩, 초기화
const pipeline = new Pipeline();
window.pipeline = pipeline; // 테스트 하네스/디버깅용 노출

function startPipeline() {
	pipeline.run();
}
function cancelPipeline() {
	if (confirm("진행 중인 블로그 생성을 취소하시겠습니까?")) {
		pipeline.cancel();
	}
}
function showTab(name) {
	PipelineUI.showTab(
		name,
		document.querySelector(`.result-tab[onclick*="${name}"]`),
	);
}
function copyBlog() {
	BlogAssembler.copyBlog(pipeline.results);
}
function downloadAll() {
	BlogAssembler.downloadAll(pipeline.results);
}
function publishToBlogger() {
	AuthManager.publishToBlogger(pipeline.results);
}

// L6 사용자 거부권: 제목이 어색하면 다음 후보로 교체. 풀 소진 시 Agent ① 재호출.
async function regenerateTitle() {
	const btn = document.getElementById("regenTitleBtn");
	if (!btn) return;
	const originalText = btn.textContent;
	btn.disabled = true;
	btn.textContent = "🔄 생성 중...";
	try {
		const newTitle = await Pipeline.regenerateTitle();
		if (newTitle) {
			document.getElementById("titleText").textContent = newTitle;
			pipeline.results.title = newTitle;
		} else {
			alert("더 이상 생성 가능한 후보가 없습니다.");
		}
	} catch (e) {
		alert("제목 재생성 실패: " + e.message);
	} finally {
		btn.disabled = false;
		btn.textContent = originalText;
	}
}

document.getElementById("topic").addEventListener("keydown", (e) => {
	if (e.key === "Enter") startPipeline();
});

// JARVIS SFX 토글 (스위치 input checked → state). 새로고침 시 OFF 시작 — localStorage 저장 안 함.
function toggleJarvis() {
	const cb = document.getElementById("jarvisToggle");
	if (!cb) return;
	JarvisFX._enabled = cb.checked;
	if (cb.checked) JarvisFX.bassDrop();
	else JarvisFX.stopBgm();
}
function toggleBgm() {
	const cb = document.getElementById("bgmToggle");
	if (!cb) return;
	JarvisFX._bgmEnabled = cb.checked;
	if (cb.checked) JarvisFX.startBgm();
	else JarvisFX.stopBgm();
}

// 초기 스위치 상태 강제 OFF + 음성 목록 미리 로드
(function initJarvis() {
	const sfxCb = document.getElementById("jarvisToggle");
	if (sfxCb) sfxCb.checked = false;
	const bgmCb = document.getElementById("bgmToggle");
	if (bgmCb) bgmCb.checked = false;
	JarvisFX._enabled = false;
	JarvisFX._bgmEnabled = false;
	// Web Speech voices 비동기 로드 트리거 (음성 메타데이터만 캐싱, 재생 안 함)
	if (window.speechSynthesis) {
		speechSynthesis.getVoices();
		speechSynthesis.addEventListener("voiceschanged", () => {
			speechSynthesis.getVoices();
			JarvisFX._voiceAvailable = null;
		});
	}
})();
