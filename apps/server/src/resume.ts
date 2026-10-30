/**
 * Sessions that carry on by themselves at a set time: a wake-up Claude scheduled (ScheduleWakeup),
 * and a turn the usage limit refused, continued a minute after the limit resets. The plan is kept
 * with the session (summary.resume), so it outlives the process and the server. While the process
 * that scheduled a wake-up runs, Claude Code fires it itself; once that process is gone (saved to
 * make room, restarted for new settings, ended, the server restarted) Code Agent resumes the session
 * at that time and sends the wake-up's message. A limit's continuation is always Code Agent's.
 */
import { randomUUID } from 'node:crypto';
import type { Resume } from '@code-agent/shared/types';
import { afterLimit } from '@code-agent/shared/schedule';
import { app } from './state';
import { register } from './hub';
import { resolveModel } from './models';
import { addItem, allSummaries, patchSummary, rt, summary } from './sessions/registry';
import { closeProcess, decorateTool, inTurn, live, onLimitRefusal, onProcessEnd, onSelfTurn, onSendTurn, onToolResult, onTurnEnd, sendTurn, startProcess, type Outgoing } from './sessions/live';
import { enqueue, pumpQueue } from './sessions/ops';
import { acquire } from './sessions/slots';

/** Continuations after the limit refused a session, in a row, before Code Agent stops trying. */
const MAX_TRIES = 3;
const WAKE_LABEL = '按预约继续';
const LIMIT_LABEL = '限额已重置，自动继续';

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Limit continuations sent per session since a turn last got through. */
const tries = new Map<string, number>();
/** Sessions whose current turn the limit refused: its end does not reset the count. */
const refused = new Set<string>();
/** Sessions whose wake-up the user cancelled by ending the process that holds it. */
const cancelling = new Set<string>();

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** /loop schedules with a placeholder Claude Code expands itself (`<<autonomous-loop-dynamic>>`). */
// i18n-ignore: the prompt Claude reads.
const wakeText = (prompt?: string) => (!prompt ? '按之前的预约继续。' : /^<<[\w-]+>>$/.test(prompt) ? '继续 /loop 的下一轮。' : prompt);

function plan(sid: string, r: Resume | undefined) {
  patchSummary(sid, { resume: r });
  arm(sid);
}

function arm(sid: string, soonest = 0) {
  clearTimeout(timers.get(sid));
  timers.delete(sid);
  const r = summary(sid)?.resume;
  if (!r) return;
  // Claude Code fires its own wake-up; one it has not fired long after its time is dropped.
  const at = r.by === 'cli' ? r.at + 10 * 60_000 : r.at;
  timers.set(sid, setTimeout(() => fire(sid), Math.min(Math.max(at - Date.now(), soonest), 2 ** 31 - 1)));
}

function fire(sid: string) {
  timers.delete(sid);
  const sum = summary(sid);
  const r = sum?.resume;
  if (!sum || !r) return;
  plan(sid, undefined);
  if (r.by === 'cli' && live(sid)) return;
  if (sum.worktreeGone) return;
  if (r.kind === 'limit') tries.set(sid, r.tries ?? 1);
  // i18n-ignore: the prompt Claude reads.
  const m: Outgoing = r.kind === 'wake'
    ? { text: wakeText(r.prompt), fromApp: WAKE_LABEL }
    : { text: '用量限额已经重置，接着做被限额打断的工作。', fromApp: LIMIT_LABEL };
  deliver(sid, m);
}

/** Send now to an idle session, after the turn or requests of a busy one; resume a saved one first. */
function deliver(sid: string, m: Outgoing) {
  if (!live(sid)) {
    enqueue(sid, m, 'next');
    void acquire(sid, () => startProcess(sid, { resume: true }), () => void pumpQueue(sid));
    return;
  }
  const r = rt(sid);
  if (inTurn(sid) || r?.request || r?.queue.length) enqueue(sid, m, 'next');
  else sendTurn(sid, m);
}

// ------------------------------------------------------------------ wake-ups

decorateTool((_sid, name, input, item) => {
  if (name === 'ScheduleWakeup') item.detail = str(input.reason) || str(input.prompt);
});

