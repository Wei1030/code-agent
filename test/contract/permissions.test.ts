// What Claude Code itself decides about permissions, run straight through the SDK. Code Agent shows
// these decisions as they are, so a change here (an SDK upgrade) changes what users see.
// Run on Windows, where a command is a PowerShell call as often as a Bash one (NFR-05).
// Pinned on Claude Code 2.1.312.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { query, type CanUseTool, type Options, type PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import { makeWorld, type World } from '../harness/world';
import { FakeModel, say, use, shell, plan, type Step } from '../harness/fake-model';
import { cliEnv } from '../harness/cli';

let world: World;
let model: FakeModel;
let repo: string;
let out: string;
before(async () => {
  world = makeWorld();
  model = await new FakeModel().start();
  repo = world.repo('main', { 'a.txt': 'one\n' });
  out = world.repo('outside', { 'x.txt': 'x\n' }, { git: false });
});
after(async () => { await model.close(); world.remove(); });

interface Ask { tool: string; input: Record<string, unknown>; suggestions: PermissionUpdate[]; reason?: string; blockedPath?: string }
let n = 0;
/** Run one prompt with these steps; every ask is answered with deny. */
async function run(steps: Step[], opts: Partial<Options> = {}, cwd = repo) {
  const tag = `契约${++n}`;
  model.script(new RegExp(tag), steps);
  const asks: Ask[] = [];
  const canUseTool: CanUseTool = async (tool, input, o) => {
    asks.push({ tool, input, suggestions: o.suggestions ?? [], reason: o.decisionReason as string | undefined, blockedPath: o.blockedPath });
    return { behavior: 'deny', message: 'no' };
  };
  const denials: string[] = [];
  const q = query({ prompt: tag, options: { cwd, model: 'model-one', env: cliEnv(world, model), settingSources: ['user', 'project', 'local'], persistSession: false, canUseTool, ...opts } });
  for await (const m of q) {
    if (m.type === 'result') {
      denials.push(...(m.permission_denials ?? []).map((d) => d.tool_name));
      break;
    }
  }
  return { asks, denials };
}
const shellName = () => model.requests.at(-1)!.tools.includes('Bash') ? 'Bash' : 'PowerShell';

test('a read outside the working directories asks, suggesting a read rule for that folder for the session', async () => {
  const { asks } = await run([[use('Read', { file_path: path.join(out, 'x.txt') })], [say('好')]]);
  assert.equal(asks.length, 1);
  assert.equal(asks[0].reason, 'Path is outside allowed working directories');
  assert.equal(asks[0].suggestions.length, 1);
  const s = asks[0].suggestions[0] as Extract<PermissionUpdate, { type: 'addRules' }>;
  assert.equal(s.type, 'addRules');
  assert.equal(s.destination, 'session');
  assert.equal(s.rules[0].toolName, 'Read');
  assert.match(s.rules[0].ruleContent ?? '', /outside\/\*\*$/);
});

test('a write outside asks, suggesting accept-edits mode and the folder as an extra directory', async () => {
  const { asks } = await run([[use('Write', { file_path: path.join(out, 'new.txt'), content: 'n' })], [say('好')]]);
  assert.equal(asks.length, 1);
  assert.deepEqual(asks[0].suggestions.map((s) => s.type), ['setMode', 'addDirectories']);
  assert.equal((asks[0].suggestions[0] as { mode: string }).mode, 'acceptEdits');
});

test('an edit inside asks in default mode, suggesting accept-edits; accept-edits mode does not ask', async () => {
  // Answered with deny, so a.txt keeps its text for the second run.
  const edit: Step = [use('Edit', { file_path: '{cwd}/a.txt', old_string: 'one', new_string: 'two' })];
  const d = await run([edit, [say('好')]]);
  assert.deepEqual(d.asks[0]?.suggestions.map((s) => s.type), ['setMode']);
  const a = await run([edit, [say('好')]], { permissionMode: 'acceptEdits' });
  assert.equal(a.asks.length, 0);
});

test('a command that changes things asks, suggesting the exact command for the local settings', async () => {
  const { asks } = await run([shell('node -e "console.log(1)"'), [say('好')]]);
  assert.equal(asks.length, 1);
  const s = asks[0].suggestions[0] as Extract<PermissionUpdate, { type: 'addRules' }>;
  assert.equal(s.destination, 'localSettings');
  assert.equal(s.rules[0].toolName, shellName());
  assert.equal(s.rules[0].ruleContent, 'node -e "console.log(1)"');
});

test('a read-only command inside does not ask; one reading outside asks with the blocked path', async () => {
  const inside = await run([shell('git status'), [say('好')]]);
  assert.equal(inside.asks.length, 0);
  const ls = await run([shell(`ls "${out}"`), [say('好')]]);
  assert.equal(ls.asks.length, 1);
  assert.ok(ls.asks[0].blockedPath?.endsWith('outside'), `blocked path: ${ls.asks[0].blockedPath}`);
});

