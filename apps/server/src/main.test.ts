import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function home() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ca-test-'));
  mkdirSync(path.join(dir, 'dist'), { recursive: true });
  writeFileSync(path.join(dir, 'dist', 'index.html'), '<!doctype html>');
  return dir;
}

/** Start the server like npm start does; resolves with what it printed once it is up or has exited. */
function start(dir: string, port: number) {
  const p = spawn(process.execPath, ['--import', 'tsx', path.resolve(import.meta.dirname, 'start.ts')], {
    env: { ...process.env, CODE_AGENT_HOME: dir, CODE_AGENT_PORT: String(port), CODE_AGENT_NO_PROBE: '1', CODE_AGENT_NO_OPEN: '1', CODE_AGENT_WEB_DIST: path.join(dir, 'dist') }, stdio: 'pipe',
  });
  let out = '';
  const ready = new Promise<{ out: string; exited: number | null }>((resolve) => {
    p.stdout.on('data', (b: Buffer) => {
      out += b.toString();
      if (/Code Agent [\d.]+ · /.test(out)) resolve({ out, exited: null });
    });
    p.on('exit', (code) => resolve({ out, exited: code }));
  });
  return { p, ready };
}

const somePort = () => 5300 + Math.floor(Math.random() * 400);

test('a malformed URL gets 400 and the server keeps running', { timeout: 60_000 }, async () => {
  const port = somePort();
  const { p, ready } = start(home(), port);
  try {
    assert.equal((await ready).exited, null);
    const bad = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
    assert.equal(bad.status, 400);
    const ok = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(ok.status, 200);
  } finally {
    p.kill();
  }
});

test('a taken port moves to the next; the same data dir is not started twice', { timeout: 90_000 }, async () => {
  const port = somePort();
  const a = home();
  const first = start(a, port);
  let other: ReturnType<typeof start> | undefined;
  try {
    assert.equal((await first.ready).exited, null);
    // Another data dir on the same port: moves on to the next one.
    other = start(home(), port);
    const o = await other.ready;
    assert.equal(o.exited, null);
    assert.match(o.out, new RegExp(`127\\.0\\.0\\.1:${port + 1}`));
    // A second start on the same data finds the running one and leaves.
    const again = await start(a, port).ready;
    assert.equal(again.exited, 0);
    assert.match(again.out, /已经在/);
  } finally {
    first.p.kill();
    other?.p.kill();
  }
});
