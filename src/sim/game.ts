// Симуляция боя. Не знает ничего про экран — только состояние и правила.
// Это пригодится для онлайна: тот же код сможет крутиться на сервере.
import { BAL, CreepKind, Difficulty } from '../data/config';
import { heroById } from '../data/heroes';
import { LaneGeo, LANE_NAMES, THRONE_POS, buildLanes } from './map';
import type { Creep, Fx, GameEvent, Hero, Pick, Proj, Side, Target, Ward } from './types';

const SIDE_COLOR = ['#5fd4c4', '#e0566b'];

export class Game {
  t = 0;
  lanes: LaneGeo[] = buildLanes();
  heroes: Hero[] = [];
  creeps: Creep[] = [];
  wards: Ward[] = [];
  projs: Proj[] = [];
  fx: Fx[] = [];
  events: GameEvent[] = [];

  gold: [number, number] = [BAL.startGold, BAL.startGold];
  throne: [number, number] = [BAL.throneHp, BAL.throneHp];
  /** front[lane][side] — индекс позиции героев. Игрок: 2 → 1 → 0 → -1 (у трона). Противник: 3 → 4 → 5 → 6. */
  front: [number, number][] = [[2, 3], [2, 3], [2, 3]];
  creepLvl: [number, number][] = [[0, 0], [0, 0], [0, 0]];
  waveTimer = BAL.firstWave;
  waveNo = 0;
  winner: Side | null = null;
  autoCast: [boolean, boolean] = [false, true];
  incomeMul: [number, number];
  stats = { kills: [0, 0], pushes: [0, 0], goldEarned: [0, 0] };

  private uid = 1;
  private throneAtkFx = [0, 0];

  constructor(picks: [Pick[], Pick[]], difficulty: Difficulty) {
    this.incomeMul = [1, BAL.difficulty[difficulty].botIncome];
    ([0, 1] as Side[]).forEach((side) => {
      for (const p of picks[side]) {
        const def = heroById(p.heroId);
        this.heroes.push({
          uid: this.uid++, def, side, lane: p.lane, lvl: 1,
          hp: def.hp, maxHp: def.hp, mana: def.mana * 0.5, maxMana: def.mana, dmg: def.dmg,
          cd: 0, atkCd: 0, dead: false, respawn: 0, off: 0, s: 0, flash: 0, casts: 0,
        });
      }
    });
    for (let l = 0; l < 3; l++) this.placeHeroes(l);
  }

  // ---------- геометрия ----------

  slotS(lane: number, side: Side): number {
    const f = this.front[lane][side];
    const L = this.lanes[lane].length;
    if (side === 0 && f < 0) return BAL.throneGuardT[0] * L;
    if (side === 1 && f > 5) return BAL.throneGuardT[1] * L;
    return BAL.slotT[f] * L;
  }

  atThrone(lane: number, side: Side): boolean {
    const f = this.front[lane][side];
    return side === 0 ? f < 0 : f > 5;
  }

  heroesOn(lane: number, side: Side): Hero[] {
    return this.heroes.filter((h) => h.lane === lane && h.side === side);
  }

  private placeHeroes(lane: number) {
    ([0, 1] as Side[]).forEach((side) => {
      const list = this.heroesOn(lane, side);
      const offs = list.length === 1 ? [0] : list.length === 2 ? [-42, 42] : [-62, 0, 62];
      const s = this.slotS(lane, side);
      list.forEach((h, i) => {
        h.s = s;
        h.off = offs[i] ?? 0;
      });
    });
  }

  heroPos(h: Hero) {
    return this.lanes[h.lane].pos(h.s, h.off);
  }

  creepPos(c: Creep) {
    return this.lanes[c.lane].pos(c.s, c.off);
  }

  private targetPos(t: Target) {
    if (t.kind === 'creep') return this.creepPos(t.c);
    if (t.kind === 'hero') return this.heroPos(t.h);
    return THRONE_POS[t.side];
  }

  // ---------- действия игрока / бота ----------

  heroUpCost(h: Hero) {
    return BAL.heroUpCost(h.lvl);
  }

  creepUpCost(lane: number, side: Side) {
    return BAL.creepUpCost(this.creepLvl[lane][side]);
  }

