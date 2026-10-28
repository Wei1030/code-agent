/** Seed data for MCP servers, skills, commands, plugins and hooks. */
import type { CommandFile, FileHook, HookLogEntry, HookRule, McpServer, PluginInfo, SkillInfo } from '../api/types';

const now = Date.now();
const MIN = 60_000;

export const MCP_SERVERS: McpServer[] = [
  {
    id: 'mcp-github', name: 'github', type: 'http', scope: 'global', url: 'https://api.githubcopilot.com/mcp/',
    headers: [{ key: 'Authorization', value: 'Bearer ghp_••••••••••••3f2a' }], timeout: 60, status: 'connected', version: 'github-mcp 1.4.0',
    instructionsTokens: 1100, offIn: [],
    tools: [
      { name: 'list_issues', desc: 'List issues in a repository', annotations: ['readOnly'], tokens: 420 },
      { name: 'get_pull_request', desc: 'Get a pull request', annotations: ['readOnly'], tokens: 380 },
      { name: 'search_code', desc: 'Search code across repositories', annotations: ['readOnly', 'openWorld'], tokens: 440 },
      { name: 'create_issue', desc: 'Create a new issue', annotations: ['openWorld'], tokens: 510 },
      { name: 'merge_pull_request', desc: 'Merge a pull request', annotations: ['destructive', 'openWorld'], tokens: 460 },
      { name: 'delete_branch', desc: 'Delete a branch', annotations: ['destructive'], tokens: 300 },
    ],
    prompts: [{ name: 'pr-summary', desc: 'Summarize a pull request' }],
  },
  {
    id: 'mcp-jira', name: 'jira', type: 'http', scope: 'global', url: 'https://mcp.atlassian.com/v1/sse',
    headers: [], timeout: 60, status: 'needs-auth', instructionsTokens: 0, offIn: [], tools: [], prompts: [],
  },
  {
    id: 'mcp-postgres', name: 'postgres', type: 'stdio', scope: 'repo', workspaceId: 'ws-shop-api',
    command: 'npx', args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/shop'],
    env: [{ key: 'PGPASSWORD', value: '••••••' }], timeout: 30, status: 'connected', version: 'server-postgres 0.9.2',
    instructionsTokens: 300, offIn: [],
    tools: [
      { name: 'query', desc: 'Run a read-only SQL query', annotations: ['readOnly'], tokens: 520 },
      { name: 'list_tables', desc: 'List tables', annotations: ['readOnly'], tokens: 210 },
      { name: 'run_migration', desc: 'Apply a migration (asks for settings)', annotations: ['destructive'], tokens: 640 },
    ],
    prompts: [],
  },
  {
    id: 'mcp-browser', name: 'browser', type: 'stdio', scope: 'workspace', workspaceId: 'ws-shop-web',
    command: 'npx', args: ['-y', '@playwright/mcp'], timeout: 30, status: 'failed', error: 'spawn npx ENOENT',
    instructionsTokens: 0, offIn: [], tools: [], prompts: [],
  },
  {
    id: 'mcp-git', name: 'git', type: 'stdio', scope: 'plugin', plugin: 'git-tools', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/mcp/git.js'],
    timeout: 30, status: 'connected', version: 'git-tools 0.3.0', instructionsTokens: 150, offIn: [],
    tools: [
      { name: 'log', desc: 'Show commit history', annotations: ['readOnly'], tokens: 260 },
      { name: 'blame', desc: 'Show who changed each line', annotations: ['readOnly'], tokens: 240 },
      { name: 'commit', desc: 'Create a commit', annotations: [], tokens: 330 },
      { name: 'push', desc: 'Push to the remote', annotations: ['openWorld'], tokens: 280 },
    ],
    prompts: [],
  },
];

const SECURITY_CHECK = `---
name: security-check
description: 检查改动代码中的注入、权限和密钥泄露问题。合并前使用。
allowed-tools: Read, Grep, Bash(git diff *)
---

# 安全检查

1. 运行 \`git diff origin/main...\`，列出改动的文件。
2. 逐个检查输入处理、权限校验和硬编码的密钥。
3. 以 文件:行号 的形式报告问题并给出修复建议。
`;

