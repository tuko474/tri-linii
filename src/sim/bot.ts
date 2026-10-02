// Простой противник. Играет по тем же правилам и тем же кнопкам, что и игрок.
import { HEROES } from '../data/heroes';
import type { Game } from './game';
import { halfOf } from './map';
import type { Hero, Pick, Side } from './types';

export function botPicks(): Pick[] {
  const pool = [...HEROES].sort(() => Math.random() - 0.5).slice(0, 5);
  const lanes = [0, 0, 1, 2, 2].sort(() => Math.random() - 0.5);
  return pool.map((h, i) => ({ heroId: h.id, lane: lanes[i] }));
}

export class Bot {
  private think = 0;
  private tripThink = 8;
  private focus = Math.floor(Math.random() * 3);

  /** rush — агрессивный стиль, похожий на сильного игрока: всё в одну линию и постоянный лес. Нужен для проверки баланса. */
  constructor(private side: Side, private style: 'normal' | 'rush' = 'normal') {}

  update(g: Game, dt: number) {
    this.tripThink -= dt;
    if (this.tripThink <= 0) {
      this.tripThink = this.style === 'rush' ? 1.5 + Math.random() : 3 + Math.random() * 3;
      this.trips(g);
    }

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
    if (worst >= 0 && worstGap >= (this.style === 'rush' ? 3 : 1)) {
      if (g.upgradeCreeps(worst, me)) return;
      // уровень обороны упёрся в лимит времени — усиливаем другие линии
    }

    // Нападение: давим одну выбранную линию, иногда меняем фокус.
    if (this.style === 'rush') {
      if (!g.upgradeCreeps(this.focus, me)) for (const l of [0, 1, 2]) if (g.upgradeCreeps(l, me)) break;
      return;
    }
    if (Math.random() < 0.04) this.focus = Math.floor(Math.random() * 3);
    // золото тратится только на крипов: сначала на линию фокуса, потом на остальные
    if (!g.upgradeCreeps(this.focus, me)) for (const l of [0, 1, 2].sort(() => Math.random() - 0.5)) if (g.upgradeCreeps(l, me)) break;
  }

  /** Кого можно снять с линии: на линии останется хотя бы один живой герой. */
  private spare(g: Game, want: number): Hero[] {
    const me = this.side;
    const out: Hero[] = [];
    for (let l = 0; l < 3; l++) {
      const here = g.heroesOn(l, me).filter((h) => !h.dead && !h.trip).sort((a, b) => b.lvl - a.lvl || b.hp - a.hp);
      if (g.atThrone(l, me)) continue;
      out.push(...here.slice(0, Math.max(0, here.length - 1)));
    }
    return out.filter((h) => h.hp > h.maxHp * 0.6).sort((a, b) => b.lvl - a.lvl).slice(0, want);
  }

  private trips(g: Game) {
    const me = this.side;
    const foe = (1 - me) as Side;
    const busy = g.heroes.some((h) => h.side === me && h.trip && h.trip.phase !== 'back');

    // Если отряд проигрывает (мало HP) — отзываем.
    for (const n of g.neutrals) {
      const mine = g.party(n.id, me, 'fight');
      if (mine.length && mine.every((h) => h.hp < h.maxHp * 0.25)) g.recall(me, n.id);
    }
    if (busy) return;

    // Стражи логов: держим под контролем, чтобы видеть, кто бьёт Лорда и Черепаху.
    for (const gd of g.neutrals) {
      if (gd.kind !== 'guard' || gd.owner === me || !gd.alive) continue;
      if (Math.random() > 0.3) continue;
      const team = this.spare(g, gd.owner === null ? 1 : 2);
      if (team.length) {
        g.sendParty(me, gd.id, team);
        return;
      }
    }

    // Боссы: идём сами или перехватываем, если туда пошёл игрок.
    for (const n of g.neutrals.slice(0, 2)) {
      if (!n.alive) continue;
      // видит ли бот врага у логова — сквозь туман войны он не подглядывает
      const contest = g.party(n.id, foe).length > 0 && g.visible(me, n.x, n.y);
      const chance = contest ? 0.6 : n.kind === 'lord' ? 0.35 : 0.25;
      if (Math.random() > chance) continue;
      const team = this.spare(g, n.kind === 'lord' ? 3 : 2);
      if (team.length >= 2) {
        g.sendParty(me, n.id, team);
        return;
      }
    }

    // Лес: изредка один герой идёт на ближайший живой лагерь своей половины.
    if (Math.random() < (this.style === 'rush' ? 0.9 : 0.35)) {
      const h = this.spare(g, 1)[0];
      if (!h) return;
      const from = g.heroPos(h);
      const camps = g.neutrals.filter((n) => n.kind === 'camp' && n.alive && halfOf(n.x, n.y) === me);
      camps.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
      if (camps[0]) g.sendParty(me, camps[0].id, [h]);
    }
  }
}
