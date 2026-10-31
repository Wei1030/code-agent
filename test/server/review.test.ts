// The code review loop: checks, the read-only reviewer, rounds, the author's answers, the user's
// decisions, the record (custom feature 代码审核, issues 10-30#4 and 10-30#10).
import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use, shell, type Block, type Req } from '../harness/fake-model';
import { until, sleep } from '../harness/client';
import type { ReviewTicket } from '@code-agent/shared/types';

let env: Env;
/** What the reviewer answers in round n: a verdict, or blocks (tool calls) first. */
let reviewer: (round: number, req: Req) => { output?: unknown; blocks?: Block[] } | undefined;
const pass = { verdict: 'pass', summary: '没有问题', findings: [], rulings: [] };
const major = (title: string) => ({ verdict: 'changes_requested', summary: '有一处要改', findings: [{ severity: 'major', file: 'src/calc.js', line: 1, title, scenario: 'add(0, -1) 返回 1，应该是 -1', detail: '边界值没有处理' }], rulings: [] });

before(async () => {
  env = await setup({ files: { 'package.json': { name: 'calc', scripts: { test: 'node -e "process.exit(0)"' } }, 'src/calc.js': 'export const add = (a, b) => a + b;\n' } });
  env.model.structured((schema, req) => {
    if (!schema?.properties?.verdict) return undefined;
    return reviewer(Number(/Review round (\d+)/.exec(req.prompt)?.[1] ?? 1), req);
  });
  // The author answers review messages: fix the file, answer every finding as fixed.
  env.model.script(/代码审核第 \d+ 轮打回|用户追加了审核轮数/, [
    [use('Edit', { file_path: '{cwd}/src/calc.js', old_string: 'a + b', new_string: '(a ?? 0) + (b ?? 0)' })],
    (r) => [use('mcp__workspace__respond_findings', { answers: [...r.prompt.matchAll(/^- (R\d+) /gm)].map((m) => ({ id: m[1], status: 'fixed', text: '改了' })) })],
    [say('都处理了')],
  ]);
  env.model.script(/运行验证没有通过/, [[say('看过了，先这样')]]);
});
after(() => env?.close());
beforeEach(() => { reviewer = () => ({ output: pass }); });

const ticket = (id: string) => env.c.slices.reviews.find((t) => t.id === id) as ReviewTicket;
const ended = (id: string, ...status: ReviewTicket['status'][]) => until(() => status.includes(ticket(id)?.status), `review ${status.join('/')}`, 120_000);
/** A session that changed a file, idle, ready for review. */
async function changed(tag: string) {
  env.model.script(new RegExp(`^${tag}$`), [[use('Write', { file_path: `{cwd}/src/${tag}.js`, content: 'export const x = 1;\n' })], [say('写好了')]]);
  const sid = await env.start(tag, { mode: 'acceptEdits' });
  await env.turns(sid);
  return sid;
}

test('suggested checks come from the project files', async () => {
  assert.deepEqual(await env.c.call('suggestChecks', env.ws), ['npm test']);
});

test('a pass in round 1: checks run, snapshots are taken, the branch and index are untouched', async () => {
  const sid = await changed('一轮通过');
  const before = env.world.git(env.repo, 'status', '--porcelain');
  const head = env.world.git(env.repo, 'rev-parse', 'HEAD');
  const id = (await env.c.call('startReview', sid, ['node -e "process.exit(0)"'], {}))!;
  assert.ok(id);
  await ended(id, 'passed');
  const t = ticket(id);
  assert.equal(t.rounds.length, 1);
  assert.equal(t.rounds[0].checks.at(-1)?.commands[0].ok, true);
  assert.match(env.world.git(env.repo, 'show-ref'), new RegExp(`refs/code-agent/review/${id}/r1`));
  assert.equal(env.world.git(env.repo, 'status', '--porcelain'), before);
  assert.equal(env.world.git(env.repo, 'rev-parse', 'HEAD'), head);
  assert.deepEqual(env.c.slices.reviewChecks[env.ws], ['node -e "process.exit(0)"'], 'checks remembered per workspace');
  assert.ok(env.c.notices.some((n) => /代码审核通过/.test(n.title)));
});

test('changes requested: the author answers, round 2 rules on it and passes; the record and Markdown', async () => {
  const sid = await changed('打回一次');
  reviewer = (n) => ({ output: n === 1 ? major('没处理 undefined') : { ...pass, rulings: [{ id: 'R1', status: 'verified', note: '改对了' }] } });
  const id = (await env.c.call('startReview', sid, [], {}))!;
  await ended(id, 'passed');
  const t = ticket(id);
  assert.equal(t.rounds.length, 2);
  assert.equal(t.findings[0].id, 'R1');
  assert.equal(t.findings[0].status, 'verified');
  assert.equal(t.findings[0].response, '改了');
  assert.equal(t.findings[0].scenario, 'add(0, -1) 返回 1，应该是 -1');
  const md = await env.c.call('reviewMarkdown', id);
  assert.match(md, /R1/);
  assert.match(md, /没处理 undefined/);
  assert.match(md, /失败场景：add\(0, -1\) 返回 1/);
  assert.match(md, /第 2 轮/);
  // The author got the scenario with the finding; the reviewer is asked for one.
  assert.ok(env.model.requests.some((r) => /代码审核第 1 轮打回/.test(r.prompt) && /失败场景：add\(0, -1\) 返回 1/.test(r.prompt)), 'the author sees it');
  assert.ok(env.model.requests.some((r) => r.tools.includes('StructuredOutput') && /Every finding names its failure scenario/.test(r.prompt)), 'the reviewer is asked');
});

