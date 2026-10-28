/** How tool calls look in the transcript: the one-line detail, the right-hand note and the output. */
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { structuredPatch } from 'diff';
import type { NestedRow, ToolOutput } from '@code-agent/shared/types';

type Input = Record<string, unknown>;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

export function rel(cwd: string, p: string): string {
  if (!p) return '';
  const r = path.relative(cwd, p);
  return !r || r.startsWith('..') || path.isAbsolute(r) ? p : r.replace(/\\/g, '/');
}

export function firstLine(s: string, max = 160): string {
  const l = s.split(/\r?\n/)[0] ?? '';
  return l.length > max ? `${l.slice(0, max)}…` : l;
}

/** "mcp__github__create_issue" → github · create_issue */
export function mcpParts(name: string): { server: string; tool: string } | null {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? { server: m[1], tool: m[2] } : null;
}

export function toolDetail(name: string, input: Input, cwd: string): string {
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return firstLine(str(input.command));
    case 'Read': {
      const p = rel(cwd, str(input.file_path));
      return input.offset ? `${p} · 从第 ${str(input.offset)} 行` : p;
    }
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return rel(cwd, str(input.file_path ?? input.notebook_path));
    case 'Glob':
      return input.path ? `${str(input.pattern)} in ${rel(cwd, str(input.path))}` : str(input.pattern);
    case 'Grep':
      return `"${str(input.pattern)}"${input.glob ? ` in ${str(input.glob)}` : input.path ? ` in ${rel(cwd, str(input.path))}` : ''}`;
    case 'WebFetch':
      return str(input.url);
    case 'WebSearch':
      return str(input.query);
    case 'Agent':
    case 'Task':
      return str(input.description);
    case 'Skill':
      return str(input.skill ?? input.command);
    case 'TodoWrite':
      return `${(input.todos as unknown[] | undefined)?.length ?? 0} 项`;
    case 'TaskCreate':
      return str(input.subject);
    case 'TaskUpdate':
      return `#${str(input.taskId)}${input.status ? ` → ${str(input.status)}` : ''}`;
    case 'AskUserQuestion':
      return str((input.questions as Array<{ question: string }> | undefined)?.[0]?.question);
    case 'ExitPlanMode':
      return firstLine(str(input.plan).replace(/^#+\s*/, ''), 80);
    case 'TaskStop':
      return str(input.task_id ?? input.shell_id);
    default:
      return Object.entries(input).filter(([, v]) => v != null && v !== '').slice(0, 2).map(([k, v]) => `${k}: ${firstLine(str(v), 40)}`).join(', ');
  }
}

/** Display name: MCP tools as server · tool. */
export function toolName(name: string): string {
  const mcp = mcpParts(name);
  return mcp ? `${mcp.server} · ${mcp.tool}` : name;
}

export function toolIcon(name: string): string {
  if (name === 'Bash' || name === 'PowerShell') return 'terminal';
  if (name === 'Read') return 'file';
  if (name === 'Edit' || name === 'Write' || name === 'NotebookEdit') return 'pencil';
  if (name === 'Grep' || name === 'Glob') return 'search';
  if (name === 'WebFetch' || name === 'WebSearch') return 'globe';
  if (name === 'Agent' || name === 'Task') return 'agent';
  if (name.startsWith('mcp__')) return 'plug';
  return 'spark';
}

export const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'LS']);
export const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit']);
/** Tools that may run long and can be sent to the background. */
export const BACKGROUNDABLE = new Set(['Bash', 'PowerShell', 'Agent', 'Task']);

export function lines(text: string, max = 400): string[] {
  const all = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  return all.length > max ? [...all.slice(0, max), `… 还有 ${all.length - max} 行`] : all;
}

export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] };

export function hunksToDiff(hunks: Hunk[]): { diff: string[]; add: number; del: number } {
  const diff: string[] = [];
  let add = 0;
  let del = 0;
  for (const h of hunks) {
    diff.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) {
      if (l.startsWith('\\')) continue;
      if (l.startsWith('+')) add++;
      else if (l.startsWith('-')) del++;
      diff.push(l);
    }
  }
  return { diff, add, del };
}

export function diffTexts(before: string, after: string): { diff: string[]; add: number; del: number } {
  const p = structuredPatch('a', 'b', before, after, '', '', { context: 3 });
  return hunksToDiff(p.hunks);
}

