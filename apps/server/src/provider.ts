/**
 * The provider side: login state, plan, models and limits, learned from short-lived Claude Code
 * processes ("probes") that never send a prompt. Code Agent never signs in itself and never
 * reads credentials: it only asks Claude Code what it sees.
 */
import { query, type Query, type SDKControlInitializeResponse } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
import type { ModelInfo } from '@code-agent/shared/types';
import { app, onWrite, set } from './state';
import { compatibleKey, envCredentialVar, processEnv, setCompatibleKey, systemClaude } from './claude/files';
import { recordLimits } from './usage';
import { register } from './hub';

const DESC: Record<string, string> = {
  opus: '复杂工作和日常任务', fable: '最难的问题、长任务', sonnet: '简单任务，快且省', haiku: '最快，适合简单问答',
};

/** Run a Claude Code process that sends no prompt, ask it something, and close it. */
export async function withProbe<T>(cwd: string, fn: (q: Query) => Promise<T>, timeoutMs = 60_000): Promise<T> {
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  async function* none() {
    await hold;
  }
  const exe = app.provider.executable === 'system' ? systemClaude() : undefined;
  const q = query({ prompt: none(), options: { cwd, persistSession: false, env: processEnv(), ...(exe ? { pathToClaudeCodeExecutable: exe } : {}) } });
  const timer = setTimeout(() => q.close(), timeoutMs);
  try {
    return await fn(q);
  } finally {
    clearTimeout(timer);
    release();
    q.close();
  }
}

/** `probe`: from a probe, which sees every skill (sessions only see the enabled ones). */
export function noteInit(init: SDKControlInitializeResponse, probe = false) {
  const p = app.provider;
  if (probe) void import('./ext/skills').then((m) => m.noteCommands(init.commands ?? []));
  if (p.kind === 'subscription') {
    // Aliases (opus, sonnet…) only; Claude Code also lists pinned model ids.
    const list = (init.models ?? []).filter((m) => m.value !== 'default');
    const aliases = list.filter((m) => !m.value.startsWith('claude-'));
    const models: ModelInfo[] = (aliases.length ? aliases : list).map((m) => ({
      id: m.value, label: m.displayName, desc: DESC[m.value] ?? m.description, efforts: (m.supportedEffortLevels ?? ['low', 'medium', 'high']) as ModelInfo['efforts'],
    }));
    if (models.length && JSON.stringify(models) !== JSON.stringify(app.models)) set('models', models);
  }
  const acct = init.account as { email?: string; subscriptionType?: string; apiProvider?: string } | undefined;
  const loggedIn = p.kind === 'compatible' ? true : !!acct?.subscriptionType;
  const plan = (acct?.subscriptionType ?? '').replace(/^Claude\s+/i, '');
  const next = { ...p, loggedIn, plan, account: acct?.email, ...envFacts(p.ignoreEnvKey), checkedAt: Date.now(), error: undefined };
  if (JSON.stringify(next) !== JSON.stringify({ ...p, checkedAt: next.checkedAt })) set('provider', next);
}

/** What the server's own environment says about credentials and the config directory. */
export function envFacts(ignoreEnvKey?: boolean) {
  const envVar = envCredentialVar();
  return { envVar, envConflict: !!envVar && !ignoreEnvKey, envConfigDir: process.env.CLAUDE_CONFIG_DIR };
}

let checking: Promise<void> | null = null;

/** Ask Claude Code who is logged in, which models it offers and how much of the plan is used. */
export function checkLogin(): Promise<void> {
  if (checking) return checking;
  checking = withProbe(os.homedir(), async (q) => {
    const init = await q.initializationResult();
    noteInit(init, true);
    if (app.provider.kind === 'subscription' && app.provider.loggedIn) {
      try {
        recordLimits(await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
      } catch {
        // Limits are optional.
      }
    }
  }).catch((e: unknown) => {
    set('provider', { ...app.provider, loggedIn: false, error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() });
  }).finally(() => {
    checking = null;
  });
  return checking;
}

export function compatibleModels(): ModelInfo[] {
  const m = app.provider.compatibleModel || '兼容端点模型';
  return [{ id: 'opus', label: m, desc: '兼容端点上配置的模型', efforts: ['low', 'medium', 'high', 'max'] }];
}

onWrite('provider', (next, prev) => {
  // "Ignore this variable" in the UI sets envConflict to false.
  const ignoreEnvKey = next.ignoreEnvKey || (prev.envConflict && !next.envConflict);
  const merged = { ...next, ignoreEnvKey, loggedIn: prev.loggedIn, plan: prev.plan, account: prev.account, ...envFacts(ignoreEnvKey) };
  set('provider', merged);
  if (merged.kind === 'compatible') set('models', compatibleModels());
  if (merged.kind !== prev.kind || merged.configDir !== prev.configDir || merged.customDir !== prev.customDir || merged.executable !== prev.executable) {
    void checkLogin();
  }
});

set('provider', { ...app.provider, ...envFacts(app.provider.ignoreEnvKey), compatibleKeySet: !!compatibleKey() });

register({
  checkLogin: () => checkLogin(),
  refreshUsage: () => checkLogin(),
  setCompatibleKey: (key) => {
    setCompatibleKey(key);
    set('provider', { ...app.provider, compatibleKeySet: !!key });
  },
});
