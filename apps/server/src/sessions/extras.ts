/**
 * Smaller things around sessions: the file preview, the worktrees Code Agent made for sessions,
 * output styles, a session's debug log, and restarting running sessions for a changed profile.
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import type { OutputStyle, WorktreeInfo } from '@code-agent/shared/types';
import { app } from '../state';
import { register } from '../hub';
import { LOGS_DIR, WORKTREES_DIR } from '../paths';
import { configDir } from '../claude/files';
import { allSummaries, patchSummary, summary } from './registry';
import { closeProcess, live, liveIds } from './live';
import { restartWhenIdle } from './slots';
import { cwdOf, workspaceOf } from './options';

const run = promisify(execFile);
const git = (cwd: string, ...args: string[]) => run('git', args, { cwd, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }).then((r) => r.stdout.trim());
const inside = (file: string, dir: string) => {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

// ------------------------------------------------------------------ file preview

const MAX_BYTES = 1024 * 1024;

/** Only files in the session's own directories: its working directory, its workspace, its extra dirs. */
function readWorkspaceFile(sid: string, p: string) {
  const cwd = cwdOf(sid);
  const file = path.resolve(cwd, p);
  const roots = [cwd, workspaceOf(sid)?.path, ...app.dirs.filter((d) => d.scope === 'global' || d.workspaceId === summary(sid)?.workspaceId || d.sessionId === sid).map((d) => d.path)].filter(Boolean) as string[];
  if (!roots.some((r) => inside(file, r))) throw new Error('这个文件不在会话的工作目录里');
  if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`文件不存在：${p}`);
  const size = statSync(file).size;
  const buf = readFileSync(file).subarray(0, MAX_BYTES);
  const binary = buf.subarray(0, 8000).includes(0);
  const content = binary ? '' : buf.toString('utf8');
  const shown = inside(file, cwd) ? path.relative(cwd, file).replace(/\\/g, '/') : file;
  return { path: shown, content, lines: content ? content.split(/\r?\n/).length : 0, truncated: size > MAX_BYTES, binary };
}

// ------------------------------------------------------------------ worktrees

async function listWorktrees(): Promise<WorktreeInfo[]> {
  const out: WorktreeInfo[] = [];
  for (const ws of app.workspaces) {
    let porcelain: string;
    try {
      porcelain = await git(ws.path, 'worktree', 'list', '--porcelain');
    } catch {
      continue;
    }
    const base = await git(ws.path, 'rev-parse', '--abbrev-ref', 'HEAD').catch(() => 'HEAD');
    for (const block of porcelain.split(/\r?\n\r?\n/)) {
      const dir = /^worktree (.+)$/m.exec(block)?.[1];
      const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? '';
      if (!dir || !inside(dir, WORKTREES_DIR)) continue;
      const ahead = Number(await git(ws.path, 'rev-list', '--count', `${base}..${branch || 'HEAD'}`).catch(() => '0')) || 0;
      const changed = existsSync(dir) ? (await git(dir, 'status', '--porcelain').catch(() => '')).split(/\r?\n/).filter(Boolean) : [];
      const sessions = allSummaries().filter((s) => s.cwd && path.resolve(s.cwd) === path.resolve(dir)).map((s) => ({ id: s.id, title: s.title, live: !!live(s.id) }));
      out.push({ path: path.resolve(dir), workspaceId: ws.id, branch, base, ahead, changed, sessions });
    }
  }
  return out;
}

async function removeWorktree(dir: string): Promise<{ branchDeleted: boolean }> {
  const wt = (await listWorktrees()).find((w) => w.path === path.resolve(dir));
  if (!wt) throw new Error('不是 Code Agent 建的工作树');
  const ws = app.workspaces.find((w) => w.id === wt.workspaceId)!;
  for (const s of wt.sessions) if (live(s.id)) await closeProcess(s.id);
  await git(ws.path, 'worktree', 'remove', '--force', wt.path);
  // Only a branch whose commits are in the base goes; unmerged work stays reachable.
  const branchDeleted = wt.branch ? await git(ws.path, 'branch', '-d', wt.branch).then(() => true, () => false) : false;
  for (const s of wt.sessions) patchSummary(s.id, { worktreeGone: true });
  return { branchDeleted };
}

// ------------------------------------------------------------------ output styles

function stylesIn(dir: string, source: OutputStyle['source']): OutputStyle[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  return names.map((n) => {
    const text = readFileSync(path.join(dir, n), 'utf8');
    const meta = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
    const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(meta)?.[1].trim().replace(/^["'](.*)["']$/, '$1');
    return { name: field('name') ?? n.slice(0, -3), description: field('description') ?? '', source };
  });
}

const BUILTIN_STYLES: OutputStyle[] = [
  { name: 'default', description: '默认：直接完成工作', source: 'builtin' },
  { name: 'Explanatory', description: '解释型：边做边讲实现上的取舍', source: 'builtin' },
  { name: 'Learning', description: '学习型：留一些代码让你自己写', source: 'builtin' },
];

function outputStyles(workspaceId?: string): OutputStyle[] {
  const ws = app.workspaces.find((w) => w.id === workspaceId);
  return [...BUILTIN_STYLES, ...stylesIn(path.join(configDir(), 'output-styles'), 'global'), ...(ws ? stylesIn(path.join(ws.path, '.claude', 'output-styles'), 'workspace') : [])];
}

// ------------------------------------------------------------------ debug log

function debugLog(sid: string) {
  const file = path.join(LOGS_DIR, `${sid}.log`);
  if (!existsSync(file)) return { path: file, exists: false, tail: '' };
  const text = readFileSync(file, 'utf8');
  return { path: file, exists: true, tail: text.split(/\r?\n/).slice(-300).join('\n') };
}

register({
  readWorkspaceFile,
  listWorktrees,
  removeWorktree,
  outputStyles,
  debugLog,
  applyProfileToRunning: () => {
    // Job runs keep the settings they were started with.
    const ids = liveIds().filter((id) => !summary(id)?.jobId);
    for (const id of ids) restartWhenIdle(id, '配置方案改了');
    return ids.length;
  },
});
