// Связь двух телефонов. Один создаёт комнату (хост), второй входит по коду (гость).
// Основной путь — публичные MQTT-брокеры: сообщения идут через сервер-посредник, поэтому
// не мешают ни роутеры, ни мобильные операторы. Хост слушает комнату сразу на всех
// доступных брокерах, гость пробует их по очереди. Запасной путь — PeerJS (WebRTC).
// В браузере для проверки — BroadcastChannel между двумя вкладками.
import { Mqtt } from './mqtt';

export interface Link {
  send(msg: unknown): void;
  close(): void;
  onMessage: (msg: any) => void;
  onClose: () => void;
  /** Как часто хосту слать снимки боя (через брокер — реже, чтобы не упереться в лимиты). */
  snapEvery: number;
  via: string;
  /** Связь пропала (false) или вернулась (true) — для подсказки на экране. */
  onStatus?: (ok: boolean) => void;
}

/** Публичные брокеры MQTT по WebSocket. Можно переопределить в localStorage 'tl-brokers' (JSON-массив). */
function brokers(): string[] {
  try {
    const o = localStorage.getItem('tl-brokers');
    if (o) return JSON.parse(o);
  } catch { /* */ }
  return [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
    'wss://mqtt.eclipseprojects.io:443/mqtt',
  ];
}
const host = (url: string) => url.replace(/^wss?:\/\//, '').split(/[:/]/)[0];

type PeerCtor = new (id?: string, opts?: unknown) => {
  on(ev: string, cb: (...a: any[]) => void): void;
  connect(id: string, opts?: unknown): any;
  destroy(): void;
};

const PREFIX = 'trilinii-room-';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRoomCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

/** PeerJS подключается обычным скриптом (vendor/peerjs.min.js) и кладёт себя в window. */
function peerCtor(): PeerCtor | null {
  const w = window as unknown as { Peer?: PeerCtor; peerjs?: { Peer?: PeerCtor } };
  return w.Peer ?? w.peerjs?.Peer ?? null;
}

/** local — проверка в двух вкладках (адрес с #local), иначе — настоящая сеть. */
export function netMode(): 'net' | 'local' {
  return location.hash.includes('local') ? 'local' : 'net';
}

function makeLink(sendRaw: (s: string) => void, closeRaw: () => void, via = 'peer', snapEvery = 0.1): Link & { feed(raw: string): void; dead(): void; closed: boolean } {
  const link = {
    onMessage: (_: any) => undefined as void,
    onClose: () => undefined as void,
    closed: false,
    via,
    snapEvery,
    send(msg: unknown) {
      if (!link.closed) sendRaw(JSON.stringify(msg));
    },
    close() {
      if (link.closed) return;
      link.closed = true;
      closeRaw();
    },
    feed(raw: string) {
      try { link.onMessage(JSON.parse(raw)); } catch { /* битое сообщение — пропускаем */ }
    },
    dead() {
      if (link.closed) return;
      link.closed = true;
      link.onClose();
    },
  };
  return link;
}

const TOPIC = (code: string) => `trilinii/v2/${code}`;

/**
 * Надёжная связь через несколько брокеров сразу.
 * Мобильный интернет иногда молча «замораживает» соединение с зарубежным сервером: сокет
 * формально открыт, но данные не идут. Поэтому:
 *  - держим соединения со всеми доступными брокерами, служебные сообщения шлём через все;
 *  - тяжёлые снимки боя — только через тот брокер, откуда последним что-то пришло;
 *  - если от брокера 7 секунд тишины — переподключаемся к нему заново в фоне;
 *  - соединение с соперником считается потерянным, только если 45 секунд не работает ни один брокер.
 * Сообщения нумеруются, повторы (пришедшие через разные брокеры) отбрасываются.
 */
const ROTATE_BYTES = 20000;

function multiLink(urls: string[], first: Mqtt[], sendTopic: string, recvTopic: string): Link {
  type C = { url: string; m: Mqtt | null; lastIn: number; lastOut: number; connecting: boolean; retryAt: number; bytes: number; rotating: boolean };
  const now = () => performance.now();
  const conns: C[] = urls.map((url) => ({ url, m: null, lastIn: 0, lastOut: 0, connecting: false, retryAt: 0, bytes: 0, rotating: false }));
  let seq = 0;
  const seen = new Set<number>();
  let maxSeen = 0;
  let lastAny = now();
  let wasOk = true;
  let timer = 0;

  const link = makeLink(
    (s) => {
      const t = now();
      const live = conns.filter((c) => c.m && !c.m.closed);
      if (!live.length) return;
      // снимок боя — через самый «свежий» брокер, остальное — через все
      const bulk = s.startsWith('{"t":"snap"');
      const targets = bulk ? [live.reduce((a, b) => (b.lastIn > a.lastIn ? b : a))] : live;
      const raw = `{"q":${++seq},"d":${s}}`;
      for (const c of targets) { c.lastOut = t; c.bytes += raw.length; c.m!.publish(sendTopic, raw); }
    },
    () => { clearInterval(timer); for (const c of conns) c.m?.close(); },
    'mqtt',
    0.2,
  ) as ReturnType<typeof makeLink> & { onStatus?: (ok: boolean) => void };

  const attach = (c: C, m: Mqtt) => {
    c.m = m;
    c.bytes = 0;
    c.lastIn = now(); // даём новому соединению время показать себя
    m.subscribe(recvTopic, (raw) => {
      const t = now();
      c.lastIn = t;
      if (c.m === m) c.bytes += raw.length + 40;
      lastAny = t;
      if (raw === '{"t":"hb"}') return;
      let q = 0;
      let body = raw;
      const mm = /^\{"q":(\d+),"d":/.exec(raw);
      if (mm) {
        q = Number(mm[1]);
        if (seen.has(q)) return;
        seen.add(q);
        if (q > maxSeen) maxSeen = q;
        if (seen.size > 600) for (const k of seen) if (k < maxSeen - 400) seen.delete(k);
        body = raw.slice(mm[0].length, -1);
      }
      link.feed(body);
    });
    m.onClose = () => { if (c.m === m) { c.m = null; c.retryAt = now() + 1000; } };
  };

  /** Заранее заменить соединение свежим, пока по нему не прошло слишком много данных:
   * некоторые мобильные сети «замораживают» долгие соединения после нескольких десятков килобайт. */
  const rotate = (c: C) => {
    if (c.rotating || link.closed) return;
    c.rotating = true;
    Mqtt.connect(c.url, 6000).then((m) => {
      c.rotating = false;
      if (link.closed) { m.close(); return; }
      const old = c.m;
      attach(c, m);
      if (old) { old.onClose = () => undefined; setTimeout(() => old.close(), 1500); }
    }, () => { c.rotating = false; c.bytes = 0; });
  };

  const reconnect = (c: C) => {
    if (c.connecting || link.closed) return;
    c.connecting = true;
    Mqtt.connect(c.url, 6000).then((m) => {
      c.connecting = false;
      if (link.closed) { m.close(); return; }
      attach(c, m);
    }, () => {
      c.connecting = false;
      c.retryAt = now() + 5000;
    });
  };

  for (const m of first) {
    const c = conns.find((x) => x.url === m.url);
    if (c) attach(c, m);
  }
  // остальные брокеры подключаем в фоне — запасные пути
  for (const c of conns) if (!c.m) reconnect(c);

  timer = window.setInterval(() => {
    if (link.closed) { clearInterval(timer); return; }
    const t = now();
    for (const c of conns) {
      if (c.m && !c.m.closed) {
        if (t - c.lastOut > 2000) { c.lastOut = t; c.bytes += 60; c.m.publish(sendTopic, '{"t":"hb"}'); }
        if (c.bytes > ROTATE_BYTES) rotate(c);
        // тишина: соединение, вероятно, «заморожено» — пересоздаём
        if (t - c.lastIn > 7000) { const m = c.m; c.m = null; m.onClose = () => undefined; m.close(); c.retryAt = t + 500; }
      } else if (!c.connecting && t >= c.retryAt) reconnect(c);
    }
    const ok = t - lastAny < 5000;
    if (ok !== wasOk) { wasOk = ok; link.onStatus?.(ok); }
    if (t - lastAny > 45000) { clearInterval(timer); for (const c of conns) c.m?.close(); link.dead(); }
  }, 1000);
  return link;
}

/** Создать комнату и ждать соперника. onStatus — текст для экрана ожидания. */
export async function hostRoom(code: string, onStatus: (s: string) => void): Promise<Link> {
  if (netMode() === 'local') return localLink(code, 'host', onStatus);
  onStatus('Подключаемся к серверам…');
  const urls = brokers();
  const tried = await Promise.allSettled(urls.map((u) => Mqtt.connect(u)));
  const conns = tried.filter((r): r is PromiseFulfilledResult<Mqtt> => r.status === 'fulfilled').map((r) => r.value);
  if (!conns.length) {
    onStatus('Серверы-посредники недоступны, пробуем запасной способ…');
    return peerHost(code, onStatus);
  }
  onStatus(`Комната создана (серверов: ${conns.length}). Ждём соперника…`);
  const T = TOPIC(code);
  return new Promise((resolve) => {
    let done = false;
    for (const m of conns) {
      m.subscribe(`${T}/k`, (raw) => {
        if (done) return;
        let id = '';
        try { id = JSON.parse(raw).id; } catch { return; }
        if (!id) return;
        done = true;
        const live = conns.filter((c) => !c.closed);
        // сначала подписка на сообщения гостя, потом приглашение — чтобы не потерять его первое сообщение
        const link = multiLink(urls, live, `${T}/g/${id}`, `${T}/h/${id}`);
        for (const c of live) c.publish(`${T}/g/${id}`, '{"t":"welcome"}');
        resolve(link);
      });
    }
  });
}

/** Войти в комнату по коду. */
export async function joinRoom(code: string, onStatus: (s: string) => void): Promise<Link> {
  if (netMode() === 'local') return localLink(code, 'guest', onStatus);
  const T = TOPIC(code);
  const id = Math.random().toString(36).slice(2, 10);
  const urls = brokers();
  let reached = 0;
  for (const url of urls) {
    onStatus(`Ищем комнату на ${host(url)}…`);
    let m: Mqtt;
    try { m = await Mqtt.connect(url, 5000); } catch { continue; }
    reached++;
    const welcomed = await new Promise<boolean>((res) => {
      const t = setTimeout(() => res(false), 3500);
      m.subscribe(`${T}/g/${id}`, (raw) => { if (raw.includes('welcome')) { clearTimeout(t); res(true); } });
      m.publish(`${T}/k`, JSON.stringify({ id }));
      setTimeout(() => m.publish(`${T}/k`, JSON.stringify({ id })), 1200);
    });
    if (welcomed) return multiLink(urls, [m], `${T}/h/${id}`, `${T}/g/${id}`);
    m.close();
  }
  if (!reached) {
    onStatus('Серверы-посредники недоступны, пробуем запасной способ…');
    return peerJoin(code, onStatus);
  }
  throw new Error('Комната с таким кодом не найдена. Проверь код — и что у друга открыт экран ожидания');
}

function peerHost(code: string, onStatus: (s: string) => void): Promise<Link> {
  const Peer = peerCtor();
  if (!Peer) return Promise.reject(new Error('Нет связи с серверами. Проверь интернет или попробуй другую сеть'));
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { debug: 0 });
    let done = false;
    peer.on('open', () => onStatus('Комната создана. Ждём соперника…'));
    peer.on('error', (e: { type?: string }) => {
      if (done) return;
      reject(new Error(e?.type === 'unavailable-id' ? 'Код занят, создай комнату ещё раз' : `Нет связи с серверами (${e?.type ?? 'ошибка'}). Проверь интернет или попробуй другую сеть`));
    });
    peer.on('connection', (conn: any) => {
      if (done) { conn.close(); return; }
      conn.on('open', () => {
        done = true;
        const link = makeLink((s) => conn.send(s), () => { conn.close(); peer.destroy(); });
        conn.on('data', (d: string) => link.feed(d));
        conn.on('close', () => link.dead());
        conn.on('error', () => link.dead());
        resolve(link);
      });
    });
  });
}

