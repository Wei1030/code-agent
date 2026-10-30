// The demo world the prototype is shot in: three small git repositories and the Claude Code config
// of the world's home (settings, user skills, a subagent, two MCP servers — one is
// issue-tracker-mcp.mjs, which asks for input through an elicitation). Nothing outside it is touched.
import path from 'node:path';
import { copyFileSync } from 'node:fs';
import { makeWorld, type World } from '../../../test/harness/world';

const here = import.meta.dirname;

export function demoWorld(root: string): World & { repos: Record<string, string> } {
  const w = makeWorld(root);
  const repos: Record<string, string> = {};
  const repo = (name: string, commits: Array<[string, Record<string, string | object>]>) => {
    const dir = w.repo(name, commits[0][1]);
    for (const [msg, files] of commits.slice(1)) {
      for (const [rel, c] of Object.entries(files)) w.write(path.join(dir, rel), c);
      w.git(dir, 'add', '-A');
      w.git(dir, 'commit', '-q', '-m', msg);
    }
    repos[name] = dir;
  };

  repo('shop-api', [
    ['Initial orders API', {
      'package.json': { name: 'shop-api', version: '0.4.0', private: true, scripts: { test: 'node --test', dev: 'node src/server.js', bench: 'node scripts/bench.js' } },
      'README.md': '# shop-api\n\n小型电商后端：用户、商品、订单。`npm run dev` 启动，`npm test` 跑测试。\n',
      'CLAUDE.md': '# shop-api 约定\n\n- Node 22，CommonJS，不引入新的运行时依赖。\n- 金额一律用「分」为单位的整数。\n- 改了接口就同步更新 docs/api.md 和测试。\n- 提交前跑 `npm test`。\n',
      'src/db.js': "// A tiny in-memory store standing in for the database.\nconst tables = new Map();\nlet seq = 0;\n\nfunction table(name) {\n  if (!tables.has(name)) tables.set(name, new Map());\n  return tables.get(name);\n}\n\nmodule.exports = {\n  nextId: (name) => `${name.slice(0, 3)}_${++seq}`,\n  insert: (name, row) => table(name).set(row.id, row),\n  get: (name, id) => table(name).get(id),\n  all: (name) => [...table(name).values()],\n};\n",
      'src/orders.js': "// Orders: create, cancel and list.\nconst db = require('./db');\n\nfunction createOrder(input) {\n  const order = { id: db.nextId('orders'), userId: input.userId, items: input.items, status: 'pending', createdAt: Date.now() };\n  order.total = input.items.reduce((sum, it) => sum + it.price * it.quantity, 0);\n  db.insert('orders', order);\n  return order;\n}\n\nfunction cancelOrder(id) {\n  const order = db.get('orders', id);\n  if (!order) throw new Error('order not found');\n  if (order.status === 'shipped') throw new Error('cannot cancel a shipped order');\n  order.status = 'cancelled';\n  return order;\n}\n\nfunction listOrders(userId) {\n  return db.all('orders').filter((o) => o.userId === userId);\n}\n\nmodule.exports = { createOrder, cancelOrder, listOrders };\n",
      'src/users.js': "const db = require('./db');\n\nfunction createUser({ name, email }) {\n  const user = { id: db.nextId('users'), name, email };\n  db.insert('users', user);\n  return user;\n}\n\nmodule.exports = { createUser };\n",
      'src/server.js': "const http = require('node:http');\nconst { createOrder, listOrders } = require('./orders');\n\nhttp.createServer((req, res) => {\n  if (req.method === 'POST' && req.url === '/orders') {\n    let body = '';\n    req.on('data', (c) => (body += c));\n    req.on('end', () => {\n      const order = createOrder(JSON.parse(body));\n      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify(order));\n    });\n    return;\n  }\n  if (req.method === 'GET' && req.url.startsWith('/orders?user=')) {\n    res.end(JSON.stringify(listOrders(req.url.split('=')[1])));\n    return;\n  }\n  res.writeHead(404).end();\n}).listen(3000);\n",
      'test/orders.test.js': "const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { createOrder, cancelOrder } = require('../src/orders');\n\ntest('creates an order with its total', () => {\n  const o = createOrder({ userId: 'u1', items: [{ sku: 'a', price: 1200, quantity: 2 }] });\n  assert.equal(o.total, 2400);\n  assert.equal(o.status, 'pending');\n});\n\ntest('cancels a pending order', () => {\n  const o = createOrder({ userId: 'u1', items: [{ sku: 'a', price: 500, quantity: 1 }] });\n  assert.equal(cancelOrder(o.id).status, 'cancelled');\n});\n",
      'scripts/bench.js': "// Load test of createOrder: prints progress every 2 seconds.\nconst { createOrder } = require('../src/orders');\nconst rounds = Number(process.argv[2] ?? 300);\nlet i = 0;\nconst t = setInterval(() => {\n  const t0 = performance.now();\n  for (let k = 0; k < 20000; k++) createOrder({ userId: 'u', items: [{ sku: 'a', price: 100, quantity: 1 }] });\n  console.log(`round ${++i}/${rounds}: ${(20000 / ((performance.now() - t0) / 1000)).toFixed(0)} orders/s`);\n  if (i >= rounds) clearInterval(t);\n}, 2000);\n",
      'docs/api.md': '# API\n\n- `POST /orders` 创建订单：`{ userId, items: [{ sku, price, quantity }] }`\n- `GET /orders?user=<id>` 某个用户的订单\n',
      '.claude/skills/api-review/SKILL.md': '---\nname: api-review\ndescription: 检查接口改动是否同步了 docs/api.md、测试和错误码表\n---\n\n# 接口改动检查\n\n1. 对照 `git diff` 找出改动的路由。\n2. 确认 docs/api.md 已更新。\n3. 确认每个新错误分支都有测试。\n',
      '.claude/commands/changelog.md': '---\ndescription: 根据最近的提交生成更新日志\n---\n\n读取 `git log --oneline -20`，按 新功能 / 修复 / 其他 分组写出更新日志。\n',
      '.gitignore': 'node_modules\n.env\n.claude/settings.local.json\n',
    }],
    ['Add users and docs', { 'docs/errors.md': '# 错误码\n\n| 码 | 含义 |\n| --- | --- |\n| ORDER_NOT_FOUND | 订单不存在 |\n' }],
  ]);
  // A picture in the repository, for the chat's pictures (P05g).
  copyFileSync(path.join(here, '..', 'shots', 'P12.webp'), path.join(repos['shop-api'], 'docs', 'ui-sessions.webp'));
  w.git(repos['shop-api'], 'add', '-A');
  w.git(repos['shop-api'], 'commit', '-q', '-m', 'Add a UI screenshot');
  repo('web-console', [['Admin console skeleton', {
    'package.json': { name: 'web-console', version: '0.2.0', private: true, scripts: { dev: 'vite', build: 'vite build', test: 'vitest run' } },
    'README.md': '# web-console\n\n运营后台：订单查询、退款审核。\n',
    'src/App.tsx': "export function App() {\n  return <main><h1>运营后台</h1></main>;\n}\n",
    'src/pages/Orders.tsx': "export function Orders() {\n  return <section>订单列表</section>;\n}\n",
  }]]);
  repo('docs-site', [['Docs site', {
    'README.md': '# docs-site\n\n对外文档站（Markdown）。\n',
    'guide/getting-started.md': '# 快速开始\n\n1. 申请 API 密钥\n2. 创建第一个订单\n',
  }]]);

  // Notes outside the workspaces, for reads Claude Code asks about.
  w.write('notes/order-design.md', '# 下单设计稿\n\n- 商品列表不能为空\n- 金额用分\n');
  w.write('notes/api-conventions.md', '# 接口约定\n\n- 错误用英文短语，前端按错误码表翻译\n');

  // shop-api's own rules, as Code Agent keeps them for a workspace (not committed).
  w.write(path.join(repos['shop-api'], '.claude', 'settings.local.json'), { permissions: { allow: ['Bash(npm test)', 'PowerShell(npm test)', 'Bash(npm run bench *)', 'PowerShell(npm run bench *)', 'Bash(node scripts/bench.js *)', 'PowerShell(node scripts/bench.js *)', 'mcp__issue-tracker'], deny: ['Read(./.env)'] } });
  w.write(path.join(w.config, 'settings.json'), {
    permissions: { allow: ['Bash(git log *)', 'WebFetch(domain:nodejs.org)'], deny: ['Bash(rm -rf *)'] },
    hooks: { PostToolUse: [{ matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'git diff --stat' }] }] },
  });
  w.write(path.join(w.config, 'CLAUDE.md'), '# 我的习惯\n\n- 回答用简体中文，代码和提交信息用英文。\n- 先读再改；改完跑测试。\n');
  w.write(path.join(w.config, 'skills/commit-message/SKILL.md'), '---\nname: commit-message\ndescription: 按团队格式写提交信息（英文祈使句，正文说明原因）\n---\n\n# 提交信息\n\n- 标题不超过 60 个字符，祈使句。\n- 正文写为什么改，而不是改了什么。\n');
  w.write(path.join(w.config, 'agents/test-writer.md'), '---\nname: test-writer\ndescription: 为指定模块补测试；只写 test/ 下的文件\ntools: Read, Grep, Glob, Write, Bash\nmodel: inherit\n---\n\n你只负责写测试。先读被测模块，再按边界值、错误分支、正常路径补 node:test 用例，最后跑 `npm test`。\n');
  w.mcp('issue-tracker', { type: 'stdio', command: 'node', args: [path.join(here, 'issue-tracker-mcp.mjs').split(path.sep).join('/')] });
  w.mcp('docs-search', { type: 'http', url: 'http://127.0.0.1:18099/mcp' });
  return { ...w, repos };
}
