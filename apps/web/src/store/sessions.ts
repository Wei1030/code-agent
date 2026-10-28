/** Live session state, built by applying backend events. */
import { create } from 'zustand';
import type { Item, SessionEvent, SessionRuntime } from '../api/types';
import { baseContext } from '../mock/data';

interface SessionsState {
  runtimes: Record<string, SessionRuntime>;
  init: (rt: SessionRuntime) => void;
  apply: (id: string, ev: SessionEvent) => void;
  drop: (id: string) => void;
}

export function emptyRuntime(id: string, p: Partial<SessionRuntime> = {}): SessionRuntime {
  return {
    id, items: [], state: 'idle', model: 'opus', effort: 'max', mode: 'default', request: null, queue: [],
    tasks: [], background: [], changes: [], context: baseContext('claude-opus-5-5', 1200), events: [], stderr: [],
    status: null, readOnly: false, turn: 0, tokens: 0, ...p,
  };
}

let eventSeq = 0;

function patchItem(items: Item[], id: string, fn: (it: Item) => Item): Item[] {
  return items.map((it) => {
    if (it.id === id) return fn(it);
    if (it.kind === 'toolgroup' && it.tools.some((x) => x.id === id)) {
      return { ...it, tools: it.tools.map((x) => (x.id === id ? (fn(x) as typeof x) : x)) };
    }
    return it;
  });
}

function reduce(rt: SessionRuntime, ev: SessionEvent): SessionRuntime {
  switch (ev.t) {
    case 'item.add': {
      if (!ev.after) return { ...rt, items: [...rt.items, ev.item] };
      const i = rt.items.findIndex((x) => x.id === ev.after);
      const items = [...rt.items];
      items.splice(i < 0 ? items.length : i + 1, 0, ev.item);
      return { ...rt, items };
    }
    case 'item.patch':
      return { ...rt, items: patchItem(rt.items, ev.id, (it) => ({ ...it, ...ev.patch } as Item)) };
    case 'item.append':
      return {
        ...rt,
        items: patchItem(rt.items, ev.id, (it) => ('text' in it ? ({ ...it, text: it.text + ev.text } as Item) : it)),
      };
    case 'item.remove':
      return { ...rt, items: rt.items.filter((x) => x.id !== ev.id) };
    case 'items.reset':
      return { ...rt, items: ev.items };
    case 'state':
      return { ...rt, state: ev.state };
    case 'request':
      return { ...rt, request: ev.request };
    case 'queue':
      return { ...rt, queue: ev.queue };
    case 'tasks':
      return { ...rt, tasks: ev.tasks };
    case 'background':
      return { ...rt, background: ev.background };
    case 'changes':
      return { ...rt, changes: ev.changes };
    case 'context':
      return { ...rt, context: ev.context };
    case 'raw': {
      eventSeq += 1;
      const events = [...rt.events, { seq: eventSeq, ts: Date.now(), type: ev.type, summary: ev.summary, json: ev.json }];
      return { ...rt, events: events.length > 5000 ? events.slice(-5000) : events };
    }
    case 'stderr':
      return { ...rt, stderr: [...rt.stderr, ev.line] };
    case 'status':
      return { ...rt, status: ev.status };
    case 'settings':
      return { ...rt, ...ev.patch };
    default:
      return rt;
  }
}

export const useSessions = create<SessionsState>((set, get) => ({
  runtimes: {},
  init: (rt) => set({ runtimes: { ...get().runtimes, [rt.id]: rt } }),
  apply: (id, ev) => {
    const rt = get().runtimes[id];
    if (!rt) return;
    set({ runtimes: { ...get().runtimes, [id]: reduce(rt, ev) } });
  },
  drop: (id) => {
    const r = { ...get().runtimes };
    delete r[id];
    set({ runtimes: r });
  },
}));