test('don\'t-ask mode refuses without asking', async () => {
  const { asks, denials } = await run([[use('Write', { file_path: '{cwd}/dont-ask.txt', content: 'x' })], [say('好')]], { permissionMode: 'dontAsk' });
  assert.equal(asks.length, 0);
  assert.deepEqual(denials, ['Write']);
});

test('plan mode asks before an edit', async () => {
  const { asks } = await run([[use('Write', { file_path: '{cwd}/plan.txt', content: 'x' })], [say('好')]], { permissionMode: 'plan' });
  assert.equal(asks.length, 1);
});

test('a repository\'s committed allow rules apply only in a trusted folder; local rules always (issue 10-30#12)', async () => {
  const r = world.repo('committed', { 'README.md': 'x\n' });
  world.write(path.join(r, '.claude', 'settings.json'), { permissions: { allow: ['Bash(npm test)', 'PowerShell(npm test)'] } });
  const untrusted = await run([shell('npm test'), [say('好')]], {}, r);
  assert.equal(untrusted.asks.length, 1, 'not trusted: asked');
  world.write(path.join(world.home, '.claude.json'), { projects: { [r.split(path.sep).join('/')]: { hasTrustDialogAccepted: true } } });
  const trusted = await run([shell('npm test'), [say('好')]], {}, r);
  assert.equal(trusted.asks.length, 0, 'trusted: the rule applies');

  const l = world.repo('local-rule', { 'README.md': 'x\n' });
  world.write(path.join(l, '.claude', 'settings.local.json'), { permissions: { allow: ['Bash(npm test)', 'PowerShell(npm test)'] } });
  const local = await run([shell('npm test'), [say('好')]], {}, l);
  assert.equal(local.asks.length, 0, 'local rules need no trust');
});

test('an untrusted folder\'s committed settings: what widens permissions is ignored, deny rules, env and hooks apply (issue 10-30#12)', async () => {
  const r = world.repo('untrusted-settings', { 'secret.txt': 'secret\n' });
  const hookFile = path.join(r, 'hook-ran.txt');
  world.write(path.join(r, '.claude', 'settings.json'), {
    permissions: { allow: ['Bash(node -e *)', 'PowerShell(node -e *)'], deny: ['Read(./secret.txt)'], additionalDirectories: [out] },
    env: { MARK_ENV: 'from-project-settings' },
    hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: `node -e "require('fs').writeFileSync('${hookFile.split(path.sep).join('/')}', String(process.env.MARK_ENV))"` }] }] },
  });
  const { asks } = await run([
    shell('node -e "1"'),
    [use('Read', { file_path: '{cwd}/secret.txt' })],
    [use('Read', { file_path: path.join(out, 'x.txt') })],
    [say('好')],
  ], {}, r);
  const body = JSON.stringify(model.requests.at(-1)!.body.messages);
  assert.ok(asks.some((a) => a.tool === 'Bash' || a.tool === 'PowerShell'), 'allow rules ignored: the command asks');
  assert.ok(asks.some((a) => a.tool === 'Read' && String(a.input.file_path).endsWith('x.txt')), 'additionalDirectories ignored: reading there asks');
  assert.ok(!asks.some((a) => String(a.input.file_path ?? '').endsWith('secret.txt')) && !body.includes('secret\\n'), 'deny rules apply: refused without asking');
  assert.equal(existsSync(hookFile) && readFileSync(hookFile, 'utf8'), 'from-project-settings', 'hooks run, with the env set');
});

test('in plan mode the plan is written to a plan file; ExitPlanMode asks with its text', async () => {
  const { asks } = await run([...plan('# 契约计划\n\n1. 第一步\n'), [say('好')]], { permissionMode: 'plan' });
  assert.deepEqual(asks.map((a) => a.tool), ['ExitPlanMode'], 'writing the plan file is not asked');
  assert.match(String(asks[0].input.plan), /契约计划/);
  assert.match(String(asks[0].input.planFilePath), /plans[\\/].+\.md$/);
});

test('a Bash rule does not cover the same command run with PowerShell', async () => {
  const r = world.repo('shell-rule', { 'README.md': 'x\n' });
  world.write(path.join(r, '.claude', 'settings.local.json'), { permissions: { allow: ['Bash(node -e *)'] } });
  const { asks } = await run([shell('node -e "console.log(7)"'), [say('好')]], {}, r);
  const sh = shellName();
  if (sh === 'Bash') assert.equal(asks.length, 0, 'Bash: the rule applies');
  else assert.equal(asks.length, 1, 'PowerShell: a Bash rule does not apply');
});
