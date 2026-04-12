// app.js — 엔트리포인트, 이벤트 바인딩, 초기화
const pipeline = new Pipeline();

function startPipeline() {
	pipeline.run();
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
function doGoogleLogin() {
	AuthManager.promptUnlock();
}

(function init() {
	if (AuthManager.accessPassword) AuthManager.updateLoginUI();
})();

document.getElementById("topic").addEventListener("keydown", (e) => {
	if (e.key === "Enter") startPipeline();
});
