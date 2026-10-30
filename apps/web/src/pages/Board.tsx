/**
 * 看板 — a workspace's features, issues and notes. Claude reads and writes it through its board tools;
 * after each turn the recorder adds what was settled (marked 待确认 until the user confirms it).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { BoardItem, BoardKind, BoardStatus, Effort } from '../api/types';
import type { ImportRow } from '../api';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button, Check, Chip, Field, Modal, Seg, Select, Tabs, Toggle } from '../components/ui';
import { linkify } from '../components/BoardLink';
import { SessionLink } from '../session/Transcript';
import { useApp } from '../store/app';
import { NoWorkspace } from '../components/NoWorkspace';
import { EFFORT_LABEL } from '../lib/catalog';
import { effortFor, effortOptions, modelOptions, takesEffort } from '../lib/models';
import { CLOSED, KIND_ICON, KIND_LABEL, STATUSES, STATUS_LABEL, STATUS_TONE } from '../lib/board';
import { relTime } from '../lib/format';
import { cx, download, uid } from '../lib/util';
import { useT } from '../lib/i18n';

const PRIORITY = { high: '高', normal: '中', low: '低' } as const;

export function Board() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const app = useApp();
  const asked = params.get('ws');
  const known = (id: string | null) => !!id && app.workspaces.some((w) => w.id === id);
  const wsId = known(asked) ? asked! : known(app.currentWorkspaceId) ? app.currentWorkspaceId : app.workspaces[0]?.id ?? '';
  const focus = params.get('item');
  const items = app.board.filter((x) => x.workspaceId === wsId);
  const focused = focus ? items.find((x) => x.id === focus) : undefined;
  const [kind, setKind] = useState<BoardKind>(focused?.kind ?? 'feature');
  const [view, setView] = useState<'open' | 'all' | 'unconfirmed'>(focused && CLOSED.includes(focused.status) ? 'all' : 'open');
  const [q, setQ] = useState('');
  const [selId, setSelId] = useState<string | null>(focus);
  const [dialog, setDialog] = useState<'new' | 'import' | 'settings' | null>(null);

  // A link from a conversation (?item=I-3) selects that item.
  useEffect(() => {
    useApp.getState().set({ reviewRecord: null });
    if (!focused) return;
    setKind(focused.kind);
    setSelId(focused.id);
    if (CLOSED.includes(focused.status)) setView('all');
    requestAnimationFrame(() => document.getElementById(`bi-${focused.id}`)?.scrollIntoView({ block: 'nearest' }));
  }, [focus, wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  const unconfirmed = items.filter((x) => x.unconfirmed);
  const count = (k: BoardKind) => items.filter((x) => x.kind === k && !CLOSED.includes(x.status)).length;
  const list = useMemo(() => {
    const base = view === 'unconfirmed' ? unconfirmed : items.filter((x) => x.kind === kind && (view === 'all' || !CLOSED.includes(x.status)));
    const k = q.trim().toLowerCase();
    return base.filter((x) => !k || `${x.id} ${x.title} ${x.body}`.toLowerCase().includes(k));
  }, [items, unconfirmed, kind, view, q]);
  const sel = list.find((x) => x.id === selId) ?? list[0];
  const groups: Array<{ title: string; items: BoardItem[] }> = view === 'unconfirmed'
    ? (['feature', 'issue', 'note'] as BoardKind[]).map((k) => ({ title: t(KIND_LABEL[k]), items: list.filter((x) => x.kind === k) }))
    : STATUSES[kind].map((s) => ({ title: t(STATUS_LABEL[s]), items: list.filter((x) => x.status === s) }));
  const pick = (id: string) => { setSelId(id); setParams({ ws: wsId, item: id }, { replace: true }); };

  const intro = t('这个工作区要做的功能、发现的问题和值得记住的笔记。Claude 可以查看和修改看板；每轮对话结束后，后台会把新的决定、确认的问题和完成的工作记下来。数据保存在 Code Agent 的数据目录，不放进仓库。');
  if (!wsId) {
    return (
      <div className="page"><div className="page-inner full">
        <div className="page-title"><h1>{t('看板')}</h1></div>
        <p className="page-sub">{intro}</p>
        <NoWorkspace text={t('看板按工作区记录。添加一个工作区后，就能在这里新建、导入条目，Claude 也会在对话后自动记录。')} />
      </div></div>
    );
  }

  return (
    <div className="page">
      <div className="page-inner full">
        <div className="page-title"><h1>{t('看板')}</h1></div>
        <p className="page-sub">{intro}</p>
        <div className="row board-bar">
          <Select value={wsId} icon="folder" className="w-240" onChange={(v) => { setSelId(null); setParams({ ws: v }); }}
            options={app.workspaces.map((w) => ({ value: w.id, label: w.name, desc: w.path }))} />
          <Seg value={view} onChange={setView} items={[
            { value: 'open', label: t('未完成') }, { value: 'all', label: t('全部') }, { value: 'unconfirmed', label: t('待确认 {n}', { n: unconfirmed.length }) },
          ]} />
          <div className="input-wrap" style={{ width: 220 }}>
            <Icon name="search" size={15} />
            <input className="input" placeholder={t('搜索编号、标题、内容')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <span className="grow" />
          <Button icon="download" onClick={() => api.boardMarkdown(wsId).then((md) => download(`board-${app.workspaces.find((w) => w.id === wsId)?.name ?? wsId}.md`, md, 'text/markdown;charset=utf-8'))}>{t('导出')}</Button>
          <Button icon="upload" onClick={() => setDialog('import')}>{t('导入')}</Button>
          <Button icon="gear" title={t('自动记录、识别用的模型和思考强度')} onClick={() => setDialog('settings')}>{t('设置')}</Button>
          <Button variant="primary" icon="plus" onClick={() => setDialog('new')}>{t('新建')}</Button>
        </div>
        {view !== 'unconfirmed' && (
          <Tabs className="board-tabs" value={kind} onChange={(k) => { setKind(k); setSelId(null); }}
            items={(['feature', 'issue', 'note'] as BoardKind[]).map((k) => ({ value: k, label: t(KIND_LABEL[k]), count: count(k) }))} />
        )}

        <div className="ext-layout board-layout">
          <div className="ext-list">
            {list.length === 0 && (
              <div className="empty" style={{ padding: 18 }}>
                <b>{view === 'unconfirmed' ? t('没有待确认的条目') : q ? t('没有匹配的条目') : t('还没有{k}', { k: t(KIND_LABEL[kind]) })}</b>
                {view !== 'unconfirmed' && !q && t('在对话里说「记到看板」，或者等后台自动记录；也可以点「新建」或「导入」。')}
              </div>
            )}
            {groups.filter((g) => g.items.length).map((g) => (
              <div key={g.title}>
                <h5>{g.title}<span className="muted">{g.items.length}</span></h5>
                {g.items.map((it) => (
                  <div key={it.id} id={`bi-${it.id}`} className={cx('ext-item', sel?.id === it.id && 'on', focus === it.id && 'focus')} onClick={() => pick(it.id)}>
                    <div className="top">
                      <Icon name={KIND_ICON[it.kind]} size={13} className="muted" />
                      <b className="mono">{it.id}</b>
                      <span className="grow truncate">{it.title}</span>
                      {it.unconfirmed && <Chip tone="accent">{t('待确认')}</Chip>}
                    </div>
                    <div className="sub">
                      <Chip tone={STATUS_TONE[it.status]}>{t(STATUS_LABEL[it.status])}</Chip>
                      {it.priority === 'high' && <span style={{ color: 'var(--warn-ink)' }}>{t('优先级高')}</span>}
                      {it.tasks.length > 0 && <span>{t('任务 {d}/{n}', { d: it.tasks.filter((x) => x.done).length, n: it.tasks.length })}</span>}
                      {it.sessions.length > 0 && <span>{t('{n} 个会话', { n: it.sessions.length })}</span>}
                      <span className="grow" />
                      <span>{relTime(it.updatedAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {sel ? <ItemDetail key={`${sel.workspaceId}:${sel.id}`} item={sel} onDeleted={() => setSelId(null)} /> : <div className="empty" style={{ marginTop: 40 }}>{t('选择左侧的条目查看详情')}</div>}
        </div>
      </div>
      {dialog === 'new' && <NewItemDialog wsId={wsId} kind={kind} onClose={() => setDialog(null)} onCreated={(it) => { setView('open'); setKind(it.kind); pick(it.id); }} />}
      {dialog === 'import' && <ImportDialog wsId={wsId} onClose={() => setDialog(null)} onDone={(first) => { if (first) { const it = useApp.getState().board.find((x) => x.workspaceId === wsId && x.id === first); if (it) { setView('open'); setKind(it.kind); pick(it.id); } } }} />}
      {dialog === 'settings' && <BoardSettingsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ detail

function ItemDetail({ item, onDeleted }: { item: BoardItem; onDeleted: () => void }) {
  const t = useT();
  const nav = useNavigate();
  const sessions = useApp((s) => s.sessions);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [task, setTask] = useState('');
  const [decision, setDecision] = useState('');
  useEffect(() => { setTitle(item.title); setBody(item.body); }, [item.title, item.body]);
  const upd = (p: Partial<BoardItem>, log?: string) => api.updateItem(item.workspaceId, item.id, p, log);
  const srcSession = item.source.sessionId ? sessions.find((s) => s.id === item.source.sessionId) : undefined;
  const source = {
    manual: t('你手动新建'),
    auto: t('后台从对话里自动记录'),
    agent: t('Claude 用看板工具新建'),
    import: t('从 {r} 导入', { r: item.source.ref ?? '' }),
    review: t('来自代码审核里没有解决的意见'),
  }[item.source.kind];
  const remove = () => useApp.getState().ask({
    title: t('删除 {id}？', { id: item.id }), body: t('「{x}」会从看板上删除。对话里提到它的地方不再是链接。', { x: item.title }), confirmLabel: t('删除'), danger: true,
    onConfirm: () => { api.deleteItem(item.workspaceId, item.id); onDeleted(); },
  });

  return (
    <div className="ext-detail">
      {item.unconfirmed && (
        <div className="banner-info" style={{ marginBottom: 0 }}>
          <Icon name="info" size={16} />
          <span className="grow">{t('这条是后台自动记录的{s}，看一下内容对不对。', { s: srcSession ? t('（来自会话「{x}」）', { x: srcSession.title }) : '' })}</span>
          <Button size="sm" variant="primary" onClick={() => api.confirmItem(item.workspaceId, item.id)}>{t('确认')}</Button>
          <Button size="sm" onClick={remove}>{t('删除')}</Button>
        </div>
      )}
      <div className="panel">
        <div className="panel-body board-detail">
          <div className="row" style={{ gap: 8 }}>
            <Icon name={KIND_ICON[item.kind]} size={16} className="muted" />
            <b className="mono">{item.id}</b>
            <Chip>{t(KIND_LABEL[item.kind])}</Chip>
            <span className="grow" />
            <Select<BoardStatus> size="sm" value={item.status} className="w-120" onChange={(v) => upd({ status: v }, t('状态改为「{s}」', { s: t(STATUS_LABEL[v]) }))}
              options={STATUSES[item.kind].map((s) => ({ value: s, label: t(STATUS_LABEL[s]) }))} />
            <Select<BoardItem['priority']> size="sm" value={item.priority} className="w-120" onChange={(v) => upd({ priority: v }, t('优先级改为「{p}」', { p: t(PRIORITY[v]) }))} renderValue={(o) => <>{t('优先级')} · {o?.label}</>}
              options={(['high', 'normal', 'low'] as const).map((p) => ({ value: p, label: t(PRIORITY[p]) }))} />
            <Button size="sm" variant="ghost" icon="trash" title={t('删除')} onClick={remove} />
          </div>
          <input className="input board-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== item.title && upd({ title: title.trim() }, t('改了标题'))} />
          <Field label={item.kind === 'feature' ? t('目标') : item.kind === 'issue' ? t('现象和证据') : t('内容')}>
            <textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => body !== item.body && upd({ body }, t('改了内容'))} />
          </Field>

          {item.kind === 'feature' && (
            <>
              <h4>{t('任务')}<span className="right">{item.tasks.filter((x) => x.done).length}/{item.tasks.length}</span></h4>
              {item.tasks.map((x) => (
                <div key={x.id} className="board-task">
                  <Check on={x.done} onChange={(v) => upd({ tasks: item.tasks.map((y) => (y.id === x.id ? { ...y, done: v } : y)) }, v ? t('完成任务：{x}', { x: x.text }) : undefined)} label={<span className={cx(x.done && 'done')}>{linkify(x.text, item.workspaceId)}</span>} />
                  <span className="grow" />
                  <Button size="sm" variant="ghost" icon="x" title={t('删除任务')} onClick={() => upd({ tasks: item.tasks.filter((y) => y.id !== x.id) })} />
                </div>
              ))}
              <input className="input sm" placeholder={t('添加任务，回车保存')} value={task} onChange={(e) => setTask(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && task.trim()) { upd({ tasks: [...item.tasks, { id: uid('t'), text: task.trim(), done: false }] }); setTask(''); } }} />

              <h4>{t('决定')}<span className="right">{t('{n} 个待定', { n: item.decisions.filter((d) => !d.outcome).length })}</span></h4>
              {item.decisions.map((d) => (
                <div key={d.id} className="board-decision">
                  <span className="q">{d.text}</span>
                  {d.outcome ? <span className="a"><Icon name="check" size={13} className="st-ok" />{d.outcome}</span>
                    : <input className="input sm" placeholder={t('待定 · 填写结论后回车')} onKeyDown={(e) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing && v) upd({ decisions: item.decisions.map((y) => (y.id === d.id ? { ...y, outcome: v } : y)) }, t('决定：{q} → {a}', { q: d.text, a: v }));
                    }} />}
                </div>
              ))}
              <input className="input sm" placeholder={t('添加一个要决定的问题，回车保存')} value={decision} onChange={(e) => setDecision(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && decision.trim()) { upd({ decisions: [...item.decisions, { id: uid('d'), text: decision.trim() }] }); setDecision(''); } }} />
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-body board-detail">
          <h4>{t('来源')}</h4>
          <div className="ink2">
            {source}
            {srcSession && <> · {t('会话')}<SessionLink r={{ sessionId: srcSession.id, title: srcSession.title }} /></>}
            {item.source.url && <> · <a href={item.source.url} target="_blank" rel="noreferrer">{item.source.url.replace(/^https?:\/\//, '')}</a></>}
          </div>
          <h4>{t('相关会话')}</h4>
          {item.sessions.length === 0 ? <div className="hint">{t('还没有会话处理过它')}</div> : (
            <div className="board-sessions">
              {item.sessions.map((id) => {
                const s = sessions.find((x) => x.id === id);
                return s ? <SessionLink key={id} r={{ sessionId: id, title: s.title }} /> : null;
              })}
            </div>
          )}
          <h4>{t('记录')}</h4>
          <div className="board-log">
            {[...item.log].reverse().map((l, i) => {
              const s = l.sessionId ? sessions.find((x) => x.id === l.sessionId) : undefined;
              return (
                <div key={i} className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                  <span className="muted" style={{ width: 70, flex: 'none' }}>{relTime(l.ts)}</span>
                  <span className="grow">{t(l.text)}{s && <span className="muted"> · {s.title}</span>}</span>
                  {l.auto && <Chip>{t('自动')}</Chip>}
                </div>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 10 }}>
            {t('在对话里提到 {id} 时会显示成链接。', { id: item.id })}
            <button className="link-btn" onClick={() => nav(`/s/${item.sessions[item.sessions.length - 1] ?? ''}`)} hidden={!item.sessions.length}>{t('打开最近的会话')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ dialogs

function NewItemDialog({ wsId, kind: initial, onClose, onCreated }: { wsId: string; kind: BoardKind; onClose: () => void; onCreated: (it: BoardItem) => void }) {
  const t = useT();
  const [kind, setKind] = useState<BoardKind>(initial);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const create = async () => {
    const it = await api.createItem(wsId, { kind, title: title.trim(), body }, { kind: 'manual' });
    onClose();
    onCreated(it);
  };
  return (
    <Modal title={t('新建看板条目')} width={520} onClose={onClose}
      footer={<><Button onClick={onClose}>{t('取消')}</Button><Button variant="primary" disabled={!title.trim()} onClick={() => create()}>{t('新建')}</Button></>}>
      <div className="col" style={{ gap: 12 }}>
        <Seg value={kind} onChange={setKind} items={(['feature', 'issue', 'note'] as BoardKind[]).map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} />
        <Field label={t('标题')}><input className="input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={kind === 'feature' ? t('目标') : kind === 'issue' ? t('现象和证据') : t('内容')}><textarea className="textarea" rows={4} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

type Source = 'github' | 'jira' | 'paste' | 'file';

function ImportDialog({ wsId, onClose, onDone }: { wsId: string; onClose: () => void; onDone: (firstCreated?: string) => void }) {
  const t = useT();
  const app = useApp();
  const rm = app.models.find((m) => m.id === app.boardSettings.recorderModel);
  const recorder = `${rm?.label ?? app.boardSettings.recorderModel}${takesEffort(rm) ? ` · ${t('思考')}${t(EFFORT_LABEL[app.boardSettings.recorderEffort])}` : ''}`;
  const jiraOk = app.mcp.some((m) => /jira|atlassian/i.test(m.name) && m.status === 'connected' && (m.scope !== 'workspace' || m.workspaceId === wsId));
  const [source, setSource] = useState<Source>('github');
  const [repo, setRepo] = useState('');
  const [query, setQuery] = useState('is:open');
  const [jql, setJql] = useState('status != Done ORDER BY updated DESC');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [step, setStep] = useState<'source' | 'working' | 'preview'>('source');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const items = app.board.filter((x) => x.workspaceId === wsId);

  const ready = source === 'github' ? true : source === 'jira' ? jiraOk && !!jql.trim() : !!text.trim();
  const run = async () => {
    setStep('working');
    try {
      const input = source === 'github' ? JSON.stringify({ repo: repo.trim(), query: query.trim() }) : source === 'jira' ? jql : text;
      setRows(await api.importPreview(wsId, source, input));
      setStep('preview');
    } catch {
      setStep('source');
    }
  };
  const apply = async () => {
    const created = await api.applyImport(wsId, rows);
    const merged = rows.filter((r) => r.action !== 'create' && r.action !== 'skip').length;
    app.toast(t('导入完成：新建 {c} 条，合并 {m} 条', { c: created.length, m: merged }), 'good');
    onClose();
    onDone(created[0]);
  };
  const setRow = (key: string, p: Partial<ImportRow>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const nCreate = rows.filter((r) => r.action === 'create').length;
  const nSkip = rows.filter((r) => r.action === 'skip').length;

  return (
    <Modal title={t('导入到看板')} sub={step === 'preview' ? t('Claude 整理好了，确认后才写入') : t('Claude 读取来源，整理成条目，并和看板上已有的条目查重')} width={step === 'preview' ? 980 : 600} onClose={onClose}
      footLeft={step === 'preview' ? <span className="hint">{t('将新建 {c} 条，合并 {m} 条，跳过 {s} 条', { c: nCreate, m: rows.length - nCreate - nSkip, s: nSkip })}</span> : undefined}
      footer={step === 'preview'
        ? <><Button onClick={() => setStep('source')}>{t('返回')}</Button><Button variant="primary" disabled={nCreate + (rows.length - nCreate - nSkip) === 0} onClick={() => apply()}>{t('导入')}</Button></>
        : <><Button onClick={onClose}>{t('取消')}</Button><Button variant="primary" disabled={!ready || step === 'working'} onClick={() => run()}>{t('读取并整理')}</Button></>}>
      {step === 'source' && (
        <div className="col" style={{ gap: 12 }}>
          <Seg value={source} onChange={setSource} items={[
            { value: 'github', label: 'GitHub Issues' }, { value: 'jira', label: 'Jira' }, { value: 'paste', label: t('粘贴文本') }, { value: 'file', label: t('文件') },
          ]} />
          {source === 'github' && (
            <>
              <div className="form-grid">
                <Field label={t('仓库')} hint={t('owner/repo；留空时用工作区的 git 远程仓库')}><input className="input mono" placeholder="owner/repo" value={repo} onChange={(e) => setRepo(e.target.value)} /></Field>
                <Field label={t('筛选')}><input className="input mono" value={query} onChange={(e) => setQuery(e.target.value)} /></Field>
              </div>
              <div className="hint">{t('通过 gh 命令读取，需要先在你的终端里登录 gh。')}</div>
            </>
          )}
          {source === 'jira' && (jiraOk
            ? <Field label="JQL"><input className="input mono" value={jql} onChange={(e) => setJql(e.target.value)} /></Field>
            : <div className="banner-warn"><Icon name="warning" size={15} /><span>{t('通过 Jira（Atlassian）的 MCP 服务器读取。还没有已连接的 Jira MCP 服务器：先在 MCP 页面添加并登录。')}</span></div>)}
          {source === 'paste' && (
            <Field label={t('内容')} hint={t('每行一条，可以直接粘贴待办清单、会议记录或 issue 列表')}>
              <textarea className="textarea" rows={7} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('- 支付回调偶尔超时，需要修复\n- 订单列表需要支持按日期筛选')} />
            </Field>
          )}
          {source === 'file' && (
            <Field label={t('文件')} hint={t('Markdown、CSV、JSON 或纯文本')}>
              <div className="row">
                <label className="btn">
                  <Icon name="upload" size={15} />{t('选择文件…')}
                  <input type="file" accept=".md,.csv,.json,.txt" hidden onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    setFileName(f.name);
                    const r = new FileReader();
                    r.onload = () => setText(String(r.result));
                    r.readAsText(f);
                  }} />
                </label>
                <span className="muted">{fileName || t('还没有选择')}</span>
              </div>
            </Field>
          )}
        </div>
      )}
      {step === 'working' && (
        <div className="row ink2" style={{ padding: '24px 4px' }}>
          <span className="spinner" />{t('Claude 正在读取并整理（{m}）…', { m: recorder })}
        </div>
      )}
      {step === 'preview' && (
        <table className="import-table">
          <thead><tr><th>{t('来源')}</th><th>{t('类型')}</th><th>{t('标题')}</th><th>{t('处理')}</th><th>{t('原因')}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className={cx(r.action === 'skip' && 'skip')}>
                <td className="mono">{r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.ref}</a> : r.ref}</td>
                <td><Select<BoardKind> size="sm" value={r.kind} onChange={(v) => setRow(r.key, { kind: v })} options={(['feature', 'issue', 'note'] as BoardKind[]).map((k) => ({ value: k, label: t(KIND_LABEL[k]) }))} /></td>
                <td><input className="input sm" value={r.title} onChange={(e) => setRow(r.key, { title: e.target.value })} /></td>
                <td>
                  <Select size="sm" value={r.action} width={300} onChange={(v) => setRow(r.key, { action: v })}
                    options={[{ value: 'create', label: t('新建') }, { value: 'skip', label: t('跳过') },
                      ...items.map((x) => ({ value: x.id, label: t('合并到 {id}', { id: x.id }), desc: x.title }))]} />
                </td>
                <td className="muted">{t(r.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

/** The board's settings: the recorder and the model it runs on. Also opened from a session's board check. */
export function BoardSettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const s = useApp((x) => x.boardSettings);
  const models = useApp((x) => x.models);
  const provider = useApp((x) => x.provider);
  // The server runs a model that is not offered (a Claude model without the login) on the first one there is.
  const effective = models.some((m) => m.id === s.recorderModel) ? s.recorderModel : models[0]?.id ?? '';
  const recorder = models.find((m) => m.id === effective);
  const usable = provider.loggedIn || models.some((m) => m.endpoint);
  const set = (p: Partial<typeof s>) => useApp.getState().set({ boardSettings: { ...s, ...p } });
  return (
    <Modal title={t('看板设置')} width={560} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>{t('完成')}</Button>}>
      <div className="col" style={{ gap: 14 }}>
        <div>
          <Toggle on={s.recorder} disabled={!usable && !s.recorder} onChange={(v) => set({ recorder: v })} label={t('每轮对话结束后自动记录')} />
          {!usable && <div className="hint" style={{ marginTop: 4, color: 'var(--warn)' }}>{t('没有可用的模型：先在终端里登录 Claude Code，或在「模型服务与账号」里添加兼容端点。')}</div>}
          <div className="hint" style={{ marginTop: 4, lineHeight: 1.6 }}>{t('只记你拍板的决定、确认过的问题和完成的工作，讨论中的想法不记；优先更新已有条目。直接写进看板并标为「待确认」，对话里可以一键撤销。')}</div>
        </div>
        <Field label={t('后台识别用的模型')} hint={t('自动记录和导入时整理条目都用它。在后台运行，不拖慢会话；选便宜的模型、较低的思考强度就够了。')}>
          <div className="row" style={{ gap: 8 }}>
            <Select value={effective} className="w-240" icon="cpu"
              onChange={(v) => set({ recorderModel: v, recorderEffort: effortFor(models, v, s.recorderEffort, 'lowest') })}
              options={modelOptions(models, t)} />
            <Select<Effort> value={s.recorderEffort} className="w-240" icon="bulb" renderValue={(o) => <>{t('思考')} · {o?.label}</>} onChange={(v) => set({ recorderEffort: v })}
              disabled={!takesEffort(recorder)} options={effortOptions(recorder, s.recorderEffort, t)} />
          </div>
          {effective !== s.recorderModel && recorder && <div className="hint" style={{ marginTop: 4 }}>{t('选的模型现在不可用，改用 {m}。', { m: recorder.label })}</div>}
        </Field>
        <ul className="plain-list">
          <li>{t('每个会话里，Claude 都有四个看板工具：搜索、查看、新建、修改。你说「记到看板」，它就会先查重再记。')}</li>
          <li>{t('Claude 提到条目时会写编号，对话里的编号可以点，鼠标停在上面能看到摘要。')}</li>
          <li>{t('代码审核结束时没解决的意见，可以在审核记录里一键记成问题。')}</li>
        </ul>
      </div>
    </Modal>
  );
}
