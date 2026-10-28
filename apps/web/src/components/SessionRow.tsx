/** A session row used on Home (recent sessions) and History. Hover reveals every action. */
import { useRef, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import type { SessionSummary } from '../api/types';
import { api } from '../api';
import { useApp } from '../store/app';
import { relTime, tokens } from '../lib/format';
import { cx, download } from '../lib/util';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';
import { Button, Chip, Popover, Status } from './ui';

export function StateBadge({ s }: { s: SessionSummary }) {
  const t = useT();
  if (s.waiting) return <Status tone="warn">{t('等待空位')}</Status>;
  if (!s.live) return <span className="muted">{t('已保存')}</span>;
  if (s.state === 'requires_action') return <Status tone="warn">{t('等你处理')}</Status>;
  if (s.state === 'running') return <Status tone="info">{t('运行中')}</Status>;
  return <Status tone="idle">{t('空闲 · 进程在线')}</Status>;
}

/** Lines naming the work that stopping a session's process will kill; empty when nothing runs. */
function workLines(sid: string, t: ReturnType<typeof useT>): string[] {
  const w = api.runningWork(sid);
  const lines: string[] = [];
  if (w.turn) lines.push(t('· Claude 正在进行的这一轮'));
  if (w.request) lines.push(t('· 等你处理的请求（视为拒绝）'));
  w.background.forEach((b) => lines.push(t('· 后台任务：{b}', { b })));
  if (w.queued) lines.push(t('· {n} 条排队中的消息', { n: w.queued }));
  return lines;
}

export function useSessionActions() {
  const nav = useNavigate();
  const t = useT();
  const here = useMatch('/s/:id')?.params.id;

  const openWorkspace = useOpenWorkspace();
  /** After the session on screen goes away, show the workspace's next session (or a new one). */
  const leave = (s: SessionSummary) => {
    if (here === s.id) openWorkspace(s.workspaceId);
  };

  return {
    open: (s: SessionSummary) => { api.openSession(s.id); nav(`/s/${s.id}`); },
    resume: (s: SessionSummary) => { api.resume(s.id); nav(`/s/${s.id}`); },
    fork: async (s: SessionSummary) => {
      const id = await api.forkAt(s.id);
      useApp.getState().toast(t('已分叉出新会话'), 'good');
      nav(`/s/${id}`);
    },
    exportMd: async (s: SessionSummary) => {
      download(`${s.title}.md`, await api.exportMarkdown(s.id), 'text/markdown;charset=utf-8');
      useApp.getState().toast(t('已导出 Markdown'), 'good');
    },
    /** Save = end the Claude Code process. The transcript is already on disk; it can be resumed later. */
    save: (s: SessionSummary) => {
      const done = () => { api.stop(s.id); useApp.getState().toast(t('已保存「{title}」，可以随时恢复', { title: s.title }), 'good'); };
      const lines = workLines(s.id, t);
      if (lines.length === 0) { done(); return; }
      useApp.getState().ask({
        title: t('保存并结束这个会话？'),
        body: [t('会结束这个会话的 Claude Code 进程，对话记录会保留，之后可以恢复。'), '', t('以下正在进行的工作会被强制停止：'), ...lines, '', t('已经改动的文件不会被撤销。')].join('\n'),
        confirmLabel: t('保存并结束'),
        danger: true,
        onConfirm: done,
      });
    },
    remove: (s: SessionSummary) => {
      const lines = s.live ? workLines(s.id, t) : [];
      useApp.getState().ask({
        title: s.draft ? t('丢弃这个新会话？') : t('删除会话？'),
        body: s.draft
          ? t('还没有发送任何消息。')
          : t('「{title}」的对话记录将被删除，无法撤销。', { title: s.title })
            + (lines.length ? ['', '', t('以下正在进行的工作会被强制停止：'), ...lines, '', t('已经改动的文件不会被撤销。')].join('\n') : ''),
        confirmLabel: s.draft ? t('丢弃') : t('删除'),
        danger: true,
        onConfirm: () => {
          if (s.live) api.stop(s.id);
          api.remove(s.id);
          useApp.getState().toast(s.draft ? t('已丢弃') : t('已删除'), 'good');
          leave(s);
        },
      });
    },
  };
}

/** Open a workspace: its latest running session (see api.latestSession), or a new one when it has none. */
export function useOpenWorkspace() {
  const nav = useNavigate();
  return (workspaceId: string) => {
    const id = api.latestSession(workspaceId) ?? api.createDraft(workspaceId);
    api.openSession(id);
    useApp.getState().set({ currentWorkspaceId: workspaceId });
    nav(`/s/${id}`);
  };
}

export function SessionRow({ s, wsName, detailed }: { s: SessionSummary; wsName: string; detailed?: boolean }) {
  const t = useT();
  const actions = useSessionActions();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [tagOpen, setTagOpen] = useState(false);
  const tagBtn = useRef<HTMLSpanElement>(null);
  const allTags = Array.from(new Set(useApp.getState().sessions.map((x) => x.tag).filter(Boolean))) as string[];
  const [tagText, setTagText] = useState('');

  const commitRename = () => {
    setEditing(false);
    if (title.trim() && title.trim() !== s.title) { api.rename(s.id, title.trim()); useApp.getState().toast(t('已重命名'), 'good'); }
    else setTitle(s.title);
  };

  return (
    <div className={cx('srow', detailed && 'detailed')} onClick={() => !editing && !tagOpen && actions.open(s)} role="button" tabIndex={0}>
      <div className="srow-main">
        {editing ? (
          <input
            className="input sm"
            value={title}
            autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename(); }}
          />
        ) : (
          <div className="srow-title ellipsis">
            {s.forkedFrom && <Icon name="branch" size={14} className="fork-icon" />}
            {s.title}
          </div>
        )}
        {detailed && (
          <div className="srow-first ellipsis">
            {s.forkedFrom ? <span className="fork-from">↳ {t('分叉自「{t}」', { t: s.forkedFrom })}</span> : s.firstPrompt}
          </div>
        )}
        {detailed && <div className="srow-meta">{wsName}{s.branch ? ` · ${s.branch}` : ''} · {tokens(s.tokens)} tokens</div>}
      </div>
      {!detailed && <div className="srow-ws ellipsis">{wsName}</div>}
      <div className="srow-state"><StateBadge s={s} /></div>
      <div className="srow-time">{relTime(s.lastActive)}</div>
      <div className="srow-tag">{s.tag && <Chip icon="tag">{s.tag}</Chip>}</div>
      <div className="srow-actions" onClick={(e) => e.stopPropagation()}>
        {s.live ? <Button size="sm" icon="chat" onClick={() => actions.open(s)}>{t('打开')}</Button>
          : <Button size="sm" icon="play" onClick={() => actions.resume(s)}>{t('恢复')}</Button>}
        {s.live && <Button size="sm" icon="save" title={t('保存并结束（结束 Claude Code 进程，之后可以恢复）')} onClick={() => actions.save(s)}>{detailed && t('保存')}</Button>}
        {/* History rows have room for labels; the compact Home rows show icons with tooltips. */}
        <Button size="sm" icon="branch" title={t('分叉')} onClick={() => actions.fork(s)}>{detailed && t('分叉')}</Button>
        <Button size="sm" icon="pencil" title={t('重命名')} onClick={() => setEditing(true)}>{detailed && t('重命名')}</Button>
        <span ref={tagBtn}><Button size="sm" icon="tag" title={t('标签')} onClick={() => setTagOpen(true)}>{detailed && t('标签')}</Button></span>
        <Button size="sm" icon="download" title={t('导出 Markdown')} onClick={() => actions.exportMd(s)}>{detailed && t('导出')}</Button>
        <Button size="sm" icon="trash" variant="danger-outline" title={t('删除')} onClick={() => actions.remove(s)}>{detailed && t('删除')}</Button>
      </div>
      <Popover anchor={tagBtn.current} open={tagOpen} onClose={() => setTagOpen(false)} placement="bottom-end" width={220}>
        <div style={{ padding: 6 }} onClick={(e) => e.stopPropagation()}>
          <input
            className="input sm"
            placeholder={t('新标签，回车确认')}
            value={tagText}
            onChange={(e) => setTagText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && tagText.trim()) { api.tag(s.id, tagText.trim()); setTagText(''); setTagOpen(false); }
            }}
          />
        </div>
        {allTags.map((tg) => (
          <button key={tg} className={cx('menu-item', s.tag === tg && 'on')} onClick={(e) => { e.stopPropagation(); api.tag(s.id, tg); setTagOpen(false); }}>
            <Icon name="tag" size={14} /><span className="grow">{tg}</span>{s.tag === tg && <Icon name="check" size={14} />}
          </button>
        ))}
        {s.tag && (
          <>
            <div className="menu-sep" />
            <button className="menu-item danger" onClick={(e) => { e.stopPropagation(); api.tag(s.id, null); setTagOpen(false); }}>
              <Icon name="x" size={14} />{t('清除标签')}
            </button>
          </>
        )}
      </Popover>
    </div>
  );
}

/**
 * The "Sessions" entry (left rail, brand): the selected workspace's latest session, or the
 * overview page when "All workspaces" is selected.
 */
export function useGoToSessions() {
  const nav = useNavigate();
  const openWorkspace = useOpenWorkspace();
  return () => {
    const ws = useApp.getState().currentWorkspaceId;
    if (ws && useApp.getState().workspaces.some((w) => w.id === ws)) openWorkspace(ws);
    else nav('/');
  };
}
