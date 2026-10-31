// Sessions working together: the workspace tools, delivery and receipts, holding messages for the
// user, the hop limit, sessions created by sessions and their worktrees, searching and reading the
// workspace's conversations. The workspace tools are
// Code Agent's own in-process MCP server (custom feature 会话协作, FR-CTOOL-01, FR-OUT-10, issue 10-30#9).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use, shell } from '../harness/fake-model';
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

test('search the workspace\'s conversations, this session\'s too; read around a hit, and a tool call with its output', async () => {
  env.model.script(/^记下暗号$/, [shell('node -e "console.log(6*7, \'OUTPUT\')"'), [say('暗号是 ZEBRA-MARK，命令也跑完了')]]);
  const b = await env.start('记下暗号', { mode: 'bypassPermissions' });
  await env.turns(b);
  const otherWs = (await env.c.call('addWorkspace', env.world.repo('other-search'))).id;
  env.model.script(/^别处的暗号$/, [[say('别处也说了 ZEBRA-MARK')]]);
  const elsewhere = await env.start('别处的暗号', { ws: otherWs });
  await env.turns(elsewhere);
  const items = (await env.rt(b)).items;
  const said = items.find((i) => i.kind === 'text' && /ZEBRA-MARK/.test(i.text))!;
  const cmd = items.flatMap((i) => (i.kind === 'toolgroup' ? i.tools : [i])).find((i): i is Tool => i.kind === 'tool' && (i.tool === 'Bash' || i.tool === 'PowerShell'))!;
  assert.ok(cmd.output, 'the command\'s output is kept');

  env.model.script(/^自己说过 OWL-MARK$/, [[say('记住了')]]);
  const a = await env.start('自己说过 OWL-MARK');
  await env.turns(a);
  await until(async () => (await env.c.call('searchSessions', 'OWL-MARK')).some((h) => h.sessionId === a) && (await env.c.call('searchSessions', 'ZEBRA-MARK')).some((h) => h.sessionId === b), 'both indexed');
  env.model.script(/^找暗号$/, [
    [use('mcp__workspace__search_history', { query: 'zebra-mark' })],
    [use('mcp__workspace__search_history', { query: '42 OUTPUT' })],
    [use('mcp__workspace__search_history', { query: 'OWL-MARK' })],
    [use('mcp__workspace__read_session', { session_id: b, around: said.id })],
    [use('mcp__workspace__read_entry', { session_id: b, entry_id: cmd.id })],
    [use('mcp__workspace__read_entry', { session_id: b, entry_id: 'no-such-entry' })],
    [say('找到了')],
  ]);
  await env.c.call('send', a, '找暗号', {});
  await env.turns(a, 2);
  const results = JSON.stringify(env.model.sent(/^找暗号$/).at(-1)!.body.messages);
  assert.match(results, new RegExp(`${b}:\\\\n- entry ${said.id}: .*ZEBRA-MARK`), 'found in the other session, any case, with the entry');
  assert.doesNotMatch(results, new RegExp(elsewhere), 'not in another workspace');
  assert.match(results, /Nothing in the conversations of this workspace matches \\"42 OUTPUT\\"/, 'tool output is not searched');
  assert.match(results, /\(this session\)[^"]*OWL-MARK/, 'this session too');
  assert.match(results, new RegExp(`\\(entry ${cmd.id}\\)`), 'read_session marks the call that has more to read');
  assert.match(results, /Output:\\n42 OUTPUT/, 'read_entry gives the output');
  assert.match(results, /No entry no-such-entry/);
  const card = await peerCard(a, 'search');
  assert.equal(card.detail, 'zebra-mark');
  assert.ok(card.peer?.rows?.some((r) => /ZEBRA-MARK/.test(r.text)), 'the card shows the hits');
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

test('a message from another session queued in a busy session and set to "after tools" keeps its own turn and its receipt (review R5)', async () => {
  env.model.script(/^忙着的接收方$/, [shell('node -e "setTimeout(() => {}, 6000)"'), [say('忙完了')]]);
  const b = await env.start('忙着的接收方', { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(b)).items.some((i) => i.kind === 'tool' && i.status === 'running'), 'busy');
  env.model.script(/请忙着的接收方回答/, [[say('忙着的接收方回答：77')]]);
  env.model.script(/^发给忙着的接收方$/, [[use('mcp__workspace__send_to_session', { session_id: b, message: '请忙着的接收方回答一个数字' })], [say('发出去了')]]);
  env.model.script(/处理完了你的消息/, [[say('收到回执')]]);
  const a = await env.start('发给忙着的接收方', { mode: 'bypassPermissions' });
  const q = await until(async () => (await env.rt(b)).queue.find((m) => /请忙着的接收方回答/.test(m.text)), 'queued in the busy session');
  await env.c.call('updateQueued', b, q.id, { priority: 'next' });
  assert.equal((await env.rt(b)).queue.find((m) => m.id === q.id)?.sent, undefined, 'not handed over: it keeps a turn of its own');
  await until(async () => (await peerCard(a, 'send'))?.peer?.delivery === 'handled', 'handled', 60_000);
  await until(async () => (await users(a)).some((u) => u.from?.kind === 'receipt' && /77/.test(u.text)), 'receipt with its reply');
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

test('a session created by a session: own worktree and branch, at most the creator\'s mode, the creator\'s effort unless the user asked, its origin shown', async () => {
  env.model.script(/开个新会话/, [[use('mcp__workspace__create_session', { title: '子任务会话', message: '子任务：看一下 README', worktree: true, mode: 'bypassPermissions', notify: false })], [say('开好了')]]);
  env.model.script(/子任务：看一下 README/, [[say('README 很短')]]);
  // With tool search off the workspace tools come with their descriptions in the first request.
  const mb = env.c.slices.mcpBehavior;
  await env.c.call('setState', { mcpBehavior: { ...mb, toolSearch: 'off' } });
  const a = await env.start('开个新会话', { mode: 'acceptEdits' });
  await env.turns(a);
  await env.c.call('setState', { mcpBehavior: mb });
  const tools = env.model.sent(/开个新会话/)[0].body.tools as Array<{ name: string; description?: string }>;
  assert.match(tools.find((x) => x.name === 'mcp__workspace__create_session')?.description ?? '', /Leave effort unset unless the user asked for one/);
  const child = await until(() => [...env.c.sessions.values()].find((s) => s.title === '子任务会话'), 'child session');
  assert.equal(child.createdBy?.sessionId, a);
  assert.match(child.worktree ?? '', /^ca\//);
  assert.ok(child.cwd && existsSync(child.cwd), 'its checkout exists');
  assert.equal((await env.rt(child.id)).mode, 'acceptEdits', 'not above the creator');
  assert.equal((await env.rt(child.id)).effort, (await env.rt(a)).effort, 'no effort given: the creator\'s');
  await until(async () => (await env.rt(child.id)).items.some((i) => i.kind === 'text' && /README 很短/.test(i.text)), 'child works');
  const wt = await env.c.call('listWorktrees');
  assert.ok(wt.some((w) => w.branch === child.worktree), 'listed on the worktree tab');
});

test('a worktree session runs on the workspace\'s own settings; removing the worktree saves its session (FR-WS-03)', async () => {
  // settings.local.json is not committed, so the worktree's checkout has no copy of this rule.
  await env.c.call('setState', { rules: [...env.c.slices.rules, ...['Bash', 'PowerShell'].map((t, i) => ({ id: `wt${i}`, behavior: 'allow' as const, rule: `${t}(node -e *)`, scope: 'workspace' as const, workspaceId: env.ws }))] });
  const local = path.join(env.repo, '.claude', 'settings.local.json');
  await until(() => existsSync(local) && readFileSync(local, 'utf8').includes('node -e'), 'the rule written');
  env.model.script(/开工作树会话/, [[use('mcp__workspace__create_session', { title: '工作树会话', message: '在工作树里跑命令', worktree: true, mode: 'acceptEdits', notify: false })], [say('开好了')]]);
  env.model.script(/^在工作树里跑命令$/, [shell('node -e "console.log(6*7)"'), [say('跑完了')]]);
  const a = await env.start('开工作树会话', { mode: 'acceptEdits' });
  await env.turns(a);
  const child = await until(() => [...env.c.sessions.values()].find((s) => s.title === '工作树会话'), 'child session');
  await until(async () => (await env.rt(child.id)).items.some((i) => i.kind === 'text' && /跑完了/.test(i.text)), 'the command ran', 60_000);
  assert.ok(!existsSync(path.join(child.cwd!, '.claude', 'settings.local.json')), 'no copy in the worktree');
  // In accept-edits mode a command asks first; with the rule it ran on its own.
  const cmd = (await env.rt(child.id)).items.find((i) => i.kind === 'tool' && (i.tool === 'Bash' || i.tool === 'PowerShell')) as Tool;
  assert.equal(cmd.status, 'ok', 'the workspace rule allowed it without asking');

  const { branchDeleted } = await env.c.call('removeWorktree', child.cwd!);
  assert.equal(branchDeleted, true, 'a branch with nothing new goes too');
  assert.ok(!existsSync(child.cwd!), 'the checkout is gone');
  await until(() => env.c.sessions.get(child.id)?.live === false && env.c.sessions.get(child.id)?.worktreeGone, 'its session saved and marked');
  assert.ok(!(await env.c.call('listWorktrees')).some((w) => w.path === path.resolve(child.cwd!)));
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
