// Which hook events Claude Code calls back into the SDK host for. Code Agent's hook rules are such
// callbacks, so an event that never fires here makes rules on it do nothing (issue 10-30#13).
// Pinned on Claude Code 2.1.312.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { query, HOOK_EVENTS, type HookCallbackMatcher, type HookEvent, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { makeWorld, type World } from '../harness/world';
import { FakeModel, say, use, shell } from '../harness/fake-model';
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

test('the events that reach callbacks in a session with tools, a failure, a subagent, tasks and compaction', async () => {
  model.script(/^钩子一$/, [
    [use('Read', { file_path: '{cwd}/a.txt' })],
    [use('Read', { file_path: '{cwd}/missing.txt' })],
    [use('TaskCreate', { subject: '一项', description: '一项', activeForm: '做' })],
    [use('TaskUpdate', { taskId: '1', status: 'completed' })],
    [use('Agent', { description: '子任务', subagent_type: 'general-purpose', prompt: '子代理任务' })],
    (r) => shell('node -e "1"')(r),
    [say('完成')],
  ]);
  model.script(/^子代理任务$/, [[say('子代理做完了')]]);
  const fired = new Set<string>();
  const starts: string[] = [];
  const hooks = Object.fromEntries(HOOK_EVENTS.map((e) => [e, [{ hooks: [async (i: { source?: string }) => { fired.add(e); if (e === 'SessionStart') starts.push(String(i.source)); return {}; }] }]])) as Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  let push: (() => void) | undefined;
  const input = (async function* () {
    yield { type: 'user', message: { role: 'user', content: '钩子一' }, parent_tool_use_id: null } as SDKUserMessage;
    await new Promise<void>((r) => { push = r; });
    yield { type: 'user', message: { role: 'user', content: '/compact' }, parent_tool_use_id: null } as SDKUserMessage;
  })();
  const q = query({ prompt: input, options: {
    cwd: repo, model: 'model-one', env: cliEnv(world, model), persistSession: false, hooks, settingSources: ['project'],
    canUseTool: async (tool, i) => (tool === 'PowerShell' || tool === 'Bash' ? { behavior: 'deny', message: 'no' } : { behavior: 'allow', updatedInput: i }),
  } });
  let results = 0;
  for await (const m of q) {
    if (m.type === 'result' && ++results === 1) push?.();
    else if (m.type === 'result') break;
  }
  q.close();
  const got = [...fired].sort();
  console.log('fired:', got.join(' '));
  // What Code Agent relies on.
  for (const e of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStart', 'SubagentStop', 'PreCompact']) assert.ok(fired.has(e), `${e} fires`);
  // What does not fire as a callback (rules on it do nothing): pinned so a change shows.
  assert.ok(!starts.includes('startup'), `SessionStart is called back only after compaction, not at startup: ${starts.join(', ')}`);
  for (const e of ['TaskCreated', 'TaskCompleted', 'Notification', 'SessionEnd']) assert.equal(fired.has(e), false, `${e} is not called back here`);
});
