// Расы и их бонусы. Бонус включается, когда в команде набирается 2, 3, 4 или 5 героев одной расы.
// Сфера расы с Лорда добавляет +1 к счётчику расы, как будто в команде на одного героя больше.

export type RaceId = 'undead' | 'elemental' | 'wild' | 'kingdom' | 'mountain';

/** Модификаторы. Поля без префикса all* действуют только на героев этой расы. */
export interface RaceFx {
  hpMul?: number; // множитель HP
  atkMul?: number; // урон автоатак
  rateMul?: number; // интервал между атаками (меньше — быстрее)
  cdMul?: number; // перезарядка способностей
  spellMul?: number; // сила способностей
  lifesteal?: number; // доля нанесённого урона, возвращаемая здоровьем
  respawnMul?: number; // время возрождения
  armor?: number; // доля поглощаемого урона
  // на всю команду
  allLifesteal?: number;
  allSpellMul?: number;
  allAtkMul?: number;
  allArmor?: number;
  goldMul?: number; // золото за крипов
  creepMul?: number; // HP и урон своих крипов
}

export interface RaceTier {
  n: number;
  text: string;
  fx: RaceFx;
}

export interface RaceDef {
  id: RaceId;
  name: string;
  color: string;
  tiers: RaceTier[]; // каждый следующий уровень включает предыдущие
}

export const RACES: Record<RaceId, RaceDef> = {
  undead: {
    id: 'undead', name: 'Нежить', color: '#8fd36b',
    tiers: [
      { n: 2, text: 'Нежить возрождается на 30% быстрее', fx: { respawnMul: 0.7 } },
      { n: 3, text: 'Нежить лечится на 12% от нанесённого урона', fx: { respawnMul: 0.7, lifesteal: 0.12 } },
      { n: 4, text: 'Возрождение вдвое быстрее, вампиризм 20%', fx: { respawnMul: 0.5, lifesteal: 0.2 } },
      { n: 5, text: 'Вся команда лечится на 10% от урона', fx: { respawnMul: 0.5, lifesteal: 0.2, allLifesteal: 0.1 } },
    ],
  },
  elemental: {
    id: 'elemental', name: 'Стихии', color: '#7cc8f0',
    tiers: [
      { n: 2, text: 'Способности стихий перезаряжаются на 15% быстрее', fx: { cdMul: 0.85 } },
      { n: 3, text: 'Способности стихий сильнее на 20%', fx: { cdMul: 0.85, spellMul: 1.2 } },
      { n: 4, text: 'Перезарядка −25%, сила способностей +35%', fx: { cdMul: 0.75, spellMul: 1.35 } },
      { n: 5, text: 'Способности всей команды сильнее на 20%', fx: { cdMul: 0.75, spellMul: 1.35, allSpellMul: 1.2 } },
    ],
  },
  wild: {
    id: 'wild', name: 'Дикие', color: '#d9a74a',
    tiers: [
      { n: 2, text: 'Автоатаки диких сильнее на 15%', fx: { atkMul: 1.15 } },
      { n: 3, text: 'Атаки +25% и на 15% быстрее', fx: { atkMul: 1.25, rateMul: 0.87 } },
      { n: 4, text: 'Атаки +40% и на 25% быстрее', fx: { atkMul: 1.4, rateMul: 0.8 } },
      { n: 5, text: 'Автоатаки всей команды +15%', fx: { atkMul: 1.4, rateMul: 0.8, allAtkMul: 1.15 } },
    ],
  },
  kingdom: {
    id: 'kingdom', name: 'Королевство', color: '#f3d27a',
    tiers: [
      { n: 2, text: 'Золото за крипов +10%', fx: { goldMul: 1.1 } },
      { n: 3, text: 'Твои крипы на 15% крепче и сильнее', fx: { goldMul: 1.1, creepMul: 1.15 } },
      { n: 4, text: 'Золото +20%, крипы +25%', fx: { goldMul: 1.2, creepMul: 1.25 } },
      { n: 5, text: 'Крипы +40%', fx: { goldMul: 1.2, creepMul: 1.4 } },
    ],
  },
  mountain: {
    id: 'mountain', name: 'Горные', color: '#b8925a',
    tiers: [
      { n: 2, text: 'HP горных героев +20%', fx: { hpMul: 1.2 } },
      { n: 3, text: 'Горные получают на 15% меньше урона', fx: { hpMul: 1.2, armor: 0.15 } },
      { n: 4, text: 'HP +35%, урона −25%', fx: { hpMul: 1.35, armor: 0.25 } },
      { n: 5, text: 'Вся команда получает на 15% меньше урона', fx: { hpMul: 1.35, armor: 0.25, allArmor: 0.15 } },
    ],
  },
};

export const RACE_IDS = Object.keys(RACES) as RaceId[];

/** Активный уровень расы при данном количестве: -1 — бонуса нет. */
export function tierIndex(race: RaceId, count: number): number {
  const t = RACES[race].tiers;
  let i = -1;
  while (i + 1 < t.length && count >= t[i + 1].n) i++;
  return i;
}
