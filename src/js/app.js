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

// JARVIS SFX 토글
function toggleJarvis() {
	JarvisFX.toggle();
}

// 초기 토글 버튼 상태 반영 + 음성 목록 미리 로드
(function initJarvis() {
	const btn = document.getElementById("jarvisToggle");
	if (btn) {
		btn.textContent = JarvisFX._enabled ? "🔊 SFX ON" : "🔇 SFX OFF";
	}
	// Web Speech voices 비동기 로드 트리거
	if (window.speechSynthesis) {
		speechSynthesis.getVoices();
		speechSynthesis.addEventListener("voiceschanged", () => speechSynthesis.getVoices());
	}
})();
