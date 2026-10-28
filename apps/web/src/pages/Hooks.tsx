/**
 * P17 — hooks. Rules made here are compiled into SDK hook callbacks (no scripts needed); hooks
 * from settings files, plugins and Code Agent itself are listed read-only. The log shows every run.
 */
import { useMemo, useState } from 'react';
import type { HookAction, HookRule } from '../api/types';
import { Icon } from '../components/Icon';
import { Button, Chip, Field, Seg, Select, Status, Toggle } from '../components/ui';
import { useApp } from '../store/app';
import { HOOK_EVENTS } from '../lib/catalog';
import { ACTION_INFO, actionLabel, actionsFor, condFieldsFor, hookOutput, isToolEvent, ruleMatches, sampleInput } from '../lib/hooks';
import { cx, uid } from '../lib/util';
import { useT } from '../lib/i18n';

const OPS = [
  { value: 'glob', label: '匹配通配符' },
  { value: 'contains', label: '包含' },
  { value: 'eq', label: '等于' },
  { value: 'regex', label: '匹配正则' },
] as const;

const ACTION_TONE: Partial<Record<HookAction, 'crit' | 'warn' | 'good' | 'accent'>> = { deny: 'crit', block: 'crit', ask: 'warn', defer: 'warn', allow: 'good', context: 'accent' };

