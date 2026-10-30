/** App-wide state: registries, preferences and UI chrome. Sessions live in ./sessions. */
import { create } from 'zustand';
import type {
  BoardItem, BoardSettings, CommandFile, EnvVar, ExtraDir, FileHook, HeldMessage, HookLogEntry, HookRule, JobRun, JobTemplate, McpBehavior, McpServer, ModelInfo,
  PeerSettings, PermissionRule, PluginInfo, Prefs, Profile, Provider, ReviewProfile, ReviewTicket, RuntimeSettings, SessionSummary, SkillInfo, UsageData, Workspace, AgentFile,
} from '../api/types';
import { MODELS } from '../lib/catalog';
import { uid } from '../lib/util';

export type { Provider };

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
  onConfirm: () => unknown;
}

export type InspectorTab = 'tasks' | 'background' | 'changes' | 'checkpoints' | 'context' | 'events' | 'file' | 'info';

interface AppState {
  /** The server's state has arrived. */
  booted: boolean;
  /** The computer's user name, from the server. */
  userName: string;
  workspaces: Workspace[];
  sessions: SessionSummary[];
  currentWorkspaceId: string;
  prefs: Prefs;
  profiles: Profile[];
  rules: PermissionRule[];
  dirs: ExtraDir[];
  mcp: McpServer[];
  mcpBehavior: McpBehavior;
  skills: SkillInfo[];
  agents: AgentFile[];
  commandFiles: CommandFile[];
  plugins: PluginInfo[];
  hookRules: HookRule[];
  fileHooks: FileHook[];
  hookLog: HookLogEntry[];
  jobs: JobTemplate[];
  jobRuns: JobRun[];
  peer: PeerSettings;
  /** Claude Code processes running at once, across all workspaces. */
  maxRunning: number;
  board: BoardItem[];
  boardSettings: BoardSettings;
  reviews: ReviewTicket[];
  /** Check commands by workspace id; empty skips the checks. */
  reviewChecks: Record<string, string[]>;
  reviewProfile: ReviewProfile;
  /** Session whose review record is open in the dialog. */
  reviewRecord: string | null;
  /** By session id: how many of its file changes a finished review has covered. */
  reviewed: Record<string, number>;
  /** Messages between sessions waiting for the user to release them. */
  held: HeldMessage[];
  provider: Provider;
  env: EnvVar[];
  runtime: RuntimeSettings;
  models: ModelInfo[];
  usage: UsageData;
  connection: 'online' | 'offline' | 'restored';
  reconnectAttempt: number;
  /** Server calls in flight that the user is waiting for (drives the top progress bar). */
  busy: number;
  toasts: Toast[];
  confirm: ConfirmRequest | null;
  inspector: { open: boolean; width: number; tab: InspectorTab; eventsSub: 'events' | 'stderr' | 'hooks' | 'debug' };
  /** The file shown in the inspector's 文件 tab (and the lines to mark). */
  preview: { sid: string; path: string; from?: number; to?: number } | null;
  folderPickerOpen: boolean;
  /** The board check in a session is shown as a small badge. */
  boardCheckSmall: boolean;
  inboxOpen: boolean;
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
  saveProfile: (p: Profile) => void;
  fillComposer: (sid: string, text: string) => void;
  logHook: (e: Omit<HookLogEntry, 'id' | 'ts'>) => void;
}

export const useApp = create<AppState>((set, get) => ({
  booted: false,
  userName: '',
  workspaces: [],
  sessions: [],
  currentWorkspaceId: localStorage.getItem('ca.workspace') ?? '',
  prefs: {
    uiLanguage: 'auto',
    responseLanguage: 'ui',
    responseLanguageCustom: '',
    numberStyle: 'intl',
    showRawSdkText: false,
    browserNotifications: true,
    notifyRequests: true,
    notifyTurnDone: true,
    notifyBackground: true,
  },
  profiles: [],
  rules: [],
  dirs: [],
  mcp: [],
  mcpBehavior: { strict: false, toolSearch: 'auto', firstTurnWait: 30 },
  skills: [],
  agents: [],
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
  boardSettings: { recorder: false, recorderModel: '', recorderEffort: 'low' },
  reviews: [],
  reviewChecks: {},
  reviewProfile: { model: 'opus', effort: 'high', tools: [], claudeMd: true, extraPrompt: '' },
  reviewRecord: null,
  reviewed: {},
  held: [],
  provider: {
    configDir: 'default', customDir: '', executable: 'bundled', loggedIn: false, plan: '', envConflict: false, endpoints: [],
  },
  env: [],
  runtime: { debugLog: false, otel: false, otelEndpoint: '', otelProtocol: 'http/protobuf', otelMetrics: false, otelLogs: false, otelTraces: false, otelPrompts: false, otelTools: false },
  models: MODELS,
  usage: { fiveHour: null, weekly: null, checkedAt: null, days: {} },
  connection: 'online',
  reconnectAttempt: 0,
  busy: 0,
  toasts: [],
  confirm: null,
  inspector: { open: true, width: 340, tab: 'tasks', eventsSub: 'events' },
  preview: null,
  folderPickerOpen: false,
  boardCheckSmall: false,
  inboxOpen: false,
  fill: null,

  set: (patch) => {
    if (patch.currentWorkspaceId) localStorage.setItem('ca.workspace', patch.currentWorkspaceId);
    set(patch);
  },
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
  logHook: (e) => set({ hookLog: [{ ...e, id: uid('hl'), ts: Date.now() }, ...get().hookLog].slice(0, 200) }),
  fillComposer: (sid, text) => set({ fill: { sid, text, n: (get().fill?.n ?? 0) + 1 } }),
  saveProfile: (p) => set({ profiles: get().profiles.map((x) => (x.id === p.id ? p : p.isDefault ? { ...x, isDefault: false } : x)) }),
}));
