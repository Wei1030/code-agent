/**
 * The files Claude reads at the start of every session — CLAUDE.md in the config directory and in a
 * workspace, CLAUDE.local.md, rules under .claude/rules — and Claude Code's auto memory of the
 * workspace (<config>/projects/<path as a name>/memory). Viewed and edited in 设置 → 项目说明与记忆.
 */
import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { InstructionFile } from '@code-agent/shared/types';
import { app } from '../state';
import { register } from '../hub';
import { configDir } from '../claude/files';

/** Absolute file behind each id handed to the UI; nothing else can be read or written. */
const known = new Map<string, string>();

/** How Claude Code names a project's folder under <config>/projects. */
const projectKey = (dir: string) => path.resolve(dir).replace(/[^a-zA-Z0-9]/g, '-');

function mdIn(dir: string): string[] {
  try {
    return readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
  } catch {
    return [];
  }
}

function entry(file: string, scope: InstructionFile['scope'], kind: InstructionFile['kind'], name: string, shown: string): InstructionFile {
  const id = `${scope}:${kind}:${file}`;
  known.set(id, file);
  let text = '';
  let exists = false;
  try {
    if (statSync(file).isFile()) {
      text = readFileSync(file, 'utf8');
      exists = true;
    }
  } catch {
    // Not there yet: it can be created.
  }
  const first = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && l !== '---') ?? '';
  return { id, scope, kind, name, path: shown, exists, lines: exists ? text.split(/\r?\n/).length : 0, summary: first.replace(/^#+\s*/, '').slice(0, 80) };
}

function list(workspaceId: string | null): InstructionFile[] {
  const cfg = configDir();
  const out: InstructionFile[] = [
    entry(path.join(cfg, 'CLAUDE.md'), 'global', 'claude', 'CLAUDE.md', '~/.claude/CLAUDE.md'),
    ...mdIn(path.join(cfg, 'rules')).map((n) => entry(path.join(cfg, 'rules', n), 'global', 'rule', `rules/${n}`, `~/.claude/rules/${n}`)),
  ];
  const ws = app.workspaces.find((w) => w.id === workspaceId);
  if (ws) {
    out.push(
      entry(path.join(ws.path, 'CLAUDE.md'), 'workspace', 'claude', 'CLAUDE.md', path.join(ws.path, 'CLAUDE.md')),
      entry(path.join(ws.path, 'CLAUDE.local.md'), 'workspace', 'local', 'CLAUDE.local.md', path.join(ws.path, 'CLAUDE.local.md')),
      ...mdIn(path.join(ws.path, '.claude', 'rules')).map((n) => entry(path.join(ws.path, '.claude', 'rules', n), 'workspace', 'rule', `.claude/rules/${n}`, path.join(ws.path, '.claude', 'rules', n))),
    );
    const mem = path.join(cfg, 'projects', projectKey(ws.path), 'memory');
    const notes = mdIn(mem);
    // MEMORY.md first: it is the index Claude Code loads.
    for (const n of notes.includes('MEMORY.md') ? ['MEMORY.md', ...notes.filter((x) => x !== 'MEMORY.md')] : notes) {
      out.push(entry(path.join(mem, n), 'workspace', 'memory', n, path.join(mem, n)));
    }
  }
  return out;
}

const fileOf = (id: string) => {
  const f = known.get(id);
  if (!f) throw new Error('文件不在列表里，刷新后再试');
  return f;
};

register({
  listInstructions: (workspaceId) => list(workspaceId),
  readInstruction: (id) => {
    const f = fileOf(id);
    return existsSync(f) ? readFileSync(f, 'utf8') : '';
  },
  writeInstruction: (id, content) => {
    const f = fileOf(id);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, content);
  },
});
