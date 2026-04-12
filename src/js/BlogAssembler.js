// BlogAssembler.js — 마크다운 → HTML 변환, 블로그 조립
class BlogAssembler {
	static markdownToHtml(md) {
		marked.setOptions({ breaks: true, gfm: true });

		const processed = md.replace(
			/<!--\s*IMAGE:\s*(\w+)\s*-->/g,
			'<div style="text-align:center;padding:16px 0;"><span style="background:#667eea22;border:1px dashed #667eea;border-radius:8px;padding:8px 20px;font-size:13px;color:#667eea;">🖼️ Image: $1</span></div>',
		);

		const html = marked.parse(processed);

		const bloggerStyles = `
<style>
  .blog-content h2 { font-size: 1.5em; margin: 1.5em 0 0.5em; padding-bottom: 0.3em; border-bottom: 2px solid #667eea; color: #333; }
  .blog-content h3 { font-size: 1.2em; margin: 1.2em 0 0.4em; color: #555; }
  .blog-content table { width: 100%; border-collapse: collapse; margin: 1em 0; font-size: 0.95em; }
  .blog-content th { background: #667eea; color: #fff; padding: 10px 14px; text-align: left; font-weight: 600; }
  .blog-content td { padding: 10px 14px; border: 1px solid #e0e0e0; }
  .blog-content tr:nth-child(even) { background: #f8f9ff; }
  .blog-content pre { background: #1e1e2e; color: #cdd6f4; padding: 16px 20px; border-radius: 10px; overflow-x: auto; font-size: 0.9em; line-height: 1.6; margin: 1em 0; }
  .blog-content code { font-family: 'Consolas', 'Monaco', monospace; }
  .blog-content p code { background: #f0f0f5; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; color: #e53e3e; }
  .blog-content blockquote { border-left: 4px solid #667eea; background: #f8f9ff; padding: 12px 20px; margin: 1em 0; border-radius: 0 8px 8px 0; color: #444; }
  .blog-content blockquote strong { color: #667eea; }
  .blog-content hr { border: none; border-top: 1px solid #e0e0e0; margin: 2em 0; }
  .blog-content ul, .blog-content ol { padding-left: 1.5em; margin: 0.8em 0; }
  .blog-content li { margin: 0.3em 0; line-height: 1.7; }
  .blog-content strong { color: #333; }
  .blog-content p { line-height: 1.8; margin: 0.8em 0; }
  .blog-content img { max-width: 100%; height: auto; border-radius: 12px; margin: 1.5em auto; display: block; box-shadow: 0 4px 20px rgba(0,0,0,0.15); }
</style>`;

		return `${bloggerStyles}<div class="blog-content">${html}</div>`;
	}

	static assemble(blog, prompts, images, imageUrls) {
		const introImg = images?.intro;
		const middleImg = images?.middle;
		const outroImg = images?.outro;
		const introUrl = imageUrls?.intro;
		const middleUrl = imageUrls?.middle;
		const outroUrl = imageUrls?.outro;

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
		const assembled = `${introBlock}\n\n${blog.front_half}\n\n${middleBlock}\n\n${blog.back_half}\n\n${outroBlock}`;

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
		const assembledPublish = `${introPub}\n\n${blog.front_half}\n\n${middlePub}\n\n${blog.back_half}\n\n${outroPub}`;

		// 평가용: 텍스트만
		const assembledText = `> 🖼️ ${prompts.intro_prompt}\n\n${blog.front_half}\n\n> 🖼️ ${prompts.middle_prompt}\n\n${blog.back_half}\n\n> 🖼️ ${prompts.outro_prompt}`;

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