const TESTING = `---
name: testing-conventions
description: 本项目的测试写法约定。写或改测试时自动使用。
user-invocable: false
---

# 测试约定

- 每个测试文件只测一个模块，放在 tests/ 下对应的目录。
- 用 tests/helpers/clock.ts 的假时钟，不要用真实的 setTimeout。
- 测试之间不共享状态；需要的数据在 beforeEach 里重建。
`;

const DEPLOY = `---
name: deploy
description: 部署到预发环境
disable-model-invocation: true
argument-hint: "[service]"
---

# 部署到预发

1. 确认当前分支已推送、CI 通过。
2. 运行 \`./deploy.sh staging $ARGUMENTS\`。
3. 部署完成后打开健康检查页面确认。
`;

export const SKILLS: SkillInfo[] = [
  { id: 'sk-review', name: 'code-review', description: 'Review the diff for bugs, risky changes and missing tests', source: 'bundled', invocable: 'both', enabled: true, path: '内置', content: '---\nname: code-review\ndescription: Review the diff for bugs, risky changes and missing tests\n---\n\n（内置技能，只读）\n' },
  { id: 'sk-security', name: 'security-check', description: '检查改动代码中的注入、权限和密钥泄露问题。合并前使用。', source: 'workspace', workspaceId: 'ws-shop-api', invocable: 'both', enabled: true, path: '.claude/skills/security-check/SKILL.md', content: SECURITY_CHECK },
  { id: 'sk-testing', name: 'testing-conventions', description: '本项目的测试写法约定。写或改测试时自动使用。', source: 'workspace', workspaceId: 'ws-shop-api', invocable: 'model', enabled: true, path: '.claude/skills/testing-conventions/SKILL.md', content: TESTING },
  { id: 'sk-deploy', name: 'deploy', description: '部署到预发环境', source: 'global', invocable: 'user', enabled: false, path: '~/.claude/skills/deploy/SKILL.md', content: DEPLOY },
  { id: 'sk-release', name: 'release-notes', description: 'Draft release notes from merged PRs', source: 'plugin', plugin: 'git-tools', invocable: 'both', enabled: true, path: 'git-tools/skills/release-notes/SKILL.md', content: '---\nname: release-notes\ndescription: Draft release notes from merged PRs\n---\n\n（插件提供，只读）\n' },
  { id: 'sk-pdf', name: 'pdf', description: 'Read and fill PDF forms', source: 'global', invocable: 'model', enabled: true, path: '~/.claude/skills/pdf/SKILL.md', content: '---\nname: pdf\ndescription: Read and fill PDF forms\nuser-invocable: false\n---\n\n# PDF\n\n用 scripts/fill.py 填写表单字段。\n' },
];

export const COMMAND_FILES: CommandFile[] = [
  { id: 'cmd-cost', name: 'cost-report', desc: '每周用量汇总', argHint: '[周数]', source: 'workspace', workspaceId: 'ws-shop-api', path: '.claude/commands/cost-report.md', content: '---\ndescription: 每周用量汇总\nargument-hint: "[周数]"\n---\n\n汇总最近 $ARGUMENTS 周的用量，按工作区和模型列表。\n' },
  { id: 'cmd-standup', name: 'standup', desc: '根据昨天的提交写站会摘要', argHint: '', source: 'global', path: '~/.claude/commands/standup.md', content: '---\ndescription: 根据昨天的提交写站会摘要\n---\n\n读取昨天以来的 git log，写三句话的站会摘要：做了什么、今天做什么、有什么阻碍。\n' },
  { id: 'cmd-commit', name: 'commit', desc: 'Commit staged changes', argHint: '[message]', source: 'plugin', plugin: 'git-tools', path: 'git-tools/commands/commit.md', content: '（插件提供，只读）\n' },
];

