/**
 * Hooks: the user's rules (run by Code Agent as SDK hook callbacks in every session), hooks from
 * Claude Code's settings files (shown read-only, run by Claude Code) and the execution log.
 */
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
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

/** POST the event; a JSON object in the answer is the hook's output. */
async function webhook(url: string, body: unknown, timeoutSec: number): Promise<{ status: number; output?: Record<string, unknown> }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutSec * 1000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    let output: unknown;
    try { output = text.trim() ? JSON.parse(text) : undefined; } catch { /* not JSON: no output */ }
    return { status: r.status, output: r.ok && output && typeof output === 'object' && !Array.isArray(output) && Object.keys(output).length ? output as Record<string, unknown> : undefined };
  } finally {
    clearTimeout(timer);
  }
}

/** Several rules on one event: added context adds up; for anything else the first rule that says something wins. */
function merge(out: Record<string, unknown> | undefined, next: Record<string, unknown>): Record<string, unknown> {
  if (!out) return next;
  const a = out.hookSpecificOutput as Record<string, unknown> | undefined;
  const b = next.hookSpecificOutput as Record<string, unknown> | undefined;
  if (!b) return out;
  if (!a) return { ...out, hookSpecificOutput: b };
  const context = [a.additionalContext, b.additionalContext].filter(Boolean).join('\n\n');
  return { ...out, hookSpecificOutput: { ...b, ...a, ...(context ? { additionalContext: context } : {}) } };
}

async function runRules(event: string, sid: string, input: Record<string, unknown>): Promise<HookJSONOutput | undefined> {
  const ws = summary(sid)?.workspaceId;
  const rules = app.hookRules.filter((r) => r.event === event && (r.scope === 'global' || r.workspaceId === ws) && ruleMatches(r, input));
  if (!rules.length) return undefined;
  let out: Record<string, unknown> | undefined;
  let denied = false;
  for (const r of rules) {
    const t0 = Date.now();
    let result = RESULT[r.action];
    let outcome: HookLogEntry['outcome'] = r.action === 'deny' || r.action === 'block' ? 'crit' : r.action === 'ask' || r.action === 'defer' ? 'warn' : 'good';
    if (r.action === 'notify') {
      broadcast({ t: 'notify', n: { kind: 'background', sid, title: `钩子「${r.name}」`, body: r.text || targetOf(input), tone: 'info' } });
    } else if (r.action === 'log') {
      if (r.text.trim()) {
        try {
          mkdirSync(path.dirname(r.text.trim()), { recursive: true });
          appendFileSync(r.text.trim(), `${JSON.stringify({ time: new Date().toISOString(), event, rule: r.name, session: summary(sid)?.title, input })}\n`);
        } catch (e) {
          result = `写入失败：${e instanceof Error ? e.message : String(e)}`;
          outcome = 'crit';
        }
      }
    } else if (r.action === 'webhook') {
      const send = webhook(r.text, { ...input, session_title: summary(sid)?.title }, r.timeout || 10);
      if (r.async) {
        void send.catch(() => undefined);
        result = '已发送（异步）';
      } else {
        try {
          const res = await send;
          result = `HTTP ${res.status}`;
          if (res.output) out = merge(out, res.output);
        } catch (e) {
          result = `发送失败：${e instanceof Error ? e.message : String(e)}`;
          outcome = 'crit';
        }
      }
    } else {
      let o = hookOutput(r);
      if (event === 'PermissionRequest' && (r.action === 'allow' || r.action === 'deny')) {
        o = { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: r.action === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: r.text || 'Denied by a hook rule.' } } };
      }
      out = merge(out, o);
      if (r.action === 'title' && r.text) patchSummary(sid, { title: r.text });
      if (event === 'PreToolUse' && r.action === 'deny' && !denied) {
        denied = true;
        markDenied(sid, String(input.tool_use_id ?? ''), `被钩子「${r.name}」拒绝`);
      }
    }
    logHook({ event, rule: r.name, target: targetOf(input), outcome, result, ms: Date.now() - t0 });
  }
  // A webhook that denied a tool call shows on its card like a rule.
  const decision = (out?.hookSpecificOutput as { permissionDecision?: string } | undefined)?.permissionDecision;
  if (event === 'PreToolUse' && decision === 'deny' && !denied) markDenied(sid, String(input.tool_use_id ?? ''), '被钩子拒绝');
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
  ];
  if (JSON.stringify(list) !== JSON.stringify(app.fileHooks)) set('fileHooks', list);
}
