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
//
// Базы: dota.db и dota_test.db в той же папке, что и база мобильной игры (/var/lib/arena).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.dirname(process.env.DB || new URL('./arena.db', import.meta.url).pathname);
const KEY_FILE = path.join(DATA_DIR, 'dota_key.txt');

// ---------- правила (меняй тут) ----------
export const DOTA = {
  START_MMR: 1000,
  CALIB_GAMES: 10,      // первые игры — калибровка, рейтинг меняется сильнее
  K_CALIB: 40,
  K: 25,
  TEAM_START: 1000,
  TEAM_K: 32,
  TEAM_K_CALIB: 48,
  TEAM_CALIB_GAMES: 5,
  TEAM_SIZE: 5,
  INVITE_DAYS: 3,
  TOP: 30,
};
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
  `);
  return db;
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
    db.prepare('INSERT INTO players (sid, name, created, seen) VALUES (?, ?, ?, ?)').run(sid, cleanName(name), t, t);
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
  calib: p.games < DOTA.CALIB_GAMES ? DOTA.CALIB_GAMES - p.games : 0,
  rank: p.games > 0 ? rankOf(db, p.mmr) : 0,
});
const expected = (a, b) => 1 / (1 + 10 ** ((b - a) / 400));
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
  return { ok: true, match: id, players, teamMatch, teams: { 2: teamShort(good), 3: teamShort(bad) } };
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
        const k = me.games < DOTA.TEAM_CALIB_GAMES ? DOTA.TEAM_K_CALIB : DOTA.TEAM_K;
        let d = Math.round(k * (win - expected(me.mmr, op.mmr)));
        d = win ? Math.max(1, d) : Math.min(-1, d);
        db.prepare('UPDATE teams SET mmr = mmr + ?, games = games + 1, wins = wins + ?, losses = losses + ? WHERE id = ?')
          .run(d, win, 1 - win, me.id);
        teams[side] = { id: me.id, name: me.name, tag: me.tag, before: me.mmr, after: me.mmr + d, delta: d };
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
        const k = p.games < DOTA.CALIB_GAMES ? DOTA.K_CALIB : DOTA.K;
        const e = expected(mean[x.side], mean[5 - x.side]);
        let d = Math.round(k * (win - e));
        d = win ? Math.max(1, d) : Math.min(-1, d);
        if (x.abandoned) d = Math.min(d, -Math.round(k * 0.75));          // ливер теряет заметно
        else if (!win && leaverIn[x.side]) d = Math.min(-1, Math.round(d / 2)); // из-за ливера — вполовину
        db.prepare(`UPDATE players SET mmr = MAX(0, mmr + ?), games = games + 1, wins = wins + ?, losses = losses + ?,
          abandons = abandons + ? WHERE sid = ?`).run(d, win, 1 - win, x.abandoned ? 1 : 0, x.sid);
        db.prepare('INSERT OR REPLACE INTO history (match, sid, side, hero, win, abandoned, delta, kind, at) VALUES (?,?,?,?,?,?,?,?,?)')
          .run(id, x.sid, x.side, x.hero, win, x.abandoned ? 1 : 0, d, 'solo', t);
        results[x.sid] = { before: p.mmr, after: Math.max(0, p.mmr + d), delta: d, win, abandoned: x.abandoned, calib: p.games < DOTA.CALIB_GAMES };
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
  return { ok: true, player: playerView(db, p), team, invites, history };
};

OPS.top = (db, b) => {
  if (b.kind === 'team') {
    return { ok: true, kind: 'team', list: db.prepare(`SELECT id, name, tag, mmr, games, wins, losses FROM teams
      WHERE games > 0 ORDER BY mmr DESC, wins DESC LIMIT ?`).all(DOTA.TOP) };
  }
  return { ok: true, kind: 'solo', list: db.prepare(`SELECT p.sid, p.name, p.mmr, p.games, p.wins, p.losses, t.tag FROM players p
    LEFT JOIN members m ON m.sid = p.sid LEFT JOIN teams t ON t.id = m.team
    WHERE p.games >= ? ORDER BY p.mmr DESC, p.wins DESC LIMIT ?`).all(Math.min(DOTA.CALIB_GAMES, Number(b.minGames ?? DOTA.CALIB_GAMES)), DOTA.TOP) };
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
  const r = db.prepare('INSERT INTO teams (name, tag, captain, created) VALUES (?, ?, ?, ?)').run(name, tag, sid, t);
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
      return send(res, 200, leaderboardPage(en), 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/dota/top.json') {
      return send(res, 200, OPS.top(dbFor(false), { kind: url.searchParams.get('kind') }));
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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function leaderboardPage(en = false) {
  const L = (ru, e) => (en ? e : ru);
  const db = dbFor(false);
  const solo = OPS.top(db, { kind: 'solo' }).list;
  const teams = OPS.top(db, { kind: 'team' }).list;
  const wr = (w, g) => (g ? Math.round((w / g) * 100) + '%' : '—');
  const soloRows = solo.map((p, i) => `<tr><td>${i + 1}</td><td>${p.tag ? `<span class="tag">[${esc(p.tag)}]</span> ` : ''}${esc(p.name)}</td><td class="n">${p.mmr}</td><td class="n">${p.games}</td><td class="n">${wr(p.wins, p.games)}</td></tr>`).join('');
  const teamRows = teams.map((t, i) => `<tr><td>${i + 1}</td><td><span class="tag">[${esc(t.tag)}]</span> ${esc(t.name)}</td><td class="n">${t.mmr}</td><td class="n">${t.games}</td><td class="n">${wr(t.wins, t.games)}</td></tr>`).join('');
  const empty = (txt) => `<tr><td colspan="5" class="empty">${txt}</td></tr>`;
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
a{color:var(--gold)}footer{color:var(--muted);font-size:13px;margin-top:28px}
</style></head><body><main>
<h1>Arena of Defense</h1><p class="sub">${L('Рейтинг кастомки Dota 2 · обновляется после каждой рейтинговой игры', 'Dota 2 custom game leaderboard · updated after every ranked game')} · <a href="?lang=${en ? 'ru' : 'en'}">${en ? 'По-русски' : 'English'}</a></p>
<h2>${L('Игроки (соло-ММР)', 'Players (solo MMR)')}</h2><table><tr><th>#</th><th>${L('Игрок', 'Player')}</th><th class="n">${L('ММР', 'MMR')}</th><th class="n">${L('Игр', 'Games')}</th><th class="n">${L('Побед', 'Win %')}</th></tr>
${soloRows || empty(L(`Пока никто не прошёл калибровку (${DOTA.CALIB_GAMES} игр)`, `Nobody has finished calibration yet (${DOTA.CALIB_GAMES} games)`))}</table>
<h2>${L('Команды', 'Teams')}</h2><table><tr><th>#</th><th>${L('Команда', 'Team')}</th><th class="n">${L('ММР', 'MMR')}</th><th class="n">${L('Игр', 'Games')}</th><th class="n">${L('Побед', 'Win %')}</th></tr>
${teamRows || empty(L('Пока не было командных игр 5 на 5', 'No 5v5 team games yet'))}</table>
<footer><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=3816015867">${L('Мастерская Steam', 'Steam Workshop')}</a> · <a href="https://t.me/arena_of_defense">Telegram</a></footer>
</main></body></html>`;
}
