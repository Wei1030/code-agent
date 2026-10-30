/**
 * The board recorder checking the turn that just ended, floating at the top right of the chat:
 * which model checks, the board settings, stop (and stop for good), shrink to a small badge. It
 * goes away when the check ends; a failed check says why for a while.
 */
import { useState } from 'react';
import type { BoardCheck } from '../api/types';
import { api } from '../api';
import { useApp } from '../store/app';
import { useT } from '../lib/i18n';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { BoardSettingsDialog } from '../pages/Board';

export function BoardCheckPanel({ sid, check }: { sid: string; check: BoardCheck }) {
  const t = useT();
  const small = useApp((s) => s.boardCheckSmall);
  const [settings, setSettings] = useState(false);
  const [closed, setClosed] = useState<number | null>(null);
  const shrink = (v: boolean) => useApp.getState().set({ boardCheckSmall: v });
  if (closed === check.startedAt) return null;

  const dialog = settings && <BoardSettingsDialog onClose={() => setSettings(false)} />;
  if (small && !check.error) {
    return (
      <>
        <button className="board-check small" title={t('展开')} onClick={() => shrink(false)}>
          <span className="spinner" />{t('看板分析中')}
        </button>
        {dialog}
      </>
    );
  }
  return (
    <div className={`board-check${check.error ? ' failed' : ''}`} role="status">
      <div className="board-check-head">
        {check.error ? <Icon name="warning" size={15} /> : <span className="spinner" />}
        <b className="grow">{t('看板分析')}</b>
        <Button size="sm" variant="ghost" icon="gear" title={t('看板设置')} onClick={() => setSettings(true)} />
        {check.error
          ? <Button size="sm" variant="ghost" icon="x" title={t('关闭')} onClick={() => setClosed(check.startedAt)} />
          : <Button size="sm" variant="ghost" icon="minus" title={t('缩小')} onClick={() => shrink(true)} />}
      </div>
      <div className="board-check-body">
        {check.error
          ? t('{m} 没能分析完本轮对话：{e}', { m: check.model, e: check.error })
          : t('{m} 正在分析本轮对话是否需要更新看板', { m: check.model })}
      </div>
      {!check.error && (
        <div className="board-check-foot">
          <Button size="sm" onClick={() => api.stopBoardCheck(sid, true)}>{t('停止并不再自动分析')}</Button>
          <Button size="sm" variant="primary" onClick={() => api.stopBoardCheck(sid, false)}>{t('停止分析')}</Button>
        </div>
      )}
      {dialog}
    </div>
  );
}
