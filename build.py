"""src/ → dist/index.html 번들러"""
import os

src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src')
dist = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'dist')
os.makedirs(dist, exist_ok=True)

with open(f'{src}/index.html', 'r', encoding='utf-8') as f:
    html = f.read()

# CSS 인라인
for f in sorted(os.listdir(f'{src}/css')):
    if f.endswith('.css'):
        with open(f'{src}/css/{f}', 'r', encoding='utf-8') as cf:
            css = cf.read()
        html = html.replace(f'<link rel="stylesheet" href="css/{f}">', f'<style>\n{css}\n</style>')

# JS 인라인
js_order = ['config.js','ApiClient.js','BlogAssembler.js','PipelineUI.js','AuthManager.js','Pipeline.js','app.js']
for js_file in js_order:
    tag = f'<script src="js/{js_file}"></script>'
    with open(f'{src}/js/{js_file}', 'r', encoding='utf-8') as jf:
        js = jf.read()
    html = html.replace(tag, f'<script>\n{js}\n</script>')

with open(f'{dist}/index.html', 'w', encoding='utf-8', newline='\n') as f:
    f.write(html)

print(f'dist/index.html ({len(html):,} chars)')
