/**
 * Token ledger (per local day and model, from each turn's result) and the plan's 5-hour / weekly
 * limits (from rate-limit events and Claude Code's usage answer).
 */
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { UsageData } from '@code-agent/shared/types';
import { app, set } from './state';

function day(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let pendingSave: NodeJS.Timeout | null = null;
function commit(u: UsageData) {
  app.usage = u;
  if (pendingSave) return;
  // Results come in bursts; tell the UI at most once a second.
  pendingSave = setTimeout(() => {
    pendingSave = null;
    set('usage', app.usage);
  }, 1000);
}

type ModelUsage = { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number };

export function family(model: string): string {
  const m = model.toLowerCase();
  return ['opus', 'sonnet', 'haiku', 'fable'].find((f) => m.includes(f)) ?? 'other';
}

export function recordUsage(models: Record<string, ModelUsage> | undefined, workspaceId = '') {
  if (!models) return;
  const d = day();
  const days = { ...app.usage.days, [d]: { ...(app.usage.days[d] ?? {}) } };
  const cache = { ...(app.usage.cache ?? {}) };
  const c = { ...(cache[d] ?? { input: 0, cacheRead: 0 }) };
  for (const [model, u] of Object.entries(models)) {
    const n = (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
    const key = `${workspaceId}\t${family(model)}`;
    if (n) days[d][key] = (days[d][key] ?? 0) + n;
    c.input += (u.inputTokens ?? 0) + (u.cacheReadInputTokens ?? 0) + (u.cacheCreationInputTokens ?? 0);
    c.cacheRead += u.cacheReadInputTokens ?? 0;
  }
  cache[d] = c;
  // Keep about 400 days.
  const keys = Object.keys(days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) {
    delete days[k];
    delete cache[k];
  }
  commit({ ...app.usage, days, cache });
}

const pct = (v: number) => (v <= 1 ? Math.round(v * 100) : Math.round(v));

export function recordLimit(info: SDKRateLimitInfo) {
  if (info.utilization === undefined) return;
  const w = { utilization: pct(info.utilization), resetsAt: info.resetsAt ? info.resetsAt * 1000 : null };
  if (info.rateLimitType === 'five_hour') commit({ ...app.usage, fiveHour: w, checkedAt: Date.now() });
  else if (info.rateLimitType === 'seven_day') commit({ ...app.usage, weekly: w, checkedAt: Date.now() });
}

type Window = { utilization: number | null; resets_at: string | null } | null | undefined;

export function recordLimits(r: { rate_limits_available: boolean; rate_limits: { five_hour?: Window; seven_day?: Window } | null }) {
  if (!r.rate_limits_available || !r.rate_limits) {
    set('usage', { ...app.usage, fiveHour: null, weekly: null, checkedAt: Date.now() });
    return;
  }
  const conv = (w: Window) => (w && w.utilization !== null ? { utilization: Math.round(w.utilization), resetsAt: w.resets_at ? Date.parse(w.resets_at) : null } : null);
  set('usage', { ...app.usage, fiveHour: conv(r.rate_limits.five_hour), weekly: conv(r.rate_limits.seven_day), checkedAt: Date.now() });
}
