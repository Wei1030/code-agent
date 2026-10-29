// A stand-in for an Anthropic-Messages-compatible endpoint that plays the scripts in scenarios.mjs,
// so the prototype is shot from the real app without a real model or account.
//   node docs/prototype/tools/demo-llm.mjs          (port DEMO_LLM_PORT, default 18090)
// Models whose name starts with "expired" answer 401, for the error states.
import http from 'node:http';
import { appendFileSync } from 'node:fs';
import { SCENARIOS, say, structured, use } from './scenarios.mjs';

const PORT = Number(process.env.DEMO_LLM_PORT ?? 18090);
const LOG = process.env.DEMO_LLM_LOG;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const textOf = (c) => (typeof c === 'string' ? c : (c ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n'));
const isPrompt = (m) => m.role === 'user' && !(Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')) && textOf(m.content).trim() !== '';

/** Claude Code states the working directory in an environment block of the first messages. */
function cwdOf(body) {
  const texts = [body.system, ...(body.messages ?? []).map((m) => m.content)].map((c) => (Array.isArray(c) ? c.map((b) => b.text ?? '').join('\n') : String(c ?? '')));
  for (const t of texts) {
    const m = /Primary working directory:\s*(.+)/.exec(t);
    if (m) return m[1].trim();
  }
  return process.cwd();
}

/** Put the session's directory into file paths, with its separators. */
function fill(v, cwd, key = '') {
  if (typeof v === 'string') {
    if (!v.includes('{cwd}')) return v;
    const s = v.replace('{cwd}', cwd);
    return cwd.includes('\\') && (key === 'file_path' || key === 'path') ? s.replace(/\//g, '\\') : s;
  }
  if (Array.isArray(v)) return v.map((x) => fill(x, cwd));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, cwd, k)]));
  return v;
}

function sample(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.enum) return s.enum[0];
  if (s.type === 'object') return Object.fromEntries((s.required ?? Object.keys(s.properties ?? {})).map((k) => [k, sample(s.properties?.[k])]));
  if (s.type === 'array') return [];
  if (s.type === 'string') return '示例';
  if (s.type === 'integer' || s.type === 'number') return 1;
  if (s.type === 'boolean') return true;
  return null;
}

/** The blocks to answer with. */
function answer(body) {
  const msgs = body.messages ?? [];
  let pi = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (isPrompt(msgs[i])) { pi = i; break; }
  const prompt = pi >= 0 ? textOf(msgs[pi].content) : '';
  const step = msgs.slice(pi + 1).filter((m) => m.role === 'assistant').length;
  const tools = body.tools ?? [];
  const so = tools.find((t) => t.name === 'StructuredOutput');
  if (so) {
    const lastAssistant = [...msgs].reverse().find((m) => m.role === 'assistant');
    if (Array.isArray(lastAssistant?.content) && lastAssistant.content.some((b) => b.type === 'tool_use' && b.name === 'StructuredOutput')) return [say('完成。')];
    const r = structured(so.input_schema, prompt, step);
    if (r.blocks) return r.blocks.map((b) => (b.name === 'Bash' && !tools.some((t) => t.name === 'Bash') ? { ...b, name: 'PowerShell' } : b));
    return [use('StructuredOutput', r.output ?? sample(so.input_schema))];
  }
  if (!tools.length) return [say('好的。')];
  const sc = SCENARIOS.find((s) => s.match.test(prompt));
  if (!sc) return [say('好的，我来处理。')];
  const blocks = sc.steps[step] ?? [say('完成。')];
  // Claude Code on Windows without Git Bash offers PowerShell instead of Bash.
  const shell = tools.some((t) => t.name === 'Bash') ? 'Bash' : 'PowerShell';
  return blocks.map((b) => (typeof b === 'function' ? b(prompt) : b)).map((b) => (b.name === 'Bash' ? { ...b, name: shell } : b));
}

async function respond(req, res, body) {
  const cwd = cwdOf(body);
  const blocks = fill(answer(body), cwd);
  const hasTool = blocks.some((b) => b.type === 'tool_use');
  const turns = (body.messages ?? []).filter((m) => m.role === 'assistant').length;
  const usage = { input_tokens: 1800 + turns * 650, cache_read_input_tokens: 9400 + turns * 2100, cache_creation_input_tokens: turns ? 600 : 9400, output_tokens: 80 + blocks.reduce((n, b) => n + JSON.stringify(b).length / 3, 0) | 0 };
  if (process.env.DEMO_LLM_DUMP) appendFileSync(process.env.DEMO_LLM_DUMP, JSON.stringify(body) + '\n');
  if (LOG) appendFileSync(LOG, JSON.stringify({ at: Date.now(), model: body.model, tools: (body.tools ?? []).length, cwd, answer: blocks.map((b) => b.name ?? b.type), toolNames: (body.tools ?? []).map((t) => t.name).filter((x) => !x.startsWith('mcp__')) }) + '\n');
  const msg = { id: `msg_demo_${Date.now()}`, type: 'message', role: 'assistant', model: body.model, stop_reason: null, stop_sequence: null, usage: { ...usage, output_tokens: 1 } };
  await sleep(500 + Math.random() * 700);
  if (!body.stream) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ...msg, content: blocks, stop_reason: hasTool ? 'tool_use' : 'end_turn', usage }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev('message_start', { message: { ...msg, content: [] } });
  for (const [index, b] of blocks.entries()) {
    if (b.type === 'thinking') {
      ev('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      const parts = b.thinking.match(/.{1,12}/gs) ?? [];
      for (const p of parts) { ev('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: p } }); await sleep(3500 / parts.length); }
      ev('content_block_delta', { index, delta: { type: 'signature_delta', signature: b.signature } });
    } else if (b.type === 'text') {
      ev('content_block_start', { index, content_block: { type: 'text', text: '' } });
      const parts = b.text.match(/.{1,24}/gs) ?? [];
      for (const p of parts) { ev('content_block_delta', { index, delta: { type: 'text_delta', text: p } }); await sleep(Math.min(40, 1500 / parts.length)); }
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

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* not JSON */ }
    if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
      res.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not here' } }));
      return;
    }
    if (req.url.startsWith('/v1/messages/count_tokens')) {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ input_tokens: 14200 }));
      return;
    }
    if (String(body.model).startsWith('expired')) {
      res.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'API key expired.' } }));
      return;
    }
    respond(req, res, body).catch((e) => { console.error(e); res.end(); });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`demo model on http://127.0.0.1:${PORT}`));
