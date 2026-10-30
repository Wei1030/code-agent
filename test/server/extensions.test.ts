// Skills, commands, plugins and subagents: listed from their files, created and edited as files,
// switched off for new sessions, reloaded in running ones (FR-SKILL-01..04, FR-PLUG-01..03,
// FR-AGT-01/02, FR-TOOL-07).
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { setup, type Env } from '../harness/env';
import { say, use } from '../harness/fake-model';
import { until } from '../harness/client';
import type { Item, SkillInfo } from '@code-agent/shared/types';

let env: Env;
before(async () => {
  env = await setup({ files: {
    '.claude/skills/api-docs/SKILL.md': '---\nname: api-docs\ndescription: 生成接口文档\n---\n\n# api-docs\n',
    '.claude/commands/standup.md': '---\ndescription: 写站会摘要\nargument-hint: "<日期>"\n---\n\n总结 $ARGUMENTS 的提交。\n',
  }, prepare: (w) => {
    w.write(path.join(w.config, 'skills', 'commit-msg', 'SKILL.md'), '---\nname: commit-msg\ndescription: 写提交信息\n---\n\n# commit-msg\n');
    w.write(path.join(w.config, 'agents', 'test-writer.md'), '---\nname: test-writer\ndescription: 补测试\ntools: Read, Write\n---\n\n你只写测试。\n');
  } });
});
after(() => env?.close());

const skill = (name: string) => env.c.slices.skills.find((s) => s.name === name);
const skillText = (r: { body: unknown }) => JSON.stringify(r.body);

test('skills and commands are listed from the workspace and the user folder (FR-SKILL-01)', async () => {
  await env.c.call('refreshExtensions');
  await until(() => skill('api-docs') && skill('commit-msg'), 'skills listed');
  assert.equal(skill('api-docs')!.source, 'workspace');
  assert.equal(skill('commit-msg')!.source, 'global');
  await until(() => env.c.slices.commandFiles.find((c) => c.name === 'standup'), 'command listed');
  assert.equal(env.c.slices.commandFiles.find((c) => c.name === 'standup')!.argHint, '<日期>');
});