  levelHero(h: Hero): boolean {
    const cost = this.heroUpCost(h);
    if (h.lvl >= BAL.heroMaxLvl || this.gold[h.side] < cost) return false;
    this.gold[h.side] -= cost;
    h.lvl++;
    const k = h.lvl - 1;
    const newMax = h.def.hp * (1 + BAL.heroHpPerLvl * k);
    h.hp += newMax - h.maxHp;
    h.maxHp = newMax;
    h.dmg = h.def.dmg * (1 + BAL.heroDmgPerLvl * k);
    h.maxMana = h.def.mana * (1 + BAL.heroManaPerLvl * k);
    if (!h.dead) this.fxRingAtHero(h, '#f3d27a', 40);
    return true;
  }

  upgradeCreeps(lane: number, side: Side): boolean {
    const cost = this.creepUpCost(lane, side);
    if (this.creepLvl[lane][side] >= BAL.creepMaxLvl || this.gold[side] < cost) return false;
    this.gold[side] -= cost;
    this.creepLvl[lane][side]++;
    return true;
  }

  canCast(h: Hero) {
    return !h.dead && h.cd <= 0 && h.mana >= h.def.skill.mana;
  }

  /** Применить способность. strict=true — только если эффект стоящий (для автокаста). */
  cast(h: Hero, strict = false): boolean {
    if (!this.canCast(h)) return false;
    const sk = h.def.skill;
    const pow = sk.power + sk.perLvl * (h.lvl - 1);
    const range = sk.range ?? h.def.range;
    const enemies = this.creeps.filter((c) => !c.dead && c.side !== h.side && c.lane === h.lane);
    const inRange = enemies.filter((c) => Math.abs(c.s - h.s) <= range);
    const lane = this.lanes[h.lane];
    const need = strict ? 2 : 1;
    let ok = false;

    switch (sk.kind) {
      case 'blast': {
        const R = sk.radius ?? 100;
        let best: Creep | null = null;
        let bestN = 0;
        for (const c of inRange) {
          const n = enemies.filter((e) => Math.abs(e.s - c.s) <= R).length;
          if (n > bestN) { bestN = n; best = c; }
        }
        if (!best || bestN < need) break;
        const center = best.s;
        for (const e of enemies) {
          if (Math.abs(e.s - center) > R) continue;
          this.hitCreep(e, pow);
          if (sk.slow) this.slowCreep(e, sk.slow, sk.slowT ?? 2);
        }
        const p = lane.at(center);
        this.fx.push({ kind: 'ring', x: p.x, y: p.y, r: R, color: h.def.color, t: 0, life: 0.6 });
        ok = true;
        break;
      }
      case 'around': {
        const R = sk.radius ?? 140;
        const hit = enemies.filter((e) => Math.abs(e.s - h.s) <= R);
        if (hit.length < need) break;
        for (const e of hit) {
          this.hitCreep(e, pow);
          if (sk.stun) e.stunT = Math.max(e.stunT, sk.stun);
        }
        this.fxRingAtHero(h, h.def.color, R);
        ok = true;
        break;
      }
      case 'chain': {
        if (inRange.length < 1 || (strict && enemies.length < 2)) break;
        let cur = inRange.reduce((a, b) => (Math.abs(a.s - h.s) < Math.abs(b.s - h.s) ? a : b));
        const done = new Set<Creep>();
        let from = this.heroPos(h);
        for (let i = 0; i < (sk.count ?? 4) && cur; i++) {
          done.add(cur);
          const to = this.creepPos(cur);
          this.fx.push({ kind: 'bolt', x: from.x, y: from.y, x2: to.x, y2: to.y, color: h.def.color, t: 0, life: 0.35 });
          this.hitCreep(cur, pow * Math.pow(0.9, i));
          from = to;
          const prev: Creep = cur;
          const next = enemies
            .filter((e) => !done.has(e) && Math.abs(e.s - prev.s) <= 170)
            .sort((a, b) => Math.abs(a.s - prev.s) - Math.abs(b.s - prev.s))[0];
          if (!next) break;
          cur = next;
        }
        ok = true;
        break;
      }
      case 'volley': {
        if (inRange.length < need) break;
        const targets = [...inRange].sort((a, b) => Math.abs(a.s - h.s) - Math.abs(b.s - h.s)).slice(0, sk.count ?? 5);
        const from = this.heroPos(h);
        for (const c of targets) {
          const to = this.creepPos(c);
          this.fx.push({ kind: 'beam', x: from.x, y: from.y, x2: to.x, y2: to.y, color: h.def.color, t: 0, life: 0.25 });
          this.hitCreep(c, pow);
          if (sk.slow) this.slowCreep(c, sk.slow, sk.slowT ?? 2);
        }
        ok = true;
        break;
      }
      case 'drain': {
        if (inRange.length < need) break;
        for (const c of inRange) this.hitCreep(c, pow);
        const heal = inRange.length * pow * 0.25;
        for (const a of this.heroesOn(h.lane, h.side)) if (!a.dead) this.healHero(a, heal);
        this.fxRingAtHero(h, h.def.color, range);
        ok = true;
        break;
      }
      case 'snipe': {
        if (inRange.length < 1) break;
        if (strict && !inRange.some((c) => c.hp > pow * 0.5)) break;
        const tgt = inRange.reduce((a, b) => (a.hp > b.hp ? a : b));
        const from = this.heroPos(h);
        const to = this.creepPos(tgt);
        this.fx.push({ kind: 'beam', x: from.x, y: from.y, x2: to.x, y2: to.y, color: '#fff3c4', t: 0, life: 0.4 });
        this.hitCreep(tgt, pow);
        ok = true;
        break;
      }
      case 'wards': {
        if (inRange.length < need) break;
        const dir = h.side === 0 ? 1 : -1;
        for (let i = 0; i < (sk.count ?? 3); i++) {
          this.wards.push({
            side: h.side, lane: h.lane, s: h.s + dir * (40 + 25 * i), off: (i - 1) * 45,
            ttl: 10, dmg: pow, range: 210, atkCd: 0.2 * i,
          });
        }
        ok = true;
        break;
      }
      case 'heal': {
        const allies = this.heroesOn(h.lane, h.side).filter((a) => !a.dead);
        const hurt = allies.some((a) => a.hp < a.maxHp * 0.75);
        const R = sk.radius ?? 140;
        const near = enemies.filter((e) => Math.abs(e.s - h.s) <= R);
        if (strict && !hurt && near.length < 3) break;
        if (!strict && !hurt && near.length === 0 && allies.every((a) => a.hp >= a.maxHp)) break;
        for (const a of allies) this.healHero(a, pow);
        for (const e of near) this.hitCreep(e, pow * 0.35);
        this.fxRingAtHero(h, h.def.color, R);
        ok = true;
        break;
      }
    }

    if (ok) {
      h.mana -= sk.mana;
      h.cd = sk.cd;
      h.casts++;
    }
    return ok;
  }

