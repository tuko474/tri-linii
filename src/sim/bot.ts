// Простой противник. Играет по тем же правилам и тем же кнопкам, что и игрок.
import { BAL } from '../data/config';
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
  /** level — сложность: на сложном бот чаще ходит в лес и к боссам и раньше встаёт в оборону. */
  constructor(private side: Side, private style: 'normal' | 'rush' = 'normal', private level: 'easy' | 'normal' | 'hard' = 'normal') {}

  update(g: Game, dt: number) {
    this.tripThink -= dt;
    if (this.tripThink <= 0) {
      this.tripThink = this.style === 'rush' || this.level === 'hard' ? 1.5 + Math.random() : this.level === 'easy' ? 5 + Math.random() * 4 : 3 + Math.random() * 3;
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
      // чем глубже нас продавили, тем срочнее оборона (на лёгком бот этого не замечает)
      const deep = this.level === 'easy' ? 0 : g.depth(l, me);
      const gap = g.creepLvl[l][foe] - g.creepLvl[l][me] + deep + (g.atThrone(l, me) ? 2 : 0);
      if (gap > worstGap) { worstGap = gap; worst = l; }
    }
    // Подмога: линия продавлена глубоко, а герои там гибнут — стягиваем помощь с других линий.
    if (worst >= 0 && this.level !== 'easy' && g.canHelp(me) && this.needHelp(g, worst)) {
      const keep = this.level === 'hard' ? 1 : 2; // сколько героев оставить на каждой из других линий
      const list: Hero[] = [];
      for (let l = 0; l < 3; l++) {
        if (l === worst) continue;
        const here = g.heroesOn(l, me).filter((h) => !h.dead && !h.trip && h.helpT <= 0).sort((a, b) => b.hp - a.hp);
        list.push(...here.slice(0, Math.max(0, here.length - keep)));
      }
      if (list.length && g.callHelp(me, worst, list)) return;
    }

    // Глиф: линию продавили глубоко, а её герои почти мертвы; или трон бьют, а прочности мало
    if (this.level !== 'easy' && g.canGlyph(me)) {
      if (g.throneUnderAttack(me) && g.throne[me] < BAL.throneHp * 0.3 && g.glyph(me)) return;
      for (let l = 0; l < 3; l++) {
        if (g.depth(l, me) < 2 && !g.atThrone(l, me)) continue;
        const hs = g.heroesOn(l, me).filter((h) => !h.dead && !h.trip);
        if (hs.length && hs.every((h) => h.hp < h.maxHp * 0.35) && g.glyph(me)) return;
      }
    }

    if (worst >= 0 && worstGap >= (this.style === 'rush' ? 3 : 1)) {
      if (g.upgradeCreeps(worst, me)) return;
      // на сложном копим золото на оборону, пока лимит не позволит усилить эту линию
      if (this.level === 'hard' && worstGap >= 2 && g.creepLvl[worst][me] < g.creepCap()) return;
      // уровень обороны упёрся в лимит времени — усиливаем другие линии
    }

    // Нападение: давим одну выбранную линию, иногда меняем фокус.
    if (this.style === 'rush') {
      if (!g.upgradeCreeps(this.focus, me)) for (const l of [0, 1, 2]) if (g.upgradeCreeps(l, me)) return;
      this.spendRest(g);
      return;
    }
    if (Math.random() < 0.04) this.focus = Math.floor(Math.random() * 3);
    // сначала крипы: линия фокуса, потом остальные; упёрлись в лимит времени — улучшения
    if (g.upgradeCreeps(this.focus, me)) return;
    for (const l of [0, 1, 2].sort(() => Math.random() - 0.5)) if (g.upgradeCreeps(l, me)) return;
    this.spendRest(g);
  }

  /** Золото, которое некуда деть в крипов: алтарь, пушка, бараки. Держим запас на глиф. */
  private spendRest(g: Game) {
    const me = this.side;
    if (this.level === 'easy' && Math.random() < 0.6) return;
    const reserve = g.glyphCd[me] <= 0 ? 0 : 200;
    const opts: (() => boolean)[] = [];
    const costs: number[] = [];
    for (const k of ['armor', 'fury', 'mana', 'gun'] as const) {
      const c = g.upgCost(me, k);
      if (c !== null) { opts.push(() => g.buyUpg(me, k)); costs.push(c); }
    }
    for (let l = 0; l < 3; l++) {
      const c = g.barracksCost(l, me);
      if (c !== null) { opts.push(() => g.buyBarracks(l, me)); costs.push(c * (l === this.focus ? 0.8 : 1.1)); }
    }
    if (!opts.length) return;
    // самое дешёвое из доступного — так прокачка идёт ровно
    let best = 0;
    for (let i = 1; i < opts.length; i++) if (costs[i] < costs[best]) best = i;
    if (g.gold[me] - reserve >= costs[best]) opts[best]();
  }

  /** Линии нужна подмога: мы глубоко, а живых героев там мало или они ранены. */
  private needHelp(g: Game, lane: number): boolean {
    const me = this.side;
    if (g.depth(lane, me) < 2 && !g.atThrone(lane, me)) return false;
    const alive = g.heroesOn(lane, me).filter((h) => !h.dead && !h.trip);
    const hp = alive.reduce((a, h) => a + h.hp / h.maxHp, 0);
    return hp < 1.2;
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
      const boost = this.level === 'hard' ? 1.6 : this.level === 'easy' ? 0.6 : 1;
      const chance = (contest ? 0.6 : n.kind === 'lord' ? 0.35 : 0.25) * boost;
      if (Math.random() > chance) continue;
      const team = this.spare(g, n.kind === 'lord' ? 3 : 2);
      if (team.length >= 2) {
        g.sendParty(me, n.id, team);
        return;
      }
    }

    // Лес: изредка один герой идёт на ближайший живой лагерь своей половины.
    if (Math.random() < (this.style === 'rush' ? 0.9 : this.level === 'hard' ? 0.75 : this.level === 'easy' ? 0.2 : 0.35)) {
      const h = this.spare(g, 1)[0];
      if (!h) return;
      const from = g.heroPos(h);
      const camps = g.neutrals.filter((n) => n.kind === 'camp' && n.alive && halfOf(n.x, n.y) === me);
      camps.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y));
      if (camps[0]) g.sendParty(me, camps[0].id, [h]);
    }
  }
}
