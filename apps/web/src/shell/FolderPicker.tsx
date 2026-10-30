/** "Open folder…" browser over the file system of the machine running the Code Agent server. */
import { useEffect, useState } from 'react';
import { Icon } from '../components/Icon';
import { Button, Modal } from '../components/ui';
import { useApp } from '../store/app';
import { useOpenWorkspace } from '../components/SessionRow';
import type { FsNode } from '../lib/catalog';
import { api } from '../api';
import { cx } from '../lib/util';
import { useT } from '../lib/i18n';
import { askTrust } from '../lib/trust';

const join = (parent: string, name: string) => (parent ? `${parent}${/[\\/]$/.test(parent) ? '' : parent.includes('/') && !parent.includes('\\') ? '/' : '\\'}${name}` : name);

export function FolderPicker() {
  const t = useT();
  const open = useApp((s) => s.folderPickerOpen);
  const openWorkspace = useOpenWorkspace();
  const [sel, setSel] = useState('');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [children, setChildren] = useState<Record<string, FsNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open && !children['']) void api.listDir(null).then((roots) => setChildren((c) => ({ ...c, '': roots })));
  }, [open, children]);
  if (!open) return null;
  const close = () => useApp.getState().set({ folderPickerOpen: false });
  const path = typed.trim() || sel;

  const toggle = (full: string) => {
    const n2 = new Set(expanded);
    if (n2.has(full)) n2.delete(full);
    else {
      n2.add(full);
      if (!children[full]) void api.listDir(full).then((list) => setChildren((c) => ({ ...c, [full]: list })));
    }
    setExpanded(n2);
  };

  const render = (nodes: FsNode[], parent: string, depth: number): React.ReactNode =>
    nodes.map((n) => {
      const full = join(parent, n.name);
      const isOpen = expanded.has(full);
      const kids = children[full];
      return (
        <div key={full}>
          <div className={cx('folder-row', sel === full && 'sel')} style={{ paddingLeft: 8 + depth * 18 }} onClick={() => { setSel(full); setTyped(''); }}
            onDoubleClick={() => toggle(full)}>
            <span onClick={(e) => { e.stopPropagation(); toggle(full); }}>
              <Icon name={kids && kids.length === 0 ? 'dots' : isOpen ? 'chevDown' : 'chevRight'} size={13} className={kids && kids.length === 0 ? 'muted' : 'ink2'} />
            </span>
            <Icon name="folder" size={15} />
            {n.name}
          </div>
          {isOpen && kids && render(kids, full, depth + 1)}
        </div>
      );
    });

  const add = async () => {
    setBusy(true);
    try {
      const ws = await api.addWorkspace(path);
      useApp.getState().set({ folderPickerOpen: false });
      useApp.getState().toast(t('已添加工作区 {name}', { name: ws.name }), 'good');
      openWorkspace(ws.id);
      if (!ws.trusted) askTrust(ws);
    } catch {
      // The server's message is shown as a toast.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('打开文件夹')}
      sub={t('浏览的是运行 Code Agent 服务的这台机器上的文件夹。')}
      onClose={close}
      width={560}
      footer={<><Button onClick={close}>{t('取消')}</Button><Button variant="primary" disabled={!path || busy} onClick={() => add()}>{t('添加为工作区')}</Button></>}
    >
      <div className="folder-tree">{children[''] ? render(children[''], '', 0) : <div className="hint"><span className="spinner" /> {t('正在读取…')}</div>}</div>
      <div className="field">
        <label>{t('或直接输入路径')}</label>
        <input className="input mono" placeholder="D:\src\my-project" value={typed} onChange={(e) => setTyped(e.target.value)} />
      </div>
      {path && <div className="hint">{t('将添加：')}<span className="mono">{path}</span></div>}
    </Modal>
  );
}
