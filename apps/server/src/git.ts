/** Git helpers: hidden snapshots of the working tree (review rounds) and diff stats. */
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { rmSync } from 'node:fs';

const IDENTITY = { GIT_AUTHOR_NAME: 'Code Agent', GIT_AUTHOR_EMAIL: 'code-agent@localhost', GIT_COMMITTER_NAME: 'Code Agent', GIT_COMMITTER_EMAIL: 'code-agent@localhost' };

export function git(cwd: string, args: string[], env?: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])) === 'true';
  } catch {
    return false;
  }
}

export async function head(cwd: string): Promise<string | null> {
  try {
    return await git(cwd, ['rev-parse', 'HEAD']);
  } catch {
    return null;
  }
}

/**
 * Commit the working tree as it is (tracked and untracked files, .gitignore respected) without
 * touching the index, HEAD or any branch, and point `ref` at it.
 */
export async function snapshot(cwd: string, ref: string, message: string): Promise<string> {
  const index = path.join(os.tmpdir(), `code-agent-index-${randomUUID()}`);
  const env = { GIT_INDEX_FILE: index, ...IDENTITY };
  try {
    const parent = await head(cwd);
    if (parent) await git(cwd, ['read-tree', parent], env);
    await git(cwd, ['add', '-A'], env);
    const tree = await git(cwd, ['write-tree'], env);
    const commit = await git(cwd, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], env);
    await git(cwd, ['update-ref', ref, commit]);
    return commit;
  } finally {
    rmSync(index, { force: true });
  }
}

export interface DiffStat {
  files: number;
  add: number;
  del: number;
  list: Array<{ path: string; add: number; del: number }>;
}

export async function numstat(cwd: string, from: string, to: string): Promise<DiffStat> {
  const out = await git(cwd, ['diff', '--numstat', from, to]);
  const list = out.split(/\r?\n/).filter(Boolean).map((l) => {
    const [a, d, ...p] = l.split('\t');
    return { path: p.join('\t'), add: Number(a) || 0, del: Number(d) || 0 };
  });
  return { files: list.length, add: list.reduce((s, x) => s + x.add, 0), del: list.reduce((s, x) => s + x.del, 0), list };
}