export function Hooks() {
  const t = useT();
  const app = useApp();
  const [event, setEvent] = useState('PreToolUse');
  const [selId, setSelId] = useState<string | null>(app.hookRules.find((r) => r.event === 'PreToolUse')?.id ?? null);
  const rules = app.hookRules.filter((r) => r.event === event);
  const fileHooks = app.fileHooks.filter((h) => h.event === event);
  const sel = app.hookRules.find((r) => r.id === selId && r.event === event) ?? null;
  const count = (e: string) => app.hookRules.filter((r) => r.event === e).length + app.fileHooks.filter((h) => h.event === e).length;
  const info = HOOK_EVENTS.flatMap((g) => g.events).find((e) => e.name === event);

  const create = () => {
    const r: HookRule = {
      id: uid('hk'), name: t('新规则'), event, matcher: isToolEvent(event) ? 'Bash' : '', action: actionsFor(event)[0],
      text: '', timeout: 10, async: false, enabled: false, scope: 'global',
      cond: condFieldsFor(event).length ? { field: condFieldsFor(event)[0], op: 'glob', value: '' } : undefined,
    };
    app.set({ hookRules: [...app.hookRules, r] });
    setSelId(r.id);
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-title"><h1>{t('钩子')}</h1></div>
        <p className="page-sub">{t('钩子在 Claude 工作的特定时机自动执行：比如工具运行前拦截危险命令、每轮结束发通知。这里用规则配置，不用写代码。')}</p>
        <div className="hooks-layout">
          <div className="ext-list hook-events">
            {HOOK_EVENTS.map((g) => (
              <div key={g.group}>
                <h5>{t(g.group)}</h5>
                {g.events.map((e) => (
                  <div key={e.name} className={cx('hook-ev', e.name === event && 'on', count(e.name) === 0 && 'zero')} title={t(e.desc)}
                    onClick={() => { setEvent(e.name); setSelId(app.hookRules.find((r) => r.event === e.name)?.id ?? null); }}>
                    <span className="mono grow">{e.name}</span>
                    {count(e.name) > 0 && <span className="cnt">{count(e.name)}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className="ext-detail">
            <div className="ext-head">
              <h2 className="mono">{event}</h2>
              <span className="muted">{info && t(info.desc)}</span>
              <span className="grow" />
              <Button variant="primary" icon="plus" onClick={create}>{t('新建规则')}</Button>
            </div>

            {rules.length === 0 && fileHooks.length === 0 && <div className="empty panel">{t('这个时机还没有钩子')}</div>}
            {rules.map((r) => (
              <div key={r.id} className={cx('hook-card', r.id === sel?.id && 'on', !r.enabled && 'off')} onClick={() => setSelId(r.id)}>
                <span onClick={(e) => e.stopPropagation()}><Toggle on={r.enabled} onChange={(v) => app.set({ hookRules: app.hookRules.map((x) => (x.id === r.id ? { ...x, enabled: v } : x)) })} /></span>
                <div className="grow">
                  <div className="row"><b>{r.name}</b>{r.matcher && <Chip mono>{r.matcher}</Chip>}{r.async && <Chip>{t('异步')}</Chip>}</div>
                  <div className="mono ink2" style={{ fontSize: 12 }}>{r.cond?.value ? `${r.cond.field} ${t(OPS.find((o) => o.value === r.cond!.op)!.label)} ${r.cond.value}` : t('无条件')}</div>
                </div>
                <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Chip tone={ACTION_TONE[r.action]}>{t(actionLabel(r.event, r.action))}</Chip>
                  <span className="hint">{r.scope === 'global' ? t('所有工作区') : app.workspaces.find((w) => w.id === r.workspaceId)?.name}</span>
                </div>
              </div>
            ))}
            {fileHooks.map((h) => (
              <div key={h.id} className="hook-card file">
                <Icon name="lock" size={14} className="muted" />
                <div className="grow">
                  <div className="row"><b className="ink2">{h.source}</b><Chip>{h.type === 'builtin' ? t('内置') : h.type}</Chip>{h.matcher && <Chip mono>{h.matcher}</Chip>}</div>
                  <div className="mono muted" style={{ fontSize: 12 }}>{h.detail}</div>
                </div>
                <span className="hint">{t('只读 · 与上面的规则一起执行')}</span>
              </div>
            ))}

            {sel && <RuleEditor key={sel.id} rule={sel} onDeleted={() => setSelId(null)} />}
          </div>
        </div>
        <HookLog />
      </div>
    </div>
  );
}

function RuleEditor({ rule, onDeleted }: { rule: HookRule; onDeleted: () => void }) {
  const t = useT();
  const app = useApp();
  const [r, setR] = useState(rule);
  const [sample, setSample] = useState(JSON.stringify(sampleInput(rule.event), null, 2));
  const [result, setResult] = useState<string | null>(null);
  const dirty = JSON.stringify(r) !== JSON.stringify(rule);
  const fields = condFieldsFor(r.event);
  const set = (p: Partial<HookRule>) => { setR({ ...r, ...p }); setResult(null); };
  const save = () => {
    app.set({ hookRules: app.hookRules.map((x) => (x.id === r.id ? r : x)) });
    app.toast(t('已保存，运行中的会话从下一轮起生效'), 'good');
  };
  const test = () => {
    let input: Record<string, unknown>;
    try { input = JSON.parse(sample); } catch { setResult(t('示例输入不是合法的 JSON')); return; }
    setResult(ruleMatches({ ...r, enabled: true }, input) ? JSON.stringify(hookOutput(r), null, 2) : t('不匹配：这条规则不会执行，什么也不返回。'));
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t('编辑规则')}</h3>
        {dirty && <Chip tone="warn">{t('未保存')}</Chip>}
        <span className="grow" />
        <Button size="sm" variant="ghost" icon="trash" onClick={() => app.ask({
          title: t('删除规则「{n}」？', { n: rule.name }), body: t('运行中的会话从下一轮起不再执行它。'), confirmLabel: t('删除'), danger: true,
          onConfirm: () => { app.set({ hookRules: app.hookRules.filter((x) => x.id !== rule.id) }); onDeleted(); },
        })}>{t('删除')}</Button>
      </div>
      <div className="panel-body col" style={{ gap: 12 }}>
        <div className="form-grid">
          <Field label={t('名称')}><input className="input" value={r.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={t('作用范围')}>
            <Select value={r.scope === 'global' ? '__all' : r.workspaceId ?? ''} onChange={(v) => set(v === '__all' ? { scope: 'global', workspaceId: undefined } : { scope: 'workspace', workspaceId: v })}
              options={[{ value: '__all', label: t('所有工作区') }, ...app.workspaces.map((w) => ({ value: w.id, label: w.name }))]} />
          </Field>
        </div>
        {isToolEvent(r.event) && (
          <Field label={t('匹配工具')} hint={t('工具名，可写 Edit|Write 或正则如 mcp__github__.*；留空匹配所有工具')}>
            <input className="input mono" value={r.matcher} onChange={(e) => set({ matcher: e.target.value })} />
          </Field>
        )}
        {fields.length > 0 && (
          <Field label={t('条件（可选）')}>
            <div className="row">
              <Select size="sm" value={r.cond?.field ?? fields[0]} onChange={(v) => set({ cond: { field: v, op: r.cond?.op ?? 'glob', value: r.cond?.value ?? '' } })} className="w-180"
                options={fields.map((f) => ({ value: f, label: <span className="mono">{f}</span> }))} />
              <Select size="sm" value={r.cond?.op ?? 'glob'} onChange={(v) => set({ cond: { field: r.cond?.field ?? fields[0], op: v, value: r.cond?.value ?? '' } })} className="w-140"
                options={OPS.map((o) => ({ value: o.value, label: t(o.label) }))} />
              <input className="input sm mono grow" placeholder={t('留空表示不加条件')} value={r.cond?.value ?? ''} onChange={(e) => set({ cond: { field: r.cond?.field ?? fields[0], op: r.cond?.op ?? 'glob', value: e.target.value } })} />
            </div>
          </Field>
        )}
        <div className="form-grid">
          <Field label={t('动作')}>
            <Select value={r.action} onChange={(v) => set({ action: v })} options={actionsFor(r.event).map((a) => ({ value: a, label: t(actionLabel(r.event, a)) }))} />
          </Field>
          <Field label={t('超时（秒）')}>
            <div className="row">
              <input className="input" style={{ width: 80 }} inputMode="numeric" value={r.timeout} onChange={(e) => set({ timeout: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
              <Toggle on={r.async} onChange={(v) => set({ async: v })} label={t('异步执行')} hint={t('不等它完成，适合日志和 Webhook')} />
            </div>
          </Field>
        </div>
        <Field label={t(ACTION_INFO[r.action].text)}>
          <textarea className="textarea" rows={2} value={r.text} onChange={(e) => set({ text: e.target.value })} />
        </Field>

        <div className="hook-test">
          <div className="row"><b>{t('测试')}</b><span className="hint grow">{t('用示例输入运行这条规则，看它会返回什么')}</span><Button size="sm" icon="play" onClick={test}>{t('运行')}</Button></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <textarea className="editor" style={{ minHeight: 120 }} spellCheck={false} value={sample} onChange={(e) => { setSample(e.target.value); setResult(null); }} />
            <pre className="code-block" style={{ minHeight: 120, margin: 0 }}>{result ?? t('（点「运行」查看钩子输出）')}</pre>
          </div>
        </div>

        <div className="row">
          <span className="grow" />
          <Button disabled={!dirty} onClick={() => setR(rule)}>{t('还原')}</Button>
          <Button variant="primary" disabled={!dirty || !r.name.trim()} onClick={save}>{t('保存')}</Button>
        </div>
      </div>
    </div>
  );
}

function HookLog() {
  const t = useT();
  const log = useApp((s) => s.hookLog);
  const [filter, setFilter] = useState<'all' | 'blocked' | 'error'>('all');
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => log.filter((e) => filter === 'all' || (filter === 'blocked' ? e.outcome === 'crit' && !e.result.startsWith('错误') : e.result.startsWith('错误'))), [log, filter]);
  const time = (ts: number) => new Date(ts).toTimeString().slice(0, 8);
  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <h3>{t('执行记录')}</h3>
        <span className="sub">{t('运行中会话里触发的钩子 · 最新在前')}</span>
        <span className="grow" />
        <Seg value={filter} onChange={setFilter} items={[{ value: 'all', label: t('全部') }, { value: 'blocked', label: t('已拦截') }, { value: 'error', label: t('出错') }]} />
      </div>
      <div className="panel-body" style={{ padding: 0 }}>
        <table className="data-table">
          <thead><tr><th style={{ paddingLeft: 16 }}>{t('时间')}</th><th>{t('时机')}</th><th>{t('规则')}</th><th>{t('对象')}</th><th>{t('结果')}</th><th className="num" style={{ paddingRight: 16 }}>{t('耗时')}</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="empty">{t('没有记录')}</td></tr>}
            {rows.slice(0, 50).map((e) => (
              <tr key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} style={{ cursor: e.detail ? 'pointer' : undefined }}>
                <td style={{ paddingLeft: 16 }} className="mono">{time(e.ts)}</td>
                <td className="mono">{e.event}</td>
                <td>{e.rule}</td>
                <td className="ink2">{e.target}{open === e.id && e.detail && <div className="mono" style={{ color: 'var(--crit)', marginTop: 4 }}>{e.detail}</div>}</td>
                <td><Status tone={e.outcome}>{e.result}</Status></td>
                <td className="num" style={{ paddingRight: 16 }}>{e.ms >= 1000 ? `${(e.ms / 1000).toFixed(1)} s` : `${e.ms} ms`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
