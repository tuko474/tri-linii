// Точка входа: меню → (лобби) → драфт → расстановка → бой → итог.
import { BAL, Difficulty, WORLD } from './data/config';
import { HEROES, HeroDef, STARTER_IDS, heroById } from './data/heroes';
import { RACES, RACE_IDS, RaceId, tierIndex } from './data/races';
import { portraitURL, raceURL, skillURL, skill2URL, drawCastleFigure, STICKERS, stickerURL } from './render/art';
import { Sound } from './audio';
import { Renderer, clock } from './render/renderer';
import { Bot } from './sim/bot';
import { Draft, PICK_SECONDS, botDraftPick, botPlacement, randomPick } from './sim/draft';
import { Game } from './sim/game';
import { LANE_NAMES, LANE_SHORT } from './sim/map';
import type { Hero, Pick, Side } from './sim/types';
import { Link, hostRoom, joinRoom, netMode, newRoomCode } from './net';
import { BUILD, PROTO, Daily, Ended, Online, serverUrl } from './online';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS = ['menu', 'how', 'stickers', 'daily', 'races', 'pick', 'lobby', 'account', 'queue', 'draft', 'place', 'battle', 'result'];
function show(id: string) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

let difficulty: Difficulty = (store.get('tl-diff') as Difficulty) || 'normal';
/** Сложность бота в этом бою: вместо соперника из рейтинга — всегда обычная. */
const gameDiff = (): Difficulty => (botRanked ? 'normal' : difficulty);
// ---------- прогресс игрока: кристаллы и открытые герои ----------
function parseJSON(v: string | null): unknown { try { return v ? JSON.parse(v) : null; } catch { return null; } }
/** Звёзды из хранилища или с сервера: только известные герои, целые 1..5. */
function cleanStars(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && typeof v === 'object') for (const [id, n] of Object.entries(v as Record<string, unknown>)) {
    const k = Math.floor(Number(n));
    if (HEROES.some((h) => h.id === id) && k > 0) out[id] = Math.min(BAL.stars.max, k);
  }
  return out;
}

const meta = {
  crystals: Number(store.get('tl-crystals') ?? 300), // стартовый подарок, чтобы сразу открыть одного героя
  owned: new Set<string>([...STARTER_IDS, ...(store.get('tl-owned') || '').split(',').filter((id) => HEROES.some((h) => h.id === id))]),
  /** Звёзды героев 0..5 (прокачка за кристаллы). */
  stars: cleanStars(parseJSON(store.get('tl-stars'))),
  starsOf(id: string): number { return this.stars[id] ?? 0; },
  /** Купленные стикеры (бесплатные доступны всегда). */
  stickers: new Set<string>((store.get('tl-stickers') || '').split(',').filter((id) => STICKERS.some((x) => x.id === id))),
  hasSticker(id: string): boolean { return this.stickers.has(id) || STICKERS.find((x) => x.id === id)?.price === 0; },
  save() {
    store.set('tl-stickers', [...this.stickers].join(','));
    store.set('tl-crystals', String(this.crystals));
    store.set('tl-owned', [...this.owned].join(','));
    store.set('tl-stars', JSON.stringify(this.stars));
    // с аккаунтом прогресс ведёт сервер: покупки идут туда (buy), кристаллы начисляет он же
  },
};
const online = new Online();
const crystalsText = () => `✦ ${meta.crystals}`;
function syncCrystals() {
  $('crystalsMenu').textContent = `${crystalsText()} кристаллов · открыто героев: ${meta.owned.size} из ${HEROES.length}`;
  $('crystalsPick').textContent = crystalsText();
}

// ---------- режим матча ----------
/** bot — против бота; host/guest — по сети. me — за какую сторону играем. */
let mode: 'bot' | 'host' | 'guest' = 'bot';
let me: Side = 0;
const foe = () => (1 - me) as Side;
let link: Link | null = null;
let foeOwned: string[] = [];
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
syncCrystals();
$('toPick').onclick = () => {
  botRanked = null;
  mode = 'bot';
  me = 0;
  startDraft(Math.random() < 0.5 ? 0 : 1);
};
$('toHeroes').onclick = () => { renderCards(); show('pick'); };
$('toLobby').onclick = () => {
  // есть сервер, но нет аккаунта — сначала аккаунт
  if (online.configured && online.ready && !online.me) { openAccount('Создай аккаунт, чтобы играть онлайн.'); return; }
  resetLobby();
  show('lobby');
};
$('howBtn').onclick = () => show('how');
$('toStickers').onclick = () => { renderStickerShop(); show('stickers'); };
$('stickersBack').onclick = () => { syncCrystals(); show('menu'); };

// ---------- стикеры: коллекция и покупка ----------
function renderStickerShop() {
  $('crystalsStickers').textContent = crystalsText();
  const el = $('stickerGrid');
  el.innerHTML = '';
  for (const st of STICKERS) {
    const have = meta.hasSticker(st.id);
    const card = document.createElement('div');
    card.className = 'stk-card' + (have ? '' : ' locked');
    card.innerHTML = `<img src="${stickerURL(st.id, 112)}" alt="${st.name}">`
      + (have ? `<span class="stk-tag">${st.price ? 'Куплен' : 'Бесплатно'}</span>`
        : `<button type="button" class="btn buy" ${meta.crystals < st.price ? 'disabled' : ''}>✦ ${st.price}</button>`);
    card.querySelector('.buy')?.addEventListener('click', () => {
      if (!purchase('sticker', st.id, st.price, () => meta.stickers.add(st.id))) { sound.play('deny'); return; }
      sound.play('levelUp');
      toast(`Стикер «${st.name}» теперь твой`, 'good');
      renderStickerShop();
    });
    el.appendChild(card);
  }
}

$('toDaily').onclick = () => { renderDaily(); show('daily'); };
$('dailyBack').onclick = () => show('menu');

// ---------- задания дня и награда за вход ----------
let dailyAt = 0; // когда пришли данные (для обратного отсчёта до нового дня)
function dailyData(): Daily | null {
  return online.me?.daily ?? null;
}
/** Есть что забрать — точка на кнопке «Задания». */
function renderDailyDot() {
  const d = dailyData();
  $('dailyDot').hidden = !d || !(d.login.can || d.quests.some((q) => !q.claimed && q.have >= q.need));
}
function renderDaily() {
  const d = dailyData();
  $('crystalsDaily').textContent = crystalsText();
  const body = $('dailyBody');
  if (!online.me) {
    $('dailyHint').textContent = 'Задания и награды за вход — для игроков с аккаунтом. Создай его в меню (кнопка справа вверху).';
    body.innerHTML = '';
    return;
  }
  if (!d) {
    $('dailyHint').textContent = online.ready ? 'Сервер ещё не обновлён — заданий пока нет.' : 'Нет связи с сервером.';
    body.innerHTML = '';
    return;
  }
  const left = Math.max(0, d.resetIn - (Date.now() - dailyAt));
  const hh = Math.floor(left / 3600000), mm = Math.floor((left % 3600000) / 60000);
  $('dailyHint').textContent = `Новые задания через ${hh} ч ${mm} мин. Задания засчитываются в боях по сети (рейтинг и с другом), не короче 3 минут.`;
  const cells = d.login.rewards.map((r, i) => {
    const n = i + 1;
    const got = d.login.can ? n < d.login.day : n <= d.login.day;
    const today = d.login.can && n === d.login.day;
    return `<div class="lg${got ? ' got' : ''}${today ? ' today' : ''}${n === 7 ? ' big' : ''}"><small>День ${n}</small><b>✦ ${r}</b>${got ? '<i>✓</i>' : ''}</div>`;
  }).join('');
  const login = `<div class="daily-card"><h3>Награда за вход</h3><p class="hint">Заходи каждый день — награда растёт к 7-му дню. Пропустишь день — цепочка начнётся заново.</p>
    <div class="login-row">${cells}</div>
    ${d.login.can ? `<button type="button" class="btn primary big" id="claimLogin">Забрать ✦ ${d.login.rewards[d.login.day - 1]}</button>` : '<p class="hint done">Сегодняшняя награда получена — приходи завтра.</p>'}</div>`;
  const quests = d.quests.map((q) => {
    const ready = !q.claimed && q.have >= q.need;
    return `<div class="quest${q.claimed ? ' claimed' : ''}${ready ? ' ready' : ''}">
      <div class="q-text"><b>${q.text}</b><span class="q-bar"><i style="width:${(100 * q.have) / q.need}%"></i></span><small>${q.have} / ${q.need}</small></div>
      ${q.claimed ? '<span class="q-done">✓ Получено</span>' : `<button type="button" class="btn ${ready ? 'primary' : 'ghost'} q-claim" data-q="${q.id}" ${ready ? '' : 'disabled'}>✦ ${q.reward}</button>`}
    </div>`;
  }).join('');
  body.innerHTML = login + `<div class="daily-card"><h3>Задания дня</h3>${quests}</div>`;
  $('claimLogin')?.addEventListener('click', () => { online.send({ t: 'claimLogin' }); sound.play('tap'); });
  body.querySelectorAll<HTMLButtonElement>('.q-claim').forEach((b) => b.addEventListener('click', () => { online.send({ t: 'claimQuest', id: b.dataset.q }); sound.play('tap'); }));
}
online.on('claimed', (m: { what: string; day?: number; crystals: number }) => {
  toast(m.what === 'login' ? `Награда за вход (день ${m.day}): +✦ ${m.crystals}` : `Задание выполнено: +✦ ${m.crystals}`, 'good');
  sound.play('coins');
});

// замок на главном экране — тот же рисунок, что трон в бою
{
  const cv = document.createElement('canvas');
  cv.width = 340; cv.height = 300;
  const x = cv.getContext('2d')!;
  const glow = x.createRadialGradient(170, 150, 10, 170, 150, 150);
  glow.addColorStop(0, 'rgba(243,210,122,.35)');
  glow.addColorStop(1, 'rgba(243,210,122,0)');
  x.fillStyle = glow; x.fillRect(0, 0, 340, 300);
  x.translate(170, 210); x.scale(1.45, 1.45);
  x.fillStyle = '#2f4a33'; x.strokeStyle = '#14121c'; x.lineWidth = 3;
  x.beginPath(); x.ellipse(0, 46, 110, 20, 0, 0, 7); x.fill(); x.stroke();
  drawCastleFigure(x, '#5fd4c4', '#1f6f68', 0, false);
  $<HTMLImageElement>('menuCastle').src = cv.toDataURL();
}
$('toRaces').onclick = () => { renderRaces(); show('races'); };
$('racesBack').onclick = () => show('menu');

/** Версия игры: в APK её вписывает сборка (meta app-version). */
const APP_VERSION = document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content || 'dev';
$('version').textContent = `Версия ${APP_VERSION === 'dev' ? 'для разработки' : APP_VERSION}`;

/** Есть ли на GitHub сборка новее установленной — тогда на главном экране плашка со ссылкой на APK. */
/** Сборка для магазина: обновления приходят через магазин, а не с GitHub (правило RuStore). */
const STORE = document.querySelector<HTMLMetaElement>('meta[name="app-store"]')?.content || '';
async function checkUpdate() {
  if (STORE) return;
  const cur = Number(APP_VERSION.split('.')[2]);
  if (!cur) return; // версия для разработки
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://api.github.com/repos/tuko474/tri-linii/releases/latest', { signal: ctl.signal, headers: { Accept: 'application/vnd.github+json' } });
    clearTimeout(timer);
    if (!r.ok) return;
    const rel = await r.json() as { tag_name?: string; assets?: { name: string; browser_download_url: string }[] };
    const n = Number(/^build-(\d+)$/.exec(rel.tag_name ?? '')?.[1]);
    if (!n || n <= cur) return;
    const ver = `0.1.${n}`;
    const file = rel.assets?.find((a) => a.name === `tri-linii-${ver}.apk`);
    const bar = $<HTMLAnchorElement>('updateBar');
    bar.href = file?.browser_download_url ?? `https://github.com/tuko474/tri-linii/releases/download/build-${n}/tri-linii-${ver}.apk`;
    bar.innerHTML = `Вышла версия ${ver} <b>Скачать</b>`;
    bar.hidden = false;
  } catch { /* нет сети или GitHub недоступен — молчим */ }
}
void checkUpdate();
$('howBack').onclick = () => show('menu');

// ---------- общие куски интерфейса ----------
function portrait(def: HeroDef) {
  return `<img class="portrait" src="${portraitURL(def)}" alt="">`;
}

/** Плашки рас с количеством и уровнем бонуса. */
function synergyHTML(counts: Partial<Record<RaceId, number>>, compact = false) {
  return RACE_IDS.filter((r) => (counts[r] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))
    .map((r) => {
      const n = counts[r] ?? 0;
      const ti = tierIndex(r, n);
      const next = RACES[r].tiers[ti + 1];
      const cur = ti >= 0 ? RACES[r].tiers[ti].text : `Бонус с ${RACES[r].tiers[0].n}`;
      const dots = RACES[r].tiers.map((t, i) => `<i class="${i <= ti ? 'on' : ''}">${t.n}</i>`).join('');
      return `<button type="button" class="syn ${ti >= 0 ? 'active' : ''}" data-race="${r}" style="--rc:${RACES[r].color}" title="${cur}">
        <img src="${raceURL(r)}" alt=""><b>${n}</b>${compact ? '' : `<span class="syn-name">${RACES[r].name}</span><span class="dots">${dots}</span>`}
        ${compact ? '' : `<small>${cur}${next ? ` · дальше с ${next.n}` : ''}</small>`}</button>`;
    })
    .join('');
}
function countsOf(ids: string[]): Partial<Record<RaceId, number>> {
  const c: Partial<Record<RaceId, number>> = {};
  for (const id of ids) { const r = heroById(id).race; c[r] = (c[r] ?? 0) + 1; }
  return c;
}

