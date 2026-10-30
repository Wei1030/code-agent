// What the transcript shows: streaming text and thinking, tool cards, grouping, the turn footer,
// banners and the retry status, paging of long transcripts (FR-OUT-01..09, FR-TOOL-01..05/15).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setup, finished, type Env, EP } from '../harness/env';
import { say, think, use, shell, httpError } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup({ files: { 'src/a.js': 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'src/b.js': 'export {};\n', 'docs/readme.md': '# doc\n' } });
  env.world.mcp('tracker', env.world.tracker());
});
after(() => env?.close());

type Tool = Extract<Item, { kind: 'tool' }>;
const tools = (items: Item[]) => items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : []));
const byTool = (items: Item[], name: string) => tools(items).find((t) => t.tool === name) as Tool;

test('text and thinking stream in pieces and end as one item each (FR-OUT-01, FR-OUT-02)', async () => {
  env.model.script(/流式/, [[think('先想一想这个问题应该怎么回答才好'), say('这是一段比较长的回答，会分成好几段推送到页面上，最后合成一条。')]], { slow: 30 });
  const sid = await env.start('流式');
  await env.turns(sid);
  const items = (await env.rt(sid)).items;
  const text = items.find((i) => i.kind === 'text') as Extract<Item, { kind: 'text' }>;
  const thinking = items.find((i) => i.kind === 'thinking') as Extract<Item, { kind: 'thinking' }>;
  assert.equal(text.text, '这是一段比较长的回答，会分成好几段推送到页面上，最后合成一条。');
  assert.ok(!text.streaming);
  assert.ok(env.c.evs(sid, 'item.append').filter((e) => e.id === text.id).length >= 2, 'text came in pieces');
  assert.match(thinking.text, /先想一想/);
  assert.ok(thinking.seconds >= 1);
});

test('tool cards: read, edit with its diff, new file, search, failing command, MCP tool (FR-TOOL-01..04, FR-TOOL-15)', async () => {
  env.model.script(/工具卡片/, [
    [use('Read', { file_path: '{cwd}/src/a.js', offset: 2, limit: 2 })],
    [use('Edit', { file_path: '{cwd}/src/a.js', old_string: 'const b = 2;', new_string: 'const b = 20;\nconst d = 4;' })],
    [use('Write', { file_path: '{cwd}/src/new.js', content: 'export const x = 1;\n' })],
    [use('Grep', { pattern: 'const', path: '{cwd}/src', output_mode: 'files_with_matches' })],
    (r) => [say('跑个会失败的命令'), ...shell('node -e "process.exit(3)"')(r)],
    [use('mcp__tracker__list_issues', {})],
    [say('完成')],
  ]);
  const sid = await env.start('工具卡片', { mode: 'bypassPermissions' });
  await env.turns(sid);
  const items = (await env.rt(sid)).items;
  const read = byTool(items, 'Read');
  assert.equal(read.status, 'ok');
  assert.match(read.detail, /src[\\/]a\.js/);
  assert.equal(read.file?.from, 2);
  const edit = byTool(items, 'Edit');
  assert.equal(edit.output?.type, 'diff');
  assert.ok((edit.output as { lines: string[] }).lines.some((l) => l.startsWith('+') && l.includes('const d = 4;')));
  assert.match(edit.right ?? '', /\+2 −1/);
  const write = byTool(items, 'Write');
  assert.equal(write.status, 'ok');
  const grep = byTool(items, 'Grep');
  assert.equal(grep.status, 'ok');
  const cmd = tools(items).find((t) => t.tool === 'PowerShell' || t.tool === 'Bash')!;
  assert.equal(cmd.status, 'error');
  const mcp = byTool(items, 'tracker · list_issues');
  assert.equal(mcp.status, 'ok', 'MCP tools show as "server · tool"');
  assert.match(read.right ?? '', /2 行/);
  assert.match(grep.right ?? '', /处匹配/);
  assert.equal(cmd.right, '失败');
  const changes = (await env.rt(sid)).changes;
  assert.deepEqual(changes.map((c) => [path.basename(c.path), c.kind]).sort(), [['a.js', 'modified'], ['new.js', 'created']]);
});

