import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRule, describeRule, parseRule } from './rules';

test('rules parse into tool and specifier', () => {
  assert.deepEqual(parseRule('Bash(npm test *)'), { tool: 'Bash', spec: 'npm test *' });
  assert.deepEqual(parseRule('Read'), { tool: 'Read', spec: null });
  assert.deepEqual(parseRule('mcp__gh__*'), { tool: 'mcp__gh__*', spec: null });
});

test('descriptions in plain words for each kind of rule', () => {
  assert.equal(describeRule('Bash(npm test *)'), '以「npm test」开头的命令');
  assert.equal(describeRule('Bash(npm test:*)'), '以「npm test」开头的命令', 'the old :* form');
  assert.equal(describeRule('PowerShell(npm test)'), '完全等于「npm test」的命令');
  assert.equal(describeRule('Bash(git * --force)'), '符合「git * --force」的命令（* 代表任意内容）');
  assert.equal(describeRule('Bash'), '所有命令');
  assert.equal(describeRule('Read(//c/Users/x/**)'), '读取 /c/Users/x/**（绝对路径）');
  assert.equal(describeRule('Edit(src/**)'), '修改 工作区 src/**');
  assert.equal(describeRule('Read(~/.ssh/**)'), '读取 ~/.ssh/**（用户目录）');
  assert.equal(describeRule('Read(*.env)'), '读取 任意位置的 *.env');
  assert.equal(describeRule('WebFetch(domain:nodejs.org)'), '抓取 nodejs.org 的网页');
  assert.equal(describeRule('mcp__gh__*'), 'MCP 服务器 gh 的全部工具');
  assert.equal(describeRule('mcp__gh__issue_*'), 'MCP 服务器 gh 中以 issue_ 开头的工具');
  assert.equal(describeRule('Agent(Explore)'), '子代理 Explore');
});

test('the structured editor builds the rule text', () => {
  assert.equal(buildRule('bash', 'npm run lint'), 'Bash(npm run lint *)');
  assert.equal(buildRule('bash', 'npm run lint', '', 'exact'), 'Bash(npm run lint)');
  assert.equal(buildRule('bash', '', '', 'all'), 'Bash');
  assert.equal(buildRule('web', 'https://nodejs.org/api/fs.html'), 'WebFetch(domain:nodejs.org)');
  assert.equal(buildRule('mcp', 'gh', ''), 'mcp__gh__*');
  assert.equal(buildRule('mcp', 'gh', 'create_issue'), 'mcp__gh__create_issue');
  assert.equal(buildRule('read', ''), 'Read');
});
