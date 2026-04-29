// ApiClient.js — BizRouter API, 이미지 생성, Imgur 업로드
class ApiClient {
	// AbortController 기반 timeout 헬퍼 — Nano Banana/LLM 응답 무한 대기 방지
	static async _fetchWithTimeout(url, options, timeoutMs) {
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), timeoutMs);
		try {
			return await fetch(url, { ...options, signal: ctrl.signal });
		} catch (e) {
			if (e.name === "AbortError") {
				throw new Error(`요청 타임아웃 (${timeoutMs / 1000}초 초과)`);
			}
			throw e;
		} finally {
			clearTimeout(timer);
		}
	}

	static async callAgent(systemPrompt, userMessages, options = {}) {
		// Perplexity Sonar 등 일부 모델은 user 메시지 연속 불허 (user/assistant 교대 규칙).
		// 여러 user 메시지를 하나로 합침.
		const model = options.model || Config.MODEL;
		const strictAlternation = /perplexity\/|^sonar/i.test(model);
		const messages = [{ role: "system", content: systemPrompt }];
		if (strictAlternation && userMessages.length > 1) {
			const combined = userMessages
				.map((m, i) => `[Part ${i + 1}]\n${typeof m === "string" ? m : JSON.stringify(m)}`)
				.join("\n\n");
			messages.push({ role: "user", content: combined });
		} else {
			for (const m of userMessages) {
				// multimodal 지원: 배열이면 그대로 (text+image content parts)
				if (Array.isArray(m)) {
					messages.push({ role: "user", content: m });
				} else {
					messages.push({
						role: "user",
						content: typeof m === "string" ? m : JSON.stringify(m),
					});
				}
			}
		}

		const body = {
			model: options.model || Config.MODEL,
			messages,
			temperature: options.temperature ?? 0.7,
			thinking_budget: options.thinking_budget ?? 0,
			max_tokens: options.max_tokens ?? 32768,
			stream: false,
		};

		if (options.response_schema) {
			body.response_format = {
				type: "json_schema",
				json_schema: {
					name: options.schema_name || "response",
					strict: true,
					schema: options.response_schema,
				},
			};
		} else {
			body.response_format = { type: "json_object" };
		}

		if (options.tools) {
			body.tools = options.tools;
		}

		// 503/429 등 일시 장애는 지수 백오프로 최대 3회 재시도. 단일 호출 90초 timeout.
		let res;
		let attempt = 0;
		while (true) {
			res = await ApiClient._fetchWithTimeout(Config.BIZROUTER_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...AuthManager.getAuthHeaders(),
				},
				body: JSON.stringify(body),
			}, 90000);
			if (res.ok) break;
			const transient = res.status === 503 || res.status === 429 || res.status === 504;
			if (!transient || attempt >= 3) break;
			attempt++;
			const wait = 2000 * Math.pow(2, attempt - 1); // 2s, 4s, 8s
			console.warn(`API ${res.status}, ${wait}ms 후 재시도 (${attempt}/3)`);
			await new Promise((r) => setTimeout(r, wait));
		}

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`API 오류 (${res.status}): ${err}`);
		}

		const data = await res.json();
		const content = data.choices[0].message.content;
		const finishReason = data.choices[0].finish_reason;
		const usage = data.usage || {};

		let parsed;
		if (typeof content === "string") {
			try {
				parsed = JSON.parse(content);
			} catch (e) {
				const jsonMatch =
					content.match(/```json\s*([\s\S]*?)```/) ||
					content.match(/(\{[\s\S]*\})/);
				if (jsonMatch) {
					try {
						parsed = JSON.parse(jsonMatch[1].trim());
					} catch (e2) {
						throw new Error(
							`JSON 파싱 실패 (finish=${finishReason}, len=${content.length}): ${content.substring(content.length - 200)}`,
						);
					}
				} else {
					throw new Error(
						`JSON 파싱 실패 (finish=${finishReason}, len=${content.length}): ${content.substring(0, 200)}`,
					);
				}
			}
		} else {
			parsed = content;
		}

		return { data: parsed, usage, finishReason };
	}

	static async generateImage(prompt, aspectRatio = "16:9") {
		try {
			const res = await ApiClient._fetchWithTimeout(Config.BIZROUTER_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					...AuthManager.getAuthHeaders(),
				},
				body: JSON.stringify({
					model: Config.IMAGE_MODEL,
					messages: [
						{
							role: "user",
							content:
								prompt +
								"\n\nIMPORTANT: Any text in the image must be in English only. Do NOT use Korean, Japanese, Chinese or any non-Latin script. English text labels, signs, and typography are encouraged.",
						},
					],
					aspect_ratio: aspectRatio,
					stream: false,
				}),
			}, 60000); // Nano Banana 60초 timeout

			if (!res.ok) {
				console.warn("이미지 API 응답 오류:", res.status);
				return { url: null, usage: {} };
			}

			const data = await res.json();
			const content = data.choices?.[0]?.message?.content;
			const usage = data.usage || {};

			if (Array.isArray(content)) {
				const img = content.find((c) => c.type === "image_url");
				if (img) return { url: img.image_url.url, usage };
			}
			return { url: null, usage };
		} catch (e) {
			console.warn("이미지 생성 예외:", e.message);
			return { url: null, usage: {} };
		}
	}

	static async uploadToImgur(base64DataUrl) {
		const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
		// 서버 4회 재시도 누적 ~17초 + 각 30초 timeout. 클라이언트 60초 timeout + 502 시 1회 재시도.
		const delays = [0, 3000]; // 502 발생 시 3초 후 1회 재시도
		let lastErr = null;
		for (let i = 0; i < delays.length; i++) {
			if (delays[i] > 0) await new Promise((r) => setTimeout(r, delays[i]));
			try {
				const res = await ApiClient._fetchWithTimeout(Config.IMGUR_PROXY_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						...AuthManager.getAuthHeaders(),
					},
					body: JSON.stringify({ image: base64 }),
				}, 60000);
				if (res.ok) {
					const data = await res.json();
					if (data.link) {
						if (i > 0) console.log(`Imgur 업로드 ${i + 1}차 시도 성공`);
						return data.link;
					}
					lastErr = "응답에 link 없음";
				} else if (res.status === 502 || res.status === 503 || res.status === 504) {
					lastErr = `Railway edge ${res.status} — 재시도`;
				} else {
					lastErr = `HTTP ${res.status}`;
					break; // 502/503/504 외 에러는 재시도 안 함
				}
			} catch (e) {
				lastErr = e.message;
			}
			console.warn(`Imgur 업로드 실패 ${i + 1}/${delays.length}: ${lastErr}`);
		}
		throw new Error(`Imgur 업로드 실패: ${lastErr}`);
	}
}
