// Точка входа: меню → (лобби) → драфт → расстановка → бой → итог.
import { BAL, Difficulty, WORLD } from './data/config';
import { HEROES, HeroDef, STARTER_IDS, heroById } from './data/heroes';
import { RACES, RACE_IDS, RaceId, tierIndex } from './data/races';
import { portraitURL, raceURL, skillURL, drawCastleFigure } from './render/art';
import { Sound } from './audio';
import { Renderer, clock } from './render/renderer';
import { Bot } from './sim/bot';
import { Draft, PICK_SECONDS, botDraftPick, botPlacement, randomPick } from './sim/draft';
import { Game } from './sim/game';
import { LANE_NAMES, LANE_SHORT } from './sim/map';
import type { Hero, Pick, Side } from './sim/types';
import { Link, hostRoom, joinRoom, netMode, newRoomCode } from './net';
import { Ended, Online } from './online';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS = ['menu', 'how', 'races', 'pick', 'lobby', 'account', 'queue', 'draft', 'place', 'battle', 'result'];
function show(id: string) {
  for (const s of SCREENS) $(s).hidden = s !== id;
}

const store = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
};

let difficulty: Difficulty = (store.get('tl-diff') as Difficulty) || 'normal';
// ---------- прогресс игрока: кристаллы и открытые герои ----------
const meta = {
  crystals: Number(store.get('tl-crystals') ?? 300), // стартовый подарок, чтобы сразу открыть одного героя
  owned: new Set<string>([...STARTER_IDS, ...(store.get('tl-owned') || '').split(',').filter((id) => HEROES.some((h) => h.id === id))]),
  save() {
    store.set('tl-crystals', String(this.crystals));
    store.set('tl-owned', [...this.owned].join(','));
    // на сервер; если связи нет — отправим при следующем входе
    if (online.me && online.ready) online.send({ t: 'save', crystals: this.crystals, owned: [...this.owned] });
    else store.set('tl-dirty', '1');
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
$('toRaces').onclick = () => { renderRaces(); show('races'); };
$('racesBack').onclick = () => show('menu');

/** Версия игры: в APK её вписывает сборка (meta app-version). */
const APP_VERSION = document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content || 'dev';
$('version').textContent = `Версия ${APP_VERSION === 'dev' ? 'для разработки' : APP_VERSION}`;

/** Есть ли на GitHub сборка новее установленной — тогда на главном экране плашка со ссылкой на APK. */
async function checkUpdate() {
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
    const b = document.createElement('div');
    b.className = 'card' + (owned ? '' : ' locked');
    const race = RACES[h.race];
    b.innerHTML = `
      <div class="card-head">${portrait(h)}<div><h3>${h.name}</h3><div class="role">${h.role}</div>
        <span class="race-tag" style="--rc:${race.color}"><img src="${raceURL(h.race, 40)}" alt="">${race.name}</span></div></div>
      <div class="nums"><span>HP ${h.hp}</span><span>урон ${h.dmg}</span><span>дальн. ${h.range}</span></div>
      <div class="skill"><img class="skill-ico" src="${skillURL(h)}" alt=""><span><b>${h.skill.name}.</b> ${h.skill.desc}</span></div>
      ${owned ? '<span class="owned-tag">Открыт</span>' : `<button type="button" class="btn buy" ${meta.crystals < h.price ? 'disabled' : ''}>Открыть за ✦ ${h.price}</button>`}`;
    const buy = b.querySelector('.buy') as HTMLButtonElement | null;
    if (buy) buy.onclick = () => {
      if (meta.crystals < h.price) return;
      meta.crystals -= h.price;
      meta.owned.add(h.id);
      meta.save();
      sound.play('levelUp');
      renderCards();
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
    b.innerHTML = `<img src="${portraitURL(h, 72)}" alt=""><span>${h.name}</span><img class="race" src="${raceURL(h.race, 32)}" alt="${RACES[h.race].name}">${lockedNow ? '<i>🔒</i>' : ''}`;
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
    $('draftInfo').innerHTML = `<img class="skill-ico" src="${skillURL(sel)}" alt=""><span><b>${sel.name}</b> · ${sel.role} · <span style="color:${race.color}">${race.name}</span>${note}<br>${sel.skill.name}: ${sel.skill.desc}. HP ${sel.hp}, урон ${sel.dmg}, дальность ${sel.range}.<br>${raceHint(sel.id, d.team(me))}</span>`;
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
let myPlacementSent = false;
const laneCount = (l: number) => placement.filter((p) => p.lane === l).length;
const validPlacement = () => [0, 1, 2].every((l) => laneCount(l) >= 1 && laneCount(l) <= 3);

function toPlacement() {
  if (!draft || !$('place').hidden) return;
  const mine = draft.team(me);
  const saved = store.get('tl-place');
  const prev: Pick[] = saved ? JSON.parse(saved) : [];
  const lanes = [0, 0, 1, 2, 2];
  placement = mine.map((id, i) => ({ heroId: id, lane: prev.find((p) => p.heroId === id)?.lane ?? lanes[i] }));
  if (!validPlacement()) placement = mine.map((id, i) => ({ heroId: id, lane: lanes[i] }));
  selectedChip = null;
  myPlacementSent = false;
  if (mode !== 'guest') foePlacement = mode === 'bot' ? botPlacement(draft.team(foe())) : foePlacement;
  $('placeWait').hidden = true;
  $<HTMLButtonElement>('startBattle').hidden = false;
  renderPlace();
  show('place');
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
    for (const p of placement.filter((x) => x.lane === l)) {
      const h = heroById(p.heroId);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hero-chip';
      chip.setAttribute('aria-pressed', String(selectedChip === h.id));
      chip.innerHTML = `${portrait(h)}<span>${h.name}</span>`;
      chip.onclick = (e) => {
        e.stopPropagation();
        if (myPlacementSent) return;
        selectedChip = selectedChip === h.id ? null : h.id;
        renderPlace();
      };
      col.appendChild(chip);
    }
    const moveHere = () => {
      if (!selectedChip || myPlacementSent) return;
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
  const picks: [Pick[], Pick[]] = [placement, foePlacement];
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
  game = new Game([picks[0].map((p) => ({ ...p })), picks[1].map((p) => ({ ...p }))], mode === 'bot' ? difficulty : 'normal', seed);
  if (mode !== 'bot') game.incomeMul = [1, 1];
  game.autoCast = [false, false];
  myAuto = store.get('tl-auto') === '1';
  ls = null;
  if (mode === 'bot') { game.autoCast[me] = myAuto; game.autoCast[foe()] = true; }
  else { lsInit(); if (myAuto) lsCmd({ c: 'auto', on: true }); }
  bot = mode === 'bot' ? new Bot(foe(), 'normal', difficulty) : null;
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
  if (mode === 'guest') act({ c: 'auto', on: game.autoCast[me] });
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
    case 'cast': { const h = hero(cmd.uid); return !!h && g.cast(h); }
    case 'creep': return g.upgradeCreeps(cmd.lane, side);
    case 'send': return g.sendParty(side, cmd.nid, (cmd.uids as number[]).map(hero).filter((h): h is Hero => !!h)) > 0;
    case 'recall': g.recall(side, cmd.nid ?? undefined); return true;
    case 'upg': return ['armor', 'fury', 'mana', 'gun'].includes(cmd.k) && g.buyUpg(side, cmd.k);
    case 'barr': return g.buyBarracks(cmd.lane, side);
    case 'glyph': return g.glyph(side);
    case 'move': { const h = hero(cmd.uid); return !!h && h.side === side && g.moveHero(h, cmd.lane); }
    case 'home': { const h = hero(cmd.uid); return !!h && h.side === side && g.sendHome(h); }
    case 'recallHero': { const h = hero(cmd.uid); if (h) g.recallHero(h); return !!h; }
    case 'auto': g.autoCast[side] = !!cmd.on; return true;
    case 'surrender': if (g.winner === null) g.winner = (1 - side) as Side; return true;
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
    cast.onclick = () => {
      selected = h;
      const hp = g.heroPos(h);
      renderer?.focus(hp.x, hp.y);
      if (!g.canCast(h) || !act({ c: 'cast', uid: h.uid })) { pulse(cast); sound.play('deny'); }
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

function syncPanel() {
  const g = game!;
  $('gold').textContent = String(Math.floor(g.gold[me]));
  $('myHp').style.width = (100 * g.throne[me]) / BAL.throneHp + '%';
  $('foeHp').style.width = (100 * g.throne[foe()]) / BAL.throneHp + '%';
  $('clock').textContent = clock(g.t);
  const ping = ls && ls.rtt ? ` · ${Math.round(ls.rtt)} мс` : '';
  $('waveInfo').textContent = lsWaiting ? (mode === 'guest' ? 'ждём хоста…' : 'ждём соперника…') + ping : `волна ${g.waveNo} · ${Math.ceil(g.waveTimer)} с${ping}`;
  for (const b of heroBtns) {
    const { h } = b;
    b.cast.classList.toggle('ready', g.canCast(h));
    b.cast.classList.toggle('sel', selected === h);
    if (h.dead) { b.cdv.hidden = false; b.cdv.textContent = '✝' + Math.ceil(h.respawn); }
    else if (h.cd > 0) { b.cdv.hidden = false; b.cdv.textContent = String(Math.ceil(h.cd)); }
    else b.cdv.hidden = true;
    b.mana.style.width = (100 * h.mana) / h.maxMana + '%';
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
    const cheapest = (ks: ('armor' | 'fury' | 'mana' | 'gun')[]) => Math.min(...ks.map((k) => g.upgCost(me, k) ?? Infinity));
    $('altarBtn').classList.toggle('can', g.gold[me] >= cheapest(['armor', 'fury', 'mana']));
    $('throneBtn').classList.toggle('can', g.gold[me] >= cheapest(['gun']) || g.canGlyph(me));
    if (!$('shopModal').hidden) renderShop();
  }
  $('recallAll').hidden = !g.heroes.some((h) => h.side === me && h.trip && h.trip.phase !== 'back');
  const counts = g.raceCounts(me);
  const key = JSON.stringify(counts);
  if (key !== synKey) {
    synKey = key;
    $('synergy').innerHTML = synergyHTML(counts, true);
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

$('synergy').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('.syn') as HTMLElement | null;
  if (!el || !game) return;
  const r = el.dataset.race as RaceId;
  const n = game.raceCounts(me)[r];
  const ti = tierIndex(r, n);
  const next = RACES[r].tiers[ti + 1];
  const orbs = game.orbs[me][r] ?? 0;
  toast(`${RACES[r].name} ${n}${orbs ? ` (сфер: ${orbs})` : ''}: ${ti >= 0 ? RACES[r].tiers[ti].text : 'бонуса пока нет'}${next ? `. С ${next.n}: ${next.text}` : ''}`, 'info');
});

// ---------- окно похода ----------
let tripNid = -1;
let tripPick = new Set<Hero>();

function openTrip(nid: number) {
  const g = game;
  if (!g) return;
  sound.play('tap');
  const n = g.neutrals[nid];
  tripNid = nid;
  const mineOut = g.party(nid, me);
  const free = g.heroes.filter((h) => h.side === me && !h.dead && !h.trip);
  const name = g.neutralName(n);
  $('tripTitle').textContent = n.kind === 'camp' ? 'Лесной лагерь' : name;
  if (n.kind === 'guard' && n.owner === me) {
    $('tripText').textContent = `${name} уже твой и даёт обзор на логово. Враг может его перехватить — следи за ним на миникарте.`;
    tripPick = new Set();
    renderTripHeroes();
    $<HTMLButtonElement>('tripGo').disabled = true;
    $('tripRecall').hidden = mineOut.length === 0;
    $('tripModal').hidden = false;
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
  tripPick = new Set();
  if ((n.kind === 'camp' || n.kind === 'guard') && free.length) {
    // предложим героя ближе всего к лагерю
    const best = [...free].sort((a, b) => dist(g.heroPos(a), n) - dist(g.heroPos(b), n))[0];
    tripPick.add(best);
  }
  renderTripHeroes();
  $('tripRecall').hidden = mineOut.length === 0;
  $('tripModal').hidden = false;
  modalPause = true;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
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
  renderShop();
  $('shopModal').hidden = false;
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
    text = 'Пушка трона отстреливает вражеских крипов у базы. Глиф спасает линии и трон в беде.';
    const c = g.upgCost(me, 'gun');
    rows += shopRow(BAL.gunUp.icon, BAL.gunUp.name, BAL.gunUp.text, g.upg[me].gun, BAL.upgCost.length, buy(c), 'upg:gun', c !== null && gold >= c);
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
$('surrender').onclick = () => { act({ c: 'surrender' }); $('pauseModal').hidden = true; paused = false; };
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
  if (mode !== 'bot' && link?.via === 'server') online.send({ t: 'result', winner: g.winner });
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
  const reward = (win ? 150 : 60) + 20 * g.stats.lords[me];
  meta.crystals += reward;
  meta.save();
  syncCrystals();
  $('resReward').textContent = `+✦ ${reward} кристаллов · всего ${meta.crystals}. Новых героев открывай при выборе команды.`;
  game = null;
  show('result');
}
$('again').onclick = () => {
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

/** Играть через свой сервер: он настроен, на связи и есть аккаунт. */
const useServer = () => online.configured && online.ready && !!online.me;

function renderProfileChip() {
  const b = $<HTMLButtonElement>('profileBtn');
  b.hidden = !online.configured;
  b.textContent = online.me ? `${online.me.name} · ★ ${online.me.rating}` : online.ready ? 'Войти' : 'Сервер недоступен';
  $('rankedBtn').hidden = !online.configured;
}

function applyServerProgress() {
  const p = online.me!;
  if (store.get('tl-dirty') === '1' && store.get('tl-acc-synced') === p.id) {
    // играли без связи — отправляем своё
    store.set('tl-dirty', '0');
    online.send({ t: 'save', crystals: meta.crystals, owned: [...meta.owned] });
    return;
  }
  store.set('tl-acc-synced', p.id);
  store.set('tl-dirty', '0');
  meta.crystals = p.crystals;
  meta.owned = new Set([...STARTER_IDS, ...p.owned.filter((id) => HEROES.some((h) => h.id === id))]);
  store.set('tl-crystals', String(meta.crystals));
  store.set('tl-owned', [...meta.owned].join(','));
  syncCrystals();
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
  $('accRating').textContent = `★ ${p.rating}`;
  const games = p.wins + p.losses;
  $('accStats').textContent = games ? `Побед: ${p.wins} · поражений: ${p.losses} · ${Math.round((100 * p.wins) / games)}%` : 'Рейтинговых боёв пока не было';
  $('passBtn').textContent = p.hasPass ? 'Сменить пароль' : 'Задать пароль';
}

function renderRatingLine() {
  const el = $('resRating');
  if (!lastEnded || !lastEnded.ranked || !online.me) { el.hidden = true; return; }
  const d = lastEnded.delta;
  el.hidden = false;
  el.textContent = `Рейтинг: ★ ${online.me.rating} (${d >= 0 ? '+' : ''}${d})`;
}

function startQueue() {
  if (!useServer()) {
    if (!online.ready) { toast('Нет связи с сервером', 'bad'); return; }
    openAccount('Создай аккаунт, чтобы играть рейтинговые бои.');
    return;
  }
  lastEnded = null;
  queueSince = performance.now();
  $('qRating').textContent = `★ ${online.me!.rating}`;
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
  applyServerProgress();
  renderProfileChip();
  if (!$('account').hidden) { renderAccount(); $('accStatus').textContent = ''; }
  if (!$('result').hidden) renderRatingLine();
});
online.on('error', (m: { where: string; text: string }) => {
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
  toast(`Соперник: ${m.foe.name} (★ ${m.foe.rating})`, 'info');
  onConnected(l, m.role);
});
online.on('ended', (m: Ended) => {
  lastEnded = m;
  if (!$('result').hidden) renderRatingLine();
});
online.on('top', (m: { list: { name: string; rating: number; wins: number; losses: number }[]; players: number; online: number }) => {
  $('topList').innerHTML = m.list.length
    ? m.list.map((x) => `<li class="${x.name === online.me?.name ? 'me' : ''}">${escapeHtml(x.name)}<span>★ ${x.rating}</span></li>`).join('')
    : '<li>Пока никого — сыграй первый рейтинговый бой!</li>';
  $('topInfo').textContent = `Игроков: ${m.players} · сейчас в сети: ${m.online}`;
});

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

$('profileBtn').onclick = () => openAccount();
$('rankedBtn').onclick = startQueue;
$('accBack').onclick = () => { renderProfileChip(); show('menu'); };
$('qCancel').onclick = () => { online.send({ t: 'unqueue' }); show('menu'); };
$('regBtn').onclick = () => {
  const name = $<HTMLInputElement>('regName').value.trim();
  if (name.length < 2) { $('accStatus').textContent = 'Имя — хотя бы 2 символа'; return; }
  store.set('tl-dirty', '0');
  online.send({ t: 'register', name, crystals: meta.crystals, owned: [...meta.owned] });
  $('accStatus').textContent = 'Создаём…';
};
$('loginBtn').onclick = () => {
  store.set('tl-dirty', '0');
  online.send({ t: 'login', name: $<HTMLInputElement>('loginName').value.trim(), password: $<HTMLInputElement>('loginPass').value });
  $('accStatus').textContent = 'Входим…';
};
$('nameBtn').onclick = () => online.send({ t: 'setName', name: $<HTMLInputElement>('newName').value.trim() });
$('passBtn').onclick = () => {
  online.send({ t: 'setPassword', password: $<HTMLInputElement>('newPass').value });
  $<HTMLInputElement>('newPass').value = '';
  $('accStatus').textContent = 'Пароль сохранён — теперь можно войти с другого телефона.';
};
$('logoutBtn').onclick = () => { online.logout(); renderAccount(); renderProfileChip(); online.start(); };
setInterval(() => {
  if (!$('queue').hidden) {
    const t = Math.floor((performance.now() - queueSince) / 1000);
    $('qTimer').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
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
if (location.hash.includes('debug')) Object.assign(window, { __game: () => game, __renderer: () => renderer, __online: online, __castle: drawCastleFigure });
