/**
 * Code review. Nothing starts until the user clicks 提交审核; then Code Agent loops on its own until
 * the reviewer passes the change, the round limit is reached, or the user stops it. Each round:
 * snapshot the working tree into a hidden ref, run the workspace's check commands (Code Agent runs
 * them, not Claude), then have the author session run the read-only code-reviewer subagent. A
 * PreToolUse hook pins the subagent's prompt, model and effort; its verdict comes back through
 * submit_review, the author's answers through respond_findings. Rounds 1–3 look at the whole
 * change, later rounds only at what changed since the previous round.
 */
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { Effort, ReviewCheck, ReviewFinding, ReviewRound, ReviewTicket, ToolItem } from '@code-agent/shared/types';
import { app, set, update } from './state';
import { broadcast, register } from './hub';
import { load, save } from './store';
import { addItem, patchItem, rt, summary } from './sessions/registry';
import { addHook, decorateTool, inTurn, interruptTurn, live, markDenied, onProcessEnd, onSendTurn, onTurnEnd, sendTurn } from './sessions/live';
import { addSessionAgents, cwdOf } from './sessions/options';
import { addBusyCheck } from './sessions/slots';
import { addQueueBlocker, pumpQueue } from './sessions/ops';
import { head, isRepo, numstat, snapshot } from './git';
import { readOnlyCommand } from '@code-agent/shared/readonly';
import { addWorkspaceTools } from './peer';

const GLOBAL_ROUNDS = 3;
const MAX_CHECK_ATTEMPTS = 3;
const RUNNING: Array<ReviewTicket['status']> = ['checking', 'reviewing', 'fixing'];
const ACTIVE: Array<ReviewTicket['status']> = [...RUNNING, 'needs_decision', 'checks_failed'];

/** What the loop waits for in each ticket's author session. */
interface Pending {
  /** check-fix: the author fixes a failed check; review: the round's reviewer + fixes; more: fixes after extra rounds were granted. */
  step: 'check-fix' | 'review' | 'more';
  round: number;
  /** Index into the session's file changes when the step started. */
  changesAt: number;
  attempt?: number;
  /** The reviewer was asked once more after it did not submit a verdict. */
  retried?: boolean;
}

const pending = new Map<string, Pending>();
const stopping = new Set<string>();
const checkProcs = new Map<string, ChildProcess>();
/** Snapshot commits per ticket: [base, r1, r2…]. */
const snaps = new Map<string, string[]>();

/** Commit each session started from (base of its first review), kept across restarts. */
const sessionBase = load<Record<string, string>>('review-base', {});

// Tickets that were running when the server stopped cannot continue.
if (app.reviews.some((t) => RUNNING.includes(t.status))) {
  app.reviews = app.reviews.map((t) => (RUNNING.includes(t.status) ? { ...t, status: 'stopped', endedAt: Date.now(), note: 'Code Agent 服务重启，审核中断' } : t));
  save('slice:reviews', () => app.reviews);
}

const get = (id: string) => app.reviews.find((t) => t.id === id);
function updateTicket(id: string, fn: (t: ReviewTicket) => ReviewTicket) {
  update('reviews', (list) => list.map((t) => (t.id === id ? fn(t) : t)));
}
function setRound(id: string, n: number, fn: (r: ReviewRound) => ReviewRound) {
  updateTicket(id, (t) => ({ ...t, rounds: t.rounds.map((r) => (r.n === n ? fn(r) : r)) }));
}
function setFinding(id: string, fid: string, p: Partial<ReviewFinding>) {
  updateTicket(id, (t) => ({ ...t, findings: t.findings.map((f) => (f.id === fid ? { ...f, ...p } : f)) }));
}

export function activeTicket(sid: string): ReviewTicket | undefined {
  return app.reviews.find((t) => t.sessionId === sid && ACTIVE.includes(t.status));
}

addBusyCheck((sid) => !!activeTicket(sid));
// Queued user messages wait while Code Agent runs the checks between turns.
addQueueBlocker((sid) => activeTicket(sid)?.status === 'checking');

function notify(sid: string, kind: 'request' | 'background', title: string, body: string, tone: 'good' | 'warn') {
  broadcast({ t: 'notify', n: { kind, sid, title, body, tone, action: kind === 'request' ? '去处理' : '查看' } });
}

