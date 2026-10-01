// Герои. Каждый — неподвижная «вышка» с HP, маной, автоатакой и способностью.
// Прототипы взяты из Доты, имена и формулировки свои.

export type SkillKind =
  | 'blast' // удар по самой плотной группе в радиусе действия
  | 'around' // удар вокруг себя
  | 'chain' // цепь от цели к цели
  | 'volley' // несколько целей сразу
  | 'drain' // урон всем в радиусе + лечение союзных героев линии
  | 'snipe' // одна самая живучая цель
  | 'wards' // призыв стражей
  | 'heal'; // лечение союзников + урон вокруг

export interface SkillDef {
  name: string;
  kind: SkillKind;
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

export interface HeroDef {
  id: string;
  name: string;
  role: string;
  proto: string; // на кого похож из Доты — подсказка для дизайна
  color: string;
  glyph: string;
  hp: number;
  mana: number;
  dmg: number;
  range: number;
  rate: number;
  skill: SkillDef;
}

export const HEROES: HeroDef[] = [
  {
    id: 'frost', name: 'Инеята', role: 'Маг холода', proto: 'Crystal Maiden', color: '#7cc8f0', glyph: 'И',
    hp: 520, mana: 320, dmg: 22, range: 230, rate: 1.1,
    skill: { name: 'Ледяной вихрь', kind: 'blast', desc: 'Урон по группе и сильное замедление', mana: 90, cd: 9, power: 95, perLvl: 28, radius: 110, slow: 0.45, slowT: 3 },
  },
  {
    id: 'storm', name: 'Громобой', role: 'Повелитель молний', proto: 'Zeus', color: '#f4e07a', glyph: 'Г',
    hp: 480, mana: 300, dmg: 20, range: 250, rate: 1.05,
    skill: { name: 'Цепная молния', kind: 'chain', desc: 'Бьёт до 5 крипов по цепочке', mana: 80, cd: 6, power: 80, perLvl: 22, count: 5 },
  },
  {
    id: 'axe', name: 'Рубака', role: 'Стойкий боец', proto: 'Axe', color: '#d9573e', glyph: 'Р',
    hp: 950, mana: 200, dmg: 32, range: 105, rate: 1.0,
    skill: { name: 'Вихрь секир', kind: 'around', desc: 'Мощный удар по всем рядом', mana: 70, cd: 7, power: 120, perLvl: 32, radius: 150 },
  },
  {
    id: 'archer', name: 'Сумеречная', role: 'Лучница', proto: 'Drow Ranger', color: '#9fb7e8', glyph: 'С',
    hp: 450, mana: 240, dmg: 33, range: 300, rate: 1.0,
    skill: { name: 'Залп', kind: 'volley', desc: 'Стрелы в 6 целей, лёгкое замедление', mana: 75, cd: 8, power: 70, perLvl: 20, count: 6, slow: 0.75, slowT: 2 },
  },
  {
    id: 'fire', name: 'Пламена', role: 'Маг огня', proto: 'Lina', color: '#ff8a3d', glyph: 'П',
    hp: 470, mana: 320, dmg: 26, range: 240, rate: 1.05,
    skill: { name: 'Огненный столп', kind: 'blast', desc: 'Огромный урон по группе', mana: 110, cd: 10, power: 150, perLvl: 40, radius: 120 },
  },
  {
    id: 'quake', name: 'Камнелом', role: 'Сотрясатель', proto: 'Earthshaker', color: '#b8925a', glyph: 'К',
    hp: 780, mana: 260, dmg: 28, range: 125, rate: 1.1,
    skill: { name: 'Раскол земли', kind: 'around', desc: 'Урон и оглушение всех рядом', mana: 100, cd: 11, power: 75, perLvl: 20, radius: 175, stun: 1.8 },
  },
  {
    id: 'necro', name: 'Мор', role: 'Некромант', proto: 'Necrophos', color: '#8fd36b', glyph: 'М',
    hp: 620, mana: 280, dmg: 22, range: 220, rate: 1.1,
    skill: { name: 'Волна тлена', kind: 'drain', desc: 'Урон всем в радиусе, лечит героев линии', mana: 90, cd: 9, power: 60, perLvl: 17 },
  },
  {
    id: 'sniper', name: 'Меткий Глаз', role: 'Стрелок', proto: 'Sniper', color: '#c9b48a', glyph: 'Ё',
    hp: 420, mana: 220, dmg: 38, range: 380, rate: 1.4,
    skill: { name: 'Выстрел в упор', kind: 'snipe', desc: 'Огромный урон по самому крепкому крипу', mana: 80, cd: 7, power: 280, perLvl: 70, range: 420 },
  },
  {
    id: 'shaman', name: 'Змеевик', role: 'Шаман', proto: 'Shadow Shaman', color: '#5fc9a8', glyph: 'З',
    hp: 500, mana: 300, dmg: 20, range: 220, rate: 1.1,
    skill: { name: 'Змеиные стражи', kind: 'wards', desc: '3 стража стреляют 10 секунд', mana: 140, cd: 18, power: 18, perLvl: 5, count: 3 },
  },
  {
    id: 'healer', name: 'Знахарь', role: 'Целитель', proto: 'Witch Doctor', color: '#e58bd0', glyph: 'Ж',
    hp: 560, mana: 320, dmg: 21, range: 230, rate: 1.1,
    skill: { name: 'Целебный отвар', kind: 'heal', desc: 'Лечит героев линии и жжёт крипов рядом', mana: 110, cd: 12, power: 170, perLvl: 40, radius: 140 },
  },
];

export const heroById = (id: string): HeroDef => {
  const h = HEROES.find((x) => x.id === id);
  if (!h) throw new Error('Неизвестный герой ' + id);
  return h;
};
