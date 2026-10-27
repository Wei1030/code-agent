/* Screens P09–P16: subagents, rewind, context and cost, history, MCP, elicitation, agents, skills. */
(function () {
  'use strict';
  const K = window.K;
  const { C, t, rect, line, path, circle, box, btn, chip, status, input, select, textarea, toggle, check,
    radio, panel, hline, vline, mk, code, diff, overlay, tabs, seg, progress, kbd, para, ic, tw, kv, runs, L } = K;

  /** Live session base: shell, session column, header. */
  function sessionBase(o = {}) {
    let s = K.shell({ nav: 'sessions', approvals: o.approvals ?? 0 });
    s += K.sessionColumn({ active: o.active ?? 0, live: o.live });
    s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
    s += K.sessionHeader(L.MX, 49, L.MW, o.header ?? {});
    return s;
  }

  /** One row of a nested (subagent) transcript. */
  function nestedRow(x, y, icon, text, right) {
    let s = ic(icon, x, y - 12, 15, C.ink2);
    s += t(x + 22, y, text, { s: 12.5, m: icon !== 'chat' });
    if (right) s += t(x + 640, y, right, { s: 11.5, c: C.muted, a: 'end' });
    return s;
  }

  // ------------------------------------------------------------------ P09
  window.SCREENS.push({
    id: 'P09',
    group: '运行中的会话',
    title: '子代理与后台任务',
    summary: '子代理显示为可展开的卡片，带实时进度和嵌套的对话记录。耗时长的命令和代理可以转入后台；「后台」标签页跟踪所有脱离当前轮运行的工作。',
    frs: ['FR-AGT-04', 'FR-TOOL-06', 'FR-BG-01..05', 'FR-TOOL-11'],
    draw() {
      let s = sessionBase({ header: { state: 'running', cost: '$1.12', ctx: 44 } });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, '找出所有用到 CartTimer 的地方；修改的同时在后台跑一遍 e2e 测试。');
      s += t(X, 202, '我让一个子代理去梳理调用点，同时在后台启动 e2e 测试。', { s: 14 });

      const ay = 220;
      s += K.toolCard(X, ay, W, { icon: 'agent', name: 'Agent', detail: 'Explore · 查找 CartTimer 的所有用法', right: '0:38 · haiku', st: 'run', bodyH: 192, body: ' ' });
      s += ic('spark', X + 14, ay + 48, 15, C.accent);
      s += t(X + 36, ay + 60, '正在扫描 src/cart 和 tests —— 已读 14 个文件，找到 3 处调用', { s: 12.5, i: true, c: C.accent });
      s += line(X + 22, ay + 76, X + 22, ay + 196, { c: C.accentLine, sw: 2 });
      s += nestedRow(X + 36, ay + 96, 'file', 'Read src/cart/timer.ts', '✓');
      s += nestedRow(X + 36, ay + 120, 'search', 'Grep "CartTimer" in src/**', '7 处匹配');
      s += nestedRow(X + 36, ay + 144, 'file', 'Read src/checkout/session.ts', '✓');
      s += ic('chat', X + 36, ay + 156, 15, C.ink2);
      s += t(X + 58, ay + 168, '调用点：session.ts:41、cart.ts:88、tests/helpers.ts:12。正在检查 helpers', { s: 12.5, c: C.ink2 });
      s += t(X + 58, ay + 186, '里是否还有第二个计时器实例…', { s: 12.5, c: C.ink2 });
      s += chip(X + 14, ay + 204, '18.2k tokens', { h: 18, s: 10.5 });
      s += chip(X + 104, ay + 204, '9 次工具调用', { h: 18, s: 10.5 });
      s += t(X + W - 14, ay + 217, '折叠 · 打开完整记录', { s: 12, c: C.accent, a: 'end' });

      s += K.toolCard(X, 458, W, { icon: 'agent', name: 'Agent', detail: 'test-runner · 运行 e2e 测试', right: '后台', st: 'run' });
      s += chip(X + 450, 467, '已在后台运行', { icon: 'layers', bg: C.accentSoft, c: C.accent });

      s += K.toolCard(X, 506, W, {
        icon: 'terminal', name: 'Bash', detail: 'npm run build -- --watch', right: '1:12', st: 'run', bodyH: 96,
        body: code(X + 12, 552, W - 24, ['webpack 5.97 compiled successfully in 2310 ms', 'watching for file changes…'], { s: 11.5 }) +
          btn(X + 12, 608, '转入后台', { icon: 'layers', h: 26, s: 12, w: 100 }) + kbd(X + 120, 612, 'Ctrl B') +
          btn(X + W - 76, 608, '停止', { icon: 'stop', h: 26, s: 12, w: 64, v: 'dangerOutline' }),
      });

      s += rect(X, 652, W, 36, { r: 8, fill: C.goodSoft, stroke: '#b7e3b7' });
      s += ic('check', X + 12, 662, 16, C.goodInk, 2.2);
      s += t(X + 36, 674.5, '后台任务已完成：e2e 第 1/4 组通过（42 个测试，2分51秒）', { s: 12.5, c: C.goodInk, w: 500 });
      s += t(X + W - 14, 674.5, '查看输出', { s: 12, c: C.accent, a: 'end' });
      s += t(X, 728, '有两处调用各自创建了计时器，我现在把它们改为使用共享的时钟。', { s: 14 });
      s += K.composer(X, 776, W, { running: true, h: 108 });

      s += K.inspector(1);
      const IX = L.IX + 16;
      s += btn(IX, 136, '把当前工作转入后台', { icon: 'layers', w: 180, h: 30, s: 12.5 });
      s += kbd(IX + 188, 142, 'Ctrl B');
      const items = [
        ['agent', 'test-runner', '子代理 · 运行中', '正在跑 jest 第 2/4 组…', '3分02秒 · 41.3k tokens', 'run', '停止'],
        ['terminal', 'npm run e2e', 'Bash · 运行中', null, '3分12秒', 'run', '停止'],
        ['agent', 'Explore', '子代理 · 已完成', '梳理出 3 处调用', '0:52 · 22.0k', 'ok', '报告'],
        ['braces', 'audit-deps', '工作流 · 失败', '退出码 1 —— 2 条安全公告', '1分40秒', 'err', '输出'],
        ['eye', 'tail -f logs/app.log', '监视器 · 运行中', '最近事件在 4 秒前', '', 'run', '停止'],
      ];
      let y = 180;
      items.forEach(([icn, name, kind, sum, meta, st, act], i) => {
        const h = sum ? 76 : 58;
        s += rect(IX, y, 307, h, { r: 8, fill: C.surface, stroke: C.border });
        s += ic(icn, IX + 10, y + 10, 16, C.ink2);
        s += t(IX + 34, y + 22, name, { s: 13, w: 600, m: icn === 'terminal' || icn === 'eye' });
        const sc = st === 'ok' ? ['good', '完成'] : st === 'err' ? ['crit', '失败'] : ['info', '运行中'];
        s += status(IX + 307 - 10 - K.chip.w(sc[1], { icon: 1 }), y + 9, sc[0], sc[1]);
        s += t(IX + 34, y + 40, kind + (meta ? ' · ' + meta : ''), { s: 11.5, c: C.muted });
        if (sum) s += t(IX + 34, y + 60, sum, { s: 12, i: st === 'run', c: st === 'err' ? C.crit : C.ink2 });
        const bw = K.btnW(act, { s: 11.5 });
        s += btn(IX + 297 - bw, y + h - 30, act, { h: 24, s: 11.5, v: act === '停止' ? 'dangerOutline' : 'secondary' });
        if (i === 0) {
          s += rect(IX + 20, y + h + 4, 287, 40, { r: 8, fill: C.surface2, stroke: C.border });
          s += t(IX + 30, y + h + 21, '↳ Explore', { s: 12.5, w: 600 });
          s += t(IX + 30, y + h + 37, '嵌套子代理 · 运行中 · 0:21', { s: 11, c: C.muted });
          y += 46;
        }
        y += h + 8;
      });
      s += t(IX, 640, '子代理上限（来自配置方案）：3 层 · 同时 20 个', { s: 11.5, c: C.muted });

      s += mk(L.TX - 13, ay + 18, 1) + mk(L.TX - 13, ay + 56, 2) + mk(L.TX - 13, ay + 120, 3) + mk(L.TX - 13, 476, 4) + mk(L.TX - 13, 620, 5);
      s += mk(L.TX - 13, 670, 6) + mk(L.IX + 10, 200, 7) + mk(L.IX + 12, 151, 8) + mk(IX + 250, 230, 9) + mk(L.IX + 10, 290, 10);
      return s;
    },
    notes: [
      ['子代理卡片', '显示子代理类型、Claude 交给它的任务、所用模型和实时计时。点击折叠或展开。', '`Agent` 工具调用；`task_started`；`SubagentStart` 钩子（FR-TOOL-06）'],
      ['进度摘要', '子代理工作时持续更新的一行摘要，折叠状态下也有用。', '`agentProgressSummaries` → `task_progress.summary`'],
      ['嵌套记录', '子代理自己的工具调用和文字，缩进显示在卡片下。「打开完整记录」全宽查看；嵌套的子代理继续缩进。', '`forwardSubagentText`、`parent_tool_use_id`、`agent_id`'],
      ['后台子代理', '定义为后台运行（或被转入后台）的代理会立即交还控制权；卡片链接到「后台」标签页。', '`AgentDefinition.background`；`task_updated`'],
      ['转入后台', '运行中的 Bash 命令和子代理都可以转入后台：本轮继续，工作也继续运行。Ctrl B 把所有前台工作转入后台。', '`backgroundTasks(toolUseId?)`（FR-BG-03）'],
      ['后台完成提示', '后台工作完成、失败或被停止时，对话中出现一行提示；若标签页不在前台，还会发送浏览器通知。', '`task_notification`（`status`、`summary`、`output_file`）（FR-BG-05）'],
      ['后台标签页', '每项脱离运行的工作：类型、状态、耗时、token 用量和最新摘要。已结束的保留到会话结束。', '`task_started` / `task_progress` / `task_updated` / `background_tasks_changed`（FR-BG-01）'],
      ['把当前工作转入后台', '等同于 Ctrl B，作用于本轮正在等待的所有工作。', '`backgroundTasks()`'],
      ['停止 / 查看输出', '「停止」结束单个任务；「输出」在查看器中打开任务的输出文件。', '`stopTask(taskId)`；`readFile(output_file)`（FR-BG-02/04）'],
      ['嵌套子代理', '由子代理再启动的子代理显示为子项，层级一目了然；层数和并发上限来自配置方案。', '`parent_task_id`；`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`、`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`'],
    ],
  });

  // ------------------------------------------------------------------ P10
  window.SCREENS.push({
    id: 'P10',
    group: '运行中的会话',
    title: '检查点与回退',
    summary: '每条用户消息都是 Claude 所编辑文件的还原点。「检查点」标签页列出这些还原点；回退前总会先演练（dry run），准确列出会改动什么、哪些无法还原。',
    frs: ['FR-CKPT-01..05', 'FR-SES-10'],
    draw() {
      let s = sessionBase({ header: { state: 'idle', cost: '$0.88', ctx: 41 } });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 140, W, '给计时器补上测试。', { hover: true });
      s += t(X, 210, '在 timer.test.ts 中新增 6 个测试，并加了一个假时钟辅助函数。', { s: 14 });
      s += K.toolCard(X, 224, W, { icon: 'file', name: 'Write', detail: 'src/cart/timer.test.ts', right: '+96', st: 'ok' });
      s += K.toolCard(X, 270, W, { icon: 'file', name: 'Write', detail: 'tests/helpers/clock.ts', right: '+12', st: 'ok' });
      s += K.userMsg(X, 330, W, '退款流程也处理一下。');
      s += K.toolCard(X, 396, W, { icon: 'pencil', name: 'Edit', detail: 'src/orders/refund.ts', right: '+22 −8', st: 'ok' });

      s += K.inspector(3);
      const IX = L.IX + 16;
      s += para(IX, 148, '回退可还原本会话中 Edit 和 Write 改过的文件。', 300, { s: 12, c: C.muted, lh: 16 });
      const cps = [
        ['#4', '退款流程也处理一下', '2 分钟前 · 1 个文件'],
        ['#3', '给计时器补上测试', '9 分钟前 · 2 个文件', true],
        ['#2', '修一下', '14 分钟前 · 1 个文件'],
        ['#1', 'CI 上结账测试偶尔失败…', '21 分钟前 · 起点'],
      ];
      cps.forEach(([n, msg, meta, on], i) => {
        const y = 182 + i * 62;
        s += rect(IX, y, 307, 54, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border });
        s += t(IX + 12, y + 22, n, { s: 12, w: 700, c: C.muted });
        s += t(IX + 40, y + 22, msg, { s: 13, w: 600 });
        s += t(IX + 40, y + 41, meta, { s: 11.5, c: C.muted });
        s += btn(IX + 271, y + 13, '', { icon: 'rewind', w: 28, h: 28 });
      });

      s += overlay();
      const mx = 400;
      const my = 150;
      s += rect(mx, my, 640, 600, { r: 12, fill: C.surface, shadow: true });
      s += t(mx + 24, my + 40, '把文件回退到消息 #3 之前？', { s: 18, w: 700 });
      s += t(mx + 24, my + 64, '「给计时器补上测试」· 9 分钟前', { s: 13, c: C.ink2 });
      s += ic('x', mx + 604, my + 22, 18, C.ink2);
      s += hline(mx, my + 82, 640);
      s += t(mx + 24, my + 112, '预览 · 演练结果', { s: 11.5, w: 700, c: C.muted });
      s += t(mx + 616, my + 112, '4 个文件 · +12 −148', { s: 12.5, w: 600, a: 'end' });
      const files = [
        ['src/cart/timer.test.ts', '删除 · 在此之后创建', '', '−96'],
        ['tests/helpers/clock.ts', '删除 · 在此之后创建', '', '−12'],
        ['src/orders/refund.ts', '还原', '+8', '−22'],
        ['src/cart/timer.ts', '还原', '+4', '−18'],
      ];
      s += rect(mx + 24, my + 124, 592, 4 * 40 + 2, { r: 8, fill: C.surface, stroke: C.border });
      files.forEach(([f, what, add, del], i) => {
        const y = my + 125 + i * 40;
        if (i) s += hline(mx + 24, y, 592, '#eef0f4');
        const deleted = what.startsWith('删除');
        s += ic(deleted ? 'trash' : 'rewind', mx + 36, y + 12, 16, deleted ? C.crit : C.ink2);
        s += t(mx + 60, y + 25, f, { s: 12.5, m: true });
        s += t(mx + 330, y + 25, what, { s: 12, c: C.ink2 });
        s += t(mx + 566, y + 25, add, { s: 12, w: 600, c: C.addInk, a: 'end' });
        s += t(mx + 604, y + 25, del, { s: 12, w: 600, c: C.delInk, a: 'end' });
      });
      const wy = my + 300;
      s += rect(mx + 24, wy, 592, 78, { r: 8, fill: C.warnSoft, stroke: '#f1d38a' });
      s += ic('warning', mx + 36, wy + 12, 16, C.warnInk);
      s += t(mx + 60, wy + 25, '不会还原', { s: 13, w: 700, c: C.warnInk });
      s += t(mx + 60, wy + 45, 'Bash 命令造成的改动（npm install 执行过两次）、子代理所做的编辑，', { s: 12, c: C.ink2 });
      s += t(mx + 60, wy + 63, '以及目录的创建/删除。跳过 1 个符号链接。这些请用 git 处理。', { s: 12, c: C.ink2 });
      const oy = my + 398;
      s += rect(mx + 24, oy, 592, 54, { r: 8, fill: C.surface, stroke: C.border });
      s += radio(mx + 36, oy + 10, false, '只回退文件', { w: 600 });
      s += t(mx + 60, oy + 42, '对话保持不变；会告知 Claude 文件已被还原。', { s: 12, c: C.muted });
      s += rect(mx + 24, oy + 62, 592, 54, { r: 8, fill: C.accentSoft, stroke: C.accent, sw: 1.5 });
      s += radio(mx + 36, oy + 72, true, '回退文件，并从这里分叉对话', { w: 600 });
      s += t(mx + 60, oy + 104, '打开一个停在消息 #2 的新会话，原会话保持不变。', { s: 12, c: C.ink2 });
      s += hline(mx, my + 540, 640);
      s += btn(mx + 430, my + 556, '取消', { w: 70 });
      s += btn(mx + 508, my + 556, '回退文件', { v: 'danger', icon: 'rewind', w: 108 });

      s += mk(X + W - 184, 124, 1) + mk(L.IX + 10, 186, 2) + mk(mx + 16, my + 108, 3) + mk(mx + 20, my + 140, 4) + mk(mx + 20, wy + 14, 5);
      s += mk(mx + 20, oy + 14, 6) + mk(mx + 20, oy + 76, 7) + mk(mx + 504, my + 556, 8);
      return s;
    },
    notes: [
      ['消息操作', '悬停在用户消息上出现「回退文件」（把文件还原到这条消息之前）和「分叉」（新建一个停在这里的会话）。', '`SDKUserMessage.uuid`；`forkSession({ upToMessageId })`'],
      ['检查点时间线', '每条用户消息一行，显示其后改动的文件数。回退按钮打开对应的对话框。会话未开启检查点时隐藏。', '`enableFileCheckpointing`、`replay-user-messages`（FR-CKPT-01/02）'],
      ['演练摘要', '打开对话框时先演练一次，汇总数据来自演练结果。无法回退时，原因替代预览显示。', '`rewindFiles(uuid, { dryRun: true })` → `canRewind`、`error`、`insertions`、`deletions`'],
      ['将改动的文件', '每个文件及其处理方式：删除（Claude 之后才创建的）或还原，附行数变化。', '`RewindFilesResult.filesChanged`'],
      ['不会还原的内容', '始终显示：Bash 造成的改动、子代理的编辑、目录和远程文件不在检查点范围内；统计跳过的链接数。', '`skippedLinks`；文档所述限制（FR-CKPT-05）'],
      ['只回退文件', '还原文件；对话记录不变，并追加一条说明让 Claude 知道。', '`rewindFiles(uuid)`'],
      ['回退并分叉', '还原文件，再从该点之前的消息分叉会话并打开分叉。检查点不会带到分叉中。', '`rewindFiles(uuid)` + `forkSession({ upToMessageId })`（FR-CKPT-04）'],
      ['确认', '危险样式；默认 Enter 不触发。成功后提示可「打开分叉」，并说明此操作不能撤销，可用 git 恢复。', '—'],
    ],
  });

  // ------------------------------------------------------------------ P11
  window.SCREENS.push({
    id: 'P11',
    group: '运行中的会话',
    title: '上下文与费用',
    summary: '检查器展开为宽抽屉。左侧：上下文窗口被哪些内容占用（按类别），以及背后的文件和工具，还有压缩控制。右侧：本会话按模型的费用、预算上限和速率限制状态。',
    frs: ['FR-CTX-01..03', 'FR-COST-01..05', 'FR-PROMPT-03', 'FR-I18N-04'],
    draw() {
      let s = sessionBase({ header: { state: 'idle', cost: '$0.42', ctx: 38 } });
      s += K.userMsg(L.TX, 130, 300, '总结一下改了什么。');
      s += rect(640, 49, 800, 851, { fill: C.surface, shadow: true });
      s += vline(640, 49, 851);
      s += t(664, 80, '上下文与费用', { s: 16, w: 700 });
      s += tabs(820, 80, ['任务', '后台', '变更', '检查点', '上下文与费用'], 4, { s: 13, gap: 22 });
      s += ic('x', 1404, 66, 18, C.ink2);
      s += hline(640, 96, 800);

      const X = 664;
      s += t(X, 140, '76.4k', { s: 30, w: 700 });
      s += t(X + 92, 140, '/ 200k tokens · 38%', { s: 14, c: C.ink2 });
      s += t(X, 162, 'claude-opus-5-5 · 接近上限时自动压缩 · 上一轮结束后更新', { s: 12, c: C.muted });
      const cats = [
        ['系统提示词', 3100, 0], ['系统工具', 14200, 1], ['MCP 工具', 6800, 2], ['记忆文件', 2500, 3],
        ['技能', 1200, 4], ['消息', 48600, 5],
      ];
      const bw = 460;
      let bx = X;
      const by = 180;
      cats.forEach(([, tok, slot]) => {
        const w = (tok / 200000) * bw;
        s += rect(bx, by, Math.max(w - 2, 2), 20, { fill: C.series[slot], r: 2 });
        bx += w;
      });
      const bufW = (16000 / 200000) * bw;
      s += rect(bx, by, bufW - 2, 20, { fill: 'url(#hatch)', r: 2 });
      bx += bufW;
      s += rect(bx, by, X + bw - bx, 20, { fill: C.surface3, r: 2 });
      s += t(X, 228, '类别', { s: 11, w: 700, c: C.muted });
      s += t(X + 380, 228, 'TOKENS', { s: 10.5, w: 700, c: C.muted, ls: 0.4, a: 'end' });
      s += t(X + 460, 228, '占比', { s: 11, w: 700, c: C.muted, a: 'end' });
      const rows = [...cats.map(([n, tok, slot]) => [n, tok, C.series[slot]]), ['压缩预留', 16000, 'url(#hatch)'], ['空闲', 107600, C.surface3]];
      rows.forEach(([n, tok, fill], i) => {
        const y = 240 + i * 24;
        s += rect(X, y + 4, 12, 12, { r: 3, fill, stroke: fill === C.surface3 ? C.borderStrong : undefined });
        s += t(X + 22, y + 15, n, { s: 12.5 });
        s += t(X + 380, y + 15, (tok / 1000).toFixed(1) + 'k', { s: 12.5, a: 'end' });
        s += t(X + 460, y + 15, ((tok / 200000) * 100).toFixed(1) + '%', { s: 12.5, c: C.ink2, a: 'end' });
      });
      s += t(X, 450, '延迟加载的工具定义（不计入）：41 个工具 · 12.3k', { s: 11.5, c: C.muted });

      s += t(X, 486, '记忆文件', { s: 13.5, w: 700 });
      [['CLAUDE.md', '1.9k'], ['.claude/rules/testing.md', '0.4k'], ['~/.claude/CLAUDE.md', '0.2k']].forEach(([f, tok], i) => {
        const y = 498 + i * 24;
        s += ic('file', X, y + 3, 14, C.ink2);
        s += t(X + 22, y + 15, f, { s: 12.5, m: true });
        s += t(X + 380, y + 15, tok, { s: 12.5, a: 'end' });
      });
      s += t(X, 600, 'MCP 工具', { s: 13.5, w: 700 });
      [['github', '28 个工具 · 22 个延迟加载', '3.9k'], ['postgres', '6 个工具', '2.9k']].forEach(([n, d, tok], i) => {
        const y = 612 + i * 24;
        s += ic('plug', X, y + 3, 14, C.ink2);
        s += t(X + 22, y + 15, n, { s: 12.5, w: 600 });
        s += t(X + 100, y + 15, d, { s: 12, c: C.muted });
        s += t(X + 380, y + 15, tok, { s: 12.5, a: 'end' });
      });
      s += btn(X, 684, '立即压缩…', { icon: 'layers', w: 130 });
      s += btn(X + 140, 684, '清空对话', { icon: 'trash', w: 120, v: 'dangerOutline' });
      s += btn(X + 270, 684, '精确统计', { icon: 'refresh', w: 120 });
      s += rect(X, 730, 460, 112, { r: 8, fill: C.surface2, stroke: C.border, dash: '4 3' });
      s += t(X + 12, 752, '立即压缩…', { s: 12.5, w: 700 });
      s += textarea(X + 12, 762, 436, 44, ['保留失败测试的名称和关于计时器的决定。'], { s: 12 });
      s += btn(X + 360, 812, '压缩', { v: 'primary', h: 26, s: 12, w: 88 });
      s += t(X + 12, 830, '182k → 约 40k tokens', { s: 11.5, c: C.muted });

      const R = 1160;
      s += vline(1144, 112, 760);
      s += t(R, 140, '$0.42', { s: 30, w: 700 });
      s += t(R + 92, 140, '本会话', { s: 13, c: C.ink2 });
      s += t(R, 166, '预算上限 $5.00', { s: 12, c: C.muted });
      s += t(R + 256, 166, '8%', { s: 12, w: 600, a: 'end' });
      s += progress(R, 174, 256, 8, C.accent, 6);
      s += t(R, 214, '按模型', { s: 13.5, w: 700 });
      const models = [
        ['Opus 5.5', '主 Agent', '$0.38', [['输入', '182k'], ['输出', '21.4k'], ['缓存读取', '1.24M'], ['缓存写入', '96k']]],
        ['Haiku 4.5', '子代理', '$0.04', [['输入', '64k'], ['输出', '6.1k'], ['缓存读取', '310k'], ['网页搜索', '0']]],
      ];
      models.forEach(([m, role, cost, kvs], i) => {
        const y = 226 + i * 150;
        s += rect(R, y, 256, 138, { r: 8, fill: C.surface, stroke: C.border });
        s += t(R + 12, y + 22, m, { s: 13, w: 700 });
        s += t(R + 12 + tw(m, 13, false, true) + 8, y + 22, role, { s: 11.5, c: C.muted });
        s += t(R + 244, y + 22, cost, { s: 13, w: 700, a: 'end' });
        kvs.forEach(([k, v], j) => {
          s += t(R + 12, y + 50 + j * 22, k, { s: 12, c: C.muted });
          s += t(R + 244, y + 50 + j * 22, v, { s: 12, a: 'end' });
        });
      });
      s += t(R, 548, '速率限制', { s: 13.5, w: 700 });
      s += status(R, 560, 'warn', '接近上限');
      s += t(R, 602, '5 小时窗口', { s: 12, c: C.muted });
      s += t(R + 256, 602, '84% · 21:30 重置', { s: 12, a: 'end' });
      s += progress(R, 610, 256, 84, C.warn, 6);
      s += t(R, 654, '各轮', { s: 13.5, w: 700 });
      [['第 1 轮', '1分12秒', '$0.21'], ['第 2 轮', '48 秒', '$0.18'], ['第 3 轮', '9 秒', '$0.03']].forEach(([n, d, c], i) => {
        const y = 666 + i * 24;
        s += t(R, y + 15, n, { s: 12.5 });
        s += t(R + 120, y + 15, d, { s: 12, c: C.muted });
        s += t(R + 256, y + 15, c, { s: 12.5, a: 'end' });
      });
      s += t(R, 760, '打开用量面板 →', { s: 12.5, c: C.accent });

      s += mk(800, 74, 1) + mk(X - 10, 190, 2) + mk(X - 10, 248, 3) + mk(X - 10, 506, 4) + mk(X - 10, 620, 5);
      s += mk(X - 10, 698, 6) + mk(X + 404, 698, 7) + mk(R - 8, 132, 8) + mk(R - 8, 238, 9) + mk(R - 8, 572, 10);
      return s;
    },
    notes: [
      ['上下文用量', '标题栏的用量条（占窗口百分比）点开就是这个抽屉。60% 变琥珀色，80% 变红。', '助手消息上的 `context_usage`；`getContextUsage({ detail: "summary" })`（FR-CTX-01）'],
      ['用量条', '用一条横条表示整个窗口：已用的各类别用固定颜色，压缩预留用斜纹，空闲为灰色。悬停显示类别和 token 数。', '`getContextUsage()` → `categories`（`kind`：used / buffer / free / deferred）'],
      ['类别表', '每个类别的 token 数和占比，数值不依赖颜色辨认。延迟加载的工具定义不计入，单独列出。数字按界面语言格式化。', '`categories`、`totalTokens`、`maxTokens`、`percentage`（FR-I18N-04）'],
      ['记忆文件', '加载了哪些 CLAUDE.md 和规则文件、各占多少；点击在编辑器中打开（P20 → 提示词与记忆）。', '`memoryFiles`（FR-PROMPT-03）'],
      ['MCP 工具', '每个服务器已加载与延迟加载的工具数量及 token 开销。', '`mcpTools`、`mcpInstructions`'],
      ['压缩 / 清空', '压缩把较早的历史总结成摘要，可附带「保留什么」的说明；对话中会出现分隔线。清空则重新开始对话（需确认）。', '`/compact [说明]`、`/clear`；`compact_boundary`、`conversation_reset`（FR-CTX-03）'],
      ['精确统计', '用 token 计数请求重新统计每个类别，而不是估算。', '`getContextUsage({ detail: "full" })`（FR-CTX-02）'],
      ['会话费用与上限', '本会话累计费用及相对预算上限的进度，包含子代理。金额以美元显示，按界面语言格式化。', '`total_cost_usd`、`maxBudgetUsd`（FR-COST-01/02）'],
      ['按模型', '每个模型的输入、输出、缓存读写和网页搜索次数，子代理在便宜模型上的花费一目了然。', '`modelUsage` → `ModelUsage`'],
      ['速率限制', '套餐或组织限额的状态、使用率和重置时间；接近时琥珀色，请求被拒时红色。', '`rate_limit_event`（`status`、`utilization`、`resetsAt`）（FR-COST-04）'],
    ],
  });

  // ------------------------------------------------------------------ P12
  window.SCREENS.push({
    id: 'P12',
    group: '会话',
    title: '会话历史 — 恢复、分叉与管理',
    summary: '所有已保存的会话，支持搜索和筛选。选中一个即以只读方式预览其对话记录；在这里可以恢复（可换配置方案或提高上限）、从任意消息分叉、重命名、打标签、导出或删除。',
    frs: ['FR-SES-05..11', 'FR-SES-15', 'FR-I18N-08'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += t(96, 98, '全部会话', { s: 22, w: 700 });
      s += check(596, 84, true, '包含 worktree', { s: 12.5 });
      s += input(96, 116, 216, { icon: 'search', ph: '搜索标题和提问内容', h: 34 });
      s += select(322, 116, 150, '所有工作区', { h: 34, icon: 'folder' });
      s += select(482, 116, 104, '任意标签', { h: 34, icon: 'tag' });
      s += seg(596, 119, ['全部', '运行中', '已保存'], 0, { h: 28 });
      s += rect(96, 166, 660, 716, { r: 10, fill: C.surface, stroke: C.border });
      const rows = [
        ['为 /orders 添加限流', '用 Redis。先出计划，我审过之后再改代码…', 'shop-api', 'main', '2 小时前', 'perf', true],
        ['限流 —— 令牌桶方案', '↳ 分叉自「为 /orders 添加限流」', 'shop-api', 'main', '1 小时前', null, false, true],
        ['排查内存泄漏', 'worker-3 的堆每小时增长 40 MB…', 'infra', 'main', '昨天', null],
        ['每周笔记摘要', '把本周的笔记整理成…', '笔记', '—', '昨天', 'job'],
        ['迁移到 Postgres 17', '规划从 15 升级到 17 的路径…', 'data-pipeline', 'dev', '周一', 'db'],
        ['撰写 3.2 版本说明', '收集 v3.1 以来合并的 PR…', 'shop-web', 'main', '10月21日', null],
        ['评审 PR #482', '/code-review high', 'shop-api', 'pr-482', '10月20日', 'review'],
        ['修复结账测试偶发失败', 'CI 上结账测试偶尔失败…', 'shop-api', 'main', '10月19日', 'ci'],
        ['讲解计费模块', '带我过一遍发票是怎么…', 'shop-api', 'main', '10月18日', null],
        ['文档：API 参考', '为以下接口生成参考页面…', 'shop-web', 'docs', '10月17日', 'docs'],
      ];
      rows.forEach(([title, first, ws, br, when, tag, on, fork], i) => {
        const y = 167 + i * 71;
        if (on) s += rect(97, y, 658, 70, { fill: C.accentSoft });
        if (fork) s += ic('branch', 112, y + 14, 15, C.accent);
        s += t(fork ? 134 : 112, y + 26, title, { s: 14, w: 600 });
        s += t(112, y + 47, first, { s: 12, c: fork ? C.accent : C.muted });
        s += t(112, y + 63, `${ws} · ${br}`, { s: 11.5, c: C.muted });
        s += t(740, y + 26, when, { s: 12, c: C.ink2, a: 'end' });
        if (tag) s += chip(740 - K.chip.w(tag, { icon: 1 }), y + 38, tag, { icon: 'tag' });
        if (i < rows.length - 1) s += hline(112, y + 70, 628, '#eef0f4');
      });

      const X = 776;
      s += rect(X, 82, 640, 800, { r: 10, fill: C.surface, stroke: C.border });
      s += t(X + 20, 116, '为 /orders 添加限流', { s: 17, w: 700 });
      s += ic('pencil', X + 20 + tw('为 /orders 添加限流', 17, false, true) + 8, 103, 15, C.muted);
      let cx = X + 20;
      [['perf', 'tag'], ['main', 'branch'], ['shop-api', 'folder'], ['2 小时前', 'clock']].forEach(([l, icn]) => {
        s += chip(cx, 128, l, { icon: icn });
        cx += K.chip.w(l, { icon: 1 }) + 6;
      });
      s += t(X + 620, 142, '5b3f2c1a-8d4e…', { s: 11.5, m: true, c: C.muted, a: 'end' });
      s += btn(X + 20, 164, '恢复', { v: 'primary', icon: 'play', w: 80 });
      s += btn(X + 108, 164, '分叉', { icon: 'branch', w: 72 });
      s += btn(X + 188, 164, '导出', { icon: 'download', w: 72 });
      s += btn(X + 268, 164, '标签', { icon: 'tag', w: 72 });
      s += btn(X + 548, 164, '删除', { icon: 'trash', w: 72, v: 'dangerOutline' });
      s += hline(X, 208, 640);
      s += t(X + 320, 232, '加载更早的 12 条消息', { s: 12, c: C.accent, a: 'middle' });
      const msgs = [
        ['user', '给 /orders 接口加上限流。'],
        ['tool', 'AskUserQuestion · 存储: Redis · 范围: 按 API Key'],
        ['user', '用 Redis。先出计划，我审过之后再改代码。', true],
        ['asst', '计划 v2 已批准 · 模式 → 自动接受编辑'],
        ['tool', 'Write src/middleware/rate-limit.ts (+64)'],
        ['tool', 'Edit src/routes/orders.ts (+3 −1)'],
        ['tool', 'Bash npm test -- rate-limit · 12 passed'],
        ['asst', 'POST /orders 的限流已上线，并补充了测试和文档。'],
      ];
      let y = 250;
      msgs.forEach(([kind, text, hover]) => {
        const h = kind === 'user' ? 44 : 32;
        if (kind === 'user') s += rect(X + 20, y, 600, h, { r: 8, fill: C.accentSoft });
        if (hover) s += rect(X + 20, y, 600, h, { r: 8, stroke: C.accent, sw: 1.5 });
        s += ic(kind === 'user' ? 'user' : kind === 'tool' ? 'terminal' : 'chat', X + 32, y + (h - 16) / 2, 16, C.ink2);
        s += t(X + 56, y + h / 2 + 4.5, text, { s: 13, m: kind === 'tool', c: kind === 'tool' ? C.ink2 : C.ink });
        if (hover) s += btn(X + 494, y + 8, '从这里分叉', { icon: 'branch', h: 28, s: 12, w: 118 });
        y += h + 10;
      });
      s += rect(X + 20, 700, 600, 162, { r: 8, fill: C.surface2, stroke: C.border });
      s += t(X + 36, 726, '恢复设置', { s: 13, w: 700 });
      s += select(X + 36, 740, 200, '配置方案：默认', { h: 30, s: 12.5 });
      s += input(X + 248, 740, 110, { h: 30, val: '100', right: '轮', s: 12.5 });
      s += input(X + 368, 740, 110, { h: 30, val: '10.00', right: 'USD', s: 12.5 });
      s += check(X + 36, 786, false, '分叉出新会话，不在原会话上继续', { s: 12.5 });
      s += check(X + 36, 812, true, '沿用会话原来的模型和权限模式', { s: 12.5 });
      s += btn(X + 510, 820, '恢复', { v: 'primary', w: 94 });

      s += mk(92, 112, 1) + mk(92, 230, 2) + mk(102, 250, 3) + mk(X + 20, 160, 4) + mk(X + 616, 336, 5);
      s += mk(X + 16, 704, 6) + mk(X + 190, 160, 7) + mk(X + 616, 160, 8);
      return s;
    },
    notes: [
      ['搜索与筛选', '搜索标题和首条提问（支持中文等 CJK 文本，不依赖空格分词）。筛选：工作区、标签、运行中/已保存，以及是否包含该文件夹 git worktree 中的会话。', '`listSessions({ dir, includeWorktrees })` → `SDKSessionInfo`（FR-SES-05、FR-I18N-08）'],
      ['会话行', '标题（自定义、AI 生成或首条提问）、首条提问、工作区与分支、最后修改时间（本地化）和标签。运行中的会话显示状态点。', '`summary`、`customTitle`、`firstPrompt`、`gitBranch`、`lastModified`、`tag`'],
      ['分叉来源', '分叉会注明来自哪个会话；点击该行选中父会话。', '应用 `SessionMeta.forkParent`'],
      ['预览标题栏', '可直接重命名（铅笔）、恢复、分叉（整个会话）、导出（Markdown / JSON）、打标签（选择或新建；可清除）。', '`renameSession`、`forkSession`、`getSessionMessages`、`tagSession`（FR-SES-08/10/15）'],
      ['从这里分叉', '悬停任意消息出现「从这里分叉」，新会话停在该消息，并作为运行中的会话打开。', '`forkSession(id, { upToMessageId })`'],
      ['恢复设置', '恢复时可以换配置方案、提高上限——达到最大轮数或预算后的常用做法。「分叉出新会话」不改动原会话。', '`resume`、`forkSession: true`、`maxTurns`、`maxBudgetUsd`（FR-SES-07）'],
      ['导出', 'Markdown 便于阅读，JSON 便于工具处理。子代理的记录以嵌套小节导出。文件以 UTF-8 编码。', '`getSessionMessages({ includeSystemMessages })`'],
      ['删除', '确认框写明会话名称并说明不可撤销。运行中的会话需先停止。', '`deleteSession()`（FR-SES-09）'],
    ],
  });

  // ------------------------------------------------------------------ P13
  window.SCREENS.push({
    id: 'P13',
    group: '扩展',
    title: 'MCP 服务器',
    summary: '集中管理 Agent 能用的所有 MCP 服务器：在 Code Agent 中注册的、来自项目文件和插件的。每个服务器显示连接状态、工具及其审批策略，并可在运行中的会话里控制。',
    frs: ['FR-MCP-01..05', 'FR-MCP-09', 'FR-PERM-11', 'FR-CTOOL-03', 'FR-CTX-04'],
    draw() {
      let s = K.shell({ nav: 'mcp' });
      s += t(96, 98, 'MCP 服务器', { s: 22, w: 700 });
      s += btn(286, 80, '添加服务器', { v: 'primary', icon: 'plus', w: 118 });
      s += rect(96, 128, 308, 754, { r: 10, fill: C.surface, stroke: C.border });
      const groups = [
        ['Code Agent 注册表', [
          ['github', 'HTTP', 'good', '已连接', '28 个工具', true],
          ['jira', 'HTTP', 'warn', '需要登录', '—'],
          ['app-tools', '进程内', 'good', '已连接', '3 个工具'],
          ['webhooks', '进程内', 'good', '已连接', '2 个工具'],
        ]],
        ['项目 .mcp.json · 只读', [
          ['postgres', 'stdio', 'good', '已连接', '6 个工具'],
          ['browser', 'stdio', 'crit', '失败', 'spawn ENOENT'],
        ]],
        ['插件 · git-tools', [['git', 'stdio', 'good', '已连接', '4 个工具']]],
      ];
      let y = 152;
      groups.forEach(([g, items]) => {
        s += t(112, y, g, { s: 11, w: 700, c: C.muted });
        y += 10;
        items.forEach(([n, type, st, label, tools, on]) => {
          if (on) s += rect(102, y, 296, 54, { r: 8, fill: C.accentSoft });
          s += t(116, y + 22, n, { s: 13.5, w: 600 });
          s += chip(116 + tw(n, 13.5, false, true) + 8, y + 9, type, { h: 18, s: 10.5 });
          s += status(116, y + 30, st, label);
          s += t(388, y + 44, tools, { s: 11.5, c: st === 'crit' ? C.crit : C.muted, a: 'end', m: st === 'crit' });
          y += 58;
        });
        y += 18;
      });

      const X = 424;
      s += t(X, 162, 'github', { s: 20, w: 700 });
      s += chip(X + 72, 148, 'HTTP', { h: 20 });
      s += status(X + 120, 148, 'good', '已连接 · github-mcp 1.4.0');
      s += btn(X + 700, 140, '重新连接', { icon: 'refresh', w: 104 });
      s += btn(X + 812, 140, '编辑', { icon: 'pencil', w: 70 });
      s += btn(X + 890, 140, '移除', { icon: 'trash', w: 80, v: 'dangerOutline' });

      s += panel(X, 186, 470, 196, { title: '连接' });
      s += kv(X + 16, 248, 'URL', 'https://api.githubcopilot.com/mcp/', { kw: 100, m: true });
      s += kv(X + 16, 274, '请求头', 'Authorization: Bearer ••••••••', { kw: 100, m: true });
      s += t(X + 116, 292, '来自密钥「github-pat」', { s: 11.5, c: C.muted });
      s += kv(X + 16, 318, '工具超时', '60 秒', { kw: 100 });
      s += kv(X + 16, 344, '默认启用于', '配置方案：默认、评审', { kw: 100 });
      s += kv(X + 16, 368, '服务器说明', '1.1k tokens', { kw: 100 });

      s += panel(X + 486, 186, 484, 196, { title: '运行中的会话' });
      const live = [['修复结账测试偶发失败', true, '跟随会话模式'], ['重构鉴权中间件', true, '总是询问'], ['文档：API 参考', false, '—']];
      live.forEach(([n, on, ov], i) => {
        const ly = 240 + i * 44;
        s += toggle(X + 502, ly, on);
        s += t(X + 544, ly + 13.5, n, { s: 13, c: on ? C.ink : C.muted });
        if (on) s += select(X + 744, ly - 6, 150, ov, { h: 28, s: 12 });
        s += btn(X + 902, ly - 6, '', { icon: 'refresh', w: 28, h: 28 });
      });
      s += t(X + 502, 370, '覆盖只在会话以「跳过权限检查」或「自动」模式运行时生效。', { s: 11.5, c: C.muted });

      s += panel(X, 398, 970, 330, { title: '工具', sub: '28 个 · 22 个由工具搜索延迟加载' });
      const cols = [[16, '工具'], [260, '注解'], [560, 'TOKENS'], [660, '审批']];
      cols.forEach(([dx, h]) => (s += t(X + dx, 460, h, { s: 11, w: 700, c: C.muted })));
      const tools = [
        ['list_issues', ['只读'], '420', '允许'],
        ['get_pull_request', ['只读'], '380', '允许'],
        ['create_issue', ['访问外部'], '510', '询问'],
        ['merge_pull_request', ['破坏性', '访问外部'], '460', '询问'],
        ['delete_branch', ['破坏性'], '300', '拒绝'],
        ['search_code', ['只读', '访问外部'], '440', '默认'],
      ];
      const pols = ['允许', '询问', '拒绝', '默认'];
      tools.forEach(([n, ann, tok, pol], i) => {
        const ty = 470 + i * 40;
        s += hline(X + 1, ty, 968, '#eef0f4');
        s += t(X + 16, ty + 25, n, { s: 12.5, m: true });
        let ax = X + 260;
        ann.forEach((a) => {
          s += chip(ax, ty + 11, a, { h: 18, s: 10.5, bg: a === '破坏性' ? C.critSoft : C.surface3, c: a === '破坏性' ? C.crit : C.ink2 });
          ax += K.chip.w(a, { s: 10.5 }) + 6;
        });
        s += t(X + 560, ty + 25, tok, { s: 12.5 });
        s += seg(X + 660, ty + 6, pols, pols.indexOf(pol), { h: 26, s: 11.5 });
      });

      s += panel(X, 744, 970, 138, { title: '会话行为', sub: '对所有服务器生效' });
      s += toggle(X + 16, 798, false, '严格 MCP 配置', { hint: '只用 Code Agent 传入的服务器；忽略 .mcp.json、插件和连接器' });
      s += t(X + 16, 852, '工具搜索', { s: 13 });
      s += select(X + 90, 834, 220, '开启 · 延迟加载定义', { h: 30, s: 12.5 });
      s += t(X + 334, 852, '首轮等待', { s: 13 });
      s += input(X + 400, 834, 90, { h: 30, val: '30', right: '秒', s: 12.5 });

      s += mk(284, 82, 1) + mk(100, 150, 2) + mk(100, 510, 3) + mk(X + 698, 142, 4) + mk(X + 4, 190, 5);
      s += mk(X + 4, 412, 6) + mk(X + 490, 190, 7) + mk(X + 4, 748, 8);
      return s;
    },
    notes: [
      ['添加服务器', '表单包含类型（stdio：命令、参数、环境变量 · HTTP / SSE：URL、请求头 · Webhook 工具）、超时，以及默认在哪些配置方案中启用。密钥从密钥库选择，不以明文写进配置。', '`McpStdioServerConfig`、`McpHttpServerConfig`、`McpSSEServerConfig`；`createSdkMcpServer({ timeout })`（FR-MCP-01）'],
      ['按来源分组的列表', '注册表中的服务器可编辑；来自项目 `.mcp.json` 和插件的服务器在这里只读（请改文件或插件）。每行显示类型、状态和工具数。', '`McpServerStatus.scope` / `source`'],
      ['异常状态', '「失败」显示错误原文；「需要登录」说明 SDK 不会执行 OAuth，并提供令牌输入框（存为密钥）；「连接中」显示转圈。状态文字本地化，错误详情保留原文。', '`status`：connected / pending / failed / needs-auth / disabled（FR-MCP-02/05、FR-I18N-06）'],
      ['服务器操作', '在所有运行中的会话里重新连接、编辑、移除（会询问是否保留在正在运行的会话中）。', '`reconnectMcpServer()`、`setMcpServers()`'],
      ['连接', '地址、遮盖后的请求头及其密钥来源、工具超时、默认启用的配置方案，以及服务器说明占用的 token。', '服务器配置；`getContextUsage().mcpInstructions`'],
      ['工具与审批', '每个工具的注解（破坏性标红）和 token 开销。审批设置会为 `mcp__github__<tool>` 写入允许/询问/拒绝规则；对进程内服务器则设置工具策略。', '`allowedTools` / `disallowedTools` 规则；`McpServerToolPolicy.permission_policy`（FR-CTOOL-03）'],
      ['运行中的会话', '针对每个运行中的会话：启用/停用该服务器、重新连接，以及在会话处于「跳过权限检查」或「自动」模式时为其工具设置更严格的模式。', '`toggleMcpServer()`、`reconnectMcpServer()`、`setMcpPermissionModeOverride()`（FR-MCP-03、FR-PERM-11）'],
      ['会话行为', '严格模式忽略来自文件、插件和连接器的服务器。工具搜索决定工具定义是否按需加载。首轮等待限制会话首轮前等待服务器连接的时长。', '`strictMcpConfig`；`ENABLE_TOOL_SEARCH`；`MCP_TIMEOUT`（FR-MCP-04、FR-CTX-04）'],
    ],
  });

  // ------------------------------------------------------------------ P14
  window.SCREENS.push({
    id: 'P14',
    group: '扩展',
    title: 'MCP 信息征询',
    summary: 'MCP 服务器可以在工具调用过程中向用户索取信息。Code Agent 根据服务器的请求生成对话框：表单（左）或需要用户打开的链接（右，变体）。服务器发来的说明按原文显示。',
    frs: ['FR-MCP-06', 'FR-HOOK-01'],
    draw() {
      let s = sessionBase({ header: { state: 'requires_action', title: '迁移 orders 表' }, active: 0, live: [
        ['迁移 orders 表', 'requires_action', 'data-pipeline', 'postgres 需要输入'],
        ['重构鉴权中间件', 'running', 'shop-api'],
      ] });
      s += K.userMsg(L.TX, 122, L.TW, '在预发环境执行 orders 表的迁移。');
      s += K.toolCard(L.TX, 184, L.TW, { icon: 'plug', name: 'postgres · run_migration', detail: '20261027_orders_v2', right: '等待输入', st: 'wait' });
      s += K.inspector(0);
      s += overlay();

      const x = 360;
      const y = 150;
      s += rect(x, y, 500, 520, { r: 12, fill: C.surface, shadow: true });
      s += rect(x + 24, y + 24, 36, 36, { r: 8, fill: C.accentSoft });
      s += ic('plug', x + 34, y + 34, 16, C.accent);
      s += t(x + 72, y + 40, 'postgres 需要你提供信息', { s: 17, w: 700 });
      s += t(x + 72, y + 58, '项目 .mcp.json · 执行 run_migration 期间', { s: 12, c: C.muted });
      s += hline(x, y + 80, 500);
      s += para(x + 24, y + 110, 'Choose the target schema and confirm the batch settings before the migration runs.', 452, { s: 14, lh: 21 });
      s += t(x + 24, y + 156, '服务器原文 · 不翻译', { s: 11, c: C.muted });
      s += select(x + 24, y + 194, 452, 'orders_v2', { label: 'Target schema *' });
      s += check(x + 24, y + 246, true, 'Dry run first');
      s += input(x + 24, y + 298, 200, { label: 'Batch size', val: '500' });
      s += t(x + 236, y + 319, '100 – 5000 之间', { s: 12, c: C.muted });
      s += textarea(x + 24, y + 366, 452, 54, [], { label: 'Reason (optional)' });
      s += t(x + 24, y + 440, '字段由服务器请求中的 schema 生成；校验提示为本地化文案。', { s: 11.5, c: C.muted });
      s += hline(x, y + 456, 500);
      s += btn(x + 24, y + 472, '拒绝提供', { w: 90 });
      s += btn(x + 306, y + 472, '取消', { w: 70, v: 'ghost' });
      s += btn(x + 384, y + 472, '提交', { v: 'primary', w: 92 });

      const vx = 900;
      const vy = 280;
      s += t(vx, vy - 14, '变体 · 链接模式', { s: 12, w: 700, c: '#fff' });
      s += rect(vx, vy, 500, 300, { r: 12, fill: C.surface, shadow: true });
      s += rect(vx + 24, vy + 24, 36, 36, { r: 8, fill: C.warnSoft });
      s += ic('link', vx + 34, vy + 34, 16, C.warnInk);
      s += t(vx + 72, vy + 40, 'jira 需要你登录', { s: 17, w: 700 });
      s += t(vx + 72, vy + 58, 'Code Agent 注册表 · 执行 create_issue 期间', { s: 12, c: C.muted });
      s += hline(vx, vy + 80, 500);
      s += t(vx + 24, vy + 112, '打开下面的页面以继续：', { s: 14 });
      s += rect(vx + 24, vy + 126, 452, 34, { r: 6, fill: C.surface2, stroke: C.border });
      s += t(vx + 36, vy + 148, 'https://id.atlassian.com/authorize?client=…', { s: 12.5, m: true, c: C.accent });
      s += btn(vx + 24, vy + 176, '打开页面', { v: 'primary', icon: 'link', w: 110 });
      s += circle(vx + 156, vy + 191, 7, { stroke: C.accent, sw: 2.5 });
      s += t(vx + 172, vy + 195.5, '等待 jira 确认…', { s: 12.5, c: C.ink2 });
      s += hline(vx, vy + 232, 500);
      s += btn(vx + 24, vy + 250, '拒绝提供', { w: 90 });
      s += btn(vx + 406, vy + 250, '取消', { w: 70 });

      s += mk(L.TX - 13, 200, 1) + mk(x + 20, y + 28, 2) + mk(x + 12, y + 104, 3) + mk(x + 12, y + 186, 4) + mk(x + 480, y + 476, 5);
      s += mk(vx + 20, vy + 180, 6) + mk(vx + 156, vy + 170, 7);
      return s;
    },
    notes: [
      ['等待中的工具调用', '触发请求的 MCP 工具调用显示「等待输入」；会话进入「等待你的操作」状态，并出现在审批收件箱中。', '`onElicitation` 待处理；`requires_action`'],
      ['谁在请求', '服务器名、配置来源以及正在执行的工具调用，帮助判断是否信任该请求。', '`McpServerStatus.source`；工具调用上下文'],
      ['说明文字', '服务器发来的说明，按原文以纯文本显示（不渲染 HTML，也不机器翻译），并标注「服务器原文」。', '`ElicitationRequest.message`（FR-I18N-06）'],
      ['生成的表单', '字段、类型、必填标记、枚举和范围都来自服务器请求的 schema；字段名用服务器提供的标题，校验提示用本地化文案。提交前先校验。', '请求的 schema（表单模式）'],
      ['拒绝提供 / 取消 / 提交', '「提交」返回填写的值；「拒绝提供」告知服务器用户拒绝；「取消」关闭而不作答。Esc = 取消。', '`{ action: "accept", content }` / `"decline"` / `"cancel"`'],
      ['链接模式', '用于服务器必须在浏览器里完成的流程（登录、授权）：在新标签页打开链接。', '链接模式的征询'],
      ['等待完成', '对话框等待服务器报告完成后自动关闭。钩子也可以自动应答征询（P17）。', '`elicitation_complete`；`Elicitation` / `ElicitationResult` 钩子'],
    ],
  });

  // ------------------------------------------------------------------ P15
  window.SCREENS.push({
    id: 'P15',
    group: '扩展',
    title: '代理库与编辑器',
    summary: '把各个来源的子代理放在一个列表里。Code Agent 中定义的代理在此编辑，覆盖 SDK 支持的全部字段；任何代理都可以在新会话中试用，或作为主代理使用。',
    frs: ['FR-AGT-01..05'],
    draw() {
      let s = K.shell({ nav: 'agents' });
      s += t(96, 98, '代理', { s: 22, w: 700 });
      s += btn(274, 80, '新建代理', { v: 'primary', icon: 'plus', w: 106 });
      s += rect(96, 128, 284, 754, { r: 10, fill: C.surface, stroke: C.border });
      s += input(108, 140, 260, { icon: 'search', ph: '筛选代理', h: 30 });
      const groups = [
        ['Code Agent', [['code-reviewer', 'opus'], ['test-runner', 'haiku', true], ['researcher', 'sonnet']]],
        ['项目 .claude/agents', [['db-migrator', 'inherit']]],
        ['插件 · git-tools', [['changelog-writer', 'haiku']]],
        ['内置', [['Explore', 'haiku'], ['general-purpose', 'inherit'], ['Plan', 'inherit']]],
      ];
      let y = 196;
      groups.forEach(([g, items]) => {
        s += t(112, y, g, { s: 11, w: 700, c: C.muted });
        y += 10;
        items.forEach(([n, m, on]) => {
          if (on) s += rect(102, y, 272, 34, { r: 7, fill: C.accentSoft });
          s += ic('agent', 114, y + 9, 16, on ? C.accent : C.ink2);
          s += t(138, y + 22, n, { s: 13, w: on ? 600 : 400, c: on ? C.accent : C.ink });
          s += chip(364 - K.chip.w(m), y + 8, m, { h: 18, s: 10.5 });
          y += 38;
        });
        y += 16;
      });

      const X = 404;
      s += t(X, 98, 'test-runner', { s: 20, w: 700 });
      s += chip(X + 124, 84, 'Code Agent 注册表', { h: 20, icon: 'layers' });
      s += btn(X + 560, 80, '在新会话中试用', { icon: 'play', w: 136 });
      s += btn(X + 704, 80, '设为主代理…', { icon: 'agent', w: 122 });
      s += btn(X + 834, 80, '保存', { v: 'primary', w: 172 });

      s += rect(X, 128, 1006, 754, { r: 10, fill: C.surface, stroke: C.border });
      const L1 = X + 20;
      s += input(L1, 166, 280, { label: '名称', val: 'test-runner', mono: true });
      s += textarea(L1 + 296, 166, 284, 52, ['运行测试套件并报告失败。在代码改动后', '或被要求跑测试时使用。'], { label: '描述 —— Claude 何时该用它 *', s: 12 });
      s += textarea(L1, 252, 580, 236, [
        '你负责运行测试并报告结果。不要修改源文件。',
        '',
        '1. 从 package.json 判断测试运行器。',
        '2. 运行能覆盖需求的最小范围命令。',
        '3. 失败时把失败的测试再跑一次，排除偶发。',
        '4. 报告：命令、通过/失败数、第一个失败及堆栈，',
        '   以及是否能复现。',
        '',
        '报告控制在 300 字以内。',
      ], { label: '系统提示词 *', s: 12.5 });
      s += t(L1, 516, '工具', { s: 12, w: 500, c: C.ink2 });
      s += toggle(L1 + 440, 503, false, '继承全部工具', { s: 12.5 });
      s += rect(L1, 526, 580, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      let cx = L1 + 8;
      ['Bash', 'Read', 'Grep', 'Glob', 'AskUserQuestion'].forEach((tn) => {
        s += chip(cx, 536, tn + '  ×', { h: 20, m: true });
        cx += K.chip.w(tn + '  ×', { m: true }) + 6;
      });
      s += t(L1, 594, '禁用的工具', { s: 12, w: 500, c: C.ink2 });
      s += rect(L1, 604, 580, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      cx = L1 + 8;
      ['Bash(rm *)', 'Edit', 'Write', 'mcp__github__*'].forEach((tn) => {
        s += chip(cx, 614, tn + '  ×', { h: 20, m: true, bg: C.critSoft, c: C.crit });
        cx += K.chip.w(tn + '  ×', { m: true }) + 6;
      });
      s += t(L1, 672, '预加载技能', { s: 12, w: 500, c: C.ink2 });
      s += rect(L1, 682, 284, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      s += chip(L1 + 8, 692, 'testing-conventions  ×', { h: 20, icon: 'spark' });
      s += t(L1 + 296, 672, 'MCP 服务器', { s: 12, w: 500, c: C.ink2 });
      s += rect(L1 + 296, 682, 284, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      s += chip(L1 + 304, 692, 'postgres  ×', { h: 20, icon: 'plug' });
      s += t(L1 + 410, 707, '+ 内联服务器', { s: 12, c: C.accent });
      s += input(L1, 758, 580, { label: '初始提示（仅作为主代理时使用）', ph: '例如：跑完整测试套件并汇总失败' });

      const R = X + 640;
      s += t(R, 160, '运行时', { s: 11, w: 700, c: C.muted });
      s += select(R, 190, 346, 'haiku', { label: '模型' });
      s += t(R, 240, 'inherit · fable · opus · sonnet · haiku · 完整模型 ID', { s: 11.5, c: C.muted });
      s += select(R, 272, 165, '中', { label: '推理强度' });
      s += select(R + 181, 272, 165, '继承', { label: '权限模式' });
      s += input(R, 340, 165, { label: '最大轮数', val: '30' });
      s += input(R + 181, 340, 165, { label: '自动压缩窗口', val: '200000', right: 'tokens' });
      s += select(R, 408, 346, 'project', { label: '记忆范围' });
      s += t(R, 468, '行为', { s: 11, w: 700, c: C.muted });
      s += toggle(R, 484, true, '在后台运行', { s: 13 });
      s += t(R + 42, 516, '它运行时 Claude 可以继续工作', { s: 11.5, c: C.muted });
      s += toggle(R, 534, false, '不加载 CLAUDE.md', { s: 13 });
      s += t(R + 42, 566, '适合所有上下文都来自提示词的代理', { s: 11.5, c: C.muted });
      s += rect(R, 600, 346, 120, { r: 8, fill: C.surface2, stroke: C.border });
      s += t(R + 14, 624, '使用情况', { s: 12.5, w: 700 });
      s += t(R + 14, 646, '配置方案：默认、无人值守 CI', { s: 12, c: C.ink2 });
      s += t(R + 14, 666, '最近运行：12 分钟前，在「修复结账测试…」中', { s: 12, c: C.ink2 });
      s += t(R + 14, 686, '平均 41k tokens · 每次 $0.03', { s: 12, c: C.ink2 });
      s += t(R + 14, 708, '保存在 ~/.code-agent（不写入 .claude/agents）', { s: 11.5, c: C.muted });

      s += mk(100, 200, 1) + mk(100, 560, 2) + mk(L1 + 282, 156, 3) + mk(L1 - 10, 242, 4) + mk(L1 - 10, 512, 5);
      s += mk(R - 12, 180, 6) + mk(R - 12, 470, 7) + mk(L1 - 10, 668, 8) + mk(X + 702, 78, 9) + mk(X + 558, 78, 10);
      return s;
    },
    notes: [
      ['按来源分组', 'Code Agent 中的代理可编辑；项目和插件中的代理以只读方式打开，并提供「编辑文件」/「复制到 Code Agent」。模型标签显示各代理所用模型。', '`supportedAgents()` → `AgentInfo`；`Options.agents`（FR-AGT-01）'],
      ['内置代理', '列出 Explore、general-purpose、Plan 供参考，可复制作为起点。名称和描述来自 SDK，按原文显示。', '`AgentInfo`（FR-I18N-06）'],
      ['描述', '告诉 Claude 何时把任务委派给这个代理——自动委派最关键的字段。可以用中文写。', '`AgentDefinition.description`'],
      ['系统提示词', '代理的指令，Markdown 编辑器。', '`AgentDefinition.prompt`'],
      ['工具', '从会话的工具列表中选择，或继承全部。禁用工具支持规则模式和整个 MCP 服务器（`mcp__server__*`）。缺少 AskUserQuestion 时给出提醒。', '`tools`、`disallowedTools`'],
      ['模型与运行时', '模型别名、继承或完整 ID；推理强度；权限模式（主会话的规划/自动/跳过权限仍优先）；最大轮数；自动压缩窗口；记忆范围。', '`model`、`effort`、`permissionMode`、`maxTurns`、`autoCompactWindow`、`memory`'],
      ['行为', '后台代理立即交还控制权，通过「后台」标签页汇报。不加载 CLAUDE.md 可为自足型代理节省上下文。', '`background`、`omitClaudeMd`'],
      ['技能、MCP、初始提示', '预加载到代理上下文的技能；按名称或内联配置的 MCP 服务器；仅在作为主线程时使用的初始提示。', '`skills`、`mcpServers`（`AgentMcpServerSpec`）、`initialPrompt`'],
      ['设为主代理', '新建会话（或切换运行中的会话）并以此代理作为主线程：其提示词、工具和模型从下一轮起生效。', '`Options.agent`；`applyFlagSettings({ agent })`（FR-AGT-03）'],
      ['在新会话中试用', '打开 P03，已加入此代理，并附带一条会调用它的示例提示。', '`Options.agents`'],
    ],
  });

  // ------------------------------------------------------------------ P16
  window.SCREENS.push({
    id: 'P16',
    group: '扩展',
    title: '技能、命令与插件',
    summary: '当前工作区可用的技能和命令、各配置方案启用了哪些，以及 SKILL.md 编辑器。插件（打包了技能、代理、钩子和 MCP 服务器的本地文件夹）在这里注册和重新加载。',
    frs: ['FR-SKILL-01..04', 'FR-PLUG-01..03'],
    draw() {
      let s = K.shell({ nav: 'skills' });
      s += t(96, 98, '技能', { s: 22, w: 700 });
      s += tabs(96, 140, [['技能', 6], ['命令', 14], ['插件', 2]], 0, { s: 13.5, gap: 28, rule: [96, 1314] });
      s += t(560, 102, '配置方案', { s: 12.5, c: C.ink2 });
      s += select(620, 82, 152, '默认', { h: 30, s: 12.5 });
      s += seg(784, 83, ['全部技能', '仅所选'], 1, { h: 28 });

      s += rect(96, 168, 664, 450, { r: 10, fill: C.surface, stroke: C.border });
      const cols = [[112, '技能'], [330, '来源'], [470, '谁可调用'], [744, '本方案启用']];
      cols.forEach(([x, h], i) => (s += t(x, 192, h, { s: 11, w: 700, c: C.muted, a: i === 3 ? 'end' : undefined })));
      const rows = [
        ['code-review', 'Review the diff for bugs', '内置包', '你 · Claude', true],
        ['security-check', '检查注入、权限和密钥泄露', '项目', '你 · Claude', true, true],
        ['testing-conventions', '本项目的测试写法约定', '项目', '仅 Claude', true],
        ['deploy', '部署到预发环境', '用户', '仅你', false],
        ['release-notes', 'Draft notes from merged PRs', '插件 · git-tools', '你 · Claude', true],
        ['pdf', 'Read and fill PDF forms', '用户', '仅 Claude', true],
      ];
      rows.forEach(([n, d, src, by, on, sel], i) => {
        const y = 202 + i * 68;
        if (sel) s += rect(97, y, 662, 68, { fill: C.accentSoft });
        s += t(112, y + 28, n, { s: 13.5, w: 600, m: true });
        s += t(112, y + 48, d, { s: 12, c: C.muted });
        s += chip(330, y + 17, src, { h: 20 });
        s += t(470, y + 32, by, { s: 12.5, c: C.ink2 });
        s += toggle(712, y + 20, on);
        if (i < rows.length - 1) s += hline(112, y + 68, 632, '#eef0f4');
      });

      const X = 780;
      s += rect(X, 168, 630, 450, { r: 10, fill: C.surface, stroke: C.border });
      s += ic('file', X + 16, 182, 16, C.ink2);
      s += t(X + 40, 195, '.claude/skills/security-check/SKILL.md', { s: 12.5, m: true });
      s += chip(X + 352, 181, '已修改', { h: 18, s: 10.5, bg: C.warnSoft, c: C.warnInk });
      s += hline(X, 212, 630);
      s += code(X + 16, 226, 598, [
        [['---', C.muted]],
        [['name', C.accent], [': security-check']],
        [['description', C.accent], [': 检查改动代码中的注入、权限和密钥泄露问题。合并前使用。']],
        [['allowed-tools', C.accent], [': Read, Grep, Bash(git diff *)']],
        [['---', C.muted]],
        [['# 安全检查', C.ink, 700]],
        '1. 运行 `git diff origin/main...`，列出改动的文件。',
        '2. 逐个检查输入处理、权限校验和硬编码的密钥。',
        '3. 以 文件:行号 的形式报告问题并给出修复建议。',
      ], { s: 12, lh: 19, bg: C.surface, stroke: C.border, h: 316 });
      s += t(X + 16, 572, '已检查 frontmatter：名称合法，描述已填写', { s: 11.5, c: C.goodInk });
      s += btn(X + 330, 580, '在运行中的会话里重新加载 (2)', { icon: 'refresh', w: 200, h: 28, s: 12 });
      s += btn(X + 538, 580, '保存', { v: 'primary', w: 76, h: 28, s: 12 });

      s += panel(96, 636, 1314, 246, { title: '插件', sub: '本地文件夹 · 技能、代理、命令、钩子和 MCP 服务器' });
      s += btn(1170, 642, '添加文件夹', { icon: 'plus', w: 108, h: 28, s: 12 });
      s += btn(1286, 642, '重新加载', { icon: 'refresh', w: 112, h: 28, s: 12 });
      const plugs = [
        ['git-tools', 'D:\\plugins\\git-tools', 'good', '已加载', '技能 2 · 命令 1 · 代理 1 · MCP 1 · 钩子 2', true],
        ['team-standards', '\\\\nas\\plugins\\team-standards', 'crit', '错误', 'plugin.json: missing "name"', false],
      ];
      plugs.forEach(([n, p, st, label, detail, on], i) => {
        const y = 690 + i * 78;
        s += rect(112, y, 1282, 66, { r: 8, fill: C.surface, stroke: st === 'crit' ? '#e9a3a3' : C.border });
        s += ic('box', 126, y + 14, 18, C.ink2);
        s += t(154, y + 27, n, { s: 14, w: 600 });
        s += t(154, y + 48, p, { s: 12, m: true, c: C.muted });
        s += status(460, y + 14, st, label);
        s += t(460, y + 52, detail, { s: 12, c: st === 'crit' ? C.crit : C.ink2, m: st === 'crit' });
        s += toggle(1030, y + 14, on, '在本方案中启用', { s: 12.5 });
        s += toggle(1030, y + 40, false, '跳过其 MCP 服务器', { s: 12.5 });
        s += btn(1360, y + 18, '', { icon: 'dots', w: 28, h: 28 });
      });

      s += mk(92, 132, 1) + mk(780, 80, 2) + mk(326, 214, 3) + mk(760, 214, 4) + mk(X + 4, 172, 5) + mk(X + 326, 584, 6);
      s += mk(108, 694, 7) + mk(1166, 644, 8);
      return s;
    },
    notes: [
      ['技能 · 命令 · 插件', '技能：基于 SKILL.md 的能力。命令：工作区内所有 / 命令（内置、技能、命令文件、MCP 提示），附来源和参数提示。插件：已注册的文件夹。', 'init 中的 `skills`、`supportedCommands()`（FR-SKILL-01）'],
      ['配置方案的技能模式', '按配置方案选择：启用发现的全部技能，或只启用所选技能。', '`Options.skills`：`"all"` 或名称列表（FR-SKILL-02）'],
      ['来源与调用者', '技能所在位置（内置包、项目、用户、插件），以及谁可以调用：你通过 /名称、Claude 自动调用，或两者皆可（来自 frontmatter）。技能描述按作者原文显示，中英文均可。', 'Skill frontmatter 的 `user-invocable` / 模型调用（FR-I18N-06）'],
      ['本方案启用', '切换所选配置方案是否启用该技能。即使未启用，用户可调用的技能仍能通过 /名称运行。', '`Options.skills`'],
      ['SKILL.md 编辑器', '就地编辑项目或用户技能，并校验 frontmatter（名称格式、描述是否填写）。插件和内置包的技能只读。文件以 UTF-8 保存，中文内容可直接编写。', '`.claude/skills/`、`~/.claude/skills/` 下的文件（FR-I18N-08）'],
      ['在运行中的会话里重新加载', '把新增或修改的技能推送到正在运行的会话，无需重启。', '`reloadSkills()`（FR-SKILL-03）'],
      ['插件', '每个已注册文件夹的加载状态、提供的内容，以及上次会话启动时的错误（错误原文保留）。按配置方案：是否启用，以及在 Code Agent 自行管理 MCP 时跳过其 MCP 服务器。', '`plugins`（`SdkPluginConfig`、`skipMcpDiscovery`）；init 中的 `plugins`、`plugin_errors`（FR-PLUG-01/02）'],
      ['添加文件夹 / 重新加载', '添加插件文件夹（也加入运行中的会话），并在运行中的会话里重新加载插件；若重新加载会导致提示词缓存重建，会先提醒。', '`reloadPlugins({ addPlugins, holdOnCacheImpact })`（FR-PLUG-03）'],
    ],
  });
})();
