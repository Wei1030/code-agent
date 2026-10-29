/** Right-hand inspector: tasks, background work, changes, checkpoints, context, raw events, a file, session info. */
import { useEffect, useMemo, useState } from 'react';
import type { SessionRuntime } from '../api/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button, Chip, Modal, Tabs } from '../components/ui';
import { useApp, type InspectorTab } from '../store/app';
import { clock, duration, relTime, tokens as fmtTokens, pct } from '../lib/format';
import { cx, download } from '../lib/util';
import { useT } from '../lib/i18n';
import { MODE_INFO } from '../lib/catalog';
import { highlightLines, languageOf } from '../lib/highlight';
import { openPreview } from '../lib/preview';
import { DiffLines } from './Transcript';

const TABS: Array<{ value: InspectorTab; label: string; icon: string }> = [
  { value: 'tasks', label: '任务', icon: 'list' },
  { value: 'background', label: '后台', icon: 'layers' },
  { value: 'changes', label: '变更', icon: 'pencil' },
  { value: 'checkpoints', label: '检查点', icon: 'rewind' },
  { value: 'context', label: '上下文', icon: 'gauge' },
  { value: 'events', label: '事件', icon: 'braces' },
  { value: 'file', label: '文件', icon: 'file' },
  { value: 'info', label: '信息', icon: 'info' },
];

const MIN_W = 280;
const MAX_W = 900;
const CENTER_MIN = 560;

/**
 * The icon rail on the far right is always there. Clicking an icon opens the panel on that tab;
 * clicking the open tab's icon closes it. The panel's left edge can be dragged to resize it.
 */
