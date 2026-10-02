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

function makeLink(sendRaw: (s: string) => void, closeRaw: () => void, via = 'peer', snapEvery = 0.1): Link & { feed(raw: string): void; dead(): void } {
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

/** Связь через брокер с сердцебиением: если 12 секунд тишины — соединение считается потерянным. */
function mqttLink(m: Mqtt, sendTopic: string, recvTopic: string): Link {
  let lastIn = performance.now();
  let lastOut = 0;
  let hb = 0;
  const link = makeLink(
    (s) => { lastOut = performance.now(); m.publish(sendTopic, s); },
    () => { clearInterval(hb); m.close(); },
    host(m.url),
    0.2,
  );
  m.subscribe(recvTopic, (raw) => {
    lastIn = performance.now();
    if (raw === '{"t":"hb"}') return;
    link.feed(raw);
  });
  hb = window.setInterval(() => {
    const now = performance.now();
    if (now - lastOut > 2000) { lastOut = now; m.publish(sendTopic, '{"t":"hb"}'); }
    if (now - lastIn > 12000) { clearInterval(hb); m.close(); link.dead(); }
  }, 1000);
  m.onClose = () => { clearInterval(hb); link.dead(); };
  return link;
}

/** Создать комнату и ждать соперника. onStatus — текст для экрана ожидания. */
export async function hostRoom(code: string, onStatus: (s: string) => void): Promise<Link> {
  if (netMode() === 'local') return localLink(code, 'host', onStatus);
  onStatus('Подключаемся к серверам…');
  const tried = await Promise.allSettled(brokers().map((u) => Mqtt.connect(u)));
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
        for (const o of conns) if (o !== m) o.close();
        m.publish(`${T}/g/${id}`, '{"t":"welcome"}');
        resolve(mqttLink(m, `${T}/g/${id}`, `${T}/h/${id}`));
      });
    }
  });
}

/** Войти в комнату по коду. */
export async function joinRoom(code: string, onStatus: (s: string) => void): Promise<Link> {
  if (netMode() === 'local') return localLink(code, 'guest', onStatus);
  const T = TOPIC(code);
  const id = Math.random().toString(36).slice(2, 10);
  let reached = 0;
  for (const url of brokers()) {
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
    if (welcomed) return mqttLink(m, `${T}/h/${id}`, `${T}/g/${id}`);
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
