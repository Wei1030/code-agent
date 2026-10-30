// The running-session limit: idle sessions are saved to make room, otherwise a new one waits
// (NFR-03, issues 10-30#6 and 10-30#7).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, type Env } from '../harness/env';
import { say, shell, sleepCmd } from '../harness/fake-model';
import { until, sleep } from '../harness/client';

let env: Env;
before(async () => { env = await setup({ maxRunning: 2 }); });
after(() => env?.close());

const live = () => [...env.c.sessions.values()].filter((s) => s.live).length;
async function settle() {
  // Leave the previous test's sessions saved.
  for (const s of env.c.sessions.values()) if (s.live || s.waiting) await env.c.call('stop', s.id);
  await until(() => live() === 0, 'no session running');
}
/** A session busy running a command for a while. */
async function busy(tag: string, seconds: number) {
  env.model.script(new RegExp(tag), [shell(sleepCmd(seconds)), [say(`${tag} 完成`)]]);
  const sid = await env.start(tag, { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running'), `${tag} running`);
  return sid;
}
async function idle(tag: string) {
  env.model.script(new RegExp(tag), [[say('好')]]);
  const sid = await env.start(tag);
  await env.turns(sid);
  return sid;
}

test('at the limit, the least recently active idle session is saved to make room', async () => {
  await settle();
  const a = await idle('空闲甲');
  const b = await idle('空闲乙');
  await idle('第三个');
  await until(() => env.c.sessions.get(a)?.live === false, 'the oldest idle one saved');
  assert.equal(env.c.sessions.get(b)?.live, true);
  assert.ok(live() <= 2);
  assert.ok((await env.rt(a)).items.some((i) => i.kind === 'notice' && /达到上限/.test(i.text)), 'a note in the saved session');
  assert.ok(env.c.toasts.some((t) => /自动保存/.test(t.text)));
});

test('with no idle session a new one waits, then starts and sends its message; or the user stops waiting', async () => {
  await settle();
  await busy('忙碌甲', 6);
  await busy('忙碌乙', 30);
  env.model.script(/排队的会话/, [[say('轮到我了')]]);
  const c = await env.start('排队的会话');
  await until(() => env.c.sessions.get(c)?.waiting, 'waiting');
  assert.ok(env.c.toasts.some((t) => /排队等待空位/.test(t.text)));
  assert.equal(live(), 2);
  await env.turns(c, 1, 60_000);
  assert.ok((await env.rt(c)).items.some((i) => i.kind === 'text' && i.text === '轮到我了'));
  assert.ok(live() <= 2);

  await busy('忙碌丙', 30);
  const d = await env.start('不等了的会话');
  await until(() => env.c.sessions.get(d)?.waiting, 'waiting');
  await env.c.call('cancelWaiting', d);
  await until(() => !env.c.sessions.get(d)?.waiting, 'not waiting');
  assert.equal((await env.rt(d)).queue.length, 0);
});

test('raising the limit starts a waiting session at once', async () => {
  await settle();
  await busy('上限甲', 30);
  await busy('上限乙', 30);
  env.model.script(/上限丙/, [[say('开始了')]]);
  const c = await env.start('上限丙');
  await until(() => env.c.sessions.get(c)?.waiting, 'waiting');
  await env.c.call('setState', { maxRunning: 3 });
  await env.c.call('pumpSlots');
  await env.turns(c, 1, 30_000);
  await env.c.call('setState', { maxRunning: 2 });
});

test('a message sent while a resumed session waits for a slot goes out when it starts (issue 10-30#6)', async () => {
  await settle();
  const saved = await idle('等空位恢复');
  await env.c.call('stop', saved);
  await busy('占位甲', 6);
  await busy('占位乙', 30);
  assert.equal(await env.c.call('resume', saved), false, 'resume has to wait');
  await until(() => env.c.sessions.get(saved)?.waiting, 'waiting');
  env.model.script(/等空位时发的话/, [[say('收到等空位时发的话')]]);
  await env.c.call('send', saved, '等空位时发的话', {});
  await until(() => env.c.sessions.get(saved)?.live, 'started', 60_000);
  await until(async () => (await env.rt(saved)).items.some((i) => i.kind === 'text' && i.text === '收到等空位时发的话'), 'the waiting message was sent', 30_000);
});

test('restarting sessions for new endpoint settings keeps to the limit (issue 10-30#7)', async () => {
  await settle();
  await busy('重启甲', 5);
  await busy('重启乙', 40);
  env.model.script(/等重启的会话/, [[say('好')]]);
  const c = await env.start('等重启的会话');
  await until(() => env.c.sessions.get(c)?.waiting, 'waiting');
  const p = env.c.slices.provider;
  await env.c.call('setState', { provider: { ...p, endpoints: p.endpoints.map((e) => ({ ...e, models: e.models.map((m) => (m.name === 'model-one' ? { ...m, effort: !m.effort } : m)) })) } });
  let most = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    most = Math.max(most, live());
    await sleep(100);
  }
  assert.ok(most <= 2, `at most 2 running, saw ${most}`);
  await env.c.call('setState', { provider: p });
});
