// Сервер Arena of Defense: аккаунты, прогресс, рейтинг, подбор соперника и передача сетевой игры.
// Без внешних библиотек: только Node.js 22+ (встроенные http, crypto и sqlite).
// Запуск: node server.mjs  (порт — PORT, по умолчанию 8080; база — DB, по умолчанию ./arena.db)
// Снаружи его прикрывает Caddy: он даёт https/wss и сам получает сертификат.

import { HERO_PRICE, STICKER_PRICE, STAR_COST, MAX_STARS, REWARD, MIN_REWARD_MS, LOGIN_REWARD, QUESTS, QUESTS_PER_DAY, dayNow, msToNextDay } from './economy.mjs';
import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DB || new URL('./arena.db', import.meta.url).pathname;
const START_RATING = 1000;
const K = 32; // насколько сильно меняется рейтинг за бой
const REJOIN_MS = 45000; // сколько ждём вернувшегося после обрыва игрока
const START_CRYSTALS = 300;
/** Минимальная сборка игры для боёв по сети: старые сами начисляли кристаллы и звёзды. */
const MIN_BUILD = 33;
const STARTERS = Object.keys(HERO_PRICE).filter((id) => HERO_PRICE[id] === 0);

// ---------- база ----------
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass TEXT,
    rating INTEGER NOT NULL DEFAULT ${START_RATING},
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    crystals INTEGER NOT NULL DEFAULT ${START_CRYSTALS},
    owned TEXT NOT NULL DEFAULT '[]',
    created INTEGER NOT NULL,
    seen INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY,
    a TEXT NOT NULL,
    b TEXT NOT NULL,
    ranked INTEGER NOT NULL,
    winner TEXT,
    delta INTEGER,
    reason TEXT,
    created INTEGER NOT NULL,
    ended INTEGER
  );