test('consecutive reads and searches fold into one group (FR-OUT-04)', async () => {
  env.model.script(/连续读取/, [[use('Read', { file_path: '{cwd}/src/a.js' }), use('Read', { file_path: '{cwd}/src/b.js' }), use('Glob', { pattern: '**/*.md', path: '{cwd}' })], [say('看完了')]]);
  const sid = await env.start('连续读取');
  await env.turns(sid);
  const group = (await env.rt(sid)).items.find((i) => i.kind === 'toolgroup') as Extract<Item, { kind: 'toolgroup' }>;
  assert.ok(group, 'a group');
  assert.equal(group.tools.length, 3);
  assert.match(group.label, /读取 2 个文件/);
});

test('the turn footer: number, tool calls, tokens, why it stopped (FR-OUT-06)', async () => {
  env.model.script(/统计一/, [[use('Read', { file_path: '{cwd}/src/a.js' })], [say('好')]]);
  env.model.script(/统计二/, [[say('第二轮')]]);
  const sid = await env.start('统计一');
  await env.turns(sid);
  await env.c.call('send', sid, '统计二', {});
  await env.turns(sid, 2);
  const footers = (await env.rt(sid)).items.filter((i): i is Extract<Item, { kind: 'footer' }> => i.kind === 'footer');
  assert.deepEqual(footers.map((f) => [f.turn, f.toolCalls, f.stopReason]), [[1, 1, 'end_turn'], [2, 0, 'end_turn']]);
  assert.ok(footers.every((f) => f.tokens > 0));
});

test('an endpoint refusing the token stops the turn at once with a banner (FR-OUT-07)', async () => {
  env.model.failModel('model-two', httpError(401, 'authentication_error', 'invalid x-api-key'));
  const t0 = Date.now();
  const sid = await env.start('认证失败', { model: `ep:${EP}:model-two` });
  const banner = await until(async () => (await env.rt(sid)).items.find((i) => i.kind === 'banner'), 'banner', 30_000) as Extract<Item, { kind: 'banner' }>;
  assert.equal(banner.banner, 'endpointRejected');
  assert.match(banner.detail ?? '', /测试端点/);
  assert.match(banner.detail ?? '', /401/);
  await env.turns(sid);
  assert.ok(Date.now() - t0 < 20_000, 'no ten retries first');
  env.model.failModel('model-two', null);
});

test('an overloaded endpoint shows the retry, then the turn goes on (FR-OUT-08)', async () => {
  let failed = 0;
  env.model.script(/过载重试/, [(r) => (failed++ < 1 ? httpError(529, 'overloaded_error') : [say(`第 ${r.step} 步通过`)])]);
  const sid = await env.start('过载重试');
  await env.turns(sid, 1, 120_000);
  assert.ok(env.c.evs(sid, 'status').some((e) => e.status?.kind === 'retry'), 'a retry status was shown');
  assert.ok((await env.rt(sid)).items.some((i) => i.kind === 'text' && /通过/.test(i.text)));
});

test('Claude Code ending unexpectedly leaves a banner and a saved session (FR-OUT-07, FR-SES-13)', async () => {
  env.model.script(/崩溃前/, [[say('好')]]);
  const sid = await env.start('崩溃前');
  await env.turns(sid);
  const pid = (await env.rt(sid)).info?.pid;
  assert.ok(pid, 'the process id is known');
  execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  await until(() => env.c.sessions.get(sid)?.live === false, 'saved after the crash');
  const banner = await until(async () => (await env.rt(sid)).items.find((i) => i.kind === 'banner'), 'crash banner') as Extract<Item, { kind: 'banner' }>;
  assert.equal(banner.banner, 'crash');
  assert.equal(await env.c.call('resume', sid), true);
});

test('a long transcript comes a page at a time, earlier pages on request (FR-SES-06)', async () => {
  env.model.script(/^第 \d+ 问$/, [[say('答')]]);
  const sid = await env.start('第 1 问');
  await env.turns(sid);
  for (let i = 2; i <= 45; i++) {
    await env.c.call('send', sid, `第 ${i} 问`, {});
    await env.turns(sid, i);
  }
  assert.equal(finished(env.c, sid), 45);
  const last = await env.rt(sid);
  assert.ok(last.items.length <= 120, `last page ${last.items.length} items`);
  assert.equal(last.items[0].kind, 'user', 'a page starts at a prompt');
  assert.ok((last.earlier?.items ?? 0) > 0);
  const before = await env.c.call('earlierItems', sid, last.items[0].id);
  const all = [...before.items, ...last.items];
  const prompts = all.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user').map((u) => u.text);
  assert.deepEqual(prompts, Array.from({ length: 45 }, (_, k) => `第 ${k + 1} 问`));
  assert.equal(before.earlier, undefined, 'nothing before the first page');
});
