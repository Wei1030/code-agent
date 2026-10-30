// Workspaces and the session lifecycle: folders picked and added, the branch shown, removal; draft,
// first message, save, resume, rename, tag, fork, export, search, delete.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { setup, finished, type Env } from '../harness/env';
import { say, use, shell } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup({ files: { 'notes.txt': 'hello\n' } });
  // The SDK's session functions in this process read Claude Code's files of the test world.
  process.env.CLAUDE_CONFIG_DIR = env.world.config;
});
after(() => env?.close());

const texts = (items: Item[]) => items.filter((i) => i.kind === 'text').map((i) => (i as { text: string }).text);
const users = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user');
/** Claude Code's transcript file of a session in the test world. */
function transcript(sid: string): string | undefined {
  const root = path.join(env.world.config, 'projects');
  for (const d of existsSync(root) ? readdirSync(root) : []) {
    const f = path.join(root, d, `${sid}.jsonl`);
    if (existsSync(f)) return f;
  }
  return undefined;
}

test('workspaces: folders for the picker, a folder added once with its branch, a missing one refused (FR-WS-01, FR-WS-04)', async () => {
  const parent = path.dirname(env.repo);
  assert.ok((await env.c.call('listDir', parent)).some((d) => d.name === path.basename(env.repo) && d.dir), 'the repository folder is offered');
  assert.ok((await env.c.call('listDir', null)).length > 0, 'roots to start from');
  assert.equal((await env.c.call('addWorkspace', `${env.repo}${path.sep}`)).id, env.ws, 'the same folder is the same workspace');
  const branch = env.world.git(env.repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
  assert.equal(env.c.slices.workspaces.find((w) => w.id === env.ws)?.branch, branch);
  await assert.rejects(env.c.call('addWorkspace', path.join(parent, 'no-such-folder')), /文件夹不存在/);
  const plain = env.world.repo('plain', { 'readme.txt': 'x' }, { git: false });
  const ws = await env.c.call('addWorkspace', plain);
  assert.equal(ws.name, 'plain');
  assert.ok(!ws.branch, 'no branch outside git');
  assert.deepEqual((await env.c.call('listFiles', ws.id)).map((f) => f.name), ['readme.txt'], 'files without git too');
});

test('removing a workspace stops and drops its sessions; the folder and Claude Code\'s records stay (FR-WS-01)', async () => {
  const dir = env.world.repo('gone', { 'a.txt': 'a' });
  const ws = (await env.c.call('addWorkspace', dir)).id;
  env.model.script(/要移除的工作区/, [[say('好')]]);
  const sid = await env.start('要移除的工作区', { ws });
  await env.turns(sid);
  await env.c.call('removeWorkspace', ws);
  await until(() => !env.c.slices.workspaces.some((w) => w.id === ws) && !env.c.sessions.has(sid), 'workspace and session gone');
  assert.ok(existsSync(path.join(dir, 'a.txt')), 'the folder stays');
  assert.ok(transcript(sid), 'Claude Code\'s record stays');
});

test('a new session is a draft without a process until its first message (FR-SES-01)', async () => {
  const sid = crypto.randomUUID();
  await env.c.call('createDraft', env.ws, sid);
  const draft = await until(() => env.c.sessions.get(sid), 'draft summary');
  assert.equal(draft.draft, true);
  assert.equal(draft.live, false);
  assert.equal(draft.title, '新会话');
  env.model.script(/第一条消息/, [[say('收到。')]]);
  await env.c.call('send', sid, '这是第一条消息，标题取它前面二十四个字，后面的不要了', {});
  await env.turns(sid);
  const s = env.c.sessions.get(sid)!;
  assert.equal(s.draft, false);
  assert.equal(s.live, true);
  assert.equal(s.title, `${'这是第一条消息，标题取它前面二十四个字，后面的不要了'.slice(0, 24)}…`);
  assert.equal(s.firstPrompt, '这是第一条消息，标题取它前面二十四个字，后面的不要了');
});

test('a saved session refuses messages, and resumes with its conversation (FR-SES-07, FR-SES-13)', async () => {
  env.model.script(/记住暗号/, [[say('记住了：青蛙。')]]);
  env.model.script(/暗号是什么/, [[say('是青蛙。')]]);
  const sid = await env.start('记住暗号：青蛙');
  await env.turns(sid);
  await env.c.call('stop', sid);
  await until(() => env.c.sessions.get(sid)?.live === false, 'saved');
  await assert.rejects(env.c.call('send', sid, '暗号是什么？', {}), /会话已保存/);
  assert.equal(await env.c.call('resume', sid), true);
  await until(() => env.c.sessions.get(sid)?.live, 'live again');
  await env.c.call('send', sid, '暗号是什么？', {});
  await env.turns(sid, 2);
  const req = env.model.sent(/暗号是什么/)[0];
  assert.match(JSON.stringify(req.body.messages), /记住暗号：青蛙/, 'the resumed process sends the earlier conversation');
  assert.deepEqual(texts((await env.rt(sid)).items).slice(-1), ['是青蛙。']);
});

test('rename and tag reach Claude Code\'s own session info; a tag can be cleared (FR-SES-08)', async () => {
  env.model.script(/改名测试/, [[say('好。')]]);
  const sid = await env.start('改名测试');
  await env.turns(sid);
  await env.c.call('rename', sid, '新的名字');
  await env.c.call('tag', sid, '重要');
  assert.equal(env.c.sessions.get(sid)?.title, '新的名字');
  assert.equal(env.c.sessions.get(sid)?.tag, '重要');
  await until(async () => {
    const info = await getSessionInfo(sid, { dir: env.repo });
    return info?.customTitle === '新的名字' && info?.tag === '重要';
  }, 'title and tag in Claude Code');
  await env.c.call('tag', sid, null);
  assert.equal(env.c.sessions.get(sid)?.tag, null);
  await until(async () => !(await getSessionInfo(sid, { dir: env.repo }))?.tag, 'tag cleared in Claude Code');
});

test('fork the whole session, or before a message with the rest left out (FR-SES-10, FR-SES-11)', async () => {
  env.model.script(/分叉一号/, [[say('一号回答')]]);
  env.model.script(/分叉二号/, [[say('二号回答')]]);
  const sid = await env.start('分叉一号');
  await env.turns(sid);
  await env.c.call('send', sid, '分叉二号', {});
  await env.turns(sid, 2);
  const items = (await env.rt(sid)).items;

  const whole = await env.c.call('forkAt', sid);
  const w = await until(() => env.c.sessions.get(whole), 'fork summary');
  assert.equal(w.forkedFrom, env.c.sessions.get(sid)?.title, 'the list says where it came from');
  assert.match(w.title, /（分叉）$/);
  assert.deepEqual(texts((await env.rt(whole)).items), ['一号回答', '二号回答']);

  const second = users(items)[1];
  const part = await env.c.call('forkAt', sid, second.id);
  const pItems = (await env.rt(part)).items;
  assert.deepEqual(users(pItems).map((u) => u.text), ['分叉一号']);
  assert.deepEqual(texts(pItems), ['一号回答']);
  assert.equal((await env.rt(part)).turn, 1, 'the fork has had one turn');
  // Its tokens are those of the turns it took over; its context is read once it runs.
  const firstTurn = (items.find((i) => i.kind === 'footer') as Extract<Item, { kind: 'footer' }>).tokens;
  assert.equal((await env.rt(part)).tokens, firstTurn);
  assert.equal(env.c.sessions.get(part)?.tokens, firstTurn);
  assert.ok(firstTurn < (await env.rt(sid)).tokens);
  // It continues from there: Claude Code sees the first exchange only.
  await until(() => env.c.sessions.get(part)?.live, 'fork resumed');
  await until(() => env.c.evs(part, 'context').length > 0, 'the fork\'s own context read');
  env.model.script(/分叉三号/, [[say('三号回答')]]);
  await env.c.call('send', part, '分叉三号', {});
  await until(async () => texts((await env.rt(part)).items).includes('三号回答'), 'fork answers');
  const sent = JSON.stringify(env.model.sent(/分叉三号/)[0].body.messages);
  assert.match(sent, /分叉一号/);
  assert.doesNotMatch(sent, /分叉二号/);
});

test('a fork takes the conversation, not the state of the original: no request waiting, no card left running (FR-SES-10)', async () => {
  env.model.script(/^等批准时分叉$/, [shell('node -e "console.log(1)"'), [say('跑完了')]]);
  const sid = await env.start('等批准时分叉');
  const req = await env.request(sid, 'approval');
  await until(() => env.c.sessions.get(sid)?.requests?.length, 'the original waits on the user');
  const fork = await env.c.call('forkAt', sid);
  const f = await until(() => env.c.sessions.get(fork), 'the fork');
  assert.equal(f.requests, undefined, 'nothing waits on the user in the fork');
  const cards = (await env.rt(fork)).items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : []));
  assert.ok(cards.every((c) => c.status !== 'waiting' && c.status !== 'running'), 'its copied cards are not running');
  await env.c.call('respondApproval', sid, req.id, { behavior: 'deny' });
  await env.turns(sid);
});

