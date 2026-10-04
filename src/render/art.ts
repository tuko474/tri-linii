// Рисованные модели героев, иконки навыков и рас. Всё вектором на Canvas — без файлов картинок.
// Одна функция рисует героя и на поле, и в портретах интерфейса.
import type { HeroDef, Look, SkillIcon } from '../data/heroes';
import type { RaceId } from '../data/races';
import { RACES } from '../data/races';

type Ctx = CanvasRenderingContext2D;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  return `rgb(${r},${g},${b})`;
}

function poly(c: Ctx, pts: number[]) {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
}

function disc(c: Ctx, x: number, y: number, r: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

// ---------- герой ----------

/**
 * Поза героя для анимации. t — время в секундах (у каждого героя своя фаза),
 * atk — ход удара 0..1 (0 — не бьёт), cast — ход способности 0..1 (0 — не колдует).
 * Без позы герой рисуется спокойно стоящим (портреты в меню).
 */
export interface HeroPose { t: number; atk: number; cast: number }
const STILL: HeroPose = { t: 0, atk: 0, cast: 0 };

const BACK_WEAPONS = ['staff', 'scythe', 'banner', 'totem', 'bow'];
const MELEE = ['axe', 'club', 'scythe', 'hammer'];
const PUNCH = ['claws', 'fist'];
/** Где рука держит оружие: вокруг этой точки оружие качается и бьёт. */
const GRIP: Record<string, [number, number]> = {
  staff: [0.55, 0.16], orb: [0.5, 0.22], axe: [0.47, 0.38], bow: [0.3, 0.05], rifle: [0.2, 0.18], club: [0.52, 0.48],
  scythe: [0.54, 0.22], claws: [0.5, 0.15], hammer: [0.45, 0.46], banner: [0.55, 0.18], fist: [0.62, 0.15], totem: [0.55, 0.18],
};

const INK = 'rgba(10,8,16,.88)';

/** Цвета героя на один кадр: обычные или белый силуэт для вспышки от удара. */
interface Pal { main: string; dark: string; skin: string; trim: string; white: boolean }

/** Объём: светлый край слева, тень справа (свет падает слева сверху, как у замка). */
function vol(c: Ctx, P: Pal, col: string, x0: number, x1: number): string | CanvasGradient {
  if (P.white) return '#ffffff';
  const g = c.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, shade(col, 0.22));
  g.addColorStop(0.5, col);
  g.addColorStop(1, shade(col, -0.32));
  return g;
}

/** Блик металла сверху вниз. */
function metal(c: Ctx, P: Pal, col: string, y0: number, y1: number): string | CanvasGradient {
  if (P.white) return '#ffffff';
  const g = c.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, shade(col, 0.45));
  g.addColorStop(0.45, col);
  g.addColorStop(1, shade(col, -0.35));
  return g;
}

/** Плавная форма удара: замах назад, резкий удар вперёд, возврат. */
function swing(a: number): number {
  if (a <= 0) return 0;
  if (a < 0.3) return -(a / 0.3) * 0.6;
  if (a < 0.48) return -0.6 + ((a - 0.3) / 0.18) * 1.6;
  return 1.0 * (1 - (a - 0.48) / 0.52);
}

/**
 * Рисует героя в координатах «единица = половина высоты фигуры», центр в (0,0).
 * Перед вызовом сделай ctx.translate(x, y) и ctx.scale(R, R), где R — радиус фигуры в пикселях.
 */
export function drawHeroFigure(c: Ctx, def: HeroDef, white = false, pose: HeroPose = STILL) {
  const L = def.look;
  const P: Pal = {
    main: white ? '#ffffff' : def.color,
    dark: white ? '#ffffff' : shade(def.color, -0.45),
    skin: white ? '#ffffff' : L.skin,
    trim: white ? '#ffffff' : L.trim,
    white,
  };
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const w = L.weapon;
  const [gx0, gy0] = GRIP[w];
  // удар: рукопашное оружие крутится вокруг хвата, когти и кулаки делают выпад
  let ang = Math.sin(pose.t * 1.7) * 0.05;
  let dx = 0, dy = 0;
  if (MELEE.includes(w)) ang += swing(pose.atk);
  else if (PUNCH.includes(w)) dx = Math.max(0, swing(pose.atk)) * 0.3;
  else if (w === 'rifle') ang -= Math.sin(pose.atk * Math.PI) * 0.22;
  else if (w === 'staff' || w === 'totem' || w === 'banner') ang += Math.sin(pose.atk * Math.PI) * 0.4;
  if (pose.cast > 0 && w !== 'orb' && w !== 'bow' && !PUNCH.includes(w)) {
    ang -= Math.sin(pose.cast * Math.PI) * 0.35;
    dy -= Math.sin(pose.cast * Math.PI) * 0.12;
  }
  if (w === 'orb') dy += Math.sin(pose.t * 2.3) * 0.045 - Math.sin(pose.cast * Math.PI) * 0.15;
  const gx = gx0 + dx, gy = gy0 + dy;
  const inHand = (fn: () => void) => {
    c.save();
    c.translate(gx, gy);
    c.rotate(ang);
    c.translate(-gx0, -gy0);
    fn();
    c.restore();
  };

  if (L.body === 'armor') cape(c, P, pose);
  if (BACK_WEAPONS.includes(w)) inHand(() => weapon(c, L, P, pose));
  body(c, L, P, pose);
  head(c, L, P, pose);
  arms(c, L, P, gx, gy);
  if (PUNCH.includes(w)) weapon(c, L, P, pose, -1); // дальняя лапа/кулак не делает выпад
  if (!BACK_WEAPONS.includes(w)) inHand(() => weapon(c, L, P, pose, PUNCH.includes(w) ? 1 : 0));
  if (!PUNCH.includes(w) && w !== 'orb') hand(c, P, gx, gy, L.body === 'bones' ? 0.07 : 0.085);
  // способность: сияние вокруг оружия
  if (pose.cast > 0 && !white) {
    const k = Math.sin(pose.cast * Math.PI);
    const tip = w === 'orb' ? [gx + 0.08, gy - 0.17] : w === 'bow' || PUNCH.includes(w) ? [gx, gy] : [gx + 0.1, gy - 0.95];
    const gr = c.createRadialGradient(tip[0], tip[1], 0, tip[0], tip[1], 0.45 * k + 0.05);
    gr.addColorStop(0, 'rgba(255,255,255,.95)');
    gr.addColorStop(0.35, L.trim);
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    c.globalAlpha = k;
    c.fillStyle = gr;
    c.beginPath(); c.arc(tip[0], tip[1], 0.45 * k + 0.05, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
  }
}

/** Плащ за спиной у героев в доспехах — колышется. */
function cape(c: Ctx, P: Pal, p: HeroPose) {
  const s = Math.sin(p.t * 1.9) * 0.05, s2 = Math.sin(p.t * 1.9 + 1.3) * 0.06;
  c.beginPath();
  c.moveTo(-0.34, -0.2);
  c.lineTo(0.3, -0.2);
  c.quadraticCurveTo(0.42 + s, 0.4, 0.3 + s2, 0.9);
  c.quadraticCurveTo(0.05, 0.84 + s * 0.5, -0.12 + s, 0.94);
  c.quadraticCurveTo(-0.32, 0.86, -0.5 + s2, 0.92);
  c.quadraticCurveTo(-0.46 + s, 0.35, -0.34, -0.2);
  c.closePath();
  c.fillStyle = vol(c, P, P.white ? '#ffffff' : shade(P.main, -0.55), -0.5, 0.4);
  c.fill();
  c.lineWidth = 0.05; c.strokeStyle = INK; c.stroke();
}

function body(c: Ctx, L: Look, P: Pal, p: HeroPose) {
  const { main, dark, skin, trim } = P;
  const sway = Math.sin(p.t * 1.5) * 0.03;
  c.lineWidth = 0.06;
  c.strokeStyle = INK;
  switch (L.body) {
    case 'robe': {
      c.beginPath();
      c.moveTo(-0.3, -0.2); c.lineTo(0.3, -0.2);
      c.quadraticCurveTo(0.42, 0.3, 0.56 + sway, 0.86);
      c.quadraticCurveTo(0, 0.95, -0.56 + sway, 0.86);
      c.quadraticCurveTo(-0.42, 0.3, -0.3, -0.2);
      c.closePath();
      c.fillStyle = vol(c, P, main, -0.56, 0.56); c.fill(); c.stroke();
      // полоса по центру и складки
      c.fillStyle = dark;
      poly(c, [-0.08, -0.2, 0.08, -0.2, 0.15 + sway, 0.9, -0.15 + sway, 0.9]); c.fill();
      if (!P.white) {
        c.strokeStyle = 'rgba(0,0,0,.22)'; c.lineWidth = 0.03;
        c.beginPath(); c.moveTo(-0.24, 0.42); c.lineTo(-0.34 + sway, 0.84); c.moveTo(0.26, 0.42); c.lineTo(0.36 + sway, 0.84); c.stroke();
      }
      // пояс с пряжкой
      c.fillStyle = trim; c.fillRect(-0.36, 0.26, 0.72, 0.09);
      disc(c, 0, 0.305, 0.065, P.white ? '#fff' : '#f3d27a');
      // воротник
      c.fillStyle = trim;
      c.beginPath(); c.moveTo(-0.24, -0.22); c.quadraticCurveTo(0, -0.08, 0.24, -0.22); c.lineTo(0.18, -0.12); c.quadraticCurveTo(0, -0.02, -0.18, -0.12); c.closePath(); c.fill();
      break;
    }
    case 'hood': {
      c.beginPath();
      c.moveTo(-0.32, -0.25); c.lineTo(0.32, -0.25);
      c.lineTo(0.5 + sway, 0.86); c.lineTo(0.25 + sway, 0.74); c.lineTo(0, 0.88 + sway); c.lineTo(-0.25 + sway, 0.74); c.lineTo(-0.5 + sway, 0.86);
      c.closePath();
      c.fillStyle = vol(c, P, dark, -0.5, 0.5); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(-0.2, -0.2); c.lineTo(0.2, -0.2); c.lineTo(0.26, 0.56); c.lineTo(-0.26, 0.56); c.closePath();
      c.fillStyle = vol(c, P, main, -0.26, 0.26); c.fill();
      c.fillStyle = trim; c.fillRect(-0.27, 0.2, 0.54, 0.07);
      // ремень через грудь
      c.strokeStyle = P.white ? '#fff' : '#3a2a1c'; c.lineWidth = 0.06;
      c.beginPath(); c.moveTo(-0.22, -0.16); c.lineTo(0.22, 0.2); c.stroke();
      disc(c, 0, 0.02, 0.04, P.white ? '#fff' : '#c9cdd6');
      break;
    }
    case 'armor': {
      // ноги в поножах
      c.fillStyle = vol(c, P, dark, -0.3, 0.3);
      c.beginPath(); c.rect(-0.3, 0.45, 0.22, 0.42); c.rect(0.08, 0.45, 0.22, 0.42); c.fill(); c.stroke();
      c.fillStyle = metal(c, P, '#9aa2ae', 0.75, 0.9);
      c.beginPath(); c.rect(-0.32, 0.78, 0.26, 0.1); c.rect(0.06, 0.78, 0.26, 0.1); c.fill(); c.stroke();
      // кираса
      poly(c, [-0.4, -0.22, 0.4, -0.22, 0.34, 0.55, -0.34, 0.55]);
      c.fillStyle = vol(c, P, main, -0.4, 0.4); c.fill(); c.stroke();
      if (!P.white) {
        c.fillStyle = 'rgba(255,255,255,.22)';
        c.beginPath(); c.moveTo(-0.3, -0.16); c.lineTo(-0.12, -0.16); c.lineTo(-0.18, 0.2); c.lineTo(-0.28, 0.2); c.closePath(); c.fill();
      }
      c.fillStyle = trim; c.fillRect(-0.36, 0.3, 0.72, 0.09);
      disc(c, 0, 0.345, 0.07, P.white ? '#fff' : '#f3d27a');
      // наплечники
      for (const sx of [-1, 1]) {
        c.beginPath(); c.ellipse(sx * 0.4, -0.15, 0.19, 0.15, 0, Math.PI, 0); c.lineTo(sx * 0.4 + 0.19, -0.08); c.lineTo(sx * 0.4 - 0.19, -0.08); c.closePath();
        c.fillStyle = metal(c, P, trim, -0.3, -0.06); c.fill(); c.lineWidth = 0.045; c.strokeStyle = INK; c.stroke();
      }
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.04;
      c.beginPath(); c.moveTo(0, -0.18); c.lineTo(0, 0.28); c.stroke();
      break;
    }
    case 'beast': {
      c.fillStyle = vol(c, P, P.white ? '#fff' : shade(skin, -0.3), -0.36, 0.36);
      c.beginPath(); c.ellipse(-0.2, 0.72, 0.16, 0.19, 0, 0, 7); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(0.2, 0.72, 0.16, 0.19, 0, 0, 7); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(0, 0.2, 0.52, 0.48 + Math.sin(p.t * 2.2) * 0.012, 0, 0, Math.PI * 2);
      c.fillStyle = vol(c, P, skin, -0.52, 0.52); c.fill(); c.stroke();
      c.beginPath(); c.ellipse(0, 0.3, 0.29, 0.29, 0, 0, Math.PI * 2);
      c.fillStyle = P.white ? '#fff' : shade(skin, 0.3); c.fill();
      // шерсть клочками по краю
      if (!P.white) {
        c.strokeStyle = shade(skin, -0.35); c.lineWidth = 0.035;
        for (const [x, y] of [[-0.42, 0.0], [-0.47, 0.25], [0.44, 0.02], [0.48, 0.27], [-0.3, -0.18], [0.3, -0.18]]) {
          c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sign(x) * 0.08, y + 0.05); c.stroke();
        }
      }
      c.fillStyle = main; c.fillRect(-0.48, 0.1, 0.96, 0.11);
      disc(c, 0, 0.155, 0.06, trim);
      break;
    }
    case 'bones': {
      // тёмный дым-плащ, чтобы скелет читался на любом фоне
      if (!P.white) {
        c.fillStyle = 'rgba(30,20,40,.55)';
        c.beginPath(); c.moveTo(-0.3, -0.2); c.quadraticCurveTo(-0.5, 0.5, -0.36 + sway, 0.9); c.lineTo(0.36 + sway, 0.9); c.quadraticCurveTo(0.5, 0.5, 0.3, -0.2); c.closePath(); c.fill();
      }
      c.strokeStyle = INK; c.lineWidth = 0.15;
      const ribs = () => {
        c.beginPath(); c.moveTo(0, -0.2); c.lineTo(0, 0.5);
        for (let i = 0; i < 4; i++) {
          const y = -0.1 + i * 0.13, wd = 0.32 - i * 0.04;
          c.moveTo(-wd, y + 0.05); c.quadraticCurveTo(0, y - 0.06, wd, y + 0.05);
        }
        c.moveTo(-0.18, 0.5); c.lineTo(-0.24, 0.88); c.moveTo(0.18, 0.5); c.lineTo(0.24, 0.88);
        c.stroke();
      };
      ribs();
      c.strokeStyle = skin; c.lineWidth = 0.09; ribs();
      c.fillStyle = main; c.fillRect(-0.24, 0.45, 0.48, 0.1);
      // светящееся сердце
      if (!P.white) {
        const k = 0.6 + Math.sin(p.t * 3) * 0.3;
        const gr = c.createRadialGradient(0, 0.1, 0, 0, 0.1, 0.16);
        gr.addColorStop(0, trim); gr.addColorStop(1, 'rgba(0,0,0,0)');
        c.globalAlpha = k; c.fillStyle = gr; c.beginPath(); c.arc(0, 0.1, 0.16, 0, 7); c.fill(); c.globalAlpha = 1;
      }
      break;
    }
    case 'stone': {
      poly(c, [-0.55, -0.15, -0.2, -0.35, 0.3, -0.3, 0.6, -0.05, 0.55, 0.6, 0.15, 0.88, -0.35, 0.82, -0.62, 0.45]);
      c.fillStyle = vol(c, P, skin, -0.6, 0.6); c.fill(); c.stroke();
      if (!P.white) {
        c.fillStyle = 'rgba(255,255,255,.14)';
        poly(c, [-0.5, -0.12, -0.2, -0.3, -0.05, -0.2, -0.38, 0.1]); c.fill();
      }
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.04;
      c.beginPath(); c.moveTo(-0.3, -0.1); c.lineTo(-0.05, 0.25); c.lineTo(-0.2, 0.55); c.moveTo(0.25, 0.05); c.lineTo(0.38, 0.4); c.stroke();
      // светящиеся руны пульсируют
      const k = P.white ? 1 : 0.65 + Math.sin(p.t * 2.6) * 0.35;
      c.globalAlpha = k;
      disc(c, 0.05, 0.1, 0.075, trim); disc(c, -0.3, 0.4, 0.05, trim); disc(c, 0.35, 0.55, 0.05, trim);
      c.globalAlpha = 1;
      break;
    }
  }
}

