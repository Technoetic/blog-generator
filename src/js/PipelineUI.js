// PipelineUI.js — Phase 상태 관리, 비용 표시, 탭 전환, 결과 표시
class PipelineUI {
	static setPhase(id, state, timeMs) {
		const el = document.getElementById(id);
		el.className = `phase ${state}`;
		const icon = el.querySelector(".phase-icon");
		if (icon) icon.classList.remove("retry-shake");
		const sub = document.getElementById(`${id}-sub`);
		if (sub) sub.classList.remove("retry-flash");
		if (state === "running") icon.innerHTML = '<div class="spinner"></div>';
		else if (state === "done") icon.textContent = "\u2713";
		else if (state === "fail") icon.textContent = "\u2717";

		if (timeMs !== undefined) {
			document.getElementById(`${id}-time`).textContent =
				`${(timeMs / 1000).toFixed(1)}s`;
		}
		// 완료/대기 시 sub-status 비움
		if (state === "done" || state === "fail" || state === "waiting") {
			const sub = document.getElementById(`${id}-sub`);
			if (sub) sub.textContent = "";
		}
		// gauge 진행도 관리
		PipelineUI._updateGauge(id, state);
		// 전체 진행도 업데이트
		PipelineUI.updateOverallProgress();
		// done 시 게임 스테이지 클리어 이펙트
		if (state === "done") {
			PipelineUI._stageClearEffect(id);
		}
	}

	// 스테이지 클리어 — sparkle 폭발 + CLEAR 토스트 + 행 sweep + 스크린 엣지 플래시
	static _stageClearEffect(phaseId) {
		const row = document.getElementById(phaseId);
		if (!row) return;
		const icon = row.querySelector(".phase-icon");
		// 1) 행 background sweep
		row.classList.remove("stage-clear-sweep");
		void row.offsetWidth;
		row.classList.add("stage-clear-sweep");
		// 2) sparkle 8개 폭발
		if (icon) {
			const rect = icon.getBoundingClientRect();
			const cx = rect.left + rect.width / 2;
			const cy = rect.top + rect.height / 2;
			for (let i = 0; i < 8; i++) {
				const sp = document.createElement("div");
				sp.className = "stage-sparkle";
				const angle = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
				const dist = 50 + Math.random() * 30;
				sp.style.left = `${cx}px`;
				sp.style.top = `${cy}px`;
				sp.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
				sp.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
				sp.style.animationDelay = `${i * 0.02}s`;
				document.body.appendChild(sp);
				setTimeout(() => sp.remove(), 900);
			}
		}
		// 3) CLEAR! 토스트 (행 우측 상단)
		if (row) {
			const rect = row.getBoundingClientRect();
			const toast = document.createElement("div");
			toast.className = "stage-clear-toast";
			toast.textContent = "✦ CLEAR!";
			toast.style.left = `${rect.left + rect.width - 60}px`;
			toast.style.top = `${rect.top + rect.height / 2 - 14}px`;
			document.body.appendChild(toast);
			setTimeout(() => toast.remove(), 1300);
		}
		// 4) 스크린 우측 엣지 짧은 그린 vignette
		const edge = document.createElement("div");
		edge.className = "stage-edge-flash";
		document.body.appendChild(edge);
		setTimeout(() => edge.remove(), 600);
	}

	static EXPECTED_DUR = {
		phase1: 20, phase2a: 20, phase2b: 30,
		phase3a: 15, phase3b: 30, phase3c: 30,
		phase4: 20, phase5: 15,
	};

	static _updateGauge(id, state) {
		const fill = document.getElementById(id + '-gauge');
		const pct = document.getElementById(id + '-pct');
		if (!fill || !pct) return;
		PipelineUI._gaugeTimers = PipelineUI._gaugeTimers || {};
		if (PipelineUI._gaugeTimers[id]) {
			clearInterval(PipelineUI._gaugeTimers[id]);
			delete PipelineUI._gaugeTimers[id];
		}
		if (state === 'waiting') {
			fill.style.width = '0%';
			pct.textContent = '0%';
		} else if (state === 'running') {
			const dur = ((PipelineUI.EXPECTED_DUR[id]) || 20) * 1000;
			const start = Date.now();
			fill.style.width = '0%';
			pct.textContent = '0%';
			PipelineUI._gaugeTimers[id] = setInterval(() => {
				const t = (Date.now() - start) / dur;
				const v = Math.min(95, 95 * (1 - Math.exp(-t * 1.5)));
				fill.style.width = v + '%';
				pct.textContent = Math.round(v) + '%';
			}, 120);
		} else if (state === 'done') {
			fill.style.width = '100%';
			pct.textContent = '100%';
		} else if (state === 'fail') {
			pct.textContent = 'FAIL';
		}
	}

	static setSubStatus(phaseId, text) {
		const el = document.getElementById(`${phaseId}-sub`);
		if (el) el.textContent = text || "";
	}

