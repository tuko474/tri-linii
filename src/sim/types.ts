import type { CreepKind } from '../data/config';
import type { HeroDef } from '../data/heroes';

export type Side = 0 | 1;

export interface Hero {
  uid: number;
  def: HeroDef;
  side: Side;
  lane: number;
  lvl: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  dmg: number;
  cd: number; // перезарядка способности
  atkCd: number;
  dead: boolean;
  respawn: number;
  off: number; // боковое смещение на позиции
  s: number; // позиция вдоль линии
  flash: number;
  casts: number;
  trip: Trip | null; // поход к боссу или в лес; null — герой стоит на линии
}

export interface Trip {
  nid: number; // индекс нейтрала
  phase: 'go' | 'fight' | 'back';
  x: number;
  y: number;
  idx: number; // место в отряде
}

export type NeutralKind = 'lord' | 'turtle' | 'camp' | 'guard';

export interface Neutral {
  id: number;
  kind: NeutralKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  dmg: number;
  alive: boolean;
  respawnT: number;
  atkCd: number;
  hits: number;
  flash: number;
  owner: Side | null; // для стража: кто его захватил
  pit?: number; // для стража: какое логово он охраняет
  guard?: number; // для логова: id его стража
}

export interface Creep {
  uid: number;
  kind: CreepKind;
  side: Side;
  lane: number;
  s: number;
  off: number;
  hp: number;
  maxHp: number;
  dmg: number;
  range: number;
  rate: number;
  speed: number;
  atkCd: number;
  slowT: number;
  slowMul: number;
  stunT: number;
  gold: number;
  r: number;
  dead: boolean;
}

export interface Ward {
  side: Side;
  lane: number;
  s: number;
  off: number;
  ttl: number;
  dmg: number;
  range: number;
  atkCd: number;
}

export type Target = { kind: 'creep'; c: Creep } | { kind: 'hero'; h: Hero } | { kind: 'throne'; side: Side };

export interface Proj {
  x: number;
  y: number;
  src?: Hero; // кто выпустил (для вампиризма)
  target: Target;
  dmg: number;
  speed: number;
  color: string;
  size: number;
}

export interface Fx {
  kind: 'ring' | 'bolt' | 'text' | 'beam' | 'heal';
  x: number;
  y: number;
  x2?: number;
  y2?: number;
  r?: number;
  color: string;
  text?: string;
  t: number;
  life: number;
  to?: Side; // показывать только этой стороне (например, «+золото»)
}

export interface GameEvent {
  text: string;
  to: Side | null; // кому показать; null — обоим
  tone: 'good' | 'bad' | 'info';
}

export interface Sfx {
  name: string;
  to: Side | null; // кому проиграть; null — обоим
}

export interface Pick {
  heroId: string;
  lane: number;
}
