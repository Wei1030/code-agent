/**
 * MCP servers from every place Claude Code reads them: all workspaces (user scope in .claude.json),
 * one workspace on this machine (local scope), the repository's .mcp.json, plugins and claude.ai
 * connectors. Changes go through Claude Code's own `claude mcp add-json / remove`, so its files stay
 * consistent. Status and tools come from probes. Secret values in env and headers are masked
 * before they reach the browser.
 */
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk';
import type { McpServer, Workspace } from '@code-agent/shared/types';
import { app, onWrite, set } from '../state';
import { register } from '../hub';
import { claudeJsonPath, processEnv, readJson, systemClaude } from '../claude/files';
import { withProbe } from '../provider';
import { live } from '../sessions/live';

type Raw = { type?: string; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; timeout?: number };

const MASK = '••••••';
const mask = (v: string) => (v.length <= 8 ? MASK : `${v.slice(0, 4)}${MASK}`);
const masked = (v: string) => v.includes(MASK);
const norm = (p: string) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Real configs by server id (secrets included); never sent to the browser. */
const raws = new Map<string, Raw>();
/** Last probe result by `${workspaceId}|${name}`. */
const statuses = new Map<string, McpServerStatus>();
/** Servers only running sessions report (claude.ai connectors load after a probe has answered). */
const fromSessions = new Set<string>();
/** Sessions where the user switched a server off, by server name. */
const offIn = new Map<string, string[]>();

function claudeBin(): string {
  if (app.provider.executable === 'system') return systemClaude() ?? 'claude';
  try {
    const req = createRequire(import.meta.url);
    const pkg = req.resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    const exe = path.join(path.dirname(pkg), process.platform === 'win32' ? 'claude.exe' : 'claude');
    if (existsSync(exe)) return exe;
  } catch {
    // fall through
  }
  return systemClaude() ?? 'claude';
}

function cli(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(claudeBin(), args, { cwd, env: processEnv() as NodeJS.ProcessEnv, windowsHide: true, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout || err.message).trim().split('\n').slice(-3).join(' ')));
      else resolve(stdout);
    });
  });
}

function toServer(id: string, name: string, raw: Raw, scope: McpServer['scope'], ws?: Workspace, plugin?: string): McpServer {
  raws.set(id, raw);
  const type = (raw.type === 'http' || raw.type === 'sse' ? raw.type : raw.url ? 'http' : 'stdio') as McpServer['type'];
  const st = statuses.get(`${ws?.id ?? ''}|${name}`) ?? [...statuses.entries()].find(([k]) => k.endsWith(`|${name}`))?.[1];
  return {
    id, name, type, scope, ...(ws ? { workspaceId: ws.id } : {}), ...(plugin ? { plugin } : {}),
    ...(type === 'stdio' ? { command: raw.command, args: raw.args ?? [], env: Object.entries(raw.env ?? {}).map(([key, value]) => ({ key, value: mask(String(value)) })) } : {}),
    ...(type !== 'stdio' ? { url: raw.url, headers: Object.entries(raw.headers ?? {}).map(([key, value]) => ({ key, value: mask(String(value)) })) } : {}),
    timeout: raw.timeout ? Math.round(raw.timeout / 1000) : 60,
    status: st ? st.status : 'pending', ...(st?.error ? { error: st.error } : {}), ...(st?.serverInfo ? { version: `${st.serverInfo.name} ${st.serverInfo.version}` } : {}),
    instructionsTokens: 0,
    tools: (st?.tools ?? []).map((t) => ({
      name: t.name, desc: t.description?.split('\n')[0]?.slice(0, 200) ?? '',
      annotations: [...(t.annotations?.readOnly ? ['readOnly' as const] : []), ...(t.annotations?.destructive ? ['destructive' as const] : []), ...(t.annotations?.openWorld ? ['openWorld' as const] : [])],
      // Only an estimate, and only when the server describes the tool.
      tokens: t.description ? Math.round(((t.name.length + t.description.length) / 4) + 80) : 0,
    })),
    prompts: [],
    offIn: offIn.get(name) ?? [],
  };
}

