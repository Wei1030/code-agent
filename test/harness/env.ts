/**
 * One call per test file: a world, the scripted endpoint, a server set up to use it, a connected
 * client and a workspace. Helpers start sessions and wait for what tests wait on.
 */
import { randomUUID } from 'node:crypto';
import type { Effort, PendingRequest, PermissionMode, SessionRuntime } from '@code-agent/shared/types';
import type { SendOptions } from '@code-agent/shared/api';
import { Client, until } from './client';
import { FakeModel } from './fake-model';
import { Server, type ServerOpts } from './server';
import { makeWorld, type World } from './world';

export const EP = 'ep-test';
/** Endpoint models: M1 takes thinking and effort, M2 does not. */
export const M1 = `ep:${EP}:model-one`;
export const M2 = `ep:${EP}:model-two`;

export interface Env {
  world: World;
  model: FakeModel;
  server: Server;
  c: Client;
  /** The workspace repo and its id. */
  repo: string;
  ws: string;
  /** Create a session in a workspace and send its first message; returns its id. */
  start(text: string, opts?: { ws?: string; mode?: PermissionMode; model?: string; effort?: Effort; send?: SendOptions }): Promise<string>;
  rt(sid: string): Promise<SessionRuntime>;
  /** Wait until the session has finished `n` turns (went from working back to idle n times). */
  turns(sid: string, n?: number, ms?: number): Promise<void>;
  request(sid: string, kind?: PendingRequest['kind'], ms?: number): Promise<PendingRequest>;
  /** Connect another client (a second browser tab). */
  client(): Promise<Client>;
  close(): Promise<void>;
}

export interface EnvOpts {
  server?: ServerOpts;
  /** Files of the workspace repo. */
  files?: Record<string, string | object>;
  maxRunning?: number;
}

/** How many times the session went back to idle after working. */
export function finished(c: Client, sid: string): number {
  let n = 0;
  let busy = false;
  for (const e of c.evs(sid, 'state')) {
    if (e.state === 'idle' && busy) n += 1;
    busy = e.state !== 'idle';
  }
  return n;
}

export async function setup(opts: EnvOpts = {}): Promise<Env> {
  const world = makeWorld();
  const model = await new FakeModel().start();
  const server = await new Server(world, opts.server).start();
  const c = await new Client(server.port).connect();
  const clients = [c];

  await c.call('setState', { provider: { ...c.slices.provider, endpoints: [{ id: EP, name: '测试端点', url: model.url, models: [{ name: 'model-one', effort: true }, { name: 'model-two', effort: false }] }] } });
  await c.call('setEndpointKey', EP, 'test-token');
  await until(() => c.slices.models?.some((m) => m.id === M1), 'endpoint models');
  await c.call('setState', {
    profiles: c.slices.profiles.map((p) => ({ ...p, model: M1, effort: 'high' as Effort })),
    reviewProfile: { ...c.slices.reviewProfile, model: M1, effort: 'high' },
    boardSettings: { ...c.slices.boardSettings, recorder: false, recorderModel: M2 },
    maxRunning: opts.maxRunning ?? 8,
  });
  const repo = world.repo('main', opts.files);
  const ws = (await c.call('addWorkspace', repo)).id;

  const env: Env = {
    world, model, server, c, repo, ws,
    async start(text, o = {}) {
      const sid = randomUUID();
      await c.call('createDraft', o.ws ?? ws, sid);
      if (o.model) await c.call('setModel', sid, o.model);
      if (o.effort) await c.call('setEffort', sid, o.effort);
      if (o.mode) await c.call('setMode', sid, o.mode);
      await c.call('send', sid, text, o.send ?? {});
      return sid;
    },
    async rt(sid) {
      const r = await c.call('openSession', sid);
      if (!r) throw new Error(`no session ${sid}`);
      return r;
    },
    async turns(sid, n = 1, ms = 90_000) {
      await until(() => finished(c, sid) >= n, `turn ${n} of ${sid}`, ms);
    },
    async request(sid, kind, ms = 90_000) {
      return until(async () => {
        const r = (await env.rt(sid)).request;
        return r && (!kind || r.kind === kind) ? r : null;
      }, `${kind ?? 'a'} request in ${sid}`, ms);
    },
    async client() {
      const x = await new Client(server.port).connect();
      clients.push(x);
      return x;
    },
    async close() {
      for (const x of clients) x.close();
      server.kill();
      await model.close();
      // TEST_KEEP=1 leaves the world (logs, screenshots, transcripts) for a look after a failure.
      if (!process.env.TEST_KEEP) world.remove();
      else console.log(`test world kept: ${world.root}`);
    },
  };
  return env;
}
