// Settings reach Claude Code: the 默认 profile option by option, instruction files, permission
// rules and extra directories from the rules page, model services and endpoints, environment
// variables, usage (FR-CFG-01/02/04, FR-PROMPT-01..05, FR-PERM-08, FR-WS-02, FR-MOD-01/03,
// FR-AUTH-01..04, FR-I18N-05, FR-COST-03, FR-TODO-02, FR-OBS-03).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setup, EP, M1, M2, type Env } from '../harness/env';
import { say, use, shell, httpError } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item, Profile } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup({ files: { 'CLAUDE.md': '# 仓库约定 MARK-REPO-CLAUDE\n', 'a.txt': 'x\n' }, server: { env: { MY_TOOL_HOME: 'from-server-env' } } });
});
after(() => env?.close());

let k = 0;
/** A fresh session's first request after changing the default profile. */
async function firstRequest(p: Partial<Profile>, o: { model?: string } = {}) {
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((x) => ({ ...x, ...p })) });
  const tag = `方案检查${++k}`;
  env.model.script(new RegExp(tag), [[say('好')]]);
  const sid = await env.start(tag, o);
  await env.turns(sid);
  await env.c.call('setState', { profiles: prev });
  return { req: env.model.sent(new RegExp(tag))[0], sid };
}

test('profile: tools switched off are not given to Claude; WebSearch never on an endpoint (FR-CFG-02)', async () => {
  const { req } = await firstRequest({ tools: env.c.slices.profiles[0].tools.filter((t) => t !== 'Bash' && t !== 'PowerShell' && t !== 'WebFetch') });
  assert.ok(!req.tools.includes('WebFetch'));
  assert.ok(!req.tools.includes('Bash') && !req.tools.includes('PowerShell'));
  assert.ok(req.tools.includes('Read'));
  assert.ok(!req.tools.includes('WebSearch'), 'WebSearch is for Claude models only');
});

test('profile: system prompt modes — appended text, custom, minimal (FR-PROMPT-01)', async () => {
  const a = await firstRequest({ promptMode: 'append', promptText: '追加的说明 MARK-APPEND' });
  assert.match(a.req.system, /MARK-APPEND/);
  assert.match(a.req.system, /Claude Code/, 'the Claude Code preset stays');
  const c = await firstRequest({ promptMode: 'custom', promptText: '完全自定义 MARK-CUSTOM' });
  assert.match(c.req.system, /MARK-CUSTOM/);
  const m = await firstRequest({ promptMode: 'minimal', promptText: '' });
  assert.match(m.req.system, /You are Claude, an AI assistant working in a software project/);
});

test('profile: which settings files are read; CLAUDE.md of the repository (FR-PROMPT-02, FR-PROMPT-03)', async () => {
  const on = await firstRequest({ sources: { user: true, project: true, local: true } });
  assert.match(JSON.stringify(on.req.body), /MARK-REPO-CLAUDE/);
  const off = await firstRequest({ sources: { user: true, project: false, local: true } });
  assert.doesNotMatch(JSON.stringify(off.req.body), /MARK-REPO-CLAUDE/);
});

test('profile: reply language line, by the profile and by the UI language (FR-I18N-05)', async () => {
  const ui = await firstRequest({ responseLanguage: 'ui' });
  assert.match(ui.req.system, /Always respond to the user in Simplified Chinese/);
  const conv = await firstRequest({ responseLanguage: 'conversation' });
  assert.doesNotMatch(conv.req.system, /Always respond to the user in/);
});

test('profile: "save sessions to disk" off leaves no transcript (FR-SES-03)', async () => {
  const projects = path.join(env.world.config, 'projects');
  const count = () => (existsSync(projects) ? readdirSync(projects).flatMap((d) => readdirSync(path.join(projects, d))).length : 0);
  const before = count();
  const p = env.c.slices.profiles[0];
  const { sid } = await firstRequest({ features: { ...p.features, persist: false } });
  assert.equal(count(), before, 'nothing written');
  assert.ok(sid);
});