// Remember where a session started so its first review compares against that commit.
onSendTurn((sid) => {
  if (sessionBase[sid]) return;
  const cwd = cwdOf(sid);
  void head(cwd).then((h) => {
    if (h && !sessionBase[sid]) {
      sessionBase[sid] = h;
      save('review-base', () => sessionBase);
    }
  });
});

// ------------------------------------------------------------------ starting

async function startReview(sid: string, checks: string[], opts: { model?: string; effort?: Effort }): Promise<string | null> {
  const sum = summary(sid);
  if (!sum || !live(sid) || inTurn(sid) || activeTicket(sid)) return null;
  const cwd = cwdOf(sid);
  set('reviewChecks', { ...app.reviewChecks, [sum.workspaceId]: checks });
  const id = `rv-${randomUUID().slice(0, 8)}`;
  const repo = await isRepo(cwd);
  const base = repo ? (lastPassed.get(sid) ?? sessionBase[sid] ?? (await head(cwd)) ?? '') : '';
  const model = opts.model ?? app.reviewProfile.model;
  const effort = opts.effort ?? app.reviewProfile.effort;
  set('reviews', [{ id, sessionId: sid, status: 'checking', base: base ? base.slice(0, 9) : '（不是 git 仓库）', maxRounds: 5, rounds: [], findings: [], checks, model, effort, startedAt: Date.now(), tokens: 0 }, ...app.reviews]);
  snaps.set(id, [base]);
  void beginRound(id, 1);
  return id;
}

/** Snapshot of the last passed review per session, so the next review starts from there. */
const lastPassed = new Map<string, string>();

async function beginRound(id: string, n: number) {
  const t = get(id)!;
  const sid = t.sessionId;
  const cwd = cwdOf(sid);
  const scope: ReviewRound['scope'] = n <= GLOBAL_ROUNDS ? 'global' : 'incremental';
  const list = snaps.get(id) ?? [''];
  const base = list[0];
  const prev = list[n - 1] ?? base;
  let snap = '';
  let diff = { files: 0, add: 0, del: 0 };
  if (base) {
    try {
      snap = await snapshot(cwd, `refs/code-agent/review/${id}/r${n}`, `Code Agent review ${id} round ${n}`);
      const d = await numstat(cwd, scope === 'global' ? base : prev, snap);
      diff = { files: d.files, add: d.add, del: d.del };
    } catch (e) {
      addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `无法给工作区拍快照：${e instanceof Error ? e.message : String(e)}。这一轮按会话记录的改动审核。` });
    }
  }
  if (!snap) {
    const changes = rt(sid)?.changes.slice(app.reviewed[sid] ?? 0) ?? [];
    diff = { files: new Set(changes.map((c) => c.path)).size, add: changes.reduce((a, c) => a + c.add, 0), del: changes.reduce((a, c) => a + c.del, 0) };
  }
  snaps.set(id, [...list.slice(0, n), snap]);
  const short = (c: string) => (c ? c.slice(0, 9) : '');
  const range = snap ? (scope === 'global' ? `${short(base)}..r${n}` : `r${n - 1}..r${n}`) : '会话记录的改动';
  updateTicket(id, (x) => ({
    ...x, status: 'checking', rounds: [...x.rounds, {
      n, scope, snapshot: snap ? `refs/code-agent/review/${id}/r${n}` : '', range, diff, checks: [], raised: [], rulings: [], answers: [], authorFiles: [], startedAt: Date.now(),
    }],
  }));
  const skip = t.checks.length === 0;
  addItem(sid, { kind: 'divider', id: randomUUID(), label: `代码审核 · 第 ${n} 轮 · ${scope === 'global' ? '全局审核' : `增量审核（只看第 ${n - 1} 轮之后的修改）`}${skip ? ' · 跳过验证' : ''}` });
  if (skip) askReviewer(id, n);
  else {
    addItem(sid, { kind: 'review', id: randomUUID(), ticketId: id, round: n, what: 'check' });
    void runChecks(id, n, 1);
  }
}

// ------------------------------------------------------------------ checks

