// PipelineUI.js — Phase 상태 관리, 비용 표시, 탭 전환, 결과 표시
class PipelineUI {
	static setPhase(id, state, timeMs) {
		const el = document.getElementById(id);
		el.className = `phase ${state}`;
		const icon = el.querySelector(".phase-icon");
		if (state === "running") icon.innerHTML = '<div class="spinner"></div>';
		else if (state === "done") icon.textContent = "\u2713";
		else if (state === "fail") icon.textContent = "\u2717";

		if (timeMs !== undefined) {
			document.getElementById(`${id}-time`).textContent =
				`${(timeMs / 1000).toFixed(1)}s`;
		}
	}

	static resetPipeline() {
		Config.PHASES.forEach((id) => {
			PipelineUI.setPhase(id, "waiting");
			document.getElementById(`${id}-time`).textContent = "";
		});
		document.getElementById("costBar").style.display = "none";
		document.getElementById("errorMsg").className = "error-msg";
		document.getElementById("resultPanel").className = "result-panel";
	}

	static async timed(phaseId, fn) {
		PipelineUI.setPhase(phaseId, "running");
		const start = Date.now();
		try {
			const result = await fn();
			PipelineUI.setPhase(phaseId, "done", Date.now() - start);
			return result;
		} catch (e) {
			PipelineUI.setPhase(phaseId, "fail", Date.now() - start);
			throw e;
		}
	}

	static showResults(results) {
		document.getElementById("resultPanel").className = "result-panel active";
		document.getElementById("blogPreview").innerHTML =
			BlogAssembler.markdownToHtml(results.assembled || "");
		document.getElementById("designReport").textContent = JSON.stringify(
			results.design,
			null,
			2,
		);
		document.getElementById("verifyReport").textContent = JSON.stringify(
			results.verify,
			null,
			2,
		);
		document.getElementById("factcheckReport").textContent = JSON.stringify(
			results.factcheck,
			null,
			2,
		);
		document.getElementById("evalReport").textContent = JSON.stringify(
			results.eval,
			null,
			2,
		);
		document.getElementById("promptsReport").textContent = JSON.stringify(
			results.prompts,
			null,
			2,
		);

		if (results.published?.status === "ready") {
			document.getElementById("publishBtn").style.display = "block";
			document.getElementById("publishBtn").textContent = "Blogger 발행";
			document.getElementById("publishBtn").disabled = false;
		} else if (results.published?.status === "published") {
			document.getElementById("publishBtn").style.display = "block";
			document.getElementById("publishBtn").textContent = "발행 완료 — 보기";
			document.getElementById("publishBtn").disabled = false;
			document.getElementById("publishBtn").onclick = () =>
				window.open(results.published.url, "_blank");
		}
	}

	static showTab(name, clickedEl) {
		document
			.querySelectorAll(".result-tab")
			.forEach((t) => { t.classList.remove("active"); });
		document
			.querySelectorAll(".result-pane")
			.forEach((p) => { p.classList.remove("active"); });
		if (clickedEl) clickedEl.classList.add("active");
		document.getElementById(`pane-${name}`).classList.add("active");
	}

	static showCost(totalTokens, totalCost, totalTime) {
		document.getElementById("costBar").style.display = "flex";
		document.getElementById("totalTokens").textContent =
			totalTokens.toLocaleString();
		document.getElementById("totalCost").textContent =
			`\u20A9${Math.round(totalCost).toLocaleString()}`;
		document.getElementById("totalTime").textContent =
			`${totalTime.toFixed(1)}초`;
	}

	static showError(message) {
		const errEl = document.getElementById("errorMsg");
		errEl.textContent = message;
		errEl.className = "error-msg active";
	}
}