test('profile: thinking and effort only for an endpoint model that takes them (FR-MOD-03, FR-MOD-04)', async () => {
  const one = await firstRequest({}, { model: M1 });
  assert.notEqual(one.req.body.thinking?.type, 'disabled');
  const two = await firstRequest({}, { model: M2 });
  assert.ok(!two.req.body.thinking || two.req.body.thinking.type === 'disabled', 'no thinking for model-two');
});

test('instruction files: listed, written, read by new sessions; only listed files (FR-PROMPT-03, FR-PROMPT-05)', async () => {
  const files = await env.c.call('listInstructions', env.ws);
  const user = files.find((f) => f.scope === 'global' && f.kind === 'claude')!;
  assert.equal(user.exists, false);
  await env.c.call('writeInstruction', user.id, '# 我的习惯 MARK-USER-CLAUDE\n');
  assert.ok(existsSync(path.join(env.world.config, 'CLAUDE.md')));
  assert.equal(await env.c.call('readInstruction', user.id), '# 我的习惯 MARK-USER-CLAUDE\n');
  const { req } = await firstRequest({});
  assert.match(JSON.stringify(req.body), /MARK-USER-CLAUDE/);
  await assert.rejects(env.c.call('writeInstruction', 'not-listed', 'x'), /不在列表里/);
});

test('rules page: a rule per scope goes to its file; an extra directory lets Claude read there (FR-PERM-08, FR-WS-02)', async () => {
  const outside = env.world.repo('shared-lib', { 'lib.txt': 'shared\n' }, { git: false });
  await env.c.call('setState', {
    rules: [...env.c.slices.rules, { id: 'g1', behavior: 'deny', rule: 'Bash(rm -rf *)', scope: 'global' }, { id: 'w1', behavior: 'allow', rule: 'Bash(npm run lint)', scope: 'workspace', workspaceId: env.ws }],
    dirs: [...env.c.slices.dirs, { id: 'd1', path: outside, scope: 'workspace', workspaceId: env.ws }],
  });
  const local = path.join(env.repo, '.claude', 'settings.local.json');
  await until(() => existsSync(local) && JSON.parse(readFileSync(local, 'utf8')).permissions?.additionalDirectories?.length, 'workspace settings written');
  const l = JSON.parse(readFileSync(local, 'utf8'));
  assert.deepEqual(l.permissions.allow, ['Bash(npm run lint)']);
  assert.ok(JSON.parse(readFileSync(path.join(env.world.config, 'settings.json'), 'utf8')).permissions.deny.includes('Bash(rm -rf *)'));
  env.model.script(/读共享库/, [[use('Read', { file_path: path.join(outside, 'lib.txt') })], [say('读到了')]]);
  const sid = await env.start('读共享库');
  await env.turns(sid);
  assert.equal((await env.rt(sid)).request, null, 'no approval for the extra directory');
  const read = (await env.rt(sid)).items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : [])).find((t) => t.tool === 'Read') as Extract<Item, { kind: 'tool' }>;
  assert.equal(read.status, 'ok');
});

test('endpoint: its token never reaches the browser; no token sends a placeholder, never a Claude login (FR-AUTH-01, NFR-04)', async () => {
  const hello = JSON.stringify(env.c.slices);
  assert.doesNotMatch(hello, /test-token/);
  assert.equal(env.c.slices.provider.endpoints[0].keySet, true);
  await env.c.call('setEndpointKey', EP, '');
  env.model.script(/没有令牌/, [[say('好')]]);
  const sid = await env.start('没有令牌');
  await env.turns(sid);
  assert.equal(env.model.sent(/没有令牌/)[0].headers.authorization, 'Bearer no-token');
  await env.c.call('setEndpointKey', EP, 'test-token');
});

test('endpoint: the test button reports success and a refused token (FR-AUTH-03)', async () => {
  const ok = await env.c.call('testModel', M1);
  assert.equal(ok.ok, true, ok.message);
  env.model.failModel('model-two', httpError(401, 'authentication_error', 'bad key'));
  const bad = await env.c.call('testModel', M2);
  assert.equal(bad.ok, false);
  assert.match(bad.message, /401/);
  env.model.failModel('model-two', null);
});

