// Точка входа: экраны меню → выбор → расстановка → бой → итог.
import { BAL, Difficulty, WORLD } from './data/config';
import { HEROES, heroById } from './data/heroes';
import { Renderer } from './render/renderer';
import { Bot, botPicks } from './sim/bot';
import { Game } from './sim/game';
import { LANE_NAMES, LANE_SHORT } from './sim/map';
import type { Hero, Pick } from './sim/types';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS = ['menu', 'how', 'pick', 'place', 'battle', 'result'];
function show(id: string) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

let difficulty: Difficulty = (store.get('tl-diff') as Difficulty) || 'normal';
let picked: string[] = (store.get('tl-picks') || '').split(',').filter((id) => HEROES.some((h) => h.id === id)).slice(0, 5);
let placement: Pick[] = [];

// ---------- меню ----------
function renderDiff() {
  const el = $('diff');
  el.innerHTML = '';
  (Object.keys(BAL.difficulty) as Difficulty[]).forEach((d) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(d === difficulty));
    b.textContent = BAL.difficulty[d].label;
    b.onclick = () => { difficulty = d; store.set('tl-diff', d); renderDiff(); };
    el.appendChild(b);
  });
}
renderDiff();
$('toPick').onclick = () => { renderCards(); show('pick'); };
$('howBtn').onclick = () => show('how');
$('howBack').onclick = () => show('menu');

// ---------- выбор героев ----------
function portrait(color: string, glyph: string) {
  return `<span class="portrait" style="background:${color}">${glyph}</span>`;
}
function renderCards() {
  const el = $('cards');
  el.innerHTML = '';
  for (const h of HEROES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'card';
    b.setAttribute('aria-pressed', String(picked.includes(h.id)));
    b.innerHTML = `
      <div class="card-head">${portrait(h.color, h.glyph)}<div><h3>${h.name}</h3><div class="role">${h.role}</div></div></div>
      <div class="nums"><span>HP ${h.hp}</span><span>урон ${h.dmg}</span><span>дальн. ${h.range}</span></div>
      <div class="skill"><b>${h.skill.name}.</b> ${h.skill.desc}</div>`;
    b.onclick = () => {
      if (picked.includes(h.id)) picked = picked.filter((x) => x !== h.id);
      else if (picked.length < 5) picked.push(h.id);
      renderCards();
    };
    el.appendChild(b);
  }
  $('pickCount').textContent = `${picked.length}/5`;
  $<HTMLButtonElement>('toPlace').disabled = picked.length !== 5;
}
$('pickBack').onclick = () => show('menu');
$('toPlace').onclick = () => {
  store.set('tl-picks', picked.join(','));
  const lanes = [0, 0, 1, 2, 2];
  const saved = store.get('tl-place');
  const prev: Pick[] = saved ? JSON.parse(saved) : [];
  placement = picked.map((id, i) => ({ heroId: id, lane: prev.find((p) => p.heroId === id)?.lane ?? lanes[i] }));
  if (!validPlacement()) placement = picked.map((id, i) => ({ heroId: id, lane: lanes[i] }));
  selectedChip = null;
  renderPlace();
  show('place');
};

// ---------- расстановка ----------
let selectedChip: string | null = null;
const laneCount = (l: number) => placement.filter((p) => p.lane === l).length;
const validPlacement = () => [0, 1, 2].every((l) => laneCount(l) >= 1 && laneCount(l) <= 3);