function runCommand(id: string, cwd: string, cmd: string): Promise<{ ok: boolean; output: string[]; seconds: number }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const out: string[] = [];
    const p = spawn(cmd, { cwd, shell: true, windowsHide: true, env: process.env });
    checkProcs.set(id, p);
    const add = (b: Buffer) => {
      out.push(...b.toString('utf8').replace(/\r\n/g, '\n').split('\n'));
      if (out.length > 2000) out.splice(0, out.length - 2000);
    };
    p.stdout.on('data', add);
    p.stderr.on('data', add);
    const timer = setTimeout(() => p.kill(), 15 * 60_000);
    p.on('close', (code) => {
      clearTimeout(timer);
      checkProcs.delete(id);
      const lines = out.filter((l, i) => l.trim() || i < out.length - 1);
      resolve({ ok: code === 0, output: [`> ${cmd}`, ...lines.slice(-200), ...(code === 0 ? [] : [`退出码 ${code ?? '（被终止）'}`])], seconds: Math.round((Date.now() - t0) / 100) / 10 });
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      checkProcs.delete(id);
      resolve({ ok: false, output: [`> ${cmd}`, e.message], seconds: 0 });
    });
  });
}

async function runChecks(id: string, n: number, attempt: number) {
  const t = get(id)!;
  const sid = t.sessionId;
  const cwd = cwdOf(sid);
  updateTicket(id, (x) => ({ ...x, status: 'checking' }));
  const check: ReviewCheck = { attempt, ok: null, commands: t.checks.map((cmd) => ({ cmd, ok: null, output: [], seconds: 0 })) };
  setRound(id, n, (r) => ({ ...r, checks: [...r.checks, check] }));
  let failed = -1;
  for (let i = 0; i < t.checks.length; i++) {
    const res = await runCommand(id, cwd, t.checks[i]);
    if (get(id)?.status !== 'checking') return; // stopped meanwhile
    setRound(id, n, (r) => ({ ...r, checks: r.checks.map((c) => (c.attempt !== attempt ? c : { ...c, commands: c.commands.map((x, j) => (j === i ? { ...x, ...res } : x)) })) }));
    if (!res.ok) {
      failed = i;
      break;
    }
  }
  const ok = failed < 0;
  setRound(id, n, (r) => ({ ...r, checks: r.checks.map((c) => (c.attempt === attempt ? { ...c, ok } : c)) }));
  if (ok) {
    askReviewer(id, n);
    return;
  }
  if (attempt >= MAX_CHECK_ATTEMPTS) {
    updateTicket(id, (x) => ({ ...x, status: 'checks_failed' }));
    notify(sid, 'request', `「${summary(sid)?.title ?? ''}」的代码审核需要你决定`, `验证连续 ${MAX_CHECK_ATTEMPTS} 次没有通过`, 'warn');
    pumpQueue(sid);
    return;
  }
  const cmd = t.checks[failed];
  const output = get(id)!.rounds[n - 1].checks.find((c) => c.attempt === attempt)!.commands[failed].output.slice(-40).join('\n');
  pending.set(id, { step: 'check-fix', round: n, changesAt: rt(sid)?.changes.length ?? 0, attempt });
  updateTicket(id, (x) => ({ ...x, status: 'fixing' }));
  sendTurn(sid, {
    fromApp: `代码审核 · 第 ${n} 轮 · 验证`,
    text: `Code Agent 运行验证没有通过（第 ${attempt} 次，最多 ${MAX_CHECK_ATTEMPTS} 次）：\`${cmd}\` 失败。\n\n\`\`\`\n${output}\n\`\`\`\n\n请修复，然后结束这一轮。Code Agent 会重新运行验证。`,
  });
}

// ------------------------------------------------------------------ the reviewer