  // ---------- основной цикл ----------

  update(dt: number) {
    if (this.winner !== null) return;
    this.t += dt;
    for (const s of [0, 1] as Side[]) this.addGold(s, BAL.passiveGold * dt);

    this.waveTimer -= dt;
    if (this.waveTimer <= 0) {
      this.waveTimer = BAL.waveEvery;
      this.spawnWave();
    }

    this.updateHeroes(dt);
    this.updateWards(dt);
    this.updateCreeps(dt);
    this.updateProjs(dt);
    this.cleanup();

    for (const f of this.fx) f.t += dt;
    this.fx = this.fx.filter((f) => f.t < f.life);
    this.throneAtkFx[0] = Math.max(0, this.throneAtkFx[0] - dt);
    this.throneAtkFx[1] = Math.max(0, this.throneAtkFx[1] - dt);

    for (const s of [0, 1] as Side[]) {
      if (this.throne[s] <= 0) {
        this.throne[s] = 0;
        this.winner = (1 - s) as Side;
      }
    }
  }

  throneUnderAttack(side: Side) {
    return this.throneAtkFx[side] > 0;
  }

  private addGold(side: Side, g: number) {
    const v = g * this.incomeMul[side];
    this.gold[side] += v;
    this.stats.goldEarned[side] += v;
  }

