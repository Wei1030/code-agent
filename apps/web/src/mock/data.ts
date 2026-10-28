/** Seed data for the mocked backend. */
import type {
  ContextUsage, EnvVar, Item, ModelInfo, PermissionRule, Profile, SessionSummary, Workspace,
} from '../api/types';

const now = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const MODELS: ModelInfo[] = [
  { id: 'opus', label: 'Opus 5.5', desc: '最强的编码与 Agent 能力', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'fable', label: 'Fable 5.1', desc: '长任务与复杂规划', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'sonnet', label: 'Sonnet 5', desc: '速度与能力均衡', efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'haiku', label: 'Haiku 4.5', desc: '最快、最省', efforts: ['low', 'medium', 'high'] },
];

export const EFFORT_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' };

export const MODE_INFO: Record<string, { label: string; desc: string; icon: string }> = {
  default: { label: '编辑前询问', desc: '未授权的操作都先问我', icon: 'shield' },
  acceptEdits: { label: '自动接受编辑', desc: '工作区内的文件编辑直接执行', icon: 'pencil' },
  plan: { label: '规划模式', desc: '只探索和出计划，不改文件', icon: 'list' },
  dontAsk: { label: '不询问', desc: '未预先授权的一律拒绝', icon: 'lock' },
  bypassPermissions: { label: '跳过权限检查', desc: '全部直接执行 · 需二次确认', icon: 'warning' },
};

export const WORKSPACES: Workspace[] = [
  { id: 'ws-shop-api', name: 'shop-api', path: 'D:\\src\\shop-api', branch: 'main', lastActive: now - 2 * MIN },
  { id: 'ws-shop-web', name: 'shop-web', path: 'D:\\src\\shop-web', branch: 'feat/checkout', lastActive: now - 14 * MIN },
  { id: 'ws-infra', name: 'infra', path: 'D:\\src\\infra', branch: 'main', lastActive: now - 26 * HOUR },
  { id: 'ws-notes', name: '笔记', path: 'D:\\笔记', branch: null, lastActive: now - 30 * HOUR },
  { id: 'ws-pipeline', name: 'data-pipeline', path: 'D:\\work\\data-pipeline', branch: 'dev', lastActive: now - 3 * DAY },
];

function s(p: Partial<SessionSummary> & Pick<SessionSummary, 'id' | 'workspaceId' | 'title' | 'firstPrompt'>): SessionSummary {
  return {
    branch: 'main', createdAt: now - DAY, lastActive: now - HOUR, tag: null, live: false, state: 'idle',
    forkedFrom: null, tokens: 120_000, ...p,
  };
}

