/**
 * Permission rules and extra directories live in Claude Code's settings files:
 * global = <config>/settings.json, workspace = .claude/settings.local.json. Session-only directories
 * stay in memory.
 */
import type { ExtraDir, PermissionRule, Workspace } from '@code-agent/shared/types';
import { app, onWrite, set } from '../state';
import { editJson, readSettings, settingsPath } from './files';

type Perms = { allow?: string[]; ask?: string[]; deny?: string[]; additionalDirectories?: string[] };
const BEHAVIORS = ['allow', 'ask', 'deny'] as const;

function perms(scope: 'global' | 'workspace', ws?: Workspace): Perms {
  const p = readSettings(scope, ws).permissions;
  return p && typeof p === 'object' ? (p as Perms) : {};
}

function rulesOf(scope: 'global' | 'workspace', ws?: Workspace): PermissionRule[] {
  const p = perms(scope, ws);
  return BEHAVIORS.flatMap((b) => (p[b] ?? []).filter((r) => typeof r === 'string').map((rule) => ({
    id: `${scope}:${ws?.id ?? ''}:${b}:${rule}`, behavior: b, rule, scope, ...(ws ? { workspaceId: ws.id } : {}),
  })));
}

function dirsOf(scope: 'global' | 'workspace', ws?: Workspace): ExtraDir[] {
  return (perms(scope, ws).additionalDirectories ?? []).filter((d) => typeof d === 'string').map((d) => ({
    id: `${scope}:${ws?.id ?? ''}:${d}`, path: d, scope, ...(ws ? { workspaceId: ws.id } : {}),
  }));
}

export function readRules(): PermissionRule[] {
  return [...rulesOf('global'), ...app.workspaces.flatMap((ws) => rulesOf('workspace', ws))];
}

export function readDirs(): ExtraDir[] {
  return [...dirsOf('global'), ...app.workspaces.flatMap((ws) => dirsOf('workspace', ws)), ...app.dirs.filter((d) => d.scope === 'session')];
}

export function reloadRules() {
  const rules = readRules();
  if (JSON.stringify(rules) !== JSON.stringify(app.rules)) set('rules', rules);
  const dirs = readDirs();
  if (JSON.stringify(dirs) !== JSON.stringify(app.dirs)) set('dirs', dirs);
}

const key = (scope: string, wsId?: string) => `${scope}|${wsId ?? ''}`;

onWrite('rules', (next) => {
  const want = new Map<string, Record<string, string[]>>();
  const files = new Set<string>([key('global'), ...app.workspaces.map((w) => key('workspace', w.id))]);
  for (const k of files) want.set(k, { allow: [], ask: [], deny: [] });
  for (const r of next) {
    const k = key(r.scope, r.scope === 'workspace' ? r.workspaceId : undefined);
    want.get(k)?.[r.behavior].push(r.rule);
  }
  for (const [k, lists] of want) {
    const [scope, wsId] = k.split('|') as ['global' | 'workspace', string];
    const ws = app.workspaces.find((w) => w.id === wsId);
    if (scope === 'workspace' && !ws) continue;
    const cur = perms(scope, ws);
    if (BEHAVIORS.every((b) => JSON.stringify(cur[b] ?? []) === JSON.stringify(lists[b]))) continue;
    editJson(settingsPath(scope, ws), (j) => {
      const p = { ...((j.permissions as Perms | undefined) ?? {}) };
      for (const b of BEHAVIORS) {
        if (lists[b].length) p[b] = lists[b];
        else delete p[b];
      }
      j.permissions = p;
    });
  }
  set('rules', readRules());
});

onWrite('dirs', (next) => {
  const sessions = next.filter((d) => d.scope === 'session');
  const targets: Array<['global' | 'workspace', Workspace | undefined]> = [['global', undefined], ...app.workspaces.map((w) => ['workspace', w] as ['workspace', Workspace])];
  for (const [scope, ws] of targets) {
    const list = next.filter((d) => d.scope === scope && (scope === 'global' || d.workspaceId === ws?.id)).map((d) => d.path);
    const cur = perms(scope, ws).additionalDirectories ?? [];
    if (JSON.stringify(cur) === JSON.stringify(list)) continue;
    editJson(settingsPath(scope, ws), (j) => {
      const p = { ...((j.permissions as Perms | undefined) ?? {}) };
      if (list.length) p.additionalDirectories = list;
      else delete p.additionalDirectories;
      j.permissions = p;
    });
  }
  app.dirs = [...readDirs().filter((d) => d.scope !== 'session'), ...sessions];
  set('dirs', app.dirs);
});
