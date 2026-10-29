/**
 * The models Code Agent offers: the Claude subscription's (as Claude Code reports them) and every
 * model of every compatible endpoint. A model id says which service runs it, so each process —
 * session, reviewer, job, background run — gets that service's environment.
 */
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import type { Endpoint, ModelInfo } from '@code-agent/shared/types';
import { apiErrorText, FATAL_API_ERRORS, MODELS } from '@code-agent/shared/catalog';
import { app, set } from './state';
import { load, save } from './store';
import { endpointKey, processEnv } from './claude/files';

let claude: ModelInfo[] = load('claude-models', MODELS);

export const endpointModelId = (endpoint: string, name: string) => `ep:${endpoint}:${name}`;

/** Claude Code reported the subscription's models. */
export function noteClaudeModels(list: ModelInfo[]) {
  if (!list.length || JSON.stringify(list) === JSON.stringify(claude)) return;
  claude = list;
  save('claude-models', () => claude);
  refreshModels();
}

export function refreshModels() {
  const fromEndpoints: ModelInfo[] = app.provider.endpoints.flatMap((ep) => ep.models.filter((m) => m.name.trim()).map((m) => ({
    id: endpointModelId(ep.id, m.name), label: m.name, desc: ep.name || ep.url, efforts: m.effort ? ['low', 'medium', 'high', 'max'] as ModelInfo['efforts'] : [], endpoint: ep.id,
  })));
  // Claude's models are offered when logged in, and as a fallback when nothing else is configured.
  const list = [...(app.provider.loggedIn || !fromEndpoints.length ? claude : []), ...fromEndpoints];
  if (JSON.stringify(list) !== JSON.stringify(app.models)) set('models', list);
  dropGoneModels();
}

/** Settings that name a model of a removed endpoint (or a removed endpoint model) take the first model there is. */
function dropGoneModels() {
  const fix = (id: string) => (isClaudeModel(id) || app.models.some((m) => m.id === id) ? id : validModel(id));
  const profiles = app.profiles.map((p) => ({ ...p, model: fix(p.model) }));
  if (profiles.some((p, i) => p.model !== app.profiles[i].model)) set('profiles', profiles);
  if (fix(app.reviewProfile.model) !== app.reviewProfile.model) set('reviewProfile', { ...app.reviewProfile, model: fix(app.reviewProfile.model) });
  if (fix(app.boardSettings.recorderModel) !== app.boardSettings.recorderModel) set('boardSettings', { ...app.boardSettings, recorderModel: fix(app.boardSettings.recorderModel) });
  const jobs = app.jobs.map((j) => ({ ...j, model: fix(j.model) }));
  if (jobs.some((j, i) => j.model !== app.jobs[i].model)) set('jobs', jobs);
}

export interface Resolved {
  /** The endpoint serving it; undefined for the Claude subscription. */
  endpoint?: Endpoint;
  /** What to pass as the model: a Claude alias or the endpoint's model name. */
  name: string;
  /** Whether to send thinking and the effort level. */
  effort: boolean;
}

/**
 * Thinking and effort for a run. Claude Code sends both by default, even to models it does not
 * know, so an endpoint model not marked as taking them gets thinking turned off and no effort of
 * ours (Claude Code still tries its default effort once and drops it if the endpoint refuses it).
 */
export function reasoning(model: Resolved, effort: Options['effort']): Pick<Options, 'effort' | 'thinking'> {
  if (model.endpoint && !model.effort) return { thinking: { type: 'disabled' } };
  return effort ? { effort } : {};
}

export function resolveModel(id: string): Resolved {
  const m = /^ep:([^:]+):([\s\S]+)$/.exec(id);
  if (!m) return { name: id, effort: true };
  const ep = app.provider.endpoints.find((e) => e.id === m[1]);
  if (!ep) throw new Error(`模型 ${m[2]} 所在的兼容端点已经删除，请换一个模型`);
  return { endpoint: ep, name: m[2], effort: !!ep.models.find((x) => x.name === m[2])?.effort };
}

/** Environment of a Claude Code process running this model. */
export function envFor(modelId: string) {
  const r = resolveModel(modelId);
  if (!r.endpoint) return processEnv();
  return processEnv({ url: r.endpoint.url, key: endpointKey(r.endpoint.id), model: r.name });
}

/**
 * One process can switch from model a to b: both are Claude models. An endpoint process is set up
 * for its one model (its name stands in for every alias, thinking is on or off for it), so any
 * other model restarts it.
 */
export function oneProcess(a: string, b: string): boolean {
  return a === b || (isClaudeModel(a) && isClaudeModel(b));
}

export const isClaudeModel = (id: string) => !id.startsWith('ep:');

/** A model that still exists: `id` itself, else the first one offered. */
export function validModel(id: string): string {
  return app.models.some((m) => m.id === id) ? id : app.models[0]?.id ?? id;
}

/** The 默认 profile's model, or the first there is. */
export function defaultModel(): string {
  const prof = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
  return validModel(prof?.model ?? '');
}

/**
 * A failed API call Claude Code retries in vain (it retries 401s and the like for minutes): the
 * endpoint refused the token, the account or the model. Returns what to tell the user. Claude's
 * own login errors are left to Claude Code, which can refresh the login.
 */
export function pointlessRetry(modelId: string, m: { error?: unknown; error_status?: unknown }): string | null {
  const error = String(m.error ?? '');
  if (isClaudeModel(modelId) || !FATAL_API_ERRORS.includes(error)) return null;
  return apiErrorText(error, typeof m.error_status === 'number' ? m.error_status : null);
}