function renderPlace() {
  const el = $('laneCols');
  el.innerHTML = '';
  for (let l = 0; l < 3; l++) {
    const col = document.createElement('div');
    col.className = 'lane-col' + (selectedChip ? ' target' : '');
    col.setAttribute('role', 'button');
    col.tabIndex = 0;
    col.innerHTML = `<h3>${LANE_NAMES[l]}</h3><span class="n">${laneCount(l)} из 3</span>`;
    for (const p of placement.filter((x) => x.lane === l)) {
      const h = heroById(p.heroId);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hero-chip';
      chip.setAttribute('aria-pressed', String(selectedChip === h.id));
      chip.innerHTML = `${portrait(h.color, h.glyph)}<span>${h.name}</span>`;
      chip.onclick = (e) => {
        e.stopPropagation();
        selectedChip = selectedChip === h.id ? null : h.id;
        renderPlace();
      };
      col.appendChild(chip);
    }
    const moveHere = () => {
      if (!selectedChip) return;
      const p = placement.find((x) => x.heroId === selectedChip)!;
      if (p.lane !== l && laneCount(l) < 3) p.lane = l;
      selectedChip = null;
      renderPlace();
    };
    col.onclick = moveHere;
    col.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') moveHere(); };
    el.appendChild(col);
  }
  const ok = validPlacement();
  $('placeHint').textContent = ok ? [0, 1, 2].map(laneCount).join('–') : 'нужен герой на каждой линии';
  $<HTMLButtonElement>('startBattle').disabled = !ok;
}
$('placeBack').onclick = () => { renderCards(); show('pick'); };
$('startBattle').onclick = () => {
  store.set('tl-place', JSON.stringify(placement));
  startBattle();
};

// ---------- бой ----------
let game: Game | null = null;
let renderer: Renderer | null = null;
let bot: Bot | null = null;
let paused = false;
let speed = 1;
let selected: Hero | null = null;
let heroBtns: { h: Hero; cast: HTMLButtonElement; up: HTMLButtonElement; cdv: HTMLElement; mana: HTMLElement }[] = [];
let creepBtns: HTMLButtonElement[] = [];
const cv = $<HTMLCanvasElement>('cv');

function startBattle() {
  game = new Game([placement.map((p) => ({ ...p })), botPicks()], difficulty);
  game.autoCast[0] = store.get('tl-auto') === '1';
  bot = new Bot(1);
  renderer = new Renderer(cv, game);
  paused = false;
  speed = 1;
  selected = null;
  $('speedBtn').textContent = '×1';
  $('autoBtn').setAttribute('aria-pressed', String(game.autoCast[0]));
  $('pauseModal').hidden = true;
  $('toasts').innerHTML = '';
  buildPanel();
  show('battle');
  fit();
}

function buildPanel() {
  const g = game!;
  const hb = $('herobar');
  hb.innerHTML = '';
  heroBtns = [];
  const mine = g.heroes.filter((h) => h.side === 0).sort((a, b) => a.lane - b.lane);
  for (const h of mine) {
    const wrap = document.createElement('div');
    wrap.className = 'hb';
    const cast = document.createElement('button');
    cast.type = 'button';
    cast.className = 'hb-cast';
    cast.setAttribute('aria-label', `${h.def.name}: ${h.def.skill.name}`);
    cast.innerHTML = `${portrait(h.def.color, h.def.glyph)}<span>${h.def.name.split(' ')[0]}</span><span class="lname">${LANE_SHORT[h.lane]}</span><span class="cdv" hidden></span><span class="mana"></span>`;
    cast.onclick = () => {
      selected = h;
      const hp = g.heroPos(h);
      renderer?.focus(hp.x, hp.y);
      if (!g.cast(h)) pulse(cast);
    };
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn hb-up';
    up.onclick = () => { selected = h; g.levelHero(h); };
    wrap.append(cast, up);
    hb.appendChild(wrap);
    heroBtns.push({ h, cast, up, cdv: cast.querySelector('.cdv') as HTMLElement, mana: cast.querySelector('.mana') as HTMLElement });
  }
  const cb = $('creepbar');
  cb.innerHTML = '';
  creepBtns = [0, 1, 2].map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn cb';
    b.onclick = () => g.upgradeCreeps(l, 0);
    cb.appendChild(b);
    return b;
  });
}

function pulse(el: HTMLElement) {
  el.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 160 });
}

