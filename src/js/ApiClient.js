// ApiClient.js — BizRouter API, 이미지 생성, Imgur 업로드
class ApiClient {
	static async callAgent(systemPrompt, userMessages, options = {}) {
		const messages = [
			{ role: "system", content: systemPrompt },
			...userMessages.map((m) => ({
				role: "user",
				content: typeof m === "string" ? m : JSON.stringify(m),
			})),
		];

		const body = {
			model: Config.MODEL,
			messages,
			temperature: options.temperature ?? 0.7,
			thinking_budget: options.thinking_budget ?? 0,
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

		const res = await fetch(Config.BIZROUTER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${Config.BIZROUTER_KEY}`,
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const err = await res.text();
			throw new Error(`API 오류 (${res.status}): ${err}`);
		}

		const data = await res.json();
		const content = data.choices[0].message.content;
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
					parsed = JSON.parse(jsonMatch[1].trim());
				} else {
					throw new Error(`JSON 파싱 실패: ${content.substring(0, 200)}`);
				}
			}
		} else {
			parsed = content;
		}

		return { data: parsed, usage };
	}

	static async generateImage(prompt, aspectRatio = "16:9") {
		try {
			const res = await fetch(Config.BIZROUTER_URL, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${Config.BIZROUTER_KEY}`,
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
			});

			if (!res.ok) {
				console.warn("이미지 API 응답 오류:", res.status);
				return null;
			}

			const data = await res.json();
			const content = data.choices?.[0]?.message?.content;

			if (Array.isArray(content)) {
				const img = content.find((c) => c.type === "image_url");
				if (img) return img.image_url.url;
			}
			return null;
		} catch (e) {
			console.warn("이미지 생성 예외:", e.message);
			return null;
		}
	}

	static async uploadToImgur(base64DataUrl) {
		try {
			const base64 = base64DataUrl.replace(/^data:image\/\w+;base64,/, "");
			const res = await fetch(Config.IMGUR_PROXY_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ image: base64 }),
			});
			if (!res.ok) return null;
			const data = await res.json();
			return data.link || null;
		} catch (e) {
			console.warn("Imgur 업로드 실패:", e.message);
			return null;
		}
	}
}
