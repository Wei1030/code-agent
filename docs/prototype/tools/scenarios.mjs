// What the demo model answers. A scenario is picked by the latest user prompt of a request; its
// step is the number of assistant messages since that prompt. `{cwd}` is the session's working
// directory (read from Claude Code's system prompt).

let n = 0;
const id = () => `toolu_demo_${Date.now().toString(36)}_${++n}`;
export const say = (text) => ({ type: 'text', text });
export const think = (thinking) => ({ type: 'thinking', thinking, signature: 'demo' });
export const use = (name, input) => ({ type: 'tool_use', id: id(), name, input });
const read = (rel) => use('Read', { file_path: `{cwd}/${rel}` });
const task = (subject, activeForm) => use('TaskCreate', { subject, description: subject, activeForm });
const mark = (taskId, status) => use('TaskUpdate', { taskId, status });

const VALIDATE_OLD = 'function createOrder(input) {\n  const order =';
const VALIDATE_NEW = "function validateItems(items) {\n  if (!Array.isArray(items) || items.length === 0) throw new Error('items must not be empty');\n  for (const it of items) {\n    if (!(it.quantity > 0)) throw new Error('invalid item');\n    if (!(it.price >= 0)) throw new Error('invalid item');\n  }\n}\n\nfunction createOrder(input) {\n  validateItems(input.items);\n  const order =";
const TESTS_ANCHOR = "test('cancels a pending order', () => {";
const TESTS_NEW = "test('rejects an empty item list', () => {\n  assert.throws(() => createOrder({ userId: 'u1', items: [] }), /items must not be empty/);\n});\n\ntest('rejects a negative price or zero quantity', () => {\n  assert.throws(() => createOrder({ userId: 'u1', items: [{ sku: 'a', price: -1, quantity: 1 }] }), /invalid item/);\n  assert.throws(() => createOrder({ userId: 'u1', items: [{ sku: 'a', price: 100, quantity: 0 }] }), /invalid item/);\n});\n\n" + TESTS_ANCHOR;

/** Finding ids in the review messages Code Agent sends ("- F-1 [major] …"). */
const findingIds = (prompt) => [...prompt.matchAll(/^- (\S+) \[(blocker|major|minor)\]/gm)].map((m) => m[1]);

