// PipelineUI.js — Phase 상태 관리, 비용 표시, 탭 전환, 결과 표시

// JARVIS 사이버 보이스 + 트랜스포머 메탈릭 SFX + 사이버 앰비언트 BGM
class JarvisFX {
	static _ctx = null;
	static _enabled = false;
	static _bgmEnabled = false;
	static _bgmNodes = null;
	static _voiceAvailable = null;
	static _reverbIR = null; // ConvolutionReverb IR 캐시

	static get ctx() {
		if (!JarvisFX._ctx) JarvisFX._ctx = new (window.AudioContext || window.webkitAudioContext)();
		return JarvisFX._ctx;
	}

	// 영어 남성 보이스 존재 확인. 없으면 voice() 호출 자체를 차단 (한국 보이스로 영어 읽는 것 방지)
	static hasEnglishMaleVoice() {
		if (JarvisFX._voiceAvailable !== null) return JarvisFX._voiceAvailable;
		const voices = (window.speechSynthesis?.getVoices() || []);
		const englishOnly = voices.filter((v) => /^en[-_]/i.test(v.lang));
		JarvisFX._voiceAvailable = englishOnly.length > 0;
		return JarvisFX._voiceAvailable;
	}

	// 호환용: 외부에서 직접 호출 시 사용. 스위치 UI는 app.js의 toggleJarvis/toggleBgm()이 처리.
	// 새로고침 시 항상 OFF로 시작하므로 localStorage 저장 안 함.
	static toggle() {
		JarvisFX._enabled = !JarvisFX._enabled;
		const cb = document.getElementById("jarvisToggle");
		if (cb) cb.checked = JarvisFX._enabled;
		if (JarvisFX._enabled) JarvisFX.bassDrop();
		else JarvisFX.stopBgm();
		return JarvisFX._enabled;
	}

	static toggleBgm() {
		JarvisFX._bgmEnabled = !JarvisFX._bgmEnabled;
		const cb = document.getElementById("bgmToggle");
		if (cb) cb.checked = JarvisFX._bgmEnabled;
		if (JarvisFX._bgmEnabled) JarvisFX.startBgm();
		else JarvisFX.stopBgm();
		return JarvisFX._bgmEnabled;
	}

	// Epic Cinematic BGM — 단일 BufferSource + loop=true (sample-level 정확 loop)
	// mp3 디코딩 후 head/tail silence trim한 새 buffer 생성 → loopStart/loopEnd 명시
	// 이전 듀얼 BufferSource crossfade의 setTimeout 부정확성 문제 해결.
	static BGM_TARGET_VOL = 0.30;
	static BGM_TRIM_HEAD_SEC = 0.05; // 시작 silence skip
	static BGM_TRIM_TAIL_SEC = 0.15; // 끝 silence skip

	// mp3 buffer head/tail을 잘라낸 trimmed buffer 생성 (silence 제거)
	static async _ensureTrimmedBgmBuffer() {
		if (JarvisFX._trimmedBgmBuffer) return JarvisFX._trimmedBgmBuffer;
		const ctx = JarvisFX.ctx;
		const url = "assets/bgm-epic-cinematic.mp3";
		const ab = await fetch(url).then((r) => r.arrayBuffer());
		const original = await ctx.decodeAudioData(ab);
		const sr = original.sampleRate;
		const startSample = Math.floor(JarvisFX.BGM_TRIM_HEAD_SEC * sr);
		const endSample = Math.floor((original.duration - JarvisFX.BGM_TRIM_TAIL_SEC) * sr);
		const trimmedLen = endSample - startSample;
		const trimmed = ctx.createBuffer(original.numberOfChannels, trimmedLen, sr);
		// 채널별 복사 + 매끄러운 loop을 위한 첫/끝 50ms crossfade (loop point에서 클릭 방지)
		const xfadeLen = Math.floor(0.05 * sr); // 50ms crossfade
		for (let ch = 0; ch < original.numberOfChannels; ch++) {
			const srcData = original.getChannelData(ch);
			const dstData = trimmed.getChannelData(ch);
			for (let i = 0; i < trimmedLen; i++) {
				dstData[i] = srcData[startSample + i];
			}
			// 끝부분 50ms를 첫부분 50ms와 mix → loop 경계에서 sample 불연속 제거
			for (let i = 0; i < xfadeLen; i++) {
				const t = i / xfadeLen;
				const headSample = dstData[i];
				const tailSample = dstData[trimmedLen - xfadeLen + i];
				// linear crossfade
				dstData[trimmedLen - xfadeLen + i] = tailSample * (1 - t) + headSample * t;
			}
		}
		JarvisFX._trimmedBgmBuffer = trimmed;
		return trimmed;
	}

