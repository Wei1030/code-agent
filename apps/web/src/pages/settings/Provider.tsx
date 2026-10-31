/**
 * P22 — model services and account: the user's own Claude Code login (Claude subscription) and any
 * number of compatible endpoints, each with its models. All models land in one list; sessions,
 * reviews, background runs and jobs each pick one, and with it the service.
 * Code Agent never signs anyone in to claude.ai and never touches those credentials: with a
 * subscription, the user logs in to Claude Code themselves and we only point at its config dir.
 */
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { relTime } from '../../lib/format';
import type { Endpoint, EndpointModel, EnvVar, GitBash, RuntimeSettings } from '../../api/types';
import { COMMON_ENV } from '../../lib/catalog';
import { Icon } from '../../components/Icon';
import { Button, Chip, Field, Radio, Seg, Select, Status, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { uid } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

export function Provider() {
  const t = useT();
  return (
    <>
      <h1>{t('模型服务与账号')}</h1>
      <p className="lead">{t('Claude 订阅和兼容端点可以同时使用：它们的模型都会出现在模型列表里，会话、代码审核、后台识别和作业各自选用。修改后对新启动的进程生效。')}</p>
      <Subscription />
      <Endpoints />
      <EnvVars />
      <Runtime />
    </>
  );
}

function Subscription() {
  const t = useT();
  const app = useApp();
  const p = app.provider;
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try {
      await api.checkLogin();
      const now = useApp.getState().provider;
      if (now.loggedIn) app.toast(t('已检测到登录状态：Claude {p}', { p: now.plan }), 'good');
      else app.toast(now.error ? t('检测失败：{e}', { e: now.error }) : t('仍未检测到登录，请先在终端完成 /login'), 'warn');
    } finally {
      setChecking(false);
    }
  };
  const envDir = p.envConfigDir || t('（服务进程没有设置这个变量）');
  const dir = p.configDir === 'default' ? '~/.claude' : p.configDir === 'env' ? `$CLAUDE_CONFIG_DIR → ${envDir}` : p.customDir || t('（未填写）');
  const loginCmd = p.configDir === 'default' ? 'claude' : `CLAUDE_CONFIG_DIR=${p.configDir === 'env' ? p.envConfigDir ?? '' : p.customDir} claude`;
  const claudeModels = app.models.filter((m) => !m.endpoint);
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>{t('Claude 订阅')}</h3><span className="sub">{t('使用你自己在 Claude Code 里登录的账号')}</span><span className="grow" />
        {p.loggedIn ? <Status tone="good">{t('已登录 · Claude {p}', { p: p.plan })}</Status> : <Status tone="warn">{t('未登录')}</Status>}
      </div>
      <div className="panel-body">
        <div className="banner-info"><Icon name="info" size={16} />
          <span>{t('Code Agent 不提供 claude.ai 登录，也不会读取或保存你的登录凭证。请在终端里自己登录 Claude Code，这里只指定它的配置目录。')}</span>
        </div>
        {p.envConflict && (
          <div className="banner-warn" style={{ marginBottom: 14 }}>
            <Icon name="warning" size={16} />
            <div className="grow">
              <b>{t('环境变量 {v} 已设置', { v: p.envVar ?? 'ANTHROPIC_API_KEY' })}</b>
              <div>{t('它的优先级高于订阅登录，Claude Code 会改用 API 密钥并按 token 计费。')}</div>
            </div>
            <Button size="sm" onClick={() => app.setProvider({ envConflict: false })}>{t('启动时忽略这个变量')}</Button>
          </div>
        )}
        <Section title={t('登录')}>
          {p.loggedIn ? (
            <dl className="kv">
              <dt>{t('账号')}</dt><dd>{p.account ? p.account.replace(/^(.)[^@]*(@.*)$/, '$1***$2') : '—'}</dd>
              <dt>{t('订阅')}</dt><dd>Claude {p.plan}</dd>
              <dt>{t('模型')}</dt><dd>{claudeModels.map((m) => m.label).join('、') || '—'}</dd>
              <dt>{t('配置目录')}</dt><dd className="mono">{dir}</dd>
            </dl>
          ) : (
            <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
              <li>{t('打开终端，运行')} <code className="mono">{loginCmd}</code></li>
              <li>{t('在 Claude Code 中输入')} <code className="mono">/login</code> {t('并按提示完成登录')}</li>
              <li>{t('回到这里点「重新检测」')}</li>
            </ol>
          )}
          <div className="row" style={{ marginTop: 12 }}>
            <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText(loginCmd); app.toast(t('已复制登录命令'), 'good'); }}>{t('复制命令')}</Button>
            <Button size="sm" icon="refresh" loading={checking} onClick={() => recheck()}>{t('重新检测')}</Button>
            {p.checkedAt && <span className="hint">{t('上次检测 {t}', { t: relTime(p.checkedAt) })}</span>}
          </div>
        </Section>
        <Section title={t('配置目录')}>
          <div className="col">
            <div className="option-card" onClick={() => app.setProvider({ configDir: 'default' })}><Radio on={p.configDir === 'default'} onChange={() => app.setProvider({ configDir: 'default' })} /><div><b>{t('默认位置')}</b><div className="d mono">~/.claude</div></div></div>
            <div className="option-card" onClick={() => app.setProvider({ configDir: 'env' })}><Radio on={p.configDir === 'env'} onChange={() => app.setProvider({ configDir: 'env' })} /><div><b>{t('使用环境变量 CLAUDE_CONFIG_DIR')}</b><div className="d mono">{envDir}</div></div></div>
            <div className="option-card" onClick={() => app.setProvider({ configDir: 'custom' })}>
              <Radio on={p.configDir === 'custom'} onChange={() => app.setProvider({ configDir: 'custom' })} />
              <div className="grow"><b>{t('指定目录')}</b>
                {p.configDir === 'custom' && <input className="input mono" style={{ marginTop: 6 }} placeholder="D:\\tools\\claude" value={p.customDir} onClick={(e) => e.stopPropagation()} onChange={(e) => app.setProvider({ customDir: e.target.value })} />}
              </div>
            </div>
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t('配置目录里还有设置、技能和 MCP 服务器；用兼容端点的会话也读它们。')}</div>
        </Section>
        <Section title={t('Claude Code 程序')}>
          <Seg value={p.executable} onChange={(v) => app.setProvider({ executable: v })} items={[{ value: 'bundled', label: t('随 SDK 提供') }, { value: 'system', label: t('系统中安装的 claude') }]} />
        </Section>
      </div>
    </div>
  );
}