export const SCENARIOS = [
  // ---------------------------------------------------------------- P04: a finished piece of work
  {
    match: /加上校验和对应的测试/,
    steps: [
      [think('要给 createOrder 加校验：items 非空、quantity 正数、price 非负。先看实现和现有测试，确认错误是怎么抛的，测试用的是 node:test。'), say('我先看一下下单逻辑和现有测试。'), read('src/orders.js'), read('test/orders.test.js')],
      [task('在 createOrder 里校验 items、quantity、price', '正在添加校验'), task('补充校验失败的测试', '正在补测试'), task('运行 npm test', '正在运行测试')],
      [mark('1', 'in_progress'), say('在 `createOrder` 前加一个 `validateItems`：'), use('Edit', { file_path: '{cwd}/src/orders.js', old_string: VALIDATE_OLD, new_string: VALIDATE_NEW })],
      [mark('1', 'completed'), mark('2', 'in_progress'), use('Edit', { file_path: '{cwd}/test/orders.test.js', old_string: TESTS_ANCHOR, new_string: TESTS_NEW })],
      [mark('2', 'completed'), mark('3', 'in_progress'), use('Bash', { command: 'npm test', description: '运行测试' })],
      [mark('3', 'completed')],
      [say('已加上下单参数校验，测试全部通过（4 个）。\n\n**改动**\n- `src/orders.js`：新增 `validateItems`，在创建订单前检查：\n  - 商品列表不能为空\n  - `quantity` 必须大于 0\n  - `price` 不能为负\n- `test/orders.test.js`：补了空列表、负单价、数量为 0 三种情况的测试。\n\n```js\nfunction validateItems(items) {\n  if (!Array.isArray(items) || items.length === 0) throw new Error(\'items must not be empty\');\n  for (const it of items) {\n    if (!(it.quantity > 0)) throw new Error(\'invalid item\');\n    if (!(it.price >= 0)) throw new Error(\'invalid item\');\n  }\n}\n```\n\n接口返回的错误信息还是英文原文，前端要展示的话可以在 `docs/errors.md` 里加错误码。')],
    ],
  },
  // The author's answer to a review round.
  {
    match: /代码审核第 \d+ 轮打回/,
    steps: [
      [say('逐条处理审核意见。数量确实应该是整数：'), use('Edit', { file_path: '{cwd}/src/orders.js', old_string: "    if (!(it.quantity > 0)) throw new Error('invalid item');", new_string: "    if (!Number.isInteger(it.quantity) || it.quantity <= 0) throw new Error('invalid item');" })],
      [use('Edit', { file_path: '{cwd}/test/orders.test.js', old_string: TESTS_ANCHOR, new_string: "test('rejects a fractional quantity', () => {\n  assert.throws(() => createOrder({ userId: 'u1', items: [{ sku: 'a', price: 100, quantity: 2.5 }] }), /invalid item/);\n});\n\n" + TESTS_ANCHOR }), use('Bash', { command: 'npm test', description: '运行测试' })],
      [(prompt) => {
        const [a, b] = findingIds(prompt);
        return use('mcp__workspace__respond_findings', { answers: [
          ...(a ? [{ id: a, status: 'fixed', text: '改用 Number.isInteger，并补了 2.5 的测试' }] : []),
          ...(b ? [{ id: b, status: 'disputed', text: '错误码表 docs/errors.md 统一维护提示文案，接口层保持 invalid item 与现有约定一致' }] : []),
        ] });
      }],
      [say('两条意见都答复了：数量改为整数校验并补了测试；错误信息那条保留现状，理由已写明。')],
    ],
  },
  // ---------------------------------------------------------------- P06: an approval waits
  {
    match: /把 server\.js 改成 express/,
    steps: [[say('先装上 express 5，再改路由。'), use('Bash', { command: 'npm install express@5', description: '安装 express 5' })], [say('已安装。')]],
  },
  // ---------------------------------------------------------------- P07: a question waits
  {
    match: /帮我选个数据库方案/,
    steps: [
      [think('持久化方案取决于部署方式和并发量，用户没说。先问清楚再动手。'), use('AskUserQuestion', { questions: [
        { header: '数据库', question: '订单数据用哪种数据库？', multiSelect: false, options: [
          { label: 'SQLite', description: '单文件，部署最简单；并发写入有限' },
          { label: 'PostgreSQL', description: '功能全、并发好；需要单独部署' },
          { label: '先保持内存存储', description: '只抽出存储接口，以后再换' },
        ] },
        { header: '迁移', question: '现有的开发数据需要迁移吗？', multiSelect: false, options: [
          { label: '需要', description: '写一个一次性迁移脚本' },
          { label: '不需要', description: '开发数据可以丢弃' },
        ] },
      ] })],
      [say('好的，按你的选择来。')],
    ],
  },
  // ---------------------------------------------------------------- P08: a plan waits
  {
    match: /规划一下：把订单从内存存储迁到 SQLite/,
    steps: [
      [say('先看看存储层是怎么被用到的。'), use('Grep', { pattern: 'db\\.', path: '{cwd}/src', output_mode: 'content' }), read('src/db.js')],
      [use('ExitPlanMode', { plan: '# 订单迁移到 SQLite\n\n## 目标\n把 `src/db.js` 的内存存储换成 SQLite，接口（`nextId` / `insert` / `get` / `all`）保持不变，调用方不用改。\n\n## 步骤\n1. 引入 Node 内置的 `node:sqlite`，不加新依赖。\n2. 新建 `src/schema.sql`：`orders`、`order_items`、`users` 三张表，金额用整数（分）。\n3. 重写 `src/db.js`：启动时建表；`insert` / `get` / `all` 改为 SQL。\n4. `createOrder` 在一个事务里写订单和明细。\n5. 测试改用内存库 `:memory:`，每个用例前清表。\n6. 更新 `docs/api.md` 的部署说明。\n\n## 风险\n- `nextId` 现在是内存自增，改成数据库自增后 id 格式会变（`ord_1` → 数字），前端如果依赖格式需要同步。\n' })],
      [say('开始按计划实施。')],
    ],
  },
  // ---------------------------------------------------------------- P09: a subagent and a background task
  {
    match: /压测一下下单性能，同时梳理 src/,
    steps: [
      [say('压测放到后台跑，同时让 Explore 子代理梳理模块结构。'),
        use('Agent', { description: '梳理 src 模块结构', subagent_type: 'Explore', prompt: '梳理 src 目录：每个模块的职责、导出的函数和互相依赖，输出一张简表。' }),
        use('Bash', { command: 'npm run bench -- 300', description: '压测 createOrder（300 轮）', run_in_background: true })],
      [say('**src 模块结构**\n\n| 模块 | 职责 | 导出 | 依赖 |\n| --- | --- | --- | --- |\n| db.js | 内存存储 | nextId, insert, get, all | — |\n| orders.js | 订单 | createOrder, cancelOrder, listOrders | db |\n| users.js | 用户 | createUser | db |\n| server.js | HTTP 路由 | — | orders |\n\n压测在后台运行，大约 10 分钟；跑完我再汇总吞吐量。')],
    ],
  },
  {
    match: /梳理 src 目录：每个模块的职责/,
    steps: [
      [use('Glob', { pattern: 'src/**/*.js', path: '{cwd}' })],
      [read('src/db.js'), read('src/orders.js'), read('src/server.js')],
      [say('db.js 提供内存存储；orders.js 和 users.js 依赖 db；server.js 只用到 orders 的 createOrder / listOrders。')],
    ],
  },
  // ---------------------------------------------------------------- P04 running / P24: a long command
  {
    match: /跑一遍完整的回归测试/,
    steps: [[say('开始跑回归测试，大约需要 20 分钟。'), use('Bash', { command: 'node scripts/bench.js 600', description: '回归测试（完整）', timeout: 1800000 })], [say('回归测试完成。')]],
  },
  // ---------------------------------------------------------------- P28: peer sessions
  {
    match: /处理完了你的消息/,
    steps: [[say('「对接下单错误码」已经完成：`docs/api.md` 新增了「错误码」一节，列出了前端要处理的两种错误和提示文案。')]],
  },
  {
    match: /开一个会话在独立工作树里处理/,
    steps: [
      [say('好，开一个会话专门处理，放在独立的工作树里，不影响这里的改动。'), use('mcp__workspace__create_session', {
        title: '对接下单错误码',
        message: '在 docs/api.md 补充下单接口的错误码说明（items must not be empty / invalid item），并给出前端要展示的提示文案。改完回复我改了哪些文件。',
        worktree: true, notify: true,
      })],
      [say('已创建会话「对接下单错误码」，它处理完会给我回执。')],
    ],
  },
  {
    match: /在 docs\/api\.md 补充下单接口的错误码说明/,
    steps: [
      [read('docs/api.md')],
      [use('Edit', { file_path: '{cwd}/docs/api.md', old_string: '- `GET /orders?user=<id>` 某个用户的订单\n', new_string: '- `GET /orders?user=<id>` 某个用户的订单\n\n## 错误码\n\n| 错误 | 含义 | 前端提示 |\n| --- | --- | --- |\n| `items must not be empty` | 商品列表为空 | 请至少选择一件商品 |\n| `invalid item` | 数量或单价不合法 | 商品数量或价格有误，请刷新后重试 |\n' })],
      [say('已在 docs/api.md 增加「错误码」一节：两种错误、含义和前端提示文案。只改了这一个文件。')],
    ],
  },
  // ---------------------------------------------------------------- P14: an MCP elicitation waits
  {
    match: /记一个缺陷：导出 CSV/,
    steps: [
      [say('在缺陷系统里新建一条。'), use('mcp__issue-tracker__create_issue', { title: '导出 CSV 时金额单位错误', body: '订单导出的 total 列是「分」，表头写的是「元」。' })],
      [say('已创建缺陷单。')],
    ],
  },
  // ---------------------------------------------------------------- simple conversations for lists
  {
    match: /订单列表加分页/,
    steps: [[read('src/pages/Orders.tsx')], [say('订单页现在一次拉取全部订单，后端 `listOrders` 也没有分页参数。建议加 `cursor` 和 `limit` 两个参数，按 `createdAt` 倒序分页；需要的话我来改。')]],
  },
  {
    match: /退款审核页/,
    steps: [[say('退款审核页可以分三块：待审核列表（按申请时间）、订单详情侧栏、通过 / 驳回操作（驳回必须填原因）。要我先搭页面骨架吗？')]],
  },
  {
    match: /快速开始/,
    steps: [[read('guide/getting-started.md')], [say('快速开始缺少「创建订单」的请求示例，我可以补一段 curl 示例。')]],
  },
];

