// Planned continuations at a server start (issue 10-31#3): a wake-up more than a minute overdue is
// dropped with a note in its session, not sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Resume } from '@code-agent/shared/types';
import { emptyRuntime } from '@code-agent/shared/runtime';

process.env.CODE_AGENT_HOME = mkdtempSync(path.join(os.tmpdir(), 'ca-resume-'));
const { initRuntime, rt, summary, upsert } = await import('./sessions/registry');
const { flush } = await import('./store');
const { live } = await import('./sessions/live');
const { startResumes } = await import('./resume');

function session(id: string, resume: Resume) {
  const now = Date.now();
  upsert({ id, workspaceId: 'w', title: id, firstPrompt: '', branch: null, createdAt: now, lastActive: now, tag: null, live: false, state: 'idle', forkedFrom: null, tokens: 0, resume });
  initRuntime(emptyRuntime(id));
  flush();
}

test('a wake-up more than a minute overdue at a start is dropped, with a note; the session is not resumed', async () => {
  session('overdue', { kind: 'wake', at: Date.now() - 2 * 60_000, reason: '十分钟后再看部署', prompt: '看看部署', by: 'cli' });
  startResumes();
  assert.equal(summary('overdue')?.resume?.by, 'server', 'Code Agent holds it after a start');
  const deadline = Date.now() + 15_000;
  while (summary('overdue')?.resume && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  assert.equal(summary('overdue')?.resume, undefined);
  assert.ok(rt('overdue')!.items.some((i) => i.kind === 'notice' && /这次预约不再执行/.test(i.text)), 'a note in the session');
  assert.equal(live('overdue'), undefined, 'not resumed');
});