export const BUILTIN_COMMANDS: Array<{ name: string; desc: string; argHint: string }> = [
  { name: 'compact', desc: '压缩历史记录', argHint: '[说明]' },
  { name: 'clear', desc: '清空对话，重新开始', argHint: '' },
  { name: 'context', desc: '查看上下文占用', argHint: '' },
  { name: 'usage', desc: '查看用量与限额', argHint: '' },
];

export const PLUGINS: PluginInfo[] = [
  { id: 'pl-git', name: 'git-tools', path: 'D:\\plugins\\git-tools', status: 'loaded', version: '0.3.0', contents: { skills: 1, commands: 1, agents: 1, mcp: 1, hooks: 2 }, enabled: true, skipMcp: false },
  { id: 'pl-team', name: 'team-standards', path: 'D:\\plugins\\team-standards', status: 'error', error: 'plugin.json: missing required field "name"', contents: { skills: 0, commands: 0, agents: 0, mcp: 0, hooks: 0 }, enabled: true, skipMcp: false },
];

/** Every hook event the SDK fires, grouped for the event list. */
export const HOOK_EVENTS: Array<{ group: string; events: Array<{ name: string; desc: string }> }> = [
  { group: '工具', events: [
    { name: 'PreToolUse', desc: '工具运行前 · 可以允许、拒绝、询问、延后决定或改写输入' },
    { name: 'PostToolUse', desc: '工具成功运行后 · 可以补充上下文或改写工具输出' },
    { name: 'PostToolUseFailure', desc: '工具运行失败后' },
    { name: 'PostToolBatch', desc: '一批并行的工具调用全部结束后' },
  ] },
  { group: '提示与显示', events: [
    { name: 'UserPromptSubmit', desc: '你发送消息后、Claude 处理前 · 可以补充上下文、拦截或设置会话标题' },
    { name: 'UserPromptExpansion', desc: '/ 命令展开成提示词时' },
    { name: 'MessageDisplay', desc: '消息显示前' },
  ] },
  { group: '会话', events: [
    { name: 'SessionStart', desc: '会话启动或恢复时 · 可以补充上下文' },
    { name: 'SessionEnd', desc: '会话结束时' },
    { name: 'Setup', desc: '首次初始化时' },
    { name: 'Stop', desc: 'Claude 结束一轮回答时 · 可以要求继续' },
    { name: 'StopFailure', desc: '一轮因错误结束时' },
    { name: 'Notification', desc: 'Claude Code 发出通知时（如等待审批）' },
  ] },
  { group: '代理与任务', events: [
    { name: 'SubagentStart', desc: '子代理启动时' },
    { name: 'SubagentStop', desc: '子代理结束时' },
    { name: 'TeammateIdle', desc: '代理团队中的成员空闲时' },
    { name: 'TaskCreated', desc: '创建任务时' },
    { name: 'TaskCompleted', desc: '任务完成时' },
  ] },
  { group: '压缩', events: [
    { name: 'PreCompact', desc: '压缩对话前' },
    { name: 'PostCompact', desc: '压缩对话后' },
  ] },
  { group: '模型', events: [
    { name: 'PreModelSwitch', desc: '切换模型前' },
    { name: 'PostModelSwitch', desc: '切换模型后' },
  ] },
  { group: '权限', events: [
    { name: 'PermissionRequest', desc: '要弹出审批时 · 可以代你允许或拒绝' },
    { name: 'PermissionDenied', desc: '工具调用被拒绝后' },
  ] },
  { group: 'MCP', events: [
    { name: 'Elicitation', desc: 'MCP 服务器向你索取信息时 · 可以自动应答' },
    { name: 'ElicitationResult', desc: '信息征询完成后' },
  ] },
  { group: '配置与文件', events: [
    { name: 'ConfigChange', desc: '设置文件变化时' },
    { name: 'InstructionsLoaded', desc: '加载 CLAUDE.md 等说明文件时' },
    { name: 'DirectoryAdded', desc: '添加额外目录时' },
    { name: 'WorktreeCreate', desc: '创建 worktree 时' },
    { name: 'WorktreeRemove', desc: '删除 worktree 时' },
    { name: 'CwdChanged', desc: '工作目录变化时' },
    { name: 'FileChanged', desc: '被监视的文件变化时' },
  ] },
];

