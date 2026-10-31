/** Live session state, built by applying the server's session events. */
import { create } from 'zustand';
import type { EarlierItems, Item, SessionEvent, SessionRuntime } from '../api/types';
import { reduce } from '@code-agent/shared/runtime';

export { emptyRuntime } from '@code-agent/shared/runtime';

interface SessionsState {
  runtimes: Record<string, SessionRuntime>;
  init: (rt: SessionRuntime) => void;
  /** Apply session events in order, all in one store update. */
  applyAll: (batch: Array<{ sid: string; ev: SessionEvent }>) => void;
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
  applyAll: (batch) => {
    const runtimes = { ...get().runtimes };
    let changed = false;
    for (const { sid, ev } of batch) {
      const rt = runtimes[sid];
      if (!rt) continue;
      if (ev.t === 'raw') eventSeq += 1;
      runtimes[sid] = reduce(rt, ev, eventSeq);
      changed = true;
    }
    if (changed) set({ runtimes });
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

/**
 * For `memo`: the same props and the same runtime apart from its transcript items, which the component
 * does not show. Every other part of a runtime keeps its object until it changes.
 */
export function sameApartFromItems<P extends { rt: SessionRuntime }>(a: P, b: P): boolean {
  for (const k of Object.keys(b) as Array<keyof P>) if (k !== 'rt' && a[k] !== b[k]) return false;
  if (a.rt === b.rt) return true;
  const keys = Object.keys(b.rt) as Array<keyof SessionRuntime>;
  return keys.length === Object.keys(a.rt).length && keys.every((k) => k === 'items' || a.rt[k] === b.rt[k]);
}

/** Every prompt of a session, the ones not loaded yet too: for numbering, checkpoints and rewinding. */
export function promptsOf(rt: SessionRuntime): Array<{ id: string; text: string; ts: number }> {
  return [...(rt.earlier?.users ?? []), ...rt.items.flatMap((x) => (x.kind === 'user' ? [{ id: x.id, text: x.text, ts: x.ts }] : []))];
}