test('endpoint: a model\'s context window is the one Claude Code works with; unset, it assumes 200k (FR-MOD-01)', async () => {
  const windowOf = async (tag: string) => {
    env.model.script(new RegExp(tag), [[say('好')]]);
    const sid = await env.start(tag);
    await env.turns(sid);
    return until(async () => { const c = (await env.rt(sid)).context; return c.categories.length ? c.max : null; }, 'context usage');
  };
  assert.equal(await windowOf('默认窗口'), 200_000);
  const p = env.c.slices.provider;
  await env.c.call('setState', { provider: { ...p, endpoints: p.endpoints.map((e) => ({ ...e, models: e.models.map((m) => (m.name === 'model-one' ? { ...m, contextWindow: 640_000 } : m)) })) } });
  try {
    assert.equal(await windowOf('设了窗口'), 640_000);
  } finally {
    await env.c.call('setState', { provider: p });
  }
});

test('switching to a model of another endpoint restarts the process and keeps the conversation (FR-MOD-01)', async () => {
  env.model.script(/换模型前/, [[say('好')]]);
  env.model.script(/换模型后/, [[say('还记得')]]);
  const sid = await env.start('换模型前');
  await env.turns(sid);
  await env.c.call('setModel', sid, M2);
  await until(async () => (await env.rt(sid)).model === M2 && env.c.sessions.get(sid)?.live, 'switched');
  await env.c.call('send', sid, '换模型后', {});
  await until(() => env.model.sent(/换模型后/).length > 0, 'sent');
  const req = env.model.sent(/换模型后/)[0];
  assert.equal(req.model, 'model-two');
  assert.match(JSON.stringify(req.body.messages), /换模型前/);
});

test('removing an endpoint model moves the profile that named it; the board recorder keeps its choice (FR-AUTH-01)', async () => {
  const p = env.c.slices.provider;
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((x) => ({ ...x, model: M2 })), boardSettings: { ...env.c.slices.boardSettings, recorderModel: M2 } });
  await env.c.call('setState', { provider: { ...p, endpoints: p.endpoints.map((e) => ({ ...e, models: e.models.filter((m) => m.name !== 'model-two') })) } });
  await until(() => env.c.slices.profiles.every((x) => x.model === M1), 'the profile moved to a model that exists');
  assert.equal(env.c.slices.boardSettings.recorderModel, M2, 'its checks fail and say so instead');
  await env.c.call('setState', { provider: p, profiles: prev });
});

test('environment variables of the settings and of the server reach the commands Claude runs (FR-CFG-04)', async () => {
  await env.c.call('setState', { env: [{ id: 'e1', key: 'MY_SETTING_VAR', value: 'from-settings', note: '' }] });
  env.model.script(/看环境变量/, [shell('node -e "console.log(process.env.MY_SETTING_VAR + \'|\' + process.env.MY_TOOL_HOME)"'), [say('好')]]);
  const sid = await env.start('看环境变量', { mode: 'bypassPermissions' });
  await env.turns(sid);
  assert.match(JSON.stringify(env.model.sent(/看环境变量/).at(-1)!.body.messages), /from-settings\|from-server-env/);
});

test('profile: the task tools are given when switched on, left out when off (FR-TODO-02)', async () => {
  const on = await firstRequest({});
  assert.ok(on.req.tools.includes('TaskCreate'));
  const off = await firstRequest({ tools: env.c.slices.profiles[0].tools.filter((t) => t !== 'TaskCreate') });
  assert.ok(!off.req.tools.some((t) => /^Task(Create|Update|Get|List)$|^TodoWrite$/.test(t)), off.req.tools.join(', '));
});

