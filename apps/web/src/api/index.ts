/**
 * Backend access for the UI: calls go to the Code Agent server over one WebSocket (`/ws`), which
 * also pushes app state, session events and notifications. App slices the UI edits in the store
 * are sent back to the server automatically.
 */
import type { ClientApi } from '@code-agent/shared/api';
import { READONLY_SLICES } from '@code-agent/shared/types';
import type { AppSlices, ServerMessage, SliceKey } from './types';
import { MODELS } from '../lib/catalog';
import { useApp } from '../store/app';
import { emptyRuntime, useSessions } from '../store/sessions';
import { notify } from '../lib/notify';

export type { DryRun, ImportRow, SendOptions } from '@code-agent/shared/api';

let ws: WebSocket | null = null;
let seq = 0;
let attempts = 0;
let everConnected = false;
const waiting = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
const outbox: string[] = [];
/** Set while applying the server's state, so it is not sent back. */
let applying = false;

function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

function sendRaw(data: string) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  else outbox.push(data);
}

export function call<T = unknown>(method: string, args: unknown[]): Promise<T> {
  seq += 1;
  const id = seq;
  return new Promise<T>((res, rej) => {
    waiting.set(id, { res: res as (v: unknown) => void, rej });
    sendRaw(JSON.stringify({ t: 'call', id, method, args }));
  });
}

function applySlices(patch: Partial<AppSlices>) {
  applying = true;
  try {
    if (patch.models?.length) MODELS.splice(0, MODELS.length, ...patch.models);
    useApp.setState(patch as never);
  } finally {
    applying = false;
  }
}

function handle(m: ServerMessage) {
  switch (m.t) {
    case 'hello': {
      applySlices(m.slices);
      useApp.setState({ sessions: m.sessions, booted: true });
      const app = useApp.getState();
      if (!app.workspaces.some((w) => w.id === app.currentWorkspaceId)) useApp.setState({ currentWorkspaceId: app.workspaces[0]?.id ?? '' });
      // Reload the transcripts in view: events may have been missed while disconnected.
      for (const id of Object.keys(useSessions.getState().runtimes)) {
        void call<ReturnType<typeof emptyRuntime> | null>('openSession', [id]).then((rt) => (rt ? useSessions.getState().init(rt) : useSessions.getState().drop(id)));
      }
      break;
    }
    case 'app':
      applySlices(m.patch);
      break;
    case 'session.upsert':
      useApp.getState().upsertSession(m.s);
      break;
    case 'session.remove':
      useApp.getState().removeSession(m.id);
      useSessions.getState().drop(m.id);
      break;
    case 'ev':
      useSessions.getState().apply(m.sid, m.ev);
      break;
    case 'notify':
      notify(m.n.kind, m.n);
      break;
    case 'toast':
      useApp.getState().toast(m.text, m.tone);
      break;
    case 'ret': {
      const w = waiting.get(m.id);
      waiting.delete(m.id);
      if (!w) break;
      if (m.error !== undefined) {
        w.rej(new Error(m.error));
        useApp.getState().toast(m.error, 'crit');
      } else w.res(m.result);
      break;
    }
  }
}

export function connect() {
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    attempts = 0;
    if (everConnected) {
      useApp.setState({ connection: 'restored' });
      setTimeout(() => useApp.setState({ connection: 'online' }), 2500);
    }
    everConnected = true;
    while (outbox.length) ws!.send(outbox.shift()!);
  };
  ws.onmessage = (e) => {
    try {
      handle(JSON.parse(String(e.data)) as ServerMessage);
    } catch (err) {
      console.error('bad server message', err);
    }
  };
  ws.onclose = () => {
    ws = null;
    for (const [, w] of waiting) w.rej(new Error('与 Code Agent 服务的连接已断开'));
    waiting.clear();
    attempts += 1;
    useApp.setState({ connection: 'offline', reconnectAttempt: attempts });
    setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempts, 5)));
  };
}