	// 재시도 발생 시각화: phase-icon에 ↻ 아이콘 + shake/pulse, 행 우측에 RETRY 토스트, sub-status 강조
	// 게이지도 0%로 리셋 후 재시작 (이전 사이클의 100%/95% 상태 정리)
	// 일부 phase(예: phase2b)는 timed() 종료 후 검증 단계에서 재시도가 발생해 row가 'done' 상태로 잡혀 있음.
	// 이 경우 row 클래스를 강제로 running으로 되돌리고, 전체 진행도도 재계산해 100%로 튀는 현상 방지.
	static markRetry(phaseId, attempt, maxAttempts, reason) {
		const row = document.getElementById(phaseId);
		if (!row) return;
		// 1) row 클래스를 'phase running'으로 강제 복귀 (done/fail 상태 제거)
		row.className = "phase running";
		// 2) 게이지 0%로 리셋 후 running 애니메이션 재시작
		PipelineUI._updateGauge(phaseId, "running");
		// 3) phase-time 텍스트도 임시 숨김 (재시도 끝나면 timed가 갱신 안 하므로 직전 측정값 유지하지 말고 비워둠)
		const timeEl = document.getElementById(`${phaseId}-time`);
		if (timeEl) timeEl.textContent = "";
		// 4) 전체 진행도 재계산 (이번 phase가 done이 아니므로 overall % 감소)
		PipelineUI.updateOverallProgress();
		const icon = row.querySelector(".phase-icon");
		if (icon) {
			icon.classList.remove("retry-shake");
			void icon.offsetWidth;
			icon.classList.add("retry-shake");
			icon.innerHTML = `<span class="retry-glyph">↻</span><sup class="retry-badge">${attempt}/${maxAttempts}</sup>`;
		}
		const sub = document.getElementById(`${phaseId}-sub`);
		if (sub) {
			sub.classList.remove("retry-flash");
			void sub.offsetWidth;
			sub.classList.add("retry-flash");
			sub.textContent = `↻ 재시도 ${attempt}/${maxAttempts} — ${reason || ""}`;
		}
		const rect = row.getBoundingClientRect();
		const toast = document.createElement("div");
		toast.className = "retry-toast";
		toast.textContent = `↻ RETRY ${attempt}/${maxAttempts}`;
		toast.style.left = `${rect.left + rect.width - 110}px`;
		toast.style.top = `${rect.top + rect.height / 2 - 14}px`;
		document.body.appendChild(toast);
		setTimeout(() => toast.remove(), 1800);
	}

	static updateCost(totalTokens, totalCost) {
		const bar = document.getElementById("costBar");
		bar.style.display = "flex";
		// 실제 _track 도달 — ticker 베이스 갱신 + 애니메이션
		PipelineUI._tickerBaseTokens = totalTokens;
		PipelineUI._tickerBaseCost = totalCost;
		PipelineUI._lastTrackAt = Date.now();
		PipelineUI._animateNumber("totalTokens", totalTokens, (v) => Math.round(v).toLocaleString());
		PipelineUI._animateNumber("totalCost", totalCost, (v) => `₩${Math.round(v).toLocaleString()}`);
	}

	// running phase id에 따라 예상 token rate (tokens/sec)
	static _estimateRate(phaseId) {
		const rates = {
			phase1: 30,
			phase2a: 60,
			phase2b: 200,   // writer는 토큰 출력 많음
			phase3a: 80,
			phase3b: 100,   // Sonar 검색 결과 토큰
			phase3c: 5,     // 이미지 생성, 적은 텍스트
			phase4: 80,
			phase5: 0,      // 발행은 토큰 거의 없음
		};
		return rates[phaseId] || 30;
	}

	// ticker 단순 렌더 (애니메이션 없음, 매초 갱신)
	static _renderTickerValue(id, value, formatter) {
		const el = document.getElementById(id);
		if (!el) return;
		// 이미 _animateNumber가 진행 중이면 끼어들지 않음
		const last = el._lastValue || 0;
		if (value > last) {
			el.textContent = formatter(value);
			el._lastValue = value;
		}
	}

	static _animateNumber(id, target, formatter) {
		const el = document.getElementById(id);
		if (!el) return;
		const prev = el._lastValue || 0;
		const delta = target - prev;
		if (delta <= 0) return; // 감소/변화 없음 무시
		const start = performance.now();
		const dur = 1500; // 1.5초 천천히 카운트
		const step = (now) => {
			const t = Math.min(1, (now - start) / dur);
			const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
			const v = prev + delta * eased;
			el.textContent = formatter(v);
			if (t < 1) requestAnimationFrame(step);
			else el._lastValue = target;
		};
		requestAnimationFrame(step);
		// 펄스 글로우 트리거 (CSS animation 재시작)
		el.classList.remove("count-pulse");
		void el.offsetWidth; // reflow
		el.classList.add("count-pulse");
		// delta 토스트 (+125)
		PipelineUI._spawnDelta(el, delta, id === "totalCost");
	}