/** Wait for an edit to reach the server before a call that needs it. */
const settled = () => new Promise((r) => setTimeout(r, 400));

function Endpoints() {
  const t = useT();
  const app = useApp();
  const list = app.provider.endpoints;
  const setList = (endpoints: Endpoint[]) => app.setProvider({ endpoints });
  const patch = (id: string, p: Partial<Endpoint>) => setList(list.map((e) => (e.id === id ? { ...e, ...p } : e)));
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>{t('兼容端点')}</h3><span className="sub">{t('实现了 Anthropic Messages API 的网关、代理或其他厂商的服务')}</span><span className="grow" />
        <Button size="sm" icon="plus" onClick={() => setList([...list, { id: uid('ep'), name: t('新端点'), url: '', models: [] }])}>{t('添加端点')}</Button>
      </div>
      <div className="panel-body col" style={{ gap: 14 }}>
        {list.length === 0 && <div className="empty">{t('还没有兼容端点。没有 Claude 订阅时，至少要添加一个端点和一个模型。')}</div>}
        {list.map((e) => <EndpointEditor key={e.id} ep={e} onChange={(p) => patch(e.id, p)} onRemove={() => app.ask({
          title: t('删除端点 {n}？', { n: e.name }), body: t('它的模型会从模型列表里消失；正在用这些模型的会话需要换一个模型。保存的令牌也会删除。'), confirmLabel: t('删除'), danger: true,
          onConfirm: () => setList(list.filter((x) => x.id !== e.id)),
        })} />)}
        {list.length > 0 && (
          <div className="banner-warn">
            <Icon name="warning" size={16} />
            <div>
              <b>{t('非 Claude 模型不受官方支持')}</b>
              <div>{t('以下功能取决于端点是否实现：思考强度、扩展思考、提示缓存统计、精确 token 计数、工具搜索、结构化输出（代码审核和后台识别要用）、图片输入。WebSearch 只在 Claude 模型上提供。')}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function EndpointEditor({ ep, onChange, onRemove }: { ep: Endpoint; onChange: (p: Partial<Endpoint>) => void; onRemove: () => void }) {
  const t = useT();
  const app = useApp();
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const addModel = () => {
    const name = model.trim();
    if (!name || ep.models.some((m) => m.name === name)) return;
    onChange({ models: [...ep.models, { name, effort: false }] });
    setModel('');
  };
  // The server also asks the endpoint for the model's context window and fills it in if none is set.
  const test = (m: EndpointModel) => settled().then(() => api.testModel(`ep:${ep.id}:${m.name}`)).then((r) => {
    const w = r.contextWindow;
    const note = !w ? ''
      : !m.contextWindow ? t('；按端点报告填上了上下文窗口 {w}', { w: windowText(w) })
      : w !== m.contextWindow ? t('；端点报告的上下文窗口是 {w}，保留了你填的 {v}', { w: windowText(w), v: windowText(m.contextWindow) })
      : '';
    app.toast((r.ok ? t('{m} 可用：{x}', { m: m.name, x: t(r.message) }) : t('{m} 测试失败：{x}', { m: m.name, x: t(r.message) })) + note, r.ok ? 'good' : 'crit');
  });
  return (
    <div className="endpoint">
      <div className="form-grid">
        <Field label={t('名称')}><input className="input" value={ep.name} onChange={(e) => onChange({ name: e.target.value })} /></Field>
        <Field label="Base URL" hint="ANTHROPIC_BASE_URL"><input className="input mono" placeholder="https://gateway.example.com" value={ep.url} onChange={(e) => onChange({ url: e.target.value.trim() })} /></Field>
      </div>
      <Field label={t('认证令牌')} hint={ep.keySet ? t('已保存在服务端（不会发到浏览器）；输入新的会替换它') : t('ANTHROPIC_AUTH_TOKEN；不需要令牌的本地服务可以不填（会发送占位值，绝不会用你的 Claude 登录）')}>
        <div className="row">
          <input className="input mono grow" type="password" placeholder={ep.keySet ? '••••••••' : ''} value={key} onChange={(e) => setKey(e.target.value)} />
          <Button size="sm" disabled={!key} onClick={() => settled().then(() => api.setEndpointKey(ep.id, key)).then(() => { setKey(''); app.toast(t('已保存认证令牌'), 'good'); })}>{t('保存令牌')}</Button>
          {ep.keySet && <Button size="sm" variant="ghost" onClick={() => api.setEndpointKey(ep.id, '')}>{t('清除')}</Button>}
        </div>
      </Field>
      <div className="endpoint-models">
        <div className="hint">{t('模型')}</div>
        {ep.models.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>{t('还没有模型。填写端点接受的模型名，比如 deepseek-chat。')}</div>}
        {ep.models.map((m) => (
          <div key={m.name} className="row endpoint-model">
            <span className="mono grow">{m.name}</span>
            <span title={t('开启：发送思考（thinking）和思考强度。关闭：关掉思考；Claude Code 默认的思考强度如果被端点拒绝，它会自动去掉再发。端点不支持思考时请关闭。')}>
              <Toggle on={m.effort} onChange={(v) => onChange({ models: ep.models.map((x) => (x.name === m.name ? { ...x, effort: v } : x)) })} label={t('思考与思考强度')} />
            </span>
            <ContextWindow name={m.name} value={m.contextWindow} onChange={(v) => onChange({ models: ep.models.map((x) => (x.name === m.name ? { ...x, contextWindow: v } : x)) })} />
            {m.test && <Chip tone={m.test.ok ? 'good' : 'crit'} title={`${relTime(m.test.at)} · ${t(m.test.message)}`}>{m.test.ok ? t('可用') : t('失败')}</Chip>}
            <Button size="sm" disabled={!ep.url} title={t('发一句很短的提示，看服务是否回复；端点报告了上下文窗口的话，顺便填上')} onClick={() => test(m)}>{t('测试')}</Button>
            <Button size="sm" variant="ghost" icon="trash" title={t('删除这个模型')} onClick={() => onChange({ models: ep.models.filter((x) => x.name !== m.name) })} />
          </div>
        ))}
        <div className="row">
          <input className="input sm mono grow" placeholder={t('模型名')} value={model} onChange={(e) => setModel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addModel(); }} />
          <Button size="sm" icon="plus" disabled={!model.trim()} onClick={addModel}>{t('添加模型')}</Button>
        </div>
      </div>
      <div className="row"><span className="grow" /><Button size="sm" variant="danger-outline" icon="trash" onClick={onRemove}>{t('删除端点')}</Button></div>
    </div>
  );
}

/** 128k, 1m, 131072 → tokens; empty → not set; null: not a window. */
function parseWindow(s: string): number | undefined | null {
  if (!s.trim()) return undefined;
  const m = /^\s*(\d+(?:\.\d+)?)\s*([km]?)\s*$/i.exec(s);
  const n = m ? Math.round(Number(m[1]) * ({ k: 1000, m: 1_000_000 }[m[2].toLowerCase()] ?? 1)) : 0;
  return n > 0 ? n : null;
}
const windowText = (n: number) => (n % 1_000_000 === 0 ? `${n / 1_000_000}m` : n % 1000 === 0 ? `${n / 1000}k` : String(n));

/** An endpoint model's context window, for a name Claude Code does not know (it assumes 200k for those). */
function ContextWindow({ name, value, onChange }: { name: string; value?: number; onChange: (v: number | undefined) => void }) {
  const t = useT();
  const app = useApp();
  const [text, setText] = useState<string | null>(null);
  // Claude Code decides the window of claude-… names itself and ignores the setting there.
  const own = name.toLowerCase().startsWith('claude-');
  const commit = () => {
    if (text === null) return;
    const v = parseWindow(text);
    setText(null);
    if (v === null) app.toast(t('上下文窗口填 token 数，比如 128k、1m 或 131072'), 'crit');
    else if (v !== value) onChange(v);
  };
  return (
    <label className="row" style={{ gap: 6 }} title={own
      ? t('claude- 开头的模型名由 Claude Code 自己决定上下文窗口，这里的设置不生效。')
      : t('模型能接收的 token 数，比如 128k、1m。不填时 Claude Code 按 200k 算，并据此决定何时自动压缩对话。点「测试」时，端点报告了上下文窗口的话会自动填上。改了以后，正在用这个模型的会话会在空闲时重新启动。')}>
      <span className="muted" style={{ fontSize: 12.5 }}>{t('上下文窗口')}</span>
      <input className="input sm mono" style={{ width: 76 }} placeholder="200k" disabled={own} value={text ?? (value ? windowText(value) : '')}
        onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(); }} />
    </label>
  );
}

