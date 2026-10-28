/** Code review in a session: the 提交审核 button and dialog, the decision panel, transcript cards and the inspector tab. */
import { useState } from 'react';
import type { Effort, ReviewFinding, ReviewTicket, SessionRuntime, SessionSummary } from '../api/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button, Chip, Field, Modal, Select, Status } from '../components/ui';
import { useApp } from '../store/app';
import { EFFORT_LABEL, MODELS } from '../mock/data';
import { relTime, tokens as fmtTokens } from '../lib/format';
import { cx, download } from '../lib/util';
import { useT } from '../lib/i18n';

const SEVERITY: Record<ReviewFinding['severity'], { label: string; tone?: 'crit' | 'warn' }> = {
  blocker: { label: '阻断', tone: 'crit' },
  major: { label: '重要', tone: 'warn' },
  minor: { label: '次要' },
};

const FINDING_STATUS: Record<ReviewFinding['status'], { label: string; tone?: 'good' | 'warn' | 'accent' }> = {
  open: { label: '待处理', tone: 'warn' },
  fixed: { label: '已修改，待确认', tone: 'accent' },
  disputed: { label: '有异议，待裁决', tone: 'accent' },
  verified: { label: '已确认修复', tone: 'good' },
  upheld: { label: '异议成立', tone: 'good' },
};

const TICKET_STATUS: Record<ReviewTicket['status'], { label: string; tone: 'good' | 'warn' | 'crit' | 'info' | 'idle' }> = {
  checking: { label: '验证中', tone: 'info' },
  reviewing: { label: '审核中', tone: 'info' },
  fixing: { label: '修改中', tone: 'info' },
  passed: { label: '已通过', tone: 'good' },
  needs_decision: { label: '等你决定', tone: 'warn' },
  checks_failed: { label: '验证没通过，等你决定', tone: 'warn' },
  stopped: { label: '已停止', tone: 'idle' },
  accepted: { label: '已接受现状', tone: 'good' },
};

const RUNNING: Array<ReviewTicket['status']> = ['checking', 'reviewing', 'fixing'];
const WAITING: Array<ReviewTicket['status']> = ['needs_decision', 'checks_failed'];

/** Changes the last finished review did not cover. */
function useUnreviewed(rt: SessionRuntime) {
  const done = useApp((s) => s.reviewed[rt.id] ?? 0);
  const list = rt.changes.slice(done);
  return { files: new Set(list.map((c) => c.path)).size, add: list.reduce((a, c) => a + c.add, 0), del: list.reduce((a, c) => a + c.del, 0) };
}

const useLatest = (sid: string) => useApp((s) => s.reviews.find((x) => x.sessionId === sid));

// ------------------------------------------------------------------ header button and dialog

export function ReviewButton({ sum, rt }: { sum: SessionSummary; rt: SessionRuntime }) {
  const t = useT();
  const ticket = useLatest(sum.id);
  const un = useUnreviewed(rt);
  const [dialog, setDialog] = useState(false);
  const showRecord = () => useApp.getState().setInspector({ open: true, tab: 'review' });

  if (ticket && RUNNING.includes(ticket.status)) {
    return (
      <div className="shead-right">
        <Status tone="info">{t('代码审核 · 第 {n}/{m} 轮 · {s}', { n: ticket.rounds.length, m: ticket.maxRounds, s: t(TICKET_STATUS[ticket.status].label) })}</Status>
        <Button size="sm" onClick={showRecord}>{t('审核记录')}</Button>
        <Button size="sm" variant="danger-outline" icon="stop" onClick={() => useApp.getState().ask({
          title: t('停止代码审核？'), body: t('正在进行的这一轮会中断。已经做完的轮次、验证结果和意见都保留在审核记录里。'), confirmLabel: t('停止审核'), danger: true,
          onConfirm: () => api.stopReview(sum.id),
        })}>{t('停止审核')}</Button>
      </div>
    );
  }
  if (ticket && WAITING.includes(ticket.status)) {
    return <div className="shead-right"><Status tone="warn">{t('代码审核等你决定')}</Status><Button size="sm" onClick={showRecord}>{t('审核记录')}</Button></div>;
  }
  const why = rt.readOnly ? t('会话没有运行，恢复后才能提交审核') : un.files === 0 ? t('没有还没审核过的改动') : rt.state !== 'idle' ? t('等这一轮结束后再提交审核') : '';
  return (
    <div className="shead-right">
      {ticket && <Button size="sm" variant="ghost" onClick={showRecord}>{t('审核记录')}</Button>}
      <Button size="sm" icon="shield" disabled={!!why} title={why || t('验证并审核这个会话里还没审核过的改动')} onClick={() => setDialog(true)}>
        {un.files > 0 ? t('提交审核 · {n} 个文件', { n: un.files }) : t('提交审核')}
      </Button>
      {dialog && <ReviewDialog sum={sum} rt={rt} onClose={() => setDialog(false)} />}
    </div>
  );
}

