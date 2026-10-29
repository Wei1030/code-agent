// Proposed screens: the real page with the proposed parts drawn in using the app's own classes.
// `snippet` is what gets injected (shown under the screen in the prototype); `{…}` placeholders are
// filled with the demo's values when shooting.
import { readFileSync } from 'node:fs';
import path from 'node:path';

const DEMO = process.env.DEMO_DIR ?? 'C:/tmp/code-agent-demo';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fill = (html, vals) => html.replace(/\{(\w+)\}/g, (m, k) => (k in vals ? esc(vals[k]) : m));

const PROTO_CSS = '.proto-new { outline: 2px dashed #e8590c !important; outline-offset: 3px; }';
const style = (c) => c.eval(`(() => { if (!document.getElementById('proto-css')) { const s = document.createElement('style'); s.id = 'proto-css'; s.textContent = ${JSON.stringify(PROTO_CSS)}; document.head.appendChild(s); } })()`);
const open = async (c, id) => { await c.go(`/s/${id}`); await c.sleep(900); await style(c); };
const tab = async (c, label) => {
  await c.eval(`(() => { const b = [...document.querySelectorAll('.ins-rail-btn')].find((x) => x.querySelector('span')?.textContent === ${JSON.stringify(label)}); if (b && !b.classList.contains('on')) b.click(); })()`);
  await c.sleep(500);
};
/** A new inspector tab: a rail button like the others (outlined) and its content in the inspector. */
const newInspectorTab = (c, label, html) => c.eval(`(() => {
  const rail = document.querySelector('.ins-rail');
  const tpl = rail.querySelector('.ins-rail-btn');
  rail.querySelectorAll('.ins-rail-btn').forEach((b) => b.classList.remove('on'));
  const b = tpl.cloneNode(true);
  b.classList.add('on', 'proto-new', 'proto-tab');
  b.querySelector('span').textContent = ${JSON.stringify(label)};
  b.querySelector('.badge')?.remove();
  rail.appendChild(b);
  document.querySelector('.ins-head b').textContent = ${JSON.stringify(label)};
  document.querySelector('.ins-body').innerHTML = ${JSON.stringify(html)};
})()`);

