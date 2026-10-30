// Working on the same sessions in Code Agent and in the claude CLI: sessions started in the CLI are
// listed and opened, turns taken in the CLI show up, the copied resume command works.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { listSessions } from '@anthropic-ai/claude-agent-sdk';
import { setup, type Env } from '../harness/env';
import { say } from '../harness/fake-model';
import { until } from '../harness/client';
import { cli } from '../harness/cli';
import type { Item } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup();
  process.env.CLAUDE_CONFIG_DIR = env.world.config;
});
after(() => env?.close());

const users = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'user' }> => i.kind === 'user').map((u) => u.text);
const texts = (items: Item[]) => items.filter((i): i is Extract<Item, { kind: 'text' }> => i.kind === 'text').map((t) => t.text);

test('a session started in the CLI is listed as 外部, opens read-only and can be resumed', async () => {
  env.model.script(/命令行里问的/, [[say('命令行里答的')]]);
  const run = await cli(env.world, env.model, env.repo, '命令行里问的');
  // A workspace added again scans its folder for Claude Code's sessions.
  await env.c.call('removeWorkspace', env.ws);
  env.ws = (await env.c.call('addWorkspace', env.repo)).id;
  const s = await until(() => env.c.sessions.get(run.sessionId), 'listed', 30_000);
  assert.equal(s.tag, '外部');
  const rt = await env.rt(run.sessionId);
  assert.equal(rt.readOnly, true);
  assert.deepEqual(users(rt.items), ['命令行里问的']);
  assert.deepEqual(texts(rt.items), ['命令行里答的']);
  env.model.script(/在 Code Agent 里接着问/, [[say('接着答')]]);
  assert.equal(await env.c.call('resume', run.sessionId), true);
  await env.c.call('send', run.sessionId, '在 Code Agent 里接着问', {});
  await env.turns(run.sessionId);
  assert.match(JSON.stringify(env.model.sent(/在 Code Agent 里接着问/)[0].body.messages), /命令行里问的/);
});

test('turns taken in the CLI after Code Agent saved the session show up when it is opened again', async () => {
  env.model.script(/先在 Code Agent/, [[say('Code Agent 的回答')]]);
  env.model.script(/再到命令行/, [[say('命令行的回答')]]);
  const sid = await env.start('先在 Code Agent');
  await env.turns(sid);
  await env.c.call('stop', sid);
  await until(() => env.c.sessions.get(sid)?.live === false, 'saved');
  await cli(env.world, env.model, env.repo, '再到命令行', { resume: sid });
  const rt = await env.rt(sid);
  assert.deepEqual(users(rt.items), ['先在 Code Agent', '再到命令行']);
  assert.ok(rt.items.some((i) => i.kind === 'divider' && /在 Claude Code 里继续/.test(i.label)), 'marked as continued in the CLI');
  assert.deepEqual(texts(rt.items).slice(-1), ['命令行的回答']);
});

test('a title and tag set here are what the CLI lists', async () => {
  env.model.script(/起个名字/, [[say('好')]]);
  const sid = await env.start('起个名字');
  await env.turns(sid);
  await env.c.call('rename', sid, '命令行也能看到的名字');
  await env.c.call('tag', sid, '重要');
  await until(async () => {
    const s = (await listSessions({ dir: env.repo })).find((x) => x.sessionId === sid);
    return s?.customTitle === '命令行也能看到的名字' && s?.tag === '重要';
  }, 'seen through Claude Code');
});
