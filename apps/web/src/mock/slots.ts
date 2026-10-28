/**
 * At most `maxRunning` Claude Code processes across all workspaces. Starting one more (a new,
 * resumed, forked or agent-created session, or a job run) saves the least recently active idle
 * session; when none is idle, the new one waits and starts as soon as a session becomes idle.
 */
import { useApp } from '../store/app';
import { uid } from '../lib/util';
import { addItem, emit, isRunning, onIdle, rt } from './engine';
import { stop } from './server';

interface Waiter {
  sid: string;
  start: () => void;
  then: Array<() => void>;
}

const waiting: Waiter[] = [];

/** Idle: no turn, no pending request, no queued message and no background task still running. */
function isIdle(sid: string): boolean {
  const r = rt(sid);
  return !isRunning(sid) && !r?.request && !r?.queue.length && !r?.background.some((b) => b.status === 'running');
}

/** Save idle sessions until there is room for one more; false when every running session is busy. */
function makeRoom(forSid: string): boolean {
  for (;;) {
    const app = useApp.getState();
    const live = app.sessions.filter((s) => s.live && !s.draft && s.id !== forSid);
    if (live.length < app.maxRunning) return true;
    const idle = live.filter((s) => isIdle(s.id)).sort((a, b) => a.lastActive - b.lastActive)[0];
    if (!idle) return false;
    const title = app.sessions.find((s) => s.id === forSid)?.title ?? '';
    stop(idle.id);
    addItem(idle.id, { kind: 'notice', id: uid('note'), tone: 'info', text: `同时运行的会话达到上限（${app.maxRunning} 个），为「${title}」腾出位置，已自动保存。需要时可以恢复。` });
    app.toast(`已自动保存空闲的「${idle.title}」，为「${title}」腾出位置`, 'info');
  }
}

/**
 * Start a session's process now if the limit allows, else queue it. `then` runs once it has started
 * (right away when it starts now); a session already waiting just collects more `then`s.
 */
export function acquire(sid: string, start: () => void, then?: () => void): boolean {
  const queued = waiting.find((w) => w.sid === sid);
  if (queued) {
    if (then) queued.then.push(then);
    return false;
  }
  if (makeRoom(sid)) {
    start();
    then?.();
    return true;
  }
  waiting.push({ sid, start, then: then ? [then] : [] });
  const app = useApp.getState();
  app.patchSession(sid, { waiting: true });
  const title = app.sessions.find((s) => s.id === sid)?.title ?? '';
  app.toast(`「${title}」排队等待空位：同时运行的会话已达上限（${app.maxRunning} 个），而且都在工作或等你处理`, 'warn');
  return false;
}

/** Start waiting sessions while there is room. */
export function pump() {
  while (waiting.length && makeRoom(waiting[0].sid)) {
    const w = waiting.shift()!;
    useApp.getState().patchSession(w.sid, { waiting: false });
    w.start();
    w.then.forEach((f) => f());
  }
}

/** The user stops waiting: the session stays saved and its queued messages are dropped. */
export function cancelWaiting(sid: string) {
  const i = waiting.findIndex((w) => w.sid === sid);
  if (i < 0) return;
  waiting.splice(i, 1);
  useApp.getState().patchSession(sid, { waiting: false });
  if (rt(sid)) {
    emit(sid, { t: 'queue', queue: [] });
    emit(sid, { t: 'settings', patch: { readOnly: true } });
  }
}

let scheduled = false;
onIdle(() => {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => { scheduled = false; pump(); }, 0);
});
