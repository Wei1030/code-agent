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

/** Claude Code's config directory as the provider settings choose it. */
export function configDir(): string {
  const p = app.provider;
  if (p.configDir === 'custom' && p.customDir.trim()) return p.customDir.trim();
  if (p.configDir === 'env' && process.env.CLAUDE_CONFIG_DIR) return process.env.CLAUDE_CONFIG_DIR;
  return path.join(os.homedir(), '.claude');
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

export function envCredentialVar(): string | undefined {
  return CREDENTIAL_VARS.find((k) => process.env[k]);
}

/** The compatible endpoint's token stays in the data directory and never goes to the browser. */
import { load, save } from '../store';
let secrets = load<{ compatibleKey?: string }>('secrets.json', {});
export function compatibleKey() {
  return secrets.compatibleKey ?? '';
}
export function setCompatibleKey(key: string) {
  secrets = { ...secrets, compatibleKey: key };
  save('secrets.json', () => secrets, 0);
}

/** Environment for a Claude Code process: ours plus the provider, user variables and runtime switches. */
export function processEnv(extra: Record<string, string> = {}): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_AGENT_SDK_CLIENT_APP: 'code-agent/0.1.0' };
  const p = app.provider;
  const dir = configDirEnv();
  if (dir) env.CLAUDE_CONFIG_DIR = dir;
  else delete env.CLAUDE_CONFIG_DIR;
  if (p.kind === 'subscription') {
    if (p.ignoreEnvKey) for (const k of CREDENTIAL_VARS) delete env[k];
  } else {
    for (const k of CREDENTIAL_VARS) delete env[k];
    if (p.compatibleUrl) env.ANTHROPIC_BASE_URL = p.compatibleUrl;
    if (compatibleKey()) env.ANTHROPIC_AUTH_TOKEN = compatibleKey();
    if (p.compatibleModel) {
      env.ANTHROPIC_MODEL = p.compatibleModel;
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = p.compatibleModel;
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = p.compatibleModel;
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = p.compatibleModel;
    }
  }
  const mb = app.mcpBehavior;
  env.ENABLE_TOOL_SEARCH = mb.toolSearch === 'auto' ? 'auto' : mb.toolSearch === 'on' ? 'true' : 'false';
  if (mb.firstTurnWait) env.MCP_TIMEOUT = String(mb.firstTurnWait * 1000);
  const r = app.runtime;
  if (r.otel) {
    env.CLAUDE_CODE_ENABLE_TELEMETRY = '1';
    if (r.otelEndpoint) env.OTEL_EXPORTER_OTLP_ENDPOINT = r.otelEndpoint;
    if (r.otelMetrics) env.OTEL_METRICS_EXPORTER = 'otlp';
    if (r.otelLogs) env.OTEL_LOGS_EXPORTER = 'otlp';
    if (r.otelTraces) { env.OTEL_TRACES_EXPORTER = 'otlp'; env.CLAUDE_CODE_ENHANCED_TELEMETRY_BETA = '1'; }
    if (r.otelPrompts) env.OTEL_LOG_USER_PROMPTS = '1';
    if (r.otelTools) env.OTEL_LOG_TOOL_DETAILS = '1';
  }
  for (const v of app.env) if (v.key.trim()) env[v.key.trim()] = v.value;
  return { ...env, ...extra };
}
