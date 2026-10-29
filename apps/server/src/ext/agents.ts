/**
 * Subagents as Claude Code finds them: `agents/*.md` in the config directory (all workspaces), a
 * workspace's `.claude/agents/`, loaded plugins, and the built-in ones Claude Code reports. Edits are
 * written back to those files (frontmatter name / description / tools / model, body = prompt).
 * Switching one off adds an `Agent(<name>)` deny rule to new sessions, so Claude cannot use it.
 */
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AgentInfo } from '@anthropic-ai/claude-agent-sdk';
import type { AgentFile, Workspace } from '@code-agent/shared/types';
import { app, set } from '../state';
import { register } from '../hub';
import { load, save } from '../store';
import { configDir } from '../claude/files';

/** Absolute file of each agent id; the UI only sees display paths. */
const files = new Map<string, string>();
const disabled = new Set(load<string[]>('agents-off', []));
/** Built-in agents from the last running session (name, description, model). */
let builtins: AgentInfo[] = load<AgentInfo[]>('agents-builtin', []);

function parse(content: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(content);
  const meta: Record<string, string> = {};
  for (const line of (m?.[1] ?? '').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["'](.*)["']$/, '$1');
  }
  return { meta, body: m ? content.slice(m[0].length) : content };
}

function agentsIn(root: string, source: AgentFile['source'], shown: string, ws?: Workspace, plugin?: string): AgentFile[] {
  let names: string[];
  try {
    names = readdirSync(root).filter((n) => n.endsWith('.md'));
  } catch {
    return [];
  }
  return names.map((n) => {
    const file = path.join(root, n);
    const { meta, body } = parse(readFileSync(file, 'utf8'));
    const name = meta.name || n.slice(0, -3);
    const id = `${source}:${ws?.id ?? plugin ?? ''}:${name}`;
    files.set(id, file);
    return {
      id, name, description: meta.description ?? '', tools: (meta.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean),
      model: meta.model || 'inherit', source, ...(ws ? { workspaceId: ws.id } : {}), ...(plugin ? { plugin } : {}),
      path: `${shown}/${n}`, prompt: body.trim(), enabled: !disabled.has(name),
    };
  });
}

export function reloadAgents() {
  files.clear();
  const agents: AgentFile[] = [
    ...agentsIn(path.join(configDir(), 'agents'), 'global', '~/.claude/agents'),
    ...app.workspaces.flatMap((ws) => agentsIn(path.join(ws.path, '.claude', 'agents'), 'workspace', '.claude/agents', ws)),
    ...app.plugins.filter((p) => p.enabled && p.status === 'loaded').flatMap((p) => agentsIn(path.join(p.path, 'agents'), 'plugin', `${p.name}/agents`, undefined, p.name)),
  ];
  const known = new Set(agents.map((a) => a.name));
  for (const b of builtins) {
    if (known.has(b.name)) continue;
    agents.push({ id: `builtin::${b.name}`, name: b.name, description: b.description, tools: [], model: b.model ?? 'inherit', source: 'builtin', path: '（Claude Code 内置）', prompt: '', enabled: !disabled.has(b.name) });
  }
  if (JSON.stringify(agents) !== JSON.stringify(app.agents)) set('agents', agents);
}

/** A session reported the agents it has; the ones without a file are Claude Code's own. */
export function noteAgents(list: AgentInfo[]) {
  const fromFiles = new Set(app.agents.filter((a) => a.source !== 'builtin').map((a) => a.name));
  const next = list.filter((a) => !fromFiles.has(a.name)).map((a) => ({ name: a.name, description: a.description, ...(a.model ? { model: a.model } : {}) }));
  if (JSON.stringify(next) === JSON.stringify(builtins)) return;
  builtins = next;
  save('agents-builtin', () => builtins);
  reloadAgents();
}

/** Deny rules for the agents switched off, for new sessions. */
export const deniedAgents = (): string[] => [...disabled].map((n) => `Agent(${n})`);

function fileText(a: Pick<AgentFile, 'name' | 'description' | 'tools' | 'model' | 'prompt'>): string {
  const lines = ['---', `name: ${a.name}`, `description: ${a.description.replace(/\r?\n/g, ' ')}`];
  if (a.tools.length) lines.push(`tools: ${a.tools.join(', ')}`);
  if (a.model && a.model !== 'inherit') lines.push(`model: ${a.model}`);
  lines.push('---', '', a.prompt.trim(), '');
  return lines.join('\n');
}

register({
  saveAgent: (a) => {
    const name = a.name.trim();
    if (!/^[A-Za-z0-9][\w-]*$/.test(name)) throw new Error('名称只能用字母、数字、- 和 _');
    const cur = a.id ? app.agents.find((x) => x.id === a.id) : undefined;
    if (cur && (cur.source === 'builtin' || cur.source === 'plugin')) throw new Error('内置和插件里的子代理不能修改');
    let file = cur ? files.get(cur.id) : undefined;
    if (!file) {
      const ws = app.workspaces.find((w) => w.id === a.workspaceId);
      if (a.workspaceId && !ws) throw new Error('工作区不存在');
      file = path.join(ws ? path.join(ws.path, '.claude', 'agents') : path.join(configDir(), 'agents'), `${name}.md`);
      if (existsSync(file)) throw new Error(`已经有一个叫 ${name} 的子代理`);
    }
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, fileText({ ...a, name }));
    reloadAgents();
    const saved = app.agents.find((x) => files.get(x.id) === file);
    if (!saved) throw new Error('保存后没有读到这个子代理');
    return saved;
  },
  deleteAgent: (id) => {
    const a = app.agents.find((x) => x.id === id);
    const file = files.get(id);
    if (!a || !file || a.source === 'builtin' || a.source === 'plugin') throw new Error('这个子代理不能删除');
    rmSync(file, { force: true });
    reloadAgents();
  },
  setAgentEnabled: (id, on) => {
    const a = app.agents.find((x) => x.id === id);
    if (!a) return;
    if (on) disabled.delete(a.name);
    else disabled.add(a.name);
    save('agents-off', () => [...disabled]);
    reloadAgents();
  },
});