  private spawnWave() {
    this.waveNo++;
    for (let lane = 0; lane < 3; lane++) {
      const L = this.lanes[lane].length;
      for (const side of [0, 1] as Side[]) {
        const lvl = this.creepLvl[lane][side];
        const kinds: CreepKind[] = [];
        const melee = 3 + Math.floor(lvl / 4);
        for (let i = 0; i < melee; i++) kinds.push('melee');
        kinds.push('ranged');
        if (lvl >= 6) kinds.push('ranged');
        if (this.waveNo % BAL.siegeEvery === 0) kinds.push('siege');
        const dir = side === 0 ? 1 : -1;
        const base = BAL.throneT[side] * L;
        kinds.forEach((kind, i) => {
          const st = BAL.creep[kind];
          const mul = 1 + BAL.creepLvlMul * lvl;
          this.creeps.push({
            uid: this.uid++, kind, side, lane,
            s: base - dir * i * 28,
            off: ((i % 3) - 1) * 16,
            hp: st.hp * mul, maxHp: st.hp * mul, dmg: st.dmg * mul,
            range: st.range, rate: st.rate, speed: st.speed, atkCd: Math.random() * 0.3,
            slowT: 0, slowMul: 1, stunT: 0, gold: st.gold, r: st.r, dead: false,
          });
        });
      }
    }
  }

