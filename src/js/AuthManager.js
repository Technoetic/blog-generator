// AuthManager.js — 서버 프록시 발행 (게이트 없음, 헤더 제공자 유지)
class AuthManager {
	static getAuthHeaders() {
		return {};
	}

	static async publishToBlogger(results) {
		const publishMode = document.getElementById("publish").value;
		const isDraft = publishMode === "draft";

		try {
			document.getElementById("publishBtn").textContent = "발행 중...";

			const htmlContent = BlogAssembler.markdownToHtml(
				results.assembledPublish ||
					results.assembledText ||
					results.assembled ||
					"",
			);
			const title = `${results.design?.confirmed_analogy || "비유"} — ${results.contextPacket?.topic || "기술 블로그"}`;

			const res = await fetch("/api/blogger/post", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					title,
					content: htmlContent,
					labels: ["기술블로그", "비유", results.contextPacket?.topic || ""],
					isDraft,
				}),
			});

			if (!res.ok) {
				const err = await res.text();
				throw new Error(`발행 실패 (${res.status}): ${err}`);
			}

			const post = await res.json();
			results.published = {
				status: "published",
				url: post.url,
				postId: post.id,
			};

			alert(
				`발행 완료!\n\n${isDraft ? "초안" : "공개"}으로 저장되었습니다.\nURL: ${post.url}`,
			);
			document.getElementById("publishBtn").textContent = "발행 완료";
			document.getElementById("publishBtn").disabled = true;
		} catch (e) {
			alert(`발행 오류: ${e.message}`);
			document.getElementById("publishBtn").textContent = "Blogger 발행";
		}
	}
}