/** Глаза: тёмные с бликом; иногда моргают. */
function eyes(c: Ctx, P: Pal, hy: number, col: string, r: number, t: number, gap = 0.075) {
  const blink = (t + 2) % 4.6 < 0.13;
  if (blink) {
    c.strokeStyle = col; c.lineWidth = 0.025;
    c.beginPath(); c.moveTo(-gap - r, hy); c.lineTo(-gap + r, hy); c.moveTo(gap - r, hy); c.lineTo(gap + r, hy); c.stroke();
    return;
  }
  disc(c, -gap, hy, r, col); disc(c, gap, hy, r, col);
  if (!P.white) { disc(c, -gap + r * 0.35, hy - r * 0.35, r * 0.38, 'rgba(255,255,255,.85)'); disc(c, gap + r * 0.35, hy - r * 0.35, r * 0.38, 'rgba(255,255,255,.85)'); }
}

function head(c: Ctx, L: Look, P: Pal, p: HeroPose) {
  const { main, dark, skin, trim } = P;
  // голова чуть покачивается отдельно от тела
  const bob = Math.sin(p.t * 2.2 + 0.6) * 0.012;
  const hy = (L.body === 'stone' ? -0.42 : -0.45) + bob;
  const hr = L.body === 'stone' ? 0.2 : 0.23;
  c.lineWidth = 0.05;
  c.strokeStyle = INK;
  if (L.head === 'skull') {
    c.beginPath(); c.arc(0, hy, hr, 0, Math.PI * 2); c.fillStyle = vol(c, P, skin, -hr, hr); c.fill(); c.stroke();
    c.beginPath(); c.rect(-0.1, hy + 0.12, 0.2, 0.1); c.fillStyle = P.white ? '#fff' : shade(skin, -0.1); c.fill(); c.stroke();
    disc(c, -0.08, hy - 0.01, 0.065, P.white ? '#fff' : '#1a1622'); disc(c, 0.08, hy - 0.01, 0.065, P.white ? '#fff' : '#1a1622');
    const k = P.white ? 1 : 0.7 + Math.sin(p.t * 3.1) * 0.3;
    c.globalAlpha = k; disc(c, -0.08, hy - 0.01, 0.03, trim); disc(c, 0.08, hy - 0.01, 0.03, trim); c.globalAlpha = 1;
    c.strokeStyle = P.white ? '#fff' : '#1a1622'; c.lineWidth = 0.02;
    c.beginPath(); for (let i = -2; i <= 2; i++) { c.moveTo(i * 0.035, hy + 0.13); c.lineTo(i * 0.035, hy + 0.2); } c.stroke();
    return;
  }
  if (L.head === 'hood') {
    c.beginPath(); c.moveTo(-0.3, hy + 0.2); c.quadraticCurveTo(-0.3, hy - 0.38, 0, hy - 0.36); c.quadraticCurveTo(0.3, hy - 0.38, 0.3, hy + 0.2); c.closePath();
    c.fillStyle = vol(c, P, dark, -0.3, 0.3); c.fill(); c.stroke();
    c.beginPath(); c.arc(0, hy + 0.02, 0.16, 0, Math.PI * 2); c.fillStyle = P.white ? '#fff' : '#0d0b14'; c.fill();
    const k = P.white ? 1 : 0.75 + Math.sin(p.t * 2.4) * 0.25;
    c.globalAlpha = k;
    eyes(c, P, hy, P.white ? '#fff' : '#bff7a0', 0.035, p.t, 0.06);
    c.globalAlpha = 1;
    return;
  }
  if (L.head === 'mane') {
    c.beginPath();
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = (i % 2 ? hr + 0.08 : hr + 0.16) + Math.sin(p.t * 2 + i) * 0.01;
      const x = Math.cos(a) * r, y = hy + Math.sin(a) * r;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath();
    c.fillStyle = vol(c, P, dark, -hr - 0.16, hr + 0.16); c.fill(); c.lineWidth = 0.04; c.stroke(); c.lineWidth = 0.05;
  }
  c.beginPath(); c.arc(0, hy, hr, 0, Math.PI * 2); c.fillStyle = vol(c, P, skin, -hr, hr); c.fill(); c.stroke();
  // румянец
  if (!P.white && L.body !== 'stone' && L.head !== 'mask') {
    c.fillStyle = 'rgba(230,90,80,.18)';
    c.beginPath(); c.ellipse(-0.12, hy + 0.07, 0.05, 0.03, 0, 0, 7); c.ellipse(0.12, hy + 0.07, 0.05, 0.03, 0, 0, 7); c.fill();
  }
  if (L.head !== 'mask') {
    const eye = L.body === 'stone' ? trim : P.white ? '#fff' : '#1a1622';
    eyes(c, P, hy, eye, 0.038, p.t);
    // брови: при ударе хмурятся
    if (!P.white && L.body !== 'stone') {
      const f = p.atk > 0 ? Math.sin(p.atk * Math.PI) * 0.03 : 0;
      c.strokeStyle = 'rgba(20,15,20,.7)'; c.lineWidth = 0.025;
      c.beginPath(); c.moveTo(-0.12, hy - 0.08 - f * 0.3); c.lineTo(-0.04, hy - 0.06 + f); c.moveTo(0.12, hy - 0.08 - f * 0.3); c.lineTo(0.04, hy - 0.06 + f); c.stroke();
    }
  }
  c.strokeStyle = INK; c.lineWidth = 0.05;
  switch (L.head) {
    case 'pointy': {
      const tip = 0.08 + Math.sin(p.t * 1.6) * 0.03;
      c.beginPath(); c.moveTo(-0.32, hy - 0.1); c.lineTo(0.32, hy - 0.1); c.quadraticCurveTo(0.14, hy - 0.3, tip, hy - 0.62); c.quadraticCurveTo(-0.06, hy - 0.3, -0.32, hy - 0.1); c.closePath();
      c.fillStyle = vol(c, P, main, -0.32, 0.32); c.fill(); c.stroke();
      c.fillStyle = trim; c.fillRect(-0.32, hy - 0.16, 0.64, 0.07);
      disc(c, tip, hy - 0.62, 0.055, P.white ? '#fff' : '#f3d27a');
      break;
    }
    case 'crown':
      poly(c, [-0.22, hy - 0.14, -0.22, hy - 0.34, -0.11, hy - 0.22, 0, hy - 0.38, 0.11, hy - 0.22, 0.22, hy - 0.34, 0.22, hy - 0.14]);
      c.fillStyle = metal(c, P, '#f3d27a', hy - 0.38, hy - 0.14); c.fill(); c.stroke();
      disc(c, 0, hy - 0.2, 0.035, P.white ? '#fff' : '#e0455a');
      // борода
      c.beginPath(); c.moveTo(-0.18, hy + 0.06); c.quadraticCurveTo(-0.12, hy + 0.44, 0, hy + 0.46); c.quadraticCurveTo(0.12, hy + 0.44, 0.18, hy + 0.06); c.quadraticCurveTo(0, hy + 0.16, -0.18, hy + 0.06);
      c.fillStyle = P.white ? '#fff' : '#f2f2f2'; c.fill(); c.lineWidth = 0.03; c.stroke();
      break;
    case 'horns':
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.moveTo(sx * 0.16, hy - 0.14);
        c.quadraticCurveTo(sx * 0.44, hy - 0.2, sx * 0.4, hy - 0.5);
        c.quadraticCurveTo(sx * 0.3, hy - 0.26, sx * 0.08, hy - 0.2);
        c.closePath();
        c.fillStyle = metal(c, P, trim, hy - 0.5, hy - 0.14); c.fill(); c.stroke();
      }
      break;
    case 'cap':
      c.beginPath(); c.arc(0, hy - 0.06, hr + 0.01, Math.PI, 0); c.closePath(); c.fillStyle = vol(c, P, dark, -hr, hr); c.fill(); c.stroke();
      c.fillStyle = dark; c.beginPath(); c.rect(-0.02, hy - 0.09, 0.38, 0.06); c.fill(); c.stroke();
      // монокль-прицел
      c.strokeStyle = trim; c.lineWidth = 0.04; c.beginPath(); c.arc(0.075, hy, 0.07, 0, Math.PI * 2); c.stroke();
      // усы
      if (!P.white) { c.strokeStyle = '#4a3020'; c.lineWidth = 0.04; c.beginPath(); c.moveTo(-0.1, hy + 0.11); c.quadraticCurveTo(0, hy + 0.07, 0.1, hy + 0.11); c.stroke(); }
      break;
    case 'mask':
      for (const sx of [-1, 1]) { c.fillStyle = main; poly(c, [sx * 0.16, hy - 0.2, sx * 0.3, hy - 0.52 + Math.sin(p.t * 2 + sx) * 0.02, sx * 0.24, hy - 0.16]); c.fill(); c.stroke(); }
      c.beginPath(); c.ellipse(0, hy + 0.02, 0.2, 0.26, 0, 0, Math.PI * 2); c.fillStyle = vol(c, P, trim, -0.2, 0.2); c.fill(); c.stroke();
      disc(c, -0.075, hy - 0.02, 0.048, P.white ? '#fff' : '#1a1622'); disc(c, 0.075, hy - 0.02, 0.048, P.white ? '#fff' : '#1a1622');
      if (!P.white) {
        const k = 0.5 + Math.sin(p.t * 2.8) * 0.5;
        c.globalAlpha = k; disc(c, -0.075, hy - 0.02, 0.02, main); disc(c, 0.075, hy - 0.02, 0.02, main); c.globalAlpha = 1;
        c.strokeStyle = main; c.lineWidth = 0.025;
        c.beginPath(); c.moveTo(-0.13, hy + 0.06); c.lineTo(-0.05, hy + 0.08); c.moveTo(0.13, hy + 0.06); c.lineTo(0.05, hy + 0.08); c.stroke();
      }
      c.strokeStyle = P.white ? '#fff' : '#1a1622'; c.lineWidth = 0.03;
      c.beginPath(); c.moveTo(-0.1, hy + 0.14); c.lineTo(0.1, hy + 0.14); c.stroke();
      break;
    case 'flame':
      for (let i = -2; i <= 2; i++) {
        const fl = Math.sin(p.t * 11 + i * 1.7) * 0.05 + Math.sin(p.t * 7.3 + i) * 0.03;
        c.fillStyle = P.white ? '#fff' : i % 2 ? '#ffd25a' : '#ff6a2a';
        c.beginPath();
        c.moveTo(i * 0.09 - 0.08, hy - 0.1);
        c.quadraticCurveTo(i * 0.11 - 0.05, hy - 0.3, i * 0.11 + fl, hy - 0.44 - (2 - Math.abs(i)) * 0.07 + fl * 0.5);
        c.quadraticCurveTo(i * 0.11 + 0.06, hy - 0.28, i * 0.09 + 0.08, hy - 0.1);
        c.closePath(); c.fill();
      }
      if (!P.white) {
        c.fillStyle = 'rgba(255,240,180,.8)';
        c.beginPath(); c.ellipse(0, hy - 0.2, 0.06, 0.1 + Math.sin(p.t * 9) * 0.02, 0, 0, 7); c.fill();
      }
      break;
    case 'helm':
      c.beginPath(); c.arc(0, hy - 0.02, hr + 0.045, Math.PI, 0); c.lineTo(hr + 0.045, hy + 0.08); c.lineTo(-hr - 0.045, hy + 0.08); c.closePath();
      c.fillStyle = metal(c, P, '#b8bec8', hy - 0.3, hy + 0.08); c.fill(); c.stroke();
      c.fillStyle = P.white ? '#fff' : '#1a1622'; c.fillRect(-0.16, hy - 0.04, 0.32, 0.055);
      c.strokeStyle = P.white ? '#fff' : 'rgba(0,0,0,.4)'; c.lineWidth = 0.03;
      c.beginPath(); c.moveTo(0, hy - 0.27); c.lineTo(0, hy - 0.06); c.stroke();
      // плюмаж колышется
      c.beginPath(); c.moveTo(-0.02, hy - 0.26);
      c.quadraticCurveTo(-0.22 + Math.sin(p.t * 2.5) * 0.04, hy - 0.62, -0.32 + Math.sin(p.t * 2.5 + 0.8) * 0.06, hy - 0.38);
      c.quadraticCurveTo(-0.16, hy - 0.42, 0.04, hy - 0.24); c.closePath();
      c.fillStyle = trim; c.fill(); c.lineWidth = 0.03; c.strokeStyle = INK; c.stroke();
      break;
    case 'mane':
      disc(c, -0.06, hy + 0.12, 0.03, trim); disc(c, 0.06, hy + 0.12, 0.03, trim);
      // уши
      for (const sx of [-1, 1]) { c.beginPath(); c.moveTo(sx * 0.12, hy - 0.18); c.lineTo(sx * 0.24, hy - 0.36 + Math.sin(p.t * 1.3 + sx) * 0.015); c.lineTo(sx * 0.24, hy - 0.14); c.closePath(); c.fillStyle = dark; c.fill(); c.lineWidth = 0.035; c.stroke(); }
      // нос-морда
      c.beginPath(); c.ellipse(0, hy + 0.08, 0.09, 0.06, 0, 0, 7); c.fillStyle = P.white ? '#fff' : shade(skin, 0.3); c.fill();
      disc(c, 0, hy + 0.05, 0.03, P.white ? '#fff' : '#1a1622');
      break;
  }
}

