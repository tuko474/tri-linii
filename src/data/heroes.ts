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
  | 'serpent' | 'potion' | 'firearrows' | 'claws' | 'storm' | 'paw' | 'cross' | 'horn' | 'boulder'
  | 'wave' | 'leaf' | 'fist' | 'dagger' | 'moon' | 'web' | 'eye' | 'howl'
  // иконки вторых способностей (6 окт 2026) — у каждого героя вторая отличается от первой
  | 'aura' | 'cloud' | 'meteor' | 'tornado' | 'scythe' | 'hex' | 'fangs' | 'icearrow' | 'spiral' | 'burst'
  | 'shield' | 'swords' | 'spin' | 'rings' | 'rocks' | 'crystal' | 'tentacle' | 'sprout' | 'acid' | 'ghost'
  | 'spider' | 'mask' | 'souls';

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
  /** Вторая способность: открывается на 5★, срабатывает сама, без маны. */
  skill2: SkillDef;
}

const HERO_LIST: Omit<HeroDef, 'skill2'>[] = [
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
    id: 'fire', name: 'Пламена', role: 'Маг огня', race: 'elemental', proto: 'Lina', color: '#ff8a3d', glyph: 'П', price: 0,
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
    id: 'healer', name: 'Знахарь', role: 'Целитель вуду', race: 'undead', proto: 'Witch Doctor', color: '#e58bd0', glyph: 'Ж', price: 0,
    look: { body: 'robe', weapon: 'staff', head: 'mask', skin: '#8a6a52', trim: '#e58bd0' },
    hp: 560, mana: 320, dmg: 21, range: 230, rate: 1.1,
    skill: { name: 'Целебный отвар', kind: 'heal', icon: 'potion', desc: 'Лечит героев линии и жжёт крипов рядом', mana: 110, cd: 12, power: 170, perLvl: 40, radius: 140 },
  },
  {
    id: 'bone', name: 'Костяной', role: 'Лучник-скелет', race: 'undead', proto: 'Clinkz', color: '#e8dcc0', glyph: 'К', price: 0,
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
    id: 'bear', name: 'Медвежья Лапа', role: 'Берсерк', race: 'wild', proto: 'Ursa', color: '#a5703f', glyph: 'Л', price: 0,
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
    id: 'paladin', name: 'Паладин', role: 'Светлый рыцарь', race: 'kingdom', proto: 'Omniknight', color: '#f6f0d0', glyph: 'Н', price: 0,
    look: { body: 'armor', weapon: 'hammer', head: 'helm', skin: '#e8c9a8', trim: '#f3d27a' },
    hp: 820, mana: 260, dmg: 28, range: 110, rate: 1.1,
    skill: { name: 'Свет исцеления', kind: 'heal', icon: 'cross', desc: 'Лечит героев линии, обжигает крипов', mana: 100, cd: 11, power: 190, perLvl: 45, radius: 160 },
  },
  {
    id: 'banner', name: 'Знаменосец', role: 'Полководец', race: 'kingdom', proto: 'Legion Commander', color: '#e05a4a', glyph: 'З', price: 0,
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
    id: 'golem', name: 'Каменный Страж', role: 'Живая скала', race: 'mountain', proto: 'Tiny', color: '#8a8f99', glyph: 'Т', price: 0,
    look: { body: 'stone', weapon: 'fist', head: 'none', skin: '#8a8f99', trim: '#6fd0c0' },
    hp: 1000, mana: 220, dmg: 34, range: 115, rate: 1.15,
    skill: { name: 'Обвал', kind: 'blast', icon: 'boulder', desc: 'Глыба по группе и оглушение', mana: 90, cd: 10, power: 105, perLvl: 28, radius: 120, stun: 1.5, range: 260 },
  },

  // ---------- новые герои ----------
  {
    id: 'lich', name: 'Хладный Лич', role: 'Повелитель стужи', race: 'undead', proto: 'Lich', color: '#9fd8e8', glyph: 'Х', price: 400,
    look: { body: 'robe', weapon: 'staff', head: 'skull', skin: '#cfe6ee', trim: '#7fd0ff' },
    hp: 480, mana: 320, dmg: 22, range: 240, rate: 1.1,
    skill: { name: 'Цепь стужи', kind: 'chain', icon: 'snowflake', desc: 'Ледяной шар скачет по 6 крипам', mana: 90, cd: 8, power: 70, perLvl: 20, count: 6 },
  },
  {
    id: 'tide', name: 'Волнолом', role: 'Морской исполин', race: 'elemental', proto: 'Tidehunter', color: '#4fb3d9', glyph: 'В', price: 450,
    look: { body: 'beast', weapon: 'fist', head: 'none', skin: '#4f9fc9', trim: '#bff0ff' },
    hp: 780, mana: 260, dmg: 30, range: 120, rate: 1.1,
    skill: { name: 'Приливная волна', kind: 'around', icon: 'wave', desc: 'Волна бьёт и замедляет всех рядом', mana: 90, cd: 9, power: 90, perLvl: 24, radius: 170, slow: 0.5, slowT: 2.5 },
  },
  {
    id: 'wolf', name: 'Вожак Стаи', role: 'Оборотень', race: 'wild', proto: 'Lycan', color: '#8a8f9e', glyph: 'О', price: 400,
    look: { body: 'beast', weapon: 'claws', head: 'mane', skin: '#6b6f7e', trim: '#e8e8f0' },
    hp: 820, mana: 220, dmg: 34, range: 110, rate: 0.95,
    skill: { name: 'Волчья стая', kind: 'wards', icon: 'howl', desc: '3 волка грызут крипов 10 секунд', mana: 120, cd: 16, power: 24, perLvl: 7, count: 3 },
  },
  {
    id: 'treant', name: 'Древень', role: 'Хранитель леса', race: 'wild', proto: 'Treant Protector', color: '#6fae4f', glyph: 'Д', price: 450,
    look: { body: 'stone', weapon: 'club', head: 'none', skin: '#6b4a2a', trim: '#8fd36b' },
    hp: 940, mana: 260, dmg: 28, range: 115, rate: 1.2,
    skill: { name: 'Живая роща', kind: 'heal', icon: 'leaf', desc: 'Лечит героев линии, корни ранят крипов рядом', mana: 100, cd: 11, power: 180, perLvl: 42, radius: 150 },
  },
  {
    id: 'dragon', name: 'Драконий Рыцарь', role: 'Рыцарь-дракон', race: 'kingdom', proto: 'Dragon Knight', color: '#d9733e', glyph: 'Р', price: 450,
    look: { body: 'armor', weapon: 'axe', head: 'helm', skin: '#e0b896', trim: '#ff8a3d' },
    hp: 860, mana: 220, dmg: 32, range: 115, rate: 1.05,
    skill: { name: 'Дыхание дракона', kind: 'blast', icon: 'flame', desc: 'Пламя по группе крипов перед собой', mana: 90, cd: 9, power: 110, perLvl: 30, radius: 130, range: 280 },
  },
  {
    id: 'alch', name: 'Алхимик', role: 'Варщик зелий', race: 'kingdom', proto: 'Alchemist', color: '#b7d44a', glyph: 'А', price: 400,
    look: { body: 'armor', weapon: 'orb', head: 'cap', skin: '#c48a5a', trim: '#b7d44a' },
    hp: 700, mana: 260, dmg: 28, range: 170, rate: 1.05,
    skill: { name: 'Кислотный туман', kind: 'drain', icon: 'potion', desc: 'Кислота жжёт всех рядом, герои линии лечатся', mana: 90, cd: 9, power: 55, perLvl: 16 },
  },
  {
    id: 'centaur', name: 'Кентавр', role: 'Воитель степей', race: 'mountain', proto: 'Centaur Warrunner', color: '#a0522d', glyph: 'К', price: 450,
    look: { body: 'beast', weapon: 'axe', head: 'horns', skin: '#8a5a3a', trim: '#d9c08a' },
    hp: 1000, mana: 220, dmg: 33, range: 110, rate: 1.1,
    skill: { name: 'Топот копыт', kind: 'around', icon: 'quake', desc: 'Удар и оглушение всех рядом', mana: 90, cd: 10, power: 85, perLvl: 22, radius: 160, stun: 1.5 },
  },
  {
    id: 'tusk', name: 'Ледяной Клык', role: 'Северный кулачник', race: 'mountain', proto: 'Tusk', color: '#9ec9e8', glyph: 'Л', price: 400,
    look: { body: 'beast', weapon: 'fist', head: 'mane', skin: '#c9d8e8', trim: '#ffffff' },
    hp: 820, mana: 240, dmg: 34, range: 110, rate: 1.0,
    skill: { name: 'Моржовый удар', kind: 'snipe', icon: 'fist', desc: 'Сокрушительный удар по самому крепкому', mana: 75, cd: 7, power: 250, perLvl: 62, range: 170 },
  },
  // ---------- Тени ----------
  {
    id: 'phantom', name: 'Фантомная', role: 'Убийца', race: 'shadow', proto: 'Phantom Assassin', color: '#7d6ad9', glyph: 'Ф', price: 0,
    look: { body: 'hood', weapon: 'claws', head: 'mask', skin: '#c9c2e8', trim: '#7d6ad9' },
    hp: 540, mana: 220, dmg: 38, range: 110, rate: 0.85,
    skill: { name: 'Смертельный удар', kind: 'snipe', icon: 'dagger', desc: 'Клинок в самую крепкую цель', mana: 70, cd: 6, power: 220, perLvl: 60, range: 220 },
  },
  {
    id: 'stalker', name: 'Ночной Охотник', role: 'Тварь ночи', race: 'shadow', proto: 'Night Stalker', color: '#3a3f6b', glyph: 'Н', price: 0,
    look: { body: 'beast', weapon: 'claws', head: 'horns', skin: '#4a4f7a', trim: '#c9c2e8' },
    hp: 880, mana: 220, dmg: 34, range: 110, rate: 1.0,
    skill: { name: 'Полночь', kind: 'around', icon: 'moon', desc: 'Удар тьмой и замедление всех рядом', mana: 90, cd: 9, power: 100, perLvl: 28, radius: 160, slow: 0.6, slowT: 2 },
  },
  {
    id: 'weaver', name: 'Ткачиха', role: 'Паучья мать', race: 'shadow', proto: 'Broodmother', color: '#a64f8f', glyph: 'Т', price: 0,
    look: { body: 'beast', weapon: 'claws', head: 'none', skin: '#5a2f4f', trim: '#e58bd0' },
    hp: 580, mana: 300, dmg: 24, range: 220, rate: 1.05,
    skill: { name: 'Паучий выводок', kind: 'wards', icon: 'spider', desc: '3 паука атакуют 10 секунд', mana: 130, cd: 17, power: 20, perLvl: 6, count: 3 },
  },
  {
    id: 'whisper', name: 'Шёпот', role: 'Метатель клинков', race: 'shadow', proto: 'Riki', color: '#5f6ab0', glyph: 'Ш', price: 450,
    look: { body: 'hood', weapon: 'claws', head: 'hood', skin: '#9aa0d0', trim: '#c9c2e8' },
    hp: 480, mana: 240, dmg: 32, range: 260, rate: 0.95,
    skill: { name: 'Веер клинков', kind: 'volley', icon: 'dagger', desc: 'Клинки в 5 целей', mana: 75, cd: 7, power: 75, perLvl: 21, count: 5 },
  },
  {
    id: 'soul', name: 'Пожиратель Душ', role: 'Демон теней', race: 'shadow', proto: 'Shadow Fiend', color: '#c4344a', glyph: 'П', price: 500,
    look: { body: 'robe', weapon: 'orb', head: 'horns', skin: '#3a1a22', trim: '#ff6a6a' },
    hp: 480, mana: 300, dmg: 30, range: 250, rate: 1.0,
    skill: { name: 'Реквием душ', kind: 'blast', icon: 'eye', desc: 'Огромный урон тьмой по группе', mana: 110, cd: 10, power: 160, perLvl: 42, radius: 125 },
  },
];

