// Claude Code records a session's first system prompt in its transcript and sends that record on
// every later request and resume, whatever a later launch passes; the tools follow the new launch.
// Code Agent says so where a changed profile is applied to running sessions (issue 10-30#17).
// Pinned on Claude Code 2.1.312.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { makeWorld, type World } from '../harness/world';
import { FakeModel, say } from '../harness/fake-model';
import { cliEnv } from '../harness/cli';

let world: World;
let model: FakeModel;
let repo: string;
before(async () => {
  world = makeWorld();
  model = await new FakeModel().start();
  repo = world.repo('main', { 'a.txt': 'one\n' });
});
after(async () => { await model.close(); world.remove(); });

async function run(prompt: string, opts: Partial<Options>) {
  const q = query({ prompt, options: { cwd: repo, model: 'model-one', env: cliEnv(world, model), settingSources: [], ...opts } });
  for await (const m of q) if (m.type === 'result') break;
  return model.sent(new RegExp(`^${prompt}$`)).at(-1)!;
}

test('a resumed session keeps the system prompt it started with; the tools follow the new launch', async () => {
  model.script(/^第[一二三]句$/, [[say('好')]]);
  const sid = crypto.randomUUID();
  const first = await run('第一句', { sessionId: sid, systemPrompt: { type: 'preset', preset: 'claude_code', append: 'MARK-FIRST' } });
  assert.match(first.system, /MARK-FIRST/);
  const second = await run('第二句', { resume: sid, systemPrompt: { type: 'preset', preset: 'claude_code', append: 'MARK-SECOND' }, disallowedTools: ['Grep'] });
  assert.match(second.system, /MARK-FIRST/);
  assert.doesNotMatch(JSON.stringify(second.body), /MARK-SECOND/);
  assert.ok(first.tools.includes('Grep') && !second.tools.includes('Grep'), 'the tools are the new launch\'s');
  const third = await run('第三句', { resume: sid, systemPrompt: { type: 'custom', prompt: 'MARK-CUSTOM' } });
  assert.match(third.system, /MARK-FIRST/, 'a custom prompt does not replace it either');
});
