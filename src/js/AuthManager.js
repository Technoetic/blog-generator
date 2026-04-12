// AuthManager.js — 데모 비밀번호 게이트 + 서버 프록시 발행
class AuthManager {
	static accessPassword = sessionStorage.getItem("access_password") || null;

	static async unlock(password) {
		const res = await fetch("/api/auth/unlock", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ password }),
		});
		const data = await res.json();
		if (res.ok && data.ok) {
			AuthManager.accessPassword = password;
			sessionStorage.setItem("access_password", password);
			return true;
		}
		return false;
	}

	static getAuthHeaders() {
		return AuthManager.accessPassword
			? { "X-Access-Password": AuthManager.accessPassword }
			: {};
	}

	static async publishToBlogger(results) {
		if (!AuthManager.accessPassword) {
			alert("먼저 데모 비밀번호로 잠금 해제하세요.");
			return;
		}

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
				headers: {
					"Content-Type": "application/json",
					...AuthManager.getAuthHeaders(),
				},
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

	static updateLoginUI() {
		const loginBtn = document.getElementById("loginBtn");
		const statusEl = document.getElementById("loginStatus");
		if (!loginBtn || !statusEl) return;
		if (AuthManager.accessPassword) {
			loginBtn.textContent = "잠금 해제됨";
			loginBtn.disabled = true;
			loginBtn.style.opacity = "0.5";
			statusEl.textContent = "데모 모드 활성화 — 발행 준비 완료";
			statusEl.style.display = "block";
		}
	}

	static promptUnlock() {
		const pw = prompt("데모 비밀번호를 입력하세요:");
		if (!pw) return;
		AuthManager.unlock(pw).then((ok) => {
			if (ok) {
				AuthManager.updateLoginUI();
				alert("잠금 해제 완료");
			} else {
				alert("비밀번호가 틀렸습니다.");
			}
		});
	}
}