	static async startBgm() {
		if (!JarvisFX._enabled || !JarvisFX._bgmEnabled) return;
		if (JarvisFX._bgmSource) return; // 이미 재생 중
		const ctx = JarvisFX.ctx;
		try {
			const buffer = await JarvisFX._ensureTrimmedBgmBuffer();
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			src.loop = true; // 핵심: Web Audio sample-level loop (setTimeout 의존 X)
			src.loopStart = 0;
			src.loopEnd = buffer.duration;

			const gain = ctx.createGain();
			src.connect(gain).connect(ctx.destination);

			// fade in 2초
			const t0 = ctx.currentTime;
			gain.gain.setValueAtTime(0.0001, t0);
			gain.gain.linearRampToValueAtTime(JarvisFX.BGM_TARGET_VOL, t0 + 2.0);
			src.start();

			JarvisFX._bgmSource = src;
			JarvisFX._bgmGain = gain;
		} catch (e) {
			console.warn("[BGM] start failed:", e.message);
		}
	}

	static stopBgm() {
		if (!JarvisFX._bgmSource) {
			// 호환: 이전 <audio> 태그 잔여 정지
			const audio = document.getElementById("bgmAudio");
			if (audio && !audio.paused) { audio.pause(); audio.currentTime = 0; }
			return;
		}
		const ctx = JarvisFX.ctx;
		const t = ctx.currentTime;
		const src = JarvisFX._bgmSource;
		const gain = JarvisFX._bgmGain;
		// fade out 1.5초 후 stop
		try {
			gain.gain.cancelScheduledValues(t);
			gain.gain.setValueAtTime(gain.gain.value, t);
			gain.gain.linearRampToValueAtTime(0.0001, t + 1.5);
			setTimeout(() => { try { src.stop(); } catch (e) {} }, 1600);
		} catch (e) {}
		JarvisFX._bgmSource = null;
		JarvisFX._bgmGain = null;
	}