	static _spawnDelta(anchorEl, delta, isCost) {
		const text = isCost
			? `+₩${Math.round(delta).toLocaleString()}`
			: `+${Math.round(delta).toLocaleString()}`;
		const toast = document.createElement("div");
		toast.className = "delta-toast";
		toast.textContent = text;
		const rect = anchorEl.getBoundingClientRect();
		toast.style.left = `${rect.left + rect.width / 2}px`;
		toast.style.top = `${rect.top - 4}px`;
		document.body.appendChild(toast);
		setTimeout(() => toast.remove(), 1400);
	}

	// 라이브 경과 시간 + 토큰/비용 ticker (1초마다 시각 증가)
	static startLiveTimer(startTime) {
		PipelineUI.stopLiveTimer();
		// 마지막 _track 이후 시간 경과에 따라 토큰/비용 미세 ticker
		// 실제 값 도달 전까지 시각적 흐름을 만들기 위함 (실제 _track 시 snap)
		PipelineUI._tickerBaseTokens = 0;
		PipelineUI._tickerBaseCost = 0;
		PipelineUI._lastTrackAt = Date.now();
		const tick = () => {
			const sec = Math.round((Date.now() - startTime) / 1000);
			const el = document.getElementById("totalTime");
			if (el) el.textContent = `${sec}초`;
			// 전체 % 매초 갱신 (running phase 진행도 반영)
			PipelineUI.updateOverallProgress();
			// running phase가 있으면 토큰/비용 ticker 가산 (예상 rate)
			const running = document.querySelector(".phase.running");
			if (running) {
				const sinceTrack = (Date.now() - PipelineUI._lastTrackAt) / 1000;
				const rate = PipelineUI._estimateRate(running.id); // tokens/sec
				const tokensTick = PipelineUI._tickerBaseTokens + Math.floor(sinceTrack * rate);
				const costTick = PipelineUI._tickerBaseCost + sinceTrack * rate * 0.0008; // 대략 ₩/tok
				PipelineUI._renderTickerValue("totalTokens", tokensTick, (v) => Math.round(v).toLocaleString());
				PipelineUI._renderTickerValue("totalCost", costTick, (v) => `₩${Math.round(v).toLocaleString()}`);
			}
		};
		tick();
		PipelineUI._timerHandle = setInterval(tick, 1000);
	}
	static stopLiveTimer() {
		if (PipelineUI._timerHandle) {
			clearInterval(PipelineUI._timerHandle);
			PipelineUI._timerHandle = null;
		}
	}

	// 전체 진행도 게이지 업데이트 (1/8 → 8/8)
	static updateOverallProgress() {
		const phases = Config.PHASES;
		const total = phases.length;
		const done = phases.filter((id) => {
			const el = document.getElementById(id);
			return el && el.classList.contains("done");
		}).length;
		// 완료된 phase + 현재 running phase의 진행률 합산 — 매초 부드럽게 증가
		let runningProgress = 0;
		const runningEl = document.querySelector(".phase.running");
		if (runningEl) {
			const pctEl = runningEl.querySelector(".phase-gauge-pct");
			if (pctEl) {
				const m = pctEl.textContent.match(/(\d+)/);
				if (m) runningProgress = parseInt(m[1], 10) / 100;
			}
		}
		const percent = ((done + runningProgress) / total) * 100;
		const fillEl = document.getElementById("overallGaugeFill");
		const labelEl = document.getElementById("overallGaugeLabel");
		if (fillEl) fillEl.style.width = `${percent}%`;
		if (labelEl) labelEl.textContent = `${percent.toFixed(1)}%`;
	}

	static resetPipeline() {
		Config.PHASES.forEach((id) => {
			PipelineUI.setPhase(id, "waiting");
			document.getElementById(`${id}-time`).textContent = "";
			PipelineUI.setSubStatus(id, "");
		});
		document.getElementById("costBar").style.display = "none";
		document.getElementById("errorMsg").className = "error-msg";
		document.getElementById("resultPanel").className = "result-panel";
		const tokensEl = document.getElementById("totalTokens");
		const costEl = document.getElementById("totalCost");
		tokensEl.textContent = "0";
		tokensEl._lastValue = 0;
		costEl.textContent = "₩0";
		costEl._lastValue = 0;
		// 전체 진행도 게이지 리셋
		const fillEl = document.getElementById("overallGaugeFill");
		const labelEl = document.getElementById("overallGaugeLabel");
		if (fillEl) fillEl.style.width = "0%";
		if (labelEl) labelEl.textContent = `0.0%`;
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
		// 제목 표시 + 사용자 거부권 버튼
		if (results.title) {
			const tb = document.getElementById("titleBar");
			const tt = document.getElementById("titleText");
			if (tb && tt) {
				tt.textContent = results.title;
				tb.style.display = "flex";
			}
		}
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
