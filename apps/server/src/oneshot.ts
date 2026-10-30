/**
 * Short background Claude Code runs with structured output (the board recorder, imports). They do
 * not show up as sessions, are not saved, and do not count against the running-session limit.
 */
import os from 'node:os';
import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { app } from './state';
import { systemClaude } from './claude/files';
import { envFor, pointlessRetry, reasoning, resolveModel, validModel } from './models';
import { recordUsage } from './usage';

export interface OneShot {
  prompt: string;
  schema: Record<string, unknown>;
  model: string;
  effort: Options['effort'];
  cwd?: string;
  /** Load the user's settings and MCP servers (needed to reach e.g. a Jira MCP server). */
  withSettings?: boolean;
  allowedTools?: string[];
  workspaceId?: string;
  timeoutMs?: number;
}

export async function oneShot<T>(o: OneShot): Promise<T> {
  // A Claude model while only endpoint models are offered (no Claude login) would end at once without
  // an answer: run on a model that is there.
  o = { ...o, model: validModel(o.model) };
  const model = resolveModel(o.model);
  const exe = app.provider.executable === 'system' ? systemClaude() : undefined;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), o.timeoutMs ?? 180_000);
  try {
    const q = query({
      prompt: o.prompt,
      options: {
        cwd: o.cwd ?? os.tmpdir(),
        model: model.name,
        ...reasoning(model, o.effort),
        persistSession: false,
        settingSources: o.withSettings ? ['user', 'project', 'local'] : [],
        systemPrompt: 'You are a careful assistant that turns material into structured records. Answer only through the required structured output.',
        permissionMode: 'dontAsk',
        ...(o.allowedTools ? { allowedTools: o.allowedTools } : { disallowedTools: ['Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Read', 'Glob', 'Grep'] }),
        outputFormat: { type: 'json_schema', schema: o.schema },
        env: envFor(o.model),
        abortController: abort,
        ...(exe ? { pathToClaudeCodeExecutable: exe } : {}),
      },
    });
    for await (const m of q) {
      const rejected = m.type === 'system' && m.subtype === 'api_retry' ? pointlessRetry(o.model, m) : null;
      if (rejected) {
        abort.abort();
        throw new Error(rejected);
      }
      if (m.type !== 'result') continue;
      recordUsage(m.modelUsage as Parameters<typeof recordUsage>[0], o.workspaceId ?? '');
      if (m.subtype === 'success' && m.structured_output !== undefined) return m.structured_output as T;
      throw new Error(m.subtype === 'success' ? '没有返回结构化结果' : `${m.subtype}${'errors' in m && m.errors?.length ? `：${m.errors.join('；')}` : ''}`);
    }
    throw new Error('没有结果');
  } finally {
    clearTimeout(timer);
  }
}
