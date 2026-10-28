/** P20 — configuration profiles: the options a new session starts with. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Effort, PermissionMode, Profile } from '../../api/types';
import { BUILTIN_TOOLS, EFFORT_LABEL, MODE_INFO, MODELS } from '../../mock/data';
import { Button, Check, Chip, Field, Seg, Select, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { cx, uid } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

const FEATURES: Array<{ key: string; label: string; hint: string }> = [
  { key: 'checkpoints', label: '文件检查点', hint: '每条消息前保存快照，可以回退' },
  { key: 'subagentText', label: '显示子代理的文字输出', hint: '' },
  { key: 'progressSummaries', label: '子代理进度摘要', hint: '后台子代理定期汇报进展' },
  { key: 'hookEvents', label: '记录钩子事件', hint: '在事件页中显示钩子的执行结果' },
  { key: 'persist', label: '保存会话到磁盘', hint: '关闭后不能恢复和分叉' },
  { key: 'verbatim', label: '默认原样发送', hint: '以 / 开头的消息不当作命令' },
];

export function Profiles() {
  const t = useT();
  const app = useApp();
  const [selId, setSelId] = useState(app.profiles.find((p) => p.isDefault)?.id ?? app.profiles[0].id);
  const saved = app.profiles.find((p) => p.id === selId) ?? app.profiles[0];
  const [draft, setDraft] = useState<Profile>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const set = (p: Partial<Profile>) => setDraft({ ...draft, ...p });
  const model = MODELS.find((m) => m.id === draft.model) ?? MODELS[0];

  const select = (id: string) => {
    if (!dirty) { setSelId(id); return; }
    app.ask({ title: t('放弃未保存的修改？'), body: t('「{n}」有未保存的修改。', { n: saved.name }), confirmLabel: t('放弃修改'), danger: true, onConfirm: () => setSelId(id) });
  };
  const create = (from?: Profile) => {
    const base = from ?? app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
    const p: Profile = { ...base, id: uid('p'), name: from ? t('{n} 副本', { n: base.name }) : t('新方案'), isDefault: false, desc: '' };
    app.set({ profiles: [...app.profiles, p] });
    setSelId(p.id);
  };
  const remove = () => app.ask({
    title: t('删除配置方案？'), body: t('「{n}」将被删除。使用它的会话不受影响。', { n: saved.name }), confirmLabel: t('删除'), danger: true,
    onConfirm: () => {
      const rest = app.profiles.filter((p) => p.id !== saved.id);
      app.set({ profiles: rest });
      setSelId(rest[0].id);
    },
  });

  return (
    <>
      <h1>{t('配置方案')}</h1>
      <p className="lead">{t('配置方案是新会话的默认选项。会话中途在输入框下方改的模型、思考强度、权限模式只影响当前会话。')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <div>
          <div className="profile-list">
            {app.profiles.map((p) => (
              <div key={p.id} className={cx('profile-item', p.id === selId && 'on')} onClick={() => select(p.id)}>
                <div className="row"><b className="grow">{p.name}</b>{p.isDefault && <Chip tone="accent">{t('默认')}</Chip>}</div>
                <div className="muted">{p.desc || '—'}</div>
              </div>
            ))}
          </div>
          <Button icon="plus" style={{ width: '100%', marginTop: 10 }} onClick={() => create()}>{t('新建配置方案')}</Button>
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>{draft.name || t('未命名')}</h3>
            <div className="actions">
              <Button size="sm" variant="ghost" icon="copy" onClick={() => create(saved)}>{t('复制')}</Button>
              <Button size="sm" variant="ghost" icon="trash" disabled={saved.isDefault || app.profiles.length < 2} title={saved.isDefault ? t('默认方案不能删除') : undefined} onClick={remove}>{t('删除')}</Button>
            </div>
          </div>
          <div className="panel-body">
            <Section title={t('基本')}>
              <div className="form-grid">
                <Field label={t('名称')}><input className="input" value={draft.name} onChange={(e) => set({ name: e.target.value })} /></Field>
                <Field label={t('说明')}><input className="input" value={draft.desc} onChange={(e) => set({ desc: e.target.value })} /></Field>
              </div>
              <div style={{ marginTop: 10 }}><Toggle on={!!draft.isDefault} onChange={(v) => set({ isDefault: v })} label={t('新会话默认使用这个方案')} disabled={saved.isDefault} /></div>
            </Section>

            <Section title={t('模型')}>
              <div className="form-grid">
                <Field label={t('模型')}>
                  <Select value={draft.model} onChange={(v) => { const efforts = MODELS.find((m) => m.id === v)!.efforts; set({ model: v, effort: efforts.includes(draft.effort) ? draft.effort : efforts[efforts.length - 1] }); }}
                    options={MODELS.map((m) => ({ value: m.id, label: m.label, desc: t(m.desc) }))} />
                </Field>
                <Field label={t('思考强度')} hint={t('使用第三方端点时可能不生效')}>
                  <Select<Effort> value={draft.effort} onChange={(v) => set({ effort: v })} options={model.efforts.map((e) => ({ value: e, label: t(EFFORT_LABEL[e]) }))} />
                </Field>
                <Field label={t('扩展思考')} hint={t('回答前先在内部推理。自适应：由模型决定想多少，深浅由思考强度控制')}>
                  <Seg value={draft.thinking} onChange={(v) => set({ thinking: v })} items={[{ value: 'adaptive', label: t('自适应') }, { value: 'budget', label: t('固定预算') }, { value: 'off', label: t('关闭') }]} />
                </Field>
              </div>
            </Section>

            <Section title={t('权限')}>
              <div className="form-grid">
                <Field label={t('默认权限模式')}>
                  <Select<PermissionMode> value={draft.mode} onChange={(v) => set({ mode: v })}
                    options={(Object.keys(MODE_INFO) as PermissionMode[]).map((m) => ({ value: m, icon: MODE_INFO[m].icon, label: t(MODE_INFO[m].label), desc: t(MODE_INFO[m].desc), disabled: m === 'bypassPermissions' && !draft.allowBypass }))} />
                </Field>
                <Field label={t('需要审批时')}>
                  <Seg value={draft.prompts} onChange={(v) => set({ prompts: v })} items={[{ value: 'host', label: t('在界面中询问我') }, { value: 'none', label: t('一律拒绝') }]} />
                </Field>
              </div>
              <div style={{ margin: '10px 0' }}>
                <Toggle on={draft.allowBypass} onChange={(v) => set({ allowBypass: v, mode: !v && draft.mode === 'bypassPermissions' ? 'default' : draft.mode })} label={t('允许切换到「跳过权限检查」')} hint={t('只建议在容器或虚拟机中开启')} />
              </div>
              <div className="hint">{t('哪些操作直接执行、哪些先问你、哪些禁止，在')} <Link to="/settings/permissions">{t('权限规则')}</Link> {t('里设置。')}</div>
            </Section>

            <Section title={t('Claude 可以使用的工具')} right={<span className="hint">{t('{n}/{m} 个已开启', { n: draft.tools.length, m: BUILTIN_TOOLS.length })}</span>}>
              <div className="tool-grid">
                {BUILTIN_TOOLS.map((tool) => {
                  const on = draft.tools.includes(tool.name);
                  return (
                    <div key={tool.name} className={cx('tool-item', on && 'on')} onClick={() => set({ tools: on ? draft.tools.filter((x) => x !== tool.name) : [...draft.tools, tool.name] })}>
                      <Check on={on} onChange={() => {}} label="" />
                      <div className="grow">
                        <b>{t(tool.label)}</b> <span className="mono muted">{tool.name}</span>
                        {tool.desc && <div className="hint">{t(tool.desc)}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="hint" style={{ marginTop: 6 }}>{t('关掉的工具 Claude 看不到，也不会去用。')}</div>
              {draft.tools.includes('AskUserQuestion') && (
                <div style={{ marginTop: 10 }}><Toggle on={draft.questionPreviews} onChange={(v) => set({ questionPreviews: v })} label={t('提问时允许 HTML 预览')} /></div>
              )}
            </Section>

            <Section title={t('读取的设置文件')}>
              <div className="row" style={{ gap: 18 }}>
                <Check on={draft.sources.user} onChange={(v) => set({ sources: { ...draft.sources, user: v } })} label={<>{t('所有工作区')} <span className="mono muted">~/.claude/settings.json</span></>} />
                <Check on={draft.sources.local} onChange={(v) => set({ sources: { ...draft.sources, local: v } })} label={<>{t('这个工作区')} <span className="mono muted">.claude/settings.local.json</span></>} />
                <Check on={draft.sources.project} onChange={(v) => set({ sources: { ...draft.sources, project: v } })} label={<>{t('仓库共享')} <span className="mono muted">.claude/settings.json</span></>} />
              </div>
              <div className="hint" style={{ marginTop: 6 }}>{t('CLAUDE.md、技能、钩子等也来自这些位置。全部取消时只使用这里的配置。')}</div>
            </Section>

            <Section title={t('系统提示词')}>
              <Seg value={draft.promptMode} onChange={(v) => set({ promptMode: v })} items={[
                { value: 'preset', label: t('Claude Code 默认') }, { value: 'append', label: t('默认 + 追加') }, { value: 'custom', label: t('完全自定义') }, { value: 'minimal', label: t('最简') },
              ]} />
              {(draft.promptMode === 'append' || draft.promptMode === 'custom') && (
                <textarea className="textarea" style={{ marginTop: 8, width: '100%' }} rows={3} value={draft.promptText} onChange={(e) => set({ promptText: e.target.value })}
                  placeholder={draft.promptMode === 'append' ? t('追加在默认提示词之后') : t('替换整个系统提示词')} />
              )}
            </Section>

            <Section title={t('回复语言')}>
              <Seg value={draft.responseLanguage} onChange={(v) => set({ responseLanguage: v })} items={[
                { value: 'ui', label: t('跟随界面语言') }, { value: 'conversation', label: t('跟随对话') }, { value: 'zh-CN', label: '简体中文' }, { value: 'en', label: 'English' },
              ]} />
            </Section>

            <Section title={t('功能')}>
              <div className="col">
                {FEATURES.map((f) => (
                  <Toggle key={f.key} on={!!draft.features[f.key]} onChange={(v) => set({ features: { ...draft.features, [f.key]: v } })} label={t(f.label)} hint={f.hint ? t(f.hint) : undefined} />
                ))}
              </div>
            </Section>
          </div>
          {dirty && (
            <div className="modal-foot" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', borderRadius: '0 0 10px 10px' }}>
              <div className="left hint">{t('有未保存的修改')}</div>
              <Button onClick={() => setDraft(saved)}>{t('放弃')}</Button>
              <Button variant="primary" onClick={() => { app.saveProfile(draft); app.toast(t('已保存「{n}」', { n: draft.name }), 'good'); }}>{t('保存')}</Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
