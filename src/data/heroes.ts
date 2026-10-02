// Герои. Каждый — неподвижная «вышка» с HP, маной, автоатакой и способностью.
// Прототипы взяты из Доты, имена, внешность и формулировки свои.
import type { RaceId } from './races';

export type SkillKind =
  | 'blast' // удар по самой плотной группе в радиусе действия
  | 'around' // удар вокруг себя
  | 'chain' // цепь от цели к цели
  | 'volley' // несколько целей сразу
  | 'drain' // урон всем в радиусе + лечение союзных героев линии
  | 'snipe' // одна самая живучая цель
  | 'wards' // призыв стражей
  | 'heal'; // лечение союзников + урон вокруг

/** Иконка навыка на кнопке. */
export type SkillIcon =
  | 'snowflake' | 'lightning' | 'axes' | 'arrows' | 'flame' | 'quake' | 'skull' | 'crosshair'
  | 'serpent' | 'potion' | 'firearrows' | 'claws' | 'storm' | 'paw' | 'cross' | 'horn' | 'boulder';

export interface SkillDef {
  name: string;
  kind: SkillKind;
  icon: SkillIcon;
  desc: string;
  mana: number;
  cd: number;
  power: number; // урон или лечение на 1 уровне
  perLvl: number; // прирост за уровень героя
  range?: number; // дальность применения (по умолчанию — дальность атаки)
  radius?: number;
  slow?: number; // множитель скорости, напр. 0.55
  slowT?: number;
  stun?: number;
  count?: number;
}

/** Внешность модели: из чего собирается фигурка героя. */
export interface Look {
  body: 'robe' | 'armor' | 'hood' | 'beast' | 'bones' | 'stone';
  weapon: 'staff' | 'orb' | 'axe' | 'bow' | 'rifle' | 'club' | 'scythe' | 'claws' | 'hammer' | 'banner' | 'fist' | 'totem';
  head: 'pointy' | 'crown' | 'horns' | 'hood' | 'cap' | 'mask' | 'mane' | 'flame' | 'skull' | 'helm' | 'none';
  skin: string;
  trim: string; // второй цвет: оружие, пояс, узор
}

export interface HeroDef {
  id: string;
  name: string;
  role: string;
  race: RaceId;
  proto: string; // на кого похож из Доты — подсказка для дизайна
  color: string;
  glyph: string;
  look: Look;
  price: number; // 0 — открыт с самого начала
  hp: number;
  mana: number;
  dmg: number;
  range: number;
  rate: number;
  skill: SkillDef;
}

