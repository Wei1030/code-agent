/** P25 — UI language, Claude's reply language and number format. */
import { Icon } from '../../components/Icon';
import { Radio, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { cx } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

export function Language() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);

  const ui = [
    { value: 'auto' as const, label: t('跟随浏览器'), d: t('目前解析为简体中文') },
    { value: 'zh-CN' as const, label: '简体中文', d: '' },
    { value: 'en' as const, label: 'English', d: t('交互定稿后补齐翻译'), disabled: true },
  ];
  const reply = [
    { value: 'ui' as const, label: t('跟随界面语言'), d: t('通过 Claude Code 的 language 设置告诉 Claude') },
    { value: 'conversation' as const, label: t('跟随对话'), d: t('用你提问时使用的语言回答') },
    { value: 'custom' as const, label: t('指定语言'), d: '' },
  ];

  return (
    <>
      <h1>{t('语言与地区')}</h1>
      <p className="lead">{t('界面语言只影响 Code Agent 本身；Claude 的回复语言单独设置。配置方案可以覆盖回复语言。')}</p>

      <Section title={t('界面语言')}>
        <div className="lang-options">
          {ui.map((o) => (
            <div key={o.value} className={cx('option-card', prefs.uiLanguage === o.value && 'on', o.disabled && 'disabled')}
              onClick={() => !o.disabled && setPrefs({ uiLanguage: o.value })}>
              <Radio on={prefs.uiLanguage === o.value} onChange={() => !o.disabled && setPrefs({ uiLanguage: o.value })} />
              <div className="grow"><b>{o.label}</b>{o.d && <div className="d">{o.d}</div>}</div>
              {o.disabled && <Icon name="lock" size={14} className="muted" />}
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('Claude 的回复语言')}>
        <div className="lang-options">
          {reply.map((o) => (
            <div key={o.value} className={cx('option-card', prefs.responseLanguage === o.value && 'on')} onClick={() => setPrefs({ responseLanguage: o.value })}>
              <Radio on={prefs.responseLanguage === o.value} onChange={() => setPrefs({ responseLanguage: o.value })} />
              <div className="grow">
                <b>{o.label}</b>{o.d && <div className="d">{o.d}</div>}
                {o.value === 'custom' && prefs.responseLanguage === 'custom' && (
                  <input className="input" style={{ marginTop: 6, maxWidth: 280 }} placeholder={t('例如：日本語、Deutsch')} value={prefs.responseLanguageCustom}
                    onClick={(e) => e.stopPropagation()} onChange={(e) => setPrefs({ responseLanguageCustom: e.target.value })} />
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('数字格式')}>
        <div className="lang-options">
          <div className={cx('option-card', prefs.numberStyle === 'intl' && 'on')} onClick={() => setPrefs({ numberStyle: 'intl' })}>
            <Radio on={prefs.numberStyle === 'intl'} onChange={() => setPrefs({ numberStyle: 'intl' })} />
            <div><b>1.2k · 18.4M</b><div className="d">{t('国际写法')}</div></div>
          </div>
          <div className={cx('option-card', prefs.numberStyle === 'cn' && 'on')} onClick={() => setPrefs({ numberStyle: 'cn' })}>
            <Radio on={prefs.numberStyle === 'cn'} onChange={() => setPrefs({ numberStyle: 'cn' })} />
            <div><b>1200 · 1840万</b><div className="d">{t('中文写法')}</div></div>
          </div>
        </div>
      </Section>

      <Section title={t('其他')}>
        <div className="col">
          <Toggle on={prefs.showRawSdkText} onChange={(v) => setPrefs({ showRawSdkText: v })} label={t('审批面板中默认展开 SDK 原文')} hint={t('SDK 给出的原因是英文')} />
        </div>
      </Section>
    </>
  );
}
