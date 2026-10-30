/**
 * A throw-away world for one test file: a home folder (the server and its Claude Code processes see
 * it as the user's home, so ~/.claude is the test's own), Code Agent's data dir and repositories.
 * Nothing outside it is read or written.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface World {
  root: string;
  /** The user's home for the server and Claude Code. */
  home: string;
  /** Claude Code's config dir (~/.claude in that home). */
  config: string;
  /** Code Agent's data dir. */
  data: string;
  /** A git repository (or a plain folder) with these files; returns its path. */
  repo(name: string, files?: Record<string, string | object>, opts?: { git?: boolean }): string;
  write(file: string, content: string | object): string;
  read(file: string): string;
  exists(file: string): boolean;
  git(cwd: string, ...args: string[]): string;
  /** Environment for processes that live in this world. */
  env(): Record<string, string>;
  remove(): void;
}

const json = (c: string | object) => (typeof c === 'string' ? c : JSON.stringify(c, null, 2) + '\n');

export function makeWorld(): World {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const home = path.join(root, 'home');
  const config = path.join(home, '.claude');
  const data = path.join(root, 'data');
  for (const d of [home, config, data, path.join(root, 'repos')]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(config, 'settings.json'), '{}\n');

  const env = () => ({
    USERPROFILE: home, HOME: home,
    // Git commits in test repos need an identity; nothing reads the real global config.
    GIT_CONFIG_GLOBAL: path.join(home, '.gitconfig'),
  });
  writeFileSync(path.join(home, '.gitconfig'), '[user]\n\tname = Test\n\temail = test@example.com\n[init]\n\tdefaultBranch = main\n');

  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env: { ...process.env, ...env() }, encoding: 'utf8' });
  const write = (file: string, content: string | object) => {
    const f = path.isAbsolute(file) ? file : path.join(root, file);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, json(content));
    return f;
  };

  return {
    root, home, config, data, env, git, write,
    read: (file) => readFileSync(path.isAbsolute(file) ? file : path.join(root, file), 'utf8'),
    exists: (file) => existsSync(path.isAbsolute(file) ? file : path.join(root, file)),
    repo(name, files = { 'README.md': `# ${name}\n` }, { git: isGit = true } = {}) {
      const dir = path.join(root, 'repos', name);
      mkdirSync(dir, { recursive: true });
      for (const [rel, c] of Object.entries(files)) write(path.join(dir, rel), c);
      if (isGit) {
        git(dir, 'init', '-q');
        git(dir, 'add', '-A');
        git(dir, 'commit', '-q', '-m', 'init');
      }
      return dir;
    },
    remove() {
      try { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* a process still holds a file */ }
    },
  };
}
