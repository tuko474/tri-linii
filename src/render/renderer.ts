// Отрисовка поля на Canvas 2D с камерой. Читает состояние Game, ничего в нём не меняет.
import { BAL, WORLD } from '../data/config';
import { RACES } from '../data/races';
import type { Game } from '../sim/game';
import { ALTAR_POS, CAMPS, GUARD_POS, PITS, RIVER, RIVER_W, THRONE_POS, barracksPos, segDist } from '../sim/map';
import type { Hero, Neutral, Side } from '../sim/types';
import { drawBeastFigure, drawCastleFigure, drawHeroFigure } from './art';
import type { HeroPose } from './art';

const C = {
  grass: '#2f4a33',
  grass2: '#36553a',
  grass3: '#2b4430',
  tree: '#1c3221',
  tree2: '#25412c',
  tree3: '#2f5236',
  road: '#8a7550',
  roadEdge: '#6d5b3d',
  bank: '#5d5a3e',
  river: '#2c5a72',
  river2: '#3b7391',
  stone: '#5b5346',
  stoneDark: '#3b352d',
  plank: '#5e4a2e',
  ink: '#f3ead6',
  dark: '#14121c',
  side: ['#5fd4c4', '#e0566b'],
  sideDeep: ['#1f6f68', '#7c2236'],
};

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const riverDist = (x: number, y: number) => {
  let best = Infinity;
  for (let i = 1; i < RIVER.length; i++) best = Math.min(best, segDist(x, y, RIVER[i - 1], RIVER[i]));
  return best;
};

