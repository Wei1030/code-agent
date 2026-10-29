/**
 * At most `maxRunning` Claude Code processes across all workspaces. Starting one more (a new,
 * resumed, forked or agent-created session, or a job run) saves the least recently active idle
 * session; when none is idle, the new one waits and starts as soon as a session becomes idle.
 */
import { randomUUID } from 'node:crypto';
import { app } from '../state';
import { broadcast } from '../hub';
import { addItem, allSummaries, emit, patchSummary, rt, summary } from './registry';
import { closeProcess, inTurn, live, liveIds, onProcessEnd, onTurnEnd, startProcess } from './live';

interface Waiter {
  sid: string;
  start: () => Promise<void>;
  then: Array<() => void>;
}

const waiting: Waiter[] = [];
const starting = new Set<string>();

/** Other reasons a session counts as busy (an unfinished code review…). */
const busyChecks: Array<(sid: string) => boolean> = [];
export function addBusyCheck(fn: (sid: string) => boolean) {
  busyChecks.push(fn);
}

/** Idle: no turn, no pending request, no queued message, no background task, nothing else in progress. */
export function isIdle(sid: string): boolean {
  const r = rt(sid);
  return !inTurn(sid) && !r?.request && !r?.queue.length && !r?.background.some((b) => b.status === 'running') && !busyChecks.some((f) => f(sid));
}

function toast(text: string, tone: 'info' | 'warn' = 'info') {
  broadcast({ t: 'toast', text, tone });
}

/** Save idle sessions until there is room for one more; false when every running session is busy. */
async function makeRoom(forSid: string): Promise<boolean> {
  for (;;) {
    const running = [...new Set([...liveIds(), ...starting])].filter((id) => id !== forSid);
    if (running.length < app.maxRunning) return true;
    const idle = running.filter((id) => isIdle(id) && !starting.has(id) && !summary(id)?.jobId)
      .sort((a, b) => (summary(a)?.lastActive ?? 0) - (summary(b)?.lastActive ?? 0))[0];
    if (!idle) return false;
    const title = summary(forSid)?.title ?? '';
    const idleTitle = summary(idle)?.title ?? '';
    await closeProcess(idle);
    addItem(idle, { kind: 'notice', id: randomUUID(), tone: 'info', text: `同时运行的会话达到上限（${app.maxRunning} 个），为「${title}」腾出位置，已自动保存。需要时可以恢复。` });
    toast(`已自动保存空闲的「${idleTitle}」，为「${title}」腾出位置`);
  }
}

async function run(sid: string, start: () => Promise<void>, then: Array<() => void>) {
  starting.add(sid);
  try {
    await start();
  } finally {
    starting.delete(sid);
  }
  for (const f of then) f();
}

/**
 * Start a session's process now if the limit allows, else queue it. `then` runs once it has started;
 * a session already waiting just collects more `then`s. Resolves true when it started now.
 */
export async function acquire(sid: string, start: () => Promise<void>, then?: () => void): Promise<boolean> {
  const queued = waiting.find((w) => w.sid === sid);
  if (queued) {
    if (then) queued.then.push(then);
    return false;
  }
  if (await makeRoom(sid)) {
    await run(sid, start, then ? [then] : []);
    return true;
  }
  waiting.push({ sid, start, then: then ? [then] : [] });
  patchSummary(sid, { waiting: true });
  toast(`「${summary(sid)?.title ?? ''}」排队等待空位：同时运行的会话已达上限（${app.maxRunning} 个），而且都在工作或等你处理`, 'warn');
  return false;
}

let pumping = false;
/** Start waiting sessions while there is room. */
export async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    while (waiting.length && (await makeRoom(waiting[0].sid))) {
      const w = waiting.shift()!;
      patchSummary(w.sid, { waiting: false });
      await run(w.sid, w.start, w.then).catch((e: unknown) => console.error('[slots] start failed:', e));
    }
  } finally {
    pumping = false;
  }
}

export function isWaiting(sid: string) {
  return waiting.some((w) => w.sid === sid);
}

/** The user stops waiting: the session stays saved and its queued messages are dropped. */
export function cancelWaiting(sid: string) {
  const i = waiting.findIndex((w) => w.sid === sid);
  if (i < 0) return;
  waiting.splice(i, 1);
  patchSummary(sid, { waiting: false });
  if (rt(sid)) {
    emit(sid, { t: 'queue', queue: [] });
    emit(sid, { t: 'settings', patch: { readOnly: true } });
  }
}

/**
 * Run fn once the running session is idle (above): a restart for new settings must not cut a
 * turn, a pending request, queued messages or background work short. A session saved meanwhile
 * gets the new settings when it is resumed, so fn is dropped.
 */
const whenIdleFns = new Map<string, () => void>();
let idleTimer: ReturnType<typeof setInterval> | null = null;
export function whenIdle(sid: string, fn: () => void) {
  if (isIdle(sid)) {
    fn();
    return;
  }
  whenIdleFns.set(sid, fn);
  idleTimer ??= setInterval(() => {
    for (const [id, f] of whenIdleFns) {
      if (!live(id)) whenIdleFns.delete(id);
      else if (isIdle(id)) {
        whenIdleFns.delete(id);
        f();
      }
    }
    if (!whenIdleFns.size && idleTimer) {
      clearInterval(idleTimer);
      idleTimer = null;
    }
  }, 2000);
}

/** Restart a running session once it is idle so it picks up new settings, and carry on the conversation. */
export function restartWhenIdle(sid: string, why: string) {
  whenIdle(sid, () => void (async () => {
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: `${why}，Claude Code 按新设置重新启动后接着这段对话。` });
    await closeProcess(sid);
    await startProcess(sid, { resume: true });
  })().catch((e) => console.error('[slots] restart failed:', e)));
}

/** Sessions that may have become idle let waiting ones in. */
let scheduled = false;
export function schedulePump() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    void pump();
  }, 50);
}
onTurnEnd(() => schedulePump());
onProcessEnd(() => schedulePump());

/** Running sessions that are not in the summaries anymore are an error; keep the count honest. */
export function runningCount() {
  return allSummaries().filter((s) => s.live).length;
}
