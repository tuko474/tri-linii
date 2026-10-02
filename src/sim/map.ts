// Геометрия карты в духе MOBA: квадрат, базы в противоположных углах.
// Игрок — снизу слева, противник — сверху справа.
// Верхняя линия идёт вдоль левого и верхнего края, нижняя — вдоль нижнего и правого,
// центральная — по диагонали. Река пересекает карту от верхнего левого угла к нижнему правому.
import { WORLD } from '../data/config';

export interface LanePoint {
  x: number;
  y: number;
  nx: number; // нормаль к линии, для бокового смещения юнитов
  ny: number;
}

export class LaneGeo {
  readonly pts: [number, number][];
  readonly cum: number[] = [0];
  readonly length: number;

  constructor(pts: [number, number][]) {
    this.pts = pts;
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      this.cum.push(this.cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
    }
    this.length = this.cum[this.cum.length - 1];
  }

  /** Точка на расстоянии s от трона игрока. */
  at(s: number): LanePoint {
    const d = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i] < d) i++;
    const [x0, y0] = this.pts[i - 1];
    const [x1, y1] = this.pts[i];
    const seg = this.cum[i] - this.cum[i - 1] || 1;
    const k = (d - this.cum[i - 1]) / seg;
    const dx = (x1 - x0) / seg;
    const dy = (y1 - y0) / seg;
    return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, nx: -dy, ny: dx };
  }

  pos(s: number, off: number): { x: number; y: number } {
    const p = this.at(s);
    return { x: p.x + p.nx * off, y: p.y + p.ny * off };
  }

  /** Расстояние от точки до линии (для отрисовки леса вне дорог). */
  dist(x: number, y: number): number {
    let best = Infinity;
    for (let i = 1; i < this.pts.length; i++) {
      best = Math.min(best, segDist(x, y, this.pts[i - 1], this.pts[i]));
    }
    return best;
  }
}

export function segDist(px: number, py: number, a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(px - (a[0] + dx * t), py - (a[1] + dy * t));
}

const { W, H } = WORLD;
const M = 360; // отступ баз от края

export const THRONE_POS: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: M, y: H - M },
  { x: W - M, y: M },
];

/** Расстояние от центра трона, с которого крипы бьют трон и выходят на линию. */
export const THRONE_R = 120;
/** Куда отходят герои, когда все вышки линии потеряны. */
export const GUARD_R = 300;

/** Барак стоит у начала каждой линии: на этом расстоянии от трона, сбоку от дороги. Оттуда выходят крипы. */
export const BARRACKS_S = 270;
export const BARRACKS_OFF = 135;
/** Где стоит барак линии: сбоку от дороги, с той стороны, где дальше от соседних линий. */
export function barracksPos(lanes: LaneGeo[], lane: number, side: 0 | 1): { x: number; y: number } {
  const L = lanes[lane];
  const s = side === 0 ? BARRACKS_S : L.length - BARRACKS_S;
  let best = L.pos(s, BARRACKS_OFF);
  let bd = -1;
  for (const off of [BARRACKS_OFF, -BARRACKS_OFF]) {
    const p = L.pos(s, off);
    const d = Math.min(...lanes.filter((_, i) => i !== lane).map((o) => o.dist(p.x, p.y)));
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}

/** Алтарь — за троном, в углу базы. */
export const ALTAR_POS: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: THRONE_POS[0].x - 175, y: THRONE_POS[0].y + 175 },
  { x: THRONE_POS[1].x + 175, y: THRONE_POS[1].y - 175 },
];

export const LANE_NAMES = ['Верхняя', 'Центральная', 'Нижняя'];
export const LANE_SHORT = ['Верх', 'Центр', 'Низ'];

const E = 320; // линия вдоль края — на таком расстоянии от него

export function buildLanes(): LaneGeo[] {
  const b = THRONE_POS[0];
  const t = THRONE_POS[1];
  return [
    // верхняя: вверх по левому краю, затем вправо по верхнему
    new LaneGeo([[b.x, b.y], [E, H - M - 260], [E, E + 140], [E + 140, E], [W - M - 260, E], [t.x, t.y]]),
    // центр: диагональ
    new LaneGeo([[b.x, b.y], [t.x, t.y]]),
    // нижняя: вправо по нижнему краю, затем вверх по правому
    new LaneGeo([[b.x, b.y], [M + 260, H - E], [W - E - 140, H - E], [W - E, H - E - 140], [W - E, M + 260], [t.x, t.y]]),
  ];
}

/** Средняя линия реки — от верхнего левого угла к нижнему правому, с лёгким изгибом. */
export const RIVER: [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    const x = -120 + (W + 240) * t;
    const y = -120 + (H + 240) * t;
    const wob = Math.sin(t * Math.PI * 3) * 80;
    const L = Math.hypot(W, H);
    pts.push([x + (wob * H) / L, y - (wob * W) / L]);
  }
  return pts;
})();
export const RIVER_W = 190;

/** На чьей половине точка: 0 — снизу слева от реки (игрок), 1 — сверху справа. */
export const halfOf = (x: number, y: number): 0 | 1 => (y * W > x * H ? 0 : 1);

const onRiver = (t: number) => ({ x: -120 + (W + 240) * t, y: -120 + (H + 240) * t });

/** Логова боссов в реке: Лорд ближе к верхней линии, Черепаха — к нижней. */
export const PITS = [
  { ...onRiver(0.31), name: 'Лорд' },
  { ...onRiver(0.69), name: 'Черепаха' },
];

/** Стражи у входа в логова: вдоль реки в сторону центра карты. */
export const GUARD_POS = PITS.map((p) => {
  const dx = W / 2 - p.x;
  const dy = H / 2 - p.y;
  const d = Math.hypot(dx, dy) || 1;
  return { x: p.x + (dx / d) * 400, y: p.y + (dy / d) * 400 };
});

/** Лесные лагеря (поляны): подбираются автоматически в лесу каждой половины, зеркально. */
export const CAMPS: { x: number; y: number }[] = (() => {
  const lanes = buildLanes();
  const ok = (x: number, y: number) =>
    halfOf(x, y) === 0 &&
    lanes.every((l) => l.dist(x, y) > 260) &&
    RIVER.every((_, i) => i === 0 || segDist(x, y, RIVER[i - 1], RIVER[i]) > RIVER_W / 2 + 200) &&
    THRONE_POS.every((t) => Math.hypot(t.x - x, t.y - y) > 700) &&
    PITS.every((p) => Math.hypot(p.x - x, p.y - y) > 520) &&
    x > 200 && y > 200 && x < W - 200 && y < H - 200;
  const cand: { x: number; y: number }[] = [];
  for (let y = 150; y < H; y += 60) for (let x = 150; x < W; x += 60) if (ok(x, y)) cand.push({ x, y });
  // самые удалённые друг от друга точки
  const picked: { x: number; y: number }[] = [];
  if (cand.length) picked.push(cand[Math.floor(cand.length / 2)]);
  while (picked.length < 10 && cand.length) {
    let best = cand[0];
    let bd = -1;
    for (const c of cand) {
      const d = Math.min(...picked.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      if (d > bd) { bd = d; best = c; }
    }
    if (bd < 430) break;
    picked.push(best);
  }
  return [...picked, ...picked.map((p) => ({ x: W - p.x, y: H - p.y }))];
})();
