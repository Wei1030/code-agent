// A test MCP server (stdio, JSON-RPC by hand): tools that ask the user through elicitations (a
// form, or a page to open), one with annotations, a prompt, and one that fails.
//   node tracker.mjs            FAIL_START=1 exits at once (a server that cannot start)
import { createInterface } from 'node:readline';

if (process.env.FAIL_START) {
  console.error('tracker: cannot start (FAIL_START)');
  process.exit(1);
}

const TOOLS = [
  { name: 'create_issue', description: 'Create an issue; asks the user for priority', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'login', description: 'Sign in through a web page', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_issues', description: 'List open issues', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } },
  { name: 'drop_all', description: 'Delete every issue', inputSchema: { type: 'object', properties: {} }, annotations: { destructiveHint: true } },
  { name: 'broken', description: 'Always fails', inputSchema: { type: 'object', properties: {} } },
];
const PROMPTS = [{ name: 'triage', description: 'Triage the open issues', arguments: [] }];

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const waiting = new Map();
let seq = 0;
const ask = (method, params) => new Promise((resolve) => { const id = `srv-${++seq}`; waiting.set(id, resolve); send({ id, method, params }); });
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });

async function call(name, args) {
  if (name === 'create_issue') {
    const r = await ask('elicitation/create', {
      message: `新建缺陷单「${args.title}」：选择优先级`,
      requestedSchema: {
        type: 'object',
        properties: {
          priority: { type: 'string', title: '优先级', enum: ['高', '中', '低'] },
          estimate: { type: 'number', title: '预估天数', minimum: 1, maximum: 10 },
          notify: { type: 'boolean', title: '通知负责人', default: true },
        },
        required: ['priority'],
      },
    });
    if (r?.action !== 'accept') return text(`没有创建（${r?.action}）`);
    return text(`已创建：优先级 ${r.content.priority}，预估 ${r.content.estimate ?? '-'} 天，通知 ${r.content.notify}`);
  }
  if (name === 'login') {
    const elicitationId = `el-${++seq}`;
    const r = await ask('elicitation/create', { mode: 'url', elicitationId, url: 'https://example.com/login?code=42', message: '打开页面登录缺陷系统' });
    if (r?.action !== 'accept') return text(`没有登录（${r?.action}）`);
    setTimeout(() => send({ method: 'notifications/elicitation/complete', params: { elicitationId } }), 300);
    return text('已登录');
  }
  if (name === 'list_issues') return text('BUG-1 下单失败\nBUG-2 列表慢');
  if (name === 'drop_all') return text('全部删除了');
  if (name === 'broken') return text('内部错误：数据库连不上', true);
  return text(`unknown tool ${name}`, true);
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
    return;
  }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'tracker', version: '1.0.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: TOOLS } });
  else if (m.method === 'prompts/list') send({ id: m.id, result: { prompts: PROMPTS } });
  else if (m.method === 'prompts/get') send({ id: m.id, result: { messages: [{ role: 'user', content: { type: 'text', text: '把未关闭的缺陷按严重程度排序' } }] } });
  else if (m.method === 'tools/call') send({ id: m.id, result: await call(m.params.name, m.params.arguments ?? {}) });
  else if (m.method === 'ping') send({ id: m.id, result: {} });
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
});
