// AuthManager.js — Google OAuth2, Blogger API
class AuthManager {
	static googleAccessToken = sessionStorage.getItem("google_token") || null;
	static bloggerBlogId = sessionStorage.getItem("blogger_blog_id") || null;

	static googleLogin(results) {
		if (results && results.assembled) {
			const saveResults = {
				...results,
				images: null,
				assembled: results.assembledPublish || results.assembledText,
			};
			localStorage.setItem("blog_results", JSON.stringify(saveResults));
			localStorage.setItem(
				"blog_publish_mode",
				document.getElementById("publish").value,
			);
		}

		const redirectUri = window.location.origin + window.location.pathname;
		const authUrl =
			"https://accounts.google.com/o/oauth2/v2/auth?" +
			new URLSearchParams({
				client_id: Config.GOOGLE_CLIENT_ID,
				redirect_uri: redirectUri,
				response_type: "token",
				scope: Config.BLOGGER_SCOPE,
				prompt: "consent",
			}).toString();

		window.location.href = authUrl;
		return new Promise(() => {});
	}

	static doGoogleLogin() {
		localStorage.setItem("blog_login_only", "true");
		AuthManager.googleLogin({});
	}

	static async getBloggerBlogs() {
		const res = await fetch(
			"https://www.googleapis.com/blogger/v3/users/self/blogs",
			{
				headers: { Authorization: `Bearer ${AuthManager.googleAccessToken}` },
			},
		);
		if (!res.ok) throw new Error(`Blogger API 오류: ${res.status}`);
		const data = await res.json();
		return data.items || [];
	}

	static async publishToBlogger(results) {
		const publishMode = document.getElementById("publish").value;

		try {
			if (!AuthManager.googleAccessToken) {
				document.getElementById("publishBtn").textContent =
					"Google 로그인 중...";
				await AuthManager.googleLogin(results);
			}

			if (!AuthManager.bloggerBlogId) {
				document.getElementById("publishBtn").textContent = "블로그 확인 중...";
				const blogs = await AuthManager.getBloggerBlogs();
				if (blogs.length === 0) {
					alert("Blogger에 블로그가 없습니다.");
					return;
				}
				if (blogs.length === 1) {
					AuthManager.bloggerBlogId = blogs[0].id;
					sessionStorage.setItem("blogger_blog_id", AuthManager.bloggerBlogId);
				} else {
					const names = blogs.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
					const choice = prompt(
						`발행할 블로그를 선택하세요:\n${names}\n\n번호 입력:`,
					);
					if (!choice) return;
					AuthManager.bloggerBlogId = blogs[parseInt(choice) - 1]?.id;
					if (!AuthManager.bloggerBlogId) {
						alert("잘못된 선택입니다.");
						return;
					}
					sessionStorage.setItem("blogger_blog_id", AuthManager.bloggerBlogId);
				}
			}

			document.getElementById("publishBtn").textContent = "발행 중...";
			const htmlContent = BlogAssembler.markdownToHtml(
				results.assembledPublish ||
					results.assembledText ||
					results.assembled ||
					"",
			);
			const title = `${results.design?.confirmed_analogy || "비유"} — ${results.contextPacket?.topic || "기술 블로그"}`;

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
					title: title,
					content: htmlContent,
					labels: ["기술블로그", "비유", results.contextPacket?.topic || ""],
				}),
			});

			if (!res.ok) {
				if (res.status === 401) {
					AuthManager.googleAccessToken = null;
					sessionStorage.removeItem("google_token");
					alert("Google 토큰이 만료되었습니다. 다시 로그인합니다.");
					AuthManager.googleLogin(results);
					return;
				}
				const err = await res.text();
				throw new Error(`발행 실패 (${res.status}): ${err}`);
			}

			const post = await res.json();
			results.published = {
				status: "published",
				url: post.url,
				postId: post.id,
				publishedAt: post.published,
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

	static checkRedirectToken() {
		const hash = window.location.hash;
		if (hash && hash.includes("access_token")) {
			const params = new URLSearchParams(hash.substring(1));
			AuthManager.googleAccessToken = params.get("access_token");
			sessionStorage.setItem("google_token", AuthManager.googleAccessToken);
			window.history.replaceState(null, "", window.location.pathname);
			return true;
		}
		return false;
	}

	static updateLoginUI() {
		const loginBtn = document.getElementById("loginBtn");
		const statusEl = document.getElementById("loginStatus");
		if (AuthManager.googleAccessToken) {
			loginBtn.textContent = "로그인 완료";
			loginBtn.disabled = true;
			loginBtn.style.opacity = "0.5";
			statusEl.textContent = "Google 계정 연결됨 — 발행 준비 완료";
			statusEl.style.display = "block";
		}
	}
}