// ---------- расы: описание бонусов ----------
/** Бонусы расы списком: «2 героя: …», «4 героя: …». */
function raceTiersHTML(r: RaceId): string {
  return RACES[r].tiers.map((t) => `<li><b>${t.n} ${t.n < 5 ? 'героя' : 'героев'}:</b> ${t.text}</li>`).join('');
}

/** Что даст герой расе твоей команды в драфте — одна строка. */
function raceHint(id: string, team: string[]): string {
  const r = heroById(id).race;
  const race = RACES[r];
  const n = team.filter((x) => heroById(x).race === r).length + (team.includes(id) ? 0 : 1);
  const tier = race.tiers.find((t) => t.n === n);
  const next = race.tiers.find((t) => t.n > n);
  const head = `<span class="race-line" style="color:${race.color}">${race.name}</span>`;
  if (tier) return `${head}: с ним будет ${n} — включится: ${tier.text}.`;
  if (next) return `${head}: с ним ${n} из ${next.n} — бонус: ${next.text}.`;
  return `${head}: с ним ${n} — максимальный бонус уже действует.`;
}

function renderRaces() {
  const el = $('raceList');
  el.innerHTML = RACE_IDS.map((r) => {
    const race = RACES[r];
    const heroes = HEROES.filter((h) => h.race === r).map((h) =>
      `<span class="rh${meta.owned.has(h.id) ? '' : ' locked'}"><img src="${portraitURL(h, 64)}" alt="">${h.name}</span>`).join('');
    return `<div class="race-card" style="--rc:${race.color}">
      <h3><img src="${raceURL(r, 48)}" alt="">${race.name}</h3>
      <ul class="race-tiers">${raceTiersHTML(r)}</ul>
      <div class="race-heroes">${heroes}</div>
    </div>`;
  }).join('');
}

// ---------- коллекция героев (просмотр и покупка) ----------
/** Покупка за кристаллы. С аккаунтом — через сервер (он проверит цену и пришлёт свежий профиль), без — в телефоне. */
function purchase(what: 'hero' | 'star' | 'sticker', id: string, cost: number, apply: () => void): boolean {
  if (meta.crystals < cost) return false;
  if (online.me && !online.ready) { toast('Нет связи с сервером — покупка не прошла', 'bad'); return false; }
  meta.crystals -= cost; // сразу показываем, сервер потом пришлёт точные цифры
  apply();
  meta.save();
  if (online.me) online.send({ t: 'buy', what, id });
  return true;
}

/** Ряд звёзд героя: закрашенные и пустые. */
function starsHTML(n: number, small = false): string {
  return `<span class="stars${small ? ' small' : ''}" aria-label="${n} из ${BAL.stars.max} звёзд">${Array.from({ length: BAL.stars.max }, (_, i) => `<i class="${i < n ? 'on' : ''}">★</i>`).join('')}</span>`;
}
/** Чем помогают звёзды: одной строкой. */
function starBonusText(n: number): string {
  return `+${Math.round(n * BAL.stars.hp * 100)}% HP и урона, +${Math.round(n * BAL.stars.spell * 100)}% к силе способностей`;
}

function renderCards() {
  syncCrystals();
  const el = $('cards');
  el.innerHTML = '';
  const order = [...HEROES].sort((a, b) => RACE_IDS.indexOf(a.race) - RACE_IDS.indexOf(b.race) || Number(meta.owned.has(b.id)) - Number(meta.owned.has(a.id)));
  let lastRace: RaceId | null = null;
  for (const h of order) {
    if (h.race !== lastRace) {
      lastRace = h.race;
      const hd = document.createElement('div');
      hd.className = 'race-head';
      hd.style.setProperty('--rc', RACES[h.race].color);
      hd.innerHTML = `<h3><img src="${raceURL(h.race, 40)}" alt="">${RACES[h.race].name}</h3><ul class="race-tiers">${raceTiersHTML(h.race)}</ul>`;
      el.appendChild(hd);
    }
    const owned = meta.owned.has(h.id);
    const st = meta.starsOf(h.id);
    const upCost = BAL.stars.cost[st] ?? 0;
    const b = document.createElement('div');
    b.className = 'card' + (owned ? '' : ' locked') + (st >= BAL.stars.max ? ' maxed' : '');
    const race = RACES[h.race];
    b.innerHTML = `
      <div class="card-head">${portrait(h)}<div><h3>${h.name}</h3><div class="role">${h.role}</div>
        <span class="race-tag" style="--rc:${race.color}"><img src="${raceURL(h.race, 40)}" alt="">${race.name}</span></div></div>
      <div class="star-line">${starsHTML(st)}<small>${st ? starBonusText(st) : owned ? 'звёзды усиливают героя' : ''}</small></div>
      <div class="nums"><span>HP ${Math.round(h.hp * (1 + BAL.stars.hp * st))}</span><span>урон ${Math.round(h.dmg * (1 + BAL.stars.dmg * st))}</span><span>дальн. ${h.range}</span></div>
      <div class="skill"><img class="skill-ico" src="${skillURL(h)}" alt=""><span><b>${h.skill.name}.</b> ${h.skill.desc}</span></div>
      <div class="skill skill2${st >= BAL.stars.max ? '' : ' off'}"><img class="skill-ico" src="${skill2URL(h)}" alt=""><span><b>${h.skill2.name}.</b> ${h.skill2.desc}. ${st >= BAL.stars.max ? `Срабатывает сама, раз в ${h.skill2.cd} с.` : `<em>Откроется на ${BAL.stars.max}★.</em>`}</span></div>
      ${!owned ? `<button type="button" class="btn buy" ${meta.crystals < h.price ? 'disabled' : ''}>Открыть за ✦ ${h.price}</button>`
        : st >= BAL.stars.max ? '<span class="owned-tag">5★ — максимум</span>'
        : `<button type="button" class="btn star-up" ${meta.crystals < upCost ? 'disabled' : ''}>Звезда ${st + 1}★ за ✦ ${upCost}</button>`}`;
    const buy = b.querySelector('.buy') as HTMLButtonElement | null;
    if (buy) buy.onclick = () => {
      if (!purchase('hero', h.id, h.price, () => meta.owned.add(h.id))) return;
      sound.play('levelUp');
      renderCards();
    };
    const up = b.querySelector('.star-up') as HTMLButtonElement | null;
    if (up) up.onclick = () => {
      const cur = meta.starsOf(h.id);
      const cost = BAL.stars.cost[cur];
      if (cost === undefined || !purchase('star', h.id, cost, () => { meta.stars[h.id] = cur + 1; })) return;
      sound.play('levelUp');
      const y = $('pick').scrollTop;
      renderCards();
      $('pick').scrollTop = y;
      if (cur + 1 === BAL.stars.max) toast(`${h.name}: 5★! Открыта вторая способность «${h.skill2.name}»`, 'good');
    };
    el.appendChild(b);
  }
}
$('pickBack').onclick = () => { syncCrystals(); show('menu'); };

// ---------- лобби: игра с другом ----------
function lobbyStatus(text: string, err = false) {
  const el = $('lobbyStatus');
  el.textContent = text;
  el.classList.toggle('err', err);
}
function resetLobby() {
  $('roomCode').hidden = true;
  $<HTMLButtonElement>('hostBtn').disabled = false;
  $<HTMLButtonElement>('joinBtn').disabled = false;
  lobbyStatus(netMode() === 'net'
    ? 'Оба телефона должны быть в интернете. Лучше всего — в одной Wi-Fi сети.'
    : 'Проверочный режим: сеть работает в установленном приложении. Здесь можно открыть игру в двух вкладках.');
}
$('lobbyBack').onclick = () => { link?.close(); link = null; if (useServer()) online.send({ t: 'leaveRoom' }); show('menu'); };
$('hostBtn').onclick = async () => {
  if (useServer()) {
    $<HTMLButtonElement>('hostBtn').disabled = true;
    $<HTMLButtonElement>('joinBtn').disabled = true;
    lobbyStatus('Создаём комнату…');
    online.send({ t: 'host' });
    return;
  }
  const code = newRoomCode();
  $<HTMLButtonElement>('hostBtn').disabled = true;
  $<HTMLButtonElement>('joinBtn').disabled = true;
  $('roomCode').hidden = false;
  $('roomCode').textContent = code;
  try {
    const l = await hostRoom(code, (s) => lobbyStatus(s));
    onConnected(l, 'host');
  } catch (e) {
    lobbyStatus((e as Error).message, true);
    $<HTMLButtonElement>('hostBtn').disabled = false;
    $<HTMLButtonElement>('joinBtn').disabled = false;
    $('roomCode').hidden = true;
  }
};
$('joinCode').addEventListener('input', () => {
  const i = $<HTMLInputElement>('joinCode');
  i.value = i.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
});
$('joinBtn').onclick = async () => {
  const code = $<HTMLInputElement>('joinCode').value.trim().toUpperCase();
  if (code.length !== 4) { lobbyStatus('Введи код из 4 символов', true); return; }
  if (useServer()) {
    $<HTMLButtonElement>('hostBtn').disabled = true;
    $<HTMLButtonElement>('joinBtn').disabled = true;
    lobbyStatus('Ищем комнату…');
    online.send({ t: 'join', code });
    return;
  }
  $<HTMLButtonElement>('hostBtn').disabled = true;
  $<HTMLButtonElement>('joinBtn').disabled = true;
  try {
    const l = await joinRoom(code, (s) => lobbyStatus(s));
    onConnected(l, 'guest');
  } catch (e) {
    lobbyStatus((e as Error).message, true);
    $<HTMLButtonElement>('hostBtn').disabled = false;
    $<HTMLButtonElement>('joinBtn').disabled = false;
  }
};

function onConnected(l: Link, role: 'host' | 'guest') {
  link = l;
  mode = role;
  me = role === 'host' ? 0 : 1;
  foeOwned = [];
  lobbyStatus('Соперник найден!');
  netLost = false;
  l.onMessage = onNet;
  l.onStatus = (ok) => {
    netLost = !ok;
    if (!ok) { toast('Связь с соперником прервалась — переподключаемся…', 'bad'); return; }
    toast('Связь восстановлена', 'good');
    // на время обрыва таймер выбора не должен съедать ход
    if (draft && !draft.done) {
      pickDeadline = performance.now() + PICK_SECONDS * 1000;
      if (mode === 'host') link?.send({ t: 'draft', picks: draft.picks, left: PICK_SECONDS });
    }
  };
  l.onClose = () => {
    link = null;
    if (game && game.winner === null && (mode === 'host' || mode === 'guest')) {
      netLost = false;
      if (lastEnded && lastEnded.winner === me) {
        game.winner = me;
        toast('Соперник покинул бой — победа за тобой', 'good');
        finish();
      } else finish(true);
    } else if (!$('draft').hidden || !$('place').hidden) {
      toast('Соперник отключился', 'bad');
      show('menu');
    }
  };
  l.send({ t: 'hello', owned: [...meta.owned] });
}

/** Сообщения по сети. Хост — главный: он ведёт драфт и считает бой. */
function onNet(m: any) {
  switch (m.t) {
    case 'hello':
      foeOwned = m.owned;
      if (mode === 'host') {
        const first: Side = Math.random() < 0.5 ? 0 : 1;
        startDraft(first);
        link?.send({ t: 'draftStart', first });
      }
      break;
    case 'draftStart':
      if (mode === 'guest') startDraft(m.first);
      break;
    case 'pick': // гость → хост
      if (mode === 'host' && draft && draft.turn() === 1 && (foeOwned.includes(m.id) || noOwnedFree(foeOwned))) doPick(1, m.id);
      break;
    case 'draft': // хост → гость
      if (mode === 'guest' && draft) {
        draft.picks = m.picks;
        pickDeadline = performance.now() + m.left * 1000;
        renderDraft();
        if (draft.done) toPlacement();
      }
      break;
    case 'place': // гость → хост
      if (mode === 'host') { foePlacement = m.placement; tryStartNet(); }
      break;
    case 'start': // хост → гость (может прийти повторно — пока гость не ответил ходом)
      if (mode === 'guest' && !game && !$('place').hidden) startBattle(m.picks, m.seed);
      break;
    case 'lk': // хост → гость: журнал ходов
      lsOnLog(m);
      break;
    case 'gk': // гость → хост: подтверждение и команды
      lsOnGuest(m);
      break;
    case 'needsync':
      if (mode === 'host' && ls) ls.resync = true;
      break;
    case 'sync': // хост → гость: расхождение, берём состояние хоста
      if (mode === 'guest' && game && ls) lsApplySync(m);
      break;
  }
}

// ---------- драфт ----------
let draft: Draft | null = null;
let pickDeadline = 0;
let draftSel: string | null = null;
let botPickAt = 0;

function startDraft(first: Side) {
  draft = new Draft(first);
  foePlacement = null;
  draftSel = null;
  pickDeadline = performance.now() + PICK_SECONDS * 1000;
  botPickAt = performance.now() + 900 + Math.random() * 900;
  $('foeName').textContent = mode === 'bot' ? 'Бот' : online.match && link?.via === 'server' ? online.match.foe.name : 'Соперник';
  renderDraft();
  show('draft');
}

/** Нет ли среди открытых героев свободных — тогда можно взять любого как пробного на этот бой. */
const noOwnedFree = (owned: Iterable<string>) => !!draft && [...owned].every((id) => draft!.taken(id));
/** Может ли игрок взять героя (свой ли он и свободен ли). */
const canTake = (id: string) => !!draft && !draft.taken(id) && (meta.owned.has(id) || noOwnedFree(meta.owned));

