// Прогон матчей бот против бота без экрана: проверка, что игра заканчивается и баланс живой.
declare const process: { argv: string[] };
import { Game } from '../src/sim/game';
import { Bot, botPicks } from '../src/sim/bot';

const N = Number(process.argv[2] ?? 20);
const res: { winner: number | null; t: number; pushes: number[]; lvl: number; lords: number[]; turtles: number[]; camps: number[] }[] = [];
for (let i = 0; i < N; i++) {
  const g = new Game([botPicks(), botPicks()], 'normal');
  g.autoCast = [true, true];
  const bots = [new Bot(0), new Bot(1)];
  const dt = 1 / 30;
  while (g.winner === null && g.t < 1800) {
    bots[0].update(g, dt);
    bots[1].update(g, dt);
    g.update(dt);
  }
  const avgLvl = g.heroes.reduce((a, h) => a + h.lvl, 0) / g.heroes.length;
  res.push({ winner: g.winner, t: Math.round(g.t), pushes: g.stats.pushes, lvl: +avgLvl.toFixed(1), lords: g.stats.lords, turtles: g.stats.turtles, camps: g.stats.camps });
}
console.log(res.map((r) => `win=${r.winner} t=${Math.floor(r.t / 60)}:${String(r.t % 60).padStart(2, '0')} pushes=${r.pushes} heroLvl=${r.lvl} lords=${r.lords} turtles=${r.turtles} camps=${r.camps}`).join('\n'));
const times = res.filter((r) => r.winner !== null).map((r) => r.t);
console.log('finished', times.length, '/', N, 'avg min', (times.reduce((a, b) => a + b, 0) / Math.max(1, times.length) / 60).toFixed(1));
