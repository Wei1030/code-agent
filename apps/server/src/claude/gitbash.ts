/**
 * Git Bash for Claude Code on Windows: its Bash and Monitor tools need one; without it Claude runs
 * commands in PowerShell only. Claude Code looks in C:\Program Files and two folders up from the
 * first git.exe on PATH. That misses a Git installed elsewhere when Code Agent was started from Git
 * Bash, whose PATH puts <Git>\mingw64\bin\git.exe first. Code Agent looks next to every git.exe on
 * PATH, once when it starts, and passes what it finds as CLAUDE_CODE_GIT_BASH_PATH.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import type { GitBash } from '@code-agent/shared/types';

export const GIT_BASH_VAR = 'CLAUDE_CODE_GIT_BASH_PATH';

/** Where Git for Windows installs by default: Claude Code looks there itself. */
const DEFAULT_ROOTS = ['C:\\Program Files\\Git', 'C:\\Program Files (x86)\\Git'];

/** <Git>\bin\bash.exe of a Git for Windows in its default folders or next to a git.exe on PATH (<Git>\cmd, \bin or \mingw64\bin). */
export function findGitBash(pathVar = process.env.PATH ?? '', defaults = DEFAULT_ROOTS): string | undefined {
  const roots = [...defaults];
  for (const dir of pathVar.split(';')) {
    if (dir.trim() && existsSync(path.join(dir, 'git.exe'))) roots.push(path.join(dir, '..'), path.join(dir, '..', '..'));
  }
  return roots.map((root) => path.join(root, 'bin', 'bash.exe')).find((p) => existsSync(p));
}

const given = process.env[GIT_BASH_VAR]?.trim();
const found = process.platform === 'win32' && !given ? findGitBash() : undefined;

/**
 * The Git Bash Claude Code processes get, as Code Agent started; null off Windows. A
 * CLAUDE_CODE_GIT_BASH_PATH of the user's (on the settings page) replaces it.
 */
export const GIT_BASH: GitBash | null = process.platform !== 'win32' ? null
  : given ? { path: given, source: 'environment' }
  : found ? { path: found, source: 'found' }
  : { source: 'none' };