export const SESSIONS: SessionSummary[] = [
  s({ id: 's-flaky', workspaceId: 'ws-shop-api', title: '修复结账测试偶发失败', firstPrompt: 'CI 上结账测试偶尔失败，帮我找到原因并修复——CI 日志在附件里。', live: true, state: 'requires_action', lastActive: now - 2 * MIN, createdAt: now - 25 * MIN, tag: 'ci', tokens: 412_000 }),
  s({ id: 's-auth', workspaceId: 'ws-shop-api', title: '重构鉴权中间件', firstPrompt: '把鉴权中间件拆成独立模块，并补上测试。', live: true, state: 'running', lastActive: now - 20_000, createdAt: now - 40 * MIN, tokens: 980_000 }),
  s({ id: 's-docs', workspaceId: 'ws-shop-web', title: '文档：API 参考', firstPrompt: '为 /orders 和 /payments 生成 API 参考页面。', live: true, state: 'requires_action', branch: 'docs', lastActive: now - 14 * MIN, createdAt: now - 50 * MIN, tag: 'docs', tokens: 160_000 }),
  s({ id: 's-rate', workspaceId: 'ws-shop-api', title: '为 /orders 添加限流', firstPrompt: '用 Redis。先出计划，我审过之后再改代码。', lastActive: now - 2 * HOUR, createdAt: now - 3 * HOUR, tag: 'perf', tokens: 1_340_000 }),
  s({ id: 's-rate-tb', workspaceId: 'ws-shop-api', title: '限流 —— 令牌桶方案', firstPrompt: '换成令牌桶算法试试。', lastActive: now - HOUR, createdAt: now - 70 * MIN, forkedFrom: '为 /orders 添加限流', tokens: 380_000 }),
  s({ id: 's-leak', workspaceId: 'ws-infra', title: '排查内存泄漏', firstPrompt: 'worker-3 的堆每小时增长 40 MB，帮我找原因。', lastActive: now - 26 * HOUR, createdAt: now - 28 * HOUR, tokens: 2_100_000 }),
  s({ id: 's-notes', workspaceId: 'ws-notes', title: '每周笔记摘要', firstPrompt: '把本周的笔记整理成一页摘要。', branch: null, lastActive: now - 30 * HOUR, createdAt: now - 31 * HOUR, tag: 'job', tokens: 64_000 }),
  s({ id: 's-pg', workspaceId: 'ws-pipeline', title: '迁移到 Postgres 17', firstPrompt: '规划从 Postgres 15 升级到 17 的路径。', branch: 'dev', lastActive: now - 3 * DAY, createdAt: now - 3 * DAY - 2 * HOUR, tag: 'db', tokens: 3_900_000 }),
  s({ id: 's-release', workspaceId: 'ws-shop-web', title: '撰写 3.2 版本说明', firstPrompt: '收集 v3.1 以来合并的 PR，写版本说明。', lastActive: now - 7 * DAY, createdAt: now - 7 * DAY - HOUR, tokens: 210_000 }),
  s({ id: 's-pr', workspaceId: 'ws-shop-api', title: '评审 PR #482', firstPrompt: '/code-review high', branch: 'pr-482', lastActive: now - 8 * DAY, createdAt: now - 8 * DAY - HOUR, tag: 'review', tokens: 540_000 }),
  s({ id: 's-billing', workspaceId: 'ws-shop-api', title: '讲解计费模块', firstPrompt: '带我过一遍发票是怎么生成的。', lastActive: now - 9 * DAY, createdAt: now - 9 * DAY - HOUR, tokens: 95_000 }),
];

/** Transcript used for saved sessions that have no specific seed. */
export function genericTranscript(sum: SessionSummary): Item[] {
  return [
    { kind: 'user', id: `${sum.id}-u1`, text: sum.firstPrompt, attachments: [], ts: sum.createdAt },
    { kind: 'thinking', id: `${sum.id}-th1`, text: '先了解相关代码的结构，再决定改动范围。', seconds: 4 },
    { kind: 'text', id: `${sum.id}-t1`, text: '我先看一下相关文件。' },
    {
      kind: 'toolgroup', id: `${sum.id}-g1`, label: '读取 5 个文件 · 搜索 2 个模式 · 2.3 秒', tools: [
        { kind: 'tool', id: `${sum.id}-r1`, tool: 'Read', detail: 'src/index.ts', status: 'ok', seconds: 0.2 },
        { kind: 'tool', id: `${sum.id}-r2`, tool: 'Grep', detail: '"export function" in src/**', status: 'ok', right: '23 处匹配', seconds: 0.4 },
      ],
    },
    { kind: 'text', id: `${sum.id}-t2`, text: '已经完成。主要改动集中在 3 个文件中，测试全部通过。需要的话我可以继续补充文档。' },
    { kind: 'footer', id: `${sum.id}-f1`, turn: 1, seconds: 84, toolCalls: 9, tokens: Math.round(sum.tokens * 0.6), stopReason: 'end_turn' },
  ];
}

export function baseContext(model = 'claude-opus-5-5', messages = 48_600): ContextUsage {
  return {
    model,
    max: 200_000,
    categories: [
      { name: '系统提示词', tokens: 3100, kind: 'used' },
      { name: '系统工具', tokens: 14_200, kind: 'used' },
      { name: 'MCP 工具', tokens: 6800, kind: 'used' },
      { name: '记忆文件', tokens: 2500, kind: 'used' },
      { name: '技能', tokens: 1200, kind: 'used' },
      { name: '消息', tokens: messages, kind: 'used' },
      { name: '压缩预留', tokens: 16_000, kind: 'buffer' },
    ],
    deferred: { tools: 41, tokens: 12_300 },
    memoryFiles: [
      { path: 'CLAUDE.md', tokens: 1900 },
      { path: '.claude/rules/testing.md', tokens: 400 },
      { path: '~/.claude/CLAUDE.md', tokens: 200 },
    ],
    mcp: [
      { server: 'github', detail: '28 个工具 · 22 个延迟加载', tokens: 3900 },
      { server: 'postgres', detail: '6 个工具', tokens: 2900 },
    ],
    precise: false,
  };
}

