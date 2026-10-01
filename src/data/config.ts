// Баланс игры. Все числа в одном месте, чтобы крутить их без поиска по коду.

export const WORLD = { W: 2400, H: 2400 };

export type CreepKind = 'melee' | 'ranged' | 'siege';

export interface CreepStats {
  hp: number;
  dmg: number;
  range: number;
  rate: number; // секунд между ударами
  speed: number; // единиц мира в секунду
  gold: number; // награда за убийство
  r: number; // радиус для отрисовки
}

export const BAL = {
  startGold: 250,
  passiveGold: 3, // золота в секунду
  throneHp: 2500,
  heroRespawn: 12, // сек, если на линии жив хотя бы один союзный герой
  pushRespawn: 3, // сек после отката линии
  heroRegen: 0.006, // доля HP в секунду
  waveEvery: 20,
  firstWave: 3,
  siegeEvery: 4, // каждая N-я волна с катапультой

  // Позиции вышек вдоль линии (доля длины от трона игрока).
  // 0..2 — сторона игрока, 3..5 — сторона противника.
  slotT: [0.2, 0.32, 0.44, 0.56, 0.68, 0.8],

  creep: {
    melee: { hp: 300, dmg: 19, range: 40, rate: 1.0, speed: 110, gold: 12, r: 12 },
    ranged: { hp: 200, dmg: 24, range: 165, rate: 1.25, speed: 110, gold: 16, r: 10 },
    siege: { hp: 650, dmg: 70, range: 270, rate: 2.6, speed: 80, gold: 40, r: 16 },
  } as Record<CreepKind, CreepStats>,

  lateGameFrom: 600, // с 10-й минуты крипы усиливаются сами, чтобы бой не тянулся вечно
  lateGamePerMin: 0.12, // +12% HP и урона за каждую минуту после этого
  creepLvlMul: 0.2, // +20% HP и урона за уровень волны
  creepMaxLvl: 12,
  creepUpCost: (lvl: number) => 110 + 65 * lvl,

  heroMaxLvl: 15,
  heroUpCost: (lvl: number) => 80 + 45 * lvl,
  heroHpPerLvl: 0.1,
  heroDmgPerLvl: 0.09,
  heroManaPerLvl: 0.05,

  difficulty: {
    easy: { label: 'Лёгкий', botIncome: 0.8 },
    normal: { label: 'Обычный', botIncome: 1.0 },
    hard: { label: 'Сложный', botIncome: 1.2 },
  },
};

export type Difficulty = keyof typeof BAL.difficulty;
