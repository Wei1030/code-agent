/** The WebSocket the UI talks over: RPC calls in, results and pushed state out. */
import type { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientMessage, ServerMessage } from '@code-agent/shared/types';
import type { ServerApi } from '@code-agent/shared/api';

type Handler = (...args: never[]) => unknown;
const methods = new Map<string, Handler>();
const clients = new Set<WebSocket>();

/** The client whose call is being handled, so its own edits are not echoed back. */
export let caller: WebSocket | null = null;

export function register(handlers: Partial<{ [K in keyof ServerApi]: (...args: Parameters<ServerApi[K]>) => ReturnType<ServerApi[K]> | Promise<ReturnType<ServerApi[K]>> }>) {
  for (const [k, fn] of Object.entries(handlers)) methods.set(k, fn as Handler);
}

export function broadcast(msg: ServerMessage, except?: WebSocket | null) {
  const data = JSON.stringify(msg);
  for (const c of clients) if (c !== except && c.readyState === WebSocket.OPEN) c.send(data);
}

export function clientCount() {
  return clients.size;
}

let hello: () => ServerMessage = () => { throw new Error('no hello'); };
export function onHello(fn: () => ServerMessage) {
  hello = fn;
}

export function allowedOrigin(req: IncomingMessage, port: number): boolean {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && Number(u.port || 80) === port;
  } catch {
    return false;
  }
}

export function attach(wss: WebSocketServer) {
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.send(JSON.stringify(hello()));
    ws.on('close', () => clients.delete(ws));
    ws.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.t !== 'call') return;
      const fn = methods.get(msg.method);
      const reply = (r: { result?: unknown; error?: string }) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'ret', id: msg.id, ...r } satisfies ServerMessage));
      };
      if (!fn) {
        reply({ error: `unknown method ${msg.method}` });
        return;
      }
      try {
        caller = ws;
        const out = (fn as (...a: unknown[]) => unknown)(...msg.args);
        caller = null;
        reply({ result: await out });
      } catch (e) {
        caller = null;
        console.error(`[rpc] ${msg.method} failed:`, e);
        reply({ error: e instanceof Error ? e.message : String(e) });
      }
    });
  });
}