function askReviewer(id: string, n: number, retry = false) {
  const t = get(id)!;
  const sid = t.sessionId;
  const round = t.rounds[n - 1];
  const last = n >= t.maxRounds;
  updateTicket(id, (x) => ({ ...x, status: 'reviewing' }));
  pending.set(id, { step: 'review', round: n, changesAt: rt(sid)?.changes.length ?? 0, retried: retry });
  sendTurn(sid, {
    fromApp: `代码审核 · 第 ${n} 轮`,
    text: [
      retry ? '审核子代理上一次没有用 submit_review 提交结论。请再调用一次。' : '',
      `Code Agent 代码审核第 ${n} 轮（最多 ${t.maxRounds} 轮），${round.scope === 'global' ? '全局审核' : '增量审核'}：${round.range}，${round.diff.files} 个文件 +${round.diff.add} −${round.diff.del}。`,
      '请现在用 Agent 工具调用 code-reviewer 子代理（subagent_type 填 "code-reviewer"，prompt 写「第 N 轮」即可，审核要求由 Code Agent 填入）。',
      last
        ? '这是最后一轮：拿到结论后简短说明。如果被打回，先不要修改，等用户决定。'
        : '拿到结论后：通过就简短说明并结束；打回就逐条处理意见——能改的改掉，不同意的写明理由——然后用 workspace 的 respond_findings 工具逐条答复（fixed 或 disputed），再结束这一轮。',
    ].filter(Boolean).join('\n'),
  });
}

/** What the reviewer subagent is told in round n (pinned by the PreToolUse hook). */
function roundPrompt(t: ReviewTicket, n: number): string {
  const round = t.rounds[n - 1];
  const list = snaps.get(t.id) ?? [];
  const base = list[0];
  const snap = list[n];
  const prev = list[n - 1] ?? base;
  const sum = summary(t.sessionId);
  const goals = (rt(t.sessionId)?.items ?? []).filter((x): x is Extract<typeof x, { kind: 'user' }> => x.kind === 'user' && !x.fromApp).slice(-4).map((x) => `- ${x.text.slice(0, 600)}`);
  const earlier = t.findings.filter((f) => f.round < n);
  const where = snap
    ? round.scope === 'global'
      ? `Review the whole change: \`git diff ${base} ${snap}\` (base = where the work started, ${snap.slice(0, 9)} = snapshot of the working tree for this round). Trace its impact: callers, data flow, config, tests, docs.`
      : `Incremental round: review only what changed since the previous round, \`git diff ${prev} ${snap}\`, and whether earlier findings are resolved. Raise new findings only for defects these changes introduced.`
    : `The workspace is not a git repository. The files the session changed: ${[...new Set((rt(t.sessionId)?.changes ?? []).map((c) => c.path))].join(', ')}. Read them.`;
  return [
    `You are the code reviewer for round ${n} of at most ${t.maxRounds} of a change made in session "${sum?.title ?? ''}".`,
    where,
    'Correctness only: bugs, broken behaviour, data loss, security, missing error handling, tests that do not test what they claim, mismatches with the goal. Skip style, naming and formatting.',
    goals.length ? `What the user asked for:\n${goals.join('\n')}` : '',
    earlier.length ? `Earlier findings (rule on each one the author answered: verified = fixed correctly, upheld = the author's dispute is right, open = still a problem):\n${earlier.map((f) => `- ${f.id} [${f.severity}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.title} — status ${f.status}${f.response ? `; author: ${f.response}` : ''}`).join('\n')}` : '',
    'Severity: blocker = breaks the build, loses data or is a security hole; major = wrong behaviour users will hit; minor = worth fixing but not blocking. The change passes when no blocker or major finding remains open.',
    'You are read-only: use Read, Grep, Glob and read-only shell commands (git diff/log/show/status, ls, cat, grep, find; on Windows the shell tool is PowerShell). Do not edit anything.',
    'When done, call mcp__workspace__submit_review exactly once with your findings and rulings, then reply with a two-line summary.',
    app.reviewProfile.extraPrompt.trim() ? `Additional review requirements from the user:\n${app.reviewProfile.extraPrompt.trim()}` : '',
  ].filter(Boolean).join('\n\n');
}

/** The ticket whose reviewer is running in this session, if any. */
function reviewing(sid: string): { t: ReviewTicket; n: number } | undefined {
  const t = activeTicket(sid);
  const p = t && pending.get(t.id);
  return t && p?.step === 'review' && t.status === 'reviewing' ? { t, n: p.round } : undefined;
}