test('the verdict is Code Agent\'s: "pass" with an open major finding is sent back', async () => {
  const sid = await changed('自称通过');
  reviewer = (n) => ({ output: n === 1 ? { ...major('其实有问题'), verdict: 'pass' } : { ...pass, rulings: [{ id: 'R1', status: 'verified', note: '好' }] } });
  const id = (await env.c.call('startReview', sid, [], {}))!;
  await ended(id, 'passed');
  assert.equal(ticket(id).rounds[0].verdict, 'changes_requested');
});

test('checks failing three times wait for the user; more rounds, accept or take over (FR review decisions)', async () => {
  const sid = await changed('验证不过');
  const id = (await env.c.call('startReview', sid, ['node -e "process.exit(1)"'], {}))!;
  await ended(id, 'checks_failed');
  assert.equal(ticket(id).rounds[0].checks.length, 3);
  assert.ok(env.c.sessions.get(sid)?.state !== undefined);
  await env.c.call('decideReview', sid, 'takeover');
  await ended(id, 'stopped');
  assert.match(ticket(id).note ?? '', /由你接手/);
});

test('five rounds without a pass wait for the user; "accept" ends it, unsolved findings noted', async () => {
  const sid = await changed('五轮不过');
  reviewer = (n) => ({ output: major(`第 ${n} 轮的问题`) });
  const id = (await env.c.call('startReview', sid, [], {}))!;
  await ended(id, 'needs_decision');
  assert.equal(ticket(id).rounds.length, 5);
  assert.ok(env.c.sessions.get(sid)?.requests === undefined, 'not an approval');
  await env.c.call('decideReview', sid, 'accept');
  await ended(id, 'accepted');
  assert.match(ticket(id).note ?? '', /接受了现状/);
});

test('a reviewer giving no verdict twice leaves the decision to the user', async () => {
  const sid = await changed('没有结论');
  reviewer = () => ({ blocks: [say('我不想给结论')] });
  const id = (await env.c.call('startReview', sid, [], {}))!;
  await ended(id, 'needs_decision');
  assert.match(ticket(id).note ?? '', /没有给出结论/);
  await env.c.call('decideReview', sid, 'takeover');
});

test('stopping a review, and a finding put on the board once', async () => {
  const sid = await changed('停止审核');
  reviewer = () => ({ output: major('要记到看板的问题') });
  const id = (await env.c.call('startReview', sid, [], {}))!;
  await until(() => ticket(id)?.findings.length > 0, 'a finding');
  await env.c.call('stopReview', sid);
  await ended(id, 'stopped');
  const item = await env.c.call('findingToBoard', id, 'R1');
  assert.ok(item);
  assert.equal(await env.c.call('findingToBoard', id, 'R1'), item, 'the same item the second time');
  assert.ok(env.c.slices.board.some((b) => b.id === item && /要记到看板的问题/.test(b.title) && /^失败场景：add\(0, -1\) 返回 1/.test(b.body)), 'with its failure scenario');
});

test('stopping a review stops its check command, not only the shell around it', async () => {
  const sid = await changed('停掉验证');
  const late = path.join(env.repo, 'late.txt');
  const id = (await env.c.call('startReview', sid, [`node -e "setTimeout(() => require('fs').writeFileSync('late.txt', 'x'), 4000)"`], {}))!;
  await until(() => ticket(id)?.status === 'checking', 'checking');
  await sleep(1000);
  await env.c.call('stopReview', sid);
  await ended(id, 'stopped');
  await sleep(5000);
  assert.equal(existsSync(late), false, 'the check command was still running');
});

test('a server restart stops a running review', async () => {
  const sid = await changed('重启审核');
  const id = (await env.c.call('startReview', sid, [`node -e "setTimeout(() => {}, 60000)"`], {}))!;
  await until(() => ticket(id)?.status === 'checking', 'checking');
  await env.restart();
  await until(() => ticket(id)?.status === 'stopped', 'stopped by the restart');
  assert.match(ticket(id).note ?? '', /服务重启/);
});

