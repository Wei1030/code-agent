/** Running-session limit and notifications. */
import { useState } from 'react';
import { api } from '../../api';
import { Button, Status, Toggle } from '../../components/ui';
import { useApp } from '../../store/app';
import { notificationPermission, requestNotificationPermission, testNotification } from '../../lib/notify';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

export function General() {
  const t = useT();
  const prefs = useApp((s) => s.prefs);
  const setPrefs = useApp((s) => s.setPrefs);
  const maxRunning = useApp((s) => s.maxRunning);
  const sessions = useApp((s) => s.sessions);
  const running = sessions.filter((s) => s.live && !s.draft).length;
  const waiting = sessions.filter((s) => s.waiting).length;
  const [perm, setPerm] = useState(notificationPermission());

  const setMax = (v: string) => {
    useApp.getState().set({ maxRunning: Math.max(1, Math.min(20, Math.round(Number(v) || 1))) });
    api.pumpSlots();
  };
  const enableSystem = async (on: boolean) => {
    setPrefs({ browserNotifications: on });
    if (on) setPerm(await requestNotificationPermission());
  };

  return (
    <>
      <h1>{t('常规')}</h1>
      <p className="lead">{t('同时运行多少个会话，以及什么时候提醒你。')}</p>

      <Section title={t('同时运行的会话')}>
        <div className="form-row">
          <span>{t('所有工作区合计最多')}</span>
          <input className="input sm" type="number" min={1} max={20} style={{ width: 72 }} value={maxRunning} onChange={(e) => setMax(e.target.value)} />
          <span>{t('个')}</span>
          <span className="muted">{t('现在运行中 {n} 个', { n: running })}{waiting > 0 ? t('，排队 {n} 个', { n: waiting }) : ''}</span>
        </div>
        <div className="hint" style={{ lineHeight: 1.7 }}>
          {t('每个运行中的会话都是一个独立的 Claude Code 进程。新建、恢复、分叉会话，Claude 新建会话，或作业开始运行时，如果已经到了上限，会自动保存最久没有活动的一个空闲会话来腾出位置。空闲指没有在回答、没有等你处理、也没有后台任务。如果都不空闲，新会话就排队，等有会话空闲后自动开始。')}
        </div>
      </Section>

      <Section title={t('提醒我')}>
        <div className="col">
          <Toggle on={prefs.notifyRequests} onChange={(v) => setPrefs({ notifyRequests: v })} label={t('有事等我处理时')} hint={t('审批、提问、计划审阅、待放行的会话消息')} />
          <Toggle on={prefs.notifyTurnDone} onChange={(v) => setPrefs({ notifyTurnDone: v })} label={t('一轮对话完成时')} />
          <Toggle on={prefs.notifyBackground} onChange={(v) => setPrefs({ notifyBackground: v })} label={t('后台任务或作业完成时')} />
        </div>
        <div className="hint" style={{ marginTop: 8, lineHeight: 1.7 }}>
          {t('提醒在左下角弹出，点一下就能跳到对应的会话；你正在看的那个会话不弹。等你处理的数量还会显示在右上角和浏览器标签的标题上。')}
        </div>
      </Section>

      <Section title={t('系统通知')}>
        <Toggle on={prefs.browserNotifications} onChange={(v) => void enableSystem(v)} label={t('Code Agent 的标签页不在前台时，同时发送系统通知')} />
        <div className="row" style={{ marginTop: 10, gap: 10 }}>
          {perm === 'granted' && <Status tone="good">{t('浏览器已允许通知')}</Status>}
          {perm === 'default' && <Status tone="warn">{t('还没有授权')}</Status>}
          {perm === 'denied' && <Status tone="crit">{t('浏览器阻止了通知：请在浏览器的网站设置里允许')}</Status>}
          {perm === 'unsupported' && <Status tone="crit">{t('这个浏览器不支持系统通知')}</Status>}
          {perm === 'default' && <Button size="sm" onClick={async () => setPerm(await requestNotificationPermission())}>{t('授权')}</Button>}
          {perm === 'granted' && <Button size="sm" onClick={() => { if (!testNotification()) useApp.getState().toast(t('没有发出：浏览器未授权'), 'warn'); }}>{t('发送测试通知')}</Button>}
        </div>
      </Section>
    </>
  );
}
