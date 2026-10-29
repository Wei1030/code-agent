/** P12 — all sessions with search and filters. */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Button, Check, Chip, Seg, Select, Status, Tabs } from '../components/ui';
import type { WorktreeInfo } from '../api/types';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { SessionRow } from '../components/SessionRow';
import { useApp } from '../store/app';
import { useT } from '../lib/i18n';

export function History() {
  const t = useT();
  const sessions = useApp((s) => s.sessions);
  const workspaces = useApp((s) => s.workspaces);
  const [q, setQ] = useState('');
  const [ws, setWs] = useState('all');
  const [tag, setTag] = useState('all');
  const [kind, setKind] = useState<'all' | 'live' | 'saved'>('all');
  const [worktrees, setWorktrees] = useState(true);
  const [view, setView] = useState<'sessions' | 'worktrees'>('sessions');
  const tags = Array.from(new Set(sessions.map((s) => s.tag).filter(Boolean))) as string[];
  // Transcript text is searched on the server (full-text index), a moment after typing stops.
  const [hits, setHits] = useState<Map<string, string> | null>(null);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const k = q.trim();
    if (!k) { setHits(null); return; }
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void api.searchSessions(k).then((r) => { if (live) setHits(new Map(r.map((x) => [x.sessionId, x.snippet]))); })
        .finally(() => { if (live) setSearching(false); });
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return sessions
      .filter((s) => !s.draft)
      .filter((s) => ws === 'all' || s.workspaceId === ws)
      .filter((s) => tag === 'all' || s.tag === tag)
      .filter((s) => kind === 'all' || (kind === 'live' ? s.live : !s.live))
      .filter((s) => worktrees || !s.worktree)
      .filter((s) => !k || s.title.toLowerCase().includes(k) || s.firstPrompt.toLowerCase().includes(k) || !!hits?.has(s.id))
      .sort((a, b) => b.lastActive - a.lastActive);
  }, [sessions, q, ws, tag, kind, worktrees, hits]);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title"><h1>{t('全部会话')}</h1></div>
        <p className="page-sub">{t('点击一行打开会话；鼠标悬停显示全部操作。')}</p>
        <Tabs className="history-tabs" value={view} onChange={setView} items={[
          { value: 'sessions', label: t('会话'), count: sessions.filter((s) => !s.draft).length },
          { value: 'worktrees', label: t('工作树'), count: sessions.filter((s) => s.worktree && !s.worktreeGone).length },
        ]} />
        {view === 'worktrees' ? <Worktrees /> : <>
        <div className="filter-row">
          <div className="input-wrap" style={{ width: 280 }}>
            <Icon name="search" size={15} />
            <input className="input" placeholder={t('搜索标题和对话内容')} value={q} onChange={(e) => setQ(e.target.value)} />
            {searching && <span className="spinner" style={{ marginRight: 8 }} />}
          </div>
          <Select icon="folder" value={ws} onChange={setWs} width={240}
            options={[{ value: 'all', label: t('所有工作区') }, ...workspaces.map((w) => ({ value: w.id, label: w.name }))]} className="w-180" />
          <Select icon="tag" value={tag} onChange={setTag} width={200}
            options={[{ value: 'all', label: t('任意标签') }, ...tags.map((x) => ({ value: x, label: x }))]} className="w-140" />
          <Seg value={kind} onChange={setKind} items={[{ value: 'all', label: t('全部') }, { value: 'live', label: t('运行中') }, { value: 'saved', label: t('已保存') }]} />
          <Check on={worktrees} onChange={setWorktrees} label={t('包含 worktree')} />
          <span className="grow" />
          <span className="muted">{t('{n} 个会话', { n: list.length })}</span>
        </div>
        <div className="slist detailed">
          {list.length === 0 && <div className="empty"><b>{t('没有匹配的会话')}</b>{t('换个关键词或清除筛选条件')}</div>}
          {list.map((s) => (
            <div key={s.id}>
              <SessionRow s={s} detailed wsName={workspaces.find((w) => w.id === s.workspaceId)?.name ?? ''} />
              {hits?.get(s.id) && <div className="search-hit">{hits.get(s.id)!.split(/\[([^\]]*)\]/).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}</div>}
            </div>
          ))}
        </div>
        </>}
      </div>
    </div>
  );
}