test('a message the user sends during a review waits until the review ends (issue 10-30#10)', async () => {
  const sid = await changed('审核中插话');
  await env.c.call('resume', sid);
  reviewer = (n) => ({ output: n === 1 ? major('第一轮问题') : { ...pass, rulings: [{ id: 'R1', status: 'verified', note: '好' }] } });
  env.model.script(/用户插话/, [[say('收到插话')]]);
  const id = (await env.c.call('startReview', sid, [], {}))!;
  const order: string[] = [];
  const stop = env.c.on((m) => {
    if (m.t === 'app' && m.patch.reviews) order.push(`review:${m.patch.reviews.find((t) => t.id === id)?.status}`);
    if (m.t === 'ev' && m.sid === sid && m.ev.t === 'item.add' && m.ev.item.kind === 'user' && m.ev.item.text === '用户插话') order.push('sent');
  });
  await until(() => ticket(id)?.status === 'fixing', 'the author fixing');
  // Right as the author's turn ends the session is idle for a moment: the message must still wait.
  await until(() => !env.c.evs(sid, 'state').length || env.c.sessions.get(sid)?.state === 'idle', 'between turns', 30_000).catch(() => undefined);
  await env.c.call('send', sid, '用户插话', {});
  await ended(id, 'passed');
  await until(() => order.includes('sent'), 'sent at last');
  stop();
  const sentAt = order.indexOf('sent');
  assert.ok(order.slice(0, sentAt).includes('review:passed'), `sent only after the review ended: ${order.join(', ')}`);
});

test('"after tools" sent while the author writes its last words of a review answer waits for the review to end (review R9)', async () => {
  const sid = await changed('审核中工具后');
  await env.c.call('resume', sid);
  reviewer = (n) => ({ output: n === 1 ? major('第一轮问题') : { ...pass, rulings: [{ id: 'R1', status: 'verified', note: '好' }] } });
  // This session's author ends its answer slowly, so the message comes in while it writes, no tool call left.
  env.model.script((r) => /代码审核第 \d+ 轮打回/.test(r.prompt) && JSON.stringify(r.body.messages).includes('审核中工具后'), [
    [use('Edit', { file_path: '{cwd}/src/calc.js', old_string: 'a + b', new_string: '(a ?? 0) + (b ?? 0)' })],
    (r) => [use('mcp__workspace__respond_findings', { answers: [...r.prompt.matchAll(/^- (R\d+) /gm)].map((m) => ({ id: m[1], status: 'fixed', text: '改了' })) })],
    [say('总结一下这一轮改了什么，'.repeat(60))],
  ], { slow: 50 });
  env.model.script(/顺便改 README/, [[say('README 改了')]]);
  const id = (await env.c.call('startReview', sid, [], {}))!;
  const order: string[] = [];
  const stop = env.c.on((m) => {
    if (m.t === 'app' && m.patch.reviews) order.push(`review:${m.patch.reviews.find((t) => t.id === id)?.status}`);
    if (m.t === 'ev' && m.sid === sid && m.ev.t === 'item.add' && m.ev.item.kind === 'user' && m.ev.item.text === '顺便改 README') order.push('sent');
  });
  await until(async () => ticket(id)?.status === 'fixing' && (await env.rt(sid)).items.some((i) => i.kind === 'text' && i.streaming && /总结一下/.test(i.text)), 'the author writing its last words', 60_000);
  await env.c.call('send', sid, '顺便改 README', { priority: 'next' });
  assert.equal((await env.rt(sid)).queue.find((m) => m.text === '顺便改 README')?.sent, undefined, 'not handed to Claude Code while the review holds the queue');
  await ended(id, 'passed');
  await until(() => order.includes('sent'), 'sent at last');
  stop();
  assert.ok(order.slice(0, order.indexOf('sent')).includes('review:passed'), `sent only after the review ended: ${order.join(', ')}`);
});

test('the reviewer cannot change files, even with a trusted repository allowing the command (issue 10-30#4)', async () => {
  const sid = await changed('只读审核');
  env.world.write(path.join(env.repo, '.claude', 'settings.json'), { permissions: { allow: ['Bash(node -e *)', 'PowerShell(node -e *)'] } });
  env.world.write(path.join(env.world.home, '.claude.json'), { ...JSON.parse(env.world.read(path.join(env.world.home, '.claude.json'))), projects: { [env.repo.split(path.sep).join('/')]: { hasTrustDialogAccepted: true } } });
  env.world.write(path.join(env.repo, 'CLAUDE.md'), '# 约定\n\n金额一律用分为单位 MARK-CLAUDE-MD\n');
  await env.c.call('setState', { reviewProfile: { ...env.c.slices.reviewProfile, claudeMd: true } });
  const target = path.join(env.repo, 'pwned.txt');
  reviewer = (_n, req) => (req.step === 0 ? { blocks: shell(`node -e "require('fs').writeFileSync('pwned.txt', 'x')"`)(req) } : { output: pass });
  const id = (await env.c.call('startReview', sid, [], {}))!;
  await ended(id, 'passed', 'needs_decision');
  await sleep(500);
  assert.equal(existsSync(target), false, 'the reviewer wrote a file');
  assert.ok(env.model.requests.some((r) => r.tools.includes('StructuredOutput') && /MARK-CLAUDE-MD/.test(r.system)), 'the reviewer still reads CLAUDE.md');
  await env.c.call('setState', { reviewProfile: { ...env.c.slices.reviewProfile, claudeMd: false } });
});
