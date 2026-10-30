// MCP servers: status and tools from a probe, adding / editing / removing through Claude Code's own
// command with secrets masked, tool approval as rules, switching a server off in one session, tool
// search (FR-MCP-01..05, FR-MCP-09, FR-TOOL-15).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item, McpServer } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup({ prepare: (w) => {
    w.mcp('tracker', w.tracker());
    w.mcp('broken', w.tracker({ FAIL_START: '1' }));
  } });
});
after(() => env?.close());

const server = (name: string) => env.c.slices.mcp.find((m) => m.name === name);
const claudeJson = () => JSON.parse(env.world.read(path.join(env.world.home, '.claude.json')));
type Tool = Extract<Item, { kind: 'tool' }>;
const card = async (sid: string, name: string) => (await env.rt(sid)).items.flatMap((i) => (i.kind === 'tool' ? [i] : i.kind === 'toolgroup' ? i.tools : [])).find((t) => t.tool.includes(name)) as Tool;

test('a probe shows each server\'s status, its tools with their annotations, and why one failed (FR-MCP-02)', async () => {
  await env.c.call('refreshMcp');
  const t = await until(() => (server('tracker')?.status === 'connected' ? server('tracker') : null), 'tracker connected', 90_000);
  const tools = Object.fromEntries(t.tools.map((x) => [x.name, x.annotations]));
  assert.deepEqual(tools.list_issues, ['readOnly']);
  assert.deepEqual(tools.drop_all, ['destructive']);
  const b = await until(() => (server('broken')?.status === 'failed' ? server('broken') : null), 'broken failed', 90_000);
  assert.ok(b.status === 'failed');
});

test('a server added here is written by Claude Code\'s command; its secret is masked here and kept on edit; removal (FR-MCP-01)', async () => {
  const fresh: McpServer = {
    id: 'global::notes', name: 'notes', type: 'stdio', scope: 'global', command: process.execPath, args: [path.join(import.meta.dirname, '..', 'harness', 'mcp', 'tracker.mjs')],
    env: [{ key: 'API_TOKEN', value: 'secret-token-123456' }], timeout: 60, status: 'pending', instructionsTokens: 0, tools: [], prompts: [], offIn: [],
  };
  await env.c.call('setState', { mcp: [...env.c.slices.mcp, fresh] });
  await until(() => claudeJson().mcpServers?.notes, 'written to ~/.claude.json', 60_000);
  assert.equal(claudeJson().mcpServers.notes.env.API_TOKEN, 'secret-token-123456');
  const shown = await until(() => server('notes'), 'listed');
  assert.equal(shown.env?.[0].value, 'secr••••••', 'masked for the browser');
  await env.c.call('setState', { mcp: env.c.slices.mcp.map((m) => (m.name === 'notes' ? { ...m, timeout: 90 } : m)) });
  await until(() => claudeJson().mcpServers.notes?.timeout === 90_000, 'edited', 60_000);
  assert.equal(claudeJson().mcpServers.notes.env.API_TOKEN, 'secret-token-123456', 'the real secret is kept');
  await env.c.call('setState', { mcp: env.c.slices.mcp.filter((m) => m.name !== 'notes') });
  await until(() => !claudeJson().mcpServers?.notes, 'removed', 60_000);
});

test('a tool set to "deny" is refused by Claude Code (FR-MCP-02, FR-PERM-08)', async () => {
  await env.c.call('setState', { rules: [...env.c.slices.rules, { id: 'r-drop', behavior: 'deny', rule: 'mcp__tracker__drop_all', scope: 'global' }] });
  await until(() => JSON.parse(env.world.read(path.join(env.world.config, 'settings.json'))).permissions?.deny?.includes('mcp__tracker__drop_all'), 'rule written');
  env.model.script(/删光缺陷/, [[use('mcp__tracker__drop_all', {})], [say('好')]]);
  const sid = await env.start('删光缺陷', { mode: 'bypassPermissions' });
  await env.turns(sid);
  // Claude Code takes a denied MCP tool away altogether, so a call is refused one way or another.
  assert.ok(['denied', 'error'].includes((await card(sid, 'drop_all')).status));
  assert.ok(!env.model.sent(/删光缺陷/).some((r) => /全部删除了/.test(JSON.stringify(r.body.messages))), 'the server never ran it');
  await env.c.call('setState', { rules: env.c.slices.rules.filter((r) => r.id !== 'r-drop' && r.rule !== 'mcp__tracker__drop_all') });
});

test('switched off in one session only; the config stays (FR-MCP-03)', async () => {
  env.model.script(/^关掉之前$/, [[use('mcp__tracker__list_issues', {})], [say('好')]]);
  env.model.script(/^关掉之后$/, [[use('mcp__tracker__list_issues', {})], [say('好')]]);
  const sid = await env.start('关掉之前', { mode: 'bypassPermissions' });
  await env.turns(sid);
  assert.equal((await card(sid, 'list_issues')).status, 'ok');
  await env.c.call('toggleMcpInSession', sid, 'tracker', false);
  await env.c.call('send', sid, '关掉之后', {});
  await env.turns(sid, 2);
  const cards = (await env.rt(sid)).items.filter((i): i is Tool => i.kind === 'tool' && i.tool.includes('list_issues'));
  assert.notEqual(cards.at(-1)!.status, 'ok', 'not available any more in this session');
  assert.ok(claudeJson().mcpServers.tracker, 'config untouched');
  await env.c.call('toggleMcpInSession', sid, 'tracker', true);
});

test('tool search off gives Claude the MCP tools directly (FR-CTX-04)', async () => {
  env.model.script(/工具搜索/, [[say('好')]]);
  await env.c.call('setState', { mcpBehavior: { ...env.c.slices.mcpBehavior, toolSearch: 'off' } });
  const off = await env.start('工具搜索 关');
  await env.turns(off);
  assert.ok(env.model.sent(/工具搜索 关/)[0].tools.includes('mcp__tracker__list_issues'));
  await env.c.call('setState', { mcpBehavior: { ...env.c.slices.mcpBehavior, toolSearch: 'on' } });
  const on = await env.start('工具搜索 开');
  await env.turns(on);
  assert.ok(!env.model.sent(/工具搜索 开/)[0].tools.includes('mcp__tracker__list_issues'), 'deferred behind tool search');
});
