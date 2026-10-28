/**
 * Permission rules as Claude Code writes them (`Tool` or `Tool(specifier)`): parsing, a plain-language
 * description, and a simplified version of Claude Code's matching for previews and the mock.
 * The real decision is always made by Claude Code; this only explains it.
 */
import type { PermissionRule } from '../api/types';

export type RuleKind = 'bash' | 'read' | 'edit' | 'web' | 'mcp' | 'agent' | 'skill' | 'raw';

export function parseRule(rule: string): { tool: string; spec: string | null } {
  const m = /^([\w-]+)\((.*)\)$/s.exec(rule.trim());
  return m ? { tool: m[1], spec: m[2] } : { tool: rule.trim(), spec: null };
}

const TOOL_LABEL: Record<string, string> = {
  Bash: '命令', PowerShell: 'PowerShell 命令', Read: '读取文件', Edit: '修改文件', Write: '新建文件', WebFetch: '抓取网页',
  Glob: '按名称找文件', Grep: '搜索文件内容', Agent: '子代理', Skill: '技能', NotebookEdit: '编辑笔记本',
};

function pathText(spec: string): string {
  if (spec.startsWith('//')) return `${spec.slice(1)}（绝对路径）`;
  if (spec.startsWith('~/')) return `${spec}（用户目录）`;
  if (spec.startsWith('/')) return `工作区 ${spec.slice(1)}`;
  if (spec.startsWith('./')) return `工作区 ${spec.slice(2)}`;
  return spec.includes('/') ? `工作区 ${spec}` : `任意位置的 ${spec}`;
}

/** Plain-language description of a rule, in the UI's source language. */
export function describeRule(rule: string): string {
  const { tool, spec } = parseRule(rule);
  if (tool.startsWith('mcp__')) {
    const [, server, name] = tool.split('__');
    if (!name || name === '*') return `MCP 服务器 ${server} 的全部工具`;
    return name.endsWith('*') ? `MCP 服务器 ${server} 中以 ${name.slice(0, -1)} 开头的工具` : `MCP 服务器 ${server} 的 ${name} 工具`;
  }
  if (spec === null || spec === '*' || spec === '') {
    return { Bash: '所有命令', Read: '读取任何文件', Edit: '修改任何文件', WebFetch: '抓取任何网页' }[tool] ?? `整个「${TOOL_LABEL[tool] ?? tool}」工具`;
  }
  if (tool === 'Bash' || tool === 'PowerShell') {
    const s = spec.replace(/:\*$/, ' *');
    if (s.endsWith(' *') && !s.slice(0, -2).includes('*')) return `以「${s.slice(0, -2)}」开头的命令`;
    if (!s.includes('*')) return `完全等于「${s}」的命令`;
    return `符合「${s}」的命令（* 代表任意内容）`;
  }
  if (tool === 'Read' || tool === 'Edit') return `${tool === 'Read' ? '读取' : '修改'} ${pathText(spec)}`;
  if (tool === 'WebFetch') return spec.startsWith('domain:') ? `抓取 ${spec.slice(7)} 的网页` : `抓取 ${spec}`;
  if (tool === 'Agent') return `子代理 ${spec}`;
  if (tool === 'Skill') return `技能 ${spec}`;
  return `${TOOL_LABEL[tool] ?? tool}：${spec}`;
}

/** Build a rule from the structured editor's fields. */
export function buildRule(kind: RuleKind, a: string, b = '', bashMode: 'prefix' | 'exact' | 'all' = 'prefix'): string {
  const v = a.trim();
  switch (kind) {
    case 'bash':
      if (bashMode === 'all') return 'Bash';
      if (!v) return '';
      return bashMode === 'prefix' ? `Bash(${v} *)` : `Bash(${v})`;
    case 'read': return v ? `Read(${v})` : 'Read';
    case 'edit': return v ? `Edit(${v})` : 'Edit';
    case 'web': return v ? `WebFetch(domain:${v.replace(/^https?:\/\//, '').replace(/\/.*$/, '')})` : 'WebFetch';
    case 'mcp': return v ? `mcp__${v}__${b.trim() || '*'}` : '';
    case 'agent': return v ? `Agent(${v})` : 'Agent';
    case 'skill': return v ? `Skill(${v})` : 'Skill';
    default: return v;
  }
}

