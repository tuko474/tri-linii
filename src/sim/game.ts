// Симуляция боя. Не знает ничего про экран — только состояние и правила.
// Это пригодится для онлайна: тот же код сможет крутиться на сервере.
import { BAL, CreepKind, Difficulty, WORLD } from '../data/config';
import { heroById } from '../data/heroes';
import { RACES, RACE_IDS, RaceFx, RaceId, tierIndex } from '../data/races';
import { CAMPS, GUARD_POS, GUARD_R, LaneGeo, LANE_NAMES, PITS, THRONE_POS, THRONE_R, buildLanes } from './map';
import type { Creep, Fx, GameEvent, Hero, Neutral, NeutralKind, Pick, Proj, Sfx, Side, Target, Ward } from './types';

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
  /** Звуковые события: 'cast:blast', 'kill', 'levelUp' и т.д., с адресатом. */
  sfx: Sfx[] = [];
  /** 0 — Лорд, 1 — Черепаха, дальше лесные лагеря. */
  neutrals: Neutral[] = [];
  /** Сферы рас, полученные с Лорда: orbs[side][race]. */
  orbs: [Partial<Record<RaceId, number>>, Partial<Record<RaceId, number>>] = [{}, {}];
  /** Источники обзора для тумана войны: [x, y, радиус], пересчитываются несколько раз в секунду. */
  vision: [[number, number, number][], [number, number, number][]] = [[], []];
  /** Сетка видимости (клетка 50 единиц) — быстрые проверки «видно ли точку». */
  private visGrid: [Uint8Array, Uint8Array] = [new Uint8Array(0), new Uint8Array(0)];
  private static CELL = 50;
  private visionT = 0;

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
  stats = { kills: [0, 0], pushes: [0, 0], goldEarned: [0, 0], lords: [0, 0], turtles: [0, 0], camps: [0, 0], guards: [0, 0] };
  /** pitSeen[side][i] — видит ли сторона логово i (Лорд, Черепаха). */
  pitSeen: [boolean[], boolean[]] = [[false, false], [false, false]];

  private uid = 1;
  private throneAtkFx = [0, 0];
  private throneCd = [0, 0];

  constructor(picks: [Pick[], Pick[]], difficulty: Difficulty) {
    this.incomeMul = [1, BAL.difficulty[difficulty].botIncome];
    ([0, 1] as Side[]).forEach((side) => {
      for (const p of picks[side]) {
        const def = heroById(p.heroId);
        this.heroes.push({
          uid: this.uid++, def, side, lane: p.lane, lvl: 1, xp: 0,
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
        alive: false, respawnT: cfg.first, atkCd: 0, hits: 0, flash: 0, owner: null,
      });
      return this.neutrals[this.neutrals.length - 1];
    };
    mk('lord', PITS[0].x, PITS[0].y);
    mk('turtle', PITS[1].x, PITS[1].y);
    for (const c of CAMPS) mk('camp', c.x, c.y);
    // стражи логов — в конце списка, чтобы id Лорда (0) и Черепахи (1) не сдвигались
    GUARD_POS.forEach((gp, i) => {
      const gd = mk('guard', gp.x, gp.y);
      gd.pit = i;
      this.neutrals[i].guard = gd.id;
    });
    this.refreshStats(0);
    this.refreshStats(1);
    this.updateVision();
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

  // ---------- расы ----------

  /** Сколько «голов» каждой расы у стороны, с учётом сфер Лорда. */
  raceCounts(side: Side): Record<RaceId, number> {
    const c = {} as Record<RaceId, number>;
    for (const r of RACE_IDS) c[r] = this.orbs[side][r] ?? 0;
    for (const h of this.heroes) if (h.side === side) c[h.def.race]++;
    return c;
  }

  /** Активные бонусы стороны: раса → индекс уровня. */
  activeRaces(side: Side): { race: RaceId; count: number; tier: number }[] {
    const c = this.raceCounts(side);
    return RACE_IDS.map((race) => ({ race, count: c[race], tier: tierIndex(race, c[race]) })).filter((x) => x.count > 0);
  }

  private raceFx(side: Side): Partial<Record<RaceId, RaceFx>> {
    const out: Partial<Record<RaceId, RaceFx>> = {};
    for (const a of this.activeRaces(side)) if (a.tier >= 0) out[a.race] = RACES[a.race].tiers[a.tier].fx;
    return out;
  }

  /** Итоговые модификаторы героя: своей расы + общекомандные. */
  heroMods(h: Hero) {
    const all = this.raceFx(h.side);
    const own = all[h.def.race] ?? {};
    let allLs = 0, allSpell = 1, allAtk = 1, allArmor = 0;
    for (const fx of Object.values(all)) {
      allLs += fx?.allLifesteal ?? 0;
      allSpell *= fx?.allSpellMul ?? 1;
      allAtk *= fx?.allAtkMul ?? 1;
      allArmor += fx?.allArmor ?? 0;
    }
    return {
      hpMul: own.hpMul ?? 1,
      atkMul: (own.atkMul ?? 1) * allAtk,
      rateMul: own.rateMul ?? 1,
      cdMul: own.cdMul ?? 1,
      spellMul: (own.spellMul ?? 1) * allSpell,
      lifesteal: (own.lifesteal ?? 0) + allLs,
      respawnMul: own.respawnMul ?? 1,
      armor: Math.min(0.6, (own.armor ?? 0) + allArmor),
    };
  }

  sideMods(side: Side) {
    let goldMul = 1, creepMul = 1;
    for (const fx of Object.values(this.raceFx(side))) {
      goldMul *= fx?.goldMul ?? 1;
      creepMul *= fx?.creepMul ?? 1;
    }
    return { goldMul, creepMul };
  }

  /** Пересчитать HP и урон героев стороны после прокачки или новой сферы. */
  refreshStats(side: Side) {
    for (const h of this.heroes) {
      if (h.side !== side) continue;
      const m = this.heroMods(h);
      const k = h.lvl - 1;
      const ratio = h.maxHp > 0 ? h.hp / h.maxHp : 1;
      h.maxHp = h.def.hp * (1 + BAL.heroHpPerLvl * k) * m.hpMul;
      h.hp = h.dead ? 0 : Math.max(1, ratio * h.maxHp);
      h.dmg = h.def.dmg * (1 + BAL.heroDmgPerLvl * k) * m.atkMul;
      h.maxMana = h.def.mana * (1 + BAL.heroManaPerLvl * k);
    }
  }

  /** Герой нанёс урон — вампиризм от рас. */
  private dealt(h: Hero | undefined, dmg: number) {
    if (!h || h.dead) return;
    const ls = this.heroMods(h).lifesteal;
    if (ls > 0) h.hp = Math.min(h.maxHp, h.hp + dmg * ls);
  }

  // ---------- туман войны ----------

  private updateVision() {
    const V = BAL.vision;
    for (const side of [0, 1] as Side[]) {
      const v: [number, number, number][] = [];
      const t = THRONE_POS[side];
      v.push([t.x, t.y, V.throne]);
      for (const h of this.heroes) if (h.side === side && !h.dead) { const p = this.heroPos(h); v.push([p.x, p.y, V.hero]); }
      for (const c of this.creeps) if (c.side === side && !c.dead) { const p = this.creepPos(c); v.push([p.x, p.y, V.creep]); }
      for (const w of this.wards) if (w.side === side) { const p = this.lanes[w.lane].pos(w.s, w.off); v.push([p.x, p.y, V.ward]); }
      for (let l = 0; l < 3; l++) {
        const lane = this.lanes[l];
        BAL.slotT.forEach((tt, i) => {
          if (this.slotOwner(l, i) !== side) return;
          const p = lane.at(tt * lane.length);
          v.push([p.x, p.y, V.slot]);
        });
      }
      // логова: видно только со своим стражем или отрядом внутри
      for (let i = 0; i < PITS.length; i++) {
        const pit = this.neutrals[i];
        const guard = this.neutrals[pit.guard!];
        if (guard.owner === side) v.push([guard.x, guard.y, V.guard]);
        const inside = this.heroes.some((h) => h.side === side && !h.dead && h.trip?.nid === i && h.trip.phase !== 'back'
          && Math.hypot(h.trip.x - pit.x, h.trip.y - pit.y) < BAL.pitZone + 160);
        this.pitSeen[side][i] = guard.owner === side || inside;
        if (this.pitSeen[side][i]) v.push([pit.x, pit.y, BAL.pitZone + 40]);
      }
      this.vision[side] = v;
      this.visGrid[side] = this.buildGrid(v);
    }
  }

  private buildGrid(v: [number, number, number][]) {
    const C = Game.CELL;
    const gw = Math.ceil(WORLD.W / C);
    const gh = Math.ceil(WORLD.H / C);
    const grid = new Uint8Array(gw * gh);
    for (const [vx, vy, r] of v) {
      const r2 = r * r;
      const cx0 = Math.max(0, Math.floor((vx - r) / C)), cx1 = Math.min(gw - 1, Math.floor((vx + r) / C));
      const cy0 = Math.max(0, Math.floor((vy - r) / C)), cy1 = Math.min(gh - 1, Math.floor((vy + r) / C));
      for (let cy = cy0; cy <= cy1; cy++) {
        const dy = (cy + 0.5) * C - vy;
        for (let cx = cx0; cx <= cx1; cx++) {
          const dx = (cx + 0.5) * C - vx;
          if (dx * dx + dy * dy <= r2) grid[cy * gw + cx] = 1;
        }
      }
    }
    return grid;
  }

  /** Видит ли сторона точку (не в тумане). Внутрь логова видно только по pitSeen. */
  visible(side: Side, x: number, y: number, pad = 0): boolean {
    for (let i = 0; i < PITS.length; i++) {
      const dx = PITS[i].x - x;
      const dy = PITS[i].y - y;
      if (dx * dx + dy * dy < BAL.pitZone * BAL.pitZone) return this.pitSeen[side][i];
    }
    const grid = this.visGrid[side];
    if (!grid.length) return false;
    const C = Game.CELL;
    const gw = Math.ceil(WORLD.W / C);
    const gh = Math.ceil(WORLD.H / C);
    const at = (px: number, py: number) => {
      const cx = Math.floor(px / C), cy = Math.floor(py / C);
      return cx >= 0 && cy >= 0 && cx < gw && cy < gh && grid[cy * gw + cx] === 1;
    };
    if (at(x, y)) return true;
    if (pad > 0) return at(x - pad, y) || at(x + pad, y) || at(x, y - pad) || at(x, y + pad);
    return false;
  }

  /** Сколько секунд ещё действует сфера (до возрождения Лорда). 0 — сферы нет. */
  orbTimeLeft(side: Side): number {
    const has = Object.values(this.orbs[side]).some((v) => (v ?? 0) > 0);
    const lord = this.neutrals[0];
    return has && !lord.alive ? lord.respawnT : 0;
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

  /** Сколько опыта нужно до следующего уровня. */
  xpNeed(h: Hero) {
    return BAL.xpToNext(h.lvl);
  }

  creepUpCost(lane: number, side: Side) {
    return BAL.creepUpCost(this.creepLvl[lane][side]);
  }

  /** Начислить опыт; при наборе — новый уровень. */
  gainXp(h: Hero, amount: number) {
    if (h.dead || h.lvl >= BAL.heroMaxLvl || amount <= 0) return;
    h.xp += amount;
    while (h.lvl < BAL.heroMaxLvl && h.xp >= this.xpNeed(h)) {
      h.xp -= this.xpNeed(h);
      this.levelUp(h);
    }
    if (h.lvl >= BAL.heroMaxLvl) h.xp = 0;
  }

  /** Поделить опыт между героями. */
  private shareXp(list: Hero[], amount: number) {
    const alive = list.filter((h) => !h.dead);
    if (!alive.length) return;
    for (const h of alive) this.gainXp(h, amount / alive.length);
  }

  /** Герои стороны, стоящие на линии (не в походе) — получают опыт с этой линии. */
  private laneHeroes(lane: number, side: Side) {
    return this.heroes.filter((h) => h.lane === lane && h.side === side && !h.dead && !h.trip);
  }

  private levelUp(h: Hero) {
    const before = h.maxHp;
    h.lvl++;
    this.refreshStats(h.side);
    if (!h.dead) h.hp = Math.min(h.maxHp, h.hp + Math.max(0, h.maxHp - before));
    if (!h.dead) this.fxRingAtHero(h, '#f3d27a', 40);
    this.say(h.side, 'levelUp');
  }

  /** Сколько уровней крипов можно иметь сейчас (растёт со временем матча). */
  creepCap(): number {
    return Math.min(BAL.creepMaxLvl, 1 + Math.floor(this.t / BAL.creepLvlEvery));
  }

  upgradeCreeps(lane: number, side: Side): boolean {
    const cost = this.creepUpCost(lane, side);
    if (this.creepLvl[lane][side] >= this.creepCap() || this.gold[side] < cost) return false;
    this.gold[side] -= cost;
    this.creepLvl[lane][side]++;
    this.say(side, 'creepUp');
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
    const mods = this.heroMods(h);
    const pow = (sk.power + sk.perLvl * (h.lvl - 1)) * mods.spellMul;
    const range = sk.range ?? h.def.range;
    let dealtSum = 0;
    const hit = (c: Creep, d: number) => { dealtSum += Math.min(d, Math.max(0, c.hp)); this.hitCreep(c, d); };
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
          hit(e, pow);
          if (sk.slow) this.slowCreep(e, sk.slow, sk.slowT ?? 2);
          if (sk.stun) e.stunT = Math.max(e.stunT, sk.stun);
        }
        const p = lane.at(center);
        this.fx.push({ kind: 'ring', x: p.x, y: p.y, r: R, color: h.def.color, t: 0, life: 0.6 });
        ok = true;
        break;
      }
      case 'around': {
        const R = sk.radius ?? 140;
        const near = enemies.filter((e) => Math.abs(e.s - h.s) <= R);
        if (near.length < need) break;
        for (const e of near) {
          hit(e, pow);
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
          hit(cur, pow * Math.pow(0.9, i));
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
          hit(c, pow);
          if (sk.slow) this.slowCreep(c, sk.slow, sk.slowT ?? 2);
        }
        ok = true;
        break;
      }
      case 'drain': {
        if (inRange.length < need) break;
        for (const c of inRange) hit(c, pow);
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
        hit(tgt, pow);
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
        for (const e of near) hit(e, pow * 0.35);
        this.fxRingAtHero(h, h.def.color, R);
        ok = true;
        break;
      }
    }

    if (ok) {
      this.dealt(h, dealtSum);
      h.mana -= sk.mana;
      h.cd = sk.cd * mods.cdMul;
      h.casts++;
      this.say(h.side, 'cast:' + sk.kind);
    }
    return ok;
  }

  // ---------- походы: Лорд, Черепаха, лес ----------

  neutralName(n: Neutral) {
    if (n.kind === 'guard') return 'Страж ' + (n.pit === 0 ? 'Лорда' : 'Черепахи');
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
    if (n.kind === 'guard' && n.owner === side) return 0; // свой страж — бить нечего
    let idx = this.party(nid, side).length;
    let sent = 0;
    for (const h of list) {
      if (h.side !== side || h.dead || h.trip) continue;
      const p = this.heroPos(h);
      h.trip = { nid, phase: 'go', x: p.x, y: p.y, idx: idx++ };
      sent++;
    }
    if (sent && n.kind !== 'camp') this.tell(side, `Твои герои идут на: ${this.neutralName(n)}`, 'info');
    return sent;
  }

  /** Срочно вернуть одного героя на линию. */
  recallHero(h: Hero) {
    if (h.trip) h.trip.phase = 'back';
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
    if (n.kind === 'guard' && n.owner === h.side) return null; // захвачен — возвращаемся
    return n.alive ? { n } : null;
  }

  private updateTrip(h: Hero, dt: number) {
    const t = h.trip!;
    const n = this.neutrals[t.nid];
    if (t.phase === 'go') {
      if (!n.alive) { t.phase = 'back'; return; }
      if (this.moveTrip(h, this.tripSpot(n, h), dt)) {
        t.phase = 'fight';
        if (n.kind === 'lord' || n.kind === 'turtle') this.say(h.side, 'roar');
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
    h.atkCd = h.def.rate * this.heroMods(h).rateMul;
    const to = tg.hero ? this.heroPos(tg.hero) : { x: n.x, y: n.y };
    this.dealt(h, h.dmg);
    if (h.def.range >= 150) this.fx.push({ kind: 'beam', x: t.x, y: t.y, x2: to.x, y2: to.y, color: h.def.color, t: 0, life: 0.15 });
    if (tg.hero) this.hitHero(tg.hero, h.dmg);
    else if (tg.n) this.hitNeutral(tg.n, h.dmg, h.side);
  }

  /** Способность в походе: бьёт текущую цель, лекари лечат свой отряд. */
  private castTrip(h: Hero): boolean {
    if (!this.canCast(h)) return false;
    const sk = h.def.skill;
    const mods = this.heroMods(h);
    const pow = (sk.power + sk.perLvl * (h.lvl - 1)) * mods.spellMul;
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
      this.dealt(h, dmg * 0.7);
      if (sk.kind === 'drain') for (const m of mates) this.healHero(m, pow * 0.4);
    }
    h.mana -= sk.mana;
    h.cd = sk.cd * mods.cdMul;
    h.casts++;
    this.say(h.side, 'cast:' + sk.kind);
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
          if (n.kind === 'lord' || n.kind === 'turtle') {
            this.tell(null, `${cfg.name} появился в реке`, 'info');
            this.say(null, 'bossSpawn');
          }
          if (n.kind === 'lord') this.expireOrbs();
        }
        continue;
      }
      // страж бьёт только тех, кто пришёл его отбить, а не хозяев
      const fighters = this.heroes.filter((h) => !h.dead && h.trip?.nid === n.id && h.trip.phase === 'fight' && h.side !== n.owner);
      if (!fighters.length) {
        n.hp = Math.min(n.maxHp, n.hp + n.maxHp * BAL.neutralRegen * dt);
        continue;
      }
      n.atkCd -= dt;
      if (n.atkCd > 0) continue;
      n.atkCd = cfg.rate;
      n.hits++;
      if ((n.kind === 'lord' || n.kind === 'turtle') && n.hits % 4 === 0) {
        for (const f of fighters) this.hitHero(f, n.dmg * 0.7);
        this.fx.push({ kind: 'ring', x: n.x, y: n.y, r: cfg.r + 120, color: n.kind === 'lord' ? '#b48cff' : '#7fd68a', t: 0, life: 0.6 });
      } else {
        const tg = fighters.reduce((a, b) => (a.hp < b.hp ? a : b));
        this.hitHero(tg, n.dmg);
      }
    }
  }

  private hitNeutral(n: Neutral, dmg: number, side: Side) {
    if (!n.alive || n.owner === side) return;
    n.hp -= dmg;
    n.flash = 0.1;
    if (n.hp > 0) return;
    if (n.kind === 'guard') {
      // страж не умирает, а переходит к победителю
      const lost = n.owner;
      n.owner = side;
      n.hp = n.maxHp = BAL.neutral.guard.hp + BAL.neutral.guard.hpPerMin * (this.t / 60);
      this.stats.guards[side]++;
      this.shareXp(this.party(n.id, side, 'fight'), BAL.xp.guard);
      const pit = n.pit === 0 ? 'Лорда' : 'Черепахи';
      this.tell(side, `Страж ${pit} твой — логово под обзором`, 'good');
      this.say(side, 'coins');
      if (lost !== null) {
        this.tell(lost, `Враг перехватил стража ${pit}`, 'bad');
        this.say(lost, 'bad');
      }
      this.updateVision();
      return;
    }
    n.alive = false;
    n.hp = 0;
    const cfg = BAL.neutral[n.kind];
    n.respawnT = cfg.respawn;
    this.shareXp(this.party(n.id, side, 'fight'), n.kind === 'camp' ? BAL.xp.camp : n.kind === 'turtle' ? BAL.xp.turtle : BAL.xp.lord);
    if (n.kind === 'camp') {
      this.addGold(side, BAL.neutral.camp.gold);
      this.stats.camps[side]++;
      this.fx.push({ kind: 'text', x: n.x, y: n.y, text: '+' + BAL.neutral.camp.gold, color: '#f3d27a', t: 0, life: 1.2, to: side });
      this.say(side, 'coins');
    } else if (n.kind === 'turtle') {
      this.addGold(side, BAL.neutral.turtle.gold);
      this.stats.turtles[side]++;
      const other = (1 - side) as Side;
      this.tell(side, `Черепаха повержена: +${BAL.neutral.turtle.gold} золота`, 'good');
      this.tell(other, 'Враг забрал Черепаху', 'bad');
      this.say(side, 'bossDown');
      this.say(other, 'bad');
    } else {
      this.stats.lords[side]++;
      const lane = this.bestLane(side);
      this.spawnLordCreep(side, lane);
      const race = this.rollOrb(side);
      const rn = RACES[race].name;
      const other = (1 - side) as Side;
      this.tell(side, `Лорд на твоей стороне (${LANE_NAMES[lane]} линия). Сфера: ${rn} +1, пока Лорд мёртв`, 'good');
      this.tell(other, `Враг подчинил Лорда (${LANE_NAMES[lane]} линия) и получил сферу: ${rn}`, 'bad');
      this.say(side, 'bossDown');
      this.say(other, 'bad');
    }
  }

  /** Сфера случайной расы из всех: +1 к счётчику расы, пока Лорд не возродится. Может выпасть и ненужная. */
  private rollOrb(side: Side): RaceId {
    const race = RACE_IDS[Math.floor(Math.random() * RACE_IDS.length)];
    this.orbs[side][race] = (this.orbs[side][race] ?? 0) + 1;
    this.refreshStats(side);
    return race;
  }

  /** Лорд возродился — сферы рассеиваются. */
  private expireOrbs() {
    for (const side of [0, 1] as Side[]) {
      if (!Object.values(this.orbs[side]).some((v) => (v ?? 0) > 0)) continue;
      this.orbs[side] = {};
      this.refreshStats(side);
      this.tell(side, 'Сфера рассеялась: Лорд возродился', 'info');
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

    this.visionT -= dt;
    if (this.visionT <= 0) { this.visionT = 0.2; this.updateVision(); }
    this.updateHeroes(dt);
    this.updateNeutrals(dt);
    this.updateWards(dt);
    this.updateThroneGuns(dt);
    this.updateCreeps(dt);
    this.updateProjs(dt);
    this.cleanup();

    if (this.sfx.length > 100) this.sfx.splice(0, this.sfx.length - 100);
    if (this.events.length > 30) this.events.splice(0, this.events.length - 30);
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
          const mul = (1 + BAL.creepLvlMul * lvl) * (1 + BAL.lateGamePerMin * late) * this.sideMods(side).creepMul;
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
      this.gainXp(h, BAL.xp.passive * dt);

      if (h.trip) { this.updateTrip(h, dt); continue; }
      if (this.autoCast[h.side] && this.canCast(h)) this.cast(h, true);

      h.atkCd -= dt;
      if (h.atkCd > 0) continue;
      const tgt = this.nearestEnemyCreep(h.lane, h.side, h.s, h.def.range);
      if (!tgt) continue;
      h.atkCd = h.def.rate * this.heroMods(h).rateMul;
      if (h.def.range < 150) {
        this.dealt(h, Math.min(h.dmg, tgt.hp));
        this.hitCreep(tgt, h.dmg);
      } else {
        const p = this.heroPos(h);
        this.projs.push({ x: p.x, y: p.y, src: h, target: { kind: 'creep', c: tgt }, dmg: h.dmg, speed: 700, color: h.def.color, size: 4 });
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

  /** Трон отстреливает вражеских крипов в радиусе. */
  private updateThroneGuns(dt: number) {
    const cfg = BAL.throneGun;
    for (const side of [0, 1] as Side[]) {
      this.throneCd[side] -= dt;
      if (this.throneCd[side] > 0) continue;
      const t = THRONE_POS[side];
      let best: Creep | null = null;
      let bd = cfg.range;
      for (const c of this.creeps) {
        if (c.dead || c.side === side) continue;
        const p = this.creepPos(c);
        const d = Math.hypot(p.x - t.x, p.y - t.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) continue;
      this.throneCd[side] = cfg.rate;
      this.projs.push({ x: t.x, y: t.y - 40, target: { kind: 'creep', c: best }, dmg: cfg.dmg + cfg.dmgPerMin * (this.t / 60), speed: 900, color: side === 0 ? '#9ff5e8' : '#ffb0bb', size: 7 });
    }
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
        if (p.src && p.target.kind === 'creep') this.dealt(p.src, Math.min(p.dmg, Math.max(0, p.target.c.hp)));
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
      this.say(t.side, 'throne');
    }
  }

  private hitCreep(c: Creep, dmg: number) {
    if (c.dead) return;
    c.hp -= dmg;
    if (c.hp <= 0) {
      c.dead = true;
      const killer = (1 - c.side) as Side;
      this.shareXp(this.laneHeroes(c.lane, killer), BAL.xp.creep[c.kind]);
      const gold = Math.round(c.gold * this.sideMods(killer).goldMul);
      this.addGold(killer, gold);
      this.stats.kills[killer]++;
      this.say(killer, c.kind === 'lord' ? 'bossDown' : 'kill');
      const p = this.creepPos(c);
      this.fx.push({ kind: 'text', x: p.x, y: p.y, text: '+' + gold, color: '#f3d27a', t: 0, life: 0.9, to: killer });
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
    dmg *= 1 - this.heroMods(h).armor;
    h.hp -= dmg;
    h.flash = 0.12;
    if (h.hp <= 0) {
      h.hp = 0;
      const trip = h.trip;
      h.dead = true;
      h.trip = null;
      h.respawn = BAL.heroRespawn * this.heroMods(h).respawnMul;
      this.say(h.side, 'heroDie:mine');
      this.say((1 - h.side) as Side, 'heroDie:foe');
      const foe = (1 - h.side) as Side;
      this.shareXp(trip ? this.party(trip.nid, foe, 'fight') : this.laneHeroes(h.lane, foe), BAL.xp.heroKill);
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
    this.tell(winner, exposed ? `${name}: путь к трону врага открыт!` : abandoned ? `${name}: враг бросил позицию — она твоя` : `${name} линия продавлена`, 'good');
    this.tell(loser, exposed ? `${name}: враг у твоего трона!` : abandoned ? `${name}: позиция брошена и потеряна` : `${name} линия потеряна`, 'bad');
    this.say(winner, 'push:good');
    this.say(loser, 'push:bad');
  }

  private cleanup() {
    this.creeps = this.creeps.filter((c) => !c.dead);
  }

  private fxRingAtHero(h: Hero, color: string, r: number) {
    const p = this.heroPos(h);
    this.fx.push({ kind: 'ring', x: p.x, y: p.y, r, color, t: 0, life: 0.55 });
  }

  private say(to: Side | null, name: string) {
    this.sfx.push({ name, to });
  }

  private tell(to: Side | null, text: string, tone: GameEvent['tone']) {
    this.events.push({ text, to, tone });
  }

  // ---------- сеть: снимок состояния (хост → гость) ----------

  snapshot() {
    const r = (v: number) => Math.round(v * 10) / 10;
    const tgt = (t: Target) => (t.kind === 'creep' ? { k: 'c', u: t.c.uid } : t.kind === 'hero' ? { k: 'h', u: t.h.uid } : { k: 't', u: t.side });
    return {
      t: r(this.t), gold: this.gold.map(r), throne: this.throne.map(r), front: this.front, creepLvl: this.creepLvl,
      waveTimer: r(this.waveTimer), waveNo: this.waveNo, winner: this.winner, orbs: this.orbs, stats: this.stats,
      autoCast: this.autoCast, tac: this.throneAtkFx.map(r), tcd: this.throneCd.map(r),
      heroes: this.heroes.map((h) => [h.uid, h.lvl, r(h.xp), r(h.hp), r(h.maxHp), r(h.mana), r(h.maxMana), r(h.dmg), r(h.cd), r(h.atkCd),
        h.dead ? 1 : 0, r(h.respawn), h.off, r(h.s), h.trip ? [h.trip.nid, h.trip.phase, r(h.trip.x), r(h.trip.y), h.trip.idx] : 0]),
      creeps: this.creeps.map((c) => [c.uid, c.kind, c.side, c.lane, r(c.s), c.off, r(c.hp), r(c.maxHp), r(c.dmg), c.range, c.rate, c.speed,
        r(c.atkCd), r(c.slowT), c.slowMul, r(c.stunT), c.gold, c.r]),
      wards: this.wards.map((w) => [w.side, w.lane, r(w.s), w.off, r(w.ttl), r(w.dmg), w.range, r(w.atkCd)]),
      projs: this.projs.map((p) => [r(p.x), r(p.y), tgt(p.target), r(p.dmg), p.speed, p.color, p.size, p.src?.uid ?? 0]),
      neutrals: this.neutrals.map((n) => [r(n.hp), r(n.maxHp), r(n.dmg), n.alive ? 1 : 0, r(n.respawnT), r(n.atkCd), n.hits, n.owner]),
      fx: this.fx.map((f) => ({ ...f })),
    };
  }

  applySnapshot(S: ReturnType<Game['snapshot']>) {
    this.t = S.t; this.gold = S.gold as [number, number]; this.throne = S.throne as [number, number];
    this.front = S.front; this.creepLvl = S.creepLvl; this.waveTimer = S.waveTimer; this.waveNo = S.waveNo;
    this.winner = S.winner; this.orbs = S.orbs; this.stats = S.stats; this.autoCast = S.autoCast;
    this.throneAtkFx = S.tac; this.throneCd = S.tcd;
    const byUid = new Map(this.heroes.map((h) => [h.uid, h]));
    for (const a of S.heroes) {
      const h = byUid.get(a[0] as number);
      if (!h) continue;
      [, h.lvl, h.xp, h.hp, h.maxHp, h.mana, h.maxMana, h.dmg, h.cd, h.atkCd] = a as number[];
      h.dead = a[10] === 1; h.respawn = a[11] as number; h.off = a[12] as number; h.s = a[13] as number;
      const tr = a[14] as 0 | [number, 'go' | 'fight' | 'back', number, number, number];
      h.trip = tr ? { nid: tr[0], phase: tr[1], x: tr[2], y: tr[3], idx: tr[4] } : null;
    }
    this.creeps = S.creeps.map((a) => ({
      uid: a[0] as number, kind: a[1] as CreepKind, side: a[2] as Side, lane: a[3] as number, s: a[4] as number, off: a[5] as number,
      hp: a[6] as number, maxHp: a[7] as number, dmg: a[8] as number, range: a[9] as number, rate: a[10] as number, speed: a[11] as number,
      atkCd: a[12] as number, slowT: a[13] as number, slowMul: a[14] as number, stunT: a[15] as number, gold: a[16] as number, r: a[17] as number, dead: false,
    }));
    const cByUid = new Map(this.creeps.map((c) => [c.uid, c]));
    this.wards = S.wards.map((a) => ({ side: a[0] as Side, lane: a[1], s: a[2], off: a[3], ttl: a[4], dmg: a[5], range: a[6], atkCd: a[7] }));
    const projs: Proj[] = [];
    for (const a of S.projs) {
      const t = a[2] as { k: string; u: number };
      let target: Target | null = null;
      if (t.k === 'c') { const c = cByUid.get(t.u); if (c) target = { kind: 'creep', c }; }
      else if (t.k === 'h') { const h = byUid.get(t.u); if (h) target = { kind: 'hero', h }; }
      else target = { kind: 'throne', side: t.u as Side };
      if (!target) continue;
      projs.push({ x: a[0] as number, y: a[1] as number, target, dmg: a[3] as number, speed: a[4] as number, color: a[5] as string, size: a[6] as number, src: byUid.get(a[7] as number) });
    }
    this.projs = projs;
    S.neutrals.forEach((a, i) => {
      const n = this.neutrals[i];
      if (!n) return;
      [n.hp, n.maxHp, n.dmg] = a as number[];
      n.alive = a[3] === 1; n.respawnT = a[4] as number; n.atkCd = a[5] as number; n.hits = a[6] as number; n.owner = a[7] as Side | null;
    });
    this.fx = S.fx;
    this.updateVision();
  }

  sideColor(side: Side) {
    return SIDE_COLOR[side];
  }
}