function ReviewDialog({ sum, rt, onClose }: { sum: SessionSummary; rt: SessionRuntime; onClose: () => void }) {
  const t = useT();
  const cfg = useApp((s) => s.reviewConfig[sum.workspaceId]);
  const [checks, setChecks] = useState((cfg?.checks ?? ['npm test']).join('\n'));
  const [model, setModel] = useState(cfg?.model ?? 'opus');
  const [effort, setEffort] = useState<Effort>(cfg?.effort ?? 'high');
  const un = useUnreviewed(rt);
  const lines = checks.split('\n').map((x) => x.trim()).filter(Boolean);
  const info = MODELS.find((m) => m.id === model) ?? MODELS[0];
  const start = () => {
    api.startReview(sum.id, { checks: lines, model, effort });
    onClose();
    useApp.getState().setInspector({ open: true, tab: 'review' });
  };
  return (
    <Modal title={t('提交代码审核')} sub={t('{f} 个文件 +{a} −{d}，还没有审核过', { f: un.files, a: un.add, d: un.del })} width={600} onClose={onClose}
      footer={<><Button onClick={onClose}>{t('取消')}</Button><Button variant="primary" icon="shield" disabled={lines.length === 0} onClick={start}>{t('开始审核')}</Button></>}>
      <Field label={t('验证命令')} hint={t('每行一条，按顺序执行。由 Code Agent 直接运行，不经过 Claude；全部通过后才开始审核。按工作区记住。')}>
        <textarea className="textarea mono" rows={3} value={checks} onChange={(e) => setChecks(e.target.value)} placeholder="npm run typecheck&#10;npm test" />
      </Field>
      <div className="form-row" style={{ marginTop: 14 }}>
        <span className="field-label">{t('审核子代理')}</span>
        <Select size="sm" icon="cpu" width={260} value={model} onChange={(v) => { setModel(v); const m = MODELS.find((x) => x.id === v); if (m && !m.efforts.includes(effort)) setEffort(m.efforts[m.efforts.length - 1]); }}
          options={MODELS.map((m) => ({ value: m.id, label: m.label, desc: t(m.desc) }))} />
        <Select<Effort> size="sm" icon="bulb" width={200} value={effort} onChange={setEffort} renderValue={(o) => <>{t('思考')} · {o?.label}</>}
          options={info.efforts.map((e) => ({ value: e, label: t(EFFORT_LABEL[e]) }))} />
      </div>
      <ul className="plain-list" style={{ marginTop: 6 }}>
        <li>{t('最多 5 轮：前 3 轮全局审核，看整个改动和它影响到的地方；之后只看上一轮之后的修改。')}</li>
        <li>{t('审核子代理只能读，看不到这个会话的对话。只报正确性问题，不管风格；没有阻断和重要问题就算通过。')}</li>
        <li>{t('被打回时，Claude 逐条修改或写明异议，然后自动进入下一轮。审核期间这个会话处于忙碌状态，你发的消息会排队。')}</li>
        <li>{t('每一轮的验证结果、审核结论和修改都记在右侧「审核」里。')}</li>
      </ul>
    </Modal>
  );
}