test('export gives the conversation as Markdown (FR-SES-15)', async () => {
  env.model.script(/导出测试/, [[say('先读文件。'), use('Read', { file_path: '{cwd}/notes.txt' })], [say('读完了。')]]);
  const sid = await env.start('导出测试');
  await env.turns(sid);
  const md = await env.c.call('exportMarkdown', sid);
  assert.match(md, /^# 导出测试/);
  assert.match(md, /导出测试/);
  assert.match(md, /先读文件。/);
  assert.match(md, /Read/);
  assert.match(md, /读完了。/);
});

test('search finds words in the conversation, long and short, Chinese without spaces (FR-SES-05, FR-I18N-08)', async () => {
  env.model.script(/搜索素材/, [[say('仓库里的结算模块用的是 decimal 金额，退款走异步队列。')]]);
  const sid = await env.start('搜索素材');
  await env.turns(sid);
  await new Promise((r) => setTimeout(r, 800));
  for (const q of ['退款走异步', '结算', 'decimal']) {
    const hits = await env.c.call('searchSessions', q);
    assert.ok(hits.some((h) => h.sessionId === sid), `"${q}" finds the session`);
  }
  assert.ok(!(await env.c.call('searchSessions', '不存在的词语组合')).some((h) => h.sessionId === sid));
});

test('delete removes the session here and Claude Code\'s transcript (FR-SES-09)', async () => {
  env.model.script(/删除测试/, [[say('好。')]]);
  const sid = await env.start('删除测试');
  await env.turns(sid);
  const file = await until(() => transcript(sid), 'transcript file');
  await env.c.call('stop', sid);
  await env.c.call('remove', sid);
  await until(() => !env.c.sessions.has(sid), 'session gone from the list');
  assert.equal(await env.c.call('openSession', sid), null);
  await until(() => !existsSync(file), 'transcript deleted');
});

test('a turn counts once from working back to idle', async () => {
  env.model.script(/计数测试/, [[say('一')]]);
  const sid = await env.start('计数测试');
  await env.turns(sid);
  assert.equal(finished(env.c, sid), 1);
  assert.equal(env.c.sessions.get(sid)?.state, 'idle');
});
