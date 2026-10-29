/**
 * 项目说明与记忆: the files Claude reads at the start of every session (CLAUDE.md, CLAUDE.local.md,
 * rules) and Claude Code's auto memory of the workspace, viewed and edited in place.
 */
import { useEffect, useState } from 'react';
import type { InstructionFile } from '../../api/types';
import { api } from '../../api';
import { Button, Chip, Seg, Select } from '../../components/ui';
import { useApp } from '../../store/app';
import { useWorkspaceChoice } from '../../components/NoWorkspace';
import { cx } from '../../lib/util';
import { useT } from '../../lib/i18n';

const KIND_HINT: Record<InstructionFile['kind'], string> = {
  claude: '每个会话开始时读',
  local: '只在这台电脑上，不提交到仓库',
  rule: '按路径或主题生效的规则',
  memory: 'Claude Code 自动记下的',
};

export function Instructions() {
  const t = useT();
  const app = useApp();
  const [wsId, setWsId] = useWorkspaceChoice();
  const [scope, setScope] = useState<'workspace' | 'global'>(wsId ? 'workspace' : 'global');
  const [files, setFiles] = useState<InstructionFile[]>([]);
  const [selId, setSelId] = useState('');
  const load = () => api.listInstructions(scope === 'workspace' ? wsId || null : null).then((list) => {
    setFiles(list);
    setSelId((cur) => (list.some((f) => f.id === cur) ? cur : (list.find((f) => f.scope === scope && f.exists) ?? list.find((f) => f.exists) ?? list[0])?.id ?? ''));
  });
  useEffect(() => { void load(); }, [scope, wsId]);
  const sel = files.find((f) => f.id === selId);
  const groups = [
    { key: 'global', title: t('所有工作区'), sub: '~/.claude', items: files.filter((f) => f.scope === 'global') },
    { key: 'workspace', title: app.workspaces.find((w) => w.id === wsId)?.name ?? '', sub: t('仓库'), items: files.filter((f) => f.scope === 'workspace' && f.kind !== 'memory') },
    { key: 'memory', title: t('记忆'), sub: t('Claude Code 自动记下的'), items: files.filter((f) => f.kind === 'memory') },
  ].filter((g) => g.items.length);

  return (
    <>
      <h1>{t('项目说明与记忆')}</h1>
      <p className="lead">{t('Claude 每个会话开始时都会读的说明文件，以及 Claude Code 自动记下的记忆。改动对新会话生效；运行中的会话下次读取这些文件时生效。')}</p>
      <div className="row" style={{ gap: 12, marginBottom: 14 }}>
        <Seg value={scope} onChange={setScope} items={[{ value: 'workspace', label: t('当前工作区'), disabled: !wsId }, { value: 'global', label: t('只看所有工作区的') }]} />
        {scope === 'workspace' && wsId && <Select value={wsId} onChange={setWsId} icon="folder" className="w-240" options={app.workspaces.map((w) => ({ value: w.id, label: w.name, desc: w.path }))} />}
      </div>
      <div className="ext-layout" style={{ gridTemplateColumns: '340px minmax(0, 1fr)' }}>
        <div className="ext-list">
          {groups.map((g) => (
            <div key={g.key}>
              <h5>{g.title} <span style={{ fontWeight: 400 }}>{g.sub}</span></h5>
              {g.items.map((f) => (
                <div key={f.id} className={cx('ext-item', f.id === sel?.id && 'on')} onClick={() => setSelId(f.id)}>
                  <div className="top">
                    <b className="mono" style={{ fontSize: 13 }}>{f.name}</b>
                    <span className="grow" />
                    {!f.exists ? <Chip tone="outline">{t('新建')}</Chip> : f.kind === 'claude' && f.scope === 'workspace' ? <Chip>{t('随仓库提交')}</Chip> : null}
                  </div>
                  <div className="sub truncate" style={{ display: 'block' }}>{f.exists ? `${f.summary || t(KIND_HINT[f.kind])} · ${t('{n} 行', { n: f.lines })}` : t(KIND_HINT[f.kind])}</div>
                </div>
              ))}
            </div>
          ))}
          {scope === 'workspace' && !files.some((f) => f.kind === 'memory') && (
            <div><h5>{t('记忆')}</h5><div className="ext-item"><div className="sub">{t('这个工作区还没有自动记忆。Claude Code 觉得值得记下时会写在这里。')}</div></div></div>
          )}
        </div>
        {sel ? <InstructionEditor key={sel.id} file={sel} onSaved={load} /> : <div />}
      </div>
    </>
  );
}

function InstructionEditor({ file, onSaved }: { file: InstructionFile; onSaved: () => void }) {
  const t = useT();
  const app = useApp();
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState('');
  useEffect(() => {
    void api.readInstruction(file.id).then((c) => { setSaved(c); setText(c); });
  }, [file.id]);
  const dirty = saved !== null && text !== saved;
  return (
    <div className="panel">
      <div className="panel-head">
        <h3 className="mono">{file.name}</h3>
        <span className="sub mono truncate" title={file.path}>{file.path}</span>
      </div>
      <div className="panel-body">
        <div className="hint" style={{ marginBottom: 8 }}>{t(KIND_HINT[file.kind])}{!file.exists && ` · ${t('文件还不存在，保存时创建')}`}</div>
        <textarea className="editor" rows={18} value={text} onChange={(e) => setText(e.target.value)} placeholder={file.kind === 'local' ? t('只对你自己生效的约定，例如本机的路径和账号') : t('例如：项目的约定、常用命令、不要做的事')} />
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
          <Button size="sm" disabled={!dirty} onClick={() => setText(saved ?? '')}>{t('还原')}</Button>
          <Button size="sm" variant="primary" disabled={!dirty && file.exists} onClick={() => api.writeInstruction(file.id, text).then(() => { setSaved(text); app.toast(t('已保存 {n}', { n: file.name }), 'good'); onSaved(); })}>{t('保存')}</Button>
        </div>
      </div>
    </div>
  );
}
