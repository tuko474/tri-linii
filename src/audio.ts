// Звук без файлов: эффекты и музыка синтезируются через Web Audio.
// Браузеры и WebView разрешают звук только после касания экрана — вызывай unlock() из обработчика нажатия.
//
// Цепочка: голоса → шины (эффекты / музыка) → тёплый фильтр → компрессор → выход.
// Часть сигнала уходит в «зал» — эхо из сгенерированного отклика (свёртка), это убирает «приставочную» сухость.
// Тембры: щипок (струна), колокольчик (FM), удар с низом, шелест (фильтрованный шум), «медь» и мягкий пэд.

type Mode = 'all' | 'sfx' | 'off';
const MODES: Mode[] = ['all', 'sfx', 'off'];

interface VoiceOpts {
  delay?: number;
  bus?: GainNode;
  wet?: number; // доля в «зал» 0..1
  pan?: number; // -1..1
}

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private room!: GainNode; // вход «зала»
  private noiseBuf!: AudioBuffer;
  private last: Record<string, number> = {};
  private musicTimer = 0;
  private step = 0;
  mode: Mode = 'all';

  constructor(saved: string | null) {
    if (saved && (MODES as string[]).includes(saved)) this.mode = saved as Mode;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = (this.ctx = new AC());
      this.master = c.createGain();
      this.master.gain.value = 0.75;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.004;
      comp.release.value = 0.25;
      const warm = c.createBiquadFilter(); // срезаем резкий верх
      warm.type = 'lowpass';
      warm.frequency.value = 9500;
      warm.connect(comp).connect(this.master).connect(c.destination);
      this.sfxBus = c.createGain();
      this.sfxBus.connect(warm);
      this.musicBus = c.createGain();
      this.musicBus.connect(warm);
      // «зал»
      const conv = c.createConvolver();
      conv.buffer = this.impulse(2.2, 2.8);
      this.room = c.createGain();
      const ret = c.createGain();
      ret.gain.value = 0.32;
      this.room.connect(conv).connect(ret).connect(warm);
      // общий запас шума — режем из него кусочки
      const len = c.sampleRate * 2;
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.apply();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => undefined);
  }

  cycle(): Mode {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.apply();
    return this.mode;
  }

  private apply() {
    if (!this.ctx) return;
    this.sfxBus.gain.value = this.mode === 'off' ? 0 : 1;
    this.musicBus.gain.value = this.mode === 'all' ? 0.22 : 0;
  }

  suspend(on: boolean) {
    if (!this.ctx) return;
    if (on) this.ctx.suspend().catch(() => undefined);
    else this.ctx.resume().catch(() => undefined);
  }

  // ---------- кирпичики ----------

  /** Отклик «зала»: стерео-шум с плавным затуханием. */
  private impulse(sec: number, decay: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  private now(delay = 0) {
    return this.ctx!.currentTime + delay;
  }

  /** Выход голоса: громкость → панорама → шина (+ доля в зал). */
  private out(node: AudioNode, o: VoiceOpts) {
    const c = this.ctx!;
    let tail: AudioNode = node;
    if (o.pan && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = o.pan;
      tail = tail.connect(p);
    }
    tail.connect(o.bus ?? this.sfxBus);
    if (o.wet) {
      const w = c.createGain();
      w.gain.value = o.wet;
      tail.connect(w).connect(this.room);
    }
  }

  /** Огибающая: быстрая атака, плавный спад до тишины. */
  private env(g: GainNode, t0: number, peak: number, attack: number, dur: number) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  /** Лёгкий разброс высоты, чтобы повторы не звучали одинаково. */
  private vary(f: number, k = 0.03) {
    return f * (1 + (Math.random() - 0.5) * 2 * k);
  }

  /** Щипок струны: треугольник + октава синусом, фильтр быстро закрывается. */
  private pluck(freq: number, vol: number, dur = 0.35, o: VoiceOpts = {}) {
    const c = this.ctx!;
    const t0 = this.now(o.delay);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 2;
    f.frequency.setValueAtTime(Math.min(12000, freq * 8), t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 1.2), t0 + dur * 0.7);
    const g = c.createGain();
    this.env(g, t0, vol, 0.004, dur);
    for (const [type, mul, lvl] of [['triangle', 1, 1], ['sine', 2, 0.35]] as const) {
      const osc = c.createOscillator();
      osc.type = type;
      osc.frequency.value = freq * mul;
      const lg = c.createGain();
      lg.gain.value = lvl;
      osc.connect(lg).connect(f);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    f.connect(g);
    this.out(g, o);
  }

  /** Колокольчик: частотная модуляция, звонкое затухание. */
  private bell(freq: number, vol: number, dur = 0.9, o: VoiceOpts = {}) {
    const c = this.ctx!;
    const t0 = this.now(o.delay);
    const car = c.createOscillator();
    car.frequency.value = freq;
    const mod = c.createOscillator();
    mod.frequency.value = freq * 3.5;
    const mg = c.createGain();
    mg.gain.setValueAtTime(freq * 1.6, t0);
    mg.gain.exponentialRampToValueAtTime(freq * 0.05, t0 + dur);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain();
    this.env(g, t0, vol, 0.003, dur);
    car.connect(g);
    this.out(g, { wet: 0.35, ...o });
    for (const x of [car, mod]) { x.start(t0); x.stop(t0 + dur + 0.05); }
  }

  /** Удар: синус с падением высоты + короткий щелчок шума. */
  private thump(freq: number, vol: number, dur = 0.35, o: VoiceOpts = {}) {
    const c = this.ctx!;
    const t0 = this.now(o.delay);
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(freq, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.4), t0 + dur * 0.7);
    const g = c.createGain();
    this.env(g, t0, vol, 0.003, dur);
    osc.connect(g);
    this.out(g, o);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
    this.hiss(0.03, vol * 0.4, 2500, { type: 'highpass', delay: o.delay, bus: o.bus });
  }

  /** Шелест/взрыв: фильтрованный шум с движением фильтра. */
  private hiss(dur: number, vol: number, freq: number, o: VoiceOpts & { to?: number; q?: number; type?: BiquadFilterType; attack?: number } = {}) {
    const c = this.ctx!;
    const t0 = this.now(o.delay);
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
    f.Q.value = o.q ?? 0.9;
    const g = c.createGain();
    this.env(g, t0, vol, o.attack ?? 0.004, dur);
    src.connect(f).connect(g);
    this.out(g, o);
    src.start(t0, Math.random() * 1.5, dur + 0.05);
  }

  /** «Медь»: две расстроенные пилы, фильтр раскрывается — мягкий духовой звук. */
  private brass(freq: number, vol: number, dur = 0.5, o: VoiceOpts = {}) {
    const c = this.ctx!;
    const t0 = this.now(o.delay);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(freq * 1.5, t0);
    f.frequency.exponentialRampToValueAtTime(freq * 6, t0 + 0.08);
    f.frequency.exponentialRampToValueAtTime(freq * 2, t0 + dur);
    const g = c.createGain();
    this.env(g, t0, vol, 0.03, dur);
    for (const det of [-7, 7]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = det;
      osc.connect(f);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    f.connect(g);
    this.out(g, { wet: 0.3, ...o });
  }

  /** Пэд: мягкий долгий аккорд (для музыки и тревожных моментов). */
  private pad(freqs: number[], vol: number, dur: number, o: VoiceOpts & { attack?: number; cutoff?: number } = {}) {
    const c = this.ctx!;
    const t0 = this.now(o.delay);
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = o.cutoff ?? 900;
    f.Q.value = 0.5;
    const g = c.createGain();
    const a = o.attack ?? 0.6;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.setValueAtTime(vol, t0 + Math.max(a, dur - 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    for (const fr of freqs) for (const det of [-9, 9]) {
      const osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = fr;
      osc.detune.value = det;
      osc.connect(f);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    }
    f.connect(g);
    this.out(g, { wet: 0.5, ...o });
  }

  private throttle(key: string, ms: number) {
    const now = performance.now();
    if ((this.last[key] ?? 0) > now - ms) return false;
    this.last[key] = now;
    return true;
  }

  // ---------- эффекты ----------

  play(name: string) {
    if (!this.ctx || this.mode === 'off' || this.ctx.state !== 'running') return;
    const [k, arg] = name.split(':');
    const pan = () => (Math.random() - 0.5) * 0.6;
    switch (k) {
      case 'kill':
        // тихая «монетка»: щипок с призвуком колокольчика
        if (!this.throttle(k, 120)) return;
        this.pluck(this.vary(1175, 0.05), 0.05, 0.18, { pan: pan() });
        this.bell(this.vary(2350, 0.04), 0.012, 0.3, { delay: 0.02, wet: 0.15 });
        break;
      case 'coins':
        [1047, 1319, 1568].forEach((f, i) => this.bell(f, 0.05, 0.7, { delay: i * 0.07 }));
        break;
      case 'levelUp':
        [523, 659, 784, 1047].forEach((f, i) => this.pluck(f, 0.07, 0.45, { delay: i * 0.06, wet: 0.3 }));
        this.bell(2093, 0.03, 1.2, { delay: 0.24 });
        this.hiss(0.6, 0.03, 7000, { type: 'highpass', delay: 0.2, wet: 0.5 });
        break;
      case 'creepUp':
        // барабан: два удара с низом
        this.thump(this.vary(120), 0.35, 0.3);
        this.hiss(0.18, 0.12, 700, { type: 'lowpass' });
        this.thump(this.vary(105), 0.28, 0.3, { delay: 0.14 });
        break;
      case 'cast':
        this.castSound(arg);
        break;
      case 'heroDie':
        if (!this.throttle(name, 300)) return;
        if (arg === 'mine') {
          this.brass(220, 0.05, 0.7);
          this.brass(165, 0.05, 0.9, { delay: 0.18 });
          this.thump(70, 0.25, 0.6);
        } else {
          this.pluck(784, 0.06, 0.3);
          this.bell(1175, 0.03, 0.7, { delay: 0.08 });
        }
        break;
      case 'push':
        if (arg === 'good') {
          [392, 523, 659].forEach((f, i) => this.brass(f, 0.045, 0.45, { delay: i * 0.11 }));
          this.brass(784, 0.05, 0.9, { delay: 0.33 });
          this.thump(90, 0.25, 0.4, { delay: 0.33 });
        } else {
          [330, 294, 247].forEach((f, i) => this.brass(f, 0.045, 0.6, { delay: i * 0.15 }));
          this.thump(65, 0.25, 0.6, { delay: 0.3 });
        }
        break;
      case 'throne':
        // тревожный колокол
        if (!this.throttle(name, 1800)) return;
        this.bell(880, 0.05, 1.0);
        this.bell(660, 0.05, 1.2, { delay: 0.22 });
        break;
      case 'alert':
        if (!this.throttle(k, 1500)) return;
        this.bell(740, 0.04, 0.6);
        this.bell(988, 0.04, 0.8, { delay: 0.12 });
        break;
      case 'roar':
        if (!this.throttle(k, 2000)) return;
        this.hiss(1.0, 0.25, 320, { to: 110, q: 1.6, attack: 0.08, wet: 0.4 });
        this.brass(55, 0.08, 1.0);
        this.thump(55, 0.35, 0.9);
        break;
      case 'bossSpawn':
        this.pad([98, 147], 0.05, 2.2, { attack: 0.5, cutoff: 600 });
        this.hiss(1.4, 0.06, 300, { to: 1200, q: 2, attack: 0.6, wet: 0.5 });
        break;
      case 'bossDown':
        this.thump(80, 0.4, 0.7);
        this.hiss(0.7, 0.12, 400, { type: 'lowpass', to: 150 });
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.bell(f, 0.04, 1.2, { delay: 0.1 + i * 0.07 }));
        break;
      case 'bad':
        [220, 208, 196].forEach((f, i) => this.brass(f, 0.04, 0.5, { delay: i * 0.16 }));
        break;
      case 'win':
        [523, 659, 784].forEach((f, i) => this.brass(f, 0.045, 0.4, { delay: i * 0.12 }));
        this.brass(1047, 0.05, 1.3, { delay: 0.36 });
        this.pad([262, 330, 392], 0.04, 2.2, { delay: 0.36, attack: 0.2, cutoff: 1800 });
        [1568, 2093].forEach((f, i) => this.bell(f, 0.03, 1.4, { delay: 0.5 + i * 0.15 }));
        this.thump(80, 0.3, 0.6, { delay: 0.36 });
        break;
      case 'lose':
        [392, 349, 311].forEach((f, i) => this.brass(f, 0.04, 0.6, { delay: i * 0.22 }));
        this.pad([131, 156, 196], 0.045, 2.4, { delay: 0.66, attack: 0.3, cutoff: 700 });
        break;
      case 'tap':
        this.pluck(this.vary(880, 0.02), 0.035, 0.08);
        break;
      case 'deny':
        this.thump(180, 0.12, 0.14);
        break;
    }
  }

  private castSound(kind: string) {
    switch (kind) {
      case 'blast':
        // взрыв: шум сверху вниз + удар
        this.hiss(0.6, 0.3, 3500, { type: 'lowpass', to: 250, wet: 0.4 });
        this.thump(this.vary(150), 0.35, 0.5);
        break;
      case 'chain':
        // треск молнии
        for (let i = 0; i < 5; i++) this.hiss(0.05, 0.18, this.vary(4500, 0.2), { q: 6, delay: i * 0.045, pan: (Math.random() - 0.5) });
        this.hiss(0.35, 0.08, 6000, { type: 'highpass', wet: 0.4 });
        this.thump(110, 0.15, 0.25, { delay: 0.05 });
        break;
      case 'around':
        this.thump(this.vary(95), 0.45, 0.5);
        this.hiss(0.4, 0.16, 900, { type: 'lowpass', to: 200, wet: 0.3 });
        break;
      case 'volley':
        // свист стрел
        for (let i = 0; i < 5; i++) this.hiss(0.12, 0.22, this.vary(3200, 0.1), { to: 1400, q: 2, delay: i * 0.055, pan: (Math.random() - 0.5) * 0.8 });
        break;
      case 'drain':
        this.pad([110, 117], 0.05, 0.9, { attack: 0.08, cutoff: 700 });
        this.hiss(0.7, 0.07, 500, { type: 'lowpass', to: 150, wet: 0.4 });
        break;
      case 'snipe':
        this.hiss(0.06, 0.35, 2500, { type: 'highpass' });
        this.thump(85, 0.35, 0.35);
        this.hiss(0.5, 0.05, 1200, { type: 'lowpass', delay: 0.05, wet: 0.6 });
        break;
      case 'wards':
        [660, 880, 990].forEach((f, i) => this.bell(f, 0.035, 0.6, { delay: i * 0.08 }));
        break;
      case 'heal':
        [784, 1047, 1319].forEach((f, i) => this.bell(f, 0.035, 1.0, { delay: i * 0.07 }));
        this.hiss(0.8, 0.03, 7000, { type: 'highpass', wet: 0.6, attack: 0.1 });
        break;
    }
  }

  // ---------- музыка: мягкий пэд, щипковое арпеджио, в напряжённые моменты — барабан ----------

  /** Вызывать каждый кадр; сама планирует ноты наперёд. */
  tickMusic(dt: number, intense: boolean) {
    if (!this.ctx || this.mode !== 'all' || this.ctx.state !== 'running') return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const beat = intense ? 0.24 : 0.32;
    this.musicTimer = beat;
    const bus = this.musicBus;
    // ля минор → фа → до → соль
    const prog = [[220, 262, 330], [175, 220, 262], [262, 330, 392], [196, 247, 294]];
    const bar = Math.floor(this.step / 8) % prog.length;
    const chord = prog[bar];
    const s = this.step % 8;
    if (s === 0) {
      this.pad(chord.map((f) => f / 2), 0.035, beat * 8 + 0.4, { bus, attack: 0.8, cutoff: 800 });
      this.pluck(chord[0] / 4, 0.09, beat * 3.5, { bus }); // бас
    }
    if (s === 4) this.pluck(chord[0] / 4, 0.06, beat * 3, { bus });
    // арпеджио: не каждую долю — так музыка дышит
    const arp = [0, 1, 2, 1, 2, 0, 2, 1];
    if (s !== 3 && s !== 7) {
      const f = chord[arp[s]] * (this.step % 16 < 8 ? 2 : 1);
      this.pluck(f, 0.03, beat * 1.6, { bus, wet: 0.55, pan: (s % 2 ? 0.25 : -0.25) });
    }
    if (intense) {
      if (s % 2 === 0) this.thump(60, 0.16, 0.25, { bus });
      else this.hiss(0.04, 0.025, 8000, { type: 'highpass', bus });
    }
    this.step++;
  }
}