function doPick(side: Side, id: string) {
  if (!draft || !draft.pick(side, id)) return;
  sound.play('tap');
  if (side === me) draftSel = null;
  pickDeadline = performance.now() + PICK_SECONDS * 1000;
  botPickAt = performance.now() + 900 + Math.random() * 1100;
  if (mode === 'host') link?.send({ t: 'draft', picks: draft.picks, left: PICK_SECONDS });
  renderDraft();
  if (draft.done) setTimeout(toPlacement, 700);
}

function renderDraft() {
  if (!draft) return;
  const d = draft;
  const slots = (side: Side) => {
    const ids = d.team(side);
    return Array.from({ length: 5 }, (_, i) => {
      const id = ids[i];
      if (!id) return `<div class="slot empty"></div>`;
      const h = heroById(id);
      return `<div class="slot"><img src="${portraitURL(h, 64)}" alt=""><span>${h.name}</span><img class="race" src="${raceURL(h.race, 32)}" alt=""></div>`;
    }).join('');
  };
  $('mySlots').innerHTML = slots(me);
  $('foeSlots').innerHTML = slots(foe());
  $('draftSyn').innerHTML = synergyHTML(countsOf(d.team(me)), true);
  const turn = d.turn();
  $('draftTurn').textContent = turn === null ? 'Драфт окончен' : turn === me ? 'Твой выбор' : mode === 'bot' ? 'Выбирает бот…' : 'Выбирает соперник…';
  $('draftTurn').className = 'turn ' + (turn === me ? 'mine' : 'theirs');
  const pool = $('draftPool');
  pool.innerHTML = '';
  // по расам: так проще собирать пары и четвёрки
  const byRace = [...HEROES].sort((a, b) => RACE_IDS.indexOf(a.race) - RACE_IDS.indexOf(b.race));
  for (const h of byRace) {
    const taken = d.picks.find((p) => p.id === h.id);
    const owned = meta.owned.has(h.id);
    const b = document.createElement('button');
    b.type = 'button';
    const lockedNow = !owned && !taken && !noOwnedFree(meta.owned);
    b.className = 'pool-hero' + (taken ? (taken.side === me ? ' taken mine' : ' taken theirs') : '') + (lockedNow ? ' locked' : '') + (draftSel === h.id ? ' sel' : '');
    const hs = owned ? meta.starsOf(h.id) : 0;
    b.innerHTML = `<img src="${portraitURL(h, 72)}" alt=""><span>${h.name}</span><img class="race" src="${raceURL(h.race, 32)}" alt="${RACES[h.race].name}">${lockedNow ? '<i>🔒</i>' : ''}${hs ? `<b class="tile-stars">${hs}★</b>` : ''}`;
    b.onclick = () => {
      draftSel = h.id;
      renderDraft();
    };
    pool.appendChild(b);
  }
  const sel = draftSel ? heroById(draftSel) : null;
  if (sel) {
    const race = RACES[sel.race];
    const trial = !meta.owned.has(sel.id) && noOwnedFree(meta.owned);
    const note = d.taken(sel.id) ? ' · уже выбран' : trial ? ' · пробный на этот бой' : !meta.owned.has(sel.id) ? ' · не открыт (открой в «Героях»)' : '';
    const ss = meta.owned.has(sel.id) ? meta.starsOf(sel.id) : 0;
    $('draftInfo').innerHTML = `<img class="skill-ico" src="${skillURL(sel)}" alt=""><span><b>${sel.name}</b>${ss ? ` <span class="st-gold">${ss}★</span>` : ''} · ${sel.role} · <span style="color:${race.color}">${race.name}</span>${note}<br>${sel.skill.name}: ${sel.skill.desc}.${ss >= BAL.stars.max ? ` 5★: «${sel.skill2.name}» — ${sel.skill2.desc.toLowerCase()}.` : ''} HP ${sel.hp}, урон ${sel.dmg}, дальность ${sel.range}.<br>${raceHint(sel.id, d.team(me))}</span>`;
  } else {
    $('draftInfo').textContent = turn === me && noOwnedFree(meta.owned)
      ? 'Свободных открытых героев не осталось — можно взять любого как пробного на этот бой.'
      : 'Нажми на героя, чтобы посмотреть его, затем «Выбрать». Повторять героев соперника нельзя.';
  }
  $<HTMLButtonElement>('draftPickBtn').disabled = !(turn === me && draftSel && canTake(draftSel));
}

$('draftPickBtn').onclick = () => {
  if (!draft || !draftSel || draft.turn() !== me || !canTake(draftSel)) return;
  if (mode === 'guest') {
    link?.send({ t: 'pick', id: draftSel });
    draftSel = null;
    renderDraft();
  } else doPick(me, draftSel);
};

/** Таймер драфта и ходы бота; вызывается каждый кадр. */
function tickDraft(now: number) {
  if (!draft || $('draft').hidden || draft.done) return;
  const left = Math.max(0, Math.ceil((pickDeadline - now) / 1000));
  $('draftTimer').textContent = String(left);
  const turn = draft.turn()!;
  if (mode === 'guest') return; // таймер ведёт хост
  if (netLost) { pickDeadline = now + PICK_SECONDS * 1000; return; } // пока нет связи, ход не сгорает
  if (mode === 'bot' && turn !== me && now >= botPickAt) { doPick(turn, botDraftPick(draft, turn)); return; }
  if (now >= pickDeadline) {
    const allowed = turn === me ? meta.owned : mode === 'bot' ? HEROES.map((h) => h.id) : foeOwned;
    const id = randomPick(draft, allowed) ?? randomPick(draft, HEROES.map((h) => h.id));
    if (id) doPick(turn, id);
  }
}

// ---------- расстановка ----------
let selectedChip: string | null = null;
let foePlacement: Pick[] | null = null;

/** Звёзды героев бота — по силе твоей пятёрки: на лёгком на звезду меньше, на сложном на звезду больше. */
function botStars(): number {
  const avg = placement.reduce((a, p) => a + (p.stars ?? 0), 0) / Math.max(1, placement.length);
  const d = gameDiff();
  const shift = d === 'easy' ? -1 : d === 'hard' ? 1 : 0;
  return Math.max(0, Math.min(BAL.stars.max, Math.round(avg) + shift));
}
let myPlacementSent = false;
const laneCount = (l: number) => placement.filter((p) => p.lane === l).length;
const validPlacement = () => [0, 1, 2].every((l) => laneCount(l) >= 1 && laneCount(l) <= 3);

function toPlacement() {
  if (!draft || !$('place').hidden) return;
  const mine = draft.team(me);
  const saved = store.get('tl-place');
  const prev: Pick[] = saved ? JSON.parse(saved) : [];
  const lanes = [0, 0, 1, 2, 2];
  placement = mine.map((id, i) => ({ heroId: id, lane: prev.find((p) => p.heroId === id)?.lane ?? lanes[i], stars: meta.starsOf(id) }));
  // порядок в колонне линии (кто впереди) — как в прошлый раз
  const at = (id: string) => { const k = prev.findIndex((p) => p.heroId === id); return k < 0 ? 99 : k; };
  placement.sort((a, b) => at(a.heroId) - at(b.heroId));
  if (!validPlacement()) placement = mine.map((id, i) => ({ heroId: id, lane: lanes[i], stars: meta.starsOf(id) }));
  selectedChip = null;
  myPlacementSent = false;
  if (mode !== 'guest') foePlacement = mode === 'bot' ? botPlacement(draft.team(foe())).map((p) => ({ ...p, stars: botStars() })) : foePlacement;
  $('placeWait').hidden = true;
  $<HTMLButtonElement>('startBattle').hidden = false;
  renderPlace();
  show('place');
}

/** Поменять двух героев местами: и линией, и местом в колонне. */
function swapPlaces(a: string, b: string) {
  const i = placement.findIndex((x) => x.heroId === a);
  const j = placement.findIndex((x) => x.heroId === b);
  if (i < 0 || j < 0) return;
  const pa = placement[i], pb = placement[j];
  [pa.lane, pb.lane] = [pb.lane, pa.lane];
  placement[i] = pb;
  placement[j] = pa;
}