function syncPanel() {
  const g = game!;
  $('gold').textContent = String(Math.floor(g.gold[0]));
  $('myHp').style.width = (100 * g.throne[0]) / BAL.throneHp + '%';
  $('foeHp').style.width = (100 * g.throne[1]) / BAL.throneHp + '%';
  for (const b of heroBtns) {
    const { h } = b;
    const ready = g.canCast(h);
    b.cast.classList.toggle('ready', ready);
    b.cast.classList.toggle('sel', selected === h);
    if (h.dead) { b.cdv.hidden = false; b.cdv.textContent = '✝' + Math.ceil(h.respawn); }
    else if (h.cd > 0) { b.cdv.hidden = false; b.cdv.textContent = String(Math.ceil(h.cd)); }
    else b.cdv.hidden = true;
    b.mana.style.width = (100 * h.mana) / h.maxMana + '%';
    const maxed = h.lvl >= BAL.heroMaxLvl;
    const cost = g.heroUpCost(h);
    b.up.textContent = maxed ? `ур.${h.lvl} макс` : `ур.${h.lvl} ▲${cost}`;
    b.up.disabled = maxed || g.gold[0] < cost;
  }
  creepBtns.forEach((b, l) => {
    const lvl = g.creepLvl[l][0];
    const maxed = lvl >= BAL.creepMaxLvl;
    const cost = g.creepUpCost(l, 0);
    const html = `<span>Крипы · ${LANE_SHORT[l]}</span><small>ур. ${lvl} · у врага ${g.creepLvl[l][1]}</small><span class="cost">${maxed ? 'максимум' : '▲ ' + cost}</span>`;
    if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
    b.disabled = maxed || g.gold[0] < cost;
  });
  const m = Math.floor(g.t / 60);
  const s = Math.floor(g.t % 60);
  $('waveInfo').textContent = `${m}:${String(s).padStart(2, '0')} · волна ${g.waveNo} · следующая через ${Math.ceil(g.waveTimer)} с`;

  for (const e of g.events.splice(0)) {
    const t = document.createElement('div');
    t.className = 'toast ' + (e.side === 0 ? 'good' : 'bad');
    t.textContent = e.text;
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3100);
  }
}

function fit() {
  if (!renderer) return;
  const f = $('field');
  renderer.resize(f.clientWidth, f.clientHeight);
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const ms = mini.clientWidth || 116;
  mini.width = Math.round(ms * dpr);
  mini.height = Math.round(ms * dpr);
}
new ResizeObserver(fit).observe($('field'));

// ---------- камера: перетаскивание, щипок, колесо, миникарта ----------
const pts = new Map<number, { x: number; y: number }>();
let moved = 0;
let pinch = 0;
const local = (e: PointerEvent) => {
  const r = cv.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId);
  pts.set(e.pointerId, local(e));
  if (pts.size === 1) moved = 0;
  if (pts.size === 2) {
    const [a, b] = [...pts.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
    moved = 99;
  }
});
cv.addEventListener('pointermove', (e) => {
  if (!renderer || !pts.has(e.pointerId)) return;
  const prev = pts.get(e.pointerId)!;
  const cur = local(e);
  if (pts.size === 1) {
    moved += Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y);
    if (moved > 8) renderer.pan(cur.x - prev.x, cur.y - prev.y);
    pts.set(e.pointerId, cur);
  } else if (pts.size === 2) {
    const before = [...pts.values()];
    const midB = { x: (before[0].x + before[1].x) / 2, y: (before[0].y + before[1].y) / 2 };
    pts.set(e.pointerId, cur);
    const [a, b] = [...pts.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (pinch > 0 && d > 0) renderer.zoomAt(d / pinch, mid.x, mid.y);
    renderer.pan(mid.x - midB.x, mid.y - midB.y);
    pinch = d;
  }
});
const endPtr = (e: PointerEvent) => {
  if (!pts.has(e.pointerId)) return;
  const wasTap = pts.size === 1 && moved <= 8;
  pts.delete(e.pointerId);
  if (pts.size < 2) pinch = 0;
  if (!wasTap || !renderer || !game || e.type === 'pointercancel') return;
  const p = local(e);
  const w = renderer.toWorld(p.x, p.y);
  const h = renderer.heroAt(w.x, w.y);
  selected = h && h.side === 0 ? h : null;
};
cv.addEventListener('pointerup', endPtr);
cv.addEventListener('pointercancel', endPtr);
cv.addEventListener('wheel', (e) => {
  if (!renderer) return;
  e.preventDefault();
  const p = local(e as unknown as PointerEvent);
  renderer.zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
}, { passive: false });

