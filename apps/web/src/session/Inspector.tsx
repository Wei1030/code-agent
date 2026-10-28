/** Right-hand inspector: tasks, background work, changes, checkpoints, context, raw events. Collapsible. */
import { useMemo, useState } from 'react';
import type { SessionRuntime } from '../api/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button, Chip, Modal, Tabs } from '../components/ui';
import { useApp, type InspectorTab } from '../store/app';
import { clock, duration, relTime, tokens as fmtTokens, pct } from '../lib/format';
import { cx, download } from '../lib/util';
import { useT } from '../lib/i18n';

const TABS: Array<{ value: InspectorTab; label: string; icon: string }> = [
  { value: 'tasks', label: '任务', icon: 'list' },
  { value: 'background', label: '后台', icon: 'layers' },
  { value: 'changes', label: '变更', icon: 'pencil' },
  { value: 'checkpoints', label: '检查点', icon: 'rewind' },
  { value: 'context', label: '上下文', icon: 'gauge' },
  { value: 'events', label: '事件', icon: 'braces' },
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
    // Keep the conversation column at least CENTER_MIN wide (nav rail + session list + icon rail = 364 px).
    const max = Math.max(MIN_W, Math.min(MAX_W, window.innerWidth - 364 - CENTER_MIN));
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
              <Button size="sm" variant="ghost" icon="eye" onClick={() => void api.taskOutput(rt.id, b.id).then((text) => setOutput({ name: b.name, text }))}>{t('查看输出')}</Button>
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
            <span className="add-n">+{c.add}</span><span className="del-n">−{c.del}</span>
          </div>
          {open === c.path && (
            <div className="diff" style={{ borderRadius: 0, border: 0, borderTop: '1px solid var(--border)' }}>
              {c.diff.map((l, i) => <div key={i} className={l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l}</div>)}
            </div>
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
        {used.map((x, i) => <div key={x.name} title={`${x.name} · ${fmtTokens(x.tokens)}`} style={{ width: `${(x.tokens / c.max) * 100}%`, background: CTX_COLORS[i % CTX_COLORS.length] }} />)}
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
        ]} />
      </div>
      {sub === 'stderr' ? (
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
                <span className="sm">{e.summary}</span>
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
