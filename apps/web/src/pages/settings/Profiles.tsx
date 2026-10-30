/** P20 — configuration profiles: 默认 for sessions, 评审 for the code-reviewer subagent. Fixed; none can be added. */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Effort, OutputStyle, PermissionMode, Profile, ReviewProfile } from '../../api/types';
import { api } from '../../api';
import { Icon } from '../../components/Icon';
import { BUILTIN_TOOLS, MODE_INFO } from '../../lib/catalog';
import { effortFor, effortOptions, modelOptions, takesEffort } from '../../lib/models';
import { Button, Check, Field, Seg, Select, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { cx } from '../../lib/util';
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

const ENTRIES = [
  { id: 'default' as const, name: '默认', desc: '新会话和 Claude 新建的会话使用' },
  { id: 'review' as const, name: '评审', desc: '代码审核时的审核者使用' },
];

export function Profiles() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const which = params.get('p') === 'review' ? 'review' : 'default';
  const [dirty, setDirty] = useState(false);
  const select = (id: 'default' | 'review') => {
    const go = () => { setDirty(false); setParams(id === 'review' ? { p: 'review' } : {}); };
    if (!dirty || id === which) { go(); return; }
    useApp.getState().ask({ title: t('放弃未保存的修改？'), body: t('「{n}」有未保存的修改。', { n: which === 'review' ? t('评审') : t('默认') }), confirmLabel: t('放弃修改'), danger: true, onConfirm: go });
  };

  return (
    <>
      <h1>{t('配置方案')}</h1>
      <p className="lead">{t('只有两套：「默认」用于新会话和 Claude 新建的会话，「评审」用于代码审核的审核者。会话中途在输入框下方改的模型、思考强度、权限模式只影响当前会话。')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
        <div className="profile-list">
          {ENTRIES.map((e) => (
            <div key={e.id} className={cx('profile-item', e.id === which && 'on')} onClick={() => select(e.id)}>
              <b>{t(e.name)}</b>
              <div className="muted">{t(e.desc)}</div>
            </div>
          ))}
        </div>
        {which === 'default' ? <DefaultEditor onDirty={setDirty} /> : <ReviewEditor onDirty={setDirty} />}
      </div>
    </>
  );
}

function SaveBar({ onDiscard, onSave }: { onDiscard: () => void; onSave: () => void }) {
  const t = useT();
  return (
    <div className="modal-foot" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', borderRadius: '0 0 10px 10px' }}>
      <div className="left hint">{t('有未保存的修改')}</div>
      <Button onClick={onDiscard}>{t('放弃')}</Button>
      <Button variant="primary" onClick={onSave}>{t('保存')}</Button>
    </div>
  );
}

function DefaultEditor({ onDirty }: { onDirty: (d: boolean) => void }) {
  const t = useT();
  const [styles, setStyles] = useState<OutputStyle[]>([]);
  const wsId = useApp((s) => s.currentWorkspaceId);
  useEffect(() => { void api.outputStyles(wsId || undefined).then(setStyles); }, [wsId]);
  const [justSaved, setJustSaved] = useState(false);
  const running = useApp((s) => s.sessions.filter((x) => x.live && !x.draft && !x.jobId).length);
  const app = useApp();
  const saved = app.profiles.find((p) => p.isDefault) ?? app.profiles[0];
  const [draft, setDraft] = useState<Profile>(saved);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const set = (p: Partial<Profile>) => setDraft({ ...draft, ...p });
  const model = app.models.find((m) => m.id === draft.model);
  const onClaude = !model?.endpoint;

  return (
    <div className="panel">
      <div className="panel-head"><h3>{t('默认')}</h3><span className="hint">{t('新会话和 Claude 新建的会话使用')}</span></div>
      <div className="panel-body">
            <Section title={t('模型')}>
              <div className="form-grid">
                <Field label={t('模型')}>
                  <Select value={draft.model} onChange={(v) => set({ model: v, effort: effortFor(app.models, v, draft.effort) })}
                    options={modelOptions(app.models, t)} />
                </Field>
                <Field label={t('思考强度')} hint={takesEffort(model) ? t('模型回答前想得多深') : t('这个端点模型没有开启「思考与思考强度」')}>
                  <Select<Effort> value={draft.effort} onChange={(v) => set({ effort: v })} disabled={!takesEffort(model)} options={effortOptions(model, draft.effort, t)} />
                </Field>
              </div>
            </Section>

            <Section title={t('权限')}>
              <div className="form-grid">
                <Field label={t('默认权限模式')}>
                  <Select<PermissionMode> value={draft.mode} onChange={(v) => set({ mode: v })}
                    options={(Object.keys(MODE_INFO) as PermissionMode[]).map((m) => ({ value: m, icon: MODE_INFO[m].icon, label: t(MODE_INFO[m].label), desc: t(MODE_INFO[m].desc) }))} />
                </Field>
                <Field label={t('需要审批时')}>
                  <Seg value={draft.prompts} onChange={(v) => set({ prompts: v })} items={[{ value: 'host', label: t('在界面中询问我') }, { value: 'none', label: t('一律拒绝') }]} />
                </Field>
              </div>
              <div className="hint">{t('哪些操作直接执行、哪些先问你、哪些禁止，在')} <Link to="/settings/permissions">{t('权限规则')}</Link> {t('里设置。')}</div>
            </Section>

            <Section title={t('Claude 可以使用的工具')} right={<span className="hint">{t('{n}/{m} 个已开启', { n: draft.tools.length, m: BUILTIN_TOOLS.length })}</span>}>
              <div className="tool-grid">
                {BUILTIN_TOOLS.map((tool) => {
                  const unavailable = !!tool.claudeOnly && !onClaude;
                  const on = draft.tools.includes(tool.name) && !unavailable;
                  return (
                    <div key={tool.name} className={cx('tool-item', on && 'on', unavailable && 'disabled')}
                      onClick={() => !unavailable && set({ tools: on ? draft.tools.filter((x) => x !== tool.name) : [...draft.tools, tool.name] })}>
                      <Check on={on} onChange={() => {}} label="" />
                      <div className="grow">
                        <b>{t(tool.label)}</b> <span className="mono muted">{tool.name}</span>
                        {tool.desc && <div className="hint">{t(tool.desc)}</div>}
                        {tool.claudeOnly && <div className="hint">{unavailable ? t('只在 Claude 模型上提供，选的端点模型没有') : t('只在 Claude 模型上提供')}</div>}
                        {tool.name === 'AskUserQuestion' && !on && <div className="hint" style={{ color: 'var(--warn-ink)' }}>{t('关掉后，Claude 遇到需要你选择的地方会自己决定，不再停下来问。')}</div>}
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

            <Section title={t('输出风格')}>
              <Select value={draft.outputStyle ?? 'default'} onChange={(v) => set({ outputStyle: v })} className="w-240"
                options={(styles.some((s) => s.name === (draft.outputStyle ?? 'default')) ? styles : [...styles, { name: draft.outputStyle ?? '', description: t('（找不到这个风格的文件）'), source: 'global' as const }])
                  .map((s) => ({ value: s.name, label: s.name === 'default' ? t('默认') : s.name, desc: s.source === 'builtin' ? t(s.description) : `${s.description}${s.description ? ' · ' : ''}${s.source === 'global' ? '~/.claude/output-styles' : '.claude/output-styles'}` }))} />
              <div className="hint" style={{ marginTop: 6 }}>{t('改变 Claude 回答的写法：解释型会边做边讲取舍，学习型会留一些代码让你自己写。自定义风格放在 output-styles 文件夹里。')}</div>
            </Section>

            <Section title={t('计划模式补充说明')}>
              <textarea className="textarea" style={{ width: '100%' }} rows={3} value={draft.planInstructions ?? ''} onChange={(e) => set({ planInstructions: e.target.value })}
                placeholder={t('例如：计划里写清楚要改的文件、测试方案和回滚方式')} />
              <div className="hint" style={{ marginTop: 4 }}>{t('进入规划模式时代替默认的规划要求交给 Claude；留空用 Claude Code 默认的。')}</div>
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
      {dirty && <SaveBar onDiscard={() => setDraft(saved)} onSave={() => { app.saveProfile(draft); app.toast(t('已保存「默认」'), 'good'); setJustSaved(true); }} />}
      {!dirty && justSaved && running > 0 && (
        <div className="modal-foot" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', borderRadius: '0 0 10px 10px' }}>
          <div className="left hint"><Icon name="info" size={14} /> {t('改动对新会话生效。{n} 个运行中的会话可以重新启动 Claude Code，用上新的工具和设置（对话会接着进行）；系统提示词和回复语言只对新会话生效。', { n: running })}</div>
          <Button onClick={() => setJustSaved(false)}>{t('以后再说')}</Button>
          <Button variant="primary" onClick={() => api.applyProfileToRunning().then((n) => { setJustSaved(false); app.toast(t('{n} 个会话会在空闲时重新启动', { n }), 'good'); })}>{t('应用到运行中的会话')}</Button>
        </div>
      )}
    </div>
  );
}

/** Tools the reviewer may also get; Read, Glob, Grep and read-only commands are always on. */
const REVIEW_TOOLS = [
  { name: 'WebFetch', label: '抓取网页', desc: '查看库的文档、规范' },
  { name: 'WebSearch', label: '网页搜索', desc: '只在 Claude 模型上提供', claudeOnly: true },
  { name: 'Skill', label: '技能', desc: '使用工作区里装的技能，例如团队的审查清单' },
  { name: 'Agent', label: '子代理', desc: '把大范围的搜索交给 Explore 子代理；更费 token' },
];

const BUILT_IN_RULES = [
  '只读：能读文件、搜索、运行只读命令（git diff / log / show / status、rg、ls 等）。审核者在「不询问」模式下运行，哪些命令算只读由 Claude Code 判断，其他的直接拒绝，不会问你。',
  '看不到作者会话的对话，只拿到改动范围、改动目标，以及之前各轮的意见和作者的答复。',
  '前 3 轮全局审核：看整个改动，追查调用方、数据流、配置、测试和文档受到的影响；之后的轮次只看上一轮之后的修改，确认意见是否解决。',
  '只报正确性问题，不管风格；每条意见标出严重程度（阻断 / 重要 / 次要）、文件和行号。没有阻断和重要问题就算通过。',
  '结论以固定格式的结构化结果交给 Code Agent。',
];

function ReviewEditor({ onDirty }: { onDirty: (d: boolean) => void }) {
  const t = useT();
  const models = useApp((s) => s.models);
  const saved = useApp((s) => s.reviewProfile);
  const [draft, setDraft] = useState<ReviewProfile>(saved);
  const [showRules, setShowRules] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const set = (p: Partial<ReviewProfile>) => setDraft({ ...draft, ...p });
  const model = models.find((m) => m.id === draft.model);
  const onClaude = !model?.endpoint;

  return (
    <div className="panel">
      <div className="panel-head"><h3>{t('评审')}</h3><span className="hint">{t('代码审核时的审核者使用')}</span></div>
      <div className="panel-body">
        <Section title={t('模型')}>
          <div className="form-grid">
            <Field label={t('模型')}>
              <Select value={draft.model} onChange={(v) => set({ model: v, effort: effortFor(models, v, draft.effort) })}
                options={modelOptions(models, t)} />
            </Field>
            <Field label={t('思考强度')} hint={takesEffort(model) ? t('审核要找出容易漏掉的情况，建议「高」') : t('这个端点模型没有开启「思考与思考强度」')}>
              <Select<Effort> value={draft.effort} onChange={(v) => set({ effort: v })} disabled={!takesEffort(model)} options={effortOptions(model, draft.effort, t)} />
            </Field>
          </div>
        </Section>

        <Section title={t('审核者可以使用的工具')}>
          <div className="tool-grid">
            {[{ name: 'Read', label: '读取文件' }, { name: 'Glob', label: '按名称找文件' }, { name: 'Grep', label: '搜索文件内容' }, { name: 'Bash', label: '只读命令' }].map((tool) => (
              <div key={tool.name} className="tool-item on locked">
                <Check on onChange={() => {}} label="" />
                <div className="grow"><b>{t(tool.label)}</b> <span className="mono muted">{tool.name}</span><div className="hint">{tool.name === 'Bash' ? t('只放行只读命令，由 Code Agent 强制') : t('始终开启')}</div></div>
              </div>
            ))}
            {REVIEW_TOOLS.map((tool) => {
              const unavailable = !!tool.claudeOnly && !onClaude;
              const on = draft.tools.includes(tool.name) && !unavailable;
              return (
                <div key={tool.name} className={cx('tool-item', on && 'on', unavailable && 'disabled')}
                  onClick={() => !unavailable && set({ tools: on ? draft.tools.filter((x) => x !== tool.name) : [...draft.tools, tool.name] })}>
                  <Check on={on} onChange={() => {}} label="" />
                  <div className="grow"><b>{t(tool.label)}</b> <span className="mono muted">{tool.name}</span><div className="hint">{unavailable ? t('只在 Claude 模型上提供，选的端点模型没有') : t(tool.desc)}</div></div>
                </div>
              );
            })}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>{t('修改文件、向你提问、任务清单这些工具不提供：审核者只读，也不打断你。')}</div>
        </Section>

        <Section title={t('项目说明')}>
          <Toggle on={draft.claudeMd} onChange={(v) => set({ claudeMd: v })} label={t('读取项目的 CLAUDE.md')} hint={t('项目的约定和命令通常写在这里，审核时有用。只读 CLAUDE.md，不读任何设置文件，所以工作区的权限规则也不能让审核者改文件。')} />
        </Section>

        <Section title={t('审核要求')} right={<button className="link-btn" onClick={() => setShowRules(!showRules)}>{showRules ? t('收起内置规则') : t('查看内置规则')}</button>}>
          {showRules && <ul className="plain-list" style={{ marginBottom: 10 }}>{BUILT_IN_RULES.map((r, i) => <li key={i}>{t(r)}</li>)}</ul>}
          <textarea className="textarea" style={{ width: '100%' }} rows={3} value={draft.extraPrompt} onChange={(e) => set({ extraPrompt: e.target.value })}
            placeholder={t('追加在内置规则之后，例如：特别注意 SQL 注入和金额计算；接口改动要检查 openapi.yaml 是否同步')} />
          <div className="hint" style={{ marginTop: 4 }}>{t('内置规则保证审核循环能正常工作，不能替换，只能追加。')}</div>
        </Section>

        <div className="hint" style={{ lineHeight: 1.7 }}>
          {t('审核者是单独启动的 Claude Code 进程，不沿用会话的权限模式、系统提示词和「功能」选项：它只读、不向你提问，审完就退出，不占运行中会话的名额。')}
        </div>
      </div>
      {dirty && <SaveBar onDiscard={() => setDraft(saved)} onSave={() => { useApp.getState().set({ reviewProfile: draft }); useApp.getState().toast(t('已保存「评审」'), 'good'); }} />}
    </div>
  );
}
