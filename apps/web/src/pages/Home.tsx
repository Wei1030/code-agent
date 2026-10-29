/** P02 — workspaces and recent sessions. */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Button, Chip } from '../components/ui';
import { SessionRow, useOpenWorkspace } from '../components/SessionRow';
import { useApp } from '../store/app';
import { api } from '../api';
import { relTime } from '../lib/format';
import { useT } from '../lib/i18n';

export function Home() {
  const t = useT();
  const nav = useNavigate();
  const workspaces = useApp((s) => s.workspaces);
  const sessions = useApp((s) => s.sessions);
  const recent = sessions.filter((s) => !s.draft && !s.jobId).sort((a, b) => b.lastActive - a.lastActive).slice(0, 8);
  const openPicker = () => useApp.getState().set({ folderPickerOpen: true });

  const openWorkspace = useOpenWorkspace();
  const askRemove = (id: string) => {
    const app = useApp.getState();
    const w = app.workspaces.find((x) => x.id === id);
    if (!w) return;
    const own = app.sessions.filter((s) => s.workspaceId === id && !s.draft);
    const running = own.filter((s) => s.live).length;
    const board = app.board.filter((x) => x.workspaceId === id).length;
    const jobs = app.jobs.filter((j) => j.workspaceId === id).length;
    app.ask({
      title: t('移除工作区 {n}？', { n: w.name }),
      body: [
        t('Code Agent 会删掉它在这里的数据：'),
        t('· 会话列表里的 {n} 个会话{r}', { n: own.length, r: running ? t('（其中 {k} 个正在运行，会被停止）', { k: running }) : '' }),
        t('· 看板上的 {n} 个条目', { n: board }),
        t('· {n} 个作业和它们的运行记录，以及审核记录', { n: jobs }),
        '',
        t('不会动文件夹 {p} 里的任何文件，也不会删 Claude Code 自己的会话记录。以后重新添加这个文件夹，那些会话会再次导入。', { p: w.path }),
      ].join('\n'),
      confirmLabel: t('移除'), danger: true,
      onConfirm: () => api.removeWorkspace(id).then(() => app.toast(t('已移除工作区 {n}', { n: w.name }), 'good')),
    });
  };
  // The overview is what "All workspaces" in the top bar shows.
  useEffect(() => useApp.getState().set({ currentWorkspaceId: '' }), []);

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          <h1>{t('工作区')}</h1>
          <span className="grow" />
          {workspaces.length > 0 && <Button icon="folder" onClick={openPicker}>{t('打开文件夹…')}</Button>}
        </div>
        <p className="page-sub">{t('选择一个文件夹作为 Agent 的工作目录。点击卡片进入这个工作区最近的会话；还没有会话时新建一个。')}</p>

        {workspaces.length === 0 ? (
          <div className="ws-empty">
            <button className="ws-add" onClick={openPicker}>
              <Icon name="plus" size={28} />
              <b>{t('添加工作区')}</b>
              <span>{t('选择一个文件夹，或直接粘贴文件夹路径')}</span>
            </button>
          </div>
        ) : (
          <div className="ws-grid">
            {workspaces.map((w) => {
              const all = sessions.filter((s) => s.workspaceId === w.id && !s.draft);
              const live = all.filter((s) => s.live);
              const waiting = live.filter((s) => s.state === 'requires_action').length;
              return (
                <button key={w.id} className="ws-card" onClick={() => openWorkspace(w.id)} title={t('打开 {name} 最近的会话', { name: w.name })}>
                  <span className="ws-remove" role="button" title={t('移除这个工作区')} onClick={(e) => { e.stopPropagation(); askRemove(w.id); }}><Icon name="trash" size={14} /></span>
                  <div className="ws-card-head">
                    <span className="ws-icon"><Icon name="folder" size={16} /></span>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <b className="ellipsis">{w.name}</b>
                      <span className="mono muted ellipsis">{w.path}</span>
                    </span>
                  </div>
                  <div className="ws-card-chips">
                    {w.branch ? <Chip icon="branch">{w.branch}</Chip> : <Chip>{t('非 Git 仓库')}</Chip>}
                    <Chip>{t('{n} 个会话', { n: all.length })}</Chip>
                    {live.length > 0 && (
                      <Chip tone={waiting ? 'warn' : 'accent'}>
                        <span className="dot" style={{ background: waiting ? 'var(--warn)' : 'var(--accent)' }} />
                        {waiting ? t('{n} 个运行中 · {w} 个等你', { n: live.length, w: waiting }) : t('{n} 个运行中', { n: live.length })}
                      </Chip>
                    )}
                  </div>
                  <div className="ws-card-foot muted">{t('活动于 {t}', { t: relTime(w.lastActive) })}</div>
                </button>
              );
            })}
          </div>
        )}

        <div className="section-head">
          <h2>{t('最近会话')}</h2>
          <span className="muted">{t('所有工作区')}</span>
          <span className="grow" />
          <a onClick={() => nav('/sessions')} style={{ cursor: 'pointer' }}>{t('查看全部 →')}</a>
        </div>
        <div className="slist">
          <div className="slist-head">
            <span>{t('标题')}</span><span>{t('工作区')}</span><span>{t('状态')}</span><span>{t('最近活动')}</span><span>{t('标签')}</span><span />
          </div>
          {recent.length === 0 && <div className="empty"><b>{t('还没有会话')}</b>{t('点击上面的工作区卡片开始第一个会话')}</div>}
          {recent.map((s) => (
            <SessionRow key={s.id} s={s} wsName={workspaces.find((w) => w.id === s.workspaceId)?.name ?? ''} />
          ))}
        </div>
      </div>
    </div>
  );
}
