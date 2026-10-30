// Loaded into every node process of a test world through NODE_OPTIONS; does something only when the
// process is the fake `gh` (a copy of node.exe named gh.exe): prints the issues in $FAKE_GH_DATA,
// like `gh issue list --json …` does, and exits.
import { readFileSync } from 'node:fs';
import path from 'node:path';

if (path.basename(process.execPath).toLowerCase().replace(/\.exe$/, '') === 'gh') {
  const args = process.argv.slice(1).join(' ');
  if (!/issue list/.test(args)) {
    process.stderr.write(`fake gh: unsupported command: ${args}\n`);
    process.exit(1);
  }
  const data = readFileSync(process.env.FAKE_GH_DATA, 'utf8');
  process.stdout.write(data);
  process.exit(0);
}
