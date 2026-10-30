/** Workspaces (folders on this machine), the folder browser and the file list for @ mentions. */
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { FsNode } from '@code-agent/shared/catalog';
import type { Workspace } from '@code-agent/shared/types';
import { register } from './hub';
import { app, set, update } from './state';

const run = promisify(execFile);

/** Hooks that re-read what depends on the workspace list (rules, hooks, MCP, skills, sessions). */
const changed: Array<() => void> = [];
export function onWorkspacesChanged(fn: () => void) {
  changed.push(fn);
}
function notifyChanged() {
  for (const f of changed) {
    try {
      f();
    } catch (e) {
      console.error('[workspaces] reload failed:', e);
    }
  }
}

export async function gitBranch(dir: string): Promise<string | null> {
  try {
    const { stdout } = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, windowsHide: true });
    const b = stdout.trim();
    return b && b !== 'HEAD' ? b : null;
  } catch {
    return null;
  }
}

/** Keep branches current (the user may switch branches outside Code Agent). */
export async function refreshBranches() {
  let dirty = false;
  const next = await Promise.all(app.workspaces.map(async (w) => {
    const branch = existsSync(w.path) ? await gitBranch(w.path) : w.branch;
    if (branch !== w.branch) dirty = true;
    return { ...w, branch };
  }));
  if (dirty) set('workspaces', next);
}

export function touchWorkspace(id: string) {
  update('workspaces', (ws) => ws.map((w) => (w.id === id ? { ...w, lastActive: Date.now() } : w)));
}

async function addWorkspace(dir: string): Promise<Workspace> {
  const p = path.resolve(dir.trim());
  if (!existsSync(p) || !statSync(p).isDirectory()) throw new Error(`文件夹不存在：${p}`);
  const existing = app.workspaces.find((w) => w.path.toLowerCase() === p.toLowerCase());
  if (existing) return existing;
  const ws: Workspace = { id: `ws-${randomUUID().slice(0, 8)}`, name: path.basename(p) || p, path: p, branch: await gitBranch(p), lastActive: Date.now() };
  set('workspaces', [ws, ...app.workspaces]);
  notifyChanged();
  return ws;
}

function roots(): FsNode[] {
  if (process.platform === 'win32') {
    const out: FsNode[] = [];
    for (let c = 67; c <= 90; c++) {
      const d = `${String.fromCharCode(c)}:\\`;
      if (existsSync(d)) out.push({ name: d, dir: true });
    }
    return out;
  }
  return [{ name: '/', dir: true }, { name: os.homedir(), dir: true }];
}

function listDir(dir: string | null): FsNode[] {
  if (!dir) return roots();
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('$') && e.name !== 'System Volume Information')
      .map((e) => ({ name: e.name, dir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.venv', '__pycache__', 'target', '.idea', '.vscode', 'coverage']);

function walk(root: string, rel = '', out: string[] = [], max = 5000): string[] {
  if (out.length >= max) return out;
  let entries;
  try {
    entries = readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= max) break;
    if (SKIP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, r, out, max);
    else out.push(r);
  }
  return out;
}

function toTree(files: string[]): FsNode[] {
  const root: FsNode = { name: '', dir: true, children: [] };
  for (const f of files) {
    const parts = f.split('/');
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let child = node.children!.find((c) => c.name === part && !!c.dir === !last);
      if (!child) {
        child = last ? { name: part } : { name: part, dir: true, children: [] };
        node.children!.push(child);
      }
      node = child;
    });
  }
  const sort = (n: FsNode) => {
    n.children?.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children?.forEach(sort);
  };
  sort(root);
  return root.children!;
}

async function listFiles(workspaceId: string): Promise<FsNode[]> {
  const ws = app.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return [];
  try {
    const { stdout } = await run('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ws.path, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
    const files = stdout.split(/\r?\n/).filter(Boolean).slice(0, 20000);
    if (files.length) return toTree(files);
  } catch {
    // not a git repository
  }
  return toTree(walk(ws.path));
}

/**
 * Take a workspace out of Code Agent: its running sessions stop, and Code Agent's own data for it
 * goes (session list, board, jobs and their runs, review records). The folder and Claude Code's own
 * session records stay; adding the folder again imports those sessions again.
 */
async function removeWorkspace(id: string) {
  const { allSummaries, dropSession } = await import('./sessions/registry');
  const { closeProcess } = await import('./sessions/live');
  const { cancelWaiting } = await import('./sessions/slots');
  const sessions = allSummaries().filter((s) => s.workspaceId === id);
  for (const s of sessions) {
    cancelWaiting(s.id);
    await closeProcess(s.id);
  }
  for (const s of sessions) dropSession(s.id);
  const gone = new Set(sessions.map((s) => s.id));
  const jobs = app.jobs.filter((j) => j.workspaceId === id).map((j) => j.id);
  set('board', app.board.filter((x) => x.workspaceId !== id));
  set('jobs', app.jobs.filter((j) => j.workspaceId !== id));
  set('jobRuns', app.jobRuns.filter((r) => !jobs.includes(r.jobId)));
  set('reviews', app.reviews.filter((t) => !gone.has(t.sessionId)));
  set('reviewed', Object.fromEntries(Object.entries(app.reviewed).filter(([sid]) => !gone.has(sid))));
  const { [id]: _checks, ...checks } = app.reviewChecks;
  void _checks;
  set('reviewChecks', checks);
  set('workspaces', app.workspaces.filter((w) => w.id !== id));
  notifyChanged();
}

register({
  addWorkspace,
  removeWorkspace,
  listDir,
  listFiles,
});