/** Рука от плеча к хвату (у когтей и кулаков — обе руки). */
function arms(c: Ctx, L: Look, P: Pal, gx: number, gy: number) {
  const col = L.body === 'robe' || L.body === 'hood' || L.body === 'armor' ? P.main : P.skin;
  const thick = L.body === 'bones' ? 0.06 : L.body === 'stone' ? 0.17 : 0.13;
  const sh = L.body === 'stone' ? 0.42 : L.body === 'beast' ? 0.36 : 0.27;
  const sy = L.body === 'beast' ? -0.02 : -0.13;
  const two = PUNCH.includes(L.weapon);
  const arm = (x0: number, y0: number, x1: number, y1: number) => {
    const mx = (x0 + x1) / 2 + (x1 > 0 ? 0.04 : -0.04), my = Math.max(y0, y1) + 0.06;
    c.beginPath(); c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1);
    c.strokeStyle = INK; c.lineWidth = thick + 0.06; c.stroke();
    c.strokeStyle = P.white ? '#fff' : shade(col.startsWith('#') ? col : '#888888', -0.08); c.lineWidth = thick; c.stroke();
  };
  if (two) arm(-sh, sy, -GRIP[L.weapon][0] + 0.02, GRIP[L.weapon][1] + 0.02);
  arm(sh, sy, gx - 0.02, gy + 0.02);
}

function hand(c: Ctx, P: Pal, x: number, y: number, r: number) {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  c.fillStyle = P.skin; c.fill();
  c.lineWidth = 0.035; c.strokeStyle = INK; c.stroke();
}