`);
// звёзды героев (добавлены позже — старой базе докидываем колонку)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'stars')) {
  db.exec(`ALTER TABLE users ADD COLUMN stars TEXT NOT NULL DEFAULT '{}'`);
}
// купленные стикеры (JSON-массив id)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'stickers')) {
  db.exec(`ALTER TABLE users ADD COLUMN stickers TEXT NOT NULL DEFAULT '[]'`);
}

// ежедневное: задания дня и цепочка входов (JSON в users.daily)
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'daily')) {
  db.exec(`ALTER TABLE users ADD COLUMN daily TEXT NOT NULL DEFAULT '{}'`);
}

// промокоды: код → кристаллы; лимит активаций (0 — без лимита); каждый игрок — один раз
db.exec(`
  CREATE TABLE IF NOT EXISTS promos (
    code TEXT PRIMARY KEY COLLATE NOCASE,
    crystals INTEGER NOT NULL,
    max_uses INTEGER NOT NULL DEFAULT 0,
    uses INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS promo_uses (
    code TEXT NOT NULL COLLATE NOCASE,
    user TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (code, user)
  );
`);

/** Звёзды из сообщения: объект {героя: 1..5}, не больше 200 записей. */
const cleanStars = (v) => {
  const out = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [id, n] of Object.entries(v).slice(0, 200)) {
      const k = Math.floor(Number(n));
      if (typeof id === 'string' && id.length <= 32 && k > 0) out[id] = Math.min(5, k);
    }
  }
  return out;
};

const q = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byName: db.prepare('SELECT * FROM users WHERE name = ?'),
  insert: db.prepare('INSERT INTO users (id, token, name, crystals, owned, stars, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  seen: db.prepare('UPDATE users SET seen = ? WHERE id = ?'),
  name: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  pass: db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
  token: db.prepare('UPDATE users SET token = ? WHERE id = ?'),
  save: db.prepare('UPDATE users SET crystals = ?, owned = ?, stars = ? WHERE id = ?'),
  give: db.prepare('UPDATE users SET crystals = crystals + ? WHERE id = ?'),
  daily: db.prepare('UPDATE users SET daily = ? WHERE id = ?'),
  stickers: db.prepare('UPDATE users SET stickers = ?, crystals = crystals - ? WHERE id = ? AND crystals >= ?'),
  promo: db.prepare('SELECT * FROM promos WHERE code = ?'),
  promoUsed: db.prepare('SELECT 1 FROM promo_uses WHERE code = ? AND user = ?'),
  promoUse: db.prepare('INSERT INTO promo_uses (code, user, at) VALUES (?, ?, ?)'),
  promoCount: db.prepare('UPDATE promos SET uses = uses + 1 WHERE code = ?'),
  rate: db.prepare('UPDATE users SET rating = ?, wins = wins + ?, losses = losses + ? WHERE id = ?'),
  top: db.prepare('SELECT name, rating, wins, losses FROM users WHERE wins + losses > 0 ORDER BY rating DESC LIMIT 50'),
  count: db.prepare('SELECT COUNT(*) AS n FROM users'),
  matchNew: db.prepare('INSERT INTO matches (id, a, b, ranked, created) VALUES (?, ?, ?, ?, ?)'),
  matchEnd: db.prepare('UPDATE matches SET winner = ?, delta = ?, reason = ?, ended = ? WHERE id = ?'),
};

const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');
const hashPass = (p, salt = rid(12)) => salt + ':' + crypto.scryptSync(p, salt, 32).toString('base64url');
const checkPass = (p, stored) => {
  if (!stored) return false;
  const [salt] = stored.split(':');
  const a = Buffer.from(hashPass(p, salt));
  const b = Buffer.from(stored);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const cleanName = (s) => String(s ?? '').replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);

/** Задания дня для игрока: одинаковые весь день, у разных игроков — разные. */
function rollQuests(userId, day) {
  let h = 2166136261;
  for (const ch of userId + ':' + day) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const pool = [...QUESTS];
  const out = [];
  while (out.length < QUESTS_PER_DAY && pool.length) {
    h = Math.imul(h ^ (h >>> 15), 2246822519) >>> 0;
    out.push(pool.splice(h % pool.length, 1)[0].id);
  }
  return out.map((id) => ({ id, have: 0, claimed: false }));
}

/** Ежедневное состояние игрока на сегодня (при смене дня — новые задания). Сохраняет, если что-то поменялось. */
function dailyOf(u) {
  const today = dayNow();
  let d;
  try { d = JSON.parse(u.daily || '{}'); } catch { d = {}; }
  if (d.day !== today) {
    d = { day: today, quests: rollQuests(u.id, today), loginDay: d.loginDay ?? 0, streak: d.streak ?? 0 };
    const s = JSON.stringify(d);
    q.daily.run(s, u.id);
    u.daily = s;
  }
  return d;
}
/** Какой день цепочки входа будет при следующей награде. */
const nextStreak = (d) => (d.loginDay === dayNow() - 1 ? (d.streak % LOGIN_REWARD.length) + 1 : 1);

function dailyView(u) {
  const d = dailyOf(u);
  const can = d.loginDay !== d.day;
  return {
    resetIn: msToNextDay(),
    login: { can, day: can ? nextStreak(d) : d.streak, rewards: LOGIN_REWARD },
    quests: d.quests.map((x) => {
      const def = QUESTS.find((qq) => qq.id === x.id);
      return def ? { id: x.id, text: def.text, need: def.need, have: Math.min(def.need, x.have), reward: def.reward, claimed: x.claimed } : null;
    }).filter(Boolean),
  };
}

/** Засчитать бой по сети в задания игрока. st — статистика его стороны (или null, если ей нельзя верить). */
function questProgress(userId, won, st) {
  const u = q.byId.get(userId);
  if (!u) return;
  const d = dailyOf(u);
  const add = { play: 1, win: won ? 1 : 0, lords: st?.lords ?? 0, turtles: st?.turtles ?? 0, camps: st?.camps ?? 0, pushes: st?.pushes ?? 0, kills: st?.kills ?? 0 };
  for (const x of d.quests) {
    const def = QUESTS.find((qq) => qq.id === x.id);
    if (def && !x.claimed) x.have = Math.min(def.need, x.have + (add[def.stat] ?? 0));
  }
  q.daily.run(JSON.stringify(d), userId);
}

function profile(u) {
  return {
    t: 'me', id: u.id, token: u.token, name: u.name, rating: u.rating, wins: u.wins, losses: u.losses,
    crystals: u.crystals, owned: JSON.parse(u.owned), stars: JSON.parse(u.stars || '{}'), hasPass: !!u.pass, daily: dailyView(u), stickers: JSON.parse(u.stickers || '[]'),
  };
}

// ---------- WebSocket (RFC 6455, минимально) ----------
function wsAccept(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  sock.setNoDelay(true);
  sock.setKeepAlive(true, 20000);
  const c = new Client(sock, req.headers['x-forwarded-for'] || sock.remoteAddress);
  let buf = Buffer.alloc(0);
  let frag = [];
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 128;
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 1 << 20) { sock.destroy(); return; } // не больше 1 МБ
      const masked = buf[1] & 128;
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const data = Buffer.from(buf.subarray(off, off + len));
      buf = buf.subarray(off + len);
      if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      if (op === 8) { c.close(); return; }
      if (op === 9) { c.frame(10, data); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2 || op === 0) {
        frag.push(data);
        if (!fin) continue;
        const text = Buffer.concat(frag).toString('utf8');
        frag = [];
        c.onText(text);
      }
    }
  });
  sock.on('close', () => c.gone());
  sock.on('error', () => c.gone());
  return c;
}

// ---------- игроки, подбор, матчи ----------
const online = new Map(); // userId -> Client
const queue = new Map(); // userId -> { c, since }
const rooms = new Map(); // код комнаты -> Client (хост ждёт друга)
const matches = new Map(); // matchId -> Match

class Client {
  constructor(sock, ip) {
    this.sock = sock;
    this.ip = ip;
    this.user = null;
    this.match = null;
    this.alive = true;
    this.lastIn = Date.now();
  }

  frame(op, payload) {
    if (!this.alive) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([128 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 128 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 128 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    this.sock.write(Buffer.concat([head, payload]));
  }

  send(obj) {
    this.frame(1, Buffer.from(JSON.stringify(obj)));
  }

  close() {
    if (!this.alive) return;
    try { this.frame(8, Buffer.alloc(0)); } catch { /* */ }
    this.sock.end();
    this.gone();
  }

  gone() {
    if (!this.alive) return;
    this.alive = false;
    if (this.user) {
      if (online.get(this.user.id) === this) online.delete(this.user.id);
      queue.delete(this.user.id);
    }
    for (const [code, h] of rooms) if (h === this) rooms.delete(code);
    this.match?.left(this);
  }

  onText(text) {
    this.lastIn = Date.now();
    let m;
    try { m = JSON.parse(text); } catch { return; }
    if (!m || typeof m.t !== 'string') return;
    try { this.handle(m); } catch (e) { console.error('handle', m.t, e); }
  }

  login(u, build) {
    this.build = Number(build) || 0;
    const prev = online.get(u.id);
    if (prev && prev !== this) { prev.send({ t: 'kicked' }); prev.user = null; prev.close(); }
    this.user = u;
    online.set(u.id, this);
    q.seen.run(Date.now(), u.id);
    this.send(profile(u));
  }

  refresh() {
    if (this.user) this.user = q.byId.get(this.user.id);
  }

  handle(m) {
    switch (m.t) {
      case 'ping':
        this.send({ t: 'pong', ts: m.ts });
        return;
      case 'register': {
        // новый аккаунт: имя; стартовые кристаллы и герои
        let name = cleanName(m.name);
        if (name.length < 2) { this.send({ t: 'error', where: 'register', text: 'Имя слишком короткое' }); return; }
        if (q.byName.get(name)) { this.send({ t: 'error', where: 'register', text: 'Такое имя уже занято' }); return; }
        const id = rid(9);
        // прогресс с телефона не переносим: его можно накрутить. Новый аккаунт — как новая игра.
        q.insert.run(id, rid(24), name, START_CRYSTALS, JSON.stringify(STARTERS), '{}', Date.now(), Date.now());
        this.login(q.byId.get(id), m.v);
        return;
      }
      case 'auth': {
        const u = q.byId.get(String(m.id ?? ''));
        if (!u || u.token !== m.token) { this.send({ t: 'error', where: 'auth', text: 'Аккаунт не найден' }); return; }
        this.login(u, m.v);
        if (m.matchId) matches.get(m.matchId)?.rejoin(this);
        return;
      }
      case 'login': {
        const u = q.byName.get(cleanName(m.name));
        if (!u || !checkPass(String(m.password ?? ''), u.pass)) { this.send({ t: 'error', where: 'login', text: 'Неверное имя или пароль' }); return; }
        this.login(u, m.v);
        return;
      }
      case 'top':
        this.send({ t: 'top', list: q.top.all(), players: q.count.get().n, online: online.size });
        return;
    }
    if (!this.user) { this.send({ t: 'error', where: m.t, text: 'Сначала войди в аккаунт' }); return; }
    const me = this.user;
    switch (m.t) {
      case 'setName': {
        const name = cleanName(m.name);
        if (name.length < 2) { this.send({ t: 'error', where: 'setName', text: 'Имя слишком короткое' }); return; }
        const other = q.byName.get(name);
        if (other && other.id !== me.id) { this.send({ t: 'error', where: 'setName', text: 'Такое имя уже занято' }); return; }
        q.name.run(name, me.id);
        break;
      }
      case 'setPassword': {
        const p = String(m.password ?? '');
        if (p.length < 4) { this.send({ t: 'error', where: 'setPassword', text: 'Пароль — хотя бы 4 символа' }); return; }
        q.pass.run(hashPass(p), me.id);
        break;
      }
      case 'save':
        // старые версии игры присылали свой прогресс — теперь его ведёт только сервер
        return;
      case 'buy': {
        // покупка за кристаллы: открыть героя или звезду. Цена — только серверная.
        const id = String(m.id ?? '');
        if (m.what === 'sticker') {
          this.refresh();
          const have = JSON.parse(this.user.stickers || '[]');
          const price = STICKER_PRICE[id];
          if (!price || have.includes(id)) break; // нет такого, бесплатный или уже куплен
          if (this.user.crystals < price) { this.send({ t: 'error', where: 'buy', text: 'Не хватает кристаллов' }); break; }
          q.stickers.run(JSON.stringify([...have, id]), price, this.user.id, price);
          break;
        }
        if (!(id in HERO_PRICE)) break;
        this.refresh(); // свежие цифры из базы (кристаллы могли начислить, пока игрок в сети)
        const me = this.user;
        const owned = JSON.parse(me.owned);
        const stars = JSON.parse(me.stars || '{}');
        let cost;
        if (m.what === 'hero') {
          if (owned.includes(id) || HERO_PRICE[id] === 0) break;
          cost = HERO_PRICE[id];
          owned.push(id);
        } else if (m.what === 'star') {
          const cur = stars[id] ?? 0;
          if ((!owned.includes(id) && HERO_PRICE[id] !== 0) || cur >= MAX_STARS) break;
          cost = STAR_COST[cur];
          stars[id] = cur + 1;
        } else break;
        if (me.crystals < cost) { this.send({ t: 'error', where: 'buy', text: 'Не хватает кристаллов' }); break; }
        q.save.run(me.crystals - cost, JSON.stringify(owned), JSON.stringify(stars), me.id);
        break; // ниже — свежий профиль телефону
      }
      case 'claimLogin': {
        // награда за вход: один раз в день
        this.refresh();
        const u = this.user;
        const d = dailyOf(u);
        if (d.loginDay === d.day) break;
        const day = nextStreak(d);
        const gain = LOGIN_REWARD[day - 1];
        d.loginDay = d.day;
        d.streak = day;
        q.daily.run(JSON.stringify(d), u.id);
        q.give.run(gain, u.id);
        this.send({ t: 'claimed', what: 'login', day, crystals: gain });
        break;
      }
      case 'claimQuest': {
        this.refresh();
        const u = this.user;
        const d = dailyOf(u);
        const x = d.quests.find((qq) => qq.id === m.id);
        const def = QUESTS.find((qq) => qq.id === m.id);
        if (!x || !def || x.claimed || x.have < def.need) break;
        x.claimed = true;
        q.daily.run(JSON.stringify(d), u.id);
        q.give.run(def.reward, u.id);
        this.send({ t: 'claimed', what: 'quest', id: def.id, crystals: def.reward });
        break;
      }
      case 'promo': {
        // не больше 8 попыток в минуту — чтобы коды не подбирали перебором
        const now = Date.now();
        this.promoTries = (this.promoTries ?? []).filter((t) => now - t < 60000);
        if (this.promoTries.length >= 8) { this.send({ t: 'error', where: 'promo', text: 'Слишком много попыток — подожди минуту' }); return; }
        this.promoTries.push(now);
        const code = String(m.code ?? '').trim().slice(0, 32);
        const p = code && q.promo.get(code);
        if (!p) { this.send({ t: 'error', where: 'promo', text: 'Такого промокода нет' }); return; }
        if (q.promoUsed.get(p.code, me.id)) { this.send({ t: 'error', where: 'promo', text: 'Ты уже активировал этот промокод' }); return; }
        if (p.max_uses > 0 && p.uses >= p.max_uses) { this.send({ t: 'error', where: 'promo', text: 'Этот промокод закончился' }); return; }
        db.exec('BEGIN');
        try {
          q.promoUse.run(p.code, me.id, now);
          q.promoCount.run(p.code);
          q.give.run(p.crystals, me.id);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          this.send({ t: 'error', where: 'promo', text: 'Не получилось — попробуй ещё раз' });
          return;
        }
        this.send({ t: 'promoOk', code: p.code, crystals: p.crystals });
        break; // ниже — свежий профиль
      }
      case 'queue':
        if (this.build < MIN_BUILD) { this.send({ t: 'error', where: 'version', text: 'Обнови игру до последней версии — старая не подходит для боёв по сети' }); return; }
        if (this.match) return;
        queue.set(me.id, { c: this, since: Date.now() });
        this.send({ t: 'queued', size: queue.size });
        matchmake();
        return;
      case 'unqueue':
        queue.delete(me.id);
        return;
      case 'host': {
        if (this.build < MIN_BUILD) { this.send({ t: 'error', where: 'version', text: 'Обнови игру до последней версии — старая не подходит для боёв по сети' }); return; }
        if (this.match) return;
        for (const [code, h] of rooms) if (h === this) rooms.delete(code);
        let code;
        do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (rooms.has(code));
        rooms.set(code, this);
        this.send({ t: 'room', code });
        return;
      }
      case 'join': {
        if (this.build < MIN_BUILD) { this.send({ t: 'error', where: 'version', text: 'Обнови игру до последней версии — старая не подходит для боёв по сети' }); return; }
        const code = String(m.code ?? '').toUpperCase().trim();
        const h = rooms.get(code);
        if (!h || !h.alive || !h.user) { this.send({ t: 'error', where: 'join', text: 'Комната не найдена. Проверь код' }); return; }
        if (h === this || h.user.id === me.id) { this.send({ t: 'error', where: 'join', text: 'Это твоя же комната' }); return; }
        rooms.delete(code);
        new Match(h, this, false);
        return;
      }
      case 'leaveRoom':
        for (const [code, h] of rooms) if (h === this) rooms.delete(code);
        return;
      case 'relay':
        this.match?.relay(this, m.d);
        return;
      case 'result':
        this.match?.report(this, m.winner, m.stats);
        return;
      case 'quit':
        this.match?.quit(this);
        return;
      default:
        return;
    }
    this.refresh();
    this.send(profile(this.user));
  }
}

/** Статистика боя из сообщения: только целые счётчики по двум сторонам. */
function cleanMatchStats(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  for (const k of ['kills', 'lords', 'turtles', 'camps', 'pushes']) {
    const v = s[k];
    if (!Array.isArray(v) || v.length !== 2) return null;
    out[k] = v.map((n) => Math.max(0, Math.min(5000, Math.floor(Number(n) || 0))));
  }
  return out;
}

class Match {
  constructor(host, guest, ranked) {
    this.id = rid(9);
    this.ranked = ranked;
    this.p = [host, guest]; // 0 — хост, 1 — гость
    this.ids = [host.user.id, guest.user.id];
    this.names = [host.user.name, guest.user.name];
    this.away = [0, 0]; // когда игрок пропал (0 — на связи)
    this.reports = [null, null];
    this.statReports = [null, null]; // статистика боя от каждого телефона (у обоих одинаковая симуляция)
    this.done = false;
    this.timer = null;
    this.started = Date.now();
    // звёзды героев — из базы, а не с телефона
    this.stars = [host.user, guest.user].map((u) => JSON.parse(u.stars || '{}'));
    matches.set(this.id, this);
    q.matchNew.run(this.id, this.ids[0], this.ids[1], ranked ? 1 : 0, Date.now());
    for (let i = 0; i < 2; i++) {
      const c = this.p[i];
      queue.delete(this.ids[i]);
      c.match = this;
      const foe = this.p[1 - i].user;
      c.send({ t: 'match', id: this.id, role: i === 0 ? 'host' : 'guest', ranked, foe: { name: foe.name, rating: foe.rating }, stars: this.stars });
    }
  }

  side(c) {
    return this.p.indexOf(c);
  }

  relay(c, d) {
    const i = this.side(c);
    if (i < 0 || this.done) return;
    const o = this.p[1 - i];
    if (o?.alive) o.send({ t: 'relay', d });
  }

  left(c) {
    const i = this.side(c);
    if (i < 0 || this.done) return;
    this.p[i] = null;
    this.away[i] = Date.now();
    this.p[1 - i]?.send({ t: 'peer', ok: false });
  }

  rejoin(c) {
    const i = this.ids.indexOf(c.user?.id);
    if (i < 0 || this.done) return;
    this.p[i] = c;
    this.away[i] = 0;
    c.match = this;
    c.send({ t: 'rejoined', id: this.id, role: i === 0 ? 'host' : 'guest' });
    this.p[1 - i]?.send({ t: 'peer', ok: true });
  }

  quit(c) {
    const i = this.side(c);
    if (i < 0 || this.done) return;
    // бой уже закончился у этого игрока (он прислал итог) — просто ушёл в меню, это не бегство
    if (this.reports[i] !== null) { this.p[i] = null; c.match = null; return; }
    this.finish(1 - i, 'quit');
  }

  /** Оба присылают, кто победил. Совпало — засчитываем; второй молчит 15 с — верим первому. */
  report(c, winnerSide, stats) {
    const i = this.side(c);
    if (i < 0 || this.done || (winnerSide !== 0 && winnerSide !== 1)) return;
    this.reports[i] = winnerSide;
    this.statReports[i] = cleanMatchStats(stats);
    const [a, b] = this.reports;
    if (a !== null && b !== null) { if (a === b) this.finish(a, 'throne'); else this.finish(null, 'disputed'); return; }
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.finish(winnerSide, 'throne-one'), 15000);
  }

  tick(now) {
    if (this.done) return;
    for (let i = 0; i < 2; i++) {
      if (this.away[i] && now - this.away[i] > REJOIN_MS) {
        // не вернулся — поражение ушедшему (если пропали оба — матч без итога)
        const other = 1 - i;
        this.finish(this.away[other] ? null : other, 'left');
        return;
      }
    }
  }

  finish(winner, reason) {
    if (this.done) return;
    this.done = true;
    clearTimeout(this.timer);
    matches.delete(this.id);
    let delta = 0;
    if (winner !== null && this.ranked) {
      const w = q.byId.get(this.ids[winner]);
      const l = q.byId.get(this.ids[1 - winner]);
      const expect = 1 / (1 + 10 ** ((l.rating - w.rating) / 400));
      delta = Math.max(1, Math.round(K * (1 - expect)));
      q.rate.run(w.rating + delta, 1, 0, w.id);
      q.rate.run(Math.max(0, l.rating - delta), 0, 1, l.id);
    }
    q.matchEnd.run(winner === null ? null : this.ids[winner], delta, reason, Date.now(), this.id);
    // кристаллы: только рейтинг, только честно доигранный матч (не короче MIN_REWARD_MS); сбежавшему — ничего
    const gain = [0, 0];
    if (this.ranked && winner !== null && Date.now() - this.started >= MIN_REWARD_MS) {
      gain[winner] = REWARD.win;
      if (reason === 'throne' || reason === 'throne-one') gain[1 - winner] = REWARD.loss;
      for (let i = 0; i < 2; i++) if (gain[i]) q.give.run(gain[i], this.ids[i]);
    }
    // задания: только доигранный до трона бой не короче MIN_REWARD_MS. Статистике верим, если оба телефона прислали
    // одинаковую (или прислал один, а второй промолчал) — подделать её в одиночку нельзя
    if (winner !== null && (reason === 'throne' || reason === 'throne-one') && Date.now() - this.started >= MIN_REWARD_MS) {
      const [sa, sb] = this.statReports.map((x) => (x ? JSON.stringify(x) : null));
      const st = sa && sb ? (sa === sb ? this.statReports[0] : null) : (this.statReports[0] ?? this.statReports[1]);
      for (let i = 0; i < 2; i++) {
        questProgress(this.ids[i], winner === i, st ? Object.fromEntries(Object.entries(st).map(([k, v]) => [k, v[i]])) : null);
      }
    }
    for (let i = 0; i < 2; i++) {
      const c = this.p[i];
      if (!c) continue;
      c.match = null;
      c.refresh();
      c.send({ t: 'ended', winner, reason, ranked: this.ranked, delta: winner === null ? 0 : winner === i ? delta : -delta, crystals: gain[i] });
      if (c.user) c.send(profile(c.user));
    }
  }
}

/** Подбор: пары с близким рейтингом; чем дольше ждёшь, тем шире окно. */
function matchmake() {
  const now = Date.now();
  const list = [...queue.values()].filter((x) => x.c.alive && x.c.user && !x.c.match);
  list.sort((a, b) => a.since - b.since);
  const used = new Set();
  for (const a of list) {
    if (used.has(a)) continue;
    const wa = 100 + ((now - a.since) / 1000) * 15;
    let best = null;
    let bd = Infinity;
    for (const b of list) {
      if (b === a || used.has(b)) continue;
      const wb = 100 + ((now - b.since) / 1000) * 15;
      const d = Math.abs(a.c.user.rating - b.c.user.rating);
      if (d <= Math.min(wa, wb) && d < bd) { bd = d; best = b; }
    }
    if (best) {
      used.add(a);
      used.add(best);
      // хостом становится тот, кто ждал дольше (случайно — честнее, но так проще объяснить)
      new Match(a.c, best.c, true);
    }
  }
}

setInterval(() => {
  matchmake();
  const now = Date.now();
  for (const m of matches.values()) m.tick(now);
  for (const c of online.values()) if (now - c.lastIn > 60000) c.close(); // молчит минуту — отключаем
}, 1000);

// ---------- http ----------
const srv = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, online: online.size, queue: queue.size, matches: matches.size, players: q.count.get().n }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('Arena of Defense server\n');
});
srv.on('upgrade', (req, sock) => {
  if (!req.url?.startsWith('/ws')) { sock.destroy(); return; }
  wsAccept(req, sock);
});
srv.listen(PORT, () => console.log(`Arena of Defense server on :${PORT}, db ${DB_PATH}`));
