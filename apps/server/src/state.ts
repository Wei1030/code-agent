/**
 * The app state the server keeps and pushes to the UI (AppSlices). Plain slices are saved in
 * state.json; slices that mirror files on disk (rules, MCP servers, skills…) are written back by
 * the handler registered with onWrite and re-read from disk.
 */
import type { WebSocket } from 'ws';
import type { AppSlices, Profile, SliceKey } from '@code-agent/shared/types';
import { READONLY_SLICES } from '@code-agent/shared/types';
import { BUILTIN_TOOLS, MODELS } from '@code-agent/shared/catalog';
import { broadcast } from './hub';
import { load, save } from './store';

export const DEFAULT_PROFILE: Profile = {
  id: 'p-default', name: '默认', desc: '新会话和 Claude 新建的会话使用', isDefault: true, allowBypass: false,
  model: 'opus', effort: 'max', mode: 'default', prompts: 'host',
  tools: BUILTIN_TOOLS.map((t) => t.name), questionPreviews: true,
  sources: { user: true, project: true, local: true }, promptMode: 'append', promptText: '', responseLanguage: 'ui',
  features: { checkpoints: true, subagentText: true, progressSummaries: true, hookEvents: true, persist: true, verbatim: false },
};

function defaults(): AppSlices {
  return {
    workspaces: [],
    prefs: {
      uiLanguage: 'auto', responseLanguage: 'ui', responseLanguageCustom: '', numberStyle: 'intl', showRawSdkText: false,
      browserNotifications: true, notifyRequests: true, notifyTurnDone: true, notifyBackground: true,
    },
    profiles: [DEFAULT_PROFILE],
    rules: [],
    dirs: [],
    mcp: [],
    mcpBehavior: { strict: false, toolSearch: 'auto', firstTurnWait: 30 },
    skills: [],
    commandFiles: [],
    plugins: [],
    hookRules: [],
    fileHooks: [],
    hookLog: [],
    jobs: [],
    jobRuns: [],
    peer: { inbound: 'parity', maxHops: 6 },
    maxRunning: 4,
    board: [],
    boardSettings: { recorder: true, recorderModel: 'haiku', recorderEffort: 'low', startContext: true },
    reviews: [],
    reviewChecks: {},
    reviewProfile: { model: 'opus', effort: 'high', tools: [], claudeMd: true, extraPrompt: '' },
    reviewed: {},
    held: [],
    provider: {
      kind: 'subscription', configDir: 'default', customDir: '', executable: 'bundled', loggedIn: false, plan: '',
      envConflict: false, compatibleUrl: '', compatibleModel: '',
    },
    env: [],
    runtime: { debugLog: false, otel: false, otelEndpoint: '', otelMetrics: false, otelLogs: false, otelTraces: false, otelPrompts: false, otelTools: false },
    models: MODELS,
    usage: { fiveHour: null, weekly: null, checkedAt: null, days: {} },
  };
}

/** Slices kept in their own file; the rest of the saved ones go to state.json. */
const OWN_FILE: Partial<Record<SliceKey, string>> = { board: 'board.json', reviews: 'reviews.json', usage: 'usage.json', jobRuns: 'job-runs.json', hookLog: 'hook-log.json' };
/** Slices read from disk (Claude Code's files), never saved by us. */
const FROM_DISK: SliceKey[] = ['rules', 'dirs', 'mcp', 'skills', 'commandFiles', 'fileHooks'];

const def = defaults();
const saved = load<Partial<AppSlices>>('state.json', {});
export const app: AppSlices = { ...def };
for (const k of Object.keys(def) as SliceKey[]) {
  if (FROM_DISK.includes(k)) continue;
  const own = OWN_FILE[k];
  const v = own ? load(own, undefined) : saved[k];
  if (v !== undefined) (app as unknown as Record<string, unknown>)[k] = v;
}
// Settings added in later versions get their defaults.
app.prefs = { ...def.prefs, ...app.prefs };
app.provider = { ...def.provider, ...app.provider };
app.runtime = { ...def.runtime, ...app.runtime };
app.boardSettings = { ...def.boardSettings, ...app.boardSettings };
app.reviewProfile = { ...def.reviewProfile, ...app.reviewProfile };
app.profiles = app.profiles.length ? app.profiles.map((p) => ({ ...DEFAULT_PROFILE, ...p })) : [DEFAULT_PROFILE];

function persist(key: SliceKey) {
  if (FROM_DISK.includes(key) || key === 'models') return;
  const own = OWN_FILE[key];
  if (own) {
    save(own, () => app[key]);
    return;
  }
  save('state.json', () => {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(app) as SliceKey[]) if (!FROM_DISK.includes(k) && !OWN_FILE[k] && k !== 'models') out[k] = app[k];
    return out;
  });
}

/** Change a slice: save it and tell the UI (except the client the change came from). */
export function set<K extends SliceKey>(key: K, value: AppSlices[K], except?: WebSocket | null) {
  app[key] = value;
  persist(key);
  broadcast({ t: 'app', patch: { [key]: value } as Partial<AppSlices> }, except);
}

export function update<K extends SliceKey>(key: K, fn: (v: AppSlices[K]) => AppSlices[K]) {
  set(key, fn(app[key]));
}

type Writer<K extends SliceKey> = (next: AppSlices[K], prev: AppSlices[K]) => void | Promise<void>;
const writers = new Map<SliceKey, Writer<SliceKey>>();

/** Handle the UI's edits of a slice (write files, apply to running sessions…). */
export function onWrite<K extends SliceKey>(key: K, fn: Writer<K>) {
  writers.set(key, fn as unknown as Writer<SliceKey>);
}

/** The UI changed some slices. */
export async function clientSet(patch: Partial<AppSlices>, from: WebSocket | null) {
  for (const [k, v] of Object.entries(patch) as Array<[SliceKey, AppSlices[SliceKey]]>) {
    if ((READONLY_SLICES as readonly string[]).includes(k) || !(k in app)) continue;
    const prev = app[k];
    const w = writers.get(k);
    if (w) {
      try {
        await w(v, prev);
      } catch (e) {
        console.error(`[state] writing ${k} failed:`, e);
        // Tell the client what actually holds.
        broadcast({ t: 'app', patch: { [k]: app[k] } as Partial<AppSlices> });
        throw e;
      }
      // A writer that re-read the slice from disk has already broadcast it.
      if (app[k] === prev) set(k, v, from);
    } else {
      set(k, v, from);
    }
  }
}
