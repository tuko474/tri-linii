// Точка входа: меню → (лобби) → драфт → расстановка → бой → итог.
import { BAL, Difficulty, WORLD } from './data/config';
import { HEROES, HeroDef, STARTER_IDS, heroById } from './data/heroes';
import { RACES, RACE_IDS, RaceId, tierIndex } from './data/races';
import { portraitURL, raceURL, skillURL } from './render/art';
import { Sound } from './audio';
import { Renderer, clock } from './render/renderer';
import { Bot } from './sim/bot';
import { Draft, PICK_SECONDS, botDraftPick, botPlacement, randomPick } from './sim/draft';
import { Game } from './sim/game';
import { LANE_NAMES, LANE_SHORT } from './sim/map';
import type { GameEvent, Hero, Pick, Sfx, Side } from './sim/types';
import { Link, hostRoom, joinRoom, netMode, newRoomCode } from './net';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const SCREENS = ['menu', 'how', 'pick', 'lobby', 'draft', 'place', 'battle', 'result'];
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
  },
};
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
$('toLobby').onclick = () => { resetLobby(); show('lobby'); };
$('howBtn').onclick = () => show('how');
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

// ---------- коллекция героев (просмотр и покупка) ----------
function renderCards() {
  syncCrystals();
  const el = $('cards');
  el.innerHTML = '';
  const order = [...HEROES].sort((a, b) => RACE_IDS.indexOf(a.race) - RACE_IDS.indexOf(b.race) || Number(meta.owned.has(b.id)) - Number(meta.owned.has(a.id)));
  for (const h of order) {
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
$('lobbyBack').onclick = () => { link?.close(); link = null; show('menu'); };
$('hostBtn').onclick = async () => {
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
  lobbyStatus(`Соперник найден${l.via !== 'local' && l.via !== 'peer' ? ` (через ${l.via})` : ''}!`);
  l.onMessage = onNet;
  l.onClose = () => {
    link = null;
    if (game && game.winner === null && (mode === 'host' || mode === 'guest')) {
      game.winner = me;
      toast('Соперник отключился — победа за тобой', 'info');
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
    case 'start': // хост → гость
      if (mode === 'guest') startBattle(m.picks);
      break;
    case 'snap':
      if (mode === 'guest' && game) {
        game.applySnapshot(m.s);
        netEvents.push(...m.ev);
        netSfx.push(...m.sfx);
      }
      break;
    case 'cmd':
      if (mode === 'host' && game) applyCmd(1, m);
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
  $('foeName').textContent = mode === 'bot' ? 'Бот' : 'Соперник';
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
    $('draftInfo').innerHTML = `<img class="skill-ico" src="${skillURL(sel)}" alt=""><span><b>${sel.name}</b> · ${sel.role} · <span style="color:${race.color}">${race.name}</span>${note}<br>${sel.skill.name}: ${sel.skill.desc}. HP ${sel.hp}, урон ${sel.dmg}, дальность ${sel.range}.</span>`;
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
  link?.send({ t: 'start', picks });
  startBattle(picks);
}

// ---------- бой ----------
let game: Game | null = null;
let renderer: Renderer | null = null;
let bot: Bot | null = null;
let paused = false;
let modalPause = false;
let speed = 1;
let selected: Hero | null = null;
let heroBtns: { h: Hero; cast: HTMLButtonElement; up: HTMLElement; cdv: HTMLElement; mana: HTMLElement; badge: HTMLElement; back: HTMLButtonElement }[] = [];
let synKey = '';
let creepBtns: HTMLButtonElement[] = [];
let bossBtns: HTMLButtonElement[] = [];
let campHintShown = false;
let snapTimer = 0;
const netEvents: GameEvent[] = [];
const netSfx: Sfx[] = [];
const outEv: GameEvent[] = [];
const outSfx: Sfx[] = [];
const cv = $<HTMLCanvasElement>('cv');

function startBattle(picks: [Pick[], Pick[]]) {
  game = new Game([picks[0].map((p) => ({ ...p })), picks[1].map((p) => ({ ...p }))], mode === 'bot' ? difficulty : 'normal');
  if (mode !== 'bot') game.incomeMul = [1, 1];
  game.autoCast = [false, false];
  game.autoCast[me] = store.get('tl-auto') === '1';
  if (mode === 'bot') game.autoCast[foe()] = true;
  bot = mode === 'bot' ? new Bot(foe()) : null;
  renderer = new Renderer(cv, game, me);
  paused = false;
  modalPause = false;
  speed = 1;
  selected = null;
  snapTimer = 0;
  netEvents.length = 0;
  netSfx.length = 0;
  campHintShown = store.get('tl-camphint') === '1';
  $('speedBtn').textContent = '×1';
  $('speedBtn').hidden = mode !== 'bot';
  $('autoBtn').setAttribute('aria-pressed', String(game.autoCast[me]));
  $('pauseModal').hidden = true;
  $('tripModal').hidden = true;
  $('toasts').innerHTML = '';
  if (mode === 'guest') act({ c: 'auto', on: game.autoCast[me] });
  buildPanel();
  show('battle');
  fit();
}

/** Действие игрока: против бота и у хоста — сразу в игру, у гостя — хосту по сети. */
function act(cmd: any): boolean {
  if (!game) return false;
  if (mode === 'guest') { link?.send({ t: 'cmd', ...cmd }); return true; }
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
    const lname = document.createElement('span');
    lname.className = 'lname';
    lname.textContent = LANE_SHORT[h.lane];
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
      h, cast, up, back,
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
    b.onclick = () => { if (!act({ c: 'creep', lane: l })) sound.play('deny'); };
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
  $('waveInfo').textContent = `волна ${g.waveNo} · ${Math.ceil(g.waveTimer)} с`;
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
    const html = `<span>Крипы ${LANE_SHORT[l]}</span><small>${lvl} · враг ${g.creepLvl[l][foe()]}</small><span class="cost">${tail}</span>`;
    if (b.dataset.h !== html) { b.innerHTML = html; b.dataset.h = html; }
    b.disabled = maxed || g.gold[me] < cost;
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
  $('recallAll').hidden = !g.heroes.some((h) => h.side === me && h.trip && h.trip.phase !== 'back');
  const counts = g.raceCounts(me);
  const key = JSON.stringify(counts);
  if (key !== synKey) {
    synKey = key;
    $('synergy').innerHTML = synergyHTML(counts, true);
  }
  // события: у гостя — пришедшие от хоста, у остальных — свои из симуляции
  const evs = mode === 'guest' ? netEvents.splice(0) : g.events.filter((e) => e.to === null || e.to === me);
  if (mode !== 'guest') g.events.length = 0;
  for (const e of evs) toast(e.text, e.tone);
  if (!campHintShown && g.neutrals.some((n) => n.kind === 'camp' && n.alive)) {
    campHintShown = true;
    store.set('tl-camphint', '1');
    toast('В лесу появились монстры: нажми на лагерь и отправь героя за золотом', 'info');
  }
  const sfx = mode === 'guest' ? netSfx.splice(0) : g.sfx.filter((x) => x.to === null || x.to === me);
  if (mode !== 'guest') g.sfx.length = 0;
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
  const on = !game.autoCast[me];
  game.autoCast[me] = on;
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

function finish() {
  const g = game!;
  const win = g.winner === me;
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
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  tickDraft(now);
  if (game && renderer) {
    const net = mode !== 'bot';
    // в сетевой игре пауза и окна не останавливают бой
    const running = (net || (!paused && !modalPause)) && game.winner === null;
    if (running) {
      acc += dt * speed;
      while (acc >= STEP) {
        bot?.update(game, STEP);
        game.update(STEP); // у гостя — предсказание между снимками хоста
        acc -= STEP;
      }
      if (mode === 'guest') { game.events.length = 0; game.sfx.length = 0; }
    }
    if (mode === 'host' && link) {
      // события для гостя копим, свои хост покажет в syncPanel
      for (const e of game.events) if (e.to === null || e.to === 1) outEv.push(e);
      for (const x of game.sfx) if (x.to === null || x.to === 1) outSfx.push(x);
      game.events = game.events.filter((e) => e.to !== 1);
      game.sfx = game.sfx.filter((x) => x.to !== 1);
      snapTimer -= dt;
      if (snapTimer <= 0 || game.winner !== null) {
        snapTimer = link.snapEvery;
        link.send({ t: 'snap', s: game.snapshot(), ev: outEv.splice(0), sfx: outSfx.splice(0) });
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
