// Sessions that carry on by themselves: a wake-up Claude scheduled with ScheduleWakeup (fired by
// Claude Code while its process runs, by Code Agent once that process is gone, kept across a
// server restart, cancellable), and a turn the usage limit refused, continued after the reset.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, M1, type Env } from '../harness/env';
import { say, use, httpError } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => { env = await setup(); });
after(() => env?.close());

type User = Extract<Item, { kind: 'user' }>;
const sum = (sid: string) => env.c.sessions.get(sid)!;
const prompted = (text: string) => env.model.requests.some((r) => r.prompt === text);
/** The transcript from the wake-up's message on: what Code Agent showed for it, and what came next. */
async function woke(sid: string, prompt: string) {
  const items = (await env.rt(sid)).items;
  const at = items.findIndex((i) => i.kind === 'user' && i.fromApp === '按预约继续' && i.text === prompt);
  return at < 0 ? undefined : { said: items[at] as User, next: items.slice(at + 1) };
}
function wakeScript(tag: string, delaySeconds: number) {
  env.model.script(new RegExp(`^${tag}$`), [
    [use('ScheduleWakeup', { delaySeconds, reason: `${tag}的原因`, prompt: `${tag}醒来`, noop: false })],
    [say('先睡一会儿')],
  ]);
  env.model.script(new RegExp(`^${tag}醒来$`), [[say(`${tag}醒了`)]]);
}

test('a wake-up: Claude Code fires it while its process runs; once the process is gone Code Agent sends it at its time', { timeout: 300_000 }, async () => {
  wakeScript('进程里唤醒', 60);
  wakeScript('进程结束后唤醒', 60);
  const a = await env.start('进程里唤醒', { model: M1 });
  const b = await env.start('进程结束后唤醒', { model: M1 });
  await env.turns(a);
  await env.turns(b);

  const planned = sum(a).resume!;
  assert.equal(planned.kind, 'wake');
  assert.equal(planned.by, 'cli');
  assert.equal(planned.reason, '进程里唤醒的原因');
  assert.ok(planned.at > Date.now() && planned.at < Date.now() + 130_000, 'at the time Claude Code named');
  assert.equal(planned.at % 60_000, 0, 'on the minute, as Claude Code rounds it');
  const card = (await env.rt(a)).items.find((i) => i.kind === 'tool' && i.tool === 'ScheduleWakeup') as Extract<Item, { kind: 'tool' }>;
  assert.equal(card.detail, '进程里唤醒的原因');
  assert.equal(card.right, '已预约');

  await env.c.call('stop', b);
  await until(() => sum(b).live === false && sum(b).resume?.by === 'server', 'Code Agent holds the wake-up of the ended process');

  // At its time the plan goes; the process that holds the wake-up fires it.
  await until(() => !sum(a).resume, 'dropped at its time', 200_000);
  assert.equal(sum(a).live, true);
  await until(() => prompted('进程里唤醒醒来') && prompted('进程结束后唤醒醒来'), 'both woke up', 200_000);
  await until(async () => (await env.rt(a)).items.some((i) => i.kind === 'text' && i.text === '进程里唤醒醒了'), 'Claude Code fired it: the reply');
  assert.equal(await woke(a, '进程里唤醒醒来'), undefined, 'Code Agent did not send it as well');
  // Code Agent sent the one whose process had ended, and says so.
  const w = await until(async () => {
    const x = await woke(b, '进程结束后唤醒醒来');
    return x?.next.some((i) => i.kind === 'text' && i.text === '进程结束后唤醒醒了') ? x : undefined;
  }, 'the wake-up\'s message, then the reply');
  assert.ok(w.said);
  assert.equal(sum(b).resume, undefined);
  assert.equal(sum(b).live, true, 'the ended session was resumed for it');
});

test('a wake-up outlives a server restart; cancelling drops it, ending the process that holds it', async () => {
  wakeScript('重启后还在', 600);
  wakeScript('取消预约', 600);
  const a = await env.start('重启后还在', { model: M1 });
  const b = await env.start('取消预约', { model: M1 });
  await env.turns(a);
  await env.turns(b);
  const at = sum(a).resume!.at;

  await env.c.call('cancelResume', b);
  await until(() => !sum(b).resume && sum(b).live === false, 'cancelled, its process ended');

  await env.restart();
  const kept = await until(() => sum(a)?.resume, 'still planned after the restart');
  assert.equal(kept.by, 'server', 'Code Agent sends it now');
  assert.equal(kept.at, at);
  await env.c.call('cancelResume', a);
  await until(() => !sum(a).resume, 'cancelled');
});

