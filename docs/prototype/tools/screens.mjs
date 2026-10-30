// The prototype's screens: how to bring the demo app into each one, its numbered marks and notes.
// status: 'done' = built as shown; 'new' = a proposed screen; 'changed' = built, with proposed parts.
// Proposed parts are injected with the app's own classes and outlined (.proto-new); their marks
// have isNew and their snippet is shown under the screen for whoever implements it.

/** Open an inspector tab (click its rail button unless it is open already). */
const inspector = async ({ eval: ev, sleep }, label) => {
  await ev(`(() => { const b = [...document.querySelectorAll('.ins-rail-btn')].find((x) => x.querySelector('span')?.textContent === ${JSON.stringify(label)}); if (b && !b.classList.contains('on')) b.click(); })()`);
  await sleep(500);
};
const closeInspector = async ({ eval: ev, sleep }) => {
  await ev(`(() => { const b = document.querySelector('.ins-rail-btn.on'); if (b) b.click(); })()`);
  await sleep(300);
};
/** Scroll the transcript so the item containing `text` is near the top (or to the very top / end). */
const scrollTo = async ({ eval: ev, sleep }, text, offset = 70) => {
  await ev(`(() => {
    const box = document.querySelector('.transcript');
    if (!box) return;
    if (${JSON.stringify(text)} === 'top') { box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); return; }
    if (${JSON.stringify(text)} === 'end') { box.scrollTop = box.scrollHeight; return; }
    const el = __find('.transcript *', ${JSON.stringify(text)});
    if (el) { box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - ${offset}; box.dispatchEvent(new Event('scroll')); }
  })()`);
  await sleep(400);
};
const openSession = async (ctx, id) => { await ctx.go(`/s/${id}`); await ctx.sleep(900); };
/** Open the collapsed thinking-and-tool-call lines of the transcript (all of them). */
const openSteps = async ({ eval: ev, sleep }) => {
  await ev(`document.querySelectorAll('.steps:not(.open) > .steps-head').forEach((h) => h.click())`);
  await sleep(400);
};