function renderPlace() {
  const el = $('laneCols');
  el.innerHTML = '';
  for (let l = 0; l < 3; l++) {
    const col = document.createElement('div');
    col.className = 'lane-col' + (selectedChip ? ' target' : '');
    col.setAttribute('role', 'button');
    col.tabIndex = 0;
    col.innerHTML = `<h3>${LANE_NAMES[l]}</h3><span class="n">${laneCount(l)} из 3</span>`;
    const inLane = placement.filter((x) => x.lane === l);
    inLane.forEach((p, k) => {
      const h = heroById(p.heroId);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hero-chip';
      chip.setAttribute('aria-pressed', String(selectedChip === h.id));
      const tag = inLane.length > 1 ? `<em class="ord${k === 0 ? ' front' : ''}">${k === 0 ? 'впереди' : k + 1}</em>` : '';
      chip.innerHTML = `${portrait(h)}<span>${h.name}<small class="kind">${h.hp} HP · ${h.range <= 130 ? 'ближний' : 'дальний'}</small></span>${tag}`;
      chip.onclick = (e) => {
        e.stopPropagation();
        if (myPlacementSent) return;
        if (selectedChip && selectedChip !== h.id) { swapPlaces(selectedChip, h.id); selectedChip = null; }
        else selectedChip = selectedChip === h.id ? null : h.id;
        renderPlace();
      };
      col.appendChild(chip);
    });
    const moveHere = () => {
      if (!selectedChip || myPlacementSent) return;
      const i = placement.findIndex((x) => x.heroId === selectedChip);
      const p = placement[i];
      if (p.lane !== l && laneCount(l) < 3) {
        p.lane = l;
        placement.splice(i, 1);
        placement.push(p); // пришёл на линию — встаёт в конец колонны
      }
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
$('placeBack').onclick = () => {
  if (mode !== 'bot') return; // в сетевой игре назад нельзя
  show('menu');
};
$('startBattle').onclick = () => {
  store.set('tl-place', JSON.stringify(placement));
  if (mode === 'bot') {
    startBattle(me === 0 ? [placement, foePlacement!] : [foePlacement!, placement]);
    return;
  }
  myPlacementSent = true;
  $<HTMLButtonElement>('startBattle').hidden = true;
  $('placeWait').hidden = false;
  if (mode === 'guest') link?.send({ t: 'place', placement });
  else tryStartNet();
};

/** Хост начинает бой, когда обе расстановки готовы. */
function tryStartNet() {
  if (mode !== 'host' || !myPlacementSent || !foePlacement) return;
  // в бою через сервер звёзды обеих сторон берём из базы сервера, а не с телефонов
  const st = online.match?.stars;
  const withStars = (pl: Pick[], tbl?: Record<string, number>) => pl.map((p) => ({ ...p, stars: tbl ? Math.min(BAL.stars.max, tbl[p.heroId] ?? 0) : p.stars }));
  const picks: [Pick[], Pick[]] = link?.via === 'server' && st ? [withStars(placement, st[0]), withStars(foePlacement, st[1])] : [placement, foePlacement];
  const seed = Math.floor(Math.random() * 2 ** 31);
  startMsg = { t: 'start', picks, seed };
  link?.send(startMsg);
  startBattle(picks, seed);
}

// ---------- бой ----------
let game: Game | null = null;
let renderer: Renderer | null = null;
let bot: Bot | null = null;
let paused = false;
let modalPause = false;
/** Сетевая игра: связь с соперником временно пропала — бой стоит на паузе у обоих. */
let netLost = false;
let speed = 1;
let selected: Hero | null = null;
let heroBtns: { h: Hero; cast: HTMLButtonElement; up: HTMLElement; cdv: HTMLElement; mana: HTMLElement; badge: HTMLElement; back: HTMLButtonElement; lname: HTMLElement }[] = [];
let synKey = '';
let creepBtns: HTMLButtonElement[] = [];
let bossBtns: HTMLButtonElement[] = [];
let campHintShown = false;
let myAuto = false;
let startMsg: unknown = null;
const cv = $<HTMLCanvasElement>('cv');

function startBattle(picks: [Pick[], Pick[]], seed?: number) {
  iSurrendered = false;
  game = new Game([picks[0].map((p) => ({ ...p })), picks[1].map((p) => ({ ...p }))], mode === 'bot' ? gameDiff() : 'normal', seed);
  if (mode !== 'bot') game.incomeMul = [1, 1];
  game.autoCast = [false, false];
  myAuto = store.get('tl-auto') === '1';
  ls = null;
  if (mode === 'bot') { game.autoCast[me] = myAuto; game.autoCast[foe()] = true; }
  else { lsInit(); if (myAuto) lsCmd({ c: 'auto', on: true }); }
  bot = mode === 'bot' ? new Bot(foe(), 'normal', gameDiff()) : null;
  renderer = new Renderer(cv, game, me);
  paused = false;
  modalPause = false;
  speed = 1;
  selected = null;
  campHintShown = store.get('tl-camphint') === '1';
  $('speedBtn').textContent = '×1';
  $('speedBtn').hidden = mode !== 'bot';
  $('autoBtn').setAttribute('aria-pressed', String(myAuto));
  $('pauseModal').hidden = true;
  $('tripModal').hidden = true;
  $('shopModal').hidden = true;
  $('toasts').innerHTML = '';
  // (раньше здесь гость слал ещё {auto: false} из ещё не синхронизированной симуляции — и выключал себе авто сразу после включения)
  buildPanel();
  show('battle');
  fit();
}

/** Действие игрока: против бота и у хоста — сразу в игру, у гостя — хосту по сети. */
function act(cmd: any): boolean {
  if (!game) return false;
  if (ls) { lsCmd(cmd); return true; } // сетевой бой: команда уйдёт в ближайший ход
  return applyCmd(me, cmd);
}

/** Выполнить команду стороны side (своя или пришедшая от гостя). */
function applyCmd(side: Side, cmd: any): boolean {
  const g = game!;
  const hero = (uid: number) => g.heroes.find((h) => h.uid === uid && h.side === side);
  switch (cmd.c) {
    case 'cast': { const h = hero(cmd.uid); return !!h && g.cast(h, false, false, !!cmd.force); }
    case 'creep': return g.upgradeCreeps(cmd.lane, side);
    case 'send': return g.sendParty(side, cmd.nid, (cmd.uids as number[]).map(hero).filter((h): h is Hero => !!h)) > 0;
    case 'recall': g.recall(side, cmd.nid ?? undefined); return true;
    case 'upg': return ['armor', 'fury', 'mana', 'gun', 'walls', 'thorns'].includes(cmd.k) && g.buyUpg(side, cmd.k);
    case 'barr': return g.buyBarracks(cmd.lane, side);
    case 'glyph': return g.glyph(side);
    case 'move': { const h = hero(cmd.uid); return !!h && h.side === side && g.moveHero(h, cmd.lane); }
    case 'home': { const h = hero(cmd.uid); return !!h && h.side === side && g.sendHome(h); }
    case 'recallHero': { const h = hero(cmd.uid); if (h) g.recallHero(h); return !!h; }
    case 'auto': g.autoCast[side] = !!cmd.on; return true;
    case 'surrender': if (g.winner === null) g.winner = (1 - side) as Side; return true;
    case 'sticker': showSticker(side, String(cmd.id)); return true; // на бой не влияет — только картинка
  }
  return false;
}

function buildPanel() {
  const g = game!;
  const hb = $('herobar');
  hb.innerHTML = '';
  heroBtns = [];
  const mine = g.heroes.filter((h) => h.side === me).sort((a, b) => a.lane - b.lane);
  for (const h of mine) {
    const wrap = document.createElement('div');
    wrap.className = 'hb';
    const lname = document.createElement('button');
    lname.type = 'button';
    lname.className = 'lname';
    lname.textContent = LANE_SHORT[h.lane];
    lname.setAttribute('aria-label', `${h.def.name}: перейти на другую линию`);
    lname.onclick = () => openMove(h);
    const cast = document.createElement('button');
    cast.type = 'button';
    cast.className = 'hb-cast';
    cast.setAttribute('aria-label', `${h.def.name}: ${h.def.skill.name}`);
    cast.innerHTML = `<img class="skill-ico" src="${skillURL(h.def)}" alt=""><img class="mini-portrait" src="${portraitURL(h.def, 64)}" alt=""><span class="cdv" hidden></span><span class="mana"></span><span class="badge" hidden></span>`;
    // одно нажатие — к герою и способность, если рядом есть цель; двойное — применить в любом случае (например, подлечить)
    let lastTap = 0;
    cast.onclick = () => {
      selected = h;
      const hp = g.heroPos(h);
      renderer?.focus(hp.x, hp.y);
      const now = performance.now();
      const second = now - lastTap < 380;
      lastTap = second ? 0 : now;
      if (!g.canCast(h)) { if (!second) { pulse(cast); sound.play('deny'); } return; }
      if (second) { act({ c: 'cast', uid: h.uid, force: true }); sound.play('tap'); return; }
      if (!act({ c: 'cast', uid: h.uid })) {
        pulse(cast);
        if (!forceHintShown) { forceHintShown = true; toast('Рядом нет цели. Нажми дважды — способность сработает всё равно', 'info'); }
      }
    };
    // уровень и полоска опыта (уровни растут сами)
    const up = document.createElement('div');
    up.className = 'hb-xp';
    up.innerHTML = '<b></b><i><span></span></i>';
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'hb-back';
    back.textContent = '↩';
    back.setAttribute('aria-label', `${h.def.name}: срочно на линию`);
    back.hidden = true;
    back.onclick = () => { act({ c: 'recallHero', uid: h.uid }); sound.play('tap'); };
    wrap.append(lname, cast, up, back);
    if (h.stars > 0) {
      const st = document.createElement('span');
      st.className = 'hb-stars';
      st.textContent = `${h.stars}★`;
      wrap.appendChild(st);
    }
    if (h.stars >= BAL.stars.max) {
      // значок второй способности (5★): светится, когда готова
      const s2 = document.createElement('img');
      s2.className = 's2';
      s2.src = skill2URL(h.def, 48);
      s2.alt = '';
      s2.title = `${h.def.skill2.name}: срабатывает сама`;
      wrap.appendChild(s2);
    }
    hb.appendChild(wrap);
    heroBtns.push({
      h, cast, up, back, lname,
      cdv: cast.querySelector('.cdv') as HTMLElement,
      mana: cast.querySelector('.mana') as HTMLElement,
      badge: cast.querySelector('.badge') as HTMLElement,
    });
  }
  const cb = $('creepbar');
  cb.innerHTML = '';
  creepBtns = [0, 1, 2].map((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn cb';
    b.onclick = () => openShop({ kind: 'barracks', lane: l });
    cb.appendChild(b);
    return b;
  });
  const bb = $('bosses');
  bb.innerHTML = '';
  const all = document.createElement('button');
  all.type = 'button';
  all.className = 'boss recall-all';
  all.id = 'recallAll';
  all.innerHTML = '<i>↩</i>Все на линию';
  all.hidden = true;
  all.onclick = () => { act({ c: 'recall' }); sound.play('tap'); };
  bb.appendChild(all);
  synKey = '';
  bossBtns = [0, 1].map((nid) => {
    const n = g.neutrals[nid];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'boss ' + n.kind;
    b.onclick = () => openTrip(nid);
    bb.appendChild(b);
    return b;
  });
}

function pulse(el: HTMLElement) {
  el.animate?.([{ transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'none' }], { duration: 160 });
}

function toast(text: string, cls: string) {
  const t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.textContent = text;
  const box = $('toasts');
  box.appendChild(t);
  while (box.children.length > 3) box.firstElementChild?.remove();
  setTimeout(() => t.remove(), 3500);
}

// ---------- стикеры в бою ----------
const STICKER_GAP = 3500; // не чаще одного стикера в 3,5 с от стороны
const stickerAt: [number, number] = [0, 0];
let foeMuted = false;

/** Показать стикер стороны side над её троном (в верхней панели). */
function showSticker(side: Side, id: string) {
  if (!STICKERS.some((x) => x.id === id)) return;
  const now = performance.now();
  if (now - stickerAt[side] < STICKER_GAP - 300) return;
  stickerAt[side] = now;
  if (side !== me && foeMuted) return;
  const el = $(side === me ? 'stickMine' : 'stickFoe');
  el.innerHTML = `<img src="${stickerURL(id, 112)}" alt="">`;
  el.classList.remove('show');
  void el.offsetWidth; // перезапуск анимации
  el.classList.add('show');
  clearTimeout(Number(el.dataset.t));
  el.dataset.t = String(window.setTimeout(() => el.classList.remove('show'), 2600));
  if (side !== me) sound.play('tap');
}

function renderStickerPicker() {
  const el = $('stickPick');
  const mine = STICKERS.filter((x) => meta.hasSticker(x.id));
  const net = mode !== 'bot';
  el.innerHTML = mine.map((x) => `<button type="button" class="stk" data-id="${x.id}" aria-label="${x.name}"><img src="${stickerURL(x.id, 96)}" alt=""></button>`).join('')
    + `<p class="stk-more">Ещё ${STICKERS.length - mine.length} — в меню «Стикеры»</p>`
    + (net ? `<button type="button" class="btn ghost stk-mute">${foeMuted ? 'Включить стикеры соперника' : 'Заглушить соперника'}</button>` : '');
  el.querySelectorAll<HTMLButtonElement>('.stk').forEach((b) => b.addEventListener('click', () => {
    el.hidden = true;
    if (performance.now() - stickerAt[me] < STICKER_GAP) { toast('Не так часто 🙂', 'info'); return; }
    act({ c: 'sticker', id: b.dataset.id });
  }));
  el.querySelector('.stk-mute')?.addEventListener('click', () => { foeMuted = !foeMuted; el.hidden = true; toast(foeMuted ? 'Стикеры соперника скрыты' : 'Стикеры соперника снова видны', 'info'); });
}
// касание мимо окна стикеров — закрыть его
document.addEventListener('pointerdown', (e) => {
  const el = $('stickPick');
  if (!el.hidden && !el.contains(e.target as Node) && e.target !== $('stickBtn')) el.hidden = true;
});
$('stickBtn').onclick = () => {
  const el = $('stickPick');
  if (el.hidden) renderStickerPicker();
  el.hidden = !el.hidden;
};

/** Бот иногда отвечает стикером: когда продавил позицию или потерял её. */
let botBanter = { pushes: 0, lost: 0, t: 0 };
function botStickers(g: Game) {
  if (mode !== 'bot') return;
  const f = foe();
  const pushes = g.stats.pushes[f], lost = g.stats.pushes[me];
  if (g.t < 1) botBanter = { pushes, lost, t: 0 };
  let pick: string | null = null;
  if (pushes > botBanter.pushes) pick = ['lol', 'gg', 'hi'][Math.floor(Math.random() * 3)];
  else if (lost > botBanter.lost) pick = Math.random() < 0.5 ? 'gg' : null;
  botBanter.pushes = pushes;
  botBanter.lost = lost;
  if (pick && Math.random() < 0.45 && g.t - botBanter.t > 40) {
    botBanter.t = g.t;
    window.setTimeout(() => game === g && showSticker(f, pick!), 600 + Math.random() * 900);
  }
}

let forceHintShown = false;

function syncPanel() {
  const g = game!;
  $('gold').textContent = String(Math.floor(g.gold[me]));
  botStickers(g);
  $('myHp').style.width = (100 * g.throne[me]) / BAL.throneHp + '%';
  $('foeHp').style.width = (100 * g.throne[foe()]) / BAL.throneHp + '%';
  const hpTxt = (v: number) => String(Math.max(0, Math.ceil(v)));
  if ($('myHpN').textContent !== hpTxt(g.throne[me])) $('myHpN').textContent = hpTxt(g.throne[me]);
  if ($('foeHpN').textContent !== hpTxt(g.throne[foe()])) $('foeHpN').textContent = hpTxt(g.throne[foe()]);
  $('clock').textContent = clock(g.t);
  const ping = ls && ls.rtt ? ` · ${Math.round(ls.rtt)} мс` : '';
  $('waveInfo').textContent = lsWaiting ? (mode === 'guest' ? 'ждём хоста…' : 'ждём соперника…') + ping : `волна ${g.waveNo + 1} через ${Math.ceil(g.waveTimer)} с${ping}`;
  for (const b of heroBtns) {
    const { h } = b;
    b.cast.classList.toggle('ready', g.canCast(h));
    b.cast.classList.toggle('sel', selected === h);
    if (h.dead) { b.cdv.hidden = false; b.cdv.textContent = '✝' + Math.ceil(h.respawn); }
    else if (h.cd > 0) { b.cdv.hidden = false; b.cdv.textContent = String(Math.ceil(h.cd)); }
    else b.cdv.hidden = true;
    b.mana.style.width = (100 * h.mana) / h.maxMana + '%';
    const s2 = b.cast.parentElement!.querySelector<HTMLElement>('.s2');
    if (s2) s2.classList.toggle('on', h.cd2 <= 0 && !h.dead);
    const trip = h.trip ? (h.trip.phase === 'back' ? '↩' : '⚔') : '';
    b.back.hidden = !h.trip || h.trip.phase === 'back';
    b.badge.hidden = !trip;
    b.badge.textContent = trip;
    const ln = h.helpT > 0 ? `⇄ ${LANE_SHORT[h.lane]} ${Math.ceil(h.helpT)}`
      : h.moveCd > 0 ? `${LANE_SHORT[h.lane]} · ${Math.ceil(h.moveCd)}` : `${LANE_SHORT[h.lane]} ⇄`;
    if (b.lname.textContent !== ln) b.lname.textContent = ln;
    b.lname.classList.toggle('can', g.canMove(h));
    b.lname.classList.toggle('away', h.helpT > 0);
    if (moveHero === h && !$('moveModal').hidden) renderMove();
    const maxed = h.lvl >= BAL.heroMaxLvl;
    (b.up.firstElementChild as HTMLElement).textContent = maxed ? `${h.lvl} ★` : `ур. ${h.lvl}`;
    (b.up.querySelector('span') as HTMLElement).style.width = maxed ? '100%' : `${Math.min(100, (100 * h.xp) / g.xpNeed(h))}%`;
  }
  creepBtns.forEach((b, l) => {
    const lvl = g.creepLvl[l][me];
    const cap = g.creepCap();
    const maxed = lvl >= cap;
    const cost = g.creepUpCost(l, me);
    const wait = BAL.creepLvlEvery * cap - g.t;
    const tail = lvl >= BAL.creepMaxLvl ? 'макс' : maxed ? `через ${Math.ceil(wait)} с` : '▲ ' + cost;
    const bl = g.barracks[l][me];
    const html = `<span>Барак ${LANE_SHORT[l]}</span><small>${lvl} · враг ${g.creepLvl[l][foe()]}</small><span class="cost">${tail}${bl ? ` · ★${bl}` : ''}</span>`;
    if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
    const bc = g.barracksCost(l, me);
    b.classList.toggle('can', (!maxed && g.gold[me] >= cost) || (bc !== null && g.gold[me] >= bc));
  });
  bossBtns.forEach((b, nid) => {
    const n = g.neutrals[nid];
    const mine = g.party(nid, me).length;
    const foes = g.visible(me, n.x, n.y, 60) ? g.party(nid, foe()).length : 0; // за туманом не видно
    let status: string;
    if (!n.alive) status = 'через ' + clock(n.respawnT);
    else if (mine && foes) status = 'бой с врагом!';
    else if (mine) status = `отряд: ${Math.round((100 * n.hp) / n.maxHp)}%`;
    else if (foes) status = 'там враг!';
    else status = 'бросить вызов';
    const icon = n.kind === 'lord' ? '♛' : '◈';
    const gd = g.neutrals[n.guard!];
    const gs = gd.owner === me ? 'страж твой' : !g.visible(me, gd.x, gd.y, 40) ? 'страж: ?' : gd.owner === foe() ? 'страж врага' : 'страж ничей';
    const html = `<i>${icon}</i>${g.neutralName(n)}<small>${status}</small><small class="${gd.owner === me ? 'own' : ''}">${gs}</small>`;
    if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
    b.classList.toggle('alive', n.alive && !mine);
    b.classList.toggle('fight', n.alive && foes > 0);
  });

  const orbT = g.orbTimeLeft(me);
  const orbEl = $('orbChip');
  orbEl.hidden = orbT <= 0;
  if (orbT > 0) {
    const r = (Object.keys(g.orbs[me]) as RaceId[]).find((k) => (g.orbs[me][k] ?? 0) > 0)!;
    orbEl.innerHTML = `<img src="${raceURL(r)}" alt="">Сфера: ${RACES[r].name} · ${clock(orbT)}`;
  }
  {
    const cheapest = (ks: ('armor' | 'fury' | 'mana' | 'gun' | 'walls' | 'thorns')[]) => Math.min(...ks.map((k) => g.upgCost(me, k) ?? Infinity));
    $('altarBtn').classList.toggle('can', g.gold[me] >= cheapest(['armor', 'fury', 'mana']));
    $('throneBtn').classList.toggle('can', g.gold[me] >= cheapest(['gun', 'walls', 'thorns']) || g.canGlyph(me));
    if (!$('shopModal').hidden) renderShop();
    // кнопка глифа: готов / перезарядка / действует / нет золота; при атаке на трон — пульсирует
    const gb = $('glyphBtn');
    const on = g.glyphT[me] > 0, cd = g.glyphCd[me];
    const ready = g.canGlyph(me);
    const txt = on ? `${Math.ceil(g.glyphT[me])} с` : cd > 0 ? `${Math.ceil(cd)} с` : `◆${BAL.glyph.cost}`;
    if ($('glyphTxt').textContent !== txt) $('glyphTxt').textContent = txt;
    gb.style.setProperty('--p', on ? '0' : String(Math.min(1, cd / BAL.glyph.cd).toFixed(3)));
    gb.classList.toggle('on', on);
    gb.classList.toggle('ready', ready);
    gb.classList.toggle('poor', !on && cd <= 0 && !ready);
    gb.classList.toggle('urgent', ready && g.throneUnderAttack(me));
  }
  $('recallAll').hidden = !g.heroes.some((h) => h.side === me && h.trip && h.trip.phase !== 'back');
  const counts = g.raceCounts(me);
  const fc = g.raceCounts(foe());
  const key = JSON.stringify([counts, fc]);
  if (key !== synKey) {
    synKey = key;
    $('synergy').innerHTML = synergyHTML(counts, true);
    $('foeSynergy').innerHTML = synergyHTML(fc, true);
  }
  // события: у гостя — пришедшие от хоста, у остальных — свои из симуляции
  const evs = g.events.filter((e) => e.to === null || e.to === me);
  g.events.length = 0;
  for (const e of evs) toast(e.text, e.tone);
  if (!campHintShown && g.neutrals.some((n) => n.kind === 'camp' && n.alive)) {
    campHintShown = true;
    store.set('tl-camphint', '1');
    toast('В лесу появились монстры: нажми на лагерь и отправь героя за золотом', 'info');
  }
  const sfx = g.sfx.filter((x) => x.to === null || x.to === me);
  g.sfx.length = 0;
  for (const x of sfx) sound.play(x.name);
}

/** Нажатие на плашку расы — подсказка о бонусе (своей стороны или соперника). */
function raceToast(side: Side, e: Event) {
  const el = (e.target as HTMLElement).closest('.syn') as HTMLElement | null;
  if (!el || !game) return;
  const r = el.dataset.race as RaceId;
  const n = game.raceCounts(side)[r];
  const ti = tierIndex(r, n);
  const next = RACES[r].tiers[ti + 1];
  const orbs = game.orbs[side][r] ?? 0;
  const who = side === me ? '' : 'У врага: ';
  toast(`${who}${RACES[r].name} ${n}${orbs ? ` (сфер: ${orbs})` : ''}: ${ti >= 0 ? RACES[r].tiers[ti].text : 'бонуса пока нет'}${next ? `. С ${next.n}: ${next.text}` : ''}`, side === me ? 'info' : 'bad');
}
$('synergy').addEventListener('click', (e) => raceToast(me, e));
$('foeSynergy').addEventListener('click', (e) => raceToast(foe(), e));

// ---------- окно похода ----------
let tripNid = -1;
let tripPick = new Set<Hero>();

// Окна, открытые касанием карты: на телефоне после pointerup браузер ещё шлёт «клик» в ту же точку,
// и он попадал в кнопку, только что появившуюся под пальцем (выбирал героя / нажимал покупку).
// Один такой клик в первые 350 мс после открытия внутри окна гасим.
let modalOpenedAt = -1e9;
const GHOST_MS = 350;
document.addEventListener('click', (e) => {
  if (performance.now() - modalOpenedAt > GHOST_MS) return;
  const t = e.target as Element | null;
  if (t?.closest('#tripModal, #shopModal, #moveModal')) { modalOpenedAt = -1e9; e.stopPropagation(); e.preventDefault(); }
}, true);

function openTrip(nid: number) {
  const g = game;
  if (!g) return;
  sound.play('tap');
  const n = g.neutrals[nid];
  tripNid = nid;
  const mineOut = g.party(nid, me);
  const name = g.neutralName(n);
  $('tripTitle').textContent = n.kind === 'camp' ? 'Лесной лагерь' : name;
  if (n.kind === 'guard' && n.owner === me) {
    $('tripText').textContent = `${name} уже твой и даёт обзор на логово. Враг может его перехватить — следи за ним на миникарте.`;
    tripPick = new Set();
    renderTripHeroes();
    $<HTMLButtonElement>('tripGo').disabled = true;
    $('tripRecall').hidden = mineOut.length === 0;
    $('tripModal').hidden = false;
    modalOpenedAt = performance.now();
    modalPause = true;
    return;
  }
  const reward = n.kind === 'lord'
    ? 'Победивший Лорда получает его в союзники (он идёт по линии, где ты продвинулся дальше всего) и сферу случайной расы: +1 к расе, пока Лорд не возродится. Может выпасть и ненужная. Чтобы видеть логово, захвати стража у входа.'
    : n.kind === 'turtle'
      ? `Черепаха даёт команде ${BAL.neutral.turtle.gold} золота.`
      : n.kind === 'guard'
        ? `Захвати стража — и логово ${n.pit === 0 ? 'Лорда' : 'Черепахи'} будет под обзором: увидишь, если враг пошёл туда. Враг может перехватить стража обратно. Хватит 1–2 героев.`
        : `Лесные монстры дают ${BAL.neutral.camp.gold} золота. Хватит одного героя.`;
  const foeNote = g.party(nid, foe()).length && g.visible(me, n.x, n.y, 60) ? ' Там уже вражеские герои — сначала придётся победить их.' : '';
  $('tripText').textContent = n.alive ? reward + foeNote : `${name} появится через ${clock(n.respawnT)}. ${reward}`;
  tripPick = new Set(); // никого заранее не выбираем — игрок решает сам
  renderTripHeroes();
  $('tripRecall').hidden = mineOut.length === 0;
  $('tripModal').hidden = false;
  modalOpenedAt = performance.now();
  modalPause = true;
}

function renderTripHeroes() {
  const g = game!;
  const n = g.neutrals[tripNid];
  const el = $('tripHeroes');
  el.innerHTML = '';
  const mine = g.heroes.filter((h) => h.side === me).sort((a, b) => a.lane - b.lane);
  for (const h of mine) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'trip-hero';
    const busy = h.dead ? 'погиб' : h.trip ? (h.trip.nid === tripNid ? 'уже здесь' : 'в походе') : '';
    b.disabled = !!busy || !n.alive;
    b.setAttribute('aria-pressed', String(tripPick.has(h)));
    b.innerHTML = `${portrait(h.def)}${h.def.name.split(' ')[0]}<small>${busy || `${LANE_SHORT[h.lane]} · ур. ${h.lvl}`}</small><span class="hpbar"><b style="width:${(100 * h.hp) / h.maxHp}%"></b></span>`;
    b.onclick = () => {
      if (tripPick.has(h)) tripPick.delete(h); else tripPick.add(h);
      renderTripHeroes();
    };
    el.appendChild(b);
  }
  // предупреждение: какие линии останутся пустыми
  const empty = [0, 1, 2].filter((l) => {
    const onLane = g.heroesOn(l, me).filter((h) => !h.dead && !h.trip && !tripPick.has(h));
    return tripPick.size > 0 && onLane.length === 0 && [...tripPick].some((h) => h.lane === l);
  });
  $('tripWarn').textContent = empty.length
    ? `${empty.map((l) => LANE_NAMES[l]).join(' и ')} линия останется без героев — вражеские крипы смогут занять позицию.`
    : '';
  const go = $<HTMLButtonElement>('tripGo');
  go.disabled = tripPick.size === 0 || !n.alive;
  go.textContent = tripPick.size ? `Отправить (${tripPick.size})` : 'Выбери героев';
}

function closeTrip() {
  $('tripModal').hidden = true;
  modalPause = false;
}
$('tripCancel').onclick = closeTrip;
$('tripGo').onclick = () => {
  if (game && act({ c: 'send', nid: tripNid, uids: [...tripPick].map((h) => h.uid) })) {
    const n = game.neutrals[tripNid];
    renderer?.focus(n.x, n.y);
  }
  closeTrip();
};
$('tripRecall').onclick = () => {
  act({ c: 'recall', nid: tripNid });
  closeTrip();
};

// ---------- окно улучшений: алтарь, трон, бараки ----------
type ShopWhat = { kind: 'altar' } | { kind: 'throne' } | { kind: 'barracks'; lane: number };
let shop: ShopWhat = { kind: 'altar' };

function openShop(what: ShopWhat) {
  if (!game) return;
  sound.play('tap');
  shop = what;
  $('shopRows').innerHTML = '';
  delete $('shopRows').dataset.h; // иначе при том же содержимом кнопки не перерисуются (окно открывалось пустым)
  renderShop();
  $('shopModal').hidden = false;
  modalOpenedAt = performance.now();
  modalPause = true;
}

function pips(lvl: number, max: number) {
  return `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</span>`;
}

function shopRow(icon: string, name: string, text: string, lvl: number, max: number, btn: string, act: string, ok: boolean) {
  return `<div class="shop-row"><span class="ico">${icon}</span><span><b>${name}</b><small>${text}</small>${max ? pips(lvl, max) : ''}</span>`
    + `<button type="button" class="btn ${ok ? 'primary' : 'ghost'}" data-act="${act}" ${ok ? '' : 'disabled'}>${btn}</button></div>`;
}

function renderShop() {
  const g = game;
  if (!g) return;
  const gold = g.gold[me];
  const buy = (cost: number | null) => (cost === null ? 'макс' : `◆ ${cost}`);
  let title = '';
  let text = '';
  let rows = '';
  if (shop.kind === 'altar') {
    title = 'Алтарь';
    text = 'Ауры для всех твоих героев. Действуют всю игру, без ограничения по времени.';
    for (const k of ['armor', 'fury', 'mana'] as const) {
      const a = BAL.altar[k];
      const c = g.upgCost(me, k);
      rows += shopRow(a.icon, a.name, a.text, g.upg[me][k], BAL.upgCost.length, buy(c), 'upg:' + k, c !== null && gold >= c);
    }
  } else if (shop.kind === 'throne') {
    title = 'Трон';
    text = `Прочность: ${Math.ceil(g.throne[me])} из ${BAL.throneHp}. Пушка отстреливает крипов у базы, стены и шипы защищают трон, глиф спасает в беде.`;
    const c = g.upgCost(me, 'gun');
    rows += shopRow(BAL.gunUp.icon, BAL.gunUp.name, BAL.gunUp.text, g.upg[me].gun, BAL.upgCost.length, buy(c), 'upg:gun', c !== null && gold >= c);
    for (const k of ['walls', 'thorns'] as const) {
      const u = BAL.throneUp[k];
      const ck = g.upgCost(me, k);
      rows += shopRow(u.icon, u.name, u.text, g.upg[me][k], BAL.upgCost.length, buy(ck), 'upg:' + k, ck !== null && gold >= ck);
    }
    const gl = g.glyphT[me] > 0 ? `действует ${Math.ceil(g.glyphT[me])} с` : g.glyphCd[me] > 0 ? `через ${Math.ceil(g.glyphCd[me])} с` : `◆ ${BAL.glyph.cost}`;
    rows += shopRow('✺', 'Глиф', `Все герои на линиях и трон ${BAL.glyph.dur} с не получают урона. Перезарядка ${BAL.glyph.cd} с.`, 0, 0, gl, 'glyph', g.canGlyph(me));
  } else {
    const l = shop.lane;
    title = `Барак: ${LANE_NAMES[l].toLowerCase()} линия`;
    text = 'Отсюда выходят крипы этой линии.';
    const lvl = g.creepLvl[l][me];
    const cap = g.creepCap();
    const cc = g.creepUpCost(l, me);
    const capped = lvl >= cap;
    const btn = lvl >= BAL.creepMaxLvl ? 'макс' : capped ? `через ${Math.ceil(BAL.creepLvlEvery * cap - g.t)} с` : `◆ ${cc}`;
    rows += shopRow('⚔', 'Сила крипов', `Уровень ${lvl}, у врага ${g.creepLvl[l][foe()]}. +20% HP и урона за уровень. Сейчас можно до ${cap}.`, 0, 0, btn, 'creep:' + l, !capped && gold >= cc);
    const bl = g.barracks[l][me];
    const bc = g.barracksCost(l, me);
    const ex = (i: number) => { const [m, r] = BAL.barracksExtra[i]; return [m ? `+${m} мечн.` : '', r ? `+${r} лучн.` : ''].filter(Boolean).join(' '); };
    const next = bl < BAL.barracksCost.length ? `Следующий: ${ex(bl + 1)} в каждой волне.` : 'Барак улучшен полностью.';
    rows += shopRow('⌂', 'Уровень барака', `${bl ? `Сейчас: ${ex(bl)}. ` : ''}${next}`, bl, BAL.barracksCost.length, buy(bc), 'barr:' + l, bc !== null && gold >= bc);
  }
  $('shopTitle').textContent = title;
  $('shopText').textContent = `${text} Золото: ${Math.floor(gold)}.`;
  const box = $('shopRows');
  if (box.dataset.h !== rows) { box.innerHTML = rows; box.dataset.h = rows; }
}

$('shopRows').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button[data-act]') as HTMLButtonElement | null;
  if (!b || b.disabled || !game) return;
  const [a, v] = b.dataset.act!.split(':');
  const cmd = a === 'upg' ? { c: 'upg', k: v } : a === 'barr' ? { c: 'barr', lane: Number(v) } : a === 'creep' ? { c: 'creep', lane: Number(v) } : { c: 'glyph' };
  if (act(cmd)) sound.play('tap'); else sound.play('deny');
  if (a === 'glyph') closeShop();
});
function closeShop() {
  $('shopModal').hidden = true;
  modalPause = false;
}
$('shopClose').onclick = closeShop;
$('altarBtn').onclick = () => openShop({ kind: 'altar' });
$('throneBtn').onclick = () => openShop({ kind: 'throne' });
// глиф в один тап прямо с экрана боя (pointerdown — без задержки click на телефоне)
$('glyphBtn').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!game) return;
  if (game.canGlyph(me) && act({ c: 'glyph' })) sound.play('tap');
  else sound.play('deny');
});

