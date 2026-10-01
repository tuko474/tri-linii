// Симуляция боя. Не знает ничего про экран — только состояние и правила.
// Это пригодится для онлайна: тот же код сможет крутиться на сервере.
import { BAL, CreepKind, Difficulty } from '../data/config';
import { heroById } from '../data/heroes';
import { CAMPS, GUARD_R, LaneGeo, LANE_NAMES, PITS, THRONE_POS, THRONE_R, buildLanes } from './map';
import type { Creep, Fx, GameEvent, Hero, Neutral, NeutralKind, Pick, Proj, Side, Target, Ward } from './types';

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
  /** Звуковые события для клиента: 'cast:blast', 'kill', 'levelUp' и т.д. */
  sfx: string[] = [];
  /** 0 — Лорд, 1 — Черепаха, дальше лесные лагеря. */
  neutrals: Neutral[] = [];

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
  stats = { kills: [0, 0], pushes: [0, 0], goldEarned: [0, 0], lords: [0, 0], turtles: [0, 0], camps: [0, 0] };

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
          cd: 0, atkCd: 0, dead: false, respawn: 0, off: 0, s: 0, flash: 0, casts: 0, trip: null,
        });
      }
    });
    for (let l = 0; l < 3; l++) this.placeHeroes(l);
    const mk = (kind: NeutralKind, x: number, y: number) => {
      const cfg = BAL.neutral[kind];
      this.neutrals.push({
        id: this.neutrals.length, kind, x, y, hp: 0, maxHp: cfg.hp, dmg: cfg.dmg,
        alive: false, respawnT: cfg.first, atkCd: 0, hits: 0, flash: 0,
      });
    };
    mk('lord', PITS[0].x, PITS[0].y);
    mk('turtle', PITS[1].x, PITS[1].y);
    for (const c of CAMPS) mk('camp', c.x, c.y);
  }

  // ---------- геометрия ----------

  slotS(lane: number, side: Side): number {
    const f = this.front[lane][side];
    const L = this.lanes[lane].length;
    if (side === 0 && f < 0) return GUARD_R;
    if (side === 1 && f > 5) return L - GUARD_R;
    return BAL.slotT[f] * L;
  }

  /** Точка на линии, откуда бьют трон стороны side. */
  throneS(lane: number, side: Side): number {
    return side === 0 ? THRONE_R : this.lanes[lane].length - THRONE_R;
  }

  /** Владелец площадки вышки: сторона, чья территория её покрывает. */
  slotOwner(lane: number, slot: number): Side {
    return slot <= this.front[lane][0] ? 0 : 1;
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
    if (h.trip) return { x: h.trip.x, y: h.trip.y };
    return this.lanes[h.lane].pos(h.s, h.off);
  }

  /** Место героя на его позиции линии (куда он вернётся из похода). */
  laneSpot(h: Hero) {
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
    if (h.side === 0) this.sfx.push('levelUp');
    return true;
  }

  upgradeCreeps(lane: number, side: Side): boolean {
    const cost = this.creepUpCost(lane, side);
    if (this.creepLvl[lane][side] >= BAL.creepMaxLvl || this.gold[side] < cost) return false;
    this.gold[side] -= cost;
    this.creepLvl[lane][side]++;
    if (side === 0) this.sfx.push('creepUp');
    return true;
  }

  canCast(h: Hero) {
    return !h.dead && h.cd <= 0 && h.mana >= h.def.skill.mana;
  }

  /** Применить способность. strict=true — только если эффект стоящий (для автокаста). */
  cast(h: Hero, strict = false): boolean {
    if (!this.canCast(h)) return false;
    if (h.trip) return h.trip.phase === 'fight' ? this.castTrip(h) : false;
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
        for (const a of this.heroesOn(h.lane, h.side)) if (!a.dead && !a.trip) this.healHero(a, heal);
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
        const allies = this.heroesOn(h.lane, h.side).filter((a) => !a.dead && !a.trip);
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
      if (h.side === 0) this.sfx.push('cast:' + sk.kind);
    }
    return ok;
  }

  // ---------- походы: Лорд, Черепаха, лес ----------

  neutralName(n: Neutral) {
    return BAL.neutral[n.kind].name;
  }

  /** Герои стороны, которые сейчас в походе к нейтралу nid (идут, бьются или возвращаются). */
  party(nid: number, side: Side, phase?: 'go' | 'fight' | 'back'): Hero[] {
    return this.heroes.filter((h) => h.side === side && !h.dead && h.trip?.nid === nid && (!phase || h.trip.phase === phase));
  }

  /** Отправить героев с линий к нейтралу. Возвращает, сколько ушло. */
  sendParty(side: Side, nid: number, list: Hero[]): number {
    const n = this.neutrals[nid];
    if (!n || !n.alive) return 0;
    let idx = this.party(nid, side).length;
    let sent = 0;
    for (const h of list) {
      if (h.side !== side || h.dead || h.trip) continue;
      const p = this.heroPos(h);
      h.trip = { nid, phase: 'go', x: p.x, y: p.y, idx: idx++ };
      sent++;
    }
    if (sent && n.kind !== 'camp') {
      const name = this.neutralName(n);
      this.events.push({ text: side === 0 ? `Твои герои идут на: ${name}` : `Враг идёт на: ${name}`, side: side === 0 ? null : 1 });
      if (side === 1) this.sfx.push('alert');
    }
    return sent;
  }

  /** Вернуть героев стороны на линии (всех или от одного нейтрала). */
  recall(side: Side, nid?: number) {
    for (const h of this.heroes) {
      if (h.side === side && h.trip && (nid === undefined || h.trip.nid === nid)) h.trip.phase = 'back';
    }
  }

  private tripSpot(n: Neutral, h: Hero) {
    const base = THRONE_POS[h.side];
    const a0 = Math.atan2(base.y - n.y, base.x - n.x);
    const i = h.trip!.idx;
    const a = a0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.55;
    const r = BAL.neutral[n.kind].r + 95;
    return { x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r };
  }

  private moveTrip(h: Hero, to: { x: number; y: number }, dt: number): boolean {
    const t = h.trip!;
    const dx = to.x - t.x;
    const dy = to.y - t.y;
    const d = Math.hypot(dx, dy);
    const step = BAL.tripSpeed * dt;
    if (d <= step) {
      t.x = to.x;
      t.y = to.y;
      return true;
    }
    t.x += (dx / d) * step;
    t.y += (dy / d) * step;
    return false;
  }

  /** Цель героя у логова: сначала вражеские герои рядом, потом сам нейтрал. */
  private tripTarget(h: Hero): { hero?: Hero; n?: Neutral } | null {
    const nid = h.trip!.nid;
    const foes = this.party(nid, (1 - h.side) as Side, 'fight');
    if (foes.length) return { hero: foes.reduce((a, b) => (a.hp < b.hp ? a : b)) };
    const n = this.neutrals[nid];
    return n.alive ? { n } : null;
  }

  private updateTrip(h: Hero, dt: number) {
    const t = h.trip!;
    const n = this.neutrals[t.nid];
    if (t.phase === 'go') {
      if (!n.alive) { t.phase = 'back'; return; }
      if (this.moveTrip(h, this.tripSpot(n, h), dt)) {
        t.phase = 'fight';
        if (n.kind !== 'camp' && h.side === 0) this.sfx.push('roar');
      }
      return;
    }
    if (t.phase === 'back') {
      if (this.moveTrip(h, this.laneSpot(h), dt)) h.trip = null;
      return;
    }
    // бой
    const tg = this.tripTarget(h);
    if (!tg) { t.phase = 'back'; return; }
    if (this.autoCast[h.side] && this.canCast(h)) this.castTrip(h);
    h.atkCd -= dt;
    if (h.atkCd > 0) return;
    h.atkCd = h.def.rate;
    const to = tg.hero ? this.heroPos(tg.hero) : { x: n.x, y: n.y };
    if (h.def.range >= 150) this.fx.push({ kind: 'beam', x: t.x, y: t.y, x2: to.x, y2: to.y, color: h.def.color, t: 0, life: 0.15 });
    if (tg.hero) this.hitHero(tg.hero, h.dmg);
    else if (tg.n) this.hitNeutral(tg.n, h.dmg, h.side);
  }

  /** Способность в походе: бьёт текущую цель, лекари лечат свой отряд. */
  private castTrip(h: Hero): boolean {
    if (!this.canCast(h)) return false;
    const sk = h.def.skill;
    const pow = sk.power + sk.perLvl * (h.lvl - 1);
    const mates = this.party(h.trip!.nid, h.side, 'fight');
    if (sk.kind === 'heal') {
      if (!mates.some((m) => m.hp < m.maxHp * 0.8)) return false;
      for (const m of mates) this.healHero(m, pow);
    } else {
      const tg = this.tripTarget(h);
      if (!tg) return false;
      const to = tg.hero ? this.heroPos(tg.hero) : { x: tg.n!.x, y: tg.n!.y };
      const p = this.heroPos(h);
      this.fx.push({ kind: sk.kind === 'chain' ? 'bolt' : 'beam', x: p.x, y: p.y, x2: to.x, y2: to.y, color: h.def.color, t: 0, life: 0.35 });
      this.fx.push({ kind: 'ring', x: to.x, y: to.y, r: 70, color: h.def.color, t: 0, life: 0.45 });
      const dmg = sk.kind === 'wards' ? pow * 6 : sk.kind === 'chain' || sk.kind === 'volley' ? pow * 1.6 : pow;
      if (tg.hero) {
        this.hitHero(tg.hero, dmg * 0.7);
        if (sk.stun) tg.hero.atkCd = Math.max(tg.hero.atkCd, sk.stun);
      } else this.hitNeutral(tg.n!, dmg, h.side);
      if (sk.kind === 'drain') for (const m of mates) this.healHero(m, pow * 0.4);
    }
    h.mana -= sk.mana;
    h.cd = sk.cd;
    h.casts++;
    if (h.side === 0) this.sfx.push('cast:' + sk.kind);
    return true;
  }

  private updateNeutrals(dt: number) {
    const min = this.t / 60;
    for (const n of this.neutrals) {
      const cfg = BAL.neutral[n.kind];
      n.flash = Math.max(0, n.flash - dt);
      if (!n.alive) {
        n.respawnT -= dt;
        if (n.respawnT <= 0) {
          n.alive = true;
          n.maxHp = cfg.hp + cfg.hpPerMin * min;
          n.hp = n.maxHp;
          n.dmg = cfg.dmg * (1 + 0.06 * min);
          n.hits = 0;
          if (n.kind !== 'camp') {
            this.events.push({ text: `${cfg.name} появился в реке`, side: null });
            this.sfx.push('bossSpawn');
          }
        }
        continue;
      }
      const fighters = this.heroes.filter((h) => !h.dead && h.trip?.nid === n.id && h.trip.phase === 'fight');
      if (!fighters.length) {
        n.hp = Math.min(n.maxHp, n.hp + n.maxHp * BAL.neutralRegen * dt);
        continue;
      }
      n.atkCd -= dt;
      if (n.atkCd > 0) continue;
      n.atkCd = cfg.rate;
      n.hits++;
      if (n.kind !== 'camp' && n.hits % 4 === 0) {
        for (const f of fighters) this.hitHero(f, n.dmg * 0.7);
        this.fx.push({ kind: 'ring', x: n.x, y: n.y, r: cfg.r + 120, color: n.kind === 'lord' ? '#b48cff' : '#7fd68a', t: 0, life: 0.6 });
      } else {
        const tg = fighters.reduce((a, b) => (a.hp < b.hp ? a : b));
        this.hitHero(tg, n.dmg);
      }
    }
  }

  private hitNeutral(n: Neutral, dmg: number, side: Side) {
    if (!n.alive) return;
    n.hp -= dmg;
    n.flash = 0.1;
    if (n.hp > 0) return;
    n.alive = false;
    n.hp = 0;
    const cfg = BAL.neutral[n.kind];
    n.respawnT = cfg.respawn;
    if (n.kind === 'camp') {
      this.addGold(side, BAL.neutral.camp.gold);
      this.stats.camps[side]++;
      if (side === 0) {
        this.fx.push({ kind: 'text', x: n.x, y: n.y, text: '+' + BAL.neutral.camp.gold, color: '#f3d27a', t: 0, life: 1.2 });
        this.sfx.push('coins');
      }
    } else if (n.kind === 'turtle') {
      this.addGold(side, BAL.neutral.turtle.gold);
      this.stats.turtles[side]++;
      this.events.push({ text: side === 0 ? `Черепаха повержена: +${BAL.neutral.turtle.gold} золота` : 'Враг забрал Черепаху', side });
      this.sfx.push(side === 0 ? 'bossDown' : 'bad');
    } else {
      this.stats.lords[side]++;
      const lane = this.bestLane(side);
      this.spawnLordCreep(side, lane);
      this.events.push({
        text: side === 0 ? `Лорд на твоей стороне! Идёт по линии: ${LANE_NAMES[lane]}` : `Враг подчинил Лорда: ${LANE_NAMES[lane]} линия`,
        side,
      });
      this.sfx.push(side === 0 ? 'bossDown' : 'bad');
    }
  }

  /** Линия, где сторона продвинулась дальше всего. При равенстве — центр. */
  private bestLane(side: Side): number {
    let best = 1;
    let bv = -Infinity;
    for (const l of [1, 0, 2]) {
      const v = side === 0 ? this.front[l][0] : -this.front[l][1];
      if (v > bv) { bv = v; best = l; }
    }
    return best;
  }

  private spawnLordCreep(side: Side, lane: number) {
    const st = BAL.creep.lord;
    const dir = side === 0 ? 1 : -1;
    const mul = 1 + 0.08 * (this.t / 60);
    this.creeps.push({
      uid: this.uid++, kind: 'lord', side, lane, s: this.slotS(lane, side) + dir * 70, off: 0,
      hp: st.hp * mul, maxHp: st.hp * mul, dmg: st.dmg * mul, range: st.range, rate: st.rate, speed: st.speed,
      atkCd: 0, slowT: 0, slowMul: 1, stunT: 0, gold: st.gold, r: st.r, dead: false,
    });
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
    this.updateNeutrals(dt);
    this.updateWards(dt);
    this.updateCreeps(dt);
    this.updateProjs(dt);
    this.cleanup();

    if (this.sfx.length > 100) this.sfx.splice(0, this.sfx.length - 100);
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
      for (const side of [0, 1] as Side[]) {
        const lvl = this.creepLvl[lane][side];
        const kinds: CreepKind[] = [];
        const melee = 3 + Math.floor(lvl / 4);
        for (let i = 0; i < melee; i++) kinds.push('melee');
        kinds.push('ranged');
        if (lvl >= 6) kinds.push('ranged');
        if (this.waveNo % BAL.siegeEvery === 0) kinds.push('siege');
        const dir = side === 0 ? 1 : -1;
        const base = this.throneS(lane, side);
        kinds.forEach((kind, i) => {
          const st = BAL.creep[kind];
          const late = Math.max(0, this.t - BAL.lateGameFrom) / 60;
          const mul = (1 + BAL.creepLvlMul * lvl) * (1 + BAL.lateGamePerMin * late);
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

      if (h.trip) { this.updateTrip(h, dt); continue; }
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
      const reach = c.range + c.r;

      // 1. вражеский крип в зоне атаки
      const ec = this.nearestEnemyCreep(c.lane, c.side, c.s, reach + 10);
      let target: Target | null = ec ? { kind: 'creep', c: ec } : null;

      // 2. вражеский герой
      if (!target) {
        let bh: Hero | null = null;
        let bd = Infinity;
        for (const h of this.heroes) {
          if (h.dead || h.trip || h.lane !== c.lane || h.side === c.side) continue;
          const d = (h.s - c.s) * dir;
          if (d >= -20 && d <= reach + 22 && d < bd) { bd = d; bh = h; }
        }
        if (bh) target = { kind: 'hero', h: bh };
      }

      // 3. вражеский трон
      if (!target) {
        const throneS = this.throneS(c.lane, (1 - c.side) as Side);
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

      // 4. позиция брошена: все живые герои врага ушли в поход — крипы занимают её
      const foe = (1 - c.side) as Side;
      if (!this.atThrone(c.lane, foe) && (this.slotS(c.lane, foe) - c.s) * dir <= 0) {
        const hs = this.heroesOn(c.lane, foe);
        if (hs.some((x) => !x.dead && x.trip) && !hs.some((x) => !x.dead && !x.trip)) this.pushLane(c.lane, foe, true);
      }

      // 5. двигаемся вперёд
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
      this.sfx.push('throne:' + t.side);
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
        this.sfx.push(c.kind === 'lord' ? 'bossDown' : 'kill');
        const p = this.creepPos(c);
        this.fx.push({ kind: 'text', x: p.x, y: p.y, text: '+' + c.gold, color: '#f3d27a', t: 0, life: 0.9 });
      }
    }
  }

  private slowCreep(c: Creep, mul: number, t: number) {
    c.slowMul = Math.min(c.slowMul, mul);
    c.slowT = Math.max(c.slowT, t);
  }

  /** Насколько глубоко в своей половине стоят герои линии: 0 — передняя позиция … 3 — у трона. */
  depth(lane: number, side: Side): number {
    const f = this.front[lane][side];
    return side === 0 ? 2 - f : f - 3;
  }

  private hitHero(h: Hero, dmg: number) {
    if (h.dead) return;
    if (!h.trip) dmg *= 1 - BAL.depthArmor[Math.max(0, Math.min(3, this.depth(h.lane, h.side)))];
    h.hp -= dmg;
    h.flash = 0.12;
    if (h.hp <= 0) {
      h.hp = 0;
      h.dead = true;
      h.trip = null;
      h.respawn = BAL.heroRespawn;
      this.sfx.push('heroDie:' + h.side);
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
    const hs = this.heroesOn(lane, loser);
    if (hs.some((x) => !x.dead && !x.trip)) return;
    if (this.atThrone(lane, loser)) return; // отступать некуда, герои просто ждут возрождения
    // часть героев линии жива, но в походе — позицию заберут крипы, если дойдут (см. updateCreeps)
    if (hs.some((x) => !x.dead)) return;
    this.pushLane(lane, loser, false);
  }

  /** Сторона loser откатывается на позицию назад, победитель встаёт на её место. */
  private pushLane(lane: number, loser: Side, abandoned: boolean) {
    const winner = (1 - loser) as Side;
    const old = this.front[lane][loser];
    this.front[lane][loser] = loser === 0 ? old - 1 : old + 1;
    this.front[lane][winner] = old;
    this.placeHeroes(lane);
    for (const x of this.heroesOn(lane, loser)) if (x.dead) x.respawn = Math.min(x.respawn, BAL.pushRespawn);
    this.stats.pushes[winner]++;
    const exposed = this.atThrone(lane, loser);
    const name = LANE_NAMES[lane];
    const text = winner === 0
      ? exposed ? `${name}: путь к трону врага открыт!` : abandoned ? `${name}: враг бросил позицию — она твоя` : `${name} линия продавлена`
      : exposed ? `${name}: враг у твоего трона!` : abandoned ? `${name}: позиция брошена и потеряна` : `${name} линия потеряна`;
    this.events.push({ text, side: winner });
    this.sfx.push('push:' + winner);
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
