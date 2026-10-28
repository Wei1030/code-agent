/** How sessions in a workspace see, message and create each other. */
import type { PeerSettings } from '../../api/types';
import { Link } from 'react-router-dom';
import { Radio } from '../../components/ui';
import { useApp } from '../../store/app';
import { cx } from '../../lib/util';
import { useT } from '../../lib/i18n';
import { Section } from './SettingsLayout';

export function Collaboration() {
  const t = useT();
  const peer = useApp((s) => s.peer);
  const set = (p: Partial<PeerSettings>) => useApp.getState().set({ peer: { ...useApp.getState().peer, ...p } });
  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Math.round(Number(v) || min)));

  const inbound: Array<{ value: PeerSettings['inbound']; label: string; d: string }> = [
    { value: 'parity', label: t('权限模式同类时直接送达（推荐）'), d: t('双方都跳过权限检查，或都没有跳过时直接送达；否则先等你放行。这样宽松的会话没法借一条消息，让需要审批的会话替它做事。') },
    { value: 'accept', label: t('总是直接送达'), d: '' },
    { value: 'hold', label: t('总是先等我放行'), d: t('每条会话消息都出现在右上角「等你处理」里。') },
  ];

  return (
    <>
      <h1>{t('会话协作')}</h1>
      <p className="lead">{t('同一工作区里的会话可以互相查看对话和状态、发消息，也可以新建会话来分担工作。你也可以在输入框里用 @ 引用会话。这里设置它们之间的规则。')}</p>

      <Section title={t('收到其他会话的消息')}>
        <div className="lang-options">
          {inbound.map((o) => (
            <div key={o.value} className={cx('option-card', peer.inbound === o.value && 'on')} onClick={() => set({ inbound: o.value })}>
              <Radio on={peer.inbound === o.value} onChange={() => set({ inbound: o.value })} />
              <div className="grow"><b>{o.label}</b>{o.d && <div className="d">{o.d}</div>}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('防止来回转发')}>
        <div className="form-row">
          <span>{t('连续转发')}</span>
          <input className="input sm" type="number" min={1} max={50} style={{ width: 72 }} value={peer.maxHops} onChange={(e) => set({ maxHops: num(e.target.value, 1, 50) })} />
          <span>{t('次后暂停')}</span>
        </div>
        <div className="hint">{t('一串会话消息里，你没有插话时最多转发几次。超过后的消息先等你放行；你放行或发了消息后重新计数。')}</div>
      </Section>

      <Section title={t('Claude 怎样使用这些功能')}>
        <ul className="plain-list">
          <li>{t('每个会话都有五个工具：列出会话、读取会话、查看会话状态、发消息给会话、新建会话。只能用于同一工作区。')}</li>
          <li>{t('新建的会话沿用发起会话的模型、思考强度和权限模式，不会比发起的会话更宽松。它和你手动建的会话一样，你随时可以进去直接聊。')}</li>
          <li>{t('发消息和新建会话默认要回执：对方处理完后，结果会作为一条消息回到发起的会话。')}</li>
          <li>{t('内置的子代理仍然可用：快速搜索之类的短任务交给子代理；需要你参与或之后继续讨论的工作，Claude 会新建会话。')}</li>
          <li>{t('要并行改代码时，Claude 可以让新会话在独立的 worktree 里工作，避免互相覆盖。同一目录下两个会话改到同一个文件时会提醒。')}</li>
          <li>{t('Claude 新建的会话和你新建的一样，受同时运行会话数的限制，在')} <Link to="/settings/general">{t('常规')}</Link> {t('里设置。')}</li>
        </ul>
      </Section>
    </>
  );
}