	// SFX 재생 (Mixkit royalty-free sci-fi mp3 — 합성 사운드보다 영화급 음질)
	// 7종: transform / bassDrop / hudLock / alert / servo / success / victory
	// 첫 호출 시 fetch + decode 후 캐싱, 이후 즉시 재생.
	static _sfxBuf = {};
	static _playSfx(key, opts = {}) {
		if (!JarvisFX._enabled) return;
		const ctx = JarvisFX.ctx;
		const url = `assets/sfx/${key}.mp3`;
		const playBuf = (buf) => {
			const src = ctx.createBufferSource();
			src.buffer = buf;
			const gain = ctx.createGain();
			gain.gain.value = opts.volume || 0.7; // BGM 0.30 / SFX 0.7 / Voice 0.55
			src.connect(gain).connect(ctx.destination);
			src.start();
		};
		if (JarvisFX._sfxBuf[key]) { playBuf(JarvisFX._sfxBuf[key]); return; }
		fetch(url).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)).then((buf) => {
			JarvisFX._sfxBuf[key] = buf;
			playBuf(buf);
		}).catch((e) => console.warn(`[SFX] ${key}.mp3 load fail:`, e.message));
	}

	// Phase 진행 클릭 (Mixkit "Sci fi click" — 1.27초 짧고 깔끔, BGM과 충돌 없음)
	static transform()  { JarvisFX._playSfx("transform", { volume: 0.4 }); }
	// 아이언맨 베이스 드롭 (Mixkit "Apocalyptic stomp impact")
	static bassDrop()   { JarvisFX._playSfx("bassdrop",  { volume: 0.7 }); }
	// HUD 락온 확인음 (Mixkit "Sci Fi confirmation")
	static hudLock()    { JarvisFX._playSfx("hudlock",   { volume: 0.6 }); }
	// 빨간 경보 (Mixkit "Sci-Fi error alert")
	static alert()      { JarvisFX._playSfx("alert",     { volume: 0.55 }); }
	// 서보 모터 클릭 (Mixkit "Sci fi interface robot click")
	static servo()      { JarvisFX._playSfx("servo",     { volume: 0.55 }); }
	// 성공 chime (Mixkit "Sci Fi positive notification")
	static success()    { JarvisFX._playSfx("success",   { volume: 0.6 }); }
	// 발행 완료 팡파레 (Mixkit "Futuristic space intro")
	static victory()    {
		JarvisFX._playSfx("victory", { volume: 0.7 });
		setTimeout(() => JarvisFX._playSfx("bassdrop", { volume: 0.5 }), 200);
	}

	// 영화급 reverb IR — 2.5초 tail, 적절한 공간감 (이전 3.5초는 늘어짐)
	static _getReverbIR() {
		if (JarvisFX._reverbIR) return JarvisFX._reverbIR;
		const ctx = JarvisFX.ctx;
		const sr = ctx.sampleRate;
		const len = Math.floor(sr * 2.5); // 2.5초 (이전 3.5 → 늘어짐 줄임)
		const ir = ctx.createBuffer(2, len, sr);
		for (let ch = 0; ch < 2; ch++) {
			const data = ir.getChannelData(ch);
			const earlyLen = Math.floor(sr * 0.08);
			for (let i = 0; i < len; i++) {
				const t = i / len;
				// decay 지수 2.0 — 적당히 빠른 감쇠 (이전 1.8보다 깔끔)
				const decay = Math.pow(1 - t, 2.0);
				let sample = (Math.random() * 2 - 1) * decay;
				if (i < earlyLen) sample *= 1 + Math.sin(i * 0.1) * 0.3;
				if (ch === 1) sample *= 0.92;
				data[i] = sample * 0.7;
			}
		}
		JarvisFX._reverbIR = ir;
		return ir;
	}

	// SF 영화 동굴 톤 보이스 처리 (Brian + 베이스 부각 + 동굴 reverb)
	// 처리 체인: rate 0.85 → HP 60 → SubShelf+5dB@80 → LowShelf+8dB@200 → Peak+2@3k
	//        → split → dry 60% / Reverb(predelay 80ms + 3.5s) wet 40% → Master 0.55
	static voicePlay(key, opts = {}) {
		if (!JarvisFX._enabled) return;
		const ctx = JarvisFX.ctx;
		const url = `assets/voice/${key}.mp3`;
		JarvisFX._voiceBuf = JarvisFX._voiceBuf || {};
		const playBuf = (buf) => {
			const src = ctx.createBufferSource();
			src.buffer = buf;
			src.playbackRate.value = opts.rate || 0.92; // 정상에 가깝게 (이전 0.80은 늘어짐)

			// 1) Highpass — 60Hz (이전 50 → 60Hz로 럼블 더 컷)
			const hp = ctx.createBiquadFilter();
			hp.type = "highpass";
			hp.frequency.value = 60;
			hp.Q.value = 0.7;

			// 2) Sub-bass shelf @ 80Hz +5dB — 베이스 존재감 (이전 +9 → 먹먹 회피)
			const subShelf = ctx.createBiquadFilter();
			subShelf.type = "lowshelf";
			subShelf.frequency.value = 80;
			subShelf.gain.value = 5;

			// 3) Low-mid 컷 @ 250Hz -2dB Q1.0 — 머디(muddy) 영역 컷 (먹먹 핵심 원인)
			const muddyCut = ctx.createBiquadFilter();
			muddyCut.type = "peaking";
			muddyCut.frequency.value = 250;
			muddyCut.Q.value = 1.0;
			muddyCut.gain.value = -2;

			// 4) Vocal clarity peak @ 2500Hz +4dB Q1.2 — 자음/명료도 (Mid 강화 핵심)
			const clarity = ctx.createBiquadFilter();
			clarity.type = "peaking";
			clarity.frequency.value = 2500;
			clarity.Q.value = 1.2;
			clarity.gain.value = 4;

			// 5) Presence peak @ 5000Hz +3dB Q1.0 — 공기감/디테일 (멋있는 톤)
			const presence = ctx.createBiquadFilter();
			presence.type = "peaking";
			presence.frequency.value = 5000;
			presence.Q.value = 1.0;
			presence.gain.value = 3;

			// 6) Low shelf @ 200Hz +4dB — 베이스 존재감 (이전 +10 → 먹먹 회피)
			const lowShelf = ctx.createBiquadFilter();
			lowShelf.type = "lowshelf";
			lowShelf.frequency.value = 200;
			lowShelf.gain.value = 4;

			// 7) Saturation — 살짝 따스함 + 임팩트 (+2dB 효과)
			const sat = ctx.createWaveShaper();
			const curve = new Float32Array(2048);
			for (let i = 0; i < 2048; i++) {
				const x = (i / 1024) - 1;
				curve[i] = Math.tanh(x * 1.3); // 부드러운 saturation
			}
			sat.curve = curve;
			sat.oversample = "2x";

			// 8) Pre-delay 50ms (이전 80 → 50, 너무 큰 공간감 줄임)
			const preDelay = ctx.createDelay(0.5);
			preDelay.delayTime.value = 0.05;

			// 9) Convolution Reverb — 2.5초 tail
			const reverb = ctx.createConvolver();
			reverb.buffer = JarvisFX._getReverbIR();

			// 10) Dry/Wet (dry 72% + wet 28% — 늘어짐 줄이고 명료도 우선)
			const dryGain = ctx.createGain();
			dryGain.gain.value = 0.72;
			const wetGain = ctx.createGain();
			wetGain.gain.value = 0.28;

			// 11) Master gain — 0.65 그대로
			const masterGain = ctx.createGain();
			masterGain.gain.value = opts.volume || 0.65;

			// 라우팅: src → HP → SubShelf → MuddyCut → Clarity → Presence → LowShelf → Saturation
			//                                                                       ├─ dry → master
			//                                                                       └─ preDelay → Reverb → wet → master
			src.connect(hp);
			hp.connect(subShelf);
			subShelf.connect(muddyCut);
			muddyCut.connect(clarity);
			clarity.connect(presence);
			presence.connect(lowShelf);
			lowShelf.connect(sat);
			sat.connect(dryGain);
			dryGain.connect(masterGain);
			sat.connect(preDelay);
			preDelay.connect(reverb);
			reverb.connect(wetGain);
			wetGain.connect(masterGain);
			masterGain.connect(ctx.destination);
			src.start();
		};
		if (JarvisFX._voiceBuf[key]) {
			playBuf(JarvisFX._voiceBuf[key]);
			return;
		}
		fetch(url).then((r) => r.arrayBuffer()).then((ab) => ctx.decodeAudioData(ab)).then((buf) => {
			JarvisFX._voiceBuf[key] = buf;
			playBuf(buf);
		}).catch((e) => console.warn(`[Voice] ${key}.mp3 load fail:`, e.message));
	}

	// 호환: 이전 voice(text) 호출 → 텍스트 → key 매핑
	static voice(text, opts = {}) {
		const map = {
			"System online.": "system_online",
			"System online": "system_online",
			"Scanning topic.": "scanning",
			"Topic locked.": "topic_locked",
			"Forging analogy.": "forging",
			"Analogy ready.": "analogy_ready",
			"Parallel agents online.": "parallel_online",
			"Composition complete.": "composition",
			"Validating.": "scanning", // 재사용
			"Validation passed.": "validation_passed",
			"Fact check.": "scanning",
			"Facts verified.": "facts_verified",
			"Rendering visuals.": "scanning",
			"Visuals deployed.": "visuals_deployed",
			"Quality scan.": "scanning",
			"All systems nominal.": "systems_nominal",
			"Deploying.": "scanning",
			"Mission complete.": "mission_complete",
		};
		const key = map[text.trim()] || (text.toLowerCase().includes("retry") ? "retry_engaged" : null);
		if (key) JarvisFX.voicePlay(key, opts);
	}
}

