/** The web app's side of the WebSocket, for tests: calls, the app slices and every pushed event. */
import WebSocket from 'ws';
import type { AppSlices, NotifyMessage, ServerMessage, SessionEvent, SessionSummary } from '@code-agent/shared/types';
import type { ServerApi } from '@code-agent/shared/api';

type Method = keyof ServerApi;
type Result<M extends Method> = Awaited<ReturnType<ServerApi[M]>>;

export class Client {
  slices = {} as AppSlices;
  sessions = new Map<string, SessionSummary>();
  /** Every session event, per session, in order. */
  events = new Map<string, SessionEvent[]>();
  notices: NotifyMessage[] = [];
  toasts: Array<{ text: string; tone: string }> = [];
  user = '';
  private ws!: WebSocket;
  private id = 0;
  private waiting = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
  private listeners: Array<(m: ServerMessage) => void> = [];

  constructor(readonly port: number) {}

  async connect(origin = `http://127.0.0.1:${this.port}`): Promise<this> {
    this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws`, { origin });
    await new Promise<void>((resolve, reject) => {
      this.ws.once('error', reject);
      this.ws.once('unexpected-response', (_q, r) => reject(new Error(`HTTP ${r.statusCode}`)));
      this.ws.on('message', (raw) => {
        const m = JSON.parse(String(raw)) as ServerMessage;
        this.take(m);
        if (m.t === 'hello') resolve();
      });
    });
    return this;
  }

  private take(m: ServerMessage) {
    if (m.t === 'hello') {
      this.slices = { ...m.slices };
      this.user = m.user;
      for (const s of m.sessions) this.sessions.set(s.id, s);
    } else if (m.t === 'ret') {
      const w = this.waiting.get(m.id);
      this.waiting.delete(m.id);
      if (m.error) w?.rej(new Error(m.error));
      else w?.res(m.result);
    } else if (m.t === 'app') Object.assign(this.slices, m.patch);
    else if (m.t === 'session.upsert') this.sessions.set(m.s.id, m.s);
    else if (m.t === 'session.remove') this.sessions.delete(m.id);
    else if (m.t === 'ev') this.events.set(m.sid, [...(this.events.get(m.sid) ?? []), m.ev]);
    else if (m.t === 'notify') this.notices.push(m.n);
    else if (m.t === 'toast') this.toasts.push({ text: m.text, tone: m.tone });
    for (const l of this.listeners) l(m);
  }

  call<M extends Method>(method: M, ...args: Parameters<ServerApi[M]>): Promise<Result<M>> {
    // Like the web app's store: a client's own change applies here at once (the server does not echo it back).
    if (method === 'setState') Object.assign(this.slices, args[0]);
    return new Promise((res, rej) => {
      this.id += 1;
      this.waiting.set(this.id, { res: res as (v: unknown) => void, rej });
      this.ws.send(JSON.stringify({ t: 'call', id: this.id, method, args }));
    });
  }

  on(fn: (m: ServerMessage) => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter((l) => l !== fn); };
  }

  /** Session events of one kind. */
  evs<T extends SessionEvent['t']>(sid: string, t: T): Array<Extract<SessionEvent, { t: T }>> {
    return (this.events.get(sid) ?? []).filter((e): e is Extract<SessionEvent, { t: T }> => e.t === t);
  }

  close() { this.ws?.close(); }
}

/** Poll until `fn` returns something truthy. */
export async function until<T>(fn: () => T | Promise<T>, what: string, ms = 60_000): Promise<NonNullable<T>> {
  const t0 = Date.now();
  let last: unknown;
  while (Date.now() - t0 < ms) {
    try {
      const v = await fn();
      if (v) return v as NonNullable<T>;
    } catch (e) { last = e; }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out after ${ms} ms waiting for ${what}${last ? ` (last error: ${last instanceof Error ? last.message : String(last)})` : ''}`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
