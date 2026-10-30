// Approvals: Claude Code decides what to ask and what to suggest; Code Agent shows it as given and
// hands back what the user chose (FR-PERM-01/03/04/05/06/07/08/10).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use, shell, type Step } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item, PendingRequest, SuggestedUpdate } from '@code-agent/shared/types';

let env: Env;
let out: string;
before(async () => {
  env = await setup({ files: { 'a.txt': 'one\n', 'b.txt': 'bee\n' } });
  out = env.world.repo('outside', { 'x.txt': 'x\n', 'y.txt': 'y\n' }, { git: false });
});
after(() => env?.close());

type Approval = Extract<PendingRequest, { kind: 'approval' }>;
const approval = async (sid: string) => (await env.request(sid, 'approval')) as Approval;
const tool = async (sid: string, id: string) => (await env.rt(sid)).items.find((i) => i.id === id) as Extract<Item, { kind: 'tool' }>;
/** A session runs the steps; returns its id. */
async function run(tag: string, steps: Step[], mode?: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions') {
  env.model.script(new RegExp(tag), steps);
  return env.start(tag, mode ? { mode } : {});
}
/** The turn ended without Claude Code asking anything. */
async function noAsk(sid: string, n = 1) {
  await env.turns(sid, n);
  assert.equal((await env.rt(sid)).request, null);
}
const readOut = (file: string): Step => [use('Read', { file_path: path.join(out, file) })];

test('a read outside the workspace: the panel shows Claude Code\'s reason and suggestion as given (FR-PERM-03)', async () => {
  const sid = await run('外部读取一', [readOut('x.txt'), [say('读完')]]);
  const r = await approval(sid);
  assert.equal(r.tool, 'Read');
  assert.match(r.title, /允许读取 .*x\.txt？/);
  assert.equal(r.decisionReason, 'Path is outside allowed working directories');
  assert.match(r.reason, /^Claude Code 的判断：Path is outside/);
  assert.equal(r.suggestions.length, 1);
  const s = r.suggestions[0] as { type: string; rules: string[]; behavior: string };
  assert.equal(s.type, 'addRules');
  assert.equal(s.behavior, 'allow');
  assert.match(s.rules[0], /^Read\(\/\/.*outside\/\*\*\)$/);
  const card = await tool(sid, r.toolItemId);
  assert.equal(card.status, 'waiting');
  assert.deepEqual(env.c.sessions.get(sid)?.requests?.map((q) => q.kind), ['approval'], 'the session list carries it for the inbox');
  assert.ok(env.c.notices.some((n) => n.kind === 'request' && n.sid === sid), 'a request notification went out');
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow' });
  await env.turns(sid);
  assert.equal((await tool(sid, r.toolItemId)).status, 'ok');
  assert.equal((await tool(sid, r.toolItemId)).provenance, '已由你批准');
  assert.equal(env.c.sessions.get(sid)?.requests, undefined);
});

test('"don\'t ask again" for this session: the same read goes through, a new session asks again (FR-PERM-04)', async () => {
  env.model.script(/外部读取二/, [readOut('x.txt'), [say('第一次')]]);
  env.model.script(/再读一次/, [readOut('y.txt'), [say('第二次')]]);
  const sid = await env.start('外部读取二');
  const r = await approval(sid);
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow', always: { updates: r.suggestions, destination: 'session' } });
  await env.turns(sid);
  assert.equal((await tool(sid, r.toolItemId)).provenance, '已由你批准，以后不再询问');
  await env.c.call('send', sid, '再读一次', {});
  await noAsk(sid, 2);
  const other = await env.start('再读一次');
  await approval(other);
  await env.c.call('stop', other);
});

test('a rule kept for the workspace is written as edited and applies to new sessions (FR-PERM-04, FR-PERM-08)', async () => {
  const sid = await run('命令一', [shell('node -e "console.log(1)"'), [say('好')]]);
  const r = await approval(sid);
  const sh = r.tool;
  const edited: SuggestedUpdate[] = [{ type: 'addRules', rules: [`${sh}(node -e *)`], behavior: 'allow', destination: 'localSettings' }];
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow', always: { updates: edited, destination: 'workspace' } });
  await env.turns(sid);
  const local = path.join(env.repo, '.claude', 'settings.local.json');
  await until(() => existsSync(local) && JSON.parse(readFileSync(local, 'utf8')).permissions?.allow?.includes(`${sh}(node -e *)`), 'rule in .claude/settings.local.json');
  await until(() => env.c.slices.rules.some((x) => x.scope === 'workspace' && x.rule === `${sh}(node -e *)`), 'rule on the rules page');
  const next = await run('命令二', [shell('node -e "console.log(2)"'), [say('好')]]);
  await noAsk(next);
});

