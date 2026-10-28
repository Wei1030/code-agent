/** Context window usage as the inspector shows it, from Claude Code's get_context_usage answer. */
import type { SDKControlGetContextUsageResponse } from '@anthropic-ai/claude-agent-sdk';
import type { ContextUsage } from '@code-agent/shared/types';

const NAMES: Record<string, string> = {
  system_prompt: '系统提示词', system_tools: '系统工具', mcp_tools: 'MCP 工具', mcp_instructions: 'MCP 说明', custom_agents: '自定义代理',
  memory_files: '记忆文件', skills: '技能', messages: '消息', autocompact_buffer: '压缩预留', compact_buffer: '压缩预留', free_space: '可用空间',
};

export function contextFrom(c: SDKControlGetContextUsageResponse, precise: boolean): ContextUsage {
  const deferred = c.categories.filter((x) => x.kind === 'deferred' || x.isDeferred);
  const byServer = new Map<string, { tools: number; tokens: number; deferred: number }>();
  for (const t of c.mcpTools ?? []) {
    const s = byServer.get(t.serverName) ?? { tools: 0, tokens: 0, deferred: 0 };
    s.tools += 1;
    if (t.isLoaded === false) s.deferred += 1;
    else s.tokens += t.tokens;
    byServer.set(t.serverName, s);
  }
  return {
    model: c.model,
    max: c.maxTokens,
    categories: c.categories
      .filter((x) => !(x.kind === 'deferred' || x.isDeferred) && x.kind !== 'free')
      .map((x) => ({ name: (x.id && NAMES[x.id]) || x.name, tokens: x.tokens, kind: x.kind === 'buffer' ? 'buffer' as const : 'used' as const })),
    deferred: {
      tools: (c.deferredBuiltinTools?.filter((t) => !t.isLoaded).length ?? 0) + (c.mcpTools ?? []).filter((t) => t.isLoaded === false).length,
      tokens: deferred.reduce((a, x) => a + x.tokens, 0),
    },
    memoryFiles: (c.memoryFiles ?? []).map((m) => ({ path: m.path, tokens: m.tokens })),
    mcp: [...byServer].map(([server, s]) => ({ server, detail: s.deferred ? `${s.tools} 个工具 · ${s.deferred} 个延迟加载` : `${s.tools} 个工具`, tokens: s.tokens })),
    precise,
  };
}
