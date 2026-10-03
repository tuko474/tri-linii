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

/** Стикеры: цена (0 — бесплатный). Должно совпадать с STICKERS в src/render/art.ts. */
export const STICKER_PRICE = { hi: 0, gg: 0, lol: 0, wow: 150, angry: 150, cry: 150, thumb: 150, cool: 200, love: 200, sleep: 200, skull: 250, crown: 300 };

/** Цена звезды: STAR_COST[i] — переход на (i+1)★. */
export const STAR_COST = [100, 200, 350, 550, 800];
export const MAX_STARS = 5;

/** Кристаллы только за рейтинговые бои. */
export const REWARD = { win: 75, loss: 30 };
/** Матч короче этого (мс) кристаллов не даёт — против договорных сдач. */
export const MIN_REWARD_MS = Number(process.env.MIN_REWARD_MS ?? 3 * 60 * 1000);

// ---------- ежедневное ----------
/** Награда за вход по дням цепочки (7-й день — большая), потом цепочка идёт по кругу. Пропуск дня — заново с 1-го. */
export const LOGIN_REWARD = [20, 30, 40, 50, 60, 80, 150];
/** Сколько заданий в день. */
export const QUESTS_PER_DAY = 3;
/** Набор заданий. stat — что считаем после боя по сети (play/win — сам факт боя и победы). */
export const QUESTS = [
  { id: 'play', text: 'Сыграй 2 боя по сети', stat: 'play', need: 2, reward: 40 },
  { id: 'win', text: 'Победи в бою по сети', stat: 'win', need: 1, reward: 50 },
  { id: 'lords', text: 'Убей Лорда', stat: 'lords', need: 1, reward: 50 },
  { id: 'turtles', text: 'Убей 2 Черепахи', stat: 'turtles', need: 2, reward: 40 },
  { id: 'camps', text: 'Зачисти 6 лесных лагерей', stat: 'camps', need: 6, reward: 30 },
  { id: 'pushes', text: 'Продави 5 позиций врага', stat: 'pushes', need: 5, reward: 40 },
  { id: 'kills', text: 'Убей 150 крипов', stat: 'kills', need: 150, reward: 30 },
];
/** День по Москве (UTC+3): номер суток. */
export const dayNow = (now = Date.now()) => Math.floor((now + 3 * 3600 * 1000) / 86400000);
/** Сколько миллисекунд до следующего дня по Москве. */
export const msToNextDay = (now = Date.now()) => (dayNow(now) + 1) * 86400000 - (now + 3 * 3600 * 1000);
