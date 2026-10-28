/** P21 — permission rules (allow / ask / deny) and the Bash sandbox. */
import { useState } from 'react';
import type { PermissionRule } from '../../api/types';
import { Icon } from '../../components/Icon';
import { Button, Chip, Field, Seg, Select, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { uid } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { ChipsInput, Section } from './SettingsLayout';

const SOURCES = ['配置方案 · 默认', '.claude/settings.local.json', '.claude/settings.json', '~/.claude/settings.json'];
const BEHAVIOR_TONE = { allow: 'good', ask: 'warn', deny: 'crit' } as const;
const BEHAVIOR_LABEL = { allow: '允许', ask: '询问', deny: '拒绝' } as const;

export function Permissions() {
  const t = useT();
  const app = useApp();
  const [filter, setFilter] = useState<'all' | PermissionRule['behavior']>('all');
  const [q, setQ] = useState('');
  const [nb, setNb] = useState<PermissionRule['behavior']>('allow');
  const [nr, setNr] = useState('');
  const [ns, setNs] = useState(SOURCES[1]);
  const sb = app.sandbox;
  const rules = app.rules.filter((r) => (filter === 'all' || r.behavior === filter) && (!q || r.rule.toLowerCase().includes(q.toLowerCase())));

  const add = () => {
    if (!nr.trim()) return;
    app.set({ rules: [...app.rules, { id: uid('r'), behavior: nb, rule: nr.trim(), matches: t('自定义规则'), source: ns }] });
    setNr('');
    app.toast(t('已添加规则'), 'good');
  };

  return (
    <>
      <h1>{t('权限规则与沙箱')}</h1>
      <p className="lead">{t('每次工具调用按下面的顺序判断，命中即停止。')}</p>
      <div className="eval-strip">
        <div className="eval-step deny"><b>{t('1 拒绝规则')}</b><span>{t('命中即拒绝')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step"><b>{t('2 询问规则')}</b><span>{t('命中即询问')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step"><b>{t('3 权限模式')}</b><span>{t('如自动接受编辑')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step"><b>{t('4 允许规则')}</b><span>{t('命中即执行')}</span></div><Icon name="chevRight" size={14} className="muted" />
        <div className="eval-step you"><b>{t('5 询问你')}</b><span>{t('「不询问」模式下直接拒绝')}</span></div>
      </div>

      <div className="rules-grid">
        <div className="panel">
          <div className="panel-head">
            <Seg value={filter} onChange={setFilter} items={[
              { value: 'all', label: t('全部 {n}', { n: app.rules.length }) },
              { value: 'allow', label: t('允许') }, { value: 'ask', label: t('询问') }, { value: 'deny', label: t('拒绝') },
            ]} />
            <span className="grow" />
            <input className="input sm" style={{ width: 200 }} placeholder={t('搜索规则')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="panel-body" style={{ padding: 0 }}>
            <table className="data-table">
              <thead><tr><th style={{ paddingLeft: 16, width: 70 }}>{t('行为')}</th><th>{t('规则')}</th><th>{t('匹配')}</th><th>{t('来源')}</th><th /></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td style={{ paddingLeft: 16 }}><Chip tone={BEHAVIOR_TONE[r.behavior]}>{t(BEHAVIOR_LABEL[r.behavior])}</Chip></td>
                    <td className="mono">{r.rule}</td>
                    <td className="ink2">{t(r.matches)}</td>
                    <td className="muted mono" style={{ fontSize: 11.5 }}>{t(r.source)}</td>
                    <td className="num">
                      {r.locked
                        ? <span title={t('由托管设置下发，不能在这里修改')}><Icon name="lock" size={14} className="muted" /></span>
                        : <Button size="sm" variant="ghost" icon="trash" title={t('删除')} onClick={() => app.set({ rules: app.rules.filter((x) => x.id !== r.id) })} />}
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && <tr><td colSpan={5} className="empty">{t('没有匹配的规则')}</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="panel-body row" style={{ borderTop: '1px solid var(--border)' }}>
            <Select value={nb} onChange={setNb} size="sm" className="w-140" options={(['allow', 'ask', 'deny'] as const).map((b) => ({ value: b, label: t(BEHAVIOR_LABEL[b]) }))} />
            <input className="input sm mono grow" placeholder="Bash(npm run build *)" value={nr} onChange={(e) => setNr(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
            <Select value={ns} onChange={setNs} size="sm" width={260} className="w-240" options={SOURCES.map((s) => ({ value: s, label: t(s) }))} />
            <Button size="sm" variant="primary" icon="plus" disabled={!nr.trim()} onClick={add}>{t('添加')}</Button>
          </div>
        </div>

        <div className="panel">
          <div className="panel-head"><h3>{t('规则写法')}</h3></div>
          <div className="panel-body">
            <dl className="syntax">
              <dt>Read</dt><dd>{t('整个工具')}</dd>
              <dt>Bash(npm test *)</dt><dd>{t('命令前缀匹配；* 是通配符')}</dd>
              <dt>Edit(/src/**)</dt><dd>{t('相对设置文件所在目录的路径')}</dd>
              <dt>Edit(//etc/**)</dt><dd>{t('// 开头表示绝对路径')}</dd>
              <dt>WebFetch(domain:x.com)</dt><dd>{t('按域名匹配')}</dd>
              <dt>mcp__github__*</dt><dd>{t('某个 MCP 服务器的全部工具')}</dd>
              <dt>Agent(Explore)</dt><dd>{t('指定子代理')}</dd>
            </dl>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>{t('Bash 沙箱')}</h3>
          <span className="sub">{t('在操作系统层面限制命令能读写的文件和能访问的网络')}</span>
          <span className="grow" />
          <Toggle on={sb.enabled} onChange={(v) => app.setSandbox({ enabled: v })} label={sb.enabled ? t('已开启') : t('已关闭')} />
        </div>
        <div className="panel-body" style={sb.enabled ? undefined : { opacity: 0.5, pointerEvents: 'none' }}>
          <Section title={t('行为')}>
            <div className="col">
              <Toggle on={sb.failIfUnavailable} onChange={(v) => app.setSandbox({ failIfUnavailable: v })} label={t('沙箱不可用时拒绝启动')} />
              <Toggle on={sb.autoAllowBash} onChange={(v) => app.setSandbox({ autoAllowBash: v })} label={t('沙箱内的命令自动允许')} hint={t('不再逐条询问')} />
              <Toggle on={sb.allowUnsandboxed} onChange={(v) => app.setSandbox({ allowUnsandboxed: v })} label={t('允许 Claude 申请在沙箱外运行')} hint={t('仍然需要你批准')} />
              <Toggle on={sb.allowLocalBinding} onChange={(v) => app.setSandbox({ allowLocalBinding: v })} label={t('允许监听本地端口')} />
            </div>
          </Section>
          <div className="form-grid">
            <Field label={t('允许访问的域名')}><ChipsInput values={sb.allowedDomains} onChange={(v) => app.setSandbox({ allowedDomains: v })} /></Field>
            <Field label={t('禁止访问的域名')}><ChipsInput values={sb.deniedDomains} onChange={(v) => app.setSandbox({ deniedDomains: v })} /></Field>
            <Field label={t('额外允许写入')}><ChipsInput values={sb.allowWrite} onChange={(v) => app.setSandbox({ allowWrite: v })} /></Field>
            <Field label={t('禁止读取')}><ChipsInput values={sb.denyRead} onChange={(v) => app.setSandbox({ denyRead: v })} /></Field>
            <Field label={t('不进沙箱的命令')} hint={t('例如需要访问 Docker 套接字的命令')}><ChipsInput values={sb.excluded} onChange={(v) => app.setSandbox({ excluded: v })} /></Field>
            <Field label={t('网络')}><Toggle on={sb.strictAllowlist} onChange={(v) => app.setSandbox({ strictAllowlist: v })} label={t('只允许名单内的域名')} /></Field>
          </div>
        </div>
      </div>
    </>
  );
}
