/** "Open folder…" browser over the server's file system (mocked). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Button, Modal } from '../components/ui';
import { useApp } from '../store/app';
import { SERVER_FOLDERS, type FsNode } from '../mock/data';
import { cx } from '../lib/util';
import { useT } from '../lib/i18n';

export function FolderPicker() {
  const t = useT();
  const open = useApp((s) => s.folderPickerOpen);
  const nav = useNavigate();
  const [sel, setSel] = useState('');
  const [typed, setTyped] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['D:\\', 'D:\\src']));
  if (!open) return null;
  const close = () => useApp.getState().set({ folderPickerOpen: false });
  const path = typed.trim() || sel;

  const render = (nodes: FsNode[], parent: string, depth: number): React.ReactNode =>
    nodes.map((n) => {
      const full = parent ? `${parent}${parent.endsWith('\\') ? '' : '\\'}${n.name}` : n.name;
      const isOpen = expanded.has(full);
      return (
        <div key={full}>
          <div className={cx('folder-row', sel === full && 'sel')} style={{ paddingLeft: 8 + depth * 18 }} onClick={() => { setSel(full); setTyped(''); }}
            onDoubleClick={() => { const n2 = new Set(expanded); if (isOpen) n2.delete(full); else n2.add(full); setExpanded(n2); }}>
            <span onClick={(e) => { e.stopPropagation(); const n2 = new Set(expanded); if (isOpen) n2.delete(full); else n2.add(full); setExpanded(n2); }}>
              <Icon name={n.children ? (isOpen ? 'chevDown' : 'chevRight') : 'dots'} size={13} className={n.children ? 'ink2' : 'muted'} />
            </span>
            <Icon name="folder" size={15} />
            {n.name}
          </div>
          {isOpen && n.children && render(n.children, full, depth + 1)}
        </div>
      );
    });

  return (
    <Modal
      title={t('打开文件夹')}
      sub={t('浏览的是运行 Code Agent 服务的这台机器上的文件夹。')}
      onClose={close}
      width={560}
      footer={<><Button onClick={close}>{t('取消')}</Button><Button variant="primary" disabled={!path} onClick={() => {
        const ws = useApp.getState().addWorkspace(path);
        useApp.getState().set({ currentWorkspaceId: ws.id, folderPickerOpen: false });
        useApp.getState().toast(t('已添加工作区 {name}', { name: ws.name }), 'good');
        nav('/');
      }}>{t('添加为工作区')}</Button></>}
    >
      <div className="folder-tree">{render(SERVER_FOLDERS, '', 0)}</div>
      <div className="field">
        <label>{t('或直接输入路径')}</label>
        <input className="input mono" placeholder="D:\src\my-project" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      {path && <div className="hint">{t('将添加：')}<span className="mono">{path}</span></div>}
    </Modal>
  );
}
