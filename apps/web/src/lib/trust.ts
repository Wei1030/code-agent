/** Trusting a workspace's folder for Claude Code, asked first as its terminal does on first use. */
import type { Workspace } from '../api/types';
import { api } from '../api';
import { useApp } from '../store/app';
import { t } from './i18n';

export function askTrust(ws: Workspace) {
  useApp.getState().ask({
    title: t('信任这个文件夹吗？'),
    body: [
      t('Claude Code 只在信任过的文件夹里应用仓库里提交的设置，例如 .claude/settings.json 里允许的命令。'),
      '',
      t('信任和在终端里第一次运行 claude 时选「信任」一样，记在 Claude Code 的配置文件 ~/.claude.json 里。只信任你了解来源的代码。'),
      '',
      ws.path,
    ].join('\n'),
    confirmLabel: t('信任'),
    onConfirm: () => api.trustWorkspace(ws.id).then(() => useApp.getState().toast(t('已信任 {name}', { name: ws.name }), 'good')),
  });
}
