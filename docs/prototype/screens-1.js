/* Screens P01–P08: overview, home, new session, live session and its docked panels. */
(function () {
  'use strict';
  const K = window.K;
  const { C, t, rect, line, path, circle, box, arrow, btn, chip, status, input, select, textarea, toggle, check,
    radio, panel, hline, vline, mk, code, diff, overlay, tabs, seg, progress, kbd, para, ic, tw, kv, runs, L } = K;

  // ------------------------------------------------------------------ P01
  window.SCREENS.push({
    id: 'P01',
    group: '总览',
    title: '架构与导航地图',
    summary: '各部分如何协作：浏览器只与本机 Node 服务通信；服务为每个运行中的会话调用一次 SDK 的 `query()`，背后各有一个 Claude Code 进程。下半部分的导航地图列出交互稿中的所有页面及其位置。',
    frs: ['§4.1 架构', '§7 信息架构', 'NFR-02', 'NFR-04'],
    draw() {
      let s = rect(0, 0, 1440, 900, { fill: C.page });
      s += t(40, 46, '运行时架构', { s: 18, w: 700 });

      s += rect(40, 66, 330, 330, { r: 12, fill: C.surface, stroke: C.border });
      s += t(60, 94, '浏览器 · 单页应用', { s: 14, w: 700 });
      s += box(60, 112, 290, 56, '视图', '由 SDK 事件渲染界面');
      s += box(60, 180, 290, 56, '会话状态', '每个运行中的会话一份');
      s += box(60, 248, 290, 56, 'WebSocket 客户端', '发出命令 · 接收带序号的事件');
      s += rect(60, 318, 290, 58, { r: 8, fill: C.surface2, stroke: C.border, dash: '4 3' });
      s += t(205, 342, '不含 SDK，不接触凭据', { s: 12.5, w: 600, a: 'middle', c: C.ink2 });
      s += t(205, 360, '一切经由本机服务', { s: 11, a: 'middle', c: C.muted });

      s += rect(450, 66, 560, 330, { r: 12, fill: C.surface, stroke: C.border });
      s += t(470, 94, 'Node.js 服务 · 127.0.0.1 + 访问令牌', { s: 14, w: 700 });
      s += box(470, 112, 160, 70, 'REST API', ['历史 · 注册表', '设置 · 用量']);
      s += box(470, 194, 160, 70, 'WebSocket 中枢', ['分发到各标签页', '按序号重放']);
      s += box(470, 276, 160, 100, '注册表', ['配置方案 · MCP', '代理 · 钩子 · 作业', '费用账本 · 密钥']);
      s += rect(650, 112, 340, 264, { r: 10, fill: C.accentSoft, stroke: C.accentLine });
      s += t(666, 134, 'SessionManager → LiveSession × N', { s: 13, w: 700, c: C.accent });
      s += box(666, 148, 150, 52, 'Query', 'query() 句柄');
      s += box(826, 148, 150, 52, '输入队列', 'AsyncIterable 输入');
      s += box(666, 210, 150, 52, '待处理请求', '审批 · 提问');
      s += box(826, 210, 150, 52, '事件缓冲', '环形缓冲 · 序号');
      s += box(666, 272, 310, 52, '回调', 'canUseTool · hooks · onElicitation · 应用工具');
      s += t(666, 346, '控制：interrupt · setModel · setPermissionMode', { s: 11, c: C.ink2 });
      s += t(666, 362, 'applyFlagSettings · rewindFiles · stopTask · close', { s: 11, c: C.ink2 });

      s += box(1090, 66, 310, 104, 'Claude Code 进程 × N', ['未修改的官方二进制，每个会话一个', 'Agent 循环 · 内置工具 · MCP 客户端'], { fill: C.surface, sw: 1.5 });
      s += box(1090, 192, 310, 52, '模型服务', 'Claude 订阅 · Anthropic API · 云厂商');
      s += box(1090, 258, 310, 52, 'MCP 服务器', 'stdio · HTTP · SSE（另有 SDK 进程内）');
      s += box(1090, 336, 150, 60, '~/.claude', ['会话记录 · 设置', '登录凭据 · 技能'], { fill: C.surface2 });
      s += box(1250, 336, 150, 60, '~/.code-agent', ['SQLite · 配置方案', '密钥 · 费用账本'], { fill: C.surface2 });

      s += arrow(372, 196, 448, 196);
      s += arrow(448, 222, 372, 222);
      s += t(410, 188, 'REST', { s: 11, a: 'middle', c: C.ink2 });
      s += t(410, 240, 'WS', { s: 11, a: 'middle', c: C.ink2 });
      s += arrow(992, 160, 1088, 118);
      s += arrow(1088, 140, 992, 182);
      s += t(1040, 118, 'stdio', { s: 11, a: 'middle', c: C.ink2 });
      s += arrow(1245, 172, 1245, 190);
      s += path('M1402 120 H1420 V284 H1404', { c: C.ink2, sw: 1.4, arrow: true });
      s += mk(368, 70, 1) + mk(1008, 70, 2) + mk(988, 116, 3) + mk(1398, 70, 4) + mk(1398, 340, 5);

      s += t(40, 452, '导航地图', { s: 18, w: 700 });
      s += box(560, 468, 320, 46, '应用框架', '顶栏 · 导航栏 · 审批收件箱', { fill: C.ink, ink: '#fff', stroke: C.ink, subInk: '#c3c8d2' });
      const nav = [
        ['会话', ['P02 首页', 'P03 新建会话', 'P04 运行中的会话', 'P12 历史与分叉']],
        ['代理', ['P15 代理']],
        ['MCP', ['P13 MCP 服务器', 'P14 信息征询']],
        ['技能', ['P16 技能与插件']],
        ['钩子', ['P17 钩子']],
        ['作业', ['P18 结构化作业']],
        ['用量', ['P19 用量']],
        ['设置', ['P20 配置方案', 'P21 规则与沙箱', 'P22 模型服务与环境', 'P25 语言与地区']],
      ];
      nav.forEach(([name, kids], i) => {
        const x = 40 + i * 170;
        const cx = x + 79;
        s += path(`M720 514 V530 H${cx} V546`, { c: C.borderStrong, sw: 1.2 });
        s += box(x, 546, 158, 38, name, null, { fill: C.surface, sw: 1.5 });
        kids.forEach((k, j) => {
          const y = 596 + j * 32;
          s += rect(x, y, 158, 26, { r: 6, fill: C.surface, stroke: C.border });
          s += t(x + 10, y + 17.5, k, { s: 12, c: C.ink });
        });
      });
      s += rect(40, 660, 158, 26, { r: 6, fill: C.accentSoft, stroke: C.accentLine });
      s += t(50, 677.5, 'P04 运行中的会话', { s: 12, w: 600, c: C.accent });
      s += path('M119 718 V748', { c: C.accent, sw: 1.4, arrow: true });
      s += rect(40, 752, 1348, 120, { r: 10, fill: C.surface, stroke: C.accentLine, dash: '5 4' });
      s += t(60, 778, '运行中的会话内部（P04）：停靠面板与检查器标签页', { s: 13, w: 700, c: C.accent });
      const docked = ['P05 输入框、命令面板与排队', 'P06 工具审批', 'P07 澄清提问', 'P08 计划审阅', 'P09 子代理与后台任务',
        'P10 检查点与回退', 'P11 上下文与费用', 'P14 MCP 信息征询', 'P23 事件检查器', 'P24 会话状态'];
      docked.forEach((d, i) => {
        const x = 60 + (i % 5) * 264;
        const y = 792 + Math.floor(i / 5) * 36;
        s += rect(x, y, 250, 28, { r: 6, fill: C.surface2, stroke: C.border });
        s += t(x + 10, y + 18.5, d, { s: 12, c: C.ink });
      });
      s += mk(888, 470, 6) + mk(1384, 756, 7);
      return s;
    },
    notes: [
      ['浏览器应用', '所有页面都由标准化后的 SDK 事件渲染。每个运行中的会话一份状态；断线后自动重连，并从最后收到的序号之后重放事件。', '不直接使用 SDK —— 浏览器不引入 SDK，也接触不到任何凭据（NFR-04）。'],
      ['Node 服务', '本机单进程，只监听 127.0.0.1，首次启动时生成访问令牌。REST 提供历史与各类注册表；WebSocket 承载会话事件和命令。', 'REST 背后是 `listSessions`、`getSessionMessages`、`forkSession`、`renameSession`、`tagSession`、`deleteSession`、`resolveSettings`'],
      ['LiveSession', '每个运行中的会话一个：持有 `Query`、为流式输入供数的输入队列、按 `requestId` 索引的待处理审批/提问/征询，以及用于重放的事件环形缓冲。', '`query({ prompt: AsyncIterable<SDKUserMessage>, options })`、`canUseTool`、`hooks`、`onElicitation`、`interrupt()`、`setModel()`、`setPermissionMode()`…'],
      ['Claude Code 进程', 'SDK 为每个会话启动一个未修改的官方 Claude Code 二进制（约 250 MB），所以服务端限制同时运行的会话数，空闲会话可关闭、按需恢复。', '`pathToClaudeCodeExecutable`、`startup()`、`prewarm()`、`spawnClaudeCodeProcess`、`close()`'],
      ['数据位置', 'SDK 自有的数据（会话记录、设置文件、CLAUDE.md、技能、登录凭据）留在 Claude Code 的目录；Code Agent 只在 ~/.code-agent 保存自己的数据，从不读取 Claude 登录凭据。', '`persistSession`；可选的 `sessionStore` 镜像（FR-SES-16）；FR-AUTH-04'],
      ['应用框架', '导航栏各项与下方方框一一对应。顶栏有工作区切换、Ctrl K 搜索、预热池状态、界面语言切换、审批收件箱和账号菜单。', '—'],
      ['会话内的面板', '当 SDK 需要用户参与（审批、提问、计划、征询），或用户打开检查器标签页时，这些面板出现在 P04 内。', '`canUseTool`（含 `AskUserQuestion`、`ExitPlanMode`）、`onElicitation`、检查器查询'],
    ],
  });

  // ------------------------------------------------------------------ P02
  window.SCREENS.push({
    id: 'P02',
    group: '会话',
    title: '首页 — 工作区',
    summary: '落地页。工作区就是 Agent 工作的文件夹，每张卡片显示其会话和运行情况。最近会话横跨所有工作区。右栏集中显示等你处理的事项、账号状态和预热池。',
    frs: ['FR-WS-01', 'FR-WS-05', 'FR-SES-05', 'FR-SES-07', 'FR-SES-04', 'FR-AUTH-02', 'FR-AUTH-04', 'FR-PERM-06'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 2 });
      s += t(96, 100, '工作区', { s: 22, w: 700 });
      s += t(96, 124, '选择一个文件夹作为 Agent 的工作目录。会话按工作区归类。', { s: 13, c: C.ink2 });
      s += btn(820, 86, '打开文件夹…', { icon: 'folder', w: 124 });
      s += btn(954, 86, '新建会话', { v: 'primary', icon: 'plus', w: 106 });

      const ws = [
        ['shop-api', 'D:\\src\\shop-api', 'main', 24, 2, '2 分钟前', true],
        ['shop-web', 'D:\\src\\shop-web', 'feat/checkout', 9, 1, '14 分钟前', false],
        ['infra', 'D:\\src\\infra', 'main', 5, 0, '昨天', false],
        ['笔记', 'D:\\笔记', null, 12, 0, '昨天', false],
        ['data-pipeline', 'D:\\work\\data-pipeline', 'dev', 3, 0, '周一', false],
      ];
      ws.forEach(([name, p, branch, n, live, when, pinned], i) => {
        const x = 96 + (i % 3) * 327;
        const y = 148 + Math.floor(i / 3) * 170;
        s += rect(x, y, 310, 154, { r: 10, fill: C.surface, stroke: C.border });
        s += rect(x + 16, y + 16, 36, 36, { r: 8, fill: C.accentSoft });
        s += ic('folder', x + 26, y + 26, 16, C.accent);
        s += t(x + 64, y + 32, name, { s: 15, w: 600 });
        s += t(x + 64, y + 49, p, { s: 11.5, c: C.muted, m: true });
        if (pinned) s += ic('pin', x + 282, y + 16, 14, C.ink2);
        let cx = x + 16;
        const br = branch ?? '非 Git 仓库';
        s += chip(cx, y + 66, br, branch ? { icon: 'branch' } : {});
        cx += chip.w(br, branch ? { icon: 1 } : {}) + 6;
        s += chip(cx, y + 66, `${n} 个会话`);
        cx += chip.w(`${n} 个会话`) + 6;
        if (live) s += chip(cx, y + 66, i === 0 ? '2 个运行中 · 1 个等你' : `${live} 个运行中`, { dot: i === 0 ? C.warn : C.accent, bg: i === 0 ? C.warnSoft : C.accentSoft, c: i === 0 ? C.warnInk : C.accent });
        s += t(x + 16, y + 131, `活动于 ${when}`, { s: 12, c: C.muted });
        s += btn(x + 142, y + 112, '继续上次', { h: 28, s: 12, w: 74 });
        s += btn(x + 222, y + 112, '新建会话', { v: 'soft', h: 28, s: 12, w: 74 });
      });
      s += rect(750, 318, 310, 154, { r: 10, fill: 'none', stroke: C.borderStrong, dash: '6 4' });
      s += ic('plus', 893, 366, 24, C.ink2);
      s += t(905, 412, '添加工作区', { s: 13, w: 600, c: C.ink2, a: 'middle' });
      s += t(905, 430, '或直接粘贴文件夹路径', { s: 12, c: C.muted, a: 'middle' });

      s += t(96, 516, '最近会话', { s: 16, w: 700 });
      s += t(170, 516, '所有工作区', { s: 12, c: C.muted });
      s += t(1060, 516, '查看全部 →', { s: 12.5, w: 500, c: C.accent, a: 'end' });
      s += rect(96, 530, 964, 352, { r: 10, fill: C.surface, stroke: C.border });
      const cols = [[112, '标题'], [470, '工作区'], [600, '状态'], [760, '最近活动'], [870, '标签'], [1040, '费用']];
      cols.forEach(([x, h], i) => (s += t(x, 552, h, { s: 11, w: 600, c: C.muted, a: i === 5 ? 'end' : undefined })));
      s += hline(96, 562, 964);
      const rows = [
        ['修复结账测试偶发失败', 'shop-api', 'req', '2 分钟前', 'ci', '$0.42'],
        ['重构鉴权中间件', 'shop-api', 'run', '刚刚', null, '$1.08'],
        ['文档：API 参考', 'shop-web', 'idle', '14 分钟前', 'docs', '$0.31'],
        ['为 /orders 添加限流', 'shop-api', 'saved', '2 小时前', 'perf', '$2.40'],
        ['排查内存泄漏', 'infra', 'saved', '昨天', null, '$3.12'],
        ['每周笔记摘要', '笔记', 'saved', '昨天', 'job', '$0.08'],
        ['迁移到 Postgres 17', 'data-pipeline', 'saved', '周一', 'db', '$5.77'],
      ];
      rows.forEach(([title, w, st, when, tag, cost], i) => {
        const y = 563 + i * 45;
        if (i === 3) s += rect(97, y, 962, 45, { fill: C.surface2 });
        s += t(112, y + 28, title, { s: 13, w: 500 });
        s += t(470, y + 28, w, { s: 12.5, c: C.ink2 });
        if (st === 'req') s += status(600, y + 13, 'warn', '待审批');
        else if (st === 'run') s += status(600, y + 13, 'info', '运行中');
        else if (st === 'idle') s += status(600, y + 13, 'idle', '空闲 · 进程在线');
        else s += t(600, y + 28, '已保存', { s: 12.5, c: C.muted });
        s += t(760, y + 28, when, { s: 12.5, c: C.ink2 });
        if (tag) s += chip(870, y + 14, tag, { icon: 'tag' });
        if (i === 3) {
          s += btn(936, y + 9, '恢复', { h: 27, s: 12, w: 54 });
          s += btn(996, y + 9, '', { h: 27, icon: 'branch', w: 28 });
          s += btn(1030, y + 9, '', { h: 27, icon: 'dots', w: 28 });
        } else s += t(1040, y + 28, cost, { s: 12.5, a: 'end' });
        if (i < rows.length - 1) s += hline(112, y + 45, 932, '#eef0f4');
      });

      const rx = 1090;
      s += panel(rx, 86, 320, 146, { title: '模型服务与账号' });
      s += kv(rx + 14, 146, '认证方式', 'Claude 订阅（Max）', { kw: 80 });
      s += kv(rx + 14, 168, '凭据来源', 'Claude Code 登录', { kw: 80 });
      s += kv(rx + 14, 190, '配置目录', '%USERPROFILE%\\.claude', { kw: 80, m: true });
      s += status(rx + 14, 202, 'good', '已登录');
      s += t(rx + 306, 216, '设置 →', { s: 12, c: C.accent, a: 'end' });

      s += panel(rx, 246, 320, 132, { title: '预热池' });
      s += toggle(rx + 14, 298, true, '保持 1 个进程就绪');
      s += kv(rx + 14, 340, '配置方案', '默认', { kw: 70 });
      s += status(rx + 14, 350, 'good', '就绪 · 238 MB');
      s += t(rx + 306, 364, '首个请求 0.4 秒', { s: 11.5, c: C.muted, a: 'end' });

      s += panel(rx, 392, 320, 200, { title: '等你处理', sub: '2' });
      s += rect(rx + 12, 442, 296, 66, { r: 8, fill: C.warnSoft });
      s += ic('shield', rx + 22, 452, 16, C.warnInk);
      s += t(rx + 46, 465, '修复结账测试偶发失败', { s: 13, w: 600 });
      s += t(rx + 46, 484, 'Bash · rm -rf …/.cache', { s: 11.5, c: C.ink2, m: true });
      s += t(rx + 46, 500, '已等待 0:12', { s: 11, c: C.warnInk });
      s += btn(rx + 244, 460, '审批', { h: 28, s: 12, w: 56 });
      s += rect(rx + 12, 516, 296, 62, { r: 8, fill: C.surface2 });
      s += ic('chat', rx + 22, 526, 16, C.ink2);
      s += t(rx + 46, 539, '文档：API 参考', { s: 13, w: 600 });
      s += t(rx + 46, 558, 'Claude 提了 2 个问题', { s: 11.5, c: C.ink2 });
      s += btn(rx + 244, 532, '回答', { h: 28, s: 12, w: 56 });

      s += panel(rx, 606, 320, 150, { title: '默认配置方案' });
      s += kv(rx + 14, 666, '模型', 'Opus 5.5 · 推理强度高', { kw: 80 });
      s += kv(rx + 14, 688, '权限模式', '编辑前询问', { kw: 80 });
      s += kv(rx + 14, 710, '限制', '50 轮 · $5.00', { kw: 80 });
      s += kv(rx + 14, 732, '检查点', '开启', { kw: 80 });
      s += t(rx + 306, 626, '编辑 →', { s: 12, c: C.accent, a: 'end' });

      s += panel(rx, 770, 320, 112, { title: '本月' });
      s += t(rx + 14, 840, '$48.20', { s: 26, w: 700 });
      s += t(rx + 14, 864, '费用 · 126 个会话', { s: 12, c: C.muted });
      s += t(rx + 306, 864, '用量 →', { s: 12, c: C.accent, a: 'end' });

      s += mk(818, 84, 1) + mk(1060, 84, 2) + mk(236, 258, 3) + mk(398, 214, 4) + mk(1052, 324, 5) + mk(932, 698, 6);
      s += mk(1408, 90, 7) + mk(1408, 250, 8) + mk(1408, 396, 9) + mk(1408, 610, 10);
      return s;
    },
    notes: [
      ['打开文件夹…', '打开由 Node 服务提供的文件夹浏览器（网页本身读不到本地路径），置顶和最近使用的排在前面。选中后新增一张工作区卡片。支持中文等非 ASCII 路径。', '服务端 `GET /api/fs/browse`；所选文件夹即 `Options.cwd`（FR-WS-01、FR-I18N-08）'],
      ['新建会话', '打开 P03，预选当前工作区和默认配置方案。任何页面都可按 Ctrl N。', '→ P03'],
      ['卡片操作', '「新建会话」为该文件夹打开 P03。「继续上次」直接恢复该文件夹最近的会话，无需挑选；文件夹没有会话时禁用。', '`query({ options: { cwd, continue: true } })`（FR-SES-07）'],
      ['会话数与运行标记', '会话数来自该文件夹的会话列表（含 worktree）。运行标记统计有进程在跑的会话，有会话等你处理时变为琥珀色；点击直接打开那个会话。', '`listSessions({ dir, includeWorktrees: true })`、`session_state_changed`'],
      ['添加工作区', '同「打开文件夹」，也可粘贴路径。卡片菜单：置顶、改显示名、移除（不删除会话）。', '仅应用自身数据'],
      ['最近会话行', '点击打开会话：运行中的直接接入，已保存的以只读方式打开并显示「恢复」栏。悬停出现恢复、分叉和更多菜单（重命名、打标签、导出、删除）。时间按界面语言本地化显示。', '`getSessionMessages`、`resume`、`forkSession`、`renameSession`、`tagSession`、`deleteSession`；FR-I18N-04'],
      ['模型服务与账号', '显示会话如何认证。默认使用你在官方 Claude Code 里登录的 Claude 订阅；Code Agent 只指定配置目录，不读取凭据。若会话因认证失败无法启动，这里变红并显示原因。「设置 →」打开 P22。', '`accountInfo()`、init 中的 `apiKeySource`、`auth_status`、`startup_failure_reason`（FR-AUTH-02/04）'],
      ['预热池', '为选定的配置方案预先启动并初始化一个 Claude Code 进程，新会话可立即响应。显示占用内存；关闭即释放进程。', '`prewarm()` + `SpareProcess.claim()`；已知文件夹时用 `startup()`（FR-SES-04）'],
      ['等你处理', '所有运行中会话里待处理的审批、提问、计划审阅或 MCP 征询，按等待时间排序。「审批 / 回答」会打开对应会话并定位到该请求。', '待处理的 `canUseTool` 请求、`requires_action`（FR-PERM-06）'],
      ['默认配置方案', '新会话使用的选项摘要。「编辑」打开 P20。', '配置方案 → `Options`'],
    ],
  });

  // ------------------------------------------------------------------ P03
  window.SCREENS.push({
    id: 'P03',
    group: '会话',
    title: '新建会话对话框',
    summary: '启动一个运行中的会话。选择配置方案会填好所有字段；在这里修改的内容只对本次会话生效。对话框只放常改的选项，其余都在「高级覆盖项」里。',
    frs: ['FR-SES-01..04', 'FR-WS-01/02', 'FR-MOD-01/03/04', 'FR-PERM-01/02', 'FR-COST-01', 'FR-CKPT-01', 'FR-CFG-01'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 2 });
      s += t(96, 100, '工作区', { s: 22, w: 700 });
      for (let i = 0; i < 3; i++) s += rect(96 + i * 327, 148, 310, 154, { r: 10, fill: C.surface, stroke: C.border });
      s += overlay();
      const x = 330;
      const y = 66;
      s += rect(x, y, 780, 806, { r: 12, fill: C.surface, shadow: true });
      s += t(x + 24, y + 38, '新建会话', { s: 18, w: 700 });
      s += ic('x', x + 744, y + 22, 18, C.ink2);
      s += hline(x, y + 58, 780);
      const X = x + 24;

      s += select(X, y + 94, 540, 'D:\\src\\shop-api', { label: '工作区', icon: 'folder' });
      s += btn(X + 552, y + 94, '添加目录', { icon: 'plus', h: 32, w: 180 });
      s += chip(X, y + 136, 'D:\\src\\shared-lib', { icon: 'folder', h: 22, m: true });
      s += ic('x', X + chip.w('D:\\src\\shared-lib', { icon: 1, m: true }) + 4, y + 140, 14, C.muted);
      s += t(X + 210, y + 151, '额外可访问的目录 · 其中的 .claude 技能和代理也会加载', { s: 11.5, c: C.muted });

      s += select(X, y + 194, 300, '默认', { label: '配置方案', icon: 'layers' });
      s += circle(X + 268, y + 210, 4, { fill: C.warn });
      s += t(X + 312, y + 215, '编辑', { s: 12.5, c: C.accent });
      s += input(X + 360, y + 194, 372, { label: '标题（可选）', ph: '不填则由 Claude 自动命名' });

      s += select(X, y + 270, 220, 'Opus 5.5', { label: '模型', icon: 'cpu' });
      s += t(X, y + 318, '自适应思考 · 快速模式 · 自动模式', { s: 11, c: C.muted });
      s += t(X + 236, y + 263, '推理强度', { s: 12, w: 500, c: C.ink2 });
      s += seg(X + 236, y + 270, ['低', '中', '高', '超高', '最高'], 2, { h: 32 });
      s += select(X + 532, y + 270, 200, '自适应 · 显示摘要', { label: '思考' });

      s += t(X, y + 360, '权限模式', { s: 12, w: 500, c: C.ink2 });
      const modes = [
        ['shield', '编辑前询问', '未授权的操作都先问我', true],
        ['pencil', '自动接受编辑', '工作区内的文件编辑直接执行'],
        ['list', '规划模式', '只探索和出计划，不改文件'],
        ['spark', '自动', '由分类模型审查每个操作'],
        ['lock', '不询问', '未预先授权的一律拒绝'],
        ['warning', '跳过权限检查', '全部直接执行 · 需二次确认', false, true],
      ];
      modes.forEach(([icn, title, desc, on, danger], i) => {
        const mx = X + (i % 3) * 248;
        const my = y + 370 + Math.floor(i / 3) * 66;
        s += rect(mx, my, 236, 56, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : danger ? '#e9a3a3' : C.border, sw: on ? 1.5 : 1 });
        s += radio(mx + 10, my + 10, !!on);
        s += ic(icn, mx + 34, my + 10, 16, danger ? C.crit : on ? C.accent : C.ink2);
        s += t(mx + 56, my + 23, title, { s: 13, w: 600, c: danger ? C.crit : C.ink });
        s += t(mx + 34, my + 44, desc, { s: 11.5, c: C.ink2 });
      });

      s += input(X, y + 524, 150, { label: '最大轮数', val: '50' });
      s += input(X + 166, y + 524, 150, { label: '预算上限', val: '5.00', right: 'USD' });
      s += t(X + 334, y + 545, '留空表示不限。预算是客户端估算，请留出余量。', { s: 11.5, c: C.muted });

      s += toggle(X, y + 580, true, '文件检查点', { hint: '之后可回退编辑' });
      s += toggle(X + 260, y + 580, false, '临时会话', { hint: '不写入磁盘' });
      s += toggle(X + 470, y + 580, true, '下一步提示建议');

      s += textarea(X, y + 638, 732, 76, ['修复结账测试的偶发失败，CI 日志见附件。'], { label: '首条消息（可选）' });
      s += chip(X + 10, y + 680, 'ci-log.png', { icon: 'image', h: 22 });
      s += btn(X + 662, y + 680, '', { v: 'ghost', icon: 'clip', w: 30, h: 26 });
      s += btn(X + 694, y + 680, '', { v: 'ghost', icon: 'image', w: 30, h: 26 });

      s += ic('chevRight', X, y + 728, 16, C.ink2);
      s += t(X + 20, y + 741, '高级覆盖项', { s: 13, w: 600 });
      s += t(X + 110, y + 741, '系统提示词 · 配置来源 · 工具 · MCP · 代理 · 技能 · 钩子 · 沙箱 · 环境变量 · 回复语言', { s: 12, c: C.muted });
      s += hline(x, y + 758, 780);
      s += t(X, y + 787, 'Ctrl Enter 开始', { s: 12, c: C.muted });
      s += btn(x + 566, y + 768, '取消', { w: 70 });
      s += btn(x + 646, y + 768, '开始会话', { v: 'primary', w: 110 });

      s += mk(X - 12, y + 86, 1) + mk(X - 12, y + 186, 2) + mk(X - 12, y + 262, 3) + mk(X - 12, y + 354, 4) + mk(X + 734, y + 442, 5);
      s += mk(X - 12, y + 516, 6) + mk(X - 12, y + 588, 7) + mk(X - 12, y + 630, 8) + mk(X - 12, y + 734, 9) + mk(x + 760, y + 768, 10);
      return s;
    },
    notes: [
      ['工作区与目录', '默认是打开对话框时所在的工作区。「添加目录」授权访问另一个文件夹；开启项目级配置时，该目录的技能、命令和代理也会加载。目录标签可移除。', '`cwd`、`additionalDirectories`（FR-WS-01/02）'],
      ['配置方案与标题', '选择配置方案即填好所有字段。在此修改任一字段后，配置方案选择框上出现琥珀色「已覆盖」圆点，覆盖只对本次会话生效。标题可选。', '配置方案 → `Options`；`title`（FR-CFG-01、FR-SES-02）'],
      ['模型、推理强度、思考', '模型列表来自预热进程（或上次缓存的列表），下方说明所选模型的能力。模型不支持的推理强度档位会被禁用。档位名称本地化显示，传给 SDK 的仍是 low…max。', '`supportedModels()` → `ModelInfo`；`effort`；`thinking`（FR-MOD-01/03/04）'],
      ['权限模式', '单选，每个选项用一句话说明效果。模型不支持自动模式时隐藏「自动」。', '`permissionMode`（FR-PERM-01）'],
      ['跳过权限检查', '选中时弹出确认：所有工具不经审批直接执行（拒绝规则和钩子仍然生效）。只有配置方案开启了「允许跳过权限检查」时才可选，否则禁用并给出跳转链接。', '`allowDangerouslySkipPermissions`（FR-PERM-02）'],
      ['限制', '达到上限时本轮以横幅结束，并提供「提高上限后继续」操作（P24）。金额统一按美元显示。', '`maxTurns`、`maxBudgetUsd`（FR-COST-01）'],
      ['会话开关', '文件检查点让每条消息都成为回退点（P10）。临时会话不写入磁盘，之后无法恢复。下一步提示建议会预测你的下一条输入。', '`enableFileCheckpointing` + `replay-user-messages`；`persistSession: false`；`promptSuggestions`'],
      ['首条消息', '可选；和输入框一样支持图片、@ 引用和 / 命令，也支持输入法组字。留空则启动一个空闲会话。', '输入队列上的第一条 `SDKUserMessage`'],
      ['高级覆盖项', '展开配置方案编辑器（P20）中的各部分，仅对本次会话生效，包括 Claude 的回复语言。', '其余 `Options`；`settings.language`（FR-I18N-05）'],
      ['开始会话', '有匹配的预热进程就直接领用，否则新启动一个；打开 P04 并发送首条消息。启动失败（如文件夹不存在）就地显示本地化的原因，并可展开 SDK 原文。', '`query()` / `SpareProcess.claim()`；`startup_failure_reason`（FR-I18N-06）'],
    ],
  });

  // ------------------------------------------------------------------ P04
  window.SCREENS.push({
    id: 'P04',
    group: '运行中的会话',
    title: '运行中的会话 — 流式对话',
    summary: '主要工作界面：左侧是运行中的会话，中间是对话记录（流式文本、思考过程、每次工具调用一张卡片），右侧是检查器（此处显示 Agent 的任务清单）。',
    frs: ['FR-SES-12/13/17', 'FR-OUT-01..06', 'FR-TOOL-01..05', 'FR-TODO-01', 'FR-PERM-01', 'FR-CTX-01', 'FR-COST-02'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += K.sessionColumn({ active: 0, live: [
        ['修复结账测试偶发失败', 'running', 'shop-api'],
        ['重构鉴权中间件', 'requires_action', 'shop-api'],
        ['文档：API 参考', 'idle', 'shop-web'],
      ] });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'running' });
      const X = L.TX;
      const W = L.TW;
      s += rect(X, 118, W, 26, { r: 6, fill: C.surface2 });
      s += t(X + 12, 135, '第 1 轮 · 1分12秒 · 14 次工具调用 · $0.21 · 停止原因 end_turn', { s: 11.5, c: C.muted });
      s += ic('chevDown', X + W - 26, 123, 16, C.muted);

      s += K.userMsg(X, 156, W, 'CI 上结账测试偶尔失败，帮我找到原因并修复——CI 日志在附件里。', { attach: 'ci-log.png · 182 KB' });
      s += K.thinking(X, 246, W, { dur: '6 秒', preview: '日志显示 cart.timer 超时——可能有计时器在测试之间泄漏…' });
      s += t(X, 304, '我先看看结账测试套件和计时器相关的代码。', { s: 14 });
      s += rect(X, 318, W, 30, { r: 6, fill: C.surface, stroke: C.border });
      s += ic('list', X + 10, 325, 16, C.ink2);
      s += t(X + 34, 337.5, '读取 4 个文件 · 搜索 2 个模式 · 1.8 秒', { s: 12.5, c: C.ink2 });
      s += ic('chevRight', X + W - 26, 325, 16, C.muted);

      s += K.toolCard(X, 362, W, {
        icon: 'pencil', name: 'Edit', detail: 'src/cart/timer.ts', right: '+2 −1', st: 'ok', prov: '已由你批准', bodyH: 112,
        body: K.diff(X + 12, 408, W - 24, [
          '@@ -41,6 +41,7 @@ export function startTimer(cart: Cart) {',
          '   const ttl = cart.ttlMs ?? DEFAULT_TTL;',
          '-  const id = setTimeout(() => expire(cart), ttl);',
          '+  const id = timers.setTimeout(() => expire(cart), ttl);',
          '+  cart.onDispose(() => timers.clearTimeout(id));',
        ]),
      });
      s += K.toolCard(X, 524, W, {
        icon: 'terminal', name: 'Bash', detail: 'npm test -- checkout --randomize', right: '12.4 秒', st: 'ok', prov: '规则 Bash(npm test *)', bodyH: 84,
        body: code(X + 12, 570, W - 24, [
          [['PASS', C.goodInk, 700], ['  tests/checkout/cart.test.ts (8.2 s)']],
          [['PASS', C.goodInk, 700], ['  tests/checkout/timer.test.ts (2.1 s)']],
          'Tests:       41 passed, 41 total',
        ]),
      });
      s += t(X, 686, '两个测试共用了一个从未清理的模块级计时器，导致后一个测试读到过期的时间。', { s: 14 });
      const last = '现在计时器改用注入的时钟，并随购物车一起释放。测试套件';
      s += t(X, 710, last, { s: 14 });
      s += rect(X + tw(last, 14) + 3, 698, 8, 16, { fill: C.accent });
      s += K.composer(X, 776, W, { running: true, h: 108 });

      s += K.inspector(0);
      const IX = L.IX + 16;
      s += t(IX, 152, '任务清单', { s: 13, w: 600 });
      s += t(L.IX + L.IW - 16, 152, '已完成 1/4', { s: 12, c: C.muted, a: 'end' });
      s += progress(IX, 162, 307, 25);
      const tasks = [
        ['done', '在本地复现失败'],
        ['doing', '定位购物车计时器的竞态', '正在定位购物车计时器的竞态…'],
        ['todo', '修复并添加回归测试', '被 #2 阻塞'],
        ['todo', '把结账测试连续跑 20 次'],
      ];
      tasks.forEach(([st, title, sub], i) => {
        const y = 188 + i * 46;
        if (st === 'done') s += circle(IX + 8, y + 8, 8, { fill: C.good }) + ic('check', IX + 2, y + 2, 12, '#fff', 2.4);
        else if (st === 'doing') s += circle(IX + 8, y + 8, 7, { stroke: C.accent, sw: 2.5 }) + path(`M${IX + 8} ${y + 1} A7 7 0 0 1 ${IX + 15} ${y + 8}`, { c: C.accentLine, sw: 2.5 });
        else s += circle(IX + 8, y + 8, 7, { stroke: C.borderStrong, sw: 1.5 });
        s += t(IX + 26, y + 12.5, title, { s: 13, c: st === 'done' ? C.muted : C.ink, w: st === 'doing' ? 600 : 400 });
        if (sub) s += st === 'doing' ? t(IX + 26, y + 30, sub, { s: 11.5, i: true, c: C.accent }) : chip(IX + 26, y + 19, sub, { h: 17, s: 10.5 });
      });
      s += hline(L.IX, 384, L.IW);
      s += t(IX, 410, '会话', { s: 13, w: 600 });
      const info = [
        ['模型', 'claude-opus-5-5'], ['权限模式', 'default'], ['工作区', 'D:\\src\\shop-api'], ['Claude Code', '2.1.302'],
        ['工具', '内置 23 · MCP 41'], ['MCP', 'github ●  postgres ●'], ['技能', '6 · 插件 1'],
      ];
      info.forEach(([k, v], i) => (s += kv(IX, 436 + i * 22, k, v, { kw: 92 })));
      s += t(IX, 600, '会话信息与事件 →', { s: 12, c: C.accent });
      s += hline(L.IX, 620, L.IW);
      s += t(IX, 646, '后台', { s: 13, w: 600 });
      s += chip(IX + 40, 633, '1 个运行中', { h: 18, bg: C.accentSoft, c: C.accent });
      s += rect(IX, 658, 307, 52, { r: 8, fill: C.surface2, stroke: C.border });
      s += ic('terminal', IX + 10, 668, 16, C.ink2);
      s += t(IX + 34, 680, 'npm run e2e', { s: 12.5, m: true });
      s += t(IX + 34, 698, '运行中 · 3分12秒', { s: 11.5, c: C.muted });
      s += btn(IX + 245, 668, '停止', { h: 26, s: 12, w: 52 });

      s += mk(78, 136, 1) + mk(544, 62, 2) + mk(L.TX + L.TW - 6, 160, 3) + mk(L.TX - 13, 262, 4) + mk(L.TX - 13, 333, 5);
      s += mk(L.TX - 13, 380, 6) + mk(L.TX - 13, 542, 7) + mk(L.TX - 13, 682, 8) + mk(L.IX + 70, 71, 9) + mk(L.TX - 13, 794, 10);
      return s;
    },
    notes: [
      ['运行中的会话', '每个运行中的会话及其状态：蓝色圆环 = 运行中，琥珀色 = 等你处理，灰色 = 空闲。点击切换中间和右侧内容，进程在后台继续运行。Alt ↑/↓ 切换。', '`session_state_changed`（FR-SES-12/13）'],
      ['会话标题栏', '标题（点击重命名）与状态。右侧依次为：模型 + 推理强度菜单（本轮内即可切换）、权限模式菜单（Shift Tab 循环）、上下文用量（打开 P11）、相对预算的费用、停止（确认后结束进程）。', '`setModel()`、`applyFlagSettings({ effortLevel })`、`setPermissionMode()`、`getContextUsage()`、`total_cost_usd`、`close()`'],
      ['用户消息', '显示文字、图片缩略图和「粘贴内容」标签。悬停出现「回退文件」和「分叉」（P10）。', '`SDKUserMessage`（uuid 即检查点）'],
      ['思考过程', '默认折叠，显示一行预览和耗时；展开后是流式输出的思考摘要。', '`thinking` 块，`thinking.display: "summarized"`'],
      ['工具调用摘要', '连续的只读调用合并为一行；展开后每次调用显示为紧凑卡片。', '`tool_use_summary` 消息'],
      ['Edit 卡片', '文件路径、增删行数和改动 diff；点击路径打开完整文件；卡片菜单可切换并排/统一视图。盾牌标签说明这次调用为何被执行（某条规则、权限模式，或你的批准）。工具名保持英文原名。', '`Edit` 的输入/输出、权限决策来源'],
      ['Bash 卡片', '命令、运行中的实时输出（结束后显示末尾）、退出状态和耗时。运行中还提供「转入后台」（P09）。命令输出原样显示，不做翻译。', '`Bash` 输入、`tool_progress`、`tool_use_result`'],
      ['流式文本', '文字逐 token 出现并带光标；Markdown 和代码块在完整后排版。被中断的消息保留「已中断」标记。', '`includePartialMessages`、`stream_event` 增量、`aborted`'],
      ['检查器：任务', 'Agent 自己的任务清单，实时更新：已完成、进行中（显示进行时描述）、待办及依赖关系。下方是会话信息和正在运行的后台工作。', '`TaskCreate` / `TaskUpdate` / `TodoWrite`、init 消息、`task_*` 消息'],
      ['运行中的输入框', 'Agent 工作时输入的消息会进入队列（P05）；「中断」（或输入框为空时按 Esc）停止本轮。输入法正在组字时按回车只确认候选词，不会发送。', '`priority`、`interrupt()`（FR-I18N-07）'],
    ],
  });

  /** Faded placeholder transcript lines. */
  function ghostLines(x, y, w, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += rect(x, y + i * 18, w * (i % 3 === 2 ? 0.55 : 0.92), 9, { r: 4, fill: C.surface3 });
    return s;
  }

  /** Minimal composer frame for narrow mock panels; returns markup. */
  function miniComposer(x, y, w, h, o = {}) {
    let s = rect(x, y, w, h, { r: 10, fill: C.surface, stroke: o.focus ? C.accent : C.borderStrong, sw: o.focus ? 1.5 : 1, shadow: true });
    const by = y + h - 38;
    s += btn(x + 8, by, '', { v: 'ghost', icon: 'clip', w: 30 }) + btn(x + 40, by, '', { v: 'ghost', icon: 'image', w: 30 });
    s += btn(x + 72, by, '', { v: 'ghost', icon: 'at', w: 30 }) + btn(x + 104, by, '', { v: 'ghost', icon: 'slash', w: 30 });
    return s;
  }

  // ------------------------------------------------------------------ P05
  window.SCREENS.push({
    id: 'P05',
    group: '运行中的会话',
    title: '输入框 — 命令、引用、附件与排队',
    summary: '输入框在四种情况下的特写：(A) 斜杠命令面板；(B) @ 引用、图片和粘贴文本；(C) Agent 仍在工作时发送消息；(D) 几个小状态——下一步提示建议、中断回执和发送选项菜单。',
    frs: ['FR-IN-01..10', 'FR-SKILL-04', 'FR-I18N-06/07'],
    draw() {
      let s = rect(0, 0, 1440, 900, { fill: C.page });
      const cols = [30, 500, 970];
      const caps = ['A · 斜杠命令面板', 'B · 引用、图片与粘贴', 'C · Claude 工作时发送消息'];
      cols.forEach((x, i) => {
        s += t(x, 50, caps[i], { s: 15, w: 700 });
        s += rect(x, 66, 440, 560, { r: 12, fill: C.page, stroke: C.border });
        s += ghostLines(x + 20, 86, 400, 4);
      });

      let x = 30;
      s += miniComposer(x + 16, 498, 408, 112, { focus: true });
      s += t(x + 32, 526, '/co', { s: 14, m: true });
      s += line(x + 32 + tw('/co', 14, true) + 2, 513, x + 32 + tw('/co', 14, true) + 2, 531, { c: C.ink, sw: 1.3 });
      s += btn(x + 344, 572, '发送', { v: 'primary', icon: 'send', w: 72 });
      s += rect(x + 16, 186, 408, 302, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      s += t(x + 30, 210, '命令', { s: 12, w: 600, c: C.muted });
      s += t(x + 410, 210, '匹配 “co” 的 5 项', { s: 11.5, c: C.muted, a: 'end' });
      const cmds = [
        ['slash', '/compact', '压缩历史记录', '内置', true],
        ['slash', '/context', '查看上下文占用', '内置'],
        ['spark', '/code-review', '[low|medium|high]', '技能 · 内置包'],
        ['box', '/commit', 'Commit staged changes', '插件 · git-tools'],
        ['file', '/cost-report', '每周费用汇总', '项目命令'],
      ];
      cmds.forEach(([icn, name, hint, origin, on], i) => {
        const y = 222 + i * 40;
        if (on) s += rect(x + 22, y, 396, 36, { r: 6, fill: C.accentSoft });
        s += ic(icn, x + 32, y + 10, 16, on ? C.accent : C.ink2);
        s += t(x + 56, y + 16, name, { s: 13, w: 600, m: true, c: on ? C.accent : C.ink });
        s += t(x + 56, y + 31, hint, { s: 11.5, c: C.muted, m: hint.startsWith('[') });
        s += chip(x + 410 - chip.w(origin, { s: 10.5 }), y + 9, origin, { s: 10.5, h: 18 });
      });
      s += hline(x + 16, 428, 408);
      s += t(x + 30, 450, '↑↓ 选择 · Tab 补全 · Enter 执行', { s: 11.5, c: C.muted });
      s += t(x + 30, 468, '参数写在命令名之后。插件自带的英文说明按原文显示。', { s: 11.5, c: C.muted });

      x = 500;
      s += rect(x + 16, 96, 408, 104, { r: 10, fill: C.accentSoft, stroke: C.accent, dash: '6 4' });
      s += ic('upload', x + 208, 112, 24, C.accent);
      s += t(x + 220, 160, '拖放图片或文件以附加', { s: 13, w: 600, c: C.accent, a: 'middle' });
      s += t(x + 220, 178, '拖入时的状态', { s: 11, c: C.accent, a: 'middle' });
      s += rect(x + 16, 214, 408, 228, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      s += t(x + 30, 238, '文件与资源', { s: 12, w: 600, c: C.muted });
      const ments = [
        ['file', 'src/cart/timer.ts', '本会话已编辑', true],
        ['file', 'src/cart/timer.test.ts', ''],
        ['file', 'docs/设计说明.md', ''],
        ['plug', 'github:issue/482', 'MCP 资源'],
        ['plug', 'postgres:schema/orders', 'MCP 资源'],
      ];
      ments.forEach(([icn, name, right, on], i) => {
        const y = 250 + i * 36;
        if (on) s += rect(x + 22, y, 396, 32, { r: 6, fill: C.accentSoft });
        s += ic(icn, x + 32, y + 8, 16, on ? C.accent : C.ink2);
        s += t(x + 56, y + 20.5, name, { s: 12.5, m: true, c: on ? C.accent : C.ink, w: on ? 600 : 400 });
        if (right) s += t(x + 410, y + 20.5, right, { s: 11, c: C.muted, a: 'end' });
      });
      s += miniComposer(x + 16, 452, 408, 158, { focus: true });
      s += rect(x + 28, 464, 44, 36, { r: 6, fill: C.surface3, stroke: C.border });
      s += ic('image', x + 40, 472, 20, C.ink2);
      s += t(x + 80, 478, 'ci-log.png', { s: 12, w: 500 });
      s += t(x + 80, 494, '182 KB', { s: 11, c: C.muted });
      s += ic('x', x + 150, 466, 14, C.muted);
      s += rect(x + 178, 464, 170, 36, { r: 6, fill: C.surface3, stroke: C.border });
      s += ic('copy', x + 188, 474, 16, C.ink2);
      s += t(x + 212, 478, '粘贴的文本', { s: 12, w: 500 });
      s += t(x + 212, 494, '214 行 · 点击查看', { s: 11, c: C.muted });
      s += ic('x', x + 328, 466, 14, C.muted);
      s += runs(x + 30, 530, [['对比 '], ['@src/cart/ti', C.accent, 600]], { s: 14 });
      s += line(x + 30 + tw('对比 @src/cart/ti', 14) + 6, 516, x + 30 + tw('对比 @src/cart/ti', 14) + 6, 534, { c: C.ink, sw: 1.3 });
      s += btn(x + 344, 572, '发送', { v: 'primary', icon: 'send', w: 72 });

      x = 970;
      s += rect(x + 16, 140, 408, 38, { r: 8, fill: C.surface, stroke: C.accentLine });
      s += circle(x + 34, 159, 7, { stroke: C.accent, sw: 2.5 });
      s += t(x + 50, 163.5, '工作中 · Bash npm test · 0:42', { s: 12.5, w: 500, c: C.accent });
      s += t(x + 410, 163.5, 'Esc 中断', { s: 11.5, c: C.muted, a: 'end' });
      s += t(x + 16, 206, '排队中 · 2', { s: 11, w: 700, c: C.muted, ls: 0.5 });
      const q = [['再检查一下 Redis 的 mock', '工具后'], ['然后更新 CHANGELOG', '下一轮']];
      q.forEach(([msg, pr], i) => {
        const y = 216 + i * 48;
        s += rect(x + 16, y, 408, 40, { r: 8, fill: C.surface, stroke: C.border, dash: '4 3' });
        s += ic('queue', x + 28, y + 12, 16, C.ink2);
        s += t(x + 52, y + 24.5, msg, { s: 13 });
        s += rect(x + 330, y + 8, 84, 24, { r: 6, fill: i === 0 ? C.accentSoft : C.surface2, stroke: i === 0 ? C.accent : C.border });
        s += t(x + 340, y + 24.5, pr, { s: 12, w: 600, c: i === 0 ? C.accent : C.ink2 });
        s += ic('chevDown', x + 392, y + 12, 14, C.ink2);
      });
      s += rect(x + 150, 252, 270, 218, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      const pri = [
        ['立即插入', 'Claude 马上读到这条消息；', '正在运行的工作转入后台'],
        ['工具后', '当前这批工具调用结束后读取', '（默认）'],
        ['下一轮', '本轮结束后作为新一轮发送', ''],
      ];
      pri.forEach(([label, a, b], i) => {
        const y = 262 + i * 52;
        if (i === 1) s += rect(x + 156, y - 4, 258, 50, { r: 6, fill: C.accentSoft });
        s += t(x + 168, y + 12, label, { s: 13, w: 600, c: i === 1 ? C.accent : C.ink });
        s += t(x + 168, y + 28, a, { s: 11.5, c: C.ink2 });
        if (b) s += t(x + 168, y + 42, b, { s: 11.5, c: C.ink2 });
        if (i === 1) s += ic('check', x + 392, y + 4, 16, C.accent);
      });
      s += hline(x + 150, 418, 270);
      s += t(x + 168, 440, '编辑消息', { s: 12.5 });
      s += t(x + 168, 460, '移出队列', { s: 12.5, c: C.crit });
      s += miniComposer(x + 16, 498, 408, 112, { focus: true });
      s += t(x + 32, 526, '跳过集成测试', { s: 14 });
      s += btn(x + 228, 572, '中断', { v: 'dangerOutline', icon: 'stop', w: 82 });
      s += btn(x + 316, 572, '立即插入', { v: 'primary', w: 100 });

      s += t(30, 660, 'D · 下一步提示建议', { s: 15, w: 700 });
      s += t(500, 660, 'D · 中断回执', { s: 15, w: 700 });
      s += t(970, 660, 'D · 发送选项', { s: 15, w: 700 });
      s += miniComposer(46, 680, 408, 100);
      s += t(62, 708, '运行完整测试套件，确认修复有效', { s: 14, c: C.muted });
      s += kbd(62, 718, 'Tab');
      s += t(92, 731, '接受 · 继续输入则忽略', { s: 11.5, c: C.muted });
      s += btn(370, 742, '发送', { v: 'primary', icon: 'send', w: 76, h: 28 });

      s += rect(516, 680, 408, 110, { r: 10, fill: C.warnSoft, stroke: '#f1d38a' });
      s += ic('warning', 532, 696, 18, C.warnInk);
      s += t(560, 710, '本轮已中断', { s: 13.5, w: 700 });
      s += t(560, 730, '有 2 条排队消息没有取消，会在接下来执行。', { s: 12.5, c: C.ink2 });
      s += btn(724, 752, '保留', { h: 28, s: 12, w: 62 });
      s += btn(792, 752, '取消排队消息', { v: 'dangerOutline', h: 28, s: 12, w: 120 });

      s += rect(986, 680, 408, 196, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      const opts = [
        ['send', '发送', 'Enter', true],
        ['bolt', '立即插入', 'Ctrl Enter'],
        ['clip', '仅作为上下文 —— 不触发回复', ''],
        ['lock', '原样发送 —— 不解析 @ 和 /', ''],
      ];
      opts.forEach(([icn, label, key, on], i) => {
        const y = 690 + i * 42;
        if (on) s += rect(992, y, 396, 36, { r: 6, fill: C.accentSoft });
        s += ic(icn, 1004, y + 10, 16, on ? C.accent : C.ink2);
        s += t(1030, y + 22.5, label, { s: 13, w: on ? 600 : 400, c: on ? C.accent : C.ink });
        if (key) s += kbd(1384 - kbd.w(key), y + 9, key);
      });
      s += t(1004, 864, '点击「发送」旁的箭头打开。', { s: 11.5, c: C.muted });

      s += mk(40, 230, 1) + mk(430, 268, 2) + mk(512, 100, 3) + mk(512, 470, 4) + mk(512, 230, 5);
      s += mk(982, 222, 6) + mk(1424, 262, 7) + mk(1424, 578, 8) + mk(42, 690, 9) + mk(512, 690, 10) + mk(982, 690, 11);
      return s;
    },
    notes: [
      ['斜杠命令面板', '在开头输入 / 打开面板，边输入边过滤。方向键选择，Tab 补全命令名（随后以灰字显示参数提示），Enter 执行。技能或插件变化时列表实时更新。', '`supportedCommands()` → `SlashCommand`（`name`、`description`、`argumentHint`、`aliases`）；`commands_changed`（FR-IN-05）'],
      ['命令来源与说明语言', '每个命令标明来源：内置、内置技能包或项目技能、插件、项目命令文件、MCP 提示。内置命令的说明使用本地化文案；技能、插件、MCP 自带的说明按作者原文显示（如 /commit 的英文说明）。', '`SlashCommand.builtin`；命令调用即发送 `/name args` 文本（FR-SKILL-04、FR-I18N-06）'],
      ['拖放', '把文件拖到对话区上方时显示投放区。图片成为图片块；其他文件以工作区路径的 @ 引用附加（工作区外的文件先复制到临时目录）。中文文件名同样支持。', '`SDKUserMessage.message` 中的图片内容块（FR-IN-02、FR-I18N-08）'],
      ['附件', '图片标签显示缩略图和大小。粘贴超过 20 行时转为可打开、可编辑的「粘贴的文本」标签，以粘贴内容的形式发送，Claude 能区分这是粘贴的。', '`pasted_content` / `inline_pastes`（FR-IN-04）'],
      ['@ 引用', '输入 @ 列出工作区文件（最近编辑的在前）和 MCP 资源，Enter 插入。发送时由 Claude Code 展开引用。', '引用展开；MCP 资源用 `@server:resource`（FR-IN-03）'],
      ['排队的消息', 'Claude 工作时发出的消息按顺序在这里等待，并显示投递方式。投递前可编辑、调整方式或移出；投递后移入对话记录。', '输入队列 → 带 `priority` 和 `uuid` 的 `SDKUserMessage`（FR-IN-06）'],
      ['投递方式', '立即插入：Claude 马上读到，正在运行的工作转入后台。工具后：当前这批工具调用结束后读取（默认）。下一轮：本轮结束后作为新一轮。', '`priority: "now"` + `origin: { kind: "human" }`、`"next"`、`"later"`'],
      ['中断 / 立即插入', 'Claude 工作时输入框有内容，主按钮变成「立即插入」，「中断」仍可用。输入框为空时按 Esc 即中断。', '`interrupt()`；`priority: "now"`'],
      ['下一步提示建议', '一轮结束后，以灰字显示预测的下一条输入。Tab 接受，输入其他内容则忽略。建议内容随 Claude 的回复语言。', '`promptSuggestions`、`prompt_suggestion` 消息（FR-IN-10）'],
      ['中断回执', '中断后 SDK 会报告哪些排队消息仍待执行，提示条可一键取消它们，避免继续执行。', '`interrupt()` → `SDKControlInterruptResponse.still_queued`（FR-IN-07）'],
      ['发送选项', '「仅作为上下文」只把消息追加到对话里，不开始新一轮（例如贴一段日志）。「原样发送」不处理 @ 和 /。', '`shouldQuery: false`；`client_composed: true` / `verbatimPrompts`（FR-IN-08/09）'],
    ],
  });

  // ------------------------------------------------------------------ P06
  window.SCREENS.push({
    id: 'P06',
    group: '运行中的会话',
    title: '工具审批',
    summary: '工具调用需要授权时，请求停靠在输入框上方，附带做决定所需的全部信息。顶栏的收件箱汇总所有运行中会话的请求。右栏展示高风险请求的变体。',
    frs: ['FR-PERM-03..07', 'FR-PERM-06', 'FR-NTF-01'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 2 });
      s += K.sessionColumn({ active: 0 });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'requires_action' });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, '干净检出后测试还是失败。清理缓存再试一次。');
      s += t(X, 202, 'jest 缓存里有过期的转换结果。我来清理缓存并重新安装依赖。', { s: 14 });
      s += K.toolCard(X, 220, W, { icon: 'terminal', name: 'Bash', detail: 'rm -rf node_modules/.cache && npm ci', right: '已等待 0:12', st: 'wait' });

      const y = 276;
      s += rect(X, y, W, 484, { r: 10, fill: C.surface, stroke: C.warn, sw: 1.5, shadow: true });
      s += rect(X + 1, y + 1, W - 2, 50, { r: 9, fill: C.warnSoft });
      s += ic('shield', X + 16, y + 16, 20, C.warnInk);
      s += t(X + 44, y + 32, '允许执行这条命令？', { s: 15, w: 700 });
      s += chip(X + 200, y + 16, '由子代理 test-runner 发起', { icon: 'agent', bg: C.surface });
      s += t(X + W - 16, y + 31, 'Enter 确认 · Esc 拒绝', { s: 11.5, c: C.ink2, a: 'end' });
      s += ic('info', X + 16, y + 66, 16, C.ink2);
      s += t(X + 40, y + 78.5, '没有匹配这条命令的允许规则；当前会话对未授权的操作会先询问。', { s: 12.5, c: C.ink2 });
      s += code(X + 16, y + 94, W - 32, [[['$ ', C.muted], ['rm -rf node_modules/.cache && npm ci', C.ink, 600]]], { s: 13 });
      s += t(X + 16, y + 146, '清理构建缓存并重新安装依赖', { s: 12, c: C.muted, i: true });

      const oy = y + 164;
      const opts = [
        ['仅允许这一次', '1'],
        ['允许，并且以后不再询问', '2'],
        ['修改命令后允许', '3'],
        ['拒绝，并告诉 Claude 该怎么做', '4'],
      ];
      opts.forEach(([label, key], i) => {
        const ry = oy + i * 50;
        const on = i === 1;
        s += rect(X + 16, ry, W - 32, i === 3 ? 82 : 42, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += radio(X + 28, ry + 13, on, label, { w: on ? 600 : 400 });
        s += kbd(X + W - 44, ry + 12, key);
        if (i === 1) {
          s += select(X + 250, ry + 6, 170, 'Bash(npm ci)', { h: 30, mono: true, s: 12 });
          s += t(X + 430, ry + 26, '保存到', { s: 12.5, c: C.ink2 });
          s += select(X + 474, ry + 6, 216, '本项目 · 本地设置', { h: 30, s: 12 });
        }
        if (i === 3) s += input(X + 52, ry + 40, W - 120, { h: 32, ph: '例如：只清理 jest 缓存，不要重新安装', s: 12.5 });
      });
      const fy = y + 432;
      s += btn(X + 16, fy, '拒绝并停止本轮', { v: 'dangerOutline', icon: 'stop', w: 150 });
      s += btn(X + W - 156, fy, '允许并记住', { v: 'primary', w: 140 });
      s += K.composer(X, 776, W, { h: 108, ph: '在这里输入即视为拒绝，内容会作为说明发给 Claude…' });

      s += K.inspector(0);
      const bx = 1084;
      s += rect(bx, 52, 346, 260, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      s += t(bx + 16, 78, '等你处理', { s: 14, w: 700 });
      s += chip(bx + 84, 64, '2', { h: 18, bg: C.critSoft, c: C.crit });
      s += rect(bx + 8, 92, 330, 72, { r: 8, fill: C.accentSoft });
      s += ic('terminal', bx + 20, 104, 16, C.accent);
      s += t(bx + 44, 116, '修复结账测试偶发失败', { s: 13, w: 600 });
      s += t(bx + 44, 134, 'Bash · rm -rf node_modules/.cache…', { s: 11.5, m: true, c: C.ink2 });
      s += t(bx + 44, 152, '正在查看 · 0:12', { s: 11, c: C.accent });
      s += ic('pencil', bx + 20, 182, 16, C.ink2);
      s += t(bx + 44, 194, '重构鉴权中间件', { s: 13, w: 600 });
      s += t(bx + 44, 212, 'Edit · src/auth/session.ts', { s: 11.5, m: true, c: C.ink2 });
      s += t(bx + 44, 230, '已等待 1分03秒', { s: 11, c: C.warnInk });
      s += btn(bx + 276, 186, '打开', { h: 26, s: 12, w: 56 });
      s += hline(bx, 250, 346);
      s += toggle(bx + 16, 270, true, '等待时发送浏览器通知', { s: 12.5 });

      s += t(1117, 352, '变体 · 高风险请求', { s: 11, w: 700, c: C.muted, ls: 0.4 });
      s += rect(1117, 364, 307, 252, { r: 10, fill: C.surface, stroke: C.crit, sw: 1.5 });
      s += ic('warning', 1131, 380, 18, C.crit);
      s += t(1157, 394, '删除工作区外的文件？', { s: 13.5, w: 700 });
      s += code(1131, 410, 279, ['rm -rf ~/projects/old-build'], { s: 11.5 });
      s += para(1131, 460, 'Claude Code 判定这是关键路径。默认焦点在「拒绝」，没有一键批准，也不提供「始终允许」。', 279, { s: 12, c: C.ink2, lh: 17 });
      s += btn(1131, 524, '拒绝', { v: 'primary', w: 136, focus: true });
      s += btn(1275, 524, '仅此一次', { w: 135 });
      s += t(1131, 586, '输入 ALLOW 后才能点击允许', { s: 11.5, c: C.muted });

      s += mk(L.TX - 13, 236, 1) + mk(X + 198, y + 12, 2) + mk(L.TX - 13, y + 72, 3) + mk(L.TX - 13, y + 110, 4) + mk(L.TX - 13, oy + 20, 5);
      s += mk(L.TX - 13, oy + 70, 6) + mk(L.TX - 13, oy + 120, 7) + mk(L.TX - 13, oy + 170, 8) + mk(L.TX - 13, fy + 15, 9);
      s += mk(1082, 56, 10) + mk(1113, 368, 11) + mk(L.TX - 13, 790, 12);
      return s;
    },
    notes: [
      ['待审批的工具卡片', '触发请求的工具调用留在对话里，显示琥珀色「等待中」和计时；处理后更新为已批准 / 已拒绝。', '`canUseTool(toolName, input, { toolUseID })`'],
      ['请求标题', '用一句话说明要做什么。由子代理而非主 Agent 发起时显示标签；MCP 工具还会显示服务器名及其配置来源。', '`agentID`、`mcpServer { name, source }`'],
      ['为什么要问', '由 SDK 给出的原因生成的本地化说明（无允许规则、命中询问规则、规划模式、路径在工作区外…），有被拦路径时一并显示；可展开查看 SDK 原文。', '`decisionReason`、`blockedPath`（FR-I18N-06）'],
      ['操作预览', 'Bash 显示命令及其说明；Edit/Write 显示 diff；MCP 工具显示 JSON 输入；WebFetch 显示域名。', '工具 `input`（按工具类型）'],
      ['仅允许这一次', '只放行这一次调用。快捷键 1。', '`{ behavior: "allow", updatedInput: input }`'],
      ['允许并记住', '从 Claude Code 建议的规则中选一条（可编辑），再选保存位置：本会话、本项目（本地或共享设置）或所有项目。SDK 表示不应提供时隐藏。快捷键 2。', '`suggestions` → 带 `destination` 的 `updatedPermissions`；`suppressAlwaysAllowRule`'],
      ['修改后允许', '打开命令（或 JSON 输入）进行编辑，执行修改后的版本。Claude 不会被告知被修改过。快捷键 3。', '`updatedInput`'],
      ['拒绝并说明', '输入的文字作为拒绝原因返回给 Claude，让它调整做法。快捷键 4。请求未处理时在输入框发消息效果相同。输入法组字时回车不提交。', '`{ behavior: "deny", message }`（FR-I18N-07）'],
      ['拒绝并停止', '拒绝并中断本轮。', '`{ behavior: "deny", interrupt: true }`'],
      ['审批收件箱', '铃铛列出所有运行中会话的请求及已等待时间。在任一标签页处理后，其他标签页同步消失；重连后重复投递的请求按 id 去重，不会出现两次。', '`requestId`、`reinitialize()`、`session_state_changed`（FR-PERM-06/07）'],
      ['高风险变体', 'SDK 标记该请求不能被误触批准时：焦点在「拒绝」，数字快捷键失效，隐藏「记住」，需输入 ALLOW 才能允许。', '`defaultToNo`、`suppressAlwaysAllowRule`（FR-PERM-05）'],
      ['请求期间的输入框', '仍可使用：发送文字即以该文字为说明拒绝当前请求。', '`{ behavior: "deny", message }`'],
    ],
  });

  // ------------------------------------------------------------------ P07
  window.SCREENS.push({
    id: 'P07',
    group: '运行中的会话',
    title: '澄清提问',
    summary: 'Claude 调用 AskUserQuestion 时，问题以简短表单停靠在输入框上方：每个问题一步，选项卡片带说明，可并排预览，并支持自由填写「其他」。问题内容由 Claude 生成，语言跟随对话。',
    frs: ['FR-ASK-01..05', 'FR-TOOL-08'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += K.sessionColumn({ active: 2, live: [
        ['修复结账测试偶发失败', 'running', 'shop-api'],
        ['重构鉴权中间件', 'running', 'shop-api'],
        ['添加限流', 'requires_action', 'shop-api', '等你回答'],
      ] });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'requires_action', title: '添加限流', cost: '$0.09', ctx: 12 });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, '给 /orders 接口加上限流。');
      s += t(X, 202, '有几个选择会影响设计：', { s: 14 });
      s += K.toolCard(X, 216, W, { icon: 'chat', name: 'AskUserQuestion', detail: '2 个问题', right: '已等待 0:31', st: 'wait' });

      const y = 268;
      s += rect(X, y, W, 496, { r: 10, fill: C.surface, stroke: C.accent, sw: 1.5, shadow: true });
      s += ic('chat', X + 16, y + 16, 20, C.accent);
      s += t(X + 44, y + 32, 'Claude 有 2 个问题', { s: 15, w: 700 });
      s += t(X + W - 16, y + 31, '跳过，直接在对话里回复', { s: 12.5, c: C.accent, a: 'end' });
      s += rect(X + 16, y + 50, 130, 30, { r: 15, fill: C.accentSoft, stroke: C.accent });
      s += circle(X + 33, y + 65, 9, { fill: C.accent }) + t(X + 33, y + 69, '1', { s: 11, w: 700, c: '#fff', a: 'middle' });
      s += t(X + 50, y + 69.5, '存储', { s: 12.5, w: 600, c: C.accent });
      s += t(X + 84, y + 69.5, '单选', { s: 11, c: C.accent });
      s += rect(X + 156, y + 50, 130, 30, { r: 15, fill: C.surface, stroke: C.border });
      s += circle(X + 173, y + 65, 9, { fill: C.surface3 }) + t(X + 173, y + 69, '2', { s: 11, w: 700, c: C.ink2, a: 'middle' });
      s += t(X + 190, y + 69.5, '范围', { s: 12.5, w: 600, c: C.ink2 });
      s += t(X + 224, y + 69.5, '多选', { s: 11, c: C.muted });

      s += t(X + 16, y + 112, '限流计数器存放在哪里？', { s: 15, w: 600 });
      const opts = [
        ['Redis（推荐）', '多实例共享；使用现有的 Redis。', true],
        ['内存', '最简单；但限额只对单个实例生效。'],
        ['PostgreSQL', '不需新基础设施；每个请求多一次写入。'],
      ];
      opts.forEach(([label, desc, on], i) => {
        const oy = y + 130 + i * 66;
        s += rect(X + 16, oy, 370, 58, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += radio(X + 28, oy + 12, on);
        s += t(X + 54, oy + 25, label, { s: 13.5, w: 600 });
        s += t(X + 54, oy + 44, desc, { s: 12, c: C.ink2 });
        s += kbd(X + 358, oy + 10, String(i + 1));
      });
      const oy4 = y + 328;
      s += rect(X + 16, oy4, 370, 70, { r: 8, fill: C.surface, stroke: C.border });
      s += radio(X + 28, oy4 + 12, false);
      s += t(X + 54, oy4 + 25, '其他', { s: 13.5, w: 600 });
      s += kbd(X + 358, oy4 + 10, '4');
      s += input(X + 54, oy4 + 34, 316, { h: 28, ph: '描述其他方案…', s: 12.5 });

      const px = X + 402;
      s += rect(px, y + 130, 329, 268, { r: 8, fill: C.surface2, stroke: C.border });
      s += t(px + 12, y + 150, '预览 · Redis', { s: 11, w: 700, c: C.muted });
      s += t(px + 317, y + 150, '在沙箱中渲染的 HTML', { s: 10.5, c: C.muted, a: 'end' });
      s += rect(px + 12, y + 162, 305, 222, { r: 6, fill: C.surface, stroke: C.border });
      ['API #1', 'API #2', 'API #3'].forEach((n, i) => {
        s += box(px + 28, y + 178 + i * 46, 96, 34, n, null, { s: 12 });
        s += arrow(px + 126, y + 195 + i * 46, px + 196, y + 240);
      });
      s += box(px + 198, y + 218, 104, 44, 'Redis', 'INCR + EXPIRE', { fill: C.accentSoft, stroke: C.accentLine, s: 12 });
      s += t(px + 28, y + 336, 'limit: 100 req / min per API key', { s: 11.5, m: true, c: C.ink2 });
      s += t(px + 28, y + 354, 'window: sliding, 60 s', { s: 11.5, m: true, c: C.ink2 });
      s += t(px + 28, y + 372, 'on limit: 429 + Retry-After', { s: 11.5, m: true, c: C.ink2 });

      s += input(X + 16, y + 412, W - 32, { h: 32, ph: '给 Claude 的补充说明（可选）', icon: 'pencil' });
      s += hline(X, y + 456, W);
      s += t(X + 16, y + 482, '1–4 选择 · Enter 下一题 · Shift Tab 上一题', { s: 12, c: C.muted });
      s += btn(X + W - 206, y + 464, '上一题', { w: 74 });
      s += btn(X + W - 124, y + 464, '下一题', { v: 'primary', w: 108 });
      s += K.composer(X, 776, W, { h: 108, ph: '或者用你自己的话一次性回答所有问题…' });

      s += K.inspector(0);
      s += t(L.IX + L.IW / 2, 220, '暂无任务', { s: 13, w: 600, c: C.ink2, a: 'middle' });
      s += t(L.IX + L.IW / 2, 240, 'Claude 开始干活后会在这里列出任务。', { s: 12, c: C.muted, a: 'middle' });

      s += mk(L.TX - 13, 232, 1) + mk(X + 20, y + 52, 2) + mk(L.TX - 13, y + 108, 3) + mk(L.TX - 13, y + 160, 4) + mk(X + 380, y + 132, 5);
      s += mk(L.TX - 13, oy4 + 20, 6) + mk(px + 324, y + 134, 7) + mk(L.TX - 13, y + 428, 8) + mk(X + W - 6, y + 468, 9) + mk(L.TX - 13, 790, 10);
      return s;
    },
    notes: [
      ['对话中的提问卡片', 'Claude 的 AskUserQuestion 调用显示为等待中的卡片；回答后卡片显示问题和所选答案。', '经 `canUseTool` 的 `AskUserQuestion`（FR-TOOL-08）'],
      ['问题步骤', '每个问题一个胶囊，使用 Claude 写的简短标题（最多 12 个字符）并注明单选或多选。已答的打勾，点击可跳转。', '`questions[].header`、`multiSelect`'],
      ['问题', 'Claude 写的完整问题，语言跟随对话（可在配置方案中指定回复语言）。', '`questions[].question`；`settings.language`（FR-I18N-05）'],
      ['选项卡片', '2–4 个带说明的选项。单选为单选卡片，多选为复选框。数字键选择。', '`questions[].options[]`（`label`、`description`）'],
      ['推荐选项', 'Claude 会在标签里标出推荐项；界面保留原文，不自动预选。', '选项 `label`'],
      ['其他', '没有合适选项时自由填写，填写内容即该问题的答案。', '`answers[question] = text`'],
      ['预览', 'Claude 提供预览时（在配置方案中开启），悬停或选中选项即显示。HTML 预览在禁用脚本的沙箱框架中渲染。', '`toolConfig.askUserQuestion.previewFormat`、`options[].preview`（FR-ASK-03）'],
      ['补充说明', '附在答案上的可选说明，例如「只针对已登录用户」。', '`annotations[question].notes`（FR-ASK-04）'],
      ['切换与提交', '「下一题」逐题前进，最后一题按钮变为「提交回答」。答案连同原问题一起返回。', '`{ behavior: "allow", updatedInput: { questions, answers } }`'],
      ['用自己的话回答', '在输入框里输入，可一次性回答所有问题，不必使用表单。', '`updatedInput.response`'],
    ],
  });

  // ------------------------------------------------------------------ P08
  window.SCREENS.push({
    id: 'P08',
    group: '运行中的会话',
    title: '计划审阅',
    summary: '规划模式下 Claude 只探索不修改，最后给出计划。计划以文档形式展示；操作栏可以在批准的同时选择执行时的权限模式，或附上意见退回。',
    frs: ['FR-PLAN-01..03', 'FR-PERM-01', 'FR-TOOL-10'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += K.sessionColumn({ active: 2, live: [
        ['修复结账测试偶发失败', 'running', 'shop-api'],
        ['重构鉴权中间件', 'running', 'shop-api'],
        ['添加限流', 'requires_action', 'shop-api', '计划待审阅'],
      ] });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'requires_action', title: '添加限流', mode: '规划模式', modeIcon: 'list', modeBg: '#eef6ff', modeStroke: '#9ec5f4', modeInk: '#184f95', cost: '$0.31', ctx: 24 });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, '用 Redis。先出计划，我审过之后再改代码。');
      s += rect(X, 186, W, 30, { r: 6, fill: C.surface, stroke: C.border });
      s += ic('list', X + 10, 193, 16, C.ink2);
      s += t(X + 34, 205.5, '读取 9 个文件 · 搜索 3 个模式 · 1 个子代理（Explore）· 48 秒', { s: 12.5, c: C.ink2 });

      const y = 230;
      s += rect(X, y, W, 482, { r: 10, fill: C.surface, stroke: '#9ec5f4', sw: 1.5 });
      s += rect(X + 1, y + 1, W - 2, 44, { r: 9, fill: '#eef6ff' });
      s += ic('list', X + 16, y + 14, 18, '#184f95');
      s += t(X + 42, y + 28, '计划', { s: 14, w: 700, c: '#184f95' });
      s += chip(X + 80, y + 13, 'v2', { h: 18, bg: C.surface });
      s += t(X + W - 16, y + 28, '等待你批准', { s: 12, c: '#184f95', a: 'end' });
      let py = y + 76;
      s += t(X + 20, py, '为 POST /orders 添加限流', { s: 17, w: 700 });
      s += t(X + 20, py + 26, '按 API Key 的滑动窗口限流（100 次/分钟），基于现有 Redis，超限返回 429 和 Retry-After。', { s: 13, c: C.ink2 });
      py += 62;
      s += t(X + 20, py, '步骤', { s: 14, w: 700 });
      const steps = [
        '在 src/middleware/rate-limit.ts 中实现 RateLimiter（INCR + EXPIRE）',
        '从 config/limits.yaml 读取限额，默认 100 次/分钟',
        '只在 POST /orders 上挂载该中间件',
        '用假 Redis 写单元测试，再加一个集成测试',
        '在 docs/api/orders.md 中说明 429 响应',
      ];
      steps.forEach((st, i) => {
        s += t(X + 24, py + 26 + i * 24, `${i + 1}.`, { s: 13, w: 600, c: C.ink2 });
        s += t(X + 44, py + 26 + i * 24, st, { s: 13 });
      });
      py += 160;
      s += t(X + 20, py, '文件', { s: 14, w: 700 });
      let fx = X + 20;
      ['src/middleware/rate-limit.ts  新增', 'src/routes/orders.ts', 'config/limits.yaml  新增', 'tests/rate-limit.test.ts  新增', 'docs/api/orders.md'].forEach((f) => {
        const w = chip.w(f, { m: true, icon: 1 });
        if (fx + w > X + W - 20) fx = X + 20, py += 26;
        s += chip(fx, py + 12, f, { m: true, icon: 'file', h: 20 });
        fx += w + 6;
      });
      py += 64;
      s += t(X + 20, py, '风险', { s: 14, w: 700 });
      s += t(X + 24, py + 24, '•  Redis 故障会阻塞下单——改为放行并记录告警日志。', { s: 13 });
      s += t(X + 24, py + 46, '•  共用 NAT 的客户端只有共用同一 API Key 时才共享限额（可接受）。', { s: 13 });

      const ay = 724;
      s += rect(X, ay, W, 160, { r: 10, fill: C.surface, stroke: C.borderStrong, shadow: true });
      s += t(X + 16, ay + 28, '可以开始实现了吗？', { s: 14, w: 700 });
      s += t(X + 160, ay + 28, '批准后会话将退出规划模式。', { s: 12, c: C.muted });
      s += btn(X + 16, ay + 44, '批准 · 自动接受编辑', { v: 'primary', icon: 'check', w: 180 });
      s += btn(X + 204, ay + 44, '批准 · 每步都询问', { w: 156 });
      s += btn(X + 368, ay + 44, '批准 · 自动模式', { icon: 'spark', w: 150 });
      s += hline(X + 16, ay + 92, W - 32);
      s += input(X + 16, ay + 108, W - 172, { h: 34, ph: '告诉 Claude 计划要怎么改…' });
      s += btn(X + W - 148, ay + 110, '继续规划', { w: 132 });

      s += K.inspector(0, { tabs: ['计划', '任务', '变更', '检查点', '上下文'] });
      const IX = L.IX + 16;
      s += t(IX, 152, '计划版本', { s: 13, w: 600 });
      s += rect(IX, 166, 307, 58, { r: 8, fill: C.accentSoft, stroke: C.accentLine });
      s += t(IX + 12, 188, 'v2 · 当前', { s: 13, w: 600, c: C.accent });
      s += t(IX + 12, 208, '刚刚 · 根据你的回答「Redis」', { s: 11.5, c: C.ink2 });
      s += rect(IX, 232, 307, 58, { r: 8, fill: C.surface, stroke: C.border });
      s += t(IX + 12, 254, 'v1', { s: 13, w: 600 });
      s += t(IX + 12, 274, '6 分钟前 · 内存存储方案', { s: 11.5, c: C.ink2 });
      s += t(IX, 316, '对比 v1 ↔ v2', { s: 12.5, c: C.accent });
      s += hline(L.IX, 336, L.IW);
      s += t(IX, 362, '规划模式', { s: 13, w: 600 });
      s += kv(IX, 388, '工作流说明', '配置方案：团队规划', { kw: 96 });
      s += kv(IX, 410, '只读', '编辑总是需要询问', { kw: 96 });
      s += kv(IX, 432, '批准后', '自动接受编辑', { kw: 96 });

      s += mk(704, 64, 1) + mk(L.TX - 13, y + 22, 2) + mk(L.TX - 13, y + 140, 3) + mk(X + 18, ay + 46, 4) + mk(X + 206, ay + 46, 5);
      s += mk(X + 370, ay + 46, 6) + mk(L.TX - 13, ay + 124, 7) + mk(L.IX + 90, 147, 8);
      return s;
    },
    notes: [
      ['标题栏中的规划模式', '权限模式菜单以独立颜色显示「规划模式」。会话中随时可以切到规划模式，此后 Claude 不再修改文件，最后给出计划。', '`setPermissionMode("plan")`、`EnterPlanMode`'],
      ['计划卡片', 'Claude 通过 ExitPlanMode 提交的计划，以 Markdown 渲染。卡头显示版本和「等待批准」。', '经 `canUseTool` 的 `ExitPlanMode`（FR-TOOL-10）'],
      ['计划内容', 'Markdown 渲染，文件标签可点击打开对应文件。计划较长时在卡片内滚动，操作栏始终可见。', '计划文本'],
      ['批准 · 自动接受编辑', '批准并把会话切到「自动接受编辑」，Claude 实施时不再逐个文件询问。', '`allow` + `setPermissionMode("acceptEdits")`（FR-PLAN-01）'],
      ['批准 · 每步都询问', '批准并回到默认模式，编辑和命令仍需审批。', '`allow` + `setPermissionMode("default")`'],
      ['批准 · 自动模式', '批准并由分类模型审查每个操作。仅在模型支持自动模式时显示。', '`allow` + `setPermissionMode("auto")`；`ModelInfo.supportsAutoMode`'],
      ['继续规划', '发送意见；Claude 留在规划模式并给出新版本。', '`{ behavior: "deny", message: 意见 }`'],
      ['计划版本', '本会话的所有计划版本，可对比版本差异；以及规划模式设置：配置方案中的自定义工作流说明、批准后使用的模式。', '对话记录；`planModeInstructions`（FR-PLAN-02/03）'],
    ],
  });
})();
