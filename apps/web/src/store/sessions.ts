/** Live session state, built by applying the server's session events. */
import { create } from 'zustand';
import type { EarlierItems, Item, SessionEvent, SessionRuntime } from '../api/types';
import { reduce } from '@code-agent/shared/runtime';

export { emptyRuntime } from '@code-agent/shared/runtime';

interface SessionsState {
  runtimes: Record<string, SessionRuntime>;
  init: (rt: SessionRuntime) => void;
  apply: (id: string, ev: SessionEvent) => void;
  drop: (id: string) => void;
  /** Put an earlier page of the transcript in front of what is loaded. */
  prepend: (id: string, items: Item[], earlier?: EarlierItems) => void;
}

let eventSeq = 0;

export const useSessions = create<SessionsState>((set, get) => ({
  runtimes: {},
  init: (rt) => {
    eventSeq = Math.max(eventSeq, ...rt.events.map((e) => e.seq));
    set({ runtimes: { ...get().runtimes, [rt.id]: rt } });
  },
  apply: (id, ev) => {
    const rt = get().runtimes[id];
    if (!rt) return;
    if (ev.t === 'raw') eventSeq += 1;
    set({ runtimes: { ...get().runtimes, [id]: reduce(rt, ev, eventSeq) } });
  },
  drop: (id) => {
    const r = { ...get().runtimes };
    delete r[id];
    set({ runtimes: r });
  },
  prepend: (id, items, earlier) => {
    const rt = get().runtimes[id];
    if (!rt) return;
    const have = new Set(rt.items.map((x) => x.id));
    set({ runtimes: { ...get().runtimes, [id]: { ...rt, items: [...items.filter((x) => !have.has(x.id)), ...rt.items], earlier } } });
  },
}));

/** Every prompt of a session, the ones not loaded yet too: for numbering, checkpoints and rewinding. */
export function promptsOf(rt: SessionRuntime): Array<{ id: string; text: string; ts: number }> {
  return [...(rt.earlier?.users ?? []), ...rt.items.flatMap((x) => (x.kind === 'user' ? [{ id: x.id, text: x.text, ts: x.ts }] : []))];
}
