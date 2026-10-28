import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('a malformed URL gets 400 and the server keeps running', { timeout: 60_000 }, async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  const port = 5300 + Math.floor(Math.random() * 500);
  const dist = path.join(home, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html>');
  const p = spawn(process.execPath, ['--import', 'tsx', path.resolve(import.meta.dirname, 'main.ts')], {
    env: { ...process.env, CODE_AGENT_HOME: home, CODE_AGENT_PORT: String(port), CODE_AGENT_NO_PROBE: '1', CODE_AGENT_WEB_DIST: dist }, stdio: 'pipe',
  });
  try {
    await new Promise<void>((resolve, reject) => {
      p.stdout.on('data', (b: Buffer) => { if (b.toString().includes('Code Agent')) resolve(); });
      p.on('exit', (code) => reject(new Error(`server exited ${code}`)));
    });
    const bad = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
    assert.equal(bad.status, 400);
    const ok = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(ok.status, 200);
  } finally {
    p.kill();
  }
});
