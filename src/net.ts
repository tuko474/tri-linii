// Связь двух телефонов. Один создаёт комнату (хост), второй входит по коду (гость).
// В приложении работает через PeerJS: сервер помогает только найти друг друга, дальше
// телефоны общаются напрямую (WebRTC). Без PeerJS (например, в браузере для проверки)
// используется BroadcastChannel — связь между двумя вкладками одного браузера.

export interface Link {
  send(msg: unknown): void;
  close(): void;
  onMessage: (msg: any) => void;
  onClose: () => void;
}

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

export function netMode(): 'peer' | 'local' {
  return peerCtor() ? 'peer' : 'local';
}

function makeLink(sendRaw: (s: string) => void, closeRaw: () => void): Link & { feed(raw: string): void; dead(): void } {
  const link = {
    onMessage: (_: any) => undefined as void,
    onClose: () => undefined as void,
    closed: false,
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

/** Создать комнату и ждать соперника. onStatus — текст для экрана ожидания. */
export function hostRoom(code: string, onStatus: (s: string) => void): Promise<Link> {
  if (netMode() === 'local') return localLink(code, 'host', onStatus);
  const Peer = peerCtor()!;
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + code, { debug: 0 });
    let done = false;
    peer.on('open', () => onStatus('Комната создана. Ждём соперника…'));
    peer.on('error', (e: { type?: string }) => {
      if (done) return;
      reject(new Error(e?.type === 'unavailable-id' ? 'Код занят, создай комнату ещё раз' : 'Нет связи с сервером комнат. Проверь интернет'));
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

/** Войти в комнату по коду. */
export function joinRoom(code: string, onStatus: (s: string) => void): Promise<Link> {
  if (netMode() === 'local') return localLink(code, 'guest', onStatus);
  const Peer = peerCtor()!;
  return new Promise((resolve, reject) => {
    const peer = new Peer(undefined, { debug: 0 });
    let done = false;
    const fail = (msg: string) => { if (!done) { done = true; peer.destroy(); reject(new Error(msg)); } };
    const timer = setTimeout(() => fail('Не удалось подключиться. Проверь код и интернет'), 20000);
    peer.on('error', (e: { type?: string }) => fail(e?.type === 'peer-unavailable' ? 'Комната с таким кодом не найдена' : 'Нет связи с сервером комнат'));
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
      link = makeLink((s) => ch.postMessage({ from: me, s }), () => { ch.postMessage({ from: me, bye: 1 }); ch.close(); });
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