// ---------- переход героя на другую линию ----------
let moveHero: Hero | null = null;
let moveKey = '';

/** Самая проблемная своя линия: глубже всего продавлена, при равенстве — меньше живых героев. */
function weakestLane(g: Game): number {
  const score = (l: number) => (g.atThrone(l, me) ? 4 : g.depth(l, me)) * 10 - g.heroesOn(l, me).filter((h) => !h.dead && !h.trip).length;
  return [0, 1, 2].sort((a, b) => score(b) - score(a))[0];
}

function openMove(h: Hero) {
  if (!game) return;
  sound.play('tap');
  selected = h;
  moveHero = h;
  moveKey = '';
  renderMove();
  $('moveModal').hidden = false;
  modalOpenedAt = performance.now();
  modalPause = true;
}

function renderMove() {
  const g = game!;
  const h = moveHero!;
  const cost = g.moveCost();
  const wl = weakestLane(g);
  const weak = g.atThrone(wl, me) || g.depth(wl, me) > 0 ? wl : -1; // ⚠ только если линию правда продавили
  const why = h.dead ? 'Герой погиб — переход после возрождения.'
    : h.trip ? 'Герой в походе — сначала верни его на линию.'
    : h.helpT > 0 ? `Герой на чужой линии ещё ${Math.ceil(h.helpT)} с. Можно вернуть домой раньше.`
    : h.moveCd > 0 ? `Переход будет готов через ${Math.ceil(h.moveCd)} с.`
    : g.gold[me] < cost ? 'Не хватает золота.' : '';
  const text = `Мгновенно отправь героя на другую линию на ${BAL.move.dur} с, потом он сам вернётся. Стоит ${cost} золота, перезарядка ${BAL.move.cd} с.` + (why ? ' ' + why : '');
  const others = g.heroesOn(h.lane, me).filter((x) => x !== h && !x.dead && !x.trip).length;
  const warn = g.canMove(h) && others === 0 ? `На линии «${LANE_SHORT[h.lane]}» не останется героев — крипы врага займут позицию.` : '';
  const key = [h.uid, text, warn, ...[0, 1, 2].map((l) => g.depth(l, me) + ':' + g.heroesOn(l, me).filter((x) => !x.dead && !x.trip).length + ':' + g.canMove(h, l))].join('|');
  if (key === moveKey) return;
  moveKey = key;
  $('moveTitle').textContent = h.def.name;
  $('moveText').textContent = text;
  $('moveWarn').textContent = warn;
  const lanes = $('moveLanes');
  lanes.innerHTML = '';
  [0, 1, 2].forEach((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost';
    const here = g.heroesOn(l, me).filter((x) => !x.dead && !x.trip).length;
    const where = g.atThrone(l, me) ? 'у трона!' : ['впереди', 'отступили', 'у базы', 'у трона'][g.depth(l, me)] ?? '';
    const tag = l === h.lane ? 'герой здесь' : `${where} · героев ${here}`;
    b.innerHTML = `${LANE_SHORT[l]}${l === weak && l !== h.lane ? ' ⚠' : ''}<small>${tag}</small>`;
    b.disabled = !g.canMove(h, l);
    b.classList.toggle('need', l === weak && l !== h.lane);
    b.onclick = () => {
      if (act({ c: 'move', uid: h.uid, lane: l })) {
        const p = g.lanes[l].pos(g.slotS(l, me), 0);
        renderer?.focus(p.x, p.y);
        sound.play('tap');
      } else sound.play('deny');
      closeMove();
    };
    lanes.appendChild(b);
  });
  $('moveHome').hidden = h.helpT <= 0;
}