// Phase별 JARVIS 보이스 라인 (짧고 또렷하게 — TTS 발음 정확도 ↑)
const JARVIS_LINES = {
	phase1:  { running: "Scanning topic.",       done: "Topic locked." },
	phase2a: { running: "Forging analogy.",       done: "Analogy ready." },
	phase2b: { running: "Parallel agents online.", done: "Composition complete." },
	phase3a: { running: "Validating.",            done: "Validation passed." },
	phase3b: { running: "Fact check.",            done: "Facts verified." },
	phase3c: { running: "Rendering visuals.",     done: "Visuals deployed." },
	phase4:  { running: "Quality scan.",          done: "All systems nominal." },
	phase5:  { running: "Deploying.",             done: "Mission complete." },
};

class PipelineUI {
	static setPhase(id, state, timeMs) {
		const el = document.getElementById(id);
		el.className = `phase ${state}`;
		const icon = el.querySelector(".phase-icon");
		if (icon) icon.classList.remove("retry-shake");
		const sub = document.getElementById(`${id}-sub`);
		if (sub) sub.classList.remove("retry-flash");
		// JARVIS SFX + \ubcf4\uc774\uc2a4 \ud2b8\ub9ac\uac70
		if (state === "running") {
			JarvisFX.transform();
			const line = JARVIS_LINES[id]?.running;
			if (line) setTimeout(() => JarvisFX.voice(line), 200);
		} else if (state === "done") {
			JarvisFX.success();
			const line = JARVIS_LINES[id]?.done;
			if (line) setTimeout(() => JarvisFX.voice(line), 200);
		} else if (state === "fail") {
			JarvisFX.alert();
		}
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
		// JARVIS 알람 + 보이스
		JarvisFX.alert();
		setTimeout(() => JarvisFX.voice(`Retry sequence engaged. Attempt ${attempt} of ${maxAttempts}.`), 200);
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
		bar.classList.add("active"); // 활동 글로우 sweep 활성화
		PipelineUI._tickerBaseTokens = totalTokens;
		PipelineUI._tickerBaseCost = totalCost;
		PipelineUI._lastTrackAt = Date.now();
		PipelineUI._animateNumber("totalTokens", totalTokens, (v) => Math.round(v).toLocaleString());
		PipelineUI._animateNumber("totalCost", totalCost, (v) => `₩${Math.round(v).toLocaleString()}`);
		PipelineUI._updateCostBar(totalCost);
		PipelineUI._checkMilestones(totalCost);
	}