test('a rule kept for all workspaces goes to the user settings (FR-PERM-04)', async () => {
  const sid = await run('命令三', [shell('node -p "3"'), [say('好')]]);
  const r = await approval(sid);
  const rule = `${r.tool}(node -p "3")`;
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow', always: { updates: [{ type: 'addRules', rules: [rule], behavior: 'allow', destination: 'localSettings' }], destination: 'global' } });
  await env.turns(sid);
  await until(() => JSON.parse(readFileSync(path.join(env.world.config, 'settings.json'), 'utf8')).permissions?.allow?.includes(rule), 'rule in ~/.claude/settings.json');
});

test('a write outside: directory and mode both kept stop the asking; the mode switch is the session\'s (FR-PERM-04)', async () => {
  env.model.script(/外部写入一/, [[use('Write', { file_path: path.join(out, 'w1.txt'), content: '1\n' })], [say('写好了')]]);
  env.model.script(/再写一个/, [[use('Write', { file_path: path.join(out, 'w2.txt'), content: '2\n' })], [say('又写好了')]]);
  const sid = await env.start('外部写入一');
  const r = await approval(sid);
  assert.deepEqual(r.suggestions.map((s) => s.type).sort(), ['addDirectories', 'setMode']);
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow', always: { updates: r.suggestions, destination: 'session' } });
  await env.turns(sid);
  assert.ok(existsSync(path.join(out, 'w1.txt')));
  assert.equal((await env.rt(sid)).mode, 'acceptEdits');
  assert.ok(env.c.slices.dirs.some((d) => d.scope === 'session' && d.sessionId === sid), 'the session\'s extra directory is listed');
  await env.c.call('send', sid, '再写一个', {});
  await noAsk(sid, 2);
  assert.ok(existsSync(path.join(out, 'w2.txt')));
});

test('an unchecked suggestion is not applied (FR-PERM-04)', async () => {
  env.model.script(/外部写入二/, [[use('Write', { file_path: path.join(out, 'w3.txt'), content: '3\n' })], [say('好')]]);
  env.model.script(/外部写入三/, [[use('Write', { file_path: path.join(out, 'w4.txt'), content: '4\n' })], [say('好')]]);
  const sid = await env.start('外部写入二');
  const r = await approval(sid);
  const dirsOnly = r.suggestions.filter((s) => s.type === 'addDirectories');
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow', always: { updates: dirsOnly, destination: 'session' } });
  await env.turns(sid);
  assert.equal((await env.rt(sid)).mode, 'default', 'the mode stays');
  await env.c.call('send', sid, '外部写入三', {});
  await approval(sid);
  await env.c.call('stop', sid);
});

test('deny with a note: Claude reads the note; deny and stop ends the turn (FR-PERM-04)', async () => {
  const sid = await run('改内部一', [[use('Edit', { file_path: '{cwd}/a.txt', old_string: 'one', new_string: 'two' })], [say('不改了')]]);
  const r = await approval(sid);
  assert.ok(r.diff && r.diff.lines.some((l) => l.includes('two')), 'the panel shows the diff');
  await env.c.call('respondApproval', sid, r.id, { behavior: 'deny', message: '先别改，等我确认' });
  await env.turns(sid);
  const card = await tool(sid, r.toolItemId);
  assert.equal(card.status, 'denied');
  assert.equal(card.denialMessage, '先别改，等我确认');
  assert.match(JSON.stringify(env.model.sent(/改内部一/).at(-1)!.body.messages), /先别改，等我确认/);
  assert.equal(readFileSync(path.join(env.repo, 'a.txt'), 'utf8'), 'one\n');

  const sid2 = await run('改内部二', [[use('Edit', { file_path: '{cwd}/b.txt', old_string: 'bee', new_string: 'b2' })], [say('不该出现')]]);
  const r2 = await approval(sid2);
  await env.c.call('respondApproval', sid2, r2.id, { behavior: 'deny', interrupt: true });
  await env.turns(sid2);
  const items = (await env.rt(sid2)).items;
  assert.equal(items.findLast((i) => i.kind === 'footer')?.kind === 'footer' && (items.findLast((i) => i.kind === 'footer') as { stopReason: string }).stopReason, 'interrupted');
  assert.ok(!items.some((i) => i.kind === 'text' && i.text === '不该出现'));
});

