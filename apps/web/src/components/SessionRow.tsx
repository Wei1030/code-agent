/** A session row used on Home (recent sessions) and History. Hover reveals every action. */
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  if (!s.live) return <span className="muted">{t('已保存')}</span>;
  if (s.state === 'requires_action') return <Status tone="warn">{t('等你处理')}</Status>;
  if (s.state === 'running') return <Status tone="info">{t('运行中')}</Status>;
  return <Status tone="idle">{t('空闲 · 进程在线')}</Status>;
}

export function useSessionActions() {
  const nav = useNavigate();
  const t = useT();
  return {
    open: (s: SessionSummary) => { api.openSession(s.id); nav(`/s/${s.id}`); },
    resume: (s: SessionSummary) => { api.resume(s.id); nav(`/s/${s.id}`); },
    fork: (s: SessionSummary) => {
      const id = api.forkAt(s.id);
      useApp.getState().toast(t('已分叉出新会话'), 'good');
      nav(`/s/${id}`);
    },
    exportMd: (s: SessionSummary) => {
      download(`${s.title}.md`, api.exportMarkdown(s.id), 'text/markdown;charset=utf-8');
      useApp.getState().toast(t('已导出 Markdown'), 'good');
    },
    remove: (s: SessionSummary) => {
      useApp.getState().ask({
        title: t('删除会话？'),
        body: t('「{title}」的对话记录将被删除，无法撤销。', { title: s.title }) + (s.live ? `\n${t('会话进程会先被停止。')}` : ''),
        confirmLabel: t('删除'),
        danger: true,
        onConfirm: () => { if (s.live) api.stop(s.id); api.remove(s.id); useApp.getState().toast(t('已删除'), 'good'); },
      });
    },
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
