// Сколько живёт трон под волной: крипы уровня LVL, барак 3, без героев-защитников на линии, без улучшений трона.
declare const process: { argv: string[] };
import { Game } from '../src/sim/game';
const picks = () => [0, 1, 2, 0, 2].map((lane, i) => ({ heroId: ['frost', 'storm', 'fire', 'necro', 'healer'][i], lane }));
const LVL = Number(process.argv[2] ?? 12);
for (const min of [15, 18, 20, 25]) {
  const g = new Game([picks(), picks()], 'normal', 7);
  g.t = min * 60;
  g.creepLvl[1][0] = LVL;
  g.barracks[1][0] = 3;
  g.front[1][1] = 6; // центр соперника откачен к трону
  for (const h of g.heroes) if (h.side === 1 && h.lane === 1) { h.dead = true; h.respawn = 1e9; }
  g.waveNo = 3; // следующая — с катапультой
  g.waveTimer = 0.01;
  const start = g.throne[1];
  let firstHit = -1, t0 = g.t;
  const dt = 1 / 30;
  // только одна волна: выключаем следующие
  let spawned = false;
  while (g.t - t0 < 120 && g.throne[1] > 0 && g.winner === null) {
    g.update(dt);
    if (!spawned && g.waveNo === 4) { spawned = true; g.waveTimer = 1e9; }
    if (firstHit < 0 && g.throne[1] < start) firstHit = g.t;
  }
  const alive = g.creeps.filter((c) => c.side === 0 && c.lane === 1 && !c.dead).length;
  console.log(`${min} мин: трон ${g.throne[1] <= 0 ? 'пал' : 'жив ' + Math.round(g.throne[1])} за ${(g.t - firstHit).toFixed(1)} с после первого удара; крипов дошло живыми ${alive}`);
}
