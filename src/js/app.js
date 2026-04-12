// app.js — 엔트리포인트, 이벤트 바인딩, 초기화
const pipeline = new Pipeline();

// ── 글로벌 함수 바인딩 (HTML onclick에서 호출) ──
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
	AuthManager.doGoogleLogin();
}

// ── 초기화 ──
(async function init() {
	// 1. OAuth 리디렉트 토큰 확인
	const hasToken = AuthManager.checkRedirectToken();

	// 2. 로그인 상태 UI 업데이트
	if (AuthManager.googleAccessToken) AuthManager.updateLoginUI();

	// 3. 로그인만 한 경우 (파이프라인 결과 없이 복귀)
	if (
		AuthManager.googleAccessToken &&
		localStorage.getItem("blog_login_only")
	) {
		localStorage.removeItem("blog_login_only");
		AuthManager.updateLoginUI();
		return;
	}

	// 4. 리디렉트 복귀 시 자동 발행
	if (hasToken) {
		const saved = localStorage.getItem("blog_results");
		const publishMode = localStorage.getItem("blog_publish_mode") || "draft";
		localStorage.removeItem("blog_results");
		localStorage.removeItem("blog_publish_mode");

		if (saved) {
			pipeline.results = JSON.parse(saved);
			PipelineUI.showResults(pipeline.results);
			document.getElementById("pipeline").className = "pipeline active";
			Config.PHASES.slice(0, 7).forEach((pid) => {
				PipelineUI.setPhase(pid, "done");
			});

			PipelineUI.setPhase("phase5", "running");
			try {
				const blogs = await AuthManager.getBloggerBlogs();
				if (blogs.length > 0) {
					AuthManager.bloggerBlogId = blogs[0].id;
					sessionStorage.setItem("blogger_blog_id", AuthManager.bloggerBlogId);
				}
				const htmlContent = BlogAssembler.markdownToHtml(
					pipeline.results.assembledPublish ||
						pipeline.results.assembledText ||
						"",
				);
				const title = `${pipeline.results.design?.confirmed_analogy || "비유"} — ${pipeline.results.contextPacket?.topic || "기술 블로그"}`;
				const isDraft = publishMode === "draft";
				const postUrl = `https://www.googleapis.com/blogger/v3/blogs/${AuthManager.bloggerBlogId}/posts${isDraft ? "?isDraft=true" : ""}`;

				const res = await fetch(postUrl, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${AuthManager.googleAccessToken}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						kind: "blogger#post",
						title,
						content: htmlContent,
						labels: [
							"기술블로그",
							"비유",
							pipeline.results.contextPacket?.topic || "",
						],
					}),
				});

				if (res.ok) {
					const post = await res.json();
					pipeline.results.published = {
						status: "published",
						url: post.url,
						postId: post.id,
					};
					PipelineUI.setPhase("phase5", "done");
					document.getElementById("publishBtn").textContent =
						"발행 완료 — 보기";
					document.getElementById("publishBtn").onclick = () =>
						window.open(post.url, "_blank");
					alert(`발행 완료!\n${post.url}`);
				} else {
					PipelineUI.setPhase("phase5", "fail");
				}
			} catch (e) {
				PipelineUI.setPhase("phase5", "fail");
			}
		}
	}
})();

// ── Enter 키 지원 ──
document.getElementById("topic").addEventListener("keydown", (e) => {
	if (e.key === "Enter") startPipeline();
});
