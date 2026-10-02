// Отрисовка поля на Canvas 2D с камерой. Читает состояние Game, ничего в нём не меняет.
import { BAL, WORLD } from '../data/config';
import type { Game } from '../sim/game';
import { CAMPS, GUARD_POS, PITS, RIVER, RIVER_W, THRONE_POS, segDist } from '../sim/map';
import type { Hero, Neutral, Side } from '../sim/types';
import { drawHeroFigure } from './art';

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

    // река
    x.lineCap = 'round';
    x.lineJoin = 'round';
    const river = () => {
      x.beginPath();
      RIVER.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
    };
    river();
    x.strokeStyle = C.bank;
    x.lineWidth = RIVER_W + 36;
    x.stroke();
    x.strokeStyle = C.river;
    x.lineWidth = RIVER_W;
    x.stroke();
    x.strokeStyle = C.river2;
    x.lineWidth = RIVER_W * 0.45;
    x.stroke();
    x.strokeStyle = 'rgba(255,255,255,.12)';
    x.lineWidth = 3;
    x.setLineDash([40, 70]);
    x.stroke();
    x.setLineDash([]);

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

    // лес: деревья везде, кроме дорог, реки, баз, полян и логов
    const tr = rng(42);
    for (let i = 0; i < 5200 * area; i++) {
      const px = tr() * W;
      const py = tr() * H;
      const s = 18 + tr() * 22;
      const free =
        g.lanes.every((l) => l.dist(px, py) > 92 + s) &&
        riverDist(px, py) > RIVER_W / 2 + 22 + s &&
        THRONE_POS.every((t) => Math.max(Math.abs(t.x - px), Math.abs(t.y - py)) > BASE_HALF + 30 + s) &&
        CAMPS.every((c) => Math.hypot(c.x - px, c.y - py) > 100 + s) &&
        PITS.every((p) => Math.hypot(p.x - px, p.y - py) > 195 + s) &&
        GUARD_POS.every((p) => Math.hypot(p.x - px, p.y - py) > 110 + s);
      if (!free) continue;
      x.fillStyle = 'rgba(0,0,0,.25)';
      x.beginPath();
      x.arc(px + 5, py + 8, s, 0, 7);
      x.fill();
      x.fillStyle = C.tree;
      x.beginPath();
      x.arc(px, py, s, 0, 7);
      x.fill();
      x.fillStyle = tr() > 0.4 ? C.tree2 : C.tree3;
      x.beginPath();
      x.arc(px - s * 0.2, py - s * 0.25, s * 0.72, 0, 7);
      x.fill();
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
      // мост там, где дорога пересекает реку
      for (let s = 0; s < lane.length; s += 13) {
        const p = lane.at(s);
        if (riverDist(p.x, p.y) > RIVER_W / 2 + 18) continue;
        x.strokeStyle = C.plank;
        x.lineWidth = 6;
        x.beginPath();
        x.moveTo(p.x - p.nx * 48, p.y - p.ny * 48);
        x.lineTo(p.x + p.nx * 48, p.y + p.ny * 48);
        x.stroke();
        x.fillStyle = '#3a2c1a';
        x.fillRect(p.x - p.nx * 54 - 4, p.y - p.ny * 54 - 4, 8, 8);
        x.fillRect(p.x + p.nx * 54 - 4, p.y + p.ny * 54 - 4, 8, 8);
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

    this.drawPads();
    for (const s of [0, 1] as Side[]) this.drawThrone(s);
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
    ctx.save();
    ctx.translate(n.x, n.y);
    const white = false; // не мигаем: иначе вспышка выдаёт бой у босса даже сквозь туман
    if (n.kind === 'lord') {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(6, 14, R, R * 0.8, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = white ? '#fff' : '#5b3a8c';
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, 7);
      ctx.fill();
      ctx.fillStyle = white ? '#fff' : '#8a63c9';
      ctx.beginPath();
      ctx.arc(0, -6, R * 0.72, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#e8dcc0';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(sx * R * 0.45, -R * 0.55);
        ctx.lineTo(sx * R * 0.95, -R * 1.25);
        ctx.lineTo(sx * R * 0.2, -R * 0.7);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#ffd25a';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * R * 0.28, -R * 0.12, 7, 0, 7);
        ctx.fill();
      }
    } else if (n.kind === 'turtle') {
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.beginPath();
      ctx.ellipse(6, 12, R * 1.1, R * 0.8, 0, 0, 7);
      ctx.fill();
      ctx.fillStyle = white ? '#fff' : '#6fae6a';
      ctx.beginPath();
      ctx.arc(0, -R * 0.9, R * 0.35, 0, 7);
      ctx.fill();
      ctx.fillStyle = white ? '#fff' : '#3f7a45';
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 1.05, R * 0.85, 0, 0, 7);
      ctx.fill();
      ctx.strokeStyle = '#9ccf7e';
      ctx.lineWidth = 4;
      hex(ctx, R * 0.42);
      ctx.stroke();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 6 + (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 0.42, Math.sin(a) * R * 0.42);
        ctx.lineTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.7);
        ctx.stroke();
      }
    } else {
      for (const [ox, oy, k] of [[-18, 6, 1], [20, -4, 0.8]] as const) {
        ctx.fillStyle = 'rgba(0,0,0,.3)';
        ctx.beginPath();
        ctx.arc(ox + 3, oy + 5, R * k, 0, 7);
        ctx.fill();
        ctx.fillStyle = white ? '#fff' : '#8b6b3e';
        ctx.beginPath();
        ctx.arc(ox, oy, R * k, 0, 7);
        ctx.fill();
        ctx.fillStyle = '#f0d36a';
        ctx.beginPath();
        ctx.arc(ox - 6 * k, oy - 4, 3.5, 0, 7);
        ctx.arc(ox + 6 * k, oy - 4, 3.5, 0, 7);
        ctx.fill();
      }
    }
    ctx.restore();
    // в тумане не видно, кто бьёт босса и сколько у него HP
    if (!g.visible(this.me, n.x, n.y, 60)) return;
    if (n.hp < n.maxHp || n.kind !== 'camp') {
      const w = n.kind === 'camp' ? 60 : 150;
      const y = n.y - R - (n.kind === 'lord' ? 50 : 26);
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

  private drawThrone(side: Side) {
    const { ctx, g } = this;
    const p = THRONE_POS[side];
    const hit = g.throneUnderAttack(side);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.fillStyle = C.dark;
    hex(ctx, 74);
    ctx.fill();
    ctx.fillStyle = C.sideDeep[this.rel(side)];
    hex(ctx, 62);
    ctx.fill();
    ctx.fillStyle = hit ? '#fff1d6' : C.side[this.rel(side)];
    ctx.beginPath();
    ctx.moveTo(-26, 18);
    ctx.lineTo(-26, -10);
    ctx.lineTo(-13, 2);
    ctx.lineTo(0, -24);
    ctx.lineTo(13, 2);
    ctx.lineTo(26, -10);
    ctx.lineTo(26, 18);
    ctx.closePath();
    ctx.fill();
    // кольцо прочности
    const k = g.throne[side] / BAL.throneHp;
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath();
    ctx.arc(0, 0, 86, 0, 7);
    ctx.stroke();
    ctx.strokeStyle = k > 0.35 ? C.side[this.rel(side)] : '#ffb347';
    ctx.beginPath();
    ctx.arc(0, 0, 86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.restore();
  }

  private drawCreep(c: Game['creeps'][number]) {
    const { ctx, g } = this;
    const p = g.creepPos(c);
    const col = C.side[this.rel(c.side)];
    ctx.fillStyle = C.dark;
    ctx.fillStyle = col;
    ctx.strokeStyle = C.dark;
    ctx.lineWidth = 3;
    const r = c.r * 1.25;
    ctx.beginPath();
    if (c.kind === 'melee') ctx.arc(p.x, p.y, r, 0, 7);
    else if (c.kind === 'ranged') {
      const d = c.side === 0 ? -1 : 1;
      ctx.moveTo(p.x, p.y + d * r * 1.2);
      ctx.lineTo(p.x - r, p.y - d * r * 0.8);
      ctx.lineTo(p.x + r, p.y - d * r * 0.8);
      ctx.closePath();
    } else ctx.rect(p.x - r, p.y - r * 0.8, r * 2, r * 1.6);
    ctx.stroke();
    ctx.fill();
    if (c.stunT > 0) {
      ctx.fillStyle = '#ffe680';
      ctx.fillRect(p.x - 6, p.y - r - 14, 12, 4);
    }
    if (c.slowT > 0) {
      ctx.strokeStyle = '#a9e4ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + 4, 0, 7);
      ctx.stroke();
    }
    if (c.hp < c.maxHp) bar(ctx, p.x - 16, p.y - r - 8, 32, 4, c.hp / c.maxHp, col);
  }

  private drawHero(h: Hero) {
    const { ctx, g } = this;
    const p = g.heroPos(h);
    const R = 40;
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
    // фигурка
    ctx.save();
    ctx.translate(0, -R * 0.15);
    ctx.scale(R * 1.15, R * 1.15);
    if (h.side === 1) ctx.scale(-1, 1); // верхняя команда смотрит в другую сторону
    drawHeroFigure(ctx, h.def, h.flash > 0);
    ctx.restore();
    // уровень
    ctx.fillStyle = '#f3d27a';
    ctx.beginPath();
    ctx.arc(R + 4, R * 0.55, 15, 0, 7);
    ctx.fill();
    ctx.fillStyle = C.dark;
    ctx.font = '800 19px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(h.lvl), R + 4, R * 0.55 + 1);
    // полоски HP и маны
    bar(ctx, -36, -R * 1.75 - 14, 72, 8, h.hp / h.maxHp, this.rel(h.side) === 0 ? '#7ee07a' : '#ff6f7f');
    bar(ctx, -36, -R * 1.75 - 4, 72, 5, h.mana / h.maxMana, '#6fa8ff');
    if (g.canCast(h) && h.side === this.me) {
      ctx.fillStyle = '#f3d27a';
      ctx.beginPath();
      ctx.moveTo(-6, -R * 1.75 - 30); ctx.lineTo(6, -R * 1.75 - 30); ctx.lineTo(0, -R * 1.75 - 20); ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
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

function hex(ctx: CanvasRenderingContext2D, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, col: string) {
  ctx.fillStyle = 'rgba(10,8,16,.8)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = col;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
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
