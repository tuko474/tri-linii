// Рейтинг для кастомки Dota 2 «Arena of Defense» (аддон arena_of_defense в Steam Workshop).
// Соло-ММР, команды из 5 игроков (капитан + приглашения по Steam-аккаунту) и командный ММР.
//
// Как это работает:
//   • Сервер игры Доты (Lua, rating.lua) шлёт POST /dota/api с JSON { op, ... }.
//     Подлинность — заголовок X-AOD-Key: GetDedicatedServerKeyV3("aod"). Этот ключ знают только
//     серверы Valve, на которых идёт наша кастомка, — подделать итог матча из браузера нельзя.
//     Первый ключ, пришедший с настоящего сервера Valve, запоминается в dota_key.txt рядом с базой.
//   • Тест из Workshop Tools (test: true) пишет в отдельную базу dota_test.db — боевая не трогается.
//   • Публичная таблица лидеров: GET /dota (страница) и GET /dota/top.json?kind=solo|team.
//   • Сезоны по временам года (зима с 1 дек, весна с 1 мар, лето с 1 июн, осень с 1 сен, время МСК).
//     Конец сезона — сам при первом запросе/по таймеру: значки по месту, архив season_results, сброс 50%.
//   • Шкала как в Доте: старт 2000, ±25 за равную игру. Старые базы (старт 1000) пересчитываются один раз.
//
// Базы: dota.db и dota_test.db в той же папке, что и база мобильной игры (/var/lib/arena).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.dirname(process.env.DB || new URL('./arena.db', import.meta.url).pathname);
const KEY_FILE = path.join(DATA_DIR, 'dota_key.txt');

// ---------- правила (меняй тут) ----------
// Шкала как в Доте: равная игра ≈ ±25, калибровка ≈ ±40 (Эло с делителем 800 вместо 400).
export const DOTA = {
  START_MMR: 2000,
  CALIB_GAMES: 10,      // первые игры — калибровка, рейтинг меняется сильнее
  K_CALIB: 80,
  K: 50,
  SCALE: 800,           // делитель в формуле Эло (×2 к шахматному — числа как в Доте)
  TEAM_START: 2000,
  TEAM_K: 64,
  TEAM_K_CALIB: 96,
  TEAM_CALIB_GAMES: 5,
  TEAM_SIZE: 5,
  INVITE_DAYS: 3,
  TOP: 30,
  // сезоны
  SEASON_RESET: 0.5,        // новый ММР = старт + (ММР − старт) × 0.5
  RECALIB_GAMES: 5,         // перекалибровка в начале сезона
  TEAM_RECALIB_GAMES: 3,
  SEASON_MIN_GAMES: 15,     // минимум рейтинговых игр за сезон для значка
  TEAM_SEASON_MIN_GAMES: 5, // для командного значка
  TRIAL_SEASONS: ['2026-autumn'], // пробные сезоны — без значков
};

// Значки сезона. order — чем больше, тем почётнее (для «лучшего значка»).
export const BADGES = {
  food:     { order: 1, icon: '🥩', ru: 'Корм для крипов',          en: 'Creep Food' },
  feeder:   { order: 2, icon: '🍼', ru: 'Фидер со стажем',          en: 'Veteran Feeder' },
  rune:     { order: 3, icon: '🔮', ru: 'Ловец рун',                en: 'Rune Catcher' },
  courier:  { order: 4, icon: '🐴', ru: 'Гроза курьеров',           en: 'Courier Hunter' },
  baby:     { order: 5, icon: '🐢', ru: 'Укротитель Бэби Рошана',   en: 'Baby Roshan Tamer' },
  throne:   { order: 6, icon: '🪑', ru: 'Ломатель тронов',          en: 'Throne Breaker' },
  legend:   { order: 7, icon: '🏆', ru: 'Легенда Арены',            en: 'Arena Legend' },
  champion: { order: 8, icon: '👑', ru: 'Сам себе Рошан',           en: 'Roshan Himself' },
  gang3:    { order: 1, icon: '🥉', ru: 'Так себе банда',           en: 'So-So Gang', team: true },
  gang2:    { order: 2, icon: '🥈', ru: 'Почти банда',              en: 'Almost a Gang', team: true },
  gang1:    { order: 3, icon: '🥇', ru: 'Банда сезона',             en: 'Gang of the Season', team: true },
};
// Доли таблицы сверху вниз (накопительно): верхние 4% — тронов, до 12% — Бэби Рошана, и т.д.
const TIERS = [['throne', 0.04], ['baby', 0.12], ['courier', 0.25], ['rune', 0.45], ['feeder', 0.70], ['food', 1]];
const LEGEND_TOP = 10;      // места 2–10 — «Легенда Арены» (если они в верхних 12%)
const LEGEND_SHARE = 0.12;
// Когда игра рейтинговая. В тесте (Tools, один с ботами) правила мягче — чтобы можно было проверить.
const RULES = {
  real: { minMinutes: 10, minPerTeam: 3, maxDiff: 1 },
  test: { minMinutes: 0, minPerTeam: 1, maxDiff: 5 },
};

// ---------- базы ----------
function openDb(file) {
  const db = new DatabaseSync(path.join(DATA_DIR, file));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS players (
      sid INTEGER PRIMARY KEY,           -- Steam account id (32 бита)
      name TEXT NOT NULL DEFAULT '',
      mmr INTEGER NOT NULL DEFAULT ${DOTA.START_MMR},
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      abandons INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,
      seen INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
      captain INTEGER NOT NULL,
      mmr INTEGER NOT NULL DEFAULT ${DOTA.TEAM_START},
      games INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      sid INTEGER PRIMARY KEY,           -- игрок может быть только в одной команде
      team INTEGER NOT NULL,
      joined INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS invites (
      team INTEGER NOT NULL,
      sid INTEGER NOT NULL,
      by INTEGER NOT NULL,
      created INTEGER NOT NULL,
      PRIMARY KEY (team, sid)
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      created INTEGER NOT NULL,
      ended INTEGER,
      kind TEXT,                         -- solo | team | NULL (не рейтинговая)
      reason TEXT,                       -- почему не рейтинговая
      winner INTEGER,
      duration INTEGER,
      start TEXT NOT NULL,               -- JSON: кто был в начале и команды
      result TEXT                        -- JSON: итог для повторного ответа
    );
    CREATE TABLE IF NOT EXISTS history (
      match TEXT NOT NULL,
      sid INTEGER NOT NULL,
      side INTEGER NOT NULL,
      hero TEXT,
      win INTEGER NOT NULL,
      abandoned INTEGER NOT NULL DEFAULT 0,
      delta INTEGER,
      kind TEXT,
      at INTEGER NOT NULL,
      PRIMARY KEY (match, sid)
    );
    CREATE INDEX IF NOT EXISTS history_sid ON history (sid, at);
    CREATE INDEX IF NOT EXISTS members_team ON members (team);
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS season_results (
      season TEXT NOT NULL,              -- '2026-autumn'
      kind TEXT NOT NULL,                -- solo | team | member (игрок из команды-призёра)
      id INTEGER NOT NULL,               -- steam id или id команды
      name TEXT,
      tag TEXT,
      place INTEGER,
      mmr INTEGER,
      games INTEGER,
      wins INTEGER,
      badge TEXT,                        -- id из BADGES или NULL (пробный сезон / мало игр)
      PRIMARY KEY (season, kind, id)
    );
    CREATE INDEX IF NOT EXISTS season_results_id ON season_results (id, kind);
  `);
  migrate(db);
  return db;
}

// ---------- миграции ----------
const metaGet = (db, key) => db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
const metaSet = (db, key, value) => db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(value));

function addColumn(db, table, col, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

function migrate(db) {
  // сезонная статистика и калибровка отдельным счётчиком (после сброса сезона — 5 игр)
  addColumn(db, 'players', 'calib_left', `INTEGER NOT NULL DEFAULT ${DOTA.CALIB_GAMES}`);
  addColumn(db, 'players', 's_games', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'players', 's_wins', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'players', 's_peak', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'teams', 'calib_left', `INTEGER NOT NULL DEFAULT ${DOTA.TEAM_CALIB_GAMES}`);
  addColumn(db, 'teams', 's_games', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'teams', 's_wins', 'INTEGER NOT NULL DEFAULT 0');

  // переход на шкалу ×2 (старт 1000 → 2000, ±12 → ±25): один раз для уже сыгравших
  if (metaGet(db, 'scale') !== '2') {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        UPDATE players SET mmr = MAX(0, 2000 + (mmr - 1000) * 2),
          calib_left = MAX(0, ${DOTA.CALIB_GAMES} - games), s_games = games, s_wins = wins;
        UPDATE players SET s_peak = mmr;
        UPDATE teams SET mmr = MAX(0, 2000 + (mmr - 1000) * 2),
          calib_left = MAX(0, ${DOTA.TEAM_CALIB_GAMES} - games), s_games = games, s_wins = wins;
        UPDATE history SET delta = delta * 2 WHERE delta IS NOT NULL;
      `);
      metaSet(db, 'scale', '2');
      db.exec('COMMIT');
      console.log('[dota] рейтинг переведён на шкалу ×2 (старт 2000)');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (!metaGet(db, 'season')) metaSet(db, 'season', seasonOf(now()).id);
}

