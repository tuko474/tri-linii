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
 * Рисует героя в координатах «единица = половина высоты фигуры», центр в (0,0).
 * Перед вызовом сделай ctx.translate(x, y) и ctx.scale(R, R), где R — радиус фигуры в пикселях.
 */
export function drawHeroFigure(c: Ctx, def: HeroDef, white = false) {
  const L = def.look;
  const main = white ? '#ffffff' : def.color;
  const dark = white ? '#ffffff' : shade(def.color, -0.45);
  const skin = white ? '#ffffff' : L.skin;
  const trim = white ? '#ffffff' : L.trim;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  // оружие за спиной рисуется до тела
  if (['staff', 'scythe', 'banner', 'totem', 'bow'].includes(L.weapon)) weapon(c, L, main, trim, dark);
  body(c, L, main, dark, skin, trim);
  head(c, L, main, dark, skin, trim);
  if (!['staff', 'scythe', 'banner', 'totem', 'bow'].includes(L.weapon)) weapon(c, L, main, trim, dark);
}

function body(c: Ctx, L: Look, main: string, dark: string, skin: string, trim: string) {
  c.lineWidth = 0.06;
  c.strokeStyle = 'rgba(10,8,16,.85)';
  switch (L.body) {
    case 'robe':
      poly(c, [-0.3, -0.2, 0.3, -0.2, 0.55, 0.85, -0.55, 0.85]);
      c.fillStyle = main; c.fill(); c.stroke();
      c.fillStyle = dark;
      poly(c, [-0.08, -0.2, 0.08, -0.2, 0.16, 0.85, -0.16, 0.85]); c.fill();
      c.fillStyle = trim;
      c.fillRect(-0.38, 0.28, 0.76, 0.08);
      break;
    case 'hood':
      poly(c, [-0.32, -0.25, 0.32, -0.25, 0.48, 0.85, 0, 0.7, -0.48, 0.85]);
      c.fillStyle = dark; c.fill(); c.stroke();
      poly(c, [-0.2, -0.2, 0.2, -0.2, 0.26, 0.55, -0.26, 0.55]);
      c.fillStyle = main; c.fill();
      c.fillStyle = trim; c.fillRect(-0.27, 0.2, 0.54, 0.07);
      break;
    case 'armor':
      c.fillStyle = dark;
      c.fillRect(-0.3, 0.45, 0.22, 0.42); c.fillRect(0.08, 0.45, 0.22, 0.42);
      poly(c, [-0.4, -0.22, 0.4, -0.22, 0.34, 0.55, -0.34, 0.55]);
      c.fillStyle = main; c.fill(); c.stroke();
      c.fillStyle = trim; c.fillRect(-0.36, 0.3, 0.72, 0.09);
      disc(c, -0.42, -0.14, 0.17, trim); disc(c, 0.42, -0.14, 0.17, trim);
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.04;
      c.beginPath(); c.moveTo(0, -0.18); c.lineTo(0, 0.28); c.stroke();
      break;
    case 'beast':
      c.fillStyle = dark;
      c.beginPath(); c.ellipse(-0.2, 0.7, 0.16, 0.2, 0, 0, 7); c.ellipse(0.2, 0.7, 0.16, 0.2, 0, 0, 7); c.fill();
      c.beginPath(); c.ellipse(0, 0.2, 0.52, 0.48, 0, 0, Math.PI * 2);
      c.fillStyle = skin; c.fill(); c.stroke();
      c.beginPath(); c.ellipse(0, 0.28, 0.3, 0.3, 0, 0, Math.PI * 2);
      c.fillStyle = shade(skin.startsWith('#') ? skin : '#888888', 0.25); c.fill();
      c.fillStyle = main; c.fillRect(-0.48, 0.12, 0.96, 0.1);
      break;
    case 'bones':
      c.strokeStyle = skin; c.lineWidth = 0.09;
      c.beginPath(); c.moveTo(0, -0.2); c.lineTo(0, 0.5); c.stroke();
      for (let i = 0; i < 4; i++) {
        const y = -0.1 + i * 0.13;
        const w = 0.32 - i * 0.04;
        c.beginPath(); c.moveTo(-w, y + 0.05); c.quadraticCurveTo(0, y - 0.06, w, y + 0.05); c.stroke();
      }
      c.beginPath(); c.moveTo(-0.18, 0.5); c.lineTo(-0.24, 0.88); c.moveTo(0.18, 0.5); c.lineTo(0.24, 0.88); c.stroke();
      c.fillStyle = main; c.fillRect(-0.24, 0.45, 0.48, 0.1);
      break;
    case 'stone':
      poly(c, [-0.55, -0.15, -0.2, -0.35, 0.3, -0.3, 0.6, -0.05, 0.55, 0.6, 0.15, 0.88, -0.35, 0.82, -0.62, 0.45]);
      c.fillStyle = skin; c.fill(); c.stroke();
      c.strokeStyle = 'rgba(0,0,0,.35)'; c.lineWidth = 0.04;
      c.beginPath(); c.moveTo(-0.3, -0.1); c.lineTo(-0.05, 0.25); c.lineTo(-0.2, 0.55); c.moveTo(0.25, 0.05); c.lineTo(0.38, 0.4); c.stroke();
      disc(c, 0.05, 0.1, 0.07, trim); disc(c, -0.3, 0.4, 0.05, trim); disc(c, 0.35, 0.55, 0.05, trim);
      break;
  }
}

