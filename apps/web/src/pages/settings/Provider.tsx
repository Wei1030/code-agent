/**
 * P22 — model provider and account.
 * Code Agent never signs anyone in to claude.ai and never touches those credentials: with a
 * subscription, the user logs in to Claude Code themselves and we only point at its config dir.
 */
import { useState } from 'react';
import { api } from '../../api';
import { relTime } from '../../lib/format';
import type { EnvVar, ProviderKind } from '../../api/types';
import { COMMON_ENV } from '../../lib/catalog';
import { Icon } from '../../components/Icon';
import { Button, Chip, Field, Radio, Seg, Select, Status, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { cx, uid } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

const KINDS: Array<{ kind: ProviderKind; icon: string; label: string; desc: string }> = [
  { kind: 'subscription', icon: 'user', label: 'Claude 订阅', desc: '使用你自己登录的 Claude Code' },
  { kind: 'compatible', icon: 'link', label: '兼容端点', desc: 'Anthropic Messages 兼容的网关或其他模型' },
];

export function Provider() {
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
  const [key, setKey] = useState('');

  return (
    <>
      <h1>{t('模型服务与账号')}</h1>
      <p className="lead">{t('选择 Claude Code 连接哪个模型服务。修改后对新启动的会话生效。')}</p>
      <div className="provider-cards" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', maxWidth: 760 }}>
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
                  <b>{t('环境变量 {v} 已设置', { v: p.envVar ?? 'ANTHROPIC_API_KEY' })}</b>
                  <div>{t('它的优先级高于订阅登录，Claude Code 会改用 API 密钥并按 token 计费。')}</div>
                </div>
                <Button size="sm" onClick={() => app.setProvider({ envConflict: false })}>{t('启动时忽略这个变量')}</Button>
              </div>
            )}
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
            </Section>
            <Section title={t('Claude Code 程序')}>
              <Seg value={p.executable} onChange={(v) => app.setProvider({ executable: v })} items={[{ value: 'bundled', label: t('随 SDK 提供') }, { value: 'system', label: t('系统中安装的 claude') }]} />
            </Section>
            <Section title={t('登录')}>
              {p.loggedIn ? (
                <dl className="kv">
                  <dt>{t('账号')}</dt><dd>{p.account ?? '—'}</dd>
                  <dt>{t('订阅')}</dt><dd>Claude {p.plan}</dd>
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
                <Button size="sm" icon="refresh" disabled={checking} onClick={() => void recheck()}>{checking ? t('检测中…') : t('重新检测')}</Button>
                {p.checkedAt && <span className="hint">{t('上次检测 {t}', { t: relTime(p.checkedAt) })}</span>}
              </div>
            </Section>
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
              <Field label={t('认证令牌')} hint={p.compatibleKeySet ? t('已保存在服务端（不会发到浏览器）；输入新的会替换它') : 'ANTHROPIC_AUTH_TOKEN'}>
                <div className="row"><input className="input mono grow" type="password" placeholder={p.compatibleKeySet ? '••••••••' : ''} value={key} onChange={(e) => setKey(e.target.value)} />
                  <Button size="sm" disabled={!key} onClick={() => void api.setCompatibleKey(key).then(() => { setKey(''); app.toast(t('已保存认证令牌'), 'good'); })}>{t('保存')}</Button></div>
              </Field>
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
  const [note, setNote] = useState('');
  const known = COMMON_ENV.find((c) => c.key === k);
  const patch = (id: string, p: Partial<EnvVar>) => app.set({ env: app.env.map((x) => (x.id === id ? { ...x, ...p } : x)) });
  const add = () => {
    app.set({ env: [...app.env, { id: uid('e'), key: k, value: v, note: note || known?.note || '' }] });
    setK(''); setV(''); setNote('');
  };
  return (
    <div className="panel" style={{ marginBottom: 16 }}>
      <div className="panel-head"><h3>{t('环境变量')}</h3><span className="sub">{t('启动 Claude Code 进程时传入，对所有会话生效')}</span></div>
      {app.env.length === 0 ? (
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
            </tbody>
          </table>
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