/** A minimal JS highlighter for the code-highlighting proposal. */
function highlight(code) {
  const KW = /\b(function|const|let|var|return|if|for|of|throw|new|require|module|exports|true|false|null|undefined)\b/g;
  return code.split('\n').map((line) => {
    let out = '';
    const re = /('(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\/\/.*$|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*(?=\()|[A-Za-z_$][\w$]*)/g;
    let last = 0;
    for (const m of line.matchAll(re)) {
      out += esc(line.slice(last, m.index));
      const t = m[0];
      const cls = t.startsWith("'") || t.startsWith('`') ? 'tok-str' : t.startsWith('//') ? 'tok-com' : /^\d/.test(t) ? 'tok-num' : KW.test(t) ? 'tok-kw' : /\($/.test(line.slice(m.index + t.length, m.index + t.length + 1)) ? 'tok-fn' : '';
      KW.lastIndex = 0;
      out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
      last = m.index + t.length;
    }
    return out + esc(line.slice(last));
  }).join('\n');
}
const TOK_CSS = '.tok-kw{color:#8a3ffc}.tok-str{color:#0b7a3e}.tok-num{color:#b35900}.tok-fn{color:#1f5bd6}.tok-com{color:#8a8f98;font-style:italic}';

// ------------------------------------------------------------------ snippets
const INFO = `<div class="proto-new" style="display:flex;flex-direction:column;gap:14px">
  <dl class="kv">
    <dt>会话 ID</dt><dd class="mono">{sid}</dd>
    <dt>工作目录</dt><dd class="mono">{cwd}</dd>
    <dt>分支</dt><dd>main</dd>
    <dt>模型</dt><dd>demo-pro · 演示服务（兼容端点）</dd>
    <dt>Claude Code</dt><dd>2.1.312 · 随 SDK 提供 · 进程 {pid}</dd>
    <dt>权限模式</dt><dd>自动接受编辑</dd>
    <dt>设置文件</dt><dd>用户 · 项目 · 本地</dd>
    <dt>说明文件</dt><dd class="mono">~/.claude/CLAUDE.md<br>CLAUDE.md</dd>
    <dt>MCP</dt><dd>workspace、issue-tracker 已连接<br><span class="muted">docs-search 连接失败</span></dd>
    <dt>开始</dt><dd>{started} · 没有恢复过</dd>
  </dl>
  <div class="row" style="gap:8px;flex-wrap:wrap">
    <button class="btn sm">复制会话 ID</button>
    <button class="btn sm">复制「在终端里继续」的命令</button>
  </div>
  <div class="hint">在终端里运行 <span class="mono">claude --resume {short}…</span> 可以接着这段对话（先保存这个会话，避免两边同时写）。</div>
</div>`;

const FILE = `<div class="proto-new" style="display:flex;flex-direction:column;gap:8px">
  <div class="row" style="gap:8px"><b class="mono">src/orders.js</b><span class="hint">{lines} 行 · 第 1 轮读过 · 改过 2 次</span><span class="grow"></span><button class="btn sm ghost">在变更里看</button></div>
  <pre class="mono" style="margin:0;font-size:12px;line-height:1.55;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:8px 0;overflow:auto">{code}</pre>
</div>`;

const WORKTREES = `<div class="proto-new">
  <div class="tabs"><button>会话</button><button class="on">工作树<span class="count">1</span></button></div>
  <div class="panel" style="margin-top:12px"><div class="panel-body" style="padding:4px 0">
    <div style="display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1.3fr) minmax(0,1.2fr) minmax(0,1.3fr) auto;gap:14px;align-items:center;padding:12px 16px">
      <div style="min-width:0"><b>{title}</b><div class="hint mono truncate">{path}</div></div>
      <div><span class="chip mono">{branch}</span><div class="hint">基于 main · 比 main 多 0 个提交</div></div>
      <div><span class="status warn">1 个文件未提交</span><div class="hint">docs/api.md</div></div>
      <div>会话「{title}」<div class="hint">空闲 · 进程在线</div></div>
      <div class="row" style="gap:6px"><button class="btn sm">打开会话</button><button class="btn sm danger-outline">删除工作树</button></div>
    </div>
  </div></div>
  <div class="hint" style="margin-top:8px">Code Agent 为会话建的 git 工作树（create_session 的 worktree）。删除时：有未提交的改动或没合并进 main 的提交会先提醒；会话保留，恢复后回到工作区目录。</div>
</div>`;

const AGENTS = `<div class="ext-layout proto-new" style="grid-template-columns:380px minmax(0,1fr)">
  <div><div class="ext-list">
    <h5>所有工作区 <span class="mono" style="font-weight:400">~/.claude/agents</span></h5>
    <div class="ext-item on"><div class="top"><b class="mono" style="font-size:13px">test-writer</b><span class="grow"></span><label class="toggle on"><span class="track"></span></label></div><div class="sub truncate" style="display:block">为指定模块补测试；只写 test/ 下的文件</div><div class="sub">工具 5 个 · 模型跟随会话</div></div>
    <h5>shop-api <span class="mono" style="font-weight:400">.claude/agents</span></h5>
    <div class="ext-item"><div class="sub">还没有。新建的子代理可以随仓库提交，团队共用。</div></div>
    <h5>内置</h5>
    <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">Explore</b><span class="grow"></span><span class="chip">只读</span></div><div class="sub">快速搜索代码库，回答「在哪」「怎么用」</div></div>
    <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">general-purpose</b></div><div class="sub">多步骤的研究和执行</div></div>
    <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">Plan</b><span class="grow"></span><span class="chip">只读</span></div><div class="sub">规划实现方案</div></div>
  </div><div class="hint" style="margin-top:8px">Claude 用「子代理」工具把任务交给它们；关掉后 Claude 看不到这个子代理。</div></div>
  <div class="panel"><div class="panel-head"><h3 class="mono">test-writer</h3><span class="sub">~/.claude/agents/test-writer.md</span><span class="grow"></span><button class="btn ghost sm">删除</button></div>
    <div class="panel-body" style="display:flex;flex-direction:column;gap:12px">
      <div class="form-grid"><div class="field"><label>名称</label><input class="input mono" value="test-writer"></div><div class="field"><label>模型</label><button class="select-btn">跟随会话</button></div></div>
      <div class="field"><label>什么时候用（Claude 据此决定是否交给它）</label><input class="input" value="为指定模块补测试；只写 test/ 下的文件"></div>
      <div class="field"><label>可以使用的工具</label><div class="row" style="gap:6px;flex-wrap:wrap"><span class="chip">Read</span><span class="chip">Grep</span><span class="chip">Glob</span><span class="chip">Write</span><span class="chip">Bash</span><button class="btn sm ghost">+ 工具</button></div></div>
      <div class="field"><label>说明（子代理的系统提示词）</label><textarea class="editor" rows="6">你只负责写测试。先读被测模块，再按边界值、错误分支、正常路径补 node:test 用例，最后跑 \`npm test\`。</textarea></div>
      <div class="row" style="justify-content:flex-end;gap:8px"><button class="btn sm">还原</button><button class="btn sm primary">保存</button></div>
    </div></div>
</div>`;

const INSTRUCTIONS = `<div class="proto-new">
  <h1>项目说明与记忆</h1>
  <p class="lead">Claude 每个会话开始时都会读的说明文件，以及 Claude Code 自动记下的记忆。改动对新会话生效，运行中的会话下次读取时生效。</p>
  <div class="seg"><button class="on">shop-api</button><button>只看所有工作区</button></div>
  <div class="ext-layout" style="grid-template-columns:340px minmax(0,1fr);margin-top:14px">
    <div class="ext-list">
      <h5>所有工作区 <span class="mono" style="font-weight:400">~/.claude</span></h5>
      <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">CLAUDE.md</b></div><div class="sub">我的习惯 · 4 行</div></div>
      <h5>shop-api</h5>
      <div class="ext-item on"><div class="top"><b class="mono" style="font-size:13px">CLAUDE.md</b><span class="grow"></span><span class="chip">随仓库提交</span></div><div class="sub">shop-api 约定 · 6 行</div></div>
      <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">CLAUDE.local.md</b><span class="grow"></span><span class="chip outline">新建</span></div><div class="sub">只在这台电脑上，不提交</div></div>
      <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">.claude/rules/</b></div><div class="sub">按路径生效的规则 · 还没有</div></div>
      <h5>记忆 <span style="font-weight:400">Claude Code 自动记下的</span></h5>
      <div class="ext-item"><div class="top"><b class="mono" style="font-size:13px">MEMORY.md</b></div><div class="sub">2 条 · 最近：金额一律用分为单位</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3 class="mono">CLAUDE.md</h3><span class="sub mono">{path}</span><span class="grow"></span><span class="hint">9 个会话读过</span></div>
      <div class="panel-body"><textarea class="editor" rows="12">{content}</textarea>
        <div class="row" style="justify-content:flex-end;gap:8px;margin-top:10px"><button class="btn sm">还原</button><button class="btn sm primary">保存</button></div></div></div>
  </div>
</div>`;

const PROFILE_EXTRA = `<div class="proto-new" style="display:flex;flex-direction:column;gap:12px;margin-bottom:18px">
  <div class="form-grid">
    <div class="field"><label>输出风格</label><button class="select-btn">默认</button><span class="hint">Claude Code 内置的「解释型」「学习型」，或 ~/.claude/output-styles 里自定义的风格</span></div>
    <div class="field"><label>计划模式补充说明</label><textarea class="textarea" rows="2" placeholder="例如：计划里写清楚要改的文件、测试方案和回滚方式"></textarea><span class="hint">进入规划模式时追加给 Claude</span></div>
  </div>
</div>`;

const ASK_HINT = '<div class="hint proto-new" style="color:var(--warn-ink)">关掉后，Claude 遇到需要你选择的地方会自己决定，不再停下来问。</div>';

const DEBUG_LOG = `<div class="proto-new" style="display:flex;flex-direction:column;gap:8px">
  <div class="row" style="gap:8px"><span class="hint mono truncate">~/.code-agent/logs/{short}.log</span><span class="grow"></span><button class="btn sm ghost">复制路径</button></div>
  <pre class="mono" style="margin:0;font-size:11.5px;line-height:1.55;background:#1f2430;color:#e6e8ef;border-radius:8px;padding:10px;overflow:auto;white-space:pre-wrap">[DEBUG] Loaded settings from user, project, local
[DEBUG] MCP server "issue-tracker": connected in 412ms
[DEBUG] MCP server "docs-search": connect failed (ECONNREFUSED)
[DEBUG] Permission check Edit src/orders.js → allow (mode acceptEdits)
[DEBUG] Hook PostToolUse "git diff --stat" exited 0 in 88ms
[DEBUG] API request demo-pro · 14.2k input · stream
[DEBUG] Stream finished: stop_reason=end_turn, 412 output tokens
[DEBUG] Turn 2 finished in 5.5s</pre>
  <div class="hint">只在「设置 → 模型服务与账号 → 运行与遥测 → 保存调试日志」打开时有内容。</div>
</div>`;

export const PROPOSED = [
  {
    id: 'P34', group: '提议', title: '会话信息', status: 'new',
    summary: '检查器新增「信息」页：这个会话的身份和运行环境，以及在终端里接着用的命令。',
    frs: ['FR-SES-17'], snippet: INFO,
    prepare: async (c) => {
      await open(c, c.ids.validate);
      await tab(c, '任务');
      const s = c.summary(c.ids.validate);
      await newInspectorTab(c, '信息', fill(INFO, { sid: c.ids.validate, short: c.ids.validate.slice(0, 8), cwd: s?.cwd ?? path.join(DEMO, 'repos', 'shop-api'), pid: '4712', started: '今天 14:02' }));
    },
    marks: [
      { sel: '.proto-tab', isNew: true, note: ['「信息」页', '点击', '检查器多一个图标。'] },
      { sel: '.ins-body dl', isNew: true, note: ['会话信息', '—', '会话 ID、工作目录或工作树、模型和服务、Claude Code 版本和进程、权限模式、读取的设置文件和说明文件、MCP 服务器、开始时间。数据来自 Claude Code 的初始化消息。'] },
      { sel: '.ins-body .btn', text: '在终端里继续', isNew: true, note: ['复制命令', '点击', '复制 `claude --resume <会话 ID>`，在终端里接着这段对话。'] },
    ],
  },
  {
    id: 'P32', group: '提议', title: '项目说明与记忆', status: 'new',
    summary: '设置里新增一页：Claude 每次都读的说明文件和 Claude Code 自动记下的记忆，可以直接查看和编辑。',
    frs: ['FR-PROMPT-03', 'FR-PROMPT-05'], snippet: INSTRUCTIONS,
    prepare: async (c) => {
      await c.go(`/s/${c.ids.validate}`);
      await c.sleep(600);
      await c.go('/settings/general');
      await c.sleep(600);
      await style(c);
      const file = path.join(DEMO, 'repos', 'shop-api', 'CLAUDE.md');
      const html = fill(INSTRUCTIONS, { path: file, content: readFileSync(file, 'utf8') });
      await c.eval(`(() => {
        const nav = document.querySelector('.settings-nav');
        const links = [...nav.querySelectorAll('a')];
        links.forEach((a) => a.classList.remove('active'));
        const a = links[1].cloneNode(true);
        a.classList.add('active', 'proto-new', 'proto-nav');
        a.removeAttribute('href');
        a.querySelector('.row').lastChild.textContent = '项目说明与记忆';
        links[2].after(a);
        document.querySelector('.settings-main').innerHTML = ${JSON.stringify(html)};
      })()`);
    },
    marks: [
      { sel: '.proto-nav', isNew: true, note: ['设置入口', '点击', '设置侧栏新增「项目说明与记忆」。'] },
      { sel: '.settings-main .seg', isNew: true, note: ['范围', '切换', '当前工作区（同时列出所有工作区的）或只看所有工作区的。'] },
      { sel: '.settings-main .ext-item.on', isNew: true, note: ['文件列表', '点击', '`~/.claude/CLAUDE.md`、仓库的 `CLAUDE.md`、`CLAUDE.local.md`、`.claude/rules/*.md`，以及自动记忆；不存在的可以直接新建。'] },
      { sel: '.settings-main textarea', isNew: true, note: ['编辑', '直接改，保存', '保存后写回文件；标出有多少个会话读过它。'] },
    ],
  },
  {
    id: 'P33', group: '提议', title: '文件预览', status: 'new',
    summary: '点对话里的文件路径，在检查器「文件」页看文件内容；读文件的卡片定位到读的那几行。',
    frs: ['FR-FILE-02'], snippet: FILE,
    prepare: async (c) => {
      await open(c, c.ids.validate);
      await c.eval(`(() => { const box = document.querySelector('.transcript'); box.scrollTop = 0; box.dispatchEvent(new Event('scroll')); })()`);
      await c.sleep(300);
      const code = readFileSync(path.join(DEMO, 'repos', 'shop-api', 'src', 'orders.js'), 'utf8').replace(/\n$/, '').split('\n');
      const lines = code.map((l, i) => `<div style="display:flex${i >= 3 && i <= 9 ? ';background:rgba(59,91,219,.08)' : ''}"><span style="width:38px;flex:none;text-align:right;padding-right:10px;color:var(--muted);user-select:none">${i + 1}</span><span style="white-space:pre">${esc(l)}</span></div>`).join('');
      await newInspectorTab(c, '文件', FILE.replace('{lines}', String(code.length)).replace('{code}', lines));
      await c.eval(`(() => { const d = [...document.querySelectorAll('.tcard .detail')].find((x) => x.textContent.includes('src/orders.js')); if (d) { d.style.color = 'var(--accent)'; d.style.textDecoration = 'underline'; d.classList.add('proto-new', 'proto-path'); } })()`);
    },
    marks: [
      { sel: '.proto-path', isNew: true, note: ['文件路径', '点击', '工具卡片、@ 引用和变更列表里的路径都可以点。'] },
      { sel: '.proto-tab', isNew: true, note: ['「文件」页', '—', '检查器多一个图标，显示最近打开的文件。'] },
      { sel: '.ins-body pre', isNew: true, note: ['文件内容', '滚动 / 选中复制', '带行号；从读文件的卡片打开时，读过的行高亮。「在变更里看」跳到这个文件的差异。'] },
    ],
  },
  {
    id: 'P36', group: '提议', title: '代码高亮', status: 'new',
    summary: '回答里的代码块、改动差异和文件预览按语言着色。',
    frs: ['FR-OUT-01'], snippet: `<style>${TOK_CSS}</style>\n<!-- 代码块里按语言标出 tok-kw / tok-str / tok-num / tok-fn / tok-com -->`,
    prepare: async (c) => {
      await open(c, c.ids.validate);
      await c.eval(`(() => { const box = document.querySelector('.transcript'); const el = [...document.querySelectorAll('.md-code')].find((x) => x.textContent.includes('function validateItems')); if (el) { box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 220; box.dispatchEvent(new Event('scroll')); } })()`);
      await c.sleep(400);
      const code = "function validateItems(items) {\n  if (!Array.isArray(items) || items.length === 0) throw new Error('items must not be empty');\n  for (const it of items) {\n    if (!(it.quantity > 0)) throw new Error('invalid item');\n    if (!(it.price >= 0)) throw new Error('invalid item');\n  }\n}";
      await c.eval(`(() => {
        const s = document.createElement('style'); s.textContent = ${JSON.stringify(TOK_CSS)}; document.head.appendChild(s);
        const el = [...document.querySelectorAll('.md-code')].find((x) => x.textContent.includes('function validateItems'));
        const code = el.querySelector('code') ?? el.querySelector('pre') ?? el;
        code.innerHTML = ${JSON.stringify(highlight(code))};
        el.classList.add('proto-new', 'proto-code');
      })()`);
    },
    marks: [
      { sel: '.proto-code', isNew: true, note: ['代码块', '—', '按语言着色：关键字、字符串、数字、函数名、注释；语言取自代码块标注，没有就按内容猜。差异卡片和文件预览同样着色。'] },
    ],
  },
  {
    id: 'P35', group: '提议', title: '工作树', status: 'new',
    summary: '全部会话页新增「工作树」：Code Agent 为会话建的 git 工作树，看状态、打开会话、删除。',
    frs: ['FR-WS-03'], snippet: WORKTREES,
    prepare: async (c) => {
      await c.go('/sessions');
      await c.sleep(800);
      await style(c);
      const s = c.summary(c.ids.child);
      const html = fill(WORKTREES, { title: s?.title ?? '对接下单错误码', path: s?.cwd ?? '', branch: s?.worktree ?? 'ca/对接下单错误码' });
      await c.eval(`(() => {
        const row = document.querySelector('.srow');
        const list = row.parentElement;
        const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(html)};
        list.replaceWith(t.content.firstElementChild);
      })()`);
    },
    marks: [
      { sel: '.proto-new .tabs', isNew: true, note: ['会话 / 工作树', '切换', '全部会话页多一个「工作树」分页。'] },
      { sel: '.proto-new .chip.mono', isNew: true, note: ['分支', '—', '工作树的分支和基准，比基准多几个提交。'] },
      { sel: '.proto-new .status.warn', isNew: true, note: ['改动', '—', '有没有未提交的改动，列出文件。'] },
      { sel: '.proto-new .btn.danger-outline', isNew: true, note: ['删除工作树', '点击', '先确认；有未提交的改动或没合并的提交时写明会丢什么。会话保留。'] },
    ],
  },
  {
    id: 'P15', group: '提议', title: '子代理', status: 'new',
    summary: '技能页新增「子代理」：用户级、项目级、插件里和内置的子代理，可以查看、新建、编辑。',
    frs: ['FR-AGT-01', 'FR-AGT-02'], snippet: AGENTS,
    prepare: async (c) => {
      await c.go(`/s/${c.ids.validate}`);
      await c.sleep(500);
      await c.go('/skills');
      await c.sleep(800);
      await style(c);
      await c.eval(`(() => {
        const tabs = document.querySelector('.tabs');
        tabs.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
        const b = tabs.querySelector('button').cloneNode(true);
        b.classList.add('on', 'proto-new', 'proto-agents');
        b.firstChild.textContent = '子代理';
        b.querySelector('.count').textContent = '4';
        tabs.appendChild(b);
        const layout = document.querySelector('.ext-layout');
        const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(AGENTS)};
        layout.replaceWith(t.content.firstElementChild);
      })()`);
    },
    marks: [
      { sel: '.proto-agents', isNew: true, note: ['「子代理」分页', '点击', '和技能、命令、插件并列。'] },
      { sel: '.proto-new .ext-item.on', isNew: true, note: ['子代理列表', '点击 / 开关', '按位置分组：所有工作区、这个工作区（随仓库）、插件、内置（只读）。'] },
      { sel: '.proto-new input.mono', isNew: true, note: ['编辑', '填写', '名称、什么时候用、可以用的工具、模型、说明；保存成 `.claude/agents/<名称>.md`。'] },
    ],
  },
  {
    id: 'P20b', group: '提议', title: '配置方案 — 补充项', status: 'changed',
    summary: '「默认」方案补上输出风格和计划模式补充说明；关掉「向你提问」时说明后果。',
    frs: ['FR-PROMPT-04', 'FR-PLAN-02', 'FR-ASK-05'], snippet: `${PROFILE_EXTRA}\n\n${ASK_HINT}`,
    prepare: async (c) => {
      await c.go('/settings/profiles');
      await c.sleep(700);
      await style(c);
      await c.eval(`(() => {
        const h = [...document.querySelectorAll('h3')].find((x) => x.textContent.startsWith('Claude 可以使用的工具'));
        const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(PROFILE_EXTRA)};
        h.closest('.form-section').before(t.content.firstElementChild);
        const item = [...document.querySelectorAll('.tool-item')].find((x) => x.textContent.includes('AskUserQuestion'));
        if (item) { item.classList.remove('on'); item.querySelector('.check, .ck')?.classList.remove('on'); const t2 = document.createElement('template'); t2.innerHTML = ${JSON.stringify(ASK_HINT)}; item.querySelector('.grow').appendChild(t2.content.firstElementChild); }
        (item ?? h).scrollIntoView({ block: 'end' });
        const sc = document.querySelector('.settings-main'); if (sc) sc.scrollTop += 24;
      })()`);
      await c.sleep(300);
    },
    marks: [
      { sel: '.proto-new label', text: '输出风格', isNew: true, note: ['输出风格', '下拉', 'Claude Code 的输出风格（内置和 `~/.claude/output-styles` 里的），改变回答的写法。'] },
      { sel: '.proto-new label', text: '计划模式补充说明', isNew: true, note: ['计划模式说明', '输入', '进入规划模式时追加给 Claude 的要求。'] },
      { sel: '.hint.proto-new', isNew: true, note: ['关掉提问工具的提示', '—', '取消勾选「向你提问」时，说明 Claude 会自己做决定。'] },
    ],
  },
  {
    id: 'P23b', group: '提议', title: '事件检查器 — 调试日志', status: 'changed',
    summary: '开了「保存调试日志」后，事件检查器多一个「调试日志」分类，显示这个会话日志的末尾。',
    frs: ['FR-OBS-02'], snippet: DEBUG_LOG,
    prepare: async (c) => {
      await open(c, c.ids.validate);
      await tab(c, '事件');
      await c.eval(`(() => {
        const body = document.querySelector('.ins-body');
        const btns = [...body.querySelectorAll('button')].filter((b) => /^(SDK 消息|stderr|钩子)/.test(b.textContent));
        btns.forEach((b) => b.classList.remove('on'));
        const b = btns[btns.length - 1].cloneNode(true);
        b.classList.add('on', 'proto-new', 'proto-log');
        b.textContent = '调试日志';
        btns[btns.length - 1].after(b);
        const bar = btns[0].parentElement;
        while (bar.nextSibling) bar.nextSibling.remove();
        const t = document.createElement('template'); t.innerHTML = ${JSON.stringify(DEBUG_LOG.replace('{short}', 'session-91ddaf43'))};
        bar.after(t.content.firstElementChild);
      })()`);
    },
    marks: [
      { sel: '.proto-log', isNew: true, note: ['「调试日志」分类', '点击', '和 SDK 消息、stderr、钩子并列；没开调试日志时不出现。'] },
      { sel: '.ins-body pre', isNew: true, note: ['日志末尾', '滚动', '这个会话 Claude Code 调试日志的最后部分，自动跟随；可以复制文件路径用编辑器打开。'] },
    ],
  },
];
