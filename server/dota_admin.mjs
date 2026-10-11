// Обслуживание рейтинга Доты на сервере (запускать на VPS).
//
//   node /opt/arena/server/dota_admin.mjs supporter list
//   node /opt/arena/server/dota_admin.mjs supporter add "Ник" legend|ally|supporter
//   node /opt/arena/server/dota_admin.mjs supporter del "Ник"
//
// Сторонники показываются на странице https://31-31-192-98.sslip.io/dota (блок «Спасибо сторонникам»).
// Уровни: legend — «Легенды» (👑), ally — «Соратники», supporter — «Сторонники».
import fs from 'node:fs';
import path from 'node:path';

const FILE = path.join(path.dirname(process.env.DB || '/var/lib/arena/arena.db'), 'dota_supporters.json');
const TIERS = ['legend', 'ally', 'supporter'];
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } };
const save = (list) => fs.writeFileSync(FILE, JSON.stringify(list, null, 2) + '\n');
const show = (list) => {
  if (!list.length) return console.log('Список пуст');
  for (const t of TIERS) for (const x of list.filter((y) => y.tier === t)) console.log(`${t.padEnd(9)} ${x.name}`);
};

const [what, cmd, name, tier = 'supporter'] = process.argv.slice(2);

// Сезоны:
//   node /opt/arena/server/dota_admin.mjs season          — текущий сезон и сколько дней осталось
//   node /opt/arena/server/dota_admin.mjs season preview  — какие значки получили бы игроки, если бы сезон кончился сейчас
if (what === 'season') {
  process.env.DB ||= '/var/lib/arena/arena.db';
  const { seasonOf, closeSeason, BADGES } = await import('./dota.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  const s = seasonOf(Date.now());
  console.log(`Сезон: ${s.ru}${s.trial ? ' (пробный, без значков)' : ''}, до конца ${Math.ceil((s.end - Date.now()) / 86400e3)} дн.`);
  if (cmd === 'preview') {
    // «season preview test» — по тестовой базе (игры из Tools)
    const db = new DatabaseSync(path.join(path.dirname(process.env.DB), name === 'test' ? 'dota_test.db' : 'dota.db'));
    const r = closeSeason(db, s.id, { dryRun: true, forceBadges: true });
    const show = (b) => (b ? `${BADGES[b].icon} ${BADGES[b].ru}` : '—');
    console.log('\nИгроки (место · ММР · игр за сезон · значок):');
    for (const x of r.solo) console.log(`${String(x.place).padStart(3)}. ${x.name.padEnd(24)} ${String(x.mmr).padStart(5)}  ${String(x.games).padStart(3)}  ${show(x.badge)}`);
    console.log('\nКоманды:');
    for (const x of r.teams) console.log(`${String(x.place).padStart(3)}. [${x.tag}] ${x.name.padEnd(20)} ${String(x.mmr).padStart(5)}  ${String(x.games).padStart(3)}  ${show(x.badge)}`);
  }
  process.exit(0);
}

if (what !== 'supporter') {
  console.log('Команды: supporter list | supporter add "Ник" legend|ally|supporter | supporter del "Ник" | season | season preview');
  process.exit(1);
}
let list = load();
if (cmd === 'add') {
  if (!name) { console.error('Укажи ник'); process.exit(1); }
  if (!TIERS.includes(tier)) { console.error('Уровень: legend, ally или supporter'); process.exit(1); }
  list = list.filter((x) => x.name.toLowerCase() !== name.toLowerCase());
  list.push({ name: name.slice(0, 40), tier });
  save(list);
  console.log(`Добавлен: ${name} (${tier})`);
} else if (cmd === 'del') {
  const before = list.length;
  list = list.filter((x) => x.name.toLowerCase() !== String(name || '').toLowerCase());
  save(list);
  console.log(before === list.length ? 'Такого ника нет' : `Удалён: ${name}`);
}
show(list);
