// Which requirements the tests cover: every FR / NFR id of docs/requirements.zh-CN.md, minus the
// ones the prototype lists as left out, against the ids the tests name (a file's header comment
// counts for all its tests, a test's title for that test). Prints the ones no test names; exits 1
// when one is neither named nor listed below with its reason.
//   npm run test:coverage            (--all lists every requirement with its tests)
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p: string) => readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** Requirements no automated test here can show, and why. */
const ELSEWHERE: Record<string, string> = {
  'FR-AGT-05': 'no limits of its own: only Claude Code\'s environment variables, which reach it (FR-CFG-04)',
  'FR-MISC-04': 'worker_shutting_down comes from remote workers; a local session never gets it',
  'FR-I18N-10': 'checked by this script: both requirement documents list the same ids',
  'NFR-01': 'latency is not measured',
  'NFR-06': 'the version is shown (FR-SES-17); nothing is hidden by capability',
  'NFR-09': 'brand rules are checked by eye',
};

/** `FR-OUT-02/03/04`, `FR-SKILL-01..04`, `FR-TOOL-01..05/15`, `NFR-03` → the single ids. */
function ids(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(FR-[A-Z0-9]+|NFR)-(\d{2})((?:(?:\.\.|\/)\d{2})*)/g)) {
    let prev = Number(m[2]);
    out.push(`${m[1]}-${m[2]}`);
    for (const r of m[3].matchAll(/(\.\.|\/)(\d{2})/g)) {
      const n = Number(r[2]);
      for (let i = r[1] === '..' ? prev + 1 : n; i <= n; i++) out.push(`${m[1]}-${String(i).padStart(2, '0')}`);
      prev = n;
    }
  }
  return out;
}

const rows = (doc: string) => [...read(doc).matchAll(/^\| ((?:FR-[A-Z0-9]+|NFR)-\d{2}) \| (.+?) \|.*?(P\d)? \|$/gm)]
  .map((m) => ({ id: m[1], text: m[2].replace(/`/g, '').slice(0, 60), prio: m[3] ?? '' }));
const reqs = rows('docs/requirements.zh-CN.md');
const english = rows('docs/requirements.md').map((r) => r.id).join(' ');
const bilingual = reqs.map((r) => r.id).join(' ') === english;

const sandbox = { window: {} as { LEFT_OUT?: Array<{ name: string; frs: string[] }> } };
vm.runInNewContext(read('docs/prototype/notes.js'), sandbox);
const cut = new Map<string, string>();
for (const l of sandbox.window.LEFT_OUT ?? []) for (const f of l.frs) cut.set(f, l.name);

const files = [
  ...['test/server', 'test/ui', 'test/contract', 'test/real'].flatMap((d) => readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.test.ts')).map((f) => `${d}/${f}`)),
  ...['packages/shared/src', 'apps/server/src', 'apps/web/src/lib'].flatMap((d) => readdirSync(path.join(ROOT, d)).filter((f) => f.endsWith('.test.ts')).map((f) => `${d}/${f}`)),
];
const cases = new Map<string, string[]>();
const cite = (id: string, where: string) => cases.set(id, [...(cases.get(id) ?? []), where]);
for (const f of files) {
  const src = read(f);
  const header = /^((?:\/\/.*\n)+)/.exec(src)?.[1] ?? '';
  for (const id of new Set(ids(header))) cite(id, f);
  for (const t of src.matchAll(/^\s*test\((['"`])((?:\\.|(?!\1).)*)\1/gm)) for (const id of new Set(ids(t[2]))) cite(id, `${f}: ${t[2].replace(/\\(.)/g, '$1')}`);
}

if (process.argv.includes('--all')) {
  for (const r of reqs) {
    const c = cases.get(r.id);
    const why = c ? c.map((x) => `    ${x}`).join('\n') : cut.has(r.id) ? `    (left out: ${cut.get(r.id)})` : ELSEWHERE[r.id] ? `    (${ELSEWHERE[r.id]})` : '    -- no test';
    console.log(`${r.id} ${r.prio} ${r.text}\n${why}`);
  }
}
const named = reqs.filter((r) => cases.has(r.id));
const elsewhere = reqs.filter((r) => !cases.has(r.id) && !cut.has(r.id) && ELSEWHERE[r.id]);
const open = reqs.filter((r) => !cases.has(r.id) && !cut.has(r.id) && !ELSEWHERE[r.id]);
console.log(`\n${reqs.length} requirements: ${named.length} named by tests, ${reqs.filter((r) => !cases.has(r.id) && cut.has(r.id)).length} left out, ${elsewhere.length} not testable here, ${open.length} without a test.`);
for (const r of elsewhere) console.log(`  ${r.id} ${r.text}: ${ELSEWHERE[r.id]}`);
if (open.length) console.log(`\nwithout a test:\n${open.map((r) => `  ${r.id} ${r.prio} ${r.text}`).join('\n')}`);
const unknown = [...cases.keys()].filter((id) => !reqs.some((r) => r.id === id));
if (unknown.length) console.log(`\nnamed by tests but not in the requirements: ${unknown.join(', ')}`);
if (!bilingual) console.log('\nthe English and the Chinese requirements list different ids');
process.exitCode = open.length || unknown.length || !bilingual ? 1 : 0;
