// Простой противник. Играет по тем же правилам и тем же кнопкам, что и игрок.
import { HEROES } from '../data/heroes';
import type { Game } from './game';
import type { Pick, Side } from './types';

export function botPicks(): Pick[] {
  const pool = [...HEROES].sort(() => Math.random() - 0.5).slice(0, 5);
  // Крепкие герои — на края, где линии длиннее; остальных раскидываем 2-1-2.
  const lanes = [0, 0, 1, 2, 2].sort(() => Math.random() - 0.5);
  return pool.map((h, i) => ({ heroId: h.id, lane: lanes[i] }));
}

export class Bot {
  private think = 0;
  private focus = Math.floor(Math.random() * 3);

  constructor(private side: Side) {}

  update(g: Game, dt: number) {
    this.think -= dt;
    if (this.think > 0) return;
    this.think = 0.6 + Math.random() * 0.6;
    const me = this.side;
    const foe = (1 - me) as Side;

    // Оборона: линия, где враг сильнее нас по крипам или наши герои уже у трона.
    let worst = -1;
    let worstGap = 0;
    for (let l = 0; l < 3; l++) {
      const gap = g.creepLvl[l][foe] - g.creepLvl[l][me] + (g.atThrone(l, me) ? 2 : 0);
      if (gap > worstGap) { worstGap = gap; worst = l; }
    }
    if (worst >= 0 && worstGap >= 1) {
      if (g.upgradeCreeps(worst, me)) return;
      const weak = g.heroesOn(worst, me).sort((a, b) => a.lvl - b.lvl)[0];
      if (weak && g.gold[me] >= g.heroUpCost(weak) && g.levelHero(weak)) return;
      return; // копим на оборону
    }

    // Нападение: давим одну выбранную линию, иногда меняем фокус.
    if (Math.random() < 0.04) this.focus = Math.floor(Math.random() * 3);
    const roll = Math.random();
    if (roll < 0.55) {
      g.upgradeCreeps(this.focus, me);
    } else {
      const mine = g.heroes.filter((h) => h.side === me).sort((a, b) => a.lvl - b.lvl);
      if (mine[0]) g.levelHero(mine[0]);
    }
  }
}