test('two requests at once wait in line; the list and the panel follow (FR-PERM-06)', async () => {
  const sid = await run('两个请求', [[use('Read', { file_path: path.join(out, 'x.txt') }), use('Read', { file_path: path.join(out, 'y.txt') })], [say('都读了')]]);
  await until(() => (env.c.sessions.get(sid)?.requests?.length ?? 0) === 2, 'two requests listed');
  const first = await approval(sid);
  await env.c.call('respondApproval', sid, first.id, { behavior: 'allow' });
  await until(() => env.c.sessions.get(sid)?.requests?.length === 1, 'one left');
  const second = await approval(sid);
  assert.notEqual(second.id, first.id);
  await env.c.call('respondApproval', sid, second.id, { behavior: 'allow' });
  await env.turns(sid);
  assert.equal(env.c.sessions.get(sid)?.requests, undefined);
});

test('answered in one tab, gone in the other; a stale answer is ignored (FR-PERM-07)', async () => {
  const other = await env.client();
  const sid = await run('两个标签页', [readOut('x.txt'), [say('好')]]);
  const r = await approval(sid);
  await until(() => other.sessions.get(sid)?.requests?.length === 1, 'the other tab sees it');
  await env.c.call('respondApproval', sid, r.id, { behavior: 'allow' });
  await until(() => other.evs(sid, 'request').at(-1)?.request === null && !other.sessions.get(sid)?.requests, 'the other tab drops it');
  await other.call('respondApproval', sid, r.id, { behavior: 'deny' });
  await env.turns(sid);
  assert.equal((await tool(sid, r.toolItemId)).status, 'ok', 'the late deny changed nothing');
  other.close();
});

test('interrupting or saving ends a waiting request (FR-PERM-07)', async () => {
  const sid = await run('等待中中断', [readOut('x.txt'), [say('好')]]);
  const r = await approval(sid);
  await env.c.call('interrupt', sid);
  await env.turns(sid);
  assert.equal((await env.rt(sid)).request, null);
  assert.notEqual((await tool(sid, r.toolItemId)).status, 'waiting');
  assert.equal(env.c.sessions.get(sid)?.requests, undefined);

  const sid2 = await run('等待中保存', [readOut('x.txt'), [say('好')]]);
  await approval(sid2);
  await env.c.call('stop', sid2);
  await until(() => env.c.sessions.get(sid2)?.live === false, 'saved');
  assert.equal(env.c.sessions.get(sid2)?.requests, undefined);
});

test('modes: accept edits changes files without asking; don\'t ask refuses and says why; bypass runs commands (FR-PERM-01, FR-PERM-10)', async () => {
  const a = await run('自动接受', [[use('Edit', { file_path: '{cwd}/a.txt', old_string: 'one', new_string: 'uno' })], [say('改了')]], 'acceptEdits');
  await noAsk(a);
  assert.equal(readFileSync(path.join(env.repo, 'a.txt'), 'utf8'), 'uno\n');

  const d = await run('不询问模式', [[use('Edit', { file_path: '{cwd}/b.txt', old_string: 'bee', new_string: 'no' })], [say('被拒了')]], 'dontAsk');
  await noAsk(d);
  const items = (await env.rt(d)).items;
  const card = items.find((i) => i.kind === 'tool' && i.tool === 'Edit') as Extract<Item, { kind: 'tool' }>;
  assert.equal(card.status, 'denied');
  assert.match(card.provenance ?? '', /不询问/);
  assert.ok(items.some((i) => i.kind === 'banner' && i.banner === 'denials'), 'denials banner in don\'t-ask mode');
  assert.equal(readFileSync(path.join(env.repo, 'b.txt'), 'utf8'), 'bee\n');

  const b = await run('跳过检查', [shell('node -e "require(\'fs\').writeFileSync(\'bypass.txt\', \'1\')"'), [say('好')]], 'bypassPermissions');
  await noAsk(b);
  assert.ok(existsSync(path.join(env.repo, 'bypass.txt')));
});

test('switching the mode mid-session applies to the next call (FR-PERM-01)', async () => {
  env.model.script(/切模式前/, [[say('好')]]);
  env.model.script(/切模式后/, [[use('Edit', { file_path: '{cwd}/b.txt', old_string: 'bee', new_string: 'bee2' })], [say('改了')]]);
  const sid = await env.start('切模式前');
  await env.turns(sid);
  await env.c.call('setMode', sid, 'acceptEdits');
  await env.c.call('send', sid, '切模式后', {});
  await noAsk(sid, 2);
  assert.equal(readFileSync(path.join(env.repo, 'b.txt'), 'utf8'), 'bee2\n');
});

test('"always refuse when approval is needed" in the profile: nothing waits (FR-PERM-10)', async () => {
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((p) => ({ ...p, prompts: 'none' as const })) });
  const sid = await run('一律拒绝', [readOut('x.txt'), [say('读不了')]]);
  await noAsk(sid);
  const card = (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.tool === 'Read') as Extract<Item, { kind: 'tool' }>;
  assert.equal(card.status, 'denied');
  await env.c.call('setState', { profiles: prev });
});
