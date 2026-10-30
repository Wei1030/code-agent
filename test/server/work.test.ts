// The side of a session's work: task list, subagents, background tasks, file checkpoints and
// rewind, context, compaction and clearing, session info and the debug log
// (FR-TODO-01, FR-AGT-04, FR-BG-01..05, FR-CKPT-01..05, FR-CTX-01..03, FR-SES-17, FR-OBS-02,
// FR-TOOL-06/09/11, FR-COST-05, FR-FILE-02).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { setup, finished, type Env } from '../harness/env';
import { say, use, shell, sleepCmd } from '../harness/fake-model';
import { until, sleep } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => { env = await setup({ files: { 'a.txt': 'alpha\n', 'b.txt': 'beta\n' } }); });
after(() => env?.close());

type Tool = Extract<Item, { kind: 'tool' }>;
const users = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user');

test('the task list follows Claude\'s task tools (FR-TODO-01)', async () => {
  env.model.script(/拆任务/, [
    [use('TaskCreate', { subject: '写测试', description: '写测试', activeForm: '正在写测试' }), use('TaskCreate', { subject: '改代码', description: '改代码', activeForm: '正在改代码' })],
    [use('TaskUpdate', { taskId: '1', status: 'in_progress' })],
    [use('TaskUpdate', { taskId: '1', status: 'completed' })],
    [say('第一项做完了')],
  ]);
  const sid = await env.start('拆任务');
  await env.turns(sid);
  const tasks = (await env.rt(sid)).tasks;
  assert.deepEqual(tasks.map((t) => [t.subject, t.status]), [['写测试', 'completed'], ['改代码', 'pending']]);
  assert.ok(env.c.evs(sid, 'tasks').some((e) => e.tasks.some((t) => t.status === 'in_progress')), 'in progress was shown on the way');
});

test('a subagent\'s card shows its steps and tokens; its own requests go to the model too (FR-AGT-04, FR-TOOL-06)', async () => {
  env.model.script(/派个子代理/, [[use('Agent', { description: '查 a.txt', subagent_type: 'general-purpose', prompt: '子任务：读 a.txt 告诉我内容' })], [say('子代理说是 alpha')]]);
  env.model.script(/子任务：读 a\.txt/, [[use('Read', { file_path: '{cwd}/a.txt' })], [say('内容是 alpha')]]);
  const sid = await env.start('派个子代理');
  await env.turns(sid);
  const card = (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.agent) as Tool;
  assert.ok(card, 'an agent card');
  assert.equal(card.agent?.agentType, 'general-purpose');
  assert.ok((card.agent?.toolCalls ?? 0) >= 1, 'its tool calls are counted');
  assert.ok((card.agent?.tokens ?? 0) > 0, 'its tokens are counted');
  assert.ok(card.agent?.rows.some((r) => /a\.txt/.test(r.text)), 'its read is listed');
  assert.ok(env.model.sent(/子任务：读 a\.txt/).length >= 1);
});

test('a command in the background: listed, finishes with a notice, its output can be read (FR-BG-01, FR-BG-04, FR-BG-05)', async () => {
  env.model.script(/后台跑/, [(r) => shell('node -e "setTimeout(() => console.log(\'bench done 42\'), 1500)"', { run_in_background: true })(r), [say('在后台跑着')]]);
  const sid = await env.start('后台跑', { mode: 'bypassPermissions' });
  await env.turns(sid);
  const bg = await until(async () => (await env.rt(sid)).background.find((b) => b.kind === 'bash'), 'background task');
  await until(async () => (await env.rt(sid)).background.find((b) => b.id === bg.id)?.status === 'completed', 'finished', 60_000);
  assert.ok(env.c.notices.some((n) => n.kind === 'background' && n.sid === sid), 'a background notification');
  const outText = await env.c.call('taskOutput', sid, bg.id);
  assert.match(outText, /bench done 42/);
});