function EnvVars() {
  const t = useT();
  const app = useApp();
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  const [note, setNote] = useState('');
  const known = COMMON_ENV.find((c) => c.key === k);
  const patch = (id: string, p: Partial<EnvVar>) => app.set({ env: app.env.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const add = () => {
    app.set({ env: [...app.env, { id: uid('e'), key: k, value: v, note: note || known?.note || '' }] });
    setK(''); setV(''); setNote('');
  };
  // The Git Bash Claude Code gets on Windows (looked up when Code Agent started): listed with the
  // variables, or missing; a variable of the user's with the same name replaces it.
  const [found, setFound] = useState<GitBash | null>(null);
  useEffect(() => {
    let on = true;
    void api.gitBash().then((g) => { if (on) setFound(g); });
    return () => { on = false; };
  }, []);
  const gitBash = app.env.some((e) => e.key.trim() === 'CLAUDE_CODE_GIT_BASH_PATH') ? null : found;
  const auto = gitBash?.path ? gitBash : null;
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>{t('环境变量')}</h3><span className="sub">{t('启动 Claude Code 进程时传入，对所有会话生效')}</span></div>
      {app.env.length === 0 && !auto ? (
        <div className="empty">{t('没有设置任何环境变量，Claude Code 使用自己的默认值。')}</div>
      ) : (
        <div className="panel-body" style={{ padding: 0 }}>
          <table className="data-table">
            <thead><tr><th style={{ paddingLeft: 16, width: 280 }}>{t('变量')}</th><th style={{ width: 200 }}>{t('值')}</th><th>{t('说明')}</th><th /></tr></thead>
            <tbody>
              {app.env.map((e) => (
                <tr key={e.id}>
                  <td className="mono" style={{ paddingLeft: 16 }}>{e.key}</td>
                  <td><input className="input sm mono" value={e.value} onChange={(ev) => patch(e.id, { value: ev.target.value })} /></td>
                  <td><input className="input sm" value={e.note} placeholder={t('写点备注')} onChange={(ev) => patch(e.id, { note: ev.target.value })} /></td>
                  <td className="num"><Button size="sm" variant="ghost" icon="trash" title={t('删除')} onClick={() => app.set({ env: app.env.filter((x) => x.id !== e.id) })} /></td>
                </tr>
              ))}
              {auto && (
                <tr>
                  <td className="mono" style={{ paddingLeft: 16 }}>CLAUDE_CODE_GIT_BASH_PATH</td>
                  <td className="mono" style={{ fontSize: 12.5, wordBreak: 'break-all' }}>{auto.path}</td>
                  <td className="muted" style={{ fontSize: 12.5 }}>{auto.source === 'found'
                    ? t('Code Agent 自动找到的 Git Bash，Claude 的 Bash 和 Monitor 工具要用它。要换一个，添加同名变量。')
                    : t('来自启动 Code Agent 时的环境。要换一个，添加同名变量。')}</td>
                  <td className="num"><Chip>{auto.source === 'found' ? t('自动') : t('启动环境')}</Chip></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {gitBash?.source === 'none' && (
        <div className="panel-body col" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="banner-warn">
            <Icon name="warning" size={16} />
            <div className="grow">
              <b>{t('没找到 Git Bash')}</b>
              <div>{t('会话里的 Claude 只能用 PowerShell 执行命令，没有 Bash 和 Monitor 工具。装好 Git for Windows 后重启 Code Agent；装在别的位置的话，添加 CLAUDE_CODE_GIT_BASH_PATH，值为 Git 安装目录下 bin 文件夹里的 bash.exe。')}</div>
            </div>
          </div>
        </div>
      )}
      <div className="panel-body col" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="row">
          <Select value="" size="sm" width={420} className="w-240"
            renderValue={() => <span className="muted">{t('从常用变量中选择…')}</span>}
            onChange={(key) => { const c = COMMON_ENV.find((x) => x.key === key); setK(key); setNote(c?.note ?? ''); }}
            options={COMMON_ENV.filter((c) => !app.env.some((e) => e.key === c.key)).map((c) => ({ value: c.key, label: <span className="mono">{c.key}</span>, desc: `${t(c.note)} · ${t('默认 {d}', { d: t(c.def) })}` }))} />
          <span className="hint">{t('或者直接输入变量名')}</span>
        </div>
        <div className="row">
          <input className="input sm mono" style={{ width: 280 }} placeholder="NAME" value={k} onChange={(e) => setK(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} />
          <input className="input sm mono" style={{ width: 200 }} placeholder={known ? t('默认 {d}', { d: t(known.def) }) : t('值')} value={v} onChange={(e) => setV(e.target.value)} />
          <input className="input sm grow" placeholder={t('说明（可选）')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" icon="plus" disabled={!k} onClick={add}>{t('添加')}</Button>
        </div>
      </div>
    </div>
  );
}

function Runtime() {
  const t = useT();
  const app = useApp();
  const r = app.runtime;
  const set = (p: Partial<typeof r>) => app.set({ runtime: { ...r, ...p } });
  return (
    <div className="panel">
      <div className="panel-head"><h3>{t('运行与遥测')}</h3></div>
      <div className="panel-body">
        <div className="col">
          <Toggle on={r.debugLog} onChange={(v) => set({ debugLog: v })} label={t('保存调试日志')} hint={t('把 Claude Code 的调试输出写入文件，排查问题时再打开')} />
          <Toggle on={r.otel} onChange={(v) => set({ otel: v })} label={t('导出 OpenTelemetry')} hint="CLAUDE_CODE_ENABLE_TELEMETRY=1" />
        </div>
        {r.otel && (
          <div style={{ marginTop: 12 }}>
            <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
              <div className="grow"><Field label={t('OTLP 端点')}><input className="input mono" placeholder={r.otelProtocol === 'grpc' ? 'http://localhost:4317' : 'http://localhost:4318'} value={r.otelEndpoint} onChange={(e) => set({ otelEndpoint: e.target.value })} /></Field></div>
              <Field label={t('协议')}>
                <Select<RuntimeSettings['otelProtocol']> value={r.otelProtocol} onChange={(v) => set({ otelProtocol: v })} width={200} className="w-180" options={[
                  { value: 'http/protobuf', label: 'HTTP · protobuf', desc: t('端口通常是 4318') },
                  { value: 'http/json', label: 'HTTP · JSON', desc: t('端口通常是 4318') },
                  { value: 'grpc', label: 'gRPC', desc: t('端口通常是 4317') },
                ]} />
              </Field>
            </div>
            <div className="row" style={{ gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              <Toggle on={r.otelMetrics} onChange={(v) => set({ otelMetrics: v })} label={t('指标')} />
              <Toggle on={r.otelLogs} onChange={(v) => set({ otelLogs: v })} label={t('日志')} />
              <Toggle on={r.otelTraces} onChange={(v) => set({ otelTraces: v })} label={t('链路')} />
              <Toggle on={r.otelPrompts} onChange={(v) => set({ otelPrompts: v })} label={t('包含提示词原文')} />
              <Toggle on={r.otelTools} onChange={(v) => set({ otelTools: v })} label={t('包含工具参数')} />
            </div>
            {(r.otelPrompts || r.otelTools) && <div className="hint" style={{ marginTop: 6 }}><Chip tone="warn">{t('注意')}</Chip> {t('导出的数据会包含代码和对话内容')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