function globToRegex(glob: string, segment: boolean): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; }
    else if (c === '*') re += segment ? '[^/]*' : '.*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function matchCommand(spec: string, cmd: string): boolean {
  const s = spec.replace(/:\*$/, ' *');
  // "ls *" also matches the bare "ls" when the trailing * is the only wildcard.
  if (s.endsWith(' *') && !s.slice(0, -2).includes('*') && cmd === s.slice(0, -2)) return true;
  return globToRegex(s, false).test(cmd);
}

function matchPath(spec: string, path: string): boolean {
  const p = path.replace(/\\/g, '/').replace(/^\.\//, '');
  let pat = spec;
  if (pat.startsWith('//')) return globToRegex(pat.slice(1), true).test(p.startsWith('/') ? p : `/${p}`);
  if (pat.startsWith('/') || pat.startsWith('./')) pat = pat.replace(/^\.?\//, '');
  else if (!pat.includes('/')) pat = `**/${pat}`; // bare names match at any depth
  if (pat.endsWith('/')) pat += '**';
  return globToRegex(pat, true).test(p) || (pat.startsWith('**/') && globToRegex(pat.slice(3), true).test(p));
}

/** Does `rule` match one call? `input` is the command, file path or URL. */
export function matchRule(rule: string, tool: string, input = ''): boolean {
  const { tool: rt, spec } = parseRule(rule);
  if (rt.startsWith('mcp__') || tool.startsWith('mcp__')) return globToRegex(rt, false).test(tool);
  const t = tool === 'Write' || tool === 'NotebookEdit' ? 'Edit' : tool;
  if (rt !== t) return false;
  if (spec === null || spec === '*' || spec === '') return true;
  if (t === 'Bash' || t === 'PowerShell') return matchCommand(spec, input.trim());
  if (t === 'Read' || t === 'Edit') return matchPath(spec, input.trim());
  if (t === 'WebFetch') {
    const host = input.trim().replace(/^https?:\/\//, '').replace(/[/:].*$/, '');
    return spec.startsWith('domain:') ? globToRegex(spec.slice(7), true).test(host) : false;
  }
  return spec === input.trim();
}

/** Split a shell command on the operators Claude Code recognises (&&, ||, ;, |, &, newline). */
export function splitCommand(cmd: string): string[] {
  return cmd.split(/&&|\|\||;|\|&|\||&|\n/).map((s) => s.trim()).filter(Boolean);
}

export type Outcome =
  | { kind: 'deny' | 'ask' | 'allow'; rule: PermissionRule; part?: string }
  | { kind: 'none'; unmatched?: string };

/**
 * Deny, then ask, then allow; the first match decides. For a compound command a deny or ask rule
 * applies when any part matches, and an allow rule only approves when every part is allowed.
 */
export function evaluate(rules: PermissionRule[], tool: string, input = ''): Outcome {
  const parts = tool === 'Bash' || tool === 'PowerShell' ? splitCommand(input) : [input];
  for (const kind of ['deny', 'ask'] as const) {
    for (const part of parts) {
      const r = rules.find((x) => x.behavior === kind && matchRule(x.rule, tool, part));
      if (r) return { kind, rule: r, part: parts.length > 1 ? part : undefined };
    }
  }
  const allows = parts.map((part) => rules.find((x) => x.behavior === 'allow' && matchRule(x.rule, tool, part)));
  const missing = parts.findIndex((_, i) => !allows[i]);
  if (missing < 0 && allows[0]) return { kind: 'allow', rule: allows[0] };
  return { kind: 'none', unmatched: parts.length > 1 && missing >= 0 ? parts[missing] : undefined };
}
