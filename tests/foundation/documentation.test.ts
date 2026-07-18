// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const NODE_22_PREFLIGHT = [
  'if test -x /opt/homebrew/opt/node@22/bin/node; then',
  'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"',
  'fi',
  'node -e "const [major, minor] = process.versions.node.split(\'.\').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&'
] as const;

function bashBlocks(document: string): readonly string[] {
  return [...document.matchAll(/```bash\n(?<body>[\s\S]*?)\n```/gu)].map(
    (match) => match.groups?.body ?? ''
  );
}

function commandLines(document: string): readonly string[] {
  return bashBlocks(document).flatMap((block) =>
    block
      .split('\n')
      .map((line) => line.trim().replace(/\s+&&$/u, ''))
      .filter((line) => line !== '')
  );
}

function logicalCommandsAfterPreflight(block: string): readonly string[] {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const preflightIndex = lines.indexOf(NODE_22_PREFLIGHT.at(-1) ?? '');
  if (preflightIndex < 0) return [];
  const commands: string[] = [];
  let current = '';
  for (const line of lines.slice(preflightIndex)) {
    const continued = line.endsWith('\\');
    current = `${current}${current === '' ? '' : ' '}${continued ? line.slice(0, -1).trim() : line}`;
    if (!continued) {
      commands.push(current);
      current = '';
    }
  }
  if (current !== '') commands.push(current);
  return commands;
}

describe('foundation documentation', () => {
  it('states the implemented safety and protocol evidence boundaries', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme).toContain('Foundation development snapshot');
    expect(readme).toContain('does not connect to or administer OPNsense');
    expect(readme).toContain('not the complete OPNsense MCP product');
    expect(readme).toContain('No firewall mutation capability is registered');
    expect(readme).toContain('2025-11-25');
    expect(readme).toContain('2026-07-28');
    expect(readme).toContain('http-header-validation');
    expect(readme).toContain('2.0.0-beta.4');
    expect(readme).toContain('six public-script invocations');
    expect(readme).toContain('twelve official child invocations');
    expect(readme).toContain('stderr remains empty');
    expect(readme).toContain('only `SUCCESS` or `INFO`');
    expect(readme).toContain('repinned to one stable MCP v2 release');
    expect(readme).toContain('AGPL-3.0-or-later');
    expect(readme).toContain('exact serialized origin');
    expect(readme).toContain('Deprecated SSE compatibility is disabled by default');
  });

  it('publishes exact guarded contributor commands', async () => {
    const [readme, contributing, stdioTest] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('CONTRIBUTING.md', 'utf8'),
      readFile('tests/mcp/stdio.test.ts', 'utf8')
    ]);
    const readmeLines = commandLines(readme);
    const contributingLines = commandLines(contributing);
    const installLines = [...readmeLines, ...contributingLines].filter((line) =>
      /^npm (?:ci|i|install)(?:\s|$)/u.test(line)
    );
    expect(installLines).toEqual(['npm ci --ignore-scripts', 'npm ci --ignore-scripts']);
    for (const exactCommand of [
      'npm ci --ignore-scripts',
      'npm run verify',
      'npm run test:conformance:2025',
      'npm run test:conformance:2026',
      'git diff --check'
    ]) {
      expect(contributingLines).toContain(exactCommand);
    }
    for (const block of [...bashBlocks(readme), ...bashBlocks(contributing)]) {
      if (!/(?:^|\n)(?:node|npm|npx)\b/mu.test(block)) continue;
      const lines = block.split('\n').map((line) => line.trim());
      for (const preflightLine of NODE_22_PREFLIGHT) {
        expect(lines).toContain(preflightLine);
      }
      const commands = logicalCommandsAfterPreflight(block);
      expect(commands.length).toBeGreaterThan(1);
      for (const command of commands.slice(0, -1)) {
        expect(command).toMatch(/ &&$/u);
      }
    }
    expect(readmeLines).toContain('node dist/main.js');
    expect(readmeLines).not.toContain('npm start');
    expect(stdioTest).toContain("spawn(process.execPath, ['dist/main.js']");
    expect(readme).toContain('the same random 32-or-more-character value');
    expect(readme).toContain('local secret manager');
    expect(readme).toContain(': "${MCP_HTTP_TOKEN:?Set MCP_HTTP_TOKEN in the server shell}" &&');
    expect(readme).toContain(
      `MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" node -e 'process.exit(process.env.MCP_HTTP_TOKEN?.length >= 32 ? 0 : 1)' &&`
    );
    expect(readme).toContain('MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" \\');
    expect(readme).not.toContain('MCP_HTTP_TOKEN="$(');
    expect(readme).not.toContain('0123456789abcdef0123456789abcdef');
  });
});
