// Against the user's real Claude Code login, read-only: login detection and plan limits. Claude
// Code reads its own credentials; Code Agent sends no prompt and writes no transcript. Code Agent's
// data goes to a temporary folder. Run by hand: npm run test:real
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { makeWorld, type World } from '../harness/world';
import { Server } from '../harness/server';
import { Client, until } from '../harness/client';

let world: World;
let server: Server;
let c: Client;
before(async () => {
  world = makeWorld();
  // The real home, so Claude Code finds its own login and config; nothing else of the world.
  server = await new Server(world, { env: { USERPROFILE: os.homedir(), HOME: os.homedir() } }).start();
  c = await new Client(server.port).connect();
});
after(() => { c?.close(); server?.kill(); world?.remove(); });

test('the Claude login is detected through Claude Code (FR-AUTH-02, FR-AUTH-04)', async () => {
  await c.call('checkLogin');
  const p = await until(() => (c.slices.provider.checkedAt ? c.slices.provider : null), 'login checked', 90_000);
  console.log(`logged in: ${p.loggedIn}; plan: ${p.plan || '-'}; account: ${p.account ? 'known' : '-'}; error: ${p.error ?? '-'}`);
  if (p.loggedIn) {
    assert.ok(p.plan, 'a plan is named');
    assert.match(p.account ?? '', /@/, 'the account is known');
    assert.ok(c.slices.models.some((m) => !m.id.startsWith('ep:')), 'Claude models are offered');
  } else {
    assert.ok(!c.slices.models.some((m) => !m.id.startsWith('ep:')) || c.slices.provider.endpoints.length === 0);
  }
});

test('plan limits are read when logged in (FR-COST-04)', async () => {
  await c.call('refreshUsage');
  const u = await until(() => (c.slices.usage?.checkedAt ? c.slices.usage : null), 'usage checked', 90_000);
  console.log(`5 hours: ${u.fiveHour ? `${u.fiveHour.utilization}%` : '-'}; week: ${u.weekly ? `${u.weekly.utilization}%` : '-'}`);
  if (c.slices.provider.loggedIn) assert.ok(u.fiveHour || u.weekly, 'at least one window');
});
