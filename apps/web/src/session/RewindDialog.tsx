/** Rewind files to before a user message, with a dry-run preview. */
import { useEffect, useState } from 'react';
import type { DryRun } from '../api';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button, Chip, Modal, Radio } from '../components/ui';
import { useApp } from '../store/app';
import { useT } from '../lib/i18n';

export function RewindDialog({ sid, userId, n, onClose }: { sid: string; userId: string; n: number; onClose: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const [dry, setDry] = useState<DryRun | null>(null);
  useEffect(() => {
    let live = true;
    void api.dryRun(sid, userId).then((d) => live && setDry(d));
    return () => { live = false; };
  }, [sid, userId]);
  const [mode, setMode] = useState<'files' | 'fork'>('files');

  const run = async () => {
    const forkId = await api.rewind(sid, userId, mode === 'fork');
    onClose();
    if (forkId) {
      useApp.getState().toast(t('已回退文件并新建分叉会话'), 'good');
      nav(`/s/${forkId}`);
    } else {
      useApp.getState().toast(t('文件已回退'), 'good');
    }
  };

  return (
    <Modal
      title={t('回退到消息 #{n} 之前', { n })}
      sub={t('先预演，确认会改动哪些文件')}
      width={560}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button variant="primary" icon="rewind" disabled={!dry?.canRewind} onClick={() => void run()}>{mode === 'fork' ? t('回退并分叉') : t('回退文件')}</Button>
        </>
      }
    >
      {!dry ? (
        <div className="banner-info"><span className="spinner" />{t('正在预演…')}</div>
      ) : !dry.canRewind ? (
        <div className="banner-warn"><Icon name="warning" size={16} />{dry.error ?? t('无法回退：这条消息没有文件检查点。')}</div>
      ) : dry.files.length === 0 ? (
        <div className="banner-info"><Icon name="info" size={16} />{t('这条消息之后没有文件变更，回退不会改动任何文件。')}</div>
      ) : (
        <>
          <div className="row">
            <b>{t('{n} 个文件会被改动', { n: dry.files.length })}</b>
            <span className="add-n">+{dry.insertions}</span><span className="del-n">−{dry.deletions}</span>
          </div>
          <div className="rewind-files">
            {dry.files.map((f) => (
              <div key={f.path} className="rf">
                <Icon name="file" size={14} className="muted" />
                <span className="mono grow truncate">{f.path}</span>
                <Chip tone={f.what === 'deleted' ? 'crit' : 'outline'}>{f.what === 'deleted' ? t('将删除') : t('将恢复')}</Chip>
              </div>
            ))}
          </div>
          {dry.skippedLinks > 0 && <div className="banner-warn"><Icon name="warning" size={15} />{t('有 {n} 个符号链接不会被回退。用 Bash 改动的文件也不在检查点范围内。', { n: dry.skippedLinks })}</div>}
        </>
      )}
      <div className="col" style={{ marginTop: 14 }}>
        <div className="option-card" onClick={() => setMode('files')}>
          <Radio on={mode === 'files'} onChange={() => setMode('files')} />
          <div><b>{t('只回退文件')}</b><div className="d">{t('对话保持不变，Claude 会被告知文件已回退')}</div></div>
        </div>
        <div className="option-card" onClick={() => setMode('fork')}>
          <Radio on={mode === 'fork'} onChange={() => setMode('fork')} />
          <div><b>{t('回退文件，并从这里分叉对话')}</b><div className="d">{t('新会话停在这条消息之前，原会话保留')}</div></div>
        </div>
      </div>
    </Modal>
  );
}
