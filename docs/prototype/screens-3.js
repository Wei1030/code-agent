/* Screens P17–P25: hooks, jobs, usage, settings, event inspector, session states, language. */
(function () {
  'use strict';
  const K = window.K;
  const { C, t, rect, line, path, circle, box, arrow, btn, chip, status, input, select, textarea, toggle, check,
    radio, panel, hline, vline, mk, code, overlay, tabs, seg, progress, kbd, para, ic, tw, kv, runs, L } = K;

  /** Rectangle with only the top corners rounded (bar ends anchored to a baseline). */
  function topRounded(x, y, w, h, r, fill) {
    const rr = Math.min(r, h, w / 2);
    return path(`M${x} ${y + h} V${y + rr} Q${x} ${y} ${x + rr} ${y} H${x + w - rr} Q${x + w} ${y} ${x + w} ${y + rr} V${y + h} Z`, { fill });
  }

  /** Settings page frame with its own sub-navigation. */
  function settingsBase(active) {
    let s = K.shell({ nav: 'settings' });
    s += rect(65, 49, 215, 851, { fill: C.surface2 }) + vline(280, 49, 851);
    s += t(84, 84, '设置', { s: 17, w: 700 });
    const items = ['配置方案', '模型服务与账号', '权限规则', '沙箱', '环境变量', '提示词与记忆', '输出风格', '语言与地区', '通知', '遥测', '高级', '关于'];
    items.forEach((it, i) => {
      const y = 102 + i * 36;
      const on = it === active;
      if (on) s += rect(74, y, 196, 30, { r: 6, fill: C.accentSoft });
      s += t(88, y + 20, it, { s: 13, w: on ? 600 : 400, c: on ? C.accent : C.ink });
    });
    return s;
  }

  // ------------------------------------------------------------------ P17
  window.SCREENS.push({
    id: 'P17',
    group: '扩展',
    title: '钩子',
    summary: '钩子在 Agent 循环的特定时机运行代码。Code Agent 提供在界面里配置的规则式钩子（无需写代码），编译成 SDK 的钩子回调；另有实时记录显示每次触发。来自设置文件的钩子只读列出。',
    frs: ['FR-HOOK-01..06', 'FR-PERM-12'],
    draw() {
      let s = K.shell({ nav: 'hooks' });
      s += t(96, 98, '钩子', { s: 22, w: 700 });
      s += btn(286, 80, '新建规则', { v: 'primary', icon: 'plus', w: 98 });
      s += rect(96, 128, 288, 754, { r: 10, fill: C.surface, stroke: C.border });
      const groups = [
        ['工具', [['PreToolUse', 3], ['PostToolUse', 2], ['PostToolUseFailure'], ['PostToolBatch']]],
        ['提示与显示', [['UserPromptSubmit', 1], ['UserPromptExpansion'], ['MessageDisplay', 1]]],
        ['会话', [['SessionStart'], ['SessionEnd'], ['Setup'], ['Stop', 1], ['StopFailure', 1], ['Notification', 1]]],
        ['代理与任务', [['SubagentStart'], ['SubagentStop'], ['TeammateIdle'], ['TaskCreated'], ['TaskCompleted']]],
        ['压缩', [['PreCompact'], ['PostCompact']]],
        ['模型', [['PreModelSwitch'], ['PostModelSwitch']]],
        ['权限', [['PermissionRequest', 1], ['PermissionDenied']]],
        ['MCP', [['Elicitation'], ['ElicitationResult']]],
        ['配置与文件', [['ConfigChange'], ['InstructionsLoaded'], ['DirectoryAdded'], ['WorktreeCreate'], ['WorktreeRemove'], ['CwdChanged'], ['FileChanged']]],
      ];
      let y = 150;
      groups.forEach(([g, evs]) => {
        s += t(110, y, g, { s: 10.5, w: 700, c: C.muted });
        y += 6;
        evs.forEach(([e, n]) => {
          const on = e === 'PreToolUse';
          if (on) s += rect(102, y, 276, 17, { r: 5, fill: C.accentSoft });
          s += t(114, y + 12.5, e, { s: 11.5, w: on ? 600 : 400, c: on ? C.accent : n ? C.ink : C.ink2, m: true });
          if (n) s += chip(366 - K.chip.w(String(n), { s: 10 }), y + 1, String(n), { h: 15, s: 10, bg: on ? C.surface : C.surface3 });
          y += 17;
        });
        y += 12;
      });

      const X = 404;
      s += t(X, 146, 'PreToolUse', { s: 17, w: 700, m: true });
      s += t(X, 166, '工具运行前 · 可以允许、拒绝、询问、延后决定或改写输入', { s: 12, c: C.muted });
      const rules = [
        ['禁止强制推送', 'Bash', 'command 匹配 git push --force*', '拒绝', C.crit, C.critSoft, '所有配置方案', true],
        ['保护 env 文件', 'Edit|Write', 'file_path 匹配 **/.env*', '拒绝', C.crit, C.critSoft, '所有配置方案'],
        ['生产部署延后决定', 'Bash', 'command 匹配 ./deploy.sh prod*', '延后', C.warnInk, C.warnSoft, '配置方案：默认'],
      ];
      rules.forEach(([name, m, cond, act, ac, abg, scope, on], i) => {
        const ry = 182 + i * 96;
        s += rect(X, ry, 470, 86, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += toggle(X + 14, ry + 14, true);
        s += t(X + 56, ry + 27, name, { s: 13.5, w: 600 });
        s += chip(X + 456 - K.chip.w(act), ry + 12, act, { c: ac, bg: abg, w8: 700 });
        s += chip(X + 56, ry + 38, '匹配 ' + m, { h: 18, s: 10.5 });
        s += t(X + 56, ry + 74, '当 ' + cond, { s: 12, m: true, c: C.ink2 });
        s += t(X + 456, ry + 74, scope, { s: 11.5, c: C.muted, a: 'end' });
      });
      s += rect(X, 474, 470, 70, { r: 8, fill: C.surface2, stroke: C.border, dash: '4 3' });
      s += ic('lock', X + 14, 486, 14, C.muted);
      s += t(X + 36, 498, '来自 .claude/settings.json · 只读', { s: 12.5, w: 600, c: C.ink2 });
      s += t(X + 36, 520, 'command 类型 · 匹配 Bash · ./scripts/check-cmd.sh', { s: 12, c: C.muted });
      s += t(X + 36, 536, '与上面的规则一起执行。', { s: 11.5, c: C.muted });

      const E = 894;
      s += rect(E, 128, 516, 430, { r: 10, fill: C.surface, stroke: C.border });
      s += t(E + 16, 154, '编辑规则', { s: 14, w: 700 });
      s += input(E + 16, 184, 240, { label: '名称', val: '禁止强制推送' });
      s += select(E + 268, 184, 232, 'PreToolUse', { label: '事件', mono: true });
      s += input(E + 16, 250, 484, { label: '匹配器 —— 工具名或模式（Edit|Write、mcp__.*）', val: 'Bash', mono: true });
      s += t(E + 16, 306, '条件', { s: 12, w: 500, c: C.ink2 });
      s += select(E + 16, 314, 170, 'tool_input.command', { h: 30, s: 12, mono: true });
      s += select(E + 194, 314, 120, '匹配通配符', { h: 30, s: 12 });
      s += input(E + 322, 314, 178, { h: 30, val: 'git push --force*', mono: true, s: 12 });
      s += select(E + 16, 372, 230, '拒绝并说明原因', { label: '动作' });
      s += t(E + 258, 393, '共 9 种动作，见说明', { s: 11.5, c: C.muted });
      s += textarea(E + 16, 434, 484, 50, ['禁止强制推送。请推到分支并发起 PR。'], { label: '告诉 Claude 的原因', s: 12 });
      s += input(E + 16, 512, 90, { h: 30, val: '10', right: '秒', s: 12 });
      s += toggle(E + 122, 518, false, '异步执行', { s: 12.5 });
      s += select(E + 236, 512, 160, '所有配置方案', { h: 30, s: 12 });
      s += btn(E + 404, 512, '测试…', { icon: 'play', h: 30, w: 96, s: 12 });

      s += panel(X, 572, 1006, 310, { title: '执行记录', sub: '运行中会话里触发的钩子 · 最新在前' });
      s += seg(X + 790, 580, ['全部', '已拦截', '出错'], 0, { h: 24, s: 11.5 });
      const cols = [[16, '时间'], [100, '事件'], [270, '规则'], [440, '目标'], [760, '结果'], [990, '耗时']];
      cols.forEach(([dx, h], i) => (s += t(X + dx, 632, h, { s: 11, w: 700, c: C.muted, a: i === 5 ? 'end' : undefined })));
      const log = [
        ['14:02:11', 'PreToolUse', '禁止强制推送', 'Bash · git push --force origin main', 'crit', '已拒绝', '2 ms'],
        ['14:01:58', 'PostToolUse', '审计日志（内置）', 'Edit · src/cart/timer.ts', 'good', '已记录', '1 ms'],
        ['14:01:40', 'UserPromptSubmit', '会话标题（内置）', '第 1 条提问', 'good', '已设置标题', '4 ms'],
        ['14:00:05', 'Notification', '通知（内置）', '等待审批', 'info', '已通知', '1 ms'],
        ['13:58:47', 'PreToolUse', 'check-cmd.sh（设置文件）', 'Bash · npm ci', 'good', '已允许', '84 ms'],
        ['13:57:12', 'Stop', 'Webhook：team-log', '本轮结束', 'crit', '错误：502', '3.0 s'],
      ];
      log.forEach(([tm, ev, rule, target, st, out, dur], i) => {
        const ly = 642 + i * 38;
        s += hline(X + 1, ly, 1004, '#eef0f4');
        s += t(X + 16, ly + 24, tm, { s: 12, m: true, c: C.ink2 });
        s += t(X + 100, ly + 24, ev, { s: 12, m: true });
        s += t(X + 270, ly + 24, rule, { s: 12.5 });
        s += t(X + 440, ly + 24, target, { s: 12, c: C.ink2 });
        s += status(X + 760, ly + 10, st, out);
        s += t(X + 990, ly + 24, dur, { s: 12, a: 'end', c: C.ink2 });
      });

      s += mk(100, 132, 1) + mk(X - 4, 186, 2) + mk(E - 6, 242, 3) + mk(E - 6, 300, 4) + mk(E - 6, 364, 5);
      s += mk(E - 6, 428, 6) + mk(E + 232, 506, 7) + mk(E + 500, 506, 8) + mk(X - 4, 576, 9) + mk(X - 4, 478, 10);
      return s;
    },
    notes: [
      ['事件', 'SDK 的全部 33 个钩子事件，分组显示（事件名保持英文原名）。数字表示该事件有几条规则；没有规则的事件颜色变浅但可选。', '`HookEvent`'],
      ['规则', '所选事件的规则按顺序执行（可拖动排序）。每条显示匹配器、条件、动作和作用范围；开关可停用规则而不删除。', '`hooks: { [event]: HookCallbackMatcher[] }`（FR-HOOK-01）'],
      ['匹配器', '规则作用于哪个工具（或其他事件字段），规则与设置文件一致：精确名称、`Edit|Write`、正则如 `mcp__.*`。', '`HookCallbackMatcher.matcher`'],
      ['条件', '可选，对钩子输入做判断：选字段（tool_input.command、file_path、prompt…）、运算符（等于、包含、匹配通配符/正则）和值。', '在编译后的回调里对 `HookInput` 求值'],
      ['动作', 'PreToolUse 可以：允许、拒绝、询问用户、延后决定、改写输入。其他事件可以：给 Claude 补充上下文、设置会话标题、改写工具输出、通知、记录日志，或调用 Webhook 并以其 JSON 返回作为钩子输出。', '`SyncHookJSONOutput`（`permissionDecision`、`updatedInput`、`additionalContext`、`sessionTitle`、`updatedToolOutput`…）（FR-HOOK-02）'],
      ['原因', '拒绝 / 询问时发给 Claude 的文字，或要注入的上下文。可用中文书写。', '`permissionDecisionReason`、`reason`、`systemMessage`'],
      ['超时、异步、范围', '每条规则的超时；异步规则从不阻塞 Agent（适合日志和 Webhook）。范围：所有配置方案或某一个。修改从运行中会话的下一轮起生效。', '`timeout`；`{ async: true }`；`applyFlagSettings({ hooks })`（FR-HOOK-06）'],
      ['测试', '用示例输入（或执行记录里的一次真实事件）运行规则，显示它会返回的钩子输出。', '—'],
      ['执行记录', '每次触发的钩子，包括内置钩子和设置文件中的钩子，附结果和耗时。出错的（如 Webhook 失败）附响应内容。', '`includeHookEvents` → `hook_started` / `hook_progress` / `hook_response`（FR-HOOK-04）'],
      ['设置文件中的钩子', '设置文件里定义的钩子（command、http、mcp_tool、prompt 或 agent 类型）只读显示，并注明来源。', '`resolveSettings()`（FR-HOOK-05）'],
    ],
  });

  // ------------------------------------------------------------------ P18
  window.SCREENS.push({
    id: 'P18',
    group: '扩展',
    title: '结构化输出作业',
    summary: '可复用的一次性作业，必须返回符合 schema 的 JSON——提取、分拣、审计等。作业以普通会话的形式运行（可以打开继续追问），结果会按 schema 校验。',
    frs: ['FR-JOB-01..03'],
    draw() {
      let s = K.shell({ nav: 'jobs' });
      s += t(96, 98, '作业', { s: 22, w: 700 });
      s += btn(232, 80, '新建作业', { v: 'primary', icon: 'plus', w: 96 });
      s += rect(96, 128, 232, 754, { r: 10, fill: C.surface, stroke: C.border });
      const jobs = [
        ['提取 API 接口', 'good', '成功 · 12 分钟前', true],
        ['总结 PR', 'good', '成功 · 昨天'],
        ['分拣新 Issue', 'crit', '失败 · 周一'],
        ['依赖审计', 'idle', '从未运行'],
      ];
      jobs.forEach(([n, st, label, on], i) => {
        const y = 140 + i * 64;
        if (on) s += rect(102, y, 220, 58, { r: 8, fill: C.accentSoft });
        s += ic('braces', 114, y + 12, 16, on ? C.accent : C.ink2);
        s += t(138, y + 24, n, { s: 13, w: 600, c: on ? C.accent : C.ink });
        s += status(138, y + 32, st, label);
      });

      const X = 348;
      s += rect(X, 128, 560, 754, { r: 10, fill: C.surface, stroke: C.border });
      s += input(X + 16, 164, 528, { label: '名称', val: '提取 API 接口' });
      s += select(X + 16, 230, 258, 'D:\\src\\shop-api', { label: '工作区', icon: 'folder' });
      s += select(X + 286, 230, 258, '评审（只读）', { label: '配置方案', icon: 'layers' });
      s += t(X + 16, 290, '提示词', { s: 12, w: 500, c: C.ink2 });
      s += rect(X + 16, 298, 528, 70, { r: 6, fill: C.surface, stroke: C.borderStrong });
      s += runs(X + 26, 320, [['列出 '], ['{{dir}}', C.accent, 700], [' 下定义的所有 HTTP 接口，']], { s: 12.5 });
      s += t(X + 26, 340, '包括方法、路径以及是否需要鉴权。', { s: 12.5 });
      s += t(X + 16, 392, '输出结构（JSON Schema）', { s: 12, w: 500, c: C.ink2 });
      s += status(X + 450, 378, 'good', '结构有效');
      s += code(X + 16, 402, 528, [
        '{',
        [['  "type"', C.accent], [': "object",']],
        [['  "required"', C.accent], [': ["endpoints"],']],
        [['  "properties"', C.accent], [': {']],
        [['    "endpoints"', C.accent], [': {']],
        [['      "type"', C.accent], [': "array",']],
        [['      "items"', C.accent], [': {']],
        [['        "required"', C.accent], [': ["method", "path"],']],
        [['        "properties"', C.accent], [': {']],
        [['          "method"', C.accent], [': { "enum": ["GET","POST","PUT","DELETE"] },']],
        [['          "path"', C.accent], [': { "type": "string" },']],
        [['          "auth"', C.accent], [': { "type": "boolean" }']],
        '        } } } } }',
      ], { s: 12, lh: 18, bg: C.surface });
      s += t(X + 16, 674, '也可以从 TypeScript 类型或 Zod 定义生成 schema。', { s: 11.5, c: C.muted });
      s += input(X + 16, 708, 120, { label: '最大轮数', val: '20' });
      s += input(X + 148, 708, 120, { label: '预算', val: '1.00', right: 'USD' });
      s += check(X + 284, 716, true, '保存为会话', { s: 12.5 });
      s += btn(X + 444, 840, '保存', { v: 'primary', w: 100 });

      const R = 928;
      s += rect(R, 128, 482, 754, { r: 10, fill: C.surface, stroke: C.border });
      s += t(R + 16, 156, '运行', { s: 14, w: 700 });
      s += input(R + 16, 186, 300, { label: 'dir', val: 'src/routes', mono: true });
      s += btn(R + 328, 186, '运行作业', { v: 'primary', icon: 'play', w: 138, h: 32 });
      s += hline(R, 236, 482);
      s += t(R + 16, 264, '最近一次 · 12 分钟前', { s: 13, w: 600 });
      s += status(R + 16, 274, 'good', '输出有效');
      s += t(R + 116, 288, '14 轮 · 38 秒 · $0.12', { s: 12, c: C.ink2 });
      s += code(R + 16, 306, 450, [
        '{',
        [['  "endpoints"', C.accent], [': [']],
        [['    { "method": ', C.ink], ['"GET"', C.goodInk], [', "path": ', C.ink], ['"/orders"', C.goodInk], [', "auth": true },']],
        [['    { "method": ', C.ink], ['"POST"', C.goodInk], [', "path": ', C.ink], ['"/orders"', C.goodInk], [', "auth": true },']],
        [['    { "method": ', C.ink], ['"GET"', C.goodInk], [', "path": ', C.ink], ['"/health"', C.goodInk], [', "auth": false },']],
        [['    … 另外 11 项', C.muted]],
        '  ]',
        '}',
      ], { s: 12, lh: 18 });
      s += btn(R + 16, 476, '复制 JSON', { icon: 'copy', w: 110, h: 28, s: 12 });
      s += btn(R + 134, 476, '打开会话', { icon: 'chat', w: 104, h: 28, s: 12 });
      s += btn(R + 246, 476, '下载', { icon: 'download', w: 80, h: 28, s: 12 });
      s += hline(R, 524, 482);
      s += t(R + 16, 552, '历史', { s: 13, w: 600 });
      const runsList = [
        ['10月27日 14:10', 'good', '有效', '$0.12', 'src/routes'],
        ['10月26日 09:31', 'crit', '重试后仍无有效输出', '$0.31', 'src/'],
        ['10月25日 17:02', 'good', '有效', '$0.10', 'src/routes'],
        ['10月24日 11:45', 'warn', '已停止：达到最大轮数', '$0.22', 'src/'],
      ];
      runsList.forEach(([when, st, label, cost, arg], i) => {
        const y = 566 + i * 52;
        s += rect(R + 16, y, 450, 44, { r: 8, fill: C.surface2, stroke: C.border });
        s += t(R + 28, y + 18, when, { s: 12, c: C.ink2 });
        s += t(R + 28, y + 35, 'dir = ' + arg, { s: 11.5, m: true, c: C.muted });
        s += status(R + 160, y + 12, st, label);
        s += t(R + 454, y + 27, cost, { s: 12.5, a: 'end' });
      });

      s += mk(100, 132, 1) + mk(X + 276, 246, 2) + mk(X + 12, 300, 3) + mk(X + 12, 404, 4) + mk(R + 8, 202, 5);
      s += mk(R + 12, 310, 6) + mk(R + 130, 478, 7) + mk(R + 12, 620, 8);
      return s;
    },
    notes: [
      ['作业模板', '已保存的作业及其最近一次运行的状态。', '应用 `JobTemplate`（FR-JOB-01）'],
      ['工作区与配置方案', '作业在哪里运行、用哪个配置方案——通常用只读配置方案，避免作业改动文件。', '`cwd`；配置方案 → `Options`'],
      ['带变量的提示词', '`{{name}}` 占位符会成为「运行」面板中的输入项。', '提示词文本'],
      ['输出结构', 'JSON Schema 编辑器，带校验和示例；可以粘贴 TypeScript / Zod 类型自动转换。', '`outputFormat: { type: "json_schema", schema }`'],
      ['运行', '填写变量后以单消息会话启动作业，进度在此面板流式显示。', '`query({ prompt: string, options })`'],
      ['校验后的结果', 'Claude 返回且通过校验的 JSON，附轮数、耗时和费用。', '`result.structured_output`、`num_turns`、`total_cost_usd`（FR-JOB-02）'],
      ['打开会话', '打开作业对应的会话，可以继续追问或接着做。', '`session_id` → `resume`（FR-JOB-03）'],
      ['历史', '每次运行的参数和结果。失败会说明原因：重试后仍无有效输出、达到最大轮数、超出预算。', '`error_max_structured_output_retries`、`error_max_turns`、`error_max_budget_usd`'],
    ],
  });

  // ------------------------------------------------------------------ P19
  // Deterministic sample data: 30 days × 3 models.
  const DAYS = Array.from({ length: 30 }, (_, i) => {
    const wk = i % 7 === 5 || i % 7 === 6 ? 0.3 : 1;
    return [
      +(wk * (0.6 + 1.6 * Math.abs(Math.sin(i * 1.3)))).toFixed(2),
      +(wk * (0.2 + 0.6 * Math.abs(Math.cos(i * 0.7)))).toFixed(2),
      +(wk * (0.05 + 0.2 * Math.abs(Math.sin(i * 2.1)))).toFixed(2),
    ];
  });
  const TOTAL = DAYS.reduce((a, d) => a + d[0] + d[1] + d[2], 0);

  window.SCREENS.push({
    id: 'P19',
    group: '洞察',
    title: '用量与费用',
    summary: '所有会话的费用和 token 用量，来自每条结果消息，重启后不丢失。一行筛选条件控制页面上所有图表；每个图表都有表格视图。日期、数字按界面语言格式化。',
    frs: ['FR-COST-03..05', 'FR-I18N-04'],
    draw() {
      let s = K.shell({ nav: 'usage' });
      s += t(96, 98, '用量', { s: 22, w: 700 });
      s += seg(96, 116, ['7 天', '30 天', '90 天', '本月至今'], 1, { h: 30 });
      s += t(390, 136, '分组', { s: 12.5, c: C.ink2 });
      s += seg(424, 116, ['模型', '工作区', '配置方案'], 0, { h: 30 });
      s += select(640, 116, 180, '所有工作区', { h: 30, s: 12.5, icon: 'folder' });
      s += btn(1300, 116, '导出 CSV', { icon: 'download', w: 110, h: 30, s: 12.5 });

      const tiles = [
        ['费用', '$' + TOTAL.toFixed(2), '比前 30 天 +12%'],
        ['会话', '126', '9 个作业 · 3 个因预算上限停止'],
        ['Tokens', '18.4M', '输入 6.1M · 输出 1.2M · 缓存 11.1M'],
        ['缓存读取', '82%', '输入 tokens 中来自缓存的比例'],
      ];
      tiles.forEach(([k, v, sub], i) => {
        const x = 96 + i * 332;
        s += rect(x, 162, 318, 92, { r: 10, fill: C.surface, stroke: C.border });
        s += t(x + 16, 188, k, { s: 12.5, c: C.ink2 });
        s += t(x + 16, 222, v, { s: 26, w: 700 });
        s += t(x + 16, 242, sub, { s: 11.5, c: C.muted });
      });

      s += rect(96, 270, 912, 380, { r: 10, fill: C.surface, stroke: C.border });
      s += t(112, 298, '每日费用（按模型）', { s: 14, w: 700 });
      const names = ['Opus 5.5', 'Sonnet 5', 'Haiku 4.5'];
      let lx = 112;
      names.forEach((n, i) => {
        s += rect(lx, 314, 12, 12, { r: 3, fill: C.series[i] });
        s += t(lx + 18, 324.5, n, { s: 12, c: C.ink2 });
        lx += 18 + tw(n, 12) + 18;
      });
      s += seg(894, 284, ['图表', '表格'], 0, { h: 26, s: 11.5 });
      const base = 610;
      const k = 64;
      const px = 150;
      const slot = 25;
      [0, 1, 2, 3, 4].forEach((v) => {
        const y = base - v * k;
        s += line(px, y, px + 30 * slot, y, { c: v === 0 ? C.axis : C.grid });
        s += t(px - 8, y + 4, '$' + v, { s: 11, c: C.muted, a: 'end' });
      });
      const hov = 21;
      s += rect(px + hov * slot, base - 4 * k - 6, slot, 4 * k + 6, { fill: C.surface3 });
      DAYS.forEach((d, i) => {
        const x = px + i * slot + 4;
        const w = slot - 8;
        let cum = 0;
        d.forEach((v, j) => {
          const h = v * k;
          const yTop = base - cum - h;
          const hh = j === 0 ? h : h - 2;
          if (j === 2) s += topRounded(x, yTop, w, Math.max(hh, 1), 4, C.series[j]);
          else s += rect(x, yTop, w, Math.max(hh, 1), { fill: C.series[j] });
          cum += h;
        });
      });
      const last = DAYS[29];
      let cy = base;
      last.forEach((v, j) => {
        const h = v * k;
        s += t(px + 30 * slot + 6, Math.min(cy - h / 2 + 4, cy - 2), names[j], { s: 11, c: C.ink2 });
        cy -= h;
      });
      ['9月28日', '10月5日', '10月12日', '10月19日', '10月26日'].forEach((d, i) => {
        s += t(px + i * 7 * slot + slot / 2, base + 18, d, { s: 11, c: C.muted, a: 'middle' });
      });
      const hd = DAYS[hov];
      const tx = px + hov * slot + slot + 8;
      s += rect(tx, 352, 178, 112, { r: 8, fill: C.surface, stroke: C.border, shadow: true });
      s += t(tx + 12, 374, '10月19日', { s: 12, w: 700 });
      s += t(tx + 166, 374, '$' + (hd[0] + hd[1] + hd[2]).toFixed(2), { s: 12, w: 700, a: 'end' });
      names.forEach((n, j) => {
        const ry = 398 + j * 20;
        s += rect(tx + 12, ry - 9, 10, 10, { r: 2, fill: C.series[j] });
        s += t(tx + 28, ry, n, { s: 12, c: C.ink2 });
        s += t(tx + 166, ry, '$' + hd[j].toFixed(2), { s: 12, a: 'end' });
      });
      s += t(tx + 12, 456, '14 个会话 · 点击筛选', { s: 11, c: C.muted });

      s += panel(1024, 270, 386, 380, { title: '按工作区' });
      const wsRows = [['shop-api', 64, 0.55], ['data-pipeline', 18, 0.19], ['infra', 21, 0.12], ['shop-web', 15, 0.09], ['笔记', 8, 0.05]];
      wsRows.forEach(([n, ses, share], i) => {
        const y = 332 + i * 60;
        s += t(1040, y, n, { s: 13, w: 600 });
        s += t(1394, y, '$' + (TOTAL * share).toFixed(2), { s: 13, w: 600, a: 'end' });
        s += rect(1040, y + 10, 354 * share / 0.55, 10, { r: 3, fill: C.series[0] });
        s += t(1040, y + 38, `${ses} 个会话 · ${(share * 100).toFixed(0)}%`, { s: 11.5, c: C.muted });
      });

      s += panel(96, 666, 700, 216, { title: '费用最高的会话' });
      const top = [
        ['迁移到 Postgres 17', 'data-pipeline', 'Opus 5.5', '$5.77', '预算上限'],
        ['排查内存泄漏', 'infra', 'Opus 5.5', '$3.12', null],
        ['为 /orders 添加限流', 'shop-api', 'Opus 5.5 + Haiku', '$2.40', null],
        ['重构鉴权中间件', 'shop-api', 'Sonnet 5', '$1.08', '运行中'],
      ];
      top.forEach(([n, ws, m, c, note], i) => {
        const y = 728 + i * 38;
        s += t(112, y, n, { s: 13, w: 500 });
        s += t(400, y, ws, { s: 12.5, c: C.ink2 });
        s += t(530, y, m, { s: 12.5, c: C.ink2 });
        if (note) s += chip(660, y - 14, note, { h: 18, s: 10.5, bg: note === '运行中' ? C.accentSoft : C.warnSoft, c: note === '运行中' ? C.accent : C.warnInk });
        s += t(780, y, c, { s: 13, w: 600, a: 'end' });
      });

      s += panel(812, 666, 598, 216, { title: '限额与提醒' });
      s += t(828, 728, '速率限制 · 5 小时窗口', { s: 12.5, c: C.ink2 });
      s += status(828, 738, 'warn', '接近上限');
      s += t(1100, 752, '84% · 21:30 重置', { s: 12.5, a: 'end' });
      s += progress(828, 766, 272, 84, C.warn, 6);
      s += toggle(1130, 718, true, '每月超过 $50 时提醒', { s: 12.5 });
      s += toggle(1130, 752, true, '会话达到上限时提醒', { s: 12.5 });
      s += t(828, 818, '费用是 SDK 在客户端的估算，以服务商账单为准；使用 Claude 订阅时为等价参考值。', { s: 11.5, c: C.muted });
      s += t(828, 840, '总计包含子代理的 tokens。', { s: 11.5, c: C.muted });

      s += mk(92, 112, 1) + mk(92, 166, 2) + mk(890, 280, 3) + mk(px - 36, 480, 4) + mk(tx + 174, 356, 5);
      s += mk(1020, 274, 6) + mk(92, 670, 7) + mk(808, 670, 8);
      return s;
    },
    notes: [
      ['筛选条件', '日期范围、分组方式和工作区作用于页面上的所有卡片和图表。导出下载筛选后的账本（UTF-8 CSV，含 BOM 便于 Excel 打开中文）。', '应用费用账本（FR-COST-03、FR-I18N-08）'],
      ['统计卡片', '所选范围内的核心数字，并与上一周期对比。数字格式跟随「语言与地区」设置。', '每条结果的 `total_cost_usd`、`usage`、`modelUsage`（FR-I18N-04）'],
      ['图例与表格视图', '图例标出每个系列（颜色从不是唯一线索）；「表格」把同样的数字按行显示。', '—'],
      ['每日费用柱状图', '按所选分组堆叠，颜色顺序固定；最后一根柱子旁也直接标注系列名。单一纵轴，从 0 开始。', '按天汇总的账本'],
      ['悬停提示', '悬停某天会高亮该列，列出各系列及合计；点击后下方会话表筛选为当天。', '—'],
      ['按工作区', '各工作区的费用占比，单色条形并直接标注数值。', '按 `cwd` 汇总的账本'],
      ['费用最高的会话', '范围内费用最高的会话；因预算上限停止的会标注。点击打开。', '`error_max_budget_usd` 结果'],
      ['限额与提醒', '当前速率限制使用率和重置时间；每月费用提醒和会话达到上限提醒。明确说明费用是估算值。', '`rate_limit_event`；`maxBudgetUsd`（FR-COST-04）'],
    ],
  });

  // ------------------------------------------------------------------ P20
  window.SCREENS.push({
    id: 'P20',
    group: '设置',
    title: '设置 — 配置方案',
    summary: '配置方案是一组命名的 SDK 选项，用来启动会话。编辑器按用途分组；附加的注册表项（MCP 服务器、代理、技能、插件、钩子）在这里勾选，在各自页面编辑。',
    frs: ['FR-CFG-01..03', 'FR-CFG-09', 'FR-MOD-01..08', 'FR-PERM-01/02/10/14', 'FR-PROMPT-01/02', 'FR-COST-01', 'FR-I18N-05'],
    draw() {
      let s = settingsBase('配置方案');
      s += rect(296, 66, 220, 816, { r: 10, fill: C.surface, stroke: C.border });
      s += t(312, 92, '配置方案', { s: 14, w: 700 });
      s += btn(452, 74, '', { icon: 'plus', w: 28, h: 28 });
      const profs = [['默认', '新会话使用', true, '★'], ['评审', '只读，不能用 Bash'], ['无人值守 CI', '不询问 · 一律拒绝'], ['实验', '允许跳过权限检查', false, '⚠']];
      profs.forEach(([n, d, on, mark], i) => {
        const y = 108 + i * 58;
        if (on) s += rect(302, y, 208, 52, { r: 8, fill: C.accentSoft });
        s += t(316, y + 22, n + (mark ? '  ' + mark : ''), { s: 13.5, w: 600, c: mark === '⚠' ? C.crit : on ? C.accent : C.ink });
        s += t(316, y + 40, d, { s: 11.5, c: C.muted });
      });

      const X = 532;
      s += t(X, 90, '默认', { s: 20, w: 700 });
      s += btn(1130, 70, '复制', { icon: 'copy', w: 80, h: 30, s: 12.5 });
      s += btn(1218, 70, '导出', { icon: 'download', w: 80, h: 30, s: 12.5 });
      s += btn(1306, 70, '保存', { v: 'primary', w: 104, h: 30 });
      s += rect(X, 110, 878, 34, { r: 8, fill: C.accentSoft, stroke: C.accentLine });
      s += ic('info', X + 12, 119, 16, C.accent);
      s += t(X + 36, 131.5, '「Read」已预先授权，所以 Read 调用永远不会出现在审批里。这通常是预期的。', { s: 12.5, c: C.ink });
      s += t(X + 866, 131.5, '知道了', { s: 12, c: C.accent, a: 'end' });

      const A = X;
      const B = X + 448;
      const sec = (x, y, label) => t(x, y, label, { s: 11.5, w: 700, c: C.muted });
      s += sec(A, 172, '模型');
      s += select(A, 182, 210, 'Opus 5.5');
      s += select(A + 220, 182, 210, 'Sonnet 5, Haiku 4.5');
      s += t(A + 220, 228, '回退链', { s: 11, c: C.muted });
      s += t(A, 252, '推理强度', { s: 12, c: C.ink2 });
      s += seg(A + 60, 236, ['低', '中', '高', '超高', '最高'], 2, { h: 26, s: 11.5 });
      s += t(A, 286, '思考', { s: 12, c: C.ink2 });
      s += seg(A + 60, 270, ['自适应', '固定预算', '关闭'], 0, { h: 26, s: 11.5 });
      s += seg(A + 260, 270, ['显示摘要', '不显示'], 0, { h: 26, s: 11.5 });
      s += toggle(A, 310, false, '快速模式', { hint: '模型支持时可用', s: 12.5 });

      s += sec(A, 360, '权限');
      s += select(A, 370, 210, '编辑前询问', { icon: 'shield' });
      s += seg(A + 220, 372, ['问我', '直接拒绝（无人值守）'], 0, { h: 28, s: 11.5 });
      s += toggle(A, 416, false, '允许跳过权限检查', { hint: '危险 · 每次都需确认', s: 12.5 });
      s += t(A, 458, '预先授权', { s: 12, c: C.ink2 });
      let cx = A + 90;
      ['Read', 'Grep', 'Glob', 'Bash(npm test *)'].forEach((r) => {
        s += chip(cx, 444, r, { m: true, h: 20, s: 10.5 });
        cx += K.chip.w(r, { m: true, s: 10.5 }) + 5;
      });
      s += t(A, 492, '禁止', { s: 12, c: C.ink2 });
      s += chip(A + 90, 478, 'Bash(rm -rf *)', { m: true, h: 20, s: 10.5, bg: C.critSoft, c: C.crit });
      s += chip(A + 90 + K.chip.w('Bash(rm -rf *)', { m: true, s: 10.5 }) + 5, 478, 'WebFetch(domain:pastebin.com)', { m: true, h: 20, s: 10.5, bg: C.critSoft, c: C.crit });
      s += t(A, 524, '全部规则及其来源 → 权限规则', { s: 12, c: C.accent });

      s += sec(A, 562, '限制');
      s += input(A, 572, 130, { val: '50', right: '轮' });
      s += input(A + 140, 572, 130, { val: '5.00', right: 'USD' });
      s += input(A + 280, 572, 150, { ph: '任务预算', right: 'tokens' });

      s += sec(A, 640, '附加内容');
      const att = [['MCP 服务器', 'github、postgres'], ['代理', 'test-runner、code-reviewer'], ['技能', '仅所选 · 5'], ['插件', 'git-tools'], ['钩子', '6 条规则（4 条全局）']];
      att.forEach(([k2, v], i) => {
        const y = 650 + i * 44;
        s += rect(A, y, 430, 38, { r: 8, fill: C.surface, stroke: C.border });
        s += t(A + 12, y + 24, k2, { s: 12.5, c: C.ink2 });
        s += t(A + 120, y + 24, v, { s: 12.5, w: 500 });
        s += ic('chevRight', A + 404, y + 11, 16, C.muted);
      });

      s += sec(B, 172, '工具');
      s += seg(B, 182, ['Claude Code 预设', '自定义列表'], 0, { h: 28, s: 12 });
      s += toggle(B, 222, true, '任务清单工具', { hint: '在默认不提供的模型上开启', s: 12.5 });
      s += toggle(B, 250, true, '提问预览', { hint: 'HTML', s: 12.5 });

      s += sec(B, 302, '上下文');
      s += t(B, 328, '加载设置来源', { s: 12, c: C.ink2 });
      s += check(B + 96, 316, true, '用户', { s: 12.5 });
      s += check(B + 160, 316, true, '项目', { s: 12.5 });
      s += check(B + 224, 316, true, '本地', { s: 12.5 });
      s += t(B, 362, '系统提示词', { s: 12, c: C.ink2 });
      s += seg(B + 72, 346, ['Claude Code', '+ 追加', '自定义', '最简'], 1, { h: 26, s: 11.5 });
      s += textarea(B, 380, 430, 48, ['尽量小步提交。先跑最小范围的测试。'], { s: 12 });
      s += t(B, 460, '回复语言', { s: 12, c: C.ink2 });
      s += select(B + 72, 442, 210, '跟随界面语言', { h: 28, s: 12 });
      s += t(B + 292, 460, '会话期间不可更改', { s: 11.5, c: C.muted });

      s += sec(B, 500, '会话功能');
      const feats = [
        ['文件检查点', true], ['下一步提示建议', true], ['显示子代理的文字', true],
        ['子代理进度摘要', true], ['在事件流中包含钩子事件', true], ['会话保存到磁盘', true],
        ['原样发送提示', false],
      ];
      feats.forEach(([f, on], i) => {
        s += toggle(B, 512 + i * 30, on, f, { s: 12.5 });
      });
      s += t(B, 738, '界面始终开启消息的流式输出。', { s: 11.5, c: C.muted });

      s += mk(80, 100, 1) + mk(300, 112, 2) + mk(X - 10, 126, 3) + mk(A - 14, 166, 4) + mk(A - 14, 354, 5);
      s += mk(B - 16, 166, 6) + mk(B - 16, 296, 7) + mk(A - 14, 556, 8) + mk(B - 16, 494, 9) + mk(A - 14, 634, 10) + mk(1126, 72, 11);
      return s;
    },
    notes: [
      ['设置分区', '配置方案、模型服务与账号、权限规则、沙箱、环境变量、提示词与记忆（CLAUDE.md 和规则编辑器）、输出风格、语言与地区、通知、遥测、高级运行时选项。', '—'],
      ['配置方案', '命名的选项组合；其中一个是新会话的默认方案。标 ⚠ 的允许跳过权限检查。正被运行中会话使用的方案会有标记；修改只对新会话生效。', '配置方案 → `Options`（FR-CFG-01）'],
      ['配置提醒', '编辑器会说明哪些设置会悄悄绕过审批（预先授权中只写了工具名、跳过权限检查模式），以及缺少的工具（如移除了 AskUserQuestion）。', '`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`（FR-PERM-14、FR-ASK-05）'],
      ['模型', '模型、回退链、推理强度、思考方式及显示方式、快速模式。', '`model`、`fallbackModel`、`effort`、`thinking`、设置项 `fastMode`'],
      ['权限', '起始模式；由谁回答审批（你，或无人值守时一律拒绝）；是否允许跳过权限检查；预先授权和禁止的工具规则。', '`permissionMode`、`permissionPrompts`、`allowDangerouslySkipPermissions`、`allowedTools`、`disallowedTools`'],
      ['工具', 'Claude Code 的完整工具集或自定义列表；开启任务清单工具；澄清提问的预览。', '`tools`、`CLAUDE_CODE_ENABLE_TODO_TOOLS`、`toolConfig.askUserQuestion.previewFormat`'],
      ['上下文与回复语言', '加载哪些设置来源（随之加载 CLAUDE.md、规则、技能、命令、代理、钩子），系统提示词：Claude Code 预设、追加文字、完全自定义或最简。回复语言决定 Claude 用什么语言回答和生成会话标题。', '`settingSources`、`systemPrompt`、`settings.language`（FR-PROMPT-01/02、FR-I18N-05）'],
      ['限制', '最大轮数、预算，以及 alpha 阶段的 token 任务预算。', '`maxTurns`、`maxBudgetUsd`、`taskBudget`'],
      ['会话功能', '检查点、下一步提示建议、子代理文字和进度摘要、钩子事件、持久化、原样发送。', '`enableFileCheckpointing`、`promptSuggestions`、`forwardSubagentText`、`agentProgressSummaries`、`includeHookEvents`、`persistSession`、`verbatimPrompts`'],
      ['附加的注册表项', '方案中包含的 MCP 服务器、代理、技能、插件和钩子；每行点击打开对应页面。', '`mcpServers`、`agents`、`skills`、`plugins`、`hooks`'],
      ['复制 / 导出 / 保存', '配置方案可导出、导入为 JSON（只引用密钥，从不导出密钥本身）。', '—'],
    ],
  });

  // ------------------------------------------------------------------ P21
  window.SCREENS.push({
    id: 'P21',
    group: '设置',
    title: '设置 — 权限规则与沙箱',
    summary: '所有允许 / 询问 / 拒绝规则集中在一张表里，注明各自的存放位置；说明 Claude Code 检查它们的顺序；以及命令沙箱的配置。',
    frs: ['FR-PERM-08', 'FR-CFG-05', 'FR-CFG-07'],
    draw() {
      let s = settingsBase('权限规则');
      const X = 300;
      s += t(X, 92, '权限规则', { s: 20, w: 700 });
      s += t(X, 114, '一次工具调用如何被决定——最先做出决定的环节生效：', { s: 12.5, c: C.ink2 });
      const steps = [['钩子', '可拒绝或允许'], ['拒绝规则', '总是优先'], ['询问规则', '总是询问'], ['权限模式', '如自动接受编辑'], ['允许规则', '预先授权'], ['你', '审批卡片']];
      steps.forEach(([n, d], i) => {
        const bx = X + i * 186;
        s += box(bx, 128, 160, 50, n, d, { fill: i === 1 ? C.critSoft : i === 5 ? C.accentSoft : C.surface, s: 12.5 });
        if (i < steps.length - 1) s += arrow(bx + 162, 153, bx + 184, 153);
      });

      s += rect(X, 196, 720, 448, { r: 10, fill: C.surface, stroke: C.border });
      s += tabs(X + 16, 224, [['允许', 9], ['询问', 2], ['拒绝', 4]], 0, { s: 13.5, gap: 26, rule: [X, 720] });
      s += input(X + 16, 248, 300, { h: 32, val: 'Bash(npm run lint *)', mono: true, s: 12.5, focus: true });
      s += select(X + 326, 248, 230, '保存到：配置方案「默认」', { h: 32, s: 12.5 });
      s += btn(X + 566, 248, '添加规则', { v: 'primary', w: 138, h: 32 });
      const cols = [[16, '规则'], [270, '匹配范围'], [500, '存放位置']];
      cols.forEach(([dx, h]) => (s += t(X + dx, 304, h, { s: 11, w: 700, c: C.muted })));
      const rules = [
        ['Read', '所有文件读取', '配置方案 · 默认'],
        ['Bash(npm test *)', '以「npm test」开头的命令', '配置方案 · 默认'],
        ['Bash(git status)', '恰好是「git status」', '.claude/settings.local.json'],
        ['Edit(/src/**)', './src 下的编辑', '配置方案 · 默认'],
        ['WebFetch(domain:docs.github.com)', '从该域名抓取', '~/.claude/settings.json'],
        ['mcp__github__list_*', 'GitHub 的 list 类工具', '配置方案 · 默认'],
        ['Agent(Explore)', 'Explore 子代理', '配置方案 · 默认'],
        ['Skill(code-review)', 'code-review 技能', '.claude/settings.json 🔒'],
      ];
      rules.forEach(([r, m, src], i) => {
        const y = 314 + i * 40;
        s += hline(X + 1, y, 718, '#eef0f4');
        s += t(X + 16, y + 25, r, { s: 12.5, m: true });
        s += t(X + 270, y + 25, m, { s: 12.5, c: C.ink2 });
        const isProfile = src.startsWith('配置方案');
        s += t(X + 500, y + 25, src, { s: 12, c: isProfile ? C.ink2 : C.accent, m: !isProfile });
        s += ic('trash', X + 690, y + 12, 15, C.muted);
      });

      s += panel(1036, 196, 374, 448, { title: '规则语法' });
      const syn = [
        ['Bash(npm run *)', '命令前缀 / 模式'],
        ['PowerShell(Get-ChildItem *)', 'PowerShell 命令'],
        ['Read(~/secrets/**)', '路径：~ 为主目录，/x 相对工作区'],
        ['Edit(//etc/**)', '// 表示绝对路径'],
        ['WebFetch(domain:x.com)', '单个域名'],
        ['mcp__github__*', '某个服务器的全部工具'],
        ['Agent(Explore)', '某种子代理'],
        ['Skill(deploy *)', '按名称匹配技能'],
      ];
      syn.forEach(([r, d], i) => {
        const y = 256 + i * 40;
        s += t(1052, y, r, { s: 12, m: true, c: C.accent });
        s += t(1052, y + 17, d, { s: 11.5, c: C.muted });
      });
      s += t(1052, 590, 'Edit 规则同样覆盖 Write 和 NotebookEdit。', { s: 11.5, c: C.ink2 });
      s += t(1052, 610, '拒绝规则在跳过权限检查模式下依然生效。', { s: 11.5, c: C.ink2 });

      s += panel(X, 660, 1110, 222, { title: '命令沙箱', sub: '在操作系统层面隔离 Bash 命令' });
      s += toggle(X + 16, 712, true, '启用', { s: 13 });
      s += toggle(X + 16, 742, true, '沙箱无法启动时停止', { s: 12.5 });
      s += toggle(X + 16, 772, true, '沙箱内的 Bash 自动批准', { s: 12.5 });
      s += toggle(X + 16, 802, false, '允许 Claude 申请在沙箱外运行', { s: 12.5 });
      s += toggle(X + 16, 832, false, '允许绑定本地端口', { s: 12.5 });
      const lists = [
        [X + 340, '网络 · 允许的域名', ['registry.npmjs.org', '*.github.com'], false],
        [X + 340, '网络 · 禁止的域名', ['pastebin.com'], true],
        [X + 760, '文件系统 · 可写', ['./', '/tmp'], false],
        [X + 760, '文件系统 · 不可读', ['~/.ssh', '~/.aws', '.env'], true],
      ];
      lists.forEach(([lx, label, items, deny], i) => {
        const ly = 708 + (i % 2) * 64;
        s += t(lx, ly, label, { s: 12, c: C.ink2 });
        let cx2 = lx;
        items.forEach((it) => {
          s += chip(cx2, ly + 10, it, { m: true, h: 22, bg: deny ? C.critSoft : C.surface3, c: deny ? C.crit : C.ink2 });
          cx2 += K.chip.w(it, { m: true }) + 6;
        });
        s += t(cx2 + 4, ly + 25, '+ 添加', { s: 12, c: C.accent });
      });
      s += toggle(X + 340, 842, false, '严格网络白名单', { s: 12.5 });
      s += t(X + 760, 852, '排除的命令', { s: 12, c: C.ink2 });
      s += chip(X + 840, 838, 'docker *', { m: true, h: 22 });

      s += mk(X - 6, 132, 1) + mk(X + 12, 210, 2) + mk(X + 12, 252, 3) + mk(X + 486, 290, 4) + mk(1032, 200, 5);
      s += mk(X + 12, 708, 6) + mk(X + 328, 704, 7) + mk(X + 748, 704, 8);
      return s;
    },
    notes: [
      ['判定顺序', '始终显示，便于理解某次调用为何执行或为何被询问：钩子、拒绝规则、询问规则、权限模式、允许规则，最后是审批卡片。', 'SDK 的权限判定顺序'],
      ['允许 · 询问 · 拒绝', '每种行为一个标签页并显示数量。询问规则即使另有规则允许该工具，也会强制询问。', '规则行为 `allow` / `ask` / `deny`'],
      ['添加规则', '输入规则（边输入边校验并用中文解释其含义），再选择保存位置：某个配置方案、项目的共享或本地设置文件、用户设置。', '`allowedTools` / `disallowedTools`；设置中的 `permissions`；`PermissionUpdate` 的保存位置'],
      ['存放位置', '每条规则保存在哪里。「允许并记住」保存的规则落在本地设置。项目拥有的文件可以锁定（🔒）防止误改。', '`PermissionUpdateDestination`；`resolveSettings()` 的来源信息'],
      ['语法帮助', '各类规则的示例和路径约定。规则本身保持英文语法。', '权限规则语法'],
      ['沙箱开关', '启用沙箱；无法启动时是否停止；沙箱内命令自动批准；允许 Claude 申请在沙箱外运行（此时走正常审批）；允许绑定本地端口。', '`sandbox.enabled`、`failIfUnavailable`、`autoAllowBashIfSandboxed`、`allowUnsandboxedCommands`、`network.allowLocalBinding`（FR-CFG-05）'],
      ['网络列表', '沙箱内命令允许和禁止访问的域名；严格模式下其他域名一律拒绝而不是询问。', '`network.allowedDomains`、`deniedDomains`、`strictAllowlist`'],
      ['文件系统列表', '沙箱内命令可写、不可读的路径，以及不进沙箱的命令。', '`filesystem.allowWrite`、`denyRead`、`denyWrite`；`excludedCommands`'],
    ],
  });

  // ------------------------------------------------------------------ P22
  window.SCREENS.push({
    id: 'P22',
    group: '设置',
    title: '设置 — 模型服务、账号与环境',
    summary: '会话如何连接模型：使用你在官方 Claude Code 中登录的 Claude 订阅，或 API Key / 云厂商。Code Agent 不提供登录、不接触订阅凭据；API Key 只保存在本机服务端。下方是按配置方案生效的环境变量和运行时选项。',
    frs: ['FR-AUTH-01..04', 'FR-CFG-04', 'FR-CFG-06', 'FR-OBS-02/03'],
    draw() {
      let s = settingsBase('模型服务与账号');
      const X = 300;
      s += t(X, 92, '模型服务与账号', { s: 20, w: 700 });
      const provs = [['user', 'Claude 订阅', '使用 Claude Code 登录', true], ['key', 'Anthropic API', 'API Key'], ['box', 'Amazon Bedrock', 'AWS 凭据'], ['globe', 'Google Cloud', 'Agent Platform'], ['layers', 'Microsoft Foundry', 'Azure 凭据'], ['link', 'LLM 网关', '自定义 Base URL']];
      provs.forEach(([icn, n, d, on], i) => {
        const x = X + i * 185;
        s += rect(x, 110, 176, 64, { r: 10, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += radio(x + 12, 122, !!on);
        s += ic(icn, x + 36, 122, 16, on ? C.accent : C.ink2);
        s += t(x + 58, 135, n, { s: 13, w: 600 });
        s += t(x + 36, 158, d, { s: 11.5, c: C.muted });
      });

      s += panel(X, 190, 600, 270, { title: 'Claude 订阅 · 使用 Claude Code 的登录' });
      s += select(X + 16, 252, 360, '%USERPROFILE%\\.claude（默认）', { label: '配置目录', mono: true, s: 12 });
      s += select(X + 388, 252, 196, '内置 2.1.302', { label: 'Claude Code 可执行文件', s: 12 });
      s += status(X + 16, 296, 'good', '已登录 · Max 订阅 · 由 Claude Code 报告');
      s += rect(X + 16, 326, 568, 66, { r: 8, fill: C.surface2, stroke: C.border });
      s += ic('lock', X + 28, 338, 16, C.ink2);
      s += t(X + 52, 350, 'Code Agent 不提供登录，也不读取、复制或保存你的登录凭据。', { s: 12.5, w: 600 });
      s += runs(X + 52, 372, [['未登录时，请在自己的终端运行 '], ['claude', C.accent, 600], [' 并输入 '], ['/login', C.accent, 600], ['。', C.ink]], { s: 12.5 });
      s += t(X + 52, 386, ' ', { s: 1 });
      s += btn(X + 16, 404, '复制登录命令', { icon: 'copy', h: 28, s: 12, w: 120 });
      s += btn(X + 144, 404, '重新检测', { icon: 'refresh', h: 28, s: 12, w: 100 });
      s += rect(X + 256, 402, 328, 46, { r: 8, fill: C.warnSoft, stroke: '#f1d38a' });
      s += ic('warning', X + 266, 410, 14, C.warnInk);
      s += t(X + 286, 421, '服务端环境中有 ANTHROPIC_API_KEY，它会覆盖', { s: 11.5, c: C.warnInk });
      s += t(X + 286, 439, '订阅登录；启动这类会话时不会传入该变量。', { s: 11.5, c: C.warnInk });

      s += panel(X + 616, 190, 494, 270, { title: '账号', sub: '由 Claude Code 报告' });
      s += kv(X + 632, 252, '认证方式', 'Claude 订阅（claude.ai 登录）', { kw: 100 });
      s += kv(X + 632, 278, '账号', 'm•••@126.com', { kw: 100 });
      s += kv(X + 632, 304, '套餐', 'Max', { kw: 100 });
      s += kv(X + 632, 330, '可用模型', 'Fable 5.1、Opus 5.5、Sonnet 5、Haiku 4.5…', { kw: 100 });
      s += kv(X + 632, 356, '速率限制', '5 小时窗口已用 84%', { kw: 100 });
      s += para(X + 632, 392, '订阅用量上限按个人日常使用设计，并与你直接使用 Claude Code 的用量共享。', 460, { s: 11.5, c: C.muted, lh: 16 });
      s += btn(X + 990, 422, '刷新', { icon: 'refresh', w: 104, h: 28, s: 12 });

      s += panel(X, 476, 720, 406, { title: '环境变量', sub: '合并到服务端环境之上' });
      s += btn(X + 584, 482, '添加变量', { icon: 'plus', w: 120, h: 28, s: 12 });
      const cols = [[16, '变量'], [300, '值'], [430, '作用范围'], [560, '作用']];
      cols.forEach(([dx, h]) => (s += t(X + dx, 538, h, { s: 11, w: 700, c: C.muted })));
      const env = [
        ['API_TIMEOUT_MS', '600000', '所有配置方案', '单次请求等待时长'],
        ['CLAUDE_CODE_MAX_RETRIES', '10', '所有配置方案', 'API 重试次数'],
        ['CLAUDE_CODE_RETRY_WATCHDOG', '1', '无人值守 CI', '服务中断时持续重试'],
        ['CLAUDE_ENABLE_STREAM_WATCHDOG', '1', '所有配置方案', '中止卡住的流'],
        ['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', '3', '默认', '子代理层数'],
        ['ENABLE_TOOL_SEARCH', 'auto:10', '评审', '延迟加载工具定义'],
        ['MCP_TIMEOUT', '30000', '所有配置方案', 'MCP 连接等待'],
        ['CLAUDE_CONFIG_DIR', '（见上方配置目录）', '所有配置方案', 'Claude Code 配置目录'],
      ];
      env.forEach(([k2, v, sc, d], i) => {
        const y = 548 + i * 40;
        s += hline(X + 1, y, 718, '#eef0f4');
        s += t(X + 16, y + 25, k2, { s: 11.5, m: true });
        s += t(X + 300, y + 25, v, { s: 12, m: !v.startsWith('（'), c: C.ink2 });
        s += t(X + 430, y + 25, sc, { s: 12, c: C.ink2 });
        s += t(X + 560, y + 25, d, { s: 12, c: C.muted });
      });

      s += panel(X + 736, 476, 374, 406, { title: '运行时与遥测' });
      s += kv(X + 752, 538, 'JS 运行时', '自动（node）', { kw: 110 });
      s += kv(X + 752, 564, '额外参数', '—', { kw: 110 });
      s += toggle(X + 752, 584, true, '调试日志', { s: 12.5 });
      s += input(X + 752, 612, 342, { h: 30, val: '~/.code-agent/logs/claude-debug.log', mono: true, s: 11.5 });
      s += t(X + 752, 662, '每个会话的 stderr 保存在「事件」面板中。', { s: 11.5, c: C.muted });
      s += hline(X + 736, 680, 374);
      s += toggle(X + 752, 696, false, '导出 OpenTelemetry', { s: 12.5 });
      s += input(X + 752, 726, 342, { h: 30, ph: 'OTLP 地址，例如 http://localhost:4318', s: 11.5 });
      s += check(X + 752, 770, false, '指标', { s: 12.5 });
      s += check(X + 830, 770, false, '日志', { s: 12.5 });
      s += check(X + 908, 770, false, '追踪（beta）', { s: 12.5 });
      s += check(X + 752, 800, false, '包含提示词原文', { s: 12.5 });
      s += check(X + 752, 828, false, '包含工具输入和输出', { s: 12.5 });
      s += t(X + 752, 866, '未开启时任何数据都不会离开本机。', { s: 11.5, c: C.muted });

      s += mk(X - 6, 114, 1) + mk(X - 6, 256, 2) + mk(X + 580, 248, 3) + mk(X - 6, 340, 4) + mk(X + 250, 406, 5);
      s += mk(X + 612, 194, 6) + mk(X - 6, 534, 7) + mk(X + 580, 484, 8) + mk(X + 730, 590, 9) + mk(X + 730, 702, 10);
      return s;
    },
    notes: [
      ['模型服务', '六种方式：Claude 订阅（使用你在官方 Claude Code 中完成的登录）、Anthropic API Key、Amazon Bedrock、Google Cloud Agent Platform、Microsoft Foundry、LLM 网关。可按配置方案选择；选中后显示该方式所需的字段。', '`CLAUDE_CONFIG_DIR`、`ANTHROPIC_API_KEY`、`CLAUDE_CODE_USE_BEDROCK`、`CLAUDE_CODE_USE_VERTEX`、`CLAUDE_CODE_USE_FOUNDRY`、`ANTHROPIC_BASE_URL`（FR-AUTH-01/04）'],
      ['配置目录', '默认 `%USERPROFILE%\\.claude`；也可跟随服务端的 `CLAUDE_CONFIG_DIR`，或指定其他目录（例如为工作和个人账号各用一个目录）。Code Agent 只把目录交给 Claude Code，从不读取其中的凭据文件。会话历史也从同一目录读取。', '`Options.env.CLAUDE_CONFIG_DIR`（FR-AUTH-04）'],
      ['Claude Code 可执行文件', '默认使用 SDK 内置、与 SDK 版本匹配的官方二进制；也可指向系统已安装的 `claude`（版本较旧时部分功能会被禁用并提示）。两种都必须是未修改的官方程序。', '`pathToClaudeCodeExecutable`（FR-CFG-06、NFR-06）'],
      ['登录说明', '不提供登录界面、不代理 OAuth、不保存令牌。未登录时引导你在自己的终端运行 `claude` 并执行 `/login`，完成后点「重新检测」。', '`accountInfo()`、`auth_status`、`authentication_failed`（FR-AUTH-04）'],
      ['凭据冲突提醒', '服务端环境里若存在 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` / `CLAUDE_CODE_OAUTH_TOKEN`，它们的优先级高于订阅登录；使用订阅方式的会话启动时会从环境中剔除这些变量，并在此提醒。', 'Claude Code 认证优先级；`Options.env`'],
      ['账号', 'Claude Code 报告的当前凭据信息（邮箱部分隐藏）、套餐、可用模型和速率限制。说明订阅额度按个人日常使用设计，并与直接使用 Claude Code 共享。', '`accountInfo()` → `AccountInfo`、init 中的 `apiKeySource`、`supportedModels()`、`rate_limit_event`（FR-AUTH-02）'],
      ['环境变量', '传给会话的变量，可作用于所有配置方案或某一个；值可以引用密钥。已知变量显示其作用。', '`Options.env`（FR-CFG-04）'],
      ['添加变量', '提供已知变量的说明和默认值（超时、重试、看门狗、子代理上限、工具搜索、MCP 超时）。', 'Claude Code 环境变量'],
      ['调试日志', '为排查问题打开 Claude Code 的调试日志并写入文件。', '`debug`、`debugFile`、`stderr`（FR-OBS-02）'],
      ['遥测', '可选的 OpenTelemetry 导出；敏感内容需逐项勾选才会包含。', '`OTEL_*`、`CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`、`OTEL_LOG_USER_PROMPTS`、`OTEL_LOG_TOOL_DETAILS`（FR-OBS-03）'],
    ],
  });

  // ------------------------------------------------------------------ P23
  window.SCREENS.push({
    id: 'P23',
    group: '运行中的会话',
    title: '事件检查器',
    summary: '停靠在对话下方的开发者面板：本会话所有原始 SDK 消息按顺序列出，可筛选、搜索、以 JSON 查看；另有 Claude Code 的 stderr 和钩子记录。消息类型和 JSON 字段保持原文。',
    frs: ['FR-OBS-01', 'FR-OBS-02', 'FR-OBS-04', 'FR-HOOK-04'],
    draw() {
      let s = K.shell({ nav: 'sessions' });
      s += K.sessionColumn({ active: 0 });
      s += rect(L.MX, 49, 1135, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'idle', cost: '$0.21', ctx: 22 });
      s += K.userMsg(L.TX, 122, L.TW, 'CI 上结账测试偶尔失败，找到原因并修复。');
      s += t(L.TX, 202, '已修复：购物车计时器改为注入，并随购物车一起释放。41 个测试连续 20 次通过。', { s: 14 });
      s += rect(L.TX, 222, L.TW, 26, { r: 6, fill: C.surface2 });
      s += t(L.TX + 12, 239, '第 1 轮 · 1分12秒 · 14 次工具调用 · $0.21 · 停止原因 end_turn', { s: 11.5, c: C.muted });

      const Y = 300;
      s += rect(L.MX, Y, 1135, 600, { fill: C.surface }) + hline(L.MX, Y, 1135, C.borderStrong);
      s += tabs(L.MX + 16, Y + 26, [['事件', 214], ['stderr', 3], ['钩子', 12]], 0, { s: 13, gap: 24 });
      s += btn(1290, Y + 8, '', { icon: 'download', w: 30, h: 28 });
      s += btn(1326, Y + 8, '', { icon: 'expand', w: 30, h: 28 });
      s += btn(1362, Y + 8, '', { icon: 'x', w: 30, h: 28 });
      s += hline(L.MX, Y + 42, 1135);
      let fx = L.MX + 16;
      [['assistant', 48, true], ['user', 31, true], ['result', 3, true], ['system', 22, true], ['tool_progress', 16, true], ['task_*', 9, true], ['hook_*', 12, true], ['stream_event', '2.4k', false]].forEach(([n, c, on]) => {
        const lbl = `${n} ${c}`;
        s += chip(fx, Y + 54, lbl, { h: 22, m: true, bg: on ? C.accentSoft : C.surface, bd: on ? undefined : C.borderStrong, c: on ? C.accent : C.muted });
        fx += K.chip.w(lbl, { m: true }) + 6;
      });
      s += input(1110, Y + 50, 200, { h: 28, icon: 'search', ph: '搜索 JSON', s: 12 });
      s += btn(1318, Y + 50, '实时', { icon: 'play', w: 74, h: 28, s: 12, v: 'soft' });

      const TW = 600;
      const cols = [[16, '序号'], [70, '时间'], [150, '类型'], [330, '摘要']];
      cols.forEach(([dx, h]) => (s += t(L.MX + dx, Y + 102, h, { s: 11, w: 700, c: C.muted })));
      const evs = [
        ['1', '14:00:01.204', 'system/init', 'opus-5-5 · 23 个工具 · 2 个 MCP · default'],
        ['2', '14:00:01.210', 'system/session_state', 'running'],
        ['3', '14:00:02.611', 'assistant', '思考（6 秒）'],
        ['4', '14:00:08.940', 'assistant', 'tool_use Read src/cart/timer.ts'],
        ['5', '14:00:09.002', 'user', 'tool_result（2.1 KB）'],
        ['…', '', '', ''],
        ['201', '14:01:09.870', 'tool_progress', 'Bash · 11.8 秒'],
        ['205', '14:01:10.554', 'system/hook_response', 'PostToolUse · 审计日志 · ok'],
        ['211', '14:01:12.003', 'assistant', '文本（412 字）'],
        ['213', '14:01:13.416', 'result/success', '1分12秒 · 14 轮 · $0.2131', true],
        ['214', '14:01:13.420', 'system/session_state', 'idle'],
      ];
      evs.forEach(([seq, tm, ty, sum, on], i) => {
        const y = Y + 110 + i * 32;
        if (on) s += rect(L.MX + 1, y, TW - 1, 32, { fill: C.accentSoft });
        s += hline(L.MX + 1, y, TW - 1, '#eef0f4');
        s += t(L.MX + 16, y + 21, seq, { s: 11.5, m: true, c: C.muted });
        s += t(L.MX + 70, y + 21, tm.slice(3), { s: 11.5, m: true, c: C.ink2 });
        s += t(L.MX + 150, y + 21, ty, { s: 11.5, m: true, c: ty.startsWith('result') ? C.goodInk : ty.startsWith('system') ? C.ink2 : C.ink, w: on ? 700 : 400 });
        s += t(L.MX + 330, y + 21, sum, { s: 12, c: C.ink2 });
      });
      s += vline(L.MX + TW, Y + 86, 514);
      const J = L.MX + TW + 16;
      s += t(J, Y + 104, 'result/success · 序号 213', { s: 13, w: 700 });
      s += btn(J + 330, Y + 86, '复制', { icon: 'copy', w: 72, h: 26, s: 12 });
      s += t(J + 412, Y + 103, '在对话中定位', { s: 12, c: C.accent });
      s += code(J, Y + 118, 504, [
        '{',
        [['  "type"', C.accent], [': '], ['"result"', C.goodInk], [',']],
        [['  "subtype"', C.accent], [': '], ['"success"', C.goodInk], [',']],
        [['  "session_id"', C.accent], [': '], ['"5b3f2c1a-8d4e-4f6b-9a7c-2e1d0f9b8a6c"', C.goodInk], [',']],
        [['  "duration_ms"', C.accent], [': 72140,']],
        [['  "duration_api_ms"', C.accent], [': 61802,']],
        [['  "num_turns"', C.accent], [': 14,']],
        [['  "total_cost_usd"', C.accent], [': 0.2131,']],
        [['  "stop_reason"', C.accent], [': '], ['"end_turn"', C.goodInk], [',']],
        [['  "ttft_ms"', C.accent], [': 1420,']],
        [['▸ "usage"', C.accent], [': { 5 keys }']],
        [['▸ "modelUsage"', C.accent], [': { "claude-opus-5-5": {…}, "claude-haiku-4-5": {…} }']],
        [['  "permission_denials"', C.accent], [': [],']],
        [['  "result"', C.accent], [': '], ['"已修复：购物车计时器改为注入…"', C.goodInk]],
        '}',
      ], { s: 12, lh: 19, h: 300 });
      s += t(J, Y + 446, '原始消息在会话期间保留（环形缓冲：最近 5000 条）。', { s: 11.5, c: C.muted });

      s += mk(L.MX + 12, Y + 66, 1) + mk(fx - 10, Y + 52, 2) + mk(1106, Y + 54, 3) + mk(1390, Y + 54, 4) + mk(L.MX + 590, Y + 126, 5);
      s += mk(J - 6, Y + 124, 6) + mk(L.MX + 100, Y + 12, 7) + mk(1288, Y + 12, 8);
      return s;
    },
    notes: [
      ['类型筛选', '按消息类型开关显示，数量实时更新。子类型（如 `system/task_progress`）归在所属类型下，可展开。', '全部 `SDKMessage` 变体'],
      ['流事件', 'token 级的流事件默认隐藏（数量成千上万）；排查流式问题时再打开。', '`stream_event`（`SDKPartialAssistantMessage`）'],
      ['搜索', '在保留的所有事件 JSON 中全文搜索，支持中文。', '—（FR-I18N-08）'],
      ['实时 / 暂停', '「实时」跟随新事件；暂停后列表冻结，事件仍在后台接收。', '—'],
      ['事件列表', '序号（与断线重放使用的序号相同）、时间、类型/子类型和可读摘要（摘要本地化，类型名保持原文）。', '服务端事件 `seq`'],
      ['JSON 视图', '所选消息以可折叠 JSON 显示，可复制，并可定位到对话中的对应位置。', '—'],
      ['stderr 与钩子', 'stderr 显示本会话 Claude Code 的错误输出（开启调试时含调试输出）；「钩子」列出钩子的开始、进度和返回事件。', '`stderr` 回调；`hook_*` 消息（FR-OBS-02、FR-HOOK-04）'],
      ['导出', '把保留的事件导出为 JSON Lines，便于提交问题报告。', '—'],
    ],
  });

  // ------------------------------------------------------------------ P24
  window.SCREENS.push({
    id: 'P24',
    group: '运行中的会话',
    title: '会话状态与提示',
    summary: '会话界面如何报告上限、错误、重试和其他系统事件。每种状态都用平实的语言说明发生了什么，并给出下一步操作；SDK 的错误代码保留在括号或详情中。',
    frs: ['FR-OUT-07..09', 'FR-SES-14', 'FR-MISC-04', 'FR-PERM-09', 'FR-CTX-03', 'FR-COST-04', 'FR-AUTH-04', 'FR-I18N-06'],
    draw() {
      let s = rect(0, 0, 1440, 900, { fill: C.page });
      const cards = [
        ['达到最大轮数', 'warn', '已执行 50 轮后停止', '任务尚未完成（error_max_turns）。', ['再继续 50 轮', '修改限制…']],
        ['达到预算上限', 'warn', '已达到 $5.00 的预算上限', '已花费 $5.07（error_max_budget_usd）。', ['上限提到 $10 继续', '查看用量']],
        ['会话崩溃', 'crit', '会话意外结束', 'Claude Code 以退出码 1 结束（error_during_execution）。', ['恢复会话', '查看 stderr']],
        ['API 重试', 'info', 'Anthropic API 过载（529）', '8 秒后进行第 2/10 次重试…', ['中断']],
        ['速率限制', 'warn', '5 小时限额已用 90%', '21:30 重置。新的请求可能被拒绝。', ['查看用量']],
        ['模型回退', 'info', 'Opus 5.5 拒绝了请求，已改用 Sonnet 5 重试', '下面的回复来自回退模型。', ['为什么？']],
        ['压缩', 'info', '正在压缩对话…', '182k tokens → 约 40k。较早的消息会变成摘要。', []],
        ['连接', 'idle', '连接已断开 —— 正在重连（第 3 次）…', '会话仍在服务端运行。', []],
        ['启动失败', 'crit', '会话无法启动', '工作目录 D:\\old\\shop-api 已不存在（cwd_unavailable）。', ['选择其他文件夹', '详情']],
        ['进程退出', 'warn', 'Claude Code 正在退出', '原因：已安装更新。对话记录已保存。', ['恢复会话']],
        ['被拒绝的工具调用', 'warn', '本轮有 2 次工具调用被拒绝', 'Bash rm -rf dist · WebFetch pastebin.com', ['查看…']],
        ['未登录 Claude', 'crit', 'Claude Code 尚未登录', '请在终端运行 claude 并输入 /login，完成后重新检测（authentication_failed）。', ['复制登录命令', '重新检测']],
      ];
      cards.forEach(([cap, kind, title, body, actions], i) => {
        const x = 30 + (i % 3) * 467;
        const y = 34 + Math.floor(i / 3) * 214;
        s += t(x, y + 12, cap, { s: 12, w: 700, c: C.muted });
        s += rect(x, y + 22, 446, 176, { r: 10, fill: C.surface, stroke: C.border });
        const tone = { warn: [C.warnSoft, C.warnInk, 'warning', '#f1d38a'], crit: [C.critSoft, C.crit, 'x', '#efb4b4'], info: [C.accentSoft, C.accent, 'info', C.accentLine], idle: [C.surface2, C.ink2, 'clock', C.border] }[kind];
        const bx = x + 16;
        const by = y + 40;
        if (cap === '压缩') {
          s += rect(bx, by, 414, 56, { r: 8, fill: tone[0], stroke: tone[3] });
          s += circle(bx + 20, by + 20, 7, { stroke: C.accent, sw: 2.5 });
          s += t(bx + 38, by + 24, title, { s: 13, w: 700, c: tone[1] });
          s += progress(bx + 38, by + 36, 360, 60, C.accent, 5);
          s += line(bx, by + 98, bx + 414, by + 98, { c: C.borderStrong, dash: '4 4' });
          s += rect(bx + 82, by + 88, 250, 20, { r: 10, fill: C.surface, stroke: C.border });
          s += t(bx + 207, by + 102, '对话已自动压缩 · 压缩前 182k', { s: 11, c: C.ink2, a: 'middle' });
          s += t(bx, by + 136, body, { s: 12, c: C.muted });
        } else if (cap === '连接') {
          s += rect(bx, by, 414, 48, { r: 8, fill: tone[0], stroke: tone[3] });
          s += ic('refresh', bx + 12, by + 16, 16, C.ink2);
          s += t(bx + 38, by + 21, title, { s: 13, w: 700, c: C.ink });
          s += t(bx + 38, by + 38, body, { s: 12, c: C.ink2 });
          s += rect(bx, by + 60, 414, 34, { r: 8, fill: C.goodSoft, stroke: '#b7e3b7' });
          s += ic('check', bx + 12, by + 69, 16, C.goodInk, 2.2);
          s += t(bx + 38, by + 82, '已重连 · 重放了 214 条事件', { s: 12.5, w: 600, c: C.goodInk });
          s += t(bx, by + 126, '重连后，待处理的审批会重新出现。', { s: 12, c: C.muted });
        } else {
          s += rect(bx, by, 414, 92, { r: 8, fill: tone[0], stroke: tone[3] });
          s += ic(tone[2], bx + 12, by + 14, 18, tone[1], 2);
          s += t(bx + 40, by + 28, title, { s: 13.5, w: 700, c: kind === 'idle' ? C.ink : tone[1] });
          s += para(bx + 40, by + 49, body, 362, { s: 12, c: C.ink2, lh: 17, m: cap === '被拒绝的工具调用' });
          let ax = bx + 40;
          actions.forEach((a, j) => {
            const w = K.btnW(a, { s: 12 });
            s += btn(ax, by + 100, a, { h: 28, s: 12, v: j === 0 && kind !== 'info' ? 'primary' : 'secondary' });
            ax += w + 8;
          });
          if (kind === 'info' && cap === 'API 重试') s += circle(bx + 396, by + 22, 7, { stroke: C.accent, sw: 2.5 });
        }
        s += mk(x + 438, y + 26, i + 1);
      });
      return s;
    },
    notes: [
      ['最大轮数', '显示在对话末尾。「再继续」在同一会话中以更高上限恢复。', '`error_max_turns` → `resume` + `maxTurns`（FR-OUT-07）'],
      ['预算上限', '与最大轮数同样的处理，并显示已花费金额。', '`error_max_budget_usd` → `resume` + `maxBudgetUsd`'],
      ['崩溃', '进程已结束；对话记录已保存，可以恢复。一键查看 stderr。', '`error_during_execution`、`stderr`'],
      ['API 重试', '临时提示，重试成功后被回复替换。「中断」停止等待。', '`api_retry` 消息；`interrupt()`（FR-OUT-08）'],
      ['速率限制', '接近上限时提醒；请求被拒时变红，并显示重置时间。', '`rate_limit_event`（FR-COST-04）'],
      ['模型回退', '标记那些在拒绝后由回退模型给出的回复。', '`model_refusal_fallback` / `model_refusal_no_fallback`'],
      ['压缩', '压缩时显示进度，完成后在对话中插入分隔线，注明触发方式和压缩前大小。', '`status: "compacting"`、`compact_boundary`（FR-CTX-03）'],
      ['连接', '浏览器与服务端的连接断开；会话仍在运行。重连后重放错过的事件，待处理请求重新出现。', '事件 `seq` 重放；`reinitialize()`（FR-SES-14）'],
      ['启动失败', '把 SDK 的原因代码翻译成本地化说明并给出解决办法（换文件夹、登录、更新 Claude Code…），原始代码保留在括号或详情中。', '`startup_failure_reason`（FR-OUT-07、FR-I18N-06）'],
      ['进程退出', 'Claude Code 宣布即将退出；提供恢复入口。', '`worker_shutting_down`（FR-MISC-04）'],
      ['被拒绝的工具调用', '本轮结束后列出被拒绝的调用（规则、模式、沙箱或用户拒绝），并可设置下次允许。', '`permission_denials`、`permission_denied`（FR-PERM-09）'],
      ['未登录 Claude', '选择 Claude 订阅方式但 Claude Code 尚未登录时：不提供登录界面，只给出在终端执行 `claude` → `/login` 的指引和「重新检测」。', '`authentication_failed`、`auth_status`（FR-AUTH-04）'],
    ],
  });

  // ------------------------------------------------------------------ P25
  window.SCREENS.push({
    id: 'P25',
    group: '设置',
    title: '设置 — 语言与地区',
    summary: '界面语言、Claude 的回复语言、日期与数字格式，以及对 SDK 和外部内容的处理规则。界面语言即时切换、无需刷新；顶栏的地球图标可快速切换。',
    frs: ['FR-I18N-01..10'],
    draw() {
      let s = settingsBase('语言与地区');
      const X = 300;
      s += t(X, 92, '语言与地区', { s: 20, w: 700 });
      s += t(X + 120, 92, '修改立即生效，偏好保存在本机服务端。', { s: 12.5, c: C.muted });

      s += panel(X, 120, 540, 236, { title: '界面语言' });
      const langs = [['跟随浏览器', '当前识别为：简体中文（zh-CN）', true], ['简体中文', 'zh-CN'], ['English', 'en']];
      langs.forEach(([l, d, on], i) => {
        const y = 172 + i * 52;
        s += rect(X + 16, y, 508, 44, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += radio(X + 28, y + 14, !!on);
        s += t(X + 54, y + 27, l, { s: 13.5, w: 600 });
        s += t(X + 54 + tw(l, 13.5, false, true) + 12, y + 27, d, { s: 12, c: C.muted });
      });
      s += t(X + 16, 346, '缺失的译文回退到英文 · 翻译覆盖率：zh-CN 100%、en 100%', { s: 11.5, c: C.muted });

      s += panel(X + 556, 120, 554, 236, { title: 'Claude 的回复语言' });
      const resp = [['跟随界面语言', '现在是简体中文', true], ['与我的提问一致', '不指定，由对话决定'], ['指定语言', '']];
      resp.forEach(([l, d, on], i) => {
        const y = 172 + i * 44;
        s += radio(X + 572, y, !!on, l, { w: on ? 600 : 400 });
        if (d) s += t(X + 596 + tw(l, 13, false, true) + 12, y + 12.5, d, { s: 12, c: C.muted });
      });
      s += input(X + 680, 254, 160, { h: 28, ph: '例如 日本語', s: 12, disabled: true });
      s += para(X + 572, 310, '写入会话设置的 language 字段，同时决定自动生成的会话标题语言。在会话启动时生效，可在配置方案或新建会话中覆盖。', 520, { s: 11.5, c: C.muted, lh: 16 });

      s += panel(X, 372, 540, 250, { title: '格式' });
      const fmts = [
        ['日期与时间', '跟随语言', '2026年10月28日 14:05'],
        ['相对时间', '跟随语言', '2 分钟前 · 昨天 · 周一'],
        ['数字', '国际简写', '18.4M tokens · 1,234,567'],
        ['金额', '美元', 'US$57.13（按美元计费，不做汇率换算）'],
        ['时区', '跟随系统', 'Asia/Shanghai（UTC+8）'],
      ];
      fmts.forEach(([k2, v, ex], i) => {
        const y = 424 + i * 38;
        s += t(X + 16, y + 6, k2, { s: 12.5, c: C.ink2 });
        s += select(X + 100, y - 14, 120, v, { h: 28, s: 12 });
        s += t(X + 236, y + 6, ex, { s: 12.5 });
      });

      s += panel(X + 556, 372, 554, 250, { title: '输入与文字' });
      s += toggle(X + 572, 422, true, '输入法组字时按回车不发送', { s: 13 });
      s += chip(X + 572 + 42 + tw('输入法组字时按回车不发送', 13) + 10, 421, '始终开启', { h: 20, icon: 'lock' });
      s += t(X + 614, 458, '适用于输入框、审批说明、提问的「其他」、搜索框等所有回车提交的地方。', { s: 11.5, c: C.muted });
      s += kv(X + 572, 494, '界面字体', 'system-ui，中文回退 微软雅黑 / 苹方 / Noto Sans SC', { kw: 80 });
      s += kv(X + 572, 520, '等宽字体', 'Cascadia Code，中文回退同上', { kw: 80 });
      s += kv(X + 572, 546, '搜索', '中文按字匹配，不依赖空格分词', { kw: 80 });
      s += kv(X + 572, 572, '路径', '支持中文和其他非 ASCII 路径（全程 UTF-8）', { kw: 80 });
      s += kv(X + 572, 598, '快捷键', '避开常见输入法切换键（Ctrl/Shift + 空格）', { kw: 80 });

      s += panel(X, 638, 1110, 244, { title: 'SDK 与外部内容' });
      const rows = [
        ['Code Agent 自己的界面文字', '按界面语言显示'],
        ['SDK 返回的代码：错误类型、结果状态、启动失败原因、权限模式、MCP 状态等', '映射为本地化文案，原始代码可在详情中查看'],
        ['技能 / 插件 / MCP 的描述、工具名、命令输出、文件内容', '按原文显示，不做机器翻译'],
        ['Claude 生成的内容：回复、计划、提问、会话标题、提示建议', '由「回复语言」决定'],
      ];
      rows.forEach(([a, b], i) => {
        const y = 690 + i * 36;
        s += hline(X + 1, y - 10, 1108, '#eef0f4');
        s += t(X + 16, y + 10, a, { s: 12.5 });
        s += t(X + 640, y + 10, b, { s: 12.5, c: C.ink2 });
      });
      s += toggle(X + 16, 838, false, '本地化提示下方默认展开 SDK 原文', { s: 12.5 });
      s += rect(X + 640, 830, 454, 40, { r: 8, fill: C.critSoft, stroke: '#efb4b4' });
      s += ic('x', X + 652, 842, 16, C.crit, 2);
      s += t(X + 676, 855, '会话无法启动：工作目录不存在', { s: 12.5, w: 600, c: C.crit });
      s += t(X + 1082, 855, '原文 cwd_unavailable ▾', { s: 11.5, c: C.ink2, a: 'end' });

      // quick switch popover from the top bar
      s += rect(1150, 50, 160, 118, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      [['跟随浏览器', true], ['简体中文', false], ['English', false]].forEach(([l, on], i) => {
        const y = 60 + i * 34;
        if (i === 0) s += rect(1156, y - 4, 148, 30, { r: 6, fill: C.accentSoft });
        s += t(1170, y + 16, l, { s: 13, w: i === 0 ? 600 : 400, c: i === 0 ? C.accent : C.ink });
        if (on) s += ic('check', 1280, y + 3, 14, C.accent);
      });

      s += mk(1234, 30, 1) + mk(X - 6, 124, 2) + mk(X + 4, 342, 3) + mk(X + 550, 124, 4) + mk(X - 6, 376, 5);
      s += mk(X + 550, 418, 6) + mk(X + 550, 490, 7) + mk(X - 6, 642, 8) + mk(X + 4, 834, 9);
      return s;
    },
    notes: [
      ['顶栏快速切换', '顶栏地球图标显示当前语言（中 / EN），点开即可切换，与本页设置同步。', '应用 `UiPrefs.language`（FR-I18N-02）'],
      ['界面语言', '首发支持简体中文和英文。默认跟随浏览器语言（navigator.languages），无法匹配时用英文。切换后立即生效，无需刷新，并保存在本机服务端。', 'FR-I18N-01/02'],
      ['回退与覆盖率', '所有界面文字都以键值形式外置（ICU 消息格式，支持复数和变量）；缺失的译文回退到英文。新增语言只需添加翻译文件。CI 检查缺失和未使用的键。', 'FR-I18N-03'],
      ['Claude 的回复语言', '跟随界面语言、由对话决定，或指定任意语言。实现方式是在会话设置中写入 language 字段，同时影响自动生成的会话标题；会话启动时确定，可在配置方案或新建会话中覆盖。', '`settings.language`（FR-I18N-05）'],
      ['格式', '日期时间、相对时间、数字、金额和时区都用 Intl API 按语言格式化。金额始终以美元显示（SDK 按美元估算），不做汇率换算。', 'FR-I18N-04'],
      ['输入法', '输入法组字（isComposing / keyCode 229）期间按回车只确认候选词，绝不发送或提交；此规则覆盖所有「回车提交」的输入框，不可关闭。', 'FR-I18N-07'],
      ['文字与路径', '中文字体回退、按实际宽度截断、中文搜索不依赖空格分词、非 ASCII 路径全程 UTF-8；快捷键避开常见输入法切换组合。', 'FR-I18N-08/09'],
      ['SDK 与外部内容', '明确哪些内容会被本地化、哪些保持原文：Code Agent 自身文字按界面语言；SDK 返回的代码映射为本地化文案；第三方作者写的描述和工具输出保持原文；Claude 生成的内容由回复语言决定。', 'FR-I18N-06'],
      ['显示 SDK 原文', '本地化提示下方可展开查看 SDK 原始代码或错误文本，便于搜索和报告问题；可设为默认展开。', 'FR-I18N-06'],
    ],
  });
})();