const BASE_HALF = 260; // половина стороны площадки базы
/** Фон хранится в уменьшенном виде, чтобы широкая карта не съедала память телефона. */
const BG_SCALE = 0.55;

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement = document.createElement('canvas');
  private mini: HTMLCanvasElement = document.createElement('canvas');
  private dpr = 1;
  vw = 0;
  vh = 0;
  cam = { x: 1000, y: 1450, z: 0.4 };
  minZ = 0.15;
  maxZ = 0.9;
  private started = false;
  selected: Hero | null = null;

  /** me — за какую сторону смотрим (0 — снизу слева, 1 — сверху справа). Свои всегда бирюзовые, враги красные. */
  constructor(private cv: HTMLCanvasElement, private g: Game, readonly me: Side = 0) {
    this.ctx = cv.getContext('2d')!;
    this.drawStatic();
  }

  // ---------- камера ----------

  /**
   * Сколько экрана по краям закрыто интерфейсом (CSS px): слева миникарта и кнопки крипов,
   * справа боссы, снизу герои. Камера может заезжать за край карты на эти отступы,
   * чтобы любой угол поля можно было вытащить из-под панелей.
   */
  pad = { l: 170, r: 100, t: 70, b: 140 };

  resize(cssW: number, cssH: number) {
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.vw = cssW;
    this.vh = cssH;
    this.cv.style.width = cssW + 'px';
    this.cv.style.height = cssH + 'px';
    this.cv.width = Math.floor(cssW * this.dpr);
    this.cv.height = Math.floor(cssH * this.dpr);
    const P = this.pad;
    // самое дальнее отдаление — вся карта целиком в свободной от панелей части экрана
    this.minZ = Math.min((cssW - P.l - P.r) / WORLD.W, (cssH - P.t - P.b) / WORLD.H);
    this.maxZ = Math.max(this.minZ * 1.2, Math.min(1.1, cssW / 700));
    if (!this.started) {
      // по умолчанию в кадре ~2300 единиц мира по длинной стороне: своя база и ближние вышки
      this.cam.z = Math.max(cssW, cssH) / 2300;
      const t = THRONE_POS[this.me];
      const k = this.me === 0 ? 1 : -1;
      this.cam.x = t.x + 950 * k;
      this.cam.y = t.y - 520 * k;
      this.started = true;
    }
    this.clamp();
  }

  /** Допустимый центр камеры при масштабе z: карта может уходить под панели, но не дальше. */
  private bounds(z: number) {
    const P = this.pad;
    const hw = this.vw / 2 / z;
    const hh = this.vh / 2 / z;
    let x0 = hw - P.l / z, x1 = WORLD.W - hw + P.r / z;
    let y0 = hh - P.t / z, y1 = WORLD.H - hh + P.b / z;
    if (x0 > x1) x0 = x1 = (x0 + x1) / 2;
    if (y0 > y1) y0 = y1 = (y0 + y1) / 2;
    return { x0, x1, y0, y1 };
  }

  private clampPoint(x: number, y: number, z: number) {
    const b = this.bounds(z);
    return { x: Math.max(b.x0, Math.min(b.x1, x)), y: Math.max(b.y0, Math.min(b.y1, y)) };
  }

  private clamp() {
    const c = this.cam;
    c.z = Math.max(this.minZ, Math.min(this.maxZ, c.z));
    const p = this.clampPoint(c.x, c.y, c.z);
    c.x = p.x;
    c.y = p.y;
  }

  /** 0 — свои, 1 — враги (для цвета). */
  rel(side: Side): 0 | 1 {
    return side === this.me ? 0 : 1;
  }

  /** Перевод координат касания (CSS px внутри canvas) в мировые. */
  toWorld(px: number, py: number) {
    const c = this.cam;
    return { x: c.x + (px - this.vw / 2) / c.z, y: c.y + (py - this.vh / 2) / c.z };
  }

  pan(dx: number, dy: number) {
    this.cam.x -= dx / this.cam.z;
    this.cam.y -= dy / this.cam.z;
    this.tween = null;
    this.clamp();
  }

  /** Масштаб вокруг точки касания: точка под пальцем остаётся на месте. */
  zoomAt(factor: number, px: number, py: number) {
    const w = this.toWorld(px, py);
    this.cam.z *= factor;
    this.clamp();
    this.cam.x = w.x - (px - this.vw / 2) / this.cam.z;
    this.cam.y = w.y - (py - this.vh / 2) / this.cam.z;
    this.tween = null;
    this.clamp();
  }

  /** Мгновенно перевести камеру (миникарта). */
  jump(x: number, y: number) {
    this.tween = null;
    this.cam.x = x;
    this.cam.y = y;
    this.clamp();
  }

  /** Плавно (0,35 с) перевести камеру к точке мира — так, чтобы точка была в свободной части экрана. */
  focus(x: number, y: number) {
    const P = this.pad;
    const z = this.cam.z;
    // центр свободной области смещён относительно центра экрана
    const ox = (P.l - P.r) / 2 / z;
    const oy = (P.t - P.b) / 2 / z;
    const to = this.clampPoint(x - ox, y - oy, z);
    this.tween = { fx: this.cam.x, fy: this.cam.y, tx: to.x, ty: to.y, t: 0 };
  }

  private tween: { fx: number; fy: number; tx: number; ty: number; t: number } | null = null;

  private stepCamera(dt: number) {
    const w = this.tween;
    if (!w) return;
    w.t = Math.min(1, w.t + dt / 0.35);
    const e = 1 - Math.pow(1 - w.t, 3);
    this.cam.x = w.fx + (w.tx - w.fx) * e;
    this.cam.y = w.fy + (w.ty - w.fy) * e;
    if (w.t >= 1) this.tween = null;
  }

  /** Отдалить так, чтобы была видна вся карта, или вернуть обычный масштаб. */
  toggleOverview() {
    const far = this.cam.z <= this.minZ * 1.05;
    this.tween = null;
    if (far) {
      this.cam.z = Math.max(this.vw, this.vh) / 2300;
      const t = THRONE_POS[this.me];
      this.cam.x = t.x + (this.me === 0 ? 950 : -950);
      this.cam.y = t.y + (this.me === 0 ? -520 : 520);
    } else {
      this.cam.z = this.minZ;
      this.cam.x = WORLD.W / 2;
      this.cam.y = WORLD.H / 2;
    }
    this.clamp();
  }

  // ---------- статичный фон ----------

  private drawStatic() {
    const g = this.g;
    const { W, H } = WORLD;
    this.bg.width = Math.ceil(W * BG_SCALE);
    this.bg.height = Math.ceil(H * BG_SCALE);
    const x = this.bg.getContext('2d')!;
    x.scale(BG_SCALE, BG_SCALE);
    const area = (W * H) / (2400 * 2400);

    // земля
    x.fillStyle = C.grass;
    x.fillRect(0, 0, W, H);
    const r = rng(7);
    for (let i = 0; i < 900 * area; i++) {
      x.fillStyle = r() > 0.5 ? C.grass2 : C.grass3;
      x.globalAlpha = 0.7;
      x.beginPath();
      x.arc(r() * W, r() * H, 30 + r() * 90, 0, 7);
      x.fill();
    }
    x.globalAlpha = 1;
    // оттенок территорий
    ([0, 1] as Side[]).forEach((s) => {
      const t = THRONE_POS[s];
      const gr = x.createRadialGradient(t.x, t.y, 100, t.x, t.y, 1500);
      gr.addColorStop(0, this.rel(s) === 0 ? 'rgba(95,212,196,.16)' : 'rgba(224,86,107,.16)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, W, H);
    });

    // река: плавная линия, песчаные берега, глубина к центру, камыши, кувшинки и камни
    x.lineCap = 'round';
    x.lineJoin = 'round';
    const river = () => riverPath(x);
    river();
    x.strokeStyle = '#4f5b3a'; // влажная кромка
    x.lineWidth = RIVER_W + 60;
    x.stroke();
    x.strokeStyle = '#a99a6b'; // песок
    x.lineWidth = RIVER_W + 40;
    x.stroke();
    x.strokeStyle = '#8b7f58';
    x.lineWidth = RIVER_W + 16;
    x.stroke();
    x.strokeStyle = '#2f6a80'; // мелководье
    x.lineWidth = RIVER_W;
    x.stroke();
    x.strokeStyle = C.river;
    x.lineWidth = RIVER_W * 0.72;
    x.stroke();
    x.strokeStyle = '#224e66'; // глубина
    x.lineWidth = RIVER_W * 0.38;
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.18)'; // пена у берегов
    x.lineWidth = 3;
    x.setLineDash([18, 26, 6, 30]);
    for (const off of [-1, 1]) {
      x.save();
      x.beginPath();
      offsetRiver(x, off * (RIVER_W / 2 - 6));
      x.stroke();
      x.restore();
    }
    x.setLineDash([]);
    {
      const rv = rng(17);
      const len = riverLength();
      // камни, камыши и кувшинки вдоль реки (не у мостов)
      for (let i = 0; i < 260; i++) {
        const t = rv() * len;
        const pt = riverAt(t);
        if (g.lanes.some((l) => l.dist(pt.x, pt.y) < 150)) continue;
        const side = rv() > 0.5 ? 1 : -1;
        const kind = rv();
        if (kind < 0.45) {
          // камыши на берегу
          const d = RIVER_W / 2 + 4 + rv() * 14;
          const bx = pt.x + pt.nx * d * side, by = pt.y + pt.ny * d * side;
          x.strokeStyle = rv() > 0.5 ? '#5d7a3a' : '#6e8a45';
          x.lineWidth = 2.2;
          for (let k = 0; k < 4; k++) {
            const ox = (rv() - 0.5) * 14, len2 = 14 + rv() * 16;
            x.beginPath(); x.moveTo(bx + ox, by + 6); x.quadraticCurveTo(bx + ox + 3, by - len2 / 2, bx + ox + (rv() - 0.5) * 8, by - len2); x.stroke();
          }
          x.fillStyle = '#6b4a2a';
          x.beginPath(); x.ellipse(bx + 2, by - 14, 2.5, 6, 0, 0, 7); x.fill();
        } else if (kind < 0.75) {
          // кувшинки на воде у берега
          const d = RIVER_W / 2 - 20 - rv() * 25;
          const lx = pt.x + pt.nx * d * side, ly = pt.y + pt.ny * d * side;
          const rr2 = 9 + rv() * 7;
          x.fillStyle = rv() > 0.4 ? '#4f8a4a' : '#5f9a52';
          x.beginPath(); x.moveTo(lx, ly); x.arc(lx, ly, rr2, 0.3, Math.PI * 2 - 0.2); x.closePath(); x.fill();
          if (rv() > 0.6) { x.fillStyle = '#f2c6d6'; x.beginPath(); x.arc(lx + 2, ly - 2, 3.5, 0, 7); x.fill(); }
        } else {
          // камень в воде
          const d = (rv() - 0.5) * RIVER_W * 0.8;
          const sx2 = pt.x + pt.nx * d, sy2 = pt.y + pt.ny * d;
          const rs = 8 + rv() * 12;
          x.fillStyle = 'rgba(255,255,255,.14)';
          x.beginPath(); x.ellipse(sx2, sy2 + 2, rs * 1.5, rs * 0.7, 0, 0, 7); x.fill();
          x.fillStyle = '#5a5e5f';
          x.beginPath(); x.ellipse(sx2, sy2, rs, rs * 0.7, rv(), 0, 7); x.fill();
          x.fillStyle = '#7b8081';
          x.beginPath(); x.ellipse(sx2 - rs * 0.25, sy2 - rs * 0.2, rs * 0.55, rs * 0.35, 0, 0, 7); x.fill();
        }
      }
    }

    // логова боссов
    for (const p of PITS) {
      x.fillStyle = C.stoneDark;
      x.beginPath();
      x.arc(p.x, p.y, 175, 0, 7);
      x.fill();
      x.fillStyle = '#26303a';
      x.beginPath();
      x.arc(p.x, p.y, 145, 0, 7);
      x.fill();
      x.strokeStyle = 'rgba(243,210,122,.35)';
      x.lineWidth = 4;
      for (let i = 0; i < 3; i++) {
        x.beginPath();
        x.arc(p.x, p.y, 60 + i * 28, 0, 7);
        x.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        x.fillStyle = C.stone;
        x.beginPath();
        x.arc(p.x + Math.cos(a) * 160, p.y + Math.sin(a) * 160, 16, 0, 7);
        x.fill();
      }
      x.fillStyle = 'rgba(243,234,214,.55)';
      x.font = '700 30px Georgia, serif';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(p.name, p.x, p.y);
    }

    // площадки стражей у входа в логова
    for (const gp of GUARD_POS) {
      x.fillStyle = C.stoneDark;
      x.beginPath(); x.arc(gp.x, gp.y + 10, 78, 0, 7); x.fill();
      x.fillStyle = C.stone;
      x.beginPath(); x.arc(gp.x, gp.y + 6, 70, 0, 7); x.fill();
    }

    // лесные поляны
    for (const c of CAMPS) {
      x.fillStyle = '#3d5b3b';
      x.beginPath();
      x.ellipse(c.x, c.y, 85, 70, 0.4, 0, 7);
      x.fill();
      x.fillStyle = '#6b5a3f';
      x.beginPath();
      x.ellipse(c.x, c.y, 34, 26, 0.4, 0, 7);
      x.fill();
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3 + 0.3;
        x.fillStyle = C.stone;
        x.beginPath();
        x.arc(c.x + Math.cos(a) * 72, c.y + Math.sin(a) * 58, 9, 0, 7);
        x.fill();
      }
    }

    // площадки баз
    ([0, 1] as Side[]).forEach((s) => {
      const t = THRONE_POS[s];
      const b = BASE_HALF;
      x.fillStyle = C.stoneDark;
      roundRect(x, t.x - b - 14, t.y - b - 14, (b + 14) * 2, (b + 14) * 2, 70);
      x.fill();
      x.fillStyle = C.stone;
      roundRect(x, t.x - b, t.y - b, b * 2, b * 2, 60);
      x.fill();
      x.save();
      roundRect(x, t.x - b, t.y - b, b * 2, b * 2, 60);
      x.clip();
      x.strokeStyle = 'rgba(0,0,0,.18)';
      x.lineWidth = 2;
      for (let i = -b; i <= b; i += 52) {
        x.beginPath();
        x.moveTo(t.x + i, t.y - b);
        x.lineTo(t.x + i, t.y + b);
        x.moveTo(t.x - b, t.y + i);
        x.lineTo(t.x + b, t.y + i);
        x.stroke();
      }
      x.restore();
      x.strokeStyle = C.side[this.rel(s)];
      x.lineWidth = 6;
      x.globalAlpha = 0.6;
      roundRect(x, t.x - b + 10, t.y - b + 10, (b - 10) * 2, (b - 10) * 2, 52);
      x.stroke();
      x.globalAlpha = 1;
      // источник в углу базы — место возрождения
      const fx = s === 0 ? t.x - 150 : t.x + 150;
      const fy = s === 0 ? t.y + 150 : t.y - 150;
      x.fillStyle = C.stoneDark;
      x.beginPath();
      x.arc(fx, fy, 62, 0, 7);
      x.fill();
      x.fillStyle = this.rel(s) === 0 ? '#3aa79a' : '#b8465a';
      x.beginPath();
      x.arc(fx, fy, 48, 0, 7);
      x.fill();
      x.fillStyle = 'rgba(255,255,255,.35)';
      x.beginPath();
      x.arc(fx - 12, fy - 12, 14, 0, 7);
      x.fill();
    });

    // лес: деревья везде, кроме дорог, реки, баз, полян и логов. Сначала собираем места, потом рисуем сверху вниз,
    // чтобы нижние деревья перекрывали верхние; под лесом — тёмная подстилка
    const tr = rng(42);
    const spots = [...ALTAR_POS, ...[0, 1, 2].flatMap((l) => [barracksPos(g.lanes, l, 0), barracksPos(g.lanes, l, 1)])];
    const trees: { x: number; y: number; s: number; k: number; c: number }[] = [];
    for (let i = 0; i < 5600 * area; i++) {
      const px = tr() * W;
      const py = tr() * H;
      const s = 16 + tr() * 24;
      const k = tr(); // вид: <0.62 лиственное, <0.88 ёлка, иначе куст
      const c = tr();
      const free =
        g.lanes.every((l) => l.dist(px, py) > 92 + s) &&
        riverDist(px, py) > RIVER_W / 2 + 34 + s &&
        THRONE_POS.every((t) => Math.max(Math.abs(t.x - px), Math.abs(t.y - py)) > BASE_HALF + 30 + s) &&
        CAMPS.every((cc) => Math.hypot(cc.x - px, cc.y - py) > 100 + s) &&
        PITS.every((pp) => Math.hypot(pp.x - px, pp.y - py) > 195 + s) &&
        GUARD_POS.every((pp) => Math.hypot(pp.x - px, pp.y - py) > 110 + s) &&
        spots.every((pp) => Math.hypot(pp.x - px, pp.y - py) > 85 + s);
      if (free) trees.push({ x: px, y: py, s, k, c });
    }
    // подстилка: тёмные пятна под кронами
    x.fillStyle = 'rgba(16,30,20,.35)';
    for (const t of trees) { x.beginPath(); x.arc(t.x + 4, t.y + 10, t.s * 1.5, 0, 7); x.fill(); }
    trees.sort((p1, p2) => p1.y - p2.y);
    for (const t of trees) {
      const { s: sz } = t;
      x.fillStyle = 'rgba(0,0,0,.28)';
      x.beginPath(); x.ellipse(t.x + 7, t.y + sz * 0.55, sz * 0.95, sz * 0.5, 0, 0, 7); x.fill();
      if (t.k < 0.62) {
        // лиственное: ствол и пышная крона из трёх кругов, светлый край сверху-слева
        x.fillStyle = '#4a3522';
        x.fillRect(t.x - 3, t.y, 6, sz * 0.5);
        const base = t.c < 0.33 ? C.tree : t.c < 0.66 ? '#21402a' : '#263a24';
        const mid = t.c < 0.5 ? C.tree2 : '#2d4d2a';
        const top = t.c < 0.5 ? C.tree3 : '#3a5e33';
        x.fillStyle = base;
        x.beginPath(); x.arc(t.x - sz * 0.35, t.y - sz * 0.1, sz * 0.7, 0, 7); x.arc(t.x + sz * 0.35, t.y - sz * 0.05, sz * 0.7, 0, 7); x.arc(t.x, t.y - sz * 0.45, sz * 0.78, 0, 7); x.fill();
        x.fillStyle = mid;
        x.beginPath(); x.arc(t.x - sz * 0.15, t.y - sz * 0.5, sz * 0.55, 0, 7); x.fill();
        x.fillStyle = top;
        x.beginPath(); x.arc(t.x - sz * 0.3, t.y - sz * 0.65, sz * 0.3, 0, 7); x.fill();
      } else if (t.k < 0.88) {
        // ёлка: три яруса треугольников
        x.fillStyle = '#3e2c1c';
        x.fillRect(t.x - 2.5, t.y + sz * 0.1, 5, sz * 0.45);
        const dark = t.c < 0.5 ? '#16301f' : '#1a3624';
        const light = t.c < 0.5 ? '#244a30' : '#2a5236';
        for (let j = 0; j < 3; j++) {
          const w = sz * (0.95 - j * 0.22), yb = t.y + sz * 0.2 - j * sz * 0.42;
          x.fillStyle = dark;
          x.beginPath(); x.moveTo(t.x - w, yb); x.lineTo(t.x, yb - sz * 0.75); x.lineTo(t.x + w, yb); x.closePath(); x.fill();
          x.fillStyle = light;
          x.beginPath(); x.moveTo(t.x - w * 0.9, yb - 2); x.lineTo(t.x, yb - sz * 0.72); x.lineTo(t.x - w * 0.05, yb - 2); x.closePath(); x.fill();
        }
      } else {
        // куст
        x.fillStyle = '#2b4a2c';
        x.beginPath(); x.arc(t.x - sz * 0.3, t.y, sz * 0.45, 0, 7); x.arc(t.x + sz * 0.3, t.y + 2, sz * 0.42, 0, 7); x.arc(t.x, t.y - sz * 0.2, sz * 0.5, 0, 7); x.fill();
        x.fillStyle = '#3f6a3a';
        x.beginPath(); x.arc(t.x - sz * 0.15, t.y - sz * 0.3, sz * 0.25, 0, 7); x.fill();
        if (t.c > 0.7) { x.fillStyle = '#c94b4b'; for (let j = 0; j < 4; j++) { x.beginPath(); x.arc(t.x + (j - 1.5) * sz * 0.2, t.y - sz * 0.05 + (j % 2) * 4, 2.2, 0, 7); x.fill(); } }
      }
    }
    // трава и цветы у дорог
    {
      const fr = rng(5);
      for (let i = 0; i < 1400 * area; i++) {
        const px = fr() * W, py = fr() * H;
        const d = Math.min(...g.lanes.map((l) => l.dist(px, py)));
        if (d < 58 || d > 120 || riverDist(px, py) < RIVER_W / 2 + 40) continue;
        if (THRONE_POS.some((t) => Math.max(Math.abs(t.x - px), Math.abs(t.y - py)) < BASE_HALF + 20)) continue;
        if (fr() < 0.7) {
          x.strokeStyle = fr() > 0.5 ? '#4c7240' : '#5a8448';
          x.lineWidth = 1.6;
          for (let k = 0; k < 3; k++) { x.beginPath(); x.moveTo(px + k * 3, py); x.lineTo(px + k * 3 + (fr() - 0.5) * 6, py - 6 - fr() * 6); x.stroke(); }
        } else {
          x.fillStyle = ['#f3d27a', '#f2f0e6', '#d98ad0', '#8ec5f0'][Math.floor(fr() * 4)];
          x.beginPath(); x.arc(px, py, 2.6, 0, 7); x.fill();
        }
      }
    }
    // валуны у краёв леса
    const rr = rng(99);
    for (let i = 0; i < 260 * area; i++) {
      const px = rr() * W;
      const py = rr() * H;
      const d = Math.min(...g.lanes.map((l) => l.dist(px, py)));
      if (d < 100 || d > 140 || riverDist(px, py) < RIVER_W / 2 + 30) continue;
      const s = 12 + rr() * 14;
      x.fillStyle = C.stoneDark;
      x.beginPath();
      x.ellipse(px, py + 3, s * 1.2, s * 0.8, rr(), 0, 7);
      x.fill();
      x.fillStyle = '#7a7266';
      x.beginPath();
      x.ellipse(px - 2, py, s, s * 0.65, rr(), 0, 7);
      x.fill();
    }

    // дороги
    for (const lane of g.lanes) {
      x.beginPath();
      lane.pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.strokeStyle = C.roadEdge;
      x.lineWidth = 104;
      x.stroke();
      x.strokeStyle = C.road;
      x.lineWidth = 86;
      x.stroke();
      x.strokeStyle = 'rgba(0,0,0,.08)';
      x.lineWidth = 4;
      x.setLineDash([30, 40]);
      x.stroke();
      x.setLineDash([]);
      // мост там, где дорога пересекает реку: настил из досок, по бокам перила со столбиками
      const onBridge: number[] = [];
      for (let t = 0; t < lane.length; t += 4) {
        const p = lane.at(t);
        if (riverDist(p.x, p.y) <= RIVER_W / 2 + 34) onBridge.push(t);
      }
      if (onBridge.length) {
        const t0 = onBridge[0], t1 = onBridge[onBridge.length - 1];
        // настил
        x.beginPath();
        for (let t = t0; t <= t1; t += 4) { const p = lane.at(t); if (t === t0) x.moveTo(p.x, p.y); else x.lineTo(p.x, p.y); }
        x.strokeStyle = '#3a2c1a';
        x.lineWidth = 120;
        x.lineCap = 'butt';
        x.stroke();
        x.strokeStyle = '#7a5c36';
        x.lineWidth = 108;
        x.stroke();
        x.lineCap = 'round';
        for (let t = t0; t <= t1; t += 14) {
          const p = lane.at(t);
          x.strokeStyle = (Math.floor(t / 14) % 2) ? '#6a4e2c' : '#86663e';
          x.lineWidth = 11;
          x.beginPath(); x.moveTo(p.x - p.nx * 52, p.y - p.ny * 52); x.lineTo(p.x + p.nx * 52, p.y + p.ny * 52); x.stroke();
          x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 1.5;
          x.beginPath(); x.moveTo(p.x - p.nx * 52 + 6, p.y - p.ny * 52); x.lineTo(p.x + p.nx * 52 + 6, p.y + p.ny * 52); x.stroke();
        }
        // перила
        for (const sd of [-1, 1]) {
          x.beginPath();
          for (let t = t0; t <= t1; t += 4) { const p = lane.at(t); const qx = p.x + p.nx * 58 * sd, qy = p.y + p.ny * 58 * sd; if (t === t0) x.moveTo(qx, qy); else x.lineTo(qx, qy); }
          x.strokeStyle = '#2c2014'; x.lineWidth = 9; x.stroke();
          x.strokeStyle = '#9a7748'; x.lineWidth = 5; x.stroke();
          for (let t = t0; t <= t1 + 1; t += 40) {
            const p = lane.at(Math.min(t, t1));
            x.fillStyle = '#2c2014';
            x.beginPath(); x.arc(p.x + p.nx * 58 * sd, p.y + p.ny * 58 * sd, 7, 0, 7); x.fill();
            x.fillStyle = '#b08a55';
            x.beginPath(); x.arc(p.x + p.nx * 58 * sd - 1, p.y + p.ny * 58 * sd - 1, 4.5, 0, 7); x.fill();
          }
        }
      }
    }

    // мини-версия фона для миникарты
    this.mini.width = 320;
    this.mini.height = Math.round((320 * H) / W);
    const m = this.mini.getContext('2d')!;
    m.imageSmoothingQuality = 'high';
    m.drawImage(this.bg, 0, 0, this.mini.width, this.mini.height);
  }

  // ---------- кадр ----------

  draw(dt = 0) {
    const { ctx, g, cam } = this;
    this.stepCamera(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.dark;
    ctx.fillRect(0, 0, this.cv.width, this.cv.height);
    const d = this.dpr;
    ctx.setTransform(d * cam.z, 0, 0, d * cam.z, d * (this.vw / 2 - cam.x * cam.z), d * (this.vh / 2 - cam.y * cam.z));

    // видимая часть фона
    const sx = Math.max(0, Math.floor(cam.x - this.vw / 2 / cam.z) - 2);
    const sy = Math.max(0, Math.floor(cam.y - this.vh / 2 / cam.z) - 2);
    const sw = Math.min(WORLD.W - sx, Math.ceil(this.vw / cam.z) + 4);
    const sh = Math.min(WORLD.H - sy, Math.ceil(this.vh / cam.z) + 4);
    if (sw > 0 && sh > 0) ctx.drawImage(this.bg, sx * BG_SCALE, sy * BG_SCALE, sw * BG_SCALE, sh * BG_SCALE, sx, sy, sw, sh);
    this.view = { x0: sx - 150, y0: sy - 150, x1: sx + sw + 150, y1: sy + sh + 150 };

    this.drawWater();
    this.drawPads();
    for (const s of [0, 1] as Side[]) { this.drawThrone(s); this.drawBase(s); }
    this.drawLairs();
    for (const n of g.neutrals) this.drawNeutral(n);
    this.drawTripPaths();
    for (const w of g.wards) {
      const p = g.lanes[w.lane].pos(w.s, w.off);
      if (w.side !== this.me && !g.visible(this.me, p.x, p.y)) continue;
      ctx.fillStyle = '#2d6b57';
      ctx.fillRect(p.x - 7, p.y - 18, 14, 26);
      ctx.fillStyle = '#5fc9a8';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 20, 8, 0, 7);
      ctx.fill();
    }
    for (const c of g.creeps) if (this.seen(c.side, g.creepPos(c))) this.drawCreep(c);
    for (const h of g.heroes) if (h.side === this.me || (!h.dead && this.seen(h.side, g.heroPos(h)))) this.drawHero(h);

    for (const p of g.projs) {
      if (!g.visible(this.me, p.x, p.y)) continue;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 7);
      ctx.fill();
    }
    this.drawFx();
    this.drawFog();
  }

  /** Течение реки: светлые блики плывут по воде (поверх нарисованного фона). */
  private drawWater() {
    const { ctx } = this;
    const t = performance.now() / 1000;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([26, 120, 10, 160]);
    for (const [off, a, sp] of [[-RIVER_W * 0.22, 0.13, 38], [RIVER_W * 0.12, 0.1, 30], [0, 0.16, 46]] as const) {
      ctx.lineDashOffset = -t * sp - off * 3;
      ctx.strokeStyle = `rgba(220,240,255,${a})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      offsetRiver(ctx, off);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** Свои видны всегда, чужие — только вне тумана. */
  private seen(side: Side, p: { x: number; y: number }) {
    return side === this.me || this.g.visible(this.me, p.x, p.y);
  }

  private fog: HTMLCanvasElement = document.createElement('canvas');
  private fogFor: unknown = null;

  /** Туман войны: тёмная пелена с «дырами» вокруг всего, что видит игрок. */
  private drawFog() {
    const { ctx, g } = this;
    const K = 16;
    const f = this.fog;
    if (f.width !== Math.ceil(WORLD.W / K)) {
      f.width = Math.ceil(WORLD.W / K);
      f.height = Math.ceil(WORLD.H / K);
    }
    // пересчитываем туман только когда обновился обзор (5 раз в секунду), а не каждый кадр
    if (this.fogFor === g.vision[this.me]) {
      ctx.drawImage(f, 0, 0, WORLD.W, WORLD.H);
      return;
    }
    this.fogFor = g.vision[this.me];
    const x = f.getContext('2d')!;
    x.globalCompositeOperation = 'source-over';
    x.clearRect(0, 0, f.width, f.height);
    x.fillStyle = 'rgba(6,8,18,.66)';
    x.fillRect(0, 0, f.width, f.height);
    x.globalCompositeOperation = 'destination-out';
    for (const [vx, vy, r] of g.vision[this.me]) {
      const gr = x.createRadialGradient(vx / K, vy / K, (r / K) * 0.7, vx / K, vy / K, r / K);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = gr;
      x.beginPath();
      x.arc(vx / K, vy / K, r / K, 0, 7);
      x.fill();
    }
    // логово без стража и без своего отряда внутри остаётся в тумане, даже если рядом пробегают герои
    x.globalCompositeOperation = 'source-over';
    PITS.forEach((p, i) => {
      if (g.pitSeen[this.me][i]) return;
      // возвращаем логову обычный уровень тумана (не темнее остального)
      x.save();
      x.beginPath();
      x.arc(p.x / K, p.y / K, BAL.pitZone / K, 0, 7);
      x.clip();
      x.clearRect(p.x / K - BAL.pitZone / K - 1, p.y / K - BAL.pitZone / K - 1, (2 * BAL.pitZone) / K + 2, (2 * BAL.pitZone) / K + 2);
      x.fillStyle = 'rgba(6,8,18,.66)';
      x.fillRect(p.x / K - BAL.pitZone / K - 1, p.y / K - BAL.pitZone / K - 1, (2 * BAL.pitZone) / K + 2, (2 * BAL.pitZone) / K + 2);
      x.restore();
    });
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(f, 0, 0, WORLD.W, WORLD.H);
  }

  private drawNeutral(n: Neutral) {
    const { ctx, g } = this;
    const R = BAL.neutral[n.kind].r;
    if (!n.alive) {
      if (n.kind === 'camp') return;
      ctx.fillStyle = 'rgba(243,234,214,.8)';
      ctx.font = '700 28px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(clock(n.respawnT), n.x, n.y + 44);
      return;
    }
    if (n.kind === 'guard') { this.drawGuard(n); return; }
    // звери живые: дышат, моргают, шевелят хвостами и лапами; при ударе бросаются вперёд.
    // Удары видны только вне тумана — иначе по анимации можно понять, что кто-то бьёт босса.
    const now = performance.now() / 1000;
    const atk = g.visible(this.me, n.x, n.y, 60) ? this.beastAttack(n, now) : 0;
    const onScreen = this.inView(n.x, n.y, R * 3);
    const beast = (kind: string, x: number, y: number, size: number, flip: boolean, ph: number, a: number) => {
      if (!onScreen) return;
      const k = size / 20; // фигура нарисована с радиусом ≈ 20
      const hop = a > 0 ? Math.sin(Math.min(1, a / 0.6) * Math.PI) : 0;
      ctx.save();
      ctx.translate(x + (flip ? -1 : 1) * hop * size * 0.35, y - hop * size * 0.15);
      ctx.scale(flip ? -k : k, k);
      drawBeastFigure(ctx, kind, now + ph, a);
      ctx.restore();
    };
    if (n.kind === 'lord') {
      // Лорд парит над логовом
      beast('lord', n.x, n.y + 2 - Math.sin(now * 1.3) * 4, R * 1.05, false, 0, atk);
    } else if (n.kind === 'turtle') beast('turtle', n.x, n.y, R * 1.05, n.x > WORLD.W / 2, 1, atk);
    else {
      const kind = ['wolf', 'boar', 'spider'][n.id % 3];
      // звери в лагере бьют по очереди
      const a2 = atk > 0 ? Math.max(0, atk - 0.25) / 0.75 : 0;
      beast(kind, n.x + 26, n.y - 10, R * 0.9, true, n.id * 1.7 + 2, a2);
      beast(kind, n.x - 22, n.y + 10, R * 1.15, false, n.id * 1.3, atk);
    }
    // в тумане не видно, кто бьёт босса и сколько у него HP
    if (!g.visible(this.me, n.x, n.y, 60)) return;
    if (n.hp < n.maxHp || n.kind !== 'camp') {
      const w = n.kind === 'camp' ? 60 : 150;
      const y = n.y - R - (n.kind === 'lord' ? 64 : 26);
      bar(ctx, n.x - w / 2, y, w, n.kind === 'camp' ? 6 : 10, n.hp / n.maxHp, '#f0a24a');
    }
    // отряды у логова — по цвету команды
    for (const side of [0, 1] as Side[]) {
      if (g.party(n.id, side, 'fight').length && n.kind !== 'camp') {
        ctx.strokeStyle = C.side[this.rel(side)];
        ctx.lineWidth = 4;
        ctx.setLineDash([12, 10]);
        ctx.beginPath();
        ctx.arc(n.x, n.y, R + 95, side === 0 ? Math.PI * 0.5 : -Math.PI * 0.5, side === 0 ? Math.PI * 1.5 : Math.PI * 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  /** Страж логова: каменный обелиск с кристаллом цвета владельца. В тумане — без подробностей. */
  private drawGuard(n: Neutral) {
    const { ctx, g } = this;
    const seen = g.visible(this.me, n.x, n.y, 40);
    const col = !seen ? '#7a7f8c' : n.owner === null ? '#c9cdd6' : C.side[this.rel(n.owner)];
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(4, 26, 46, 18, 0, 0, 7); ctx.fill();
    ctx.fillStyle = C.stoneDark;
    ctx.beginPath(); ctx.ellipse(0, 22, 44, 16, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6e6a62';
    ctx.beginPath(); ctx.moveTo(-22, 22); ctx.lineTo(-14, -40); ctx.lineTo(0, -54); ctx.lineTo(14, -40); ctx.lineTo(22, 22); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.lineWidth = 3; ctx.stroke();
    // кристалл
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(10, -18); ctx.lineTo(0, 0); ctx.lineTo(-10, -18); ctx.closePath(); ctx.fill();
    if (seen && n.owner !== null) {
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(0, -18, 26, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (!seen) {
      ctx.fillStyle = '#f3ead6';
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 0, -16);
    }
    ctx.restore();
    if (seen && n.hp < n.maxHp) bar(ctx, n.x - 40, n.y - 72, 80, 7, n.hp / n.maxHp, col);
    if (seen) for (const side of [0, 1] as Side[]) {
      if (g.party(n.id, side, 'fight').length) {
        ctx.strokeStyle = C.side[this.rel(side)];
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 8]);
        ctx.beginPath(); ctx.arc(n.x, n.y, 115, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }

  private drawTripPaths() {
    const { ctx, g } = this;
    ctx.lineWidth = 4;
    ctx.setLineDash([14, 12]);
    for (const h of g.heroes) {
      if (h.side !== this.me || !h.trip || h.trip.phase === 'fight') continue;
      const n = g.neutrals[h.trip.nid];
      const to = h.trip.phase === 'go' ? { x: n.x, y: n.y } : g.laneSpot(h);
      ctx.strokeStyle = 'rgba(95,212,196,.55)';
      ctx.beginPath();
      ctx.moveTo(h.trip.x, h.trip.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Площадки вышек: цвет — чья это территория сейчас, передняя — где стоят герои. */
  private drawPads() {
    const { ctx, g } = this;
    for (let l = 0; l < 3; l++) {
      const lane = g.lanes[l];
      BAL.slotT.forEach((t, i) => {
        const p = lane.at(t * lane.length);
        const owner = g.slotOwner(l, i);
        const front = g.front[l][owner] === i;
        ctx.fillStyle = C.stoneDark;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y + 6, 66, 52, 0, 0, 7);
        ctx.fill();
        ctx.fillStyle = C.stone;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 62, 48, 0, 0, 7);
        ctx.fill();
        ctx.strokeStyle = C.side[this.rel(owner)];
        ctx.globalAlpha = front ? 0.9 : 0.45;
        ctx.lineWidth = front ? 6 : 4;
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (!front) {
          // пустая запасная позиция — каменная башенка
          ctx.fillStyle = C.sideDeep[this.rel(owner)];
          ctx.fillRect(p.x - 14, p.y - 30, 28, 34);
          ctx.fillStyle = C.stoneDark;
          for (let k = 0; k < 3; k++) ctx.fillRect(p.x - 16 + k * 12, p.y - 38, 8, 9);
        }
      });
    }
  }

  // ---------- миникарта ----------

  drawMinimap(m: CanvasRenderingContext2D, size: number, dpr: number) {
    // size — ширина миникарты в CSS-пикселях, высота по пропорциям карты
    const g = this.g;
    m.setTransform(dpr, 0, 0, dpr, 0, 0);
    m.drawImage(this.mini, 0, 0, size, (size * WORLD.H) / WORLD.W);
    const k = size / WORLD.W;
    for (let l = 0; l < 3; l++) {
      const lane = g.lanes[l];
      BAL.slotT.forEach((t, i) => {
        const p = lane.at(t * lane.length);
        m.fillStyle = C.side[this.rel(g.slotOwner(l, i))];
        m.fillRect(p.x * k - 3, p.y * k - 3, 6, 6);
      });
    }
    for (const c of g.creeps) {
      const p = g.creepPos(c);
      if (!this.seen(c.side, p)) continue;
      m.fillStyle = this.rel(c.side) === 0 ? '#bff3ea' : '#ffb3bf';
      m.fillRect(p.x * k - 1, p.y * k - 1, 2.5, 2.5);
    }
    ([0, 1] as Side[]).forEach((s) => {
      const t = THRONE_POS[s];
      const blink = g.throneUnderAttack(s) && Math.floor(performance.now() / 250) % 2 === 0;
      m.fillStyle = blink ? '#fff1d6' : C.side[this.rel(s)];
      m.beginPath();
      m.arc(t.x * k, t.y * k, 6, 0, 7);
      m.fill();
    });
    for (const n of g.neutrals) {
      if (!n.alive) continue;
      if (n.kind === 'guard') {
        const seen = g.visible(this.me, n.x, n.y, 40);
        m.fillStyle = !seen ? '#7a7f8c' : n.owner === null ? '#e8e8f0' : C.side[this.rel(n.owner)];
        m.fillRect(n.x * k - 3, n.y * k - 3, 6, 6);
        continue;
      }
      m.fillStyle = n.kind === 'lord' ? '#a982f0' : n.kind === 'turtle' ? '#7fd68a' : '#c9a35a';
      const r = n.kind === 'camp' ? 2.5 : 5.5;
      m.beginPath();
      m.arc(n.x * k, n.y * k, r, 0, 7);
      m.fill();
    }
    for (const h of g.heroes) {
      if (h.dead) continue;
      const p = g.heroPos(h);
      if (!this.seen(h.side, p)) continue;
      m.fillStyle = C.dark;
      m.beginPath();
      m.arc(p.x * k, p.y * k, 4.5, 0, 7);
      m.fill();
      m.fillStyle = C.side[this.rel(h.side)];
      m.beginPath();
      m.arc(p.x * k, p.y * k, 3.2, 0, 7);
      m.fill();
    }
    // туман на миникарте
    m.save();
    m.scale(k, k);
    m.drawImage(this.fog, 0, 0, WORLD.W, WORLD.H);
    m.restore();
    // рамка обзора
    const c = this.cam;
    const w = (this.vw / c.z) * k;
    const h = (this.vh / c.z) * k;
    m.strokeStyle = '#ffffff';
    m.lineWidth = 1.5;
    m.strokeRect(c.x * k - w / 2, c.y * k - h / 2, w, h);
  }

  /** Бараки у начала линий и алтарь за троном. Вражеские — только если видны. */
  private drawBase(side: Side) {
    const { ctx, g } = this;
    const rel = this.rel(side);
    const col = C.side[rel];
    const deep = C.sideDeep[rel];
    for (let l = 0; l < 3; l++) {
      const p = barracksPos(g.lanes, l, side);
      if (side !== this.me && !g.visible(this.me, p.x, p.y)) continue;
      const lvl = g.barracks[l][side];
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = 'rgba(0,0,0,.3)';
      ctx.beginPath(); ctx.ellipse(0, 26, 46, 12, 0, 0, 7); ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.dark;
      // стены
      ctx.fillStyle = '#6d5b3d';
      ctx.beginPath(); ctx.rect(-34, -6, 68, 32); ctx.fill(); ctx.stroke();
      // крыша цвета команды
      ctx.fillStyle = deep;
      ctx.beginPath(); ctx.moveTo(-42, -4); ctx.lineTo(0, -36); ctx.lineTo(42, -4); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(-30, -8); ctx.lineTo(0, -30); ctx.lineTo(30, -8); ctx.closePath(); ctx.fill();
      // ворота
      ctx.fillStyle = C.dark;
      ctx.beginPath(); ctx.moveTo(-10, 26); ctx.lineTo(-10, 8); ctx.arc(0, 8, 10, Math.PI, 0); ctx.lineTo(10, 26); ctx.closePath(); ctx.fill();
      // флажок и звёзды уровня
      ctx.strokeStyle = C.dark; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -36); ctx.lineTo(0, -56); ctx.stroke();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(0, -56); ctx.lineTo(16, -51); ctx.lineTo(0, -46); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#f3d27a';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      if (lvl) ctx.fillText('★'.repeat(lvl), 0, 46);
      this.drawWaveTimer();
      // подчинённый Лорд выйдет отсюда со следующей волной
      if (g.lordNext[side] === l) {
        ctx.font = '800 15px system-ui, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = C.dark;
        ctx.strokeText('♛ Лорд', 0, -150);
        ctx.fillStyle = '#c9a8ff';
        ctx.fillText('♛ Лорд', 0, -150);
      }
      // метки рас, которые усиливают крипов этой линии (цвет расы)
      const races = g.laneCreepFx(l, side).races;
      races.forEach((r, i) => {
        const x = (i - (races.length - 1) / 2) * 18;
        ctx.fillStyle = RACES[r].color;
        ctx.strokeStyle = C.dark; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(x, -127, 7, 0, 7); ctx.fill(); ctx.stroke();
      });
      ctx.restore();
    }
    const a = ALTAR_POS[side];
    if (side !== this.me && !g.visible(this.me, a.x, a.y)) return;
    const up = g.upg[side];
    const total = up.armor + up.fury + up.mana;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.fillStyle = 'rgba(0,0,0,.3)';
    ctx.beginPath(); ctx.ellipse(0, 22, 44, 13, 0, 0, 7); ctx.fill();
    ctx.strokeStyle = C.dark; ctx.lineWidth = 3;
    // ступени
    ctx.fillStyle = C.stone;
    ctx.beginPath(); ctx.rect(-38, 6, 76, 16); ctx.fill(); ctx.stroke();
    ctx.fillStyle = C.stoneDark;
    ctx.beginPath(); ctx.rect(-26, -10, 52, 18); ctx.fill(); ctx.stroke();
    // кристалл светится сильнее с улучшениями
    const glow = 0.25 + Math.min(1, total / 15) * 0.6 + Math.sin(performance.now() / 400) * 0.08;
    const gr = ctx.createRadialGradient(0, -34, 2, 0, -34, 46);
    gr.addColorStop(0, `rgba(243,210,122,${glow})`);
    gr.addColorStop(1, 'rgba(243,210,122,0)');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(0, -34, 46, 0, 7); ctx.fill();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.moveTo(0, -62); ctx.lineTo(13, -34); ctx.lineTo(0, -10); ctx.lineTo(-13, -34); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath(); ctx.moveTo(0, -58); ctx.lineTo(5, -34); ctx.lineTo(0, -16); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /** Таймер до следующей волны над бараком (рисуется в его системе координат).
   *  Кольцо убывает от полного к пустому; последние 5 с — золотое и пульсирует,
   *  первые 1,5 с после выхода волны — «Волна!». Только отрисовка, симуляцию не трогает. */
  private drawWaveTimer() {
    const { ctx, g } = this;
    const left = Math.max(0, g.waveTimer);
    const since = BAL.waveEvery - left; // сколько прошло с выхода прошлой волны
    const y = -90;
    ctx.save();
    ctx.translate(0, y);
    if (g.waveNo > 0 && since < 1.5) {
      const a = 1 - since / 1.5;
      ctx.globalAlpha = a;
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 4; ctx.strokeStyle = C.dark;
      ctx.strokeText('Волна!', 0, -since * 14);
      ctx.fillStyle = '#f3d27a';
      ctx.fillText('Волна!', 0, -since * 14);
      ctx.restore();
      return;
    }
    const total = g.waveNo === 0 ? BAL.firstWave : BAL.waveEvery;
    const frac = Math.min(1, left / total);
    const soon = left <= 5;
    const pulse = soon ? 1 + Math.sin(performance.now() / 90) * 0.06 : 1;
    ctx.scale(pulse, pulse);
    const R = 24;
    ctx.fillStyle = 'rgba(14,20,16,.82)';
    ctx.beginPath(); ctx.arc(0, 0, R + 4, 0, 7); ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = soon ? '#f3d27a' : '#cfd8c8';
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(0, 0, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.fillStyle = soon ? '#f3d27a' : '#eef3ea';
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.ceil(left)), 0, 1);
    ctx.restore();
  }

  /** Постройка базы под пальцем: алтарь, трон или барак. */
  buildingAt(wx: number, wy: number): { kind: 'altar' | 'throne' | 'barracks'; side: Side; lane?: number } | null {
    for (const side of [0, 1] as Side[]) {
      const a = ALTAR_POS[side];
      if (Math.hypot(a.x - wx, a.y - wy) < 70) return { kind: 'altar', side };
      for (let l = 0; l < 3; l++) {
        const p = barracksPos(this.g.lanes, l, side);
        if (Math.hypot(p.x - wx, p.y - wy + 10) < 62) return { kind: 'barracks', side, lane: l };
      }
      const t = THRONE_POS[side];
      if (Math.abs(wx - t.x) < 100 && wy - t.y > -165 && wy - t.y < 80) return { kind: 'throne', side };
    }
    return null;
  }

  /** Видимая часть мира (с запасом): то, что за экраном, не рисуем. */
  private view = { x0: 0, y0: 0, x1: WORLD.W, y1: WORLD.H };

  private inView(x: number, y: number, r = 0): boolean {
    const v = this.view;
    return x + r > v.x0 && x - r < v.x1 && y + r > v.y0 && y - r < v.y1;
  }

  /** Анимация героев: когда ударил, когда колдовал, где стоял в прошлом кадре. */
  private heroAnim = new Map<number, { atkCd: number; casts: number; atkT: number; castT: number; x: number; y: number; walk: number }>();
  /** Анимация нейтралов: счётчик ударов и время последнего. */
  private beastAnim = new Map<number, { hits: number; atkT: number }>();

  private glows = new Map<string, HTMLCanvasElement>();

  /** Мягкое круглое свечение заданного цвета (кэш). */
  private glowSprite(col: number[]): HTMLCanvasElement {
    const key = col.join(',');
    let cv = this.glows.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const x = cv.getContext('2d')!;
      const gr = x.createRadialGradient(64, 64, 8, 64, 64, 64);
      gr.addColorStop(0, `rgba(${key},.26)`);
      gr.addColorStop(1, `rgba(${key},0)`);
      x.fillStyle = gr;
      x.fillRect(0, 0, 128, 128);
      this.glows.set(key, cv);
    }
    return cv;
  }

  /** Ход удара нейтрала 0..1 (0 — сейчас не бьёт). */
  private beastAttack(n: Neutral, now: number): number {
    let a = this.beastAnim.get(n.id);
    if (!a) { a = { hits: n.hits, atkT: -9 }; this.beastAnim.set(n.id, a); }
    if (n.hits !== a.hits) { if (n.hits > a.hits) a.atkT = now; a.hits = n.hits; }
    const k = (now - a.atkT) / 0.55;
    return k > 0 && k < 1 ? k : 0;
  }

  /** Логова и лесные лагеря оживают: руны светятся и кружат, над логовом поднимаются искры, у лагерей — светлячки. */
  private drawLairs() {
    const { ctx, g } = this;
    const now = performance.now() / 1000;
    ctx.save();
    PITS.forEach((p, i) => {
      if (!this.inView(p.x, p.y, 200)) return;
      const boss = g.neutrals.find((n) => (n.kind === 'lord' || n.kind === 'turtle') && Math.hypot(n.x - p.x, n.y - p.y) < 10);
      const alive = boss ? boss.alive : true;
      const col = i === 0 ? [180, 140, 255] : [127, 214, 138];
      const pow = alive ? 1 : 0.35;
      // свечение дна логова (готовая картинка: градиент каждый кадр дорог для телефона)
      const pulse = 0.5 + Math.sin(now * 1.4 + i) * 0.5;
      ctx.globalAlpha = (0.6 + pulse * 0.4) * pow;
      ctx.drawImage(this.glowSprite(col), p.x - 150, p.y - 150, 300, 300);
      ctx.globalAlpha = 1;
      // кольцо рун медленно вращается
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(now * 0.12 * (i ? -1 : 1));
      ctx.strokeStyle = `rgba(243,210,122,${0.25 + pulse * 0.25 * pow})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([18, 22]);
      ctx.beginPath(); ctx.arc(0, 0, 128, 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      for (let k = 0; k < 8; k++) {
        const a = (k * Math.PI) / 4;
        const glow = (0.35 + 0.65 * Math.max(0, Math.sin(now * 2 - k * 0.8))) * pow;
        ctx.save();
        ctx.translate(Math.cos(a) * 112, Math.sin(a) * 112);
        ctx.rotate(a + Math.PI / 2);
        ctx.strokeStyle = `rgba(255,236,170,${glow})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        // простая руна: черта с засечками
        ctx.moveTo(0, -9); ctx.lineTo(0, 9);
        if (k % 2) { ctx.moveTo(-6, -4); ctx.lineTo(0, 2); ctx.lineTo(6, -4); } else { ctx.moveTo(-6, 6); ctx.lineTo(6, -6); }
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // искры поднимаются из логова
      if (alive) for (let k = 0; k < 14; k++) {
        const life = 3.2, ph = (now / life + k * 0.137) % 1;
        const a = k * 2.39996;
        const r = 30 + ((k * 53) % 100);
        const x = p.x + Math.cos(a) * r + Math.sin(now * 1.5 + k) * 8;
        const y = p.y + Math.sin(a) * r * 0.6 - ph * 120;
        ctx.fillStyle = `rgba(${col[0] + 40},${col[1] + 30},${col[2]},${Math.sin(ph * Math.PI) * 0.8})`;
        ctx.beginPath(); ctx.arc(x, y, 3.2 * (1 - ph * 0.5), 0, 7); ctx.fill();
      }
    });
    // светлячки у живых лагерей
    for (const n of g.neutrals) {
      if (n.kind !== 'camp' || !n.alive || !this.inView(n.x, n.y, 100)) continue;
      for (let k = 0; k < 4; k++) {
        const s = n.id * 3.1 + k * 1.9;
        const x = n.x + Math.sin(now * 0.6 + s) * 70 + Math.sin(now * 1.7 + s * 2) * 12;
        const y = n.y - 30 + Math.cos(now * 0.5 + s * 1.3) * 45;
        const a = 0.35 + 0.65 * Math.max(0, Math.sin(now * 3 + s * 5));
        ctx.fillStyle = `rgba(255,240,150,${a * 0.25})`;
        ctx.beginPath(); ctx.arc(x, y, 9, 0, 7); ctx.fill();
        ctx.fillStyle = `rgba(255,248,190,${a})`;
        ctx.beginPath(); ctx.arc(x, y, 2.8, 0, 7); ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Готовые картинки замка: сторона × разрушения × белый силуэт (для вспышки). */
  private castleSprites = new Map<string, HTMLCanvasElement>();

  private castleSprite(rel: 0 | 1, dmg: number, white: boolean): HTMLCanvasElement {
    const key = rel + ':' + dmg + ':' + white;
    let cv = this.castleSprites.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = CASTLE_BOX.w * 2; // рисуем вдвое крупнее — на приближении чётко
      cv.height = CASTLE_BOX.h * 2;
      const x = cv.getContext('2d')!;
      x.scale(2, 2);
      x.translate(-CASTLE_BOX.x, -CASTLE_BOX.y);
      drawCastleFigure(x, C.side[rel], C.sideDeep[rel], dmg, white);
      this.castleSprites.set(key, cv);
    }
    return cv;
  }

  private drawThrone(side: Side) {
    const { ctx, g } = this;
    const p = THRONE_POS[side];
    const rel = this.rel(side);
    const hit = g.throneUnderAttack(side);
    const k = Math.max(0, g.throne[side] / BAL.throneHp);
    const dmg = k > 0.66 ? 0 : k > 0.33 ? 1 : 2;
    const now = performance.now();
    ctx.save();
    ctx.translate(p.x, p.y);
    // тень и кольцо прочности на земле: убывает с боков к переду
    ctx.fillStyle = 'rgba(0,0,0,.32)';
    ctx.beginPath(); ctx.ellipse(0, 46, 108, 30, 0, 0, 7); ctx.fill();
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.beginPath(); ctx.ellipse(0, 46, 112, 34, 0, 0, 7); ctx.stroke();
    if (k > 0) {
      ctx.strokeStyle = k > 0.35 ? C.side[rel] : '#ffb347';
      ctx.beginPath(); ctx.ellipse(0, 46, 112, 34, 0, Math.PI / 2 - Math.PI * k, Math.PI / 2 + Math.PI * k); ctx.stroke();
    }
    // прочность числом под замком
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 5;
    ctx.strokeStyle = C.dark;
    const hpT = `${Math.max(0, Math.ceil(g.throne[side]))} / ${BAL.throneHp}`;
    ctx.strokeText(hpT, 0, 98);
    ctx.fillStyle = k > 0.35 ? C.ink : '#ffb347';
    ctx.fillText(hpT, 0, 98);
    // лёгкая дрожь под ударами
    const shake = hit && g.glyphT[side] <= 0 ? Math.sin(now / 35) * 1.2 : 0;
    const bx = CASTLE_BOX.x + shake, by = CASTLE_BOX.y;
    ctx.drawImage(this.castleSprite(rel, dmg, false), bx, by, CASTLE_BOX.w, CASTLE_BOX.h);
    const shield = g.glyphT[side] > 0;
    if (hit && !shield) {
      ctx.globalAlpha = 0.18 + 0.22 * Math.max(0, Math.sin(now / 90));
      ctx.drawImage(this.castleSprite(rel, dmg, true), bx, by, CASTLE_BOX.w, CASTLE_BOX.h);
      ctx.globalAlpha = 1;
    }
    // пожар и дым на сильно побитом замке
    if (dmg >= 1) {
      const smokes = dmg >= 2 ? [[66, -96], [-66, -96], [0, -120]] : [[66, -96]];
      for (const [fx, fy] of smokes) {
        for (let i = 0; i < 4; i++) {
          const t = (now / 1400 + i / 4 + fx * 0.01) % 1;
          ctx.fillStyle = `rgba(60,55,62,${0.5 * (1 - t)})`;
          ctx.beginPath(); ctx.arc(fx + Math.sin(t * 6 + i) * 6 + t * 12, fy - t * 70, 7 + t * 14, 0, 7); ctx.fill();
        }
      }
      if (dmg >= 2) {
        for (const [fx, fy] of [[-32, -22], [34, -22], [-66, -20]]) {
          const f = 1 + Math.sin(now / 70 + fx) * 0.18;
          ctx.fillStyle = '#ff8a3d';
          ctx.beginPath(); ctx.moveTo(fx - 9, fy); ctx.quadraticCurveTo(fx - 8, fy - 14 * f, fx, fy - 22 * f); ctx.quadraticCurveTo(fx + 8, fy - 14 * f, fx + 9, fy); ctx.closePath(); ctx.fill();
          ctx.fillStyle = '#ffd36b';
          ctx.beginPath(); ctx.moveTo(fx - 4, fy); ctx.quadraticCurveTo(fx - 4, fy - 8 * f, fx, fy - 12 * f); ctx.quadraticCurveTo(fx + 4, fy - 8 * f, fx + 4, fy); ctx.closePath(); ctx.fill();
        }
      }
    }
    // глиф: золотой купол над замком
    if (shield) {
      const pulse = 0.5 + Math.sin(now / 120) * 0.2;
      const gr = ctx.createLinearGradient(0, -190, 0, 50);
      gr.addColorStop(0, `rgba(255,230,128,${0.32 * pulse})`);
      gr.addColorStop(1, `rgba(255,230,128,${0.08 * pulse})`);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.ellipse(0, 46, 118, 236, 0, Math.PI, 0); ctx.ellipse(0, 46, 118, 34, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = `rgba(255,230,128,${0.55 + Math.sin(now / 120) * 0.25})`;
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(0, 46, 118, 236, 0, Math.PI, 0); ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(0, 46, 118, 34, 0, 0, Math.PI); ctx.stroke();
    }
    ctx.restore();
  }

  /** Готовые картинки крипов: вид × сторона (своя/чужая), смотрят вправо. */
  private creepSprites = new Map<string, HTMLCanvasElement>();

  private creepSprite(kind: string, rel: 0 | 1): HTMLCanvasElement {
    const key = kind + rel;
    let cv = this.creepSprites.get(key);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = cv.height = 128; // рисуем крупно, на поле уменьшаем — так чётче
      const x = cv.getContext('2d')!;
      x.translate(64, 64);
      x.scale(2, 2);
      drawCreepFigure(x, kind, C.side[rel], C.sideDeep[rel]);
      this.creepSprites.set(key, cv);
    }
    return cv;
  }

  private drawCreep(c: Game['creeps'][number]) {
    const { ctx, g } = this;
    const p = g.creepPos(c);
    const rel = this.rel(c.side);
    const col = C.side[rel];
    const r = c.r * 1.25;
    // смотрит туда, куда идёт по линии
    const lane = g.lanes[c.lane];
    const ahead = lane.pos(c.s + (c.side === 0 ? 20 : -20), c.off);
    const left = ahead.x < p.x - 0.5;
    // шаг: лёгкое покачивание, у каждого крипа своя фаза
    const step = c.stunT > 0 ? 0 : Math.sin(performance.now() / 110 + c.uid * 1.7);
    const size = c.kind === 'lord' ? r * 2.4 : c.kind === 'siege' ? r * 2.3 : r * 2.6;
    if (c.kind === 'lord') {
      // Лорд, идущий по линии, — та же фигура, что в логове, с кольцом цвета своей команды
      const R = r * 1.5;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.strokeStyle = col;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, R * 0.6, R * 1.1, R * 0.32, 0, 0, 7); ctx.stroke();
      ctx.translate(0, -Math.abs(step) * R * 0.06);
      ctx.scale(R / 20, (R / 20) * (1 + step * 0.015));
      drawBeastFigure(ctx, 'lord', performance.now() / 1000 * 1.4 + c.uid, 0);
      ctx.restore();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y - Math.abs(step) * r * 0.12);
      if (left) ctx.scale(-1, 1);
      ctx.rotate(step * 0.06);
      ctx.drawImage(this.creepSprite(c.kind, rel), -size, -size, size * 2, size * 2);
      ctx.restore();
    }
    if (c.stunT > 0) {
      ctx.fillStyle = '#ffe680';
      for (let i = 0; i < 3; i++) {
        const a = performance.now() / 200 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(a) * r * 0.8, p.y - r * 1.3 + Math.sin(a) * r * 0.25, 2.5, 0, 7);
        ctx.fill();
      }
    }
    if (c.slowT > 0) {
      ctx.strokeStyle = '#a9e4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + r * 0.7, r * 1.1, r * 0.4, 0, 0, 7);
      ctx.stroke();
    }
    if (c.kind === 'lord') bar(ctx, p.x - 40, p.y - r * 3.2, 80, 7, c.hp / c.maxHp, col);
    else if (c.hp < c.maxHp) bar(ctx, p.x - 16, p.y - r * 1.25 - 8, 32, 4, c.hp / c.maxHp, col);
  }

  private drawHero(h: Hero) {
    const { ctx, g } = this;
    const p = g.heroPos(h);
    const R = 46;
    ctx.save();
    ctx.translate(p.x, p.y);
    if (h.dead) {
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = '#3a3640';
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, 7);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.font = '700 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.ceil(h.respawn)), 0, 1);
      ctx.restore();
      return;
    }
    if (this.selected === h && !h.trip) {
      ctx.strokeStyle = 'rgba(243,210,122,.6)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, h.def.range, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // глиф: золотой купол над героями на линии
    if (!h.trip && g.glyphT[h.side] > 0) {
      ctx.strokeStyle = `rgba(255,230,128,${0.55 + Math.sin(performance.now() / 120) * 0.25})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, -6, R + 12, 0, 7);
      ctx.stroke();
    }
    // подставка в цвет команды
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.ellipse(0, R * 0.95, R * 1.05, R * 0.42, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = C.sideDeep[this.rel(h.side)];
    ctx.beginPath();
    ctx.ellipse(0, R * 0.85, R * 0.95, R * 0.36, 0, 0, 7);
    ctx.fill();
    ctx.strokeStyle = C.side[this.rel(h.side)];
    ctx.lineWidth = 4;
    ctx.stroke();
    // фигурка: дышит, при ударе делает выпад, при способности приподнимается; в походе идёт вприпрыжку
    const pose = this.heroPose(h, p);
    const dir = h.side === 1 ? -1 : 1;
    const t = pose.t;
    const lunge = pose.atk > 0 ? Math.max(0, Math.sin(Math.min(1, pose.atk / 0.6) * Math.PI)) : 0;
    const rise = pose.cast > 0 ? Math.sin(pose.cast * Math.PI) : 0;
    const hop = pose.walk > 0 ? Math.abs(Math.sin(t * 9)) * pose.walk : 0;
    if (rise > 0) {
      // круг силы под героем
      ctx.strokeStyle = h.def.color;
      ctx.globalAlpha = rise * 0.8;
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.ellipse(0, R * 0.85, R * (0.9 + rise * 0.5), R * (0.34 + rise * 0.18), 0, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.save();
    ctx.translate(dir * lunge * R * 0.14, -R * 0.15 - rise * R * 0.12 - hop * R * 0.16 + Math.sin(t * 2.2) * R * 0.015);
    if (hop > 0) ctx.rotate(Math.sin(t * 9) * 0.06 * pose.walk);
    const br = 1 + Math.sin(t * 2.2) * 0.018;
    ctx.scale(R * 1.15 * (2 - br), R * 1.15 * br);
    if (h.side === 1) ctx.scale(-1, 1); // верхняя команда смотрит в другую сторону
    drawHeroFigure(ctx, h.def, h.flash > 0, pose);
    ctx.restore();
    // уровень — маленький значок на краю подставки, не на фигурке и не на соседе
    const lx = R * 0.78, ly = R * 1.02;
    ctx.fillStyle = '#f3d27a';
    ctx.strokeStyle = C.dark;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(lx, ly, 12.5, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = C.dark;
    ctx.font = '800 15px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(h.lvl), lx, ly + 1);
    // звёзды героя (прокачка вне боя) — видны и у соперника
    if (h.stars > 0) {
      ctx.font = '900 15px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = C.dark;
      const t = h.stars >= 5 ? '★5' : '★'.repeat(h.stars);
      ctx.strokeText(t, 0, -R * 1.75 - 24);
      ctx.fillStyle = h.stars >= 5 ? '#ffd36b' : '#f3d27a';
      ctx.fillText(t, 0, -R * 1.75 - 24);
    }
    // полоски HP и маны
    bar(ctx, -36, -R * 1.75 - 14, 72, 8, h.hp / h.maxHp, this.rel(h.side) === 0 ? '#7ee07a' : '#ff6f7f');
    bar(ctx, -36, -R * 1.75 - 4, 72, 5, h.mana / h.maxMana, '#6fa8ff');
    if (g.canCast(h) && h.side === this.me) {
      ctx.fillStyle = '#f3d27a';
      ctx.beginPath();
      const ay = h.stars > 0 ? 16 : 0;
      ctx.moveTo(-6, -R * 1.75 - 30 - ay); ctx.lineTo(6, -R * 1.75 - 30 - ay); ctx.lineTo(0, -R * 1.75 - 20 - ay); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  /** Поза героя на этот кадр: замечаем новые удары и касты по счётчикам симуляции. */
  private heroPose(h: Hero, p: { x: number; y: number }): HeroPose & { walk: number } {
    const now = performance.now() / 1000;
    let a = this.heroAnim.get(h.uid);
    if (!a) { a = { atkCd: h.atkCd, casts: h.casts, atkT: -9, castT: -9, x: p.x, y: p.y, walk: 0 }; this.heroAnim.set(h.uid, a); }
    if (h.atkCd > a.atkCd + 0.05) a.atkT = now;
    if (h.casts > a.casts) a.castT = now;
    a.atkCd = h.atkCd;
    a.casts = h.casts;
    // идёт ли герой (поход, переход): плавно включаем и выключаем шаг
    const moved = Math.hypot(p.x - a.x, p.y - a.y);
    a.x = p.x; a.y = p.y;
    a.walk += ((moved > 0.4 && moved < 200 ? 1 : 0) - a.walk) * 0.2;
    const atk = (now - a.atkT) / 0.4;
    const cast = (now - a.castT) / 0.7;
    return { t: now + h.uid * 1.37, atk: atk > 0 && atk < 1 ? atk : 0, cast: cast > 0 && cast < 1 ? cast : 0, walk: a.walk };
  }

  private drawFx() {
    const ctx = this.ctx;
    for (const f of this.g.fx) {
      if (f.to !== undefined && f.to !== this.me) continue;
      if (!this.g.visible(this.me, f.x, f.y, 40)) continue;
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k;
      if (f.kind === 'ring') {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(f.x, f.y, (f.r ?? 80) * (0.5 + 0.5 * k), 0, 7);
        ctx.stroke();
        ctx.fillStyle = f.color;
        ctx.globalAlpha = 0.18 * (1 - k);
        ctx.fill();
      } else if (f.kind === 'bolt' || f.kind === 'beam') {
        ctx.strokeStyle = f.color;
        ctx.lineWidth = f.kind === 'bolt' ? 5 : 3;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        if (f.kind === 'bolt') {
          const n = 5;
          for (let i = 1; i < n; i++) {
            const t = i / n;
            ctx.lineTo(f.x + (f.x2! - f.x) * t + (Math.random() - 0.5) * 22, f.y + (f.y2! - f.y) * t + (Math.random() - 0.5) * 22);
          }
        }
        ctx.lineTo(f.x2!, f.y2!);
        ctx.stroke();
      } else {
        ctx.fillStyle = f.color;
        ctx.font = '800 22px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(f.text ?? '', f.x, f.y - 30 - k * 30);
      }
    }
    ctx.globalAlpha = 1;
  }

  neutralAt(wx: number, wy: number): Neutral | null {
    for (const n of this.g.neutrals) {
      const R = BAL.neutral[n.kind].r + (n.kind === 'camp' ? 70 : 90);
      if (Math.hypot(n.x - wx, n.y - wy) <= R) return n;
    }
    return null;
  }

  heroAt(wx: number, wy: number): Hero | null {
    let best: Hero | null = null;
    let bd = 60;
    for (const h of this.g.heroes) {
      const p = this.g.heroPos(h);
      const d = Math.hypot(p.x - wx, p.y - wy);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  }
}

/** Рамка картинки замка в координатах мира относительно точки трона. */
const CASTLE_BOX = { x: -96, y: -180, w: 192, h: 230 };

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, col: string) {
  ctx.fillStyle = 'rgba(10,8,16,.8)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
}

/** Сглаженная река: квадратичные кривые через середины отрезков ломаной RIVER. */
function riverPath(c: CanvasRenderingContext2D) {
  c.beginPath();
  c.moveTo(RIVER[0][0], RIVER[0][1]);
  for (let i = 1; i < RIVER.length - 1; i++) {
    const [x1, y1] = RIVER[i], [x2, y2] = RIVER[i + 1];
    c.quadraticCurveTo(x1, y1, (x1 + x2) / 2, (y1 + y2) / 2);
  }
  const last = RIVER[RIVER.length - 1];
  c.lineTo(last[0], last[1]);
}

/** Точки сглаженной реки с шагом ~8 единиц (считаются один раз). */
let riverPts: { x: number; y: number; nx: number; ny: number; d: number }[] | null = null;
function riverSamples() {
  if (riverPts) return riverPts;
  const raw: [number, number][] = [[RIVER[0][0], RIVER[0][1]]];
  let px = RIVER[0][0], py = RIVER[0][1];
  for (let i = 1; i < RIVER.length - 1; i++) {
    const [x1, y1] = RIVER[i], [x2, y2] = RIVER[i + 1];
    const ex = (x1 + x2) / 2, ey = (y1 + y2) / 2;
    for (let k = 1; k <= 12; k++) {
      const t = k / 12;
      raw.push([(1 - t) * (1 - t) * px + 2 * (1 - t) * t * x1 + t * t * ex, (1 - t) * (1 - t) * py + 2 * (1 - t) * t * y1 + t * t * ey]);
    }
    px = ex; py = ey;
  }
  raw.push(RIVER[RIVER.length - 1]);
  let d = 0;
  riverPts = raw.map(([x, y], i) => {
    const [ax, ay] = raw[Math.max(0, i - 1)], [bx, by] = raw[Math.min(raw.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    if (i) d += Math.hypot(x - raw[i - 1][0], y - raw[i - 1][1]);
    return { x, y, nx: -(by - ay) / len, ny: (bx - ax) / len, d };
  });
  return riverPts;
}
function riverLength() { const p = riverSamples(); return p[p.length - 1].d; }
function riverAt(dist: number) {
  const p = riverSamples();
  let i = 0;
  while (i < p.length - 1 && p[i + 1].d < dist) i++;
  return p[i];
}
/** Линия вдоль реки со сдвигом off поперёк течения. */
function offsetRiver(c: CanvasRenderingContext2D, off: number) {
  const p = riverSamples();
  p.forEach((q, i) => (i ? c.lineTo(q.x + q.nx * off, q.y + q.ny * off) : c.moveTo(q.x + q.nx * off, q.y + q.ny * off)));
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function clock(sec: number) {
  const t = Math.max(0, Math.ceil(sec));
  return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
}

/** Фигурка крипа в единичном масштабе (примерно 26×26), смотрит вправо. */
function drawCreepFigure(x: CanvasRenderingContext2D, kind: string, col: string, deep: string) {
  const ink = C.dark;
  const skin = '#e9c9a0';
  const steel = '#cfd6dd';
  const wood = '#7a5530';
  x.lineJoin = 'round';
  x.lineCap = 'round';
  x.lineWidth = 2;
  x.strokeStyle = ink;
  const rr = (a: number, b: number, w: number, h: number, r: number) => {
    x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r);
    x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath();
  };
  const shape = (fill: string, path: () => void) => {
    x.beginPath();
    path();
    x.fillStyle = fill;
    x.fill();
    x.stroke();
  };
  // тень
  x.fillStyle = 'rgba(0,0,0,.3)';
  x.beginPath();
  x.ellipse(0, 12, kind === 'siege' || kind === 'lord' ? 16 : 10, 3.5, 0, 0, 7);
  x.fill();

  if (kind === 'melee') {
    // мечник: шлем, щит, меч
    shape(deep, () => { x.rect(-5, 6, 4, 6); x.rect(1, 6, 4, 6); }); // ноги
    shape(col, () => rr(-7, -4, 14, 12, 4)); // туловище
    x.lineWidth = 4.6; x.beginPath(); x.moveTo(8, 2); x.lineTo(17, -9); x.stroke(); // меч: контур
    x.strokeStyle = steel; x.lineWidth = 2.4; x.beginPath(); x.moveTo(8, 2); x.lineTo(17, -9); x.stroke();
    x.strokeStyle = ink; x.lineWidth = 2;
    shape(wood, () => { x.moveTo(5, 4); x.lineTo(10, -1); }); // рукоять-гарда
    shape(skin, () => x.arc(0, -9, 6, 0, 7)); // голова
    shape(steel, () => { x.arc(0, -10, 6.5, Math.PI, 0); x.lineTo(6.5, -9); x.lineTo(-6.5, -9); x.closePath(); }); // шлем
    shape(col, () => { x.moveTo(-1, -16.5); x.lineTo(1, -20); x.lineTo(3, -16); x.closePath(); }); // гребень
    shape(col, () => x.arc(-6, 2, 6, 0, 7)); // щит
    shape(steel, () => x.arc(-6, 2, 2, 0, 7));
    x.fillStyle = ink; x.beginPath(); x.arc(3, -8, 1.1, 0, 7); x.fill(); // глаз
  } else if (kind === 'ranged') {
    // лучник в капюшоне с луком
    shape(deep, () => { x.moveTo(-7, 11); x.lineTo(-5, -3); x.lineTo(5, -3); x.lineTo(7, 11); x.closePath(); }); // плащ
    shape(col, () => rr(-5, -4, 10, 10, 3)); // туловище
    shape(skin, () => x.arc(1, -9, 5, 0, 7)); // лицо
    shape(col, () => { x.moveTo(-6, -6); x.quadraticCurveTo(-6, -17, 2, -17); x.quadraticCurveTo(7, -16, 6, -11); x.lineTo(2, -12); x.quadraticCurveTo(-2, -12, -1, -5); x.closePath(); }); // капюшон
    x.fillStyle = ink; x.beginPath(); x.arc(4, -9, 1, 0, 7); x.fill();
    // лук
    x.strokeStyle = wood; x.lineWidth = 2.6;
    x.beginPath(); x.arc(5, 0, 10, -1.1, 1.1); x.stroke();
    x.strokeStyle = '#efe6d0'; x.lineWidth = 0.9;
    x.beginPath(); x.moveTo(5 + 10 * Math.cos(-1.1), 10 * Math.sin(-1.1)); x.lineTo(5 + 10 * Math.cos(1.1), 10 * Math.sin(1.1)); x.stroke();
    x.strokeStyle = ink; x.lineWidth = 2;
  } else if (kind === 'siege') {
    // катапульта
    shape(wood, () => rr(-14, 2, 28, 6, 2)); // основание
    shape(wood, () => { x.moveTo(-4, 2); x.lineTo(0, -6); x.lineTo(4, 2); x.closePath(); }); // стойка
    x.strokeStyle = wood; x.lineWidth = 3.2;
    x.beginPath(); x.moveTo(-12, 0); x.lineTo(11, -12); x.stroke(); // рычаг
    x.strokeStyle = ink; x.lineWidth = 2;
    shape('#5b5346', () => x.arc(12, -13, 4, 0, 7)); // камень в ковше
    shape(col, () => { x.moveTo(-12, 2); x.lineTo(-12, -14); x.lineTo(-4, -11); x.lineTo(-12, -8); }); // флажок
    shape('#4a3a26', () => x.arc(-9, 9, 4.5, 0, 7)); // колёса
    shape('#4a3a26', () => x.arc(9, 9, 4.5, 0, 7));
    x.fillStyle = steel; x.beginPath(); x.arc(-9, 9, 1.3, 0, 7); x.arc(9, 9, 1.3, 0, 7); x.fill();
  } else if (kind === 'mage') {
    // крип-маг Стихий: мантия цвета команды, остроконечная шляпа, посох со светящимся кристаллом
    shape(deep, () => { x.moveTo(-8, 12); x.lineTo(-4, -4); x.lineTo(4, -4); x.lineTo(8, 12); x.closePath(); }); // мантия
    shape(col, () => { x.moveTo(-5, 4); x.lineTo(-3, -4); x.lineTo(3, -4); x.lineTo(5, 4); x.closePath(); }); // накидка
    shape(skin, () => x.arc(0, -8, 5, 0, 7)); // лицо
    shape(col, () => { x.moveTo(-8, -10); x.lineTo(8, -10); x.lineTo(2, -24); x.closePath(); }); // шляпа
    shape('#8fd8ff', () => x.arc(2, -24, 1.8, 0, 7));
    x.fillStyle = ink; x.beginPath(); x.arc(2.5, -8, 1, 0, 7); x.fill(); // глаз
    x.strokeStyle = wood; x.lineWidth = 2.4;
    x.beginPath(); x.moveTo(9, 11); x.lineTo(11, -12); x.stroke(); // посох
    x.strokeStyle = ink; x.lineWidth = 2;
    const gl = x.createRadialGradient(11, -15, 1, 11, -15, 9);
    gl.addColorStop(0, 'rgba(160,230,255,.9)'); gl.addColorStop(1, 'rgba(160,230,255,0)');
    x.fillStyle = gl; x.beginPath(); x.arc(11, -15, 9, 0, 7); x.fill();
    shape('#8fd8ff', () => { x.moveTo(11, -20); x.lineTo(14, -15); x.lineTo(11, -10); x.lineTo(8, -15); x.closePath(); }); // кристалл
  } else {
    // Лорд на линии: рогатый великан
    shape(deep, () => { x.rect(-9, 6, 6, 7); x.rect(3, 6, 6, 7); }); // ноги
    shape(col, () => x.ellipse(0, -1, 14, 11, 0, 0, 7)); // туловище
    shape(deep, () => x.ellipse(13, 0, 4.5, 6, 0, 0, 7)); // кулак
    shape(col, () => x.arc(4, -12, 7, 0, 7)); // голова
    shape('#efe6d0', () => { x.moveTo(-1, -16); x.quadraticCurveTo(-8, -20, -6, -26); x.quadraticCurveTo(-3, -20, 2, -18); x.closePath(); }); // рог
    shape('#efe6d0', () => { x.moveTo(7, -17); x.quadraticCurveTo(12, -22, 9, -27); x.quadraticCurveTo(14, -21, 10, -15); x.closePath(); });
    x.fillStyle = '#ffd34d'; x.beginPath(); x.arc(7, -12, 1.6, 0, 7); x.fill(); // горящий глаз
  }
}
