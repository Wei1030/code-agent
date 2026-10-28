/**
 * Skills (SKILL.md folders), command files and local plugins, read from where Claude Code finds
 * them: the config directory (all workspaces), each workspace's .claude/ and plugin folders.
 * Edits in the UI are written back to those files. The on/off switch of a skill only filters what
 * sessions offer Claude (SDK `skills` option); the files stay on disk.
 */
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { CommandFile, PluginInfo, SkillInfo, Workspace } from '@code-agent/shared/types';
import { app, onWrite, set } from '../state';
import { register } from '../hub';
import { load, save } from '../store';
import { configDir, readJson } from '../claude/files';
import { live, liveIds } from '../sessions/live';
import { summary } from '../sessions/registry';

/** Absolute file of each skill / command id; the UI only sees display paths. */
const files = new Map<string, string>();
let disabled = new Set(load<string[]>('skills-off.json', []));
/** Claude Code's own skills and commands (from the last probe), by name. */
let bundled: Array<{ name: string; description: string; argumentHint: string; builtin?: boolean }> = [];

export function noteCommands(list: typeof bundled) {
  bundled = list;
  reloadSkills();
}

function fm(content: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  const out: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["'](.*)["']$/, '$1');
  }
  return out;
}

function invocable(f: Record<string, string>): SkillInfo['invocable'] {
  if (f['user-invocable'] === 'false') return 'model';
  if (f['disable-model-invocation'] === 'true') return 'user';
  return 'both';
}

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};
const dirs = (d: string) => {
  try {
    return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

function skillsIn(root: string, source: SkillInfo['source'], shown: string, ws?: Workspace, plugin?: string): SkillInfo[] {
  return dirs(root).filter((n) => existsSync(path.join(root, n, 'SKILL.md'))).map((n) => {
    const file = path.join(root, n, 'SKILL.md');
    const content = read(file);
    const f = fm(content);
    const name = f.name || n;
    const id = `${source}:${ws?.id ?? plugin ?? ''}:${name}`;
    files.set(id, file);
    return {
      id, name, description: f.description ?? '', source, ...(ws ? { workspaceId: ws.id } : {}), ...(plugin ? { plugin } : {}),
      invocable: invocable(f), enabled: !disabled.has(id), path: `${shown}/${n}/SKILL.md`, content,
    };
  });
}

function commandsIn(root: string, source: CommandFile['source'], shown: string, ws?: Workspace, plugin?: string, prefix = ''): CommandFile[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: CommandFile[] = [];
  for (const e of entries) {
    if (e.isDirectory()) out.push(...commandsIn(path.join(root, e.name), source, `${shown}/${e.name}`, ws, plugin, `${prefix}${e.name}:`));
    else if (e.name.endsWith('.md')) {
      const file = path.join(root, e.name);
      const content = read(file);
      const f = fm(content);
      const name = `${prefix}${e.name.slice(0, -3)}`;
      const id = `${source}:${ws?.id ?? plugin ?? ''}:${name}`;
      files.set(id, file);
      out.push({ id, name, desc: f.description ?? content.replace(/^---[\s\S]*?---/, '').trim().split('\n')[0]?.slice(0, 120) ?? '', argHint: f['argument-hint'] ?? '', source, ...(ws ? { workspaceId: ws.id } : {}), ...(plugin ? { plugin } : {}), path: `${shown}/${e.name}`, content });
    }
  }
  return out;
}

export function reloadSkills() {
  const cfg = configDir();
  const skills: SkillInfo[] = [
    ...app.workspaces.flatMap((ws) => skillsIn(path.join(ws.path, '.claude', 'skills'), 'workspace', '.claude/skills', ws)),
    ...skillsIn(path.join(cfg, 'skills'), 'global', '~/.claude/skills'),
    ...app.plugins.filter((p) => p.enabled && p.status === 'loaded').flatMap((p) => skillsIn(path.join(p.path, 'skills'), 'plugin', `${p.name}/skills`, undefined, p.name)),
  ];
  const known = new Set(skills.map((s) => s.name));
  for (const c of bundled) {
    if (c.builtin || known.has(c.name) || c.name.includes(':')) continue;
    const id = `bundled::${c.name}`;
    skills.push({ id, name: c.name, description: c.description, source: 'bundled', invocable: 'both', enabled: !disabled.has(id), path: `（Claude Code 内置）`, content: `# ${c.name}\n\n${c.description}\n` });
  }
  const commandFiles: CommandFile[] = [
    ...app.workspaces.flatMap((ws) => commandsIn(path.join(ws.path, '.claude', 'commands'), 'workspace', '.claude/commands', ws)),
    ...commandsIn(path.join(cfg, 'commands'), 'global', '~/.claude/commands'),
    ...app.plugins.filter((p) => p.enabled && p.status === 'loaded').flatMap((p) => commandsIn(path.join(p.path, 'commands'), 'plugin', `${p.name}/commands`, undefined, p.name)),
  ];
  if (JSON.stringify(skills) !== JSON.stringify(app.skills)) set('skills', skills);
  if (JSON.stringify(commandFiles) !== JSON.stringify(app.commandFiles)) set('commandFiles', commandFiles);
}

/** Where a new skill or command file goes, from the display path the UI chose. */
function target(shown: string, wsId?: string): string {
  if (shown.startsWith('~/.claude/')) return path.join(configDir(), ...shown.slice('~/.claude/'.length).split('/'));
  const ws = app.workspaces.find((w) => w.id === wsId);
  if (!ws) throw new Error('工作区不存在');
  return path.join(ws.path, ...shown.split('/'));
}

function writeFile(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

onWrite('skills', (next, prev) => {
  for (const n of next) {
    const p = prev.find((x) => x.id === n.id);
    if (p && p.enabled !== n.enabled) {
      if (n.enabled) disabled.delete(n.id);
      else disabled.add(n.id);
      save('skills-off.json', () => [...disabled]);
    }
    if (n.source === 'bundled' || n.source === 'plugin') continue;
    if (!p) writeFile(target(n.path, n.workspaceId), n.content);
    else if (p.content !== n.content) writeFile(files.get(n.id) ?? target(n.path, n.workspaceId), n.content);
  }
  for (const p of prev) {
    if (next.some((x) => x.id === p.id) || p.source === 'bundled' || p.source === 'plugin') continue;
    const file = files.get(p.id);
    if (file && path.basename(file) === 'SKILL.md') rmSync(path.dirname(file), { recursive: true, force: true });
  }
  reloadSkills();
});

onWrite('commandFiles', (next, prev) => {
  for (const n of next) {
    if (n.source === 'plugin') continue;
    const p = prev.find((x) => x.id === n.id);
    if (!p) writeFile(target(n.path, n.workspaceId), n.content);
    else if (p.content !== n.content) writeFile(files.get(n.id) ?? target(n.path, n.workspaceId), n.content);
  }
  for (const p of prev) {
    if (next.some((x) => x.id === p.id) || p.source === 'plugin') continue;
    const file = files.get(p.id);
    if (file) rmSync(file, { force: true });
  }
  reloadSkills();
});

// ------------------------------------------------------------------ plugins

const count = (d: string, pred: (name: string, isDir: boolean) => boolean) => {
  try {
    return readdirSync(d, { withFileTypes: true }).filter((e) => pred(e.name, e.isDirectory())).length;
  } catch {
    return 0;
  }
};

/** Read a local plugin folder: manifest, and how many skills, commands, agents, MCP servers and hooks it brings. */
function inspect(p: PluginInfo): PluginInfo {
  const dir = p.path.trim();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return { ...p, status: 'error', error: `文件夹不存在：${dir}` };
  const manifestFile = path.join(dir, '.claude-plugin', 'plugin.json');
  const manifest = existsSync(manifestFile) ? readJson(manifestFile) : null;
  if (manifestFile && existsSync(manifestFile) && !manifest?.name) return { ...p, status: 'error', error: '.claude-plugin/plugin.json 缺少必填字段 "name"' };
  const mcpCfg = readJson(path.join(dir, '.mcp.json'));
  const mcp = Object.keys((mcpCfg.mcpServers ?? mcpCfg) as object).length + Object.keys((manifest?.mcpServers as object | undefined) ?? {}).length;
  const hooksCfg = readJson(path.join(dir, 'hooks', 'hooks.json'));
  const hooks = Object.values((hooksCfg.hooks ?? {}) as Record<string, unknown[]>).reduce((a, v) => a + (Array.isArray(v) ? v.length : 0), 0);
  return {
    ...p, name: String(manifest?.name ?? p.name), status: 'loaded', error: undefined, ...(manifest?.version ? { version: String(manifest.version) } : {}),
    contents: {
      skills: count(path.join(dir, 'skills'), (n, d) => d && existsSync(path.join(dir, 'skills', n, 'SKILL.md'))),
      commands: count(path.join(dir, 'commands'), (n) => n.endsWith('.md')),
      agents: count(path.join(dir, 'agents'), (n) => n.endsWith('.md')),
      mcp, hooks,
    },
  };
}

onWrite('plugins', (next) => {
  const checked = next.map((p) => (p.status === 'loading' || !app.plugins.some((x) => x.id === p.id && x.path === p.path) ? inspect(p) : p));
  set('plugins', checked);
  reloadSkills();
});

export function recheckPlugins() {
  const checked = app.plugins.map(inspect);
  if (JSON.stringify(checked) !== JSON.stringify(app.plugins)) set('plugins', checked);
}

async function reloadInSessions(kind: 'skills' | 'plugins', workspaceId?: string): Promise<number> {
  let n = 0;
  for (const sid of liveIds()) {
    if (workspaceId && summary(sid)?.workspaceId !== workspaceId) continue;
    const l = live(sid);
    if (!l) continue;
    try {
      if (kind === 'skills') await l.q.reloadSkills();
      else await l.q.reloadPlugins({ addPlugins: app.plugins.filter((p) => p.enabled && p.status === 'loaded').map((p) => ({ type: 'local' as const, path: p.path })) });
      n += 1;
    } catch (e) {
      console.error(`[skills] reload ${kind} in ${sid} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return n;
}

register({
  refreshExtensions: () => {
    recheckPlugins();
    reloadSkills();
  },
  reloadInSessions: (kind, workspaceId) => reloadInSessions(kind, workspaceId),
});