// The author may only start the reviewer when Code Agent asks; its prompt, model and effort are fixed here.
addHook('PreToolUse', (sid, input) => {
  const name = String(input.tool_name ?? '');
  const ti = (input.tool_input ?? {}) as Record<string, unknown>;
  if ((name === 'Agent' || name === 'Task') && ti.subagent_type === 'code-reviewer') {
    const r = reviewing(sid);
    if (!r) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The code-reviewer subagent only runs when Code Agent starts a review round.' } };
    const model = r.t.model;
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'Code Agent review round',
        updatedInput: { ...ti, description: `code-reviewer · 第 ${r.n} 轮`, prompt: roundPrompt(r.t, r.n), run_in_background: false, ...(['opus', 'sonnet', 'haiku', 'fable'].includes(model) ? { model } : {}), effort: r.t.effort },
      },
    };
  }
  if (input.agent_type === 'code-reviewer' && (name === 'Bash' || name === 'PowerShell')) {
    const cmd = String(ti.command ?? '');
    if (readOnlyCommand(cmd)) return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'read-only command of the reviewer' } };
    markDenied(sid, String(input.tool_use_id ?? ''), '审核子代理只能运行只读命令');
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The code reviewer may only run read-only commands (git diff/log/show, ls, cat, grep, find…).' } };
  }
  if (input.agent_type === 'code-reviewer' && ['Edit', 'Write', 'NotebookEdit', 'MultiEdit'].includes(name)) {
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'The code reviewer is read-only.' } };
  }
  return undefined;
});

decorateTool((_sid, name, input, item) => {
  if ((name === 'Agent' || name === 'Task') && input.subagent_type === 'code-reviewer') item.provenance = '评审方案 · 只读 · 提示词由 Code Agent 固定';
  if (name === 'mcp__workspace__respond_findings') {
    const answers = (input.answers as Array<{ id: string; status: string; text: string }> | undefined) ?? [];
    item.rows = answers.map((a) => ({ icon: a.status === 'fixed' ? 'check' : 'chat', text: `${a.id} ${a.status === 'fixed' ? '已修改' : '有异议'}：${a.text}` }));
    item.detail = `${answers.length} 条`;
  }
});

addSessionAgents(() => {
  const p = app.reviewProfile;
  return {
    'code-reviewer': {
      description: 'Code Agent\'s read-only code reviewer. Only use it when a Code Agent review-round message asks you to; Code Agent supplies its instructions.',
      prompt: 'You review code changes for correctness. You never edit files. Follow the round instructions you are given exactly and finish by calling mcp__workspace__submit_review once.',
      tools: ['Read', 'Glob', 'Grep', 'Bash', 'PowerShell', 'mcp__workspace__submit_review', ...p.tools.filter((x) => x !== 'WebSearch' || app.provider.kind === 'subscription')],
      model: p.model,
      effort: p.effort,
      omitClaudeMd: !p.claudeMd,
    },
  };
});

// ------------------------------------------------------------------ verdicts and answers

const finding = z.object({
  severity: z.enum(['blocker', 'major', 'minor']), file: z.string(), line: z.number().int().optional(), title: z.string(), detail: z.string(),
});