export function Inspector({ rt, onRewind }: { rt: SessionRuntime; onRewind: (userId: string) => void }) {
  const t = useT();
  const ins = useApp((s) => s.inspector);
  const setInspector = useApp((s) => s.setInspector);
  const [dragging, setDragging] = useState(false);
  const counts: Partial<Record<InspectorTab, number>> = {
    tasks: rt.tasks.filter((x) => x.status !== 'completed').length || undefined,
    background: rt.background.filter((b) => b.status === 'running').length || undefined,
    changes: rt.changes.length || undefined,
  };
  const current = TABS.find((x) => x.value === ins.tab) ?? TABS[0];

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = ins.width;
    // Keep the conversation column at least CENTER_MIN wide (nav rail + session list + icon rail = 368 px).
    const max = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - 368 - CENTER_MIN));
    setDragging(true);
    const move = (ev: PointerEvent) => setInspector({ width: Math.round(Math.min(max, Math.max(MIN_W, startW + startX - ev.clientX))) });
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className={cx('ins-wrap', dragging && 'dragging')}>
      {ins.open && (
        <aside className="inspector" style={{ width: ins.width }}>
          <div className="ins-resize" onPointerDown={startResize} onDoubleClick={() => setInspector({ width: 340 })} title={t('拖动调整宽度，双击恢复')} />
          <div className="ins-head"><Icon name={current.icon} size={15} className="muted" /><b>{t(current.label)}</b></div>
          <div className="ins-body">
            {ins.tab === 'tasks' && <TasksTab rt={rt} />}
            {ins.tab === 'background' && <BackgroundTab rt={rt} />}
            {ins.tab === 'changes' && <ChangesTab rt={rt} />}
            {ins.tab === 'checkpoints' && <CheckpointsTab rt={rt} onRewind={onRewind} />}
            {ins.tab === 'context' && <ContextTab rt={rt} />}
            {ins.tab === 'events' && <EventsTab rt={rt} />}
            {ins.tab === 'file' && <FileTab rt={rt} />}
            {ins.tab === 'info' && <InfoTab rt={rt} />}
          </div>
        </aside>
      )}
      <nav className="ins-rail" aria-label={t('右侧面板')}>
        {TABS.map((tb) => {
          const on = ins.open && ins.tab === tb.value;
          return (
            <button key={tb.value} className={cx('ins-rail-btn', on && 'on')} title={on ? t('收起') : t(tb.label)}
              onClick={() => setInspector(on ? { open: false } : { open: true, tab: tb.value })}>
              <Icon name={tb.icon} size={17} />
              <span>{t(tb.label)}</span>
              {counts[tb.value] !== undefined && <span className="badge">{counts[tb.value]}</span>}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function TasksTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  if (rt.tasks.length === 0) return <div className="empty"><b>{t('还没有任务')}</b>{t('Claude 拆分多步骤工作时，任务清单会显示在这里。')}</div>;
  const done = rt.tasks.filter((x) => x.status === 'completed').length;
  return (
    <>
      <h4>{t('任务清单')}<span className="right">{t('{d}/{n} 已完成', { d: done, n: rt.tasks.length })}</span></h4>
      {rt.tasks.map((x) => (
        <div key={x.id} className="task">
          <span className={cx('ck', x.status)}>{x.status === 'completed' && <Icon name="check" size={10} strokeWidth={3} />}</span>
          <div className="grow">
            <div className={cx('s', x.status)}>{x.subject}</div>
            {x.status === 'in_progress' && x.activeForm && <div className="af">{x.activeForm}…</div>}
            {x.blockedBy && <div className="hint">{t('等待：{b}', { b: x.blockedBy })}</div>}
          </div>
        </div>
      ))}
    </>
  );
}

function BackgroundTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const canBackground = rt.items.some((it) => it.kind === 'tool' && it.backgroundable && it.status === 'running');
  const kindLabel = { agent: '子代理', bash: '命令', workflow: '工作流', monitor: '监控' } as const;
  const statusTone = { running: 'accent', completed: 'good', failed: 'crit', stopped: 'outline' } as const;
  const statusLabel = { running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止' } as const;
  const [output, setOutput] = useState<{ name: string; text: string } | null>(null);
  return (
    <>
      {output && (
        <Modal title={t('输出 · {n}', { n: output.name })} width={760} onClose={() => setOutput(null)} footer={<Button onClick={() => setOutput(null)}>{t('关闭')}</Button>}>
          <pre className="code-block" style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{output.text}</pre>
        </Modal>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <Button size="sm" icon="layers" disabled={!canBackground} onClick={() => api.backgroundAll(rt.id)}>{t('把当前工作转入后台')}</Button>
        <span className="hint">{canBackground ? t('长时间运行的命令会继续执行，Claude 可以先做别的') : t('当前没有可转入后台的工作')}</span>
      </div>
      {rt.background.length === 0 && <div className="empty"><b>{t('没有后台任务')}</b>{t('后台子代理、后台命令和监控会显示在这里。')}</div>}
      {rt.background.map((b) => (
        <div key={b.id} className="bg-card">
          <Icon name={b.kind === 'agent' ? 'agent' : b.kind === 'bash' ? 'terminal' : 'layers'} size={18} className="muted" />
          <div className="grow">
            <div className="row">
              <span className="n truncate">{b.name}</span>
              <Chip tone={statusTone[b.status]}>{t(statusLabel[b.status])}</Chip>
            </div>
            <div className="k">
              {t(kindLabel[b.kind])} · {t('开始于 {c}', { c: clock(b.startedAt) })}
              {b.endedAt ? ` · ${t('用时 {d}', { d: duration((b.endedAt - b.startedAt) / 1000) })}` : ''}
              {b.tokens ? ` · ${fmtTokens(b.tokens)} tokens` : ''}
            </div>
            {b.summary && <div className="sum">{b.summary}</div>}
            <div className="row" style={{ marginTop: 6 }}>
              <Button size="sm" variant="ghost" icon="eye" onClick={() => api.taskOutput(rt.id, b.id).then((text) => setOutput({ name: b.name, text }))}>{t('查看输出')}</Button>
              {b.status === 'running' && <Button size="sm" variant="danger-outline" icon="stop" onClick={() => api.stopTask(rt.id, b.id)}>{t('停止')}</Button>}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function ChangesTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(rt.changes[0]?.path ?? null);
  if (rt.changes.length === 0) return <div className="empty"><b>{t('还没有文件变更')}</b>{t('Claude 修改的文件会列在这里，可以逐个查看差异。')}</div>;
  const add = rt.changes.reduce((a, c) => a + c.add, 0);
  const del = rt.changes.reduce((a, c) => a + c.del, 0);
  return (
    <>
      <h4>{t('{n} 个文件', { n: rt.changes.length })}<span className="right"><span className="add-n">+{add}</span> <span className="del-n">−{del}</span></span></h4>
      {rt.changes.map((c) => (
        <div key={c.path} className="change">
          <div className="change-head" onClick={() => setOpen(open === c.path ? null : c.path)}>
            <Icon name={open === c.path ? 'chevDown' : 'chevRight'} size={14} className="muted" />
            <span className="p" title={c.path}>{c.path}</span>
            {c.kind === 'created' && <Chip tone="good">{t('新建')}</Chip>}
            <button className="btn ghost sm" title={t('预览这个文件')} onClick={(e) => { e.stopPropagation(); openPreview(rt.id, { path: c.path }); }}><Icon name="eye" size={13} /></button>
            <span className="add-n">+{c.add}</span><span className="del-n">−{c.del}</span>
          </div>
          {open === c.path && (
            <DiffLines lines={c.diff} lang={languageOf(c.path)} style={{ borderRadius: 0, border: 0, borderTop: '1px solid var(--border)' }} />
          )}
        </div>
      ))}
    </>
  );
}

function CheckpointsTab({ rt, onRewind }: { rt: SessionRuntime; onRewind: (userId: string) => void }) {
  const t = useT();
  const users = rt.items.flatMap((it, i) => (it.kind === 'user' ? [{ it, i }] : []));
  if (users.length === 0) return <div className="empty"><b>{t('还没有检查点')}</b>{t('每条你发送的消息都是一个检查点，可以把文件回退到它之前。')}</div>;
  return (
    <>
      <div className="hint" style={{ marginBottom: 10 }}>{t('每条消息之前都会保存文件快照。回退只恢复文件，对话可以保留，也可以从那里分叉。')}</div>
      {users.map(({ it }, n) => {
        if (it.kind !== 'user') return null;
        const changed = rt.changes.filter((c) => c.afterUserId === it.id).length;
        return (
          <div key={it.id} className="cp">
            <span className="n">#{n + 1}</span>
            <div className="grow">
              <div className="truncate">{it.text || t('（附件）')}</div>
              <div className="hint">{relTime(it.ts)}{changed ? ` · ${t('之后改动 {n} 个文件', { n: changed })}` : ''}</div>
            </div>
            <Button size="sm" icon="rewind" disabled={rt.readOnly} onClick={() => onRewind(it.id)}>{t('回退到这里')}</Button>
          </div>
        );
      })}
    </>
  );
}

const CTX_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)'];

function ContextTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const app = useApp();
  const [instructions, setInstructions] = useState('');
  const [counting, setCounting] = useState(false);
  const c = rt.context;
  const used = c.categories.filter((x) => x.kind === 'used');
  const usedSum = used.reduce((a, x) => a + x.tokens, 0);
  const buffer = c.categories.filter((x) => x.kind === 'buffer').reduce((a, x) => a + x.tokens, 0);
  const free = Math.max(0, c.max - usedSum - buffer);
  const busy = rt.state !== 'idle' || rt.readOnly;
  return (
    <>
      <h4>
        {t('上下文')} · {fmtTokens(usedSum)} / {fmtTokens(c.max)}
        <span className="right">{c.precise ? t('精确统计') : t('估算值')}</span>
      </h4>
      <div className="hint">{c.model}</div>
      <div className="ctx-bar" role="img" aria-label={t('上下文占用 {p}', { p: pct((usedSum / c.max) * 100) })}>
        {used.map((x, i) => <div key={x.name} title={`${t(x.name)} · ${fmtTokens(x.tokens)}`} style={{ width: `${(x.tokens / c.max) * 100}%`, background: CTX_COLORS[i % CTX_COLORS.length] }} />)}
        <div className="hatch" title={`${t('压缩预留')} · ${fmtTokens(buffer)}`} style={{ width: `${(buffer / c.max) * 100}%` }} />
      </div>
      <table className="data-table ctx-table">
        <thead><tr><th>{t('类别')}</th><th className="num">tokens</th><th className="num">{t('占比')}</th></tr></thead>
        <tbody>
          {used.map((x, i) => (
            <tr key={x.name}><td><span className="sw" style={{ background: CTX_COLORS[i % CTX_COLORS.length] }} />{t(x.name)}</td><td className="num">{fmtTokens(x.tokens)}</td><td className="num">{pct((x.tokens / c.max) * 100, 1)}</td></tr>
          ))}
          <tr><td><span className="sw hatch" />{t('压缩预留')}</td><td className="num">{fmtTokens(buffer)}</td><td className="num">{pct((buffer / c.max) * 100, 1)}</td></tr>
          <tr><td><span className="sw" style={{ background: 'var(--surface-3)', border: '1px solid var(--border)' }} />{t('可用')}</td><td className="num">{fmtTokens(free)}</td><td className="num">{pct((free / c.max) * 100, 1)}</td></tr>
        </tbody>
      </table>
      <div className="hint" style={{ margin: '8px 0 14px' }}>{t('另有 {n} 个延迟加载的工具（约 {k}），用到时才载入。', { n: c.deferred.tools, k: fmtTokens(c.deferred.tokens) })}</div>
      <div className="row" style={{ marginBottom: 16 }}>
        <Button size="sm" icon="refresh" disabled={counting || rt.readOnly} onClick={async () => { setCounting(true); await api.preciseCount(rt.id); setCounting(false); }}>
          {counting ? t('统计中…') : t('精确统计')}
        </Button>
        <span className="hint">{t('调用 token 计数接口；第三方端点可能不支持')}</span>
      </div>

      <h4>{t('记忆文件')}</h4>
      <table className="data-table" style={{ marginBottom: 16 }}>
        <tbody>{c.memoryFiles.map((m) => <tr key={m.path}><td className="mono">{m.path}</td><td className="num">{fmtTokens(m.tokens)}</td></tr>)}</tbody>
      </table>
      <h4>MCP</h4>
      <table className="data-table" style={{ marginBottom: 16 }}>
        <tbody>{c.mcp.map((m) => <tr key={m.server}><td><b>{m.server}</b> <span className="muted">{t(m.detail)}</span></td><td className="num">{fmtTokens(m.tokens)}</td></tr>)}</tbody>
      </table>

      <h4>{t('压缩')}</h4>
      <textarea className="textarea" rows={2} placeholder={t('压缩说明（可选），例如：保留与限流相关的决定')} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
      <div className="row" style={{ marginTop: 8 }}>
        <Button size="sm" variant="primary" icon="layers" disabled={busy} onClick={() => { void api.compact(rt.id, instructions.trim()); setInstructions(''); }}>{t('立即压缩')}</Button>
        <Button size="sm" variant="danger-outline" icon="trash" disabled={busy} onClick={() => app.ask({
          title: t('清空对话？'), body: t('Claude 会忘记这次对话的全部内容，从头开始。文件不会被改动。'), confirmLabel: t('清空'), danger: true,
          onConfirm: () => api.clearConversation(rt.id),
        })}>{t('清空对话')}</Button>
      </div>
      {busy && !rt.readOnly && <div className="hint" style={{ marginTop: 6 }}>{t('Claude 正在工作，本轮结束后才能压缩或清空。')}</div>}
    </>
  );
}

function EventsTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const sub = useApp((s) => s.inspector.eventsSub);
  const setInspector = useApp((s) => s.setInspector);
  const debugOn = useApp((s) => s.runtime.debugLog);
  const [hidden, setHidden] = useState<Set<string>>(new Set(['stream_event']));
  const [q, setQ] = useState('');
  const [paused, setPaused] = useState<number | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const groups = useMemo(() => {
    const s = new Set(rt.events.map((e) => e.type.split('/')[0]));
    s.add('stream_event');
    return [...s].sort();
  }, [rt.events]);
  const source = paused === null ? rt.events : rt.events.filter((e) => e.seq <= paused);
  const hooks = rt.events.filter((e) => e.type === 'system/hook_response' || e.type.startsWith('hook'));
  const list = (sub === 'hooks' ? hooks : source).filter((e) => !hidden.has(e.type.split('/')[0]) || sub === 'hooks')
    .filter((e) => !q || `${e.type} ${e.summary}`.toLowerCase().includes(q.toLowerCase()));
  const selected = rt.events.find((e) => e.seq === sel);

  const exportJsonl = () => download(`${rt.id}-events.jsonl`, rt.events.map((e) => JSON.stringify({ seq: e.seq, ts: e.ts, type: e.type, ...((e.json as object) ?? {}) })).join('\n'), 'application/x-ndjson');

  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Tabs value={sub} onChange={(v) => setInspector({ eventsSub: v })} items={[
          { value: 'events', label: t('SDK 消息'), count: rt.events.length },
          { value: 'stderr', label: 'stderr', count: rt.stderr.length },
          { value: 'hooks', label: t('钩子'), count: hooks.length },
          ...(debugOn ? [{ value: 'debug' as const, label: t('调试日志') }] : []),
        ]} />
      </div>
      {sub === 'debug' && debugOn ? <DebugLog sid={rt.id} /> : sub === 'stderr' ? (
        <pre className="code-block" style={{ maxHeight: 'none', whiteSpace: 'pre-wrap' }}>{rt.stderr.length ? rt.stderr.join('\n') : t('（没有输出）')}</pre>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <input className="input sm grow" placeholder={t('搜索类型或内容')} value={q} onChange={(e) => setQ(e.target.value)} />
            <Button size="sm" variant="ghost" icon={paused === null ? 'stop' : 'play'} title={paused === null ? t('暂停滚动') : t('继续实时')}
              onClick={() => setPaused(paused === null ? (rt.events[rt.events.length - 1]?.seq ?? 0) : null)} />
            <Button size="sm" variant="ghost" icon="download" title={t('导出 JSONL')} onClick={exportJsonl} />
          </div>
          {sub === 'events' && (
            <div className="ev-filters">
              {groups.map((g) => (
                <button key={g} className={cx(!hidden.has(g) && 'on')} onClick={() => {
                  const n = new Set(hidden);
                  if (n.has(g)) n.delete(g); else n.add(g);
                  setHidden(n);
                }}>{g}</button>
              ))}
            </div>
          )}
          {paused !== null && <div className="hint" style={{ marginBottom: 6 }}>{t('已暂停 · 新事件 {n} 条', { n: rt.events.filter((e) => e.seq > paused).length })}</div>}
          <div className="ev-list">
            {list.length === 0 && <div className="empty">{t('没有事件')}</div>}
            {list.slice(-300).map((e) => (
              <div key={e.seq} className={cx('ev-row', sel === e.seq && 'on')} onClick={() => setSel(sel === e.seq ? null : e.seq)}>
                <span className="muted">{e.seq}</span>
                <span className="muted">{clock(e.ts)}</span>
                <span className="ty">{e.type}</span>
                <span className="sm">{t(e.summary)}</span>
              </div>
            ))}
          </div>
          {selected && (
            <div className="ev-json">
              <div className="row" style={{ marginBottom: 4 }}>
                <b className="mono" style={{ fontSize: 12 }}>#{selected.seq} {selected.type}</b>
                <span className="grow" />
                <Button size="sm" variant="ghost" icon="copy" title={t('复制')} onClick={() => { void navigator.clipboard?.writeText(JSON.stringify(selected.json, null, 2)); useApp.getState().toast(t('已复制'), 'good'); }} />
              </div>
              <pre className="code-block" style={{ maxHeight: 320 }}>{JSON.stringify(selected.json, null, 2)}</pre>
            </div>
          )}
        </>
      )}
    </>
  );
}

/** The file opened from the conversation or the changes list, with the lines Claude read marked. */
function FileTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const preview = useApp((s) => s.preview);
  const setInspector = useApp((s) => s.setInspector);
  const p = preview?.sid === rt.id ? preview : null;
  const [file, setFile] = useState<{ path: string; content: string; lines: number; truncated: boolean; binary: boolean } | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setFile(null);
    setError('');
    if (!p) return;
    api.readWorkspaceFile(rt.id, p.path).then(setFile, (e: Error) => setError(e.message));
  }, [rt.id, p?.path, p]);
  useEffect(() => {
    if (!file || !p?.from) return;
    document.getElementById(`fl-${p.from}`)?.scrollIntoView({ block: 'center' });
  }, [file, p?.from]);
  if (!p) return <div className="empty"><b>{t('还没有打开文件')}</b>{t('点对话里工具卡片上的文件路径，或变更列表里的预览按钮，文件内容会显示在这里。')}</div>;
  const changed = rt.changes.some((c) => c.path === file?.path || c.path === p.path);
  const lines = file && !file.binary ? highlightLines(file.content.replace(/\n$/, ''), languageOf(file.path)) : [];
  return (
    <>
      <h4 className="row" style={{ gap: 6 }}>
        <span className="mono truncate" title={file?.path ?? p.path}>{file?.path ?? p.path}</span>
        <span className="right row" style={{ gap: 6 }}>
          {file && <span className="hint">{t('{n} 行', { n: file.lines })}</span>}
          {changed && <Button size="sm" variant="ghost" onClick={() => setInspector({ tab: 'changes' })}>{t('在变更里看')}</Button>}
          <Button size="sm" variant="ghost" icon="refresh" title={t('重新读取')} onClick={() => api.readWorkspaceFile(rt.id, p.path).then(setFile, (e: Error) => setError(e.message))} />
        </span>
      </h4>
      {error && <div className="banner-warn"><Icon name="warning" size={15} />{error}</div>}
      {file?.binary && <div className="empty">{t('这是二进制文件，不显示内容。')}</div>}
      {file?.truncated && <div className="hint">{t('文件太大，只显示前 1 MB。')}</div>}
      {file && !file.binary && (
        <div className="file-view mono">
          {lines.map((html, i) => {
            const n = i + 1;
            const mark = p.from !== undefined && n >= p.from && n <= (p.to ?? p.from);
            return (
              <div key={n} id={`fl-${n}`} className={cx('fl', mark && 'mark')}>
                <span className="ln">{n}</span>
                <span className="lc" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

const MCP_STATUS: Record<string, string> = { connected: '已连接', failed: '连接失败', 'needs-auth': '需要登录', pending: '连接中', disabled: '已关闭' };

/** What the session's Claude Code process reported about itself, and how to continue it in a terminal. */
function InfoTab({ rt }: { rt: SessionRuntime }) {
  const t = useT();
  const app = useApp();
  const sum = app.sessions.find((s) => s.id === rt.id);
  const ws = app.workspaces.find((w) => w.id === sum?.workspaceId);
  const model = app.models.find((m) => m.id === rt.model);
  const info = rt.info ?? {};
  const prof = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
  const sources = [prof.sources.user && t('用户'), prof.sources.project && t('项目'), prof.sources.local && t('本地')].filter(Boolean).join(' · ') || t('不读取');
  const memory = rt.context.memoryFiles.map((m) => m.path);
  const cwd = info.cwd || sum?.cwd || ws?.path || '';
  const resume = `claude --resume ${rt.id}`;
  const copy = (text: string, what: string) => { void navigator.clipboard?.writeText(text); app.toast(t('已复制{w}', { w: what }), 'good'); };
  return (
    <>
      <dl className="kv">
        <dt>{t('会话 ID')}</dt><dd className="mono">{rt.id}</dd>
        <dt>{t('工作目录')}</dt><dd className="mono">{cwd}</dd>
        {sum?.worktree && <><dt>{t('工作树分支')}</dt><dd className="mono">{sum.worktree}</dd></>}
        <dt>{t('模型')}</dt><dd>{model ? `${model.label} · ${model.endpoint ? t('{e}（兼容端点）', { e: model.desc }) : t('Claude 订阅')}` : rt.model}{info.apiModel && <div className="hint mono">{info.apiModel}</div>}</dd>
        <dt>Claude Code</dt><dd>{info.version ? `${info.version}` : '—'} · {app.provider.executable === 'system' ? t('系统中安装的 claude') : t('随 SDK 提供')}{info.pid ? ` · ${t('进程 {p}', { p: info.pid })}` : ''}</dd>
        <dt>{t('权限模式')}</dt><dd>{t(MODE_INFO[rt.mode]?.label ?? rt.mode)}</dd>
        <dt>{t('设置文件')}</dt><dd>{sources}</dd>
        {memory.length > 0 && <><dt>{t('说明文件')}</dt><dd className="mono">{memory.join('\n')}</dd></>}
        {info.outputStyle && <><dt>{t('输出风格')}</dt><dd>{info.outputStyle === 'default' ? t('默认') : info.outputStyle}</dd></>}
        <dt>MCP</dt><dd>{info.mcp?.length ? info.mcp.map((m) => <div key={m.name}>{m.name} <span className={m.status === 'connected' ? 'muted' : 'del-n'}>{t(MCP_STATUS[m.status] ?? m.status)}</span></div>) : '—'}</dd>
        {info.agents?.length ? <><dt>{t('子代理')}</dt><dd>{info.agents.join('、')}</dd></> : null}
        <dt>{t('进程')}</dt><dd>{sum?.live ? (info.startedAt ? t('{t} 启动 · 第 {n} 次', { t: relTime(info.startedAt), n: info.starts ?? 1 }) : t('运行中')) : t('没有运行（已保存）')}</dd>
      </dl>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <Button size="sm" icon="copy" onClick={() => copy(rt.id, t('会话 ID'))}>{t('复制会话 ID')}</Button>
        <Button size="sm" icon="terminal" onClick={() => copy(`cd "${cwd}" && ${resume}`, t('命令'))}>{t('复制「在终端里继续」的命令')}</Button>
      </div>
      <div className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>{t('在终端里运行 {c} 可以接着这段对话，回到这里打开它时会补上终端里新聊的内容。先在这里保存会话，避免两边同时写同一段对话。', { c: resume })}</div>
    </>
  );
}

function DebugLog({ sid }: { sid: string }) {
  const t = useT();
  const app = useApp();
  const [log, setLog] = useState<{ path: string; exists: boolean; tail: string } | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.debugLog(sid).then((l) => alive && setLog(l), () => undefined);
    void load();
    const timer = setInterval(load, 3000);
    return () => { alive = false; clearInterval(timer); };
  }, [sid]);
  if (!log) return null;
  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="hint mono truncate grow" title={log.path}>{log.path}</span>
        <Button size="sm" variant="ghost" icon="copy" onClick={() => { void navigator.clipboard?.writeText(log.path); app.toast(t('已复制路径'), 'good'); }}>{t('复制路径')}</Button>
      </div>
      {log.exists
        ? <pre className="log-tail">{log.tail}</pre>
        : <div className="empty">{t('这个会话还没有调试日志：打开「保存调试日志」后启动或恢复的会话才会写。')}</div>}
    </>
  );
}
