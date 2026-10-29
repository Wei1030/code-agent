/** Where Code Agent keeps its own data. Claude Code's files are found through ./claude/files. */
import os from 'node:os';
import path from 'node:path';
import { mkdirSync } from 'node:fs';

export const HOME = process.env.CODE_AGENT_HOME ?? path.join(os.homedir(), '.code-agent');
export const WORKTREES_DIR = path.join(HOME, 'worktrees');
export const LOGS_DIR = path.join(HOME, 'logs');

for (const d of [HOME, WORKTREES_DIR, LOGS_DIR]) mkdirSync(d, { recursive: true });

/** The port asked for; start.ts may move it to a free one before the server loads. */
export let PORT = Number(process.env.CODE_AGENT_PORT ?? 5180);
export function setPort(port: number) {
  PORT = port;
}
/** Sent with every HTTP response, so a second start can tell this server runs on the same data. */
export const HOME_TAG = encodeURIComponent(HOME);
export const HOST = '127.0.0.1';
export const DEV = process.argv.includes('--dev');
export const VERSION = '0.1.0';
