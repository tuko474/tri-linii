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
const M = 330; // отступ баз от края

export const THRONE_POS: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: M, y: H - M },
  { x: W - M, y: M },
];

/** Расстояние от центра трона, с которого крипы бьют трон и выходят на линию. */
export const THRONE_R = 120;
/** Куда отходят герои, когда все вышки линии потеряны. */
export const GUARD_R = 300;

export const LANE_NAMES = ['Верхняя', 'Центр', 'Нижняя'];
export const LANE_SHORT = ['Верх', 'Центр', 'Низ'];

const E = 300; // линия вдоль края — на таком расстоянии от него

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
    const wob = Math.sin(t * Math.PI * 3) * 70;
    pts.push([x + wob * 0.707, y - wob * 0.707]);
  }
  return pts;
})();
export const RIVER_W = 190;

/** Логова будущих боссов в реке. */
export const PITS = [
  { x: 760, y: 760, name: 'Лорд' },
  { x: W - 760, y: H - 760, name: 'Черепаха' },
];

/** Лесные лагеря (поляны). Зеркально для обеих сторон. */
export const CAMPS: { x: number; y: number }[] = (() => {
  const mine = [
    { x: 560, y: 1250 }, { x: 830, y: 1350 }, { x: 540, y: 1660 },
    { x: 1150, y: 1900 }, { x: 1460, y: 1720 }, { x: 1200, y: 1560 },
  ];
  return [...mine, ...mine.map((p) => ({ x: W - p.x, y: H - p.y }))];
})();