test('stopping a background task (FR-BG-02)', async () => {
  env.model.script(/后台长任务/, [(r) => shell(sleepCmd(60), { run_in_background: true })(r), [say('跑着')]]);
  const sid = await env.start('后台长任务', { mode: 'bypassPermissions' });
  await env.turns(sid);
  const bg = await until(async () => (await env.rt(sid)).background.find((b) => b.status === 'running'), 'running task');
  await env.c.call('stopTask', sid, bg.id);
  await until(async () => (await env.rt(sid)).background.find((b) => b.id === bg.id)?.status === 'stopped', 'stopped');
});

test('Claude stopping its own background task with TaskStop (FR-TOOL-11)', async () => {
  const taskId = (r: { body: unknown }) => /with ID: (\w+)/.exec(JSON.stringify(r.body))?.[1] ?? 'none';
  env.model.script(/自己停掉/, [(r) => shell(sleepCmd(60), { run_in_background: true })(r), (r) => [use('TaskStop', { task_id: taskId(r) })], [say('停掉了')]]);
  const sid = await env.start('自己停掉', { mode: 'bypassPermissions' });
  await env.turns(sid);
  const rt = await env.rt(sid);
  assert.equal((rt.items.find((i) => i.kind === 'tool' && i.tool === 'TaskStop') as Tool)?.status, 'ok');
  await until(async () => (await env.rt(sid)).background.every((b) => b.status !== 'running'), 'no task left running');
});

test('"all to the background" moves what runs in the foreground and the turn goes on (FR-BG-03)', async () => {
  env.model.script(/全部转后台/, [shell(sleepCmd(30)), [say('命令在后台了')]]);
  const sid = await env.start('全部转后台', { mode: 'bypassPermissions' });
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'tool' && i.status === 'running' && i.backgroundable), 'a backgroundable command', 15_000);
  await env.c.call('backgroundAll', sid);
  await env.turns(sid);
  assert.ok((await env.rt(sid)).background.some((b) => b.status === 'running'));
  await env.c.call('stop', sid);
});

test('saving a session ends the commands it was running, in the foreground and the background (issue 10-30#16)', async () => {
  const late = (tag: string) => `node -e "setTimeout(() => require('fs').writeFileSync('late-${tag}.txt', 'x'), 8000)"`;
  env.model.script(/^保存时还在跑$/, [(r) => [...shell(late('bg'), { run_in_background: true })(r)], shell(late('fg')), [say('好')]]);
  const sid = await env.start('保存时还在跑', { mode: 'bypassPermissions' });
  await until(async () => { const r = await env.rt(sid); return r.background.some((b) => b.status === 'running') && r.items.some((i) => i.kind === 'tool' && i.status === 'running' && !i.background); }, 'both running', 30_000);
  await sleep(2000);
  await env.c.call('stop', sid);
  await until(() => env.c.sessions.get(sid)?.live === false, 'saved');
  await sleep(9000);
  assert.equal(existsSync(path.join(env.repo, 'late-fg.txt')), false, 'the foreground command was still running');
  assert.equal(existsSync(path.join(env.repo, 'late-bg.txt')), false, 'the background command was still running');
});

test('moving a running command to the background lets the turn go on (FR-BG-03)', async () => {
  env.model.script(/转后台/, [shell(sleepCmd(30)), [say('命令转到后台了，我先答别的')]]);
  const sid = await env.start('转后台', { mode: 'bypassPermissions' });
  const card = await until(async () => (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.status === 'running') as Tool | undefined, 'running command');
  assert.ok(!card.backgroundable, 'no button before Claude Code can do it');
  // Claude Code registers a command as a task after a couple of seconds; then the button shows.
  await until(async () => ((await env.rt(sid)).items.find((i) => i.id === card.id) as Tool).backgroundable, 'backgroundable', 15_000);
  await env.c.call('backgroundTool', sid, card.id);
  await env.turns(sid);
  assert.ok((await env.rt(sid)).items.some((i) => i.kind === 'text' && /先答别的/.test(i.text)));
  assert.ok((await env.rt(sid)).background.some((b) => b.status === 'running'));
});

