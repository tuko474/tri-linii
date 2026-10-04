// Связь со своим сервером игры: аккаунт, прогресс, рейтинг, подбор соперника и передача боя.
// Адрес сервера — SERVER_URL ниже (подставляется при сборке) или localStorage 'tl-server'.
import type { Link } from './net';

/** Адрес сервера по умолчанию. Пусто — сервера пока нет, игра работает как раньше. */
export const SERVER_URL = 'wss://31-31-192-98.sslip.io';

export interface Profile {
  id: string;
  token: string;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  crystals: number;
  owned: string[];
  stars?: Record<string, number>; // нет у старого сервера
  daily?: Daily; // нет у старого сервера
  stickers?: string[]; // купленные стикеры
  sv?: number; // версия сервера (нет у старого)
  hasPass: boolean;
}

export interface Daily {
  resetIn: number; // мс до нового дня
  login: { can: boolean; day: number; rewards: number[] };
  quests: { id: string; text: string; need: number; have: number; reward: number; claimed: boolean }[];
}

export interface MatchInfo {
  id: string;
  role: 'host' | 'guest';
  ranked: boolean;
  foe: { name: string; rating: number };
  stars?: Record<string, number>[]; // звёзды хоста и гостя из базы сервера
}

export interface Ended {
  winner: 0 | 1 | null;
  reason: string;
  ranked: boolean;
  delta: number;
  crystals?: number; // сколько кристаллов дал сервер за этот бой
}

const kv = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* */ } },
  del(k: string) { try { localStorage.removeItem(k); } catch { /* */ } },
};

/** Номер сборки игры (0.1.N → N); для сервера. Локальная сборка — «dev», считаем свежей. */
/** Версия протокола игры: поднимаем, когда меняются сообщения с сервером (сервер не пускает в бои ниже своего MIN_BUILD). */
export const PROTO = 40;
/** Что сообщаем серверу: протокол, а у тестовых сборок 0.1.N — номер сборки, если он больше. Локально — «dev», считаем свежей. */
const verMeta = document.querySelector<HTMLMetaElement>('meta[name="app-version"]')?.content ?? 'dev';
export const BUILD = verMeta === 'dev' ? 9999 : Math.max(PROTO, verMeta.startsWith('0.1.') ? Number(verMeta.split('.')[2]) || 0 : 0);

export function serverUrl(): string {
  return (kv.get('tl-server') || SERVER_URL).trim();
}

/** Постоянное соединение с сервером: само переподключается и входит в аккаунт. */
export class Online {
  ws: WebSocket | null = null;
  me: Profile | null = null;
  ready = false; // соединение открыто
  rtt = 0;
  match: MatchInfo | null = null;
  private wantOpen = false;
  private retry = 0;
  private timer = 0;
  private pingTimer = 0;
  private outbox: string[] = [];
  private listeners = new Map<string, Set<(m: any) => void>>();
  private link: (Link & { feed(m: any): void; dead(): void; status(ok: boolean): void }) | null = null;

  get configured() {
    return !!serverUrl();
  }

  on(t: string, cb: (m: any) => void) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t)!.add(cb);
    return () => this.listeners.get(t)!.delete(cb);
  }

  private emit(t: string, m: any) {
    for (const cb of this.listeners.get(t) ?? []) cb(m);
  }

  start() {
    if (!this.configured) return;
    this.wantOpen = true;
    this.open();
  }

  private open() {
    if (!this.wantOpen || (this.ws && this.ws.readyState <= 1)) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl().replace(/\/$/, '') + '/ws');
    } catch {
      this.later();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.ready = true;
      this.retry = 0;
      const id = kv.get('tl-acc-id');
      const token = kv.get('tl-acc-token');
      if (id && token) this.raw({ t: 'auth', id, token, matchId: this.match?.id, v: BUILD });
      for (const s of this.outbox.splice(0)) ws.send(s);
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.raw({ t: 'ping', ts: Math.round(performance.now()) }), 5000);
      this.raw({ t: 'ping', ts: Math.round(performance.now()) });
      this.emit('status', true);
    };
    ws.onmessage = (e) => {
      let m: any;
      try { m = JSON.parse(e.data as string); } catch { return; }
      this.handle(m);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ready = false;
      this.ws = null;
      clearInterval(this.pingTimer);
      this.link?.status(false);
      this.emit('status', false);
      this.later();
    };
    ws.onerror = () => { /* onclose придёт следом */ };
  }

  private later() {
    if (!this.wantOpen) return;
    clearTimeout(this.timer);
    const wait = Math.min(8000, 500 * 2 ** this.retry++);
    this.timer = window.setTimeout(() => this.open(), wait);
  }

  private raw(m: unknown) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m));
  }

  /** Отправить; если связи нет — отправится после переподключения (кроме боевых сообщений). */
  send(m: { t: string; [k: string]: unknown }) {
    const s = JSON.stringify(m);
    if (this.ws && this.ws.readyState === 1) this.ws.send(s);
    else if (m.t !== 'relay' && m.t !== 'ping') { this.outbox.push(s); this.start(); }
  }

  private handle(m: any) {
    switch (m.t) {
      case 'pong': {
        const r = performance.now() - m.ts;
        if (r >= 0 && r < 30000) this.rtt = this.rtt ? this.rtt * 0.7 + r * 0.3 : r;
        break;
      }
      case 'me':
        this.me = m;
        kv.set('tl-acc-id', m.id);
        kv.set('tl-acc-token', m.token);
        break;
      case 'error':
        if (m.where === 'auth') { kv.del('tl-acc-id'); kv.del('tl-acc-token'); this.me = null; }
        break;
      case 'kicked':
        this.wantOpen = false; // вошли с другого телефона — не переподключаемся сами
        break;
      case 'match':
        this.match = { id: m.id, role: m.role, ranked: m.ranked, foe: m.foe, stars: m.stars };
        this.link = this.makeLink();
        break;
      case 'rejoined':
        this.link?.status(true);
        break;
      case 'relay':
        this.link?.feed(m.d);
        break;
      case 'peer':
        this.link?.status(!!m.ok);
        break;
      case 'ended': {
        const l = this.link;
        this.link = null;
        this.match = null;
        // соперник ушёл и не вернулся — для боя это обрыв связи
        if (l && (m.reason === 'left' || m.reason === 'quit')) l.dead();
        break;
      }
    }
    this.emit(m.t, m);
  }

  /** Канал боя через сервер — тот же интерфейс, что и у других способов связи. */
  private makeLink() {
    const self = this;
    const link = {
      onMessage: (_: any) => undefined as void,
      onClose: () => undefined as void,
      onStatus: undefined as ((ok: boolean) => void) | undefined,
      snapEvery: 0.1,
      via: 'server',
      closed: false,
      send(msg: unknown) {
        if (!link.closed) self.raw({ t: 'relay', d: msg });
      },
      close() {
        if (link.closed) return;
        link.closed = true;
        if (self.link === link) { self.raw({ t: 'quit' }); self.link = null; self.match = null; }
      },
      feed(m: any) { if (!link.closed) link.onMessage(m); },
      dead() { if (link.closed) return; link.closed = true; link.onClose(); },
      status(ok: boolean) { if (!link.closed) link.onStatus?.(ok); },
    };
    return link;
  }

  /** Канал текущего матча (после события 'match'). */
  matchLink(): Link | null {
    return this.link;
  }

  logout() {
    kv.del('tl-acc-id');
    kv.del('tl-acc-token');
    this.me = null;
    this.ws?.close();
  }
}