function readAll(): McpServer[] {
  raws.clear();
  const out: McpServer[] = [];
  const cj = readJson(claudeJsonPath());
  for (const [name, raw] of Object.entries((cj.mcpServers ?? {}) as Record<string, Raw>)) out.push(toServer(`global::${name}`, name, raw, 'global'));
  const projects = (cj.projects ?? {}) as Record<string, { mcpServers?: Record<string, Raw> }>;
  for (const ws of app.workspaces) {
    const key = Object.keys(projects).find((k) => norm(k) === norm(ws.path));
    for (const [name, raw] of Object.entries((key && projects[key].mcpServers) || {})) out.push(toServer(`workspace:${ws.id}:${name}`, name, raw, 'workspace', ws));
    const repo = readJson(path.join(ws.path, '.mcp.json')).mcpServers as Record<string, Raw> | undefined;
    for (const [name, raw] of Object.entries(repo ?? {})) out.push(toServer(`repo:${ws.id}:${name}`, name, raw, 'repo', ws));
  }
  for (const p of app.plugins.filter((x) => x.enabled && !x.skipMcp)) {
    const cfg = readJson(path.join(p.path, '.mcp.json'));
    const servers = (cfg.mcpServers ?? cfg) as Record<string, Raw>;
    for (const [name, raw] of Object.entries(servers)) if (raw && typeof raw === 'object' && (raw.command || raw.url)) out.push(toServer(`plugin:${p.name}:${name}`, name, raw, 'plugin', undefined, p.name));
  }
  // Servers Claude Code reports that are configured elsewhere (claude.ai connectors, managed…).
  const known = new Set(out.map((s) => s.name));
  for (const [key, st] of statuses) {
    const name = key.split('|')[1];
    if (known.has(name) || name === 'workspace') continue;
    known.add(name);
    const cfg = (st.config ?? {}) as Raw;
    out.push({ ...toServer(`ext:${name}`, name, cfg, 'plugin', undefined, st.scope === 'claudeai' ? 'claude.ai' : st.scope ?? st.source ?? '外部'), ...(cfg.url ? {} : { type: 'http' as const }) });
  }
  return out;
}

export function reloadMcp() {
  const list = readAll();
  if (JSON.stringify(list) !== JSON.stringify(app.mcp)) set('mcp', list);
}

/** A running session reported its servers (it sees connectors a probe may not). */
export function noteSessionMcp(workspaceId: string, list: McpServerStatus[]) {
  let changed = false;
  for (const st of list) {
    if (st.name === 'workspace') continue;
    const key = `${workspaceId}|${st.name}`;
    const prev = statuses.get(key);
    if (prev && prev.status === st.status && (prev.tools?.length ?? 0) === (st.tools?.length ?? 0)) continue;
    statuses.set(key, st);
    fromSessions.add(key);
    changed = true;
  }
  if (changed) reloadMcp();
}

let probing: Promise<void> | null = null;

/** Ask Claude Code, in each workspace, which servers connect and what tools they offer. */
export function probeMcp(): Promise<void> {
  if (probing) return probing;
  const targets: Array<{ id: string; dir: string }> = app.workspaces.length ? app.workspaces.map((w) => ({ id: w.id, dir: w.path })) : [{ id: '', dir: os.homedir() }];
  probing = (async () => {
    for (const t of targets) {
      if (!existsSync(t.dir)) continue;
      try {
        const list = await withProbe(t.dir, async (q) => {
          await q.initializationResult();
          const deadline = Date.now() + Math.min(30, Math.max(5, app.mcpBehavior.firstTurnWait)) * 1000;
          let st = await q.mcpServerStatus();
          while (st.some((s) => s.status === 'pending') && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 1000));
            st = await q.mcpServerStatus();
          }
          return st;
        }, 90_000);
        for (const k of [...statuses.keys()]) if (k.startsWith(`${t.id}|`) && !fromSessions.has(k)) statuses.delete(k);
        for (const s of list) statuses.set(`${t.id}|${s.name}`, s);
      } catch (e) {
        console.error('[mcp] probe failed:', e instanceof Error ? e.message : e);
      }
    }
    reloadMcp();
  })().finally(() => {
    probing = null;
  });
  return probing;
}