/** The git worktrees Code Agent made for sessions: state, the sessions in them, removal. */
function Worktrees() {
  const t = useT();
  const app = useApp();
  const nav = useNavigate();
  const [list, setList] = useState<WorktreeInfo[] | null>(null);
  const load = () => api.listWorktrees().then(setList, () => setList([]));
  useEffect(() => { void load(); }, []);
  const remove = (w: WorktreeInfo) => {
    const running = w.sessions.filter((s) => s.live);
    app.ask({
      title: t('删除工作树 {b}？', { b: w.branch || w.path }),
      body: [
        w.changed.length ? t('· 有 {n} 个文件的改动还没提交，会一起删掉。', { n: w.changed.length }) : t('· 没有未提交的改动。'),
        w.ahead ? t('· 分支上有 {n} 个提交还没合并进 {b}：分支会保留，以后还能取回。', { n: w.ahead, b: w.base }) : t('· 分支已经合并进 {b}，会一起删除。', { b: w.base }),
        running.length ? t('· {n} 个正在运行的会话会先保存。', { n: running.length }) : '',
        w.sessions.length ? t('· 用这个工作树的会话之后只能查看，不能再恢复。') : '',
      ].filter(Boolean).join('\n'),
      confirmLabel: t('删除'), danger: true,
      onConfirm: () => api.removeWorktree(w.path).then((r) => { app.toast(r.branchDeleted ? t('已删除工作树和分支') : t('已删除工作树，分支保留'), 'good'); return load(); }),
    });
  };
  if (!list) return <div className="empty"><span className="spinner" /></div>;
  if (!list.length) return <div className="empty"><b>{t('没有工作树')}</b>{t('Claude 用「新建会话」并选择独立工作树时，Code Agent 会在 ~/.code-agent/worktrees 下建一个，会列在这里。')}</div>;
  return (
    <div className="panel" style={{ marginTop: 12 }}>
      <div className="panel-body wt-list">
        {list.map((w) => (
          <div key={w.path} className="wt-row">
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{w.sessions[0]?.title ?? w.branch}</b>
              <div className="hint mono truncate" title={w.path}>{w.path}</div>
            </div>
            <div><Chip mono>{w.branch || t('（游离 HEAD）')}</Chip><div className="hint">{w.ahead ? t('比 {b} 多 {n} 个提交', { b: w.base, n: w.ahead }) : t('基于 {b}，没有新提交', { b: w.base })}</div></div>
            <div>{w.changed.length ? <Status tone="warn">{t('{n} 个文件未提交', { n: w.changed.length })}</Status> : <Status tone="good">{t('没有未提交的改动')}</Status>}
              {w.changed.length > 0 && <div className="hint mono truncate" title={w.changed.join('\n')}>{w.changed.slice(0, 3).map((c) => c.slice(3)).join('、')}</div>}</div>
            <div>{w.sessions.length ? w.sessions.map((s) => <div key={s.id}><a className="link-btn" onClick={() => nav(`/s/${s.id}`)}>{s.title}</a> <span className="hint">{s.live ? t('运行中') : t('已保存')}</span></div>) : <span className="hint">{t('没有会话在用')}</span>}</div>
            <div className="row" style={{ gap: 6 }}>
              {w.sessions[0] && <Button size="sm" onClick={() => nav(`/s/${w.sessions[0].id}`)}>{t('打开会话')}</Button>}
              <Button size="sm" variant="danger-outline" onClick={() => remove(w)}>{t('删除工作树')}</Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