function closeMove() {
  $('moveModal').hidden = true;
  moveHero = null;
  modalPause = false;
}
$('moveCancel').onclick = closeMove;
$('moveHome').onclick = () => {
  if (moveHero) act({ c: 'home', uid: moveHero.uid });
  closeMove();
};

function fit() {
  if (!renderer) return;
  const f = $('field');
  renderer.resize(f.clientWidth, f.clientHeight);
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const ms = mini.clientWidth || 150;
  mini.width = Math.round(ms * dpr);
  mini.height = Math.round(((ms * WORLD.H) / WORLD.W) * dpr);
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
  if (h && h.side === me) { selected = h; return; }
  const bld = renderer.buildingAt(w.x, w.y);
  if (bld && bld.side === me) {
    if (bld.kind === 'barracks') openShop({ kind: 'barracks', lane: bld.lane! });
    else openShop({ kind: bld.kind });
    return;
  }
  const n = renderer.neutralAt(w.x, w.y);
  if (n) { openTrip(n.id); return; }
  selected = null;
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
  renderer.jump(((e.clientX - r.left) * WORLD.W) / r.width, ((e.clientY - r.top) * WORLD.H) / r.height);
};
mini.addEventListener('pointerdown', (e) => { miniDrag = true; mini.setPointerCapture(e.pointerId); miniJump(e); });
mini.addEventListener('pointermove', (e) => { if (miniDrag) miniJump(e); });
mini.addEventListener('pointerup', () => { miniDrag = false; });
mini.addEventListener('pointercancel', () => { miniDrag = false; });

$('overviewBtn').onclick = () => renderer?.toggleOverview();
$('autoBtn').onclick = () => {
  if (!game) return;
  const on = !myAuto;
  myAuto = on;
  act({ c: 'auto', on });
  store.set('tl-auto', on ? '1' : '0');
  $('autoBtn').setAttribute('aria-pressed', String(on));
};
$('speedBtn').onclick = () => { speed = speed === 1 ? 2 : 1; $('speedBtn').textContent = '×' + speed; };
$('pauseBtn').onclick = () => { paused = true; $('pauseModal').hidden = false; };
$('resume').onclick = () => { paused = false; $('pauseModal').hidden = true; };
$('surrender').onclick = () => {
  iSurrendered = true; act({ c: 'surrender' }); $('pauseModal').hidden = true; paused = false; };
document.addEventListener('visibilitychange', () => {
  sound.suspend(document.hidden);
  if (document.hidden && game && game.winner === null && !$('battle').hidden) { paused = true; $('pauseModal').hidden = false; }
});

// ---------- звук ----------
const SOUND_LABEL = { all: '♪', sfx: '🔉', off: '🔇' } as const;
const SOUND_TEXT = { all: 'Звук и музыка', sfx: 'Только эффекты', off: 'Без звука' } as const;
const sound = new Sound(store.get('tl-sound'));
const syncSoundBtn = () => {
  $('soundBtn').textContent = SOUND_LABEL[sound.mode];
  $('soundBtn').setAttribute('aria-label', SOUND_TEXT[sound.mode]);
};
syncSoundBtn();
$('soundBtn').onclick = () => {
  sound.unlock();
  const m = sound.cycle();
  store.set('tl-sound', m);
  syncSoundBtn();
  toast(SOUND_TEXT[m], 'info');
};
// звук можно включить только после касания
document.addEventListener('pointerdown', () => sound.unlock(), { capture: true });

// горизонтальный полноэкранный режим в браузере (в приложении он включён всегда)
function goFullscreen() {
  const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen()
    .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
    .catch(() => undefined);
}
$('toPick').addEventListener('click', goFullscreen);

function finish(aborted = false) {
  const g = game!;
  // хост ещё несколько секунд досылает журнал — чтобы гость досмотрел последние ходы до конца
  if (ls && mode === 'host' && !aborted) {
    const tail = ls;
    let n = 0;
    const t = window.setInterval(() => { if (++n > 24 || !link) { clearInterval(t); return; } lsSend(tail); }, SEND_EVERY);
  }
  ls = null;
  lsWaiting = false;
  if (aborted) {
    sound.play('lose');
    $('resTitle').textContent = 'Связь потеряна';
    $('resText').textContent = 'Соединение с соперником пропало больше чем на 45 секунд. Матч не засчитан.';
    $('resStats').innerHTML = `<dt>Длительность</dt><dd>${clock(g.t)}</dd>`;
    $('resReward').textContent = '';
    game = null;
    show('result');
    return;
  }
  const win = g.winner === me;
  if (mode !== 'bot' && link?.via === 'server') {
    // статистику шлют оба телефона: симуляция одинаковая, сервер засчитывает задания, только если цифры совпали
    const st = g.stats;
    online.send({ t: 'result', winner: g.winner, stats: { kills: st.kills, lords: st.lords, turtles: st.turtles, camps: st.camps, pushes: st.pushes } });
  }
  renderRatingLine();
  sound.play(win ? 'win' : 'lose');
  $('resTitle').textContent = win ? 'Победа' : 'Поражение';
  $('resText').textContent = win ? 'Вражеский трон разрушен.' : 'Твой трон пал. Попробуй другую расстановку.';
  const myLvl = g.heroes.filter((h) => h.side === me).reduce((a, h) => a + h.lvl, 0);
  $('resStats').innerHTML = `
    <dt>Длительность</dt><dd>${clock(g.t)}</dd>
    <dt>Убито крипов</dt><dd>${g.stats.kills[me]}</dd>
    <dt>Продавлено позиций</dt><dd>${g.stats.pushes[me]}</dd>
    <dt>Лорд / Черепаха / лагеря</dt><dd>${g.stats.lords[me]} / ${g.stats.turtles[me]} / ${g.stats.camps[me]}</dd>
    <dt>Сумма уровней героев</dt><dd>${myLvl}</dd>
    <dt>Заработано золота</dt><dd>${Math.round(g.stats.goldEarned[me])}</dd>`;
  if (win) store.set('tl-wins', String(Number(store.get('tl-wins') || 0) + 1));
  // кристаллы дают только за рейтинговые бои, и начисляет их сервер (придёт в 'ended')
  $('resReward').textContent = lastRanked && link?.via === 'server'
    ? 'Кристаллы — после того как сервер подтвердит итог…'
    : botRanked ? 'Кристаллы за бой с ботом — ждём подтверждения сервера…' : 'Кристаллы дают только за рейтинговые бои.';
  if (botRanked && mode === 'bot') {
    const st = g.stats;
    online.send({ t: 'botResult', id: botRanked.id, win, surrender: iSurrendered, stats: { kills: st.kills[me], lords: st.lords[me], turtles: st.turtles[me], camps: st.camps[me], pushes: st.pushes[me] } });
  }
  renderRewardLine();
  game = null;
  show('result');
}
$('again').onclick = () => {
  if (botRanked) { startQueue(); return; } // бой с ботом из рейтинга — снова ищем живого соперника
  if (mode === 'bot') { startDraft(Math.random() < 0.5 ? 0 : 1); return; }
  if (lastRanked) { link = null; startQueue(); return; }
  link?.close();
  link = null;
  resetLobby();
  show('lobby');
};
$('toMenu').onclick = () => { link?.close(); link = null; syncCrystals(); show('menu'); };

