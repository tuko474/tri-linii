// Обслуживание аккаунтов прямо на сервере (запускать на VPS, сервер игры может работать).
//
//   node /opt/arena/server/admin.mjs create <имя> <пароль> [кристаллы]   — новый аккаунт (например для тестов)
//   node /opt/arena/server/admin.mjs give   <имя> <кристаллы>           — добавить кристаллы (можно с минусом)
//   node /opt/arena/server/admin.mjs reset  <имя> [all]                 — кристаллы 300, звёзды 0; с all — и герои стартовые
//   node /opt/arena/server/admin.mjs list                                — все аккаунты
//   node /opt/arena/server/admin.mjs promo add <КОД> <кристаллы> [лимит] — промокод (лимит активаций, 0 — без лимита)
//   node /opt/arena/server/admin.mjs promo list | promo del <КОД>
//
// База — как у службы: /var/lib/arena/arena.db (или переменная DB).
// Пароли сюда, в репозиторий, не пишем: он публичный. Пароль передаётся только в команде на сервере.
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { HERO_PRICE } from './economy.mjs';

const DB_PATH = process.env.DB || '/var/lib/arena/arena.db';
const START_CRYSTALS = 300;
const STARTERS = Object.keys(HERO_PRICE).filter((id) => HERO_PRICE[id] === 0);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA busy_timeout = 5000');
if (!db.prepare('PRAGMA table_info(users)').all().some((c) => c.name === 'stars')) {
  db.exec(`ALTER TABLE users ADD COLUMN stars TEXT NOT NULL DEFAULT '{}'`);
}
// формат пароля — как в server.mjs: соль:scrypt
const rid = (n = 16) => crypto.randomBytes(n).toString('base64url');
const hashPass = (p, salt = rid(12)) => salt + ':' + crypto.scryptSync(p, salt, 32).toString('base64url');

db.exec(`
  CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY COLLATE NOCASE, crystals INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 0, uses INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS promo_uses (code TEXT NOT NULL COLLATE NOCASE, user TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (code, user));
`);
const showPromo = (p) => console.log(`${p.code}: ✦ ${p.crystals}, активировали ${p.uses}${p.max_uses ? ' из ' + p.max_uses : ' (без лимита)'}`);

const byName = (name) => db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').get(name);
const fail = (msg) => { console.error('Ошибка: ' + msg); process.exit(1); };
const show = (u) => console.log(`${u.name}: ✦ ${u.crystals}, рейтинг ${u.rating}, героев ${JSON.parse(u.owned).length}, звёзды ${u.stars}`);

const [cmd, name, a3, a4] = process.argv.slice(2);
switch (cmd) {
  case 'create': {
    if (!name || !a3) fail('нужно: create <имя> <пароль> [кристаллы]');
    if (byName(name)) fail(`аккаунт «${name}» уже есть`);
    const crystals = Math.max(0, Math.floor(Number(a4 ?? START_CRYSTALS)));
    db.prepare('INSERT INTO users (id, token, name, pass, crystals, owned, stars, created, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(rid(9), rid(24), name, hashPass(a3), crystals, JSON.stringify(STARTERS), '{}', Date.now(), Date.now());
    console.log('Создан аккаунт. В игре: кнопка аккаунта → «Войти» → имя и пароль.');
    show(byName(name));
    break;
  }
  case 'give': {
    const u = byName(name ?? '') ?? fail(`нет аккаунта «${name}»`);
    const n = Math.floor(Number(a3));
    if (!Number.isFinite(n)) fail('нужно: give <имя> <кристаллы>');
    db.prepare('UPDATE users SET crystals = MAX(0, crystals + ?) WHERE id = ?').run(n, u.id);
    show(byName(name));
    break;
  }
  case 'reset': {
    const u = byName(name ?? '') ?? fail(`нет аккаунта «${name}»`);
    const owned = a3 === 'all' ? JSON.stringify(STARTERS) : u.owned;
    db.prepare("UPDATE users SET crystals = ?, stars = '{}', owned = ? WHERE id = ?").run(START_CRYSTALS, owned, u.id);
    show(byName(name));
    break;
  }
  case 'list':
    for (const u of db.prepare('SELECT * FROM users ORDER BY created').all()) show(u);
    break;
  case 'promo': {
    const [sub2, code, n, lim] = [name, a3, a4, process.argv[6]];
    if (sub2 === 'add') {
      if (!code || !/^[\p{L}\p{N}_-]{3,32}$/u.test(code)) fail('код: 3–32 буквы/цифры, без пробелов');
      const crystals = Math.floor(Number(n));
      if (!(crystals > 0)) fail('нужно: promo add <КОД> <кристаллы> [лимит]');
      if (db.prepare('SELECT 1 FROM promos WHERE code = ?').get(code)) fail(`промокод «${code}» уже есть`);
      db.prepare('INSERT INTO promos (code, crystals, max_uses, created) VALUES (?, ?, ?, ?)').run(code, crystals, Math.max(0, Math.floor(Number(lim ?? 0))), Date.now());
      showPromo(db.prepare('SELECT * FROM promos WHERE code = ?').get(code));
      console.log('Игрок вводит код в игре: кнопка аккаунта → «Промокод».');
    } else if (sub2 === 'del') {
      db.prepare('DELETE FROM promos WHERE code = ?').run(code ?? '');
      console.log('Удалён (если был):', code);
    } else {
      const all = db.prepare('SELECT * FROM promos ORDER BY created').all();
      if (!all.length) console.log('Промокодов пока нет');
      for (const p of all) showPromo(p);
    }
    process.exit(0);
  }
  default:
    console.log('Команды: create <имя> <пароль> [кристаллы] · give <имя> <кристаллы> · reset <имя> [all] · list · promo add <КОД> <кристаллы> [лимит] · promo list · promo del <КОД>');
}
console.log('Если игрок сейчас в игре — изменения он увидит после перезахода в аккаунт.');