function head(c: Ctx, L: Look, main: string, dark: string, skin: string, trim: string) {
  const hy = L.body === 'stone' ? -0.42 : -0.45;
  const hr = L.body === 'stone' ? 0.2 : 0.23;
  c.lineWidth = 0.05;
  c.strokeStyle = 'rgba(10,8,16,.85)';
  if (L.head === 'skull') {
    c.beginPath(); c.arc(0, hy, hr, 0, Math.PI * 2); c.fillStyle = skin; c.fill(); c.stroke();
    disc(c, -0.08, hy - 0.01, 0.06, '#1a1622'); disc(c, 0.08, hy - 0.01, 0.06, '#1a1622');
    disc(c, -0.08, hy - 0.01, 0.025, trim); disc(c, 0.08, hy - 0.01, 0.025, trim);
    c.fillStyle = '#1a1622'; c.fillRect(-0.07, hy + 0.1, 0.14, 0.04);
    return;
  }
  if (L.head === 'hood') {
    c.beginPath(); c.moveTo(-0.3, hy + 0.2); c.quadraticCurveTo(-0.3, hy - 0.38, 0, hy - 0.36); c.quadraticCurveTo(0.3, hy - 0.38, 0.3, hy + 0.2); c.closePath();
    c.fillStyle = dark; c.fill(); c.stroke();
    c.beginPath(); c.arc(0, hy + 0.02, 0.16, 0, Math.PI * 2); c.fillStyle = '#0d0b14'; c.fill();
    disc(c, -0.06, hy, 0.035, '#bff7a0'); disc(c, 0.06, hy, 0.035, '#bff7a0');
    return;
  }
  if (L.head === 'mane') {
    c.beginPath(); c.arc(0, hy, hr + 0.12, 0, Math.PI * 2); c.fillStyle = dark; c.fill();
  }
  c.beginPath(); c.arc(0, hy, hr, 0, Math.PI * 2); c.fillStyle = skin; c.fill(); c.stroke();
  // глаза
  const eye = L.body === 'stone' ? trim : '#1a1622';
  disc(c, -0.075, hy, 0.035, eye); disc(c, 0.075, hy, 0.035, eye);
  switch (L.head) {
    case 'pointy':
      poly(c, [-0.3, hy - 0.1, 0.3, hy - 0.1, 0.08, hy - 0.62]);
      c.fillStyle = main; c.fill(); c.stroke();
      c.fillStyle = trim; c.fillRect(-0.3, hy - 0.15, 0.6, 0.07);
      disc(c, 0.08, hy - 0.62, 0.05, trim);
      break;
    case 'crown':
      poly(c, [-0.22, hy - 0.14, -0.22, hy - 0.34, -0.11, hy - 0.22, 0, hy - 0.38, 0.11, hy - 0.22, 0.22, hy - 0.34, 0.22, hy - 0.14]);
      c.fillStyle = '#f3d27a'; c.fill(); c.stroke();
      // борода
      c.beginPath(); c.moveTo(-0.17, hy + 0.08); c.quadraticCurveTo(0, hy + 0.42, 0.17, hy + 0.08); c.fillStyle = '#f2f2f2'; c.fill();
      break;
    case 'horns':
      c.fillStyle = trim; c.strokeStyle = 'rgba(10,8,16,.85)';
      for (const sx of [-1, 1]) {
        c.beginPath();
        c.moveTo(sx * 0.16, hy - 0.14);
        c.quadraticCurveTo(sx * 0.42, hy - 0.2, sx * 0.4, hy - 0.48);
        c.quadraticCurveTo(sx * 0.3, hy - 0.26, sx * 0.08, hy - 0.2);
        c.closePath(); c.fill(); c.stroke();
      }
      break;
    case 'cap':
      c.beginPath(); c.arc(0, hy - 0.06, hr, Math.PI, 0); c.fillStyle = dark; c.fill();
      c.fillStyle = dark; c.fillRect(-0.02, hy - 0.08, 0.36, 0.06);
      // монокль-прицел
      c.strokeStyle = trim; c.lineWidth = 0.04; c.beginPath(); c.arc(0.075, hy, 0.07, 0, Math.PI * 2); c.stroke();
      break;
    case 'mask':
      c.beginPath(); c.ellipse(0, hy + 0.02, 0.2, 0.26, 0, 0, Math.PI * 2); c.fillStyle = trim; c.fill(); c.stroke();
      disc(c, -0.075, hy - 0.02, 0.045, '#1a1622'); disc(c, 0.075, hy - 0.02, 0.045, '#1a1622');
      c.strokeStyle = '#1a1622'; c.lineWidth = 0.03;
      c.beginPath(); c.moveTo(-0.1, hy + 0.13); c.lineTo(0.1, hy + 0.13); c.stroke();
      for (const sx of [-1, 1]) { c.fillStyle = main; poly(c, [sx * 0.16, hy - 0.2, sx * 0.3, hy - 0.5, sx * 0.24, hy - 0.16]); c.fill(); }
      break;
    case 'flame':
      for (let i = -2; i <= 2; i++) {
        c.fillStyle = i % 2 ? '#ffd25a' : '#ff6a2a';
        poly(c, [i * 0.09 - 0.07, hy - 0.12, i * 0.09 + 0.07, hy - 0.12, i * 0.11, hy - 0.42 - (2 - Math.abs(i)) * 0.06]);
        c.fill();
      }
      break;
    case 'helm':
      c.beginPath(); c.arc(0, hy - 0.02, hr + 0.04, Math.PI, 0); c.lineTo(hr + 0.04, hy + 0.06); c.lineTo(-hr - 0.04, hy + 0.06); c.closePath();
      c.fillStyle = '#b8bec8'; c.fill(); c.stroke();
      c.fillStyle = '#1a1622'; c.fillRect(-0.15, hy - 0.04, 0.3, 0.05);
      poly(c, [-0.03, hy - 0.26, 0.03, hy - 0.26, 0.0, hy - 0.5]); c.fillStyle = trim; c.fill();
      break;
    case 'mane':
      c.fillStyle = trim; disc(c, -0.06, hy + 0.12, 0.03, trim); disc(c, 0.06, hy + 0.12, 0.03, trim);
      disc(c, -0.2, hy - 0.2, 0.07, dark); disc(c, 0.2, hy - 0.2, 0.07, dark);
      break;
  }
}

