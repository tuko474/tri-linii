// Баланс игры. Все числа в одном месте, чтобы крутить их без поиска по коду.

export const WORLD = { W: 1000, H: 1800 };

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
  throneHp: 3000,
  heroRespawn: 12, // сек, если на линии жив хотя бы один союзный герой
  pushRespawn: 3, // сек после отката линии
  heroRegen: 0.006, // доля HP в секунду
  waveEvery: 22,
  firstWave: 3,
  siegeEvery: 4, // каждая N-я волна с катапультой

  // Позиции вышек вдоль линии (доля длины от трона игрока).
  // 0..2 — сторона игрока, 3..5 — сторона противника.
  slotT: [0.18, 0.29, 0.4, 0.6, 0.71, 0.82],
  throneGuardT: [0.09, 0.91], // куда отходят герои, когда все вышки линии потеряны
  throneT: [0.035, 0.965],

  creep: {
    melee: { hp: 300, dmg: 19, range: 40, rate: 1.0, speed: 72, gold: 12, r: 12 },
    ranged: { hp: 200, dmg: 24, range: 165, rate: 1.25, speed: 72, gold: 16, r: 10 },
    siege: { hp: 650, dmg: 70, range: 270, rate: 2.6, speed: 52, gold: 40, r: 16 },
  } as Record<CreepKind, CreepStats>,

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