// ---------- сезоны (по временам года, время московское) ----------
// Зима: 1 дек – конец фев · Весна: 1 мар – 31 мая · Лето: 1 июн – 31 авг · Осень: 1 сен – 30 ноя
const MSK = 3 * 3600e3;
const SEASON_NAMES = {
  winter: ['Зима', 'Winter'], spring: ['Весна', 'Spring'], summer: ['Лето', 'Summer'], autumn: ['Осень', 'Autumn'],
};
export function seasonOf(ts) {
  const d = new Date(ts + MSK);          // UTC-поля этой даты = московское время
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();             // 0 = январь
  let key, year, startM;
  if (m === 11) [key, year, startM] = ['winter', y, 11];
  else if (m <= 1) [key, year, startM] = ['winter', y - 1, 11];
  else if (m <= 4) [key, year, startM] = ['spring', y, 2];
  else if (m <= 7) [key, year, startM] = ['summer', y, 5];
  else [key, year, startM] = ['autumn', y, 8];
  const start = Date.UTC(year, startM, 1) - MSK;
  const end = Date.UTC(year, startM + 3, 1) - MSK;   // начало следующего сезона
  const id = `${year}-${key}`;
  const [ru, en] = SEASON_NAMES[key];
  const yearText = key === 'winter' ? `${year}/${String(year + 1).slice(2)}` : String(year);
  return { id, key, start, end, ru: `${ru} ${yearText}`, en: `${en} ${yearText}`, trial: DOTA.TRIAL_SEASONS.includes(id) };
}
export function seasonById(id) {
  const [y, key] = String(id).split('-');
  const startM = { winter: 11, spring: 2, summer: 5, autumn: 8 }[key];
  if (startM === undefined) return null;
  return seasonOf(Date.UTC(Number(y), startM, 15) - MSK);
}
const seasonView = (s, t = now()) => ({
  id: s.id, ru: s.ru, en: s.en, trial: s.trial, end: s.end,
  daysLeft: Math.max(0, Math.ceil((s.end - t) / 86400e3)),
});

// Место в таблице → значок. n — сколько игроков набрали минимум игр за сезон.
export function badgeForPlace(place, n) {
  if (place === 1) return 'champion';
  if (place <= LEGEND_TOP && place <= Math.ceil(n * LEGEND_SHARE)) return 'legend';
  for (const [id, share] of TIERS) if (place <= Math.ceil(n * share)) return id;
  return 'food';
}
const badgeView = (id, season) => (id && BADGES[id] ? { id, icon: BADGES[id].icon, ru: BADGES[id].ru, en: BADGES[id].en, season: season || '' } : null);

