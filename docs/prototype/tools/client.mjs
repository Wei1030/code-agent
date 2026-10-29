// A small RPC client for the Code Agent server (the same WebSocket protocol the web app uses).
import WebSocket from 'ws';

export async function connect(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, { origin: `http://127.0.0.1:${port}` });
  let id = 0;
  const waiting = new Map();
  const listeners = [];
  const state = { slices: {}, sessions: new Map(), footers: new Map(), items: new Map() };
  await new Promise((resolve, reject) => {
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.t === 'hello') {
        state.slices = { ...m.slices };
        for (const s of m.sessions) state.sessions.set(s.id, s);
        resolve();
      }
      if (m.t === 'ret') {
        const w = waiting.get(m.id);
        waiting.delete(m.id);
        if (m.error) w?.rej(new Error(m.error));
        else w?.res(m.result);
      }
      if (m.t === 'app') Object.assign(state.slices, m.patch);
      if (m.t === 'session.upsert') state.sessions.set(m.s.id, m.s);
      if (m.t === 'ev' && m.ev.t === 'item.add') {
        if (m.ev.item.kind === 'footer') state.footers.set(m.sid, (state.footers.get(m.sid) ?? 0) + 1);
        state.items.set(m.sid, [...(state.items.get(m.sid) ?? []), m.ev.item]);
      }
      for (const l of listeners) l(m);
    });
  });
  const call = (method, ...args) => new Promise((res, rej) => {
    id += 1;
    waiting.set(id, { res, rej });
    ws.send(JSON.stringify({ t: 'call', id, method, args }));
  });
  const wait = async (fn, ms = 120_000, what = 'condition') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await fn();
      if (v) return v;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`timed out waiting for ${what}`);
  };
  return { call, wait, state, on: (fn) => listeners.push(fn), close: () => ws.close() };
}
