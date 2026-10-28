/** Panels docked above the composer: approval, questions, plan review, read-only bar, queue. */
import { useEffect, useState } from 'react';
import type { PendingRequest, QueuedMessage, RuleDestination } from '../api/types';
import { describeRule } from '../lib/rules';
import { Icon } from '../components/Icon';
import { Button, Check, Chip, Field, Radio, Select } from '../components/ui';
import { api } from '../api';
import { useApp } from '../store/app';
import { cx } from '../lib/util';
import { useT } from '../lib/i18n';

function useSince(since: number) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.round((Date.now() - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const DESTINATIONS: Array<{ value: RuleDestination; label: string; desc: string }> = [
  { value: 'session', label: '仅本会话', desc: '会话结束后失效，不写入文件' },
  { value: 'workspace', label: '这个工作区', desc: '只在这个工作区生效' },
  { value: 'global', label: '所有工作区', desc: '对以后所有会话生效' },
];

export function ApprovalPanel({ sid, req }: { sid: string; req: Extract<PendingRequest, { kind: 'approval' }> }) {
  const t = useT();
  const waited = useSince(req.since);
  const showRaw = useApp((s) => s.prefs.showRawSdkText);
  const [choice, setChoice] = useState<'once' | 'remember' | 'edit' | 'deny' | 'dir'>(req.defaultToNo ? 'deny' : 'once');
  const candidates = req.outside?.candidates ?? [];
  const [dir, setDir] = useState(candidates.find((c) => c.split('\\').length === 3) ?? candidates[0] ?? '');
  const [rule, setRule] = useState(req.suggestions[0] ?? '');
  const [dest, setDest] = useState<RuleDestination>('workspace');
  const [command, setCommand] = useState(req.command ?? '');
  const [message, setMessage] = useState('');
  const [rawOpen, setRawOpen] = useState(showRaw);
  const [typed, setTyped] = useState('');

  const submit = () => {
    if (choice === 'deny') api.respondApproval(sid, req.id, { behavior: 'deny', message: message.trim() || undefined });
    else if (choice === 'remember') api.respondApproval(sid, req.id, { behavior: 'allow', remember: { rule, destination: dest } });
    else if (choice === 'edit') api.respondApproval(sid, req.id, { behavior: 'allow', command });
    else if (choice === 'dir') api.respondApproval(sid, req.id, { behavior: 'allow', addDir: { dir, destination: dest } });
    else api.respondApproval(sid, req.id, { behavior: 'allow' });
  };
  const primaryLabel = { once: t('允许'), remember: t('允许并记住'), edit: t('修改后允许'), dir: t('允许并加入目录'), deny: message.trim() ? t('拒绝并发送说明') : t('拒绝') }[choice];

  if (req.defaultToNo) {
    return (
      <div className="dpanel approval risky">
        <div className="dpanel-head">
          <Icon name="warning" size={20} className="st-error" />
          <b>{req.title}</b>
          <span className="grow" />
          <span className="muted">{t('已等待 {w}', { w: waited })}</span>
        </div>
        <div className="dpanel-body">
          <pre className="code-block"><span className="muted">$ </span>{req.command}</pre>
          <div className="ink2">{req.reason}</div>
          <div className="row">
            <Button variant="primary" className="focus-ring" onClick={() => api.respondApproval(sid, req.id, { behavior: 'deny', message: '用户拒绝了这次删除。' })}>{t('拒绝')}</Button>
            <span className="grow" />
            <input className="input mono" style={{ width: 200 }} placeholder={t('输入 ALLOW 以启用允许')} value={typed} onChange={(e) => setTyped(e.target.value)} />
            <Button disabled={typed !== 'ALLOW'} onClick={() => api.respondApproval(sid, req.id, { behavior: 'allow' })}>{t('仅此一次允许')}</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="dpanel approval">
      <div className="dpanel-head">
        <Icon name={req.outside ? 'folder' : 'shield'} size={20} className="ink2" />
        <b>{req.title}</b>
        {req.agent && <Chip icon="agent" tone="outline">{t('由子代理 {a} 发起', { a: req.agent })}</Chip>}
        <span className="grow" />
        <span className="muted">{t('已等待 {w}', { w: waited })}</span>
      </div>
      <div className="dpanel-body">
        <div className="row ink2">
          <Icon name="info" size={15} />
          <span className="grow">{req.reason}</span>
          <button className="link-btn" onClick={() => setRawOpen(!rawOpen)}>{rawOpen ? t('收起原文') : t('SDK 原文')}</button>
        </div>
        {rawOpen && <pre className="code-block">{`decisionReason: "No allow rule matched ${req.tool}${req.command ? `(${req.command})` : ''}"\ntoolUseID: "${req.toolItemId}"\nrequestId: "${req.id}"`}</pre>}
        {req.command && (
          <div>
            <pre className="code-block"><span className="muted">$ </span><b>{req.command}</b></pre>
            {req.description && <div className="hint" style={{ fontStyle: 'italic', marginTop: 4 }}>{req.description}</div>}
          </div>
        )}
        {req.outside && (
          <div className="outside-path">
            <Icon name="folder" size={15} />
            <span className="mono grow">{req.outside.path}</span>
            <Chip tone="warn">{t('工作区外')}</Chip>
          </div>
        )}
        {req.diff && (
          <div className="diff">
            {req.diff.lines.map((l, i) => <div key={i} className={l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : ''}>{l}</div>)}
          </div>
        )}
        <div className={cx('opt', choice === 'once' && 'on')} onClick={() => setChoice('once')}>
          <div className="opt-row"><Radio on={choice === 'once'} onChange={() => setChoice('once')} /><span className="grow">{t('仅允许这一次')}</span></div>
        </div>
        {req.outside && (
          <div className={cx('opt', choice === 'dir' && 'on')} onClick={() => setChoice('dir')}>
            <div className="opt-row"><Radio on={choice === 'dir'} onChange={() => setChoice('dir')} /><span className="grow">{t('允许，并把目录加为额外目录')}</span></div>
            {choice === 'dir' && (
              <div className="extra" onClick={(e) => e.stopPropagation()}>
                <span className="ink2">{t('目录')}</span>
                <Select size="sm" value={dir} onChange={setDir} width={340} options={candidates.map((c) => ({ value: c, label: <span className="mono">{c}</span> }))} />
                <span className="ink2">{t('适用范围')}</span>
                <Select<RuleDestination> size="sm" value={dest} onChange={setDest} width={260} options={DESTINATIONS.map((d) => ({ value: d.value, label: t(d.label), desc: t(d.desc) }))} />
                <span className="hint" style={{ flexBasis: '100%' }}>{t('目录里的文件以后可以直接读取，修改按当前权限模式处理。保存后可以在「设置 → 权限规则」里管理。')}</span>
              </div>
            )}
          </div>
        )}
        {req.suggestions.length > 0 && (
          <div className={cx('opt', choice === 'remember' && 'on')} onClick={() => setChoice('remember')}>
            <div className="opt-row"><Radio on={choice === 'remember'} onChange={() => setChoice('remember')} /><span className="grow">{t('允许，并且以后不再询问')}</span></div>
            {choice === 'remember' && (
              <div className="extra" onClick={(e) => e.stopPropagation()}>
                <span className="ink2">{t('规则')}</span>
                <Select size="sm" value={rule} onChange={setRule} width={260} options={req.suggestions.map((s) => ({ value: s, label: <span className="mono">{s}</span> }))} />
                <span className="ink2">{t('适用范围')}</span>
                <Select<RuleDestination> size="sm" value={dest} onChange={setDest} width={260} options={DESTINATIONS.map((d) => ({ value: d.value, label: t(d.label), desc: t(d.desc) }))} />
                <span className="hint">{describeRule(rule)}</span>
              </div>
            )}
          </div>
        )}
        {req.command && (
          <div className={cx('opt', choice === 'edit' && 'on')} onClick={() => setChoice('edit')}>
            <div className="opt-row"><Radio on={choice === 'edit'} onChange={() => setChoice('edit')} /><span className="grow">{t('修改命令后允许')}</span></div>
            {choice === 'edit' && (
              <div className="extra" onClick={(e) => e.stopPropagation()}>
                <input className="input mono" value={command} onChange={(e) => setCommand(e.target.value)} autoFocus />
                <span className="hint">{t('执行修改后的命令；Claude 不会被告知被修改过。')}</span>
              </div>
            )}
          </div>
        )}
        <div className={cx('opt', choice === 'deny' && 'on')} onClick={() => setChoice('deny')}>
          <div className="opt-row"><Radio on={choice === 'deny'} onChange={() => setChoice('deny')} /><span className="grow">{t('拒绝，并告诉 Claude 该怎么做')}</span></div>
          {choice === 'deny' && (
            <div className="extra" onClick={(e) => e.stopPropagation()}>
              <input className="input" placeholder={t('例如：只清理 jest 缓存，不要重新安装（可留空）')} value={message} onChange={(e) => setMessage(e.target.value)} autoFocus />
            </div>
          )}
        </div>
      </div>
      <div className="dpanel-foot">
        <Button variant="danger-outline" icon="stop" onClick={() => api.respondApproval(sid, req.id, { behavior: 'deny', interrupt: true })}>{t('拒绝并停止本轮')}</Button>
        <span className="grow" />
        <Button variant={choice === 'deny' ? 'danger' : 'primary'} onClick={submit} disabled={choice === 'edit' && !command.trim()}>{primaryLabel}</Button>
      </div>
    </div>
  );
}

export function QuestionPanel({ sid, req }: { sid: string; req: Extract<PendingRequest, { kind: 'question' }> }) {
  const t = useT();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [hover, setHover] = useState<string | null>(null);
  const q = req.questions[step];
  const picked = answers[step] ?? [];
  const hasPreview = q.options.some((o) => o.preview);
  const previewOpt = q.options.find((o) => o.label === (hover ?? picked[0])) ?? q.options.find((o) => o.preview);
  const answered = (i: number) => (answers[i]?.length ?? 0) > 0 && (!answers[i].includes('__other') || (other[i] ?? '').trim().length > 0);
  const allDone = req.questions.every((_, i) => answered(i));

  const toggle = (label: string) => {
    if (q.multiSelect) setAnswers({ ...answers, [step]: picked.includes(label) ? picked.filter((x) => x !== label) : [...picked, label] });
    else setAnswers({ ...answers, [step]: [label] });
  };
  const submit = () => {
    const out: Record<string, string> = {};
    const outNotes: Record<string, string> = {};
    req.questions.forEach((qq, i) => {
      out[qq.question] = (answers[i] ?? []).map((a) => (a === '__other' ? other[i] : a)).join(', ');
      if (notes[i]) outNotes[qq.question] = notes[i];
    });
    api.respondQuestion(sid, req.id, { answers: out, notes: outNotes });
  };

  return (
    <div className="dpanel question">
      <div className="dpanel-head">
        <Icon name="chat" size={20} className="ink2" />
        <b>{t('Claude 有 {n} 个问题', { n: req.questions.length })}</b>
        <span className="grow" />
        <button className="link-btn" onClick={() => useApp.getState().fillComposer(sid, '')}>{t('跳过，直接在输入框里用自己的话回答')}</button>
      </div>
      <div className="dpanel-body">
        <div className="q-steps">
          {req.questions.map((qq, i) => (
            <button key={i} className={cx('q-step', i === step && 'on', answered(i) && i !== step && 'done')} onClick={() => setStep(i)}>
              <span className="n">{answered(i) && i !== step ? <Icon name="check" size={11} strokeWidth={3} /> : i + 1}</span>
              {qq.header}<small>{qq.multiSelect ? t('多选') : t('单选')}</small>
            </button>
          ))}
        </div>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{q.question}</div>
        <div className={cx('q-body', !hasPreview && 'no-preview')}>
          <div className="q-opts">
            {q.options.map((o) => {
              const on = picked.includes(o.label);
              return (
                <div key={o.label} className={cx('q-opt', on && 'on')} onClick={() => toggle(o.label)} onMouseEnter={() => setHover(o.label)} onMouseLeave={() => setHover(null)}>
                  {q.multiSelect ? <Check on={on} onChange={() => toggle(o.label)} label="" /> : <Radio on={on} onChange={() => toggle(o.label)} />}
                  <div><b>{o.label}</b><span className="d">{o.description}</span></div>
                </div>
              );
            })}
            <div className={cx('q-opt', picked.includes('__other') && 'on')} onClick={() => !picked.includes('__other') && toggle('__other')}>
              {q.multiSelect ? <Check on={picked.includes('__other')} onChange={() => toggle('__other')} label="" /> : <Radio on={picked.includes('__other')} onChange={() => toggle('__other')} />}
              <div className="grow">
                <b>{t('其他')}</b>
                <input className="input sm" style={{ marginTop: 6 }} placeholder={t('描述其他方案…')} value={other[step] ?? ''}
                  onFocus={() => { if (!picked.includes('__other')) toggle('__other'); }}
                  onChange={(e) => setOther({ ...other, [step]: e.target.value })} onClick={(e) => e.stopPropagation()} />
              </div>
            </div>
          </div>
          {hasPreview && (
            <div className="q-preview">
              <div className="ph"><span>{t('预览')}{previewOpt ? ` · ${previewOpt.label}` : ''}</span><span>{t('沙箱中渲染的 HTML')}</span></div>
              {previewOpt?.preview ? <iframe title="preview" sandbox="" srcDoc={previewOpt.preview} /> : <div className="none">{t('这个选项没有预览')}</div>}
            </div>
          )}
        </div>
        <input className="input" placeholder={t('给 Claude 的补充说明（可选）')} value={notes[step] ?? ''} onChange={(e) => setNotes({ ...notes, [step]: e.target.value })} />
      </div>
      <div className="dpanel-foot">
        <span className="hint">{t('第 {i}/{n} 题', { i: step + 1, n: req.questions.length })}</span>
        <span className="grow" />
        <Button disabled={step === 0} onClick={() => setStep(step - 1)}>{t('上一题')}</Button>
        {step < req.questions.length - 1
          ? <Button variant="primary" disabled={!answered(step)} onClick={() => setStep(step + 1)}>{t('下一题')}</Button>
          : <Button variant="primary" disabled={!allDone} onClick={submit}>{t('提交回答')}</Button>}
      </div>
    </div>
  );
}

export function PlanReviewBar({ sid, req }: { sid: string; req: Extract<PendingRequest, { kind: 'plan' }> }) {
  const t = useT();
  const [feedback, setFeedback] = useState('');
  return (
    <div className="dpanel plan">
      <div className="dpanel-body">
        <div className="row"><b style={{ fontSize: 14 }}>{t('可以开始实现了吗？')}</b><span className="muted">{t('批准后会话将退出规划模式，并按所选模式执行。')}</span></div>
        <div className="row">
          <Button variant="primary" icon="check" onClick={() => api.respondPlan(sid, req.id, { approve: true, mode: 'acceptEdits' })}>{t('批准 · 自动接受编辑')}</Button>
          <Button onClick={() => api.respondPlan(sid, req.id, { approve: true, mode: 'default' })}>{t('批准 · 每步都询问')}</Button>
        </div>
        <div className="row">
          <input className="input grow" placeholder={t('告诉 Claude 计划要怎么改…')} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <Button disabled={!feedback.trim()} onClick={() => api.respondPlan(sid, req.id, { approve: false, feedback: feedback.trim() })}>{t('继续规划')}</Button>
        </div>
      </div>
    </div>
  );
}

export function ReadOnlyBar({ sid, onFork }: { sid: string; onFork: () => void }) {
  const t = useT();
  return (
    <div className="readonly-bar">
      <Icon name="lock" size={16} className="muted" />
      <span className="grow">{t('这是已保存的会话，Claude Code 进程没有运行。恢复后可以继续对话。')}</span>
      <Button icon="branch" onClick={onFork}>{t('分叉')}</Button>
      <Button variant="primary" icon="play" onClick={() => api.resume(sid)}>{t('恢复会话')}</Button>
    </div>
  );
}

const PRIORITIES = [
  { value: 'now', label: '立即插入', desc: 'Claude 马上读到；正在运行的工作转入后台' },
  { value: 'next', label: '工具后', desc: '当前这批工具调用结束后读取（默认）' },
  { value: 'later', label: '下一轮', desc: '本轮结束后作为新一轮发送' },
] as const;

export function QueueList({ sid, queue }: { sid: string; queue: QueuedMessage[] }) {
  const t = useT();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  if (queue.length === 0) return null;
  return (
    <div className="queue">
      <div className="queue-head">{t('排队中 · {n}', { n: queue.length })}</div>
      {queue.map((q) => (
        <div key={q.id} className="qitem">
          <Icon name="queue" size={15} className="muted" />
          {editing === q.id ? (
            <input className="input sm grow" value={text} autoFocus onChange={(e) => setText(e.target.value)}
              onBlur={() => { api.updateQueued(sid, q.id, { text: text.trim() || q.text }); setEditing(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); }} />
          ) : <span className="txt" title={q.text}>{q.from && <span className="from">{t('来自「{x}」：', { x: q.from.title })}</span>}{q.text}</span>}
          <Select size="sm" value={q.priority} width={300} onChange={(v) => api.updateQueued(sid, q.id, { priority: v })}
            options={PRIORITIES.map((p) => ({ value: p.value, label: t(p.label), desc: t(p.desc) }))} />
          <Button size="sm" variant="ghost" icon="pencil" title={t('编辑')} onClick={() => { setEditing(q.id); setText(q.text); }} />
          <Button size="sm" variant="ghost" icon="x" title={t('移出队列')} onClick={() => api.removeQueued(sid, q.id)} />
        </div>
      ))}
    </div>
  );
}

export function InterruptReceipt({ sid, count, onDone }: { sid: string; count: number; onDone: () => void }) {
  const t = useT();
  return (
    <div className="receipt">
      <Icon name="warning" size={16} />
      <span className="grow">{t('本轮已中断。有 {n} 条排队消息没有取消，要继续执行吗？', { n: count })}</span>
      <Button size="sm" onClick={() => { api.runQueued(sid); onDone(); }}>{t('保留并执行')}</Button>
      <Button size="sm" variant="danger-outline" onClick={() => { api.removeQueued(sid); onDone(); }}>{t('取消排队消息')}</Button>
    </div>
  );
}

/** An MCP server asks for input during a tool call: a form built from its schema, or a page to open. */
export function ElicitationPanel({ sid, req }: { sid: string; req: Extract<PendingRequest, { kind: 'elicitation' }> }) {
  const t = useT();
  const fields = req.fields ?? [];
  const [values, setValues] = useState<Record<string, string | number | boolean>>(
    Object.fromEntries(fields.map((f) => [f.key, f.default ?? (f.type === 'boolean' ? false : '')])),
  );
  const [tried, setTried] = useState(false);
  const [opened, setOpened] = useState(false);
  const errors: Record<string, string> = {};
  fields.forEach((f) => {
    const v = values[f.key];
    if (f.required && (v === '' || v === undefined)) errors[f.key] = t('必填');
    else if (f.type === 'number' && v !== '') {
      const n = Number(v);
      if (Number.isNaN(n)) errors[f.key] = t('请输入数字');
      else if ((f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors[f.key] = t('应在 {a} 到 {b} 之间', { a: f.min ?? '', b: f.max ?? '' });
    }
  });
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length) return;
    const content = Object.fromEntries(fields.map((f) => [f.key, f.type === 'number' ? Number(values[f.key]) : values[f.key]]));
    api.respondElicitation(sid, req.id, { action: 'accept', content });
  };
  const set = (k: string, v: string | number | boolean) => setValues({ ...values, [k]: v });

  return (
    <div className="dpanel question">
      <div className="dpanel-head">
        <Icon name={req.mode === 'url' ? 'link' : 'plug'} size={20} className="ink2" />
        <div className="grow">
          <b>{req.mode === 'url' ? t('{s} 需要你登录', { s: req.server }) : t('{s} 需要你提供信息', { s: req.server })}</b>
          <div className="hint">{t('MCP 服务器 · {src} · 执行 {tool} 期间', { src: req.source, tool: req.tool })}</div>
        </div>
      </div>
      <div className="dpanel-body">
        <div className="server-msg">
          <div className="hint">{t('服务器原文 · 不翻译')}</div>
          <div>{req.message}</div>
        </div>
        {req.mode === 'form' && (
          <div className="elicit-form">
            {fields.map((f) => (
              <Field key={f.key} label={<>{f.title}{f.required && <span style={{ color: 'var(--crit)' }}> *</span>}</>}
                hint={tried && errors[f.key] ? <span style={{ color: 'var(--crit)' }}>{errors[f.key]}</span> : f.description ?? (f.type === 'number' && f.min !== undefined ? t('{a} – {b} 之间', { a: f.min, b: f.max ?? '' }) : undefined)}>
                {f.type === 'enum' ? (
                  <Select value={String(values[f.key])} onChange={(v) => set(f.key, v)} options={(f.options ?? []).map((o) => ({ value: o, label: <span className="mono">{o}</span> }))} />
                ) : f.type === 'boolean' ? (
                  <Check on={!!values[f.key]} onChange={(v) => set(f.key, v)} label={t('是')} />
                ) : f.multiline ? (
                  <textarea className="textarea" rows={2} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)} />
                ) : (
                  <input className={cx('input', f.type === 'number' && 'mono')} inputMode={f.type === 'number' ? 'numeric' : undefined} value={String(values[f.key])} onChange={(e) => set(f.key, e.target.value)} />
                )}
              </Field>
            ))}
          </div>
        )}
        {req.mode === 'url' && (
          <div className="col">
            <span>{t('打开下面的页面完成后，会自动继续：')}</span>
            <div className="code-block" style={{ color: 'var(--accent)' }}>{req.url}</div>
            <div className="row">
              <Button variant="primary" icon="link" disabled={opened} onClick={() => {
                setOpened(true);
                api.openElicitationUrl(sid, req.id);
                useApp.getState().toast(t('模拟：已在新标签页打开登录页面'), 'info');
              }}>{t('打开页面')}</Button>
              {opened && <span className="row ink2"><span className="spinner" />{t('等待 {s} 确认…', { s: req.server })}</span>}
            </div>
          </div>
        )}
      </div>
      <div className="dpanel-foot">
        <Button onClick={() => api.respondElicitation(sid, req.id, { action: 'decline' })}>{t('拒绝提供')}</Button>
        <span className="grow" />
        <Button variant="ghost" onClick={() => api.respondElicitation(sid, req.id, { action: 'cancel' })}>{t('取消')}</Button>
        {req.mode === 'form' && <Button variant="primary" onClick={submit}>{t('提交')}</Button>}
      </div>
    </div>
  );
}
