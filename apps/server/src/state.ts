/**
 * The app state the server keeps and pushes to the UI (AppSlices). Plain slices are rows of the
 * database (board items one row each); slices that mirror files on disk (rules, MCP servers, skills…) are written back by
 * the handler registered with onWrite and re-read from disk.
 */
import type { WebSocket } from 'ws';
import type { AppSlices, BoardItem, Profile, SliceKey } from '@code-agent/shared/types';
import { READONLY_SLICES } from '@code-agent/shared/types';
import { BUILTIN_TOOLS, MODELS } from '@code-agent/shared/catalog';
import { broadcast } from './hub';
import { db, later, load, save, tx } from './store';

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

/** Slices read from disk (Claude Code's files), never saved by us. */
const FROM_DISK: SliceKey[] = ['rules', 'dirs', 'mcp', 'skills', 'commandFiles', 'fileHooks'];

const def = defaults();
export const app: AppSlices = { ...def };
for (const k of Object.keys(def) as SliceKey[]) {
  if (FROM_DISK.includes(k) || k === 'models' || k === 'board') continue;
  const v = load<unknown>(`slice:${k}`, undefined);
  if (v !== undefined) (app as unknown as Record<string, unknown>)[k] = v;
}
app.board = (db.prepare('SELECT data FROM board_items').all() as Array<{ data: string }>).map((r) => JSON.parse(r.data) as BoardItem);
// Settings added in later versions get their defaults.
app.prefs = { ...def.prefs, ...app.prefs };
app.provider = { ...def.provider, ...app.provider };
app.runtime = { ...def.runtime, ...app.runtime };
app.boardSettings = { ...def.boardSettings, ...app.boardSettings };
app.reviewProfile = { ...def.reviewProfile, ...app.reviewProfile };
app.mcpBehavior = { ...def.mcpBehavior, ...app.mcpBehavior };
app.profiles = app.profiles.length ? app.profiles.map((p) => ({ ...DEFAULT_PROFILE, ...p })) : [DEFAULT_PROFILE];

/** Board items as last written, to write only the ones that changed. */
let savedBoard = new Map(app.board.map((x) => [`${x.workspaceId}\t${x.id}`, x]));
const putItem = db.prepare('INSERT INTO board_items (workspace, id, data) VALUES (?, ?, ?) ON CONFLICT(workspace, id) DO UPDATE SET data = excluded.data');
const delItem = db.prepare('DELETE FROM board_items WHERE workspace = ? AND id = ?');

function saveBoard() {
  const now = new Map(app.board.map((x) => [`${x.workspaceId}\t${x.id}`, x]));
  tx(() => {
    for (const [k, x] of now) if (savedBoard.get(k) !== x) putItem.run(x.workspaceId, x.id, JSON.stringify(x));
    for (const [k, x] of savedBoard) if (!now.has(k)) delItem.run(x.workspaceId, x.id);
  });
  savedBoard = now;
}

function persist(key: SliceKey) {
  if (FROM_DISK.includes(key) || key === 'models') return;
  if (key === 'board') later('board', saveBoard);
  else save(`slice:${key}`, () => app[key]);
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