// ---------- цикл ----------
const STEP = 1 / 30;
let acc = 0;
let last = performance.now();
// ---------- свой сервер: аккаунт, рейтинг, подбор ----------
let lastEnded: Ended | null = null;
let lastRanked = false;
let queueSince = 0;
/** Рейтинговый поиск не нашёл соперника — бой с ботом (награда ×½, лимит в день; итог проверяет сервер). */
let botRanked: { id: string; left: number } | null = null;
let iSurrendered = false;
const BOT_OFFER_S = 40; // через сколько секунд поиска предложить бота
const BOT_AUTO_S = 50; // а через сколько начать его автоматически
let botOfferAt = BOT_OFFER_S;

/** Играть через свой сервер: он настроен, на связи и есть аккаунт. */
const useServer = () => online.configured && online.ready && !!online.me;

// ---------- ранги по рейтингу ----------
/** Лиги: от какого рейтинга, название и цвет. Старт — 1000 (Серебро). */
const RANKS = [
  { from: 0, name: 'Бронза', color: '#c9824a' },
  { from: 900, name: 'Серебро', color: '#c3cad6' },
  { from: 1100, name: 'Золото', color: '#f3d27a' },
  { from: 1300, name: 'Платина', color: '#5fd4c4' },
  { from: 1500, name: 'Алмаз', color: '#7cc8f0' },
  { from: 1700, name: 'Мастер', color: '#b48cff' },
  { from: 1900, name: 'Легенда', color: '#ff6b6b' },
];
const rankIndex = (r: number) => { let i = 0; while (i + 1 < RANKS.length && r >= RANKS[i + 1].from) i++; return i; };
const rankOf = (r: number) => RANKS[rankIndex(r)];
/** Значок ранга — щит цвета лиги (у Мастера и Легенды с короной). */
function rankBadge(r: number, size = 18): string {
  const i = rankIndex(r);
  const c = RANKS[i].color;
  const crown = i >= 5 ? '<path d="M6 7 L8 3 L10 6 L12 2 L14 6 L16 3 L18 7 Z" fill="#fff6d8" stroke="#14121c" stroke-width="1"/>' : '';
  const pips = Array.from({ length: Math.min(i, 4) }, (_, k) => `<circle cx="${12 - (Math.min(i, 4) - 1) * 2 + k * 4}" cy="19" r="1.3" fill="#14121c"/>`).join('');
  return `<svg class="rank-badge" width="${size}" height="${size}" viewBox="0 0 24 26" aria-hidden="true"><path d="M12 5 L21 8 L20 16 Q17 22 12 24 Q7 22 4 16 L3 8 Z" fill="${c}" stroke="#14121c" stroke-width="1.6"/><path d="M12 8 L17 9.6 L16.5 15 Q15 18.5 12 20 Z" fill="rgba(255,255,255,.35)"/>${pips}${crown}</svg>`;
}
/** «Золото · 1180 · до Платины 120» */
function rankLine(r: number, size = 30): string {
  const i = rankIndex(r);
  const next = RANKS[i + 1];
  return `${rankBadge(r, size)}<span style="color:${RANKS[i].color}">${RANKS[i].name}</span> · ★ ${r}${next ? `<small class="rank-next">до ранга «${next.name}» ещё ${next.from - r}</small>` : '<small class="rank-next">высший ранг</small>'}`;
}

function renderProfileChip() {
  const b = $<HTMLButtonElement>('profileBtn');
  b.hidden = !online.configured;
  if (online.me) b.innerHTML = `${rankBadge(online.me.rating, 16)}${escapeHtml(online.me.name)} · ★ ${online.me.rating}`;
  else b.textContent = online.ready ? 'Войти' : 'Сервер недоступен';
  $('rankedBtn').hidden = !online.configured;
}

function applyServerProgress() {
  // прогресс аккаунта ведёт сервер — всегда берём его цифры
  const p = online.me!;
  meta.crystals = p.crystals;
  meta.owned = new Set([...STARTER_IDS, ...p.owned.filter((id) => HEROES.some((h) => h.id === id))]);
  meta.stars = cleanStars(p.stars ?? {});
  if (p.stickers) meta.stickers = new Set(p.stickers.filter((id) => STICKERS.some((x) => x.id === id)));
  meta.save();
  syncCrystals();
  if (!$('pick').hidden) { const y = $('pick').scrollTop; renderCards(); $('pick').scrollTop = y; }
  if (!$('stickers').hidden) renderStickerShop();
}

function openAccount(msg = '') {
  $('accStatus').textContent = msg;
  renderAccount();
  show('account');
  if (online.me) online.send({ t: 'top' });
}

function renderAccount() {
  const p = online.me;
  $('accGuest').hidden = !!p;
  $('accUser').hidden = !p;
  if (!online.ready) $('accStatus').textContent = 'Нет связи с сервером. Проверь интернет — подключимся сами.';
  if (!p) return;
  $('accName').textContent = p.name;
  $('accRating').innerHTML = rankLine(p.rating);
  const games = p.wins + p.losses;
  $('accStats').textContent = games ? `Побед: ${p.wins} · поражений: ${p.losses} · ${Math.round((100 * p.wins) / games)}%` : 'Рейтинговых боёв пока не было';
  $('passBtn').textContent = p.hasPass ? 'Сменить пароль' : 'Задать пароль';
}

function renderRatingLine() {
  const el = $('resRating');
  if (!lastEnded || !lastEnded.ranked || !online.me) { el.hidden = true; return; }
  const d = lastEnded.delta;
  const now = online.me.rating;
  const was = now - d;
  el.hidden = false;
  const up = rankIndex(now) > rankIndex(was), down = rankIndex(now) < rankIndex(was);
  el.innerHTML = `${rankLine(now)} <b>(${d >= 0 ? '+' : ''}${d})</b>`
    + (up ? `<br><span class="rank-up">Новый ранг: ${rankOf(now).name}!</span>` : down ? `<br><span class="rank-down">Ранг понижен: ${rankOf(now).name}</span>` : '');
  if (up && el.dataset.shown !== String(now)) { el.dataset.shown = String(now); sound.play('levelUp'); }
}

function startQueue() {
  if (!useServer()) {
    if (!online.ready) { toast('Нет связи с сервером', 'bad'); return; }
    openAccount('Создай аккаунт, чтобы играть рейтинговые бои.');
    return;
  }
  lastEnded = null;
  queueSince = performance.now();
  botOfferAt = BOT_OFFER_S;
  botRanked = null;
  $('qBot').hidden = true;
  $('qBotGo').textContent = 'Бой с ботом';
  $('qBotGo').onclick = askBot;
  $('qRating').innerHTML = rankLine(online.me!.rating);
  $('qStatus').textContent = 'Ищем соперника примерно твоей силы…';
  show('queue');
  online.send({ t: 'queue' });
}

online.on('status', (ok: boolean) => {
  renderProfileChip();
  if (!$('account').hidden) renderAccount();
  if (!ok && !$('queue').hidden) $('qStatus').textContent = 'Связь с сервером пропала, переподключаемся…';
});
online.on('me', () => {
  dailyAt = Date.now();
  applyServerProgress();
  renderDailyDot();
  if (!$('daily').hidden) renderDaily();
  renderProfileChip();
  if (!$('account').hidden) { renderAccount(); $('accStatus').textContent = ''; }
  if (!$('result').hidden) renderRatingLine();
});
online.on('error', (m: { where: string; text: string }) => {
  if (m.where === 'botMatch') { clearTimeout(botWait); botAsked = 0; $('qBotText').textContent = m.text; return; }
  if (!$('account').hidden) $('accStatus').textContent = m.text;
  else if (!$('lobby').hidden) {
    lobbyStatus(m.text, true);
    $<HTMLButtonElement>('hostBtn').disabled = false;
    $<HTMLButtonElement>('joinBtn').disabled = false;
  } else toast(m.text, 'bad');
});
online.on('kicked', () => toast('В этот аккаунт вошли с другого телефона', 'bad'));
online.on('room', (m: { code: string }) => {
  $('roomCode').hidden = false;
  $('roomCode').textContent = m.code;
  lobbyStatus('Комната создана. Скажи код другу и жди его здесь.');
});
online.on('queued', () => { $('qStatus').textContent = 'Ищем соперника примерно твоей силы…'; });
online.on('match', (m: { ranked: boolean; role: 'host' | 'guest'; foe: { name: string; rating: number } }) => {
  lastRanked = m.ranked;
  lastEnded = null;
  const l = online.matchLink();
  if (!l) return;
  toast(`Соперник: ${m.foe.name} — ${rankOf(m.foe.rating).name}, ★ ${m.foe.rating}`, 'info');
  onConnected(l, m.role);
});
online.on('ended', (m: Ended) => {
  lastEnded = m;
  if (!$('result').hidden) { renderRatingLine(); renderRewardLine(); }
});

/** Строка о кристаллах на экране итога рейтингового боя. */
function renderRewardLine() {
  if (!lastEnded || !lastEnded.ranked) return;
  const c = lastEnded.crystals ?? 0;
  $('resReward').textContent = c > 0
    ? `+✦ ${c} кристаллов · всего ${(online.me?.crystals ?? meta.crystals)}.`
    : 'Этот бой кристаллов не дал: матч был слишком коротким или его покинули.';
}
online.on('top', (m: { list: { name: string; rating: number; wins: number; losses: number }[]; players: number; online: number }) => {
  $('topList').innerHTML = m.list.length
    ? m.list.map((x, i) => {
      const prev = i > 0 ? rankIndex(m.list[i - 1].rating) : -1;
      const ri = rankIndex(x.rating);
      // заголовок лиги перед первым игроком этой лиги
      const head = ri !== prev ? `<li class="rank-head" style="--rk:${RANKS[ri].color}">${rankBadge(x.rating, 22)}${RANKS[ri].name}<small> от ★ ${RANKS[ri].from}</small></li>` : '';
      return `${head}<li class="${x.name === online.me?.name ? 'me' : ''}" style="--rk:${RANKS[ri].color}"><i>${i + 1}</i>${escapeHtml(x.name)}<span>★ ${x.rating}</span></li>`;
    }).join('')
    : '<li>Пока никого — сыграй первый рейтинговый бой!</li>';
  $('topInfo').textContent = `Игроков: ${m.players} · сейчас в сети: ${m.online}`;
});

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!); }

