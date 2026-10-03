// Отрисовка поля на Canvas 2D с камерой. Читает состояние Game, ничего в нём не меняет.
import { BAL, WORLD } from '../data/config';
import type { Game } from '../sim/game';
import { ALTAR_POS, CAMPS, GUARD_POS, PITS, RIVER, RIVER_W, THRONE_POS, barracksPos, segDist } from '../sim/map';
import type { Hero, Neutral, Side } from '../sim/types';
import { drawBeastFigure, drawCastleFigure, drawHeroFigure } from './art';

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
    const spots = [...ALTAR_POS, ...[0, 1, 2].flatMap((l) => [barracksPos(g.lanes, l, 0), barracksPos(g.lanes, l, 1)])];
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
        GUARD_POS.every((p) => Math.hypot(p.x - px, p.y - py) > 110 + s) &&
        spots.every((p) => Math.hypot(p.x - px, p.y - py) > 85 + s);
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
    for (const s of [0, 1] as Side[]) { this.drawThrone(s); this.drawBase(s); }
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
    // звери «дышат» и чуть покачиваются, у каждого своя фаза
    const now = performance.now() / 1000;
    const beast = (kind: string, x: number, y: number, size: number, flip: boolean, ph: number) => {
      const br = Math.sin(now * 2.2 + ph);
      ctx.save();
      ctx.translate(x, y + size * 0.6);
      ctx.scale(flip ? -1 : 1, 1 + br * 0.025);
      ctx.drawImage(this.beastSprite(kind), -size * 2, -size * 2 - size * 0.6, size * 4, size * 4);
      ctx.restore();
    };
    if (n.kind === 'lord') beast('lord', n.x, n.y + 6, R * 1.05, false, 0);
    else if (n.kind === 'turtle') beast('turtle', n.x, n.y, R * 1.05, n.x > WORLD.W / 2, 1);
    else {
      const kind = ['wolf', 'boar', 'spider'][n.id % 3];
      beast(kind, n.x + 26, n.y - 10, R * 0.9, true, n.id + 2);
      beast(kind, n.x - 22, n.y + 10, R * 1.15, false, n.id);
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

  /** Готовые картинки лесных зверей и боссов (рамка ±40 единиц рисунка). */
  private beastSprites = new Map<string, HTMLCanvasElement>();

  private beastSprite(kind: string): HTMLCanvasElement {
    let cv = this.beastSprites.get(kind);
    if (!cv) {
      const k = kind === 'lord' || kind === 'turtle' ? 8 : 4; // пикселей на единицу рисунка
      cv = document.createElement('canvas');
      cv.width = cv.height = 80 * k;
      const x = cv.getContext('2d')!;
      x.scale(k, k);
      x.translate(40, 40);
      drawBeastFigure(x, kind);
      this.beastSprites.set(kind, cv);
    }
    return cv;
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
      ctx.translate(0, R * 0.6 - Math.abs(step) * R * 0.06);
      ctx.scale(1, 1 + step * 0.015);
      ctx.drawImage(this.beastSprite('lord'), -R * 2, -R * 2 - R * 0.6, R * 4, R * 4);
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

/** Рамка картинки замка в координатах мира относительно точки трона. */
const CASTLE_BOX = { x: -96, y: -180, w: 192, h: 230 };

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
