/** App-wide state: registries, preferences and UI chrome. Sessions live in ./sessions. */
import { create } from 'zustand';
import type {
  CommandFile, EnvVar, ExtraDir, FileHook, HeldMessage, HookLogEntry, HookRule, JobRun, JobTemplate, McpServer, PeerSettings, PermissionRule,
  PluginInfo, Prefs, Profile, ProviderKind, SessionSummary, SkillInfo, Workspace,
} from '../api/types';
import { COMMAND_FILES, FILE_HOOKS, HOOK_LOG, HOOK_RULES, MCP_SERVERS, PLUGINS, SKILLS } from '../mock/extensions';
import { JOB_RUNS, JOBS } from '../mock/jobs';
import { ENV_VARS, PROFILES, RULES, SESSIONS, WORKSPACES } from '../mock/data';
import { uid } from '../lib/util';

export interface Toast {
  id: string;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'crit';
  action?: { label: string; run: () => void };
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  /** When set, the user must type this word to enable the confirm button. */
  typeToConfirm?: string;
  onConfirm: () => void;
}

export interface Provider {
  kind: ProviderKind;
  configDir: 'default' | 'env' | 'custom';
  customDir: string;
  executable: 'bundled' | 'system';
  loggedIn: boolean;
  plan: string;
  envConflict: boolean;
  compatibleUrl: string;
  compatibleModel: string;
}

export type InspectorTab = 'tasks' | 'background' | 'changes' | 'checkpoints' | 'context' | 'events';

interface AppState {
  workspaces: Workspace[];
  sessions: SessionSummary[];
  currentWorkspaceId: string;
  prefs: Prefs;
  profiles: Profile[];
  rules: PermissionRule[];
  dirs: ExtraDir[];
  mcp: McpServer[];
  mcpBehavior: { strict: boolean; toolSearch: 'auto' | 'on' | 'off'; firstTurnWait: number };
  skills: SkillInfo[];
  commandFiles: CommandFile[];
  plugins: PluginInfo[];
  hookRules: HookRule[];
  fileHooks: FileHook[];
  hookLog: HookLogEntry[];
  jobs: JobTemplate[];
  jobRuns: JobRun[];
  peer: PeerSettings;
  /** Messages between sessions waiting for the user to release them. */
  held: HeldMessage[];
  provider: Provider;
  env: EnvVar[];
  runtime: { debugLog: boolean; otel: boolean; otelEndpoint: string; otelMetrics: boolean; otelLogs: boolean; otelTraces: boolean; otelPrompts: boolean; otelTools: boolean };
  connection: 'online' | 'offline' | 'restored';
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  inspector: { open: boolean; width: number; tab: InspectorTab; eventsSub: 'events' | 'stderr' | 'hooks' };
  mockConsoleOpen: boolean;
  folderPickerOpen: boolean;
  /** Text pushed into a session's composer (suggestions, fork-and-edit). */
  fill: { sid: string; text: string; n: number } | null;

  set: (patch: Partial<AppState>) => void;
  toast: (text: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismissToast: (id: string) => void;
  ask: (c: ConfirmRequest) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  setProvider: (p: Partial<Provider>) => void;
  setInspector: (p: Partial<AppState['inspector']>) => void;
  upsertSession: (s: SessionSummary) => void;
  patchSession: (id: string, p: Partial<SessionSummary>) => void;
  removeSession: (id: string) => void;
  addWorkspace: (path: string) => Workspace;
  saveProfile: (p: Profile) => void;
  fillComposer: (sid: string, text: string) => void;
  logHook: (e: Omit<HookLogEntry, 'id' | 'ts'>) => void;
}

export const useApp = create<AppState>((set, get) => ({
  workspaces: WORKSPACES,
  sessions: SESSIONS,
  currentWorkspaceId: WORKSPACES[0].id,
  prefs: {
    uiLanguage: 'auto',
    responseLanguage: 'ui',
    responseLanguageCustom: '',
    numberStyle: 'intl',
    showRawSdkText: false,
    browserNotifications: true,
  },
  profiles: PROFILES,
  rules: RULES,
  dirs: [{ id: 'dir-1', path: 'D:\\src\\design-tokens', scope: 'workspace', workspaceId: 'ws-shop-web' }],
  mcp: MCP_SERVERS,
  mcpBehavior: { strict: false, toolSearch: 'auto', firstTurnWait: 30 },
  skills: SKILLS,
  commandFiles: COMMAND_FILES,
  plugins: PLUGINS,
  hookRules: HOOK_RULES,
  fileHooks: FILE_HOOKS,
  hookLog: HOOK_LOG,
  jobs: JOBS,
  jobRuns: JOB_RUNS,
  peer: { inbound: 'parity', maxHops: 6, maxRunning: 4, idleSaveMinutes: 30 },
  held: [],
  provider: {
    kind: 'subscription', configDir: 'default', customDir: '', executable: 'bundled', loggedIn: true, plan: 'Max',
    envConflict: false, compatibleUrl: '', compatibleModel: '',
  },
  env: ENV_VARS,
  runtime: { debugLog: false, otel: false, otelEndpoint: '', otelMetrics: false, otelLogs: false, otelTraces: false, otelPrompts: false, otelTools: false },
  connection: 'online',
  toasts: [],
  confirm: null,
  inspector: { open: true, width: 340, tab: 'tasks', eventsSub: 'events' },
  mockConsoleOpen: false,
  folderPickerOpen: false,
  fill: null,

  set: (patch) => set(patch),
  toast: (text, tone = 'info', action) => {
    const id = uid('toast');
    set({ toasts: [...get().toasts, { id, text, tone, action }] });
    setTimeout(() => get().dismissToast(id), action ? 8000 : 3500);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  ask: (c) => set({ confirm: c }),
  setPrefs: (p) => set({ prefs: { ...get().prefs, ...p } }),
  setProvider: (p) => set({ provider: { ...get().provider, ...p } }),
  setInspector: (p) => set({ inspector: { ...get().inspector, ...p } }),
  upsertSession: (s) => {
    const list = get().sessions;
    const i = list.findIndex((x) => x.id === s.id);
    set({ sessions: i < 0 ? [s, ...list] : list.map((x) => (x.id === s.id ? s : x)) });
  },
  patchSession: (id, p) => set({ sessions: get().sessions.map((x) => (x.id === id ? { ...x, ...p } : x)) }),
  removeSession: (id) => set({ sessions: get().sessions.filter((x) => x.id !== id) }),
  addWorkspace: (path) => {
    const existing = get().workspaces.find((w) => w.path.toLowerCase() === path.toLowerCase());
    if (existing) return existing;
    const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    const ws: Workspace = { id: uid('ws'), name, path, branch: 'main', lastActive: Date.now() };
    set({ workspaces: [ws, ...get().workspaces] });
    return ws;
  },
  logHook: (e) => set({ hookLog: [{ ...e, id: uid('hl'), ts: Date.now() }, ...get().hookLog].slice(0, 200) }),
  fillComposer: (sid, text) => set({ fill: { sid, text, n: (get().fill?.n ?? 0) + 1 } }),
  saveProfile: (p) => set({ profiles: get().profiles.map((x) => (x.id === p.id ? p : p.isDefault ? { ...x, isDefault: false } : x)) }),
}));