// ------------------------------------------------------------------ decision panel

export function ReviewDecisionPanel({ sid }: { sid: string }) {
  const t = useT();
  const ticket = useLatest(sid);
  if (!ticket || !WAITING.includes(ticket.status)) return null;
  const open = ticket.findings.filter((f) => f.status === 'open' || f.status === 'disputed');
  const rounds = ticket.status === 'needs_decision';
  return (
    <div className="dpanel review-decision">
      <div className="dpanel-head">
        <Icon name="shield" size={20} className="ink2" />
        <b>{rounds ? t('代码审核 {n} 轮后仍未通过', { n: ticket.maxRounds }) : t('验证连续 3 次没有通过')}</b>
        <span className="grow" />
        <Button size="sm" variant="ghost" onClick={() => useApp.getState().setInspector({ open: true, tab: 'review' })}>{t('审核记录')}</Button>
      </div>
      <div className="dpanel-body">
        {rounds && open.length > 0 && <div className="ink2">{t('还有 {n} 条意见没有解决：', { n: open.length })}</div>}
        {rounds && open.map((f) => <FindingRow key={f.id} f={f} compact />)}
        <div className="row" style={{ gap: 8 }}>
          {rounds && <Button variant="primary" onClick={() => api.decideReview(sid, 'more')}>{t('再审 2 轮')}</Button>}
          {rounds && <Button onClick={() => api.decideReview(sid, 'accept')}>{t('接受现状，结束审核')}</Button>}
          <Button onClick={() => api.decideReview(sid, 'takeover')}>{t('我来处理，结束审核')}</Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ transcript cards

export function ReviewCard({ ticketId, round, what }: { ticketId: string; round: number; what: 'check' | 'verdict' }) {
  const ticket = useApp((s) => s.reviews.find((x) => x.id === ticketId));
  const r = ticket?.rounds.find((x) => x.n === round);
  if (!ticket || !r) return null;
  return what === 'check' ? <CheckCard ticket={ticket} n={round} /> : <VerdictCard ticket={ticket} n={round} />;
}

function CheckCard({ ticket, n }: { ticket: ReviewTicket; n: number }) {
  const t = useT();
  const r = ticket.rounds[n - 1];
  const last = r.checks[r.checks.length - 1];
  const [open, setOpen] = useState(true);
  return (
    <div className={cx('tcard review-check', last?.ok === false && 'denied')}>
      <div className="thead" onClick={() => setOpen(!open)}>
        <Icon name="terminal" size={15} className="ink2" />
        <span className="name">{t('验证 · 第 {n} 轮', { n })}</span>
        <span className="detail plain">{t('由 Code Agent 运行，不经过 Claude')}</span>
        {last?.ok === null && <span className="spinner" />}
        {last?.ok === true && <Chip tone="good" icon="check">{r.checks.length > 1 ? t('第 {a} 次通过', { a: last.attempt }) : t('通过')}</Chip>}
        {last?.ok === false && <Chip tone="crit" icon="x">{t('第 {a} 次没通过，已交给 Claude 修复', { a: last.attempt })}</Chip>}
        <Icon name={open ? 'chevUp' : 'chevDown'} size={14} className="muted" />
      </div>
      {open && (
        <div className="tbody">
          {r.checks.map((c) => (
            <div key={c.attempt} className="rv-attempt">
              {r.checks.length > 1 && <div className="rv-attempt-h">{t('第 {a} 次', { a: c.attempt })}</div>}
              {c.commands.map((x, i) => (
                <div key={i}>
                  <div className="rv-cmd">
                    {x.ok === null ? (c.ok === null && c.commands.findIndex((y) => y.ok === null) === i ? <span className="spinner" /> : <Icon name="minus" size={14} className="muted" />)
                      : <Icon name={x.ok ? 'check' : 'x'} size={14} className={x.ok ? 'st-ok' : 'st-error'} />}
                    <span className="mono">{x.cmd}</span>
                    {x.ok !== null && <span className="muted">{x.seconds.toFixed(1)} {t('秒')}</span>}
                    {x.ok === null && c.ok !== null && <span className="muted">{t('未运行')}</span>}
                  </div>
                  {x.ok === false && <pre className="code-block">{x.output.join('\n')}</pre>}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VerdictCard({ ticket, n }: { ticket: ReviewTicket; n: number }) {
  const t = useT();
  const r = ticket.rounds[n - 1];
  const pass = r.verdict === 'pass';
  const raised = ticket.findings.filter((f) => r.raised.includes(f.id));
  const updated = ticket.findings.filter((f) => r.updated.includes(f.id));
  const [open, setOpen] = useState(true);
  return (
    <div className={cx('tcard review-verdict', pass ? 'pass' : 'reject')}>
      <div className="thead" onClick={() => setOpen(!open)}>
        <Icon name="shield" size={15} className="ink2" />
        <span className="name">{t('审核结论 · 第 {n} 轮', { n })}</span>
        <Chip tone={pass ? 'good' : 'warn'}>{pass ? t('通过') : t('打回')}</Chip>
        <span className="detail plain">{r.reviewer?.summary}</span>
        <Icon name={open ? 'chevUp' : 'chevDown'} size={14} className="muted" />
      </div>
      {open && (raised.length > 0 || updated.length > 0) && (
        <div className="tbody">
          {updated.length > 0 && (
            <div className="nested">
              {updated.map((f) => (
                <div key={f.id} className="nested-row">
                  <Icon name={f.status === 'open' ? 'warning' : 'check'} size={14} className={f.status === 'open' ? 'st-waiting' : 'st-ok'} />
                  <span className="t"><b>{f.id}</b> {f.reviewerNote}</span>
                </div>
              ))}
            </div>
          )}
          {raised.map((f) => <FindingRow key={f.id} f={f} />)}
        </div>
      )}
    </div>
  );
}

function FindingRow({ f, compact }: { f: ReviewFinding; compact?: boolean }) {
  const t = useT();
  const sev = SEVERITY[f.severity];
  const st = FINDING_STATUS[f.status];
  return (
    <div className="rv-finding">
      <div className="row" style={{ gap: 8 }}>
        <b className="mono">{f.id}</b>
        <Chip tone={sev.tone}>{t(sev.label)}</Chip>
        <span className="grow" />
        <Chip tone={st.tone}>{t(st.label)}</Chip>
      </div>
      <div className="title">{f.title}</div>
      <div className="loc">{f.file}{f.line ? `:${f.line}` : ''} · {t('第 {n} 轮提出', { n: f.round })}</div>
      {!compact && <div className="d">{f.detail}</div>}
      {f.response && <div className="d"><b>{t('作者：')}</b>{f.response}</div>}
      {f.reviewerNote && <div className="d"><b>{t('审核：')}</b>{f.reviewerNote}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ inspector tab

export function ReviewTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const all = useApp((s) => s.reviews);
  const tickets = all.filter((x) => x.sessionId === rt.id);
  const [sel, setSel] = useState<string | null>(null);
  if (tickets.length === 0) {
    return <div className="empty"><b>{t('还没有代码审核')}</b>{t('会话改了代码以后，点上方的「提交审核」开始。')}</div>;
  }
  const ticket = tickets.find((x) => x.id === sel) ?? tickets[0];
  const st = TICKET_STATUS[ticket.status];
  const open = ticket.findings.filter((f) => ['open', 'fixed', 'disputed'].includes(f.status));
  const model = MODELS.find((m) => m.id === ticket.model)?.label ?? ticket.model;
  return (
    <div className="review-tab">
      {tickets.length > 1 && (
        <Select value={ticket.id} width={300} onChange={setSel} className="rv-pick"
          options={tickets.map((x, i) => ({ value: x.id, label: t('第 {n} 次审核 · {w}', { n: tickets.length - i, w: relTime(x.startedAt) }), desc: t(TICKET_STATUS[x.status].label) }))} />
      )}
      <div className="rv-head">
        <Status tone={st.tone}>{t(st.label)}</Status>
        <span className="muted">{t('第 {n}/{m} 轮', { n: ticket.rounds.length, m: ticket.maxRounds })} · {fmtTokens(ticket.tokens)} tokens</span>
        <span className="grow" />
        <Button size="sm" variant="ghost" icon="download" title={t('导出 Markdown，可以放进提交说明或 PR')}
          onClick={() => download(`code-review-${ticket.id.slice(-6)}.md`, api.reviewMarkdown(ticket.id), 'text/markdown;charset=utf-8')}>{t('导出')}</Button>
      </div>
      {ticket.note && <div className="hint" style={{ marginBottom: 6 }}>{ticket.note}</div>}
      <div className="hint" style={{ marginBottom: 12, lineHeight: 1.7 }}>
        {t('基准 {b} · 审核子代理 {m}（思考 {e}）', { b: ticket.base, m: model, e: t(EFFORT_LABEL[ticket.effort]) })}<br />
        {t('验证：{c}', { c: ticket.checks.join(' → ') })}
      </div>

      <h4>{t('意见')}<span className="right">{t('{o} 条未解决 · {c} 条已解决', { o: open.length, c: ticket.findings.length - open.length })}</span></h4>
      {ticket.findings.length === 0 && <div className="hint" style={{ marginBottom: 12 }}>{t('还没有意见')}</div>}
      {ticket.findings.map((f) => <FindingRow key={f.id} f={f} compact />)}

      <h4 style={{ marginTop: 14 }}>{t('各轮')}</h4>
      {ticket.rounds.map((r) => {
        const last = r.checks[r.checks.length - 1];
        return (
          <div key={r.n} className="rv-round">
            <div className="rv-round-head">
              <b>{t('第 {n} 轮', { n: r.n })}</b>
              <Chip>{r.scope === 'global' ? t('全局') : t('增量')}</Chip>
              <span className="mono muted truncate">{r.range}</span>
            </div>
            <div className="rv-line"><Icon name="file" size={13} />{r.diff.files ? t('审核范围：{f} 个文件 +{a} −{d}', { f: r.diff.files, a: r.diff.add, d: r.diff.del }) : t('审核范围：上一轮之后没有代码修改')}</div>
            <div className="rv-line">
              <Icon name="terminal" size={13} />
              {!last ? t('验证：未开始') : last.ok === null ? t('验证：进行中') : last.ok ? (r.checks.length > 1 ? t('验证：第 {a} 次通过', { a: last.attempt }) : t('验证：通过')) : t('验证：第 {a} 次没通过', { a: last.attempt })}
            </div>
            {r.verdict && (
              <div className="rv-line">
                <Icon name="shield" size={13} />
                {r.verdict === 'pass' ? t('结论：通过') : t('结论：打回')}
                {r.raised.length > 0 && ` · ${t('新意见 {x}', { x: r.raised.join('、') })}`}
                {r.reviewer && <span className="muted"> · {Math.round(r.reviewer.seconds)} {t('秒')} · {fmtTokens(r.reviewer.tokens)} tokens</span>}
              </div>
            )}
            {r.fix && <div className="rv-line"><Icon name="pencil" size={13} />{r.fix.files ? t('作者修改：{f} 个文件 +{a} −{d}', { f: r.fix.files, a: r.fix.add, d: r.fix.del }) : t('作者没有改代码，提出了异议')}</div>}
          </div>
        );
      })}
    </div>
  );
}