function weapon(c: Ctx, L: Look, P: Pal, p: HeroPose, only = 0) {
  const { main, trim, dark } = P;
  c.lineWidth = 0.08;
  c.strokeStyle = INK;
  const wood = P.white ? '#fff' : '#6b4a2a';
  const shaft = (x0: number, y0: number, x1: number, y1: number, w = 0.08) => {
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
    c.strokeStyle = INK; c.lineWidth = w + 0.05; c.stroke();
    c.strokeStyle = wood; c.lineWidth = w; c.stroke();
  };
  switch (L.weapon) {
    case 'staff': {
      shaft(0.55, 0.85, 0.55, -0.68);
      // навершие-кристалл в оправе
      c.fillStyle = P.white ? '#fff' : '#f3d27a';
      c.beginPath(); c.moveTo(0.42, -0.7); c.quadraticCurveTo(0.55, -0.6, 0.68, -0.7); c.lineTo(0.62, -0.64); c.quadraticCurveTo(0.55, -0.58, 0.48, -0.64); c.closePath(); c.fill();
      poly(c, [0.55, -1.02, 0.68, -0.8, 0.55, -0.62, 0.42, -0.8]);
      c.fillStyle = metal(c, P, trim, -1.0, -0.62); c.fill();
      c.strokeStyle = INK; c.lineWidth = 0.03; c.stroke();
      if (!P.white) {
        const k = 0.35 + Math.sin(p.t * 2.5) * 0.15;
        const gr = c.createRadialGradient(0.55, -0.82, 0, 0.55, -0.82, 0.3);
        gr.addColorStop(0, `rgba(255,255,255,${k})`); gr.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = gr; c.beginPath(); c.arc(0.55, -0.82, 0.3, 0, 7); c.fill();
      }
      break;
    }
    case 'orb': {
      const glow = 0.26 + Math.sin(p.t * 3) * 0.03 + Math.sin(p.cast * Math.PI) * 0.15;
      if (!P.white) {
        const g = c.createRadialGradient(0.58, 0.05, 0.02, 0.58, 0.05, glow);
        g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, trim); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(0.58, 0.05, glow, 0, Math.PI * 2); c.fill();
      }
      const g2 = P.white ? '#fff' : c.createRadialGradient(0.55, 0.02, 0, 0.58, 0.05, 0.11);
      if (typeof g2 !== 'string') { g2.addColorStop(0, shade(main, 0.6)); g2.addColorStop(1, main); }
      c.fillStyle = g2; c.beginPath(); c.arc(0.58, 0.05, 0.1, 0, 7); c.fill();
      c.lineWidth = 0.025; c.strokeStyle = INK; c.stroke();
      // искры кружат вокруг сферы
      if (!P.white) for (let i = 0; i < 3; i++) {
        const a = p.t * 2.2 + (i * Math.PI * 2) / 3;
        disc(c, 0.58 + Math.cos(a) * 0.17, 0.05 + Math.sin(a) * 0.07, 0.022, trim);
      }
      break;
    }
    case 'axe':
      shaft(0.35, 0.75, 0.7, -0.45);
      c.beginPath(); c.moveTo(0.62, -0.2); c.quadraticCurveTo(1.0, -0.35, 0.82, -0.72); c.quadraticCurveTo(0.72, -0.45, 0.6, -0.42); c.closePath();
      c.fillStyle = metal(c, P, trim, -0.72, -0.2); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.04; c.stroke();
      if (!P.white) { c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 0.025; c.beginPath(); c.moveTo(0.9, -0.3); c.quadraticCurveTo(0.95, -0.45, 0.85, -0.62); c.stroke(); }
      break;
    case 'bow': {
      // тетива натягивается в начале удара; после выстрела стрелы нет, пока не наложит новую
      const pull = p.atk > 0 && p.atk < 0.45 ? p.atk / 0.45 : 0;
      const shot = p.atk >= 0.45;
      const tx = 0.25 + Math.cos(1) * 0.62;
      c.strokeStyle = INK; c.lineWidth = 0.11;
      c.beginPath(); c.arc(0.25, 0.05, 0.62, -1.0, 1.0); c.stroke();
      c.strokeStyle = wood; c.lineWidth = 0.07; c.stroke();
      const sx = tx - pull * 0.3;
      c.strokeStyle = P.white ? '#fff' : '#e8e8e8'; c.lineWidth = 0.02;
      c.beginPath(); c.moveTo(tx, 0.05 - Math.sin(1) * 0.62); c.lineTo(sx, 0.05); c.lineTo(tx, 0.05 + Math.sin(1) * 0.62); c.stroke();
      if (!shot) {
        c.strokeStyle = trim; c.lineWidth = 0.04;
        c.beginPath(); c.moveTo(sx - 0.02, 0.05); c.lineTo(sx + 0.62, 0.05); c.stroke();
        c.fillStyle = P.white ? '#fff' : '#c9cdd6';
        poly(c, [sx + 0.62, 0.0, sx + 0.74, 0.05, sx + 0.62, 0.1]); c.fill();
      }
      break;
    }
    case 'rifle':
      c.save(); c.translate(0.2, 0.15); c.rotate(-0.5);
      c.fillStyle = wood; c.beginPath(); c.rect(-0.2, -0.06, 0.4, 0.14); c.fill(); c.lineWidth = 0.03; c.strokeStyle = INK; c.stroke();
      c.fillStyle = metal(c, P, '#5a5a66', -0.04, 0.03); c.beginPath(); c.rect(0.15, -0.04, 0.75, 0.07); c.fill(); c.stroke();
      c.fillStyle = trim; c.fillRect(0.3, -0.12, 0.18, 0.07);
      // вспышка выстрела
      if (p.atk > 0 && p.atk < 0.3 && !P.white) {
        const k = 1 - p.atk / 0.3;
        c.fillStyle = `rgba(255,220,120,${k})`;
        c.beginPath();
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; const r = i % 2 ? 0.08 : 0.22 * k + 0.08; c.lineTo(0.95 + Math.cos(a) * r, Math.sin(a) * r * 0.7); }
        c.closePath(); c.fill();
      }
      c.restore();
      break;
    case 'club':
      c.save(); c.translate(0.55, 0.2); c.rotate(0.35);
      poly(c, [-0.06, 0.55, 0.06, 0.55, 0.17, -0.55, -0.17, -0.55]);
      c.fillStyle = vol(c, P, trim, -0.17, 0.17); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.04; c.stroke();
      // шипы
      c.fillStyle = P.white ? '#fff' : '#e8dcc0';
      for (const [x, y, s] of [[-0.16, -0.4, -1], [0.16, -0.3, 1], [-0.13, -0.15, -1], [0.14, -0.48, 1]] as const) { poly(c, [x, y - 0.04, x + s * 0.09, y, x, y + 0.04]); c.fill(); c.stroke(); }
      c.restore();
      break;
    case 'scythe':
      shaft(0.5, 0.85, 0.62, -0.75, 0.07);
      c.beginPath(); c.moveTo(0.62, -0.72); c.quadraticCurveTo(0.2, -0.97, -0.18, -0.58); c.quadraticCurveTo(0.25, -0.72, 0.6, -0.55); c.closePath();
      c.fillStyle = metal(c, P, '#c8d0d8', -0.95, -0.55); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.03; c.stroke();
      if (!P.white) { c.strokeStyle = trim; c.lineWidth = 0.02; c.beginPath(); c.moveTo(0.5, -0.7); c.quadraticCurveTo(0.2, -0.85, -0.08, -0.62); c.stroke(); }
      break;
    case 'claws':
      for (const sx of [-1, 1]) {
        if (only && sx !== only) continue;
        disc(c, sx * 0.5, 0.17, 0.1, P.skin);
        c.lineWidth = 0.03; c.strokeStyle = INK; c.beginPath(); c.arc(sx * 0.5, 0.17, 0.1, 0, 7); c.stroke();
        for (let i = 0; i < 3; i++) {
          c.beginPath(); c.moveTo(sx * (0.5 + i * 0.05), 0.12); c.quadraticCurveTo(sx * (0.6 + i * 0.07), 0.05, sx * (0.64 + i * 0.07), -0.14);
          c.strokeStyle = INK; c.lineWidth = 0.07; c.stroke();
          c.strokeStyle = trim; c.lineWidth = 0.04; c.stroke();
        }
      }
      break;
    case 'hammer':
      shaft(0.4, 0.75, 0.62, -0.35);
      c.save(); c.translate(0.64, -0.42); c.rotate(0.2);
      c.fillStyle = metal(c, P, trim, -0.13, 0.13); c.fillRect(-0.22, -0.13, 0.44, 0.26);
      c.strokeStyle = INK; c.lineWidth = 0.04; c.strokeRect(-0.22, -0.13, 0.44, 0.26);
      c.fillStyle = P.white ? '#fff' : shade(trim.startsWith('#') ? trim : '#888888', -0.3); c.fillRect(-0.24, -0.05, 0.48, 0.1);
      c.restore();
      break;
    case 'banner': {
      shaft(0.55, 0.85, 0.55, -0.95, 0.07);
      const wv = (k: number) => Math.sin(p.t * 4 - k * 6) * 0.05 * k;
      c.beginPath();
      c.moveTo(0.55, -0.92);
      c.quadraticCurveTo(0.78, -0.9 + wv(0.5), 1.0, -0.82 + wv(1));
      c.lineTo(0.88, -0.62 + wv(0.8));
      c.lineTo(1.0, -0.42 + wv(1));
      c.quadraticCurveTo(0.78, -0.5 + wv(0.5), 0.55, -0.48);
      c.closePath();
      c.fillStyle = vol(c, P, trim, 0.55, 1.0); c.fill(); c.strokeStyle = INK; c.lineWidth = 0.03; c.stroke();
      disc(c, 0.72, -0.68 + wv(0.4), 0.05, P.white ? '#fff' : '#f3d27a');
      disc(c, 0.55, -0.98, 0.05, P.white ? '#fff' : '#f3d27a');
      break;
    }
    case 'fist':
      for (const sx of [-1, 1]) {
        if (only && sx !== only) continue;
        const x = sx * 0.62;
        c.beginPath(); c.arc(x, 0.15, sx > 0 ? 0.2 : 0.17, 0, Math.PI * 2);
        c.fillStyle = vol(c, P, P.skin, x - 0.2, x + 0.2); c.fill();
        c.strokeStyle = INK; c.lineWidth = 0.04; c.stroke();
        c.strokeStyle = 'rgba(0,0,0,.3)'; c.lineWidth = 0.025;
        c.beginPath(); c.moveTo(x + sx * 0.06, 0.03); c.lineTo(x + sx * 0.1, 0.2); c.moveTo(x - sx * 0.02, 0.01); c.lineTo(x + sx * 0.02, 0.2); c.stroke();
      }
      break;
    case 'totem': {
      shaft(0.55, 0.85, 0.55, -0.55);
      c.strokeStyle = P.white ? '#fff' : '#5fc9a8'; c.lineWidth = 0.08;
      const s = Math.sin(p.t * 2.2) * 0.05;
      c.beginPath(); c.moveTo(0.55, -0.3); c.bezierCurveTo(0.8 + s, -0.45, 0.3 - s, -0.6, 0.6, -0.8); c.stroke();
      disc(c, 0.62, -0.84, 0.08, P.white ? '#fff' : '#5fc9a8');
      disc(c, 0.64, -0.86, 0.025, P.white ? '#fff' : '#ffd25a');
      // перья качаются
      for (const k of [-1, 1]) {
        c.save(); c.translate(0.55, -0.42); c.rotate(k * 0.5 + Math.sin(p.t * 2 + k) * 0.12);
        c.fillStyle = P.white ? '#fff' : k > 0 ? '#e05a4a' : '#f3d27a';
        c.beginPath(); c.ellipse(0, 0.14, 0.035, 0.12, 0, 0, 7); c.fill();
        c.restore();
      }
      void dark;
      break;
    }
  }
}

// ---------- иконки навыков ----------

