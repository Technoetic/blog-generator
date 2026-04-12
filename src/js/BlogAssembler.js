// BlogAssembler.js — 마크다운 → HTML 변환, 블로그 조립
class BlogAssembler {
	static markdownToHtml(md) {
		marked.setOptions({ breaks: true, gfm: true });

		const processed = md.replace(
			/<!--\s*IMAGE:\s*(\w+)\s*-->/g,
			'<div style="text-align:center;padding:16px 0;"><span style="background:#667eea22;border:1px dashed #667eea;border-radius:8px;padding:8px 20px;font-size:13px;color:#667eea;">🖼️ Image: $1</span></div>',
		);

		// Blogger는 <style> 태그를 sanitize해서 CSS가 본문 텍스트로 노출됨.
		// 인라인 style 속성만 통과되므로 marked 출력 후 주요 태그에 직접 주입.
		// marked는 종종 align 같은 속성을 붙이므로 정규식이 속성 유무 모두 매칭해야 함.
		let html = marked.parse(processed);
		const inject = (tag, style) => {
			// <tag> 또는 <tag attr="..."> 둘 다 매칭. 이미 style 있으면 건드리지 않음.
			const re = new RegExp(`<${tag}(\\s+[^>]*)?>`, "g");
			html = html.replace(re, (match, attrs) => {
				if (match.includes("style=")) return match;
				return `<${tag}${attrs || ""} style="${style}">`;
			});
		};
		inject("h2", "font-size:1.5em;margin:1.5em 0 0.5em;padding-bottom:0.3em;border-bottom:2px solid #667eea;color:#333;");
		inject("h3", "font-size:1.2em;margin:1.2em 0 0.4em;color:#555;");
		inject("table", "width:100%;border-collapse:collapse;margin:1em 0;font-size:0.95em;");
		inject("th", "background:#667eea;color:#fff;padding:10px 14px;text-align:left;font-weight:600;border:1px solid #e0e0e0;");
		inject("td", "padding:10px 14px;border:1px solid #e0e0e0;");
		inject("pre", "background:#1e1e2e;color:#cdd6f4;padding:16px 20px;border-radius:10px;overflow-x:auto;font-size:0.9em;line-height:1.6;margin:1em 0;");
		inject("blockquote", "border-left:4px solid #667eea;background:#f8f9ff;padding:12px 20px;margin:1em 0;border-radius:0 8px 8px 0;color:#444;");
		inject("hr", "border:none;border-top:1px solid #e0e0e0;margin:2em 0;");
		inject("img", "max-width:100%;height:auto;border-radius:12px;margin:1.5em auto;display:block;box-shadow:0 4px 20px rgba(0,0,0,0.15);");
		inject("p", "line-height:1.8;margin:0.8em 0;");

		return `<div class="blog-content">${html}</div>`;
	}

	// 본문을 글자 수 중간점에서 가장 가까운 ## 또는 ### 헤딩으로 분할.
	// front_half/back_half 둘 다 비어있지 않도록 보장.
	static splitBody(body) {
		if (!body) return { front: "", back: "" };
		const lines = body.split("\n");
		// 헤딩 위치 수집
		const headingLines = [];
		for (let i = 0; i < lines.length; i++) {
			if (/^##\s/.test(lines[i]) || /^###\s/.test(lines[i])) {
				headingLines.push(i);
			}
		}
		if (headingLines.length === 0) {
			// 헤딩 없음 → 줄 중간에서 분할
			const mid = Math.floor(lines.length / 2);
			return {
				front: lines.slice(0, mid).join("\n"),
				back: lines.slice(mid).join("\n"),
			};
		}
		// 글자 수 중간점 계산
		const midChar = body.length / 2;
		let bestLine = headingLines[0];
		let bestDiff = Infinity;
		let charCount = 0;
		for (let i = 0; i < lines.length; i++) {
			if (headingLines.includes(i) && i > 0) {
				const diff = Math.abs(charCount - midChar);
				if (diff < bestDiff) {
					bestDiff = diff;
					bestLine = i;
				}
			}
			charCount += lines[i].length + 1;
		}
		return {
			front: lines.slice(0, bestLine).join("\n"),
			back: lines.slice(bestLine).join("\n"),
		};
	}

	static assemble(blog, prompts, images, imageUrls) {
		const introImg = images?.intro;
		const middleImg = images?.middle;
		const outroImg = images?.outro;
		const introUrl = imageUrls?.intro;
		const middleUrl = imageUrls?.middle;
		const outroUrl = imageUrls?.outro;

		// 신: blog.body 단일 필드. 구: front_half/back_half (호환).
		let front, back;
		if (blog.body) {
			const split = BlogAssembler.splitBody(blog.body);
			front = split.front;
			back = split.back;
		} else {
			front = blog.front_half || "";
			back = blog.back_half || "";
		}

		// 미리보기용: base64
		const introBlock = introImg
			? `![인트로](${introImg})`
			: `> 🖼️ ${prompts.intro_prompt}`;
		const middleBlock = middleImg
			? `![중간](${middleImg})`
			: `> 🖼️ ${prompts.middle_prompt}`;
		const outroBlock = outroImg
			? `![아웃트로](${outroImg})`
			: `> 🖼️ ${prompts.outro_prompt}`;
		const assembled = `${introBlock}\n\n${front}\n\n${middleBlock}\n\n${back}\n\n${outroBlock}`;

		// Blogger 발행용: Imgur URL
		const introPub = introUrl
			? `![인트로](${introUrl})`
			: `> 🖼️ ${prompts.intro_prompt}`;
		const middlePub = middleUrl
			? `![중간](${middleUrl})`
			: `> 🖼️ ${prompts.middle_prompt}`;
		const outroPub = outroUrl
			? `![아웃트로](${outroUrl})`
			: `> 🖼️ ${prompts.outro_prompt}`;
		const assembledPublish = `${introPub}\n\n${front}\n\n${middlePub}\n\n${back}\n\n${outroPub}`;

		// 평가용: 텍스트만
		const assembledText = `> 🖼️ ${prompts.intro_prompt}\n\n${front}\n\n> 🖼️ ${prompts.middle_prompt}\n\n${back}\n\n> 🖼️ ${prompts.outro_prompt}`;

		return { assembled, assembledPublish, assembledText };
	}

	static copyBlog(results) {
		navigator.clipboard
			.writeText(results.assembled || "")
			.then(() => alert("블로그가 클립보드에 복사되었습니다."));
	}

	static downloadAll(results) {
		const blob = new Blob([JSON.stringify(results, null, 2)], {
			type: "application/json",
		});
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `${results.contextPacket?.topic || "blog"}_results.json`;
		a.click();
	}
}
