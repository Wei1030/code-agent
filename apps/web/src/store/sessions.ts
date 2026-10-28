/** Live session state, built by applying the server's session events. */
import { create } from 'zustand';
import type { SessionEvent, SessionRuntime } from '../api/types';
import { reduce } from '@code-agent/shared/runtime';

export { emptyRuntime } from '@code-agent/shared/runtime';

interface SessionsState {
  runtimes: Record<string, SessionRuntime>;
  init: (rt: SessionRuntime) => void;
  apply: (id: string, ev: SessionEvent) => void;
  drop: (id: string) => void;
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
}));