export function drawSkillIcon(c: Ctx, icon: SkillIcon, color: string, size: number) {
  const s = size / 2;
  c.save();
  c.translate(s, s);
  const g = c.createRadialGradient(0, -s * 0.3, s * 0.1, 0, 0, s);
  g.addColorStop(0, shade(color, -0.1));
  g.addColorStop(1, shade(color, -0.65));
  c.fillStyle = g;
  c.beginPath(); c.arc(0, 0, s, 0, Math.PI * 2); c.fill();
  c.scale(s, s);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const W = '#ffffff';
  const glow = shade(color, 0.6);
  c.strokeStyle = W;
  c.fillStyle = W;
  c.lineWidth = 0.1;
  switch (icon) {
    case 'snowflake':
      for (let i = 0; i < 6; i++) {
        c.save(); c.rotate((i * Math.PI) / 3);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -0.62); c.moveTo(0, -0.38); c.lineTo(-0.14, -0.5); c.moveTo(0, -0.38); c.lineTo(0.14, -0.5); c.stroke();
        c.restore();
      }
      break;
    case 'lightning':
      poly(c, [0.12, -0.7, -0.3, 0.05, -0.02, 0.05, -0.16, 0.7, 0.32, -0.12, 0.04, -0.12, 0.22, -0.7]);
      c.fillStyle = '#fff6b0'; c.fill();
      break;
    case 'axes':
      for (const sx of [-1, 1]) {
        c.save(); c.scale(sx, 1); c.rotate(-0.7);
        c.strokeStyle = '#c9a070'; c.lineWidth = 0.08;
        c.beginPath(); c.moveTo(0, 0.6); c.lineTo(0, -0.55); c.stroke();
        c.beginPath(); c.moveTo(0, -0.5); c.quadraticCurveTo(0.42, -0.58, 0.36, -0.12); c.quadraticCurveTo(0.2, -0.24, 0, -0.18); c.closePath();
        c.fillStyle = W; c.fill();
        c.restore();
      }
      break;
    case 'arrows':
    case 'firearrows': {
      const col = icon === 'firearrows' ? '#ffb15a' : W;
      for (let i = -1; i <= 1; i++) {
        c.save(); c.translate(i * 0.24, i * 0.1); c.rotate(-0.8);
        c.strokeStyle = col; c.lineWidth = 0.07;
        c.beginPath(); c.moveTo(0, 0.55); c.lineTo(0, -0.45); c.stroke();
        c.fillStyle = col; poly(c, [0, -0.62, -0.12, -0.4, 0.12, -0.4]); c.fill();
        if (icon === 'firearrows') { c.fillStyle = '#ff6a2a'; poly(c, [-0.1, 0.5, 0, 0.75, 0.1, 0.5]); c.fill(); }
        c.restore();
      }
      break;
    }
    case 'flame':
      c.beginPath(); c.moveTo(0, -0.7); c.bezierCurveTo(0.45, -0.2, 0.55, 0.2, 0.32, 0.5); c.quadraticCurveTo(0, 0.75, -0.32, 0.5); c.bezierCurveTo(-0.55, 0.2, -0.3, -0.1, -0.12, -0.25); c.quadraticCurveTo(-0.05, -0.05, 0.05, -0.1); c.quadraticCurveTo(0.08, -0.4, 0, -0.7);
      c.fillStyle = '#ffb15a'; c.fill();
      c.beginPath(); c.moveTo(0, -0.1); c.bezierCurveTo(0.22, 0.12, 0.22, 0.35, 0, 0.5); c.bezierCurveTo(-0.22, 0.35, -0.2, 0.12, 0, -0.1); c.fillStyle = '#fff3c4'; c.fill();
      break;
    case 'quake':
      c.beginPath(); c.moveTo(-0.7, 0.25); c.lineTo(0.7, 0.25); c.stroke();
      c.lineWidth = 0.08;
      c.beginPath(); c.moveTo(0, 0.25); c.lineTo(-0.12, 0.42); c.lineTo(0.05, 0.55); c.lineTo(-0.05, 0.72); c.moveTo(-0.35, 0.25); c.lineTo(-0.45, 0.45); c.moveTo(0.35, 0.25); c.lineTo(0.48, 0.48); c.stroke();
      c.fillStyle = W; poly(c, [-0.45, 0.1, -0.3, -0.25, -0.12, 0.1]); c.fill(); poly(c, [0.05, 0.1, 0.25, -0.45, 0.45, 0.1]); c.fill();
      break;
    case 'skull':
      c.beginPath(); c.arc(0, -0.08, 0.5, Math.PI * 0.85, Math.PI * 2.15); c.lineTo(0.28, 0.5); c.lineTo(-0.28, 0.5); c.closePath();
      c.fillStyle = W; c.fill();
      disc(c, -0.18, -0.05, 0.13, shade(color, -0.6)); disc(c, 0.18, -0.05, 0.13, shade(color, -0.6));
      c.fillStyle = shade(color, -0.6); poly(c, [0, 0.12, -0.07, 0.25, 0.07, 0.25]); c.fill();
      break;
    case 'crosshair':
      c.lineWidth = 0.08;
      c.beginPath(); c.arc(0, 0, 0.42, 0, Math.PI * 2); c.stroke();
      c.beginPath(); c.moveTo(0, -0.7); c.lineTo(0, -0.2); c.moveTo(0, 0.2); c.lineTo(0, 0.7); c.moveTo(-0.7, 0); c.lineTo(-0.2, 0); c.moveTo(0.2, 0); c.lineTo(0.7, 0); c.stroke();
      disc(c, 0, 0, 0.08, '#ff6a6a');
      break;
    case 'serpent':
      c.lineWidth = 0.14; c.strokeStyle = '#bff3d8';
      c.beginPath(); c.moveTo(-0.45, 0.55); c.bezierCurveTo(0.5, 0.45, -0.5, -0.1, 0.25, -0.35); c.stroke();
      disc(c, 0.32, -0.42, 0.16, '#bff3d8');
      disc(c, 0.37, -0.46, 0.04, '#1a1622');
      c.strokeStyle = '#ff6a6a'; c.lineWidth = 0.04; c.beginPath(); c.moveTo(0.46, -0.4); c.lineTo(0.6, -0.36); c.stroke();
      break;
    case 'potion':
      c.beginPath(); c.moveTo(-0.12, -0.6); c.lineTo(0.12, -0.6); c.lineTo(0.12, -0.25); c.quadraticCurveTo(0.5, -0.1, 0.45, 0.25); c.quadraticCurveTo(0.4, 0.62, 0, 0.62); c.quadraticCurveTo(-0.4, 0.62, -0.45, 0.25); c.quadraticCurveTo(-0.5, -0.1, -0.12, -0.25); c.closePath();
      c.fillStyle = W; c.fill();
      c.beginPath(); c.moveTo(-0.42, 0.15); c.lineTo(0.42, 0.15); c.quadraticCurveTo(0.4, 0.55, 0, 0.55); c.quadraticCurveTo(-0.4, 0.55, -0.42, 0.15); c.fillStyle = '#9cf09a'; c.fill();
      break;
    case 'claws':
      c.lineWidth = 0.1;
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.moveTo(-0.45 + i * 0.22, -0.55); c.quadraticCurveTo(0.05 + i * 0.22, -0.05, -0.15 + i * 0.25, 0.6); c.stroke();
      }
      break;
    case 'storm':
      c.lineWidth = 0.09;
      c.beginPath();
      for (let a = 0; a < Math.PI * 4; a += 0.2) {
        const r = 0.05 + a * 0.05;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (a === 0) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
      disc(c, 0, 0, 0.1, glow);
      break;
    case 'paw':
      c.beginPath(); c.ellipse(0, 0.22, 0.3, 0.26, 0, 0, Math.PI * 2); c.fill();
      for (const [x, y] of [[-0.38, -0.12], [-0.14, -0.38], [0.14, -0.38], [0.38, -0.12]]) { c.beginPath(); c.ellipse(x, y, 0.11, 0.14, 0, 0, Math.PI * 2); c.fill(); }
      break;
    case 'cross':
      c.fillStyle = '#fff3c4';
      c.fillRect(-0.14, -0.55, 0.28, 1.1); c.fillRect(-0.55, -0.14, 1.1, 0.28);
      c.strokeStyle = glow; c.lineWidth = 0.04; c.beginPath(); c.arc(0, 0, 0.66, 0, Math.PI * 2); c.stroke();
      break;
    case 'horn':
      c.beginPath(); c.moveTo(-0.6, 0.15); c.quadraticCurveTo(-0.2, 0.2, 0.45, -0.45); c.lineTo(0.62, -0.25); c.quadraticCurveTo(0, 0.42, -0.6, 0.35); c.closePath();
      c.fillStyle = '#f3d27a'; c.fill();
      c.lineWidth = 0.05;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0.5, -0.38, 0.25 + i * 0.12, -1.3, 0.2); c.stroke(); }
      break;
    case 'wave':
      c.lineWidth = 0.12;
      for (let i = 0; i < 2; i++) {
        const y = -0.15 + i * 0.35;
        c.beginPath(); c.moveTo(-0.65, y);
        for (let x = -0.65; x <= 0.65; x += 0.05) c.lineTo(x, y + Math.sin((x + 0.65) * 7.5) * 0.12);
        c.stroke();
      }
      c.beginPath(); c.arc(0.25, -0.42, 0.18, Math.PI, Math.PI * 1.9); c.stroke();
      break;
    case 'leaf':
      c.beginPath(); c.moveTo(-0.45, 0.5); c.quadraticCurveTo(-0.55, -0.4, 0.5, -0.55); c.quadraticCurveTo(0.45, 0.45, -0.45, 0.5);
      c.fillStyle = '#c9f0a8'; c.fill();
      c.strokeStyle = shade(color, -0.5); c.lineWidth = 0.06;
      c.beginPath(); c.moveTo(-0.45, 0.5); c.lineTo(0.35, -0.38); c.stroke();
      break;
    case 'fist':
      c.beginPath(); c.moveTo(-0.4, -0.25); c.lineTo(0.35, -0.3); c.quadraticCurveTo(0.55, -0.28, 0.5, -0.05);
      c.lineTo(0.48, 0.35); c.quadraticCurveTo(0.45, 0.55, 0.2, 0.55); c.lineTo(-0.35, 0.55); c.quadraticCurveTo(-0.55, 0.5, -0.5, 0.2); c.closePath();
      c.fill();
      c.strokeStyle = shade(color, -0.5); c.lineWidth = 0.05;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.moveTo(-0.2 + i * 0.22, -0.28); c.lineTo(-0.2 + i * 0.22, 0.05); c.stroke(); }
      break;
    case 'dagger':
      c.save(); c.rotate(-0.75);
      poly(c, [0, -0.72, 0.12, -0.1, 0, 0.0, -0.12, -0.1]); c.fillStyle = '#e8e8f0'; c.fill();
      c.fillStyle = '#c9b4ff'; c.fillRect(-0.24, -0.02, 0.48, 0.08);
      c.fillStyle = shade(color, -0.4); c.fillRect(-0.05, 0.06, 0.1, 0.36);
      disc(c, 0, 0.48, 0.07, '#c9b4ff');
      c.restore();
      break;
    case 'moon':
      c.beginPath(); c.arc(0, 0, 0.55, 0, Math.PI * 2); c.fillStyle = '#e8e0ff'; c.fill();
      c.beginPath(); c.arc(0.22, -0.12, 0.48, 0, Math.PI * 2); c.fillStyle = shade(color, -0.6); c.fill();
      disc(c, -0.5, 0.45, 0.04, W); disc(c, 0.5, 0.5, 0.03, W);
      break;
    case 'web':
      c.lineWidth = 0.04;
      for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * 0.68, Math.sin(a) * 0.68); c.stroke(); }
      for (const r of [0.22, 0.42, 0.62]) {
        c.beginPath();
        for (let i = 0; i <= 8; i++) { const a = (i * Math.PI) / 4; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
        c.stroke();
      }
      disc(c, 0.15, 0.2, 0.11, '#1a1622');
      break;
    case 'eye':
      c.beginPath(); c.moveTo(-0.65, 0); c.quadraticCurveTo(0, -0.55, 0.65, 0); c.quadraticCurveTo(0, 0.55, -0.65, 0);
      c.fillStyle = '#ffe0e0'; c.fill();
      disc(c, 0, 0, 0.24, '#ff3a4a'); disc(c, 0, 0, 0.1, '#1a1622');
      break;
    case 'howl':
      // голова волка и звуковые дуги
      poly(c, [-0.45, 0.45, -0.35, -0.25, -0.2, -0.05, 0.25, -0.2, 0.05, 0.1, 0.15, 0.45]); c.fill();
      poly(c, [-0.35, -0.25, -0.3, -0.55, -0.15, -0.15]); c.fill();
      c.lineWidth = 0.06;
      for (let i = 0; i < 3; i++) { c.beginPath(); c.arc(0.25, -0.2, 0.18 + i * 0.13, -0.9, 0.4); c.stroke(); }
      break;
    case 'boulder':
      poly(c, [-0.4, 0.2, -0.3, -0.25, 0.1, -0.4, 0.42, -0.15, 0.4, 0.3, 0.0, 0.45]);
      c.fillStyle = '#c8ccd4'; c.fill();
      c.strokeStyle = W; c.lineWidth = 0.05;
      c.beginPath(); c.moveTo(-0.7, -0.5); c.lineTo(-0.45, -0.35); c.moveTo(-0.72, -0.15); c.lineTo(-0.5, -0.08); c.stroke();
      break;
  }
  c.restore();
}

// ---------- иконки рас ----------

