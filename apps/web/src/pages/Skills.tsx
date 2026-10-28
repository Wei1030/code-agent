/** P16 — skills, slash commands and plugins available in a workspace. */
import { useMemo, useState } from 'react';
import type { CommandFile, PluginInfo, SkillInfo } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, Chip, Field, Modal, Seg, Select, Status, Tabs, Toggle } from '../components/ui';
import { useApp } from '../store/app';
import { useWorkspaceChoice } from '../components/NoWorkspace';
import { api } from '../api';
import { BUILTIN_COMMANDS } from '../lib/catalog';
import { cx, uid } from '../lib/util';
import { useT } from '../lib/i18n';

const SOURCE_LABEL = { bundled: '内置', global: '所有工作区', workspace: '这个工作区', plugin: '插件' } as const;
const INVOCABLE_LABEL = { both: '你 · Claude', user: '仅你（/ 命令）', model: '仅 Claude 自动使用' } as const;

/** Read the fields Code Agent cares about from SKILL.md / command frontmatter. */
function frontmatter(content: string): Record<string, string> | null {
  const m = /^---\n([\s\S]*?)\n---/.exec(content.replace(/\r\n/g, '\n'));
  if (!m) return null;
  const out: Record<string, string> = {};
  m[1].split('\n').forEach((line) => {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, '$1');
  });
  return out;
}

function invocableOf(fm: Record<string, string>): SkillInfo['invocable'] {
  if (fm['user-invocable'] === 'false') return 'model';
  if (fm['disable-model-invocation'] === 'true') return 'user';
  return 'both';
}

