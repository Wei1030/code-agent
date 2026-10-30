// Sessions working together: the workspace tools, delivery and receipts, holding messages for the
// user, the hop limit, sessions created by sessions (custom feature 会话协作, FR-OUT-10, issue 10-30#9).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setup, type Env } from '../harness/env';
import { say, use } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => { env = await setup(); });
after(() => env?.close());

type Tool = Extract<Item, { kind: 'tool' }>;
const peerCard = async (sid: string, op: string) => (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.peer?.op === op) as Tool;
const users = async (sid: string) => (await env.rt(sid)).items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user');
async function idle(tag: string, mode?: 'bypassPermissions') {
  env.model.script(new RegExp(`^${tag}$`), [[say(`${tag} 在`)]]);
  const sid = await env.start(tag, mode ? { mode } : {});
  await env.turns(sid);
  return sid;
}
async function setPeer(p: Partial<typeof env.c.slices.peer>) {
  await env.c.call('setState', { peer: { ...env.c.slices.peer, ...p } });
}

test('list, read and status of another session in the workspace, not of other workspaces', async () => {
  const b = await idle('被看的会话');
  const otherWs = (await env.c.call('addWorkspace', env.world.repo('other'))).id;
  env.model.script(/^别处的会话$/, [[say('别处')]]);
  const elsewhere = await env.start('别处的会话', { ws: otherWs });
  await env.turns(elsewhere);
  env.model.script(/看看别的会话/, [
    [use('mcp__workspace__list_sessions', {})],
    [use('mcp__workspace__read_session', { session_id: b })],
    [use('mcp__workspace__session_status', { session_id: b })],
    [use('mcp__workspace__read_session', { session_id: elsewhere })],
    [say('看完了')],
  ]);
  const a = await env.start('看看别的会话');
  await env.turns(a);
  const results = JSON.stringify(env.model.sent(/看看别的会话/).at(-1)!.body.messages);
  assert.match(results, new RegExp(b), 'listed');
  assert.ok(!new RegExp(`${elsewhere}[^"]*别处的会话`).test(results.split('read_session')[0]), 'another workspace is not listed');
  assert.match(results, /被看的会话 在/, 'its conversation was read');
  assert.match(results, /No session .* in this workspace/, 'another workspace cannot be read');
  assert.equal((await peerCard(a, 'list')).status, 'ok');
});

test('a message to an idle session starts its turn; the sender gets a receipt with the reply', async () => {
  const b = await idle('接收方');
  env.model.script(/请接收方回答/, [[say('接收方的回答：42')]]);
  env.model.script(/发给接收方/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '请接收方回答一个数字' })], [say('发出去了')]]);
  env.model.script(/处理完了你的消息/, [[say('收到回执')]]);
  const a = await env.start('发给接收方');
  await until(async () => (await users(b)).some((u) => u.from?.sessionId === a && /请接收方回答/.test(u.text)), 'delivered with its sender');
  await until(async () => (await peerCard(a, 'send'))?.peer?.delivery === 'handled', 'handled');
  await until(async () => (await users(a)).some((u) => u.from?.kind === 'receipt' && /42/.test(u.text)), 'receipt with the reply');
  assert.ok((env.c.sessions.get(b)?.peerUnread ?? 0) > 0, 'unread for the receiver');
  await env.c.call('markRead', b);
  await until(() => env.c.sessions.get(b)?.peerUnread === 0, 'read');
});

test('different permission classes: the message waits for the user; release delivers, reject tells the sender', async () => {
  await setPeer({ inbound: 'parity' });
  const b = await idle('谨慎的接收方');
  env.model.script(/放行测试/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '放行后的消息' })], [say('发了')]]);
  const a = await env.start('放行测试', { mode: 'bypassPermissions' });
  const held = await until(() => env.c.slices.held.find((h) => h.to.sessionId === b), 'held');
  assert.equal(held.reason, 'mode');
  assert.ok(env.c.notices.some((n) => n.kind === 'request' && n.path === '#inbox'), 'the user is told');
  env.model.script(/放行后的消息/, [[say('收到放行的消息')]]);
  await env.c.call('releaseHeld', held.id);
  await until(async () => (await users(b)).some((u) => /放行后的消息/.test(u.text)), 'released and delivered');

  env.model.script(/拒绝测试/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '不该送达' })], [say('发了')]]);
  await env.c.call('send', a, '拒绝测试', {});
  const h2 = await until(() => env.c.slices.held.find((h) => /不该送达/.test(h.text)), 'held again');
  await env.c.call('rejectHeld', h2.id);
  await until(async () => (await env.rt(a)).items.some((i) => i.kind === 'notice' && /没有放行/.test(i.text)), 'the sender is told');
  assert.equal((await users(b)).some((u) => /不该送达/.test(u.text)), false);
});