export function drawRaceIcon(c: Ctx, race: RaceId, size: number) {
  const s = size / 2;
  const col = RACES[race].color;
  c.save();
  c.translate(s, s);
  c.fillStyle = '#1a1628';
  c.beginPath(); c.arc(0, 0, s, 0, Math.PI * 2); c.fill();
  c.strokeStyle = col; c.lineWidth = s * 0.12;
  c.beginPath(); c.arc(0, 0, s * 0.9, 0, Math.PI * 2); c.stroke();
  c.scale(s, s);
  c.fillStyle = col;
  c.strokeStyle = col;
  c.lineWidth = 0.1;
  switch (race) {
    case 'undead':
      c.beginPath(); c.arc(0, -0.08, 0.38, Math.PI * 0.85, Math.PI * 2.15); c.lineTo(0.2, 0.4); c.lineTo(-0.2, 0.4); c.closePath(); c.fill();
      disc(c, -0.14, -0.05, 0.1, '#1a1628'); disc(c, 0.14, -0.05, 0.1, '#1a1628');
      break;
    case 'elemental':
      c.beginPath(); c.moveTo(0, -0.55); c.quadraticCurveTo(0.45, 0, 0.32, 0.25); c.arc(0, 0.2, 0.32, 0.15, Math.PI - 0.15); c.quadraticCurveTo(-0.45, 0, 0, -0.55); c.fill();
      break;
    case 'wild':
      c.beginPath(); c.ellipse(0, 0.2, 0.24, 0.2, 0, 0, Math.PI * 2); c.fill();
      for (const [x, y] of [[-0.3, -0.08], [-0.11, -0.3], [0.11, -0.3], [0.3, -0.08]]) { c.beginPath(); c.ellipse(x, y, 0.09, 0.11, 0, 0, Math.PI * 2); c.fill(); }
      break;
    case 'kingdom':
      poly(c, [-0.42, 0.3, -0.42, -0.2, -0.21, 0.02, 0, -0.38, 0.21, 0.02, 0.42, -0.2, 0.42, 0.3]); c.fill();
      break;
    case 'shadow':
      c.beginPath(); c.arc(0, 0, 0.42, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.arc(0.18, -0.1, 0.36, 0, Math.PI * 2); c.fillStyle = '#1a1628'; c.fill();
      break;
    case 'mountain':
      poly(c, [-0.55, 0.38, -0.15, -0.35, 0.05, -0.05, 0.2, -0.22, 0.55, 0.38]); c.fill();
      c.fillStyle = '#f3ead6'; poly(c, [-0.15, -0.35, -0.27, -0.13, -0.03, -0.13]); c.fill();
      break;
  }
  c.restore();
}

// ---------- картинки для интерфейса (кешируются) ----------

const cache = new Map<string, string>();

function render(key: string, px: number, draw: (c: Ctx) => void): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = px;
  cv.height = px;
  const c = cv.getContext('2d')!;
  draw(c);
  const url = cv.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** Портрет героя для карточек и кнопок. */
export function portraitURL(def: HeroDef, px = 112): string {
  return render('h:' + def.id + ':' + px, px, (c) => {
    const s = px / 2;
    const g = c.createRadialGradient(s, s * 0.7, s * 0.1, s, s, s);
    g.addColorStop(0, shade(def.color, -0.15));
    g.addColorStop(1, shade(def.color, -0.7));
    c.fillStyle = g;
    c.beginPath(); c.arc(s, s, s, 0, Math.PI * 2); c.fill();
    c.save();
    c.beginPath(); c.arc(s, s, s, 0, Math.PI * 2); c.clip();
    c.translate(s, s * 1.08);
    c.scale(s * 0.78, s * 0.78);
    drawHeroFigure(c, def);
    c.restore();
  });
}

export function skillURL(def: HeroDef, px = 112): string {
  return render('s:' + def.id + ':' + px, px, (c) => drawSkillIcon(c, def.skill.icon, def.color, px));
}

export function skill2URL(def: HeroDef, px = 112): string {
  return render('s2:' + def.id + ':' + px, px, (c) => drawSkillIcon(c, def.skill2.icon, def.color, px));
}

export function raceURL(race: RaceId, px = 64): string {
  return render('r:' + race + ':' + px, px, (c) => drawRaceIcon(c, race, px));
}

// ---------- замок (трон) ----------

/**
 * Замок-трон, вид спереди, как у бараков. Единица = единица мира: ширина ≈ 200, земля на y = 44,
 * флаг на верхушке ≈ y = −172. Центр (0,0) совпадает с точкой трона.
 * col/deep — цвет команды (светлый/тёмный); dmg — разрушения 0..2; white — белый силуэт для вспышки.
 */
export function drawCastleFigure(c: Ctx, col: string, deep: string, dmg = 0, white = false) {
  const W = (s: string) => (white ? '#ffffff' : s);
  const ink = W('#14121c');
  const stoneL = W('#9a8f7c'), stone = W('#7b715f'), stoneD = W('#564e42');
  const glow = W('#f3d27a');
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = 3;
  c.strokeStyle = ink;

  // зубцы стены: от x0 до x1 по верху y
  const merlons = (x0: number, x1: number, y: number, broken = -1) => {
    const n = Math.max(2, Math.round((x1 - x0) / 13));
    const w = (x1 - x0) / (n * 2 - 1);
    for (let i = 0; i < n; i++) {
      if (i === broken) continue;
      const x = x0 + i * w * 2;
      c.fillStyle = stoneL;
      c.beginPath(); c.rect(x, y - 9, w, 9); c.fill(); c.stroke();
    }
  };
  // каменный блок с тенью справа и рядами кладки
  const block = (x0: number, y0: number, x1: number, y1: number) => {
    c.fillStyle = stone;
    c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.fill();
    c.fillStyle = stoneD;
    c.fillRect(x1 - (x1 - x0) * 0.28, y0, (x1 - x0) * 0.28, y1 - y0);
    if (!white) {
      c.strokeStyle = 'rgba(20,18,28,.28)';
      c.lineWidth = 1.5;
      let row = 0;
      for (let y = y0 + 12; y < y1 - 3; y += 12, row++) {
        c.beginPath(); c.moveTo(x0 + 2, y); c.lineTo(x1 - 2, y); c.stroke();
        for (let x = x0 + (row % 2 ? 10 : 18); x < x1 - 4; x += 18) {
          c.beginPath(); c.moveTo(x, y); c.lineTo(x, y + 12 > y1 ? y1 : y + 12); c.stroke();
        }
      }
      c.strokeStyle = ink;
      c.lineWidth = 3;
    }
    c.beginPath(); c.rect(x0, y0, x1 - x0, y1 - y0); c.stroke();
  };
  // остроконечная крыша: левая грань светлая, правая тёмная
  const roof = (cx: number, base: number, half: number, top: number) => {
    c.fillStyle = W(col);
    c.beginPath(); c.moveTo(cx - half, base); c.lineTo(cx, top); c.lineTo(cx, base); c.closePath(); c.fill();
    c.fillStyle = W(deep);
    c.beginPath(); c.moveTo(cx, base); c.lineTo(cx, top); c.lineTo(cx + half, base); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(cx - half, base); c.lineTo(cx, top); c.lineTo(cx + half, base); c.closePath(); c.stroke();
  };
  const flag = (x: number, y: number, len: number, size: number) => {
    c.lineWidth = 2.5;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - len); c.stroke();
    c.fillStyle = W(col);
    c.beginPath(); c.moveTo(x, y - len); c.lineTo(x + size * 1.6, y - len + size * 0.45); c.lineTo(x, y - len + size); c.closePath(); c.fill(); c.stroke();
    c.lineWidth = 3;
  };
  const archWin = (x: number, y: number, w: number, h: number) => {
    c.fillStyle = dmg >= 2 ? W('#2a2230') : glow;
    c.beginPath(); c.moveTo(x - w / 2, y + h); c.lineTo(x - w / 2, y + w / 2); c.arc(x, y + w / 2, w / 2, Math.PI, 0); c.lineTo(x + w / 2, y + h); c.closePath(); c.fill();
    c.lineWidth = 2; c.stroke(); c.lineWidth = 3;
  };

  // донжон позади стены
  block(-34, -84, 34, 0);
  merlons(-38, 38, -84);
  roof(0, -92, 44, -150);
  flag(0, -150, 24, 13);
  archWin(-13, -66, 10, 20);
  archWin(13, -66, 10, 20);
  // стена с зубцами
  block(-50, -14, 50, 44);
  merlons(-50, 50, -14);
  // башни по бокам
  for (const sx of [-1, 1]) {
    const x0 = sx < 0 ? -84 : 48, x1 = x0 + 36;
    block(x0, -60, x1, 44);
    merlons(x0 - 4, x1 + 4, -60, dmg >= 2 && sx > 0 ? 1 : -1);
    roof(x0 + 18, -68, 26, -112);
    flag(x0 + 18, -112, 16, 9);
    // бойница
    c.fillStyle = ink;
    c.fillRect(x0 + 15, -36, 6, 18);
    // знамя команды
    c.fillStyle = W(col);
    c.beginPath(); c.moveTo(x0 + 10, -4); c.lineTo(x0 + 26, -4); c.lineTo(x0 + 26, 22); c.lineTo(x0 + 18, 15); c.lineTo(x0 + 10, 22); c.closePath(); c.fill();
    c.lineWidth = 2; c.stroke(); c.lineWidth = 3;
  }
  // ворота с решёткой
  c.fillStyle = ink;
  c.beginPath(); c.moveTo(-18, 44); c.lineTo(-18, 14); c.arc(0, 14, 18, Math.PI, 0); c.lineTo(18, 44); c.closePath(); c.fill();
  c.save();
  c.clip();
  c.strokeStyle = W('#4a4350');
  c.lineWidth = 2.5;
  for (let x = -12; x <= 12; x += 8) { c.beginPath(); c.moveTo(x, -6); c.lineTo(x, 44); c.stroke(); }
  for (let y = 10; y <= 40; y += 10) { c.beginPath(); c.moveTo(-18, y); c.lineTo(18, y); c.stroke(); }
  c.restore();
  c.strokeStyle = ink;
  c.lineWidth = 3;
  c.beginPath(); c.moveTo(-18, 44); c.lineTo(-18, 14); c.arc(0, 14, 18, Math.PI, 0); c.lineTo(18, 44); c.stroke();
  // замковый камень с гербом-короной
  c.fillStyle = glow;
  c.beginPath(); c.moveTo(-9, -2); c.lineTo(-9, -8); c.lineTo(-4.5, -4); c.lineTo(0, -10); c.lineTo(4.5, -4); c.lineTo(9, -8); c.lineTo(9, -2); c.closePath(); c.fill();
  c.lineWidth = 1.5; c.stroke(); c.lineWidth = 3;

  // трещины
  if (dmg >= 1 && !white) {
    c.strokeStyle = 'rgba(15,12,20,.85)';
    c.lineWidth = 2.5;
    const crack = (pts: number[]) => { c.beginPath(); c.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]); c.stroke(); };
    crack([-40, -14, -34, 0, -40, 10, -32, 24]);
    crack([22, -84, 18, -70, 25, -58, 20, -44]);
    if (dmg >= 2) {
      crack([60, -60, 66, -44, 58, -30, 64, -14, 60, 4]);
      crack([-76, 44, -70, 30, -78, 18]);
      crack([30, -14, 36, 0, 30, 14]);
      // выбитые камни
      c.fillStyle = '#2a2230';
      c.fillRect(-28, -40, 9, 7);
      c.fillRect(54, 10, 8, 6);
    }
    c.strokeStyle = ink;
    c.lineWidth = 3;
  }
}

// ---------- лесные крипы и боссы ----------

/**
 * Нейтралы в координатах «радиус фигуры ≈ 20», центр (0,0), земля около y = 12.
 * Звери смотрят вправо. kind: wolf | boar | spider | turtle | lord.
 * t — время в секундах (своя фаза у каждого зверя), atk — ход удара 0..1 (0 — не бьёт).
 */
