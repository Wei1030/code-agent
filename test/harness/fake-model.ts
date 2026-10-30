/**
 * A scripted stand-in for an Anthropic-Messages-compatible endpoint. Tests register what the model
 * answers to a prompt (`script`), one step per assistant message since that prompt, and read back
 * every request Claude Code sent (`requests`). Faults (HTTP errors, a hanging or cut stream) are steps too.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export type Fault =
  | { fault: 'http'; status: number; errorType: string; message?: string; headers?: Record<string, string> }
  | { fault: 'hang' }
  | { fault: 'cut' };

export interface Req {
  at: number;
  body: any;
  headers: http.IncomingHttpHeaders;
  model: string;
  /** The latest user prompt (not a tool result). */
  prompt: string;
  /** Assistant messages since that prompt. */
  step: number;
  tools: string[];
  system: string;
}

/** A step: blocks, a fault, or a function of the request giving either. */
export type Step = Block[] | Fault | ((req: Req) => Block[] | Fault);

interface Script {
  match: (req: Req) => boolean;
  steps: Step[];
  /** Stream text and thinking slowly, ms per chunk. */
  slow?: number;
}

let n = 0;
export const say = (text: string): Block => ({ type: 'text', text });
export const think = (thinking: string): Block => ({ type: 'thinking', thinking, signature: 'test' });
export const use = (name: string, input: Record<string, unknown>): Block => ({ type: 'tool_use', id: `toolu_t${Date.now().toString(36)}${++n}`, name, input });
/** A shell command with the shell this Claude Code offers (Bash, or PowerShell on Windows without Git Bash). */
export const shell = (command: string, extra: Record<string, unknown> = {}) => (r: Req): Block[] =>
  [use(r.tools.includes('Bash') ? 'Bash' : 'PowerShell', { command, description: command.slice(0, 40), ...extra })];
/** Where Claude Code wants the plan written in plan mode (named in its system prompt). */
export const planFile = (r: Req) => /create your plan at ([^\s"]+\.md)/.exec(JSON.stringify(r.body).replace(/\\\\/g, '\\'))?.[1] ?? '';
/** Two steps, as a model plans: write the plan file, then ExitPlanMode (Claude Code reads the file). */
export const plan = (markdown: string): Step[] => [(r) => [use('Write', { file_path: planFile(r), content: markdown })], [use('ExitPlanMode', {})]];
/** A command that runs for a while (works in Bash and PowerShell). */
export const sleepCmd = (seconds: number) => `node -e "setTimeout(() => {}, ${seconds * 1000})"`;
export const httpError = (status: number, errorType: string, message?: string, headers?: Record<string, string>): Fault => ({ fault: 'http', status, errorType, message, headers });
export const hang: Fault = { fault: 'hang' };
export const cut: Fault = { fault: 'cut' };

/** What the user wrote in a message: text blocks other than Claude Code's own (reminders, notes, ToolSearch's "Tool loaded.", a skill's text). */
const NOT_TYPED = /^\s*(<system-reminder>|\[Request interrupted|Tool loaded\.$|Base directory for this skill:)/;
const textOf = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b?.type === 'text' && !NOT_TYPED.test(b.text)).map((b) => b.text).join('\n') : '');
/** A user message with something the user wrote (also next to tool results: a message put into the turn). */
const isPrompt = (m: any) => m.role === 'user' && textOf(m.content).trim() !== '';

/** Claude Code names the working directory in the environment block of its prompt. */
function cwdOf(body: any): string {
  for (const c of [body.system, ...(body.messages ?? []).map((m: any) => m.content)]) {
    const t = Array.isArray(c) ? c.map((b: any) => b.text ?? '').join('\n') : String(c ?? '');
    const m = /Primary working directory:\s*(.+)/.exec(t);
    if (m) return m[1].trim();
  }
  return process.cwd();
}

/** `{cwd}` in tool input becomes the session's directory, with its separators in paths. */
function fill(v: unknown, cwd: string, key = ''): unknown {
  if (typeof v === 'string') {
    if (!v.includes('{cwd}')) return v;
    const s = v.replace('{cwd}', cwd);
    return cwd.includes('\\') && (key === 'file_path' || key === 'path' || key === 'notebook_path') ? s.replace(/\//g, '\\') : s;
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, cwd));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, cwd, k)]));
  return v;
}