/** Structured answers of the reviewer, the board recorder, imports and jobs. */
export function structured(schema, prompt, step) {
  const props = schema?.properties ?? {};
  if (props.verdict) {
    const round = Number(/Review round (\d+)/.exec(prompt)?.[1] ?? 1);
    if (step === 0) return { blocks: [use('Bash', { command: 'git diff --stat', description: '查看改动' }), use('Read', { file_path: '{cwd}/src/orders.js' })] };
    if (round === 1) {
      return { output: { verdict: 'changes_requested', summary: '校验逻辑基本正确，但数量没有限制为整数；错误信息没有指出是哪个字段。', rulings: [], findings: [
        { severity: 'major', file: 'src/orders.js', line: 4, title: '数量允许小数', detail: 'quantity 只检查了大于 0，2.5 这样的值会通过并算出非整数金额。应使用 Number.isInteger。' },
        { severity: 'minor', file: 'src/orders.js', line: 2, title: '错误信息没有指明字段', detail: "抛出的错误只有 'invalid item'，调用方无法知道是数量还是单价不合法。" },
      ] } };
    }
    const ids = [...prompt.matchAll(/^- (\S+) \[(blocker|major|minor)\]/gm)].map((m) => m[1]);
    return { output: { verdict: 'pass', summary: '数量已改为整数校验并有测试覆盖；错误信息的异议成立。', findings: [], rulings: [
      ...(ids[0] ? [{ id: ids[0], status: 'verified', note: '已改为 Number.isInteger，新增 2.5 的测试' }] : []),
      ...(ids[1] ? [{ id: ids[1], status: 'upheld', note: '错误码表统一维护文案，接口层保持现状可以接受' }] : []),
    ] } };
  }
  if (props.operations) {
    if (/加上校验和对应的测试/.test(prompt) && !/代码审核/.test(prompt)) {
      return { output: { operations: [{ op: 'create', kind: 'feature', title: '下单接口参数校验', body: 'createOrder 校验商品列表非空、数量为正整数、单价非负；补充对应测试。', status: 'done', priority: 'high', tasks: ['校验 items / quantity / price', '补充失败用例的测试', '运行 npm test'], complete_tasks: ['校验 items / quantity / price', '补充失败用例的测试', '运行 npm test'], note: '记录已完成的功能：下单接口参数校验' }] } };
    }
    return { output: { operations: [] } };
  }
  if (props.rows) {
    const lines = [...prompt.matchAll(/^[-*] (.+)$/gm)].map((m) => m[1]).slice(0, 8);
    return { output: { rows: lines.map((l, i) => ({ ref: `第 ${i + 1} 行`, kind: /错|不|失败|慢|bug/i.test(l) ? 'issue' : 'feature', title: l.replace(/[。.]$/, ''), body: '', action: i === lines.length - 1 && lines.length > 2 ? 'skip' : 'create', reason: i === lines.length - 1 && lines.length > 2 ? '和第 1 行是同一件事' : '新条目' })) } };
  }
  if (props.risk || props.summary) {
    return { output: { summary: '本周合入 6 个提交：下单校验、错误码文档、用户接口重构。', risk: 'low', followups: ['订单列表分页', '导出 CSV 金额单位'] } };
  }
  return { output: null };
}
