/** P12 — all sessions with search and filters. */
import { useMemo, useState } from 'react';
import { Check, Seg, Select } from '../components/ui';
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
  const tags = Array.from(new Set(sessions.map((s) => s.tag).filter(Boolean))) as string[];

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return sessions
      .filter((s) => !s.draft)
      .filter((s) => ws === 'all' || s.workspaceId === ws)
      .filter((s) => tag === 'all' || s.tag === tag)
      .filter((s) => kind === 'all' || (kind === 'live' ? s.live : !s.live))
      .filter((s) => worktrees || !s.branch?.startsWith('pr-'))
      .filter((s) => !k || s.title.toLowerCase().includes(k) || s.firstPrompt.toLowerCase().includes(k))
      .sort((a, b) => b.lastActive - a.lastActive);
  }, [sessions, q, ws, tag, kind, worktrees]);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title"><h1>{t('全部会话')}</h1></div>
        <p className="page-sub">{t('点击一行打开会话；鼠标悬停显示全部操作。')}</p>
        <div className="filter-row">
          <div className="input-wrap" style={{ width: 280 }}>
            <Icon name="search" size={15} />
            <input className="input" placeholder={t('搜索标题和提问内容')} value={q} onChange={(e) => setQ(e.target.value)} />
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
            <SessionRow key={s.id} s={s} detailed wsName={workspaces.find((w) => w.id === s.workspaceId)?.name ?? ''} />
          ))}
        </div>
      </div>
    </div>
  );
}
