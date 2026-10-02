// Драфт: стороны по очереди выбирают героев из общего пула, повторов нет.
// Порядок как в турнирных MOBA: 1-2-2-2-2-1, чтобы первый пик не давал большого преимущества.
import { HEROES, heroById } from '../data/heroes';
import { RACES, tierIndex } from '../data/races';
import type { Side } from './types';

export const TEAM_SIZE = 5;
export const PICK_SECONDS = 25;

export interface DraftPick {
  side: Side;
  id: string;
}

export function draftOrder(first: Side): Side[] {
  const a = first;
  const b = (1 - first) as Side;
  return [a, b, b, a, a, b, b, a, a, b];
}

export class Draft {
  readonly order: Side[];
  picks: DraftPick[] = [];

  constructor(readonly first: Side) {
    this.order = draftOrder(first);
  }

  get done() {
    return this.picks.length >= this.order.length;
  }

  /** Чей сейчас ход (null — драфт закончен). */
  turn(): Side | null {
    return this.done ? null : this.order[this.picks.length];
  }

  taken(id: string) {
    return this.picks.some((p) => p.id === id);
  }

  team(side: Side): string[] {
    return this.picks.filter((p) => p.side === side).map((p) => p.id);
  }

  pick(side: Side, id: string): boolean {
    if (this.turn() !== side || this.taken(id) || !HEROES.some((h) => h.id === id)) return false;
    this.picks.push({ side, id });
    return true;
  }
}

/** Случайный доступный герой из разрешённых (для пика по таймеру). */
export function randomPick(d: Draft, allowed: Iterable<string>): string | null {
  const free = [...allowed].filter((id) => !d.taken(id));
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}

/**
 * Выбор бота: собирает бонусы своих рас и иногда забирает героя расы,
 * которую копит соперник (чтобы тот не добрал бонус).
 */
export function botDraftPick(d: Draft, side: Side): string {
  const mine = d.team(side).map((id) => heroById(id).race);
  const theirs = d.team((1 - side) as Side).map((id) => heroById(id).race);
  const count = (list: string[], r: string) => list.filter((x) => x === r).length;
  let best = '';
  let bestScore = -Infinity;
  for (const h of HEROES) {
    if (d.taken(h.id)) continue;
    const have = count(mine, h.race);
    const next = tierIndex(h.race, have + 1);
    const now = tierIndex(h.race, have);
    let score = Math.random() * 1.2;
    score += have * 1.2; // держимся своих рас
    if (next > now) score += 2.2; // этот пик включает новый уровень бонуса
    const foe = count(theirs, h.race);
    if (foe >= 2 && tierIndex(h.race, foe + 1) > tierIndex(h.race, foe)) score += 1.6; // отбираем у соперника
    if (h.hp >= 750 && !mine.some((r) => r === 'mountain') && mine.length >= 2) score += 0.5; // нужен кто-то крепкий
    if (score > bestScore) { bestScore = score; best = h.id; }
  }
  return best;
}

/** Расстановка бота: крепкие в центр и на линии, где больше героев, 2-1-2. */
export function botPlacement(ids: string[]): { heroId: string; lane: number }[] {
  const sorted = [...ids].sort((a, b) => heroById(b).hp - heroById(a).hp);
  const lanes = [1, 0, 2, 0, 2];
  return sorted.map((id, i) => ({ heroId: id, lane: lanes[i] }));
}

export const raceName = (id: string) => RACES[heroById(id).race].name;
