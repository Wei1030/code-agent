/** P04 — a session: session column, transcript, docked panels, composer, inspector. */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { SessionRuntime, SessionSummary } from '../api/types';
import { api, rememberViewed } from '../api';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { StateBadge, useSessionActions } from '../components/SessionRow';
import { useApp, type InspectorTab } from '../store/app';
import { promptsOf, useSessions } from '../store/sessions';
import { hhmm, relTime, tokens as fmtTokens } from '../lib/format';
import { cx } from '../lib/util';
import { t as translateNow, useT } from '../lib/i18n';
import { SessionLink, Transcript } from './Transcript';
import { ApprovalPanel, ElicitationPanel, InterruptReceipt, PlanReviewBar, QuestionPanel, QueueList, ReadOnlyBar, ResumeBar, WaitingBar } from './Dock';
import { Composer } from './Composer';
import { Inspector } from './Inspector';
import { RewindDialog } from './RewindDialog';
import { ReviewButton, ReviewDecisionPanel, ReviewRecord } from './Review';
import { BoardCheckPanel } from './BoardCheck';

export function SessionPage() {
  const { id = '' } = useParams();
  const t = useT();
  const nav = useNavigate();
  const location = useLocation();
  const sum = useApp((s) => s.sessions.find((x) => x.id === id));
  const rt = useSessions((s) => s.runtimes[id]);
  const record = useApp((s) => s.reviewRecord);
  const [rewindAt, setRewindAt] = useState<{ userId: string; n: number } | null>(null);
  const [receipt, setReceipt] = useState<number>(0);
  // The same functions from one render to the next: the transcript's items draw again only when they change.
  const latest = useRef(rt);
  latest.current = rt;
  const onFork = useCallback(async (userId: string) => {
    const newId = await api.forkAt(id, userId);
    nav(`/s/${newId}`);
    useApp.getState().toast(translateNow('已分叉：新会话停在这条消息之前'), 'good');
  }, [id, nav]);
  const onRewind = useCallback((userId: string) => {
    const n = promptsOf(latest.current!).findIndex((x) => x.id === userId) + 1;
    setRewindAt({ userId, n });
  }, []);

  useEffect(() => {
    api.openSession(id);
    // The inspector starts closed, unless the link here asked for one of its tabs.
    const tab = (location.state as { inspector?: InspectorTab } | null)?.inspector;
    useApp.getState().setInspector(tab ? { open: true, tab } : { open: false });
    if (sum) useApp.getState().set({ currentWorkspaceId: sum.workspaceId });
    setReceipt(0);
    setRewindAt(null);
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Coming back to this workspace's sessions opens this one again.
  useEffect(() => {
    if (sum?.workspaceId) rememberViewed(sum.workspaceId, id);
  }, [id, sum?.workspaceId]);
  // Messages from other sessions count as read while this session is open.
  useEffect(() => {
    if (sum?.peerUnread) void api.markRead(id);
  }, [id, sum?.peerUnread]);

  if (!sum) {
    return (
      <div className="session-layout">
        <SessionColumn current={null} />
        <div className="scenter"><div className="empty" style={{ marginTop: 80 }}><b>{t('找不到这个会话')}</b>{t('它可能已被删除。')}<div style={{ marginTop: 12 }}><Button onClick={() => nav('/')}>{t('回到工作区')}</Button></div></div></div>
      </div>
    );
  }
  if (!rt) return <div className="session-layout"><SessionColumn current={sum} /><div className="scenter"><div className="loading-block"><span className="spinner" />{t('正在载入会话…')}</div></div></div>;

  return (
    <div className="session-layout">
      <SessionColumn current={sum} />
      <div className="scenter">
        <SessionHeader sum={sum} rt={rt} />
        <TranscriptPane rt={rt} sum={sum} onFork={onFork} onRewind={onRewind} />
        {rt.boardCheck && <BoardCheckPanel sid={id} check={rt.boardCheck} />}
        <div className="dock">
          <div className="dock-inner">
            {receipt > 0 && rt.queue.length > 0 && <InterruptReceipt sid={id} count={rt.queue.length} onDone={() => setReceipt(0)} />}
            <ReviewDecisionPanel sid={id} />
            {(sum.requests?.length ?? 0) > 1 && (
              <div className="more-requests"><Icon name="bell" size={14} />{t('Claude 同时提出了 {n} 个请求：处理完这一个，下一个会接着出现', { n: sum.requests!.length })}</div>
            )}
            {/* Stopping the turn there asks about the queue, as the interrupt button does. */}
            {rt.request?.kind === 'approval' && <ApprovalPanel key={rt.request.id} sid={id} req={rt.request} onStop={() => setReceipt(1)} />}
            {rt.request?.kind === 'question' && <QuestionPanel key={rt.request.id} sid={id} req={rt.request} />}
            {rt.request?.kind === 'plan' && <PlanReviewBar key={rt.request.id} sid={id} req={rt.request} />}
            {rt.request?.kind === 'elicitation' && <ElicitationPanel key={rt.request.id} sid={id} req={rt.request} />}
            {sum.resume && rt.state === 'idle' && <ResumeBar sid={id} resume={sum.resume} live={sum.live} />}
            {sum.waiting && <WaitingBar sid={id} />}
            {rt.readOnly ? (
              <>
                {/* Messages that waited for a running slot go out once the session runs again. */}
                <QueueList sid={id} queue={rt.queue} saved={!sum.waiting} />
                {!sum.waiting && <ReadOnlyBar sid={id} model={rt.model} worktreeGone={!!sum.worktreeGone} onFork={() => void api.forkAt(id).then((nid) => nav(`/s/${nid}`))} />}
              </>
            ) : (
              <>
                <QueueList sid={id} queue={rt.queue} />
                <Composer key={id} rt={rt} workspaceId={sum.workspaceId} onInterrupt={setReceipt} />
              </>
            )}
          </div>
        </div>
      </div>
      <Inspector rt={rt} onRewind={onRewind} />
      {rewindAt && <RewindDialog sid={id} userId={rewindAt.userId} n={rewindAt.n} onClose={() => setRewindAt(null)} />}
      {record === id && <ReviewRecord sid={id} />}
    </div>
  );
}

const SessionColumn = memo(function SessionColumn({ current }: { current: SessionSummary | null }) {
  const t = useT();
  const nav = useNavigate();
  const wsId = useApp((s) => current?.workspaceId ?? s.currentWorkspaceId);
  const ws = useApp((s) => s.workspaces.find((w) => w.id === wsId));
  const sessions = useApp((s) => s.sessions);
  const mine = sessions.filter((s) => s.workspaceId === wsId && (!s.draft || s.id === current?.id) && (!s.jobId || s.id === current?.id)).sort((a, b) => b.lastActive - a.lastActive);
  const live = mine.filter((s) => s.live || s.draft || s.waiting);
  const saved = mine.filter((s) => !s.live && !s.draft && !s.waiting).slice(0, 10);
  const actions = useSessionActions();

  const item = (s: SessionSummary) => (
    <div key={s.id} className={cx('scol-item', s.id === current?.id && 'on')} onClick={() => { api.openSession(s.id); nav(`/s/${s.id}`); }}>
      <span className={cx('sdot', s.live ? s.state : 'idle')} style={!s.live ? { background: 'transparent', border: '1.5px solid var(--border-strong)' } : undefined} />
      <div className="grow">
        <div className="t truncate">{s.title}</div>
        <div className={cx('m truncate', ((s.state === 'requires_action' && s.live) || s.waiting) && 'warn')} title={s.createdBy ? t('由会话「{x}」创建', { x: s.createdBy.title }) : undefined}>
          {s.draft ? t('未发送') : s.waiting ? t('等待空位') : s.live && s.state === 'requires_action' ? t('等你处理') : s.live && s.state === 'running' ? t('运行中')
            : s.resume ? (s.resume.kind === 'wake' ? t('{time} 继续', { time: hhmm(s.resume.at) }) : t('限额重置后 {time} 继续', { time: hhmm(s.resume.at) })) : relTime(s.lastActive)}
          {s.createdBy && <span className="by"> · {t('由「{x}」创建', { x: s.createdBy.title })}</span>}
        </div>
      </div>
      {!!s.peerUnread && s.id !== current?.id && <span className="peer-badge" title={t('{n} 条来自其他会话的消息', { n: s.peerUnread })}>{s.peerUnread}</span>}
      <div className="scol-acts" onClick={(e) => e.stopPropagation()}>
        {s.live && <Button size="sm" variant="ghost" icon="save" title={t('保存并结束（结束 Claude Code 进程，之后可以恢复）')} onClick={() => actions.save(s)} />}
        <Button size="sm" variant="ghost" icon="trash" title={s.draft ? t('丢弃') : t('删除')} onClick={() => actions.remove(s)} />
      </div>
    </div>
  );

  return (
    <div className="scol">
      <div className="scol-top">
        <div className="row" style={{ marginBottom: 10 }}>
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
      <div className="scol-foot"><Link to="/sessions">{t('全部会话 →')}</Link></div>
    </div>
  );
});

function SessionHeader({ sum, rt }: { sum: SessionSummary; rt: SessionRuntime }) {
  const t = useT();
  const ws = useApp((s) => s.workspaces.find((w) => w.id === sum.workspaceId));
  const allDirs = useApp((s) => s.dirs);
  const dirs = allDirs.filter((d) => d.scope === 'global' || (d.scope === 'workspace' && d.workspaceId === sum.workspaceId) || (d.scope === 'session' && d.sessionId === sum.id));
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
          {ws?.name}{sum.branch ? ` · ${sum.branch}` : ''}{sum.worktree ? t('（独立 worktree）') : ''}
          {sum.forkedFrom ? ` · ${t('分叉自「{f}」', { f: sum.forkedFrom })}` : ''}
          {sum.createdBy && <> · {t('由')}<SessionLink r={sum.createdBy} />{t('创建')}</>}
          {rt.tokens > 0 ? ` · ${t('第 {n} 轮', { n: rt.turn })} · ${fmtTokens(rt.tokens)} tokens` : ''}
          {dirs.length > 0 && <span title={dirs.map((d) => t('{path}（{scope}）', { path: d.path, scope: d.scope === 'session' ? t('仅本会话') : d.scope === 'workspace' ? t('这个工作区') : t('所有工作区') })).join('\n')}> · {t('额外目录 {n} 个', { n: dirs.length })}</span>}
        </div>
      </div>
      {!sum.draft && <ReviewButton sum={sum} rt={rt} />}
    </div>
  );
}

function TranscriptPane({ rt, sum, onFork, onRewind }: { rt: SessionRuntime; sum: SessionSummary; onFork: (id: string) => void; onRewind: (id: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const top = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  /** Distance from the bottom to keep while an earlier page goes in front. */
  const keep = useRef<number | null>(null);
  const firstId = rt.items[0]?.id;
  const more = (rt.earlier?.items ?? 0) > 0;
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

  // Scrolled up to the top: the page before comes in front, without moving what is in view.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && keep.current !== null) el.scrollTop = el.scrollHeight - keep.current;
    keep.current = null;
  }, [firstId]);
  useEffect(() => {
    const el = ref.current;
    const sentinel = top.current;
    if (!el || !sentinel || !more || !firstId) return;
    let busy = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting || busy) return;
      busy = true;
      setLoading(true);
      api.earlierItems(rt.id, firstId)
        .then((page) => {
          if (page.items.length) keep.current = el.scrollHeight - el.scrollTop;
          useSessions.getState().prepend(rt.id, page.items, page.earlier);
        })
        .finally(() => setLoading(false));
    }, { root: el, rootMargin: '400px 0px 0px 0px' });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [rt.id, firstId, more]);

  return (
    <div className="transcript" ref={ref} onScroll={(e) => {
      const el = e.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    }}>
      <div className="transcript-inner">
        {more && (
          <div ref={top} className="earlier-line">
            {loading ? <><span className="spinner" />{t('正在载入更早的对话…')}</> : t('更早的对话')}
          </div>
        )}
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
  if (s.kind === 'working') return <div className="status-line"><span className="spinner" />{t(s.label)}</div>;
  if (s.kind === 'compacting') return <div className="status-line"><span className="spinner" />{t('正在压缩对话… {p}%', { p: s.progress })}</div>;
  return (
    <div className="status-line" style={{ color: 'var(--warn-ink)' }}>
      <Icon name="refresh" size={14} />
      {s.reason ? t('请求失败（{r}），{s} 秒后重试（第 {a}/{m} 次）', { r: s.reason, s: s.seconds, a: s.attempt, m: s.max }) : t('API 暂时不可用，{s} 秒后重试（第 {a}/{m} 次）', { s: s.seconds, a: s.attempt, m: s.max })}
      <span className="muted">{t('可以中断')}</span>
    </div>
  );
}
