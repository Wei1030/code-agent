/**
 * Code Agent server: serves the web app (Vite middleware in --dev, apps/web/dist otherwise) and the
 * WebSocket the UI talks over, on 127.0.0.1 only.
 */
import http from 'node:http';
import path from 'node:path';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { DEV, HOME, HOST, PORT, VERSION } from './paths';
import { allowedOrigin, attach, onHello, register, caller } from './hub';
import { app, clientSet } from './state';
import { flush } from './store';
import { allSummaries } from './sessions/registry';
import './sessions/ops';
import { sessionsOnBoot } from './sessions/ops';
import { scanExternal } from './sessions/history';
import { onWorkspacesChanged, refreshBranches } from './workspaces';
import { checkLogin } from './provider';
import { reloadRules } from './claude/permissions';
import { reloadFileHooks } from './ext/hooks';
import { probeMcp, reloadMcp } from './ext/mcp';
import { recheckPlugins, reloadSkills } from './ext/skills';
import { startScheduler } from './ext/jobs';
import './peer';
import './review';
import './board';
import { closeProcess, liveIds } from './sessions/live';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, '../../web');

register({
  setState: (patch) => clientSet(patch, caller),
});

onHello(() => ({ t: 'hello', slices: app, sessions: allSummaries(), version: VERSION }));

function reloadDisk() {
  reloadRules();
  reloadFileHooks();
  reloadMcp();
  reloadSkills();
}
onWorkspacesChanged(() => {
  reloadDisk();
  void scanExternal();
  void probeMcp();
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2',
};

async function main() {
  sessionsOnBoot();
  recheckPlugins();
  reloadDisk();
  const server = http.createServer();
  let vite: { middlewares: (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void } | null = null;
  if (DEV) {
    const { createServer } = await import('vite');
    vite = await createServer({ root: WEB, configFile: path.join(WEB, 'vite.config.ts'), server: { middlewareMode: true, hmr: { server } }, appType: 'spa' });
  }
  const dist = path.join(WEB, 'dist');
  server.on('request', (req, res) => {
    if (vite) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
      return;
    }
    const url = new URL(req.url ?? '/', 'http://x');
    let file = path.join(dist, decodeURIComponent(url.pathname));
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(dist, 'index.html');
    if (!existsSync(file)) {
      res.statusCode = 500;
      res.end('apps/web/dist is missing: run npm run build first.');
      return;
    }
    res.setHeader('content-type', MIME[path.extname(file)] ?? 'application/octet-stream');
    createReadStream(file).pipe(res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 * 1024 });
  attach(wss);
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') return;
    if (!allowedOrigin(req, PORT)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  server.listen(PORT, HOST, () => {
    console.log(`Code Agent ${VERSION} · http://${HOST}:${PORT} · data ${HOME}${DEV ? ' · dev' : ''}`);
  });

  void checkLogin().then(() => probeMcp());
  void scanExternal();
  startScheduler();
  setInterval(() => void refreshBranches(), 30_000);
  setInterval(reloadDisk, 15_000);

  const shutdown = async () => {
    await Promise.all(liveIds().map((id) => closeProcess(id)));
    flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
