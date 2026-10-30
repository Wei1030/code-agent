// The workspace board: items and ids, the recorder and undo, Claude's board tools and what they tell
// Claude, import from pasted text and GitHub, Markdown export (custom feature 看板).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { setup, M2, type Env } from '../harness/env';
import { say, use, hang, httpError } from '../harness/fake-model';
import { until, sleep } from '../harness/client';
import type { Item } from '@code-agent/shared/types';

let env: Env;
/** The recorder's answer for the next turns. */
let recorderOps: unknown[] = [];
before(async () => {
  env = await setup({
    prepare: (w) => w.fakeGh([
      { number: 7, title: 'Checkout fails on empty cart', body: 'Steps…', url: 'https://github.com/acme/shop/issues/7', labels: [{ name: 'bug' }] },
      { number: 9, title: 'Add order export', body: 'CSV please', url: 'https://github.com/acme/shop/issues/9', labels: [] },
    ]),
  });
  env.model.structured((schema, req) => {
    if (schema?.properties?.operations) return { output: { operations: recorderOps } };
    if (schema?.properties?.rows) {
      const gh = [...req.prompt.matchAll(/GitHub #(\d+) (\S+)\nTitle: (.+)/g)].map((m) => ({ ref: `GitHub #${m[1]}`, url: m[2], kind: /fail/i.test(m[3]) ? 'issue' : 'feature', title: m[3], body: '', action: 'create', reason: '新条目' }));
      const lines = [...req.prompt.matchAll(/^- (.+)$/gm)].map((m, i) => ({ ref: `第 ${i + 1} 行`, kind: 'issue', title: m[1], body: '', action: 'create', reason: '新条目' }));
      return { output: { rows: gh.length ? gh : lines } };
    }
    return undefined;
  });
});
after(() => env?.close());

const board = () => env.c.slices.board.filter((b) => b.workspaceId === env.ws);

test('ids count per kind; edits are logged; delete removes', async () => {
  const f1 = await env.c.call('createItem', env.ws, { kind: 'feature', title: '分页' }, { kind: 'manual' });
  const f2 = await env.c.call('createItem', env.ws, { kind: 'feature', title: '导出' }, { kind: 'manual' });
  const i1 = await env.c.call('createItem', env.ws, { kind: 'issue', title: '金额错' }, { kind: 'manual' });
  const n1 = await env.c.call('createItem', env.ws, { kind: 'note', title: '用分存金额' }, { kind: 'manual' });
  assert.deepEqual([f1.id, f2.id, i1.id, n1.id], ['F-1', 'F-2', 'I-1', 'N-1']);
  assert.equal(f1.status, 'todo');
  assert.equal(i1.status, 'open');
  await env.c.call('updateItem', env.ws, 'F-1', { status: 'doing' }, '状态 → 进行中');
  await until(() => board().find((b) => b.id === 'F-1')?.status === 'doing', 'updated');
  assert.ok(board().find((b) => b.id === 'F-1')!.log.some((l) => /进行中/.test(l.text)));
  await env.c.call('deleteItem', env.ws, 'F-2');
  await until(() => !board().some((b) => b.id === 'F-2'), 'deleted');
});

test('the recorder records after a turn, unconfirmed; undo restores; confirm accepts', async () => {
  assert.equal(env.c.slices.boardSettings.recorder, false, 'off until the user turns it on');
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: true, recorderModel: 'haiku' } });
  recorderOps = [{ op: 'create', kind: 'issue', title: '自动记下的问题', body: '对话里确认过', status: 'confirmed', priority: 'high', note: '确认的缺陷' }];
  env.model.script(/确认一个缺陷/, [[say('确认了：退款金额少算一分钱，原因是四舍五入。')]]);
  const sid = await env.start('确认一个缺陷');
  await env.turns(sid);
  const item = await until(() => board().find((b) => b.title === '自动记下的问题'), 'recorded');
  assert.equal(item.unconfirmed, true);
  const card = await until(async () => (await env.rt(sid)).items.find((i) => i.kind === 'board') as Extract<Item, { kind: 'board' }> | undefined, 'board card in the transcript');
  assert.equal(card.by, 'recorder');
  assert.equal(card.model, `后台识别 · ${env.c.slices.models[0].label} · 思考低`, 'haiku is not offered without the login: the first model there is runs it, and the card says so');
  await env.c.call('undoBoardRecord', sid, card.id);
  await until(() => !board().some((b) => b.title === '自动记下的问题'), 'undone');
  assert.equal(((await env.rt(sid)).items.find((i) => i.id === card.id) as Extract<Item, { kind: 'board' }>).undone, true);

  recorderOps = [{ op: 'create', kind: 'note', title: '要确认的笔记', body: '内容', note: '决定' }];
  env.model.script(/定一个决定/, [[say('决定：金额统一用分存储，展示时换算成元，这个以后不再改。')]]);
  await env.c.call('send', sid, '定一个决定', {});
  const note = await until(() => board().find((b) => b.title === '要确认的笔记'), 'second record');
  await env.c.call('confirmItem', env.ws, note.id);
  await until(() => board().find((b) => b.id === note.id)?.unconfirmed === false, 'confirmed');
});

