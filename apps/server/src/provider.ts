/**
 * Model services: the Claude subscription (login state, plan, models and limits, learned from
 * short-lived Claude Code processes that send no prompt — Code Agent never signs in itself and never
 * reads credentials) and compatible endpoints (URL, token kept on the server, models).
 */
import { query, type Query, type SDKControlInitializeResponse } from '@anthropic-ai/claude-agent-sdk';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Endpoint, ModelInfo, Provider } from '@code-agent/shared/types';
import { app, onWrite, set } from './state';
import { applyConfigDir, endpointKey, ENV_CONFIG_DIR, envCredentialVar, NO_TOKEN, processEnv, setEndpointKey, systemClaude } from './claude/files';
import { GIT_BASH } from './claude/gitbash';
import { recordLimits } from './usage';
import { register } from './hub';
import { apiErrorText, decidesOwnWindow } from '@code-agent/shared/catalog';
import { envFor, isClaudeModel, noteClaudeModels, reasoning, refreshModels, resolveModel } from './models';

const DESC: Record<string, string> = {
  opus: '复杂工作和日常任务', fable: '最难的问题、长任务', sonnet: '简单任务，快且省', haiku: '最快，适合简单问答',
};

/** Run a Claude Code process on the Claude subscription that sends no prompt, ask it something, close it. */
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

/** What the server's own environment says about credentials and the config directory. */
export function envFacts(ignoreEnvKey?: boolean) {
  const envVar = envCredentialVar();
  return { envVar, envConflict: !!envVar && !ignoreEnvKey, envConfigDir: ENV_CONFIG_DIR };
}

/** A Claude Code process on the Claude subscription started; it tells us the login and the models. */
export function noteInit(init: SDKControlInitializeResponse) {
  const p = app.provider;
  // Aliases (opus, sonnet…) only; Claude Code also lists pinned model ids.
  const list = (init.models ?? []).filter((m) => m.value !== 'default');
  const aliases = list.filter((m) => !m.value.startsWith('claude-'));
  const models: ModelInfo[] = (aliases.length ? aliases : list).map((m) => ({
    id: m.value, label: m.displayName, desc: DESC[m.value] ?? m.description, efforts: (m.supportedEffortLevels ?? ['low', 'medium', 'high']) as ModelInfo['efforts'],
  }));
  const acct = init.account as { email?: string; subscriptionType?: string } | undefined;
  const next = {
    ...p, loggedIn: !!acct?.subscriptionType, plan: (acct?.subscriptionType ?? '').replace(/^Claude\s+/i, ''), account: acct?.email,
    ...envFacts(p.ignoreEnvKey), checkedAt: Date.now(), error: undefined,
  };
  if (JSON.stringify(next) !== JSON.stringify({ ...p, checkedAt: next.checkedAt })) set('provider', next);
  noteClaudeModels(models);
  refreshModels();
}

let checking: Promise<void> | null = null;
let rerun: Promise<void> | null = null;

/** Ask Claude Code who is logged in, which models it offers and how much of the plan is used. */
export function checkLogin(): Promise<void> {
  // A check asked for while one runs (e.g. the config dir just changed) runs once that one is done.
  if (checking) return (rerun ??= checking.then(() => { rerun = null; return checkLogin(); }));
  checking = withProbe(os.homedir(), async (q) => {
    const init = await q.initializationResult();
    noteInit(init);
    void import('./ext/skills').then((m) => m.noteCommands(init.commands ?? []));
    if (app.provider.loggedIn) {
      try {
        recordLimits(await q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }));
      } catch {
        // Limits are optional.
      }
    }
  }).catch((e: unknown) => {
    set('provider', { ...app.provider, loggedIn: false, error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() });
    refreshModels();
  }).finally(() => {
    checking = null;
  });
  return checking;
}

/**
 * The context window an endpoint reports for a model: max_input_tokens from the Models API
 * (GET /v1/models/<name>). Most endpoints do not have it; then there is none.
 */
