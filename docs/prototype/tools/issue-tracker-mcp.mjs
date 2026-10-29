// Demo MCP server (stdio, JSON-RPC by hand): an issue tracker whose create_issue asks the user for
// the priority through an elicitation, so the prototype can show that panel.
import { createInterface } from 'node:readline';

const issues = [
  { id: 'SHOP-41', title: '下单接口没有校验数量', status: 'open', priority: '高' },
  { id: 'SHOP-38', title: '取消已发货订单时报错信息不清楚', status: 'open', priority: '中' },
  { id: 'SHOP-35', title: '订单列表没有分页', status: 'in progress', priority: '中' },
];
const TOOLS = [
  { name: 'list_issues', description: 'List open issues of the shop project', inputSchema: { type: 'object', properties: { status: { type: 'string' } } } },
  { name: 'get_issue', description: 'Read one issue', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  { name: 'create_issue', description: 'Create an issue; asks the user for priority and assignee', inputSchema: { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } }, required: ['title'] } },
];

const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
const waiting = new Map();
let seq = 0;
const ask = (method, params) => new Promise((resolve) => { const id = `srv-${++seq}`; waiting.set(id, resolve); send({ id, method, params }); });
const text = (t) => ({ content: [{ type: 'text', text: t }] });

async function call(name, args) {
  if (name === 'list_issues') return text(issues.map((i) => `${i.id} [${i.priority}] ${i.title} (${i.status})`).join('\n'));
  if (name === 'get_issue') {
    const i = issues.find((x) => x.id === args.id);
    return i ? text(JSON.stringify(i, null, 2)) : { ...text(`no issue ${args.id}`), isError: true };
  }
  if (name === 'create_issue') {
    const r = await ask('elicitation/create', {
      message: `新建缺陷单「${args.title}」：选择优先级和负责人`,
      requestedSchema: {
        type: 'object',
        properties: {
          priority: { type: 'string', title: '优先级', enum: ['高', '中', '低'] },
          assignee: { type: 'string', title: '负责人', description: '用户名，留空表示暂不指派' },
          notify: { type: 'boolean', title: '通知负责人', default: true },
        },
        required: ['priority'],
      },
    });
    if (r?.action !== 'accept') return text('用户取消了创建');
    const id = `SHOP-${42 + issues.length - 3}`;
    issues.unshift({ id, title: args.title, status: 'open', priority: r.content.priority });
    return text(`已创建 ${id}（优先级 ${r.content.priority}${r.content.assignee ? `，负责人 ${r.content.assignee}` : ''}）`);
  }
  return { ...text(`unknown tool ${name}`), isError: true };
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.id !== undefined && !m.method) {
    waiting.get(m.id)?.(m.result);
    waiting.delete(m.id);
    return;
  }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'issue-tracker', version: '1.2.0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: TOOLS } });
  else if (m.method === 'tools/call') send({ id: m.id, result: await call(m.params.name, m.params.arguments ?? {}) });
  else if (m.method === 'ping') send({ id: m.id, result: {} });
  else if (m.id !== undefined) send({ id: m.id, error: { code: -32601, message: `no method ${m.method}` } });
});