export function Skills() {
  const t = useT();
  const app = useApp();
  const [wsId, setWsId] = useWorkspaceChoice();
  const [tab, setTab] = useState<'skills' | 'commands' | 'plugins'>('skills');
  const ws = app.workspaces.find((w) => w.id === wsId);
  const skills = app.skills.filter((s) => s.source !== 'workspace' || s.workspaceId === wsId);
  const commandFiles = app.commandFiles.filter((c) => c.source !== 'workspace' || c.workspaceId === wsId);
  const mcpPrompts = app.mcp.filter((s) => (s.scope === 'global' || s.scope === 'plugin' || s.workspaceId === wsId) && s.status === 'connected')
    .flatMap((s) => s.prompts.map((p) => ({ server: s.name, ...p })));
  const commandCount = BUILTIN_COMMANDS.length + skills.filter((s) => s.invocable !== 'model').length + commandFiles.length + mcpPrompts.length;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title"><h1>{t('技能、命令与插件')}</h1></div>
        <p className="page-sub">{t('技能是写在 SKILL.md 里的做事方法，Claude 需要时自动使用，也可以用 / 命令调用；命令是可复用的提示词；插件把技能、命令、钩子和 MCP 服务器打包在一个文件夹里。')}</p>
        <div className="row" style={{ marginBottom: 12 }}>
          {wsId ? (
            <>
              <span className="ink2">{t('查看工作区')}</span>
              <Select value={wsId} onChange={setWsId} icon="folder" className="w-240" options={app.workspaces.map((w) => ({ value: w.id, label: w.name, desc: w.path }))} />
            </>
          ) : (
            <span className="hint">{t('还没有工作区：这里只列出所有工作区通用的技能、命令和插件。')} <a className="link" onClick={() => app.set({ folderPickerOpen: true })}>{t('打开文件夹…')}</a></span>
          )}
        </div>
        <Tabs value={tab} onChange={setTab} items={[
          { value: 'skills', label: t('技能'), count: skills.length },
          { value: 'commands', label: t('命令'), count: commandCount },
          { value: 'plugins', label: t('插件'), count: app.plugins.length },
        ]} />
        <div style={{ marginTop: 16 }}>
          {tab === 'skills' && <SkillsTab skills={skills} wsId={wsId} wsName={ws?.name ?? ''} />}
          {tab === 'commands' && <CommandsTab files={commandFiles} skills={skills} prompts={mcpPrompts} wsId={wsId} wsName={ws?.name ?? ''} />}
          {tab === 'plugins' && <PluginsTab />}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ skills

function SkillsTab({ skills, wsId, wsName }: { skills: SkillInfo[]; wsId: string; wsName: string }) {
  const t = useT();
  const app = useApp();
  const [selId, setSelId] = useState(skills.find((s) => s.source === 'workspace')?.id ?? skills[0]?.id ?? '');
  const [creating, setCreating] = useState(false);
  const sel = skills.find((s) => s.id === selId) ?? skills[0];
  const groups = (['workspace', 'global', 'plugin', 'bundled'] as const).map((src) => ({ src, items: skills.filter((s) => s.source === src) })).filter((g) => g.items.length);
  const patch = (id: string, p: Partial<SkillInfo>) => app.set({ skills: app.skills.map((x) => (x.id === id ? { ...x, ...p } : x)) });

  return (
    <div className="ext-layout" style={{ gridTemplateColumns: '380px minmax(0, 1fr)' }}>
      <div>
        <div className="ext-list">
          {groups.map((g) => (
            <div key={g.src}>
              <h5>{t(SOURCE_LABEL[g.src])}{g.src === 'workspace' && <span className="mono" style={{ fontWeight: 400 }}>.claude/skills</span>}{g.src === 'global' && <span className="mono" style={{ fontWeight: 400 }}>~/.claude/skills</span>}</h5>
              {g.items.map((s) => (
                <div key={s.id} className={cx('ext-item', s.id === sel?.id && 'on')} onClick={() => setSelId(s.id)}>
                  <div className="top">
                    <b className="mono" style={{ fontSize: 13 }}>{s.name}</b>
                    {s.plugin && <Chip>{s.plugin}</Chip>}
                    <span className="grow" />
                    <span onClick={(e) => e.stopPropagation()}><Toggle on={s.enabled} onChange={(v) => patch(s.id, { enabled: v })} /></span>
                  </div>
                  <div className="sub truncate" style={{ display: 'block' }}>{s.description}</div>
                  <div className="sub">{t(INVOCABLE_LABEL[s.invocable])}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <Button icon="plus" style={{ width: '100%', marginTop: 10 }} onClick={() => setCreating(true)}>{t('新建技能')}</Button>
        <div className="hint" style={{ marginTop: 8 }}>{t('开关决定 Claude 能不能看到和使用这个技能。关掉后它从 Claude 的技能列表里隐藏，但文件还在磁盘上，不要在技能里放密钥。')}</div>
      </div>
      {sel ? <SkillEditor key={sel.id} skill={sel} wsId={wsId} /> : <div />}
      {creating && <NewFileDialog kind="skill" wsName={wsName} onClose={(id) => { setCreating(false); if (id) setSelId(id); }} wsId={wsId} />}
    </div>
  );
}

function SkillEditor({ skill, wsId }: { skill: SkillInfo; wsId: string }) {
  const t = useT();
  const app = useApp();
  const [text, setText] = useState(skill.content);
  const readOnly = skill.source === 'bundled' || skill.source === 'plugin';
  const dirty = text !== skill.content;
  const fm = frontmatter(text);
  const folder = skill.path.split('/').slice(-2, -1)[0];
  const problems: string[] = [];
  if (!readOnly) {
    if (!fm) problems.push(t('缺少开头的 --- frontmatter ---'));
    else {
      if (!fm.name || !/^[a-z0-9-]+$/.test(fm.name)) problems.push(t('name 只能用小写字母、数字和 -'));
      else if (folder && fm.name !== folder) problems.push(t('name 应与文件夹名 {f} 一致', { f: folder }));
      if (!fm.description) problems.push(t('需要填写 description，Claude 靠它判断什么时候用'));
    }
  }
  const live = app.sessions.filter((s) => s.live && !s.draft && (skill.source !== 'workspace' || s.workspaceId === wsId)).length;
  const save = () => {
    app.set({ skills: app.skills.map((x) => (x.id === skill.id ? { ...x, content: text, description: fm?.description ?? x.description, invocable: fm ? invocableOf(fm) : x.invocable } : x)) });
    app.toast(t('已保存 {p}', { p: skill.path }), 'good');
  };
  return (
    <div className="panel">
      <div className="panel-head">
        <Icon name="file" size={15} className="muted" />
        <span className="mono" style={{ fontSize: 12.5 }}>{skill.path}</span>
        {dirty && <Chip tone="warn">{t('已修改')}</Chip>}
        {readOnly && <Chip>{t('只读')}</Chip>}
        <span className="grow" />
        {skill.source !== 'bundled' && skill.source !== 'plugin' && (
          <Button size="sm" variant="ghost" icon="trash" title={t('删除这个技能')} onClick={() => app.ask({
            title: t('删除技能 {n}？', { n: skill.name }), body: t('会删除 {p} 所在的文件夹。', { p: skill.path }), confirmLabel: t('删除'), danger: true,
            onConfirm: () => app.set({ skills: app.skills.filter((x) => x.id !== skill.id) }),
          })} />
        )}
      </div>
      <div className="panel-body col">
        <textarea className="editor" spellCheck={false} readOnly={readOnly} value={text} onChange={(e) => setText(e.target.value)} rows={16} />
        {!readOnly && (problems.length === 0
          ? <div className="check-ok"><Icon name="check" size={14} />{t('frontmatter 检查通过：名称合法，描述已填写')}</div>
          : problems.map((p) => <div key={p} className="check-bad"><Icon name="warning" size={14} />{p}</div>))}
        <div className="hint">
          {t('常用字段：description（何时使用）、allowed-tools（使用期间免审批的工具）、user-invocable: false（只让 Claude 用）、disable-model-invocation: true（只能你用 / 命令调用）、argument-hint（参数提示）。')}
        </div>
        {!readOnly && (
          <div className="row">
            <span className="grow" />
            <Button size="sm" icon="refresh" disabled={dirty || live === 0} title={dirty ? t('先保存') : undefined}
              onClick={() => api.reloadInSessions('skills', skill.source === 'workspace' ? wsId : undefined).then((n) => app.toast(t('已在 {n} 个运行中的会话里重新加载技能', { n }), 'good'))}>{t('在运行中的会话里重新加载（{n}）', { n: live })}</Button>
            <Button size="sm" onClick={() => setText(skill.content)} disabled={!dirty}>{t('还原')}</Button>
            <Button size="sm" variant="primary" disabled={!dirty || problems.length > 0} onClick={save}>{t('保存')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function NewFileDialog({ kind, wsId, wsName, onClose }: { kind: 'skill' | 'command'; wsId: string; wsName: string; onClose: (id?: string) => void }) {
  const t = useT();
  const app = useApp();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [where, setWhere] = useState<'workspace' | 'global'>(wsId ? 'workspace' : 'global');
  const taken = kind === 'skill' ? app.skills.some((s) => s.name === name) : app.commandFiles.some((c) => c.name === name);
  const valid = /^[a-z0-9-]+$/.test(name) && !taken && desc.trim().length > 0;
  const base = where === 'workspace' ? '.claude' : '~/.claude';
  const path = kind === 'skill' ? `${base}/skills/${name || '名称'}/SKILL.md` : `${base}/commands/${name || '名称'}.md`;
  const create = () => {
    const id = `${where}:${where === 'workspace' ? wsId : ''}:${name}`;
    if (kind === 'skill') {
      const content = `---\nname: ${name}\ndescription: ${desc.trim()}\n---\n\n# ${name}\n\n写下这项工作的具体做法。\n`;
      app.set({ skills: [...app.skills, { id, name, description: desc.trim(), source: where, workspaceId: where === 'workspace' ? wsId : undefined, invocable: 'both', enabled: true, path, content }] });
    } else {
      const content = `---\ndescription: ${desc.trim()}\nargument-hint: ""\n---\n\n在这里写提示词。用 $ARGUMENTS 引用 / 命令后面的参数。\n`;
      app.set({ commandFiles: [...app.commandFiles, { id, name, desc: desc.trim(), argHint: '', source: where, workspaceId: where === 'workspace' ? wsId : undefined, path, content }] });
    }
    onClose(id);
  };
  return (
    <Modal title={kind === 'skill' ? t('新建技能') : t('新建命令')} width={520} onClose={() => onClose()}
      footer={<><Button onClick={() => onClose()}>{t('取消')}</Button><Button variant="primary" disabled={!valid} onClick={create}>{t('创建')}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Field label={t('名称')} hint={name && !/^[a-z0-9-]+$/.test(name) ? t('只能用小写字母、数字和 -') : taken ? t('已经有同名的了') : t('调用时写 /{n}', { n: name || '名称' })}>
          <input className="input mono" value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="api-docs" autoFocus />
        </Field>
        <Field label={t('说明')} hint={kind === 'skill' ? t('写清楚什么时候该用，Claude 靠它决定是否使用') : undefined}>
          <input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={kind === 'skill' ? t('为接口生成 API 文档。新增或修改接口时使用。') : t('根据昨天的提交写站会摘要')} />
        </Field>
        <Field label={t('保存位置')}>
          <Seg value={where} onChange={setWhere} items={[{ value: 'workspace', label: wsId ? t('{w}（随仓库）', { w: wsName }) : t('这个工作区（还没有工作区）'), disabled: !wsId }, { value: 'global', label: t('所有工作区') }]} />
        </Field>
        <div className="hint mono">{path}</div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ commands

function CommandsTab({ files, skills, prompts, wsId, wsName }: {
  files: CommandFile[]; skills: SkillInfo[]; prompts: Array<{ server: string; name: string; desc: string }>; wsId: string; wsName: string;
}) {
  const t = useT();
  const [editId, setEditId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const editing = files.find((f) => f.id === editId);
  const rows = useMemo(() => [
    ...BUILTIN_COMMANDS.map((c) => ({ key: `b-${c.name}`, name: c.name, desc: c.desc, arg: c.argHint, source: t('内置'), fileId: null as string | null })),
    ...files.map((f) => ({ key: f.id, name: f.name, desc: f.desc, arg: f.argHint, source: f.source === 'plugin' ? t('插件 {p}', { p: f.plugin ?? '' }) : t('命令文件 · {s}', { s: t(SOURCE_LABEL[f.source]) }), fileId: f.source === 'plugin' ? null : f.id })),
    ...skills.filter((s) => s.invocable !== 'model').map((s) => ({ key: s.id, name: s.name, desc: s.description, arg: '', source: t('技能 · {s}', { s: t(SOURCE_LABEL[s.source]) }), fileId: null })),
    ...prompts.map((p) => ({ key: `p-${p.server}-${p.name}`, name: `mcp__${p.server}__${p.name}`, desc: p.desc, arg: '', source: t('MCP 提示 · {s}', { s: p.server }), fileId: null })),
  ], [files, skills, prompts, t]);

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="hint grow">{t('在输入框里输入 / 就能看到这些命令。命令文件放在 .claude/commands/ 或 ~/.claude/commands/，内容就是提示词。')}</span>
        <Button icon="plus" onClick={() => setCreating(true)}>{t('新建命令')}</Button>
      </div>
      <div className="panel">
        <table className="data-table">
          <thead><tr><th style={{ paddingLeft: 16 }}>{t('命令')}</th><th>{t('参数')}</th><th>{t('说明')}</th><th>{t('来源')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ paddingLeft: 16 }} className="mono">/{r.name}</td>
                <td className="mono muted">{r.arg}</td>
                <td>{r.desc}</td>
                <td className="ink2">{r.source}</td>
                <td className="num">{r.fileId && <Button size="sm" variant="ghost" icon="pencil" onClick={() => setEditId(r.fileId)}>{t('编辑')}</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CommandEditor file={editing} onClose={() => setEditId(null)} />}
      {creating && <NewFileDialog kind="command" wsId={wsId} wsName={wsName} onClose={(id) => { setCreating(false); if (id) setEditId(id); }} />}
    </>
  );
}

function CommandEditor({ file, onClose }: { file: CommandFile; onClose: () => void }) {
  const t = useT();
  const app = useApp();
  const [text, setText] = useState(file.content);
  const save = () => {
    const fm = frontmatter(text) ?? {};
    app.set({ commandFiles: app.commandFiles.map((x) => (x.id === file.id ? { ...x, content: text, desc: fm.description ?? x.desc, argHint: fm['argument-hint'] ?? x.argHint } : x)) });
    app.toast(t('已保存 {p}', { p: file.path }), 'good');
    onClose();
  };
  return (
    <Modal title={`/${file.name}`} sub={<span className="mono">{file.path}</span>} width={680} onClose={onClose}
      footLeft={<span className="hint">{t('$ARGUMENTS 会替换成 / 命令后面的文字')}</span>}
      footer={<><Button onClick={onClose}>{t('取消')}</Button><Button variant="primary" disabled={text === file.content} onClick={save}>{t('保存')}</Button></>}>
      <textarea className="editor" spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} rows={14} />
    </Modal>
  );
}

// ------------------------------------------------------------------ plugins

function PluginsTab() {
  const t = useT();
  const app = useApp();
  const [path, setPath] = useState('');
  const patch = (id: string, p: Partial<PluginInfo>) => app.set({ plugins: useApp.getState().plugins.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const live = app.sessions.filter((s) => s.live && !s.draft).length;
  const add = () => {
    const id = uid('pl');
    const name = path.trim().split(/[\\/]/).filter(Boolean).pop() ?? path.trim();
    // The server reads the folder (manifest, skills, commands…) and reports it as loaded or failed.
    app.set({ plugins: [...app.plugins, { id, name, path: path.trim(), status: 'loading', contents: { skills: 0, commands: 0, agents: 0, mcp: 0, hooks: 0 }, enabled: true, skipMcp: false }] });
    setPath('');
  };
  const reload = () => app.ask({
    title: t('在运行中的会话里重新加载插件？'),
    body: t('{n} 个运行中的会话会重新加载插件。插件里的技能和工具有变化时，这些会话的提示缓存会失效，下一轮会多消耗一些 token。', { n: live }),
    confirmLabel: t('重新加载'),
    onConfirm: () => api.reloadInSessions('plugins').then((n) => app.toast(t('已在 {n} 个会话里重新加载插件', { n }), 'good')),
  });

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="hint grow">{t('插件是一个本地文件夹，里面可以有技能、命令、子代理、钩子和 MCP 服务器，对所有工作区生效。')}</span>
        <Button icon="refresh" disabled={live === 0} onClick={reload}>{t('在运行中的会话里重新加载')}</Button>
      </div>
      <div className="col" style={{ gap: 10 }}>
        {app.plugins.map((p) => (
          <div key={p.id} className="panel" style={p.status === 'error' ? { borderColor: 'var(--crit-line)' } : undefined}>
            <div className="panel-body row" style={{ alignItems: 'flex-start', gap: 14 }}>
              <Icon name="box" size={20} className="muted" />
              <div className="grow">
                <div className="row"><b style={{ fontSize: 14 }}>{p.name}</b>{p.version && <span className="muted">{p.version}</span>}
                  <Status tone={p.status === 'loaded' ? 'good' : p.status === 'error' ? 'crit' : 'info'}>{p.status === 'loaded' ? t('已加载') : p.status === 'error' ? t('加载失败') : t('加载中')}</Status>
                </div>
                <div className="mono muted" style={{ fontSize: 12 }}>{p.path}</div>
                {p.status === 'error'
                  ? <div className="mono" style={{ color: 'var(--crit)', fontSize: 12, marginTop: 4 }}>{p.error}</div>
                  : <div className="ink2" style={{ fontSize: 12.5, marginTop: 4 }}>{t('技能 {a} · 命令 {b} · 子代理 {c} · MCP {d} · 钩子 {e}', { a: p.contents.skills, b: p.contents.commands, c: p.contents.agents, d: p.contents.mcp, e: p.contents.hooks })}</div>}
              </div>
              <div className="col" style={{ gap: 6 }}>
                <Toggle on={p.enabled} onChange={(v) => patch(p.id, { enabled: v })} label={t('启用')} />
                <Toggle on={p.skipMcp} onChange={(v) => patch(p.id, { skipMcp: v })} label={t('不加载它的 MCP 服务器')} disabled={!p.contents.mcp} />
              </div>
              <Button size="sm" variant="ghost" icon="trash" title={t('移除')} onClick={() => app.ask({
                title: t('移除插件 {n}？', { n: p.name }), body: t('只是不再加载它，文件夹不会被删除。'), confirmLabel: t('移除'), danger: true,
                onConfirm: () => app.set({ plugins: app.plugins.filter((x) => x.id !== p.id) }),
              })} />
            </div>
          </div>
        ))}
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <input className="input mono grow" placeholder={'D:\\plugins\\my-plugin'} value={path} onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && path.trim()) add(); }} />
        <Button icon="plus" disabled={!path.trim()} onClick={add}>{t('添加插件文件夹')}</Button>
      </div>
    </>
  );
}
