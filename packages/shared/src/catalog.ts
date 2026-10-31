/** Static catalogs shared by the UI and the server: models (fallback), modes, efforts, tools, hook events. */
import type { CommandInfo, ModelInfo } from './types';

export type { CommandInfo };

/**
 * Claude Code decides the context window of a claude-… model name itself and ignores
 * CLAUDE_CODE_MAX_CONTEXT_TOKENS there: an endpoint model of that name has no window of its own.
 */
export const decidesOwnWindow = (name: string) => name.toLowerCase().startsWith('claude-');

/** Fallback until the server reports the models Claude Code offers; replaced in place at startup. */
export const MODELS: ModelInfo[] = [
  { id: 'opus', label: 'Opus 5.5', desc: '最强的编码与 Agent 能力', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'fable', label: 'Fable 5.1', desc: '长任务与复杂规划', efforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'sonnet', label: 'Sonnet 5', desc: '速度与能力均衡', efforts: ['low', 'medium', 'high', 'max'] },
  { id: 'haiku', label: 'Haiku 4.5', desc: '最快、最省', efforts: ['low', 'medium', 'high'] },
];

export const EFFORT_LABEL: Record<string, string> = { low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高' };

export const MODE_INFO: Record<string, { label: string; desc: string; icon: string }> = {
  default: { label: '默认模式', desc: '未授权的操作都先问我', icon: 'shield' },
  acceptEdits: { label: '自动接受编辑', desc: '工作区内的文件编辑直接执行', icon: 'pencil' },
  plan: { label: '规划模式', desc: '只探索和出计划，不改文件', icon: 'list' },
  dontAsk: { label: '不询问', desc: '未预先授权的一律拒绝', icon: 'lock' },
  bypassPermissions: { label: '跳过权限检查', desc: '全部直接执行 · 需二次确认', icon: 'warning' },
};


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

export const BUILTIN_COMMANDS: Array<{ name: string; desc: string; argHint: string }> = [
  { name: 'compact', desc: '压缩历史记录', argHint: '[说明]' },
  { name: 'clear', desc: '清空对话，重新开始', argHint: '' },
  { name: 'context', desc: '查看上下文占用', argHint: '' },
  { name: 'usage', desc: '查看用量与限额', argHint: '' },
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

export const NEW_JOB_SCHEMA = `{
  "type": "object",
  "required": ["summary"],
  "properties": {
    "summary": { "type": "string" }
  }
}`;

/** What a failed API call's category means (Claude Code's SDKAssistantMessageError). */
export const API_ERROR_TEXT: Record<string, string> = {
  authentication_failed: '认证失败：令牌无效或已过期',
  billing_error: '账户计费有问题（余额或付款）',
  rate_limit: '请求太频繁，被限流',
  overloaded: '服务过载',
  server_error: '服务端出错',
  model_not_found: '找不到这个模型',
  invalid_request: '请求被拒绝',
  oauth_org_not_allowed: '组织不允许这样使用',
  account_on_hold: '账户被暂停',
  verification_required: '账户需要验证',
  cloud_credential_error: '云服务凭证有误',
  unknown: '未知错误',
};

/** Failures a retry cannot fix: the token, the account or the model name is wrong. */
export const FATAL_API_ERRORS = ['authentication_failed', 'billing_error', 'model_not_found', 'oauth_org_not_allowed', 'account_on_hold', 'verification_required', 'cloud_credential_error'];

export function apiErrorText(error: string, status: number | null): string {
  return status ? `HTTP ${status} · ${API_ERROR_TEXT[error] ?? error}` : '连接失败或超时，没有收到响应';
}
