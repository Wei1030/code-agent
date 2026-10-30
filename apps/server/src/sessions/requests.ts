/**
 * What Claude Code asks the host: tool approvals (canUseTool), clarifying questions
 * (AskUserQuestion), plan review (ExitPlanMode) and MCP elicitations. Each waits for the user's
 * answer in the UI.
 */
import { randomUUID } from 'node:crypto';
import type { ElicitationRequest, ElicitationResult, PermissionResult, PermissionUpdate } from '@anthropic-ai/claude-agent-sdk';
import type {
  ApprovalAnswer, ElicitationAnswer, ElicitationField, PendingRequest, PermissionMode, PlanAnswer, PlanDoc, Question, QuestionAnswer, RuleDestination,
  SuggestedUpdate, ToolItem,
} from '@code-agent/shared/types';
import { parseRule } from '@code-agent/shared/rules';
import { app, update } from '../state';
import { addItem, emit, findItem, patchItem, rt } from './registry';
import { waitForUser, type Live } from './live';
import { proposedDiff, rel, toolDetail, toolName, mcpParts } from './describe';
import { cwdOf } from './options';

type Input = Record<string, unknown>;
type CanUseOpts = Parameters<import('@anthropic-ai/claude-agent-sdk').CanUseTool>[2];

const DEST: Record<RuleDestination, PermissionUpdate['destination']> = { session: 'session', workspace: 'localSettings', global: 'userSettings' };

function ruleString(r: { toolName: string; ruleContent?: string }) {
  return r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName;
}

function ruleValue(rule: string) {
  const pr = parseRule(rule);
  return { toolName: pr.tool, ...(pr.spec !== null ? { ruleContent: pr.spec } : {}) };
}

/** Claude Code's suggestions as the UI shows them: the same updates, rules as text. */
function suggested(u: PermissionUpdate): SuggestedUpdate {
  if (u.type === 'addRules' || u.type === 'replaceRules' || u.type === 'removeRules') return { type: u.type, rules: u.rules.map(ruleString), behavior: u.behavior, destination: u.destination };
  if (u.type === 'addDirectories' || u.type === 'removeDirectories') return { type: u.type, directories: u.directories, destination: u.destination };
  return { type: 'setMode', mode: u.mode, destination: u.destination };
}

/** Back to the SDK's update, kept where the user chose; a mode change is for the session. */
function toUpdate(u: SuggestedUpdate, dest: RuleDestination): PermissionUpdate {
  if (u.type === 'setMode') return { type: 'setMode', mode: u.mode as Extract<PermissionUpdate, { type: 'setMode' }>['mode'], destination: 'session' };
  if ('directories' in u) return { type: u.type, directories: u.directories, destination: DEST[dest] };
  return { type: u.type, rules: u.rules.map(ruleValue), behavior: u.behavior, destination: DEST[dest] };
}

function ensureToolItem(l: Live, id: string, name: string, input: Input): ToolItem {
  const found = findItem(l.sid, id) as ToolItem | undefined;
  if (found) return found;
  const item: ToolItem = { kind: 'tool', id, tool: toolName(name), detail: toolDetail(name, input, l.cwd), status: 'running' };
  if (!l.tools.has(id)) l.tools.set(id, { name, input, startedAt: Date.now(), parent: null });
  addItem(l.sid, item);
  return item;
}