onToolResult((sid, name, input, text, isError) => {
  if (name !== 'ScheduleWakeup' || isError) return;
  if (input.stop) {
    if (summary(sid)?.resume?.kind === 'wake') plan(sid, undefined);
    return { right: '不再唤醒' };
  }
  // Claude Code rounds the time up to a minute and says how far off it is: "… (in 93s)". A later
  // call replaces the earlier one, as in Claude Code.
  const secs = Number(/\(in (\d+)s\)/.exec(text)?.[1] ?? input.delaySeconds ?? 0);
  if (!secs) return;
  plan(sid, { kind: 'wake', at: Date.now() + secs * 1000, reason: str(input.reason), prompt: str(input.prompt), by: 'cli' });
  return { right: '已预约' };
});

onSelfTurn((sid) => {
  const r = summary(sid)?.resume;
  if (r?.kind !== 'wake' || r.by !== 'cli' || Date.now() < r.at - 5000) return;
  plan(sid, undefined);
  return { text: wakeText(r.prompt), fromApp: WAKE_LABEL };
});

onProcessEnd((sid) => {
  const r = summary(sid)?.resume;
  if (cancelling.delete(sid)) {
    if (r?.kind === 'wake') plan(sid, undefined);
    return;
  }
  // The wake-up went with the process: Code Agent sends it at its time.
  if (r?.kind === 'wake' && r.by === 'cli') plan(sid, { ...r, by: 'server' });
});

// ------------------------------------------------------------------ the usage limit

onLimitRefusal((sid, rejection) => {
  const sum = summary(sid);
  if (!sum || sum.jobId) return;
  refused.add(sid);
  // Only the five-hour window resets soon enough to wait for; the weekly ones stay with the banner.
  if (rejection?.rateLimitType && rejection.rateLimitType !== 'five_hour') return;
  const n = tries.get(sid) ?? 0;
  if (n >= MAX_TRIES) {
    tries.delete(sid);
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `用量限额重置后自动继续了 ${MAX_TRIES} 次，仍然被拒绝，不再自动继续。` });
    return;
  }
  // The reset Claude Code named, else the five-hour window's as last seen (for Claude models).
  const onClaude = !resolveModel(rt(sid)?.model ?? '').endpoint;
  const reset = rejection?.resetsAt ? rejection.resetsAt * 1000 : onClaude ? app.usage.fiveHour?.resetsAt : null;
  plan(sid, { kind: 'limit', at: afterLimit(Date.now(), reset), by: 'server', tries: n + 1 });
});

onSendTurn((sid, m) => {
  if (m.fromApp === LIMIT_LABEL) return;
  tries.delete(sid);
  // The session moves on otherwise: the limit's continuation is not needed any more.
  if (summary(sid)?.resume?.kind === 'limit') plan(sid, undefined);
});

onTurnEnd((sid) => {
  // A turn the limit let through ends the run of refusals.
  if (!refused.delete(sid)) tries.delete(sid);
});

// ------------------------------------------------------------------ boot and the user's controls

/** After a server start: no process survived it, so Code Agent sends every planned continuation. */
export function startResumes() {
  for (const s of allSummaries()) {
    if (!s.resume) continue;
    if (s.resume.by === 'cli') patchSummary(s.id, { resume: { ...s.resume, by: 'server' } });
    // One whose time passed while the server was down goes once the server has settled.
    arm(s.id, 5000);
  }
}

async function cancelResume(sid: string) {
  const r = summary(sid)?.resume;
  if (!r) return;
  tries.delete(sid);
  // Claude Code keeps a wake-up until its process ends.
  if (r.kind === 'wake' && r.by === 'cli' && live(sid)) {
    if (inTurn(sid)) throw new Error('Claude 正在工作，这一轮结束后再取消预约');
    if (rt(sid)?.background.some((b) => b.status === 'running')) throw new Error('还有后台任务在运行：预约要等 Claude Code 进程结束才会取消，先停止后台任务');
    cancelling.add(sid);
    await closeProcess(sid);
  }
  plan(sid, undefined);
}

function resumeNow(sid: string) {
  const r = summary(sid)?.resume;
  if (!r || (r.by === 'cli' && live(sid))) return;
  plan(sid, { ...r, at: Date.now() });
}

register({ cancelResume, resumeNow });
