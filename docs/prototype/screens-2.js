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
    group: 'Live session',
    title: 'Subagents and background work',
    summary: 'Subagents appear as expandable cards with their own live progress and nested transcript. Long-running commands and agents can move to the background; the Background tab tracks everything that runs detached.',
    frs: ['FR-AGT-04', 'FR-TOOL-06', 'FR-BG-01..05', 'FR-TOOL-11'],
    draw() {
      let s = sessionBase({ header: { state: 'running', cost: '$1.12', ctx: 44 } });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 122, W, 'Find every place that uses CartTimer, and run the e2e suite in the background while you fix them.');
      s += t(X, 224, "I'll map the usages with a subagent and start the e2e run in the background.", { s: 14 });

      const ay = 240;
      s += K.toolCard(X, ay, W, { icon: 'agent', name: 'Agent', detail: 'Explore · Find all usages of CartTimer', right: '0:38 · haiku', st: 'run', bodyH: 192, body: ' ' });
      s += hline(X, ay + 37, W);
      s += ic('spark', X + 14, ay + 48, 15, C.accent);
      s += t(X + 36, ay + 60, 'Scanning src/cart and tests — 14 files read, 3 call sites so far', { s: 12.5, i: true, c: C.accent });
      s += line(X + 22, ay + 76, X + 22, ay + 196, { c: C.accentLine, sw: 2 });
      s += nestedRow(X + 36, ay + 96, 'file', 'Read src/cart/timer.ts', '✓');
      s += nestedRow(X + 36, ay + 120, 'search', 'Grep "CartTimer" in src/**', '7 matches');
      s += nestedRow(X + 36, ay + 144, 'file', 'Read src/checkout/session.ts', '✓');
      s += ic('chat', X + 36, ay + 156, 15, C.ink2);
      s += t(X + 58, ay + 168, 'Call sites: session.ts:41, cart.ts:88, tests/helpers.ts:12. Checking the', { s: 12.5, c: C.ink2 });
      s += t(X + 58, ay + 186, 'helpers for a second timer instance…', { s: 12.5, c: C.ink2 });
      s += chip(X + 14, ay + 204, '18.2k tokens', { h: 18, s: 10.5 });
      s += chip(X + 104, ay + 204, '9 tool calls', { h: 18, s: 10.5 });
      s += t(X + W - 14, ay + 217, 'Collapse · Open full transcript', { s: 12, c: C.accent, a: 'end' });

      s += K.toolCard(X, 478, W, { icon: 'agent', name: 'Agent', detail: 'test-runner · Run the e2e suite', right: 'background', st: 'run' });
      s += chip(X + 430, 487, 'running in background', { icon: 'layers', bg: C.accentSoft, c: C.accent });

      s += K.toolCard(X, 526, W, {
        icon: 'terminal', name: 'Bash', detail: 'npm run build -- --watch', right: '1:12', st: 'run', bodyH: 96,
        body: code(X + 12, 572, W - 24, ['webpack 5.97 compiled successfully in 2310 ms', 'watching for file changes…'], { s: 11.5 }) +
          btn(X + 12, 628, 'Send to background', { icon: 'layers', h: 26, s: 12, w: 160 }) + kbd(X + 180, 632, 'Ctrl B') +
          btn(X + W - 76, 628, 'Stop', { icon: 'stop', h: 26, s: 12, w: 64, v: 'dangerOutline' }),
      });

      s += rect(X, 670, W, 36, { r: 8, fill: C.goodSoft, stroke: '#b7e3b7' });
      s += ic('check', X + 12, 680, 16, C.goodInk, 2.2);
      s += t(X + 36, 692.5, 'Background task finished: e2e shard 1/4 passed (42 tests, 2m 51s)', { s: 12.5, c: C.goodInk, w: 500 });
      s += t(X + W - 14, 692.5, 'View output', { s: 12, c: C.accent, a: 'end' });
      s += t(X, 738, 'Two call sites create their own timer; switching them to the shared clock now.', { s: 14 });
      s += K.composer(X, 776, W, { running: true, h: 108 });

      // inspector: background tab
      s += K.inspector(1);
      const IX = L.IX + 16;
      s += btn(IX, 136, 'Move current work to background', { icon: 'layers', w: 248, h: 30, s: 12.5 });
      s += kbd(IX + 256, 142, 'Ctrl B');
      const items = [
        ['agent', 'test-runner', 'subagent · running', 'Running jest shard 2/4…', '3m 02s · 41.3k tokens', 'run', 'Stop'],
        ['terminal', 'npm run e2e', 'bash · running', null, '3m 12s', 'run', 'Stop'],
        ['agent', 'Explore', 'subagent · completed', 'Mapped 3 call sites', '0:52 · 22.0k', 'ok', 'Report'],
        ['braces', 'audit-deps', 'workflow · failed', 'exit 1 — 2 advisories', '1m 40s', 'err', 'Output'],
        ['eye', 'tail -f logs/app.log', 'monitor · running', 'last event 4 s ago', '', 'run', 'Stop'],
      ];
      let y = 180;
      items.forEach(([icn, name, kind, sum, meta, st, act], i) => {
        const h = sum ? 76 : 58;
        s += rect(IX, y, 307, h, { r: 8, fill: C.surface, stroke: C.border });
        s += ic(icn, IX + 10, y + 10, 16, C.ink2);
        s += t(IX + 34, y + 22, name, { s: 13, w: 600, m: icn === 'terminal' || icn === 'eye' });
        const sc = st === 'ok' ? ['good', 'Done'] : st === 'err' ? ['crit', 'Failed'] : ['info', 'Running'];
        s += status(IX + 307 - 10 - K.chip.w(sc[1], { icon: 1 }), y + 9, sc[0], sc[1]);
        s += t(IX + 34, y + 40, kind + (meta ? ' · ' + meta : ''), { s: 11.5, c: C.muted });
        if (sum) s += t(IX + 34, y + 60, sum, { s: 12, i: st === 'run', c: st === 'err' ? C.crit : C.ink2 });
        const bw = K.btnW(act, { s: 11.5 });
        s += btn(IX + 297 - bw, y + h - 30, act, { h: 24, s: 11.5, v: act === 'Stop' ? 'dangerOutline' : 'secondary' });
        if (i === 0) {
          s += rect(IX + 20, y + h + 4, 287, 40, { r: 8, fill: C.surface2, stroke: C.border });
          s += t(IX + 30, y + h + 21, '↳ Explore', { s: 12.5, w: 600 });
          s += t(IX + 30, y + h + 37, 'nested subagent · running · 0:21', { s: 11, c: C.muted });
          y += 46;
        }
        y += h + 8;
      });
      s += t(IX, 640, 'Subagent limits from the profile: depth 3 · 20 at once', { s: 11.5, c: C.muted });

      s += mk(L.TX - 13, ay + 18, 1) + mk(L.TX - 13, ay + 56, 2) + mk(L.TX - 13, ay + 120, 3) + mk(L.TX - 13, 496, 4) + mk(L.TX - 13, 640, 5);
      s += mk(L.TX - 13, 688, 6) + mk(L.IX + 10, 200, 7) + mk(L.IX + 12, 151, 8) + mk(IX + 240, 230, 9) + mk(L.IX + 10, 290, 10);
      return s;
    },
    notes: [
      ['Subagent card', 'Shows the subagent type, the task Claude gave it, its model and a live timer. Click to collapse or expand.', '`Agent` tool call; `task_started`; `SubagentStart` hook (FR-TOOL-06)'],
      ['Progress summary', 'A one-line summary that updates while the subagent works, so the card is useful even when collapsed.', '`agentProgressSummaries` → `task_progress.summary`'],
      ['Nested transcript', 'The subagent\'s own tool calls and text, indented under its card. "Open full transcript" shows it full-width; nested subagents nest again.', '`forwardSubagentText`, `parent_tool_use_id`, `agent_id`'],
      ['Background subagent', 'Agents defined to run in the background (or moved there) return control at once; the card links to the Background tab.', '`AgentDefinition.background`; `task_updated`'],
      ['Send to background', 'Available on running Bash commands and subagents: the turn continues while the work keeps running. Ctrl B moves all foreground work.', '`backgroundTasks(toolUseId?)` (FR-BG-03)'],
      ['Task finished notice', 'When background work completes, fails or is stopped, a line appears in the transcript and, if the tab is hidden, a browser notification.', '`task_notification` (`status`, `summary`, `output_file`) (FR-BG-05)'],
      ['Background tab', 'Every detached item with type, status, elapsed time, token use and latest summary. Finished items stay until the session ends.', '`task_started` / `task_progress` / `task_updated` / `background_tasks_changed` (FR-BG-01)'],
      ['Move current work to background', 'Same as Ctrl B for everything the turn is waiting on.', '`backgroundTasks()`'],
      ['Stop / View output', 'Stop ends one task; View output opens the task\'s output file in a viewer.', '`stopTask(taskId)`; `readFile(output_file)` (FR-BG-02/04)'],
      ['Nested subagents', 'Subagents started by subagents appear as children so the tree is visible; depth and concurrency limits come from the profile.', '`parent_task_id`; `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`'],
    ],
  });

  // ------------------------------------------------------------------ P10
  window.SCREENS.push({
    id: 'P10',
    group: 'Live session',
    title: 'Checkpoints and rewind',
    summary: 'Each user message is a restore point for files Claude edited. The Checkpoints tab lists them; rewinding always starts with a dry run that lists exactly what will change and what cannot be restored.',
    frs: ['FR-CKPT-01..05', 'FR-SES-10'],
    draw() {
      let s = sessionBase({ header: { state: 'idle', cost: '$0.88', ctx: 41 } });
      const X = L.TX;
      const W = L.TW;
      s += K.userMsg(X, 140, W, 'Add tests for the timer.', { hover: true });
      s += t(X, 210, 'Added 6 tests in timer.test.ts and a fake clock helper.', { s: 14 });
      s += K.toolCard(X, 224, W, { icon: 'file', name: 'Write', detail: 'src/cart/timer.test.ts', right: '+96', st: 'ok' });
      s += K.toolCard(X, 270, W, { icon: 'file', name: 'Write', detail: 'tests/helpers/clock.ts', right: '+12', st: 'ok' });
      s += K.userMsg(X, 330, W, 'Also handle refunds.');
      s += K.toolCard(X, 396, W, { icon: 'pencil', name: 'Edit', detail: 'src/orders/refund.ts', right: '+22 −8', st: 'ok' });

      s += K.inspector(3);
      const IX = L.IX + 16;
      s += para(IX, 148, 'Rewind restores files that Edit and Write changed in this session.', 300, { s: 12, c: C.muted, lh: 16 });
      const cps = [
        ['#4', 'Also handle refunds', '2 min ago · 1 file'],
        ['#3', 'Add tests for the timer', '9 min ago · 2 files', true],
        ['#2', 'Fix it', '14 min ago · 1 file'],
        ['#1', 'The checkout tests fail randomly…', '21 min ago · start'],
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
      s += t(mx + 24, my + 40, 'Rewind files to before message #3?', { s: 18, w: 700 });
      s += t(mx + 24, my + 64, '“Add tests for the timer” · 9 min ago', { s: 13, c: C.ink2 });
      s += ic('x', mx + 604, my + 22, 18, C.ink2);
      s += hline(mx, my + 82, 640);
      s += t(mx + 24, my + 112, 'PREVIEW · DRY RUN', { s: 11, w: 700, c: C.muted, ls: 0.4 });
      s += t(mx + 616, my + 112, '4 files · +12 −148', { s: 12.5, w: 600, a: 'end' });
      const files = [
        ['src/cart/timer.test.ts', 'deleted · created after this point', '', '−96'],
        ['tests/helpers/clock.ts', 'deleted · created after this point', '', '−12'],
        ['src/orders/refund.ts', 'restored', '+8', '−22'],
        ['src/cart/timer.ts', 'restored', '+4', '−18'],
      ];
      s += rect(mx + 24, my + 124, 592, 4 * 40 + 2, { r: 8, fill: C.surface, stroke: C.border });
      files.forEach(([f, what, add, del], i) => {
        const y = my + 125 + i * 40;
        if (i) s += hline(mx + 24, y, 592, '#eef0f4');
        s += ic(what.startsWith('deleted') ? 'trash' : 'rewind', mx + 36, y + 12, 16, what.startsWith('deleted') ? C.crit : C.ink2);
        s += t(mx + 60, y + 25, f, { s: 12.5, m: true });
        s += t(mx + 330, y + 25, what, { s: 12, c: C.ink2 });
        s += t(mx + 566, y + 25, add, { s: 12, w: 600, c: C.addInk, a: 'end' });
        s += t(mx + 604, y + 25, del, { s: 12, w: 600, c: C.delInk, a: 'end' });
      });
      const wy = my + 300;
      s += rect(mx + 24, wy, 592, 78, { r: 8, fill: C.warnSoft, stroke: '#f1d38a' });
      s += ic('warning', mx + 36, wy + 12, 16, C.warnInk);
      s += t(mx + 60, wy + 25, 'Not restored', { s: 13, w: 700, c: C.warnInk });
      s += t(mx + 60, wy + 45, 'Changes from Bash commands (npm install ran twice), edits made by subagents,', { s: 12, c: C.ink2 });
      s += t(mx + 60, wy + 63, 'and directory changes. 1 symlink skipped. Use git for those.', { s: 12, c: C.ink2 });
      const oy = my + 398;
      s += rect(mx + 24, oy, 592, 54, { r: 8, fill: C.surface, stroke: C.border });
      s += radio(mx + 36, oy + 10, false, 'Rewind files only', { w: 600 });
      s += t(mx + 60, oy + 42, 'The conversation stays as it is; Claude is told files were restored.', { s: 12, c: C.muted });
      s += rect(mx + 24, oy + 62, 592, 54, { r: 8, fill: C.accentSoft, stroke: C.accent, sw: 1.5 });
      s += radio(mx + 36, oy + 72, true, 'Rewind files and branch the conversation here', { w: 600 });
      s += t(mx + 60, oy + 104, 'Opens a new session that ends at message #2. The original stays untouched.', { s: 12, c: C.ink2 });
      s += hline(mx, my + 540, 640);
      s += btn(mx + 420, my + 556, 'Cancel', { w: 80 });
      s += btn(mx + 508, my + 556, 'Rewind files', { v: 'danger', icon: 'rewind', w: 108 });

      s += mk(X + W - 222, 124, 1) + mk(L.IX + 10, 186, 2) + mk(mx + 16, my + 108, 3) + mk(mx + 20, my + 140, 4) + mk(mx + 20, wy + 14, 5);
      s += mk(mx + 20, oy + 14, 6) + mk(mx + 20, oy + 76, 7) + mk(mx + 504, my + 556, 8);
      return s;
    },
    notes: [
      ['Message actions', 'Hovering a user message shows Rewind (files back to before this message) and Branch (a new session that ends here).', '`SDKUserMessage.uuid`; `forkSession({ upToMessageId })`'],
      ['Checkpoint timeline', 'One row per user message with the number of files changed after it. The rewind button opens the dialog for that point. Hidden when checkpointing is off for the session.', '`enableFileCheckpointing`, `replay-user-messages` (FR-CKPT-01/02)'],
      ['Dry run summary', 'Opening the dialog runs a dry run first; the totals come from it. If rewinding is impossible the reason replaces the preview.', '`rewindFiles(uuid, { dryRun: true })` → `canRewind`, `error`, `insertions`, `deletions`'],
      ['Files that will change', 'Each file and what happens to it: deleted (Claude created it later) or restored, with line counts.', '`RewindFilesResult.filesChanged`'],
      ['What is not restored', 'Always shown: Bash changes, subagent edits, directories and remote files are outside checkpointing. Skipped links are counted.', '`skippedLinks`; documented limits (FR-CKPT-05)'],
      ['Rewind files only', 'Restores files; the transcript is unchanged and a note is added so Claude knows.', '`rewindFiles(uuid)`'],
      ['Rewind and branch', 'Restores files, then forks the session at the message before this point and opens the fork. Checkpoints do not carry into the fork.', '`rewindFiles(uuid)` + `forkSession({ upToMessageId })` (FR-CKPT-04)'],
      ['Confirm', 'Destructive styling; Enter does not trigger it by default. After success a toast offers "Open fork" or "Undo is not available — use git".', '—'],
    ],
  });

  // ------------------------------------------------------------------ P11
  window.SCREENS.push({
    id: 'P11',
    group: 'Live session',
    title: 'Context and cost',
    summary: 'The inspector expanded to a wide drawer. Left: what fills the context window, by category, with the files and tools behind it, plus compaction controls. Right: spend for this session by model, the budget cap and rate-limit status.',
    frs: ['FR-CTX-01..03', 'FR-COST-01..05', 'FR-PROMPT-03'],
    draw() {
      let s = sessionBase({ header: { state: 'idle', cost: '$0.42', ctx: 38 } });
      s += K.userMsg(L.TX, 130, 300, 'Summarize what changed.');
      s += rect(640, 49, 800, 851, { fill: C.surface, shadow: true });
      s += vline(640, 49, 851);
      s += t(664, 80, 'Context & cost', { s: 16, w: 700 });
      s += tabs(820, 80, ['Tasks', 'Background', 'Changes', 'Checkpoints', 'Context & cost'], 4, { s: 12.5, gap: 16 });
      s += ic('x', 1404, 66, 18, C.ink2);
      s += hline(640, 96, 800);

      // context column
      const X = 664;
      s += t(X, 140, '76.4k', { s: 30, w: 700 });
      s += t(X + 92, 140, '/ 200k tokens · 38%', { s: 14, c: C.ink2 });
      s += t(X, 162, 'claude-opus-5-5 · auto-compacts near the limit · updated after the last turn', { s: 12, c: C.muted });
      const cats = [
        ['System prompt', 3100, 0], ['System tools', 14200, 1], ['MCP tools', 6800, 2], ['Memory files', 2500, 3],
        ['Skills', 1200, 4], ['Messages', 48600, 5],
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
      // legend table
      s += t(X, 228, 'CATEGORY', { s: 10.5, w: 700, c: C.muted, ls: 0.4 });
      s += t(X + 380, 228, 'TOKENS', { s: 10.5, w: 700, c: C.muted, ls: 0.4, a: 'end' });
      s += t(X + 460, 228, 'SHARE', { s: 10.5, w: 700, c: C.muted, ls: 0.4, a: 'end' });
      const rows = [...cats.map(([n, tok, slot]) => [n, tok, C.series[slot]]), ['Compaction buffer', 16000, 'url(#hatch)'], ['Free', 107600, C.surface3]];
      rows.forEach(([n, tok, fill], i) => {
        const y = 240 + i * 24;
        s += rect(X, y + 4, 12, 12, { r: 3, fill, stroke: fill === C.surface3 ? C.borderStrong : undefined });
        s += t(X + 22, y + 15, n, { s: 12.5 });
        s += t(X + 380, y + 15, (tok / 1000).toFixed(1) + 'k', { s: 12.5, a: 'end' });
        s += t(X + 460, y + 15, ((tok / 200000) * 100).toFixed(1) + '%', { s: 12.5, c: C.ink2, a: 'end' });
      });
      s += t(X, 450, 'Deferred tool schemas (not counted): 41 tools · 12.3k', { s: 11.5, c: C.muted });

      s += t(X, 486, 'Memory files', { s: 13.5, w: 700 });
      [['CLAUDE.md', '1.9k'], ['.claude/rules/testing.md', '0.4k'], ['~/.claude/CLAUDE.md', '0.2k']].forEach(([f, tok], i) => {
        const y = 498 + i * 24;
        s += ic('file', X, y + 3, 14, C.ink2);
        s += t(X + 22, y + 15, f, { s: 12.5, m: true });
        s += t(X + 380, y + 15, tok, { s: 12.5, a: 'end' });
      });
      s += t(X, 600, 'MCP tools', { s: 13.5, w: 700 });
      [['github', '28 tools · 22 deferred', '3.9k'], ['postgres', '6 tools', '2.9k']].forEach(([n, d, tok], i) => {
        const y = 612 + i * 24;
        s += ic('plug', X, y + 3, 14, C.ink2);
        s += t(X + 22, y + 15, n, { s: 12.5, w: 600 });
        s += t(X + 100, y + 15, d, { s: 12, c: C.muted });
        s += t(X + 380, y + 15, tok, { s: 12.5, a: 'end' });
      });
      s += btn(X, 684, 'Compact now…', { icon: 'layers', w: 140 });
      s += btn(X + 150, 684, 'Clear conversation', { icon: 'trash', w: 160, v: 'dangerOutline' });
      s += btn(X + 320, 684, 'Precise count', { icon: 'refresh', w: 140 });
      s += rect(X, 730, 460, 112, { r: 8, fill: C.surface2, stroke: C.border, dash: '4 3' });
      s += t(X + 12, 752, 'Compact now…', { s: 12.5, w: 700 });
      s += textarea(X + 12, 762, 436, 44, ['Keep the failing test names and the timer decision.'], { s: 12 });
      s += btn(X + 360, 812, 'Compact', { v: 'primary', h: 26, s: 12, w: 88 });
      s += t(X + 12, 830, '182k → about 40k tokens', { s: 11.5, c: C.muted });

      // cost column
      const R = 1160;
      s += vline(1144, 112, 760);
      s += t(R, 140, '$0.42', { s: 30, w: 700 });
      s += t(R + 92, 140, 'this session', { s: 13, c: C.ink2 });
      s += t(R, 166, 'Budget cap $5.00', { s: 12, c: C.muted });
      s += t(R + 256, 166, '8%', { s: 12, w: 600, a: 'end' });
      s += progress(R, 174, 256, 8, C.accent, 6);
      s += t(R, 214, 'By model', { s: 13.5, w: 700 });
      const models = [
        ['Opus 5.5', 'main agent', '$0.38', [['Input', '182k'], ['Output', '21.4k'], ['Cache read', '1.24M'], ['Cache write', '96k']]],
        ['Haiku 4.5', 'subagents', '$0.04', [['Input', '64k'], ['Output', '6.1k'], ['Cache read', '310k'], ['Web searches', '0']]],
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
      s += t(R, 548, 'Rate limit', { s: 13.5, w: 700 });
      s += status(R, 560, 'warn', 'Close to limit');
      s += t(R, 602, '5-hour window', { s: 12, c: C.muted });
      s += t(R + 256, 602, '84% · resets 21:30', { s: 12, a: 'end' });
      s += progress(R, 610, 256, 84, C.warn, 6);
      s += t(R, 654, 'Turns', { s: 13.5, w: 700 });
      [['Turn 1', '1m 12s', '$0.21'], ['Turn 2', '48 s', '$0.18'], ['Turn 3', '9 s', '$0.03']].forEach(([n, d, c], i) => {
        const y = 666 + i * 24;
        s += t(R, y + 15, n, { s: 12.5 });
        s += t(R + 120, y + 15, d, { s: 12, c: C.muted });
        s += t(R + 256, y + 15, c, { s: 12.5, a: 'end' });
      });
      s += t(R, 760, 'Open usage dashboard →', { s: 12.5, c: C.accent });

      s += mk(800, 74, 1) + mk(X - 10, 190, 2) + mk(X - 10, 248, 3) + mk(X - 10, 506, 4) + mk(X - 10, 620, 5);
      s += mk(X - 10, 698, 6) + mk(X + 474, 698, 7) + mk(R - 8, 132, 8) + mk(R - 8, 238, 9) + mk(R - 8, 572, 10);
      return s;
    },
    notes: [
      ['Context meter', 'The header meter (percentage of the window) opens this drawer. It turns amber at 60% and red at 80%.', '`context_usage` on assistant messages; `getContextUsage({ detail: "summary" })` (FR-CTX-01)'],
      ['Usage bar', 'One bar for the whole window: used categories in fixed colours, the compaction reserve hatched, free space grey. Hover shows the category and tokens.', '`getContextUsage()` → `categories` (`kind`: used / buffer / free / deferred)'],
      ['Category table', 'Every category with tokens and share, so values never depend on colour. Deferred tool schemas are listed separately because they do not count.', '`categories`, `totalTokens`, `maxTokens`, `percentage`'],
      ['Memory files', 'Which CLAUDE.md and rules files loaded and what each costs; click to open in the editor (P20 → Prompt & memory).', '`memoryFiles` (FR-PROMPT-03)'],
      ['MCP tools', 'Per server: how many tools are loaded vs deferred, and their token cost.', '`mcpTools`, `mcpInstructions`'],
      ['Compact / Clear', 'Compact summarizes older history, optionally with instructions about what to keep; a divider marks it in the transcript. Clear starts the conversation over (confirmation required).', '`/compact [instructions]`, `/clear`; `compact_boundary`, `conversation_reset` (FR-CTX-03)'],
      ['Precise count', 'Recounts every category with token-counting requests instead of estimates.', '`getContextUsage({ detail: "full" })` (FR-CTX-02)'],
      ['Session cost and cap', 'Running total for the session against the budget cap. Totals include subagents.', '`total_cost_usd`, `maxBudgetUsd` (FR-COST-01/02)'],
      ['By model', 'Input, output, cache read / write and web searches per model, so subagent spend on a cheaper model is visible.', '`modelUsage` → `ModelUsage`'],
      ['Rate limit', 'Plan or org limit status with utilization and reset time; amber when close, red when requests are rejected.', '`rate_limit_event` (`status`, `utilization`, `resetsAt`) (FR-COST-04)'],
    ],
  });

  // ------------------------------------------------------------------ P12
  window.SCREENS.push({
    id: 'P12',
    group: 'Sessions',
    title: 'Session history — resume, fork, manage',
    summary: 'All saved sessions with search and filters. Selecting one previews its transcript read-only; from there it can be resumed (with new limits or another profile), forked from any message, renamed, tagged, exported or deleted.',
    frs: ['FR-SES-05..11', 'FR-SES-15'],
    draw() {
      let s = K.shell({ nav: 'sessions', approvals: 1 });
      s += t(96, 98, 'All sessions', { s: 22, w: 700 });
      s += input(96, 116, 236, { icon: 'search', ph: 'Search titles and prompts', h: 34 });
      s += select(342, 116, 160, 'All workspaces', { h: 34, icon: 'folder' });
      s += select(512, 116, 104, 'Any tag', { h: 34, icon: 'tag' });
      s += seg(626, 119, ['All', 'Live', 'Saved'], 0, { h: 28 });
      s += check(596, 84, true, 'Include worktrees', { s: 12.5 });
      s += rect(96, 166, 660, 716, { r: 10, fill: C.surface, stroke: C.border });
      const rows = [
        ['Add rate limiting to /orders', 'Use Redis. Plan it first, I want to review…', 'shop-api', 'main', '2 h ago', 'perf', true],
        ['Rate limiting — token bucket', '↳ forked from “Add rate limiting to /orders”', 'shop-api', 'main', '1 h ago', null, false, true],
        ['Investigate memory leak', 'Heap grows by 40 MB per hour on worker-3…', 'infra', 'main', 'Yesterday', null],
        ['Weekly notes digest', 'Summarize this week\'s notes into…', 'notes', '—', 'Yesterday', 'job'],
        ['Migrate to Postgres 17', 'Plan the upgrade path from 15 to 17…', 'data-pipeline', 'dev', 'Mon', 'db'],
        ['Write release notes 3.2', 'Collect merged PRs since v3.1…', 'shop-web', 'main', 'Oct 21', null],
        ['Review PR #482', '/code-review high', 'shop-api', 'pr-482', 'Oct 20', 'review'],
        ['Fix flaky checkout tests', 'The checkout tests fail randomly on CI…', 'shop-api', 'main', 'Oct 19', 'ci'],
        ['Explain the billing module', 'Walk me through how invoices are…', 'shop-api', 'main', 'Oct 18', null],
        ['Docs: API reference', 'Generate reference pages for…', 'shop-web', 'docs', 'Oct 17', 'docs'],
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

      // preview
      const X = 776;
      s += rect(X, 82, 640, 800, { r: 10, fill: C.surface, stroke: C.border });
      s += t(X + 20, 116, 'Add rate limiting to /orders', { s: 17, w: 700 });
      s += ic('pencil', X + 20 + tw('Add rate limiting to /orders', 17, false, true) + 8, 103, 15, C.muted);
      let cx = X + 20;
      [['perf', 'tag'], ['main', 'branch'], ['shop-api', 'folder'], ['2 h ago', 'clock']].forEach(([l, icn]) => {
        s += chip(cx, 128, l, { icon: icn });
        cx += K.chip.w(l, { icon: 1 }) + 6;
      });
      s += t(X + 620, 142, '5b3f2c1a-8d4e…', { s: 11.5, m: true, c: C.muted, a: 'end' });
      s += btn(X + 20, 164, 'Resume', { v: 'primary', icon: 'play', w: 100 });
      s += btn(X + 128, 164, 'Fork', { icon: 'branch', w: 76 });
      s += btn(X + 212, 164, 'Export', { icon: 'download', w: 92 });
      s += btn(X + 312, 164, 'Tag', { icon: 'tag', w: 64 });
      s += btn(X + 540, 164, 'Delete', { icon: 'trash', w: 80, v: 'dangerOutline' });
      s += hline(X, 208, 640);
      s += t(X + 320, 232, 'Load 12 earlier messages', { s: 12, c: C.accent, a: 'middle' });
      const msgs = [
        ['user', 'Add rate limiting to the /orders endpoint.'],
        ['tool', 'AskUserQuestion · Store: Redis · Scope: per API key'],
        ['user', 'Use Redis. Plan it first, I want to review before any edits.', true],
        ['asst', 'Plan v2 approved · mode → Accept edits'],
        ['tool', 'Write src/middleware/rate-limit.ts (+64)'],
        ['tool', 'Edit src/routes/orders.ts (+3 −1)'],
        ['tool', 'Bash npm test -- rate-limit · 12 passed'],
        ['asst', 'Rate limiting is in place on POST /orders with tests and docs.'],
      ];
      let y = 250;
      msgs.forEach(([kind, text, hover]) => {
        const h = kind === 'user' ? 44 : 32;
        if (kind === 'user') s += rect(X + 20, y, 600, h, { r: 8, fill: C.accentSoft });
        if (hover) s += rect(X + 20, y, 600, h, { r: 8, stroke: C.accent, sw: 1.5 });
        s += ic(kind === 'user' ? 'user' : kind === 'tool' ? 'terminal' : 'chat', X + 32, y + (h - 16) / 2, 16, C.ink2);
        s += t(X + 56, y + h / 2 + 4.5, text, { s: 13, m: kind === 'tool', c: kind === 'tool' ? C.ink2 : C.ink });
        if (hover) s += btn(X + 470, y + 8, 'Branch from here', { icon: 'branch', h: 28, s: 12, w: 142 });
        y += h + 10;
      });
      s += rect(X + 20, 700, 600, 162, { r: 8, fill: C.surface2, stroke: C.border });
      s += t(X + 36, 726, 'Resume with', { s: 13, w: 700 });
      s += select(X + 36, 740, 200, 'Profile: Default', { h: 30, s: 12.5 });
      s += input(X + 248, 740, 110, { h: 30, val: '100', right: 'turns', s: 12.5 });
      s += input(X + 368, 740, 110, { h: 30, val: '10.00', right: 'USD', s: 12.5 });
      s += check(X + 36, 786, false, 'Fork instead of continuing the original', { s: 12.5 });
      s += check(X + 36, 812, true, 'Re-apply the session\'s original model and mode', { s: 12.5 });
      s += btn(X + 494, 820, 'Resume', { v: 'primary', w: 110 });

      s += mk(92, 112, 1) + mk(92, 230, 2) + mk(102, 250, 3) + mk(X + 20, 160, 4) + mk(X + 616, 336, 5);
      s += mk(X + 16, 704, 6) + mk(X + 210, 160, 7) + mk(X + 616, 160, 8);
      return s;
    },
    notes: [
      ['Search and filters', 'Searches titles and first prompts. Filters: workspace, tag, live / saved, and whether to include sessions from the folder\'s git worktrees.', '`listSessions({ dir, includeWorktrees })` → `SDKSessionInfo` (FR-SES-05)'],
      ['Session row', 'Title (custom, AI-generated or first prompt), first prompt, workspace and branch, last modified and tag. Live sessions show their state dot.', '`summary`, `customTitle`, `firstPrompt`, `gitBranch`, `lastModified`, `tag`'],
      ['Fork lineage', 'Forks show where they came from; clicking the line selects the parent.', 'App `SessionMeta.forkParent`'],
      ['Preview header', 'Rename inline (pencil), Resume, Fork (whole session), Export (Markdown / JSON), Tag (choose or create; clear).', '`renameSession`, `forkSession`, `getSessionMessages`, `tagSession` (FR-SES-08/10/15)'],
      ['Branch from here', 'Hovering any message offers a fork that ends at that message; the fork opens as a new live session.', '`forkSession(id, { upToMessageId })`'],
      ['Resume options', 'Resume can change the profile and raise limits — the usual fix after hitting max turns or the budget. "Fork instead" leaves the original unchanged.', '`resume`, `forkSession: true`, `maxTurns`, `maxBudgetUsd` (FR-SES-07)'],
      ['Export', 'Markdown for reading, JSON for tools. Subagent transcripts are included as nested sections.', '`getSessionMessages({ includeSystemMessages })`'],
      ['Delete', 'Confirmation names the session and says it cannot be undone. Live sessions must be stopped first.', '`deleteSession()` (FR-SES-09)'],
    ],
  });

  // ------------------------------------------------------------------ P13
  window.SCREENS.push({
    id: 'P13',
    group: 'Extend',
    title: 'MCP servers',
    summary: 'One place for every MCP server the agent can use: those registered in Code Agent, those from project files and plugins. Each server shows its connection status, tools and their approval policy, and can be controlled inside running sessions.',
    frs: ['FR-MCP-01..05', 'FR-MCP-09', 'FR-PERM-11', 'FR-CTOOL-03', 'FR-CTX-04'],
    draw() {
      let s = K.shell({ nav: 'mcp' });
      s += t(96, 98, 'MCP servers', { s: 22, w: 700 });
      s += btn(286, 80, 'Add server', { v: 'primary', icon: 'plus', w: 118 });
      s += rect(96, 128, 308, 754, { r: 10, fill: C.surface, stroke: C.border });
      const groups = [
        ['CODE AGENT REGISTRY', [
          ['github', 'HTTP', 'good', 'Connected', '28 tools', true],
          ['jira', 'HTTP', 'warn', 'Needs sign-in', '—'],
          ['app-tools', 'in-process', 'good', 'Connected', '3 tools'],
          ['webhooks', 'in-process', 'good', 'Connected', '2 tools'],
        ]],
        ['PROJECT .mcp.json · read-only', [
          ['postgres', 'stdio', 'good', 'Connected', '6 tools'],
          ['browser', 'stdio', 'crit', 'Failed', 'spawn ENOENT'],
        ]],
        ['PLUGIN · git-tools', [['git', 'stdio', 'good', 'Connected', '4 tools']]],
      ];
      let y = 152;
      groups.forEach(([g, items]) => {
        s += t(112, y, g, { s: 10.5, w: 700, c: C.muted, ls: 0.4 });
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
      s += status(X + 120, 148, 'good', 'Connected · github-mcp 1.4.0');
      s += btn(X + 680, 140, 'Reconnect', { icon: 'refresh', w: 112 });
      s += btn(X + 800, 140, 'Edit', { icon: 'pencil', w: 70 });
      s += btn(X + 878, 140, 'Remove', { icon: 'trash', w: 92, v: 'dangerOutline' });

      s += panel(X, 186, 470, 196, { title: 'Connection' });
      s += kv(X + 16, 248, 'URL', 'https://api.githubcopilot.com/mcp/', { kw: 100, m: true });
      s += kv(X + 16, 274, 'Headers', 'Authorization: Bearer ••••••••', { kw: 100, m: true });
      s += t(X + 116, 292, 'from secret “github-pat”', { s: 11.5, c: C.muted });
      s += kv(X + 16, 318, 'Tool timeout', '60 s', { kw: 100 });
      s += kv(X + 16, 344, 'Default in', 'Profiles: Default, Reviewer', { kw: 100 });
      s += kv(X + 16, 368, 'Instructions', '1.1k tokens', { kw: 100 });

      s += panel(X + 486, 186, 484, 196, { title: 'In live sessions' });
      const live = [['Fix flaky checkout tests', true, 'Session mode'], ['Refactor auth middleware', true, 'Always ask'], ['Docs: API reference', false, '—']];
      live.forEach(([n, on, ov], i) => {
        const ly = 240 + i * 44;
        s += toggle(X + 502, ly, on);
        s += t(X + 544, ly + 13.5, n, { s: 13, c: on ? C.ink : C.muted });
        if (on) s += select(X + 744, ly - 6, 150, ov, { h: 28, s: 12 });
        s += btn(X + 902, ly - 6, '', { icon: 'refresh', w: 28, h: 28 });
      });
      s += t(X + 502, 370, 'Override applies only while a session runs in Bypass or Auto.', { s: 11.5, c: C.muted });

      s += panel(X, 398, 970, 330, { title: 'Tools', sub: '28 · 22 deferred by tool search' });
      const cols = [[16, 'TOOL'], [260, 'ANNOTATIONS'], [560, 'TOKENS'], [660, 'APPROVAL']];
      cols.forEach(([dx, h]) => (s += t(X + dx, 460, h, { s: 10.5, w: 700, c: C.muted, ls: 0.4 })));
      const tools = [
        ['list_issues', ['read-only'], '420', 'Allow'],
        ['get_pull_request', ['read-only'], '380', 'Allow'],
        ['create_issue', ['open-world'], '510', 'Ask'],
        ['merge_pull_request', ['destructive', 'open-world'], '460', 'Ask'],
        ['delete_branch', ['destructive'], '300', 'Deny'],
        ['search_code', ['read-only', 'open-world'], '440', 'Default'],
      ];
      tools.forEach(([n, ann, tok, pol], i) => {
        const ty = 470 + i * 40;
        s += hline(X + 1, ty, 968, '#eef0f4');
        s += t(X + 16, ty + 25, n, { s: 12.5, m: true });
        let ax = X + 260;
        ann.forEach((a) => {
          s += chip(ax, ty + 11, a, { h: 18, s: 10.5, bg: a === 'destructive' ? C.critSoft : C.surface3, c: a === 'destructive' ? C.crit : C.ink2 });
          ax += K.chip.w(a, { s: 10.5 }) + 6;
        });
        s += t(X + 560, ty + 25, tok, { s: 12.5 });
        s += seg(X + 660, ty + 6, ['Allow', 'Ask', 'Deny', 'Default'], ['Allow', 'Ask', 'Deny', 'Default'].indexOf(pol), { h: 26, s: 11.5 });
      });

      s += panel(X, 744, 970, 138, { title: 'Session behaviour', sub: 'applies to every server' });
      s += toggle(X + 16, 798, false, 'Strict MCP config', { hint: 'use only servers passed by Code Agent; ignore .mcp.json, plugins and connectors' });
      s += t(X + 16, 852, 'Tool search', { s: 13 });
      s += select(X + 104, 834, 220, 'On · defer schemas', { h: 30, s: 12.5 });
      s += t(X + 344, 852, 'First-turn wait', { s: 13 });
      s += input(X + 450, 834, 90, { h: 30, val: '30', right: 's', s: 12.5 });

      s += mk(284, 82, 1) + mk(100, 150, 2) + mk(100, 510, 3) + mk(X + 678, 142, 4) + mk(X + 4, 190, 5);
      s += mk(X + 4, 412, 6) + mk(X + 490, 190, 7) + mk(X + 4, 748, 8);
      return s;
    },
    notes: [
      ['Add server', 'Form with type (stdio: command, args, env · HTTP / SSE: URL, headers · webhook tools), timeout and which profiles enable it by default. Secrets are picked from the secret store, never typed into plain config.', '`McpStdioServerConfig`, `McpHttpServerConfig`, `McpSSEServerConfig`; `createSdkMcpServer({ timeout })` (FR-MCP-01)'],
      ['Server list by source', 'Registry servers are editable. Servers from project `.mcp.json` and plugins are read-only here (edit the file or plugin). Each row shows type, status and tool count.', '`McpServerStatus.scope` / `source`'],
      ['Problem states', 'Failed shows the error; Needs sign-in explains that the SDK does not run OAuth and offers a token field (stored as a secret). Pending shows a spinner while connecting.', '`status`: connected / pending / failed / needs-auth / disabled (FR-MCP-02/05)'],
      ['Server actions', 'Reconnect in all live sessions, edit, remove (asks whether to keep it in running sessions).', '`reconnectMcpServer()`, `setMcpServers()`'],
      ['Connection', 'Endpoint, masked headers with their secret source, tool timeout, default profiles, and the token cost of the server\'s instructions.', 'Server config; `getContextUsage().mcpInstructions`'],
      ['Tools and approval', 'Every tool with its annotations (destructive in red) and token cost. Approval writes an allow / ask / deny rule for `mcp__github__<tool>`; for in-process servers it sets the tool policy.', '`allowedTools` / `disallowedTools` rules; `McpServerToolPolicy.permission_policy` (FR-CTOOL-03)'],
      ['In live sessions', 'Per running session: enable / disable the server, reconnect, and set a stricter mode for its tools while the session runs in Bypass or Auto.', '`toggleMcpServer()`, `reconnectMcpServer()`, `setMcpPermissionModeOverride()` (FR-MCP-03, FR-PERM-11)'],
      ['Session behaviour', 'Strict mode ignores servers from files, plugins and connectors. Tool search decides whether tool schemas load on demand. First-turn wait bounds how long a session waits for servers before its first turn.', '`strictMcpConfig`; `ENABLE_TOOL_SEARCH`; `MCP_TIMEOUT` (FR-MCP-04, FR-CTX-04)'],
    ],
  });

  // ------------------------------------------------------------------ P14
  window.SCREENS.push({
    id: 'P14',
    group: 'Extend',
    title: 'MCP elicitation',
    summary: 'An MCP server can ask the user for input in the middle of a tool call. Code Agent shows a dialog generated from the server\'s request: a form (left) or a link the user must open (right, variant).',
    frs: ['FR-MCP-06', 'FR-HOOK-01'],
    draw() {
      let s = sessionBase({ header: { state: 'requires_action', title: 'Migrate orders table' }, active: 0, live: [
        ['Migrate orders table', 'requires_action', 'data-pipeline', 'postgres needs input'],
        ['Refactor auth middleware', 'running', 'shop-api'],
      ] });
      s += K.userMsg(L.TX, 122, L.TW, 'Run the orders migration on staging.');
      s += K.toolCard(L.TX, 184, L.TW, { icon: 'plug', name: 'postgres · run_migration', detail: '20261027_orders_v2', right: 'waiting for input', st: 'wait' });
      s += K.inspector(0);
      s += overlay();

      const x = 360;
      const y = 150;
      s += rect(x, y, 500, 520, { r: 12, fill: C.surface, shadow: true });
      s += rect(x + 24, y + 24, 36, 36, { r: 8, fill: C.accentSoft });
      s += ic('plug', x + 34, y + 34, 16, C.accent);
      s += t(x + 72, y + 40, 'postgres needs input', { s: 17, w: 700 });
      s += t(x + 72, y + 58, 'project .mcp.json · during run_migration', { s: 12, c: C.muted });
      s += hline(x, y + 80, 500);
      s += para(x + 24, y + 110, 'Choose the target schema and confirm the batch settings before the migration runs.', 452, { s: 14, lh: 21 });
      s += select(x + 24, y + 174, 452, 'orders_v2', { label: 'Target schema *' });
      s += check(x + 24, y + 226, true, 'Dry run first');
      s += input(x + 24, y + 278, 200, { label: 'Batch size', val: '500' });
      s += t(x + 236, y + 299, 'between 100 and 5000', { s: 12, c: C.muted });
      s += textarea(x + 24, y + 346, 452, 64, [], { label: 'Reason (optional)' });
      s += t(x + 24, y + 434, 'Fields come from the server\'s request schema.', { s: 11.5, c: C.muted });
      s += hline(x, y + 452, 500);
      s += btn(x + 24, y + 470, 'Decline', { w: 86 });
      s += btn(x + 296, y + 470, 'Cancel', { w: 80, v: 'ghost' });
      s += btn(x + 384, y + 470, 'Submit', { v: 'primary', w: 92 });

      const vx = 900;
      const vy = 280;
      s += t(vx, vy - 14, 'VARIANT · URL MODE', { s: 11, w: 700, c: '#fff', ls: 0.5 });
      s += rect(vx, vy, 500, 300, { r: 12, fill: C.surface, shadow: true });
      s += rect(vx + 24, vy + 24, 36, 36, { r: 8, fill: C.warnSoft });
      s += ic('link', vx + 34, vy + 34, 16, C.warnInk);
      s += t(vx + 72, vy + 40, 'jira wants you to sign in', { s: 17, w: 700 });
      s += t(vx + 72, vy + 58, 'Code Agent registry · during create_issue', { s: 12, c: C.muted });
      s += hline(vx, vy + 80, 500);
      s += t(vx + 24, vy + 112, 'Open this page to continue:', { s: 14 });
      s += rect(vx + 24, vy + 126, 452, 34, { r: 6, fill: C.surface2, stroke: C.border });
      s += t(vx + 36, vy + 148, 'https://id.atlassian.com/authorize?client=…', { s: 12.5, m: true, c: C.accent });
      s += btn(vx + 24, vy + 176, 'Open page', { v: 'primary', icon: 'link', w: 120 });
      s += circle(vx + 166, vy + 191, 7, { stroke: C.accent, sw: 2.5 });
      s += t(vx + 182, vy + 195.5, 'Waiting for jira to confirm…', { s: 12.5, c: C.ink2 });
      s += hline(vx, vy + 232, 500);
      s += btn(vx + 24, vy + 250, 'Decline', { w: 86 });
      s += btn(vx + 396, vy + 250, 'Cancel', { w: 80 });

      s += mk(L.TX - 13, 200, 1) + mk(x + 20, y + 28, 2) + mk(x + 12, y + 104, 3) + mk(x + 12, y + 166, 4) + mk(x + 480, y + 474, 5);
      s += mk(vx + 20, vy + 180, 6) + mk(vx + 166, vy + 170, 7);
      return s;
    },
    notes: [
      ['Waiting tool call', 'The MCP tool call that triggered the request shows "waiting for input"; the session is in the needs-input state and appears in the approvals inbox.', '`onElicitation` pending; `requires_action`'],
      ['Who is asking', 'Server name, where it is configured and which tool call is running, so the user can judge whether to trust the request.', '`McpServerStatus.source`; tool call context'],
      ['Message', 'The server\'s message, as plain text (never rendered as HTML).', '`ElicitationRequest.message`'],
      ['Generated form', 'Fields, types, required markers, enums and ranges come from the server\'s requested schema. Validation runs before Submit.', 'Requested schema (form mode)'],
      ['Decline / Cancel / Submit', 'Submit returns the values; Decline tells the server the user refused; Cancel dismisses without answering. Esc = Cancel.', '`{ action: "accept", content }` / `"decline"` / `"cancel"`'],
      ['URL mode', 'For flows the server must complete in a browser (sign-in, consent): the link opens in a new tab.', 'URL-mode elicitation'],
      ['Waiting for completion', 'The dialog waits until the server reports completion, then closes by itself. A hook can also answer elicitations automatically (P17).', '`elicitation_complete`; `Elicitation` / `ElicitationResult` hooks'],
    ],
  });

  // ------------------------------------------------------------------ P15
  window.SCREENS.push({
    id: 'P15',
    group: 'Extend',
    title: 'Agents library and editor',
    summary: 'Subagents from every source in one list. Agents defined in Code Agent are edited here with every field the SDK supports; any agent can be tested in a new session or used as the main agent.',
    frs: ['FR-AGT-01..05'],
    draw() {
      let s = K.shell({ nav: 'agents' });
      s += t(96, 98, 'Agents', { s: 22, w: 700 });
      s += btn(274, 80, 'New agent', { v: 'primary', icon: 'plus', w: 106 });
      s += rect(96, 128, 284, 754, { r: 10, fill: C.surface, stroke: C.border });
      s += input(108, 140, 260, { icon: 'search', ph: 'Filter agents', h: 30 });
      const groups = [
        ['CODE AGENT', [['code-reviewer', 'opus'], ['test-runner', 'haiku', true], ['researcher', 'sonnet']]],
        ['PROJECT .claude/agents', [['db-migrator', 'inherit']]],
        ['PLUGIN · git-tools', [['changelog-writer', 'haiku']]],
        ['BUILT-IN', [['Explore', 'haiku'], ['general-purpose', 'inherit'], ['Plan', 'inherit']]],
      ];
      let y = 196;
      groups.forEach(([g, items]) => {
        s += t(112, y, g, { s: 10.5, w: 700, c: C.muted, ls: 0.4 });
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
      s += chip(X + 124, 84, 'Code Agent registry', { h: 20, icon: 'layers' });
      s += btn(X + 534, 80, 'Test in new session', { icon: 'play', w: 162 });
      s += btn(X + 704, 80, 'Use as main agent…', { icon: 'agent', w: 164 });
      s += btn(X + 876, 80, 'Save', { v: 'primary', w: 130 });

      s += rect(X, 128, 1006, 754, { r: 10, fill: C.surface, stroke: C.border });
      const L1 = X + 20;
      s += input(L1, 166, 280, { label: 'Name', val: 'test-runner', mono: true });
      s += textarea(L1 + 296, 166, 284, 52, ['Runs test suites and reports failures. Use', 'after code changes or when asked to test.'], { label: 'Description — when Claude should use it *', s: 12 });
      s += textarea(L1, 252, 580, 236, [
        'You run tests and report results. Never edit source files.',
        '',
        '1. Detect the test runner from package.json.',
        '2. Run the narrowest command that covers the request.',
        '3. On failure, re-run the failing test once to rule out flakiness.',
        '4. Report: command, pass/fail counts, first failure with stack,',
        '   and whether it reproduced.',
        '',
        'Keep the report under 200 words.',
      ], { label: 'System prompt *', mono: true, s: 12 });
      s += t(L1, 516, 'Tools', { s: 12, w: 500, c: C.ink2 });
      s += toggle(L1 + 420, 503, false, 'Inherit all tools', { s: 12.5 });
      s += rect(L1, 526, 580, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      let cx = L1 + 8;
      ['Bash', 'Read', 'Grep', 'Glob', 'AskUserQuestion'].forEach((tn) => {
        s += chip(cx, 536, tn + '  ×', { h: 20, m: true });
        cx += K.chip.w(tn + '  ×', { m: true }) + 6;
      });
      s += t(L1, 594, 'Disallowed tools', { s: 12, w: 500, c: C.ink2 });
      s += rect(L1, 604, 580, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      cx = L1 + 8;
      ['Bash(rm *)', 'Edit', 'Write', 'mcp__github__*'].forEach((tn) => {
        s += chip(cx, 614, tn + '  ×', { h: 20, m: true, bg: C.critSoft, c: C.crit });
        cx += K.chip.w(tn + '  ×', { m: true }) + 6;
      });
      s += t(L1, 672, 'Preload skills', { s: 12, w: 500, c: C.ink2 });
      s += rect(L1, 682, 284, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      s += chip(L1 + 8, 692, 'testing-conventions  ×', { h: 20, icon: 'spark' });
      s += t(L1 + 296, 672, 'MCP servers', { s: 12, w: 500, c: C.ink2 });
      s += rect(L1 + 296, 682, 284, 40, { r: 6, fill: C.surface, stroke: C.borderStrong });
      s += chip(L1 + 304, 692, 'postgres  ×', { h: 20, icon: 'plug' });
      s += t(L1 + 420, 707, '+ inline server', { s: 12, c: C.accent });
      s += input(L1, 758, 580, { label: 'Initial prompt (only when used as the main agent)', ph: 'e.g. Run the full suite and summarize failures' });

      const R = X + 640;
      s += t(R, 160, 'RUNTIME', { s: 10.5, w: 700, c: C.muted, ls: 0.4 });
      s += select(R, 190, 346, 'haiku', { label: 'Model' });
      s += t(R, 240, 'inherit · fable · opus · sonnet · haiku · full model ID', { s: 11.5, c: C.muted });
      s += select(R, 272, 165, 'medium', { label: 'Effort' });
      s += select(R + 181, 272, 165, 'Inherit', { label: 'Permission mode' });
      s += input(R, 340, 165, { label: 'Max turns', val: '30' });
      s += input(R + 181, 340, 165, { label: 'Auto-compact window', val: '200000', right: 'tokens' });
      s += select(R, 408, 346, 'project', { label: 'Memory' });
      s += t(R, 468, 'BEHAVIOUR', { s: 10.5, w: 700, c: C.muted, ls: 0.4 });
      s += toggle(R, 484, true, 'Run in the background', { s: 13 });
      s += t(R + 42, 516, 'Claude continues while it runs', { s: 11.5, c: C.muted });
      s += toggle(R, 534, false, 'Leave out CLAUDE.md', { s: 13 });
      s += t(R + 42, 566, 'for agents that get all context from the prompt', { s: 11.5, c: C.muted });
      s += rect(R, 600, 346, 120, { r: 8, fill: C.surface2, stroke: C.border });
      s += t(R + 14, 624, 'Used by', { s: 12.5, w: 700 });
      s += t(R + 14, 646, 'Profiles: Default, Headless CI', { s: 12, c: C.ink2 });
      s += t(R + 14, 666, 'Last run: 12 min ago in “Fix flaky checkout…”', { s: 12, c: C.ink2 });
      s += t(R + 14, 686, 'Avg 41k tokens · $0.03 per run', { s: 12, c: C.ink2 });
      s += t(R + 14, 708, 'Saved to ~/.code-agent (not to .claude/agents)', { s: 11.5, c: C.muted });

      s += mk(100, 200, 1) + mk(100, 560, 2) + mk(L1 + 282, 156, 3) + mk(L1 - 10, 242, 4) + mk(L1 - 10, 512, 5);
      s += mk(R - 12, 180, 6) + mk(R - 12, 470, 7) + mk(L1 - 10, 668, 8) + mk(X + 702, 78, 9) + mk(X + 532, 78, 10);
      return s;
    },
    notes: [
      ['Agents by source', 'Code Agent agents are editable; project and plugin agents open read-only with "Edit file" / "Copy to Code Agent". The model chip shows each agent\'s model.', '`supportedAgents()` → `AgentInfo`; `Options.agents` (FR-AGT-01)'],
      ['Built-in agents', 'Shown for reference (Explore, general-purpose, Plan); they can be copied as a starting point.', '`AgentInfo`'],
      ['Description', 'Tells Claude when to delegate to this agent — the most important field for automatic use.', '`AgentDefinition.description`'],
      ['System prompt', 'The agent\'s instructions, in a Markdown editor.', '`AgentDefinition.prompt`'],
      ['Tools', 'Pick tools from the session\'s tool list, or inherit everything. Disallowed tools accept rule patterns and whole MCP servers (`mcp__server__*`). Warns when AskUserQuestion is missing.', '`tools`, `disallowedTools`'],
      ['Model and runtime', 'Model alias, inherit or a full ID; effort; permission mode (the main session\'s plan / auto / bypass still win); max turns; auto-compact window; memory scope.', '`model`, `effort`, `permissionMode`, `maxTurns`, `autoCompactWindow`, `memory`'],
      ['Behaviour', 'Background agents return control immediately and report through the Background tab. Leaving out CLAUDE.md saves context for self-contained agents.', '`background`, `omitClaudeMd`'],
      ['Skills, MCP, initial prompt', 'Skills preloaded into the agent\'s context; MCP servers by name or inline; an initial prompt used only when the agent runs as the main thread.', '`skills`, `mcpServers` (`AgentMcpServerSpec`), `initialPrompt`'],
      ['Use as main agent', 'Starts a new session (or switches a live one) with this agent as the main thread: its prompt, tools and model apply from the next turn.', '`Options.agent`; `applyFlagSettings({ agent })` (FR-AGT-03)'],
      ['Test in new session', 'Opens P03 with this agent added and a suggested prompt that invokes it.', '`Options.agents`'],
    ],
  });

  // ------------------------------------------------------------------ P16
  window.SCREENS.push({
    id: 'P16',
    group: 'Extend',
    title: 'Skills, commands and plugins',
    summary: 'Skills and commands available to the current workspace, which ones each profile enables, and an editor for SKILL.md files. Plugins (local folders bundling skills, agents, hooks and MCP servers) are registered and reloaded here.',
    frs: ['FR-SKILL-01..04', 'FR-PLUG-01..03'],
    draw() {
      let s = K.shell({ nav: 'skills' });
      s += t(96, 98, 'Skills', { s: 22, w: 700 });
      s += tabs(96, 140, [['Skills', 6], ['Commands', 14], ['Plugins', 2]], 0, { s: 13.5, gap: 28, rule: [96, 1314] });
      s += t(560, 102, 'Profile', { s: 12.5, c: C.ink2 });
      s += select(612, 82, 160, 'Default', { h: 30, s: 12.5 });
      s += seg(784, 83, ['All skills', 'Selected only'], 1, { h: 28 });

      s += rect(96, 168, 664, 450, { r: 10, fill: C.surface, stroke: C.border });
      const cols = [[112, 'SKILL'], [330, 'SOURCE'], [470, 'INVOKED BY'], [744, 'IN PROFILE']];
      cols.forEach(([x, h], i) => (s += t(x, 192, h, { s: 10.5, w: 700, c: C.muted, ls: 0.4, a: i === 3 ? 'end' : undefined })));
      const rows = [
        ['code-review', 'Review the diff for bugs', 'bundled', 'You · Claude', true],
        ['security-check', 'Injection, authz, secrets', 'project', 'You · Claude', true, true],
        ['testing-conventions', 'How tests are written here', 'project', 'Claude only', true],
        ['deploy', 'Deploy to staging', 'user', 'You only', false],
        ['release-notes', 'Draft notes from merged PRs', 'plugin · git-tools', 'You · Claude', true],
        ['pdf', 'Read and fill PDF forms', 'user', 'Claude only', true],
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

      // editor
      const X = 780;
      s += rect(X, 168, 630, 450, { r: 10, fill: C.surface, stroke: C.border });
      s += ic('file', X + 16, 182, 16, C.ink2);
      s += t(X + 40, 195, '.claude/skills/security-check/SKILL.md', { s: 12.5, m: true });
      s += chip(X + 352, 181, 'edited', { h: 18, s: 10.5, bg: C.warnSoft, c: C.warnInk });
      s += hline(X, 212, 630);
      s += code(X + 16, 226, 598, [
        [['---', C.muted]],
        [['name', C.accent], [': security-check']],
        [['description', C.accent], [': Review changed code for injection, authz and']],
        '  secrets issues. Use before merging.',
        [['allowed-tools', C.accent], [': Read, Grep, Bash(git diff *)']],
        [['---', C.muted]],
        [['# Security check', C.ink, 700]],
        '1. Run `git diff origin/main...` and list changed files.',
        '2. For each file, check input handling, authz checks and',
        '   hard-coded secrets.',
        '3. Report findings with file:line and a fix.',
      ], { s: 12, lh: 19, bg: C.surface, stroke: C.border, h: 316 });
      s += t(X + 16, 572, 'Frontmatter checked: name valid, description present', { s: 11.5, c: C.goodInk });
      s += btn(X + 330, 580, 'Reload in live sessions (2)', { icon: 'refresh', w: 200, h: 28, s: 12 });
      s += btn(X + 538, 580, 'Save', { v: 'primary', w: 76, h: 28, s: 12 });

      // plugins
      s += panel(96, 636, 1314, 246, { title: 'Plugins', sub: 'local folders · skills, agents, commands, hooks and MCP servers' });
      s += btn(1170, 642, 'Add folder', { icon: 'plus', w: 108, h: 28, s: 12 });
      s += btn(1286, 642, 'Reload', { icon: 'refresh', w: 112, h: 28, s: 12 });
      const plugs = [
        ['git-tools', 'D:\\plugins\\git-tools', 'good', 'Loaded', 'skills 2 · commands 1 · agents 1 · MCP 1 · hooks 2', true],
        ['team-standards', '\\\\nas\\plugins\\team-standards', 'crit', 'Error', 'plugin.json: missing "name"', false],
      ];
      plugs.forEach(([n, p, st, label, detail, on], i) => {
        const y = 690 + i * 78;
        s += rect(112, y, 1282, 66, { r: 8, fill: C.surface, stroke: st === 'crit' ? '#e9a3a3' : C.border });
        s += ic('box', 126, y + 14, 18, C.ink2);
        s += t(154, y + 27, n, { s: 14, w: 600 });
        s += t(154, y + 48, p, { s: 12, m: true, c: C.muted });
        s += status(460, y + 14, st, label);
        s += t(460, y + 52, detail, { s: 12, c: st === 'crit' ? C.crit : C.ink2, m: st === 'crit' });
        s += toggle(1030, y + 14, on, 'In profile', { s: 12.5 });
        s += toggle(1030, y + 40, false, 'Skip its MCP servers', { s: 12.5 });
        s += btn(1360, y + 18, '', { icon: 'dots', w: 28, h: 28 });
      });

      s += mk(92, 132, 1) + mk(780, 80, 2) + mk(326, 214, 3) + mk(760, 214, 4) + mk(X + 4, 172, 5) + mk(X + 326, 584, 6);
      s += mk(108, 694, 7) + mk(1166, 644, 8);
      return s;
    },
    notes: [
      ['Skills · Commands · Plugins', 'Skills: SKILL.md-based capabilities. Commands: every / command in the workspace (built-in, skills, command files, MCP prompts) with origin and argument hint. Plugins: registered folders.', 'init `skills`, `supportedCommands()` (FR-SKILL-01)'],
      ['Profile skill mode', 'Per profile: enable all discovered skills, or only the selected ones.', '`Options.skills`: `"all"` or a list of names (FR-SKILL-02)'],
      ['Source and invoker', 'Where the skill lives (bundled, project, user, plugin) and who may invoke it: you via /name, Claude automatically, or both (from frontmatter).', 'Skill frontmatter `user-invocable` / model invocation'],
      ['In profile', 'Toggle whether the selected profile enables the skill. A user-invocable skill can still be run with /name even when not enabled.', '`Options.skills`'],
      ['SKILL.md editor', 'Edits project or user skills in place with frontmatter validation (name format, description present). Plugin and bundled skills open read-only.', 'Files under `.claude/skills/`, `~/.claude/skills/`'],
      ['Reload in live sessions', 'Pushes new or edited skills to running sessions without restarting them.', '`reloadSkills()` (FR-SKILL-03)'],
      ['Plugins', 'Each registered folder with load status, what it contributes, and errors from the last session start. Per profile: include it, and optionally skip its MCP servers when Code Agent manages them.', '`plugins` (`SdkPluginConfig`, `skipMcpDiscovery`); init `plugins`, `plugin_errors` (FR-PLUG-01/02)'],
      ['Add folder / Reload', 'Adds a plugin folder (also to live sessions) and reloads plugins in running sessions; warns when a reload will cost a prompt-cache rebuild.', '`reloadPlugins({ addPlugins, holdOnCacheImpact })` (FR-PLUG-03)'],
    ],
  });
})();
