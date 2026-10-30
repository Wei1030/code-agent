// Jobs: runs by hand with variables, valid and invalid output, notifications, runs missed while the
// server was down, a run cut by a restart, the run's session (FR-JOB-01..03, issues 10-30#9, 10-30#14).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { setup, M1, type Env } from '../harness/env';
import { say, use, shell, sleepCmd } from '../harness/fake-model';
import { until } from '../harness/client';
import type { JobRun, JobTemplate } from '@code-agent/shared/types';

let env: Env;
/** The job's answer, by prompt. */
let answer: (prompt: string) => unknown = () => ({ summary: '本周 3 个提交', risk: 'low' });
before(async () => {
  env = await setup();
  // Jobs whose prompt is scripted (they do work first) are left to their script.
  env.model.structured((schema, req) => (schema?.properties?.risk && !/慢作业/.test(req.prompt) ? { output: answer(req.prompt) } : undefined));
});
after(() => env?.close());

const SCHEMA = JSON.stringify({ type: 'object', required: ['summary', 'risk'], properties: { summary: { type: 'string' }, risk: { type: 'string', enum: ['low', 'medium', 'high'] } } });
function job(id: string, p: Partial<JobTemplate> = {}): JobTemplate {
  return {
    id, name: `作业 ${id}`, workspaceId: env.ws, prompt: '总结 {{since}} 以来的提交，日期 {{date}}', schema: SCHEMA, model: M1, effort: 'low', mode: 'dontAsk',
    schedule: { kind: 'manual', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: { since: '上周一' }, missed: 'runOnce' }, notify: 'never', ...p,
  };
}
const run = (id: string) => env.c.slices.jobRuns.find((r) => r.id === id) as JobRun;
const done = (id: string) => until(() => (['success', 'invalid', 'error'].includes(run(id)?.status) ? run(id) : null), 'run finished', 90_000);

test('a run by hand: variables filled, output checked against the schema, its session kept apart (FR-JOB-01, FR-JOB-02, FR-JOB-03)', async () => {
  await env.c.call('setState', { jobs: [job('j1', { notify: 'always' })] });
  const id = await env.c.call('runJob', 'j1', { since: '上周三' }, 'manual');
  const r = await done(id);
  assert.equal(r.status, 'success');
  assert.deepEqual(r.output, { summary: '本周 3 个提交', risk: 'low' });
  const prompt = env.model.requests.find((q) => /总结 上周三 以来的提交/.test(q.prompt))?.prompt ?? '';
  assert.match(prompt, /日期 \d{4}-\d{2}-\d{2}/, '{{date}} filled');
  const s = env.c.sessions.get(r.sessionId!)!;
  assert.equal(s.tag, '作业');
  assert.ok(s.jobId);
  await until(() => !env.c.sessions.get(r.sessionId!)?.live, 'its process ends');
  assert.ok(env.c.notices.some((n) => /作业「作业 j1」已完成/.test(n.title)));
  assert.equal(await env.c.call('resume', r.sessionId!), true, 'the run\'s session can be opened and continued');
});

test('output that never fits the schema ends as invalid (FR-JOB-02)', async () => {
  answer = () => ({ summary: 42 });
  try {
    await env.c.call('setState', { jobs: [job('j2')] });
    const r = await done(await env.c.call('runJob', 'j2', { since: 'x' }, 'manual'));
    assert.equal(r.status, 'invalid', r.error);
  } finally {
    answer = () => ({ summary: '好', risk: 'low' });
  }
});

test('a job naming a model that is not offered runs on one that is (issue 10-30#14)', async () => {
  await env.c.call('setState', { jobs: [job('j3', { model: 'haiku' })] });
  const r = await done(await env.c.call('runJob', 'j3', { since: 'x' }, 'manual'));
  assert.equal(r.status, 'success', r.error);
});

test('runs missed while the server was down: caught up once, or counted for the user', async () => {
  await env.c.call('setState', { jobs: [
    job('hourly-once', { schedule: { ...job('x').schedule, kind: 'hourly', everyHours: 1, missed: 'runOnce' } }),
    job('hourly-skip', { schedule: { ...job('x').schedule, kind: 'hourly', everyHours: 1, missed: 'skip' } }),
  ] });
  await new Promise((r) => setTimeout(r, 1500));
  env.server.kill();
  const db = new DatabaseSync(path.join(env.world.data, 'code-agent.db'));
  const row = db.prepare("select value from kv where key = 'jobs-meta'").get() as { value: string };
  const meta = JSON.parse(row.value);
  db.prepare("update kv set value = ? where key = 'jobs-meta'").run(JSON.stringify({ ...meta, lastAlive: Date.now() - 3 * 3600_000 }));
  db.close();
  await env.server.start();
  env.c = await env.client();
  await until(() => env.c.slices.jobRuns.some((r) => r.jobId === 'hourly-once' && r.trigger === 'schedule'), 'caught up once');
  assert.equal(env.c.slices.jobRuns.filter((r) => r.jobId === 'hourly-once').length, 1);
  const skipped = await until(() => env.c.slices.jobs.find((j) => j.id === 'hourly-skip' && (j.missedRuns ?? 0) >= 2), 'missed runs counted');
  assert.ok((skipped.missedRuns ?? 0) >= 2);
  const id = await env.c.call('catchUpJob', 'hourly-skip');
  await done(id);
  assert.equal(env.c.slices.jobs.find((j) => j.id === 'hourly-skip')?.missedRuns, 0);
});

test('a run cut by a server restart is marked, not left running (issue 10-30#9)', async () => {
  env.model.script(/慢作业/, [shell(sleepCmd(60)), [say('完')]]);
  await env.c.call('setState', { jobs: [job('slow', { prompt: '慢作业', mode: 'bypassPermissions' })] });
  const id = await env.c.call('runJob', 'slow', {}, 'manual');
  await until(() => run(id)?.status === 'running', 'running');
  await env.restart();
  const r = await until(() => env.c.slices.jobRuns.find((x) => x.id === id && x.status !== 'running' && x.status !== 'queued'), 'not stuck');
  assert.equal(r.status, 'error');
  assert.match(r.error ?? '', /服务重启/);
});

test('deleting a job deletes its runs', async () => {
  await env.c.call('setState', { jobs: [] });
  await until(() => env.c.slices.jobRuns.length === 0, 'runs gone');
  void use;
});