export async function canUseTool(l: Live, name: string, input: Input, o: CanUseOpts): Promise<PermissionResult> {
  if (name === 'AskUserQuestion') return askQuestion(l, input, o);
  if (name === 'ExitPlanMode') return reviewPlan(l, input, o);
  const item = ensureToolItem(l, o.toolUseID, name, input);
  const cwd = cwdOf(l.sid);
  const command = typeof input.command === 'string' ? input.command : undefined;
  const file = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : undefined;
  const diff = name === 'Edit' || name === 'Write' ? proposedDiff(name, input, cwd) : undefined;
  const mcp = mcpParts(name);
  const title = command ? '允许执行这条命令？'
    : diff ? `允许修改 ${diff.path}？`
      : mcp ? `允许调用 ${mcp.server} 的 ${mcp.tool}？`
        : name === 'WebFetch' ? `允许访问 ${String(input.url ?? '')}？`
          : file && (name === 'Read' || name === 'Grep' || name === 'Glob') ? `允许读取 ${file}？`
            : `允许使用 ${name}？`;
  const reason = o.decisionReason ? `Claude Code 的判断：${o.decisionReason}` : '没有匹配的允许规则；当前会话对未授权的操作会先询问。';
  const agentType = o.agentID ? l.taskTypes.get(o.agentID) ?? '子代理' : undefined;
  // Claude Code says when a lasting rule would grant more than this one call: then none is offered.
  const suggestions = o.suppressAlwaysAllowRule || o.defaultToNo ? [] : (o.suggestions ?? []).map(suggested);
  const req: PendingRequest = {
    kind: 'approval', id: randomUUID(), toolItemId: item.id, tool: toolName(name), title, reason,
    ...(command ? { command } : {}), ...(typeof input.description === 'string' ? { description: input.description } : {}),
    ...(diff ? { diff } : {}),
    ...(agentType ? { agent: agentType } : {}),
    suggestions,
    ...(o.defaultToNo ? { defaultToNo: true } : {}),
    ...(o.decisionReason ? { decisionReason: o.decisionReason } : {}),
    ...(o.blockedPath ? { blockedPath: o.blockedPath } : {}),
    since: Date.now(),
  };
  patchItem(l.sid, item.id, { status: 'waiting', right: '等待审批' });
  const onAbort = () => {
    l.pending.get(req.id)?.({ behavior: 'deny', message: 'cancelled' });
    l.pending.delete(req.id);
  };
  o.signal.addEventListener('abort', onAbort, { once: true });
  const a = await waitForUser<ApprovalAnswer>(l, req);
  o.signal.removeEventListener('abort', onAbort);
  if (a.behavior === 'deny') {
    patchItem(l.sid, item.id, { status: 'denied', right: undefined, provenance: '已被你拒绝', ...(a.message ? { denialMessage: a.message } : {}) });
    return { behavior: 'deny', message: a.message || 'The user denied this action.', interrupt: !!a.interrupt, toolUseID: o.toolUseID };
  }
  const kept = a.always?.updates ?? [];
  const updates = kept.map((u) => toUpdate(u, a.always!.destination));
  // Code Agent's own lists follow what Claude Code now has.
  for (const u of kept) {
    if (u.type === 'addDirectories' && a.always!.destination === 'session') {
      update('dirs', (ds) => [...ds, ...u.directories.filter((d) => !ds.some((x) => x.scope === 'session' && x.sessionId === l.sid && x.path === d)).map((d) => ({ id: randomUUID(), path: d, scope: 'session' as const, sessionId: l.sid }))]);
    }
    if (u.type === 'setMode') emit(l.sid, { t: 'settings', patch: { mode: u.mode as PermissionMode } });
  }
  patchItem(l.sid, item.id, { status: 'running', right: undefined, provenance: updates.length ? '已由你批准，以后不再询问' : '已由你批准' });
  if (updates.some((u) => u.destination !== 'session')) {
    // Claude Code writes the settings file; read the rules and directories back once it has.
    setTimeout(() => void import('../claude/permissions').then((m) => m.reloadRules()), 600);
  }
  return {
    behavior: 'allow',
    updatedInput: input,
    ...(updates.length ? { updatedPermissions: updates } : {}),
    toolUseID: o.toolUseID,
  };
}

// ------------------------------------------------------------------ questions

async function askQuestion(l: Live, input: Input, o: CanUseOpts): Promise<PermissionResult> {
  const qs = (input.questions as Question[] | undefined) ?? [];
  const req: PendingRequest = {
    kind: 'question', id: randomUUID(), toolItemId: o.toolUseID,
    questions: qs.map((q) => ({ header: q.header ?? '', question: q.question, multiSelect: !!q.multiSelect, options: (q.options ?? []).map((x) => ({ label: x.label, description: x.description ?? '', ...(x.preview ? { preview: x.preview } : {}) })) })),
    since: Date.now(),
  };
  // The question and its answer stay in the transcript as a tool card.
  if (!findItem(l.sid, o.toolUseID)) addItem(l.sid, { kind: 'tool', id: o.toolUseID, tool: 'AskUserQuestion', detail: `${qs.length} 个问题`, status: 'waiting', right: '等待回答' });
  const a = await waitForUser<QuestionAnswer | { behavior: 'deny'; message: string }>(l, req);
  if ('behavior' in a) {
    patchItem(l.sid, o.toolUseID, { status: 'denied', right: '没有回答' });
    return { behavior: 'deny', message: a.message, toolUseID: o.toolUseID };
  }
  const answers: Record<string, string> = {};
  for (const q of qs) answers[q.question] = a.answers[q.question] ?? a.response ?? '';
  patchItem(l.sid, o.toolUseID, {
    status: 'ok', right: '已回答', detail: qs.map((q) => `${q.header || q.question}：${answers[q.question] || '—'}`).join('；'),
    rows: qs.map((q) => ({ icon: 'chat', text: `${q.question} → ${answers[q.question] || '—'}${a.notes?.[q.question] ? `（${a.notes[q.question]}）` : ''}` })),
  });
  const annotations: Record<string, { notes: string }> = {};
  for (const [k, v] of Object.entries(a.notes ?? {})) if (v) annotations[k] = { notes: v };
  return { behavior: 'allow', updatedInput: { ...input, answers, ...(Object.keys(annotations).length ? { annotations } : {}) }, toolUseID: o.toolUseID };
}

// ------------------------------------------------------------------ plans