addWorkspaceTools((sid) => [
  tool('submit_review', 'Submit the verdict of a Code Agent review round (only the code-reviewer subagent calls this, once per round).', {
    verdict: z.enum(['pass', 'changes_requested']),
    summary: z.string().describe('One or two sentences'),
    findings: z.array(finding).describe('New findings of this round'),
    rulings: z.array(z.object({ id: z.string(), status: z.enum(['verified', 'upheld', 'open']), note: z.string() })).optional().describe('Your ruling on earlier findings the author answered'),
  }, async (a) => {
    const r = reviewing(sid);
    if (!r) return { content: [{ type: 'text' as const, text: 'No review round is waiting for a verdict.' }], isError: true };
    const { t, n } = r;
    const start = t.findings.length;
    const added: ReviewFinding[] = a.findings.map((f, i) => ({ ...f, id: `R${start + i + 1}`, round: n, status: 'open' }));
    updateTicket(t.id, (x) => ({ ...x, findings: [...x.findings, ...added] }));
    const rulings = (a.rulings ?? []).filter((u) => t.findings.some((f) => f.id === u.id));
    for (const u of rulings) setFinding(t.id, u.id, { status: u.status, reviewerNote: u.note, closedIn: u.status === 'open' ? undefined : n });
    // Deterministic: the round passes when no blocker or major finding is open.
    const open = get(t.id)!.findings.filter((f) => (f.status === 'open' || f.status === 'fixed' || f.status === 'disputed') && f.severity !== 'minor');
    const verdict = open.length ? 'changes_requested' : 'pass';
    setRound(t.id, n, (x) => ({ ...x, verdict, raised: added.map((f) => f.id), rulings, reviewer: { model: t.model, seconds: 0, tokens: 0, toolCalls: 0, summary: a.summary } }));
    addItem(sid, { kind: 'review', id: randomUUID(), ticketId: t.id, round: n, what: 'verdict' });
    return { content: [{ type: 'text' as const, text: `Recorded: ${verdict === 'pass' ? 'pass' : `changes requested (${open.map((f) => f.id).join(', ')})`}${added.length ? `; new findings ${added.map((f) => f.id).join(', ')}` : ''}. Now reply to the author with a two-line summary.` }] };
  }),
  tool('respond_findings', 'Answer the findings of the current Code Agent review round: fixed (say what you changed) or disputed (say why).', {
    answers: z.array(z.object({ id: z.string(), status: z.enum(['fixed', 'disputed']), text: z.string() })),
  }, async (a) => {
    const t = activeTicket(sid);
    const p = t && pending.get(t.id);
    if (!t || !p) return { content: [{ type: 'text' as const, text: 'No review is waiting for answers.' }], isError: true };
    const known = a.answers.filter((x) => t.findings.some((f) => f.id === x.id));
    for (const x of known) setFinding(t.id, x.id, { status: x.status, response: x.text });
    setRound(t.id, p.round, (r) => ({ ...r, answers: [...r.answers.filter((y) => !known.some((k) => k.id === y.id)), ...known] }));
    if (t.status === 'reviewing') updateTicket(t.id, (x) => ({ ...x, status: 'fixing' }));
    return { content: [{ type: 'text' as const, text: `Recorded ${known.length} answer(s). End your turn when you are done; Code Agent then starts the next round.` }] };
  }),
]);

// ------------------------------------------------------------------ turn ends drive the loop

function recordFiles(id: string, n: number, sid: string, from: number, phase: 'check' | 'fix') {
  const files = (rt(sid)?.changes ?? []).slice(from).map((c) => ({ path: c.path, add: c.add, del: c.del, diff: c.diff, phase }));
  if (files.length) setRound(id, n, (r) => ({ ...r, authorFiles: [...r.authorFiles, ...files] }));
}

/** Reviewer stats from its Agent card. */
function reviewerStats(sid: string, id: string, n: number) {
  const items = rt(sid)?.items ?? [];
  const card = [...items].reverse().find((x): x is ToolItem => x.kind === 'tool' && !!x.agent && x.agent.agentType === 'code-reviewer');
  if (!card?.agent) return;
  const tokens = card.agent.tokens;
  setRound(id, n, (r) => (r.reviewer ? { ...r, reviewer: { ...r.reviewer, seconds: card.seconds ?? r.reviewer.seconds, tokens, toolCalls: card.agent!.toolCalls } } : r));
  updateTicket(id, (x) => ({ ...x, tokens: x.tokens + tokens }));
  if (card.status === 'running') patchItem(sid, card.id, { status: 'ok' });
}

function finish(id: string, status: ReviewTicket['status'], note: string) {
  const t = get(id)!;
  pending.delete(id);
  updateTicket(id, (x) => ({ ...x, status, endedAt: Date.now(), note: note || x.note }));
  if (status === 'passed' || status === 'accepted') {
    set('reviewed', { ...app.reviewed, [t.sessionId]: rt(t.sessionId)?.changes.length ?? 0 });
    const snap = snaps.get(id)?.[t.rounds.length];
    if (snap) lastPassed.set(t.sessionId, snap);
  }
  setTimeout(() => pumpQueue(t.sessionId), 0);
}

function stopped(id: string, by: string) {
  const t = get(id)!;
  finish(id, 'stopped', by);
  addItem(t.sessionId, { kind: 'notice', id: randomUUID(), tone: 'warn', text: `代码审核已停止：${by}。审核记录可以随时打开。`, action: '查看审核记录' });
}

