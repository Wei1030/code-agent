/**
 * Git Bash for Claude Code on Windows: its Bash and Monitor tools need one; without it Claude runs
 * commands in PowerShell only. Claude Code looks in C:\Program Files and two folders up from the
 * first git.exe on PATH. That misses a Git installed elsewhere when Code Agent was started from Git
 * Bash, whose PATH puts <Git>\mingw64\bin\git.exe first. Code Agent looks further (each git.exe on
 * PATH, then the registry) and passes what it finds as CLAUDE_CODE_GIT_BASH_PATH.
 */
import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { GitBash } from '@code-agent/shared/types';
import { app } from '../state';

export const GIT_BASH_VAR = 'CLAUDE_CODE_GIT_BASH_PATH';

/** Where Git for Windows installs by default: Claude Code looks there itself. */
const DEFAULT_ROOTS = ['C:\\Program Files\\Git', 'C:\\Program Files (x86)\\Git'];

/** The install folder Git for Windows records in the registry. */
function registryInstallPath(): string | undefined {
  for (const key of ['HKLM\\SOFTWARE\\GitForWindows', 'HKCU\\SOFTWARE\\GitForWindows']) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', 'InstallPath'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /InstallPath\s+REG_\w+\s+(.+)/.exec(out);
      if (m) return m[1].trim();
    } catch {
      // Not recorded there.
    }
  }
  return undefined;
}

/**
 * <Git>\bin\bash.exe of a Git for Windows: in its default folders, next to a git.exe on PATH
 * (<Git>\cmd, <Git>\bin or <Git>\mingw64\bin), or where the registry says it is installed.
 */
export function findGitBash({ pathVar = process.env.PATH ?? '', defaults = DEFAULT_ROOTS, installPath = registryInstallPath }: {
  pathVar?: string; defaults?: string[]; installPath?: () => string | undefined;
} = {}): string | undefined {
  const bash = (root: string) => path.join(root, 'bin', 'bash.exe');
  const roots = [...defaults];
  for (const dir of pathVar.split(';')) {
    if (dir.trim() && existsSync(path.join(dir, 'git.exe'))) roots.push(path.join(dir, '..'), path.join(dir, '..', '..'));
  }
  const hit = roots.map(bash).find((p) => existsSync(p));
  if (hit) return hit;
  const root = installPath();
  return root && existsSync(bash(root)) ? bash(root) : undefined;
}

/** What findGitBash found; looked up again when asked to, or when the file is gone. */
let found: { path?: string } | null = null;
function lookUp(again: boolean) {
  if (again || !found || (found.path && !existsSync(found.path))) found = { path: findGitBash() };
  return found.path;
}

/** A path Claude Code takes as Git Bash: an existing bash or sh. */
const usable = (p: string) => /^(bash|sh)(\.exe)?$/i.test(path.basename(p)) && existsSync(p);

/**
 * The Git Bash Claude Code processes get, and where it comes from; null off Windows. The user's
 * CLAUDE_CODE_GIT_BASH_PATH (settings page, else Code Agent's own environment) wins when it names a
 * bash.exe; one that does not is reported, and the one found is passed instead.
 */
export function gitBash(again = false): GitBash | null {
  if (process.platform !== 'win32') return null;
  const own = app.env.find((v) => v.key.trim() === GIT_BASH_VAR)?.value.trim();
  const given = own || process.env[GIT_BASH_VAR]?.trim();
  if (given && usable(given)) return { path: given, source: own ? 'settings' : 'environment' };
  const p = lookUp(again);
  return { ...(p ? { path: p, source: 'found' as const } : { source: 'none' as const }), ...(given ? { missing: given } : {}) };
}