function weapon(c: Ctx, L: Look, main: string, trim: string, dark: string) {
  c.lineWidth = 0.08;
  c.strokeStyle = 'rgba(10,8,16,.85)';
  const wood = '#6b4a2a';
  switch (L.weapon) {
    case 'staff':
      c.strokeStyle = wood; c.lineWidth = 0.08;
      c.beginPath(); c.moveTo(0.55, 0.85); c.lineTo(0.55, -0.7); c.stroke();
      c.fillStyle = trim;
      poly(c, [0.55, -1.0, 0.68, -0.78, 0.55, -0.6, 0.42, -0.78]); c.fill();
      c.strokeStyle = 'rgba(10,8,16,.6)'; c.lineWidth = 0.03; c.stroke();
      break;
    case 'orb': {
      const g = c.createRadialGradient(0.58, 0.05, 0.02, 0.58, 0.05, 0.24);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, trim); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0.58, 0.05, 0.26, 0, Math.PI * 2); c.fill();
      disc(c, 0.58, 0.05, 0.1, main);
      break;
    }
    case 'axe':
      c.strokeStyle = wood; c.lineWidth = 0.08;
      c.beginPath(); c.moveTo(0.35, 0.75); c.lineTo(0.7, -0.45); c.stroke();
      c.beginPath(); c.moveTo(0.62, -0.2); c.quadraticCurveTo(1.0, -0.35, 0.82, -0.72); c.quadraticCurveTo(0.72, -0.45, 0.6, -0.42); c.closePath();
      c.fillStyle = trim; c.fill(); c.strokeStyle = 'rgba(10,8,16,.85)'; c.lineWidth = 0.04; c.stroke();
      break;
    case 'bow':
      c.strokeStyle = wood; c.lineWidth = 0.07;
      c.beginPath(); c.arc(0.25, 0.05, 0.62, -1.0, 1.0); c.stroke();
      c.strokeStyle = '#e8e8e8'; c.lineWidth = 0.02;
      c.beginPath(); c.moveTo(0.25 + Math.cos(-1) * 0.62, 0.05 + Math.sin(-1) * 0.62); c.lineTo(0.25 + Math.cos(1) * 0.62, 0.05 + Math.sin(1) * 0.62); c.stroke();
      c.strokeStyle = trim; c.lineWidth = 0.04;
      c.beginPath(); c.moveTo(0.3, 0.05); c.lineTo(0.95, 0.05); c.stroke();
      break;
    case 'rifle':
      c.save(); c.translate(0.2, 0.15); c.rotate(-0.5);
      c.fillStyle = wood; c.fillRect(-0.2, -0.06, 0.4, 0.14);
      c.fillStyle = '#3a3a44'; c.fillRect(0.15, -0.04, 0.75, 0.07);
      c.fillStyle = trim; c.fillRect(0.3, -0.12, 0.18, 0.07);
      c.restore();
      break;
    case 'club':
      c.save(); c.translate(0.55, 0.2); c.rotate(0.35);
      poly(c, [-0.06, 0.55, 0.06, 0.55, 0.16, -0.55, -0.16, -0.55]);
      c.fillStyle = trim; c.fill(); c.strokeStyle = 'rgba(10,8,16,.85)'; c.lineWidth = 0.04; c.stroke();
      c.restore();
      break;
    case 'scythe':
      c.strokeStyle = wood; c.lineWidth = 0.07;
      c.beginPath(); c.moveTo(0.5, 0.85); c.lineTo(0.62, -0.75); c.stroke();
      c.beginPath(); c.moveTo(0.62, -0.72); c.quadraticCurveTo(0.2, -0.95, -0.15, -0.6); c.quadraticCurveTo(0.25, -0.72, 0.6, -0.55); c.closePath();
      c.fillStyle = '#c8d0d8'; c.fill(); c.strokeStyle = 'rgba(10,8,16,.85)'; c.lineWidth = 0.03; c.stroke();
      break;
    case 'claws':
      c.strokeStyle = trim; c.lineWidth = 0.05;
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) {
        c.beginPath(); c.moveTo(sx * (0.5 + i * 0.06), 0.15); c.lineTo(sx * (0.62 + i * 0.07), -0.12); c.stroke();
      }
      break;
    case 'hammer':
      c.strokeStyle = wood; c.lineWidth = 0.08;
      c.beginPath(); c.moveTo(0.4, 0.75); c.lineTo(0.62, -0.35); c.stroke();
      c.save(); c.translate(0.64, -0.42); c.rotate(0.2);
      c.fillStyle = trim; c.fillRect(-0.22, -0.13, 0.44, 0.26);
      c.strokeStyle = 'rgba(10,8,16,.85)'; c.lineWidth = 0.04; c.strokeRect(-0.22, -0.13, 0.44, 0.26);
      c.restore();
      // щит
      c.beginPath(); c.moveTo(-0.62, -0.1); c.lineTo(-0.3, -0.1); c.lineTo(-0.3, 0.3); c.quadraticCurveTo(-0.46, 0.55, -0.62, 0.3); c.closePath();
      c.fillStyle = '#e8e8f0'; c.fill(); c.strokeStyle = 'rgba(10,8,16,.85)'; c.stroke();
      c.fillStyle = trim; c.fillRect(-0.49, -0.05, 0.06, 0.3); c.fillRect(-0.57, 0.05, 0.22, 0.06);
      break;
    case 'banner':
      c.strokeStyle = wood; c.lineWidth = 0.07;
      c.beginPath(); c.moveTo(0.55, 0.85); c.lineTo(0.55, -0.95); c.stroke();
      poly(c, [0.55, -0.92, 1.0, -0.82, 0.88, -0.62, 1.0, -0.42, 0.55, -0.48]);
      c.fillStyle = trim; c.fill(); c.strokeStyle = 'rgba(10,8,16,.6)'; c.lineWidth = 0.03; c.stroke();
      disc(c, 0.55, -0.98, 0.05, '#f3d27a');
      break;
    case 'fist':
      disc(c, 0.62, 0.15, 0.2, dark === '#ffffff' ? dark : L.skin);
      c.strokeStyle = 'rgba(10,8,16,.85)'; c.lineWidth = 0.04; c.beginPath(); c.arc(0.62, 0.15, 0.2, 0, Math.PI * 2); c.stroke();
      disc(c, -0.62, 0.15, 0.17, dark === '#ffffff' ? dark : L.skin);
      break;
    case 'totem':
      c.strokeStyle = wood; c.lineWidth = 0.08;
      c.beginPath(); c.moveTo(0.55, 0.85); c.lineTo(0.55, -0.55); c.stroke();
      c.strokeStyle = '#5fc9a8'; c.lineWidth = 0.08;
      c.beginPath(); c.moveTo(0.55, -0.3); c.bezierCurveTo(0.8, -0.45, 0.3, -0.6, 0.6, -0.8); c.stroke();
      disc(c, 0.62, -0.84, 0.08, '#5fc9a8');
      disc(c, 0.64, -0.86, 0.02, '#ffd25a');
      break;
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
 */
