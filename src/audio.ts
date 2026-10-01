// Звук без файлов: эффекты и музыка синтезируются через Web Audio.
// Браузеры и WebView разрешают звук только после касания экрана — вызывай unlock() из обработчика нажатия.

type Mode = 'all' | 'sfx' | 'off';
const MODES: Mode[] = ['all', 'sfx', 'off'];

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
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
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(this.ctx.destination);
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = 0.22;
      this.musicBus.connect(this.master);
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

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, opts: { to?: number; delay?: number; bus?: GainNode; attack?: number } = {}) {
    const c = this.ctx!;
    const t0 = c.currentTime + (opts.delay ?? 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (opts.to) o.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    const a = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(opts.bus ?? this.sfxBus);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, opts: { delay?: number; q?: number; to?: number } = {}) {
    const c = this.ctx!;
    const t0 = c.currentTime + (opts.delay ?? 0);
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t0 + dur);
    f.Q.value = opts.q ?? 1;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t0);
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
    switch (k) {
      case 'kill':
        if (!this.throttle(k, 110)) return;
        this.tone(1320 + Math.random() * 200, 0.08, 'triangle', 0.08);
        this.tone(1980, 0.1, 'sine', 0.05, { delay: 0.04 });
        break;
      case 'coins':
        [0, 0.07, 0.14].forEach((d, i) => this.tone(1200 + i * 300, 0.12, 'triangle', 0.1, { delay: d }));
        break;
      case 'levelUp':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.16, 'square', 0.06, { delay: i * 0.06 }));
        break;
      case 'creepUp':
        this.noise(0.12, 0.35, 160, { q: 0.8 });
        this.tone(110, 0.18, 'sine', 0.25, { to: 60 });
        this.noise(0.1, 0.25, 180, { delay: 0.12, q: 0.8 });
        break;
      case 'cast':
        this.castSound(arg);
        break;
      case 'heroDie':
        if (!this.throttle(name, 300)) return;
        this.tone(arg === '0' ? 330 : 520, 0.5, 'sawtooth', 0.07, { to: arg === '0' ? 90 : 160 });
        break;
      case 'push':
        if (arg === '0') [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.28, 'square', 0.07, { delay: i * 0.1 }));
        else [392, 311, 262].forEach((f, i) => this.tone(f, 0.35, 'sawtooth', 0.06, { delay: i * 0.14 }));
        break;
      case 'throne':
        if (arg !== '0' || !this.throttle(name, 1800)) return;
        this.tone(880, 0.14, 'square', 0.07);
        this.tone(660, 0.14, 'square', 0.07, { delay: 0.18 });
        break;
      case 'alert':
        if (!this.throttle(k, 1500)) return;
        this.tone(740, 0.12, 'triangle', 0.1);
        this.tone(988, 0.16, 'triangle', 0.1, { delay: 0.12 });
        break;
      case 'roar':
        if (!this.throttle(k, 2000)) return;
        this.noise(0.9, 0.5, 220, { to: 90, q: 2 });
        this.tone(70, 0.9, 'sawtooth', 0.12, { to: 45 });
        break;
      case 'bossSpawn':
        this.tone(98, 1.2, 'sawtooth', 0.08, { to: 147, attack: 0.3 });
        this.noise(1, 0.2, 400, { to: 120, q: 3 });
        break;
      case 'bossDown':
        [262, 330, 392, 523, 659].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.1, { delay: i * 0.08 }));
        this.noise(0.6, 0.3, 120, { q: 0.7 });
        break;
      case 'bad':
        [220, 208, 196].forEach((f, i) => this.tone(f, 0.4, 'sawtooth', 0.06, { delay: i * 0.16 }));
        break;
      case 'win':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.35, 'square', 0.07, { delay: i * 0.13 }));
        break;
      case 'lose':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.5, 'sawtooth', 0.07, { delay: i * 0.22 }));
        break;
      case 'tap':
        this.tone(660, 0.05, 'triangle', 0.05);
        break;
      case 'deny':
        this.tone(160, 0.12, 'square', 0.06);
        break;
    }
  }

  private castSound(kind: string) {
    switch (kind) {
      case 'blast':
        this.noise(0.5, 0.5, 900, { to: 200, q: 1.5 });
        this.tone(180, 0.4, 'sine', 0.2, { to: 70 });
        break;
      case 'chain':
        for (let i = 0; i < 4; i++) this.tone(1600 - i * 200, 0.07, 'square', 0.06, { delay: i * 0.05, to: 400 });
        this.noise(0.25, 0.25, 3000, { q: 0.5 });
        break;
      case 'around':
        this.tone(120, 0.35, 'sine', 0.35, { to: 50 });
        this.noise(0.3, 0.4, 300, { q: 0.7 });
        break;
      case 'volley':
        for (let i = 0; i < 5; i++) this.noise(0.06, 0.3, 2400, { delay: i * 0.05, q: 4 });
        break;
      case 'drain':
        this.tone(440, 0.6, 'sawtooth', 0.06, { to: 110 });
        this.tone(220, 0.6, 'sine', 0.1, { to: 80 });
        break;
      case 'snipe':
        this.noise(0.12, 0.7, 1800, { q: 0.6 });
        this.tone(90, 0.25, 'sine', 0.25, { to: 50 });
        break;
      case 'wards':
        [660, 880, 990].forEach((f, i) => this.tone(f, 0.12, 'triangle', 0.08, { delay: i * 0.08 }));
        break;
      case 'heal':
        [523, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 'sine', 0.09, { delay: i * 0.07 }));
        break;
    }
  }

  // ---------- музыка: тихий фон из аккордов и арпеджио ----------

  /** Вызывать каждый кадр; сама планирует ноты наперёд. */
  tickMusic(dt: number, intense: boolean) {
    if (!this.ctx || this.mode !== 'all' || this.ctx.state !== 'running') return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    const beat = intense ? 0.24 : 0.32;
    this.musicTimer = beat;
    // ля минор → фа → до → соль
    const prog = [[220, 262, 330], [175, 220, 262], [262, 330, 392], [196, 247, 294]];
    const bar = Math.floor(this.step / 8) % prog.length;
    const chord = prog[bar];
    if (this.step % 8 === 0) {
      for (const f of chord) this.tone(f / 2, beat * 8, 'triangle', 0.09, { bus: this.musicBus, attack: 0.4 });
    }
    const arp = [0, 1, 2, 1, 2, 0, 2, 1];
    const f = chord[arp[this.step % 8]] * (this.step % 16 < 8 ? 2 : 1);
    this.tone(f, beat * 0.9, 'sine', 0.06, { bus: this.musicBus, attack: 0.01 });
    if (intense && this.step % 2 === 0) this.tone(55, 0.12, 'sine', 0.2, { bus: this.musicBus, to: 40 });
    this.step++;
  }
}