test('a check in progress shows in its session; stopping ends it with nothing recorded; stopping for good turns the recorder off (custom feature 看板)', async () => {
  recorderOps = [{ op: 'create', kind: 'note', title: '停掉就不该记', body: 'x', note: 'x' }];
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: true, recorderModel: M2 } });
  env.model.failModel('model-two', hang);
  env.model.script(/^停止分析/, [[say('这一轮说了足够多的内容，后台识别会来检查它要不要更新看板。')]]);
  const sid = await env.start('停止分析一');
  await env.turns(sid);
  const check = await until(async () => (await env.rt(sid)).boardCheck, 'the check shows');
  assert.equal(check.model, 'model-two');
  await env.c.call('stopBoardCheck', sid, false);
  await until(async () => (await env.rt(sid)).boardCheck === null, 'gone once stopped');
  assert.equal(env.c.slices.boardSettings.recorder, true);

  await env.c.call('send', sid, '停止分析二', {});
  await env.turns(sid, 2);
  await until(async () => (await env.rt(sid)).boardCheck, 'the next check shows');
  await env.c.call('stopBoardCheck', sid, true);
  await until(async () => (await env.rt(sid)).boardCheck === null, 'gone');
  assert.equal(env.c.slices.boardSettings.recorder, false, 'and no more checks');
  assert.ok(!board().some((b) => b.title === '停掉就不该记'));
  env.model.failModel('model-two', null);
});

test('a check that fails says why in its session for a while (custom feature 看板)', async () => {
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: true, recorderModel: M2 } });
  env.model.failModel('model-two', httpError(400, 'invalid_request_error', 'the endpoint said no'));
  env.model.script(/^分析失败$/, [[say('这一轮说了足够多的内容，后台识别会来检查它要不要更新看板。')]]);
  const sid = await env.start('分析失败');
  await env.turns(sid);
  const failed = await until(async () => (await env.rt(sid)).boardCheck?.error ? (await env.rt(sid)).boardCheck : null, 'the failure shows', 60_000);
  assert.match(failed!.error!, /\S/);
  await until(async () => (await env.rt(sid)).boardCheck === null, 'then goes', 20_000);
  env.model.failModel('model-two', null);
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: false, recorderModel: M2 } });
});

test('the recorder stays off when switched off, and for interrupted turns', async () => {
  recorderOps = [{ op: 'create', kind: 'issue', title: '不该记下', body: 'x', note: 'x' }];
  await env.c.call('setState', { boardSettings: { ...env.c.slices.boardSettings, recorder: false } });
  env.model.script(/关掉记录/, [[say('这一轮讨论了很多细节，但记录已经关掉了，不应该有任何条目被创建。')]]);
  const sid = await env.start('关掉记录');
  await env.turns(sid);
  await sleep(2500);
  assert.ok(!board().some((b) => b.title === '不该记下'));
});

test('Claude\'s board tools: search, create, a wrong status refused (custom feature 看板)', async () => {
  env.model.script(/用看板工具/, [
    [use('mcp__workspace__board_search', { query: '金额' })],
    [use('mcp__workspace__board_create', { kind: 'feature', title: 'Claude 建的功能', body: '由 Claude 新建' })],
    [use('mcp__workspace__board_update', { id: 'I-1', status: 'doing' })],
    [say('好')],
  ]);
  const sid = await env.start('用看板工具');
  await env.turns(sid);
  const created = board().find((b) => b.title === 'Claude 建的功能');
  assert.ok(created);
  assert.equal(created!.source.kind, 'agent');
  const results = JSON.stringify(env.model.sent(/用看板工具/).at(-1)!.body.messages);
  assert.match(results, /I-1/, 'search found the issue');
  assert.equal(board().find((b) => b.id === 'I-1')?.status, 'open', 'an issue cannot be "doing"');
});

test('the board needs nothing in the system prompt: its tools ask Claude to cite items by id (custom feature 看板)', async () => {
  // With tool search off the workspace tools come with their descriptions in the first request.
  const mb = env.c.slices.mcpBehavior;
  await env.c.call('setState', { mcpBehavior: { ...mb, toolSearch: 'off' } });
  env.model.script(/^看板说明$/, [[say('好')]]);
  const sid = await env.start('看板说明');
  await env.turns(sid);
  await env.c.call('setState', { mcpBehavior: mb });
  const req = env.model.sent(/^看板说明$/)[0];
  assert.equal((await env.rt(sid)).info?.prompt?.text, 'Always respond to the user in Simplified Chinese.', 'Code Agent adds only the reply language');
  assert.doesNotMatch(JSON.stringify(req.body), /Work in progress on the workspace board/, 'no features in progress at the start');
  const search = (req.body.tools as Array<{ name: string; description?: string }>).find((t) => t.name === 'mcp__workspace__board_search');
  assert.match(search?.description ?? '', /write its id/);
});

test('import pasted text: preview rows, apply creates; GitHub issues through gh; the same issue again is known', async () => {
  const rows = await env.c.call('importPreview', env.ws, 'paste', '- 列表加载慢\n- 登录偶尔失败');
  assert.deepEqual(rows.map((r) => [r.title, r.action]), [['列表加载慢', 'create'], ['登录偶尔失败', 'create']]);
  const ids = await env.c.call('applyImport', env.ws, rows);
  assert.equal(ids.length, 2);
  assert.ok(ids.every((id) => board().some((b) => b.id === id && b.source.kind === 'import')));

  const gh = await env.c.call('importPreview', env.ws, 'github', JSON.stringify({ repo: 'acme/shop' }));
  assert.deepEqual(gh.map((r) => r.ref), ['GitHub #7', 'GitHub #9']);
  await env.c.call('applyImport', env.ws, gh);
  const again = await env.c.call('importPreview', env.ws, 'github', JSON.stringify({ repo: 'acme/shop' }));
  assert.ok(again.every((r) => /^[FIN]-\d+$/.test(r.action)), 'merged into what came from it before');
  assert.match(again[0].reason, /就是从它导入的/);
});

test('the board exports as Markdown', async () => {
  const md = await env.c.call('boardMarkdown', env.ws);
  assert.match(md, /F-1 分页/);
  assert.match(md, /I-1 金额错/);
});