export function drawBeastFigure(c: Ctx, kind: string) {
  const ink = '#14121c';
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = ink;
  c.lineWidth = 1.6;
  const sh = (fill: string, path: () => void, stroke = true) => {
    c.beginPath(); path(); c.fillStyle = fill; c.fill(); if (stroke) c.stroke();
  };
  const eye = (x: number, y: number, r: number, col: string) => {
    c.fillStyle = col; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  };
  const shadow = (rx: number, y = 12) => {
    c.fillStyle = 'rgba(0,0,0,.32)'; c.beginPath(); c.ellipse(0, y, rx, rx * 0.25, 0, 0, 7); c.fill();
  };

  if (kind === 'wolf') {
    shadow(16);
    const fur = '#8f939c', furD = '#5d616b', belly = '#c9ccd2';
    // дальние лапы и хвост
    sh(furD, () => { c.rect(-9, 3, 3.5, 9); c.rect(6, 3, 3.5, 9); });
    sh(fur, () => { c.moveTo(-12, -2); c.quadraticCurveTo(-21, -4, -22, -12); c.quadraticCurveTo(-17, -6, -11, -5); c.closePath(); });
    // тело
    sh(fur, () => c.ellipse(-1, -1, 12, 6.5, -0.05, 0, 7));
    sh(belly, () => c.ellipse(0, 2.5, 8, 2.6, 0, 0, 7), false);
    // ближние лапы
    sh(fur, () => { c.rect(-6, 3, 3.5, 9); c.rect(8.5, 3, 3.5, 9); });
    // голова с мордой и ушами
    sh(fur, () => { c.moveTo(7, -9); c.lineTo(9, -16); c.lineTo(12, -10); c.closePath(); });
    sh(fur, () => c.ellipse(12, -6, 6, 5, 0, 0, 7));
    sh(fur, () => { c.moveTo(15, -8); c.lineTo(22, -5); c.lineTo(21, -2); c.lineTo(15, -2); c.closePath(); });
    sh(furD, () => { c.moveTo(11, -11); c.lineTo(13, -17); c.lineTo(15, -10); c.closePath(); });
    eye(21.5, -4.6, 1.2, ink);
    eye(15, -7, 1.4, '#ffd34d');
  } else if (kind === 'boar') {
    shadow(16);
    const hide = '#7a5236', hideD = '#4f3423', mane = '#2f2119';
    sh(hideD, () => { c.rect(-9, 4, 4, 8); c.rect(5, 4, 4, 8); });
    sh(hide, () => c.ellipse(-1, -1, 13, 9, 0, 0, 7));
    // щетина по хребту
    sh(mane, () => { c.moveTo(-12, -4); for (let i = 0; i < 6; i++) { c.lineTo(-10 + i * 3.6, -13 + (i % 2) * 3); } c.lineTo(9, -5); c.closePath(); });
    sh(hide, () => { c.rect(-6, 4, 4, 8); c.rect(8, 4, 4, 8); });
    // голова-рыло
    sh(hide, () => c.ellipse(12, -1, 7, 6.5, 0, 0, 7));
    sh('#c98d74', () => c.ellipse(19, 1, 3, 3.6, 0, 0, 7));
    eye(18.4, 0.4, 0.7, ink); eye(19.8, 1.8, 0.7, ink);
    sh('#f3ead6', () => { c.moveTo(15, 3); c.quadraticCurveTo(19, 4, 18, -2); c.quadraticCurveTo(17, 2, 15, 1); c.closePath(); });
    sh(hideD, () => { c.moveTo(9, -6); c.lineTo(8, -12); c.lineTo(12, -7); c.closePath(); });
    eye(13.5, -3, 1.4, '#ff6b4a');
  } else if (kind === 'spider') {
    shadow(17);
    const body = '#5a4580', bodyL = '#7d65a8';
    c.lineWidth = 2.4;
    c.strokeStyle = '#2e2440';
    for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const a = -0.9 + i * 0.55;
      c.beginPath();
      c.moveTo(2 * s, 0);
      c.quadraticCurveTo(s * (10 + i * 2), -10 + i * 3, s * (16 + i * 1.5), 10 - Math.abs(a) * 2);
      c.stroke();
    }
    c.strokeStyle = ink;
    c.lineWidth = 1.6;
    sh(body, () => c.ellipse(-4, -2, 10, 8, 0, 0, 7));
    sh('#c23a4c', () => { c.moveTo(-4, -8); c.lineTo(-1, -3); c.lineTo(-4, 2); c.lineTo(-7, -3); c.closePath(); }, false); // знак на спине
    sh(bodyL, () => c.ellipse(8, 0, 6, 5.5, 0, 0, 7));
    eye(10, -1.6, 1.2, '#ff5a5a'); eye(12, 0.2, 1.1, '#ff5a5a'); eye(8.6, 0.6, 0.9, '#ff5a5a');
    sh('#e8dcc0', () => { c.moveTo(12, 3); c.lineTo(14, 7); c.lineTo(11, 4.5); c.closePath(); });
  } else if (kind === 'turtle') {
    shadow(24, 13);
    const skin = '#7fb86d', shell = '#3f7a45', shellD = '#2b5a33', plate = '#9ccf7e';
    // лапы
    sh(skin, () => { c.ellipse(-15, 8, 5, 4, 0.4, 0, 7); });
    sh(skin, () => { c.ellipse(13, 8, 5, 4, -0.4, 0, 7); });
    // хвост
    sh(skin, () => { c.moveTo(-20, 4); c.lineTo(-27, 7); c.lineTo(-19, 8); c.closePath(); });
    // голова
    sh(skin, () => { c.moveTo(14, 0); c.quadraticCurveTo(20, -8, 26, -6); c.quadraticCurveTo(31, -3, 27, 2); c.quadraticCurveTo(21, 4, 15, 5); c.closePath(); });
    eye(25, -3.5, 1.3, ink);
    c.beginPath(); c.moveTo(27, 0.5); c.lineTo(30, -0.5); c.stroke();
    // панцирь: купол с краем
    sh(shellD, () => c.ellipse(-2, 3, 21, 7, 0, 0, 7));
    sh(shell, () => { c.moveTo(-22, 3); c.quadraticCurveTo(-20, -19, -2, -20); c.quadraticCurveTo(16, -19, 18, 3); c.closePath(); });
    // пластины
    c.fillStyle = plate;
    c.strokeStyle = shellD;
    c.lineWidth = 1.4;
    const plates: [number, number, number][] = [[-2, -10, 6], [-12, -5, 4.5], [8, -5, 4.5], [-8, -15, 3.6], [4, -15, 3.6]];
    for (const [px, py, pr] of plates) {
      c.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; const xx = px + Math.cos(a) * pr, yy = py + Math.sin(a) * pr * 0.8; if (i) c.lineTo(xx, yy); else c.moveTo(xx, yy); }
      c.closePath(); c.fill(); c.stroke();
    }
    // шипы по краю
    c.strokeStyle = ink; c.lineWidth = 1.6;
    for (const sx of [-17, -9, 5, 13]) sh('#e8dcc0', () => { c.moveTo(sx - 2.5, 1); c.lineTo(sx, 6); c.lineTo(sx + 2.5, 1); c.closePath(); });
    c.beginPath(); c.moveTo(-22, 3); c.quadraticCurveTo(-20, -19, -2, -20); c.quadraticCurveTo(16, -19, 18, 3); c.stroke();
  } else {
    // Лорд: рогатый демон с крыльями, вид спереди
    shadow(26, 14);
    const hide = '#9566dc', hideD = '#5f3d9e', armor = '#3a2f52', gold = '#f3c85a', wing = '#7048b0';
    // крылья
    for (const s of [-1, 1]) {
      sh(wing, () => {
        c.moveTo(s * 8, -12);
        c.lineTo(s * 30, -30);
        c.lineTo(s * 33, -6);
        c.quadraticCurveTo(s * 28, -10, s * 25, -2);
        c.quadraticCurveTo(s * 21, -8, s * 17, 0);
        c.quadraticCurveTo(s * 14, -6, s * 9, 0);
        c.closePath();
      });
      c.strokeStyle = 'rgba(20,18,28,.6)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(s * 9, -11); c.lineTo(s * 25, -2); c.moveTo(s * 9, -11); c.lineTo(s * 17, 0); c.stroke();
      c.strokeStyle = ink; c.lineWidth = 1.6;
    }
    // ноги
    sh(hideD, () => { c.rect(-9, 4, 6, 9); c.rect(3, 4, 6, 9); });
    sh('#e8dcc0', () => { c.moveTo(-10, 13); c.lineTo(-8, 15); c.lineTo(-6, 13); c.moveTo(2, 13); c.lineTo(4, 15); c.lineTo(6, 13); });
    // туловище и доспех
    sh(hide, () => { c.moveTo(-11, 6); c.quadraticCurveTo(-14, -10, -9, -16); c.lineTo(9, -16); c.quadraticCurveTo(14, -10, 11, 6); c.closePath(); });
    sh(armor, () => { c.moveTo(-7, -14); c.lineTo(7, -14); c.lineTo(5, 2); c.lineTo(0, 5); c.lineTo(-5, 2); c.closePath(); });
    sh(gold, () => { c.moveTo(0, -11); c.lineTo(3, -6); c.lineTo(0, -1); c.lineTo(-3, -6); c.closePath(); });
    // руки с когтями
    for (const s of [-1, 1]) {
      sh(hide, () => { c.moveTo(s * 9, -14); c.quadraticCurveTo(s * 19, -10, s * 17, 2); c.lineTo(s * 13, 2); c.quadraticCurveTo(s * 14, -6, s * 8, -8); c.closePath(); });
      sh(armor, () => c.ellipse(s * 11, -14, 5.5, 3.5, s * 0.3, 0, 7));
      sh('#e8dcc0', () => { c.moveTo(s * 13, 2); c.lineTo(s * 13.5, 6); c.lineTo(s * 15, 2.5); c.lineTo(s * 16.5, 6); c.lineTo(s * 17, 2); c.closePath(); });
    }
    // голова, рога, глаза
    sh(hide, () => c.ellipse(0, -21, 7, 6.5, 0, 0, 7));
    for (const s of [-1, 1]) sh('#efe6d0', () => { c.moveTo(s * 4, -25); c.quadraticCurveTo(s * 13, -28, s * 12, -37); c.quadraticCurveTo(s * 9, -30, s * 2, -27); c.closePath(); });
    sh(armor, () => { c.moveTo(-6, -24); c.lineTo(0, -29); c.lineTo(6, -24); c.lineTo(0, -22); c.closePath(); });
    eye(-2.8, -21, 1.6, '#ffd34d'); eye(2.8, -21, 1.6, '#ffd34d');
    c.strokeStyle = ink; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(-3, -17); c.lineTo(-1, -16); c.lineTo(1, -17); c.lineTo(3, -16); c.stroke();
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
