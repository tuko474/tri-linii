// Расы и их бонусы. Бонус включается при 2 и при 4 героях одной расы в команде.
// Сфера расы с Лорда добавляет +1 к счётчику расы, пока Лорд не возродится.

export type RaceId = 'undead' | 'elemental' | 'wild' | 'kingdom' | 'mountain' | 'shadow';

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
  critChance?: number; // шанс критической автоатаки
  critMul?: number; // множитель критического удара
  xpMul?: number; // множитель получаемого опыта
  // на всю команду
  allLifesteal?: number;
  allSpellMul?: number;
  allAtkMul?: number;
  allArmor?: number;
  allXpMul?: number;
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
  tiers: RaceTier[]; // второй уровень включает первый
}

export const RACES: Record<RaceId, RaceDef> = {
  undead: {
    id: 'undead', name: 'Нежить', color: '#8fd36b',
    tiers: [
      { n: 2, text: 'Нежить возрождается на 30% быстрее и лечится на 10% от урона', fx: { respawnMul: 0.7, lifesteal: 0.1 } },
      { n: 4, text: 'Возрождение вдвое быстрее, вампиризм 20%, вся команда лечится на 8% от урона', fx: { respawnMul: 0.5, lifesteal: 0.2, allLifesteal: 0.08 } },
    ],
  },
  elemental: {
    id: 'elemental', name: 'Стихии', color: '#7cc8f0',
    tiers: [
      { n: 2, text: 'Способности стихий: перезарядка −15%, сила +15%', fx: { cdMul: 0.85, spellMul: 1.15 } },
      { n: 4, text: 'Перезарядка −25%, сила +35%, способности всей команды +15%', fx: { cdMul: 0.75, spellMul: 1.35, allSpellMul: 1.15 } },
    ],
  },
  wild: {
    id: 'wild', name: 'Дикие', color: '#d9a74a',
    tiers: [
      { n: 2, text: 'Автоатаки диких +15% и на 10% быстрее', fx: { atkMul: 1.15, rateMul: 0.9 } },
      { n: 4, text: 'Атаки +35% и на 20% быстрее, автоатаки всей команды +12%', fx: { atkMul: 1.35, rateMul: 0.8, allAtkMul: 1.12 } },
    ],
  },
  kingdom: {
    id: 'kingdom', name: 'Королевство', color: '#f3d27a',
    tiers: [
      { n: 2, text: 'Золото за крипов +10%, твои крипы крепче и сильнее на 12%', fx: { goldMul: 1.1, creepMul: 1.12 } },
      { n: 4, text: 'Золото +20%, крипы +30%', fx: { goldMul: 1.2, creepMul: 1.3 } },
    ],
  },
  mountain: {
    id: 'mountain', name: 'Горные', color: '#b8925a',
    tiers: [
      { n: 2, text: 'HP горных +20%, получают на 10% меньше урона', fx: { hpMul: 1.2, armor: 0.1 } },
      { n: 4, text: 'HP +35%, урона −25%, вся команда получает на 12% меньше урона', fx: { hpMul: 1.35, armor: 0.25, allArmor: 0.12 } },
    ],
  },
  shadow: {
    id: 'shadow', name: 'Тени', color: '#9a7bd8',
    tiers: [
      { n: 2, text: 'Тени: 20% шанс крита ×2, опыт +15%', fx: { critChance: 0.2, critMul: 2, xpMul: 1.15 } },
      { n: 4, text: 'Крит 35% ×2,3, опыт +30%, вся команда получает опыт на 15% быстрее', fx: { critChance: 0.35, critMul: 2.3, xpMul: 1.3, allXpMul: 1.15 } },
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