export function drawBeastFigure(c: Ctx, kind: string, t = 0, atk = 0) {
  const ink = '#14121c';
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = ink;
  c.lineWidth = 1.6;
  const sh = (fill: string | CanvasGradient, path: () => void, stroke = true) => {
    c.beginPath(); path(); c.fillStyle = fill; c.fill(); if (stroke) c.stroke();
  };
  const eye = (x: number, y: number, r: number, col: string) => {
    c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  };
  // моргание: глаз ненадолго становится чёрточкой
  const blink = (t + 1.3) % 3.7 < 0.14;
  const lid = (x: number, y: number, r: number, col: string) => {
    if (blink) { c.strokeStyle = ink; c.lineWidth = 0.9; c.beginPath(); c.moveTo(x - r, y); c.lineTo(x + r, y); c.stroke(); c.lineWidth = 1.6; }
    else { eye(x, y, r, col); eye(x + r * 0.35, y - r * 0.35, r * 0.35, 'rgba(255,255,255,.8)'); }
  };
  const shadow = (rx: number, y = 12) => {
    c.fillStyle = 'rgba(0,0,0,.32)'; c.beginPath(); c.ellipse(0, y, rx, rx * 0.25, 0, 0, 7); c.fill();
  };
  /** Часть тела, повёрнутая вокруг (px,py) и сдвинутая на (dx,dy). */
  const part = (px: number, py: number, ang: number, dx: number, dy: number, fn: () => void) => {
    c.save(); c.translate(px + dx, py + dy); c.rotate(ang); c.translate(-px, -py); fn(); c.restore();
  };
  const lin = (col: string, x0: number, x1: number) => {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, shade(col, 0.2)); g.addColorStop(0.55, col); g.addColorStop(1, shade(col, -0.28));
    return g;
  };
  const hit = atk > 0 ? Math.sin(Math.min(1, atk / 0.6) * Math.PI) : 0; // 0→1→0 за первые 60% удара
  const breath = Math.sin(t * 2.2);

  if (kind === 'wolf') {
    shadow(16);
    const fur = '#8f939c', furD = '#5d616b', belly = '#c9ccd2';
    // дальние лапы и хвост (виляет)
    sh(furD, () => { c.rect(-9, 3, 3.5, 9); c.rect(6, 3, 3.5, 9); });
    part(-12, -3, Math.sin(t * 5.5) * 0.28, 0, 0, () => {
      sh(fur, () => { c.moveTo(-12, -2); c.quadraticCurveTo(-21, -4, -23, -13); c.quadraticCurveTo(-17, -6, -11, -5); c.closePath(); });
      sh(belly, () => { c.moveTo(-21, -9); c.quadraticCurveTo(-22.5, -11, -23, -13); c.quadraticCurveTo(-21, -10, -19.5, -8.5); c.closePath(); }, false);
    });
    // тело дышит
    sh(lin(fur, -13, 11), () => c.ellipse(-1, -1, 12, 6.5 + breath * 0.25, -0.05, 0, 7));
    sh(belly, () => c.ellipse(0, 2.5, 8, 2.6, 0, 0, 7), false);
    c.strokeStyle = 'rgba(20,18,28,.35)'; c.lineWidth = 0.8;
    c.beginPath(); c.moveTo(-6, -5); c.lineTo(-4, -3); c.moveTo(-2, -6); c.lineTo(0, -4); c.moveTo(2, -6.5); c.lineTo(4, -4.5); c.stroke();
    c.strokeStyle = ink; c.lineWidth = 1.6;
    // ближние лапы
    sh(fur, () => { c.rect(-6, 3, 3.5, 9); c.rect(8.5, 3, 3.5, 9); });
    // голова: покачивается, при ударе — бросок вперёд с открытой пастью
    part(9, -4, -hit * 0.25 + Math.sin(t * 1.8) * 0.04, hit * 4, Math.sin(t * 2.2 + 0.5) * 0.5, () => {
      sh(fur, () => { c.moveTo(7, -9); c.lineTo(9, -16 + Math.sin(t * 3.1) * 0.6); c.lineTo(12, -10); c.closePath(); });
      sh(lin(fur, 6, 18), () => c.ellipse(12, -6, 6, 5, 0, 0, 7));
      // нижняя челюсть
      part(15, -2, hit * 0.5, 0, 0, () => sh(fur, () => { c.moveTo(15, -3); c.lineTo(21, -2.5); c.lineTo(20, 0); c.lineTo(15, 0); c.closePath(); }));
      if (hit > 0.2) sh('#c23a4c', () => { c.moveTo(15.5, -3.5); c.lineTo(21, -3.5); c.lineTo(20, -1.5); c.closePath(); }, false);
      sh(fur, () => { c.moveTo(15, -8); c.lineTo(22, -5.5); c.lineTo(21.5, -3); c.lineTo(15, -3); c.closePath(); });
      sh(furD, () => { c.moveTo(11, -11); c.lineTo(13, -17 + Math.sin(t * 3.1 + 0.4) * 0.6); c.lineTo(15, -10); c.closePath(); });
      eye(21.8, -5.2, 1.2, ink);
      lid(15, -7, 1.4, '#ffd34d');
    });
  } else if (kind === 'boar') {
    shadow(16);
    const hide = '#7a5236', hideD = '#4f3423', mane = '#2f2119';
    sh(hideD, () => { c.rect(-9, 4, 4, 8); c.rect(5, 4, 4, 8); });
    // хвостик-завиток
    c.strokeStyle = hideD; c.lineWidth = 1.4;
    c.beginPath(); c.moveTo(-13, -2); c.quadraticCurveTo(-17, -4 + Math.sin(t * 6) * 1.5, -15, -7); c.stroke();
    c.strokeStyle = ink; c.lineWidth = 1.6;
    sh(lin(hide, -14, 12), () => c.ellipse(-1, -1, 13, 9 + breath * 0.3, 0, 0, 7));
    // щетина по хребту дыбится при ударе
    sh(mane, () => { c.moveTo(-12, -4); for (let i = 0; i < 6; i++) { c.lineTo(-10 + i * 3.6, -13 - hit * 2 + (i % 2) * 3); } c.lineTo(9, -5); c.closePath(); });
    sh(hide, () => { c.rect(-6, 4, 4, 8); c.rect(8, 4, 4, 8); });
    // голова-рыло: принюхивается, при ударе бодает клыками
    part(8, 0, hit * 0.35, hit * 3 + Math.sin(t * 3.4) * 0.35, Math.sin(t * 2.6) * 0.3, () => {
      sh(lin(hide, 5, 19), () => c.ellipse(12, -1, 7, 6.5, 0, 0, 7));
      sh('#c98d74', () => c.ellipse(19, 1, 3, 3.6 + Math.sin(t * 8) * 0.25, 0, 0, 7));
      eye(18.4, 0.4, 0.7, ink); eye(19.8, 1.8, 0.7, ink);
      sh('#f3ead6', () => { c.moveTo(15, 3); c.quadraticCurveTo(19, 4, 18, -2); c.quadraticCurveTo(17, 2, 15, 1); c.closePath(); });
      sh(hideD, () => { c.moveTo(9, -6); c.lineTo(8, -12 + Math.sin(t * 2.7) * 0.5); c.lineTo(12, -7); c.closePath(); });
      lid(13.5, -3, 1.4, '#ff6b4a');
    });
  } else if (kind === 'spider') {
    shadow(17);
    const body = '#5a4580', bodyL = '#7d65a8';
    // лапы перебирают, передние поднимаются при ударе
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const a = -0.9 + i * 0.55;
      const lift = Math.sin(t * 5 + i * 1.3 + s) * 1.3 - (s > 0 && i === 0 ? hit * 9 : 0);
      const kx = 2 * s, ky = 0;
      const mx = s * (10 + i * 2), my = -10 + i * 3 + lift * 0.6;
      const ex = s * (16 + i * 1.5) + (s > 0 && i === 0 ? hit * 3 : 0), ey = 10 - Math.abs(a) * 2 + Math.min(0, lift);
      c.beginPath(); c.moveTo(kx, ky); c.quadraticCurveTo(mx, my, ex, ey);
      c.strokeStyle = ink; c.lineWidth = 3.6; c.stroke();
      c.strokeStyle = '#3a2e52'; c.lineWidth = 2.2; c.stroke();
    }
    c.strokeStyle = ink;
    c.lineWidth = 1.6;
    const bob = Math.sin(t * 3) * 0.6;
    sh(lin(body, -14, 6), () => c.ellipse(-4, -2 + bob, 10, 8 + breath * 0.3, 0, 0, 7));
    sh('#c23a4c', () => { c.moveTo(-4, -8 + bob); c.lineTo(-1, -3 + bob); c.lineTo(-4, 2 + bob); c.lineTo(-7, -3 + bob); c.closePath(); }, false);
    sh(lin(bodyL, 2, 14), () => c.ellipse(8 + hit * 2, bob * 0.6, 6, 5.5, 0, 0, 7));
    const ek = 0.7 + Math.sin(t * 4) * 0.3;
    c.globalAlpha = ek;
    eye(10 + hit * 2, -1.6 + bob * 0.6, 1.2, '#ff5a5a'); eye(12 + hit * 2, 0.2 + bob * 0.6, 1.1, '#ff5a5a'); eye(8.6 + hit * 2, 0.6 + bob * 0.6, 0.9, '#ff5a5a');
    c.globalAlpha = 1;
    // жвала щёлкают
    const j = Math.sin(t * 7) * 0.5 + hit * 2;
    sh('#e8dcc0', () => { c.moveTo(12 + hit * 2, 3); c.lineTo(14 + hit * 2 + j * 0.5, 7 + j * 0.3); c.lineTo(11 + hit * 2, 4.5); c.closePath(); });
  } else if (kind === 'turtle') {
    shadow(24, 13);
    const skin = '#7fb86d', shell = '#3f7a45', shellD = '#2b5a33', plate = '#9ccf7e';
    // лапы чуть переступают
    sh(skin, () => { c.ellipse(-15, 8, 5, 4, 0.4 + Math.sin(t * 1.4) * 0.08, 0, 7); });
    sh(skin, () => { c.ellipse(13, 8, 5, 4, -0.4 - Math.sin(t * 1.4) * 0.08, 0, 7); });
    sh(skin, () => { c.moveTo(-20, 4); c.lineTo(-27, 7 + Math.sin(t * 2.5) * 0.6); c.lineTo(-19, 8); c.closePath(); });
    // голова медленно высовывается и прячется, при ударе кусает
    const out = Math.sin(t * 0.7) * 1.6 + hit * 5;
    part(15, 2, -hit * 0.15, out, Math.sin(t * 1.9) * 0.4, () => {
      sh(lin(skin, 14, 30), () => { c.moveTo(14, 0); c.quadraticCurveTo(20, -8, 26, -6); c.quadraticCurveTo(31, -3, 27, 2); c.quadraticCurveTo(21, 4, 15, 5); c.closePath(); });
      lid(25, -3.5, 1.3, ink);
      c.beginPath(); c.moveTo(26.5, 0.5); c.lineTo(30, -0.5 + hit * 2); c.stroke();
    });
    // панцирь: купол с краем
    const lift = breath * 0.4;
    sh(shellD, () => c.ellipse(-2, 3, 21, 7, 0, 0, 7));
    sh(lin(shell, -22, 18), () => { c.moveTo(-22, 3); c.quadraticCurveTo(-20, -19 - lift, -2, -20 - lift); c.quadraticCurveTo(16, -19 - lift, 18, 3); c.closePath(); });
    // пластины
    c.fillStyle = plate;
    c.strokeStyle = shellD;
    c.lineWidth = 1.4;
    const plates: [number, number, number][] = [[-2, -10, 6], [-12, -5, 4.5], [8, -5, 4.5], [-8, -15, 3.6], [4, -15, 3.6]];
    for (const [px, py, pr] of plates) {
      c.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const xx = px + Math.cos(a) * pr, yy = py - lift * 0.7 + Math.sin(a) * pr * 0.8; if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy); }
      c.closePath(); c.fill(); c.stroke();
    }
    // мох на панцире светится
    const mk = 0.4 + Math.sin(t * 1.6) * 0.2;
    c.fillStyle = `rgba(200,255,170,${mk})`;
    c.beginPath(); c.arc(-2, -10 - lift, 2, 0, 7); c.arc(-12, -5 - lift, 1.4, 0, 7); c.arc(8, -5 - lift, 1.4, 0, 7); c.fill();
    c.strokeStyle = ink; c.lineWidth = 1.6;
    for (const sx of [-17, -9, 5, 13]) sh('#e8dcc0', () => { c.moveTo(sx - 2.5, 1); c.lineTo(sx, 6); c.lineTo(sx + 2.5, 1); c.closePath(); });
    c.beginPath(); c.moveTo(-22, 3); c.quadraticCurveTo(-20, -19 - lift, -2, -20 - lift); c.quadraticCurveTo(16, -19 - lift, 18, 3); c.stroke();
  } else {
    // Лорд: рогатый демон с крыльями, вид спереди. Крылья машут, при ударе вскидывает когти.
    shadow(26, 14);
    const hide = '#9566dc', hideD = '#5f3d9e', armor = '#3a2f52', gold = '#f3c85a', wing = '#7048b0';
    const flap = Math.sin(t * 2.6) * 0.2 + hit * 0.25;
    for (const s of [-1, 1]) {
      part(s * 8, -12, -s * flap, 0, 0, () => {
        sh(lin(wing, s < 0 ? -33 : 8, s < 0 ? -8 : 33), () => {
          c.moveTo(s * 8, -12);
          c.lineTo(s * 30, -30);
          c.lineTo(s * 33, -6);
          c.quadraticCurveTo(s * 28, -10, s * 25, -2);
          c.quadraticCurveTo(s * 21, -8, s * 17, 0);
          c.quadraticCurveTo(s * 14, -6, s * 9, 0);
          c.closePath();
        });
        c.strokeStyle = 'rgba(20,18,28,.6)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(s * 9, -11); c.lineTo(s * 25, -2); c.moveTo(s * 9, -11); c.lineTo(s * 17, 0); c.moveTo(s * 9, -11); c.lineTo(s * 33, -6); c.stroke();
        c.strokeStyle = ink; c.lineWidth = 1.6;
      });
    }
    // ноги
    sh(hideD, () => { c.rect(-9, 4, 6, 9); c.rect(3, 4, 6, 9); });
    sh('#e8dcc0', () => { c.moveTo(-10, 13); c.lineTo(-8, 15); c.lineTo(-6, 13); c.moveTo(2, 13); c.lineTo(4, 15); c.lineTo(6, 13); });
    // туловище и доспех
    sh(lin(hide, -13, 13), () => { c.moveTo(-11, 6); c.quadraticCurveTo(-14, -10 - breath * 0.4, -9, -16); c.lineTo(9, -16); c.quadraticCurveTo(14, -10 - breath * 0.4, 11, 6); c.closePath(); });
    sh(armor, () => { c.moveTo(-7, -14); c.lineTo(7, -14); c.lineTo(5, 2); c.lineTo(0, 5); c.lineTo(-5, 2); c.closePath(); });
    // самоцвет на груди пульсирует
    const gk = 0.5 + Math.sin(t * 3) * 0.5;
    const gg = c.createRadialGradient(0, -6, 0, 0, -6, 7);
    gg.addColorStop(0, `rgba(255,230,140,${0.6 * gk})`); gg.addColorStop(1, 'rgba(255,230,140,0)');
    c.fillStyle = gg; c.beginPath(); c.arc(0, -6, 7, 0, 7); c.fill();
    sh(gold, () => { c.moveTo(0, -11); c.lineTo(3, -6); c.lineTo(0, -1); c.lineTo(-3, -6); c.closePath(); });
    // руки с когтями
    for (const s of [-1, 1]) {
      part(s * 9, -14, -s * (hit * 1.1 + Math.sin(t * 1.7 + s) * 0.05), 0, 0, () => {
        sh(hide, () => { c.moveTo(s * 9, -14); c.quadraticCurveTo(s * 19, -10, s * 17, 2); c.lineTo(s * 13, 2); c.quadraticCurveTo(s * 14, -6, s * 8, -8); c.closePath(); });
        sh('#e8dcc0', () => { c.moveTo(s * 13, 2); c.lineTo(s * 13.5, 6); c.lineTo(s * 15, 2.5); c.lineTo(s * 16.5, 6); c.lineTo(s * 17, 2); c.closePath(); });
      });
      sh(armor, () => c.ellipse(s * 11, -14, 5.5, 3.5, s * 0.3, 0, 7));
    }
    // голова, рога, глаза
    const hb = Math.sin(t * 2.2 + 0.7) * 0.4;
    sh(lin(hide, -7, 7), () => c.ellipse(0, -21 + hb, 7, 6.5, 0, 0, 7));
    for (const s of [-1, 1]) sh('#efe6d0', () => { c.moveTo(s * 4, -25 + hb); c.quadraticCurveTo(s * 13, -28 + hb, s * 12, -37 + hb); c.quadraticCurveTo(s * 9, -30 + hb, s * 2, -27 + hb); c.closePath(); });
    sh(armor, () => { c.moveTo(-6, -24 + hb); c.lineTo(0, -29 + hb); c.lineTo(6, -24 + hb); c.lineTo(0, -22 + hb); c.closePath(); });
    // глаза горят, сильнее при ударе
    const ek = Math.min(1, 0.55 + Math.sin(t * 3.3) * 0.2 + hit * 0.5);
    const eg = c.createRadialGradient(0, -21 + hb, 0, 0, -21 + hb, 7);
    eg.addColorStop(0, `rgba(255,211,77,${0.45 * ek})`); eg.addColorStop(1, 'rgba(255,211,77,0)');
    c.fillStyle = eg; c.beginPath(); c.arc(0, -21 + hb, 7, 0, 7); c.fill();
    eye(-2.8, -21 + hb, 1.6, '#ffd34d'); eye(2.8, -21 + hb, 1.6, '#ffd34d');
    c.strokeStyle = ink; c.lineWidth = 1.2;
    const m = hit * 1.6;
    c.beginPath(); c.moveTo(-3, -17 + hb); c.lineTo(-1, -16 + hb + m); c.lineTo(1, -17 + hb); c.lineTo(3, -16 + hb + m); c.stroke();
  }
}