onTurnEnd((sid, info) => {
  const t = activeTicket(sid);
  const p = t && pending.get(t.id);
  if (!t || !p) return;
  if (info.interrupted) {
    const by = stopping.has(t.id) ? '你停止了审核' : '你中断了这一轮，审核随之停止';
    stopping.delete(t.id);
    stopped(t.id, by);
    return;
  }
  if (p.step === 'check-fix') {
    recordFiles(t.id, p.round, sid, p.changesAt, 'check');
    pending.delete(t.id);
    void runChecks(t.id, p.round, (p.attempt ?? 1) + 1);
    return;
  }
  if (p.step === 'more') {
    recordFiles(t.id, p.round, sid, p.changesAt, 'fix');
    pending.delete(t.id);
    void beginRound(t.id, p.round + 1);
    return;
  }
  // step === 'review'
  const round = get(t.id)!.rounds[p.round - 1];
  reviewerStats(sid, t.id, p.round);
  if (!round.verdict) {
    if (!p.retried) {
      askReviewer(t.id, p.round, true);
      return;
    }
    updateTicket(t.id, (x) => ({ ...x, status: 'needs_decision', note: '审核子代理没有提交结论' }));
    notify(sid, 'request', `「${summary(sid)?.title ?? ''}」的代码审核需要你决定`, '审核子代理两次都没有提交结论', 'warn');
    pending.delete(t.id);
    pumpQueue(sid);
    return;
  }
  if (round.verdict === 'pass') {
    const minors = get(t.id)!.findings.filter((f) => f.status === 'open');
    finish(t.id, 'passed', minors.length ? `${minors.map((f) => f.id).join('、')} 是次要意见，没有修改` : '');
    addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'good', text: `代码审核通过（第 ${p.round} 轮）。${minors.length ? `还有 ${minors.length} 条次要意见没改，记在审核记录里。` : ''}`, action: '查看审核记录' });
    notify(sid, 'background', `「${summary(sid)?.title ?? ''}」代码审核通过`, `第 ${p.round} 轮通过`, 'good');
    return;
  }
  recordFiles(t.id, p.round, sid, p.changesAt, 'fix');
  pending.delete(t.id);
  if (p.round >= get(t.id)!.maxRounds) {
    updateTicket(t.id, (x) => ({ ...x, status: 'needs_decision' }));
    notify(sid, 'request', `「${summary(sid)?.title ?? ''}」的代码审核需要你决定`, `${get(t.id)!.maxRounds} 轮后仍未通过`, 'warn');
    pumpQueue(sid);
    return;
  }
  void beginRound(t.id, p.round + 1);
});

onProcessEnd((sid) => {
  const t = activeTicket(sid);
  if (t && RUNNING.includes(t.status)) stopped(t.id, 'Claude Code 进程结束了');
});

// ------------------------------------------------------------------ the user's controls

async function stopReview(sid: string) {
  const t = activeTicket(sid);
  if (!t) return;
  if (inTurn(sid)) {
    stopping.add(t.id);
    await interruptTurn(sid);
    return;
  }
  checkProcs.get(t.id)?.kill();
  stopped(t.id, '你停止了审核');
}

function decideReview(sid: string, choice: 'accept' | 'more' | 'takeover') {
  const t = activeTicket(sid);
  if (!t || inTurn(sid) || RUNNING.includes(t.status)) return;
  const open = t.findings.filter((f) => f.status === 'open' || f.status === 'disputed');
  if (choice === 'more') {
    const last = t.rounds[t.rounds.length - 1];
    updateTicket(t.id, (x) => ({ ...x, maxRounds: x.maxRounds + 2, status: 'fixing', note: undefined }));
    if (t.status === 'checks_failed') {
      void runChecks(t.id, last.n, 1);
      return;
    }
    pending.set(t.id, { step: 'more', round: last.n, changesAt: rt(sid)?.changes.length ?? 0 });
    sendTurn(sid, {
      fromApp: '代码审核 · 追加轮次',
      text: `用户追加了审核轮数（现在最多 ${t.maxRounds + 2} 轮）。请按第 ${last.n} 轮的意见修改：能改的改掉，不同意的写明理由，用 respond_findings 逐条答复，然后结束这一轮。`,
    });
    return;
  }
  const note = choice === 'accept' ? `你接受了现状${open.length ? `，${open.map((f) => f.id).join('、')} 没有解决` : ''}` : '由你接手处理剩下的意见';
  finish(t.id, choice === 'accept' ? 'accepted' : 'stopped', note);
  addItem(sid, { kind: 'notice', id: randomUUID(), tone: 'info', text: `代码审核结束：${note}。`, action: '查看审核记录' });
}