test('Claude using a skill: a card names it, and the skill\'s text reaches Claude (FR-TOOL-07)', async () => {
  env.model.script(/用一下技能/, [[use('Skill', { skill: 'api-docs' })], [say('按技能写好了')]]);
  const sid = await env.start('用一下技能');
  await env.turns(sid);
  const card = (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.tool === 'Skill') as Extract<Item, { kind: 'tool' }>;
  assert.equal(card?.status, 'ok');
  assert.match(card.detail, /api-docs/);
  assert.match(JSON.stringify(env.model.sent(/用一下技能/).at(-1)!.body.messages), /# api-docs/);
});

test('a skill switched off is not offered to new sessions (FR-SKILL-02)', async () => {
  env.model.script(/技能列表/, [[say('好')]]);
  const on = await env.start('技能列表 开');
  await env.turns(on);
  assert.match(skillText(env.model.sent(/技能列表 开/)[0]), /api-docs/);
  await env.c.call('setState', { skills: env.c.slices.skills.map((s) => (s.name === 'api-docs' ? { ...s, enabled: false } : s)) });
  const off = await env.start('技能列表 关');
  await env.turns(off);
  assert.doesNotMatch(skillText(env.model.sent(/技能列表 关/)[0]), /api-docs/);
  await env.c.call('setState', { skills: env.c.slices.skills.map((s) => (s.name === 'api-docs' ? { ...s, enabled: true } : s)) });
});

test('a new skill is written as SKILL.md; editing rewrites it; deleting removes its folder; running sessions reload (FR-SKILL-03)', async () => {
  env.model.script(/^运行中的会话$/, [[say('好')]]);
  const live = await env.start('运行中的会话');
  await env.turns(live);
  const content = '---\nname: release-notes\ndescription: 写发布说明\n---\n\n# release-notes\n';
  const fresh: SkillInfo = { id: `workspace:${env.ws}:release-notes`, name: 'release-notes', description: '写发布说明', source: 'workspace', workspaceId: env.ws, invocable: 'both', enabled: true, path: '.claude/skills/release-notes/SKILL.md', content };
  await env.c.call('setState', { skills: [...env.c.slices.skills, fresh] });
  const file = path.join(env.repo, '.claude', 'skills', 'release-notes', 'SKILL.md');
  await until(() => existsSync(file), 'written');
  assert.equal(readFileSync(file, 'utf8'), content);
  assert.ok(await env.c.call('reloadInSessions', 'skills') >= 1, 'reloaded in the running session');
  const edited = content.replace('写发布说明', '写发布说明和升级提示');
  await env.c.call('setState', { skills: env.c.slices.skills.map((s) => (s.name === 'release-notes' ? { ...s, content: edited } : s)) });
  await until(() => readFileSync(file, 'utf8') === edited, 'rewritten');
  await env.c.call('setState', { skills: env.c.slices.skills.filter((s) => s.name !== 'release-notes') });
  await until(() => !existsSync(path.dirname(file)), 'folder removed');
});

test('a command file shows in the / list of a session and runs with its arguments (FR-SKILL-04, FR-IN-05)', async () => {
  env.model.script(/^命令前$/, [[say('好')]]);
  const sid = await env.start('命令前');
  await env.turns(sid);
  const cmds = await env.c.call('listCommands', sid);
  assert.ok(cmds.some((c) => c.name === '/standup'), 'listed');
  env.model.script(/总结 昨天 的提交/, [[say('昨天提交了 3 次')]]);
  await env.c.call('send', sid, '/standup 昨天', {});
  await env.turns(sid, 2);
  assert.ok(env.model.sent(/总结 昨天 的提交/).length > 0, '$ARGUMENTS filled');
});

test('a plugin folder: missing folder and missing name are errors; a good one is loaded with its contents (FR-PLUG-01, FR-PLUG-02)', async () => {
  const good = env.world.write('plugins/good/.claude-plugin/plugin.json', { name: 'good-plugin', version: '1.2.0' });
  env.world.write('plugins/good/skills/lint-fix/SKILL.md', '---\nname: lint-fix\ndescription: 修 lint\n---\n');
  const bad = env.world.write('plugins/bad/.claude-plugin/plugin.json', { version: '0.1.0' });
  const dir = (f: string) => path.dirname(path.dirname(f));
  const base = { status: 'loading' as const, contents: { skills: 0, commands: 0, agents: 0, mcp: 0, hooks: 0 }, enabled: true, skipMcp: false };
  await env.c.call('setState', { plugins: [
    { ...base, id: 'p-good', name: 'good', path: dir(good) },
    { ...base, id: 'p-bad', name: 'bad', path: dir(bad) },
    { ...base, id: 'p-none', name: 'none', path: path.join(env.world.root, 'plugins', 'nowhere') },
  ] });
  const p = (id: string) => env.c.slices.plugins.find((x) => x.id === id);
  await until(() => p('p-good')?.status === 'loaded' && p('p-bad')?.status === 'error' && p('p-none')?.status === 'error', 'plugins inspected');
  assert.equal(p('p-good')!.name, 'good-plugin');
  assert.equal(p('p-good')!.contents.skills, 1);
  assert.match(p('p-bad')!.error ?? '', /name/);
  assert.match(p('p-none')!.error ?? '', /不存在/);
  await env.c.call('setState', { plugins: [] });
});

test('subagents: created as a file, refused bad names, switched off for new sessions, deleted (FR-AGT-01, FR-AGT-02)', async () => {
  await until(() => env.c.slices.agents.find((a) => a.name === 'test-writer'), 'user agent listed');
  const a = await env.c.call('saveAgent', { name: 'doc-writer', description: '写文档', tools: ['Read', 'Write'], model: 'inherit', prompt: '你只写文档。', workspaceId: env.ws });
  const file = path.join(env.repo, '.claude', 'agents', 'doc-writer.md');
  assert.ok(existsSync(file));
  assert.match(readFileSync(file, 'utf8'), /tools: Read, Write/);
  await assert.rejects(env.c.call('saveAgent', { name: 'bad name!', description: 'x', tools: [], model: 'inherit', prompt: 'x' }), /名称只能用/);
  await assert.rejects(env.c.call('saveAgent', { name: 'doc-writer', description: 'x', tools: [], model: 'inherit', prompt: 'x', workspaceId: env.ws }), /已经有一个叫/);

  await env.c.call('setAgentEnabled', a.id, false);
  env.model.script(/派文档代理/, [[use('Agent', { description: '写文档', subagent_type: 'doc-writer', prompt: '写 README' })], [say('好')]]);
  const sid = await env.start('派文档代理');
  await env.turns(sid);
  const card = (await env.rt(sid)).items.find((i) => i.kind === 'tool' && i.agent) as Extract<Item, { kind: 'tool' }> | undefined;
  assert.ok(!card || card.status !== 'ok', 'a switched-off subagent cannot be used');
  await env.c.call('setAgentEnabled', a.id, true);
  await env.c.call('deleteAgent', a.id);
  assert.equal(existsSync(file), false);
});