// ---------- стикеры ----------

export interface StickerDef { id: string; name: string; price: number }
/** Стикеры: первые три бесплатные, остальные покупаются за кристаллы (цены сверяются с сервером). */
export const STICKERS: StickerDef[] = [
  { id: 'hi', name: 'Привет!', price: 0 },
  { id: 'gg', name: 'GG', price: 0 },
  { id: 'lol', name: 'Ха-ха', price: 0 },
  { id: 'wow', name: 'Ого!', price: 150 },
  { id: 'angry', name: 'Грр!', price: 150 },
  { id: 'cry', name: 'Эх…', price: 150 },
  { id: 'thumb', name: 'Класс!', price: 150 },
  { id: 'cool', name: 'Круто', price: 200 },
  { id: 'love', name: 'Мир!', price: 200 },
  { id: 'sleep', name: 'Скучно', price: 200 },
  { id: 'skull', name: 'Конец тебе', price: 250 },
  { id: 'crown', name: 'Я король', price: 300 },
];

/** Стикер в квадрате size×size: рожица или значок + подпись. */
export function drawSticker(c: Ctx, id: string, size: number) {
  const s = size / 100;
  c.save();
  c.scale(s, s);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const ink = '#14121c';
  const face = (top: string, bot: string) => {
    const g = c.createLinearGradient(0, 8, 0, 82);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    c.fillStyle = g;
    c.beginPath(); c.arc(50, 45, 36, 0, Math.PI * 2); c.fill();
    c.lineWidth = 4; c.strokeStyle = ink; c.stroke();
    c.fillStyle = 'rgba(255,255,255,.35)';
    c.beginPath(); c.ellipse(38, 26, 12, 6, -0.5, 0, Math.PI * 2); c.fill();
  };
  const yellow = () => face('#ffe27a', '#f0a63a');
  const eyes = (y = 40, r = 4.5) => { c.fillStyle = ink; for (const x of [37, 63]) { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); } };
  const line = (pts: number[], w = 4, col = ink) => {
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    c.stroke();
  };
  const caption = (text: string, col = '#f3ead6') => {
    c.font = `800 ${text.length > 7 ? 13 : 16}px system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineWidth = 5; c.strokeStyle = ink;
    c.strokeText(text, 50, 91);
    c.fillStyle = col;
    c.fillText(text, 50, 91);
  };
  const def = STICKERS.find((x) => x.id === id);
  switch (id) {
    case 'hi': {
      yellow(); eyes();
      c.lineWidth = 4; c.strokeStyle = ink; c.beginPath(); c.arc(50, 50, 15, 0.15 * Math.PI, 0.85 * Math.PI); c.stroke();
      // машущая ладонь
      c.fillStyle = '#ffd36b';
      c.beginPath(); c.ellipse(84, 30, 9, 11, 0.3, 0, Math.PI * 2); c.fill(); c.lineWidth = 3; c.stroke();
      for (const [x, y] of [[78, 16], [85, 15], [91, 19]]) { c.beginPath(); c.ellipse(x, y, 3, 6, 0.2, 0, Math.PI * 2); c.fill(); c.stroke(); }
      line([72, 12, 68, 8], 2.5, '#fff'); line([96, 26, 100, 24], 2.5, '#fff');
      break;
    }
    case 'gg': {
      // щит с надписью
      const g = c.createLinearGradient(0, 10, 0, 80);
      g.addColorStop(0, '#7fe0d0'); g.addColorStop(1, '#1f6f68');
      c.fillStyle = g;
      c.beginPath(); c.moveTo(50, 8); c.lineTo(84, 18); c.lineTo(80, 52); c.quadraticCurveTo(70, 72, 50, 80); c.quadraticCurveTo(30, 72, 20, 52); c.lineTo(16, 18); c.closePath(); c.fill();
      c.lineWidth = 4; c.strokeStyle = ink; c.stroke();
      c.font = '900 34px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = 6; c.strokeStyle = ink; c.strokeText('GG', 50, 44);
      c.fillStyle = '#fff6d8'; c.fillText('GG', 50, 44);
      break;
    }
    case 'lol': {
      yellow();
      line([31, 38, 39, 34, 44, 39]); line([56, 39, 61, 34, 69, 38]);
      c.fillStyle = '#7a2230'; c.beginPath(); c.moveTo(30, 50); c.quadraticCurveTo(50, 80, 70, 50); c.closePath(); c.fill(); c.lineWidth = 4; c.strokeStyle = ink; c.stroke();
      c.fillStyle = '#ff8fa0'; c.beginPath(); c.ellipse(50, 62, 9, 5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#7cc8f0'; for (const x of [22, 78]) { c.beginPath(); c.ellipse(x, 46, 4, 7, 0, 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'wow': {
      yellow();
      c.fillStyle = '#fff'; for (const x of [37, 63]) { c.beginPath(); c.arc(x, 38, 8, 0, Math.PI * 2); c.fill(); c.lineWidth = 3; c.strokeStyle = ink; c.stroke(); }
      eyes(39, 3.5);
      c.fillStyle = '#7a2230'; c.beginPath(); c.ellipse(50, 61, 7, 9, 0, 0, Math.PI * 2); c.fill(); c.lineWidth = 3.5; c.stroke();
      line([30, 24, 42, 22], 3.5); line([58, 22, 70, 24], 3.5);
      break;
    }
    case 'angry': {
      face('#ff9a7a', '#d9473e');
      line([28, 30, 44, 37]); line([56, 37, 72, 30]); eyes(42, 4);
      line([36, 64, 50, 57, 64, 64]);
      c.fillStyle = 'rgba(255,255,255,.8)';
      for (const [x, y] of [[80, 14], [88, 20]]) { c.beginPath(); c.ellipse(x, y, 6, 3, 0.6, 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'cry': {
      face('#bfe0ff', '#6f9cff');
      line([30, 41, 42, 35]); line([58, 35, 70, 41]); eyes(45, 3.5);
      c.lineWidth = 4; c.strokeStyle = ink; c.beginPath(); c.arc(50, 70, 11, 1.15 * Math.PI, 1.85 * Math.PI); c.stroke();
      c.fillStyle = '#4fb3ff';
      for (const x of [34, 66]) { c.beginPath(); c.moveTo(x, 48); c.quadraticCurveTo(x - 6, 62, x, 66); c.quadraticCurveTo(x + 6, 62, x, 48); c.fill(); }
      break;
    }
    case 'thumb': {
      // большой палец
      c.fillStyle = '#ffd36b'; c.strokeStyle = ink; c.lineWidth = 4;
      c.beginPath(); c.moveTo(30, 44); c.lineTo(46, 44); c.lineTo(52, 14); c.quadraticCurveTo(62, 12, 62, 24); c.lineTo(60, 40); c.lineTo(76, 40);
      c.quadraticCurveTo(84, 42, 80, 50); c.quadraticCurveTo(84, 56, 78, 60); c.quadraticCurveTo(82, 66, 75, 70); c.quadraticCurveTo(76, 78, 66, 78); c.lineTo(30, 78); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#5fd4c4'; c.beginPath(); c.rect(14, 42, 16, 38); c.fill(); c.stroke();
      line([80, 50, 66, 50], 3); line([78, 60, 66, 60], 3); line([75, 70, 66, 70], 3);
      break;
    }
    case 'cool': {
      yellow();
      c.fillStyle = ink;
      c.beginPath(); c.moveTo(20, 34); c.lineTo(80, 34); c.lineTo(76, 46); c.quadraticCurveTo(66, 52, 56, 44); c.lineTo(44, 44); c.quadraticCurveTo(34, 52, 24, 46); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.moveTo(28, 38); c.lineTo(34, 38); c.lineTo(30, 44); c.fill();
      c.lineWidth = 4; c.strokeStyle = ink; c.beginPath(); c.moveTo(38, 62); c.quadraticCurveTo(54, 70, 64, 58); c.stroke();
      break;
    }
    case 'love': {
      // сердце
      const g = c.createLinearGradient(0, 12, 0, 80);
      g.addColorStop(0, '#ff8fa8'); g.addColorStop(1, '#d9365a');
      c.fillStyle = g; c.strokeStyle = ink; c.lineWidth = 4;
      c.beginPath(); c.moveTo(50, 78); c.bezierCurveTo(10, 52, 14, 14, 36, 16); c.quadraticCurveTo(46, 17, 50, 28); c.quadraticCurveTo(54, 17, 64, 16); c.bezierCurveTo(86, 14, 90, 52, 50, 78); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = 'rgba(255,255,255,.5)'; c.beginPath(); c.ellipse(34, 28, 7, 4, -0.6, 0, Math.PI * 2); c.fill();
      break;
    }
    case 'sleep': {
      face('#d6cfff', '#9a7bd8');
      line([30, 42, 42, 42]); line([58, 42, 70, 42]);
      c.fillStyle = ink; c.beginPath(); c.ellipse(50, 62, 5, 4, 0, 0, Math.PI * 2); c.fill();
      c.font = '900 16px system-ui, sans-serif'; c.fillStyle = '#fff'; c.strokeStyle = ink; c.lineWidth = 4; c.textAlign = 'center';
      for (const [t, x, y, f] of [['z', 74, 26, 13], ['Z', 85, 17, 18]] as const) { c.font = `900 ${f}px system-ui, sans-serif`; c.strokeText(t, x, y); c.fillText(t, x, y); }
      break;
    }
    case 'skull': {
      c.fillStyle = '#efe6d0'; c.strokeStyle = ink; c.lineWidth = 4;
      c.beginPath(); c.arc(50, 40, 30, Math.PI, 0); c.lineTo(80, 52); c.quadraticCurveTo(80, 62, 68, 62); c.lineTo(66, 74); c.lineTo(34, 74); c.lineTo(32, 62); c.quadraticCurveTo(20, 62, 20, 52); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = ink;
      for (const x of [37, 63]) { c.beginPath(); c.ellipse(x, 45, 8, 9, 0, 0, Math.PI * 2); c.fill(); }
      c.beginPath(); c.moveTo(50, 52); c.lineTo(46, 60); c.lineTo(54, 60); c.closePath(); c.fill();
      for (const x of [42, 50, 58]) line([x, 66, x, 74], 3);
      c.fillStyle = '#ff5a5a'; for (const x of [37, 63]) { c.beginPath(); c.arc(x, 46, 2.5, 0, Math.PI * 2); c.fill(); }
      break;
    }
    case 'crown': {
      yellow(); eyes(46, 4);
      c.lineWidth = 4; c.strokeStyle = ink; c.beginPath(); c.moveTo(38, 60); c.quadraticCurveTo(50, 68, 62, 60); c.stroke();
      c.fillStyle = '#f3c85a'; c.lineWidth = 3.5;
      c.beginPath(); c.moveTo(26, 26); c.lineTo(28, 6); c.lineTo(39, 17); c.lineTo(50, 3); c.lineTo(61, 17); c.lineTo(72, 6); c.lineTo(74, 26); c.closePath(); c.fill(); c.stroke();
      c.fillStyle = '#e0566b'; for (const x of [38, 50, 62]) { c.beginPath(); c.arc(x, 20, 3, 0, Math.PI * 2); c.fill(); }
      break;
    }
  }
  if (def) caption(def.name, id === 'gg' ? '#7fe0d0' : '#f3ead6');
  c.restore();
}

export function stickerURL(id: string, px = 96): string {
  return render('st:' + id + ':' + px, px, (c) => drawSticker(c, id, px));
}
