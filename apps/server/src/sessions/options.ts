/**
 * SDK options for a session: the 默认 profile, the session's model / effort / mode, the provider,
 * extra directories, plugins and skills, Code Agent's own tools (workspace MCP server) and the
 * code-reviewer subagent.
 */
import path from 'node:path';
import type { AgentDefinition, CanUseTool, HookCallbackMatcher, HookEvent, McpServerConfig, OnElicitation, Options, SettingSource } from '@anthropic-ai/claude-agent-sdk';
import { app } from '../state';
import { LOGS_DIR } from '../paths';
import { processEnv, systemClaude } from '../claude/files';
import { rt, summary } from './registry';

export interface BuildCtx {
  resume: boolean;
  canUseTool: CanUseTool;
  onElicitation: OnElicitation;
  hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>;
  stderr: (line: string) => void;
  extra?: Partial<Options>;
}

/** In-process MCP servers and subagents other modules add to every session. */
type ServerFactory = (sid: string) => Record<string, McpServerConfig>;
const serverFactories: ServerFactory[] = [];
export function addSessionServers(fn: ServerFactory) {
  serverFactories.push(fn);
}
type AgentFactory = (sid: string) => Record<string, AgentDefinition>;
const agentFactories: AgentFactory[] = [];
export function addSessionAgents(fn: AgentFactory) {
  agentFactories.push(fn);
}
type PromptPart = (sid: string) => string | null;
const promptParts: PromptPart[] = [];
/** A line of Code Agent's own instructions appended to the system prompt. */
export function addPromptPart(fn: PromptPart) {
  promptParts.push(fn);
}

/** Built-in tool names behind each checkbox of the profile's tool list. */
const TOOL_GROUPS: Record<string, string[]> = {
  TaskCreate: ['TaskCreate', 'TaskGet', 'TaskList', 'TaskUpdate', 'TodoWrite'],
  Agent: ['Agent', 'Task'],
  Edit: ['Edit', 'MultiEdit'],
};

export function workspaceOf(sid: string) {
  const sum = summary(sid);
  return app.workspaces.find((w) => w.id === sum?.workspaceId);
}

/** The directory the session works in: its worktree or its workspace. */
export function cwdOf(sid: string): string {
  return summary(sid)?.cwd ?? workspaceOf(sid)?.path ?? process.cwd();
}

function languageLine(): string | null {
  const prof = app.profiles[0];
  const lang = prof.responseLanguage === 'ui'
    ? (app.prefs.responseLanguage === 'custom' ? app.prefs.responseLanguageCustom : app.prefs.responseLanguage === 'conversation' ? '' : app.prefs.uiLanguage === 'en' ? 'English' : 'Simplified Chinese')
    : prof.responseLanguage === 'conversation' ? '' : prof.responseLanguage === 'en' ? 'English' : prof.responseLanguage === 'zh-CN' ? 'Simplified Chinese' : prof.responseLanguage;
  return lang ? `Always respond to the user in ${lang}.` : null;
}

export function buildOptions(sid: string, ctx: BuildCtx): { options: Options; cwd: string } {
  const prof = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
  const r = rt(sid)!;
  const ws = workspaceOf(sid);
  const cwd = cwdOf(sid);
  const onClaude = app.provider.kind === 'subscription';

  const disallowed: string[] = [];
  for (const name of ['Read', 'Glob', 'Grep', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'PowerShell', 'WebFetch', 'WebSearch', 'Agent', 'TaskCreate', 'AskUserQuestion', 'Skill']) {
    const on = prof.tools.includes(name) && !(name === 'WebSearch' && !onClaude);
    if (!on) disallowed.push(...(TOOL_GROUPS[name] ?? [name]));
  }

  const sources: SettingSource[] = [];
  if (prof.sources.user) sources.push('user');
  if (prof.sources.project) sources.push('project');
  if (prof.sources.local) sources.push('local');

  const ours = [languageLine(), ...promptParts.map((f) => f(sid))].filter(Boolean).join('\n\n');
  let systemPrompt: Options['systemPrompt'];
  if (prof.promptMode === 'custom') systemPrompt = { type: 'custom', prompt: [prof.promptText, ours].filter(Boolean).join('\n\n') };
  else if (prof.promptMode === 'minimal') systemPrompt = { type: 'custom', prompt: ['You are Claude, an AI assistant working in a software project. Use the tools available to help the user.', ours].filter(Boolean).join('\n\n') };
  else systemPrompt = { type: 'preset', preset: 'claude_code', append: [prof.promptMode === 'append' ? prof.promptText : '', ours].filter(Boolean).join('\n\n') || undefined };

  const dirs = app.dirs.filter((d) => d.scope === 'session' && d.sessionId === sid).map((d) => d.path);
  if (summary(sid)?.worktree && ws) dirs.push(ws.path);

  const plugins = app.plugins.filter((p) => p.enabled && p.status !== 'error').map((p) => ({ type: 'local' as const, path: p.path }));
  const disabledSkills = app.skills.filter((s) => !s.enabled).map((s) => s.name);
  const skills = disabledSkills.length ? app.skills.filter((s) => s.enabled).map((s) => (s.plugin ? `${s.plugin}:${s.name}` : s.name)) : undefined;

  const mcpServers: Record<string, McpServerConfig> = {};
  for (const f of serverFactories) Object.assign(mcpServers, f(sid));
  const agents: Record<string, AgentDefinition> = {};
  for (const f of agentFactories) Object.assign(agents, f(sid));

  const exe = app.provider.executable === 'system' ? systemClaude() : undefined;
  const mode = r.mode === 'bypassPermissions' && !prof.allowBypass ? 'default' : r.mode;

  const options: Options = {
    cwd,
    ...(summary(sid)?.worktree && ws ? { projectConfigRoot: ws.path } : {}),
    model: r.model,
    effort: r.effort,
    thinking: { type: 'adaptive', display: 'summarized' },
    permissionMode: mode,
    ...(mode === 'bypassPermissions' || prof.allowBypass ? { allowDangerouslySkipPermissions: true } : {}),
    permissionPrompts: prof.prompts,
    canUseTool: ctx.canUseTool,
    onElicitation: ctx.onElicitation,
    hooks: ctx.hooks,
    disallowedTools: disallowed,
    // Code Agent's own tools; their effects are guarded by Code Agent (holds, caps, read-only checks).
    allowedTools: ['mcp__workspace'],
    settingSources: sources,
    systemPrompt,
    additionalDirectories: dirs,
    plugins,
    pluginDelivery: 'initialize',
    ...(skills ? { skills } : {}),
    mcpServers,
    strictMcpConfig: app.mcpBehavior.strict,
    agents,
    toolConfig: { askUserQuestion: { previewFormat: prof.questionPreviews ? 'html' : 'markdown' } },
    enableFileCheckpointing: !!prof.features.checkpoints,
    forwardSubagentText: !!prof.features.subagentText,
    agentProgressSummaries: !!prof.features.progressSummaries,
    includeHookEvents: !!prof.features.hookEvents,
    persistSession: prof.features.persist !== false,
    verbatimPrompts: !!prof.features.verbatim,
    includePartialMessages: true,
    perTaskStopAffordance: true,
    env: processEnv(),
    stderr: ctx.stderr,
    ...(app.runtime.debugLog ? { debug: true, debugFile: path.join(LOGS_DIR, `${sid}.log`) } : {}),
    ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
    ...(ctx.resume ? { resume: sid } : { sessionId: sid }),
    ...ctx.extra,
  };
  return { options, cwd };
}
