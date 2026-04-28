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

# 정적 자산 복사 (mp3/이미지 등 인라인 불가능한 파일)
import shutil
src_assets = f'{src}/assets'
if os.path.isdir(src_assets):
    dist_assets = f'{dist}/assets'
    if os.path.exists(dist_assets):
        shutil.rmtree(dist_assets)
    shutil.copytree(src_assets, dist_assets)
    asset_count = len(os.listdir(dist_assets))
    print(f'dist/assets/ ({asset_count} files)')

print(f'dist/index.html ({len(html):,} chars)')
