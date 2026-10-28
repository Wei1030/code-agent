/**
 * P22 — model provider and account.
 * Code Agent never signs anyone in to claude.ai and never touches those credentials: with a
 * subscription, the user logs in to Claude Code themselves and we only point at its config dir.
 */
import { useState } from 'react';
import type { ProviderKind } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Button, Chip, Field, Radio, Seg, Status, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { cx, uid } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

const KINDS: Array<{ kind: ProviderKind; icon: string; label: string; desc: string }> = [
  { kind: 'subscription', icon: 'user', label: 'Claude 订阅', desc: '使用你自己登录的 Claude Code' },
  { kind: 'apiKey', icon: 'key', label: 'Anthropic API', desc: 'API 密钥，按 token 计费' },
  { kind: 'bedrock', icon: 'box', label: 'Amazon Bedrock', desc: 'AWS 凭证' },
  { kind: 'vertex', icon: 'box', label: 'Google Cloud Vertex AI', desc: 'GCP 凭证' },
  { kind: 'foundry', icon: 'box', label: 'Microsoft Foundry', desc: 'Azure 凭证' },
  { kind: 'compatible', icon: 'link', label: '兼容端点', desc: 'Anthropic Messages 兼容的网关或其他模型' },
];

export function Provider() {
  const t = useT();
  const app = useApp();
  const p = app.provider;
  const [checking, setChecking] = useState(false);
  const [keyDraft, setKeyDraft] = useState('');
  const recheck = () => {
    setChecking(true);
    setTimeout(() => {
      setChecking(false);
      app.setProvider({ loggedIn: true });
      app.toast(t('已检测到登录状态：Claude {p}', { p: p.plan }), 'good');
    }, 900);
  };
  const dir = p.configDir === 'default' ? '~/.claude' : p.configDir === 'env' ? '$CLAUDE_CONFIG_DIR → D:\\claude-config' : p.customDir || t('（未填写）');

  return (
    <>
      <h1>{t('模型服务与账号')}</h1>
      <p className="lead">{t('选择 Claude Code 连接哪个模型服务。修改后对新启动的会话生效。')}</p>
      <div className="provider-cards">
        {KINDS.map((k) => (
          <button key={k.kind} className={cx('provider-card', p.kind === k.kind && 'on')} onClick={() => app.setProvider({ kind: k.kind })}>
            <Radio on={p.kind === k.kind} onChange={() => app.setProvider({ kind: k.kind })} />
            <div><b>{t(k.label)}</b><span className="d">{t(k.desc)}</span></div>
          </button>
        ))}
      </div>

      {p.kind === 'subscription' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>{t('Claude 订阅')}</h3><span className="grow" />
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
                  <b>{t('环境变量 ANTHROPIC_API_KEY 已设置')}</b>
                  <div>{t('它的优先级高于订阅登录，Claude Code 会改用 API 密钥并按 token 计费。')}</div>
                </div>
                <Button size="sm" onClick={() => app.setProvider({ envConflict: false })}>{t('启动时忽略这个变量')}</Button>
              </div>
            )}
            <Section title={t('配置目录')}>
              <div className="col">
                <div className="option-card" onClick={() => app.setProvider({ configDir: 'default' })}><Radio on={p.configDir === 'default'} onChange={() => app.setProvider({ configDir: 'default' })} /><div><b>{t('默认位置')}</b><div className="d mono">~/.claude</div></div></div>
                <div className="option-card" onClick={() => app.setProvider({ configDir: 'env' })}><Radio on={p.configDir === 'env'} onChange={() => app.setProvider({ configDir: 'env' })} /><div><b>{t('使用环境变量 CLAUDE_CONFIG_DIR')}</b><div className="d mono">D:\claude-config</div></div></div>
                <div className="option-card" onClick={() => app.setProvider({ configDir: 'custom' })}>
                  <Radio on={p.configDir === 'custom'} onChange={() => app.setProvider({ configDir: 'custom' })} />
                  <div className="grow"><b>{t('指定目录')}</b>
                    {p.configDir === 'custom' && <input className="input mono" style={{ marginTop: 6 }} placeholder="D:\\tools\\claude" value={p.customDir} onClick={(e) => e.stopPropagation()} onChange={(e) => app.setProvider({ customDir: e.target.value })} />}
                  </div>
                </div>
              </div>
            </Section>
            <Section title={t('Claude Code 程序')}>
              <Seg value={p.executable} onChange={(v) => app.setProvider({ executable: v })} items={[{ value: 'bundled', label: t('随 SDK 提供') }, { value: 'system', label: t('系统中安装的 claude') }]} />
            </Section>
            <Section title={t('登录')}>
              {p.loggedIn ? (
                <dl className="kv">
                  <dt>{t('账号')}</dt><dd>w***@example.com</dd>
                  <dt>{t('订阅')}</dt><dd>Claude {p.plan}</dd>
                  <dt>{t('配置目录')}</dt><dd className="mono">{dir}</dd>
                </dl>
              ) : (
                <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.9 }}>
                  <li>{t('打开终端，运行')} <code className="mono">{p.configDir === 'default' ? 'claude' : `CLAUDE_CONFIG_DIR=${p.configDir === 'env' ? 'D:\\claude-config' : p.customDir} claude`}</code></li>
                  <li>{t('在 Claude Code 中输入')} <code className="mono">/login</code> {t('并按提示完成登录')}</li>
                  <li>{t('回到这里点「重新检测」')}</li>
                </ol>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <Button size="sm" icon="copy" onClick={() => { void navigator.clipboard?.writeText('claude'); app.toast(t('已复制登录命令'), 'good'); }}>{t('复制命令')}</Button>
                <Button size="sm" icon="refresh" disabled={checking} onClick={recheck}>{checking ? t('检测中…') : t('重新检测')}</Button>
                {p.loggedIn && <Button size="sm" variant="ghost" onClick={() => app.setProvider({ loggedIn: false })}>{t('模拟：退出登录')}</Button>}
              </div>
            </Section>
          </div>
        </div>
      )}

      {p.kind === 'apiKey' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>Anthropic API</h3></div>
          <div className="panel-body form-grid">
            <Field label={t('API 密钥')} hint={p.apiKeyMasked ? t('已保存：{k}', { k: p.apiKeyMasked }) : t('保存在本机的服务端，不会发到浏览器')}>
              <div className="row">
                <input className="input mono grow" type="password" placeholder="sk-ant-…" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
                <Button disabled={!keyDraft} onClick={() => { app.setProvider({ apiKeyMasked: `${keyDraft.slice(0, 7)}…${keyDraft.slice(-4)}` }); setKeyDraft(''); app.toast(t('已保存密钥'), 'good'); }}>{t('保存')}</Button>
              </div>
            </Field>
            <Field label={t('Base URL（可选）')} hint="ANTHROPIC_BASE_URL"><input className="input mono" placeholder="https://api.anthropic.com" value={p.baseUrl} onChange={(e) => app.setProvider({ baseUrl: e.target.value })} /></Field>
          </div>
        </div>
      )}

      {p.kind === 'bedrock' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>Amazon Bedrock</h3><span className="sub">CLAUDE_CODE_USE_BEDROCK=1</span></div>
          <div className="panel-body form-grid">
            <Field label={t('区域')}><input className="input mono" value={p.region} onChange={(e) => app.setProvider({ region: e.target.value })} /></Field>
            <Field label={t('AWS 配置文件')} hint={t('凭证由 AWS SDK 读取')}><input className="input mono" value={p.awsProfile} onChange={(e) => app.setProvider({ awsProfile: e.target.value })} /></Field>
          </div>
        </div>
      )}

      {p.kind === 'vertex' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>Google Cloud Vertex AI</h3><span className="sub">CLAUDE_CODE_USE_VERTEX=1</span></div>
          <div className="panel-body form-grid">
            <Field label={t('项目 ID')}><input className="input mono" value={p.gcpProject} onChange={(e) => app.setProvider({ gcpProject: e.target.value })} /></Field>
            <Field label={t('区域')}><input className="input mono" value={p.region} onChange={(e) => app.setProvider({ region: e.target.value })} /></Field>
          </div>
        </div>
      )}

      {p.kind === 'foundry' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>Microsoft Foundry</h3><span className="sub">CLAUDE_CODE_USE_FOUNDRY=1</span></div>
          <div className="panel-body form-grid">
            <Field label={t('资源名称')}><input className="input mono" value={p.foundryResource} onChange={(e) => app.setProvider({ foundryResource: e.target.value })} /></Field>
          </div>
        </div>
      )}

      {p.kind === 'compatible' && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-head"><h3>{t('兼容端点')}</h3><span className="sub">{t('需要实现 Anthropic Messages API')}</span></div>
          <div className="panel-body">
            <div className="form-grid">
              <Field label="Base URL" hint="ANTHROPIC_BASE_URL"><input className="input mono" placeholder="https://gateway.example.com" value={p.compatibleUrl} onChange={(e) => app.setProvider({ compatibleUrl: e.target.value })} /></Field>
              <Field label={t('模型名')} hint="ANTHROPIC_MODEL"><input className="input mono" placeholder="vendor/model-name" value={p.compatibleModel} onChange={(e) => app.setProvider({ compatibleModel: e.target.value })} /></Field>
              <Field label={t('认证令牌')} hint="ANTHROPIC_AUTH_TOKEN"><input className="input mono" type="password" placeholder="••••••••" /></Field>
            </div>
            <div className="banner-warn" style={{ marginTop: 14 }}>
              <Icon name="warning" size={16} />
              <div>
                <b>{t('非 Claude 模型不受官方支持')}</b>
                <div>{t('以下功能取决于端点是否实现：思考强度、扩展思考、提示缓存统计、精确 token 计数、工具搜索、结构化输出、图片输入。不支持时会被忽略或报错。')}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      <EnvVars />
      <Runtime />
    </>
  );
}

