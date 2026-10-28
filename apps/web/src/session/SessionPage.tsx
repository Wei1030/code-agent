/** P04 — a session: session column, transcript, docked panels, composer, inspector. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { SessionRuntime, SessionSummary } from '../api/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { StateBadge, useSessionActions } from '../components/SessionRow';
import { useApp } from '../store/app';
import { useSessions } from '../store/sessions';
import { relTime, tokens as fmtTokens } from '../lib/format';
import { cx } from '../lib/util';
import { useT } from '../lib/i18n';
import { Transcript } from './Transcript';
import { ApprovalPanel, InterruptReceipt, PlanReviewBar, QuestionPanel, QueueList, ReadOnlyBar } from './Dock';
import { Composer } from './Composer';
import { Inspector } from './Inspector';
import { RewindDialog } from './RewindDialog';

export function SessionPage() {
  const { id = '' } = useParams();
  const t = useT();
  const nav = useNavigate();
  const sum = useApp((s) => s.sessions.find((x) => x.id === id));
  const rt = useSessions((s) => s.runtimes[id]);
  const [rewindAt, setRewindAt] = useState<{ userId: string; n: number } | null>(null);
  const [receipt, setReceipt] = useState<number>(0);

  useEffect(() => {
    api.openSession(id);
    if (sum) useApp.getState().set({ currentWorkspaceId: sum.workspaceId });
    setReceipt(0);
    setRewindAt(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!sum) {
    return (
      <div className="session-layout">
        <SessionColumn current={null} />
        <div className="scenter"><div className="empty" style={{ marginTop: 80 }}><b>{t('找不到这个会话')}</b>{t('它可能已被删除。')}<div style={{ marginTop: 12 }}><Button onClick={() => nav('/')}>{t('回到工作区')}</Button></div></div></div>
      </div>
    );
  }
  if (!rt) return <div className="session-layout"><SessionColumn current={sum} /><div className="scenter" /></div>;

  const onFork = (userId: string) => {
    const msg = rt.items.find((x) => x.id === userId);
    const newId = api.forkAt(id, userId);
    nav(`/s/${newId}`);
    if (msg?.kind === 'user') setTimeout(() => useApp.getState().fillComposer(newId, msg.text), 0);
    useApp.getState().toast(t('已分叉：新会话停在这条消息之前，消息已放进输入框'), 'good');
  };
  const onRewind = (userId: string) => {
    const n = rt.items.filter((x) => x.kind === 'user').findIndex((x) => x.id === userId) + 1;
    setRewindAt({ userId, n });
  };

  return (
    <div className="session-layout">
      <SessionColumn current={sum} />
      <div className="scenter">
        <SessionHeader sum={sum} rt={rt} />
        <TranscriptPane rt={rt} sum={sum} onFork={onFork} onRewind={onRewind} />
        <div className="dock">
          <div className="dock-inner">
            {receipt > 0 && rt.queue.length > 0 && <InterruptReceipt sid={id} count={rt.queue.length} onDone={() => setReceipt(0)} />}
            {rt.request?.kind === 'approval' && <ApprovalPanel key={rt.request.id} sid={id} req={rt.request} />}
            {rt.request?.kind === 'question' && <QuestionPanel key={rt.request.id} sid={id} req={rt.request} />}
            {rt.request?.kind === 'plan' && <PlanReviewBar key={rt.request.id} sid={id} req={rt.request} />}
            {rt.readOnly ? (
              <ReadOnlyBar sid={id} onFork={() => { const nid = api.forkAt(id); nav(`/s/${nid}`); }} />
            ) : (
              <>
                <QueueList sid={id} queue={rt.queue} />
                <Composer rt={rt} workspaceId={sum.workspaceId} onInterrupt={(n) => setReceipt(n)} />
              </>
            )}
          </div>
        </div>
      </div>
      <Inspector rt={rt} onRewind={onRewind} />
      {rewindAt && <RewindDialog sid={id} userId={rewindAt.userId} n={rewindAt.n} onClose={() => setRewindAt(null)} />}
    </div>
  );
}

function SessionColumn({ current }: { current: SessionSummary | null }) {
  const t = useT();
  const nav = useNavigate();
  const wsId = useApp((s) => current?.workspaceId ?? s.currentWorkspaceId);
  const ws = useApp((s) => s.workspaces.find((w) => w.id === wsId));
  const sessions = useApp((s) => s.sessions);
  const mine = sessions.filter((s) => s.workspaceId === wsId && (!s.draft || s.id === current?.id)).sort((a, b) => b.lastActive - a.lastActive);
  const live = mine.filter((s) => s.live || s.draft);
  const saved = mine.filter((s) => !s.live && !s.draft).slice(0, 10);
  const actions = useSessionActions();

  const item = (s: SessionSummary) => (
    <div key={s.id} className={cx('scol-item', s.id === current?.id && 'on')} onClick={() => { api.openSession(s.id); nav(`/s/${s.id}`); }}>
      <span className={cx('sdot', s.live ? s.state : 'idle')} style={!s.live ? { background: 'transparent', border: '1.5px solid var(--border-strong)' } : undefined} />
      <div className="grow">
        <div className="t truncate">{s.title}</div>
        <div className={cx('m', s.state === 'requires_action' && s.live && 'warn')}>
          {s.draft ? t('未发送') : s.live && s.state === 'requires_action' ? t('等你处理') : s.live && s.state === 'running' ? t('运行中') : relTime(s.lastActive)}
        </div>
      </div>
      <div className="scol-acts" onClick={(e) => e.stopPropagation()}>
        {s.live && <Button size="sm" variant="ghost" icon="save" title={t('保存并结束（结束 Claude Code 进程，之后可以恢复）')} onClick={() => actions.save(s)} />}
        <Button size="sm" variant="ghost" icon="trash" title={s.draft ? t('丢弃') : t('删除')} onClick={() => actions.remove(s)} />
      </div>
    </div>
  );

  return (
    <div className="scol">
      <div className="scol-top">
        <Link to="/sessions" className="scol-all"><Icon name="list" size={15} />{t('全部会话')}<Icon name="chevRight" size={14} className="muted" /></Link>
        <div className="row" style={{ margin: '10px 0' }}>
          <Icon name="folder" size={15} className="muted" />
          <b className="truncate grow" title={ws?.path}>{ws?.name ?? t('未选择工作区')}</b>
        </div>
        <Button icon="plus" style={{ width: '100%' }} disabled={!ws} onClick={() => ws && nav(`/s/${api.createDraft(ws.id)}`)}>{t('新建会话')}</Button>
      </div>
      <div className="scol-list">
        {live.length > 0 && <h5>{t('运行中')}</h5>}
        {live.map(item)}
        {saved.length > 0 && <h5>{t('最近')}</h5>}
        {saved.map(item)}
        {mine.length === 0 && <div className="empty" style={{ padding: 16 }}>{t('这个工作区还没有会话')}</div>}
      </div>
    </div>
  );
}

function SessionHeader({ sum, rt }: { sum: SessionSummary; rt: SessionRuntime }) {
  const t = useT();
  const ws = useApp((s) => s.workspaces.find((w) => w.id === sum.workspaceId));
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(sum.title);
  useEffect(() => setTitle(sum.title), [sum.title]);
  const commit = () => {
    setEditing(false);
    if (title.trim() && title.trim() !== sum.title) api.rename(sum.id, title.trim());
    else setTitle(sum.title);
  };
  return (
    <div className="shead">
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="title">
          {editing ? (
            <input className="input sm" style={{ width: 320 }} value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(); if (e.key === 'Escape') { setTitle(sum.title); setEditing(false); } }} />
          ) : (
            <>
              <span className="truncate">{sum.title}</span>
              <span className="edit" title={t('重命名')} onClick={() => setEditing(true)}><Icon name="pencil" size={14} /></span>
            </>
          )}
          {!sum.draft && <StateBadge s={sum} />}
        </div>
        <div className="meta truncate">
          {ws?.name}{sum.branch ? ` · ${sum.branch}` : ''}
          {sum.forkedFrom ? ` · ${t('分叉自「{f}」', { f: sum.forkedFrom })}` : ''}
          {rt.tokens > 0 ? ` · ${t('第 {n} 轮', { n: rt.turn })} · ${fmtTokens(rt.tokens)} tokens` : ''}
        </div>
      </div>
    </div>
  );
}

function TranscriptPane({ rt, sum, onFork, onRewind }: { rt: SessionRuntime; sum: SessionSummary; onFork: (id: string) => void; onRewind: (id: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const lastId = rt.items[rt.items.length - 1]?.id;
  const lastLen = (() => {
    const it = rt.items[rt.items.length - 1];
    return it && 'text' in it ? it.text.length : 0;
  })();

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lastId, lastLen, rt.items.length, rt.status, rt.request]);
  useEffect(() => { stick.current = true; }, [rt.id]);

  return (
    <div className="transcript" ref={ref} onScroll={(e) => {
      const el = e.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }}>
      <div className="transcript-inner">
        {rt.items.length === 0 && sum.draft ? (
          <div className="draft-empty">
            <h2>{t('新会话 · {w}', { w: useApp.getState().workspaces.find((w) => w.id === sum.workspaceId)?.name ?? '' })}</h2>
            <div className="muted">{t('发出第一条消息后才会启动 Claude Code 进程。')}</div>
          </div>
        ) : (
          <Transcript rt={rt} onFork={onFork} onRewind={onRewind} />
        )}
        <StatusLine rt={rt} />
      </div>
    </div>
  );
}

function StatusLine({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const s = rt.status;
  if (!s) {
    if (rt.state === 'running' && !rt.request) return <div className="status-line"><span className="spinner" />{t('Claude 正在工作…')}</div>;
    if (rt.state === 'requires_action') return <div className="status-line" style={{ color: 'var(--warn-ink)' }}><Icon name="bell" size={14} />{t('等你处理下面的请求')}</div>;
    return null;
  }
  if (s.kind === 'working') return <div className="status-line"><span className="spinner" />{s.label}</div>;
  if (s.kind === 'compacting') return <div className="status-line"><span className="spinner" />{t('正在压缩对话… {p}%', { p: s.progress })}</div>;
  return (
    <div className="status-line" style={{ color: 'var(--warn-ink)' }}>
      <Icon name="refresh" size={14} />
      {t('API 暂时不可用，{s} 秒后重试（第 {a}/{m} 次）', { s: s.seconds, a: s.attempt, m: s.max })}
      <span className="muted">{t('可以中断')}</span>
    </div>
  );
}