// Итоги сезона: значки, архив и мягкий сброс. Вызывается внутри транзакции.
export function closeSeason(db, seasonId, { dryRun = false, forceBadges = false } = {}) {
  const s = seasonById(seasonId);
  const giveBadges = forceBadges || (s && !s.trial);
  const solo = db.prepare(`SELECT sid, name, mmr, s_games, s_wins FROM players WHERE s_games > 0
    ORDER BY mmr DESC, s_wins DESC, sid`).all();
  const qualified = solo.filter((p) => p.s_games >= DOTA.SEASON_MIN_GAMES);
  const teams = db.prepare(`SELECT id, name, tag, mmr, s_games, s_wins FROM teams WHERE s_games > 0
    ORDER BY mmr DESC, s_wins DESC, id`).all();
  const tq = teams.filter((t) => t.s_games >= DOTA.TEAM_SEASON_MIN_GAMES);
  const out = { season: seasonId, trial: !giveBadges, solo: [], teams: [] };
  const ins = db.prepare(`INSERT OR REPLACE INTO season_results (season, kind, id, name, tag, place, mmr, games, wins, badge)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  solo.forEach((p, i) => {
    const qi = qualified.indexOf(p);
    const badge = giveBadges && qi >= 0 ? badgeForPlace(qi + 1, qualified.length) : null;
    out.solo.push({ place: i + 1, name: p.name, mmr: p.mmr, games: p.s_games, badge });
    if (!dryRun) ins.run(seasonId, 'solo', p.sid, p.name, null, i + 1, p.mmr, p.s_games, p.s_wins, badge);
  });
  teams.forEach((t, i) => {
    const qi = tq.indexOf(t);
    const badge = giveBadges && qi >= 0 && qi < 3 ? ['gang1', 'gang2', 'gang3'][qi] : null;
    out.teams.push({ place: i + 1, name: t.name, tag: t.tag, mmr: t.mmr, games: t.s_games, badge });
    if (dryRun) return;
    ins.run(seasonId, 'team', t.id, t.name, t.tag, i + 1, t.mmr, t.s_games, t.s_wins, badge);
    // значок банды получают и все, кто в составе на конец сезона
    if (badge) for (const m of membersOf(db, t.id)) ins.run(seasonId, 'member', m.sid, m.name, t.tag, i + 1, t.mmr, null, null, badge);
  });
  if (dryRun) return out;
  // мягкий сброс: половина пути к старту, короткая перекалибровка
  const r = DOTA.SEASON_RESET;
  db.prepare(`UPDATE players SET mmr = CAST(ROUND(? + (mmr - ?) * ?) AS INTEGER),
    calib_left = MAX(calib_left, CASE WHEN games > 0 THEN ? ELSE calib_left END), s_games = 0, s_wins = 0`)
    .run(DOTA.START_MMR, DOTA.START_MMR, r, DOTA.RECALIB_GAMES);
  db.prepare('UPDATE players SET s_peak = mmr').run();
  db.prepare(`UPDATE teams SET mmr = CAST(ROUND(? + (mmr - ?) * ?) AS INTEGER),
    calib_left = MAX(calib_left, CASE WHEN games > 0 THEN ? ELSE calib_left END), s_games = 0, s_wins = 0`)
    .run(DOTA.TEAM_START, DOTA.TEAM_START, r, DOTA.TEAM_RECALIB_GAMES);
  return out;
}

// Если наступил новый сезон — закрываем прошлый (один раз). Вызывать внутри транзакции.
function checkSeason(db) {
  const cur = seasonOf(now());
  const saved = metaGet(db, 'season');
  if (saved === cur.id) return cur;
  if (saved) {
    const res = closeSeason(db, saved);
    console.log(`[dota] сезон ${saved} закрыт: игроков ${res.solo.length}, команд ${res.teams.length}${res.trial ? ' (пробный, без значков)' : ''}`);
  }
  metaSet(db, 'season', cur.id);
  return cur;
}

// Лучший значок игрока за все сезоны: соло и банда отдельно
function bestBadges(db, sid) {
  const rows = db.prepare(`SELECT season, kind, badge FROM season_results WHERE id = ? AND kind IN ('solo','member') AND badge IS NOT NULL`).all(sid);
  let solo = null, gang = null;
  for (const r of rows) {
    const b = BADGES[r.badge];
    if (!b) continue;
    const slot = b.team ? 'gang' : 'solo';
    const cur = slot === 'gang' ? gang : solo;
    if (!cur || b.order > BADGES[cur.badge].order || (b.order === BADGES[cur.badge].order && r.season > cur.season)) {
      if (slot === 'gang') gang = r; else solo = r;
    }
  }
  const name = (id) => { const s = seasonById(id); return s ? s.ru : id; };
  return { badge: solo ? badgeView(solo.badge, name(solo.season)) : null, gang: gang ? badgeView(gang.badge, name(gang.season)) : null };
}

// Текущий ранг в этом сезоне (каким был бы значок, если бы сезон кончился сейчас)
function liveTier(db, p) {
  if (p.s_games < DOTA.SEASON_MIN_GAMES) return null;
  const n = db.prepare('SELECT COUNT(*) AS n FROM players WHERE s_games >= ?').get(DOTA.SEASON_MIN_GAMES).n;
  const above = db.prepare('SELECT COUNT(*) AS n FROM players WHERE s_games >= ? AND (mmr > ? OR (mmr = ? AND s_wins > ?))')
    .get(DOTA.SEASON_MIN_GAMES, p.mmr, p.mmr, p.s_wins).n;
  return badgeView(badgeForPlace(above + 1, n));
}

const dbs = {};
const dbFor = (test) => (dbs[test ? 'test' : 'real'] ||= openDb(test ? 'dota_test.db' : 'dota.db'));

// ---------- помощники ----------
const now = () => Date.now();
const intSid = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 && n < 2 ** 33 ? n : 0;
};
const cleanName = (s) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 32) || 'Игрок';
const teamNameOk = (s) => /^[\p{L}\p{N} _.\-]{3,20}$/u.test(s) && s.trim() === s && !/\s{2}/.test(s);
const tagOk = (s) => /^[\p{L}\p{N}]{2,5}$/u.test(s);
const fail = (err, err_en = err) => ({ ok: false, err, err_en });

function getPlayer(db, sid) {
  return db.prepare('SELECT * FROM players WHERE sid = ?').get(sid);
}
function ensurePlayer(db, sid, name) {
  const t = now();
  const p = getPlayer(db, sid);
  if (!p) {
    db.prepare('INSERT INTO players (sid, name, mmr, s_peak, calib_left, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(sid, cleanName(name), DOTA.START_MMR, DOTA.START_MMR, DOTA.CALIB_GAMES, t, t);
    return getPlayer(db, sid);
  }
  if (name) db.prepare('UPDATE players SET name = ?, seen = ? WHERE sid = ?').run(cleanName(name), t, sid);
  return getPlayer(db, sid);
}
function teamOf(db, sid) {
  const m = db.prepare('SELECT team FROM members WHERE sid = ?').get(sid);
  return m ? db.prepare('SELECT * FROM teams WHERE id = ?').get(m.team) : null;
}
function membersOf(db, teamId) {
  return db.prepare(`SELECT m.sid, m.joined, p.name, p.mmr, p.games FROM members m
    LEFT JOIN players p ON p.sid = m.sid WHERE m.team = ? ORDER BY m.joined`).all(teamId);
}
function rankOf(db, mmr) {
  return db.prepare('SELECT COUNT(*) AS n FROM players WHERE games > 0 AND mmr > ?').get(mmr).n + 1;
}
const teamShort = (t) => (t ? { id: t.id, name: t.name, tag: t.tag, mmr: t.mmr, captain: t.captain } : null);
const playerView = (db, p) => ({
  sid: p.sid, name: p.name, mmr: p.mmr, games: p.games, wins: p.wins, losses: p.losses, abandons: p.abandons,
  calib: p.calib_left,
  rank: p.games > 0 ? rankOf(db, p.mmr) : 0,
  sGames: p.s_games, sWins: p.s_wins, sPeak: p.s_peak,
  sNeed: Math.max(0, DOTA.SEASON_MIN_GAMES - p.s_games),   // сколько игр осталось до значка
  live: liveTier(db, p),
  ...bestBadges(db, p.sid),
});
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / DOTA.SCALE));
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

// Полная команда стороны: все игроки стороны — это ровно состав одной команды из 5
function fullTeamOfSide(db, sids) {
  if (sids.length !== DOTA.TEAM_SIZE) return null;
  const t = teamOf(db, sids[0]);
  if (!t) return null;
  const mem = membersOf(db, t.id).map((m) => m.sid);
  if (mem.length !== DOTA.TEAM_SIZE) return null;
  return sids.every((s) => mem.includes(s)) ? t : null;
}

// ---------- операции ----------
const OPS = {};

// Начало матча: имена, рейтинги и команды игроков (для драфта)
OPS.start = (db, b) => {
  const list = (Array.isArray(b.players) ? b.players : []).slice(0, 24);
  const id = String(b.match || '').slice(0, 40) || crypto.randomBytes(8).toString('hex');
  const players = {};
  const sides = { 2: [], 3: [] };
  for (const x of list) {
    const sid = intSid(x.sid);
    if (!sid) continue;
    const p = ensurePlayer(db, sid, x.name);
    const t = teamOf(db, sid);
    players[sid] = { ...playerView(db, p), team: teamShort(t) };
    if (sides[x.team]) sides[x.team].push(sid);
  }
  const good = fullTeamOfSide(db, sides[2]);
  const bad = fullTeamOfSide(db, sides[3]);
  const teamMatch = !!(good && bad && good.id !== bad.id);
  // повторный вызов (например, команду собрали прямо в лобби) обновляет состав, пока матч не окончен
  const startJson = JSON.stringify({ sides, good: good?.id ?? null, bad: bad?.id ?? null });
  const old = db.prepare('SELECT ended FROM matches WHERE id = ?').get(id);
  if (!old) db.prepare('INSERT INTO matches (id, created, start) VALUES (?, ?, ?)').run(id, now(), startJson);
  else if (!old.ended) db.prepare('UPDATE matches SET start = ? WHERE id = ?').run(startJson, id);
  return { ok: true, match: id, players, teamMatch, teams: { 2: teamShort(good), 3: teamShort(bad) }, season: seasonView(seasonOf(now())) };
};

// Экран выбора команд: ММР и команды игроков лобби — для автобаланса.
// Если в лобби ровно две полные команды по 5 — отдаём их составы (играют команда на команду).
OPS.lobby = (db, b) => {
  const list = (Array.isArray(b.players) ? b.players : []).slice(0, 24);
  const players = {};
  const byTeam = {};
  for (const x of list) {
    const sid = intSid(x.sid);
    if (!sid) continue;
    const p = ensurePlayer(db, sid, x.name);
    const t = teamOf(db, sid);
    players[sid] = { mmr: p.mmr, calib: p.calib_left, team: t ? t.id : 0 };
    if (t) (byTeam[t.id] ||= []).push(sid);
  }
  const full = Object.entries(byTeam).filter(([tid, sids]) =>
    sids.length === DOTA.TEAM_SIZE && membersOf(db, Number(tid)).length === DOTA.TEAM_SIZE);
  let teamMatch = null;
  if (full.length === 2 && Object.keys(players).length === DOTA.TEAM_SIZE * 2) {
    const [a, b2] = full.map(([tid, sids]) => ({ team: teamShort(db.prepare('SELECT * FROM teams WHERE id = ?').get(Number(tid))), sids }));
    teamMatch = { a, b: b2 };
  }
  return { ok: true, players, teamMatch };
};

// Итог матча: проверяем, рейтинговый ли, и меняем ММР
OPS.end = (db, b, test) => {
  const id = String(b.match || '').slice(0, 40);
  const m = db.prepare('SELECT * FROM matches WHERE id = ?').get(id);
  if (!m) return fail('матч не найден', 'match not found');
  if (m.ended) return JSON.parse(m.result); // повтор — тот же ответ
  const rules = test ? RULES.test : RULES.real;
  const winner = Number(b.winner);
  const duration = Math.max(0, Math.floor(Number(b.duration) || 0));
  const list = [];
  const seen = new Set();
  for (const x of Array.isArray(b.players) ? b.players : []) {
    const sid = intSid(x.sid);
    const side = Number(x.team);
    if (!sid || seen.has(sid) || (side !== 2 && side !== 3)) continue;
    seen.add(sid);
    const p = ensurePlayer(db, sid, x.name);
    list.push({ sid, side, hero: String(x.hero || '').slice(0, 48), abandoned: !!x.abandoned, p });
  }
  const bySide = { 2: list.filter((x) => x.side === 2), 3: list.filter((x) => x.side === 3) };

  let reason = null;
  let reasonEn = null;
  if (winner !== 2 && winner !== 3) [reason, reasonEn] = ['победитель не определён', 'no winner'];
  else if (b.cheats) [reason, reasonEn] = ['включены читы', 'cheats enabled'];
  else if (duration < rules.minMinutes * 60) [reason, reasonEn] = [`матч короче ${rules.minMinutes} мин`, `match shorter than ${rules.minMinutes} min`];
  else if (Math.min(bySide[2].length, bySide[3].length) < rules.minPerTeam) [reason, reasonEn] = [`меньше ${rules.minPerTeam} игроков в команде`, `fewer than ${rules.minPerTeam} players per team`];
  else if (Math.abs(bySide[2].length - bySide[3].length) > rules.maxDiff) [reason, reasonEn] = ['команды неравные по числу игроков', 'teams have unequal player counts'];

  const start = JSON.parse(m.start || '{}');
  const t = now();
  const results = {};
  let kind = null;
  const teams = {};

  if (!reason) {
    // командная игра: обе стороны — полные составы разных команд (и были ими с начала матча)
    const good = fullTeamOfSide(db, bySide[2].map((x) => x.sid));
    const bad = fullTeamOfSide(db, bySide[3].map((x) => x.sid));
    if (good && bad && good.id !== bad.id && start.good === good.id && start.bad === bad.id) {
      kind = 'team';
      const pair = { 2: good, 3: bad };
      for (const side of [2, 3]) {
        const me = pair[side];
        const op = pair[5 - side];
        const win = side === winner ? 1 : 0;
        const k = me.calib_left > 0 ? DOTA.TEAM_K_CALIB : DOTA.TEAM_K;
        let d = Math.round(k * (win - expected(me.mmr, op.mmr)));
        d = win ? Math.max(1, d) : Math.min(-1, d);
        db.prepare(`UPDATE teams SET mmr = MAX(0, mmr + ?), games = games + 1, wins = wins + ?, losses = losses + ?,
          calib_left = MAX(0, calib_left - 1), s_games = s_games + 1, s_wins = s_wins + ? WHERE id = ?`)
          .run(d, win, 1 - win, win, me.id);
        teams[side] = { id: me.id, name: me.name, tag: me.tag, before: me.mmr, after: Math.max(0, me.mmr + d), delta: d };
      }
      for (const x of list) {
        const win = x.side === winner && !x.abandoned ? 1 : 0;
        db.prepare('INSERT OR REPLACE INTO history (match, sid, side, hero, win, abandoned, delta, kind, at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, x.sid, x.side, x.hero, win, x.abandoned ? 1 : 0, teams[x.side].delta, 'team', t);
        if (x.abandoned) db.prepare('UPDATE players SET abandons = abandons + 1 WHERE sid = ?').run(x.sid);
        results[x.sid] = { team: true, delta: teams[x.side].delta, win };
      }
    } else {
      kind = 'solo';
      const mean = { 2: avg(bySide[2].map((x) => x.p.mmr)), 3: avg(bySide[3].map((x) => x.p.mmr)) };
      const leaverIn = { 2: bySide[2].some((x) => x.abandoned), 3: bySide[3].some((x) => x.abandoned) };
      for (const x of list) {
        const p = x.p;
        const win = x.side === winner && !x.abandoned ? 1 : 0;   // ушедший — всегда поражение
        const calib = p.calib_left > 0;
        const k = calib ? DOTA.K_CALIB : DOTA.K;
        const e = expected(mean[x.side], mean[5 - x.side]);
        let d = Math.round(k * (win - e));
        d = win ? Math.max(1, d) : Math.min(-1, d);
        if (x.abandoned) d = Math.min(d, -Math.round(k * 0.75));          // ливер теряет заметно
        else if (!win && leaverIn[x.side]) d = Math.min(-1, Math.round(d / 2)); // из-за ливера — вполовину
        const after = Math.max(0, p.mmr + d);
        db.prepare(`UPDATE players SET mmr = ?, games = games + 1, wins = wins + ?, losses = losses + ?,
          abandons = abandons + ?, calib_left = MAX(0, calib_left - 1), s_games = s_games + 1, s_wins = s_wins + ?,
          s_peak = MAX(s_peak, ?) WHERE sid = ?`).run(after, win, 1 - win, x.abandoned ? 1 : 0, win, after, x.sid);
        db.prepare('INSERT OR REPLACE INTO history (match, sid, side, hero, win, abandoned, delta, kind, at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, x.sid, x.side, x.hero, win, x.abandoned ? 1 : 0, d, 'solo', t);
        results[x.sid] = { before: p.mmr, after, delta: d, win, abandoned: x.abandoned, calib };
      }
    }
  }
  const out = { ok: true, ranked: !reason, kind, reason, reason_en: reasonEn, winner, results, teams };
  db.prepare('UPDATE matches SET ended = ?, kind = ?, reason = ?, winner = ?, duration = ?, result = ? WHERE id = ?')
    .run(t, kind, reason, winner, duration, JSON.stringify(out), id);
  return out;
};

// Профиль игрока: рейтинг, команда, приглашения, последние игры
OPS.profile = (db, b) => {
  const sid = intSid(b.sid);
  if (!sid) return fail('нет игрока', 'no player');
  const p = ensurePlayer(db, sid, b.name);
  const t = teamOf(db, sid);
  const cutoff = now() - DOTA.INVITE_DAYS * 86400e3;
  db.prepare('DELETE FROM invites WHERE created < ?').run(cutoff);
  const invites = db.prepare(`SELECT i.team, i.by, t.name, t.tag, t.mmr, p.name AS byName FROM invites i
    JOIN teams t ON t.id = i.team LEFT JOIN players p ON p.sid = i.by WHERE i.sid = ?`).all(sid);
  const history = db.prepare('SELECT match, hero, win, abandoned, delta, kind, at FROM history WHERE sid = ? ORDER BY at DESC LIMIT 10').all(sid);
  let team = null;
  if (t) {
    team = {
      ...teamShort(t), games: t.games, wins: t.wins, losses: t.losses,
      members: membersOf(db, t.id).map((m) => ({ sid: m.sid, name: m.name, mmr: m.mmr, captain: m.sid === t.captain })),
      invited: db.prepare('SELECT i.sid, p.name FROM invites i LEFT JOIN players p ON p.sid = i.sid WHERE i.team = ?').all(t.id),
      rank: t.games > 0 ? db.prepare('SELECT COUNT(*) AS n FROM teams WHERE games > 0 AND mmr > ?').get(t.mmr).n + 1 : 0,
    };
  }
  return { ok: true, player: playerView(db, p), team, invites, history, season: seasonView(seasonOf(now())) };
};

// Таблица текущего сезона: кто играл в этом сезоне и уже откалиброван.
// games/wins — за сезон. badge — лучший значок прошлых сезонов, live — ранг сейчас.
OPS.top = (db, b) => {
  const season = seasonView(seasonOf(now()));
  const limit = Math.min(200, Math.max(1, Number(b.limit) || DOTA.TOP));
  if (b.kind === 'team') {
    const list = db.prepare(`SELECT id, name, tag, mmr, s_games AS games, s_wins AS wins FROM teams
      WHERE s_games > 0 ORDER BY mmr DESC, s_wins DESC LIMIT ?`).all(limit);
    list.forEach((t, i) => {
      const q = t.games >= DOTA.TEAM_SEASON_MIN_GAMES;
      t.live = q && i < 3 ? badgeView(['gang1', 'gang2', 'gang3'][i]) : null;
    });
    return { ok: true, kind: 'team', season, list };
  }
  const anyCalib = b.minGames !== undefined && Number(b.minGames) < DOTA.CALIB_GAMES; // тест в Tools — показываем всех
  const rows = db.prepare(`SELECT p.*, t.tag FROM players p
    LEFT JOIN members m ON m.sid = p.sid LEFT JOIN teams t ON t.id = m.team
    WHERE p.s_games > 0 ${anyCalib ? '' : 'AND p.calib_left = 0'} ORDER BY p.mmr DESC, p.s_wins DESC LIMIT ?`).all(limit);
  const list = rows.map((p) => ({
    sid: p.sid, name: p.name, mmr: p.mmr, games: p.s_games, wins: p.s_wins, tag: p.tag,
    live: liveTier(db, p), ...bestBadges(db, p.sid),
  }));
  return { ok: true, kind: 'solo', season, list };
};

// Архив: итоги прошедших сезонов (призёры)
OPS.seasons = (db) => {
  const ids = db.prepare('SELECT DISTINCT season FROM season_results ORDER BY season DESC').all().map((r) => r.season);
  const list = ids.map((id) => {
    const s = seasonById(id);
    return {
      id, ru: s?.ru || id, en: s?.en || id, trial: !!s?.trial,
      solo: db.prepare("SELECT name, place, mmr, games, badge FROM season_results WHERE season = ? AND kind = 'solo' ORDER BY place LIMIT 10").all(id),
      teams: db.prepare("SELECT name, tag, place, mmr, games, badge FROM season_results WHERE season = ? AND kind = 'team' ORDER BY place LIMIT 3").all(id),
    };
  });
  return { ok: true, list };
};

OPS.team_create = (db, b) => {
  const sid = intSid(b.sid);
  if (!sid) return fail('нет игрока', 'no player');
  ensurePlayer(db, sid, b.myName);
  const name = String(b.name || '').trim().replace(/\s+/g, ' ');
  const tag = String(b.tag || '').trim().toUpperCase();
  if (!teamNameOk(name)) return fail('Название: 3–20 символов (буквы, цифры, пробел, _ . -)', 'Name: 3–20 characters (letters, digits, space, _ . -)');
  if (!tagOk(tag)) return fail('Тег: 2–5 букв или цифр', 'Tag: 2–5 letters or digits');
  if (teamOf(db, sid)) return fail('Ты уже в команде — сначала выйди из неё', 'You are already in a team — leave it first');
  if (db.prepare('SELECT 1 FROM teams WHERE name = ?').get(name)) return fail('Такое название уже занято', 'This name is already taken');
  if (db.prepare('SELECT 1 FROM teams WHERE tag = ?').get(tag)) return fail('Такой тег уже занят', 'This tag is already taken');
  const t = now();
  const r = db.prepare('INSERT INTO teams (name, tag, captain, mmr, calib_left, created) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, tag, sid, DOTA.TEAM_START, DOTA.TEAM_CALIB_GAMES, t);
  db.prepare('INSERT INTO members (sid, team, joined) VALUES (?, ?, ?)').run(sid, Number(r.lastInsertRowid), t);
  db.prepare('DELETE FROM invites WHERE sid = ?').run(sid);
  return { ok: true, text: `Команда [${tag}] ${name} создана. Ты капитан — пригласи игроков.`, text_en: `Team [${tag}] ${name} created. You are the captain — invite players.` };
};

function captainTeam(db, sid) {
  const t = teamOf(db, sid);
  if (!t) return [null, fail('Ты не в команде', 'You are not in a team')];
  if (t.captain !== sid) return [null, fail('Это может только капитан', 'Only the captain can do this')];
  return [t, null];
}

OPS.team_invite = (db, b) => {
  const sid = intSid(b.sid);
  const target = intSid(b.target);
  if (!sid || !target || sid === target) return fail('Некого приглашать', 'Nobody to invite');
  const [t, err] = captainTeam(db, sid);
  if (err) return err;
  ensurePlayer(db, target, b.targetName);
  if (teamOf(db, target)) return fail('Этот игрок уже в команде', 'This player is already in a team');
  const n = membersOf(db, t.id).length;
  if (n >= DOTA.TEAM_SIZE) return fail(`В команде уже ${DOTA.TEAM_SIZE} игроков`, `The team already has ${DOTA.TEAM_SIZE} players`);
  db.prepare('INSERT OR REPLACE INTO invites (team, sid, by, created) VALUES (?, ?, ?, ?)').run(t.id, target, sid, now());
  return { ok: true, text: 'Приглашение отправлено', text_en: 'Invitation sent', team: teamShort(t) };
};

OPS.team_answer = (db, b) => {
  const sid = intSid(b.sid);
  const teamId = Math.floor(Number(b.team));
  const inv = db.prepare('SELECT * FROM invites WHERE team = ? AND sid = ?').get(teamId, sid);
  if (!inv) return fail('Приглашение не найдено или устарело', 'Invitation not found or expired');
  db.prepare('DELETE FROM invites WHERE team = ? AND sid = ?').run(teamId, sid);
  if (!b.accept) return { ok: true, text: 'Приглашение отклонено', text_en: 'Invitation declined' };
  if (teamOf(db, sid)) return fail('Ты уже в команде — сначала выйди из неё', 'You are already in a team — leave it first');
  const t = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!t) return fail('Команды больше нет', 'The team no longer exists');
  if (membersOf(db, t.id).length >= DOTA.TEAM_SIZE) return fail('В команде уже нет мест', 'The team is already full');
  db.prepare('INSERT INTO members (sid, team, joined) VALUES (?, ?, ?)').run(sid, t.id, now());
  db.prepare('DELETE FROM invites WHERE sid = ?').run(sid);
  return { ok: true, text: `Ты в команде [${t.tag}] ${t.name}`, text_en: `You joined [${t.tag}] ${t.name}` };
};

function removeMember(db, t, sid) {
  db.prepare('DELETE FROM members WHERE sid = ?').run(sid);
  const rest = membersOf(db, t.id);
  if (!rest.length) {
    db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
    db.prepare('DELETE FROM invites WHERE team = ?').run(t.id);
    return ['команда распущена (в ней никого не осталось)', 'team disbanded (nobody left)'];
  }
  if (t.captain === sid) {
    db.prepare('UPDATE teams SET captain = ? WHERE id = ?').run(rest[0].sid, t.id);
    return [`капитан теперь ${rest[0].name || rest[0].sid}`, `new captain: ${rest[0].name || rest[0].sid}`];
  }
  return ['', ''];
}

OPS.team_leave = (db, b) => {
  const sid = intSid(b.sid);
  const t = teamOf(db, sid);
  if (!t) return fail('Ты не в команде', 'You are not in a team');
  const [extra, extraEn] = removeMember(db, t, sid);
  return { ok: true, text: `Ты вышел из [${t.tag}] ${t.name}` + (extra ? `; ${extra}` : ''),
    text_en: `You left [${t.tag}] ${t.name}` + (extraEn ? `; ${extraEn}` : '') };
};

OPS.team_kick = (db, b) => {
  const sid = intSid(b.sid);
  const target = intSid(b.target);
  const [t, err] = captainTeam(db, sid);
  if (err) return err;
  if (target === sid) return fail('Себя исключить нельзя — выйди из команды', 'You cannot kick yourself — leave the team instead');
  const m = db.prepare('SELECT * FROM members WHERE sid = ? AND team = ?').get(target, t.id);
  if (!m) {
    // может, это неотвеченное приглашение — отзываем
    const r = db.prepare('DELETE FROM invites WHERE team = ? AND sid = ?').run(t.id, target);
    return r.changes ? { ok: true, text: 'Приглашение отозвано', text_en: 'Invitation revoked' } : fail('Игрок не в твоей команде', 'This player is not in your team');
  }
  removeMember(db, t, target);
  return { ok: true, text: 'Игрок исключён', text_en: 'Player kicked' };
};

OPS.team_captain = (db, b) => {
  const sid = intSid(b.sid);
  const target = intSid(b.target);
  const [t, err] = captainTeam(db, sid);
  if (err) return err;
  if (!db.prepare('SELECT 1 FROM members WHERE sid = ? AND team = ?').get(target, t.id)) return fail('Игрок не в твоей команде', 'This player is not in your team');
  db.prepare('UPDATE teams SET captain = ? WHERE id = ?').run(target, t.id);
  return { ok: true, text: 'Капитан передан', text_en: 'Captaincy transferred' };
};

OPS.team_disband = (db, b) => {
  const sid = intSid(b.sid);
  const [t, err] = captainTeam(db, sid);
  if (err) return err;
  db.prepare('DELETE FROM members WHERE team = ?').run(t.id);
  db.prepare('DELETE FROM invites WHERE team = ?').run(t.id);
  db.prepare('DELETE FROM teams WHERE id = ?').run(t.id);
  return { ok: true, text: `Команда [${t.tag}] ${t.name} распущена`, text_en: `Team [${t.tag}] ${t.name} disbanded` };
};

// ---------- ключ сервера Valve ----------
let savedKey = null;
try { savedKey = fs.readFileSync(KEY_FILE, 'utf8').trim() || null; } catch { /* ещё нет */ }

function keyOk(key) {
  if (!key || key.length < 8) return false;
  if (!savedKey) {
    // первый настоящий матч: запоминаем ключ сервера Valve
    savedKey = key;
    try { fs.writeFileSync(KEY_FILE, key + '\n', { mode: 0o600 }); } catch (e) { console.error('[dota] не смог сохранить ключ', e.message); }
    console.log('[dota] ключ сервера Valve сохранён в ' + KEY_FILE);
    return true;
  }
  const a = Buffer.from(key);
  const b = Buffer.from(savedKey);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- ограничение частоты ----------
const hits = new Map();
function limited(ip) {
  const t = now();
  const h = hits.get(ip) || { n: 0, at: t };
  if (t - h.at > 10000) { h.n = 0; h.at = t; }
  h.n++;
  hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.n > 60;
}

// ---------- http ----------
function send(res, code, obj, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 65536) { reject(new Error('слишком большой запрос')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

// Смена сезона без запросов от игры (страница, таймер) — в своей транзакции
function seasonTick(db) {
  if (metaGet(db, 'season') === seasonOf(now()).id) return;
  db.exec('BEGIN IMMEDIATE');
  try { checkSeason(db); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); console.error('[dota] смена сезона', e); }
}
// раз в 10 минут проверяем, не начался ли новый сезон (боевая база)
setInterval(() => { try { seasonTick(dbFor(false)); } catch (e) { console.error('[dota]', e); } }, 600e3).unref();

/** Обработчик всех адресов /dota… (подключается в server.mjs). */
export async function handleDota(req, res) {
  const url = new URL(req.url, 'http://x');
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  if (limited(ip)) return send(res, 429, fail('слишком часто', 'too many requests'));
  try {
    if (req.method === 'GET' && (url.pathname === '/dota' || url.pathname === '/dota/')) {
      // язык: ?lang=en / ?lang=ru, иначе по языку браузера
      const qLang = url.searchParams.get('lang');
      const en = qLang ? qLang === 'en' : !/^ru|,\s*ru/i.test(String(req.headers['accept-language'] || 'ru'));
      seasonTick(dbFor(false));
      return send(res, 200, leaderboardPage(en), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/dota/top.json') {
      seasonTick(dbFor(false));
      return send(res, 200, OPS.top(dbFor(false), { kind: url.searchParams.get('kind') }));
    }
    if (req.method === 'GET' && url.pathname === '/dota/seasons.json') {
      return send(res, 200, OPS.seasons(dbFor(false)));
    }
    if (req.method === 'POST' && url.pathname === '/dota/api') {
      const body = JSON.parse((await readBody(req)) || '{}');
      const test = !!body.test;
      if (!test && !keyOk(String(req.headers['x-aod-key'] || ''))) return send(res, 403, fail('неверный ключ сервера', 'invalid server key'));
      const op = Object.hasOwn(OPS, body.op) ? OPS[body.op] : null;
      if (!op) return send(res, 400, fail('неизвестная операция', 'unknown operation'));
      const db = dbFor(test);
      let out;
      db.exec('BEGIN IMMEDIATE');
      try {
        checkSeason(db);
        out = op(db, body, test);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      if (body.op === 'end' || body.op === 'team_create') console.log(`[dota]${test ? '[test]' : ''} ${body.op}: ${JSON.stringify(out).slice(0, 300)}`);
      return send(res, 200, out);
    }
    return send(res, 404, fail('нет такого адреса', 'not found'));
  } catch (e) {
    console.error('[dota] ошибка', e);
    return send(res, 500, fail('ошибка сервера', 'server error'));
  }
}

// ---------- страница с таблицей лидеров ----------
const plural = (n, one, few, many) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- сторонники (Boosty) ----------
// Список хранится на сервере: /var/lib/arena/dota_supporters.json — [{ "name": "Ник", "tier": "legend|ally|supporter" }]
// Править командой: node /opt/arena/server/dota_admin.mjs supporter add "Ник" legend
export const SUPPORTERS_FILE = path.join(DATA_DIR, 'dota_supporters.json');
export const LINKS = {
  boosty: 'https://boosty.to/arenaofdefense',
  telegram: 'https://t.me/arena_of_defense',
  workshop: 'https://steamcommunity.com/sharedfiles/filedetails/?id=3816015867',
  rustore: 'https://www.rustore.ru/catalog/app/ru.arenaofdefense.game',
};
function readSupporters() {
  try {
    const list = JSON.parse(fs.readFileSync(SUPPORTERS_FILE, 'utf8'));
    return Array.isArray(list) ? list.filter((x) => x && x.name) : [];
  } catch { return []; }
}

function supportersBlock(L) {
  const list = readSupporters();
  const tiers = [['legend', L('Легенды', 'Legends')], ['ally', L('Соратники', 'Allies')], ['supporter', L('Сторонники', 'Supporters')]];
  const body = list.length
    ? tiers.map(([key, title]) => {
      const names = list.filter((x) => x.tier === key);
      if (!names.length) return '';
      return `<div class="tier"><div class="tier-title">${title}</div><div class="names">${names.map((x) => `<span class="name ${key}">${key === 'legend' ? '👑 ' : ''}${esc(x.name)}</span>`).join('')}</div></div>`;
    }).join('')
    : `<div class="empty">${L('Пока никого — стань первым!', 'Nobody yet — be the first!')}</div>`;
  return `<section class="thanks" id="thanks"><h2>💛 ${L('Спасибо сторонникам', 'Thanks to supporters')}</h2>
<p class="sub">${L('Эти люди поддерживают разработку Arena of Defense. Хочешь сюда?', 'These people support the development of Arena of Defense. Want to be here?')} → <a href="${LINKS.boosty}" target="_blank" rel="noopener">Boosty</a></p>
${body}</section>
<footer><div class="links">
<a class="link" href="${LINKS.telegram}" target="_blank" rel="noopener"><span>✈️</span>Telegram</a>
<a class="link" href="${LINKS.workshop}" target="_blank" rel="noopener"><span>🎮</span>${L('Мастерская Steam', 'Steam Workshop')}</a>
<a class="link" href="${LINKS.rustore}" target="_blank" rel="noopener"><span>📱</span>Android (RuStore)</a>
<a class="link boosty" href="${LINKS.boosty}" target="_blank" rel="noopener"><span>💛</span>${L('Поддержать', 'Support')}</a>
</div><div class="copy">Arena of Defense · ${L('подписка не даёт преимуществ в игре', 'support gives no in-game advantage')}</div></footer>`;
}

function leaderboardPage(en = false) {
  const L = (ru, e) => (en ? e : ru);
  const db = dbFor(false);
  const top = OPS.top(db, { kind: 'solo', limit: 100 });
  const solo = top.list;
  const teams = OPS.top(db, { kind: 'team' }).list;
  const season = top.season;
  const archive = OPS.seasons(db).list;
  const wr = (w, g) => (g ? Math.round((w / g) * 100) + '%' : '—');
  const bname = (b) => (b ? (en ? b.en : b.ru) : '');
  const ico = (b, extra = '') => (b ? `<span class="b" title="${esc(bname(b) + (b.season ? ' · ' + b.season : '') + extra)}">${b.icon}</span>` : '');
  const nowRank = (b) => (b && !season.trial ? `<span class="live" title="${esc(L('Ранг сейчас', 'Current rank'))}">${b.icon} ${esc(bname(b))}</span>` : '');
  const soloRows = solo.map((p, i) => `<tr><td>${i + 1}</td><td>${ico(p.badge)}${ico(p.gang)}${p.tag ? `<span class="tag">[${esc(p.tag)}]</span> ` : ''}${esc(p.name)} ${nowRank(p.live)}</td><td class="n">${p.mmr}</td><td class="n">${p.games}</td><td class="n">${wr(p.wins, p.games)}</td></tr>`).join('');
  const teamRows = teams.map((t, i) => `<tr><td>${i + 1}</td><td><span class="tag">[${esc(t.tag)}]</span> ${esc(t.name)} ${nowRank(t.live)}</td><td class="n">${t.mmr}</td><td class="n">${t.games}</td><td class="n">${wr(t.wins, t.games)}</td></tr>`).join('');
  const empty = (txt) => `<tr><td colspan="5" class="empty">${txt}</td></tr>`;
  const days = season.daysLeft;
  const seasonLine = `<div class="season"><div class="s-name">${esc(en ? season.en : season.ru)}${season.trial ? ` <span class="trial">${L('пробный сезон', 'trial season')}</span>` : ''}</div>
<div class="s-left">${L('до конца сезона', 'season ends in')}: <b>${days}</b> ${L(plural(days, 'день', 'дня', 'дней'), days === 1 ? 'day' : 'days')}</div></div>`;
  const B = BADGES;
  const legendRow = (id, who) => `<div class="lg"><span class="lg-i">${B[id].icon}</span><span class="lg-n">${esc(en ? B[id].en : B[id].ru)}</span><span class="lg-w">${who}</span></div>`;
  const legend = `<section class="badges"><h2>${L('Значки сезона', 'Season badges')}</h2>
<p class="sub">${season.trial
    ? L('Этот сезон пробный — значков за него не будет. Значки начнутся со следующего сезона.', 'This season is a trial — no badges for it. Badges start next season.')
    : L(`Выдаются в конце сезона по месту в таблице (финальный ММР). Нужно сыграть минимум ${DOTA.SEASON_MIN_GAMES} рейтинговых игр за сезон. Значок остаётся навсегда.`, `Awarded at the end of the season by final table position. You need at least ${DOTA.SEASON_MIN_GAMES} ranked games in the season. Badges are kept forever.`)}</p>
<div class="lgs">
${legendRow('champion', L('№1 сезона', '#1 of the season'))}
${legendRow('legend', L('места 2–10', 'places 2–10'))}
${legendRow('throne', L('верхние 4%', 'top 4%'))}
${legendRow('baby', L('следующие 8%', 'next 8%'))}
${legendRow('courier', L('следующие 13%', 'next 13%'))}
${legendRow('rune', L('следующие 20%', 'next 20%'))}
${legendRow('feeder', L('следующие 25%', 'next 25%'))}
${legendRow('food', L('остальные', 'the rest'))}
${legendRow('gang1', L('1-я команда сезона', 'team #1'))}
${legendRow('gang2', L('2-я команда', 'team #2'))}
${legendRow('gang3', L('3-я команда', 'team #3'))}
</div>
<p class="sub small">${L(`Новый сезон каждые 3 месяца: зима (1 декабря), весна (1 марта), лето (1 июня), осень (1 сентября). В начале сезона ММР сдвигается наполовину к ${DOTA.START_MMR} и ${DOTA.RECALIB_GAMES} игр идёт перекалибровка.`, `A new season every 3 months: winter (Dec 1), spring (Mar 1), summer (Jun 1), autumn (Sep 1). At the start of a season MMR moves halfway towards ${DOTA.START_MMR}, followed by ${DOTA.RECALIB_GAMES} recalibration games.`)}</p></section>`;
  const archiveBlock = archive.length ? `<section><h2>${L('Прошлые сезоны', 'Past seasons')}</h2>${archive.map((a) => {
    const top3 = a.solo.slice(0, 3).map((x) => `${x.badge ? B[x.badge].icon + ' ' : ''}${esc(x.name)} <span class="m">${x.mmr}</span>`).join(' · ');
    const tm = a.teams.map((x) => `${x.badge ? B[x.badge].icon + ' ' : ''}[${esc(x.tag)}] ${esc(x.name)}`).join(' · ');
    return `<div class="arch"><div class="a-name">${esc(en ? a.en : a.ru)}${a.trial ? ` <span class="trial">${L('пробный', 'trial')}</span>` : ''}</div>
<div class="a-row">${top3 || L('никто не играл', 'nobody played')}</div>${tm ? `<div class="a-row">${tm}</div>` : ''}</div>`;
  }).join('')}</section>` : '';
  return `<!doctype html><html lang="${en ? 'en' : 'ru'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Arena of Defense — ${L('рейтинг', 'leaderboard')}</title><style>
:root{--bg:#0f0d0c;--card:#1b1714;--line:#332c27;--text:#ece4d8;--muted:#a3988a;--gold:#f0c45a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 48px}h1{color:var(--gold);font-size:26px;margin:0 0 4px}
p.sub{color:var(--muted);margin:0 0 24px}h2{font-size:18px;margin:28px 0 8px}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted);font-weight:600;font-size:13px}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}tr:last-child td{border-bottom:0}
tr:nth-child(-n+3) td:first-child{color:var(--gold);font-weight:700}.tag{color:var(--gold)}.empty{color:var(--muted);text-align:center;padding:18px}
a{color:var(--gold)}
.thanks{margin-top:36px}.thanks h2{margin-bottom:4px}.thanks .sub{color:var(--muted);margin:0 0 14px;font-size:14px}
.tier{margin-bottom:12px}.tier-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:6px}
.names{display:flex;flex-wrap:wrap;gap:8px}.name{padding:5px 12px;border-radius:999px;font-size:14px;background:var(--card);border:1px solid var(--line)}
.name.legend{color:#ffd34d;border-color:#b8901f;background:#2c2614;font-weight:600}.name.ally{color:#cfd8ff;border-color:#4a5a9a}
.empty{color:var(--muted);font-style:italic;font-size:14px}td.empty{color:var(--muted)!important;font-weight:400!important}
footer{margin-top:32px;padding-top:20px;border-top:1px solid var(--line)}
.links{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}
.link{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;text-decoration:none;background:var(--card);border:1px solid var(--line);color:var(--text);font-size:15px;transition:border-color .15s,transform .15s}
.link:hover{border-color:var(--gold);transform:translateY(-1px)}.link.boosty{border-color:#f15f2c}
.copy{text-align:center;color:var(--muted);font-size:12px;margin-top:14px}
.season{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:6px 16px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}
.s-name{font-size:18px;font-weight:700;color:var(--gold)}.s-left{color:var(--muted)}.s-left b{color:var(--text)}
.trial{font-size:12px;font-weight:600;color:#9fb6ff;border:1px solid #4a5a9a;border-radius:999px;padding:1px 8px;margin-left:6px;vertical-align:middle}
.b{margin-right:4px;cursor:help}.live{font-size:12px;color:var(--muted);white-space:nowrap}
.lgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px}
.lg{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px}
.lg-i{font-size:20px}.lg-n{font-weight:600;flex:1;min-width:0}.lg-w{color:var(--muted);font-size:12px;white-space:nowrap}
p.sub.small{font-size:13px;margin-top:10px}.badges .sub{margin-bottom:10px}
.arch{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:8px}
.a-name{font-weight:700;margin-bottom:4px}.a-row{color:var(--muted);font-size:14px}.a-row .m{color:var(--text);font-variant-numeric:tabular-nums}
td{overflow-wrap:anywhere}
@media (max-width:480px){.link{flex:1 1 100%;justify-content:center}th,td{padding:7px 6px}.live{display:block}}
</style></head><body><main>
<h1>Arena of Defense</h1><p class="sub">${L('Рейтинг кастомки Dota 2 · обновляется после каждой рейтинговой игры', 'Dota 2 custom game leaderboard · updated after every ranked game')} · <a href="?lang=${en ? 'ru' : 'en'}">${en ? 'По-русски' : 'English'}</a></p>
${seasonLine}
<h2>${L('Игроки (соло-ММР)', 'Players (solo MMR)')}</h2><table><tr><th>#</th><th>${L('Игрок', 'Player')}</th><th class="n">${L('ММР', 'MMR')}</th><th class="n">${L('Игр', 'Games')}</th><th class="n">${L('Побед', 'Win %')}</th></tr>
${soloRows || empty(L('В этом сезоне пока никто не откалиброван', 'Nobody is calibrated this season yet'))}</table>
<h2>${L('Команды', 'Teams')}</h2><table><tr><th>#</th><th>${L('Команда', 'Team')}</th><th class="n">${L('ММР', 'MMR')}</th><th class="n">${L('Игр', 'Games')}</th><th class="n">${L('Побед', 'Win %')}</th></tr>
${teamRows || empty(L('В этом сезоне пока не было командных игр 5 на 5', 'No 5v5 team games this season yet'))}</table>
${legend}
${archiveBlock}
${supportersBlock(L)}
</main></body></html>`;
}