test('rewind: a dry run lists the files, then they are put back; or rewind and fork (FR-CKPT-01..04)', async () => {
  env.model.script(/改两个文件/, [[use('Edit', { file_path: '{cwd}/a.txt', old_string: 'alpha', new_string: 'ALPHA' }), use('Write', { file_path: '{cwd}/c.txt', content: 'new\n' })], [say('改好了')]]);
  const sid = await env.start('改两个文件', { mode: 'acceptEdits' });
  await env.turns(sid);
  assert.equal(readFileSync(path.join(env.repo, 'a.txt'), 'utf8'), 'ALPHA\n');
  const u = users((await env.rt(sid)).items)[0];
  const dry = await env.c.call('dryRun', sid, u.id);
  assert.equal(dry.canRewind, true);
  assert.deepEqual(dry.files.map((f) => [path.basename(f.path), f.what]).sort(), [['a.txt', 'restored'], ['c.txt', 'deleted']]);
  assert.equal(readFileSync(path.join(env.repo, 'a.txt'), 'utf8'), 'ALPHA\n', 'the dry run changes nothing');
  assert.equal(await env.c.call('rewind', sid, u.id, false), null);
  assert.equal(readFileSync(path.join(env.repo, 'a.txt'), 'utf8'), 'alpha\n');
  assert.ok(!existsSync(path.join(env.repo, 'c.txt')), 'the new file is gone');

  env.model.script(/再改一次/, [[use('Edit', { file_path: '{cwd}/b.txt', old_string: 'beta', new_string: 'BETA' })], [say('好')]]);
  await env.c.call('send', sid, '再改一次', {});
  await env.turns(sid, 2);
  const u2 = users((await env.rt(sid)).items).find((x) => x.text === '再改一次')!;
  const fork = await env.c.call('rewind', sid, u2.id, true);
  assert.ok(fork, 'a fork was made');
  assert.equal(readFileSync(path.join(env.repo, 'b.txt'), 'utf8'), 'beta\n');
  assert.deepEqual(users((await env.rt(fork!)).items).map((x) => x.text), ['改两个文件']);
});

test('a saved session cannot rewind (FR-CKPT-03)', async () => {
  env.model.script(/保存后回退/, [[say('好')]]);
  const sid = await env.start('保存后回退');
  await env.turns(sid);
  const u = users((await env.rt(sid)).items)[0];
  await env.c.call('stop', sid);
  await until(() => env.c.sessions.get(sid)?.live === false, 'saved');
  const dry = await env.c.call('dryRun', sid, u.id);
  assert.equal(dry.canRewind, false);
  assert.match(dry.error ?? '', /恢复会话/);
});

test('context usage after a turn, the precise count, compaction with instructions, clearing (FR-CTX-01..03)', async () => {
  env.model.script(/上下文测试/, [[use('TaskCreate', { subject: '一项', description: '一项', activeForm: '做一项' })], [say('好')]]);
  const sid = await env.start('上下文测试');
  await env.turns(sid);
  const ctx = await until(async () => { const c = (await env.rt(sid)).context; return c.categories.length ? c : null; }, 'context usage');
  assert.ok(ctx.max > 0);
  await env.c.call('preciseCount', sid);
  await until(async () => (await env.rt(sid)).context.precise, 'precise count');

  await env.c.call('compact', sid, '保留关于数据库的决定');
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'divider' && /对话已压缩 · 手动/.test(i.label)), 'compaction divider', 60_000);
  assert.ok(env.model.requests.some((r) => /保留关于数据库的决定/.test(JSON.stringify(r.body))), 'the instructions reached the model');

  await until(async () => (await env.rt(sid)).state === 'idle', 'idle after compacting');
  await env.c.call('clearConversation', sid);
  await until(async () => (await env.rt(sid)).items.some((i) => i.kind === 'divider' && /对话已清空/.test(i.label)), 'cleared', 60_000);
  const rt = await env.rt(sid);
  assert.equal(rt.items.length, 1, 'only the divider is left');
  assert.equal(rt.tasks.length, 0);
});

