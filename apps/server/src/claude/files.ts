/**
 * Claude Code's files Code Agent reads and writes: the config directory, settings.json files at the
 * three scopes, and the MCP entries of .claude.json / .mcp.json. Credentials are never read: only
 * the keys named here are taken from those files.
 */
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { Workspace } from '@code-agent/shared/types';
import { app } from '../state';
import { GIT_BASH_VAR, gitBash } from './gitbash';

/** CLAUDE_CONFIG_DIR as Code Agent was started with: what the "environment variable" choice means. */
export const ENV_CONFIG_DIR = process.env.CLAUDE_CONFIG_DIR;

/** Claude Code's config directory as the provider settings choose it. */
export function configDir(): string {
  const p = app.provider;
  if (p.configDir === 'custom' && p.customDir.trim()) return p.customDir.trim();
  if (p.configDir === 'env' && ENV_CONFIG_DIR) return ENV_CONFIG_DIR;
  return path.join(os.homedir(), '.claude');
}

/**
 * The Agent SDK's session functions (list, read, rename, tag, fork, delete) run in this process and
 * find Claude Code's transcripts through its CLAUDE_CONFIG_DIR, read at each call: keep it on the
 * directory the provider settings choose.
 */
export function applyConfigDir() {
  const dir = configDirEnv();
  if (dir) process.env.CLAUDE_CONFIG_DIR = dir;
  else delete process.env.CLAUDE_CONFIG_DIR;
}

/** Set CLAUDE_CONFIG_DIR for the Claude Code process only when it is not the default. */
export function configDirEnv(): string | undefined {
  const p = app.provider;
  if (p.configDir === 'default') return undefined;
  return configDir();
}

/** .claude.json: next to the config dir when CLAUDE_CONFIG_DIR is set, else in the home directory. */
export function claudeJsonPath(): string {
  return configDirEnv() ? path.join(configDir(), '.claude.json') : path.join(os.homedir(), '.claude.json');
}

export type SettingsScope = 'global' | 'workspace' | 'repo';

export function settingsPath(scope: SettingsScope, ws?: Workspace): string {
  if (scope === 'global') return path.join(configDir(), 'settings.json');
  if (!ws) throw new Error('workspace required');
  return path.join(ws.path, '.claude', scope === 'workspace' ? 'settings.local.json' : 'settings.json');
}

export function readJson(file: string): Record<string, unknown> {
  try {
    const text = readFileSync(file, 'utf8');
    return text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Change a JSON file in place, keeping every key not touched. */
export function editJson(file: string, fn: (j: Record<string, unknown>) => void) {
  const j = readJson(file);
  fn(j);
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(j, null, 2)}\n`);
  renameSync(tmp, file);
}

export function readSettings(scope: SettingsScope, ws?: Workspace): Record<string, unknown> {
  return readJson(settingsPath(scope, ws));
}

/** `claude` on PATH, for the "system Claude Code" option. */
export function systemClaude(): string | undefined {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' });
    const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return lines.find((l) => /\.exe$/i.test(l)) ?? lines.find((l) => existsSync(l));
  } catch {
    return undefined;
  }
}

const CREDENTIAL_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'];
/** Sent to an endpoint configured without a token. */
export const NO_TOKEN = 'no-token';

export function envCredentialVar(): string | undefined {
  return CREDENTIAL_VARS.find((k) => process.env[k]);
}

/** Endpoint tokens stay in the database and never go to the browser. */
import { load, save } from '../store';
let secrets = load<{ endpointKeys?: Record<string, string> }>('secrets', {});
export function endpointKey(id: string) {
  return secrets.endpointKeys?.[id] ?? '';
}
export function setEndpointKey(id: string, key: string | null) {
  const keys = { ...(secrets.endpointKeys ?? {}) };
  if (key) keys[id] = key;
  else delete keys[id];
  secrets = { ...secrets, endpointKeys: keys };
  save('secrets', () => secrets, 0);
}

/** A compatible endpoint a process should talk to, and the model it asks for. */
export interface EndpointTarget {
  url: string;
  key: string;
  model: string;
  /** Its context window in tokens, if set. */
  contextWindow?: number;
}

/**
 * Environment for a Claude Code process: ours plus the service (the Claude subscription login, or a
 * compatible endpoint with its model standing in for every Claude alias), user variables and
 * runtime switches.
 */
export function processEnv(endpoint?: EndpointTarget): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'code-agent/0.1.0' };
  const p = app.provider;
  const dir = configDirEnv();
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  else delete env.CLAUDE_CONFIG_DIR;
  if (!endpoint) {
    if (p.ignoreEnvKey) for (const k of CREDENTIAL_VARS) delete env[k];
  } else {
    for (const k of CREDENTIAL_VARS) delete env[k];
    env.ANTHROPIC_BASE_URL = endpoint.url;
    // Always a token of the endpoint's own: without one Claude Code falls back to the Claude login
    // in the config dir and sends that to the endpoint.
    env.ANTHROPIC_AUTH_TOKEN = endpoint.key || NO_TOKEN;
    // Built-in agents and helper calls ask for aliases (haiku, sonnet…): send them to the same model.
    for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) env[k] = endpoint.model;
    // claude.ai connectors need the claude.ai login, which an endpoint does not use.
    env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  }
  const mb = app.mcpBehavior;
  if (mb.claudeAiConnectors === false) env.ENABLE_CLAUDEAI_MCP_SERVERS = 'false';
  env.ENABLE_TOOL_SEARCH = mb.toolSearch === 'auto' ? 'auto' : mb.toolSearch === 'on' ? 'true' : 'false';
  if (mb.firstTurnWait) env.MCP_TIMEOUT = String(mb.firstTurnWait * 1000);
  const r = app.runtime;
  if (r.otel) {
    env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
    if (r.otelEndpoint) env.OTEL_EXPORTER_OTLP_ENDPOINT = r.otelEndpoint;
    env.OTEL_EXPORTER_OTLP_PROTOCOL = r.otelProtocol;
    if (r.otelMetrics) env.OTEL_METRICS_EXPORTER = 'otlp';
    if (r.otelLogs) env.OTEL_LOGS_EXPORTER = 'otlp';
    if (r.otelTraces) { env.OTEL_TRACES_EXPORTER = 'otlp'; env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = '1'; }
    if (r.otelPrompts) env.OTEL_LOG_USER_PROMPTS = '1';
    if (r.otelTools) env.OTEL_LOG_TOOL_DETAILS = '1';
  }
  for (const v of app.env) {
    const k = v.key.trim();
    // An endpoint's address and token are its own; the variables cannot point it elsewhere.
    if (k && !(endpoint && (CREDENTIAL_VARS.includes(k) || k === 'ANTHROPIC_BASE_URL'))) env[k] = v.value;
  }
  const bash = gitBash()?.path;
  if (bash) env[GIT_BASH_VAR] = bash;
  // The model's own window wins over a variable set for every process.
  if (endpoint?.contextWindow) env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(endpoint.contextWindow);
  return env;
}