function readOr(file: string): string | null {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** The change an edit tool is about to make, for the approval card. */
export function proposedDiff(name: string, input: Input, cwd: string): { path: string; lines: string[] } | undefined {
  const file = str(input.file_path);
  if (!file) return undefined;
  const abs = path.isAbsolute(file) ? file : path.join(cwd, file);
  const before = readOr(abs) ?? '';
  let after: string | null = null;
  if (name === 'Write') after = str(input.content);
  else if (name === 'Edit') {
    const o = str(input.old_string);
    const n = str(input.new_string);
    after = input.replace_all ? before.split(o).join(n) : before.replace(o, () => n);
  }
  if (after === null) return undefined;
  return { path: rel(cwd, abs), lines: diffTexts(before, after).diff };
}

/** Text of a tool_result content. */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      if (!c || typeof c !== 'object') return '';
      const o = c as { type?: string; text?: unknown };
      if (o.type === 'image') return '[图片]';
      return 'text' in o ? str(o.text) : '';
    }).join('\n');
  }
  return str(content);
}

const clip = (text: string, n = 4000) => (text.length > n ? `${text.slice(0, n)}…` : text);

/** Output, right-hand note and file change of a finished tool call. */
export function toolResult(name: string, input: Input, content: unknown, structured: unknown, isError: boolean, cwd: string): {
  output?: ToolOutput; right?: string; change?: { path: string; kind: 'created' | 'modified'; diff: string[]; add: number; del: number };
} {
  const text = resultText(content);
  const s = (structured && typeof structured === 'object' ? structured : {}) as Record<string, unknown>;
  if (isError) return { output: text ? { type: 'text', text: clip(text) } : undefined, right: '失败' };
  if (name === 'Bash' || name === 'PowerShell') {
    const out = [str(s.stdout), str(s.stderr)].filter(Boolean).join('\n') || text;
    return { output: out.trim() ? { type: 'code', lines: lines(out, 200) } : undefined, right: s.backgroundTaskId ? '已转到后台' : s.interrupted ? '已中断' : undefined };
  }
  if (name === 'Read') {
    const f = s.file as { numLines?: number } | undefined;
    return { right: `${f?.numLines ?? text.split('\n').length} 行` };
  }
  if (EDIT_TOOLS.has(name)) {
    const hunks = s.structuredPatch as Hunk[] | undefined;
    const file = str(s.filePath ?? input.file_path ?? input.notebook_path);
    if (hunks?.length) {
      const d = hunksToDiff(hunks);
      return {
        output: { type: 'diff', lines: d.diff },
        right: `+${d.add} −${d.del}`,
        change: { path: rel(cwd, file), kind: s.type === 'create' || s.originalFile === null ? 'created' : 'modified', ...d },
      };
    }
    if (name === 'Write' && typeof input.content === 'string') {
      const d = diffTexts('', input.content);
      return { output: { type: 'diff', lines: d.diff }, right: `+${d.add}`, change: { path: rel(cwd, file), kind: 'created', ...d } };
    }
    return {};
  }
  if (name === 'Grep') {
    const n = (s.numMatches as number | undefined) ?? (s.numFiles as number | undefined);
    const list = (s.filenames as string[] | undefined)?.map((f) => rel(cwd, f));
    return { right: n !== undefined ? `${n} 处匹配` : undefined, output: list?.length ? { type: 'code', lines: list.slice(0, 50) } : text ? { type: 'code', lines: lines(text, 50) } : undefined };
  }
  if (name === 'Glob') {
    const list = (s.filenames as string[] | undefined)?.map((f) => rel(cwd, f));
    return { right: list ? `${list.length} 个文件` : undefined, output: list?.length ? { type: 'code', lines: list.slice(0, 50) } : undefined };
  }
  if (name === 'TodoWrite' || name.startsWith('Task') || name === 'ExitPlanMode' || name === 'AskUserQuestion') return {};
  return text.trim() ? { output: { type: 'text', text: clip(text) } } : {};
}

/** A nested row for a subagent's tool call. */
export function agentRow(name: string, input: Input, cwd: string): NestedRow {
  return { icon: toolIcon(name), text: `${toolName(name)} ${toolDetail(name, input, cwd)}`.trim(), mono: name === 'Bash' };
}