	// 비용 진행 막대 업데이트 (₩0~₩150 = 1편 평균 비용 범위 0~100%)
	// ₩150 초과 시 100% + 보너스 펄스 클래스로 시각 강조
	static _updateCostBar(cost) {
		const fill = document.getElementById("costBarFill");
		if (!fill) return;
		const pct = Math.min(100, (cost / 150) * 100);
		fill.style.width = pct + "%";
		// 1편 평균 초과 시 골드 변환
		if (cost > 150) fill.classList.add("over-budget");
		else fill.classList.remove("over-budget");
	}

	// 마일스톤 도달 시 sparkle + 효과음
	static _checkMilestones(cost) {
		const milestones = document.querySelectorAll(".cost-milestone");
		milestones.forEach((m) => {
			const target = parseInt(m.dataset.mile);
			if (cost >= target && !m.classList.contains("reached")) {
				m.classList.add("reached");
				if (typeof JarvisFX !== "undefined") JarvisFX.hudLock();
				// sparkle 효과
				const rect = m.getBoundingClientRect();
				const cx = rect.left + rect.width / 2;
				const cy = rect.top + rect.height / 2;
				for (let i = 0; i < 6; i++) {
					const sp = document.createElement("div");
					sp.className = "stage-sparkle";
					const angle = (Math.PI * 2 * i) / 6;
					const dist = 40 + Math.random() * 20;
					sp.style.left = `${cx}px`;
					sp.style.top = `${cy}px`;
					sp.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
					sp.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
					document.body.appendChild(sp);
					setTimeout(() => sp.remove(), 900);
				}
			}
		});
	}

	// tokens/sec 레이트 표시
	static _updateTokensRate(ratePerSec) {
		const el = document.getElementById("tokensRate");
		if (!el) return;
		if (ratePerSec > 0) {
			el.textContent = `+${Math.round(ratePerSec)}/s`;
			el.classList.add("visible");
		} else {
			el.classList.remove("visible");
		}
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
				const rate = PipelineUI._estimateRate(running.id);
				const tokensTick = PipelineUI._tickerBaseTokens + Math.floor(sinceTrack * rate);
				const costTick = PipelineUI._tickerBaseCost + sinceTrack * rate * 0.0008;
				PipelineUI._renderTickerValue("totalTokens", tokensTick, (v) => Math.round(v).toLocaleString());
				PipelineUI._renderTickerValue("totalCost", costTick, (v) => `₩${Math.round(v).toLocaleString()}`);
				PipelineUI._updateCostBar(costTick);
				PipelineUI._updateTokensRate(rate); // tokens/sec 표시
			} else {
				PipelineUI._updateTokensRate(0); // 진행 중 phase 없으면 hidden
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
		// 활동 글로우 sweep 정지
		const bar = document.getElementById("costBar");
		if (bar) bar.classList.remove("active");
		PipelineUI._updateTokensRate(0);
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
		let percent = ((done + runningProgress) / total) * 100;
		// 단조 증가 보장 — markRetry로 phase running 복귀 시 done 카운트 감소해서
		// percent 일시 하락하는 버그 방지. 100% 도달 전까지 절대 뒤로 가지 않음.
		if (PipelineUI._lastOverallPercent === undefined) PipelineUI._lastOverallPercent = 0;
		if (percent < PipelineUI._lastOverallPercent && percent < 100) {
			percent = PipelineUI._lastOverallPercent;
		}
		PipelineUI._lastOverallPercent = percent;
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
