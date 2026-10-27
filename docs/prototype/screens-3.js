/* Screens P17–P24: hooks, jobs, usage, settings, event inspector, session states. */
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
    s += t(84, 84, 'Settings', { s: 17, w: 700 });
    const items = ['Profiles', 'Provider & account', 'Permissions', 'Sandbox', 'Environment', 'Prompt & memory', 'Output styles', 'Notifications', 'Telemetry', 'Advanced', 'About'];
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
    group: 'Extend',
    title: 'Hooks',
    summary: 'Hooks run code at points in the agent loop. Code Agent offers rule-based hooks built in the UI (no code needed), compiled into SDK hook callbacks, plus a live log of every hook that fired. Hooks from settings files are listed read-only.',
    frs: ['FR-HOOK-01..06', 'FR-PERM-12'],
    draw() {
      let s = K.shell({ nav: 'hooks' });
      s += t(96, 98, 'Hooks', { s: 22, w: 700 });
      s += btn(286, 80, 'New rule', { v: 'primary', icon: 'plus', w: 98 });
      s += rect(96, 128, 288, 754, { r: 10, fill: C.surface, stroke: C.border });
      const groups = [
        ['TOOLS', [['PreToolUse', 3], ['PostToolUse', 2], ['PostToolUseFailure'], ['PostToolBatch']]],
        ['PROMPT & DISPLAY', [['UserPromptSubmit', 1], ['UserPromptExpansion'], ['MessageDisplay', 1]]],
        ['SESSION', [['SessionStart'], ['SessionEnd'], ['Setup'], ['Stop', 1], ['StopFailure', 1], ['Notification', 1]]],
        ['AGENTS & TASKS', [['SubagentStart'], ['SubagentStop'], ['TeammateIdle'], ['TaskCreated'], ['TaskCompleted']]],
        ['COMPACTION', [['PreCompact'], ['PostCompact']]],
        ['MODEL', [['PreModelSwitch'], ['PostModelSwitch']]],
        ['PERMISSIONS', [['PermissionRequest', 1], ['PermissionDenied']]],
        ['MCP', [['Elicitation'], ['ElicitationResult']]],
        ['CONFIG & FILES', [['ConfigChange'], ['InstructionsLoaded'], ['DirectoryAdded'], ['WorktreeCreate'], ['WorktreeRemove'], ['CwdChanged'], ['FileChanged']]],
      ];
      let y = 150;
      groups.forEach(([g, evs]) => {
        s += t(110, y, g, { s: 10, w: 700, c: C.muted, ls: 0.4 });
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

      // rules column
      const X = 404;
      s += t(X, 146, 'PreToolUse', { s: 17, w: 700, m: true });
      s += t(X, 166, 'Before a tool runs · can allow, deny, ask, defer or rewrite the input', { s: 12, c: C.muted });
      const rules = [
        ['Block force-push', 'Bash', 'command matches git push --force*', 'Deny', C.crit, C.critSoft, 'All profiles', true],
        ['Protect env files', 'Edit|Write', 'file_path matches **/.env*', 'Deny', C.crit, C.critSoft, 'All profiles'],
        ['Hold prod deploys', 'Bash', 'command matches ./deploy.sh prod*', 'Defer', C.warnInk, C.warnSoft, 'Profile: Default'],
      ];
      rules.forEach(([name, m, cond, act, ac, abg, scope, on], i) => {
        const ry = 182 + i * 96;
        s += rect(X, ry, 470, 86, { r: 8, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += toggle(X + 14, ry + 14, true);
        s += t(X + 56, ry + 27, name, { s: 13.5, w: 600 });
        s += chip(X + 456 - K.chip.w(act), ry + 12, act, { c: ac, bg: abg, w8: 700 });
        s += chip(X + 56, ry + 38, 'matcher ' + m, { m: true, h: 18, s: 10.5 });
        s += t(X + 56, ry + 74, 'if ' + cond, { s: 12, m: true, c: C.ink2 });
        s += t(X + 456, ry + 74, scope, { s: 11.5, c: C.muted, a: 'end' });
      });
      s += rect(X, 474, 470, 70, { r: 8, fill: C.surface2, stroke: C.border, dash: '4 3' });
      s += ic('lock', X + 14, 486, 14, C.muted);
      s += t(X + 36, 498, 'From .claude/settings.json · read-only', { s: 12.5, w: 600, c: C.ink2 });
      s += t(X + 36, 520, 'command hook · matcher Bash · ./scripts/check-cmd.sh', { s: 12, m: true, c: C.muted });
      s += t(X + 36, 536, 'Runs alongside the rules above.', { s: 11.5, c: C.muted });

      // editor
      const E = 894;
      s += rect(E, 128, 516, 430, { r: 10, fill: C.surface, stroke: C.border });
      s += t(E + 16, 154, 'Edit rule', { s: 14, w: 700 });
      s += input(E + 16, 184, 240, { label: 'Name', val: 'Block force-push' });
      s += select(E + 268, 184, 232, 'PreToolUse', { label: 'Event', mono: true });
      s += input(E + 16, 250, 484, { label: 'Matcher — tool name or pattern (Edit|Write, mcp__.*)', val: 'Bash', mono: true });
      s += t(E + 16, 306, 'Condition', { s: 12, w: 500, c: C.ink2 });
      s += select(E + 16, 314, 170, 'tool_input.command', { h: 30, s: 12, mono: true });
      s += select(E + 194, 314, 120, 'matches glob', { h: 30, s: 12 });
      s += input(E + 322, 314, 178, { h: 30, val: 'git push --force*', mono: true, s: 12 });
      s += select(E + 16, 372, 230, 'Deny with reason', { label: 'Action' });
      s += t(E + 258, 393, '9 action types — see notes', { s: 11.5, c: C.muted });
      s += textarea(E + 16, 434, 484, 50, ['Force-push is not allowed. Push to a branch and open a PR.'], { label: 'Reason shown to Claude', s: 12 });
      s += input(E + 16, 512, 90, { h: 30, val: '10', right: 's', s: 12 });
      s += toggle(E + 122, 518, false, 'Run async', { s: 12.5 });
      s += select(E + 236, 512, 160, 'All profiles', { h: 30, s: 12 });
      s += btn(E + 404, 512, 'Test…', { icon: 'play', h: 30, w: 96, s: 12 });

      // activity log
      s += panel(X, 572, 1006, 310, { title: 'Activity', sub: 'hooks that fired in live sessions · newest first' });
      s += seg(X + 800, 580, ['All', 'Blocked', 'Errors'], 0, { h: 24, s: 11.5 });
      const cols = [[16, 'TIME'], [100, 'EVENT'], [270, 'RULE'], [440, 'TARGET'], [760, 'OUTCOME'], [990, 'TIME TAKEN']];
      cols.forEach(([dx, h], i) => (s += t(X + dx, 632, h, { s: 10.5, w: 700, c: C.muted, ls: 0.4, a: i === 5 ? 'end' : undefined })));
      const log = [
        ['14:02:11', 'PreToolUse', 'Block force-push', 'Bash · git push --force origin main', 'crit', 'Denied', '2 ms'],
        ['14:01:58', 'PostToolUse', 'Audit log (built-in)', 'Edit · src/cart/timer.ts', 'good', 'Logged', '1 ms'],
        ['14:01:40', 'UserPromptSubmit', 'Session title (built-in)', 'prompt #1', 'good', 'Title set', '4 ms'],
        ['14:00:05', 'Notification', 'Notify (built-in)', 'waiting for approval', 'info', 'Notified', '1 ms'],
        ['13:58:47', 'PreToolUse', 'check-cmd.sh (settings)', 'Bash · npm ci', 'good', 'Allowed', '84 ms'],
        ['13:57:12', 'Stop', 'Webhook: team-log', 'turn ended', 'crit', 'Error: 502', '3.0 s'],
      ];
      log.forEach(([tm, ev, rule, target, st, out, dur], i) => {
        const ly = 642 + i * 38;
        s += hline(X + 1, ly, 1004, '#eef0f4');
        s += t(X + 16, ly + 24, tm, { s: 12, m: true, c: C.ink2 });
        s += t(X + 100, ly + 24, ev, { s: 12, m: true });
        s += t(X + 270, ly + 24, rule, { s: 12.5 });
        s += t(X + 440, ly + 24, target, { s: 12, m: true, c: C.ink2 });
        s += status(X + 760, ly + 10, st, out);
        s += t(X + 990, ly + 24, dur, { s: 12, a: 'end', c: C.ink2 });
      });

      s += mk(100, 132, 1) + mk(X - 4, 186, 2) + mk(E - 6, 242, 3) + mk(E - 6, 300, 4) + mk(E - 6, 364, 5);
      s += mk(E - 6, 428, 6) + mk(E + 232, 506, 7) + mk(E + 500, 506, 8) + mk(X - 4, 576, 9) + mk(X - 4, 478, 10);
      return s;
    },
    notes: [
      ['Events', 'All 33 SDK hook events, grouped. A count shows how many rules each has; events with none are dimmed but selectable.', '`HookEvent`'],
      ['Rules', 'Rules for the selected event, run in order (drag to reorder). Each shows its matcher, condition, action and scope; the toggle disables a rule without deleting it.', '`hooks: { [event]: HookCallbackMatcher[] }` (FR-HOOK-01)'],
      ['Matcher', 'Which tool (or other event field) the rule applies to, with the same pattern rules as settings files: exact name, `Edit|Write`, regex like `mcp__.*`.', '`HookCallbackMatcher.matcher`'],
      ['Condition', 'Optional test on the hook input: pick a field (tool_input.command, file_path, prompt…), an operator (equals, contains, matches glob / regex) and a value.', 'Evaluated in the compiled callback on `HookInput`'],
      ['Action', 'What the rule does. For PreToolUse: allow, deny, ask the user, defer, or rewrite the input. For other events: add context for Claude, set the session title, rewrite tool output, notify, log, or call a webhook whose JSON reply becomes the hook output.', '`SyncHookJSONOutput` (`permissionDecision`, `updatedInput`, `additionalContext`, `sessionTitle`, `updatedToolOutput`…) (FR-HOOK-02)'],
      ['Reason', 'Text Claude receives with a deny / ask, or the context to inject.', '`permissionDecisionReason`, `reason`, `systemMessage`'],
      ['Timeout, async, scope', 'Timeout per rule; async rules never block the agent (for logging and webhooks). Scope: all profiles or one profile. Changes reach live sessions from their next turn.', '`timeout`; `{ async: true }`; `applyFlagSettings({ hooks })` (FR-HOOK-06)'],
      ['Test', 'Runs the rule against a sample input (or a recent real event from the log) and shows the hook output it would return.', '—'],
      ['Activity', 'Every hook that fired, including built-in hooks and settings-file hooks, with outcome and time taken. Errors (e.g. a failing webhook) are listed with the response.', '`includeHookEvents` → `hook_started` / `hook_progress` / `hook_response` (FR-HOOK-04)'],
      ['Settings-file hooks', 'Hooks defined in settings files (command, http, mcp_tool, prompt or agent types) are shown read-only with their source.', '`resolveSettings()` (FR-HOOK-05)'],
    ],
  });

  // ------------------------------------------------------------------ P18
  window.SCREENS.push({
    id: 'P18',
    group: 'Extend',
    title: 'Structured output jobs',
    summary: 'Reusable one-shot jobs that must return JSON matching a schema — extraction, triage, audits. A job runs as an ordinary session (so it can be opened and continued) and its result is validated against the schema.',
    frs: ['FR-JOB-01..03'],
    draw() {
      let s = K.shell({ nav: 'jobs' });
      s += t(96, 98, 'Jobs', { s: 22, w: 700 });
      s += btn(236, 80, 'New job', { v: 'primary', icon: 'plus', w: 92 });
      s += rect(96, 128, 232, 754, { r: 10, fill: C.surface, stroke: C.border });
      const jobs = [
        ['Extract API endpoints', 'good', 'OK · 12 min ago', true],
        ['Summarize PR', 'good', 'OK · yesterday'],
        ['Triage new issues', 'crit', 'Failed · Mon'],
        ['Dependency audit', 'idle', 'Never run'],
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
      s += input(X + 16, 164, 528, { label: 'Name', val: 'Extract API endpoints' });
      s += select(X + 16, 230, 258, 'D:\\src\\shop-api', { label: 'Workspace', icon: 'folder' });
      s += select(X + 286, 230, 258, 'Reviewer (read-only)', { label: 'Profile', icon: 'layers' });
      s += t(X + 16, 290, 'Prompt', { s: 12, w: 500, c: C.ink2 });
      s += rect(X + 16, 298, 528, 70, { r: 6, fill: C.surface, stroke: C.borderStrong });
      s += runs(X + 26, 320, [['List every HTTP endpoint defined under '], ['{{dir}}', C.accent, 700], ['. Include the']], { s: 12.5 });
      s += t(X + 26, 340, 'method, the path and whether it requires authentication.', { s: 12.5 });
      s += t(X + 16, 392, 'Output schema (JSON Schema)', { s: 12, w: 500, c: C.ink2 });
      s += status(X + 444, 378, 'good', 'Valid schema');
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
      s += t(X + 16, 674, 'Or generate the schema from a TypeScript type / Zod definition.', { s: 11.5, c: C.muted });
      s += input(X + 16, 708, 120, { label: 'Max turns', val: '20' });
      s += input(X + 148, 708, 120, { label: 'Budget', val: '1.00', right: 'USD' });
      s += check(X + 284, 716, true, 'Save as session', { s: 12.5 });
      s += btn(X + 444, 840, 'Save', { v: 'primary', w: 100 });

      const R = 928;
      s += rect(R, 128, 482, 754, { r: 10, fill: C.surface, stroke: C.border });
      s += t(R + 16, 156, 'Run', { s: 14, w: 700 });
      s += input(R + 16, 186, 300, { label: 'dir', val: 'src/routes', mono: true });
      s += btn(R + 328, 186, 'Run job', { v: 'primary', icon: 'play', w: 138, h: 32 });
      s += hline(R, 236, 482);
      s += t(R + 16, 264, 'Last run · 12 min ago', { s: 13, w: 600 });
      s += status(R + 16, 274, 'good', 'Valid output');
      s += t(R + 140, 288, '14 turns · 38 s · $0.12', { s: 12, c: C.ink2 });
      s += code(R + 16, 306, 450, [
        '{',
        [['  "endpoints"', C.accent], [': [']],
        [['    { "method": ', C.ink], ['"GET"', C.goodInk], [', "path": ', C.ink], ['"/orders"', C.goodInk], [', "auth": true },']],
        [['    { "method": ', C.ink], ['"POST"', C.goodInk], [', "path": ', C.ink], ['"/orders"', C.goodInk], [', "auth": true },']],
        [['    { "method": ', C.ink], ['"GET"', C.goodInk], [', "path": ', C.ink], ['"/health"', C.goodInk], [', "auth": false },']],
        [['    … 11 more', C.muted]],
        '  ]',
        '}',
      ], { s: 12, lh: 18 });
      s += btn(R + 16, 476, 'Copy JSON', { icon: 'copy', w: 110, h: 28, s: 12 });
      s += btn(R + 134, 476, 'Open session', { icon: 'chat', w: 124, h: 28, s: 12 });
      s += btn(R + 266, 476, 'Download', { icon: 'download', w: 104, h: 28, s: 12 });
      s += hline(R, 524, 482);
      s += t(R + 16, 552, 'History', { s: 13, w: 600 });
      const runsList = [
        ['Oct 27 14:10', 'good', 'Valid', '$0.12', 'src/routes'],
        ['Oct 26 09:31', 'crit', 'No valid output after retries', '$0.31', 'src/'],
        ['Oct 25 17:02', 'good', 'Valid', '$0.10', 'src/routes'],
        ['Oct 24 11:45', 'warn', 'Stopped: max turns', '$0.22', 'src/'],
      ];
      runsList.forEach(([when, st, label, cost, arg], i) => {
        const y = 566 + i * 52;
        s += rect(R + 16, y, 450, 44, { r: 8, fill: C.surface2, stroke: C.border });
        s += t(R + 28, y + 18, when, { s: 12, m: true, c: C.ink2 });
        s += t(R + 28, y + 35, 'dir = ' + arg, { s: 11.5, m: true, c: C.muted });
        s += status(R + 160, y + 12, st, label);
        s += t(R + 454, y + 27, cost, { s: 12.5, a: 'end' });
      });

      s += mk(100, 132, 1) + mk(X + 276, 246, 2) + mk(X + 12, 300, 3) + mk(X + 12, 404, 4) + mk(R + 8, 202, 5);
      s += mk(R + 12, 310, 6) + mk(R + 130, 478, 7) + mk(R + 12, 620, 8);
      return s;
    },
    notes: [
      ['Job templates', 'Saved jobs with the status of their last run.', 'App `JobTemplate` (FR-JOB-01)'],
      ['Workspace and profile', 'Where the job runs and with which profile — typically a read-only profile so a job cannot edit files.', '`cwd`; profile → `Options`'],
      ['Prompt with variables', '`{{name}}` placeholders become inputs in the Run panel.', 'Prompt text'],
      ['Output schema', 'JSON Schema editor with validation and examples; a TypeScript / Zod type can be pasted and converted.', '`outputFormat: { type: "json_schema", schema }`'],
      ['Run', 'Fills the variables and starts the job as a single-message session; progress streams in this panel.', '`query({ prompt: string, options })`'],
      ['Validated result', 'The JSON Claude returned after validation, with turns, time and cost.', '`result.structured_output`, `num_turns`, `total_cost_usd` (FR-JOB-02)'],
      ['Open session', 'Opens the job\'s session to ask follow-up questions or continue the work.', '`session_id` → `resume` (FR-JOB-03)'],
      ['History', 'Each run with its arguments and outcome. Failures say why: no valid output after retries, max turns, budget.', '`error_max_structured_output_retries`, `error_max_turns`, `error_max_budget_usd`'],
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
    group: 'Insight',
    title: 'Usage and cost',
    summary: 'Spend and token use across all sessions, recorded from every result message so totals survive restarts. One filter row drives every chart; each chart has a table view.',
    frs: ['FR-COST-03..05'],
    draw() {
      let s = K.shell({ nav: 'usage' });
      s += t(96, 98, 'Usage', { s: 22, w: 700 });
      s += seg(96, 116, ['7 days', '30 days', '90 days', 'Month to date'], 1, { h: 30 });
      s += t(420, 136, 'Group by', { s: 12.5, c: C.ink2 });
      s += seg(482, 116, ['Model', 'Workspace', 'Profile'], 0, { h: 30 });
      s += select(720, 116, 180, 'All workspaces', { h: 30, s: 12.5, icon: 'folder' });
      s += btn(1300, 116, 'Export CSV', { icon: 'download', w: 110, h: 30, s: 12.5 });

      const tiles = [
        ['Spend', '$' + TOTAL.toFixed(2), '+12% vs previous 30 days'],
        ['Sessions', '126', '9 jobs · 3 stopped by budget'],
        ['Tokens', '18.4M', 'in 6.1M · out 1.2M · cache 11.1M'],
        ['Cache reads', '82%', 'of input tokens served from cache'],
      ];
      tiles.forEach(([k, v, sub], i) => {
        const x = 96 + i * 332;
        s += rect(x, 162, 318, 92, { r: 10, fill: C.surface, stroke: C.border });
        s += t(x + 16, 188, k, { s: 12.5, c: C.ink2 });
        s += t(x + 16, 222, v, { s: 26, w: 700 });
        s += t(x + 16, 242, sub, { s: 11.5, c: C.muted });
      });

      // stacked bar chart
      s += rect(96, 270, 912, 380, { r: 10, fill: C.surface, stroke: C.border });
      s += t(112, 298, 'Daily spend by model', { s: 14, w: 700 });
      const names = ['Opus 5.5', 'Sonnet 5', 'Haiku 4.5'];
      let lx = 112;
      names.forEach((n, i) => {
        s += rect(lx, 314, 12, 12, { r: 3, fill: C.series[i] });
        s += t(lx + 18, 324.5, n, { s: 12, c: C.ink2 });
        lx += 18 + tw(n, 12) + 18;
      });
      s += seg(890, 284, ['Chart', 'Table'], 0, { h: 26, s: 11.5 });
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
          else s += rect(x, yTop + (j === 0 ? 0 : 0), w, Math.max(hh, 1), { fill: C.series[j] });
          cum += h;
        });
      });
      // direct labels on the last bar
      const last = DAYS[29];
      let cy = base;
      last.forEach((v, j) => {
        const h = v * k;
        s += t(px + 30 * slot + 6, Math.min(cy - h / 2 + 4, cy - 2), names[j], { s: 11, c: C.ink2 });
        cy -= h;
      });
      ['Sep 28', 'Oct 5', 'Oct 12', 'Oct 19', 'Oct 26'].forEach((d, i) => {
        s += t(px + i * 7 * slot + slot / 2, base + 18, d, { s: 11, c: C.muted, a: 'middle' });
      });
      // tooltip
      const hd = DAYS[hov];
      const tx = px + hov * slot + slot + 8;
      s += rect(tx, 352, 178, 112, { r: 8, fill: C.surface, stroke: C.border, shadow: true });
      s += t(tx + 12, 374, 'Oct 19', { s: 12, w: 700 });
      s += t(tx + 166, 374, '$' + (hd[0] + hd[1] + hd[2]).toFixed(2), { s: 12, w: 700, a: 'end' });
      names.forEach((n, j) => {
        const ry = 398 + j * 20;
        s += rect(tx + 12, ry - 9, 10, 10, { r: 2, fill: C.series[j] });
        s += t(tx + 28, ry, n, { s: 12, c: C.ink2 });
        s += t(tx + 166, ry, '$' + hd[j].toFixed(2), { s: 12, a: 'end' });
      });
      s += t(tx + 12, 456, '14 sessions · click to filter', { s: 11, c: C.muted });

      // by workspace
      s += panel(1024, 270, 386, 380, { title: 'By workspace' });
      const wsRows = [['shop-api', 64, 0.55], ['data-pipeline', 18, 0.19], ['infra', 21, 0.12], ['shop-web', 15, 0.09], ['notes', 8, 0.05]];
      wsRows.forEach(([n, ses, share], i) => {
        const y = 332 + i * 60;
        s += t(1040, y, n, { s: 13, w: 600 });
        s += t(1394, y, '$' + (TOTAL * share).toFixed(2), { s: 13, w: 600, a: 'end' });
        s += rect(1040, y + 10, 354 * share / 0.55, 10, { r: 3, fill: C.series[0] });
        s += t(1040, y + 38, `${ses} sessions · ${(share * 100).toFixed(0)}%`, { s: 11.5, c: C.muted });
      });

      // top sessions
      s += panel(96, 666, 700, 216, { title: 'Most expensive sessions' });
      const top = [
        ['Migrate to Postgres 17', 'data-pipeline', 'Opus 5.5', '$5.77', 'budget cap'],
        ['Investigate memory leak', 'infra', 'Opus 5.5', '$3.12', null],
        ['Add rate limiting to /orders', 'shop-api', 'Opus 5.5 + Haiku', '$2.40', null],
        ['Refactor auth middleware', 'shop-api', 'Sonnet 5', '$1.08', 'live'],
      ];
      top.forEach(([n, ws, m, c, note], i) => {
        const y = 728 + i * 38;
        s += t(112, y, n, { s: 13, w: 500 });
        s += t(400, y, ws, { s: 12.5, c: C.ink2 });
        s += t(530, y, m, { s: 12.5, c: C.ink2 });
        if (note) s += chip(650, y - 14, note, { h: 18, s: 10.5, bg: note === 'live' ? C.accentSoft : C.warnSoft, c: note === 'live' ? C.accent : C.warnInk });
        s += t(780, y, c, { s: 13, w: 600, a: 'end' });
      });

      // limits
      s += panel(812, 666, 598, 216, { title: 'Limits and alerts' });
      s += t(828, 728, 'Rate limit · 5-hour window', { s: 12.5, c: C.ink2 });
      s += status(828, 738, 'warn', 'Close to limit');
      s += t(1100, 752, '84% · resets 21:30', { s: 12.5, a: 'end' });
      s += progress(828, 766, 272, 84, C.warn, 6);
      s += toggle(1130, 718, true, 'Alert at $50 / month', { s: 12.5 });
      s += toggle(1130, 752, true, 'Alert when a session hits its cap', { s: 12.5 });
      s += t(828, 818, 'Costs are client-side estimates from the SDK; your provider\'s invoice is authoritative.', { s: 11.5, c: C.muted });
      s += t(828, 840, 'Subagent tokens are included in totals.', { s: 11.5, c: C.muted });

      s += mk(92, 112, 1) + mk(92, 166, 2) + mk(886, 280, 3) + mk(px - 36, 480, 4) + mk(tx + 174, 356, 5);
      s += mk(1020, 274, 6) + mk(92, 670, 7) + mk(808, 670, 8);
      return s;
    },
    notes: [
      ['Filter row', 'Date range, grouping and workspace apply to every tile and chart on the page. Export downloads the filtered ledger.', 'App cost ledger (FR-COST-03)'],
      ['Stat tiles', 'Headline numbers for the range with a comparison to the previous period.', '`total_cost_usd`, `usage`, `modelUsage` from every result'],
      ['Legend and table view', 'The legend names each series (colour is never the only cue); the Table toggle shows the same numbers as rows.', '—'],
      ['Daily spend bars', 'Stacked by the chosen grouping, in a fixed colour order; series are also labelled at the end of the last bar. One y-axis, starting at zero.', 'Ledger grouped by day'],
      ['Hover tooltip', 'Hovering a day highlights its column and lists each series and the total; clicking filters the session table to that day.', '—'],
      ['By workspace', 'Spend share per workspace, single-hue bars with the value printed.', 'Ledger grouped by `cwd`'],
      ['Most expensive sessions', 'Top sessions in the range, with a tag when one was stopped by its budget cap; click to open.', '`error_max_budget_usd` results'],
      ['Limits and alerts', 'Current rate-limit utilization and reset time; alerts for monthly spend and for sessions hitting their cap. States that costs are estimates.', '`rate_limit_event`; `maxBudgetUsd` (FR-COST-04)'],
    ],
  });

  // ------------------------------------------------------------------ P20
  window.SCREENS.push({
    id: 'P20',
    group: 'Settings',
    title: 'Settings — profiles',
    summary: 'A profile is a named set of SDK options used to start sessions. The editor groups them by purpose; attached registries (MCP servers, agents, skills, plugins, hooks) are picked here and edited on their own pages.',
    frs: ['FR-CFG-01..03', 'FR-CFG-09', 'FR-MOD-01..08', 'FR-PERM-01/02/10/14', 'FR-PROMPT-01/02', 'FR-COST-01'],
    draw() {
      let s = settingsBase('Profiles');
      s += rect(296, 66, 220, 816, { r: 10, fill: C.surface, stroke: C.border });
      s += t(312, 92, 'Profiles', { s: 14, w: 700 });
      s += btn(452, 74, '', { icon: 'plus', w: 28, h: 28 });
      const profs = [['Default', 'used by new sessions', true, '★'], ['Reviewer', 'read-only, no Bash'], ['Headless CI', 'no prompts · deny'], ['Experimental', 'bypass allowed', false, '⚠']];
      profs.forEach(([n, d, on, mark], i) => {
        const y = 108 + i * 58;
        if (on) s += rect(302, y, 208, 52, { r: 8, fill: C.accentSoft });
        s += t(316, y + 22, n + (mark ? '  ' + mark : ''), { s: 13.5, w: 600, c: mark === '⚠' ? C.crit : on ? C.accent : C.ink });
        s += t(316, y + 40, d, { s: 11.5, c: C.muted });
      });

      const X = 532;
      s += t(X, 90, 'Default', { s: 20, w: 700 });
      s += btn(1110, 70, 'Duplicate', { icon: 'copy', w: 102, h: 30, s: 12.5 });
      s += btn(1220, 70, 'Export', { icon: 'download', w: 84, h: 30, s: 12.5 });
      s += btn(1312, 70, 'Save', { v: 'primary', w: 98, h: 30 });
      s += rect(X, 110, 878, 34, { r: 8, fill: C.accentSoft, stroke: C.accentLine });
      s += ic('info', X + 12, 119, 16, C.accent);
      s += t(X + 36, 131.5, '"Read" is pre-approved, so Read calls never reach your approval prompt. That is usually intended.', { s: 12.5, c: C.ink });
      s += t(X + 866, 131.5, 'Dismiss', { s: 12, c: C.accent, a: 'end' });

      const A = X;
      const B = X + 448;
      const sec = (x, y, label) => t(x, y, label, { s: 11, w: 700, c: C.muted, ls: 0.5 });
      // Column A
      s += sec(A, 172, 'MODEL');
      s += select(A, 182, 210, 'Opus 5.5');
      s += select(A + 220, 182, 210, 'Sonnet 5, Haiku 4.5', { label: '' });
      s += t(A + 220, 228, 'fallback chain', { s: 11, c: C.muted });
      s += t(A, 252, 'Effort', { s: 12, c: C.ink2 });
      s += seg(A + 60, 236, ['low', 'medium', 'high', 'xhigh', 'max'], 2, { h: 26, s: 11.5 });
      s += t(A, 286, 'Thinking', { s: 12, c: C.ink2 });
      s += seg(A + 60, 270, ['Adaptive', 'Budget', 'Off'], 0, { h: 26, s: 11.5 });
      s += seg(A + 252, 270, ['Summarized', 'Omitted'], 0, { h: 26, s: 11.5 });
      s += toggle(A, 310, false, 'Fast mode', { hint: 'when the model supports it', s: 12.5 });

      s += sec(A, 360, 'PERMISSIONS');
      s += select(A, 370, 210, 'Ask before edits', { icon: 'shield' });
      s += seg(A + 220, 372, ['Ask me', 'Deny (headless)'], 0, { h: 28, s: 11.5 });
      s += toggle(A, 416, false, 'Allow Bypass mode', { hint: 'dangerous · confirmation each time', s: 12.5 });
      s += t(A, 458, 'Pre-approved', { s: 12, c: C.ink2 });
      let cx = A + 90;
      ['Read', 'Grep', 'Glob', 'Bash(npm test *)'].forEach((r) => {
        s += chip(cx, 444, r, { m: true, h: 20, s: 10.5 });
        cx += K.chip.w(r, { m: true, s: 10.5 }) + 5;
      });
      s += t(A, 492, 'Blocked', { s: 12, c: C.ink2 });
      s += chip(A + 90, 478, 'Bash(rm -rf *)', { m: true, h: 20, s: 10.5, bg: C.critSoft, c: C.crit });
      s += chip(A + 90 + K.chip.w('Bash(rm -rf *)', { m: true }) + 5, 478, 'WebFetch(domain:pastebin.com)', { m: true, h: 20, s: 10.5, bg: C.critSoft, c: C.crit });
      s += t(A, 524, 'All rules and their sources → Permissions', { s: 12, c: C.accent });

      s += sec(A, 562, 'LIMITS');
      s += input(A, 572, 130, { val: '50', right: 'turns' });
      s += input(A + 140, 572, 130, { val: '5.00', right: 'USD' });
      s += input(A + 280, 572, 150, { ph: 'Task budget', right: 'tokens' });

      s += sec(A, 640, 'ATTACHED');
      const att = [['MCP servers', 'github, postgres'], ['Agents', 'test-runner, code-reviewer'], ['Skills', 'Selected · 5'], ['Plugins', 'git-tools'], ['Hooks', '6 rules (4 global)']];
      att.forEach(([k2, v], i) => {
        const y = 650 + i * 44;
        s += rect(A, y, 430, 38, { r: 8, fill: C.surface, stroke: C.border });
        s += t(A + 12, y + 24, k2, { s: 12.5, c: C.ink2 });
        s += t(A + 120, y + 24, v, { s: 12.5, w: 500 });
        s += ic('chevRight', A + 404, y + 11, 16, C.muted);
      });

      // Column B
      s += sec(B, 172, 'TOOLS');
      s += seg(B, 182, ['Claude Code preset', 'Custom list'], 0, { h: 28, s: 12 });
      s += toggle(B, 222, true, 'Task list tools', { hint: 'opt in on models without them', s: 12.5 });
      s += toggle(B, 250, true, 'Question previews', { hint: 'HTML', s: 12.5 });

      s += sec(B, 302, 'CONTEXT');
      s += t(B, 328, 'Load settings from', { s: 12, c: C.ink2 });
      s += check(B + 120, 316, true, 'User', { s: 12.5 });
      s += check(B + 188, 316, true, 'Project', { s: 12.5 });
      s += check(B + 268, 316, true, 'Local', { s: 12.5 });
      s += t(B, 362, 'System prompt', { s: 12, c: C.ink2 });
      s += seg(B + 96, 346, ['Claude Code', '+ Append', 'Custom', 'Minimal'], 1, { h: 26, s: 11.5 });
      s += textarea(B, 380, 430, 64, ['Prefer small commits. Run the narrowest test first.', 'Answer in English.'], { s: 12 });
      s += t(B, 462, 'Fixed for the life of a session.', { s: 11.5, c: C.muted });

      s += sec(B, 500, 'SESSION FEATURES');
      const feats = [
        ['File checkpointing', true], ['Prompt suggestions', true], ['Show subagent text', true],
        ['Subagent progress summaries', true], ['Hook events in the stream', true], ['Save sessions to disk', true],
        ['Send prompts verbatim', false],
      ];
      feats.forEach(([f, on], i) => {
        const y = 512 + i * 30;
        s += toggle(B, y, on, f, { s: 12.5 });
      });
      s += t(B, 738, 'Streaming of partial messages is always on in the UI.', { s: 11.5, c: C.muted });

      s += mk(80, 100, 1) + mk(300, 112, 2) + mk(X - 10, 126, 3) + mk(A - 14, 166, 4) + mk(A - 14, 354, 5);
      s += mk(B - 16, 166, 6) + mk(B - 16, 296, 7) + mk(A - 14, 556, 8) + mk(B - 16, 494, 9) + mk(A - 14, 634, 10) + mk(1106, 72, 11);
      return s;
    },
    notes: [
      ['Settings sections', 'Profiles, provider, permission rules, sandbox, environment, prompt & memory (CLAUDE.md and rules editors), output styles, notifications, telemetry, advanced runtime options.', '—'],
      ['Profiles', 'Named option sets; one is the default for new sessions. Profiles marked ⚠ allow Bypass mode. A profile in use by live sessions shows a badge; edits apply to new sessions only.', 'Profile → `Options` (FR-CFG-01)'],
      ['Configuration warnings', 'The editor explains settings that silently skip the approval prompt (bare tool names in pre-approved tools, Bypass mode) and missing tools (e.g. AskUserQuestion removed).', '`CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` (FR-PERM-14, FR-ASK-05)'],
      ['Model', 'Model, fallback chain, effort, thinking mode and display, fast mode.', '`model`, `fallbackModel`, `effort`, `thinking`, settings `fastMode`'],
      ['Permissions', 'Starting mode; who answers prompts (you, or deny everything for headless use); whether Bypass is allowed; pre-approved and blocked tool rules.', '`permissionMode`, `permissionPrompts`, `allowDangerouslySkipPermissions`, `allowedTools`, `disallowedTools`'],
      ['Tools', 'Claude Code\'s full tool set or a custom list; opt in to task tools; previews for clarifying questions.', '`tools`, `CLAUDE_CODE_ENABLE_TODO_TOOLS`, `toolConfig.askUserQuestion.previewFormat`'],
      ['Context', 'Which settings sources load (and with them CLAUDE.md, rules, skills, commands, agents, hooks), and the system prompt: Claude Code\'s, with appended text, fully custom, or minimal.', '`settingSources`, `systemPrompt` (FR-PROMPT-01/02)'],
      ['Limits', 'Max turns, budget and the alpha token task budget.', '`maxTurns`, `maxBudgetUsd`, `taskBudget`'],
      ['Session features', 'Checkpointing, prompt suggestions, subagent text and progress summaries, hook events, persistence, verbatim prompts.', '`enableFileCheckpointing`, `promptSuggestions`, `forwardSubagentText`, `agentProgressSummaries`, `includeHookEvents`, `persistSession`, `verbatimPrompts`'],
      ['Attached registries', 'MCP servers, agents, skills, plugins and hooks included in the profile; each row opens its page.', '`mcpServers`, `agents`, `skills`, `plugins`, `hooks`'],
      ['Duplicate / Export / Save', 'Profiles export and import as JSON (secrets are referenced, never exported).', '—'],
    ],
  });

  // ------------------------------------------------------------------ P21
  window.SCREENS.push({
    id: 'P21',
    group: 'Settings',
    title: 'Settings — permission rules and sandbox',
    summary: 'Every allow / ask / deny rule in one table with where it is stored, an explanation of the order Claude Code checks them in, and the command sandbox.',
    frs: ['FR-PERM-08', 'FR-CFG-05', 'FR-CFG-07'],
    draw() {
      let s = settingsBase('Permissions');
      const X = 300;
      s += t(X, 92, 'Permission rules', { s: 20, w: 700 });
      s += t(X, 114, 'How a tool call is decided — the first step that decides wins:', { s: 12.5, c: C.ink2 });
      const steps = [['Hooks', 'can deny or allow'], ['Deny rules', 'always win'], ['Ask rules', 'always prompt'], ['Mode', 'e.g. accept edits'], ['Allow rules', 'pre-approved'], ['You', 'approval card']];
      steps.forEach(([n, d], i) => {
        const bx = X + i * 186;
        s += box(bx, 128, 160, 50, n, d, { fill: i === 1 ? C.critSoft : i === 5 ? C.accentSoft : C.surface, s: 12.5 });
        if (i < steps.length - 1) s += arrow(bx + 162, 153, bx + 184, 153);
      });

      s += rect(X, 196, 720, 448, { r: 10, fill: C.surface, stroke: C.border });
      s += tabs(X + 16, 224, [['Allow', 9], ['Ask', 2], ['Deny', 4]], 0, { s: 13.5, gap: 26, rule: [X, 720] });
      s += input(X + 16, 248, 300, { h: 32, val: 'Bash(npm run lint *)', mono: true, s: 12.5, focus: true });
      s += select(X + 326, 248, 230, 'Save to: profile Default', { h: 32, s: 12.5 });
      s += btn(X + 566, 248, 'Add rule', { v: 'primary', w: 138, h: 32 });
      const cols = [[16, 'RULE'], [270, 'MATCHES'], [500, 'STORED IN']];
      cols.forEach(([dx, h]) => (s += t(X + dx, 304, h, { s: 10.5, w: 700, c: C.muted, ls: 0.4 })));
      const rules = [
        ['Read', 'every file read', 'Profile · Default'],
        ['Bash(npm test *)', 'commands starting “npm test”', 'Profile · Default'],
        ['Bash(git status)', 'exactly “git status”', '.claude/settings.local.json'],
        ['Edit(/src/**)', 'edits under ./src', 'Profile · Default'],
        ['WebFetch(domain:docs.github.com)', 'fetches from that domain', '~/.claude/settings.json'],
        ['mcp__github__list_*', 'GitHub list tools', 'Profile · Default'],
        ['Agent(Explore)', 'the Explore subagent', 'Profile · Default'],
        ['Skill(code-review)', 'the code-review skill', '.claude/settings.json 🔒'],
      ];
      rules.forEach(([r, m, src], i) => {
        const y = 314 + i * 40;
        s += hline(X + 1, y, 718, '#eef0f4');
        s += t(X + 16, y + 25, r, { s: 12.5, m: true });
        s += t(X + 270, y + 25, m, { s: 12.5, c: C.ink2 });
        s += t(X + 500, y + 25, src, { s: 12, c: src.startsWith('Profile') ? C.ink2 : C.accent, m: !src.startsWith('Profile') });
        s += ic('trash', X + 690, y + 12, 15, C.muted);
      });

      s += panel(1036, 196, 374, 448, { title: 'Rule syntax' });
      const syn = [
        ['Bash(npm run *)', 'command prefix / pattern'],
        ['PowerShell(Get-ChildItem *)', 'PowerShell commands'],
        ['Read(~/secrets/**)', 'paths: ~ home, /x workspace'],
        ['Edit(//etc/**)', '// = absolute path'],
        ['WebFetch(domain:x.com)', 'one domain'],
        ['mcp__github__*', 'all tools of one server'],
        ['Agent(Explore)', 'one subagent type'],
        ['Skill(deploy *)', 'skills by name'],
      ];
      syn.forEach(([r, d], i) => {
        const y = 256 + i * 40;
        s += t(1052, y, r, { s: 12, m: true, c: C.accent });
        s += t(1052, y + 17, d, { s: 11.5, c: C.muted });
      });
      s += t(1052, 590, 'Edit rules also cover Write and NotebookEdit.', { s: 11.5, c: C.ink2 });
      s += t(1052, 610, 'Deny rules apply even in Bypass mode.', { s: 11.5, c: C.ink2 });

      // sandbox
      s += panel(X, 660, 1110, 222, { title: 'Command sandbox', sub: 'isolates Bash commands at the OS level' });
      s += toggle(X + 16, 712, true, 'Enabled', { s: 13 });
      s += toggle(X + 16, 742, true, 'Stop if the sandbox cannot start', { s: 12.5 });
      s += toggle(X + 16, 772, true, 'Auto-approve sandboxed Bash', { s: 12.5 });
      s += toggle(X + 16, 802, false, 'Let Claude ask to run outside the sandbox', { s: 12.5 });
      s += toggle(X + 16, 832, false, 'Allow binding local ports', { s: 12.5 });
      const lists = [
        [X + 340, 'Network · allowed domains', ['registry.npmjs.org', '*.github.com'], false],
        [X + 340, 'Network · denied domains', ['pastebin.com'], true],
        [X + 760, 'Filesystem · may write', ['./', '/tmp'], false],
        [X + 760, 'Filesystem · may not read', ['~/.ssh', '~/.aws', '.env'], true],
      ];
      lists.forEach(([lx, label, items, deny], i) => {
        const ly = 708 + (i % 2) * 64;
        s += t(lx, ly, label, { s: 12, c: C.ink2 });
        let cx2 = lx;
        items.forEach((it) => {
          s += chip(cx2, ly + 10, it, { m: true, h: 22, bg: deny ? C.critSoft : C.surface3, c: deny ? C.crit : C.ink2 });
          cx2 += K.chip.w(it, { m: true }) + 6;
        });
        s += t(cx2 + 4, ly + 25, '+ add', { s: 12, c: C.accent });
      });
      s += toggle(X + 340, 842, false, 'Strict network allowlist', { s: 12.5 });
      s += t(X + 760, 852, 'Excluded commands', { s: 12, c: C.ink2 });
      s += chip(X + 880, 838, 'docker *', { m: true, h: 22 });

      s += mk(X - 6, 132, 1) + mk(X + 12, 210, 2) + mk(X + 12, 252, 3) + mk(X + 486, 290, 4) + mk(1032, 200, 5);
      s += mk(X + 12, 708, 6) + mk(X + 328, 704, 7) + mk(X + 748, 704, 8);
      return s;
    },
    notes: [
      ['Evaluation order', 'Always visible so it is clear why a call ran or was asked about: hooks, deny rules, ask rules, the permission mode, allow rules, then the approval card.', 'SDK permission evaluation order'],
      ['Allow · Ask · Deny', 'One tab per behaviour with counts. Ask rules force a prompt even when another rule allows the tool.', 'Rule behaviours `allow` / `ask` / `deny`'],
      ['Add a rule', 'Type a rule (validated and explained as you type) and choose where to save it: a profile, the project\'s shared or local settings file, or user settings.', '`allowedTools` / `disallowedTools`; settings `permissions`; `PermissionUpdate` destinations'],
      ['Stored in', 'Where each rule lives. Rules saved by "Allow and remember" land in local settings. Files owned by the project can be locked (🔒) to avoid accidental edits.', '`PermissionUpdateDestination`; `resolveSettings()` provenance'],
      ['Syntax help', 'Examples for each rule form and the path conventions.', 'Permission rule syntax'],
      ['Sandbox switches', 'Turn the sandbox on, decide whether to stop when it cannot start, auto-approve sandboxed commands, allow Claude to request unsandboxed runs (then normal approval applies), allow local ports.', '`sandbox.enabled`, `failIfUnavailable`, `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands`, `network.allowLocalBinding` (FR-CFG-05)'],
      ['Network lists', 'Allowed and denied domains for sandboxed commands; strict mode denies everything else instead of prompting.', '`network.allowedDomains`, `deniedDomains`, `strictAllowlist`'],
      ['Filesystem lists', 'Paths sandboxed commands may write or may not read, and commands excluded from the sandbox.', '`filesystem.allowWrite`, `denyRead`, `denyWrite`; `excludedCommands`'],
    ],
  });

  // ------------------------------------------------------------------ P22
  window.SCREENS.push({
    id: 'P22',
    group: 'Settings',
    title: 'Settings — provider, account and environment',
    summary: 'How sessions reach a model: an Anthropic API key or a cloud provider. Credentials are stored on the server only. Below: environment variables per profile, runtime overrides and telemetry export.',
    frs: ['FR-AUTH-01..03', 'FR-CFG-04', 'FR-CFG-06', 'FR-OBS-02/03'],
    draw() {
      let s = settingsBase('Provider & account');
      const X = 300;
      s += t(X, 92, 'Provider & account', { s: 20, w: 700 });
      const provs = [['key', 'Anthropic API', 'API key', true], ['box', 'Amazon Bedrock', 'AWS credentials'], ['globe', 'Google Cloud', 'Agent Platform'], ['layers', 'Microsoft Foundry', 'Azure credentials'], ['link', 'LLM gateway', 'custom base URL']];
      provs.forEach(([icn, n, d, on], i) => {
        const x = X + i * 222;
        s += rect(x, 110, 210, 64, { r: 10, fill: on ? C.accentSoft : C.surface, stroke: on ? C.accent : C.border, sw: on ? 1.5 : 1 });
        s += radio(x + 12, 122, !!on);
        s += ic(icn, x + 36, 122, 16, on ? C.accent : C.ink2);
        s += t(x + 58, 135, n, { s: 13, w: 600 });
        s += t(x + 36, 158, d, { s: 11.5, c: C.muted });
      });

      s += panel(X, 190, 590, 270, { title: 'Anthropic API' });
      s += input(X + 16, 252, 380, { label: 'API key', val: '••••••••••••••••••••3f9a', mono: true });
      s += btn(X + 406, 252, 'Replace', { w: 80, h: 32 });
      s += btn(X + 494, 252, 'Test', { icon: 'play', w: 80, h: 32 });
      s += t(X + 16, 302, 'Stored in Windows Credential Manager · passed to sessions as ANTHROPIC_API_KEY', { s: 11.5, c: C.muted });
      s += status(X + 16, 314, 'good', 'Connected · Claude Code 2.1.302 · 7 models · 1.8 s');
      s += input(X + 16, 370, 270, { label: 'Base URL (optional)', ph: 'https://api.anthropic.com', mono: true, s: 12 });
      s += input(X + 302, 370, 272, { label: 'Client app ID (User-Agent)', val: 'code-agent/0.1', mono: true, s: 12 });
      s += t(X + 16, 432, 'claude.ai sign-in is not offered: SDK products authenticate with API keys or cloud providers.', { s: 11.5, c: C.muted });

      s += panel(X + 606, 190, 504, 270, { title: 'Account', sub: 'as reported by Claude Code' });
      s += kv(X + 622, 252, 'Key source', 'ANTHROPIC_API_KEY (Code Agent secret)', { kw: 120 });
      s += kv(X + 622, 278, 'Organization', 'Personal', { kw: 120 });
      s += kv(X + 622, 304, 'Plan', '— (API usage billing)', { kw: 120 });
      s += kv(X + 622, 330, 'Models', 'Fable 5.1, Opus 5.5, Sonnet 5, Haiku 4.5, …', { kw: 120 });
      s += kv(X + 622, 356, 'Rate limit', '84% of 5-hour window', { kw: 120 });
      s += t(X + 622, 398, 'Refreshed when a session starts.', { s: 11.5, c: C.muted });
      s += btn(X + 980, 420, 'Refresh', { icon: 'refresh', w: 112, h: 28, s: 12 });

      s += panel(X, 476, 720, 406, { title: 'Environment variables', sub: 'merged over the server environment' });
      s += btn(X + 572, 482, 'Add variable', { icon: 'plus', w: 132, h: 28, s: 12 });
      const cols = [[16, 'VARIABLE'], [300, 'VALUE'], [430, 'SCOPE'], [560, 'WHAT IT DOES']];
      cols.forEach(([dx, h]) => (s += t(X + dx, 538, h, { s: 10.5, w: 700, c: C.muted, ls: 0.4 })));
      const env = [
        ['API_TIMEOUT_MS', '600000', 'All profiles', 'wait per request'],
        ['CLAUDE_CODE_MAX_RETRIES', '10', 'All profiles', 'API retries'],
        ['CLAUDE_CODE_RETRY_WATCHDOG', '1', 'Headless CI', 'retry outages'],
        ['CLAUDE_ENABLE_STREAM_WATCHDOG', '1', 'All profiles', 'abort stalls'],
        ['CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH', '3', 'Default', 'subagent depth'],
        ['ENABLE_TOOL_SEARCH', 'auto:10', 'Reviewer', 'defer schemas'],
        ['MCP_TIMEOUT', '30000', 'All profiles', 'MCP connect wait'],
        ['DEBUG_TOKEN', '••••••', 'Default', 'secret ref'],
      ];
      env.forEach(([k2, v, sc, d], i) => {
        const y = 548 + i * 40;
        s += hline(X + 1, y, 718, '#eef0f4');
        s += t(X + 16, y + 25, k2, { s: 11.5, m: true });
        s += t(X + 300, y + 25, v, { s: 12, m: true, c: C.ink2 });
        s += t(X + 430, y + 25, sc, { s: 12, c: C.ink2 });
        s += t(X + 560, y + 25, d, { s: 12, c: C.muted });
      });

      s += panel(X + 736, 476, 374, 406, { title: 'Runtime & telemetry' });
      s += kv(X + 752, 538, 'Claude Code', 'bundled 2.1.302', { kw: 110 });
      s += t(X + 1094, 538, 'Override…', { s: 12, c: C.accent, a: 'end' });
      s += kv(X + 752, 564, 'JS runtime', 'auto (node)', { kw: 110 });
      s += toggle(X + 752, 584, true, 'Debug log', { s: 12.5 });
      s += input(X + 752, 612, 342, { h: 30, val: '~/.code-agent/logs/claude-debug.log', mono: true, s: 11.5 });
      s += t(X + 752, 662, 'stderr of each session is kept in the Events panel.', { s: 11.5, c: C.muted });
      s += hline(X + 736, 680, 374);
      s += toggle(X + 752, 696, false, 'Export OpenTelemetry', { s: 12.5 });
      s += input(X + 752, 726, 342, { h: 30, ph: 'OTLP endpoint, e.g. http://localhost:4318', mono: true, s: 11.5 });
      s += check(X + 752, 770, false, 'Metrics', { s: 12.5 });
      s += check(X + 840, 770, false, 'Logs', { s: 12.5 });
      s += check(X + 914, 770, false, 'Traces (beta)', { s: 12.5 });
      s += check(X + 752, 800, false, 'Include prompt text', { s: 12.5 });
      s += check(X + 752, 828, false, 'Include tool inputs and output', { s: 12.5 });
      s += t(X + 752, 866, 'Nothing leaves this machine unless enabled.', { s: 11.5, c: C.muted });

      s += mk(X - 6, 114, 1) + mk(X - 6, 256, 2) + mk(X + 576, 248, 3) + mk(X - 6, 374, 4) + mk(X + 602, 194, 5);
      s += mk(X - 6, 534, 6) + mk(X + 568, 484, 7) + mk(X + 730, 534, 8) + mk(X + 730, 592, 9) + mk(X + 730, 704, 10);
      return s;
    },
    notes: [
      ['Provider', 'Anthropic API key, Amazon Bedrock, Google Cloud Agent Platform, Microsoft Foundry, or an LLM gateway. Each shows the fields it needs (region, project, credentials profile…).', '`ANTHROPIC_API_KEY`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`, `ANTHROPIC_BASE_URL` (FR-AUTH-01)'],
      ['Key storage', 'Keys go to the OS credential store when available (otherwise encrypted in the app data folder) and are injected into each session\'s environment; the browser only ever sees the last four characters.', '`Options.env` (NFR-04)'],
      ['Test', 'Starts a throwaway session and reports the Claude Code version, available models and latency — or the exact start-up failure reason.', '`startup()`, `initializationResult()`, `startup_failure_reason` (FR-AUTH-03)'],
      ['Base URL and client ID', 'Optional gateway URL; the client app ID identifies Code Agent in API request headers.', '`ANTHROPIC_BASE_URL`, `CLAUDE_AGENT_SDK_CLIENT_APP`'],
      ['Account', 'What Claude Code reports for the credentials in use.', '`accountInfo()` → `AccountInfo`, init `apiKeySource`, `supportedModels()` (FR-AUTH-02)'],
      ['Environment variables', 'Variables passed to sessions, each scoped to all profiles or one profile. Values can reference secrets. Known variables show what they do.', '`Options.env` (FR-CFG-04)'],
      ['Add variable', 'Offers known variables with descriptions and defaults (timeouts, retries, watchdogs, subagent limits, tool search, MCP timeouts).', 'Claude Code environment variables'],
      ['Runtime override', 'Point to another Claude Code executable or JS runtime (advanced); the version in use is always shown.', '`pathToClaudeCodeExecutable`, `executable`, `executableArgs` (FR-CFG-06)'],
      ['Debug log', 'Turns on Claude Code debug logging to a file for troubleshooting.', '`debug`, `debugFile`, `stderr` (FR-OBS-02)'],
      ['Telemetry', 'Optional OpenTelemetry export with explicit opt-ins for sensitive content.', '`OTEL_*`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA`, `OTEL_LOG_USER_PROMPTS`, `OTEL_LOG_TOOL_DETAILS` (FR-OBS-03)'],
    ],
  });

  // ------------------------------------------------------------------ P23
  window.SCREENS.push({
    id: 'P23',
    group: 'Live session',
    title: 'Event inspector',
    summary: 'A developer panel docked under the transcript: every raw SDK message for the session in order, with filters, search and a JSON view; plus Claude Code\'s stderr and hook activity.',
    frs: ['FR-OBS-01', 'FR-OBS-02', 'FR-OBS-04', 'FR-HOOK-04'],
    draw() {
      let s = K.shell({ nav: 'sessions' });
      s += K.sessionColumn({ active: 0 });
      s += rect(L.MX, 49, 1135, 851, { fill: C.page });
      s += K.sessionHeader(L.MX, 49, L.MW, { state: 'idle', cost: '$0.21', ctx: 22 });
      s += K.userMsg(L.TX, 122, L.TW, 'The checkout tests fail randomly on CI. Find the cause and fix it.');
      s += t(L.TX, 202, 'Fixed: the cart timer is now injected and disposed with the cart. 41 tests pass 20× in a row.', { s: 14 });
      s += rect(L.TX, 222, L.TW, 26, { r: 6, fill: C.surface2 });
      s += t(L.TX + 12, 239, 'Turn 1 · 1m 12s · 14 tool calls · $0.21 · stop: end_turn', { s: 11.5, c: C.muted });

      const Y = 300;
      s += rect(L.MX, Y, 1135, 600, { fill: C.surface }) + hline(L.MX, Y, 1135, C.borderStrong);
      s += tabs(L.MX + 16, Y + 26, [['Events', 214], ['stderr', 3], ['Hooks', 12]], 0, { s: 13, gap: 24 });
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
      s += input(1110, Y + 50, 200, { h: 28, icon: 'search', ph: 'Search JSON', s: 12 });
      s += btn(1318, Y + 50, 'Live', { icon: 'play', w: 74, h: 28, s: 12, v: 'soft' });

      const TW = 600;
      const cols = [[16, 'SEQ'], [70, 'TIME'], [150, 'TYPE'], [330, 'SUMMARY']];
      cols.forEach(([dx, h]) => (s += t(L.MX + dx, Y + 102, h, { s: 10.5, w: 700, c: C.muted, ls: 0.4 })));
      const evs = [
        ['1', '14:00:01.204', 'system/init', 'opus-5-5 · 23 tools · 2 MCP · default'],
        ['2', '14:00:01.210', 'system/session_state', 'running'],
        ['3', '14:00:02.611', 'assistant', 'thinking (6 s)'],
        ['4', '14:00:08.940', 'assistant', 'tool_use Read src/cart/timer.ts'],
        ['5', '14:00:09.002', 'user', 'tool_result (2.1 KB)'],
        ['…', '', '', ''],
        ['201', '14:01:09.870', 'tool_progress', 'Bash · 11.8 s'],
        ['205', '14:01:10.554', 'system/hook_response', 'PostToolUse · Audit log · ok'],
        ['211', '14:01:12.003', 'assistant', 'text (412 chars)'],
        ['213', '14:01:13.416', 'result/success', '1m 12s · 14 turns · $0.2131', true],
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
      s += t(J, Y + 104, 'result/success · seq 213', { s: 13, w: 700 });
      s += btn(J + 330, Y + 86, 'Copy', { icon: 'copy', w: 72, h: 26, s: 12 });
      s += t(J + 412, Y + 103, 'In transcript', { s: 12, c: C.accent });
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
        [['  "result"', C.accent], [': '], ['"Fixed: the cart timer is now injected…"', C.goodInk]],
        '}',
      ], { s: 12, lh: 19, h: 300 });
      s += t(J, Y + 446, 'Raw messages are kept for the session\'s life (ring buffer: last 5 000).', { s: 11.5, c: C.muted });

      s += mk(L.MX + 12, Y + 66, 1) + mk(fx - 10, Y + 52, 2) + mk(1106, Y + 54, 3) + mk(1390, Y + 54, 4) + mk(L.MX + 590, Y + 126, 5);
      s += mk(J - 6, Y + 124, 6) + mk(L.MX + 100, Y + 12, 7) + mk(1288, Y + 12, 8);
      return s;
    },
    notes: [
      ['Type filters', 'Toggle message types on and off; counts update live. Subtypes (e.g. `system/task_progress`) are grouped under their type and can be expanded.', 'All `SDKMessage` variants'],
      ['Stream events', 'Token-level stream events are hidden by default because there are thousands; turn them on to debug streaming.', '`stream_event` (`SDKPartialAssistantMessage`)'],
      ['Search', 'Full-text search over the JSON of all kept events.', '—'],
      ['Live / paused', 'Live follows new events; pausing freezes the list while events keep arriving in the background.', '—'],
      ['Event list', 'Sequence number (the same one used for reconnect replay), time, type/subtype and a readable summary.', 'Server event `seq`'],
      ['JSON view', 'The selected message as collapsible JSON with copy, and a link to the matching place in the transcript.', '—'],
      ['stderr and Hooks tabs', 'stderr shows Claude Code\'s error output for this session (with debug output when enabled); Hooks lists hook start / progress / response events.', '`stderr` callback; `hook_*` messages (FR-OBS-02, FR-HOOK-04)'],
      ['Export', 'Downloads the kept events as JSON Lines for bug reports.', '—'],
    ],
  });

  // ------------------------------------------------------------------ P24
  window.SCREENS.push({
    id: 'P24',
    group: 'Live session',
    title: 'Session states and messages',
    summary: 'How the session view reports limits, errors, retries and other system events. Each state says what happened in plain words and offers the next action.',
    frs: ['FR-OUT-07..09', 'FR-SES-14', 'FR-MISC-04', 'FR-PERM-09', 'FR-CTX-03', 'FR-COST-04'],
    draw() {
      let s = rect(0, 0, 1440, 900, { fill: C.page });
      const cards = [
        ['Max turns reached', 'warn', 'Stopped after 50 turns', 'The task is not finished (error_max_turns).', ['Continue with +50 turns', 'Change limits…']],
        ['Budget cap reached', 'warn', 'Budget cap of $5.00 reached', 'Spent $5.07 (error_max_budget_usd).', ['Continue with a $10 cap', 'Open usage']],
        ['Session crashed', 'crit', 'Session ended unexpectedly', 'Claude Code exited with code 1 (error_during_execution).', ['Resume session', 'View stderr']],
        ['API retry', 'info', 'Anthropic API overloaded (529)', 'Retrying 2 of 10 in 8 s…', ['Interrupt']],
        ['Rate limit', 'warn', '90% of your 5-hour limit used', 'Resets at 21:30. New requests may be rejected.', ['Usage']],
        ['Model fallback', 'info', 'Opus 5.5 declined; retried on Sonnet 5', 'The reply below came from the fallback model.', ['Why?']],
        ['Compaction', 'info', 'Compacting conversation…', '182k tokens → about 40k. Older messages become a summary.', []],
        ['Connection', 'idle', 'Connection lost — reconnecting (attempt 3)…', 'The session keeps running on the server.', []],
        ['Start-up failure', 'crit', 'Session could not start', 'cwd_unavailable — D:\\old\\shop-api no longer exists.', ['Choose another folder', 'Details']],
        ['Process shutting down', 'warn', 'Claude Code is shutting down', 'Reason: update installed. The transcript is saved.', ['Resume session']],
        ['Denied tool calls', 'warn', 'Claude was denied 2 tool calls this turn', 'Bash rm -rf dist · WebFetch pastebin.com', ['Review…']],
        ['Empty workspace', 'idle', 'No sessions in this workspace yet', 'Start one, or continue a session from another workspace.', ['Start a session']],
      ];
      cards.forEach(([cap, kind, title, body, actions], i) => {
        const x = 30 + (i % 3) * 467;
        const y = 34 + Math.floor(i / 3) * 214;
        s += t(x, y + 12, cap.toUpperCase(), { s: 11, w: 700, c: C.muted, ls: 0.5 });
        s += rect(x, y + 22, 446, 176, { r: 10, fill: C.surface, stroke: C.border });
        const tone = { warn: [C.warnSoft, C.warnInk, 'warning', '#f1d38a'], crit: [C.critSoft, C.crit, 'x', '#efb4b4'], info: [C.accentSoft, C.accent, 'info', C.accentLine], idle: [C.surface2, C.ink2, 'clock', C.border] }[kind];
        const bx = x + 16;
        const by = y + 40;
        if (cap === 'Compaction') {
          s += rect(bx, by, 414, 56, { r: 8, fill: tone[0], stroke: tone[3] });
          s += circle(bx + 20, by + 20, 7, { stroke: C.accent, sw: 2.5 });
          s += t(bx + 38, by + 24, title, { s: 13, w: 700, c: tone[1] });
          s += progress(bx + 38, by + 36, 360, 60, C.accent, 5);
          s += line(bx, by + 98, bx + 414, by + 98, { c: C.borderStrong, dash: '4 4' });
          s += rect(bx + 70, by + 88, 274, 20, { r: 10, fill: C.surface, stroke: C.border });
          s += t(bx + 207, by + 102, 'Conversation compacted · auto · 182k before', { s: 11, c: C.ink2, a: 'middle' });
          s += t(bx, by + 136, body, { s: 12, c: C.muted });
        } else if (cap === 'Connection') {
          s += rect(bx, by, 414, 48, { r: 8, fill: tone[0], stroke: tone[3] });
          s += ic('refresh', bx + 12, by + 16, 16, C.ink2);
          s += t(bx + 38, by + 21, title, { s: 13, w: 700, c: C.ink });
          s += t(bx + 38, by + 38, body, { s: 12, c: C.ink2 });
          s += rect(bx, by + 60, 414, 34, { r: 8, fill: C.goodSoft, stroke: '#b7e3b7' });
          s += ic('check', bx + 12, by + 69, 16, C.goodInk, 2.2);
          s += t(bx + 38, by + 82, 'Reconnected · 214 events replayed', { s: 12.5, w: 600, c: C.goodInk });
          s += t(bx, by + 126, 'Pending approvals reappear after reconnecting.', { s: 12, c: C.muted });
        } else if (cap === 'Empty workspace') {
          s += circle(x + 223, by + 34, 28, { fill: C.surface3 });
          s += ic('chat', x + 209, by + 20, 28, C.ink2);
          s += t(x + 223, by + 88, title, { s: 14, w: 700, a: 'middle' });
          s += t(x + 223, by + 108, body, { s: 12, c: C.ink2, a: 'middle' });
          s += btn(x + 163, by + 120, actions[0], { v: 'primary', icon: 'plus', w: 120, h: 28, s: 12 });
        } else {
          s += rect(bx, by, 414, 92, { r: 8, fill: tone[0], stroke: tone[3] });
          s += ic(tone[2], bx + 12, by + 14, 18, tone[1], 2);
          s += t(bx + 40, by + 28, title, { s: 13.5, w: 700, c: kind === 'idle' ? C.ink : tone[1] });
          s += para(bx + 40, by + 49, body, 362, { s: 12, c: C.ink2, lh: 17, m: cap === 'Denied tool calls' });
          let ax = bx + 40;
          actions.forEach((a, j) => {
            const w = K.btnW(a, { s: 12 });
            s += btn(ax, by + 100, a, { h: 28, s: 12, v: j === 0 && kind !== 'info' ? 'primary' : 'secondary' });
            ax += w + 8;
          });
          if (kind === 'info' && cap === 'API retry') s += circle(bx + 396, by + 22, 7, { stroke: C.accent, sw: 2.5 });
        }
        s += mk(x + 438, y + 26, i + 1);
      });
      return s;
    },
    notes: [
      ['Max turns', 'Shown at the end of the transcript. "Continue" resumes with a higher limit in the same session.', '`error_max_turns` → `resume` + `maxTurns` (FR-OUT-07)'],
      ['Budget cap', 'Same pattern for the cost cap; the amount spent is shown.', '`error_max_budget_usd` → `resume` + `maxBudgetUsd`'],
      ['Crash', 'The process ended; the transcript is saved and can be resumed. stderr is one click away.', '`error_during_execution`, `stderr`'],
      ['API retry', 'Transient, replaced by the reply once a retry succeeds. Interrupt stops waiting.', '`api_retry` message; `interrupt()` (FR-OUT-08)'],
      ['Rate limit', 'Warning when close to the limit; red when requests are rejected, with the reset time.', '`rate_limit_event` (FR-COST-04)'],
      ['Model fallback', 'Marks replies that came from the fallback model after a refusal.', '`model_refusal_fallback` / `model_refusal_no_fallback`'],
      ['Compaction', 'Progress while compacting, then a divider in the transcript with the trigger and the size before.', '`status: "compacting"`, `compact_boundary` (FR-CTX-03)'],
      ['Connection', 'Browser ↔ server connection loss; the session keeps running. On reconnect the missed events replay and pending requests reappear.', 'Event `seq` replay; `reinitialize()` (FR-SES-14)'],
      ['Start-up failure', 'The SDK\'s reason code in plain words with a fix (pick another folder, sign in, update Claude Code…).', '`startup_failure_reason` (FR-OUT-07)'],
      ['Process shutting down', 'Claude Code announced it is stopping; offer to resume.', '`worker_shutting_down` (FR-MISC-04)'],
      ['Denied tool calls', 'After a turn, lists calls that were denied (by rule, mode, sandbox or the user) with a way to allow them next time.', '`permission_denials`, `permission_denied` (FR-PERM-09)'],
      ['Empty state', 'Lists and the transcript show a one-line explanation and the primary action.', '—'],
    ],
  });
})();
