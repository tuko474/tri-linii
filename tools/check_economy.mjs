// Проверка: цены на сервере (server/economy.mjs) совпадают с игрой (src/data).
import { readFileSync } from 'node:fs';
import { HERO_PRICE, STAR_COST } from '../server/economy.mjs';
const heroes = readFileSync(new URL('../src/data/heroes.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../src/data/config.ts', import.meta.url), 'utf8');
const game = Object.fromEntries([...heroes.matchAll(/    id: '(\w+)'.*?price: (\d+)/g)].map((m) => [m[1], Number(m[2])]));
const bad = [];
for (const [id, p] of Object.entries(game)) if (HERO_PRICE[id] !== p) bad.push(`${id}: игра ${p}, сервер ${HERO_PRICE[id]}`);
for (const id of Object.keys(HERO_PRICE)) if (!(id in game)) bad.push(`${id}: есть на сервере, нет в игре`);
const cost = /stars: \{[^}]*cost: \[([^\]]+)\]/.exec(config)?.[1].split(',').map(Number);
if (JSON.stringify(cost) !== JSON.stringify(STAR_COST)) bad.push(`звёзды: игра ${cost}, сервер ${STAR_COST}`);
if (bad.length) { console.error('Расхождения:\n' + bad.join('\n')); process.exit(1); }
console.log('Цены совпадают:', Object.keys(game).length, 'героев, звёзды', STAR_COST.join('/'));
