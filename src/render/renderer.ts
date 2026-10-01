// Отрисовка поля на Canvas 2D. Читает состояние Game, ничего в нём не меняет.
import { BAL, WORLD } from '../data/config';
import type { Game } from '../sim/game';
import { THRONE_POS } from '../sim/map';
import type { Hero, Side } from '../sim/types';

const C = {
  grass: '#2f4a33',
  grass2: '#36553a',
  tree: '#1f3524',
  tree2: '#284430',
  road: '#8a7550',
  roadEdge: '#6d5b3d',
  river: '#2c5a72',
  river2: '#3b7391',
  pad: '#5b5346',
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

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement = document.createElement('canvas');
  k = 1;
  private dpr = 1;
  selected: Hero | null = null;

  constructor(private cv: HTMLCanvasElement, private g: Game) {
    this.ctx = cv.getContext('2d')!;
  }

  resize(cssW: number, cssH: number) {
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.k = Math.min(cssW / WORLD.W, cssH / WORLD.H);
    const w = Math.floor(WORLD.W * this.k);
    const h = Math.floor(WORLD.H * this.k);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.cv.width = Math.floor(w * this.dpr);
    this.cv.height = Math.floor(h * this.dpr);
    this.drawStatic();
  }

  /** Перевод координат касания (CSS px внутри canvas) в мировые. */
  toWorld(px: number, py: number) {
    return { x: px / this.k, y: py / this.k };
  }

  private drawStatic() {
    const g = this.g;
    this.bg.width = this.cv.width;
    this.bg.height = this.cv.height;
    const x = this.bg.getContext('2d')!;
    x.setTransform(this.k * this.dpr, 0, 0, this.k * this.dpr, 0, 0);

    x.fillStyle = C.grass;
    x.fillRect(0, 0, WORLD.W, WORLD.H);
    const r = rng(7);
    for (let i = 0; i < 260; i++) {
      x.fillStyle = r() > 0.5 ? C.grass2 : '#2b4430';
      x.beginPath();
      x.arc(r() * WORLD.W, r() * WORLD.H, 20 + r() * 60, 0, 7);
      x.fill();
    }

    // река по диагонали — граница половин карты
    x.lineCap = 'round';
    x.strokeStyle = C.river;
    x.lineWidth = 90;
    x.beginPath();
    x.moveTo(-40, 1010);
    x.bezierCurveTo(300, 960, 700, 840, 1040, 790);
    x.stroke();
    x.strokeStyle = C.river2;
    x.lineWidth = 34;
    x.stroke();

    // дороги
    x.lineJoin = 'round';
    for (const lane of g.lanes) {
      x.beginPath();
      lane.pts.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.strokeStyle = C.roadEdge;
      x.lineWidth = 92;
      x.stroke();
      x.strokeStyle = C.road;
      x.lineWidth = 76;
      x.stroke();
    }

    // деревья вне дорог
    const near = (px: number, py: number) => {
      for (const lane of g.lanes) {
        for (let s = 0; s <= lane.length; s += 25) {
          const p = lane.at(s);
          if (Math.hypot(p.x - px, p.y - py) < 85) return true;
        }
      }
      return THRONE_POS.some((t) => Math.hypot(t.x - px, t.y - py) < 150);
    };
    const tr = rng(42);
    for (let i = 0; i < 340; i++) {
      const px = tr() * WORLD.W;
      const py = tr() * WORLD.H;
      if (near(px, py)) continue;
      const s = 16 + tr() * 18;
      x.fillStyle = C.tree;
      x.beginPath();
      x.arc(px, py + 4, s, 0, 7);
      x.fill();
      x.fillStyle = C.tree2;
      x.beginPath();
      x.arc(px - 3, py, s * 0.8, 0, 7);
      x.fill();
    }

    // площадки вышек
    for (const lane of g.lanes) {
      BAL.slotT.forEach((t, i) => {
        const p = lane.at(t * lane.length);
        x.fillStyle = C.pad;
        x.beginPath();
        x.ellipse(p.x, p.y, 58, 46, 0, 0, 7);
        x.fill();
        x.strokeStyle = i < 3 ? C.sideDeep[0] : C.sideDeep[1];
        x.lineWidth = 4;
        x.stroke();
      });
    }
  }

  draw() {
    const { ctx, g } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(this.k * this.dpr, 0, 0, this.k * this.dpr, 0, 0);

    this.drawFronts();
    for (const s of [0, 1] as Side[]) this.drawThrone(s);
    for (const w of g.wards) {
      const p = g.lanes[w.lane].pos(w.s, w.off);
      ctx.fillStyle = '#2d6b57';
      ctx.fillRect(p.x - 7, p.y - 18, 14, 26);
      ctx.fillStyle = '#5fc9a8';
      ctx.beginPath();
      ctx.arc(p.x, p.y - 20, 8, 0, 7);
      ctx.fill();
    }
    for (const c of g.creeps) this.drawCreep(c);
    for (const h of g.heroes) this.drawHero(h);

    for (const p of g.projs) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 7);
      ctx.fill();
    }
    this.drawFx();
  }

  /** Подсветка: до какой позиции дошла каждая сторона на линии. */
  private drawFronts() {
    const { ctx, g } = this;
    for (let l = 0; l < 3; l++) {
      for (const side of [0, 1] as Side[]) {
        const s = g.slotS(l, side);
        const p = g.lanes[l].at(s);
        ctx.fillStyle = side === 0 ? 'rgba(95,212,196,.22)' : 'rgba(224,86,107,.22)';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 64, 52, 0, 0, 7);
        ctx.fill();
      }
    }
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
    ctx.fillStyle = C.sideDeep[side];
    hex(ctx, 62);
    ctx.fill();
    ctx.fillStyle = hit ? '#fff1d6' : C.side[side];
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
    ctx.strokeStyle = k > 0.35 ? C.side[side] : '#ffb347';
    ctx.beginPath();
    ctx.arc(0, 0, 86, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.stroke();
    ctx.restore();
  }

  private drawCreep(c: Game['creeps'][number]) {
    const { ctx, g } = this;
    const p = g.creepPos(c);
    const col = C.side[c.side];
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
    const R = 30;
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
    if (this.selected === h) {
      ctx.strokeStyle = 'rgba(243,210,122,.6)';
      ctx.setLineDash([10, 8]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, h.def.range, 0, 7);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = C.dark;
    ctx.beginPath();
    ctx.arc(0, 4, R + 6, 0, 7);
    ctx.fill();
    ctx.fillStyle = C.side[h.side];
    ctx.beginPath();
    ctx.arc(0, 0, R + 5, 0, 7);
    ctx.fill();
    ctx.fillStyle = h.flash > 0 ? '#ffffff' : h.def.color;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, 7);
    ctx.fill();
    ctx.fillStyle = C.dark;
    ctx.font = '800 30px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(h.def.glyph, 0, 2);
    // уровень
    ctx.fillStyle = '#f3d27a';
    ctx.beginPath();
    ctx.arc(R - 2, R - 4, 17, 0, 7);
    ctx.fill();
    ctx.fillStyle = C.dark;
    ctx.font = '800 22px system-ui, sans-serif';
    ctx.fillText(String(h.lvl), R - 2, R - 2);
    // полоски HP и маны
    bar(ctx, -36, -R - 22, 72, 8, h.hp / h.maxHp, h.side === 0 ? '#7ee07a' : '#ff6f7f');
    bar(ctx, -36, -R - 12, 72, 5, h.mana / h.maxMana, '#6fa8ff');
    if (g.canCast(h)) {
      ctx.strokeStyle = '#f3d27a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, R + 9, 0, 7);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawFx() {
    const ctx = this.ctx;
    for (const f of this.g.fx) {
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
