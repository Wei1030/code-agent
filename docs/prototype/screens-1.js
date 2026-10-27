/* Screens P01–P08: overview, home, new session, live session and its docked panels. */
(function () {
  'use strict';
  const K = window.K;
  const { C, t, rect, line, path, circle, box, arrow, btn, chip, status, input, select, textarea, toggle, check,
    radio, panel, hline, vline, mk, code, diff, overlay, tabs, seg, progress, kbd, para, ic, tw, kv, runs, L } = K;

  // ------------------------------------------------------------------ P01
  window.SCREENS.push({
    id: 'P01',
    group: 'Overview',
    title: 'Architecture and navigation map',
    summary: 'How the pieces fit: the browser talks only to the local Node server; the server runs one SDK `query()` per live session, each backed by a Claude Code process. Below, the navigation map shows every screen in this prototype and where it lives.',
    frs: ['§4.1 Architecture', '§7 Information architecture', 'NFR-02', 'NFR-04'],
    draw() {
      let s = rect(0, 0, 1440, 900, { fill: C.page });
      s += t(40, 46, 'Runtime architecture', { s: 18, w: 700 });

      // Browser
      s += rect(40, 66, 330, 330, { r: 12, fill: C.surface, stroke: C.border });
      s += t(60, 94, 'Browser · single-page app', { s: 14, w: 700 });
      s += box(60, 112, 290, 56, 'Views', 'screens rendered from SDK events');
      s += box(60, 180, 290, 56, 'Session stores', 'one store per live session');
      s += box(60, 248, 290, 56, 'WebSocket client', 'commands out · events in, with seq');
      s += rect(60, 318, 290, 58, { r: 8, fill: C.surface2, stroke: C.border, dash: '4 3' });
      s += t(205, 342, 'No SDK, no credentials', { s: 12.5, w: 600, a: 'middle', c: C.ink2 });
      s += t(205, 360, 'everything goes through the server', { s: 11, a: 'middle', c: C.muted });

      // Server
      s += rect(450, 66, 560, 330, { r: 12, fill: C.surface, stroke: C.border });
      s += t(470, 94, 'Node.js server · 127.0.0.1 + access token', { s: 14, w: 700 });
      s += box(470, 112, 160, 70, 'REST API', ['history · registries', 'settings · usage']);
      s += box(470, 194, 160, 70, 'WebSocket hub', ['fan-out to tabs', 'replay from seq']);
      s += box(470, 276, 160, 100, 'Registries', ['profiles · MCP', 'agents · hooks · jobs', 'cost ledger · secrets']);
      s += rect(650, 112, 340, 264, { r: 10, fill: C.accentSoft, stroke: C.accentLine });
      s += t(666, 134, 'SessionManager → LiveSession × N', { s: 13, w: 700, c: C.accent });
      s += box(666, 148, 150, 52, 'Query', 'query() handle');
      s += box(826, 148, 150, 52, 'Input queue', 'AsyncIterable input');
      s += box(666, 210, 150, 52, 'Pending requests', 'approvals · questions');
      s += box(826, 210, 150, 52, 'Event buffer', 'ring buffer, seq');
      s += box(666, 272, 310, 52, 'Callbacks', 'canUseTool · hooks · onElicitation · app tools');
      s += t(666, 346, 'Controls: interrupt · setModel · setPermissionMode', { s: 11, c: C.ink2 });
      s += t(666, 362, 'applyFlagSettings · rewindFiles · stopTask · close', { s: 11, c: C.ink2 });

      // Claude Code side
      s += box(1090, 66, 310, 104, 'Claude Code process × N', ['bundled binary, one per live session', 'agent loop · built-in tools · MCP clients'], { fill: C.surface, sw: 1.5 });
      s += box(1090, 192, 310, 52, 'Model provider', 'Anthropic API · Bedrock · Vertex · Foundry');
      s += box(1090, 258, 310, 52, 'MCP servers', 'stdio · HTTP · SSE (+ in-process via SDK)');
      s += box(1090, 336, 150, 60, '~/.claude', ['transcripts · settings', 'CLAUDE.md · skills'], { fill: C.surface2 });
      s += box(1250, 336, 150, 60, '~/.code-agent', ['SQLite · profiles', 'secrets · ledger'], { fill: C.surface2 });

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

      // Navigation map
      s += t(40, 452, 'Navigation map', { s: 18, w: 700 });
      s += box(560, 468, 320, 46, 'App shell', 'top bar · nav rail · approvals inbox', { fill: C.ink, ink: '#fff', stroke: C.ink, subInk: '#c3c8d2' });
      const nav = [
        ['Sessions', ['P02 Home', 'P03 New session', 'P04 Live session', 'P12 History & fork']],
        ['Agents', ['P15 Agents']],
        ['MCP', ['P13 MCP servers', 'P14 Elicitation']],
        ['Skills', ['P16 Skills & plugins']],
        ['Hooks', ['P17 Hooks']],
        ['Jobs', ['P18 Structured jobs']],
        ['Usage', ['P19 Usage']],
        ['Settings', ['P20 Profiles', 'P21 Rules & sandbox', 'P22 Provider & env']],
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
      s += t(50, 677.5, 'P04 Live session', { s: 12, w: 600, c: C.accent });
      s += path('M119 718 V748', { c: C.accent, sw: 1.4, arrow: true });
      s += rect(40, 752, 1348, 120, { r: 10, fill: C.surface, stroke: C.accentLine, dash: '5 4' });
      s += t(60, 778, 'Inside a live session (P04): docked panels and inspector tabs', { s: 13, w: 700, c: C.accent });
      const docked = ['P05 Composer, palette & queue', 'P06 Tool approval', 'P07 Clarifying questions', 'P08 Plan review', 'P09 Subagents & background',
        'P10 Checkpoints & rewind', 'P11 Context & cost', 'P14 MCP elicitation', 'P23 Event inspector', 'P24 Session states'];
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
      ['Browser app', 'Renders every screen from normalized SDK events. Keeps one store per live session and reconnects automatically, replaying events after the last sequence number it saw.', 'None directly — the browser never imports the SDK and never sees an API key (NFR-04).'],
      ['Node server', 'One local process bound to 127.0.0.1, protected by an access token shown at first start. REST serves history and registries; the WebSocket carries live session events and commands.', '`listSessions`, `getSessionMessages`, `forkSession`, `renameSession`, `tagSession`, `deleteSession`, `resolveSettings` behind REST.'],
      ['LiveSession', 'One per running session. Owns the `Query`, an input queue that feeds streaming input, the pending approvals / questions / elicitations keyed by `requestId`, and a ring buffer of events for replay.', '`query({ prompt: AsyncIterable<SDKUserMessage>, options })`, `canUseTool`, `hooks`, `onElicitation`, `interrupt()`, `setModel()`, `setPermissionMode()`…'],
      ['Claude Code process', 'The SDK spawns the bundled binary per live session (~250 MB each), so the server caps live sessions and can close idle ones; they resume on demand.', '`pathToClaudeCodeExecutable`, `startup()`, `prewarm()`, `spawnClaudeCodeProcess`, `close()`'],
      ['Data locations', 'SDK-owned data (transcripts, settings files, CLAUDE.md, skills) stays where Claude Code keeps it. Code Agent stores only its own data in ~/.code-agent.', '`persistSession`; optional `sessionStore` mirror (FR-SES-16)'],
      ['App shell', 'The nav rail sections map one-to-one to the boxes below. The top bar holds the workspace switcher, Ctrl K search, warm-pool status, the approvals inbox and the account menu.', '—'],
      ['Live session panels', 'These appear inside P04 when the SDK asks for something (approval, question, plan, elicitation) or when the user opens an inspector tab.', '`canUseTool` (incl. `AskUserQuestion`, `ExitPlanMode`), `onElicitation`, inspector queries'],
    ],
  });

  // ------------------------------------------------------------------ P02
  window.SCREENS.push({
    id: 'P02',
    group: 'Sessions',
    title: 'Home — workspaces',
    summary: 'Landing page. Workspaces are folders the agent works in; each card shows its sessions and live activity. Recent sessions span all workspaces. The right column surfaces anything waiting for the user, the account, and the warm pool.',
    frs: ['FR-WS-01', 'FR-WS-05', 'FR-SES-05', 'FR-SES-07', 'FR-SES-04', 'FR-AUTH-02', 'FR-PERM-06'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 2 });
      s += t(96, 100, 'Workspaces', { s: 22, w: 700 });
      s += t(96, 124, 'Pick a folder to work in. Sessions are grouped by workspace.', { s: 13, c: C.ink2 });
      s += btn(800, 86, 'Open folder…', { icon: 'folder', w: 130 });
      s += btn(940, 86, 'New session', { v: 'primary', icon: 'plus', w: 120 });

      const ws = [
        ['shop-api', 'D:\\src\\shop-api', 'main', 24, 2, '2 min ago', true],
        ['shop-web', 'D:\\src\\shop-web', 'feat/checkout', 9, 1, '14 min ago', false],
        ['infra', 'D:\\src\\infra', 'main', 5, 0, 'Yesterday', false],
        ['notes', 'D:\\notes', null, 12, 0, 'Yesterday', false],
        ['data-pipeline', 'D:\\work\\data-pipeline', 'dev', 3, 0, 'Mon', false],
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
        if (branch) {
          s += chip(cx, y + 66, branch, { icon: 'branch' });
          cx += chip.w(branch, { icon: 1 }) + 6;
        } else {
          s += chip(cx, y + 66, 'not a git repo');
          cx += chip.w('not a git repo') + 6;
        }
        s += chip(cx, y + 66, `${n} sessions`);
        cx += chip.w(`${n} sessions`) + 6;
        if (live) s += chip(cx, y + 66, i === 0 ? '2 live · 1 needs you' : `${live} live`, { dot: i === 0 ? C.warn : C.accent, bg: i === 0 ? C.warnSoft : C.accentSoft, c: i === 0 ? C.warnInk : C.accent });
        s += t(x + 16, y + 131, `Active ${when}`, { s: 12, c: C.muted });
        s += btn(x + 128, y + 112, 'Continue', { h: 28, s: 12, w: 76 });
        s += btn(x + 210, y + 112, 'New session', { v: 'soft', h: 28, s: 12, w: 86 });
      });
      // add card
      s += rect(750, 318, 310, 154, { r: 10, fill: 'none', stroke: C.borderStrong, dash: '6 4' });
      s += ic('plus', 893, 366, 24, C.ink2);
      s += t(905, 412, 'Add workspace', { s: 13, w: 600, c: C.ink2, a: 'middle' });
      s += t(905, 430, 'or drop a folder path here', { s: 12, c: C.muted, a: 'middle' });

      // recent sessions
      s += t(96, 516, 'Recent sessions', { s: 16, w: 700 });
      s += t(232, 516, 'across all workspaces', { s: 12, c: C.muted });
      s += t(1060, 516, 'View all →', { s: 12.5, w: 500, c: C.accent, a: 'end' });
      s += rect(96, 530, 964, 352, { r: 10, fill: C.surface, stroke: C.border });
      const cols = [[112, 'TITLE'], [470, 'WORKSPACE'], [600, 'STATE'], [760, 'LAST ACTIVE'], [870, 'TAG'], [1040, 'COST']];
      cols.forEach(([x, h], i) => (s += t(x, 552, h, { s: 10.5, w: 600, c: C.muted, ls: 0.4, a: i === 5 ? 'end' : undefined })));
      s += hline(96, 562, 964);
      const rows = [
        ['Fix flaky checkout tests', 'shop-api', 'req', '2 min ago', 'ci', '$0.42'],
        ['Refactor auth middleware', 'shop-api', 'run', 'now', null, '$1.08'],
        ['Docs: API reference', 'shop-web', 'idle', '14 min ago', 'docs', '$0.31'],
        ['Add rate limiting to /orders', 'shop-api', 'saved', '2 h ago', 'perf', '$2.40'],
        ['Investigate memory leak', 'infra', 'saved', 'Yesterday', null, '$3.12'],
        ['Weekly notes digest', 'notes', 'saved', 'Yesterday', 'job', '$0.08'],
        ['Migrate to Postgres 17', 'data-pipeline', 'saved', 'Mon', 'db', '$5.77'],
      ];
      rows.forEach(([title, w, st, when, tag, cost], i) => {
        const y = 563 + i * 45;
        if (i === 3) s += rect(97, y, 962, 45, { fill: C.surface2 });
        s += t(112, y + 28, title, { s: 13, w: 500 });
        s += t(470, y + 28, w, { s: 12.5, c: C.ink2 });
        if (st === 'req') s += status(600, y + 13, 'warn', 'Needs approval');
        else if (st === 'run') s += status(600, y + 13, 'info', 'Running');
        else if (st === 'idle') s += status(600, y + 13, 'idle', 'Idle · live');
        else s += t(600, y + 28, 'Saved', { s: 12.5, c: C.muted });
        s += t(760, y + 28, when, { s: 12.5, c: C.ink2 });
        if (tag) s += chip(870, y + 14, tag, { icon: 'tag' });
        if (i === 3) {
          s += btn(930, y + 9, 'Resume', { h: 27, s: 12, w: 64 });
          s += btn(998, y + 9, '', { h: 27, icon: 'branch', w: 28 });
          s += btn(1030, y + 9, '', { h: 27, icon: 'dots', w: 28 });
        } else s += t(1040, y + 28, cost, { s: 12.5, a: 'end' });
        if (i < rows.length - 1) s += hline(112, y + 45, 932, '#eef0f4');
      });

      // right column
      const rx = 1090;
      s += panel(rx, 86, 320, 146, { title: 'Provider & account' });
      s += kv(rx + 14, 146, 'Provider', 'Anthropic API', { kw: 104 });
      s += kv(rx + 14, 168, 'Key source', 'ANTHROPIC_API_KEY', { kw: 104, m: true });
      s += kv(rx + 14, 190, 'Organization', 'Personal', { kw: 104 });
      s += status(rx + 14, 202, 'good', 'Connected');
      s += t(rx + 306, 216, 'Settings →', { s: 12, c: C.accent, a: 'end' });

      s += panel(rx, 246, 320, 132, { title: 'Warm pool' });
      s += toggle(rx + 14, 298, true, 'Keep 1 process ready');
      s += kv(rx + 14, 340, 'Profile', 'Default', { kw: 70 });
      s += status(rx + 14, 350, 'good', 'Ready · 238 MB');
      s += t(rx + 306, 364, '0.4 s to first request', { s: 11.5, c: C.muted, a: 'end' });

      s += panel(rx, 392, 320, 200, { title: 'Needs your input', sub: '2' });
      s += rect(rx + 12, 442, 296, 66, { r: 8, fill: C.warnSoft });
      s += ic('shield', rx + 22, 452, 16, C.warnInk);
      s += t(rx + 46, 465, 'Fix flaky checkout tests', { s: 13, w: 600 });
      s += t(rx + 46, 484, 'Bash · rm -rf …/.cache', { s: 11.5, c: C.ink2, m: true });
      s += t(rx + 46, 500, 'waiting 0:12', { s: 11, c: C.warnInk });
      s += btn(rx + 236, 460, 'Review', { h: 28, s: 12, w: 64 });
      s += rect(rx + 12, 516, 296, 62, { r: 8, fill: C.surface2 });
      s += ic('chat', rx + 22, 526, 16, C.ink2);
      s += t(rx + 46, 539, 'Docs: API reference', { s: 13, w: 600 });
      s += t(rx + 46, 558, '2 questions from Claude', { s: 11.5, c: C.ink2 });
      s += btn(rx + 236, 532, 'Answer', { h: 28, s: 12, w: 64 });

      s += panel(rx, 606, 320, 150, { title: 'Default profile' });
      s += kv(rx + 14, 666, 'Model', 'Opus 5.5 · effort high', { kw: 90 });
      s += kv(rx + 14, 688, 'Mode', 'Ask before edits', { kw: 90 });
      s += kv(rx + 14, 710, 'Limits', '50 turns · $5.00', { kw: 90 });
      s += kv(rx + 14, 732, 'Checkpoints', 'On', { kw: 90 });
      s += t(rx + 306, 626, 'Edit →', { s: 12, c: C.accent, a: 'end' });

      s += panel(rx, 770, 320, 112, { title: 'This month' });
      s += t(rx + 14, 840, '$48.20', { s: 26, w: 700 });
      s += t(rx + 14, 864, 'spend · 126 sessions', { s: 12, c: C.muted });
      s += t(rx + 306, 864, 'Usage →', { s: 12, c: C.accent, a: 'end' });

      s += mk(800, 84, 1) + mk(1060, 84, 2) + mk(222, 258, 3) + mk(390, 214, 4) + mk(1052, 324, 5) + mk(926, 698, 6);
      s += mk(1408, 90, 7) + mk(1408, 250, 8) + mk(1408, 396, 9) + mk(1408, 610, 10);
      return s;
    },
    notes: [
      ['Open folder…', 'Opens a folder browser served by the Node server (a web page cannot read local paths). Pinned and recent folders come first. Choosing a folder adds a workspace card.', 'Server `GET /api/fs/browse`; the folder becomes `Options.cwd` (FR-WS-01)'],
      ['New session', 'Opens P03 with the current workspace and the default profile preselected. Also Ctrl N from anywhere.', '→ P03'],
      ['Card actions', '"New session" opens P03 for that folder. "Continue" resumes the most recent session in the folder without picking one; disabled when the folder has none.', '`query({ options: { cwd, continue: true } })` (FR-SES-07)'],
      ['Session count and live badge', 'Counts come from the folder\'s session list (worktrees included). The live badge counts sessions with a running process and turns amber when one needs input; clicking it opens that session.', '`listSessions({ dir, includeWorktrees: true })`, `session_state_changed`'],
      ['Add workspace', 'Same as Open folder; also accepts a pasted path. Card menu: pin, rename (display only), remove (sessions stay on disk).', 'App data only'],
      ['Recent sessions row', 'Click opens the session: live ones attach, saved ones open read-only with a Resume bar. Hover reveals Resume, Fork and a menu (rename, tag, export, delete).', '`getSessionMessages`, `resume`, `forkSession`, `renameSession`, `tagSession`, `deleteSession`'],
      ['Provider & account', 'Shows how sessions authenticate. Turns red with the SDK reason when a session failed to start for auth reasons. "Settings →" opens P22.', '`accountInfo()`, init `apiKeySource`, `auth_status`, `startup_failure_reason`'],
      ['Warm pool', 'Keeps one initialized Claude Code process per selected profile so a new session answers at once. Shows memory held; switching it off frees the process.', '`prewarm()` + `SpareProcess.claim()`; `startup()` when the folder is known (FR-SES-04)'],
      ['Needs your input', 'Every pending approval, question, plan review or MCP elicitation across live sessions, oldest first. Review / Answer opens the session with the request focused.', 'Pending `canUseTool` requests, `requires_action` (FR-PERM-06)'],
      ['Default profile', 'Summary of what new sessions use. Edit opens the profile in P20.', 'Profile → `Options`'],
    ],
  });

  // ------------------------------------------------------------------ P03
  window.SCREENS.push({
    id: 'P03',
    group: 'Sessions',
    title: 'New session dialog',
    summary: 'Starts a live session. A profile fills every field; anything changed here is a one-off override. The dialog covers the options a user commonly changes per session; everything else sits under "Advanced overrides".',
    frs: ['FR-SES-01..04', 'FR-WS-01/02', 'FR-MOD-01/03/04', 'FR-PERM-01/02', 'FR-COST-01', 'FR-CKPT-01', 'FR-CFG-01'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 2 });
      s += t(96, 100, 'Workspaces', { s: 22, w: 700 });
      for (let i = 0; i < 3; i++) s += rect(96 + i * 327, 148, 310, 154, { r: 10, fill: C.surface, stroke: C.border });
      s += overlay();
      const x = 330;
      const y = 66;
      s += rect(x, y, 780, 806, { r: 12, fill: C.surface, shadow: true });
      s += t(x + 24, y + 38, 'New session', { s: 18, w: 700 });
      s += ic('x', x + 744, y + 22, 18, C.ink2);
      s += hline(x, y + 58, 780);
      const X = x + 24;

      s += select(X, y + 94, 540, 'D:\\src\\shop-api', { label: 'Workspace', icon: 'folder' });
      s += btn(X + 552, y + 94, 'Add directory', { icon: 'plus', h: 32, w: 180 });
      s += chip(X, y + 136, 'D:\\src\\shared-lib', { icon: 'folder', h: 22, m: true });
      s += ic('x', X + chip.w('D:\\src\\shared-lib', { icon: 1 }) + 4, y + 140, 14, C.muted);
      s += t(X + 200, y + 151, 'extra access · its .claude skills and agents load too', { s: 11.5, c: C.muted });

      s += select(X, y + 194, 300, 'Default', { label: 'Profile', icon: 'layers' });
      s += circle(X + 268, y + 210, 4, { fill: C.warn });
      s += t(X + 312, y + 215, 'Edit', { s: 12.5, c: C.accent });
      s += input(X + 360, y + 194, 372, { label: 'Title (optional)', ph: 'Claude names the session otherwise' });

      s += select(X, y + 270, 220, 'Opus 5.5', { label: 'Model', icon: 'cpu' });
      s += t(X, y + 318, 'adaptive thinking · fast mode · auto mode', { s: 11, c: C.muted });
      s += t(X + 236, y + 263, 'Effort', { s: 12, w: 500, c: C.ink2 });
      s += seg(X + 236, y + 270, ['low', 'medium', 'high', 'xhigh', 'max'], 2, { h: 32 });
      s += select(X + 532, y + 270, 200, 'Adaptive · summarized', { label: 'Thinking' });

      s += t(X, y + 360, 'Permission mode', { s: 12, w: 500, c: C.ink2 });
      const modes = [
        ['shield', 'Ask before edits', 'Prompt for anything not allowed', true],
        ['pencil', 'Accept edits', 'File edits run without asking'],
        ['list', 'Plan', 'Explore and plan, no edits'],
        ['spark', 'Auto', 'A classifier reviews actions'],
        ['lock', "Don't ask", 'Deny anything not pre-approved'],
        ['warning', 'Bypass', 'Everything runs · needs confirm', false, true],
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

      s += input(X, y + 524, 150, { label: 'Max turns', val: '50' });
      s += input(X + 166, y + 524, 150, { label: 'Max budget (USD)', val: '5.00', right: 'USD' });
      s += t(X + 334, y + 545, 'Empty = no limit. Budget is a client-side estimate; keep headroom.', { s: 11.5, c: C.muted });

      s += toggle(X, y + 580, true, 'File checkpointing', { hint: 'rewind edits later' });
      s += toggle(X + 290, y + 580, false, 'Ephemeral', { hint: 'never saved' });
      s += toggle(X + 500, y + 580, true, 'Prompt suggestions');

      s += textarea(X, y + 638, 732, 76, ['Fix the flaky checkout tests. CI log attached.'], { label: 'First message (optional)' });
      s += chip(X + 10, y + 680, 'ci-log.png', { icon: 'image', h: 22 });
      s += btn(X + 662, y + 680, '', { v: 'ghost', icon: 'clip', w: 30, h: 26 });
      s += btn(X + 694, y + 680, '', { v: 'ghost', icon: 'image', w: 30, h: 26 });

      s += ic('chevRight', X, y + 728, 16, C.ink2);
      s += t(X + 20, y + 741, 'Advanced overrides', { s: 13, w: 600 });
      s += t(X + 160, y + 741, 'system prompt · setting sources · tools · MCP · agents · skills · hooks · sandbox · env', { s: 12, c: C.muted });
      s += hline(x, y + 758, 780);
      s += t(X, y + 787, 'Ctrl Enter to start', { s: 12, c: C.muted });
      s += btn(x + 556, y + 768, 'Cancel', { w: 80 });
      s += btn(x + 646, y + 768, 'Start session', { v: 'primary', w: 110 });

      s += mk(X - 12, y + 86, 1) + mk(X - 12, y + 186, 2) + mk(X - 12, y + 262, 3) + mk(X - 12, y + 354, 4) + mk(X + 734, y + 442, 5);
      s += mk(X - 12, y + 516, 6) + mk(X - 12, y + 588, 7) + mk(X - 12, y + 630, 8) + mk(X - 12, y + 734, 9) + mk(x + 760, y + 768, 10);
      return s;
    },
    notes: [
      ['Workspace and directories', 'Defaults to the workspace the dialog was opened from. "Add directory" grants access to another folder; with project settings on, its skills, commands and agents load as well. Chips can be removed.', '`cwd`, `additionalDirectories` (FR-WS-01/02)'],
      ['Profile and title', 'Choosing a profile fills every field. Changing a field here marks the profile select with an amber "overridden" dot; overrides apply to this session only. Title is optional.', 'Profile → `Options`; `title` (FR-CFG-01, FR-SES-02)'],
      ['Model, effort, thinking', 'Models come from the warm process (or the last cached list); the caption lists the selected model\'s capabilities. Effort levels the model does not support are disabled.', '`supportedModels()` → `ModelInfo`; `effort`; `thinking` (FR-MOD-01/03/04)'],
      ['Permission mode', 'Single choice, each tile states its effect in plain words. "Auto" is hidden when the model lacks auto-mode support.', '`permissionMode` (FR-PERM-01)'],
      ['Bypass', 'Selecting it opens a confirmation: every tool runs without approval; deny rules and hooks still apply. Disabled (with a link) unless the profile enables "allow dangerous skip".', '`allowDangerouslySkipPermissions` (FR-PERM-02)'],
      ['Limits', 'Reaching a limit ends the turn with a banner and a "continue with a higher limit" action (P24).', '`maxTurns`, `maxBudgetUsd` (FR-COST-01)'],
      ['Session toggles', 'Checkpointing makes every message a rewind point (P10). Ephemeral sessions are never written to disk and cannot be resumed. Prompt suggestions show a predicted next prompt.', '`enableFileCheckpointing` + `replay-user-messages`; `persistSession: false`; `promptSuggestions`'],
      ['First message', 'Optional; supports images, @ mentions and / commands like the composer. Empty starts an idle live session.', 'First `SDKUserMessage` on the input queue'],
      ['Advanced overrides', 'Expands the profile editor sections (P20) for this session only.', 'Remaining `Options`'],
      ['Start session', 'Claims a warm process when one matches, otherwise starts one; opens P04 and sends the first message. Start-up errors show inline with the SDK reason (e.g. folder missing).', '`query()` / `SpareProcess.claim()`; `startup_failure_reason`'],
    ],
  });

  // ------------------------------------------------------------------ P04
  window.SCREENS.push({
    id: 'P04',
    group: 'Live session',
    title: 'Live session — streaming transcript',
    summary: 'The main working view: live sessions on the left, the transcript in the middle with streaming text, thinking and one card per tool call, and the inspector on the right (here: the agent\'s task list).',
    frs: ['FR-SES-12/13/17', 'FR-OUT-01..06', 'FR-TOOL-01..05', 'FR-TODO-01', 'FR-PERM-01', 'FR-CTX-01', 'FR-COST-02'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += K.sessionColumn({ active: 0, live: [
        ['Fix flaky checkout tests', 'running', 'shop-api'],
        ['Refactor auth middleware', 'requires_action', 'shop-api'],
        ['Docs: API reference', 'idle', 'shop-web'],
      ] });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'running' });
      const X = L.TX;
      const W = L.TW;
      s += rect(X, 118, W, 26, { r: 6, fill: C.surface2 });
      s += t(X + 12, 135, 'Turn 1 · 1m 12s · 14 tool calls · $0.21 · stop: end_turn', { s: 11.5, c: C.muted });
      s += ic('chevDown', X + W - 26, 123, 16, C.muted);

      s += K.userMsg(X, 156, W, 'The checkout tests fail randomly on CI. Find the cause and fix it — the CI log is attached.', { attach: 'ci-log.png · 182 KB' });
      s += K.thinking(X, 268, W, { dur: '6s', preview: 'The log shows a timeout in cart.timer — likely a timer leaking across tests…' });
      s += t(X, 326, "I'll check the checkout suite and the timer utilities first.", { s: 14 });
      s += rect(X, 340, W, 30, { r: 6, fill: C.surface, stroke: C.border });
      s += ic('list', X + 10, 347, 16, C.ink2);
      s += t(X + 34, 359.5, 'Read 4 files · searched 2 patterns · 1.8 s', { s: 12.5, c: C.ink2 });
      s += ic('chevRight', X + W - 26, 347, 16, C.muted);

      s += K.toolCard(X, 382, W, {
        icon: 'pencil', name: 'Edit', detail: 'src/cart/timer.ts', right: '+2 −1', st: 'ok', prov: 'Approved by you', bodyH: 112,
        body: K.diff(X + 12, 428, W - 24, [
          '@@ -41,6 +41,7 @@ export function startTimer(cart: Cart) {',
          '   const ttl = cart.ttlMs ?? DEFAULT_TTL;',
          '-  const id = setTimeout(() => expire(cart), ttl);',
          '+  const id = timers.setTimeout(() => expire(cart), ttl);',
          '+  cart.onDispose(() => timers.clearTimeout(id));',
        ]),
      });
      s += K.toolCard(X, 544, W, {
        icon: 'terminal', name: 'Bash', detail: 'npm test -- checkout --randomize', right: '12.4 s', st: 'ok', prov: 'Rule Bash(npm test *)', bodyH: 84,
        body: code(X + 12, 590, W - 24, [
          [['PASS', C.goodInk, 700], ['  tests/checkout/cart.test.ts (8.2 s)']],
          [['PASS', C.goodInk, 700], ['  tests/checkout/timer.test.ts (2.1 s)']],
          'Tests: 41 passed, 41 total · ran 20× in random order',
        ]),
      });
      s += t(X, 700, 'Two tests shared a module-level timer that was never cleared, so a later test saw a stale', { s: 14 });
      s += t(X, 722, 'expiry. The timer now uses the injected clock and is disposed with the cart. The suite', { s: 14 });
      s += rect(X + tw('expiry. The timer now uses the injected clock and is disposed with the cart. The suite', 14) + 3, 710, 8, 16, { fill: C.accent });
      s += K.composer(X, 776, W, { running: true, h: 108 });

      // inspector: tasks
      s += K.inspector(0);
      const IX = L.IX + 16;
      s += t(IX, 152, 'Task list', { s: 13, w: 600 });
      s += t(L.IX + L.IW - 16, 152, '1 of 4 done', { s: 12, c: C.muted, a: 'end' });
      s += progress(IX, 162, 307, 25);
      const tasks = [
        ['done', 'Reproduce the failure locally'],
        ['doing', 'Identify the race in the cart timer', 'Identifying the race in the cart timer…'],
        ['todo', 'Fix and add a regression test', 'blocked by #2'],
        ['todo', 'Run the checkout suite 20×'],
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
      s += t(IX, 410, 'Session', { s: 13, w: 600 });
      const info = [
        ['Model', 'claude-opus-5-5'], ['Mode', 'default'], ['Workspace', 'D:\\src\\shop-api'], ['Claude Code', '2.1.302'],
        ['Tools', '23 built-in · 41 MCP'], ['MCP', 'github ●  postgres ●'], ['Skills', '6 · plugins 1'],
      ];
      info.forEach(([k, v], i) => (s += kv(IX, 436 + i * 22, k, v, { kw: 92 })));
      s += t(IX, 600, 'Session info and events →', { s: 12, c: C.accent });
      s += hline(L.IX, 620, L.IW);
      s += t(IX, 646, 'Background', { s: 13, w: 600 });
      s += chip(IX + 84, 633, '1 running', { h: 18, bg: C.accentSoft, c: C.accent });
      s += rect(IX, 658, 307, 52, { r: 8, fill: C.surface2, stroke: C.border });
      s += ic('terminal', IX + 10, 668, 16, C.ink2);
      s += t(IX + 34, 680, 'npm run e2e', { s: 12.5, m: true });
      s += t(IX + 34, 698, 'running · 3m 12s', { s: 11.5, c: C.muted });
      s += btn(IX + 245, 668, 'Stop', { h: 26, s: 12, w: 52 });

      s += mk(78, 136, 1) + mk(544, 62, 2) + mk(L.TX + L.TW - 6, 160, 3) + mk(L.TX - 13, 284, 4) + mk(L.TX - 13, 355, 5);
      s += mk(L.TX - 13, 400, 6) + mk(L.TX - 13, 562, 7) + mk(L.TX - 13, 696, 8) + mk(L.IX + 92, 71, 9) + mk(L.TX - 13, 794, 10);
      return s;
    },
    notes: [
      ['Live sessions', 'Every running session with its state: blue ring = running, amber = needs input, grey = idle. Clicking switches the middle and right columns; the process keeps running in the background. Alt ↑/↓ switches.', '`session_state_changed` (FR-SES-12/13)'],
      ['Session header', 'Title (click to rename) and state. Controls: model + effort menu (switches mid-turn), permission mode menu (Shift Tab cycles), context meter (opens P11), cost against the budget cap, and Stop (ends the process after confirmation).', '`setModel()`, `applyFlagSettings({ effortLevel })`, `setPermissionMode()`, `getContextUsage()`, `total_cost_usd`, `close()`'],
      ['User message', 'Shows text, image thumbnails and pasted-content chips. Hover reveals "Rewind" and "Branch" (P10).', '`SDKUserMessage` (uuid = checkpoint)'],
      ['Thinking', 'Collapsed by default with a one-line preview and duration; expands to the streamed (summarized) thinking text.', '`thinking` blocks, `thinking.display: "summarized"`'],
      ['Tool summary', 'Consecutive read-only calls collapse into one line; expanding shows each call as a compact card.', '`tool_use_summary` message'],
      ['Edit card', 'File path, +/− counts and a diff of the change; click the path to open the full file; split / unified toggle in the card menu. The shield chip says why the call ran (rule, mode, or the user\'s approval).', '`Edit` input/output, `permission` decision source'],
      ['Bash card', 'Command, live output while running (then the tail), exit status and duration. While running it also offers "Send to background" (P09).', '`Bash` input, `tool_progress`, `tool_use_result`'],
      ['Streaming text', 'Text renders token by token with a caret; Markdown and code blocks format as they complete. A cut-off message keeps an "interrupted" marker.', '`includePartialMessages`, `stream_event` deltas, `aborted`'],
      ['Inspector: Tasks', 'The agent\'s own task list, updated live: done, in progress (with its active wording), pending, and dependencies. Below: session facts and running background work.', '`TaskCreate` / `TaskUpdate` / `TodoWrite`, init message, `task_*` messages'],
      ['Composer while running', 'Typing while the agent works queues the message (P05); Interrupt (or Esc on an empty composer) stops the turn.', '`priority`, `interrupt()`'],
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
    group: 'Live session',
    title: 'Composer — commands, mentions, attachments and the queue',
    summary: 'Close-ups of the composer in four situations: (A) the slash command palette, (B) mentions, images and pasted text, (C) sending while the agent is still working, (D) smaller states — prompt suggestions, the interrupt receipt and the send options menu.',
    frs: ['FR-IN-01..10', 'FR-SKILL-04'],
    draw() {
      let s = rect(0, 0, 1440, 900, { fill: C.page });
      const cols = [30, 500, 970];
      const caps = ['A · Slash command palette', 'B · Mentions, images and pastes', 'C · Sending while Claude works'];
      cols.forEach((x, i) => {
        s += t(x, 50, caps[i], { s: 15, w: 700 });
        s += rect(x, 66, 440, 560, { r: 12, fill: C.page, stroke: C.border });
        s += ghostLines(x + 20, 86, 400, 4);
      });

      // A — palette
      let x = 30;
      s += miniComposer(x + 16, 498, 408, 112, { focus: true });
      s += t(x + 32, 526, '/co', { s: 14, m: true });
      s += line(x + 32 + tw('/co', 14, true) + 2, 513, x + 32 + tw('/co', 14, true) + 2, 531, { c: C.ink, sw: 1.3 });
      s += btn(x + 344, 572, 'Send', { v: 'primary', icon: 'send', w: 72 });
      s += rect(x + 16, 186, 408, 302, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      s += t(x + 30, 210, 'Commands', { s: 12, w: 600, c: C.muted });
      s += t(x + 410, 210, '5 match “co”', { s: 11.5, c: C.muted, a: 'end' });
      const cmds = [
        ['slash', '/compact', 'Summarize history', 'built-in', true],
        ['slash', '/context', 'Show context usage', 'built-in'],
        ['spark', '/code-review', '[low|medium|high]', 'skill · bundled'],
        ['box', '/commit', 'Commit staged changes', 'plugin · git-tools'],
        ['file', '/cost-report', 'Weekly spend summary', 'project'],
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
      s += t(x + 30, 450, '↑↓ move · Tab complete · Enter run', { s: 11.5, c: C.muted });
      s += t(x + 30, 468, 'Arguments are typed after the name.', { s: 11.5, c: C.muted });

      // B — mentions / attachments
      x = 500;
      s += rect(x + 16, 96, 408, 104, { r: 10, fill: C.accentSoft, stroke: C.accent, dash: '6 4' });
      s += ic('upload', x + 196, 112, 24, C.accent);
      s += t(x + 220, 160, 'Drop images or files to attach', { s: 13, w: 600, c: C.accent, a: 'middle' });
      s += t(x + 220, 178, 'drag-over state', { s: 11, c: C.accent, a: 'middle' });
      s += rect(x + 16, 214, 408, 228, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      s += t(x + 30, 238, 'Files and resources', { s: 12, w: 600, c: C.muted });
      const ments = [
        ['file', 'src/cart/timer.ts', 'edited this session', true],
        ['file', 'src/cart/timer.test.ts', ''],
        ['file', 'src/cart/types.ts', ''],
        ['plug', 'github:issue/482', 'MCP resource'],
        ['plug', 'postgres:schema/orders', 'MCP resource'],
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
      s += t(x + 212, 478, 'Pasted text', { s: 12, w: 500 });
      s += t(x + 212, 494, '214 lines · click to view', { s: 11, c: C.muted });
      s += ic('x', x + 328, 466, 14, C.muted);
      s += runs(x + 30, 530, [['Compare with '], ['@src/cart/ti', C.accent, 600]], { s: 14 });
      s += line(x + 30 + tw('Compare with @src/cart/ti', 14) + 6, 516, x + 30 + tw('Compare with @src/cart/ti', 14) + 6, 534, { c: C.ink, sw: 1.3 });
      s += btn(x + 344, 572, 'Send', { v: 'primary', icon: 'send', w: 72 });

      // C — queue
      x = 970;
      s += rect(x + 16, 140, 408, 38, { r: 8, fill: C.surface, stroke: C.accentLine });
      s += circle(x + 34, 159, 7, { stroke: C.accent, sw: 2.5 });
      s += t(x + 50, 163.5, 'Working · Bash npm test · 0:42', { s: 12.5, w: 500, c: C.accent });
      s += t(x + 410, 163.5, 'Esc interrupts', { s: 11.5, c: C.muted, a: 'end' });
      s += t(x + 16, 206, 'QUEUED · 2', { s: 11, w: 700, c: C.muted, ls: 0.5 });
      const q = [['Also check the Redis mock', 'Next'], ['Then update the changelog', 'Later']];
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
        ['Steer now', 'Claude reads it right away;', 'running work moves to the background'],
        ['Next', 'After the current tool calls', '(default)'],
        ['Later', 'Starts a new turn when this', 'one ends'],
      ];
      pri.forEach(([label, a, b], i) => {
        const y = 262 + i * 52;
        if (i === 1) s += rect(x + 156, y - 4, 258, 50, { r: 6, fill: C.accentSoft });
        s += t(x + 168, y + 12, label, { s: 13, w: 600, c: i === 1 ? C.accent : C.ink });
        s += t(x + 168, y + 28, a, { s: 11.5, c: C.ink2 });
        s += t(x + 168, y + 42, b, { s: 11.5, c: C.ink2 });
        if (i === 1) s += ic('check', x + 392, y + 4, 16, C.accent);
      });
      s += hline(x + 150, 418, 270);
      s += t(x + 168, 440, 'Edit message', { s: 12.5 });
      s += t(x + 168, 460, 'Remove from queue', { s: 12.5, c: C.crit });
      s += miniComposer(x + 16, 498, 408, 112, { focus: true });
      s += t(x + 32, 526, 'Skip the integration tests', { s: 14 });
      s += btn(x + 214, 572, 'Interrupt', { v: 'dangerOutline', icon: 'stop', w: 96 });
      s += btn(x + 316, 572, 'Steer now', { v: 'primary', w: 100 });

      // D — small states
      s += t(30, 660, 'D · Prompt suggestion', { s: 15, w: 700 });
      s += t(500, 660, 'D · Interrupt receipt', { s: 15, w: 700 });
      s += t(970, 660, 'D · Send options', { s: 15, w: 700 });
      s += miniComposer(46, 680, 408, 100);
      s += t(62, 708, 'Run the full test suite to confirm the fix', { s: 14, c: C.muted });
      s += kbd(62, 718, 'Tab');
      s += t(92, 731, 'to accept · keep typing to ignore', { s: 11.5, c: C.muted });
      s += btn(370, 742, 'Send', { v: 'primary', icon: 'send', w: 76, h: 28 });

      s += rect(516, 680, 408, 110, { r: 10, fill: C.warnSoft, stroke: '#f1d38a' });
      s += ic('warning', 532, 696, 18, C.warnInk);
      s += t(560, 710, 'Turn interrupted', { s: 13.5, w: 700 });
      s += t(560, 730, '2 queued messages were not cancelled and will', { s: 12.5, c: C.ink2 });
      s += t(560, 747, 'run next.', { s: 12.5, c: C.ink2 });
      s += btn(724, 752, 'Keep', { h: 28, s: 12, w: 62 });
      s += btn(792, 752, 'Cancel queued', { v: 'dangerOutline', h: 28, s: 12, w: 120 });

      s += rect(986, 680, 408, 196, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      const opts = [
        ['send', 'Send', 'Enter', true],
        ['bolt', 'Steer now', 'Ctrl Enter'],
        ['clip', 'Add as context only — no reply', ''],
        ['lock', 'Send verbatim — no @ or / expansion', ''],
      ];
      opts.forEach(([icn, label, key, on], i) => {
        const y = 690 + i * 42;
        if (on) s += rect(992, y, 396, 36, { r: 6, fill: C.accentSoft });
        s += ic(icn, 1004, y + 10, 16, on ? C.accent : C.ink2);
        s += t(1030, y + 22.5, label, { s: 13, w: on ? 600 : 400, c: on ? C.accent : C.ink });
        if (key) s += kbd(1384 - kbd.w(key), y + 9, key);
      });
      s += t(1004, 864, 'Opened from the arrow next to Send.', { s: 11.5, c: C.muted });

      s += mk(40, 230, 1) + mk(430, 268, 2) + mk(512, 100, 3) + mk(512, 470, 4) + mk(512, 230, 5);
      s += mk(982, 222, 6) + mk(1424, 262, 7) + mk(1424, 578, 8) + mk(42, 690, 9) + mk(512, 690, 10) + mk(982, 690, 11);
      return s;
    },
    notes: [
      ['Slash palette', 'Typing / at the start opens the palette, filtered as you type. Arrow keys move, Tab completes the name (then shows the argument hint as ghost text), Enter runs. The list updates live when skills or plugins change.', '`supportedCommands()` → `SlashCommand` (`name`, `description`, `argumentHint`, `aliases`); `commands_changed` (FR-IN-05)'],
      ['Command origin', 'Each command shows where it comes from: built-in, bundled or project skill, plugin, project command file, MCP prompt. Built-ins with dedicated UI (/compact, /clear, /context, /usage) also have buttons elsewhere.', '`SlashCommand.builtin`; command dispatch = prompt text `/name args` (FR-SKILL-04)'],
      ['Drag and drop', 'Dragging files over the transcript shows the drop zone. Images become image blocks; other files are attached as @ mentions of their workspace path (or uploaded to a temp folder when outside the workspace).', 'Image content blocks in `SDKUserMessage.message` (FR-IN-02)'],
      ['Attachments', 'Image chips show a thumbnail and size. Pasting more than 20 lines turns the paste into a chip that can be opened and edited; it is sent as pasted content so Claude knows it was pasted.', '`pasted_content` / `inline_pastes` (FR-IN-04)'],
      ['@ mentions', 'Typing @ lists workspace files (recently edited first) and MCP resources. Enter inserts the mention; Claude Code expands it when the message is sent.', 'Mention expansion; MCP resources via `@server:resource` (FR-IN-03)'],
      ['Queued messages', 'Messages sent while Claude is working wait here in order, with their delivery choice. They can be edited, re-prioritised or removed until delivered; delivered ones move into the transcript.', 'Input queue → `SDKUserMessage` with `priority` and `uuid` (FR-IN-06)'],
      ['Delivery choice', 'Steer now: Claude reads it immediately and running work moves to the background. Next: read once the current tool calls finish (default). Later: becomes a new turn.', '`priority: "now"` + `origin: { kind: "human" }`, `"next"`, `"later"`'],
      ['Interrupt / Steer now', 'With text in the composer while Claude works, the primary button becomes "Steer now" and Interrupt stays available. Esc on an empty composer interrupts.', '`interrupt()`; `priority: "now"`'],
      ['Prompt suggestion', 'After a turn, the predicted next prompt appears as ghost text. Tab accepts it; typing anything else dismisses it.', '`promptSuggestions`, `prompt_suggestion` message (FR-IN-10)'],
      ['Interrupt receipt', 'After an interrupt, the SDK reports which queued messages are still pending. The toast offers to cancel them so they do not run.', '`interrupt()` → `SDKControlInterruptResponse.still_queued` (FR-IN-07)'],
      ['Send options', 'Context only appends the message without starting a turn (e.g. a pasted log). Verbatim sends text exactly as typed, with no @ or / processing.', '`shouldQuery: false`; `client_composed: true` / `verbatimPrompts` (FR-IN-08/09)'],
    ],
  });

  // ------------------------------------------------------------------ P06
  window.SCREENS.push({
    id: 'P06',
    group: 'Live session',
    title: 'Tool approval',
    summary: 'When a tool call needs permission, the request docks above the composer with everything needed to decide. The top-bar inbox lists requests from every live session. A high-risk variant is shown in the right column.',
    frs: ['FR-PERM-03..07', 'FR-PERM-06', 'FR-NTF-01'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 2 });
      s += K.sessionColumn({ active: 0 });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'requires_action' });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, 'The tests still fail on a clean checkout. Clean the caches and retry.');
      s += t(X, 202, 'The jest cache holds a stale transform. I\'ll clear the cache and reinstall dependencies.', { s: 14 });
      s += K.toolCard(X, 220, W, { icon: 'terminal', name: 'Bash', detail: 'rm -rf node_modules/.cache && npm ci', right: 'waiting 0:12', st: 'wait' });

      const y = 276;
      s += rect(X, y, W, 484, { r: 10, fill: C.surface, stroke: C.warn, sw: 1.5, shadow: true });
      s += rect(X + 1, y + 1, W - 2, 50, { r: 9, fill: C.warnSoft });
      s += ic('shield', X + 16, y + 16, 20, C.warnInk);
      s += t(X + 44, y + 32, 'Allow this command?', { s: 15, w: 700 });
      s += chip(X + 222, y + 16, 'asked by subagent test-runner', { icon: 'agent', bg: C.surface });
      s += t(X + W - 16, y + 31, 'Enter confirm · Esc deny', { s: 11.5, c: C.ink2, a: 'end' });
      s += ic('info', X + 16, y + 66, 16, C.ink2);
      s += t(X + 40, y + 78.5, 'No allow rule matches this command. The session asks before anything not allowed.', { s: 12.5, c: C.ink2 });
      s += code(X + 16, y + 94, W - 32, [[['$ ', C.muted], ['rm -rf node_modules/.cache && npm ci', C.ink, 600]]], { s: 13 });
      s += t(X + 16, y + 146, 'Clear the build cache and reinstall dependencies', { s: 12, c: C.muted, i: true });

      const oy = y + 164;
      const opts = [
        ['Allow once', '1'],
        ['Allow and don\'t ask again for', '2'],
        ['Edit the command, then allow', '3'],
        ['Deny and tell Claude what to do instead', '4'],
      ];
      opts.forEach(([label, key], i) => {
        const ry = oy + i * 50 + (i === 3 ? 0 : 0);
        const on = i === 1;
        s += rect(X + 16, ry, W - 32, i === 3 ? 82 : 42, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += radio(X + 28, ry + 13, on, label, { w: on ? 600 : 400 });
        s += kbd(X + W - 44, ry + 12, key);
        if (i === 1) {
          s += select(X + 270, ry + 6, 170, 'Bash(npm ci)', { h: 30, mono: true, s: 12 });
          s += t(X + 450, ry + 26, 'in', { s: 12.5, c: C.ink2 });
          s += select(X + 468, ry + 6, 222, 'This project · local settings', { h: 30, s: 12 });
        }
        if (i === 3) s += input(X + 52, ry + 40, W - 120, { h: 32, ph: 'e.g. Only clear the jest cache; don\'t reinstall', s: 12.5 });
      });
      const fy = y + 432;
      s += btn(X + 16, fy, 'Deny and stop the turn', { v: 'dangerOutline', icon: 'stop', w: 186 });
      s += btn(X + W - 196, fy, 'Allow and remember', { v: 'primary', w: 180, focus: false });
      s += K.composer(X, 776, W, { h: 108, ph: 'Type here to deny with instructions…', running: false });

      // inspector + inbox popover + variant
      s += K.inspector(0);
      const bx = 1084;
      s += rect(bx, 52, 346, 260, { r: 10, fill: C.surface, stroke: C.border, shadow: true });
      s += t(bx + 16, 78, 'Waiting for you', { s: 14, w: 700 });
      s += chip(bx + 136, 64, '2', { h: 18, bg: C.critSoft, c: C.crit });
      s += rect(bx + 8, 92, 330, 72, { r: 8, fill: C.accentSoft });
      s += ic('terminal', bx + 20, 104, 16, C.accent);
      s += t(bx + 44, 116, 'Fix flaky checkout tests', { s: 13, w: 600 });
      s += t(bx + 44, 134, 'Bash · rm -rf node_modules/.cache…', { s: 11.5, m: true, c: C.ink2 });
      s += t(bx + 44, 152, 'viewing now · 0:12', { s: 11, c: C.accent });
      s += ic('pencil', bx + 20, 182, 16, C.ink2);
      s += t(bx + 44, 194, 'Refactor auth middleware', { s: 13, w: 600 });
      s += t(bx + 44, 212, 'Edit · src/auth/session.ts', { s: 11.5, m: true, c: C.ink2 });
      s += t(bx + 44, 230, 'waiting 1m 03s', { s: 11, c: C.warnInk });
      s += btn(bx + 276, 186, 'Open', { h: 26, s: 12, w: 56 });
      s += hline(bx, 250, 346);
      s += toggle(bx + 16, 270, true, 'Browser notification when waiting', { s: 12.5 });

      s += t(1117, 352, 'VARIANT · HIGH-RISK REQUEST', { s: 11, w: 700, c: C.muted, ls: 0.4 });
      s += rect(1117, 364, 307, 252, { r: 10, fill: C.surface, stroke: C.crit, sw: 1.5 });
      s += ic('warning', 1131, 380, 18, C.crit);
      s += t(1157, 394, 'Delete outside the workspace?', { s: 13.5, w: 700 });
      s += code(1131, 410, 279, ['rm -rf ~/projects/old-build'], { s: 11.5 });
      s += para(1131, 460, 'Claude Code flagged a critical path. Decline is focused, there is no one-key approve and no "always allow".', 279, { s: 12, c: C.ink2, lh: 17 });
      s += btn(1131, 524, 'Deny', { v: 'primary', w: 136, focus: true });
      s += btn(1275, 524, 'Allow once', { w: 135 });
      s += t(1131, 586, 'Type ALLOW to enable the button', { s: 11.5, c: C.muted });

      s += mk(L.TX - 13, 236, 1) + mk(X + 206, y + 12, 2) + mk(L.TX - 13, y + 72, 3) + mk(L.TX - 13, y + 110, 4) + mk(L.TX - 13, oy + 20, 5);
      s += mk(L.TX - 13, oy + 70, 6) + mk(L.TX - 13, oy + 120, 7) + mk(L.TX - 13, oy + 170, 8) + mk(L.TX - 13, fy + 15, 9);
      s += mk(1082, 56, 10) + mk(1113, 368, 11) + mk(L.TX - 13, 790, 12);
      return s;
    },
    notes: [
      ['Pending tool card', 'The tool call that triggered the request stays in the transcript with an amber "waiting" state and a timer; it updates to approved / denied once answered.', '`canUseTool(toolName, input, { toolUseID })`'],
      ['Request header', 'Plain question naming the action. A chip shows when a subagent asked rather than the main agent; for MCP tools, the server and where it was configured.', '`agentID`, `mcpServer { name, source }`'],
      ['Why it is asking', 'One line built from the SDK\'s reason (no allow rule, an ask rule, plan mode, a path outside the workspace…) plus the blocked path when there is one.', '`decisionReason`, `blockedPath`'],
      ['Action preview', 'Bash shows the command and its description; Edit/Write show a diff; MCP tools show their JSON input; WebFetch shows the domain.', 'Tool `input` (typed by tool)'],
      ['Allow once', 'Runs this call only. Key 1.', '`{ behavior: "allow", updatedInput: input }`'],
      ['Allow and remember', 'Pick one of the rules Claude Code suggests (editable) and where to save it: this session, this project (local or shared settings) or all projects. Hidden when the SDK says not to offer it. Key 2.', '`suggestions` → `updatedPermissions` with `destination`; `suppressAlwaysAllowRule`'],
      ['Edit, then allow', 'Opens the command (or JSON input) for editing; the edited input runs. Claude is not told it was edited. Key 3.', '`updatedInput`'],
      ['Deny with instructions', 'The text goes back to Claude as the denial reason so it can change course. Key 4. Typing in the composer while a request is open does the same.', '`{ behavior: "deny", message }`'],
      ['Deny and stop', 'Denies and interrupts the turn.', '`{ behavior: "deny", interrupt: true }`'],
      ['Approvals inbox', 'The bell lists requests from every live session with how long each has waited. Answering in one tab resolves it in all tabs; a re-delivered request (after reconnect) is matched by its id and never shown twice.', '`requestId`, `reinitialize()`, `session_state_changed` (FR-PERM-06/07)'],
      ['High-risk variant', 'When the SDK marks a request as one a stray key must not approve, Deny is focused, number keys are disabled, "remember" is hidden and Allow needs typing ALLOW.', '`defaultToNo`, `suppressAlwaysAllowRule` (FR-PERM-05)'],
      ['Composer during a request', 'Stays usable: sending text denies the pending request with that text as the message.', '`{ behavior: "deny", message }`'],
    ],
  });

  // ------------------------------------------------------------------ P07
  window.SCREENS.push({
    id: 'P07',
    group: 'Live session',
    title: 'Clarifying questions',
    summary: 'When Claude calls AskUserQuestion, its questions dock above the composer as a short form: one step per question, option cards with descriptions, optional side-by-side previews, and a free-text "Other".',
    frs: ['FR-ASK-01..05', 'FR-TOOL-08'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += K.sessionColumn({ active: 2, live: [
        ['Fix flaky checkout tests', 'running', 'shop-api'],
        ['Refactor auth middleware', 'running', 'shop-api'],
        ['Add rate limiting', 'requires_action', 'shop-api', 'Needs your answer'],
      ] });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'requires_action', title: 'Add rate limiting', cost: '$0.09', ctx: 12 });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, 'Add rate limiting to the /orders endpoint.');
      s += t(X, 202, 'A couple of choices shape the design:', { s: 14 });
      s += K.toolCard(X, 216, W, { icon: 'chat', name: 'AskUserQuestion', detail: '2 questions', right: 'waiting 0:31', st: 'wait' });

      const y = 268;
      s += rect(X, y, W, 496, { r: 10, fill: C.surface, stroke: C.accent, sw: 1.5, shadow: true });
      s += ic('chat', X + 16, y + 16, 20, C.accent);
      s += t(X + 44, y + 32, 'Claude has 2 questions', { s: 15, w: 700 });
      s += t(X + W - 16, y + 31, 'Skip and reply in chat', { s: 12.5, c: C.accent, a: 'end' });
      // steps
      s += rect(X + 16, y + 50, 150, 30, { r: 15, fill: C.accentSoft, stroke: C.accent });
      s += circle(X + 33, y + 65, 9, { fill: C.accent }) + t(X + 33, y + 69, '1', { s: 11, w: 700, c: '#fff', a: 'middle' });
      s += t(X + 50, y + 69.5, 'Store', { s: 12.5, w: 600, c: C.accent });
      s += t(X + 92, y + 69.5, 'single', { s: 11, c: C.accent });
      s += rect(X + 176, y + 50, 168, 30, { r: 15, fill: C.surface, stroke: C.border });
      s += circle(X + 193, y + 65, 9, { fill: C.surface3 }) + t(X + 193, y + 69, '2', { s: 11, w: 700, c: C.ink2, a: 'middle' });
      s += t(X + 210, y + 69.5, 'Scope', { s: 12.5, w: 600, c: C.ink2 });
      s += t(X + 254, y + 69.5, 'multi-select', { s: 11, c: C.muted });

      s += t(X + 16, y + 112, 'Where should the rate limiter keep its counters?', { s: 15, w: 600 });
      const opts = [
        ['Redis (Recommended)', 'Shared across instances; uses the existing Redis.', true],
        ['In-memory', 'Simplest; limits apply per instance only.'],
        ['PostgreSQL', 'No new infra; adds a write on every request.'],
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
      s += t(X + 54, oy4 + 25, 'Other', { s: 13.5, w: 600 });
      s += kbd(X + 358, oy4 + 10, '4');
      s += input(X + 54, oy4 + 34, 316, { h: 28, ph: 'Describe another option…', s: 12.5 });

      // preview
      const px = X + 402;
      s += rect(px, y + 130, 329, 268, { r: 8, fill: C.surface2, stroke: C.border });
      s += t(px + 12, y + 150, 'PREVIEW · REDIS', { s: 10.5, w: 700, c: C.muted, ls: 0.4 });
      s += t(px + 317, y + 150, 'sandboxed HTML', { s: 10.5, c: C.muted, a: 'end' });
      s += rect(px + 12, y + 162, 305, 222, { r: 6, fill: C.surface, stroke: C.border });
      ['API #1', 'API #2', 'API #3'].forEach((n, i) => {
        s += box(px + 28, y + 178 + i * 46, 96, 34, n, null, { s: 12 });
        s += arrow(px + 126, y + 195 + i * 46, px + 196, y + 240);
      });
      s += box(px + 198, y + 218, 104, 44, 'Redis', 'INCR + EXPIRE', { fill: C.accentSoft, stroke: C.accentLine, s: 12 });
      s += t(px + 28, y + 336, 'limit: 100 req / min per API key', { s: 11.5, m: true, c: C.ink2 });
      s += t(px + 28, y + 354, 'window: sliding, 60 s', { s: 11.5, m: true, c: C.ink2 });
      s += t(px + 28, y + 372, 'on limit: 429 + Retry-After', { s: 11.5, m: true, c: C.ink2 });

      s += input(X + 16, y + 412, W - 32, { h: 32, ph: 'Note for Claude about this answer (optional)', icon: 'pencil' });
      s += hline(X, y + 456, W);
      s += t(X + 16, y + 482, '1–4 choose · Enter next · Shift Tab back', { s: 12, c: C.muted });
      s += btn(X + W - 232, y + 464, 'Back', { w: 70 });
      s += btn(X + W - 154, y + 464, 'Next question', { v: 'primary', w: 138 });
      s += K.composer(X, 776, W, { h: 108, ph: 'Or answer everything in your own words…' });

      s += K.inspector(0);
      s += t(L.IX + L.IW / 2, 220, 'No tasks yet', { s: 13, w: 600, c: C.ink2, a: 'middle' });
      s += t(L.IX + L.IW / 2, 240, 'Claude adds tasks once work starts.', { s: 12, c: C.muted, a: 'middle' });

      s += mk(L.TX - 13, 232, 1) + mk(X + 20, y + 52, 2) + mk(L.TX - 13, y + 108, 3) + mk(L.TX - 13, y + 160, 4) + mk(X + 380, y + 132, 5);
      s += mk(L.TX - 13, oy4 + 20, 6) + mk(px + 324, y + 134, 7) + mk(L.TX - 13, y + 428, 8) + mk(X + W - 6, y + 468, 9) + mk(L.TX - 13, 790, 10);
      return s;
    },
    notes: [
      ['Question card in the transcript', 'Claude\'s AskUserQuestion call appears as a waiting card; after answering, it shows the questions with the chosen answers.', '`AskUserQuestion` via `canUseTool` (FR-TOOL-08)'],
      ['Question steps', 'One pill per question using Claude\'s short header (max 12 characters) and whether it is single or multi-select. Answered steps get a check; clicking a pill jumps to it.', '`questions[].header`, `multiSelect`'],
      ['Question', 'The full question text, as Claude wrote it.', '`questions[].question`'],
      ['Option cards', 'Two to four options with descriptions. Single-select uses radio cards, multi-select uses checkboxes. Number keys pick.', '`questions[].options[]` (`label`, `description`)'],
      ['Recommended option', 'Claude marks its suggestion in the label; the UI keeps the wording and does not preselect it.', 'Option label'],
      ['Other', 'Free text when none of the options fits; the typed text becomes the answer for that question.', '`answers[question] = text`'],
      ['Preview', 'When Claude provides previews (enabled per profile), hovering or selecting an option shows its preview. HTML previews render in a sandboxed frame with scripts disabled.', '`toolConfig.askUserQuestion.previewFormat`, `options[].preview` (FR-ASK-03)'],
      ['Note', 'Optional note attached to the answer, e.g. "only for logged-in users".', '`annotations[question].notes` (FR-ASK-04)'],
      ['Navigation and submit', 'Next moves through questions; on the last one the button becomes "Send answers". Answers are returned with the original questions.', '`{ behavior: "allow", updatedInput: { questions, answers } }`'],
      ['Answer in your own words', 'Typing in the composer replies to all questions at once instead of using the form.', '`updatedInput.response`'],
    ],
  });

  // ------------------------------------------------------------------ P08
  window.SCREENS.push({
    id: 'P08',
    group: 'Live session',
    title: 'Plan review',
    summary: 'In plan mode Claude explores without editing, then presents a plan. The plan renders as a document; the action bar lets the user approve it together with the mode to implement in, or send it back with feedback.',
    frs: ['FR-PLAN-01..03', 'FR-PERM-01', 'FR-TOOL-10'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += K.sessionColumn({ active: 2, live: [
        ['Fix flaky checkout tests', 'running', 'shop-api'],
        ['Refactor auth middleware', 'running', 'shop-api'],
        ['Add rate limiting', 'requires_action', 'shop-api', 'Plan ready for review'],
      ] });
      s += rect(L.MX, 49, L.MW, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'requires_action', title: 'Add rate limiting', mode: 'Plan', modeIcon: 'list', modeBg: '#eef6ff', modeStroke: '#9ec5f4', modeInk: '#184f95', cost: '$0.31', ctx: 24 });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, 'Use Redis. Plan it first, I want to review before any edits.');
      s += rect(X, 186, W, 30, { r: 6, fill: C.surface, stroke: C.border });
      s += ic('list', X + 10, 193, 16, C.ink2);
      s += t(X + 34, 205.5, 'Read 9 files · searched 3 patterns · 1 subagent (Explore) · 48 s', { s: 12.5, c: C.ink2 });

      const y = 230;
      s += rect(X, y, W, 482, { r: 10, fill: C.surface, stroke: '#9ec5f4', sw: 1.5 });
      s += rect(X + 1, y + 1, W - 2, 44, { r: 9, fill: '#eef6ff' });
      s += ic('list', X + 16, y + 14, 18, '#184f95');
      s += t(X + 42, y + 28, 'Plan', { s: 14, w: 700, c: '#184f95' });
      s += chip(X + 80, y + 13, 'v2', { h: 18, bg: C.surface });
      s += t(X + W - 16, y + 28, 'waiting for your approval', { s: 12, c: '#184f95', a: 'end' });
      let py = y + 76;
      s += t(X + 20, py, 'Add rate limiting to POST /orders', { s: 17, w: 700 });
      s += t(X + 20, py + 26, 'Per-API-key sliding window (100 req/min) backed by the existing Redis, returned as 429 with Retry-After.', { s: 13, c: C.ink2 });
      py += 62;
      s += t(X + 20, py, 'Steps', { s: 14, w: 700 });
      const steps = [
        'Add `RateLimiter` in src/middleware/rate-limit.ts using INCR + EXPIRE',
        'Read limits from config/limits.yaml; default 100/min',
        'Mount the middleware on POST /orders only',
        'Add unit tests with a fake Redis and an integration test',
        'Document the 429 response in docs/api/orders.md',
      ];
      steps.forEach((st, i) => {
        s += t(X + 24, py + 26 + i * 24, `${i + 1}.`, { s: 13, w: 600, c: C.ink2 });
        s += t(X + 44, py + 26 + i * 24, st.replace(/`/g, ''), { s: 13 });
      });
      py += 160;
      s += t(X + 20, py, 'Files', { s: 14, w: 700 });
      let fx = X + 20;
      ['src/middleware/rate-limit.ts  new', 'src/routes/orders.ts', 'config/limits.yaml  new', 'tests/rate-limit.test.ts  new', 'docs/api/orders.md'].forEach((f) => {
        const w = chip.w(f, { m: true, icon: 1 });
        if (fx + w > X + W - 20) fx = X + 20, py += 26;
        s += chip(fx, py + 12, f, { m: true, icon: 'file', h: 20 });
        fx += w + 6;
      });
      py += 64;
      s += t(X + 20, py, 'Risks', { s: 14, w: 700 });
      s += t(X + 24, py + 24, '•  Redis outage would block orders — fail open with a warning log.', { s: 13 });
      s += t(X + 24, py + 46, '•  Shared NAT clients share a key only if they share an API key (acceptable).', { s: 13 });

      // action bar
      const ay = 724;
      s += rect(X, ay, W, 160, { r: 10, fill: C.surface, stroke: C.borderStrong, shadow: true });
      s += t(X + 16, ay + 28, 'Ready to implement?', { s: 14, w: 700 });
      s += t(X + 170, ay + 28, 'Approving switches the session out of plan mode.', { s: 12, c: C.muted });
      s += btn(X + 16, ay + 44, 'Approve · accept edits', { v: 'primary', icon: 'check', w: 196 });
      s += btn(X + 220, ay + 44, 'Approve · ask each step', { w: 190 });
      s += btn(X + 418, ay + 44, 'Approve · auto mode', { icon: 'spark', w: 170 });
      s += hline(X + 16, ay + 92, W - 32);
      s += input(X + 16, ay + 108, W - 172, { h: 34, ph: 'Tell Claude what to change in the plan…' });
      s += btn(X + W - 148, ay + 110, 'Keep planning', { w: 132 });

      // inspector: plan history
      s += K.inspector(0, { tabs: ['Plan', 'Tasks', 'Changes', 'Checkpoints', 'Context'] });
      const IX = L.IX + 16;
      s += t(IX, 152, 'Plan versions', { s: 13, w: 600 });
      s += rect(IX, 166, 307, 58, { r: 8, fill: C.accentSoft, stroke: C.accentLine });
      s += t(IX + 12, 188, 'v2 · current', { s: 13, w: 600, c: C.accent });
      s += t(IX + 12, 208, 'now · after your answer “Redis”', { s: 11.5, c: C.ink2 });
      s += rect(IX, 232, 307, 58, { r: 8, fill: C.surface, stroke: C.border });
      s += t(IX + 12, 254, 'v1', { s: 13, w: 600 });
      s += t(IX + 12, 274, '6 min ago · in-memory store', { s: 11.5, c: C.ink2 });
      s += t(IX, 316, 'Compare v1 ↔ v2', { s: 12.5, c: C.accent });
      s += hline(L.IX, 336, L.IW);
      s += t(IX, 362, 'Plan mode', { s: 13, w: 600 });
      s += kv(IX, 388, 'Instructions', 'Profile: “Team planning”', { kw: 96 });
      s += kv(IX, 410, 'Read-only', 'edits always ask', { kw: 96 });
      s += kv(IX, 432, 'After approval', 'Accept edits', { kw: 96 });

      s += mk(704, 64, 1) + mk(L.TX - 13, y + 22, 2) + mk(L.TX - 13, y + 140, 3) + mk(X + 18, ay + 46, 4) + mk(X + 222, ay + 46, 5);
      s += mk(X + 420, ay + 46, 6) + mk(L.TX - 13, ay + 124, 7) + mk(L.IX + 120, 147, 8);
      return s;
    },
    notes: [
      ['Plan mode in the header', 'The mode menu shows Plan with its own colour. Switching to Plan mid-session is allowed at any time; Claude then stops editing and ends with a plan.', '`setPermissionMode("plan")`, `EnterPlanMode`'],
      ['Plan card', 'Claude\'s plan from the ExitPlanMode call, rendered as Markdown. The header shows the version and that approval is pending.', '`ExitPlanMode` via `canUseTool` (FR-TOOL-10)'],
      ['Plan content', 'Rendered Markdown with file chips linking to the files. Long plans scroll inside the card; the action bar stays visible.', 'Plan text'],
      ['Approve · accept edits', 'Approves and switches the session to Accept edits so Claude implements without asking for each file edit.', '`allow` + `setPermissionMode("acceptEdits")` (FR-PLAN-01)'],
      ['Approve · ask each step', 'Approves and returns to the default mode; edits and commands still ask.', '`allow` + `setPermissionMode("default")`'],
      ['Approve · auto mode', 'Approves and lets the classifier review each action. Shown only when the model supports auto mode.', '`allow` + `setPermissionMode("auto")`; `ModelInfo.supportsAutoMode`'],
      ['Keep planning', 'Sends the feedback; Claude stays in plan mode and returns a new version.', '`{ behavior: "deny", message: feedback }`'],
      ['Plan versions', 'Every plan version in this session, with a diff between versions, and the plan-mode settings: custom instructions from the profile and the mode used after approval.', 'Transcript; `planModeInstructions` (FR-PLAN-02/03)'],
    ],
  });
})();
