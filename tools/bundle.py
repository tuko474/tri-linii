"""Собирает игру в один HTML-файл без npm (для быстрой проверки и тестовой ссылки).
Основная сборка для магазинов — через Vite (npm run build), см. README.

Запуск: tsc -p tsconfig.single.json && python3 tools/bundle.py
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_JS = ROOT / '.single'
ORDER = [
    'data/config.js', 'data/races.js', 'data/heroes.js', 'sim/map.js', 'sim/game.js', 'sim/bot.js', 'sim/draft.js', 'mqtt.js', 'net.js',
    'render/art.js', 'render/renderer.js', 'audio.js', 'main.js',
]

parts = []
for rel in ORDER:
    src = (OUT_JS / rel).read_text(encoding='utf-8')
    src = re.sub(r'^import[^;]*;\s*$', '', src, flags=re.M)
    src = re.sub(r'^export \{\s*\};?\s*$', '', src, flags=re.M)
    src = re.sub(r'^export (default )?', '', src, flags=re.M)
    parts.append(f'// ---- {rel} ----\n{src}')
js = '(() => {\n"use strict";\n' + '\n'.join(parts) + '\n})();'

html = (ROOT / 'index.html').read_text(encoding='utf-8')
css = (ROOT / 'src/style.css').read_text(encoding='utf-8')
body = html.split('<!--APP-->')[1].split('<!--/APP-->')[0]
fonts = re.search(r'<link rel="stylesheet" href="https://fonts[^>]*>', html).group(0)

# Полная страница (открыть в браузере телефона)
page = f'''<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
<title>Arena of Defense</title>{fonts}<style>{css}</style></head>
<body>{body}<script>{js}</script></body></html>'''
(ROOT / 'dist-single').mkdir(exist_ok=True)
(ROOT / 'dist-single/index.html').write_text(page, encoding='utf-8')

# Вариант для публикации тестовой ссылкой (обёртка doctype/head добавляется при публикации)
art = f'<title>Arena of Defense</title>\n{fonts}\n<style>{css}</style>\n{body}\n<script>{js}</script>\n'
(ROOT / 'dist-single/artifact.html').write_text(art, encoding='utf-8')
print('ok', len(page) // 1024, 'KB')
