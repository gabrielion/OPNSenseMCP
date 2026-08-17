// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function actionUses(workflow: string): readonly string[] {
  return workflow
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:- )?uses:/u.test(line));
}

describe('foundation CI workflow', () => {
  it('detects both step actions and reusable workflow jobs', () => {
    expect(
      actionUses(`jobs:
  steps-job:
    steps:
      - uses: owner/step@0000000000000000000000000000000000000000
  reusable-job:
    uses: owner/repository/.github/workflows/example.yml@main`)
    ).toEqual([
      '- uses: owner/step@0000000000000000000000000000000000000000',
      'uses: owner/repository/.github/workflows/example.yml@main'
    ]);
  });

  it('pins supported runtimes, immutable actions, guarded installs, and residue checks', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
    const lines = workflow.split('\n').map((line) => line.trim());
    const count = (line: string): number => lines.filter((candidate) => candidate === line).length;

    expect(
      count('- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0')
    ).toBe(4);
    expect(
      count('- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0')
    ).toBe(4);
    expect(actionUses(workflow)).toEqual([
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0'
    ]);
    expect(count('persist-credentials: false')).toBe(4);
    expect(count('node-version: 22.19.0 # compatibility floor')).toBe(1);
    expect(count('node-version: 22.23.1 # current patched Node 22')).toBe(3);
    expect(count('- run: npm ci --ignore-scripts')).toBe(4);
    expect(count('- run: npm ci')).toBe(0);
    const installInvocations = [
      ...workflow.matchAll(/(?:^|[^A-Za-z0-9_-])(?<command>npm[ \t]+(?:ci|i|install)\b[^\r\n]*)/gmu)
    ].map((match) => match.groups?.command?.trim());
    expect(installInvocations).toEqual([
      'npm ci --ignore-scripts',
      'npm ci --ignore-scripts',
      'npm ci --ignore-scripts',
      'npm ci --ignore-scripts'
    ]);
    expect(count('- run: npm run build')).toBe(1);
    expect(count('- run: npm run typecheck')).toBe(1);
    expect(count('- run: npm test -- tests/mcp/stdio.test.ts')).toBe(1);
    expect(count('- run: npm run verify')).toBe(1);
    expect(count('- run: npm run test:conformance')).toBe(1);
    expect(count('needs: [compatibility-floor, verify]')).toBe(1);
    // The only `needs:` in the workflow. The sealed-evidence gate must stay independent in both
    // directions: it depends on no job, and no job depends on it, so a stale seal can neither be
    // masked by an upstream failure nor skip the conformance profiles downstream.
    expect(workflow.match(/^[ \t]*needs:/gmu)).toHaveLength(1);
    expect(lines).toContain('timeout-minutes: 10');
    expect(lines).toContain('timeout-minutes: 20');
    expect(lines).toContain('timeout-minutes: 15');
    expect(count('test ! -e results')).toBe(4);
    expect(count('test -z "$(git status --porcelain=v1 --untracked-files=all)"')).toBe(4);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow.match(/^[ \t]*permissions:/gmu)).toHaveLength(1);
    expect(workflow).not.toMatch(/^[ \t]*permissions:[ \t]*write-all[ \t]*$/gmu);
    expect(workflow).not.toMatch(/^[ \t]+[A-Za-z][A-Za-z-]*:[ \t]*write[ \t]*$/gmu);
    expect(workflow).not.toContain('pull_request_target');
  });
});
