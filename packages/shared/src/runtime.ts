/** Session runtime state and how session events change it; the server and the UI apply the same events. */
import type { ContextUsage, Item, SessionEvent, SessionRuntime } from './types';

export function emptyContext(model = ''): ContextUsage {
  return { model, max: 0, categories: [], deferred: { tools: 0, tokens: 0 }, memoryFiles: [], mcp: [], precise: false };
}

export function emptyRuntime(id: string, p: Partial<SessionRuntime> = {}): SessionRuntime {
  return {
    id, items: [], state: 'idle', model: 'opus', effort: 'xhigh', mode: 'default', request: null, queue: [],
    tasks: [], background: [], changes: [], context: emptyContext(), events: [], stderr: [],
    status: null, readOnly: false, turn: 0, tokens: 0, ...p,
  };
}

function patchItem(items: Item[], id: string, fn: (it: Item) => Item): Item[] {
  return items.map((it) => {
    if (it.id === id) return fn(it);
    if (it.kind === 'toolgroup' && it.tools.some((x) => x.id === id)) {
      return { ...it, tools: it.tools.map((x) => (x.id === id ? (fn(x) as typeof x) : x)) };
    }
    return it;
  });
}

/** Keep this many raw events and stderr lines per session. */
export const RAW_KEEP = 2000;

export function reduce(rt: SessionRuntime, ev: SessionEvent, seq = 0): SessionRuntime {
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
      return { ...rt, items: ev.items, earlier: undefined };
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
      const events = [...rt.events, { seq, ts: Date.now(), type: ev.type, summary: ev.summary, json: ev.json }];
      return { ...rt, events: events.length > RAW_KEEP ? events.slice(-RAW_KEEP) : events };
    }
    case 'stderr': {
      const stderr = [...rt.stderr, ev.line];
      return { ...rt, stderr: stderr.length > RAW_KEEP ? stderr.slice(-RAW_KEEP) : stderr };
    }
    case 'status':
      return { ...rt, status: ev.status };
    case 'settings':
      return { ...rt, ...ev.patch };
    default:
      return rt;
  }
}
