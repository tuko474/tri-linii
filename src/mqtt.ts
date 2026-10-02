// Минимальный MQTT 3.1.1 клиент поверх WebSocket — без внешних библиотек.
// Нужен только QoS 0: подключиться, подписаться на точные топики, публиковать строки.

const enc = new TextEncoder();
const dec = new TextDecoder();

function str(s: string): number[] {
  const b = enc.encode(s);
  return [b.length >> 8, b.length & 255, ...b];
}

function packet(type: number, body: number[]): Uint8Array<ArrayBuffer> {
  const len: number[] = [];
  let n = body.length;
  do {
    let d = n % 128;
    n = Math.floor(n / 128);
    if (n > 0) d |= 128;
    len.push(d);
  } while (n > 0);
  return new Uint8Array([type, ...len, ...body]);
}

export class Mqtt {
  private buf = new Uint8Array(0);
  private subs = new Map<string, (payload: string) => void>();
  private pid = 1;
  private ping = 0;
  closed = false;
  onClose: () => void = () => undefined;

  private constructor(private ws: WebSocket, readonly url: string) {}

  /** Подключиться к брокеру. Отказ — если не ответил за timeoutMs. */
  static connect(url: string, timeoutMs = 6000): Promise<Mqtt> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(url, ['mqtt']);
      } catch (e) {
        reject(e);
        return;
      }
      ws.binaryType = 'arraybuffer';
      const m = new Mqtt(ws, url);
      let ok = false;
      const timer = setTimeout(() => { if (!ok) { try { ws.close(); } catch { /* */ } reject(new Error('timeout')); } }, timeoutMs);
      ws.onopen = () => {
        const id = 'tl' + Math.random().toString(36).slice(2, 12);
        // протокол MQTT, уровень 4, чистая сессия, keepalive 30 с
        ws.send(packet(0x10, [...str('MQTT'), 4, 0x02, 0, 30, ...str(id)]));
      };
      ws.onmessage = (e) => {
        const chunk = new Uint8Array(e.data as ArrayBuffer);
        const merged = new Uint8Array(m.buf.length + chunk.length);
        merged.set(m.buf);
        merged.set(chunk, m.buf.length);
        m.buf = merged;
        m.drain((type, body) => {
          if (type === 0x20 && !ok) {
            ok = true;
            clearTimeout(timer);
            if (body[1] !== 0) { reject(new Error('refused')); ws.close(); return; }
            m.ping = window.setInterval(() => m.raw(new Uint8Array([0xc0, 0])), 20000);
            resolve(m);
          }
        });
      };
      ws.onerror = () => { if (!ok) { clearTimeout(timer); reject(new Error('ws')); } };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!ok) reject(new Error('closed'));
        m.dead();
      };
    });
  }

  private raw(b: Uint8Array<ArrayBuffer>) {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(b);
  }

  /** Разобрать накопленные байты на пакеты MQTT. */
  private drain(onCtl?: (type: number, body: Uint8Array) => void) {
    for (;;) {
      if (this.buf.length < 2) return;
      let mul = 1;
      let len = 0;
      let i = 1;
      let byte: number;
      do {
        if (i >= this.buf.length) return;
        byte = this.buf[i++];
        len += (byte & 127) * mul;
        mul *= 128;
      } while (byte & 128);
      if (this.buf.length < i + len) return;
      const hdr = this.buf[0];
      const type = hdr & 0xf0;
      const body = this.buf.slice(i, i + len);
      this.buf = this.buf.slice(i + len);
      if (type === 0x30) {
        const tl = (body[0] << 8) | body[1];
        const topic = dec.decode(body.slice(2, 2 + tl));
        const qos = (hdr >> 1) & 3; // при QoS>0 после топика идёт id пакета
        const payload = dec.decode(body.slice(2 + tl + (qos ? 2 : 0)));
        this.subs.get(topic)?.(payload);
      } else onCtl?.(type, body);
    }
  }

  subscribe(topic: string, cb: (payload: string) => void) {
    this.subs.set(topic, cb);
    const id = this.pid++ & 0xffff || 1;
    this.raw(packet(0x82, [id >> 8, id & 255, ...str(topic), 0]));
  }

  publish(topic: string, payload: string) {
    this.raw(packet(0x30, [...str(topic), ...enc.encode(payload)]));
  }

  close() {
    if (this.closed) return;
    this.raw(new Uint8Array([0xe0, 0]));
    this.closed = true;
    clearInterval(this.ping);
    try { this.ws.close(); } catch { /* */ }
  }

  private dead() {
    clearInterval(this.ping);
    if (this.closed) return;
    this.closed = true;
    this.onClose();
  }
}
