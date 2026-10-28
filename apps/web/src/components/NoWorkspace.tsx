/** Pages that work per workspace: what to show when there is none, and which one is selected. */
import { useState } from 'react';
import { useApp } from '../store/app';
import { useT } from '../lib/i18n';
import { Icon } from './Icon';
import { Button } from './ui';

export function NoWorkspace({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="no-workspace">
      <Icon name="folder" size={28} className="muted" />
      <b>{t('还没有工作区')}</b>
      <div className="muted">{text}</div>
      <Button variant="primary" icon="folder" onClick={() => useApp.getState().set({ folderPickerOpen: true })}>{t('打开文件夹…')}</Button>
    </div>
  );
}

/**
 * The workspace a page shows: the one picked here, else the selected one in the top bar, else the
 * first. Falls back when the picked workspace is removed; '' when there is none.
 */
export function useWorkspaceChoice(): [string, (id: string) => void] {
  const workspaces = useApp((s) => s.workspaces);
  const current = useApp((s) => s.currentWorkspaceId);
  const [picked, setPicked] = useState('');
  const ok = (id: string) => !!id && workspaces.some((w) => w.id === id);
  const id = ok(picked) ? picked : ok(current) ? current : workspaces[0]?.id ?? '';
  return [id, setPicked];
}