function peerJoin(code: string, onStatus: (s: string) => void): Promise<Link> {
  const Peer = peerCtor();
  if (!Peer) return Promise.reject(new Error('Нет связи с серверами. Проверь интернет или попробуй другую сеть'));
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, { debug: 0 });
    let done = false;
    const fail = (msg: string) => { if (!done) { done = true; peer.destroy(); reject(new Error(msg)); } };
    const timer = setTimeout(() => fail('Не удалось подключиться. Проверь код и интернет'), 20000);
    peer.on('error', (e: { type?: string }) => fail(e?.type === 'peer-unavailable' ? 'Комната с таким кодом не найдена' : `Нет связи с серверами (${e?.type ?? 'ошибка'})`));
    peer.on('open', () => {
      onStatus('Подключаемся…');
      const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'raw' });
      conn.on('open', () => {
        done = true;
        clearTimeout(timer);
        const link = makeLink((s) => conn.send(s), () => { conn.close(); peer.destroy(); });
        conn.on('data', (d: string) => link.feed(d));
        conn.on('close', () => link.dead());
        conn.on('error', () => link.dead());
        resolve(link);
      });
    });
  });
}

/** Запасной канал для проверки на одном компьютере: две вкладки одного браузера. */
function localLink(code: string, role: 'host' | 'guest', onStatus: (s: string) => void): Promise<Link> {
  return new Promise((resolve) => {
    const ch = new BroadcastChannel(PREFIX + code);
    const me = role;
    const other = role === 'host' ? 'guest' : 'host';
    let link: ReturnType<typeof makeLink> | null = null;
    const open = () => {
      if (link) return;
      link = makeLink((s) => ch.postMessage({ from: me, s }), () => { ch.postMessage({ from: me, bye: 1 }); ch.close(); }, 'local');
      resolve(link);
    };
    ch.onmessage = (e) => {
      const d = e.data as { from: string; hello?: number; s?: string; bye?: number };
      if (d.from !== other) return;
      if (d.hello) { ch.postMessage({ from: me, hello: 2 }); open(); return; }
      if (d.bye) { link?.dead(); return; }
      if (d.s !== undefined) link?.feed(d.s);
    };
    onStatus(role === 'host' ? 'Комната создана (проверочный режим). Ждём соперника…' : 'Подключаемся…');
    if (role === 'guest') ch.postMessage({ from: me, hello: 1 });
  });
}