function scopeArgs(s: McpServer): { scope: 'user' | 'local'; cwd: string } {
  if (s.scope === 'workspace') {
    const ws = app.workspaces.find((w) => w.id === s.workspaceId);
    if (!ws) throw new Error('工作区不存在');
    return { scope: 'local', cwd: ws.path };
  }
  return { scope: 'user', cwd: os.homedir() };
}

/** The config to write for an edited server, keeping secret values the browser only saw masked. */
function rawFor(s: McpServer, old?: Raw): Raw {
  const keep = (list: Array<{ key: string; value: string }> | undefined, before: Record<string, string> | undefined) =>
    Object.fromEntries((list ?? []).filter((e) => e.key.trim()).map((e) => [e.key.trim(), masked(e.value) && before?.[e.key.trim()] !== undefined ? before[e.key.trim()] : e.value]));
  if (s.type === 'stdio') {
    const env = keep(s.env, old?.env);
    return { type: 'stdio', command: s.command ?? '', args: s.args ?? [], ...(Object.keys(env).length ? { env } : {}), ...(s.timeout && s.timeout !== 60 ? { timeout: s.timeout * 1000 } : {}) };
  }
  const headers = keep(s.headers, old?.headers);
  return { type: s.type, url: s.url ?? '', ...(Object.keys(headers).length ? { headers } : {}), ...(s.timeout && s.timeout !== 60 ? { timeout: s.timeout * 1000 } : {}) };
}

const editable = (s: McpServer) => s.scope === 'global' || s.scope === 'workspace';
const configOf = (s: McpServer) => JSON.stringify({ n: s.name, t: s.type, c: s.command, a: s.args, e: s.env, u: s.url, h: s.headers, o: s.timeout, sc: s.scope, w: s.workspaceId });

async function add(s: McpServer, raw: Raw) {
  const { scope, cwd } = scopeArgs(s);
  await cli(['mcp', 'add-json', '-s', scope, s.name, JSON.stringify(raw)], cwd);
}

async function remove(s: McpServer) {
  const { scope, cwd } = scopeArgs(s);
  await cli(['mcp', 'remove', '-s', scope, s.name], cwd);
}

onWrite('mcp', async (next, prev) => {
  let changed = false;
  for (const p of prev.filter(editable)) {
    const n = next.find((x) => x.id === p.id);
    if (!n) {
      await remove(p);
      changed = true;
    }
  }
  for (const n of next.filter(editable)) {
    const p = prev.find((x) => x.id === n.id);
    if (p && configOf(p) === configOf(n)) continue;
    const raw = rawFor(n, p ? raws.get(p.id) : undefined);
    if (p) await remove(p);
    await add(n, raw);
    changed = true;
  }
  // Switching a server off or on in running sessions does not touch the config.
  for (const n of next) {
    const p = prev.find((x) => x.id === n.id);
    const before = p?.offIn ?? [];
    for (const sid of new Set([...before, ...n.offIn])) {
      const on = !n.offIn.includes(sid);
      if (on === !before.includes(sid)) continue;
      offIn.set(n.name, n.offIn);
      await live(sid)?.q.toggleMcpServer(n.name, on).catch(() => undefined);
    }
  }
  reloadMcp();
  if (changed) void probeMcp();
});

register({
  refreshMcp: () => probeMcp(),
  testMcp: () => probeMcp(),
  toggleMcpInSession: async (sid, server, on) => {
    const list = offIn.get(server) ?? [];
    offIn.set(server, on ? list.filter((x) => x !== sid) : [...new Set([...list, sid])]);
    await live(sid)?.q.toggleMcpServer(server, on);
    reloadMcp();
  },
  reconnectMcpInSession: async (sid, server) => {
    await live(sid)?.q.reconnectMcpServer(server);
  },
  setMcpHeader: async (id, key, value) => {
    const s = app.mcp.find((x) => x.id === id);
    if (!s || !editable(s)) throw new Error('这个服务器的配置不能在这里修改');
    const old = raws.get(id) ?? {};
    const raw = s.type === 'stdio' ? { ...old, env: { ...(old.env ?? {}), [key]: value } } : { ...old, headers: { ...(old.headers ?? {}), [key]: value } };
    await remove(s);
    await add(s, raw);
    reloadMcp();
    await probeMcp();
  },
});