test('policies: always deliver, always hold; the hop limit stops a chain', async () => {
  const b = await idle('策略接收方');
  await setPeer({ inbound: 'accept' });
  env.model.script(/总是送达/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '直接送达的', notify: false })], [say('发了')]]);
  env.model.script(/直接送达的/, [[say('好')]]);
  await env.start('总是送达', { mode: 'bypassPermissions' });
  await until(async () => (await users(b)).some((u) => /直接送达的/.test(u.text)), 'delivered across classes');

  await setPeer({ inbound: 'hold' });
  env.model.script(/总是等我/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '先放着的', notify: false })], [say('发了')]]);
  await env.start('总是等我');
  assert.equal((await until(() => env.c.slices.held.find((h) => /先放着的/.test(h.text)), 'held by policy')).reason, 'policy');

  await setPeer({ inbound: 'accept', maxHops: 1 });
  const c = await idle('转发终点');
  env.model.script(/^转发一$/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '转发二', notify: false })], [say('转了')]]);
  env.model.script(/转发二/, [[use('mcp__workspace__send_to_session', { session_id: c, message: '转发三', notify: false })], [say('又转了')]]);
  await env.start('转发一');
  const h = await until(() => env.c.slices.held.find((x) => /转发三/.test(x.text)), 'held at the hop limit');
  assert.equal(h.reason, 'hops');
  await setPeer({ inbound: 'parity', maxHops: 6 });
});

test('a session created by a session: own worktree and branch, at most the creator\'s mode, its origin shown', async () => {
  env.model.script(/开个新会话/, [[use('mcp__workspace__create_session', { title: '子任务会话', message: '子任务：看一下 README', worktree: true, mode: 'bypassPermissions', notify: false })], [say('开好了')]]);
  env.model.script(/子任务：看一下 README/, [[say('README 很短')]]);
  const a = await env.start('开个新会话', { mode: 'acceptEdits' });
  await env.turns(a);
  const child = await until(() => [...env.c.sessions.values()].find((s) => s.title === '子任务会话'), 'child session');
  assert.equal(child.createdBy?.sessionId, a);
  assert.match(child.worktree ?? '', /^ca\//);
  assert.ok(child.cwd && existsSync(child.cwd), 'its checkout exists');
  assert.equal((await env.rt(child.id)).mode, 'acceptEdits', 'not above the creator');
  await until(async () => (await env.rt(child.id)).items.some((i) => i.kind === 'text' && /README 很短/.test(i.text)), 'child works');
  const wt = await env.c.call('listWorktrees');
  assert.ok(wt.some((w) => w.branch === child.worktree), 'listed on the worktree tab');
});

test('a held message released after a server restart is still delivered (issue 10-30#9)', async () => {
  await setPeer({ inbound: 'hold' });
  const b = await idle('重启后放行');
  env.model.script(/重启前发的/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '重启前发的消息', notify: false })], [say('发了')]]);
  await env.start('重启前发的');
  const held = await until(() => env.c.slices.held.find((h) => /重启前发的消息/.test(h.text)), 'held');
  await env.restart();
  assert.ok(env.c.slices.held.some((h) => h.id === held.id), 'still waiting after the restart');
  env.model.script(/重启前发的消息/, [[say('收到了')]]);
  await env.c.call('releaseHeld', held.id);
  await until(async () => (await users(b)).some((u) => /重启前发的消息/.test(u.text)), 'delivered after the restart', 30_000);
  await setPeer({ inbound: 'parity' });
});
