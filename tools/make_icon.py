"""Иконка приложения и заставка из того же рисунка замка, что в игре.

Запуск (нужны python-пакет playwright и chromium: pip install playwright && playwright install chromium):
    npx tsc -p tsconfig.single.json && python3 tools/bundle.py && python3 tools/make_icon.py

Пишет в assets/: icon-foreground.png, icon-background.png, icon-only.png (1024×1024),
splash.png и splash-dark.png (2732×2732). Из них сборка в GitHub Actions делает иконки Android.
"""
import asyncio
import base64
import pathlib

from playwright.async_api import async_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / 'dist-single' / 'index.html'
OUT = ROOT / 'assets'

# Рисование внутри страницы игры: window.__castle — та же функция, что рисует трон в бою.
JS = r"""
() => {
  const TEAL = '#5fd4c4', TEAL_D = '#1f6f68', GOLD = '#f3d27a';
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  // фон: ночное небо, золотое сияние за замком, звёзды
  function background(c, S) {
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 0, S);
    g.addColorStop(0, '#2b2457');
    g.addColorStop(1, '#120f22');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const r = x.createRadialGradient(S / 2, S * 0.45, 0, S / 2, S * 0.45, S * 0.4);
    r.addColorStop(0, 'rgba(243,210,122,.55)');
    r.addColorStop(0.45, 'rgba(243,210,122,.16)');
    r.addColorStop(1, 'rgba(243,210,122,0)');
    x.fillStyle = r; x.fillRect(0, 0, S, S);
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    x.fillStyle = 'rgba(255,245,220,.8)';
    for (let i = 0; i < 40; i++) {
      const px = rnd() * S, py = rnd() * S * 0.55, pr = (0.6 + rnd() * 1.6) * S / 1024;
      if (Math.hypot(px - S / 2, py - S * 0.48) < S * 0.3) continue;
      x.beginPath(); x.arc(px, py, pr, 0, 7); x.fill();
    }
  }

  // замок на зелёном холме; cx,cy — центр замка, k — масштаб
  function castle(x, cx, cy, k) {
    x.save();
    x.translate(cx, cy);
    x.scale(k, k);
    // холм
    x.fillStyle = '#2f4a33';
    x.strokeStyle = '#14121c'; x.lineWidth = 3;
    x.beginPath(); x.ellipse(0, 50, 128, 26, 0, 0, 7); x.fill(); x.stroke();
    x.fillStyle = '#36553a';
    x.beginPath(); x.ellipse(-20, 44, 90, 12, 0, 0, 7); x.fill();
    __castle(x, TEAL, TEAL_D, 0, false);
    x.restore();
  }

  const S = 1024;
  // передний слой адаптивной иконки: Android может обрезать края, держим рисунок в центральных ~60%
  const fg = mk(S, S);
  castle(fg.getContext('2d'), S / 2, S / 2 + 48 * 1.95, 1.95); // 48 — середина рисунка по высоте
  const bg = mk(S, S);
  background(bg, S);
  const only = mk(S, S);
  { const x = only.getContext('2d'); x.drawImage(bg, 0, 0); castle(x, S / 2, S / 2 + 48 * 3.1, 3.1); }

  // заставка: замок и название
  function splash() {
    const Z = 2732, c = mk(Z, Z), x = c.getContext('2d');
    x.fillStyle = '#17142a'; x.fillRect(0, 0, Z, Z);
    const r = x.createRadialGradient(Z / 2, Z * 0.44, 0, Z / 2, Z * 0.44, 520);
    r.addColorStop(0, 'rgba(243,210,122,.35)');
    r.addColorStop(1, 'rgba(243,210,122,0)');
    x.fillStyle = r; x.fillRect(0, 0, Z, Z);
    castle(x, Z / 2, Z * 0.45, 2.2);
    x.fillStyle = GOLD;
    x.font = '700 150px Georgia, "Times New Roman", serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('Arena of Defense', Z / 2, Z * 0.62);
    return c;
  }
  const sp = splash();
  const url = (c) => c.toDataURL('image/png');
  return { fg: url(fg), bg: url(bg), only: url(only), splash: url(sp) };
}
"""


async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page()
        await pg.goto(PAGE.as_uri() + '#debug')
        await pg.wait_for_function('() => window.__castle')
        res = await pg.evaluate(JS)
        await b.close()
    files = {
        'icon-foreground.png': res['fg'],
        'icon-background.png': res['bg'],
        'icon-only.png': res['only'],
        'splash.png': res['splash'],
        'splash-dark.png': res['splash'],
    }
    for name, url in files.items():
        (OUT / name).write_bytes(base64.b64decode(url.split(',', 1)[1]))
        print('записано', OUT / name)


asyncio.run(main())
