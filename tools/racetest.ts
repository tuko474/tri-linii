// Сила бонуса расы крипам: обе стороны — одинаковые пятёрки (2 героя расы X на верхе и низе + 3 разных рас),
// но у стороны 1 бонус крипам выключен. Показывает побед стороны 0 и среднюю длину матча.
declare const process: { argv: string[] };
import { Game } from '../src/sim/game';
import { Bot } from '../src/sim/bot';
import { HEROES } from '../src/data/heroes';
import { RACE_IDS } from '../src/data/races';
const N = Number(process.argv[2] ?? 12);
for (const race of RACE_IDS) {
  let w0 = 0, tsum = 0;
  for (let i = 0; i < N; i++) {
    const shuffle = <T,>(a: T[]) => a.map((v) => [Math.random(), v] as [number, T]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    const two = shuffle(HEROES.filter((h) => h.race === race)).slice(0, 2);
    const others = shuffle(RACE_IDS.filter((r) => r !== race)).slice(0, 3).map((r) => shuffle(HEROES.filter((h) => h.race === r))[0]);
    const picks = [{ heroId: two[0].id, lane: 0 }, { heroId: others[0].id, lane: 0 }, { heroId: others[1].id, lane: 1 }, { heroId: two[1].id, lane: 2 }, { heroId: others[2].id, lane: 2 }];
    const g = new Game([picks, picks.map((p) => ({ ...p }))], 'normal');
    const orig = g.laneCreepFx.bind(g);
    g.laneCreepFx = (lane, side) => (side === 1 ? { fx: { mul: 1, ls: 0, rate: 1, armor: 0, crit: 0, mage: 0, melee: 0 }, races: [] } : orig(lane, side));
    g.autoCast = [true, true];
    const bots = [new Bot(0, 'normal'), new Bot(1, 'normal')];
    while (g.winner === null && g.t < 3600) { bots[0].update(g, 1 / 30); bots[1].update(g, 1 / 30); g.update(1 / 30); }
    if (g.winner === 0) w0++;
    tsum += g.t;
  }
  console.log(race.padEnd(10), 'с бонусом крипам побед', w0, 'из', N, ' средний матч', (tsum / N / 60).toFixed(1), 'мин');
}
