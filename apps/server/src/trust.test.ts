// Trusting a folder for Claude Code: only its flag in .claude.json changes, a file that cannot be read
// is left alone, and the check looks up the folders above as Claude Code does (issue 10-30#12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = mkdtempSync(path.join(os.tmpdir(), 'ca-trust-'));
process.env.CODE_AGENT_HOME = path.join(root, 'data');
process.env.USERPROFILE = process.env.HOME = path.join(root, 'home');
mkdirSync(process.env.HOME, { recursive: true });
const { claudeJsonPath, isTrusted, trustFolder } = await import('./claude/files');

const key = (dir: string) => (process.platform === 'win32' ? dir.replace(/\\/g, '/') : dir);
const repo = path.join(root, 'repos', 'shop');

test('trusting writes the flag under Claude Code\'s key for the folder and keeps the rest', async () => {
  const file = claudeJsonPath();
  assert.equal(path.dirname(file), process.env.HOME);
  writeFileSync(file, JSON.stringify({ numStartups: 3, projects: { [key(repo)]: { allowedTools: ['x'] } } }));
  await trustFolder(repo);
  const j = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(j.numStartups, 3);
  assert.deepEqual(j.projects[key(repo)], { allowedTools: ['x'], hasTrustDialogAccepted: true });
});

test('a folder is trusted when it or a folder above it is, no higher than its repository', () => {
  assert.equal(isTrusted(repo, null), true);
  assert.equal(isTrusted(path.join(repo, 'packages', 'api'), repo), true, 'inside the trusted repository');
  assert.equal(isTrusted(path.join(root, 'repos', 'other'), null), false);
  assert.equal(isTrusted(path.join(repo, 'nested'), path.join(repo, 'nested')), false, 'its own repository stops the look upwards');
});

test('a config file that cannot be read is left as it is, and nothing is trusted', async () => {
  writeFileSync(claudeJsonPath(), '{ "half": ');
  await assert.rejects(trustFolder(path.join(root, 'repos', 'other')), /读不了 Claude Code 的配置文件/);
  assert.equal(readFileSync(claudeJsonPath(), 'utf8'), '{ "half": ');
});

test('an empty config file, or none, takes the flag', async () => {
  writeFileSync(claudeJsonPath(), '');
  await trustFolder(repo);
  assert.equal(JSON.parse(readFileSync(claudeJsonPath(), 'utf8')).projects[key(repo)].hasTrustDialogAccepted, true);
  rmSync(claudeJsonPath());
  await trustFolder(repo);
  assert.equal(JSON.parse(readFileSync(claudeJsonPath(), 'utf8')).projects[key(repo)].hasTrustDialogAccepted, true);
});
