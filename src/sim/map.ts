// Геометрия карты: три линии от трона игрока (низ) к трону противника (верх).
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
}

const { W, H } = WORLD;
export const THRONE_POS: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: W / 2, y: H - 90 },
  { x: W / 2, y: 90 },
];

export const LANE_NAMES = ['Левая', 'Центр', 'Правая'];

export function buildLanes(): LaneGeo[] {
  const b = THRONE_POS[0];
  const t = THRONE_POS[1];
  return [
    new LaneGeo([[b.x, b.y], [140, H - 330], [140, 330], [t.x, t.y]]),
    new LaneGeo([[b.x, b.y], [t.x, t.y]]),
    new LaneGeo([[b.x, b.y], [W - 140, H - 330], [W - 140, 330], [t.x, t.y]]),
  ];
}
