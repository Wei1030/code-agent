/**
 * Stands in for the user working in the `claude` CLI: runs Claude Code directly through the SDK in
 * a workspace of the test world, against the scripted endpoint. Its transcripts land where Code
 * Agent looks for them, like real CLI sessions.
 */
import { query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { FakeModel } from './fake-model';
import { cleanEnv } from './server';
import type { World } from './world';

export interface CliRun {
  sessionId: string;
  messages: SDKMessage[];
}

export function cliEnv(world: World, model: FakeModel): Record<string, string> {
  return cleanEnv({
    ...world.env(),
    ANTHROPIC_BASE_URL: model.url,
    ANTHROPIC_AUTH_TOKEN: 'cli-token',
    ANTHROPIC_MODEL: 'model-one',
    ANTHROPIC_SMALL_FAST_MODEL: 'model-one',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'model-one',
  });
}

/** One prompt in the CLI; `resume` continues a session, `at` resumes from an earlier message. */
export async function cli(world: World, model: FakeModel, cwd: string, prompt: string, opts: { resume?: string; at?: string; extra?: Partial<Options> } = {}): Promise<CliRun> {
  const messages: SDKMessage[] = [];
  let sessionId = opts.resume ?? '';
  const q = query({
    prompt,
    options: {
      cwd, model: 'model-one', env: cliEnv(world, model),
      permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true,
      settingSources: ['user', 'project', 'local'],
      ...(opts.resume ? { resume: opts.resume } : {}),
      ...(opts.at ? { resumeSessionAt: opts.at } : {}),
      ...opts.extra,
    },
  });
  for await (const m of q) {
    messages.push(m);
    if ('session_id' in m && m.session_id) sessionId = m.session_id;
  }
  return { sessionId, messages };
}
