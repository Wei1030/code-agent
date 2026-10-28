/**
 * Jobs: reusable tasks whose answer must match a JSON Schema, run by hand or on a schedule. A run is
 * a one-message session (kept out of the session lists) with outputFormat set to the schema; it is
 * saved when the answer is in. The scheduler runs inside the Code Agent server; runs missed while
 * the server was down are caught up once or reported, as the job says.
 */
import { randomUUID } from 'node:crypto';
import type { JobRun, JobTemplate } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';
import { fillVars, nextRun } from '@code-agent/shared/schedule';
import { app, onWrite, set, update } from '../state';
import { broadcast, register } from '../hub';
import { load, save } from '../store';
import { initRuntime, summary, upsert } from '../sessions/registry';
import { closeProcess, onTurnEnd, sendTurn, startProcess } from '../sessions/live';
import { acquire } from '../sessions/slots';

/** Session id → run id of job runs in progress. */
const running = new Map<string, string>();
const meta = load<{ lastAlive?: number; nextAt?: Record<string, number> }>('jobs-meta', {});
const nextAt: Record<string, number> = meta.nextAt ?? {};

function persistMeta() {
  save('jobs-meta', () => ({ lastAlive: Date.now(), nextAt }));
}

function patchRun(id: string, p: Partial<JobRun>) {
  update('jobRuns', (rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
}

function runJob(jobId: string, vars: Record<string, string>, trigger: JobRun['trigger']): string {
  const job = app.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('作业不存在');
  const ws = app.workspaces.find((w) => w.id === job.workspaceId);
  if (!ws) throw new Error('作业的工作区不存在');
  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(job.schema) as Record<string, unknown>;
  } catch {
    throw new Error('作业的输出结构不是合法的 JSON');
  }
  const prompt = fillVars(job.prompt, vars);
  const sid = randomUUID();
  const runId = randomUUID();
  const now = Date.now();
  upsert({ id: sid, workspaceId: ws.id, title: `作业 · ${job.name}`, firstPrompt: prompt, branch: ws.branch, createdAt: now, lastActive: now, tag: '作业', live: false, state: 'idle', forkedFrom: null, tokens: 0, jobId });
  initRuntime(emptyRuntime(sid, { model: job.model, effort: job.effort, mode: job.mode }));
  set('jobRuns', [{ id: runId, jobId, trigger, startedAt: now, vars, status: 'queued' as const, turns: 0, tokens: 0, sessionId: sid }, ...app.jobRuns].slice(0, 500));
  running.set(sid, runId);
  void acquire(sid, async () => {
    await startProcess(sid, { resume: false, extra: { outputFormat: { type: 'json_schema', schema } } });
    patchRun(runId, { status: 'running', startedAt: Date.now() });
    sendTurn(sid, { text: prompt });
  }).catch((e: unknown) => finishRun(sid, { status: 'error', error: e instanceof Error ? e.message : String(e) }));
  return runId;
}

function finishRun(sid: string, p: Partial<JobRun>) {
  const runId = running.get(sid);
  if (!runId) return;
  running.delete(sid);
  const run = app.jobRuns.find((r) => r.id === runId);
  patchRun(runId, { endedAt: Date.now(), tokens: summary(sid)?.tokens ?? 0, ...p });
  // One message per run: the process ends and the session stays saved (it can be resumed).
  setTimeout(() => void closeProcess(sid), 0);
  const job = app.jobs.find((j) => j.id === run?.jobId);
  const ok = p.status === 'success';
  if (job && (job.notify === 'always' || (job.notify === 'failure' && !ok))) {
    broadcast({ t: 'notify', n: { kind: 'background', path: '/jobs', title: ok ? `作业「${job.name}」已完成` : `作业「${job.name}」失败`, body: ok ? undefined : p.error, tone: ok ? 'good' : 'warn', action: '查看' } });
  }
}

onTurnEnd((sid, info) => {
  if (!running.has(sid)) return;
  if (info.ok && info.structured !== undefined) finishRun(sid, { status: 'success', output: info.structured, turns: info.turns ?? 1 });
  else if (info.subtype === 'error_max_structured_output_retries') finishRun(sid, { status: 'invalid', error: '重试多次后仍没有符合结构的输出（error_max_structured_output_retries）', turns: info.turns ?? 0 });
  else finishRun(sid, { status: 'error', error: info.interrupted ? '运行被中断' : (info.errors?.join('；') || info.subtype || '运行失败'), turns: info.turns ?? 0 });
});

function catchUpJob(jobId: string): string {
  const job = app.jobs.find((j) => j.id === jobId);
  if (!job) throw new Error('作业不存在');
  update('jobs', (js) => js.map((j) => (j.id === jobId ? { ...j, missedRuns: 0 } : j)));
  return runJob(jobId, job.schedule.vars, 'schedule');
}

// ------------------------------------------------------------------ scheduler

function schedule(job: JobTemplate, from = new Date()) {
  const n = nextRun(job.schedule, from);
  if (n) nextAt[job.id] = n.getTime();
  else delete nextAt[job.id];
}

function countMissed(job: JobTemplate, since: number, until: number): number {
  let n = 0;
  let t = nextRun(job.schedule, new Date(since));
  while (t && t.getTime() <= until && n < 1000) {
    n += 1;
    t = nextRun(job.schedule, t);
  }
  return n;
}

function tick() {
  const now = Date.now();
  for (const job of app.jobs) {
    if (job.schedule.kind === 'manual' || !job.schedule.enabled) {
      delete nextAt[job.id];
      continue;
    }
    if (nextAt[job.id] === undefined) schedule(job);
    if (nextAt[job.id] !== undefined && nextAt[job.id] <= now) {
      schedule(job, new Date(now));
      try {
        runJob(job.id, job.schedule.vars, 'schedule');
      } catch (e) {
        console.error(`[jobs] ${job.name}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  persistMeta();
}

/** Runs missed while the server was not running: catch up once, or show them to the user. */
export function startScheduler() {
  const since = meta.lastAlive;
  const now = Date.now();
  if (since) {
    for (const job of app.jobs) {
      if (job.schedule.kind === 'manual' || !job.schedule.enabled) continue;
      const missed = countMissed(job, since, now);
      if (!missed) continue;
      if (job.schedule.missed === 'runOnce') {
        try {
          runJob(job.id, job.schedule.vars, 'schedule');
        } catch (e) {
          console.error(`[jobs] catch-up ${job.name}:`, e instanceof Error ? e.message : e);
        }
      } else {
        update('jobs', (js) => js.map((j) => (j.id === job.id ? { ...j, missedRuns: (j.missedRuns ?? 0) + missed } : j)));
      }
    }
  }
  for (const job of app.jobs) schedule(job, new Date(now));
  persistMeta();
  setInterval(tick, 20_000);
}

onWrite('jobs', (next) => {
  set('jobs', next);
  // Changed schedules count from now; deleted jobs take their runs with them.
  for (const job of next) schedule(job);
  for (const id of Object.keys(nextAt)) if (!next.some((j) => j.id === id)) delete nextAt[id];
  const runs = app.jobRuns.filter((r) => next.some((j) => j.id === r.jobId));
  if (runs.length !== app.jobRuns.length) set('jobRuns', runs);
  persistMeta();
});

register({
  runJob: (jobId, vars, trigger) => runJob(jobId, vars, trigger),
  catchUpJob,
});

