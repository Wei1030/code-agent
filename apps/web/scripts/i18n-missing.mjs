// Lists the Chinese UI strings that have no English entry in src/lib/i18n.en.ts.
//   npm run i18n:missing -w @code-agent/web
// Every Chinese string literal in the web app and the shared catalog counts (tables of labels are
// passed through t() later), so a few that are never shown may be listed too.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, '..');
const roots = [path.join(web, 'src'), path.resolve(web, '../../packages/shared/src/catalog.ts')];
const files = [];
const walk = (p) => {
  if (statSync(p).isDirectory()) for (const n of readdirSync(p)) walk(path.join(p, n));
  else if (/\.tsx?$/.test(p) && !p.endsWith('i18n.en.ts')) files.push(p);
};
roots.forEach(walk);

const CJK = /[㐀-鿿＀-￯　-〿]/;
const strings = new Set();
for (const f of files) {
  const src = ts.createSourceFile(f, readFileSync(f, 'utf8'), ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const visit = (n) => {
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && CJK.test(n.text)) strings.add(n.text);
    if (ts.isJsxText(n) && CJK.test(n.text) && n.text.trim()) strings.add(n.text.trim());
    ts.forEachChild(n, visit);
  };
  visit(src);
}

const have = new Set();
for (const line of readFileSync(path.join(web, 'src', 'lib', 'i18n.en.ts'), 'utf8').split('\n')) {
  const m = /^ {2}("(?:[^"\\]|\\.)*"): /.exec(line);
  if (m) have.add(JSON.parse(m[1]));
}
const missing = [...strings].filter((s) => !have.has(s)).sort();
console.log(missing.length ? JSON.stringify(missing, null, 1) : 'Every UI string has an English entry.');
process.exitCode = missing.length ? 1 : 0;
