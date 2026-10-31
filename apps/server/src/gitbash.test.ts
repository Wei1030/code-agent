import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CODE_AGENT_HOME = mkdtempSync(path.join(os.tmpdir(), 'ca-gitbash-'));
delete process.env.CLAUDE_CODE_GIT_BASH_PATH;
const { findGitBash, gitBash } = await import('./claude/gitbash');
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
const none = () => undefined;

test('Git Bash is found from the git.exe Git Bash puts first on PATH, not only from cmd\\git.exe', () => {
  const g = fakeGit();
  const other = mkdtempSync(path.join(os.tmpdir(), 'ca-other-'));
  assert.equal(findGitBash({ pathVar: `${other};${path.join(g.root, 'mingw64', 'bin')}`, defaults: [], installPath: none }), g.bash);
  assert.equal(findGitBash({ pathVar: path.join(g.root, 'cmd'), defaults: [], installPath: none }), g.bash);
});

test('Git Bash is found through the registry when git is not on PATH; nowhere, there is none', () => {
  const g = fakeGit();
  assert.equal(findGitBash({ pathVar: '', defaults: [], installPath: () => g.root }), g.bash);
  assert.equal(findGitBash({ pathVar: os.tmpdir(), defaults: [], installPath: none }), undefined);
  assert.equal(findGitBash({ pathVar: '', defaults: [], installPath: () => path.join(g.root, 'gone') }), undefined);
});

test('a CLAUDE_CODE_GIT_BASH_PATH of the user wins; one naming no bash.exe is reported and replaced', { skip: process.platform !== 'win32' }, () => {
  const g = fakeGit();
  app.env = [{ id: 'v1', key: 'CLAUDE_CODE_GIT_BASH_PATH', value: g.bash, note: '' }];
  assert.deepEqual(gitBash(), { path: g.bash, source: 'settings' });
  assert.equal(processEnv().CLAUDE_CODE_GIT_BASH_PATH, g.bash);
  const gone = path.join(g.root, 'nowhere', 'bash.exe');
  app.env = [{ id: 'v1', key: 'CLAUDE_CODE_GIT_BASH_PATH', value: gone, note: '' }];
  const s = gitBash();
  assert.equal(s?.missing, gone);
  // What Code Agent finds instead goes to Claude Code; with nothing found, the variable stays as set.
  assert.equal(processEnv().CLAUDE_CODE_GIT_BASH_PATH, s?.path ?? gone);
  app.env = [];
});
