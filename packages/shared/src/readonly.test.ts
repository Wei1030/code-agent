import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readOnlyCommand } from './readonly';

test('commands that change things or run programs are refused', () => {
  for (const c of [
    'git branch -D main', 'git remote remove origin', 'ls & rm -rf build', 'ls\nrm -rf build', `awk 'BEGIN{system("rm -rf build")}'`,
    'sort -o package.json /dev/null', 'find . -execdir rm {} +', 'git branch new', 'git tag v1', 'rg --pre sh x', 'git diff --output=x',
    'FOO=1 git diff', 'git -c core.pager=sh log', 'echo x > f', 'cat $(rm x)', 'Remove-Item x', 'git config user.name x', 'sed -i s/a/b/ f',
    'git log; rm x', 'git grep -O foo', 'find . -delete', 'tree -o out.txt',
  ]) assert.equal(readOnlyCommand(c), false, c);
});

test('reading the repository is allowed', () => {
  for (const c of [
    'git diff abc def', 'git log --oneline -5', 'git show HEAD:src/a.ts', 'git diff --stat a b', 'ls -la src', 'cat a.ts | head -50',
    'grep -rn "foo bar" src', 'find . -name "*.ts"', 'git branch', 'git branch -a', 'git remote -v', 'Get-Content src/a.ts', 'git -C repo log',
    'rg -n foo', 'git status --short', 'git log --format="%h %s" -3', 'git diff a b 2>&1 | head -100', 'git branch --contains abc', 'git config --get user.name',
  ]) assert.equal(readOnlyCommand(c), true, c);
});
