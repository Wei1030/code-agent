/** Runs a Code Agent server inside a test world, the way `npm start` does. */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { World } from './world';

const ROOT = path.resolve(import.meta.dirname, '../..');

/** Variables that would let a test process reach a real account or the real config. */
const SCRUB = ['CLAUDE_CONFIG_DIR', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CODE_AGENT_HOME', 'CODE_AGENT_PORT'];

export function cleanEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !SCRUB.includes(k.toUpperCase())) env[k] = v;
  return { ...env, ...extra };
}

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

export interface ServerOpts {
  /** Serve apps/web/dist (needs `npm run build`); otherwise a stub page. */
  web?: boolean;
  env?: Record<string, string>;
  probe?: boolean;
}

export class Server {
  port = 0;
  proc: ChildProcess | null = null;
  readonly log: string;
  output = '';

  constructor(readonly world: World, readonly opts: ServerOpts = {}) {
    this.log = path.join(world.root, 'server.log');
  }

  get url() { return `http://127.0.0.1:${this.port}`; }

  async start(): Promise<this> {
    if (!this.port) this.port = await freePort();
    const stub = this.world.write('web-stub/index.html', '<!doctype html><title>Code Agent</title>');
    const env = cleanEnv({
      ...this.world.env(),
      CODE_AGENT_HOME: this.world.data,
      CODE_AGENT_PORT: String(this.port),
      CODE_AGENT_NO_OPEN: '1',
      ...(this.opts.probe ? {} : { CODE_AGENT_NO_PROBE: '1' }),
      ...(this.opts.web ? {} : { CODE_AGENT_WEB_DIST: path.dirname(stub) }),
      ...this.opts.env,
    });
    const p = spawn(process.execPath, ['--import', 'tsx', path.join(ROOT, 'apps/server/src/start.ts')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    this.proc = p;
    const take = (b: Buffer) => {
      const s = b.toString();
      this.output += s;
      appendFileSync(this.log, s);
    };
    p.stdout!.on('data', take);
    p.stderr!.on('data', take);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`server did not start:\n${this.output}`)), 60_000);
      const check = () => {
        if (/Code Agent [\d.]+ · http/.test(this.output)) { clearTimeout(t); resolve(); }
      };
      p.stdout!.on('data', check);
      p.once('exit', (code) => { clearTimeout(t); reject(new Error(`server exited (${code}):\n${this.output}`)); });
    });
    const m = /http:\/\/127\.0\.0\.1:(\d+)/.exec(this.output.slice(this.output.lastIndexOf('Code Agent ')));
    if (m) this.port = Number(m[1]);
    return this;
  }

  /** Ends the server and every process it started (Claude Code, commands, MCP servers). */
  kill() {
    const p = this.proc;
    this.proc = null;
    if (!p?.pid || p.exitCode !== null) return;
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-p.pid, 'SIGKILL');
    } catch { /* gone already */ }
  }

  /** Stop and start again on the same data and port. Waits for debounced writes first. */
  async restart(): Promise<this> {
    await new Promise((r) => setTimeout(r, 1500));
    this.kill();
    await new Promise((r) => setTimeout(r, 500));
    return this.start();
  }
}
