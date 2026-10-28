/** Developer panel for the mock: trigger scenarios and abnormal states on demand. */
import { useMatch, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Button } from '../components/ui';
import { useApp } from '../store/app';
import { api } from '../api';
import type { BannerKind } from '../api/types';
import type { Scenario } from '../mock/server';

export function MockConsole() {
  const open = useApp((s) => s.mockConsoleOpen);
  const sid = useMatch('/s/:id')?.params.id;
  const nav = useNavigate();
  const loggedIn = useApp((s) => s.provider.loggedIn);
  const hasWs = useApp((s) => s.workspaces.length > 0);
  if (!open) return null;

  const ensureSession = (): string => {
    if (sid) return sid;
    const id = api.createDraft(useApp.getState().currentWorkspaceId);
    nav(`/s/${id}`);
    return id;
  };
  const scenario = (s: Scenario) => api.runScenario(ensureSession(), s);
  const banner = (b: BannerKind) => {
    const id = ensureSession();
    const sum = useApp.getState().sessions.find((x) => x.id === id);
    if (sum?.draft) useApp.getState().patchSession(id, { draft: false, live: true, title: '异常状态演示' });
    api.injectBanner(id, b);
  };

  const scenarios: Array<[Scenario, string]> = [
    ['fix', '修复 bug（编辑 + 命令审批）'], ['question', '澄清提问（AskUserQuestion）'], ['plan', '规划模式与计划审阅'],
    ['subagents', '子代理与后台任务'], ['highRisk', '高风险审批（默认拒绝）'], ['outside', '访问工作区外的目录'], ['elicitForm', 'MCP 征询（表单）'], ['elicitUrl', 'MCP 征询（登录链接）'],
    ['spawn', '拆分给新会话（create_session）'], ['askPeer', '查看并联系其他会话'],
  ];
  const banners: Array<[BannerKind, string]> = [
    ['crash', '会话崩溃'], ['apiRetry', 'API 过载重试'], ['rateLimit', '接近速率限制'],
    ['modelFallback', '模型拒答回退'], ['startupFailure', '启动失败'], ['workerShutdown', '进程退出'],
    ['denials', '本轮有调用被拒绝'], ['notLoggedIn', '未登录 Claude'],
  ];
  return (
    <div className="mock-console" role="dialog" aria-label="模拟控制台">
      <h3><Icon name="flask" size={16} />模拟控制台<span className="grow" /><Button size="sm" variant="ghost" icon="x" title="关闭" onClick={() => useApp.getState().set({ mockConsoleOpen: false })} /></h3>
      <div className="sub">只在 mock 版本中存在，用来触发各种场景和状态。{sid ? '作用于当前会话。' : '不在会话页时会新建一个会话。'}</div>
      <h4>场景（发送一条示例消息并播放）</h4>
      <div className="grid">
        {scenarios.map(([s, label]) => <Button key={s} onClick={() => scenario(s)}>{label}</Button>)}
      </div>
      <div className="hint" style={{ marginTop: 6 }}>也可以直接在输入框里发消息：含「计划」「提问」「子代理」「删除」「修复」「拆成」「其他会话」等词会触发对应场景；用 @ 引用会话也会先读取它。</div>
      <h4>会话状态与提示（P24）</h4>
      <div className="grid">
        {banners.map(([b, label]) => <Button key={b} onClick={() => banner(b)}>{label}</Button>)}
        <Button onClick={() => { const id = ensureSession(); void api.compact(id, ''); }}>自动压缩</Button>
        <Button onClick={() => api.connectionDrop()}>断线后重连</Button>
      </div>
      <h4>会话互通</h4>
      <div className="grid">
        <Button onClick={() => api.mockPeerMessage(ensureSession())}>其他会话发来消息</Button>
        <Button onClick={() => api.mockHeld(ensureSession(), 'mode')}>待放行：权限模式不同</Button>
        <Button onClick={() => api.mockHeld(ensureSession(), 'hops')}>待放行：连续转发超限</Button>
      </div>
      <h4>作业</h4>
      <div className="grid">
        <Button onClick={() => api.fireScheduledJob()}>定时作业到点</Button>
      </div>
      <h4>数据</h4>
      <div className="grid">
        <Button onClick={() => { api.resetSampleData(hasWs); nav('/'); }}>{hasWs ? '清空工作区（看空状态）' : '恢复示例工作区'}</Button>
        <Button onClick={() => useApp.getState().setProvider({ loggedIn: !loggedIn })}>{loggedIn ? '模拟：Claude 未登录' : '模拟：已登录'}</Button>
      </div>
    </div>
  );
}
