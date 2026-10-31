/**
 * P18 — jobs: reusable tasks whose answer must match a JSON Schema (SDK outputFormat), run by hand
 * or on a schedule. Each run is an ordinary session that can be opened and continued.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Effort, JobRun, JobSchedule, JobTemplate, PermissionMode } from '../api/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Button, Chip, Field, Seg, Select, Status, Toggle } from '../components/ui';
import { useApp } from '../store/app';
import { NoWorkspace } from '../components/NoWorkspace';
import { MODE_INFO } from '../lib/catalog';
import { effortFor, effortOptions, modelOptions, takesEffort } from '../lib/models';
import { NEW_JOB_SCHEMA } from '../lib/catalog';
import { describeSchedule, fillVars, nextRun, parseCron, promptVars } from '../lib/schedule';
import { dateTime, relTime, tokens as fmtTokens } from '../lib/format';
import { cx, download, uid } from '../lib/util';
import { useT } from '../lib/i18n';

const RUN_STATUS: Record<JobRun['status'], { tone: 'good' | 'crit' | 'info'; label: string }> = {
  queued: { tone: 'info', label: '排队等待空位' },
  running: { tone: 'info', label: '运行中' },
  success: { tone: 'good', label: '输出有效' },
  invalid: { tone: 'crit', label: '没有有效输出' },
  error: { tone: 'crit', label: '出错' },
};

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function schemaProblem(text: string): string | null {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return '不是合法的 JSON'; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return '最外层应该是一个对象';
  if (!('type' in v) && !('properties' in v) && !('enum' in v)) return '缺少 "type"';
  return null;
}

export function Jobs() {
  const t = useT();
  const app = useApp();
  const [selId, setSelId] = useState(app.jobs[0]?.id ?? '');
  const job = app.jobs.find((j) => j.id === selId) ?? app.jobs[0];
  const lastRun = (id: string) => app.jobRuns.find((r) => r.jobId === id);

  const create = () => {
    const j: JobTemplate = {
      id: uid('job'), name: t('新作业'), workspaceId: app.currentWorkspaceId || app.workspaces[0]?.id || '',
      prompt: '', schema: NEW_JOB_SCHEMA, model: 'opus', effort: 'xhigh', mode: 'dontAsk', notify: 'failure',
      schedule: { kind: 'manual', time: '09:00', weekdays: [1, 2, 3, 4, 5], everyHours: 6, cron: '0 9 * * 1-5', enabled: true, vars: {}, missed: 'runOnce' },
    };
    app.set({ jobs: [...app.jobs, j] });
    setSelId(j.id);
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1400 }}>
        <div className="page-title">
          <h1>{t('作业')}</h1>
          <span className="grow" />
          <Button variant="primary" icon="plus" disabled={!app.workspaces.length} title={app.workspaces.length ? undefined : t('作业在工作区里运行，先添加一个工作区')} onClick={create}>{t('新建作业')}</Button>
        </div>
        <p className="page-sub">{t('作业是可以反复运行的任务：Claude 照常读文件、跑命令，但最后必须交出符合你定义的结构的 JSON。可以手动运行，也可以定时运行；每次运行都是一个普通会话，可以打开继续追问。')}</p>

        {!app.workspaces.length && !app.jobs.length ? <NoWorkspace text={t('作业在某个工作区里运行（读文件、跑命令）。添加一个工作区后就能新建作业。')} /> : (
        <div className="jobs-layout">
          <div className="ext-list">
            {app.jobs.map((j) => {
              const r = lastRun(j.id);
              const next = nextRun(j.schedule);
              return (
                <div key={j.id} className={cx('ext-item', j.id === job?.id && 'on')} onClick={() => setSelId(j.id)}>
                  <div className="top"><Icon name="braces" size={15} className={j.id === job?.id ? 'accent' : 'muted'} /><b className="grow truncate">{j.name}</b>{(j.missedRuns ?? 0) > 0 && <Chip tone="warn">{t('错过 {n}', { n: j.missedRuns ?? 0 })}</Chip>}</div>
                  <div className="sub">
                    {r ? <Status tone={RUN_STATUS[r.status].tone}>{t(RUN_STATUS[r.status].label)}</Status> : <span>{t('从未运行')}</span>}
                    {r && r.status !== 'running' && r.status !== 'queued' && <span>{relTime(r.startedAt)}</span>}
                  </div>
                  <div className="sub sched"><Icon name="clock" size={12} />{t(describeSchedule(j.schedule))}{next && ` · ${t('下次 {d}', { d: dateTime(next.getTime()) })}`}</div>
                </div>
              );
            })}
            {app.jobs.length === 0 && <div className="empty">{t('还没有作业')}</div>}
          </div>
          {job ? <JobEditor key={job.id} job={job} onDeleted={() => setSelId('')} onDuplicated={setSelId} /> : <div />}
          {job ? <RunPanel key={`run-${job.id}`} job={job} /> : <div />}
        </div>
        )}
      </div>
    </div>
  );
}

function JobEditor({ job, onDeleted, onDuplicated }: { job: JobTemplate; onDeleted: () => void; onDuplicated: (id: string) => void }) {
  const t = useT();
  const app = useApp();
  const [d, setD] = useState(job);
  useEffect(() => setD(job), [job]);
  const dirty = JSON.stringify(d) !== JSON.stringify(job);
  const set = (p: Partial<JobTemplate>) => setD({ ...d, ...p });
  const setSched = (p: Partial<JobSchedule>) => setD({ ...d, schedule: { ...d.schedule, ...p } });
  const vars = promptVars(d.prompt);
  const problem = schemaProblem(d.schema);
  const model = app.models.find((m) => m.id === d.model);
  const s = d.schedule;
  const cronOk = s.kind !== 'cron' || !!parseCron(s.cron);
  const next = nextRun(s);
  const valid = d.name.trim() && d.prompt.trim() && !problem && cronOk && (s.kind !== 'weekly' || s.weekdays.length > 0);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{t('作业设置')}</h3>
        {dirty && <Chip tone="warn">{t('未保存')}</Chip>}
        <span className="grow" />
        <Button size="sm" variant="ghost" icon="copy" onClick={() => {
          const copy = { ...job, id: uid('job'), name: t('{n} 副本', { n: job.name }), missedRuns: 0 };
          app.set({ jobs: [...app.jobs, copy] });
          onDuplicated(copy.id);
        }}>{t('复制')}</Button>
        <Button size="sm" variant="ghost" icon="trash" onClick={() => app.ask({
          title: t('删除作业「{n}」？', { n: job.name }), body: t('作业和它的运行记录会被删除；已经产生的会话仍保留在「全部会话」里。'), confirmLabel: t('删除'), danger: true,
          onConfirm: () => { app.set({ jobs: app.jobs.filter((j) => j.id !== job.id), jobRuns: app.jobRuns.filter((r) => r.jobId !== job.id) }); onDeleted(); },
        })}>{t('删除')}</Button>
      </div>
      <div className="panel-body col" style={{ gap: 14 }}>
        <div className="form-grid">
          <Field label={t('名称')}><input className="input" value={d.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label={t('工作区')} hint={app.workspaces.some((w) => w.id === d.workspaceId) ? undefined : t('原来的工作区已经移除，选一个新的才能运行')}>
            <Select value={d.workspaceId} onChange={(v) => set({ workspaceId: v })} icon="folder" options={app.workspaces.map((w) => ({ value: w.id, label: w.name, desc: w.path }))}
              renderValue={(o) => o?.label ?? t('（未选择）')} />
          </Field>
        </div>

        <Field label={t('提示词')} hint={t('用 {{名称}} 写变量，运行时再填；{{date}} 会自动换成当天日期')}>
          <textarea className="textarea" rows={3} value={d.prompt} onChange={(e) => set({ prompt: e.target.value })} placeholder={t('例如：列出 {{dir}} 下所有 HTTP 接口，包括方法、路径和是否需要鉴权。')} />
        </Field>
        {vars.length > 0 && <div className="row"><span className="hint">{t('变量')}</span>{vars.map((v) => <Chip key={v} mono tone="accent">{v}</Chip>)}</div>}

        <div className="field">
          <div className="row">
            <label className="field-label grow">{t('输出结构（JSON Schema）')}</label>
            {problem ? <Status tone="crit">{t(problem)}</Status> : <Status tone="good">{t('结构有效')}</Status>}
          </div>
          <textarea className="editor" style={{ minHeight: 200 }} spellCheck={false} value={d.schema} onChange={(e) => set({ schema: e.target.value })} />
          <span className="hint">{t('Claude 最后必须交出符合这个结构的 JSON；不符合时会自动让它重试，几次都不行这次运行就算失败。')}</span>
        </div>

        <div className="form-section" style={{ marginBottom: 0 }}>
          <h3>{t('运行设置')}</h3>
          <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
            <Field label={t('模型')}>
              <Select value={d.model} onChange={(v) => set({ model: v, effort: effortFor(app.models, v, d.effort) })}
                options={modelOptions(app.models, t)} />
            </Field>
            <Field label={t('思考强度')}>
              <Select<Effort> value={d.effort} onChange={(v) => set({ effort: v })} disabled={!takesEffort(model)} options={effortOptions(model, d.effort, t)} />
            </Field>
            <Field label={t('权限模式')}>
              <Select<PermissionMode> value={d.mode} onChange={(v) => set({ mode: v })} width={300}
                options={(['dontAsk', 'default', 'acceptEdits', 'plan'] as PermissionMode[]).map((m) => ({ value: m, icon: MODE_INFO[m].icon, label: t(MODE_INFO[m].label), desc: t(MODE_INFO[m].desc) }))} />
            </Field>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            {d.mode === 'dontAsk'
              ? t('定时运行时没有人审批，建议用「不询问」：需要的操作请在权限规则里预先允许，其余一律拒绝。')
              : t('这个模式下遇到需要审批的操作会停下来等你；定时运行时可能一直等到你处理。')}
          </div>
        </div>

        <div className="form-section" style={{ marginBottom: 0 }}>
          <h3 className="row">{t('定时')}{s.kind !== 'manual' && <span style={{ marginLeft: 'auto', fontWeight: 400 }}><Toggle on={s.enabled} onChange={(v) => setSched({ enabled: v })} label={s.enabled ? t('已启用') : t('已暂停')} /></span>}</h3>
          <Seg value={s.kind} onChange={(v) => setSched({ kind: v })} items={[
            { value: 'manual', label: t('只手动运行') }, { value: 'daily', label: t('每天') }, { value: 'weekly', label: t('每周') },
            { value: 'hourly', label: t('每隔几小时') }, { value: 'cron', label: 'cron' },
          ]} />
          {s.kind !== 'manual' && (
            <div className="col" style={{ marginTop: 10 }}>
              {(s.kind === 'daily' || s.kind === 'weekly') && (
                <div className="row">
                  {s.kind === 'weekly' && WEEKDAYS.map((w, i) => (
                    <button key={w} className={cx('day-chip', s.weekdays.includes(i + 1) && 'on')}
                      onClick={() => setSched({ weekdays: s.weekdays.includes(i + 1) ? s.weekdays.filter((x) => x !== i + 1) : [...s.weekdays, i + 1] })}>{t(w)}</button>
                  ))}
                  <input className="input sm mono" type="time" style={{ width: 110 }} value={s.time} onChange={(e) => setSched({ time: e.target.value })} />
                </div>
              )}
              {s.kind === 'hourly' && (
                <div className="row"><span>{t('每')}</span>
                  <Select size="sm" value={String(s.everyHours)} onChange={(v) => setSched({ everyHours: Number(v) })} className="w-140"
                    options={[1, 2, 3, 4, 6, 8, 12].map((n) => ({ value: String(n), label: t('{n} 小时', { n }) }))} />
                  <span className="hint">{t('从 0 点起按整点计算')}</span>
                </div>
              )}
              {s.kind === 'cron' && (
                <div className="row">
                  <input className="input sm mono" style={{ width: 200 }} value={s.cron} onChange={(e) => setSched({ cron: e.target.value })} />
                  <span className={cronOk ? 'hint' : 'check-bad'}>{cronOk ? t('分 时 日 月 周，例如 0 9 * * 1-5 表示工作日 9:00') : t('cron 表达式不正确')}</span>
                </div>
              )}
              {vars.length > 0 && (
                <div className="col" style={{ gap: 6 }}>
                  <span className="hint">{t('定时运行时变量用这些值：')}</span>
                  {vars.map((v) => (
                    <div key={v} className="row"><span className="mono" style={{ width: 90 }}>{v}</span>
                      <input className="input sm mono grow" value={s.vars[v] ?? ''} onChange={(e) => setSched({ vars: { ...s.vars, [v]: e.target.value } })} /></div>
                  ))}
                </div>
              )}
              <div className="row">
                <span className="ink2">{t('错过的运行')}</span>
                <Seg value={s.missed} onChange={(v) => setSched({ missed: v })} items={[{ value: 'runOnce', label: t('服务恢复后补跑一次') }, { value: 'skip', label: t('跳过') }]} />
              </div>
              <div className="banner-info" style={{ marginBottom: 0 }}>
                <Icon name="clock" size={15} />
                <span>{next ? t('下次运行：{d}。', { d: dateTime(next.getTime()) }) : s.enabled ? '' : t('定时已暂停。')}{t('定时作业由本机的 Code Agent 服务执行，电脑关机或服务没开时会错过。')}</span>
              </div>
            </div>
          )}
        </div>

        <div className="row">
          <span className="ink2">{t('完成后通知')}</span>
          <Select value={d.notify} onChange={(v) => set({ notify: v })} className="w-180" options={[
            { value: 'failure', label: t('只在失败时') }, { value: 'always', label: t('每次') }, { value: 'never', label: t('不通知') },
          ]} />
          <span className="grow" />
          <Button disabled={!dirty} onClick={() => setD(job)}>{t('还原')}</Button>
          <Button variant="primary" disabled={!dirty || !valid} onClick={() => { app.set({ jobs: app.jobs.map((j) => (j.id === d.id ? d : j)) }); app.toast(t('已保存作业「{n}」', { n: d.name }), 'good'); }}>{t('保存')}</Button>
        </div>
      </div>
    </div>
  );
}

function RunPanel({ job }: { job: JobTemplate }) {
  const t = useT();
  const app = useApp();
  const nav = useNavigate();
  const runs = useMemo(() => app.jobRuns.filter((r) => r.jobId === job.id), [app.jobRuns, job.id]);
  const vars = promptVars(job.prompt);
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...job.schedule.vars }));
  const [selId, setSelId] = useState<string | null>(null);
  const sel = runs.find((r) => r.id === selId) ?? runs[0];
  const missing = vars.some((v) => !values[v]?.trim());
  const json = sel?.output !== undefined ? JSON.stringify(sel.output, null, 2) : '';

  return (
    <div className="panel">
      <div className="panel-head"><h3>{t('运行')}</h3></div>
      <div className="panel-body col" style={{ gap: 12 }}>
        {(job.missedRuns ?? 0) > 0 && (
          <div className="banner-warn">
            <Icon name="warning" size={16} />
            <div className="grow">{t('有 {n} 次定时运行因为 Code Agent 服务没有运行而错过。', { n: job.missedRuns ?? 0 })}</div>
            <Button size="sm" onClick={() => api.catchUpJob(job.id).then(setSelId)}>{t('补跑一次')}</Button>
            <Button size="sm" variant="ghost" onClick={() => app.set({ jobs: app.jobs.map((j) => (j.id === job.id ? { ...j, missedRuns: 0 } : j)) })}>{t('忽略')}</Button>
          </div>
        )}
        {vars.map((v) => (
          <div key={v} className="row"><span className="mono" style={{ width: 70 }}>{v}</span>
            <input className="input sm mono grow" value={values[v] ?? ''} onChange={(e) => setValues({ ...values, [v]: e.target.value })} /></div>
        ))}
        <div className="row">
          <span className="hint grow truncate" title={fillVars(job.prompt, values)}>{fillVars(job.prompt, values) || t('（提示词为空）')}</span>
          <Button variant="primary" icon="play" disabled={missing || !job.prompt.trim() || !app.workspaces.some((w) => w.id === job.workspaceId)} onClick={() => api.runJob(job.id, values, 'manual').then(setSelId)}>{t('运行作业')}</Button>
        </div>

        <div className="divider-line" />
        {!sel ? <div className="empty">{t('还没有运行过')}</div> : (
          <div className="col" style={{ gap: 8 }}>
            <div className="row">
              <b>{sel === runs[0] ? t('最近一次') : t('第 {n} 次运行', { n: runs.length - runs.indexOf(sel) })}</b>
              <Chip>{sel.trigger === 'schedule' ? t('定时') : t('手动')}</Chip>
              <span className="muted">{dateTime(sel.startedAt)}</span>
              <span className="grow" />
              <Status tone={RUN_STATUS[sel.status].tone}>{t(RUN_STATUS[sel.status].label)}</Status>
            </div>
            {sel.status === 'queued' ? (
              <div className="row ink2"><span className="spinner" />{t('同时运行的会话已达上限，有会话空闲后自动开始')}</div>
            ) : sel.status === 'running' ? (
              <div className="row ink2"><span className="spinner" />{t('Claude 正在工作，可以打开会话实时查看')}</div>
            ) : (
              <div className="hint">{t('{turns} 轮 · {tk} tokens · 用时 {s} 秒', { turns: sel.turns, tk: fmtTokens(sel.tokens), s: Math.round(((sel.endedAt ?? sel.startedAt) - sel.startedAt) / 1000) })}</div>
            )}
            {sel.error && <div className="banner-warn"><Icon name="x" size={15} /><span>{t(sel.error)}</span></div>}
            {json && <pre className="code-block" style={{ maxHeight: 260, overflow: 'auto' }}>{json}</pre>}
            <div className="row">
              <Button size="sm" icon="copy" disabled={!json} onClick={() => { void navigator.clipboard?.writeText(json); app.toast(t('已复制 JSON'), 'good'); }}>{t('复制 JSON')}</Button>
              <Button size="sm" icon="download" disabled={!json} onClick={() => download(`${job.name}.json`, json, 'application/json')}>{t('下载')}</Button>
              <Button size="sm" icon="chat" disabled={!sel.sessionId || !app.sessions.some((x) => x.id === sel.sessionId)} title={sel.sessionId ? undefined : t('这次运行的会话不在示例数据里')}
                onClick={() => { api.openSession(sel.sessionId!); nav(`/s/${sel.sessionId}`); }}>{t('打开会话')}</Button>
            </div>
          </div>
        )}

        <div className="divider-line" />
        <b>{t('历史')}</b>
        {runs.length === 0 && <div className="muted">{t('没有记录')}</div>}
        {runs.map((r) => (
          <div key={r.id} className={cx('run-row', r.id === sel?.id && 'on')} onClick={() => setSelId(r.id)}>
            <div className="grow">
              <div>{dateTime(r.startedAt)} <span className="muted">· {r.trigger === 'schedule' ? t('定时') : t('手动')}</span></div>
              {Object.keys(r.vars).length > 0 && <div className="mono muted" style={{ fontSize: 11.5 }}>{Object.entries(r.vars).map(([k, v]) => `${k} = ${v}`).join('  ')}</div>}
            </div>
            <Status tone={RUN_STATUS[r.status].tone}>{t(RUN_STATUS[r.status].label)}</Status>
            <span className="muted" style={{ width: 56, textAlign: 'right' }}>{r.status === 'running' || r.status === 'queued' ? '' : fmtTokens(r.tokens)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