export const SCREENS = [
  // ================================================================ overview
  {
    id: 'P01', group: '总览', title: '整体布局与导航', status: 'done',
    summary: '顶栏、左侧导航、会话列表、对话区和右侧检查器。所有页面共用顶栏和左侧导航。',
    frs: ['§7 信息架构', 'FR-NTF-01'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await closeInspector(c); await c.sleep(200); await inspector(c, '任务'); },
    marks: [
      { sel: '.ws-switch', note: ['工作区切换', '下拉选择', '切到某个工作区（进入它最近的会话），或「所有工作区」回到总览；最下面「打开文件夹…」添加工作区。'] },
      { sel: '.topbar input', note: ['搜索', '输入', '搜索会话标题、对话内容和设置项，结果在下拉里，回车打开第一个。'] },
      { sel: '.lang-btn', note: ['界面语言', '点击', '切换界面语言（英文在交互定稿后开放）。'] },
      { sel: '.top-icon', note: ['等你处理', '点击', '所有工作区里等你处理的审批、提问、计划、征询、待放行的会话消息和要你决定的审核，数字是条数（见 P30）。'] },
      { sel: '.account', note: ['模型服务与账号', '点击', '显示 Claude 订阅是否登录、配了几个兼容端点；点开进入 P22。'] },
      { sel: 'nav button, nav a', text: '会话', note: ['左侧导航', '点击', '会话 / 看板 / MCP / 技能 / 钩子 / 作业 / 用量 / 设置。「会话」进入当前工作区最近的会话；看板上的数字是待确认的自动记录。'] },
      { sel: '.btn', text: '新建会话', note: ['新建会话', '点击', '在当前工作区开一个新会话，直接进入输入（P03）。'] },
      { sel: 'h5', text: '运行中', note: ['会话列表', '点击 / 悬停', '当前工作区的会话：运行中在上，状态用颜色和文字标出；悬停出现保存、删除；「全部会话」进 P12。'] },
      { sel: '.ins-rail', note: ['检查器', '点击图标', '任务 / 后台 / 变更 / 检查点 / 上下文 / 事件，点一次打开、再点收起，左边缘拖动调宽度。'] },
    ],
  },
  // ================================================================ sessions
  {
    id: 'P02', group: '会话', title: '总览 — 所有工作区', status: 'done',
    summary: '顶栏选「所有工作区」时的首页：工作区卡片和所有工作区的最近会话。',
    frs: ['FR-WS-01', 'FR-WS-05', 'FR-SES-05'],
    prepare: async (c) => {
      await c.go('/');
      await c.eval(`(() => { const s = document.createElement('style'); s.textContent = '.ws-card:first-child .ws-remove { opacity: 1 !important; }'; document.head.appendChild(s); })()`);
    },
    marks: [
      { sel: '.ws-card', note: ['工作区卡片', '点击', '进入这个工作区最近的会话（运行中的优先，其次未发送的草稿、最近保存的，都没有就新建）。'] },
      { sel: '.ws-card .chip.warn', note: ['运行状态', '—', '会话数、运行中和等你处理的数量。'] },
      { sel: '.ws-remove', note: ['移除工作区', '悬停卡片后点击', '先确认，列出会被停止的会话和会删除的看板条目、作业、审核记录；不动文件夹和 Claude Code 自己的会话记录。'] },
      { sel: '.btn', text: '打开文件夹…', note: ['打开文件夹', '点击', '选择或粘贴文件夹路径添加工作区（P31）；同一目录下 Claude Code 自己的会话会自动列进来。'] },
      { sel: '.srow', note: ['最近会话', '点击 / 悬停', '所有工作区的最近会话，悬停出现保存、删除等操作。'] },
      { sel: 'a', text: '查看全部 →', note: ['查看全部', '点击', '进入全部会话（P12）。'] },
    ],
  },
  {
    id: 'P03', group: '会话', title: '新会话', status: 'done',
    summary: '新建会话不弹对话框，直接进入输入。第一条消息发出后才启动 Claude Code。',
    frs: ['FR-SES-01', 'FR-SES-03', 'FR-IN-01'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.click('.btn', '新建会话'); await c.sleep(900); },
    marks: [
      { sel: '.draft-empty', note: ['空白会话', '—', '说明这个会话会在哪个工作区、用哪个配置方案；草稿不保存，离开后从列表消失。'] },
      { sel: '.c-input', note: ['输入框', '输入', 'Enter 发送，Shift+Enter 换行；输入 `/` 列出命令和技能，`@` 列出文件和本工作区的会话（P05）。'] },
      { sel: '.c-row2 .select-btn', note: ['模型 / 思考强度 / 权限模式', '下拉', '默认取自「默认」配置方案，只影响这个会话；模型列表里有 Claude 订阅和各兼容端点的模型。'] },
      { sel: '.btn.ghost[title="添加附件"]', note: ['附件', '点击', '图片、文件或文件夹，作为这条消息的附件。'] },
    ],
  },
  {
    id: 'P12', group: '会话', title: '全部会话 — 搜索与管理', status: 'done',
    summary: '所有工作区的会话，按标题和对话内容搜索；悬停一行出现全部操作。',
    frs: ['FR-SES-05', 'FR-SES-06', 'FR-SES-07', 'FR-SES-08', 'FR-SES-15'],
    prepare: async (c) => { await c.go('/sessions'); await c.type('input[placeholder="搜索标题和对话内容"]', '校验'); await c.sleep(1500); await c.eval(`(() => { const r = document.querySelector('.srow'); r && r.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); r && r.classList.add('hover'); })()`); },
    marks: [
      { sel: 'input[placeholder="搜索标题和对话内容"]', note: ['搜索', '输入', '同时搜标题和对话全文（全文索引），结果里加粗显示命中的片段。'] },
      { sel: '.select-btn.w-180', note: ['筛选', '下拉 / 点击', '按工作区、标签、状态（全部 / 运行中 / 已保存）筛选。'] },
      { sel: '.srow', note: ['会话行', '点击 / 悬停', '点击打开；悬停出现恢复、重命名、打标签、分叉、导出 Markdown、保存、删除。由其他会话创建的会写明来源，作业运行的带「作业」标签。'] },
    ],
  },
  {
    id: 'P31', group: '会话', title: '打开文件夹', status: 'done',
    summary: '添加工作区：逐级浏览文件夹，或直接粘贴路径。',
    frs: ['FR-WS-01', 'FR-WS-02'],
    prepare: async (c) => { await c.go('/'); await c.click('.btn', '打开文件夹…'); await c.sleep(800); },
    marks: [
      { sel: '.modal input', note: ['路径', '输入 / 粘贴', '直接填文件夹路径，回车打开。'] },
      { sel: '.modal', note: ['文件夹列表', '点击进入 / 双击打开', '从盘符开始逐级浏览；不存在或无法访问的路径会提示。'] },
    ],
  },
  {
    id: 'P30', group: '会话', title: '等你处理', status: 'done',
    summary: '顶栏铃铛：所有工作区里等你处理的请求，不管那个会话在这个页面里打开过没有；点一条直接跳到那个会话处理。',
    frs: ['FR-NTF-01', 'FR-PERM-06'],
    prepare: async (c) => { await c.go('/'); await c.click('.top-icon'); await c.sleep(600); },
    marks: [
      { sel: '.inbox', note: ['请求列表', '点击一条', '审批、提问、计划、征询、待放行的会话消息、要你决定的代码审核；每条写明会话、请求内容和等了多久，同一个会话有几个请求时注明还有几个。点击跳过去处理，处理后各处同步消失。'] },
      { sel: '.inbox .foot .toggle', note: ['系统通知', '开关', '标签页不在前台时同时发系统通知；「提醒设置」进入设置 → 常规（P29）。'] },
    ],
  },
  // ================================================================ a session
  {
    id: 'P04', group: '会话页', title: '会话 — 对话', status: 'done',
    summary: '一轮完成的工作：Claude 的回答之间，思考和工具调用各收成一行；最后是本轮统计。右侧检查器进入会话时是收起的，这里点开了「任务」。',
    frs: ['FR-OUT-01', 'FR-OUT-02', 'FR-OUT-03', 'FR-OUT-04', 'FR-OUT-05', 'FR-TOOL-01', 'FR-TOOL-02', 'FR-TOOL-03', 'FR-TODO-01'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await inspector(c, '任务'); await scrollTo(c, 'top'); },
    marks: [
      { sel: '.umsg', note: ['你的消息', '悬停', '靠右显示；悬停出现「从这里回退」「从这里分叉」（P10）。'] },
      { sel: '.steps-head', nth: 0, note: ['思考与工具调用', '点击展开', '两次回答之间的思考和工具调用合成一行，默认收起：显示思考和调用的次数、用到的工具；有没成功的调用或等待审批时标出来，正在进行时显示 Claude 在做什么。展开见 P04b。'] },
      { sel: '.footer-line', note: ['本轮统计', '—', '第几轮、用时、工具调用次数、token；没有调用 API 的轮次不显示。'] },
      { sel: '.task', note: ['任务清单', '—', 'Claude 用任务工具拆分工作时，检查器「任务」页实时显示进度。'] },
      { sel: '.btn', text: '提交审核', note: ['提交审核', '点击', '把这个会话还没审核过的改动交给独立的审核者（P27）。'] },
      { sel: '.edit[title="重命名"]', note: ['标题', '点击铅笔', '重命名；下方显示工作区、分支和已用 token。'] },
    ],
  },
  {
    id: 'P04b', group: '会话页', title: '会话 — 展开思考与工具调用', status: 'done',
    summary: '点开收起的那一行：按顺序显示思考和每次工具调用，和以前一样。',
    frs: ['FR-OUT-02', 'FR-OUT-03', 'FR-TOOL-01', 'FR-TOOL-02', 'FR-TOOL-03'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await scrollTo(c, 'top'); await openSteps(c); },
    marks: [
      { sel: '.steps-body', nth: 0, note: ['展开后', '再点一次收起', '左侧一条竖线标出这一行包含的内容。'] },
      { sel: '.thinking', note: ['思考', '点击展开', '折叠时一行摘要和用时，展开看全文。'] },
      { sel: '.tgroup', note: ['连续的读取', '点击展开', '连续的只读调用（读文件、搜索）合成一组。'] },
      { sel: '.tcard', text: 'src/orders.js', nth: 0, note: ['工具卡片', '点击展开', '工具名、参数摘要、用时、审批来源（规则 / 你批准 / 无需审批）；展开看输出。改文件的卡片直接显示差异。'] },
    ],
  },
  {
    id: 'P05', group: '会话页', title: '输入框 — 引用文件和会话', status: 'done',
    summary: '输入 `@` 列出工作区里的文件和本工作区的其他会话；`/` 列出命令和技能。',
    frs: ['FR-IN-01', 'FR-IN-02', 'FR-IN-03', 'FR-IN-04', 'FR-SKILL-04'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.type('.c-input', ''); await c.sleep(200); await c.type('.c-input', '对照 @'); await c.sleep(900); },
    // Unsent text is kept per session; leave none behind for the screens after this one.
    after: async (c) => { await c.type('.c-input', ''); await c.sleep(300); },
    marks: [
      { sel: '.palette', note: ['候选列表', '↑↓ 选择，回车 / 点击插入', '文件按路径匹配；会话显示状态和摘要，插入后 Claude 能读到它的标题、状态和最近的回复。'] },
      { sel: '.c-input', note: ['输入框', '输入', '`@` 引用文件 / 会话，`/` 命令；输入法组字时回车只确认候选词。'] },
    ],
  },
  {
    id: 'P05b', group: '会话页', title: '输入框 — 排队的消息', status: 'done',
    summary: 'Claude 正在工作时发的消息先排队，这一轮结束后按顺序发出；可以改、删，或「立即插入」。',
    frs: ['FR-IN-08', 'FR-IN-09', 'FR-IN-10'],
    prepare: async (c) => {
      await openSession(c, c.ids.running);
      const rt = await c.call('openSession', c.ids.running);
      if (!rt.queue?.length) {
        await c.call('send', c.ids.running, '跑完以后把失败的用例整理成一张表', { priority: 'later' });
        await c.call('send', c.ids.running, '另外看一下 bench 的内存占用', { priority: 'later' });
      }
      await c.sleep(800);
    },
    marks: [
      { sel: '.queue', note: ['排队的消息', '点击编辑 / 删除', '按顺序发出；可以改内容、删除，或改成「立即插入」让 Claude 马上读到。'] },
      { sel: '.btn', text: '中断', note: ['中断', '点击', '停在当前位置，排队的消息保留，可以选择接着发还是清掉。'] },
      { sel: '.btn.primary', text: '排队', note: ['发送方式', '点击 / 下拉', '运行中默认排队；也可以选「立即插入」。'] },
    ],
  },
  {
    id: 'P06', group: '会话页', title: '工具审批', status: 'done',
    summary: '没有规则放行的操作停下来等你批准；请求停靠在输入框上方。要不要问、建议怎样记住，都由 Claude Code 决定，这里原样呈现。同时有几个请求时排队，一个处理完显示下一个。',
    frs: ['FR-PERM-03', 'FR-PERM-04', 'FR-PERM-05', 'FR-PERM-06', 'FR-PERM-07'],
    prepare: async (c) => { await openSession(c, c.ids.approval); },
    marks: [
      { sel: '.steps-head .chip', text: '等待审批', note: ['等待中的调用', '—', '对话里这一轮的思考与工具调用那一行标出「等待审批」，展开能看到对应的卡片。'] },
      { sel: '.dpanel-head', note: ['审批面板', '—', '要做什么、Claude Code 为什么要问（它给的理由、越出工作区的路径）；「SDK 原文」展开 Claude Code 给的原始内容。'] },
      { sel: '.dpanel *', text: '仅允许这一次', note: ['怎么处理', '选择', '仅允许这一次 / 允许，且以后不再询问（Claude Code 有建议时才有，见 P06b）/ 拒绝并告诉 Claude 该怎么做。'] },
      { sel: '.btn.danger-outline', text: '拒绝并停止本轮', note: ['拒绝', '点击', '可以附一句原因告诉 Claude；「拒绝并停止本轮」同时中断这一轮。'] },
      { sel: '.btn.primary', text: '允许', note: ['允许', '点击', '按选中的方式回答 Claude Code。'] },
      { sel: '.c-input', note: ['输入框', '输入', '等待期间发的消息排队。'] },
    ],
  },
  {
    id: 'P06b', group: '会话页', title: '工具审批 — 以后不再询问', status: 'done',
    summary: '选「允许，且以后不再询问」后展开 Claude Code 建议的做法：要加的规则、要加的额外目录、要切换的模式，按它给的顺序逐条列出，默认全部勾选。',
    frs: ['FR-PERM-05', 'FR-PERM-08'],
    prepare: async (c) => { await openSession(c, c.ids.approval); await c.click('.opt', '允许，且以后不再询问'); await c.sleep(400); },
    marks: [
      { sel: '.always-line', nth: 0, note: ['建议的做法', '勾选 / 编辑', '每条一行：规则可以改写，下面一句话说明它的意思；也可能是「加为额外目录」或「切换到某个模式」。取消勾选的不会生效。像在工作区外写文件，要「加额外目录」和「切到自动接受编辑」都选上才不会再问。'] },
      { sel: '.opt .always .row', note: ['保存到', '下拉', '默认「本会话」，会话结束就失效；可以改成本工作区（.claude/settings.local.json）或所有工作区（用户设置）。切换模式只对本会话。'] },
      { sel: '.btn.primary', text: '允许并记住', note: ['允许并记住', '点击', '执行这一次，并把勾选的规则、目录和模式交给 Claude Code。'] },
    ],
  },
  {
    id: 'P07', group: '会话页', title: '澄清提问', status: 'done',
    summary: 'Claude 用提问工具停下来问你；多个问题分步回答。',
    frs: ['FR-ASK-01', 'FR-ASK-02', 'FR-ASK-03', 'FR-ASK-04'],
    prepare: async (c) => { await openSession(c, c.ids.question); },
    marks: [
      { sel: '.q-step', note: ['问题步骤', '点击切换', '每个问题一步，标明单选还是多选。'] },
      { sel: '.dpanel *', text: 'SQLite', note: ['选项', '点击选择', '选项和 Claude 写的说明；有预览的选项会显示预览。'] },
      { sel: 'input[placeholder="描述其他方案…"]', note: ['其他', '输入', '都不合适时自己写。'] },
      { sel: 'input[placeholder="给 Claude 的补充说明（可选）"]', note: ['补充说明', '输入', '随答案一起发给 Claude。'] },
      { sel: '.link-btn', text: '跳过', note: ['跳过', '点击', '不按选项回答，直接在输入框里用自己的话说。'] },
    ],
  },
  {
    id: 'P08', group: '会话页', title: '计划审阅', status: 'done',
    summary: '规划模式下 Claude 写好计划后停下来等你批准；每改一版都留在对话里。',
    frs: ['FR-PLAN-01', 'FR-PLAN-03', 'FR-PERM-01'],
    prepare: async (c) => { await openSession(c, c.ids.plan); await scrollTo(c, 'end'); },
    marks: [
      { sel: '.chip.outline', text: 'v1', note: ['计划', '—', 'Claude 写的 Markdown 计划，标出第几版。'] },
      { sel: '.btn.primary', text: '批准 · 自动接受编辑', note: ['批准', '点击', '批准后退出规划模式开始实施：自动接受编辑，或每步都询问。'] },
      { sel: 'input[placeholder="告诉 Claude 计划要怎么改…"]', note: ['修改意见', '输入后「继续规划」', 'Claude 留在规划模式改出下一版。'] },
      { sel: '.c-row2 .select-btn', text: '规划模式', note: ['权限模式', '下拉', '规划模式下 Claude 只读不改。'] },
    ],
  },
  {
    id: 'P09', group: '会话页', title: '子代理与后台任务', status: 'done',
    summary: '交给子代理的工作以卡片显示过程；转入后台的命令在检查器「后台」页继续运行。',
    frs: ['FR-AGT-04', 'FR-BG-01', 'FR-BG-02', 'FR-BG-03', 'FR-BG-04', 'FR-TOOL-06'],
    prepare: async (c) => { await openSession(c, c.ids.bg); await inspector(c, '后台'); await openSteps(c); await scrollTo(c, '梳理 src 模块结构'); },
    marks: [
      { sel: '.ins-body .tabs', note: ['进行中 / 已完成 / 未完成', '切换', '后台任务按状态分三页，默认「进行中」；每页按时间从新到旧排。'] },
      { sel: '.tcard', text: '梳理 src 模块结构', note: ['子代理卡片', '点击展开', '子代理类型、任务、它的每一步工具调用和用量；运行中可以停止。'] },
      { sel: '.tcard', text: 'npm run bench', note: ['后台命令', '—', '在后台运行的命令不阻塞这一轮。'] },
      { sel: '.btn', text: '把当前工作转入后台', note: ['转入后台', '点击', '把正在前台运行的命令或子代理转入后台，Claude 继续别的事。'] },
      { sel: '.btn.ghost', text: '查看输出', note: ['后台任务', '查看输出 / 停止', '后台任务的状态、用时，输出的末尾；完成后 Claude 会收到通知。'] },
    ],
  },
  {
    id: 'P10', group: '会话页', title: '检查点与回退', status: 'done',
    summary: '每条消息之前都是一个检查点：回退对话和文件，或从那里分叉一个新会话。',
    frs: ['FR-CKPT-01', 'FR-CKPT-02', 'FR-CKPT-03', 'FR-CKPT-04', 'FR-SES-10'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await inspector(c, '检查点'); await c.click('.btn.sm', '回退到这里'); await c.sleep(1200); },
    marks: [
      { sel: '.modal', note: ['回退预览', '—', '列出会恢复或删除的文件和行数（先试运行，不会真的改）；之后的对话从这里截断。'] },
      { sel: '.modal .btn.primary', note: ['回退', '点击', '回退文件和对话，被截掉的那条消息放回输入框；也可以选「分叉」保留原会话。'] },
    ],
  },
  {
    id: 'P11', group: '会话页', title: '上下文', status: 'done',
    summary: '检查器「上下文」页：上下文窗口被哪些内容占用，读了哪些记忆文件，压缩。',
    frs: ['FR-CTX-01', 'FR-CTX-02', 'FR-CTX-03'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await inspector(c, '上下文'); },
    marks: [
      { sel: '.inspector h4', text: '上下文 ·', note: ['用量条', '悬停分段', '系统提示词、工具、MCP、记忆文件、技能、对话、压缩预留各占多少；估算值。'] },
      { sel: '.btn.sm', text: '精确统计', note: ['精确统计', '点击', '让 Claude Code 精确计算一次（会调用接口）。'] },
      { sel: '.inspector h4', text: '记忆文件', note: ['记忆文件', '—', '这个会话读了哪些 CLAUDE.md。'] },
      { sel: '.inspector h4', text: '压缩', note: ['压缩', '输入说明后点击', '压缩对话，可以告诉 Claude 保留什么；也可以清空对话。'] },
      { sel: '.ctx-meter', note: ['上下文用量', '点击', '输入框下方的用量，点击展开或收起这一页。'] },
    ],
  },
  {
    id: 'P23', group: '会话页', title: '事件检查器', status: 'done',
    summary: '检查器「事件」页：Claude Code 的原始消息、stderr 和钩子执行记录，排查问题用。',
    frs: ['FR-OBS-01', 'FR-HOOK-04'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await inspector(c, '事件'); },
    marks: [
      { sel: '.inspector button', text: 'SDK 消息', note: ['分类', '点击', 'SDK 消息 / stderr / 钩子。'] },
      { sel: 'input[placeholder="搜索类型或内容"]', note: ['搜索与过滤', '输入 / 点类型', '按类型筛选、搜索内容。'] },
      { sel: '.btn.ghost[title="导出 JSONL"]', note: ['导出', '点击', '暂停滚动；导出成 JSONL。'] },
    ],
  },
  {
    id: 'P24', group: '会话页', title: '会话状态 — 运行中', status: 'done',
    summary: '长时间运行的命令：状态行、运行中的卡片、中断。',
    frs: ['FR-OUT-07', 'FR-SES-14'],
    prepare: async (c) => { await openSession(c, c.ids.running); await closeInspector(c); await scrollTo(c, 'end'); },
    marks: [
      { sel: '.steps-head .now', note: ['正在做的事', '点击展开', '还在进行的那一行显示 Claude 正在运行的命令；展开后运行中的卡片显示已用时间，可以转入后台。'] },
      { sel: '.status-line', note: ['状态行', '—', '「Claude 正在工作…」，接口重试时显示原因和倒计时。'] },
      { sel: '.btn', text: '中断', note: ['中断', '点击', '停在当前位置。'] },
    ],
  },
  {
    id: 'P24b', group: '会话页', title: '会话状态 — 出错与已保存', status: 'done',
    summary: '兼容端点拒绝请求时立刻停下并说明原因；没有运行进程的会话显示「已保存」。',
    frs: ['FR-OUT-08', 'FR-OUT-09', 'FR-MISC-04', 'FR-AUTH-04'],
    prepare: async (c) => { await openSession(c, c.ids.rejected); await closeInspector(c); await scrollTo(c, 'end'); },
    marks: [
      { sel: '.banner', note: ['错误横幅', '点按钮', '认证、账户、模型名这类重试也没用的错误立刻停下这一轮，说明是哪个端点、什么错；「打开模型服务设置」去改。崩溃、用量上限、启动失败也用横幅。'] },
      { sel: '.c-row2 .select-btn', note: ['换模型', '下拉', '换一个模型再发；换到其他服务的模型会在这一轮结束后重启 Claude Code 接着对话。'] },
    ],
  },
  {
    id: 'P24c', group: '会话页', title: '会话状态 — 已保存', status: 'done',
    summary: '已保存的会话没有运行中的 Claude Code 进程，恢复后继续；模型被删除时可以先换一个。',
    frs: ['FR-SES-09', 'FR-SES-14'],
    prepare: async (c) => { await openSession(c, c.ids.webPaging); await closeInspector(c); },
    marks: [
      { sel: '.readonly-bar', note: ['已保存', '恢复 / 分叉', '恢复会话接着对话；分叉开一个新会话。会话的模型已删除时，这里先选模型。'] },
    ],
  },
  {
    id: 'P27', group: '会话页', title: '代码审核 — 审核循环', status: 'done',
    summary: '提交审核后：Code Agent 先跑验证命令，再由独立的只读审核者审改动；打回时 Claude 逐条修改或说明，然后自动进入下一轮，最多 5 轮。',
    frs: ['自定义功能：代码审核'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await closeInspector(c); await openSteps(c); await scrollTo(c, '代码审核 · 第 1 轮', 10); },
    marks: [
      { sel: '.transcript *', text: '代码审核 · 第 1 轮', note: ['轮次分隔', '—', '每一轮：全局审核（前 3 轮看整个改动）或增量审核。'] },
      { sel: '.tcard', text: '验证', note: ['验证', '展开', '验证命令由 Code Agent 直接运行，不经过 Claude；没通过就把失败输出交给 Claude 修。'] },
      { sel: '.tcard', text: 'code-reviewer', note: ['审核者', '展开', '独立的 Claude Code 进程，只读，看不到作者的对话；显示它读了什么、用了多少 token。'] },
      { sel: '.tcard', text: '审核结论', note: ['审核结论', '—', '每条意见的严重程度、文件和行号；没有阻断和重要问题就算通过。'] },
      { sel: '.tcard', text: 'respond_findings', note: ['作者的答复', '—', 'Claude 逐条答复：已修改或有异议。'] },
    ],
  },
  {
    id: 'P27b', group: '会话页', title: '代码审核 — 提交审核', status: 'done',
    summary: '提交审核对话框：验证命令（按工作区记住）和这次审核用的模型。',
    frs: ['自定义功能：代码审核'],
    prepare: async (c) => { await openSession(c, c.ids.child); await c.click('.btn', '提交审核'); await c.sleep(900); },
    marks: [
      { sel: '.modal textarea', note: ['验证命令', '每行一条', '按顺序执行，全部通过后才开始审核；第一次会按 package.json 等猜出建议命令。'] },
      { sel: '.modal .select-btn', note: ['审核者', '下拉', '默认取自「评审」配置方案，可以换成任意服务的模型，只影响这一次。'] },
      { sel: '.modal .btn.primary', note: ['开始审核', '点击', '审核期间会话处于忙碌，你发的消息会排队。'] },
    ],
  },
  {
    id: 'P27c', group: '会话页', title: '代码审核 — 审核记录', status: 'done',
    summary: '按轮查看验证结果、审核意见、作者的修改和答复，可导出 Markdown。',
    frs: ['自定义功能：代码审核'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.click('.btn', '审核记录'); await c.sleep(900); },
    marks: [
      { sel: '.modal', note: ['审核记录', '展开每一轮', '基准提交、验证命令、审核者模型；每一轮的验证、意见、裁定和作者改了哪些文件。'] },
    ],
  },
  {
    id: 'P28', group: '会话页', title: '会话协作', status: 'done',
    summary: '同一工作区的会话能互相查看、发消息、开新会话；这里 Claude 开了一个在独立工作树里干活的会话，并收到它的回执。',
    frs: ['自定义功能：会话协作', 'FR-OUT-10'],
    prepare: async (c) => { await openSession(c, c.ids.peer); await closeInspector(c); await openSteps(c); await scrollTo(c, 'top'); },
    marks: [
      { sel: '.tcard', text: '新建会话', note: ['新建会话', '点击会话名', 'Claude 用工作区工具开的会话，写明标题、是否用独立工作树；点击跳过去。'] },
      { sel: '.transcript *', text: '处理完了你的消息', note: ['回执', '—', '对方处理完后发回的回执，标明来自哪个会话。'] },
      { sel: 'h5', text: '运行中', note: ['会话列表', '—', '由其他会话创建的会话写明来源；收到其他会话的消息时有数字提示。'] },
    ],
  },
  // ================================================================ extensions
  {
    id: 'P26', group: '扩展', title: '看板', status: 'done',
    summary: '工作区的功能、问题和笔记。每轮对话结束后由便宜的模型自动记录决定、确认过的问题和完成的工作。',
    frs: ['自定义功能：看板'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.go('/board'); await c.sleep(600); await c.click('button', '全部'); await c.sleep(300); await c.click('.ext-list .row, .board-layout .ext-item, .board-layout li', '订单列表分页').catch(() => {}); await c.sleep(500); },
    marks: [
      { sel: '.board-tabs', note: ['分类', '点击', '功能 / 问题 / 笔记，各自有状态（待办、进行中、完成；待确认、修复中…）。'] },
      { sel: 'button', text: '待确认', note: ['筛选', '点击', '未完成 / 全部 / 待确认（自动记录、你还没确认的）。'] },
      { sel: 'input[placeholder="搜索编号、标题、内容"]', note: ['搜索', '输入', '按编号（F-3、I-2）、标题、内容搜索。'] },
      { sel: '.btn', text: '导入', note: ['导入 / 导出', '点击', '从 GitHub、Jira、粘贴的文字或文件导入，模型先识别成条目让你确认；导出 Markdown。'] },
      { sel: '.btn', text: '设置', note: ['看板设置', '点击', '是否自动记录、识别用的模型和思考强度、新会话是否带上进行中的功能。'] },
      { sel: '.board-detail', note: ['条目详情', '编辑', '状态、优先级、任务、决定、关联的会话和变更记录；会话里提到 F-3 这样的编号会变成链接。'] },
    ],
  },
  {
    id: 'P13', group: '扩展', title: 'MCP 服务器', status: 'done',
    summary: 'Claude Code 读到的所有 MCP 服务器，按作用范围分组：状态、工具和每个工具的审批方式。',
    frs: ['FR-MCP-01', 'FR-MCP-02', 'FR-MCP-04', 'FR-MCP-09'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.go('/mcp'); await c.sleep(800); },
    marks: [
      { sel: '.btn.primary', text: '添加服务器', note: ['添加服务器', '点击', 'stdio / http / sse，选作用范围（所有工作区 / 这个工作区 / 仓库的 .mcp.json）；通过 Claude Code 自己的命令写入。'] },
      { sel: 'h5', text: '所有工作区', note: ['服务器列表', '点击', '按作用范围分组，显示类型和连接状态（已连接 / 失败 / 需要登录）。'] },
      { sel: '.btn.sm', text: '重新连接', note: ['操作', '点击', '重新连接、编辑、移除；令牌类的环境变量和请求头只显示掩码。'] },
      { sel: 'h3', text: '运行中的会话', note: ['运行中的会话', '开关', '在某个运行中的会话里临时关掉或重连这个服务器。'] },
      { sel: 'h3', text: '工具', note: ['工具', '允许 / 询问 / 拒绝 / 默认', '每个工具的审批方式，写成权限规则。'] },
    ],
  },
  {
    id: 'P14', group: '扩展', title: 'MCP 信息征询', status: 'done',
    summary: 'MCP 服务器在工具运行中向你要信息（表单或打开网址登录），停靠在输入框上方。',
    frs: ['FR-MCP-06'],
    prepare: async (c) => { await openSession(c, c.ids.elicit); await scrollTo(c, 'end'); },
    marks: [
      { sel: '.dpanel *', text: '优先级', note: ['表单', '填写', '按服务器给的结构生成：下拉、文本、开关，必填项标星。'] },
      { sel: '.btn.primary', text: '提交', note: ['提交 / 拒绝 / 取消', '点击', '提交答案；拒绝提供；或取消这次调用。'] },
    ],
  },
  {
    id: 'P16', group: '扩展', title: '技能、命令与插件', status: 'done',
    summary: 'Claude Code 的技能、斜杠命令和插件，按位置分组，可以直接编辑。',
    frs: ['FR-SKILL-01', 'FR-SKILL-02', 'FR-SKILL-03', 'FR-PLUG-01', 'FR-PLUG-03'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.go('/skills'); await c.sleep(800); },
    marks: [
      { sel: '.tabs', note: ['分类', '点击', '技能 / 命令 / 插件。'] },
      { sel: 'h5', text: '所有工作区', note: ['位置分组', '—', '所有工作区（~/.claude）、这个工作区（随仓库）、插件、内置。'] },
      { sel: '.toggle', note: ['启用', '开关', '关掉后 Claude 不会用它。'] },
      { sel: 'textarea.editor', note: ['编辑', '直接改', 'SKILL.md 的内容，保存后写回文件。'] },
      { sel: '.btn.sm', text: '在运行中的会话里重新加载', note: ['重新加载', '点击', '让运行中的会话读到改动。'] },
    ],
  },
  {
    id: 'P17', group: '扩展', title: '钩子', status: 'done',
    summary: '在 Claude Code 的事件上自动做事：允许、拒绝、补充上下文、通知、Webhook…… 按事件分类，可以试运行。',
    frs: ['FR-HOOK-01', 'FR-HOOK-02', 'FR-HOOK-03', 'FR-HOOK-05'],
    prepare: async (c) => { await c.go('/hooks'); await c.sleep(800); },
    marks: [
      { sel: '.hook-ev.on', note: ['事件', '点击', '按类别列出所有事件，数字是规则条数。'] },
      { sel: '.btn.primary', text: '新建规则', note: ['规则列表', '点击', 'Code Agent 的规则可编辑；设置文件里的和内置的只读显示。'] },
      { sel: 'label', text: '条件（可选）', note: ['条件', '选择', '按工具参数匹配：等于、包含、通配符、正则。'] },
      { sel: 'label', text: '动作', note: ['动作', '下拉', '这个事件能做的动作：拒绝并说明、补充上下文、通知、Webhook 等。'] },
      { sel: '.btn.sm', text: '运行', note: ['试运行', '点击', '用一段示例输入试这条规则，看结果。'] },
    ],
  },
  {
    id: 'P18', group: '扩展', title: '作业', status: 'done',
    summary: '定时或手动运行的提示词，输出按 JSON Schema 校验；每次运行都留记录。',
    frs: ['FR-JOB-01', 'FR-JOB-02', 'FR-JOB-03'],
    prepare: async (c) => { await c.go('/jobs'); await c.sleep(900); },
    marks: [
      { sel: '.status.good', text: '输出有效', note: ['作业列表', '点击', '最近一次运行的结果。'] },
      { sel: 'textarea.textarea', note: ['提示词', '输入', '`{{变量}}` 会变成运行时要填的值。'] },
      { sel: 'textarea.editor', note: ['输出结构', '编辑', 'JSON Schema，实时检查是否有效；输出不符合就记为「输出无效」。'] },
      { sel: 'h3', text: '运行设置', note: ['运行设置', '下拉', '模型、思考强度、权限模式（默认「不询问」）。'] },
      { sel: 'h3.row', text: '定时', note: ['定时', '设置', '每天 / 每周 / 每隔几小时 / cron；错过的运行补跑一次或跳过；何时通知。'] },
      { sel: 'h3', text: '运行', nth: 1, note: ['运行', '填变量后运行', '手动运行；下面是运行记录和结构化输出。'] },
    ],
  },
  {
    id: 'P19', group: '扩展', title: '用量', status: 'done',
    summary: '按天、工作区、模型统计 token；Claude 订阅的 5 小时和每周额度。',
    frs: ['FR-COST-03', 'FR-COST-04'],
    prepare: async (c) => { await c.go('/usage'); await c.sleep(900); },
    marks: [
      { sel: 'h1', note: ['用量', '—', '只显示 token，不显示费用。'] },
      { sel: '.panel', text: '订阅限额', note: ['订阅限额', '刷新', '5 小时窗口和本周的用量；只有登录 Claude 订阅时有。'] },
    ],
  },
  // ================================================================ settings
  {
    id: 'P29', group: '设置', title: '设置 — 常规', status: 'done',
    summary: '同时运行的会话上限，以及什么时候提醒你。',
    frs: ['NFR-03', 'FR-NTF-01'],
    prepare: async (c) => { await c.go('/settings/general'); await c.sleep(600); },
    marks: [
      { sel: 'h3', text: '同时运行的会话', note: ['运行上限', '输入', '所有工作区合计；满了先自动保存最久没动的空闲会话，没有空闲的就让新会话排队。'] },
      { sel: 'h3', text: '提醒我', note: ['提醒', '开关', '有事等你处理、一轮完成、后台任务或作业完成时提醒。'] },
      { sel: 'h3', text: '系统通知', note: ['系统通知', '开关 / 授权', '标签页不在前台时发系统通知，需要浏览器授权。'] },
    ],
  },
  {
    id: 'P20', group: '设置', title: '设置 — 配置方案', status: 'done',
    summary: '两套固定的方案：「默认」用于新会话和 Claude 新建的会话，「评审」用于代码审核。',
    frs: ['FR-CFG-01', 'FR-CFG-02', 'FR-MOD-01', 'FR-MOD-03', 'FR-PERM-01', 'FR-PROMPT-01', 'FR-PROMPT-02'],
    prepare: async (c) => { await c.go('/settings/profiles'); await c.sleep(700); },
    marks: [
      { sel: '.panel h3, h3', text: '默认', note: ['方案', '点击切换', '默认 / 评审；改完下方出现保存条。'] },
      { sel: 'label', text: '模型', note: ['模型与思考强度', '下拉', '端点模型没开「思考与思考强度」时，思考强度不可选。'] },
      { sel: 'label', text: '默认权限模式', note: ['权限', '下拉', '默认权限模式、需要审批时在界面里问还是一律拒绝。任何会话都能切到「跳过权限检查」，切换时要确认一次。'] },
      { sel: 'h3', text: 'Claude 可以使用的工具', note: ['工具', '勾选', '内置工具逐个开关；网页搜索只在 Claude 模型上提供。'] },
    ],
  },
  {
    id: 'P21', group: '设置', title: '设置 — 权限规则', status: 'done',
    summary: '允许 / 询问 / 拒绝规则，按作用范围分组，用结构化编辑器写。规则由 Claude Code 自己判断和执行。',
    frs: ['FR-PERM-08', 'FR-CFG-05'],
    prepare: async (c) => { await c.go('/settings/permissions'); await c.sleep(700); },
    marks: [
      { sel: 'button', text: '所有工作区', note: ['作用范围', '点击', '所有工作区（~/.claude/settings.json）/ 单个工作区（.claude/settings.local.json）；仓库里的规则只读显示。'] },
      { sel: '.chip.crit', text: '拒绝', note: ['规则列表', '删除', '每条规则用一句话说明它的意思。'] },
      { sel: 'button', text: '以…开头', note: ['新规则', '选择 / 输入', '动作、工具、匹配方式和内容，不用写规则语法。'] },
      { sel: 'h3', text: '额外可访问的目录', note: ['额外目录', '添加', '工作目录之外 Claude 也能读写的目录。'] },
    ],
  },
  {
    id: 'P37', group: '设置', title: '设置 — 会话协作', status: 'done',
    summary: '会话之间互发消息的规则：权限级别不同的消息先放着等你放行，限制来回转发的次数。',
    frs: ['自定义功能：会话协作'],
    prepare: async (c) => { await c.go('/settings/collaboration'); await c.sleep(600); },
    marks: [
      { sel: 'h3', text: '收到其他会话的消息', note: ['收到消息', '选择', '直接投递，或先放着等你放行（发送方权限比接收方高时总是先放着）。'] },
      { sel: 'h3', text: '防止来回转发', note: ['转发上限', '输入', '没有人参与时，一串消息最多转几次，超过就停下等你。'] },
      { sel: 'h3', text: 'Claude 怎样使用这些功能', note: ['说明', '—', 'Claude 能用的工作区工具：列出、阅读、查看状态、发消息、新建会话。'] },
    ],
  },
  {
    id: 'P22', group: '设置', title: '设置 — 模型服务与账号', status: 'done',
    summary: 'Claude 订阅和任意多个兼容端点可以同时用，所有模型在一个列表里，各处各选各的。',
    frs: ['FR-AUTH-02', 'FR-AUTH-03', 'FR-AUTH-04'],
    prepare: async (c) => { await c.go('/settings/provider'); await c.sleep(700); },
    marks: [
      { sel: 'h3', text: 'Claude 订阅', note: ['Claude 订阅', '—', '用你自己在 Claude Code 里登录的账号；Code Agent 不提供登录，也不读取凭证。'] },
      { sel: '.btn.sm', text: '重新检测', note: ['登录', '复制命令 / 重新检测', '没登录时给出在终端里登录的步骤。'] },
      { sel: 'h3', text: '配置目录', note: ['配置目录', '选择', '默认 ~/.claude、环境变量 CLAUDE_CONFIG_DIR，或指定目录。'] },
      { sel: 'h3', text: '兼容端点', note: ['兼容端点', '添加 / 删除', '每个端点：名称、Base URL、令牌（只存在服务端）、多个模型（P22b）。'] },
    ],
  },
  {
    id: 'P22b', group: '设置', title: '设置 — 兼容端点', status: 'done',
    summary: '端点和它的模型：每个模型可以测试，单独开关「思考与思考强度」。',
    frs: ['FR-AUTH-01', 'FR-AUTH-03', 'FR-CFG-04'],
    prepare: async (c) => { await c.go('/settings/provider'); await c.sleep(700); await c.eval(`(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.textContent === '兼容端点'); h && h.scrollIntoView(); })()`); await c.sleep(300); },
    marks: [
      { sel: 'label', text: 'Base URL', note: ['端点', '输入', '名称和 Base URL。'] },
      { sel: 'label', text: '认证令牌', note: ['令牌', '保存 / 清除', '保存在服务端，不会发到浏览器；没有令牌时发占位值，绝不会用你的 Claude 登录。'] },
      { sel: '.toggle', text: '思考与思考强度', note: ['思考与思考强度', '开关', '端点支持时打开；关掉就不发思考参数。'] },
      { sel: '.btn', text: '测试', note: ['测试', '点击', '发一句很短的提示看服务是否回复；认证失败等错误会马上显示原因。'] },
      { sel: '.btn.sm', text: '添加模型', note: ['添加模型', '输入模型名', '端点接受的模型名。'] },
      { sel: '.banner-warn', text: '非 Claude 模型', note: ['提醒', '—', '哪些功能取决于端点是否实现。'] },
    ],
  },
  {
    id: 'P25', group: '设置', title: '设置 — 语言与地区', status: 'done',
    summary: '界面语言、Claude 的回复语言、数字格式。',
    frs: ['FR-I18N-01', 'FR-I18N-03', 'FR-I18N-04', 'FR-I18N-05'],
    prepare: async (c) => { await c.go('/settings/language'); await c.sleep(600); },
    marks: [
      { sel: 'h3', text: '界面语言', note: ['界面语言', '选择', '跟随浏览器或指定；英文在交互定稿后开放。'] },
      { sel: 'h3', text: 'Claude 的回复语言', note: ['回复语言', '选择', '跟随界面语言、指定语言，或不限制。'] },
      { sel: 'h3', text: '数字格式', note: ['数字格式', '选择', 'token 数等的显示方式。'] },
    ],
  },
  {
    id: 'P25b', group: '设置', title: '英文界面', status: 'done',
    summary: '界面语言选 English（或跟随英文浏览器）时的样子。服务端生成的提示（工具行、通知、错误、审核记录）也一并翻译；Code Agent 发给 Claude 的提示词保持中文。',
    frs: ['FR-I18N-01', 'FR-I18N-02'],
    prepare: async (c) => {
      await c.call('setState', { prefs: { ...c.slices().prefs, uiLanguage: 'en' } });
      await openSession(c, c.ids.validate);
      await inspector(c, '任务');
      await scrollTo(c, 'top');
    },
    after: async (c) => { await c.call('setState', { prefs: { ...c.slices().prefs, uiLanguage: 'zh-CN' } }); },
    marks: [
      { sel: '.lang-btn', note: ['界面语言', '点击', '跟随浏览器 / 简体中文 / English，切换后立即生效，不用刷新。'] },
      { sel: '.steps-head', nth: 0, note: ['翻译范围', '—', '界面文字和服务端生成的提示都已翻译，带名称和数字的也一样；对话内容和 Claude 的回答不受影响（回复语言另在「语言与地区」设置）。'] },
    ],
  },
  // ================================================================ added in v0.3
  {
    id: 'P34', group: '会话页', title: '会话信息', status: 'done',
    summary: '检查器「信息」页：这个会话的身份和运行环境，以及在终端里接着用的命令。',
    frs: ['FR-SES-17'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await inspector(c, '信息'); },
    marks: [
      { sel: '.ins-rail-btn', text: '信息', note: ['「信息」页', '点击', '检查器的图标栏。'] },
      { sel: '.ins-body dl', note: ['会话信息', '—', '会话 ID、工作目录或工作树、模型和服务、Claude Code 版本和进程、权限模式、读取的设置和说明文件、MCP 服务器和状态、子代理、进程启动时间（Claude Code 每轮开头报告）。'] },
      { sel: '.ins-body .btn', text: '在终端里继续', note: ['复制命令', '点击', '复制 `cd <目录> && claude --resume <会话 ID>`，在终端里接着这段对话；先在这里保存会话，避免两边同时写。'] },
    ],
  },
  {
    id: 'P33', group: '会话页', title: '文件预览', status: 'done',
    summary: '点对话里工具卡片上的文件路径，或变更列表里的预览按钮，在检查器「文件」页看文件内容。',
    frs: ['FR-FILE-02'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await openSteps(c); await scrollTo(c, 'top'); await c.click('.tcard .detail.link', 'src/orders.js'); await c.sleep(1200); },
    marks: [
      { sel: '.tcard .detail.link', text: 'src/orders.js', note: ['文件路径', '点击', '读、改、写文件的卡片上路径可以点；读文件的卡片会标出读的那几行。变更列表里每个文件也有预览按钮。'] },
      { sel: '.ins-rail-btn', text: '文件', note: ['「文件」页', '—', '显示最近打开的文件。'] },
      { sel: '.file-view', note: ['文件内容', '滚动 / 选中复制', '带行号、按语言着色；只能打开会话工作目录、工作区和额外目录里的文件。「在变更里看」跳到这个文件的差异。'] },
    ],
  },
  {
    id: 'P36', group: '会话页', title: '代码高亮', status: 'done',
    summary: '回答里的代码块、改动差异和文件预览按语言着色。',
    frs: ['FR-OUT-01'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await closeInspector(c); await openSteps(c); await scrollTo(c, 'function validateItems', 260); },
    marks: [
      { sel: '.md-code', note: ['代码块', '—', '按代码块标注的语言着色；没标注时自动判断，判断不出就不着色。'] },
      { sel: '.diff', note: ['差异', '—', '改动差异按文件类型着色，+/- 标记保持原样。'] },
    ],
  },
  {
    id: 'P35', group: '会话', title: '全部会话 — 工作树', status: 'done',
    summary: '「工作树」分页：Code Agent 为会话建的 git 工作树，看状态、打开会话、删除。',
    frs: ['FR-WS-03'],
    prepare: async (c) => { await c.go('/sessions'); await c.sleep(600); await c.click('.history-tabs button', '工作树'); await c.sleep(1500); },
    marks: [
      { sel: '.history-tabs', note: ['会话 / 工作树', '切换', '全部会话页的两个分页。'] },
      { sel: '.wt-row .chip', note: ['分支', '—', '工作树的分支，比基准（工作区当前分支）多几个提交。'] },
      { sel: '.wt-row .status', note: ['改动', '—', '有没有未提交的改动，悬停看文件。'] },
      { sel: '.wt-row .btn.danger-outline', note: ['删除工作树', '点击', '先确认，写明会丢掉的未提交改动；分支合并了才一起删，没合并的保留。用它的会话先保存，之后只能查看。'] },
    ],
  },
  {
    id: 'P15', group: '扩展', title: '子代理', status: 'done',
    summary: '技能页「子代理」分页：所有工作区、这个工作区、插件里和内置的子代理，可以开关、新建、编辑。',
    frs: ['FR-AGT-01', 'FR-AGT-02'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.go('/skills'); await c.sleep(700); await c.click('.tabs button', '子代理'); await c.sleep(600); await c.click('.ext-item', 'test-writer').catch(() => {}); await c.sleep(400); },
    marks: [
      { sel: '.tabs button', text: '子代理', note: ['「子代理」分页', '点击', '和技能、命令、插件并列。'] },
      { sel: '.ext-item.on', note: ['子代理列表', '点击 / 开关', '按位置分组；关掉后新会话里 Claude 不能用它（写成 Agent(名称) 拒绝规则）。内置和插件里的只能开关。'] },
      { sel: '.panel input.mono', note: ['编辑', '填写后保存', '名称、模型、什么时候用、可用的工具、说明，保存成 `.claude/agents/<名称>.md`，Claude Code 命令行也能用。'] },
      { sel: '.btn', text: '在运行中的会话里重新加载', note: ['重新加载', '点击', '运行中的会话读到新的子代理列表。'] },
    ],
  },
  {
    id: 'P32', group: '设置', title: '设置 — 项目说明与记忆', status: 'done',
    summary: 'Claude 每个会话开始时都会读的说明文件，以及 Claude Code 自动记下的记忆，可以直接查看和编辑。',
    frs: ['FR-PROMPT-03', 'FR-PROMPT-05'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await c.go('/settings/instructions'); await c.sleep(1200); await c.click('.ext-item', 'shop-api 约定').catch(() => {}); await c.sleep(800); },
    marks: [
      { sel: '.settings-nav a', text: '项目说明与记忆', note: ['入口', '点击', '设置侧栏。'] },
      { sel: '.settings-main .seg', note: ['范围', '切换', '当前工作区（同时列出所有工作区的）或只看所有工作区的。'] },
      { sel: '.ext-item.on', note: ['文件', '点击', '`~/.claude/CLAUDE.md`、仓库的 `CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules/*.md` 和自动记忆；不存在的标「新建」，保存时创建。'] },
      { sel: '.settings-main textarea', note: ['编辑', '修改后保存', '写回文件，对新会话生效。'] },
    ],
  },
  {
    id: 'P20b', group: '设置', title: '设置 — 配置方案（输出风格、计划模式）', status: 'done',
    summary: '「默认」方案的输出风格和计划模式补充说明；关掉「向你提问」时说明后果。',
    frs: ['FR-PROMPT-04', 'FR-PLAN-02', 'FR-ASK-05'],
    prepare: async (c) => {
      await c.go('/settings/profiles');
      await c.sleep(800);
      await c.click('.tool-item', 'AskUserQuestion');
      await c.sleep(300);
      await c.eval(`(() => { const h = [...document.querySelectorAll('h3')].find((x) => x.textContent === '输出风格'); h && h.scrollIntoView({ block: 'start' }); })()`);
      await c.sleep(300);
    },
    marks: [
      { sel: 'h3', text: '输出风格', note: ['输出风格', '下拉', 'Claude Code 内置的默认 / 解释型 / 学习型，以及 output-styles 文件夹里自定义的。'] },
      { sel: 'h3', text: '计划模式补充说明', note: ['计划模式说明', '输入', '进入规划模式时代替默认的规划要求交给 Claude。'] },
    ],
  },
  {
    id: 'P20c', group: '设置', title: '设置 — 配置方案（应用到运行中的会话）', status: 'done',
    summary: '保存方案后：对新会话生效；运行中的会话可以一键重启用上新方案，对话接着进行。',
    frs: ['FR-CFG-01'],
    prepare: async (c) => {
      // Start from a profile without the text, so typing it makes a change to save.
      await c.call('setState', { profiles: c.slices().profiles.map((p) => ({ ...p, planInstructions: '' })) });
      await c.go('/settings/profiles');
      await c.sleep(800);
      await c.type('textarea[placeholder="例如：计划里写清楚要改的文件、测试方案和回滚方式"]', '计划里写清楚要改的文件、测试方案和回滚方式。');
      await c.sleep(300);
      await c.click('.btn.primary', '保存');
      await c.sleep(600);
    },
    marks: [
      { sel: '.modal-foot .hint', note: ['生效时间', '—', '方案在会话的 Claude Code 进程启动时生效：新会话直接用上；运行中的会话要重启。'] },
      { sel: '.btn.primary', text: '应用到运行中的会话', note: ['应用到运行中的会话', '点击', '每个运行中的会话在空闲后（这一轮结束、没有等你处理的请求、没有排队的消息和运行中的后台任务）重新启动，接着原来的对话。'] },
    ],
  },
  {
    id: 'P23b', group: '会话页', title: '事件检查器 — 调试日志', status: 'done',
    summary: '开了「保存调试日志」后，事件检查器多一个「调试日志」分类，显示这个会话日志的末尾。',
    frs: ['FR-OBS-02'],
    prepare: async (c) => { await openSession(c, c.ids.validate); await inspector(c, '事件'); await c.click('.ins-body .tabs button', '调试日志'); await c.sleep(1500); },
    marks: [
      { sel: '.ins-body .tabs button', text: '调试日志', note: ['「调试日志」分类', '点击', '只在设置里打开「保存调试日志」时出现。'] },
      { sel: '.log-tail', note: ['日志末尾', '—', '每 3 秒刷新；可以复制文件路径用编辑器打开。'] },
    ],
  },
];
