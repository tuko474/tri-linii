// Экономика на сервере: цены и награды. Сервер — единственный, кто начисляет и тратит кристаллы.
// ВАЖНО: цены героев и звёзд должны совпадать с src/data/heroes.ts и BAL.stars в src/data/config.ts
// (проверка: node tools/check_economy.mjs).

/** Цена открытия героя (0 — открыт с начала). */
export const HERO_PRICE = {
  frost: 0,
  storm: 0,
  fire: 0,
  windy: 500,
  necro: 0,
  healer: 0,
  bone: 0,
  ghoul: 450,
  archer: 0,
  shaman: 0,
  bear: 0,
  sniper: 0,
  paladin: 0,
  banner: 0,
  axe: 0,
  quake: 0,
  golem: 0,
  lich: 400,
  tide: 450,
  wolf: 400,
  treant: 450,
  dragon: 450,
  alch: 400,
  centaur: 450,
  tusk: 400,
  phantom: 0,
  stalker: 0,
  weaver: 0,
  whisper: 450,
  soul: 500,
};

/** Цена звезды: STAR_COST[i] — переход на (i+1)★. */
export const STAR_COST = [100, 200, 350, 550, 800];
export const MAX_STARS = 5;

/** Кристаллы только за рейтинговые бои. */
export const REWARD = { win: 75, loss: 30 };
/** Матч короче этого (мс) кристаллов не даёт — против договорных сдач. */
export const MIN_REWARD_MS = Number(process.env.MIN_REWARD_MS ?? 3 * 60 * 1000);