test('session info: version, process, directory, model (FR-SES-17)', async () => {
  env.model.script(/信息页/, [[say('好')]]);
  const sid = await env.start('信息页');
  await env.turns(sid);
  const info = (await env.rt(sid)).info!;
  assert.match(info.version ?? '', /^\d+\.\d+\.\d+/);
  assert.ok(info.pid);
  assert.equal(path.resolve(info.cwd ?? ''), path.resolve(env.repo));
  assert.ok(finished(env.c, sid) === 1);
});

test('session info shows what Code Agent put in the system prompt; a resumed session and a fork keep the first (FR-SES-17)', async () => {
  env.model.script(/^提示词一$/, [[say('好')]]);
  env.model.script(/^提示词二$/, [[say('好')]]);
  const sid = await env.start('提示词一');
  await env.turns(sid);
  const first = (await env.rt(sid)).info?.prompt;
  assert.equal(first?.custom, false);
  assert.match(first?.text ?? '', /Always respond to the user in/);
  assert.ok(env.model.sent(/^提示词一$/)[0].system.includes(first!.text), 'what was sent');
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((p) => ({ ...p, promptMode: 'append', promptText: 'MARK-LATER' })) });
  await env.c.call('stop', sid);
  await until(() => env.c.sessions.get(sid)?.live === false, 'saved');
  await env.c.call('resume', sid);
  await env.c.call('send', sid, '提示词二', {});
  await env.turns(sid, 2);
  assert.deepEqual((await env.rt(sid)).info?.prompt, first, 'the resumed session keeps its first prompt');
  const fork = await env.c.call('forkAt', sid);
  assert.deepEqual((await env.rt(fork)).info?.prompt, first, 'the fork goes on with the original\'s');
  await env.c.call('setState', { profiles: prev });
});

test('the file preview reads files of the session\'s own folders only; binary and very long files are flagged (FR-FILE-02)', async () => {
  env.model.script(/文件预览/, [[say('好')]]);
  const sid = await env.start('文件预览');
  await env.turns(sid);
  const a = await env.c.call('readWorkspaceFile', sid, 'a.txt');
  assert.deepEqual([a.path, a.content, a.binary, a.truncated], ['a.txt', 'alpha\n', false, false]);
  assert.equal((await env.c.call('readWorkspaceFile', sid, path.join(env.repo, 'b.txt'))).path, 'b.txt', 'an absolute path inside works');
  writeFileSync(path.join(env.repo, 'logo.bin'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
  assert.equal((await env.c.call('readWorkspaceFile', sid, 'logo.bin')).binary, true);
  writeFileSync(path.join(env.repo, 'big.log'), 'x'.repeat(1024 * 1024 + 10));
  assert.equal((await env.c.call('readWorkspaceFile', sid, 'big.log')).truncated, true);
  await assert.rejects(env.c.call('readWorkspaceFile', sid, '../outside.txt'), /不在会话的工作目录里/);
  await assert.rejects(env.c.call('readWorkspaceFile', sid, env.world.config), /不在会话的工作目录里/);
  await assert.rejects(env.c.call('readWorkspaceFile', sid, 'missing.txt'), /文件不存在/);
});

test('the debug log, when switched on, is written and its end can be read (FR-OBS-02)', async () => {
  await env.c.call('setState', { runtime: { ...env.c.slices.runtime, debugLog: true } });
  env.model.script(/调试日志/, [[say('好')]]);
  const sid = await env.start('调试日志');
  await env.turns(sid);
  const log = await until(async () => { const d = await env.c.call('debugLog', sid); return d.exists && d.tail.length ? d : null; }, 'debug log');
  assert.match(log.path, new RegExp(`${sid}\\.log$`));
  await env.c.call('setState', { runtime: { ...env.c.slices.runtime, debugLog: false } });
});