/** A plan written in Markdown, split into the parts the plan card shows. */
export function planDoc(md: string): PlanDoc {
  const ls = md.replace(/\r\n/g, '\n').split('\n');
  const title = (ls.find((x) => /^#\s+/.test(x)) ?? ls.find((x) => /^#{1,3}\s+/.test(x)) ?? '计划').replace(/^#+\s*/, '').trim();
  const firstPara = ls.find((x) => x.trim() && !/^(#|[-*]\s|\d+[.)]\s|```|\|)/.test(x.trim())) ?? '';
  const section = (re: RegExp) => {
    const out: string[] = [];
    let on = false;
    for (const x of ls) {
      if (/^#{1,4}\s+/.test(x)) on = re.test(x);
      else if (on && /^\s*([-*]|\d+[.)])\s+/.test(x)) out.push(x.replace(/^\s*([-*]|\d+[.)])\s+/, '').trim());
    }
    return out;
  };
  let steps = section(/步骤|实施|实现|计划|step|implement|plan|change|approach/i);
  if (!steps.length) steps = ls.filter((x) => /^\s*\d+[.)]\s+/.test(x)).map((x) => x.replace(/^\s*\d+[.)]\s+/, '').trim());
  const files = [...new Set([...md.matchAll(/`([\w./\\-]+\.[A-Za-z0-9]{1,6})`/g)].map((m) => m[1]))].slice(0, 20);
  return { title, summary: firstPara.trim(), steps, files, risks: section(/风险|risk|注意|caveat/i), markdown: md };
}

async function reviewPlan(l: Live, input: Input, o: CanUseOpts): Promise<PermissionResult> {
  const md = typeof input.plan === 'string' ? input.plan : '';
  const r = rt(l.sid)!;
  const version = r.items.filter((x) => x.kind === 'plan').length + 1;
  const planItemId = randomUUID();
  addItem(l.sid, { kind: 'plan', id: planItemId, version, plan: planDoc(md), status: 'pending' });
  const a = await waitForUser<PlanAnswer | { behavior: 'deny'; message: string }>(l, { kind: 'plan', id: randomUUID(), planItemId, since: Date.now() });
  if ('behavior' in a) {
    patchItem(l.sid, planItemId, { status: 'revised' });
    return { behavior: 'deny', message: a.message, toolUseID: o.toolUseID };
  }
  if (a.approve) {
    patchItem(l.sid, planItemId, { status: 'approved' });
    emit(l.sid, { t: 'settings', patch: { mode: a.mode } });
    return { behavior: 'allow', updatedInput: input, updatedPermissions: [{ type: 'setMode', mode: a.mode, destination: 'session' }], toolUseID: o.toolUseID };
  }
  patchItem(l.sid, planItemId, { status: 'revised' });
  return { behavior: 'deny', message: `The user wants changes to the plan: ${a.feedback}`, toolUseID: o.toolUseID };
}

// ------------------------------------------------------------------ MCP elicitation

function fieldsOf(schema: Record<string, unknown> | undefined): ElicitationField[] {
  const props = (schema?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (schema?.required as string[] | undefined) ?? [];
  return Object.entries(props).map(([key, p]) => {
    const en = (p.enum as string[] | undefined) ?? (p.oneOf as Array<{ const: string }> | undefined)?.map((x) => x.const);
    const type: ElicitationField['type'] = en ? 'enum' : p.type === 'boolean' ? 'boolean' : p.type === 'number' || p.type === 'integer' ? 'number' : 'string';
    return {
      key, title: String(p.title ?? key), type, required: required.includes(key),
      ...(en ? { options: en } : {}), ...(typeof p.minimum === 'number' ? { min: p.minimum } : {}), ...(typeof p.maximum === 'number' ? { max: p.maximum } : {}),
      ...(p.default !== undefined ? { default: p.default as string | number | boolean } : {}), ...(p.description ? { description: String(p.description) } : {}),
      ...(typeof p.maxLength === 'number' && p.maxLength > 200 ? { multiline: true } : {}),
    };
  });
}

export async function onElicitation(l: Live, req: ElicitationRequest, o: { signal: AbortSignal; requestId: string }): Promise<ElicitationResult> {
  const r = rt(l.sid)!;
  // The MCP tool call that asked, if it is in view.
  const running = [...r.items].reverse().find((x): x is ToolItem => x.kind === 'tool' && x.status === 'running' && x.tool.startsWith(`${req.serverName} · `));
  const server = app.mcp.find((m) => m.name === req.serverName);
  const pending: PendingRequest = {
    kind: 'elicitation', id: randomUUID(), toolItemId: running?.id ?? '', server: req.serverName,
    source: server ? server.scope : 'mcp', tool: running ? running.tool.split(' · ')[1] ?? '' : '', mode: req.mode ?? 'form',
    message: req.message, ...(req.mode === 'url' ? { url: req.url } : { fields: fieldsOf(req.requestedSchema) }), since: Date.now(),
  };
  if (running) patchItem(l.sid, running.id, { status: 'waiting', right: '等待你提供信息' });
  const onAbort = () => {
    l.pending.get(pending.id)?.({ action: 'cancel' });
    l.pending.delete(pending.id);
  };
  o.signal.addEventListener('abort', onAbort, { once: true });
  const a = await waitForUser<ElicitationAnswer>(l, pending);
  o.signal.removeEventListener('abort', onAbort);
  if (running) patchItem(l.sid, running.id, { status: 'running', right: undefined });
  return a.action === 'accept' ? { action: 'accept', content: a.content } : { action: a.action };
}

export { rel };