$('profileBtn').onclick = () => openAccount();
$('rankedBtn').onclick = startQueue;
$('accBack').onclick = () => { renderProfileChip(); show('menu'); };
let botAsked = 0;
let botWait = 0;
function askBot() {
  if (performance.now() - botAsked < 4000) return;
  // старый сервер боя с ботом не умеет — не ждём впустую, а говорим как есть
  if ((online.me?.sv ?? 0) < 2) { botUnavailable(); return; }
  botAsked = performance.now();
  online.send({ t: 'botMatch' });
  clearTimeout(botWait);
  botWait = window.setTimeout(() => { if (!$('queue').hidden) botUnavailable(); }, 6000);
}
/** Сервер не дал бой с ботом: предлагаем обычный бой с ботом (без награды) или ждать дальше. */
function botUnavailable() {
  botOfferAt = Number.POSITIVE_INFINITY; // больше не предлагаем сами
  $('qBot').hidden = false;
  $('qBotText').textContent = 'Сервер сейчас не может выдать бой с ботом за награду (нужно обновить сервер). Можно сыграть обычный бой с ботом — без кристаллов — или подождать живого соперника.';
  $('qBotGo').textContent = 'Обычный бой с ботом';
  $('qBotGo').onclick = () => { online.send({ t: 'unqueue' }); $('toPick').click(); };
}
$('qBotGo').onclick = askBot;
$('qWait').onclick = () => { botOfferAt = Math.floor((performance.now() - queueSince) / 1000) + 60; $('qBot').hidden = true; };
online.on('botMatch', (m: { id: string; left: number }) => {
  clearTimeout(botWait);
  if ($('queue').hidden) return;
  botRanked = { id: m.id, left: m.left };
  lastRanked = false;
  link = null;
  mode = 'bot';
  me = 0;
  toast(m.left > 0 ? `Соперник не найден — бой с ботом. Награда ×½ (сегодня ещё ${m.left} из 5)` : 'Соперник не найден — бой с ботом. Лимит наград с ботом на сегодня исчерпан', 'info');
  startDraft(Math.random() < 0.5 ? 0 : 1);
});
online.on('botEnded', (m: { crystals: number; why: string; left: number }) => {
  if ($('result').hidden) return;
  const why: Record<string, string> = {
    short: 'Бой короче 3 минут — без кристаллов.',
    surrender: 'Сдача — без кристаллов.',
    limit: 'Лимит наград за бои с ботом на сегодня исчерпан (5 в день).',
  };
  $('resReward').textContent = m.crystals > 0
    ? `+✦ ${m.crystals} кристаллов за бой с ботом (награда ×½) · сегодня ещё ${m.left} из 5.`
    : why[m.why] ?? 'Этот бой кристаллов не дал.';
});
$('qCancel').onclick = () => { online.send({ t: 'unqueue' }); show('menu'); };
$('regBtn').onclick = () => {
  const name = $<HTMLInputElement>('regName').value.trim();
  if (name.length < 2) { $('accStatus').textContent = 'Имя — хотя бы 2 символа'; return; }
  online.send({ t: 'register', name, v: BUILD, p: PROTO });
  $('accStatus').textContent = 'Создаём…';
};
$('loginBtn').onclick = () => {
  online.send({ t: 'login', v: BUILD, p: PROTO, name: $<HTMLInputElement>('loginName').value.trim(), password: $<HTMLInputElement>('loginPass').value });
  $('accStatus').textContent = 'Входим…';
};
$('nameBtn').onclick = () => online.send({ t: 'setName', name: $<HTMLInputElement>('newName').value.trim() });
$('passBtn').onclick = () => {
  online.send({ t: 'setPassword', password: $<HTMLInputElement>('newPass').value });
  $<HTMLInputElement>('newPass').value = '';
  $('accStatus').textContent = 'Пароль сохранён — теперь можно войти с другого телефона.';
};
$('promoBtn').onclick = () => {
  const code = $<HTMLInputElement>('promoCode').value.trim();
  if (!code) { $('accStatus').textContent = 'Введи промокод'; return; }
  if (!online.ready) { $('accStatus').textContent = 'Нет связи с сервером'; return; }
  online.send({ t: 'promo', code });
  $('accStatus').textContent = 'Проверяем код…';
};
online.on('promoOk', (m: { code: string; crystals: number }) => {
  $<HTMLInputElement>('promoCode').value = '';
  $('accStatus').textContent = `Промокод ${m.code} активирован: +✦ ${m.crystals}!`;
  toast(`Промокод: +✦ ${m.crystals} кристаллов`, 'good');
  sound.play('coins');
});
// политика конфиденциальности — на нашем сервере (тот же адрес, что у игры, но https)
const privacyUrl = () => serverUrl().replace(/^ws(s?):/, 'http$1:').replace(/\/ws\/?$/, '') + '/privacy';
document.querySelectorAll<HTMLAnchorElement>('.privacy-link').forEach((a) => { a.href = privacyUrl(); });
$('deleteAccBtn').onclick = () => {
  if (!online.me) return;
  const name = online.me.name;
  if (!window.confirm(`Удалить аккаунт «${name}» навсегда? Кристаллы, герои, звёзды, стикеры и рейтинг пропадут, вернуть их будет нельзя.`)) return;
  if (!online.ready) { $('accStatus').textContent = 'Нет связи с сервером'; return; }
  online.send({ t: 'deleteAccount' });
  $('accStatus').textContent = 'Удаляем…';
};
online.on('deleted', () => {
  online.logout();
  // прогресс в телефоне — как у нового игрока
  meta.crystals = 300;
  meta.owned = new Set(STARTER_IDS);
  meta.stars = {};
  meta.stickers = new Set();
  meta.save();
  syncCrystals();
  renderAccount();
  renderProfileChip();
  online.start();
  $('accStatus').textContent = 'Аккаунт удалён.';
});
$('logoutBtn').onclick = () => { online.logout(); renderAccount(); renderProfileChip(); online.start(); };
setInterval(() => {
  if (!$('queue').hidden) {
    const t = Math.floor((performance.now() - queueSince) / 1000);
    $('qTimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    // долго никого — честно предлагаем бота, а через несколько секунд запускаем сами
    if (t >= botOfferAt && online.ready) {
      const auto = botOfferAt + (BOT_AUTO_S - BOT_OFFER_S);
      $('qBot').hidden = false;
      $('qBotText').textContent = `Соперник пока не найден. Через ${Math.max(0, auto - t)} с начнётся бой с ботом — награда за него вдвое меньше. Рейтинг не меняется.`;
      if (t >= auto) askBot();
    }
  }
}, 500);
renderProfileChip();
online.start();

// ---------- сетевой бой ----------
// Оба телефона считают один и тот же бой (одинаковое зерно случайности), а по сети идут только
// нажатия. Хост ведёт бой без ожиданий: каждые 0,2 с («ход») он записывает, какие команды
// выполнились, и шлёт этот журнал гостю. Гость идёт по журналу с небольшим запасом, который
// подстраивается под качество связи: так короткие заминки сети не останавливают игру.
// Команды гостя уходят хосту с номерами и повторяются, пока хост не подтвердит.
// Раз в 5 секунд гость сверяет отпечаток боя; если разошлись — хост присылает своё состояние.
const TPT = 6; // тиков симуляции в ходе: 6 × 1/30 с = 0,2 с
const HASH_EVERY = 25; // сверка каждые 5 секунд
const SEND_EVERY = 250; // мс между сообщениями
interface NetBattle {
  tick: number;
  log: Map<number, [Side, any][]>; // журнал ходов: какие команды выполнены в начале хода
  have: number; // гость: до какого хода журнал есть подряд; хост: последний записанный ход
  // хост
  hostPending: any[];
  guestQueue: any[];
  guestCmdMax: number; // последний принятый номер команды гостя
  guestHave: number; // до какого хода гость подтвердил журнал
  hashes: Map<number, number>; // хост: отпечатки для сверки; гость: присланные хостом
  resync: boolean;
  // гость
  myCmds: { i: number; c: any }[];
  cmdId: number;
  buffer: number; // запас в ходах, который гость держит позади хоста
  gaps: number[]; // паузы между сообщениями хоста за последние секунды
  lastRecv: number;
  // общее
  lastSend: number;
  waitSince: number;
  rtt: number;
  echo: number; // метка времени соперника, которую вернём ему для замера пинга
  echoAt: number; // когда мы её получили (сколько продержали — вычтем из пинга)
  syncAsked: number;
}
let ls: NetBattle | null = null;
let lsWaiting = false;

function lsInit() {
  ls = {
    tick: 0, log: new Map(), have: -1, hostPending: [], guestQueue: [], guestCmdMax: 0, guestHave: -1,
    hashes: new Map(), resync: false, myCmds: [], cmdId: 0, buffer: 2, gaps: [], lastRecv: 0,
    lastSend: 0, waitSince: 0, rtt: 0, echo: 0, echoAt: 0, syncAsked: 0,
  };
  acc = 0;
}

/** Команда игрока в сетевом бою. */
function lsCmd(cmd: any) {
  const L = ls!;
  if (mode === 'host') { L.hostPending.push(cmd); return; }
  L.myCmds.push({ i: ++L.cmdId, c: cmd });
  lsSend(); // сразу, не дожидаясь таймера
}

function lsSend(L: NetBattle | null = ls) {
  if (!L || !link) return;
  const now = performance.now();
  if (mode === 'host') {
    const f = L.guestHave + 1;
    const c: Record<number, [Side, any][]> = {};
    for (let n = f; n <= L.have; n++) { const e = L.log.get(n); if (e && e.length) c[n - f] = e; }
    const lastH = [...L.hashes.keys()].pop();
    link.send({ t: 'lk', f, n: L.have - f + 1, c, g: L.guestCmdMax, h: lastH !== undefined ? [lastH, L.hashes.get(lastH)] : 0, ts: Math.round(now), e: L.echo, d: Math.round(now - L.echoAt) });
  } else {
    link.send({ t: 'gk', a: L.have, cmds: L.myCmds, ts: Math.round(now), e: L.echo, d: Math.round(now - L.echoAt) });
  }
  L.lastSend = now;
}

function lsRtt(e: number, d: number) {
  if (!ls || !e) return;
  const r = performance.now() - e - (d || 0);
  if (r > 0 && r < 30000) ls.rtt = ls.rtt ? ls.rtt * 0.7 + r * 0.3 : r;
}

/** Гость получил журнал от хоста. */
function lsOnLog(m: { f: number; n: number; c: Record<number, [Side, any][]>; g: number; h: [number, number] | 0; ts: number; e: number; d: number }) {
  const L = ls;
  if (!L || !game || mode !== 'guest') return;
  const now = performance.now();
  if (L.lastRecv) { L.gaps.push(now - L.lastRecv); if (L.gaps.length > 40) L.gaps.shift(); }
  L.lastRecv = now;
  for (let i = 0; i < m.n; i++) if (!L.log.has(m.f + i)) L.log.set(m.f + i, m.c[i] ?? []);
  while (L.log.has(L.have + 1)) L.have++;
  L.myCmds = L.myCmds.filter((x) => x.i > m.g); // хост их уже принял
  if (m.h) { L.hashes.set(m.h[0], m.h[1]); if (L.hashes.size > 10) L.hashes.delete(L.hashes.keys().next().value!); }
  L.echo = m.ts;
  L.echoAt = performance.now();
  lsRtt(m.e, m.d);
  // запас: чтобы обычные паузы между сообщениями не останавливали бой
  const worst = Math.max(SEND_EVERY, ...L.gaps.slice(-20));
  L.buffer = Math.min(10, Math.max(1, Math.ceil(worst / 200)));
}

/** Хост получил подтверждение и команды гостя. */
function lsOnGuest(m: { a: number; cmds: { i: number; c: any }[]; ts: number; e: number; d: number }) {
  const L = ls;
  if (!L || mode !== 'host') return;
  if (m.a > L.guestHave) L.guestHave = m.a;
  for (const x of m.cmds) if (x.i > L.guestCmdMax) { L.guestCmdMax = x.i; L.guestQueue.push(x.c); }
  L.echo = m.ts;
  L.echoAt = performance.now();
  lsRtt(m.e, m.d);
  for (const n of L.log.keys()) { if (n >= L.guestHave - 450) break; L.log.delete(n); }
}

/** Гость: принять состояние хоста и идти дальше от него. */
function lsApplySync(m: { k: number; s: any }) {
  const L = ls!;
  game!.applySnapshot(m.s);
  L.tick = m.k;
  L.hashes.clear();
  L.syncAsked = 0;
}

/** Один тик. false — ждём журнал хоста (только у гостя). */
function lsStep(): boolean {
  const L = ls!;
  const g = game!;
  if (L.tick % TPT === 0) {
    const n = L.tick / TPT;
    if (mode === 'host') {
      if (L.resync) {
        // фиксируем своё состояние (округлённое так же, как у гостя) и отправляем
        L.resync = false;
        const snap = JSON.parse(JSON.stringify(g.snapshot()));
        g.applySnapshot(JSON.parse(JSON.stringify(snap)));
        link?.send({ t: 'sync', k: L.tick, s: snap });
        L.hashes.clear();
      }
      if (n % HASH_EVERY === 0) {
        L.hashes.set(n, g.hash());
        if (L.hashes.size > 6) L.hashes.delete(L.hashes.keys().next().value!);
      }
      const cmds: [Side, any][] = [...L.hostPending.map((c): [Side, any] => [0, c]), ...L.guestQueue.map((c): [Side, any] => [1, c])];
      L.hostPending = [];
      L.guestQueue = [];
      L.log.set(n, cmds);
      L.have = n;
      for (const [side, c] of cmds) applyCmd(side, c);
    } else {
      const cmds = L.log.get(n);
      if (!cmds) return false;
      if (n % HASH_EVERY === 0) {
        const want = L.hashes.get(n);
        // разошлись с хостом — просим его состояние (не чаще раза в 3 с)
        if (want !== undefined && want !== g.hash() && performance.now() - L.syncAsked > 3000) {
          L.syncAsked = performance.now();
          link?.send({ t: 'needsync' });
        }
      }
      for (const [side, c] of cmds) applyCmd(side, c);
      for (const k of L.log.keys()) { if (k >= n - 20) break; L.log.delete(k); }
    }
  }
  g.update(STEP);
  L.tick++;
  return true;
}

/** Кадр сетевого боя. Возвращает, идёт ли бой. */
function lsFrame(dt: number): boolean {
  const L = ls!;
  const now = performance.now();
  if (now - L.lastSend > SEND_EVERY) {
    lsSend();
    // гость ещё не ответил — повторяем приглашение в бой (вдруг потерялось)
    if (mode === 'host' && startMsg && L.guestHave < 0 && now - L.syncAsked > 1500) { L.syncAsked = now; link?.send(startMsg); }
  }
  let rate = 1;
  if (mode === 'guest') {
    // держимся позади хоста на запас buffer ходов: сильно отстали — догоняем, мало запаса — чуть медленнее
    const lag = L.have - Math.floor(L.tick / TPT);
    rate = lag > L.buffer + 12 ? 4 : lag > L.buffer + 2 ? 1.4 : lag < L.buffer - 1 ? 0.85 : 1;
  } else if (netLost) rate = 0; // гость пропал — хост ждёт, чтобы бой был честным
  acc += dt * rate;
  let moved = rate > 0;
  while (acc >= STEP && game && game.winner === null) {
    if (!lsStep()) { acc = Math.min(acc, STEP); moved = false; break; }
    acc -= STEP;
  }
  if (moved) L.waitSince = 0;
  else if (!L.waitSince) L.waitSince = now;
  lsWaiting = !!L.waitSince && now - L.waitSince > 1000;
  return !lsWaiting;
}

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tickDraft(now);
  if (game && renderer) {
    // в сетевой игре пауза и окна не останавливают бой; бой идёт ходами, пока есть команды соперника
    let running: boolean;
    if (ls) {
      running = game.winner === null && lsFrame(dt);
    } else {
      running = !paused && !modalPause && game.winner === null;
      if (running) {
        acc += dt * speed;
        while (acc >= STEP) {
          bot?.update(game, STEP);
          game.update(STEP);
          acc -= STEP;
        }
      }
    }
    renderer.selected = selected;
    renderer.draw(dt);
    renderer.drawMinimap(miniCtx, mini.clientWidth || 150, Math.min(2.5, window.devicePixelRatio || 1));
    syncPanel();
    if (running) {
      const tense = game.throneUnderAttack(me) || game.heroes.some((h) => h.trip?.phase === 'fight' && h.side === me);
      sound.tickMusic(dt, tense);
    }
    if (game.winner !== null) finish();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
show('menu');

// для автотестов: доступ к бою из консоли при адресе с #debug
if (location.hash.includes('debug')) Object.assign(window, { __game: () => game, __renderer: () => renderer, __online: online, __castle: drawCastleFigure, __Sound: Sound, __stickerURL: stickerURL });