export interface CommandInfo {
  name: string;
  hint: string;
  origin: string;
  icon: string;
}

/** Built-in commands; skills, command files and MCP prompts are added from the extension data. */
export const COMMANDS: CommandInfo[] = [
  { name: '/compact', hint: '压缩历史记录（可附说明）', origin: '内置', icon: 'slash' },
  { name: '/clear', hint: '清空对话，重新开始', origin: '内置', icon: 'slash' },
  { name: '/context', hint: '查看上下文占用', origin: '内置', icon: 'slash' },
  { name: '/usage', hint: '查看用量与限额', origin: '内置', icon: 'slash' },
];

export interface FsNode {
  name: string;
  dir?: boolean;
  children?: FsNode[];
}

const SHOP_API_TREE: FsNode[] = [
  { name: 'src', dir: true, children: [
    { name: 'cart', dir: true, children: [{ name: 'timer.ts' }, { name: 'timer.test.ts' }, { name: 'cart.ts' }, { name: 'types.ts' }] },
    { name: 'checkout', dir: true, children: [{ name: 'session.ts' }, { name: 'pay.ts' }] },
    { name: 'middleware', dir: true, children: [{ name: 'auth.ts' }, { name: 'logging.ts' }] },
    { name: 'routes', dir: true, children: [{ name: 'orders.ts' }, { name: 'payments.ts' }, { name: 'health.ts' }] },
    { name: 'index.ts' },
  ] },
  { name: 'tests', dir: true, children: [
    { name: 'checkout', dir: true, children: [{ name: 'cart.test.ts' }, { name: 'timer.test.ts' }] },
    { name: 'helpers', dir: true, children: [{ name: 'clock.ts' }] },
  ] },
  { name: 'docs', dir: true, children: [{ name: '设计说明.md' }, { name: 'api', dir: true, children: [{ name: 'orders.md' }] }] },
  { name: 'config', dir: true, children: [{ name: 'limits.yaml' }] },
  { name: 'CLAUDE.md' },
  { name: 'package.json' },
  { name: 'README.md' },
];

export function fsTree(_workspaceId: string): FsNode[] {
  return SHOP_API_TREE;
}

/** Folders offered by the "open folder" browser (server-side file system). */
export const SERVER_FOLDERS: FsNode[] = [
  { name: 'D:\\', dir: true, children: [
    { name: 'src', dir: true, children: [
      { name: 'shop-api', dir: true }, { name: 'shop-web', dir: true }, { name: 'infra', dir: true },
      { name: 'mobile-app', dir: true }, { name: 'code-agent', dir: true },
    ] },
    { name: 'work', dir: true, children: [{ name: 'data-pipeline', dir: true }, { name: 'reports', dir: true }] },
    { name: '笔记', dir: true },
  ] },
  { name: 'C:\\', dir: true, children: [{ name: 'Users', dir: true, children: [{ name: 'maowe', dir: true }] }] },
];

/** Built-in tools a profile can switch on or off. claudeOnly: run by Anthropic's API, so not offered on compatible endpoints. */
export const BUILTIN_TOOLS: Array<{ name: string; label: string; desc: string; claudeOnly?: boolean }> = [
  { name: 'Read', label: '读取文件', desc: '查看文件内容' },
  { name: 'Glob', label: '按名称找文件', desc: '例如找出所有 *.test.ts' },
  { name: 'Grep', label: '搜索文件内容', desc: '在代码里搜索文字' },
  { name: 'Edit', label: '修改文件', desc: '在现有文件里做局部修改' },
  { name: 'Write', label: '新建或覆盖文件', desc: '' },
  { name: 'NotebookEdit', label: '编辑 Jupyter 笔记本', desc: '' },
  { name: 'Bash', label: '运行命令', desc: '在终端里执行 Bash 命令' },
  { name: 'PowerShell', label: '运行 PowerShell 命令', desc: '仅 Windows' },
  { name: 'WebFetch', label: '抓取网页', desc: '读取指定网址的内容' },
  { name: 'WebSearch', label: '网页搜索', desc: '用搜索引擎查资料', claudeOnly: true },
  { name: 'Agent', label: '子代理', desc: '把任务交给子代理并行处理' },
  { name: 'TaskCreate', label: '任务清单', desc: '把多步骤工作拆成任务并跟踪进度' },
  { name: 'AskUserQuestion', label: '向你提问', desc: '有选择时停下来问你' },
  { name: 'Skill', label: '技能', desc: '调用已安装的技能' },
];

