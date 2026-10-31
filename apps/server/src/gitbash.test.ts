import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CODE_AGENT_HOME = mkdtempSync(path.join(os.tmpdir(), 'ca-gitbash-'));
delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
const { findGitBash, GIT_BASH } = await import('./claude/gitbash');
const { processEnv } = await import('./claude/files');
const { app } = await import('./state');

/** A Git for Windows installed in a folder of its own: cmd\git.exe, mingw64\bin\git.exe, bin\bash.exe. */
function fakeGit() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ca-git-'));
  for (const f of ['cmd/git.exe', 'mingw64/bin/git.exe', 'bin/bash.exe']) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), '');
  }
  return { root, bash: path.join(root, 'bin', 'bash.exe') };
}

test('Git Bash is found from the git.exe Git Bash puts first on PATH, not only from cmd\\git.exe; without git, none', () => {
  const g = fakeGit();
  const other = mkdtempSync(path.join(os.tmpdir(), 'ca-other-'));
  assert.equal(findGitBash(`${other};${path.join(g.root, 'mingw64', 'bin')}`, []), g.bash);
  assert.equal(findGitBash(path.join(g.root, 'cmd'), []), g.bash);
  assert.equal(findGitBash(other, []), undefined);
});

test('Claude Code gets the Git Bash found at the start; one set on the settings page replaces it', { skip: process.platform !== 'win32' }, () => {
  app.env = [];
  assert.equal(processEnv().CLAUDE_CODE_GIT_BASH_PATH, GIT_BASH?.path);
  app.env = [{ id: 'v1', key: 'CLAUDE_CODE_GIT_BASH_PATH', value: 'X:\\mine\\bash.exe', note: '' }];
  assert.equal(processEnv().CLAUDE_CODE_GIT_BASH_PATH, 'X:\\mine\\bash.exe');
  app.env = [];
});