async function reportedWindow(ep: Endpoint, name: string): Promise<number | undefined> {
  const key = endpointKey(ep.id) || NO_TOKEN;
  try {
    const res = await fetch(`${ep.url.replace(/\/+$/, '')}/v1/models/${encodeURIComponent(name)}`, {
      headers: { authorization: `Bearer ${key}`, 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const n = ((await res.json()) as { max_input_tokens?: unknown }).max_input_tokens;
    return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Send one short prompt to a model to see whether its service answers. For an endpoint model whose
 * window Claude Code does not decide itself, also ask the endpoint for its context window, and fill
 * it in unless one is set already.
 */
async function testModel(modelId: string): Promise<{ ok: boolean; message: string; contextWindow?: number }> {
  const r = resolveModel(modelId);
  const reported = r.endpoint && !decidesOwnWindow(r.name) ? reportedWindow(r.endpoint, r.name) : undefined;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  const t0 = Date.now();
  let result: { ok: boolean; message: string } = { ok: false, message: '没有回复' };
  let failed = false;
  try {
    const exe = app.provider.executable === 'system' ? systemClaude() : undefined;
    const q = query({
      prompt: 'Reply with exactly: OK',
      options: {
        cwd: os.tmpdir(), model: r.name, ...reasoning(r, undefined), persistSession: false, settingSources: [], tools: [], maxTurns: 1, permissionMode: 'dontAsk',
        systemPrompt: 'Answer in as few words as possible.', env: envFor(modelId), abortController: abort, ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
      },
    });
    for await (const m of q) {
      // Claude Code retries a failed call for minutes; for a test the first failure is the answer.
      if (m.type === 'system' && m.subtype === 'api_retry') {
        result = { ok: false, message: apiErrorText(m.error, m.error_status) };
        failed = true;
        abort.abort();
        break;
      }
      if (m.type === 'assistant' && m.error) result = { ok: false, message: String(m.error) };
      if (m.type !== 'result') continue;
      const text = m.subtype === 'success' ? m.result.trim() : '';
      result = m.subtype === 'success' && !m.is_error
        ? { ok: true, message: `${((Date.now() - t0) / 1000).toFixed(1)} 秒 · 回复「${text.slice(0, 40)}」` }
        : { ok: false, message: (m.subtype === 'success' ? m.result : (m as { errors?: string[] }).errors?.join('；')) || m.subtype };
    }
  } catch (e) {
    if (!failed) result = { ok: false, message: abort.signal.aborted ? '60 秒内没有回复' : e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
  const contextWindow = await reported;
  if (r.endpoint) {
    const ep = r.endpoint;
    const test = { ...result, at: Date.now() };
    const prev = app.provider;
    set('provider', { ...prev, endpoints: prev.endpoints.map((e) => (e.id !== ep.id ? e : { ...e, models: e.models.map((m) => (m.name !== r.name ? m : { ...m, test, contextWindow: m.contextWindow ?? contextWindow })) })) });
    // A window filled in restarts the sessions on the model, as one typed in does.
    void restartStale((model) => model === modelId && settingsOf(prev, model) !== settingsOf(app.provider, model));
  }
  return { ...result, contextWindow };
}

/**
 * Running endpoint processes whose environment no longer holds (the endpoint is gone or moved, its
 * token, the model's thinking switch or context window changed) restart with the new settings and
 * carry on the conversation; when the model itself is gone, the process ends and the session asks
 * for another.
 * A busy session (a turn, a pending request, queued messages, background work) is left to finish first.
 */
const settingsOf = (p: Provider, model: string) => {
  const m = /^ep:([^:]+):([\s\S]+)$/.exec(model);
  const ep = m && p.endpoints.find((e) => e.id === m[1]);
  const em = ep && ep.models.find((x) => x.name === m[2]);
  return em ? `${ep.url}\t${em.effort}\t${em.contextWindow ?? ''}` : '';
};
async function restartStale(changed: (model: string) => boolean) {
  const { closeProcess, liveIds } = await import('./sessions/live');
  const { addItem, rt } = await import('./sessions/registry');
  const { restartProcess } = await import('./sessions/ops');
  const { whenIdle } = await import('./sessions/slots');
  for (const sid of liveIds()) {
    const model = rt(sid)?.model;
    if (!model || isClaudeModel(model) || !changed(model)) continue;
    whenIdle(sid, () => {
      const now = rt(sid)?.model ?? '';
      const gone = !app.models.some((m) => m.id === now);
      addItem(sid, gone
        ? { kind: 'notice', id: randomUUID(), tone: 'warn', text: `模型 ${now.replace(/^ep:[^:]+:/, '')} 已经从兼容端点里删除，Claude Code 已退出。恢复会话时可以选一个模型，默认用「默认」方案的模型。` }
        : { kind: 'notice', id: randomUUID(), tone: 'info', text: '兼容端点的设置改了，Claude Code 按新设置重新启动后接着这段对话。' });
      void (gone ? closeProcess(sid) : restartProcess(sid)).catch((e) => console.error('[provider] restart failed:', e));
    });
  }
}

onWrite('provider', (next, prev) => {
  // "Ignore this variable" in the UI sets envConflict to false.
  const ignoreEnvKey = next.ignoreEnvKey || (prev.envConflict && !next.envConflict);
  // Tokens of removed endpoints go too.
  for (const e of prev.endpoints) if (!next.endpoints.some((x) => x.id === e.id)) setEndpointKey(e.id, null);
  const endpoints = next.endpoints.map((e) => ({ ...e, keySet: !!endpointKey(e.id) }));
  const merged = { ...next, endpoints, ignoreEnvKey, loggedIn: prev.loggedIn, plan: prev.plan, account: prev.account, ...envFacts(ignoreEnvKey) };
  set('provider', merged);
  refreshModels();
  void restartStale((model) => settingsOf(prev, model) !== settingsOf(merged, model));
  if (merged.configDir !== prev.configDir || merged.customDir !== prev.customDir) {
    applyConfigDir();
    // Sessions in the folders' transcripts there.
    void import('./sessions/history').then((h) => h.scanExternal());
  }
  if (merged.configDir !== prev.configDir || merged.customDir !== prev.customDir || merged.executable !== prev.executable) void checkLogin();
});

set('provider', { ...app.provider, ...envFacts(app.provider.ignoreEnvKey), endpoints: (app.provider.endpoints ?? []).map((e) => ({ ...e, keySet: !!endpointKey(e.id) })) });
applyConfigDir();
refreshModels();

register({
  checkLogin: () => checkLogin(),
  refreshUsage: () => checkLogin(),
  setEndpointKey: (id, key) => {
    setEndpointKey(id, key || null);
    set('provider', { ...app.provider, endpoints: app.provider.endpoints.map((e) => (e.id === id ? { ...e, keySet: !!key } : e)) });
    void restartStale((model) => model.startsWith(`ep:${id}:`));
  },
  testModel,
  gitBash: () => GIT_BASH,
});
