// A server restart: what is kept, how running sessions come back (FR-SES-14, NFR-02).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type Env } from '../harness/env';
import { say, shell, sleepCmd } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => { env = await setup(); });
after(() => env?.close());

test('settings, the board and jobs are kept (NFR-10)', async () => {
  await env.c.call('setState', {
    maxRunning: 5,
    prefs: { ...env.c.slices.prefs, numberStyle: 'cn' },
    env: [{ id: 'e1', key: 'MY_VAR', value: '1', note: '测试' }],
    jobs: [{ id: 'job-1', name: '每日摘要', workspaceId: env.ws, prompt: '总结', schema: '{"type":"object"}', model: env.c.slices.models[0].id, effort: 'low', mode: 'dontAsk', schedule: { kind: 'manual', time: '09:00', weekdays: [1], everyHours: 6, cron: '', enabled: false, vars: {}, missed: 'skip' }, notify: 'never' }],
  });
  const item = await env.c.call('createItem', env.ws, { kind: 'issue', title: '重启后还在吗' }, { kind: 'manual' });
  await env.restart();
  const s = env.c.slices;
  assert.equal(s.maxRunning, 5);
  assert.equal(s.prefs.numberStyle, 'cn');
  assert.deepEqual(s.env.map((e) => e.key), ['MY_VAR']);
  assert.deepEqual(s.jobs.map((j) => j.name), ['每日摘要']);
  assert.ok(s.board.some((b) => b.id === item.id && b.title === '重启后还在吗'));
});

test('a session running at the restart comes back saved; its open card is marked; it resumes with its conversation', async () => {
  env.model.script(/重启前的命令/, [shell(sleepCmd(60)), [say('不该出现')]]);
  const sid = await env.start('重启前的命令', { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running'), 'command running');
  await env.c.call('send', sid, '排着的消息', { priority: 'later' });
  await env.restart();
  const s = await until(() => env.c.sessions.get(sid), 'summary after restart');
  assert.equal(s.live, false);
  assert.equal(s.state, 'idle');
  const rt = await env.rt(sid);
  const card = rt.items.find((i) => i.kind === 'tool') as Extract<Item, { kind: 'tool' }>;
  assert.notEqual(card.status, 'running');
  assert.deepEqual(rt.queue.map((q) => q.text), ['排着的消息'], 'the queue is kept');

  env.model.script(/排着的消息/, [[say('重启后处理了排着的消息')]]);
  assert.equal(await env.c.call('resume', sid), true);
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'text' && i.text === '重启后处理了排着的消息'), 'the queued message went out after resuming');
  assert.match(JSON.stringify(env.model.sent(/排着的消息/)[0].body.messages), /重启前的命令/);
});

test('a hard kill right after a change leaves a database that opens', async () => {
  await env.c.call('createItem', env.ws, { kind: 'note', title: '马上被杀' }, { kind: 'manual' });
  env.server.kill();
  await env.server.start();
  env.c = await env.client();
  assert.ok(Array.isArray(env.c.slices.board));
});