type S2 = Omit<SkillDef, 'mana'>;
/** Вторые способности (5★). Срабатывают автоматически по перезарядке, маны не тратят. */
const SKILL2: Record<string, S2> = {
  frost: { name: 'Морозная аура', kind: 'around', icon: 'aura', desc: 'Холод вокруг: урон и замедление всех рядом', cd: 14, power: 50, perLvl: 14, radius: 160, slow: 0.6, slowT: 2 },
  storm: { name: 'Гроза', kind: 'volley', icon: 'cloud', desc: 'Молнии бьют 4 цели', cd: 15, power: 70, perLvl: 20, count: 4 },
  fire: { name: 'Огненный шквал', kind: 'chain', icon: 'meteor', desc: 'Огонь перескакивает по 4 крипам', cd: 15, power: 75, perLvl: 20, count: 4 },
  windy: { name: 'Порыв ветра', kind: 'snipe', icon: 'tornado', desc: 'Вихрь в самого крепкого крипа', cd: 14, power: 180, perLvl: 45, range: 320 },
  necro: { name: 'Жатва', kind: 'snipe', icon: 'scythe', desc: 'Коса по самому крепкому крипу', cd: 16, power: 200, perLvl: 50 },
  healer: { name: 'Проклятие вуду', kind: 'blast', icon: 'hex', desc: 'Урон по группе и замедление', cd: 15, power: 80, perLvl: 22, radius: 110, slow: 0.6, slowT: 2 },
  bone: { name: 'Костяной град', kind: 'volley', icon: 'arrows', desc: 'Стрелы в 4 цели', cd: 13, power: 60, perLvl: 17, count: 4 },
  ghoul: { name: 'Пир', kind: 'drain', icon: 'fangs', desc: 'Рвёт всех рядом, герои линии лечатся', cd: 15, power: 45, perLvl: 13 },
  archer: { name: 'Ледяная стрела', kind: 'snipe', icon: 'icearrow', desc: 'Меткий выстрел в самого крепкого', cd: 14, power: 170, perLvl: 42, range: 400 },
  shaman: { name: 'Сглаз', kind: 'blast', icon: 'spiral', desc: 'Оглушает группу крипов', cd: 16, power: 60, perLvl: 16, radius: 100, stun: 1.2 },
  bear: { name: 'Неистовство', kind: 'around', icon: 'claws', desc: 'Шквал ударов по всем рядом', cd: 13, power: 90, perLvl: 24, radius: 140 },
  sniper: { name: 'Шрапнель', kind: 'blast', icon: 'burst', desc: 'Дробь по группе и замедление', cd: 14, power: 70, perLvl: 19, radius: 120, slow: 0.7, slowT: 2 },
  paladin: { name: 'Защита веры', kind: 'heal', icon: 'shield', desc: 'Лечит героев линии', cd: 18, power: 130, perLvl: 30, radius: 140 },
  banner: { name: 'Ополчение', kind: 'wards', icon: 'swords', desc: '2 воина сражаются 10 секунд', cd: 20, power: 18, perLvl: 5, count: 2 },
  axe: { name: 'Встречный вихрь', kind: 'around', icon: 'spin', desc: 'Секира бьёт всех рядом', cd: 11, power: 60, perLvl: 16, radius: 140 },
  quake: { name: 'Эхо удара', kind: 'around', icon: 'rings', desc: 'Ударная волна по всем рядом', cd: 16, power: 70, perLvl: 19, radius: 190 },
  golem: { name: 'Бросок', kind: 'blast', icon: 'rocks', desc: 'Швыряет камень в группу', cd: 15, power: 110, perLvl: 28, radius: 110, range: 260 },
  lich: { name: 'Ледяной взрыв', kind: 'blast', icon: 'crystal', desc: 'Взрыв льда по группе и замедление', cd: 15, power: 85, perLvl: 23, radius: 120, slow: 0.5, slowT: 2 },
  tide: { name: 'Щупальца', kind: 'around', icon: 'tentacle', desc: 'Оглушает всех рядом', cd: 18, power: 60, perLvl: 17, radius: 180, stun: 1.2 },
  wolf: { name: 'Вой', kind: 'around', icon: 'fangs', desc: 'Вой рвёт всех рядом', cd: 13, power: 70, perLvl: 19, radius: 150 },
  treant: { name: 'Листва', kind: 'heal', icon: 'sprout', desc: 'Лечит героев линии', cd: 16, power: 120, perLvl: 28, radius: 140 },
  dragon: { name: 'Удар хвостом', kind: 'snipe', icon: 'fist', desc: 'Тяжёлый удар по самому крепкому', cd: 13, power: 160, perLvl: 40, range: 180 },
  alch: { name: 'Кислотный взрыв', kind: 'blast', icon: 'acid', desc: 'Взрыв по группе и оглушение', cd: 15, power: 80, perLvl: 21, radius: 120, stun: 1 },
  centaur: { name: 'Возмездие', kind: 'around', icon: 'shield', desc: 'Отдача бьёт всех рядом', cd: 13, power: 75, perLvl: 20, radius: 150 },
  tusk: { name: 'Снежок', kind: 'blast', icon: 'snowflake', desc: 'Снежный ком по группе и оглушение', cd: 15, power: 90, perLvl: 24, radius: 110, stun: 1, range: 300 },
  phantom: { name: 'Кинжал', kind: 'snipe', icon: 'crosshair', desc: 'Бросок кинжала в самого крепкого', cd: 12, power: 190, perLvl: 48, range: 300 },
  stalker: { name: 'Ночной ужас', kind: 'around', icon: 'ghost', desc: 'Страх: урон и замедление всех рядом', cd: 14, power: 65, perLvl: 18, radius: 150, slow: 0.6, slowT: 2 },
  weaver: { name: 'Паутина', kind: 'blast', icon: 'web', desc: 'Сеть по группе: урон и сильное замедление', cd: 15, power: 50, perLvl: 14, radius: 130, slow: 0.4, slowT: 3 },
  whisper: { name: 'Удар из тени', kind: 'snipe', icon: 'mask', desc: 'Клинок в спину самому крепкому', cd: 13, power: 200, perLvl: 50, range: 240 },
  soul: { name: 'Разрыв души', kind: 'volley', icon: 'souls', desc: 'Тьма бьёт 4 цели', cd: 13, power: 70, perLvl: 19, count: 4 },
};

export const HEROES: HeroDef[] = HERO_LIST.map((h) => ({ ...h, skill2: { ...SKILL2[h.id], mana: 0 } }));

export const heroById = (id: string): HeroDef => {
  const h = HEROES.find((x) => x.id === id);
  if (!h) throw new Error('Неизвестный герой ' + id);
  return h;
};

export const STARTER_IDS = HEROES.filter((h) => h.price === 0).map((h) => h.id);
