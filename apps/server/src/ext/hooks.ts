/**
 * Hooks: the user's rules (run by Code Agent as SDK hook callbacks in every session), hooks from
 * Claude Code's settings files (shown read-only, run by Claude Code) and the execution log.
 */
import { randomUUID } from 'node:crypto';
import type { HookEvent, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import type { FileHook, HookLogEntry, HookRule, Workspace } from '@code-agent/shared/types';
import { HOOK_EVENTS } from '@code-agent/shared/catalog';
import { hookOutput, ruleMatches } from '@code-agent/shared/hooks';
import { app, set } from '../state';
import { broadcast } from '../hub';
import { readSettings, type SettingsScope } from '../claude/files';
import { addHook, markDenied } from '../sessions/live';
import { patchSummary, summary } from '../sessions/registry';

const RESULT: Record<HookRule['action'], string> = {
  deny: '已拒绝', ask: '要求先问你', allow: '已允许', defer: '已延后', rewrite: '已改写输入', context: '已补充上下文',
  block: '已拦截', title: '已设置标题', rewriteOutput: '已改写输出', log: '已记录', notify: '已通知', webhook: '已发送',
};

export function logHook(e: Omit<HookLogEntry, 'id' | 'ts'>) {
  set('hookLog', [{ ...e, id: randomUUID(), ts: Date.now() }, ...app.hookLog].slice(0, 200));
}

function targetOf(input: Record<string, unknown>): string {
  const ti = (input.tool_input ?? {}) as Record<string, unknown>;
  const what = ti.command ?? ti.file_path ?? ti.url ?? input.prompt ?? '';
  return [input.tool_name, String(what).slice(0, 80)].filter(Boolean).join(' · ') || String(input.hook_event_name ?? '');
}

async function webhook(url: string, body: unknown, timeoutSec: number): Promise<string> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutSec * 1000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    return `HTTP ${r.status}`;
  } finally {
    clearTimeout(timer);
  }
}

async function runRules(event: string, sid: string, input: Record<string, unknown>): Promise<HookJSONOutput | undefined> {
  const ws = summary(sid)?.workspaceId;
  const rules = app.hookRules.filter((r) => r.event === event && (r.scope === 'global' || r.workspaceId === ws) && ruleMatches(r, input));
  if (!rules.length) return undefined;
  let out: Record<string, unknown> | undefined;
  for (const r of rules) {
    const t0 = Date.now();
    let result = RESULT[r.action];
    let outcome: HookLogEntry['outcome'] = r.action === 'deny' || r.action === 'block' ? 'crit' : r.action === 'ask' || r.action === 'defer' ? 'warn' : 'good';
    if (r.action === 'notify') {
      broadcast({ t: 'notify', n: { kind: 'background', sid, title: `钩子「${r.name}」`, body: r.text || targetOf(input), tone: 'info' } });
    } else if (r.action === 'webhook') {
      const send = webhook(r.text, { ...input, session_title: summary(sid)?.title }, r.timeout || 10);
      if (r.async) {
        void send.catch(() => undefined);
        result = '已发送（异步）';
      } else {
        try {
          result = await send;
        } catch (e) {
          result = `发送失败：${e instanceof Error ? e.message : String(e)}`;
          outcome = 'crit';
        }
      }
    } else if (r.action !== 'log') {
      if (!out) {
        out = hookOutput(r);
        if (event === 'PermissionRequest' && (r.action === 'allow' || r.action === 'deny')) {
          out = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: r.action === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: r.text || 'Denied by a hook rule.' } } };
        }
        if (r.action === 'title' && r.text) patchSummary(sid, { title: r.text });
        if (event === 'PreToolUse' && r.action === 'deny') markDenied(sid, String(input.tool_use_id ?? ''), `被钩子「${r.name}」拒绝`);
      }
    }
    logHook({ event, rule: r.name, target: targetOf(input), outcome, result, ms: Date.now() - t0 });
  }
  return out as HookJSONOutput | undefined;
}

for (const g of HOOK_EVENTS) {
  for (const e of g.events) addHook(e.name as HookEvent, (sid, input) => runRules(e.name, sid, input));
}

/** A settings-file hook ran in a session (reported when the profile records hook events). */
export function noteFileHook(_sid: string, m: Record<string, unknown>) {
  if (m.subtype !== 'hook_response') return;
  const name = String(m.hook_name ?? '');
  // Code Agent's own callbacks are logged where they run.
  if (!name || /callback/i.test(name)) return;
  const ok = m.outcome === 'success';
  logHook({
    event: String(m.hook_event ?? ''), rule: name, target: '', outcome: ok ? 'good' : m.outcome === 'cancelled' ? 'warn' : 'crit',
    result: ok ? '已执行' : `${String(m.outcome)}${m.exit_code !== undefined ? ` · 退出码 ${String(m.exit_code)}` : ''}`, ms: 0,
    detail: [m.stdout, m.stderr].filter(Boolean).join('\n').slice(0, 2000) || undefined,
  });
}

/** Hooks Code Agent itself installs in every session. */
const BUILTIN: FileHook[] = [
  { id: 'builtin-review-bash', event: 'PreToolUse', type: 'builtin', matcher: 'Bash|PowerShell', detail: '代码审核子代理只能运行只读命令', source: 'Code Agent' },
  { id: 'builtin-review-agent', event: 'PreToolUse', type: 'builtin', matcher: 'Agent', detail: '审核轮次的提示词由 Code Agent 固定', source: 'Code Agent' },
  { id: 'builtin-board', event: 'SessionStart', type: 'builtin', matcher: '', detail: '新会话开始时告诉 Claude 看板上进行中的功能', source: 'Code Agent' },
];

type SettingsHooks = Record<string, Array<{ matcher?: string; hooks?: Array<Record<string, unknown>> }>>;

function fileHooksOf(scope: SettingsScope, ws: Workspace | undefined, label: string): FileHook[] {
  const hooks = readSettings(scope, ws).hooks as SettingsHooks | undefined;
  if (!hooks || typeof hooks !== 'object') return [];
  const out: FileHook[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const [gi, g] of (Array.isArray(groups) ? groups : []).entries()) {
      for (const [hi, h] of (g.hooks ?? []).entries()) {
        const type = (['command', 'http', 'mcp_tool', 'prompt', 'agent'].includes(String(h.type)) ? h.type : 'command') as FileHook['type'];
        out.push({
          id: `${label}:${event}:${gi}:${hi}`, event, type, matcher: g.matcher ?? '',
          detail: String(h.command ?? h.url ?? h.prompt ?? h.tool ?? ''), source: label,
        });
      }
    }
  }
  return out;
}

export function reloadFileHooks() {
  const list = [
    ...fileHooksOf('global', undefined, '~/.claude/settings.json'),
    ...app.workspaces.flatMap((ws) => [...fileHooksOf('workspace', ws, `${ws.name}/.claude/settings.local.json`), ...fileHooksOf('repo', ws, `${ws.name}/.claude/settings.json`)]),
    ...BUILTIN,
  ];
  if (JSON.stringify(list) !== JSON.stringify(app.fileHooks)) set('fileHooks', list);
}