const mini = $<HTMLCanvasElement>('mini');
const miniCtx = mini.getContext('2d')!;
let miniDrag = false;
const miniJump = (e: PointerEvent) => {
  if (!renderer) return;
  const r = mini.getBoundingClientRect();
  const k = WORLD.W / r.width;
  renderer.jump((e.clientX - r.left) * k, (e.clientY - r.top) * k);
};
mini.addEventListener('pointerdown', (e) => { miniDrag = true; mini.setPointerCapture(e.pointerId); miniJump(e); });
mini.addEventListener('pointermove', (e) => { if (miniDrag) miniJump(e); });
mini.addEventListener('pointerup', () => { miniDrag = false; });
mini.addEventListener('pointercancel', () => { miniDrag = false; });

$('autoBtn').onclick = () => {
  if (!game) return;
  game.autoCast[0] = !game.autoCast[0];
  store.set('tl-auto', game.autoCast[0] ? '1' : '0');
  $('autoBtn').setAttribute('aria-pressed', String(game.autoCast[0]));
};
$('speedBtn').onclick = () => { speed = speed === 1 ? 2 : 1; $('speedBtn').textContent = '×' + speed; };
$('pauseBtn').onclick = () => { paused = true; $('pauseModal').hidden = false; };
$('resume').onclick = () => { paused = false; $('pauseModal').hidden = true; };
$('surrender').onclick = () => { if (game) { game.winner = 1; } $('pauseModal').hidden = true; paused = false; };
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game && game.winner === null && !$('battle').hidden) { paused = true; $('pauseModal').hidden = false; }
});

function finish() {
  const g = game!;
  const win = g.winner === 0;
  $('resTitle').textContent = win ? 'Победа' : 'Поражение';
  $('resText').textContent = win ? 'Вражеский трон разрушен.' : 'Твой трон пал. Попробуй другую расстановку.';
  const m = Math.floor(g.t / 60);
  const s = Math.floor(g.t % 60);
  const myLvl = g.heroes.filter((h) => h.side === 0).reduce((a, h) => a + h.lvl, 0);
  $('resStats').innerHTML = `
    <dt>Длительность</dt><dd>${m}:${String(s).padStart(2, '0')}</dd>
    <dt>Убито крипов</dt><dd>${g.stats.kills[0]}</dd>
    <dt>Продавлено линий</dt><dd>${g.stats.pushes[0]}</dd>
    <dt>Сумма уровней героев</dt><dd>${myLvl}</dd>
    <dt>Заработано золота</dt><dd>${Math.round(g.stats.goldEarned[0])}</dd>`;
  if (win) store.set('tl-wins', String(Number(store.get('tl-wins') || 0) + 1));
  game = null;
  show('result');
}
$('again').onclick = () => startBattle();
$('toMenu').onclick = () => show('menu');

// ---------- цикл ----------
const STEP = 1 / 30;
let acc = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (game && renderer && bot) {
    if (!paused && game.winner === null) {
      acc += dt * speed;
      while (acc >= STEP) {
        bot.update(game, STEP);
        game.update(STEP);
        acc -= STEP;
      }
    }
    renderer.selected = selected;
    renderer.draw(dt);
    renderer.drawMinimap(miniCtx, mini.clientWidth || 116, Math.min(2.5, window.devicePixelRatio || 1));
    syncPanel();
    if (game.winner !== null) finish();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
show('menu');
