// Баланс игры. Все числа в одном месте, чтобы крутить их без поиска по коду.

export const WORLD = { W: 4200, H: 2400 };

export type CreepKind = 'melee' | 'ranged' | 'siege' | 'lord';

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
  throneHp: 3600,
  heroRespawn: 12, // сек, если на линии жив хотя бы один союзный герой
  pushRespawn: 3, // сек после отката линии
  heroRegen: 0.006, // доля HP в секунду
  waveEvery: 20,
  firstWave: 3,
  siegeEvery: 4, // каждая N-я волна с катапультой

  // Позиции вышек вдоль линии (доля длины от трона игрока).
  // 0..2 — сторона игрока, 3..5 — сторона противника.
  slotT: [0.2, 0.32, 0.44, 0.56, 0.68, 0.8],
  // Чем глубже позиция в своей половине, тем меньше урона получают её герои (как вышки у базы).
  // Индекс: 0 — передняя, 1 — средняя, 2 — у базы, 3 — у трона.
  depthArmor: [0, 0.2, 0.35, 0.5],

  creep: {
    melee: { hp: 300, dmg: 19, range: 40, rate: 1.0, speed: 80, gold: 12, r: 12 },
    ranged: { hp: 200, dmg: 24, range: 165, rate: 1.25, speed: 80, gold: 16, r: 10 },
    siege: { hp: 650, dmg: 70, range: 270, rate: 2.6, speed: 62, gold: 40, r: 16 },
    // Лорд, перешедший на сторону победителя: идёт по линии как огромный крип
    lord: { hp: 2600, dmg: 85, range: 70, rate: 1.3, speed: 65, gold: 150, r: 34 },
  } as Record<CreepKind, CreepStats>,

  lateGameFrom: 1200, // с 20-й минуты крипы усиливаются сами, чтобы бой не тянулся вечно
  lateGamePerMin: 0.2, // +20% HP и урона за каждую минуту после этого
  creepLvlMul: 0.2, // +20% HP и урона за уровень волны
  creepMaxLvl: 12,
  creepUpCost: (lvl: number) => 110 + 65 * lvl,

  // Нейтралы. first — когда появляется впервые (сек), respawn — через сколько после смерти.
  neutral: {
    lord: { name: 'Лорд', hp: 3200, hpPerMin: 260, dmg: 55, rate: 1.4, first: 180, respawn: 180, r: 64 },
    turtle: { name: 'Черепаха', hp: 1700, hpPerMin: 140, dmg: 32, rate: 1.3, first: 75, respawn: 120, r: 54, gold: 320 },
    camp: { name: 'Лесные', hp: 520, hpPerMin: 45, dmg: 14, rate: 1.2, first: 25, respawn: 60, r: 24, gold: 70 },
  },
  tripSpeed: 320, // скорость героя в походе
  neutralRegen: 0.08, // доля HP в секунду, когда рядом никого
  tripReach: 230, // с какого расстояния герои в походе бьют цель

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