const WRITABLE = (Object.keys({
  prefs: 1, profiles: 1, rules: 1, dirs: 1, mcp: 1, mcpBehavior: 1, skills: 1, commandFiles: 1, plugins: 1, hookRules: 1, hookLog: 1, jobs: 1,
  peer: 1, maxRunning: 1, board: 1, boardSettings: 1, reviewChecks: 1, reviewProfile: 1, provider: 1, env: 1, runtime: 1,
} satisfies Partial<Record<SliceKey, 1>>) as SliceKey[]).filter((k) => !(READONLY_SLICES as readonly string[]).includes(k));

/** Send the UI's edits of app slices to the server (debounced per key while typing). */
const pendingSlices: Partial<AppSlices> = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;
useApp.subscribe((s, prev) => {
  if (applying || !s.booted || !prev.booted) return;
  let any = false;
  for (const k of WRITABLE) {
    if (s[k] !== prev[k]) {
      (pendingSlices as Record<string, unknown>)[k] = s[k];
      any = true;
    }
  }
  if (!any) return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    const patch = { ...pendingSlices };
    for (const k of Object.keys(pendingSlices)) delete (pendingSlices as Record<string, unknown>)[k];
    void call('setState', [patch]).catch(() => undefined);
  }, 250);
});

/** Work that ends when the session's Claude Code process is stopped. */
export interface RunningWork {
  turn: boolean;
  request: boolean;
  background: string[];
  queued: number;
}

type Remote = Omit<ClientApi, 'createDraft' | 'openSession'>;

interface Local {
  /** New, empty session in a workspace (reuses its unsent one). Created on the server right away. */
  createDraft(workspaceId: string): string;
  /** Load a session's transcript into the store if it is not there yet. */
  openSession(sid: string): Promise<void>;
  /** The session to open for a workspace: latest running, else its unsent one, else latest saved. */
  latestSession(workspaceId: string): string | null;
  runningWork(sid: string): RunningWork;
}

const opening = new Map<string, Promise<void>>();

const local: Local = {
  createDraft(workspaceId) {
    const app = useApp.getState();
    const ws = app.workspaces.find((w) => w.id === workspaceId) ?? app.workspaces[0];
    const unsent = app.sessions.find((s) => s.workspaceId === ws.id && s.draft);
    useApp.setState({ currentWorkspaceId: ws.id });
    if (unsent) return unsent.id;
    const id = crypto.randomUUID();
    const prof = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
    const now = Date.now();
    app.upsertSession({ id, workspaceId: ws.id, title: '新会话', firstPrompt: '', branch: ws.branch, createdAt: now, lastActive: now, tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0, draft: true });
    useSessions.getState().init(emptyRuntime(id, { model: prof.model, effort: prof.effort, mode: prof.mode }));
    void call('createDraft', [ws.id, id]);
    return id;
  },
  openSession(sid) {
    if (useSessions.getState().runtimes[sid]) return Promise.resolve();
    const cur = opening.get(sid);
    if (cur) return cur;
    const p = call<ReturnType<typeof emptyRuntime> | null>('openSession', [sid]).then((rt) => {
      if (rt) useSessions.getState().init(rt);
    }).finally(() => opening.delete(sid));
    opening.set(sid, p);
    return p;
  },
  latestSession(workspaceId) {
    const list = useApp.getState().sessions.filter((s) => s.workspaceId === workspaceId && !s.jobId);
    const newest = (xs: typeof list) => (xs.length ? xs.reduce((a, b) => (b.lastActive > a.lastActive ? b : a)).id : null);
    return newest(list.filter((s) => s.live && !s.draft)) ?? newest(list.filter((s) => s.draft)) ?? newest(list);
  },
  runningWork(sid) {
    const r = useSessions.getState().runtimes[sid];
    if (!r) return { turn: false, request: false, background: [], queued: 0 };
    return {
      turn: r.state !== 'idle' && !r.request,
      request: !!r.request,
      background: r.background.filter((b) => b.status === 'running').map((b) => b.name),
      queued: r.queue.length,
    };
  },
};

export const api = new Proxy(local as Local & Remote, {
  get(target, name: string) {
    if (name in target) return (target as unknown as Record<string, unknown>)[name];
    return (...args: unknown[]) => call(name, args);
  },
});