function EnvVars() {
  const t = useT();
  const app = useApp();
  const [k, setK] = useState('');
  const [v, setV] = useState('');
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>{t('环境变量')}</h3><span className="sub">{t('启动 Claude Code 进程时传入')}</span></div>
      <div className="panel-body" style={{ padding: 0 }}>
        <table className="data-table">
          <thead><tr><th style={{ paddingLeft: 16 }}>{t('变量')}</th><th>{t('值')}</th><th>{t('适用于')}</th><th>{t('说明')}</th><th /></tr></thead>
          <tbody>
            {app.env.map((e) => (
              <tr key={e.id}>
                <td className="mono" style={{ paddingLeft: 16 }}>{e.key}</td>
                <td><input className="input sm mono" value={e.value} onChange={(ev) => app.set({ env: app.env.map((x) => (x.id === e.id ? { ...x, value: ev.target.value } : x)) })} /></td>
                <td className="ink2">{t(e.scope)}</td>
                <td className="muted">{t(e.note)}</td>
                <td className="num"><Button size="sm" variant="ghost" icon="trash" title={t('删除')} onClick={() => app.set({ env: app.env.filter((x) => x.id !== e.id) })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-body row" style={{ borderTop: '1px solid var(--border)' }}>
        <input className="input sm mono" style={{ width: 280 }} placeholder="NAME" value={k} onChange={(e) => setK(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} />
        <input className="input sm mono grow" placeholder={t('值')} value={v} onChange={(e) => setV(e.target.value)} />
        <Button size="sm" icon="plus" disabled={!k} onClick={() => { app.set({ env: [...app.env, { id: uid('e'), key: k, value: v, scope: '所有配置方案', note: '' }] }); setK(''); setV(''); }}>{t('添加')}</Button>
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
          <Toggle on={r.debugLog} onChange={(v) => set({ debugLog: v })} label={t('保存调试日志')} hint={t('stderr 写入会话目录，便于排查')} />
          <Toggle on={r.otel} onChange={(v) => set({ otel: v })} label={t('导出 OpenTelemetry')} hint="CLAUDE_CODE_ENABLE_TELEMETRY=1" />
        </div>
        {r.otel && (
          <div style={{ marginTop: 12 }}>
            <Field label={t('OTLP 端点')}><input className="input mono" placeholder="http://localhost:4318" value={r.otelEndpoint} onChange={(e) => set({ otelEndpoint: e.target.value })} /></Field>
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