test('a job run that schedules a wake-up is not woken: it ends with its answer (issue 10-31#4)', async () => {
  env.model.script(/^作业里预约$/, [[use('ScheduleWakeup', { delaySeconds: 60, reason: '作业里的预约', prompt: '作业醒来', noop: false })]]);
  const schema = JSON.stringify({ type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } });
  await env.c.call('setState', { jobs: [{
    id: 'wake-job', name: '预约的作业', workspaceId: env.ws, prompt: '作业里预约', schema, model: M1, effort: 'low', mode: 'dontAsk',
    schedule: { kind: 'manual', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: true, vars: {}, missed: 'runOnce' }, notify: 'never',
  }] });
  const id = await env.c.call('runJob', 'wake-job', {}, 'manual');
  const run = await until(() => env.c.slices.jobRuns.find((r) => r.id === id && ['success', 'invalid', 'error'].includes(r.status)), 'run finished');
  assert.equal(run.status, 'success');
  assert.ok(env.model.requests.some((r) => r.tools.includes('ScheduleWakeup') && /作业里预约/.test(r.prompt)), 'the run did schedule');
  assert.equal(sum(run.sessionId!).resume, undefined, 'nothing planned for the job run');
  await env.c.call('setState', { jobs: [] });
});

test('the usage limit: carried on after the reset, now on request, not when the user writes, at most three times in a row', async () => {
  env.model.failModel('model-one', httpError(429, 'rate_limit_error', 'Usage limit reached', { 'x-should-retry': 'false' }));
  env.model.script(/^限额会话$/, [[say('不会到这里')]]);
  const sid = await env.start('限额会话', { model: M1 });
  await env.turns(sid);
  const r1 = await until(() => sum(sid).resume, 'planned');
  assert.equal(r1.kind, 'limit');
  assert.equal(r1.tries, 1);
  // A third-party endpoint names no reset: in half an hour.
  assert.ok(Math.abs(r1.at - (Date.now() + 31 * 60_000)) < 60_000, 'in half an hour');
  assert.ok((await env.rt(sid)).items.some((i) => i.kind === 'banner' && i.banner === 'rateLimit'));

  // Carried on now, refused again: twice more, then it stops trying.
  for (const n of [2, 3]) {
    await env.c.call('resumeNow', sid);
    await until(() => sum(sid).resume?.tries === n, `continuation ${n - 1} refused, number ${n} planned`);
  }
  await env.c.call('resumeNow', sid);
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'notice' && /自动继续了 3 次/.test(i.text)), 'it stops trying');
  assert.equal(sum(sid).resume, undefined);
  const shown = (await env.rt(sid)).items.filter((i): i is User => i.kind === 'user' && i.fromApp === '限额已重置，自动继续');
  assert.equal(shown.length, 3, 'each continuation shown');

  // The user writing again: refused, planned anew (the count starts over); a message that gets through drops it.
  env.model.script(/^再试一次$/, [[say('还是不会到这里')]]);
  await env.c.call('send', sid, '再试一次', {});
  await until(() => sum(sid).resume?.tries === 1, 'planned anew');
  env.model.failModel('model-one', null);
  env.model.script(/^限额过了$/, [[say('现在可以了')]]);
  await env.c.call('send', sid, '限额过了', {});
  await until(() => !sum(sid).resume, 'the user took it on');

  // Refused once more, carried on when the limit has gone.
  env.model.failModel('model-one', httpError(429, 'rate_limit_error', 'Usage limit reached', { 'x-should-retry': 'false' }));
  env.model.script(/^又被限额$/, [[say('不会到这里')]]);
  await env.c.call('send', sid, '又被限额', {});
  await until(() => sum(sid).resume?.kind === 'limit', 'planned');
  env.model.failModel('model-one', null);
  env.model.script(/用量限额已经重置/, [[say('接着做完了')]]);
  await env.c.call('resumeNow', sid);
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'text' && i.text === '接着做完了'), 'carried on');
  assert.equal(sum(sid).resume, undefined);
});
