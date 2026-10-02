// Сервер Arena of Defense: аккаунты, прогресс, рейтинг, подбор соперника и передача сетевой игры.
// Без внешних библиотек: только Node.js 22+ (встроенные http, crypto и sqlite).
// Запуск: node server.mjs  (порт — PORT, по умолчанию 8080; база — DB, по умолчанию ./arena.db)
// Снаружи его прикрывает Caddy: он даёт https/wss и сам получает сертификат.

import http from 'node:http';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.PORT || 8080);
const DB_PATH = process.env.DB || new URL('./arena.db', import.meta.url).pathname;
const START_RATING = 1000;
const K = 32; // насколько сильно меняется рейтинг за бой
const REJOIN_MS = 45000; // сколько ждём вернувшегося после обрыва игрока
const START_CRYSTALS = 300;

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
const q = {
  byId: db.prepare('SELECT * FROM users WHERE id = ?'),
  byName: db.prepare('SELECT * FROM users WHERE name = ?'),
  insert: db.prepare('INSERT INTO users (id, token, name, crystals, owned, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  seen: db.prepare('UPDATE users SET seen = ? WHERE id = ?'),
  name: db.prepare('UPDATE users SET name = ? WHERE id = ?'),
  pass: db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
  token: db.prepare('UPDATE users SET token = ? WHERE id = ?'),
  save: db.prepare('UPDATE users SET crystals = ?, owned = ? WHERE id = ?'),
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

function profile(u) {
  return {
    t: 'me', id: u.id, token: u.token, name: u.name, rating: u.rating, wins: u.wins, losses: u.losses,
    crystals: u.crystals, owned: JSON.parse(u.owned), hasPass: !!u.pass,
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

  login(u) {
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
        // новый аккаунт: имя + прогресс с телефона (кристаллы и открытые герои)
        let name = cleanName(m.name);
        if (name.length < 2) { this.send({ t: 'error', where: 'register', text: 'Имя слишком короткое' }); return; }
        if (q.byName.get(name)) { this.send({ t: 'error', where: 'register', text: 'Такое имя уже занято' }); return; }
        const id = rid(9);
        const crystals = Math.max(0, Math.min(100000, Number(m.crystals) || START_CRYSTALS));
        const owned = Array.isArray(m.owned) ? m.owned.filter((x) => typeof x === 'string').slice(0, 200) : [];
        q.insert.run(id, rid(24), name, crystals, JSON.stringify(owned), Date.now(), Date.now());
        this.login(q.byId.get(id));
        return;
      }
      case 'auth': {
        const u = q.byId.get(String(m.id ?? ''));
        if (!u || u.token !== m.token) { this.send({ t: 'error', where: 'auth', text: 'Аккаунт не найден' }); return; }
        this.login(u);
        if (m.matchId) matches.get(m.matchId)?.rejoin(this);
        return;
      }
      case 'login': {
        const u = q.byName.get(cleanName(m.name));
        if (!u || !checkPass(String(m.password ?? ''), u.pass)) { this.send({ t: 'error', where: 'login', text: 'Неверное имя или пароль' }); return; }
        this.login(u);
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
      case 'save': {
        // прогресс: кристаллы и открытые герои
        const crystals = Math.max(0, Math.min(1000000, Math.floor(Number(m.crystals) || 0)));
        const owned = Array.isArray(m.owned) ? m.owned.filter((x) => typeof x === 'string').slice(0, 200) : JSON.parse(me.owned);
        q.save.run(crystals, JSON.stringify(owned), me.id);
        this.refresh();
        return; // без ответа — телефон и так знает
      }
      case 'queue':
        if (this.match) return;
        queue.set(me.id, { c: this, since: Date.now() });
        this.send({ t: 'queued', size: queue.size });
        matchmake();
        return;
      case 'unqueue':
        queue.delete(me.id);
        return;
      case 'host': {
        if (this.match) return;
        for (const [code, h] of rooms) if (h === this) rooms.delete(code);
        let code;
        do { code = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[crypto.randomInt(32)]).join(''); } while (rooms.has(code));
        rooms.set(code, this);
        this.send({ t: 'room', code });
        return;
      }
      case 'join': {
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
        this.match?.report(this, m.winner);
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

class Match {
  constructor(host, guest, ranked) {
    this.id = rid(9);
    this.ranked = ranked;
    this.p = [host, guest]; // 0 — хост, 1 — гость
    this.ids = [host.user.id, guest.user.id];
    this.names = [host.user.name, guest.user.name];
    this.away = [0, 0]; // когда игрок пропал (0 — на связи)
    this.reports = [null, null];
    this.done = false;
    this.timer = null;
    matches.set(this.id, this);
    q.matchNew.run(this.id, this.ids[0], this.ids[1], ranked ? 1 : 0, Date.now());
    for (let i = 0; i < 2; i++) {
      const c = this.p[i];
      queue.delete(this.ids[i]);
      c.match = this;
      const foe = this.p[1 - i].user;
      c.send({ t: 'match', id: this.id, role: i === 0 ? 'host' : 'guest', ranked, foe: { name: foe.name, rating: foe.rating } });
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
  report(c, winnerSide) {
    const i = this.side(c);
    if (i < 0 || this.done || (winnerSide !== 0 && winnerSide !== 1)) return;
    this.reports[i] = winnerSide;
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
    for (let i = 0; i < 2; i++) {
      const c = this.p[i];
      if (!c) continue;
      c.match = null;
      c.refresh();
      c.send({ t: 'ended', winner, reason, ranked: this.ranked, delta: winner === null ? 0 : winner === i ? delta : -delta });
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