export const HEROES: HeroDef[] = [
  // ---------- Стихии ----------
  {
    id: 'frost', name: 'Инеята', role: 'Маг холода', race: 'elemental', proto: 'Crystal Maiden', color: '#7cc8f0', glyph: 'И', price: 0,
    look: { body: 'robe', weapon: 'staff', head: 'pointy', skin: '#f2d7c4', trim: '#e9f6ff' },
    hp: 520, mana: 320, dmg: 22, range: 230, rate: 1.1,
    skill: { name: 'Ледяной вихрь', kind: 'blast', icon: 'snowflake', desc: 'Урон по группе и сильное замедление', mana: 90, cd: 9, power: 95, perLvl: 28, radius: 110, slow: 0.45, slowT: 3 },
  },
  {
    id: 'storm', name: 'Громобой', role: 'Повелитель молний', race: 'elemental', proto: 'Zeus', color: '#f4e07a', glyph: 'Г', price: 0,
    look: { body: 'robe', weapon: 'orb', head: 'crown', skin: '#e8c9a8', trim: '#ffffff' },
    hp: 480, mana: 300, dmg: 20, range: 250, rate: 1.05,
    skill: { name: 'Цепная молния', kind: 'chain', icon: 'lightning', desc: 'Бьёт до 5 крипов по цепочке', mana: 80, cd: 6, power: 80, perLvl: 22, count: 5 },
  },
  {
    id: 'fire', name: 'Пламена', role: 'Маг огня', race: 'elemental', proto: 'Lina', color: '#ff8a3d', glyph: 'П', price: 300,
    look: { body: 'robe', weapon: 'orb', head: 'flame', skin: '#f0c8a8', trim: '#ffd25a' },
    hp: 470, mana: 320, dmg: 26, range: 240, rate: 1.05,
    skill: { name: 'Огненный столп', kind: 'blast', icon: 'flame', desc: 'Огромный урон по группе', mana: 110, cd: 10, power: 150, perLvl: 40, radius: 120 },
  },
  {
    id: 'windy', name: 'Буревей', role: 'Дух бури', race: 'elemental', proto: 'Storm Spirit', color: '#6f9cff', glyph: 'Б', price: 500,
    look: { body: 'robe', weapon: 'orb', head: 'none', skin: '#9fc3ff', trim: '#dbe8ff' },
    hp: 500, mana: 300, dmg: 24, range: 220, rate: 1.0,
    skill: { name: 'Шаровая буря', kind: 'blast', icon: 'storm', desc: 'Вихрь по группе и оглушение', mana: 100, cd: 9, power: 110, perLvl: 30, radius: 115, stun: 1.2 },
  },
  // ---------- Нежить ----------
  {
    id: 'necro', name: 'Мор', role: 'Некромант', race: 'undead', proto: 'Necrophos', color: '#8fd36b', glyph: 'М', price: 0,
    look: { body: 'robe', weapon: 'scythe', head: 'hood', skin: '#a8c49a', trim: '#4a5a3a' },
    hp: 620, mana: 280, dmg: 22, range: 220, rate: 1.1,
    skill: { name: 'Волна тлена', kind: 'drain', icon: 'skull', desc: 'Урон всем в радиусе, лечит героев линии', mana: 90, cd: 9, power: 60, perLvl: 17 },
  },
  {
    id: 'healer', name: 'Знахарь', role: 'Целитель вуду', race: 'undead', proto: 'Witch Doctor', color: '#e58bd0', glyph: 'Ж', price: 300,
    look: { body: 'robe', weapon: 'staff', head: 'mask', skin: '#8a6a52', trim: '#e58bd0' },
    hp: 560, mana: 320, dmg: 21, range: 230, rate: 1.1,
    skill: { name: 'Целебный отвар', kind: 'heal', icon: 'potion', desc: 'Лечит героев линии и жжёт крипов рядом', mana: 110, cd: 12, power: 170, perLvl: 40, radius: 140 },
  },
  {
    id: 'bone', name: 'Костяной', role: 'Лучник-скелет', race: 'undead', proto: 'Clinkz', color: '#e8dcc0', glyph: 'К', price: 450,
    look: { body: 'bones', weapon: 'bow', head: 'skull', skin: '#e8dcc0', trim: '#ff7a3d' },
    hp: 440, mana: 240, dmg: 34, range: 290, rate: 0.95,
    skill: { name: 'Огненные стрелы', kind: 'volley', icon: 'firearrows', desc: 'Горящие стрелы в 5 целей', mana: 80, cd: 7, power: 85, perLvl: 24, count: 5 },
  },
  {
    id: 'ghoul', name: 'Вурдалак', role: 'Пожиратель', race: 'undead', proto: 'Lifestealer', color: '#c4625a', glyph: 'В', price: 450,
    look: { body: 'bones', weapon: 'claws', head: 'none', skin: '#b9a08a', trim: '#c4625a' },
    hp: 820, mana: 200, dmg: 34, range: 100, rate: 0.95,
    skill: { name: 'Рвущие когти', kind: 'around', icon: 'claws', desc: 'Серия ударов по всем рядом', mana: 70, cd: 7, power: 115, perLvl: 30, radius: 140 },
  },
  // ---------- Дикие ----------
  {
    id: 'archer', name: 'Сумеречная', role: 'Лучница', race: 'wild', proto: 'Drow Ranger', color: '#9fb7e8', glyph: 'С', price: 0,
    look: { body: 'hood', weapon: 'bow', head: 'hood', skin: '#b9c4e0', trim: '#5a6aa0' },
    hp: 450, mana: 240, dmg: 33, range: 300, rate: 1.0,
    skill: { name: 'Залп', kind: 'volley', icon: 'arrows', desc: 'Стрелы в 6 целей, лёгкое замедление', mana: 75, cd: 8, power: 70, perLvl: 20, count: 6, slow: 0.75, slowT: 2 },
  },
  {
    id: 'shaman', name: 'Змеевик', role: 'Шаман', race: 'wild', proto: 'Shadow Shaman', color: '#5fc9a8', glyph: 'З', price: 0,
    look: { body: 'beast', weapon: 'totem', head: 'mask', skin: '#6aa88a', trim: '#f3d27a' },
    hp: 500, mana: 300, dmg: 20, range: 220, rate: 1.1,
    skill: { name: 'Змеиные стражи', kind: 'wards', icon: 'serpent', desc: '3 стража стреляют 10 секунд', mana: 140, cd: 18, power: 18, perLvl: 5, count: 3 },
  },
  {
    id: 'bear', name: 'Медвежья Лапа', role: 'Берсерк', race: 'wild', proto: 'Ursa', color: '#a5703f', glyph: 'Л', price: 400,
    look: { body: 'beast', weapon: 'claws', head: 'mane', skin: '#7a5232', trim: '#e8dcc0' },
    hp: 880, mana: 200, dmg: 36, range: 110, rate: 1.0,
    skill: { name: 'Ярость зверя', kind: 'snipe', icon: 'paw', desc: 'Сокрушительный удар по самому крепкому', mana: 70, cd: 6, power: 240, perLvl: 60, range: 160 },
  },
  // ---------- Королевство ----------
  {
    id: 'sniper', name: 'Меткий Глаз', role: 'Стрелок', race: 'kingdom', proto: 'Sniper', color: '#c9b48a', glyph: 'Ё', price: 0,
    look: { body: 'armor', weapon: 'rifle', head: 'cap', skin: '#e0b896', trim: '#7a5a3a' },
    hp: 420, mana: 220, dmg: 38, range: 380, rate: 1.4,
    skill: { name: 'Выстрел в упор', kind: 'snipe', icon: 'crosshair', desc: 'Огромный урон по самому крепкому крипу', mana: 80, cd: 7, power: 280, perLvl: 70, range: 420 },
  },
  {
    id: 'paladin', name: 'Паладин', role: 'Светлый рыцарь', race: 'kingdom', proto: 'Omniknight', color: '#f6f0d0', glyph: 'Н', price: 350,
    look: { body: 'armor', weapon: 'hammer', head: 'helm', skin: '#e8c9a8', trim: '#f3d27a' },
    hp: 820, mana: 260, dmg: 28, range: 110, rate: 1.1,
    skill: { name: 'Свет исцеления', kind: 'heal', icon: 'cross', desc: 'Лечит героев линии, обжигает крипов', mana: 100, cd: 11, power: 190, perLvl: 45, radius: 160 },
  },
  {
    id: 'banner', name: 'Знаменосец', role: 'Полководец', race: 'kingdom', proto: 'Legion Commander', color: '#e05a4a', glyph: 'З', price: 350,
    look: { body: 'armor', weapon: 'banner', head: 'helm', skin: '#e0b896', trim: '#e05a4a' },
    hp: 760, mana: 240, dmg: 30, range: 120, rate: 1.0,
    skill: { name: 'Боевой клич', kind: 'around', icon: 'horn', desc: 'Удар и оглушение всех рядом', mana: 90, cd: 10, power: 80, perLvl: 22, radius: 165, stun: 1.3 },
  },
  // ---------- Горные ----------
  {
    id: 'axe', name: 'Рубака', role: 'Стойкий боец', race: 'mountain', proto: 'Axe', color: '#d9573e', glyph: 'Р', price: 0,
    look: { body: 'armor', weapon: 'axe', head: 'horns', skin: '#c46a4a', trim: '#9aa0a8' },
    hp: 950, mana: 200, dmg: 32, range: 105, rate: 1.0,
    skill: { name: 'Вихрь секир', kind: 'around', icon: 'axes', desc: 'Мощный удар по всем рядом', mana: 70, cd: 7, power: 120, perLvl: 32, radius: 150 },
  },
  {
    id: 'quake', name: 'Камнелом', role: 'Сотрясатель', race: 'mountain', proto: 'Earthshaker', color: '#b8925a', glyph: 'К', price: 0,
    look: { body: 'beast', weapon: 'club', head: 'horns', skin: '#8a6a4a', trim: '#d9c08a' },
    hp: 780, mana: 260, dmg: 28, range: 125, rate: 1.1,
    skill: { name: 'Раскол земли', kind: 'around', icon: 'quake', desc: 'Урон и оглушение всех рядом', mana: 100, cd: 11, power: 75, perLvl: 20, radius: 175, stun: 1.8 },
  },
  {
    id: 'golem', name: 'Каменный Страж', role: 'Живая скала', race: 'mountain', proto: 'Tiny', color: '#8a8f99', glyph: 'Т', price: 400,
    look: { body: 'stone', weapon: 'fist', head: 'none', skin: '#8a8f99', trim: '#6fd0c0' },
    hp: 1000, mana: 220, dmg: 34, range: 115, rate: 1.15,
    skill: { name: 'Обвал', kind: 'blast', icon: 'boulder', desc: 'Глыба по группе и оглушение', mana: 90, cd: 10, power: 105, perLvl: 28, radius: 120, stun: 1.5, range: 260 },
  },
];

export const heroById = (id: string): HeroDef => {
  const h = HEROES.find((x) => x.id === id);
  if (!h) throw new Error('Неизвестный герой ' + id);
  return h;
};

export const STARTER_IDS = HEROES.filter((h) => h.price === 0).map((h) => h.id);