/** The smallest value a JSON schema accepts, for structured output nobody scripted. */
function sample(s: any): unknown {
  if (!s || typeof s !== 'object') return null;
  if (s.enum) return s.enum[0];
  if (s.type === 'object') return Object.fromEntries((s.required ?? Object.keys(s.properties ?? {})).map((k: string) => [k, sample(s.properties?.[k])]));
  if (s.type === 'array') return [];
  if (s.type === 'string') return 'x';
  if (s.type === 'integer' || s.type === 'number') return 1;
  if (s.type === 'boolean') return true;
  return null;
}

export class FakeModel {
  readonly requests: Req[] = [];
  private scripts: Script[] = [];
  private structuredFns: Array<(schema: any, req: Req) => { output?: unknown; blocks?: Block[] } | undefined> = [];
  private failing = new Map<string, Fault>();
  private open = new Set<http.ServerResponse>();
  private server!: http.Server;
  url = '';

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
    return this;
  }

  async close() {
    for (const r of this.open) r.destroy();
    await new Promise((r) => this.server.close(r));
  }

  /** What the model does after a prompt matching `match` (newest scripts win). */
  script(match: RegExp | ((req: Req) => boolean), steps: Step[], opts: { slow?: number } = {}) {
    const fn = match instanceof RegExp ? (r: Req) => match.test(r.prompt) : match;
    this.scripts.unshift({ match: fn, steps, slow: opts.slow });
  }

  /** Answers to requests that ask for structured output (jobs, reviewer, board recorder, import). */
  structured(fn: (schema: any, req: Req) => { output?: unknown; blocks?: Block[] } | undefined) {
    this.structuredFns.unshift(fn);
  }

  /** Every request for this model name fails like this (until cleared with null). */
  failModel(model: string, f: Fault | null) {
    if (f) this.failing.set(model, f);
    else this.failing.delete(model);
  }

  /** Requests of the agent loop (with tools; not title or summary requests) whose latest prompt matches. */
  sent(match: RegExp): Req[] {
    return this.requests.filter((r) => r.tools.length > 0 && match.test(r.prompt));
  }

  private parse(body: any, headers: http.IncomingHttpHeaders): Req {
    const msgs = body.messages ?? [];
    let pi = -1;
    for (let i = msgs.length - 1; i >= 0; i--) if (isPrompt(msgs[i])) { pi = i; break; }
    const system = Array.isArray(body.system) ? body.system.map((b: any) => b.text ?? '').join('\n') : String(body.system ?? '');
    return {
      at: Date.now(), body, headers, model: String(body.model ?? ''),
      prompt: pi >= 0 ? textOf(msgs[pi].content) : '',
      step: msgs.slice(pi + 1).filter((m: any) => m.role === 'assistant').length,
      tools: (body.tools ?? []).map((t: any) => t.name),
      system,
    };
  }

  private answer(r: Req): { blocks: Block[] | Fault; slow?: number } {
    const fail = this.failing.get(r.model);
    if (fail) return { blocks: fail };
    const so = (r.body.tools ?? []).find((t: any) => t.name === 'StructuredOutput');
    const sc = this.scripts.find((s) => s.match(r));
    if (so) {
      // Done once Claude Code took the structured output; after a rejected one, answer again.
      const msgs = r.body.messages ?? [];
      const last = [...msgs].reverse().find((m: any) => m.role === 'assistant');
      const result = msgs.at(-1)?.content;
      const rejected = Array.isArray(result) && result.some((b: any) => b.type === 'tool_result' && b.is_error);
      if (Array.isArray(last?.content) && last.content.some((b: any) => b.type === 'tool_use' && b.name === 'StructuredOutput') && !rejected) return { blocks: [say('完成。')] };
      for (const f of this.structuredFns) {
        const out = f(so.input_schema, r);
        if (out?.blocks) return { blocks: out.blocks };
        if (out && 'output' in out) return { blocks: [use('StructuredOutput', out.output as Record<string, unknown>)] };
      }
      // A scripted run (a job doing work first) goes through its steps.
      if (!sc || r.step >= sc.steps.length) return { blocks: [use('StructuredOutput', sample(so.input_schema) as Record<string, unknown>)] };
    }
    if (!r.tools.length) return { blocks: [say('好的。')] };
    if (!sc) return { blocks: [say('好的。')] };
    const step = sc.steps[r.step] ?? [say('完成。')];
    return { blocks: typeof step === 'function' ? step(r) : step, slow: sc.slow };
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body: any = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages')) {
        res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not here' } }));
        return;
      }
      if (req.url.startsWith('/v1/messages/count_tokens')) {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: 14200 }));
        return;
      }
      const r = this.parse(body, req.headers);
      this.requests.push(r);
      const { blocks, slow } = this.answer(r);
      void this.respond(res, r, blocks, slow ?? 0).catch(() => res.destroy());
    });
  }

  private async respond(res: http.ServerResponse, r: Req, answer: Block[] | Fault, slow: number) {
    if (!Array.isArray(answer)) {
      if (answer.fault === 'http') {
        res.writeHead(answer.status, { 'content-type': 'application/json', ...answer.headers }).end(JSON.stringify({ type: 'error', error: { type: answer.errorType, message: answer.message ?? answer.errorType } }));
        return;
      }
      if (answer.fault === 'hang') {
        this.open.add(res);
        res.on('close', () => this.open.delete(res));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return;
      }
      res.destroy();
      return;
    }
    // Fresh tool ids every time: a script can be played in several sessions, or twice in one.
    const blocks = (fill(answer, cwdOf(r.body)) as Block[]).map((b) => (b.type === 'tool_use' ? { ...b, id: `toolu_t${Date.now().toString(36)}${++n}` } : b));
    const hasTool = blocks.some((b) => b.type === 'tool_use');
    const turns = (r.body.messages ?? []).filter((m: any) => m.role === 'assistant').length;
    const usage = { input_tokens: 1000 + turns * 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 20 + blocks.reduce((k, b) => k + Math.ceil(JSON.stringify(b).length / 4), 0) };
    const msg = { id: `msg_t${Date.now()}`, type: 'message', role: 'assistant', model: r.model, stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } };
    if (!r.body.stream) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...msg, content: blocks, stop_reason: hasTool ? 'tool_use' : 'end_turn', usage }));
      return;
    }
    this.open.add(res);
    res.on('close', () => this.open.delete(res));
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    const ev = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    const pause = (ms: number) => (ms ? new Promise((x) => setTimeout(x, ms)) : Promise.resolve());
    ev('message_start', { message: { ...msg, content: [] } });
    for (const [index, b] of blocks.entries()) {
      if (res.destroyed) return;
      if (b.type === 'thinking') {
        ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
        for (const p of b.thinking.match(/[\s\S]{1,16}/g) ?? []) { ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: p } }); await pause(slow); }
        ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: b.signature } });
      } else if (b.type === 'text') {
        ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
        for (const p of b.text.match(/[\s\S]{1,24}/g) ?? []) { ev('content_block_delta', { index, delta: { type: 'text_delta', text: p } }); await pause(slow); }
      } else {
        ev('content_block_start', { index, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } });
        ev('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } });
      }
      ev('content_block_stop', { index });
    }
    ev('message_delta', { delta: { stop_reason: hasTool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: usage.output_tokens } });
    ev('message_stop', {});
    res.end();
  }
}
