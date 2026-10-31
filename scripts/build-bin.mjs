// Builds bin/: Code Agent that runs on Node alone, without npm install, on this platform.
//   npm run build:bin      then      node bin/code-agent.mjs
// bin/code-agent.mjs  checks the Node version and starts the server
// bin/server.mjs      the server with every package it loads (the Claude Agent SDK too), one file
// bin/web/            the built web app
// bin/node_modules/   the Claude Code binary for this platform, where the SDK looks for it
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = path.join(ROOT, 'apps/server');
const OUT = path.join(ROOT, 'bin');
/** The Node version Code Agent is tested on: node:sqlite, among others. */
const NODE_MAJOR = 24;

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

console.log('· web app');
execSync('npm run build -w @code-agent/web', { cwd: ROOT, stdio: 'inherit' });
cpSync(path.join(ROOT, 'apps/web/dist'), path.join(OUT, 'web'), { recursive: true });

console.log('· server');
await build({
  entryPoints: [path.join(SERVER, 'src/start.ts')],
  outfile: path.join(OUT, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: `node${NODE_MAJOR}`,
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
  // vite runs only with --dev, from a checkout; ws does without its optional native helpers.
  external: ['vite', 'bufferutil', 'utf-8-validate'],
  // CommonJS packages inside an ES module still require Node's own modules.
  banner: { js: "import { createRequire as __bundleRequire } from 'node:module'; const require = __bundleRequire(import.meta.url);" },
});

console.log('· Claude Code');
// The SDK looks for the binary package next to where it runs: bin/server.mjs.
const binary = `@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`;
cpSync(path.dirname(createRequire(path.join(SERVER, 'package.json')).resolve(`${binary}/package.json`)), path.join(OUT, 'node_modules', binary), { recursive: true, dereference: true });

writeFileSync(path.join(OUT, 'code-agent.mjs'), `// Code Agent, built by npm run build:bin. Start it with: node code-agent.mjs
// It needs Node.js ${NODE_MAJOR} or newer, nothing else.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (Number(process.versions.node.split('.')[0]) < ${NODE_MAJOR}) {
  console.error(\`Code Agent 需要 Node.js ${NODE_MAJOR} 或更新的版本，现在是 \${process.versions.node}。\`);
  process.exit(1);
}
process.setSourceMapsEnabled(true);
process.env.CODE_AGENT_WEB_DIST ??= path.join(path.dirname(fileURLToPath(import.meta.url)), 'web');
await import('./server.mjs');
`);

const size = (p) => (statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : statSync(p).size);
console.log(`bin/ ready: ${Math.round(size(OUT) / 1024 / 1024)} MB (server.mjs ${Math.round(size(path.join(OUT, 'server.mjs')) / 1024)} KB). Start it with: node bin/code-agent.mjs`);