function reviewMarkdown(id: string): string {
  const t = get(id);
  if (!t) return '';
  const sum = summary(t.sessionId);
  const sev = { blocker: '阻断', major: '重要', minor: '次要' };
  const rule = { verified: '已确认修复', upheld: '异议成立', open: '未解决' };
  const status: Record<ReviewTicket['status'], string> = { checking: '验证中', reviewing: '审核中', fixing: '修改中', passed: '已通过', needs_decision: '等你决定', checks_failed: '验证没通过', stopped: '已停止', accepted: '已接受现状' };
  const lines = [
    `# 代码审核 · ${sum?.title ?? ''}`, '',
    `- 基准：${t.base}`, `- 轮数：${t.rounds.length}/${t.maxRounds}`, `- 结果：${status[t.status]}${t.note ? `（${t.note}）` : ''}`,
    `- 审核子代理：${t.model} · 思考 ${t.effort}`,
    `- 验证命令：${t.checks.length ? t.checks.join('；') : '跳过验证'}`, '',
  ];
  for (const r of t.rounds) {
    lines.push(`## 第 ${r.n} 轮 · ${r.scope === 'global' ? '全局' : '增量'} · ${r.range}`, '');
    lines.push(`- 审核范围：${r.diff.files} 个文件 +${r.diff.add} −${r.diff.del}`);
    lines.push(`- 验证：${t.checks.length === 0 ? '跳过' : r.checks.map((c) => `第 ${c.attempt} 次${c.ok ? '通过' : '失败'}`).join('，') || '—'}`);
    lines.push(`- 结论：${r.verdict === 'pass' ? '通过' : r.verdict === 'changes_requested' ? '打回' : '—'}${r.reviewer ? `（${r.reviewer.summary}）` : ''}`, '');
    const raised = t.findings.filter((f) => r.raised.includes(f.id));
    if (raised.length) {
      lines.push('### 新意见', '');
      for (const f of raised) lines.push(`- **${f.id}** [${sev[f.severity]}] ${f.file}${f.line ? `:${f.line}` : ''} — ${f.title}`, `  ${f.detail}`);
      lines.push('');
    }
    if (r.rulings.length) {
      lines.push('### 对之前意见的结论', '');
      for (const u of r.rulings) lines.push(`- **${u.id}** ${rule[u.status]}：${u.note}`);
      lines.push('');
    }
    if (r.answers.length) {
      lines.push('### 作者的答复', '');
      for (const x of r.answers) lines.push(`- **${x.id}** ${x.status === 'fixed' ? '已修改' : '有异议'}：${x.text}`);
      lines.push('');
    }
    if (r.authorFiles.length) {
      lines.push('### 作者修改的文件', '');
      for (const f of r.authorFiles) lines.push(`- ${f.path} +${f.add} −${f.del}（${f.phase === 'check' ? '验证没通过后修复' : '按意见修改'}）`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

function suggestChecks(workspaceId: string): string[] {
  const ws = app.workspaces.find((w) => w.id === workspaceId);
  if (!ws) return [];
  const has = (f: string) => existsSync(path.join(ws.path, f));
  if (has('package.json')) {
    try {
      const scripts = (JSON.parse(readFileSync(path.join(ws.path, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {};
      const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
      const runScript = (k: string) => (pm === 'npm' ? (k === 'test' ? 'npm test' : `npm run ${k}`) : `${pm} ${k}`);
      return ['typecheck', 'lint', 'build', 'test'].filter((k) => scripts[k] && !/no test specified/.test(scripts[k])).map(runScript);
    } catch {
      return [];
    }
  }
  if (has('Cargo.toml')) return ['cargo build', 'cargo test'];
  if (has('go.mod')) return ['go vet ./...', 'go test ./...'];
  if (has('pyproject.toml') || has('pytest.ini')) return ['python -m pytest -q'];
  return [];
}

register({
  suggestChecks,
  startReview,
  stopReview,
  decideReview,
  reviewMarkdown,
});