test('output styles: built-in, user and workspace ones are listed; the profile\'s style reaches Claude (FR-PROMPT-04)', async () => {
  env.world.write(path.join(env.world.config, 'output-styles', 'brief.md'), '---\nname: Brief\ndescription: Short answers\n---\n\nAnswer in one line.\n');
  env.world.write(path.join(env.repo, '.claude', 'output-styles', 'reviewer.md'), '---\nname: Reviewer\ndescription: Like a reviewer\n---\n\nMARK-STYLE-REVIEWER: point out risks first.\n');
  const styles = await env.c.call('outputStyles', env.ws);
  assert.deepEqual(styles.filter((s) => s.source !== 'builtin').map((s) => [s.name, s.source]), [['Brief', 'global'], ['Reviewer', 'workspace']]);
  assert.ok(styles.some((s) => s.name === 'Explanatory' && s.source === 'builtin'));
  // Claude Code sends the style as a system message of the conversation.
  const { req } = await firstRequest({ outputStyle: 'Reviewer' });
  assert.match(JSON.stringify(req.body.messages), /MARK-STYLE-REVIEWER/);
  assert.doesNotMatch(JSON.stringify((await firstRequest({})).req.body), /MARK-STYLE-REVIEWER/, 'only with the style chosen');
});

// Claude Code keeps the system prompt it recorded first (test/contract/prompt.test.ts), so the
// prompt text reaches new sessions only; the tools, model and settings reach running ones.
test('applying a changed profile restarts running sessions once idle: the tools change, the conversation goes on (FR-CFG-01)', async () => {
  env.model.script(/换方案前/, [[say('好')]]);
  env.model.script(/换方案后/, [[say('好')]]);
  const sid = await env.start('换方案前');
  await env.turns(sid);
  const pid = (await env.rt(sid)).info?.pid;
  const prev = env.c.slices.profiles;
  await env.c.call('setState', { profiles: prev.map((x) => ({ ...x, tools: x.tools.filter((t) => t !== 'Grep') })) });
  assert.ok((await env.c.call('applyProfileToRunning')) >= 1);
  await until(async () => { const info = (await env.rt(sid)).info; return info?.pid && info.pid !== pid; }, 'a new process', 60_000);
  await env.c.call('send', sid, '换方案后', {});
  await env.turns(sid, 2);
  assert.ok(env.model.sent(/换方案前/)[0].tools.includes('Grep'));
  assert.ok(!env.model.sent(/换方案后/)[0].tools.includes('Grep'), 'the tool switched off is gone');
  assert.ok(JSON.stringify(env.model.sent(/换方案后/)[0].body.messages).includes('换方案前'), 'the conversation goes on');
  await env.c.call('setState', { profiles: prev });
});

test('OpenTelemetry: with export switched on, a collector at the address receives Claude Code\'s logs and metrics (FR-OBS-03)', async () => {
  const got: string[] = [];
  const collector = createServer((req, res) => { got.push(`${req.method} ${req.url} ${req.headers['content-type']}`); req.resume(); req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end('{}')); });
  await new Promise<void>((r) => collector.listen(0, '127.0.0.1', r));
  const prev = { runtime: env.c.slices.runtime, env: env.c.slices.env };
  await env.c.call('setState', {
    runtime: { ...prev.runtime, otel: true, otelEndpoint: `http://127.0.0.1:${(collector.address() as AddressInfo).port}`, otelMetrics: true, otelLogs: true, otelTraces: false, otelPrompts: false, otelTools: false },
    env: [...prev.env, { id: 'o1', key: 'OTEL_LOGS_EXPORT_INTERVAL', value: '500', note: '' }, { id: 'o2', key: 'OTEL_METRIC_EXPORT_INTERVAL', value: '1000', note: '' }],
  });
  env.model.script(/遥测导出/, [[say('好')]]);
  const sid = await env.start('遥测导出');
  await env.turns(sid);
  try {
    await until(() => got.some((g) => /^POST \/v1\/logs/.test(g)) && got.some((g) => /^POST \/v1\/metrics/.test(g)), 'logs and metrics at the collector', 30_000);
    assert.ok(got.every((g) => g.endsWith('application/x-protobuf')), `the default protocol: ${got.join(', ')}`);
  } finally {
    await env.c.call('setState', prev);
    collector.close();
  }
});

test('usage: tokens per day, workspace and model are recorded (FR-COST-03)', async () => {
  await env.c.call('refreshUsage');
  const u = await until(() => (Object.keys(env.c.slices.usage?.days ?? {}).length ? env.c.slices.usage : null), 'usage recorded');
  assert.match(JSON.stringify(u), new RegExp(env.ws));
});
