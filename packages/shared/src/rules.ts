/**
 * Permission rules as Claude Code writes them (`Tool` or `Tool(specifier)`): parsing, a plain-language
 * description and building one in the rule editor. Whether a rule applies is Claude Code's decision only.
 */

export type RuleKind = 'bash' | 'read' | 'edit' | 'web' | 'mcp' | 'agent' | 'skill' | 'raw';

export function parseRule(rule: string): { tool: string; spec: string | null } {
  const m = /^([\w-]+)\((.*)\)$/s.exec(rule.trim());
  return m ? { tool: m[1], spec: m[2] } : { tool: rule.trim(), spec: null };
}

const TOOL_LABEL: Record<string, string> = {
  Bash: '命令', PowerShell: 'PowerShell 命令', Read: '读取文件', Edit: '修改文件', Write: '新建文件', WebFetch: '抓取网页', WebSearch: '网页搜索',
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

/**
 * The rules to write for one: a command rule goes in twice, for Bash and for PowerShell, because
 * Claude Code runs commands with PowerShell on Windows without Git Bash and a rule names one tool.
 */
export function rulesFor(rule: string): string[] {
  const { tool, spec } = parseRule(rule);
  return tool === 'Bash' ? [rule, spec === null ? 'PowerShell' : `PowerShell(${spec})`] : [rule];
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