const ALL_TOOLS = BUILTIN_TOOLS.map((t) => t.name);

export const PROFILES: Profile[] = [
  {
    id: 'p-default', name: '默认', desc: '新会话和 Claude 新建的会话使用', isDefault: true, allowBypass: false,
    model: 'opus', effort: 'max', mode: 'default', prompts: 'host',
    tools: ALL_TOOLS, questionPreviews: true,
    sources: { user: true, project: true, local: true }, promptMode: 'append', promptText: '', responseLanguage: 'ui',
    features: { checkpoints: true, subagentText: true, progressSummaries: true, hookEvents: true, persist: true, verbatim: false },
  },
];

export const RULES: PermissionRule[] = [
  { id: 'r1', behavior: 'allow', rule: 'Bash(npm test *)', scope: 'global' },
  { id: 'r2', behavior: 'allow', rule: 'WebFetch(domain:docs.github.com)', scope: 'global' },
  { id: 'r3', behavior: 'ask', rule: 'Bash(git push *)', scope: 'global' },
  { id: 'r4', behavior: 'deny', rule: 'Bash(rm -rf *)', scope: 'global' },
  { id: 'r5', behavior: 'deny', rule: 'Edit(//etc/**)', scope: 'global' },
  { id: 'r6', behavior: 'allow', rule: 'Bash(git status)', scope: 'workspace', workspaceId: 'ws-shop-api' },
  { id: 'r7', behavior: 'allow', rule: 'Edit(/src/**)', scope: 'workspace', workspaceId: 'ws-shop-api' },
  { id: 'r8', behavior: 'deny', rule: 'Read(./.env*)', scope: 'repo', workspaceId: 'ws-shop-api' },
  { id: 'r9', behavior: 'allow', rule: 'Bash(npm run lint *)', scope: 'repo', workspaceId: 'ws-shop-api' },
  { id: 'r10', behavior: 'allow', rule: 'Bash(npm run build *)', scope: 'workspace', workspaceId: 'ws-shop-web' },
];

/** Environment variables users commonly set, with Claude Code's built-in default. Nothing is set by default. */
export const COMMON_ENV: Array<{ key: string; note: string; def: string }> = [
  { key: 'API_TIMEOUT_MS', note: '每次 API 请求等待响应头的时间（毫秒）', def: '600000（10 分钟）' },
  { key: 'CLAUDE_CODE_MAX_RETRIES', note: 'API 请求失败后的重试次数', def: '10' },
  { key: 'BASH_DEFAULT_TIMEOUT_MS', note: '命令默认超时（毫秒）', def: '120000（2 分钟）' },
  { key: 'BASH_MAX_TIMEOUT_MS', note: 'Claude 能给命令设置的最长超时（毫秒）', def: '600000（10 分钟）' },
  { key: 'BASH_MAX_OUTPUT_LENGTH', note: '命令输出读回给 Claude 的最大字符数', def: '30000' },
  { key: 'CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', note: '子代理最多嵌套几层；1 表示子代理不能再开子代理', def: '3' },
  { key: 'HTTPS_PROXY', note: '通过代理访问网络', def: '不使用代理' },
];

export const ENV_VARS: EnvVar[] = [];

/** Tokens per day for the last 30 days, per model (deterministic). */
export function usageDays(): Array<{ date: number; opus: number; sonnet: number; haiku: number }> {
  return Array.from({ length: 30 }, (_, i) => {
    const wk = i % 7 === 5 || i % 7 === 6 ? 0.3 : 1;
    const d = new Date(now - (29 - i) * DAY);
    d.setHours(0, 0, 0, 0);
    return {
      date: d.getTime(),
      opus: Math.round(wk * (300_000 + 800_000 * Math.abs(Math.sin(i * 1.3)))),
      sonnet: Math.round(wk * (100_000 + 300_000 * Math.abs(Math.cos(i * 0.7)))),
      haiku: Math.round(wk * (20_000 + 90_000 * Math.abs(Math.sin(i * 2.1)))),
    };
  });
}