export const HOOK_RULES: HookRule[] = [
  { id: 'hk-1', name: '禁止强制推送', event: 'PreToolUse', matcher: 'Bash', cond: { field: 'tool_input.command', op: 'glob', value: 'git push --force*' }, action: 'deny', text: '禁止强制推送。请推到分支并发起 PR。', timeout: 10, async: false, enabled: true, scope: 'global' },
  { id: 'hk-2', name: '保护 env 文件', event: 'PreToolUse', matcher: 'Edit|Write', cond: { field: 'tool_input.file_path', op: 'glob', value: '**/.env*' }, action: 'deny', text: '.env 文件由运维管理，不要修改。', timeout: 10, async: false, enabled: true, scope: 'global' },
  { id: 'hk-3', name: '生产部署延后决定', event: 'PreToolUse', matcher: 'Bash', cond: { field: 'tool_input.command', op: 'glob', value: './deploy.sh prod*' }, action: 'defer', text: '生产部署需要值班人确认。', timeout: 10, async: false, enabled: true, scope: 'workspace', workspaceId: 'ws-shop-api' },
  { id: 'hk-4', name: '附加团队约定', event: 'UserPromptSubmit', matcher: '', action: 'context', text: '提交前先跑 npm run lint；提交信息用英文。', timeout: 10, async: false, enabled: true, scope: 'global' },
  { id: 'hk-5', name: '本轮结束写入团队日志', event: 'Stop', matcher: '', action: 'webhook', text: 'https://hooks.example.com/team-log', timeout: 10, async: true, enabled: true, scope: 'global' },
];

export const FILE_HOOKS: FileHook[] = [
  { id: 'fh-1', event: 'PreToolUse', type: 'command', matcher: 'Bash', detail: './scripts/check-cmd.sh', source: 'shop-api · .claude/settings.json' },
  { id: 'fh-2', event: 'PostToolUse', type: 'command', matcher: 'Edit|Write', detail: 'npx prettier --write "$CLAUDE_FILE_PATH"', source: '~/.claude/settings.json' },
  { id: 'fh-3', event: 'PostToolUse', type: 'builtin', matcher: '', detail: '审计日志：记录每次工具调用', source: 'Code Agent 内置' },
  { id: 'fh-4', event: 'Notification', type: 'builtin', matcher: '', detail: '浏览器通知：需要你处理时提醒', source: 'Code Agent 内置' },
  { id: 'fh-5', event: 'PostToolUse', type: 'command', matcher: 'Bash', detail: '${CLAUDE_PLUGIN_ROOT}/hooks/log.sh', source: '插件 git-tools' },
];

export const HOOK_LOG: HookLogEntry[] = [
  { id: 'hl-1', ts: now - 2 * MIN, event: 'PreToolUse', rule: '禁止强制推送', target: 'Bash · git push --force origin main', outcome: 'crit', result: '已拒绝', ms: 2 },
  { id: 'hl-2', ts: now - 3 * MIN, event: 'PostToolUse', rule: '审计日志（内置）', target: 'Edit · src/cart/timer.ts', outcome: 'good', result: '已记录', ms: 1 },
  { id: 'hl-3', ts: now - 4 * MIN, event: 'UserPromptSubmit', rule: '附加团队约定', target: '第 1 条提问', outcome: 'good', result: '已补充上下文', ms: 3 },
  { id: 'hl-4', ts: now - 6 * MIN, event: 'Notification', rule: '浏览器通知（内置）', target: '等待审批', outcome: 'info', result: '已通知', ms: 1 },
  { id: 'hl-5', ts: now - 8 * MIN, event: 'PreToolUse', rule: 'check-cmd.sh（设置文件）', target: 'Bash · npm ci', outcome: 'good', result: '已允许', ms: 84 },
  { id: 'hl-6', ts: now - 12 * MIN, event: 'Stop', rule: '本轮结束写入团队日志', target: '本轮结束', outcome: 'crit', result: '错误：502', ms: 3000, detail: 'POST https://hooks.example.com/team-log → 502 Bad Gateway' },
];
