import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CODE_AGENT_HOME = mkdtempSync(path.join(os.tmpdir(), 'ca-env-'));
process.env.ANTHROPIC_API_KEY = 'sk-ant-api-from-shell';
process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat-from-shell';
const { processEnv, NO_TOKEN } = await import('./claude/files');
const { app } = await import('./state');

test('an endpoint process gets its own token and never a Claude credential', () => {
  app.env = [{ id: 'v1', key: 'ANTHROPIC_AUTH_TOKEN', value: 'sk-ant-from-settings', note: '' }, { id: 'v2', key: 'ANTHROPIC_BASE_URL', value: 'https://elsewhere', note: '' }];
  for (const key of ['', 'sk-endpoint']) {
    const env = processEnv({ url: 'http://127.0.0.1:1', key, model: 'm' });
    // Without a token Claude Code would send the config dir's Claude login to the endpoint.
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, key || NO_TOKEN);
    assert.equal(env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:1');
    assert.equal(env.ANTHROPIC_API_KEY, undefined);
    assert.equal(env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.equal(env.ANTHROPIC_MODEL, 'm');
  }
});

test('a Claude process keeps the subscription setup', () => {
  app.env = [];
  const env = processEnv();
  assert.equal(env.ANTHROPIC_BASE_URL, undefined);
  assert.equal(env.ANTHROPIC_MODEL, undefined);
});
