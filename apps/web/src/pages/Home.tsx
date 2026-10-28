/** P02 — workspaces and recent sessions. */
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Button, Chip } from '../components/ui';
import { SessionRow } from '../components/SessionRow';
import { useApp } from '../store/app';
import { api } from '../api';
import { relTime } from '../lib/format';
import { useT } from '../lib/i18n';

export function Home() {
  const t = useT();
  const nav = useNavigate();
  const workspaces = useApp((s) => s.workspaces);
  const sessions = useApp((s) => s.sessions);
  const recent = sessions.filter((s) => !s.draft).sort((a, b) => b.lastActive - a.lastActive).slice(0, 8);
  const openPicker = () => useApp.getState().set({ folderPickerOpen: true });

  const startIn = (wsId: string) => {
    const id = api.createDraft(wsId);
    nav(`/s/${id}`);
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title">
          <h1>{t('工作区')}</h1>
          <span className="grow" />
          {workspaces.length > 0 && <Button icon="folder" onClick={openPicker}>{t('打开文件夹…')}</Button>}
        </div>
        <p className="page-sub">{t('选择一个文件夹作为 Agent 的工作目录，点击卡片即开始新会话。会话按工作区归类。')}</p>

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
                <button key={w.id} className="ws-card" onClick={() => startIn(w.id)} title={t('在 {name} 中开始新会话', { name: w.name })}>
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