  private updateHeroes(dt: number) {
    for (const h of this.heroes) {
      h.flash = Math.max(0, h.flash - dt);
      if (h.dead) {
        h.respawn -= dt;
        if (h.respawn <= 0) {
          h.dead = false;
          h.hp = h.maxHp;
          h.mana = Math.max(h.mana, h.maxMana * 0.5);
        }
        continue;
      }
      h.cd = Math.max(0, h.cd - dt);
      h.mana = Math.min(h.maxMana, h.mana + (3 + 0.35 * h.lvl) * dt);
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * BAL.heroRegen * dt);

      if (this.autoCast[h.side] && this.canCast(h)) this.cast(h, true);

      h.atkCd -= dt;
      if (h.atkCd > 0) continue;
      const tgt = this.nearestEnemyCreep(h.lane, h.side, h.s, h.def.range);
      if (!tgt) continue;
      h.atkCd = h.def.rate;
      if (h.def.range < 150) {
        this.hitCreep(tgt, h.dmg);
      } else {
        const p = this.heroPos(h);
        this.projs.push({ x: p.x, y: p.y, target: { kind: 'creep', c: tgt }, dmg: h.dmg, speed: 700, color: h.def.color, size: 4 });
      }
    }
  }

  private updateWards(dt: number) {
    for (const w of this.wards) {
      w.ttl -= dt;
      w.atkCd -= dt;
      if (w.atkCd > 0) continue;
      const tgt = this.nearestEnemyCreep(w.lane, w.side, w.s, w.range);
      if (!tgt) continue;
      w.atkCd = 0.8;
      const p = this.lanes[w.lane].pos(w.s, w.off);
      this.projs.push({ x: p.x, y: p.y, target: { kind: 'creep', c: tgt }, dmg: w.dmg, speed: 600, color: '#5fc9a8', size: 3 });
    }
    this.wards = this.wards.filter((w) => w.ttl > 0);
  }

  private nearestEnemyCreep(lane: number, side: Side, s: number, range: number): Creep | null {
    let best: Creep | null = null;
    let bd = Infinity;
    for (const c of this.creeps) {
      if (c.dead || c.lane !== lane || c.side === side) continue;
      const d = Math.abs(c.s - s);
      if (d <= range && d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private updateCreeps(dt: number) {
    for (const c of this.creeps) {
      if (c.dead) continue;
      c.atkCd -= dt;
      if (c.slowT > 0) c.slowT -= dt; else c.slowMul = 1;
      if (c.stunT > 0) { c.stunT -= dt; continue; }

      const dir = c.side === 0 ? 1 : -1;
      const L = this.lanes[c.lane].length;
      const reach = c.range + c.r;

      // 1. вражеский крип в зоне атаки
      const ec = this.nearestEnemyCreep(c.lane, c.side, c.s, reach + 10);
      let target: Target | null = ec ? { kind: 'creep', c: ec } : null;

      // 2. вражеский герой
      if (!target) {
        let bh: Hero | null = null;
        let bd = Infinity;
        for (const h of this.heroes) {
          if (h.dead || h.lane !== c.lane || h.side === c.side) continue;
          const d = (h.s - c.s) * dir;
          if (d >= -20 && d <= reach + 22 && d < bd) { bd = d; bh = h; }
        }
        if (bh) target = { kind: 'hero', h: bh };
      }

      // 3. вражеский трон
      if (!target) {
        const throneS = BAL.throneT[1 - c.side] * L;
        if ((throneS - c.s) * dir <= reach + 30) target = { kind: 'throne', side: (1 - c.side) as Side };
      }

      if (target) {
        if (c.atkCd <= 0) {
          c.atkCd = c.rate;
          if (c.range < 100) this.applyHit(target, c.dmg);
          else {
            const p = this.creepPos(c);
            this.projs.push({ x: p.x, y: p.y, target, dmg: c.dmg, speed: 450, color: c.side === 0 ? '#bff3ea' : '#ffc2cb', size: c.kind === 'siege' ? 6 : 3 });
          }
        }
        continue;
      }

      // 4. двигаемся вперёд, но не дальше живого вражеского героя
      c.s += dir * c.speed * c.slowMul * dt;
    }
  }

  private updateProjs(dt: number) {
    for (const p of this.projs) {
      const to = this.targetPos(p.target);
      const dx = to.x - p.x;
      const dy = to.y - p.y;
      const d = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step) {
        p.speed = 0;
        this.applyHit(p.target, p.dmg);
      } else {
        p.x += (dx / d) * step;
        p.y += (dy / d) * step;
      }
    }
    this.projs = this.projs.filter((p) => p.speed > 0);
  }

  private applyHit(t: Target, dmg: number) {
    if (t.kind === 'creep') this.hitCreep(t.c, dmg);
    else if (t.kind === 'hero') this.hitHero(t.h, dmg);
    else {
      if (this.winner !== null) return;
      this.throne[t.side] -= dmg;
      this.throneAtkFx[t.side] = 1.2;
    }
  }

  private hitCreep(c: Creep, dmg: number) {
    if (c.dead) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      c.dead = true;
      const killer = (1 - c.side) as Side;
      this.addGold(killer, c.gold);
      this.stats.kills[killer]++;
      if (killer === 0) {
        const p = this.creepPos(c);
        this.fx.push({ kind: 'text', x: p.x, y: p.y, text: '+' + c.gold, color: '#f3d27a', t: 0, life: 0.9 });
      }
    }
  }

  private slowCreep(c: Creep, mul: number, t: number) {
    c.slowMul = Math.min(c.slowMul, mul);
    c.slowT = Math.max(c.slowT, t);
  }

  private hitHero(h: Hero, dmg: number) {
    if (h.dead) return;
    h.hp -= dmg;
    h.flash = 0.12;
    if (h.hp <= 0) {
      h.hp = 0;
      h.dead = true;
      h.respawn = BAL.heroRespawn;
      this.onHeroDown(h);
    }
  }

  private healHero(h: Hero, v: number) {
    h.hp = Math.min(h.maxHp, h.hp + v);
    const p = this.heroPos(h);
    this.fx.push({ kind: 'heal', x: p.x, y: p.y, color: '#9cf09a', text: '+' + Math.round(v), t: 0, life: 0.9 });
  }

  /** Все герои стороны на линии пали — линия откатывается. */
  private onHeroDown(h: Hero) {
    const lane = h.lane;
    const loser = h.side;
    if (this.heroesOn(lane, loser).some((x) => !x.dead)) return;
    if (this.atThrone(lane, loser)) return; // отступать некуда, герои просто ждут возрождения
    const winner = (1 - loser) as Side;
    const old = this.front[lane][loser];
    this.front[lane][loser] = loser === 0 ? old - 1 : old + 1;
    this.front[lane][winner] = old;
    this.placeHeroes(lane);
    for (const x of this.heroesOn(lane, loser)) x.respawn = BAL.pushRespawn;
    this.stats.pushes[winner]++;
    const exposed = this.atThrone(lane, loser);
    const name = LANE_NAMES[lane];
    const text = winner === 0
      ? exposed ? `${name}: путь к трону врага открыт!` : `${name} линия продавлена`
      : exposed ? `${name}: враг у твоего трона!` : `${name} линия потеряна`;
    this.events.push({ text, side: winner });
  }

  private cleanup() {
    this.creeps = this.creeps.filter((c) => !c.dead);
  }

  private fxRingAtHero(h: Hero, color: string, r: number) {
    const p = this.heroPos(h);
    this.fx.push({ kind: 'ring', x: p.x, y: p.y, r, color, t: 0, life: 0.55 });
  }

  sideColor(side: Side) {
    return SIDE_COLOR[side];
  }
}
