// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProductCapabilityCatalog } from '../../src/capabilities/catalog.js';
import type { OPNsenseAliasAdapter } from '../../src/opnsense/alias-adapter.js';
import type { OPNsenseReadAdapter } from '../../src/opnsense/read-adapter.js';
import { afterEach, describe, expect, it } from 'vitest';

const NODE_22_PREFLIGHT = [
  'if test -x /opt/homebrew/opt/node@22/bin/node; then',
  'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"',
  'fi',
  'node -e "const [major, minor] = process.versions.node.split(\'.\').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&'
] as const;

const PLATFORM_STATUS =
  '**Platform status:** macOS and Linux are the currently verified development hosts. Native Windows remains a required product target, but package and client support are not claimed until the later `windows-2025` gate passes.';
const VM_ATTESTATION_SCRIPT = join(process.cwd(), 'scripts/verify-vm-attestation.mjs');
const VERIFIER_ROOTS: string[] = [];

interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

afterEach(async () => {
  await Promise.all(
    VERIFIER_ROOTS.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

function runCommand(
  command: string,
  arguments_: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      command,
      [...arguments_],
      {
        cwd: options.cwd,
        encoding: 'utf8',
        env: options.env ?? process.env,
        maxBuffer: 1024 * 1024,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        const code =
          error === null
            ? 0
            : typeof error.code === 'number' && Number.isInteger(error.code)
              ? error.code
              : 1;
        resolve({ code, stdout, stderr });
      }
    );
  });
}

async function git(root: string, arguments_: readonly string[]): Promise<string> {
  const result = await runCommand('git', arguments_, {
    cwd: root,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Task 7 Test',
      GIT_AUTHOR_EMAIL: 'task7@example.invalid',
      GIT_COMMITTER_NAME: 'Task 7 Test',
      GIT_COMMITTER_EMAIL: 'task7@example.invalid'
    }
  });
  if (result.code !== 0) throw new Error('Git fixture command failed');
  return result.stdout.trim();
}

function vmAttestation(
  commit: string,
  tree: string,
  imageSha256 = '28d5e2f37e40d87468a924e3006ef10e2ddc6de485b85333d9e3958c84d0cb9d'
): string {
  return `${JSON.stringify({
    checks: {
      aliasAbsentAfter: true,
      aliasAbsentBefore: true,
      aliasCreated: true,
      aliasDeleted: true,
      aliasPresent: true,
      bootstrap: true,
      doctor: true,
      packageInstalled: true,
      residueFree: true,
      vmStarted: true,
      vmStopped: true,
      writableSurface: true
    },
    clientVersion: '0.1.0',
    commit,
    host: 'linux',
    image: {
      release: '26.7',
      sha256: imageSha256
    },
    node: '22.19.0',
    protocolVersion: '2026-07-28',
    scenario: {
      flags: ['experimental-alias-write'],
      readOnly: false,
      scopes: ['server.status', 'system.status', 'core.services', 'firewall.alias']
    },
    schemaVersion: 2,
    tree
  })}\n`;
}

async function verifierFixture(): Promise<{
  readonly root: string;
  readonly evidencePath: string;
  readonly testedCommit: string;
  readonly testedTree: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'opnsense-vm-attestation-verifier-'));
  VERIFIER_ROOTS.push(root);
  await git(root, ['init', '-q']);
  await writeFile(join(root, 'tracked.txt'), 'tested bytes\n', 'utf8');
  await git(root, ['add', 'tracked.txt']);
  await git(root, ['commit', '-qm', 'tested commit']);
  const testedCommit = await git(root, ['rev-parse', 'HEAD']);
  const testedTree = await git(root, ['rev-parse', 'HEAD^{tree}']);
  const evidencePath = join(root, 'docs/evidence/product3-vm.json');
  await mkdir(join(root, 'docs/evidence'), { recursive: true });
  await writeFile(evidencePath, vmAttestation(testedCommit, testedTree), 'utf8');
  return { root, evidencePath, testedCommit, testedTree };
}

async function runVerifier(root: string): Promise<CommandResult> {
  return runCommand(process.execPath, [VM_ATTESTATION_SCRIPT], { cwd: root });
}

async function commitVmEvidence(root: string): Promise<void> {
  await git(root, ['add', 'docs/evidence/product3-vm.json']);
  await git(root, ['commit', '-qm', 'add VM evidence']);
}

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

describe('product documentation', () => {
  it('states the useful Product 1 surface, evidence, and explicit non-claims', async () => {
    const [readme, evidence, liveEvidence] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('tests/fixtures/opencode.product1a.json', 'utf8'),
      readFile('tests/fixtures/product1b.live.json', 'utf8')
    ]);
    expect(readme).toContain('read-only by default');
    for (const tool of ['`server_status`', '`opn_describe`', '`opn_get`', '`opn_list`']) {
      expect(readme).toContain(tool);
    }
    for (const resource of ['`system.status`', '`core.services`']) {
      expect(readme).toContain(resource);
    }
    // Prettier rewraps prose, so content assertions run against a whitespace-normalised copy.
    const prose = readme.replace(/\s+/gu, ' ');
    expect(prose).toContain('no write tool is listed or dispatchable');
    expect(prose).toContain('verified pre-change backup');
    expect(readme).toContain('disposable OPNsense 26 VM');
    expect(readme).toContain('POST /api/core/service/search');
    for (const nonClaim of ['public DNS, ACME, or HAProxy', 'Windows', 'agentic benchmark'])
      expect(readme).toContain(nonClaim);
    expect(readme).toContain('OpenCode 1.18.16');
    expect(readme).toContain('opencode/deepseek-v4-flash-free');
    expect(readme).toContain('AGPL-3.0-or-later');
    expect(readme).toContain('not affiliated with, sponsored by, or endorsed by');
    expect(readme).not.toContain('Foundation development snapshot');
    expect(JSON.parse(evidence)).toMatchObject({
      status: 'passed',
      client: { name: 'OpenCode', version: '1.18.16' },
      model: 'opencode/deepseek-v4-flash-free',
      checks: { cleanupConfirmed: true, secretAbsent: true }
    });
    expect(JSON.parse(liveEvidence)).toMatchObject({
      status: 'passed',
      firmware: { name: 'OPNsense', version: '26.1.6' },
      virtualization: { accelerator: 'tcg' },
      checks: {
        packageInstalled: true,
        readOnlySurface: true,
        systemStatus: true,
        servicesPage: true,
        vmStopped: true,
        residueFree: true
      }
    });
  });

  it('states that every excluded broad legacy surface is absent', async () => {
    const readme = await readFile('README.md', 'utf8');
    const prose = readme.replace(/\s+/gu, ' ');

    expect(prose).toContain(
      'Raw API dispatch, free-form shell/SSH, bulk IaC, a dashboard, and broad legacy parity are absent.'
    );
  });

  it('distinguishes all four live MCP reads from the two remote API calls', async () => {
    const contributing = await readFile('CONTRIBUTING.md', 'utf8');
    const prose = contributing.replace(/\s+/gu, ' ');

    expect(prose).toContain(
      'all four MCP read-tool calls (`server_status`, `opn_describe system.status`, `opn_get system.status`, and `opn_list core.services`)'
    );
    expect(prose).toContain('the last two issuing the two remote OPNsense API calls');
    expect(prose).not.toContain('the two MCP reads');
  });

  it('publishes only the lifecycle proven by the commit-bound Product 3 VM attestation', async () => {
    const [readme, attestationBytes] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('docs/evidence/product3-vm.json', 'utf8')
    ]);
    const attestation = JSON.parse(attestationBytes) as {
      readonly checks?: Readonly<Record<string, unknown>>;
    };
    expect(attestation.checks).toMatchObject({
      vmStarted: true,
      bootstrap: true,
      packageInstalled: true,
      writableSurface: true,
      aliasAbsentBefore: true,
      aliasCreated: true,
      aliasPresent: true,
      aliasDeleted: true,
      aliasAbsentAfter: true,
      vmStopped: true,
      residueFree: true
    });

    const prose = readme.replace(/\s+/gu, ' ');
    const lowerProse = prose.toLowerCase();
    for (const obsoleteStatus of [
      'no sealed disposable-vm evidence for a write exists',
      'no sealed live run is committed',
      'a live disposable-vm mutation: the lifecycle is proven against a synthetic target only'
    ]) {
      expect.soft(lowerProse).not.toContain(obsoleteStatus);
    }
    expect
      .soft(readme)
      .toContain('[commit-bound Product 3 VM attestation](docs/evidence/product3-vm.json)');
    expect
      .soft(prose)
      .toContain(
        '`test:product1b` owns the whole live test: it verifies and caches the pinned official OPNsense 26.7 nano image, starts one local VM, creates a disposable least-privilege API user over the serial console without any operator credential, packs and installs this npm package, calls `server_status`, `opn_describe system.status`, `opn_get system.status` and `opn_list core.services` through one MCP session, then stops the VM and removes the overlay, API credentials, certificate, and temporary package.'
      );
    expect
      .soft(prose)
      .toContain(
        'The historical Product 1B evidence remains the proof for only two remote calls: `GET /api/core/system/status` and `POST /api/core/service/search`.'
      );
    expect
      .soft(prose)
      .toContain(
        'Product 3 proves on a disposable VM the following only: the writable surface and this exact `firewall.alias` lifecycle: absent, create, present, delete, absent, followed by VM cleanup and a residue-free check.'
      );
    expect
      .soft(prose)
      .toContain(
        'Both ACL profiles now have live evidence only in their exact scenarios: the read-only profile in Product 1B and the alias-write profile in Product 3.'
      );
    expect
      .soft(prose)
      .toContain(
        'The Product 3 attestation does not prove production use, durable state, durable backups, a durable audit trail, restore, or automatic rollback.'
      );
    const claimVerb =
      /\b(?:attest|claim|confirm|cover|demonstrate|establish|prove|show|support|validate|verify)s?\b/iu;
    const product3Reference = /\b(?:Product 3|attestation)\b/iu;
    const product3Claims = readme
      .split(/\n\s*\n/u)
      .flatMap((paragraph) =>
        paragraph
          .replace(/\s+/gu, ' ')
          .trim()
          .split(/(?<=[.!?])\s+(?=[*#`A-Z])/u)
      )
      .filter((sentence) => product3Reference.test(sentence) && claimVerb.test(sentence));
    expect
      .soft(product3Claims)
      .toEqual([
        'Product 3 proves on a disposable VM the following only: the writable surface and this exact `firewall.alias` lifecycle: absent, create, present, delete, absent, followed by VM cleanup and a residue-free check.',
        'The Product 3 attestation does not prove production use, durable state, durable backups, a durable audit trail, restore, or automatic rollback.'
      ]);

    const proofSection = prose.slice(
      prose.indexOf('## Disposable OPNsense 26 proof'),
      prose.indexOf('## OpenCode')
    );
    const positiveClaimsOnly = proofSection.replace(product3Claims[1] ?? '', '');
    expect
      .soft(positiveClaimsOnly)
      .not.toMatch(
        /\b(?:attest|claim|confirm|cover|demonstrate|establish|prove|show|support|validate|verify)s?\b[^.!?]{0,160}\b(?:production|durable|persistent|restore|rollback|public exposure|Internet-facing|outside `firewall\.alias`)\b/iu
      );
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
      'npm run test:product1a',
      'npm run vm:doctor',
      'npm run test:product1b',
      'npm run verify',
      'npm run test:conformance:2025',
      'npm run test:conformance:2026',
      'git diff --check'
    ]) {
      expect(contributingLines).toContain(exactCommand);
    }
    expect(contributingLines).toContain(
      'npm run vm:product3 -- --attestation-out "$PWD/docs/evidence/product3-vm.json"'
    );
    expect(contributingLines).not.toContain('npm run vm:product3');
    for (const block of [...bashBlocks(readme), ...bashBlocks(contributing)]) {
      if (!/(?:^|\n)(?:node|npm|npx)\b/mu.test(block)) continue;
      if (/npm run (?:vm:|test:product1b)/u.test(block)) continue;
      // The Node 22 preflight pins this workstation's Homebrew path. It belongs to contributor
      // instructions run from a clone; an end user installing the published package has no
      // Homebrew node@22 to select, so requiring it in the quickstart would print a path that
      // does not exist on their machine. The supported Node range is stated in prose instead and
      // enforced by the package's own `engines` field.
      if (block.includes('npx -y @gabrielion/opnsense-mcp')) continue;
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
    expect(readmeLines.some((line) => line.endsWith('node dist/main.js'))).toBe(true);
    expect(readmeLines).not.toContain('npm start');
    expect(stdioTest).toContain("spawn(process.execPath, ['dist/main.js']");
    expect(readme).toContain('"type": "local"');
    expect(readme).toContain('"command": [');
    expect(readme).toContain('"OPNSENSE_CONFIG_FILE"');
    expect(readme).not.toContain('PRODUCT_1A_OPENCODE_SECRET_SENTINEL');
  });

  it('distinguishes current verification hosts from the unclaimed Windows target', async () => {
    const [readme, contributing] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('CONTRIBUTING.md', 'utf8')
    ]);
    for (const document of [readme, contributing]) {
      expect(document).toContain(PLATFORM_STATUS);
      expect(document).not.toMatch(/Windows (?:is|currently) supported/iu);
      expect(document).not.toContain('Windows package and client support are verified');
    }
  });

  it('hard-stops superseded plans and routes only independently reviewed replacements', async () => {
    const [index, product, guided] = await Promise.all([
      readFile('docs/superpowers/plans/2026-07-17-rebuild-plan-index.md', 'utf8'),
      readFile('docs/superpowers/plans/2026-07-17-opnsense-product-parity.md', 'utf8'),
      readFile('docs/superpowers/plans/2026-07-17-guided-workflows-clients-release.md', 'utf8')
    ]);
    const blockedBanner = '# BLOCKED / SUPERSEDED — DO NOT EXECUTE\n';
    expect(product.startsWith(blockedBanner)).toBe(true);
    expect(guided.startsWith(blockedBanner)).toBe(true);
    for (const plan of [product, guided]) {
      expect(plan).toContain('inputs to the rewrite, not executable instructions');
      expect(plan).toContain(
        'docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md'
      );
      expect(plan).toContain(
        'docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md'
      );
      expect(plan).toContain('independently reviewed');
    }
    expect(index).toContain('beginning with Product 1A');
    expect(index).toContain('No Product implementation starts from the superseded');
    expect(index).toContain('GUIDED/CLIENT CHECKPOINT');
    expect(index).toContain(
      'Product 5 implementation starts only after that replacement passes review'
    );
    expect(index).toContain('independently reviewed');
    expect(index).toContain(
      'docs/superpowers/specs/2026-07-19-operation-catalog-progressive-discovery-design.md'
    );
    expect(index).toContain(
      'docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md'
    );
    for (const checkpoint of [index, guided]) {
      expect(checkpoint).toContain('windows-2025');
      expect(checkpoint).toContain('package path containing spaces');
      expect(checkpoint).toContain('`.cmd` launch');
      expect(checkpoint).toContain('installer and ACL');
      expect(checkpoint).toContain('MCP exchange');
      expect(checkpoint).toContain('mock connectivity');
      expect(checkpoint).toContain('exact-process exit');
      expect(checkpoint).toContain('cleanup evidence');
    }
  });

  it('routes bounded provenance independently from vertical product delivery', async () => {
    const [index, task2Index, baselinePlan, historical, productRouting] = await Promise.all([
      readFile('docs/superpowers/plans/2026-07-17-rebuild-plan-index.md', 'utf8'),
      readFile(
        'docs/superpowers/plans/2026-07-19-private-provenance-contract-preflight.md',
        'utf8'
      ),
      readFile('docs/superpowers/plans/2026-07-19-private-provenance-baseline.md', 'utf8'),
      readFile(
        'docs/superpowers/plans/2026-07-17-provenance-test-infrastructure-migration.md',
        'utf8'
      ),
      readFile('docs/superpowers/plans/2026-07-19-opnsense-product-verticals.md', 'utf8')
    ]);
    expect(task2Index).toContain('**Status:** Routing document; not directly executable');
    expect(task2Index).toContain('Task 2A1 — pure baseline contract');
    expect(task2Index).toContain('Task 2A2 — accepted-context preflight');
    expect(task2Index).toContain('2026-07-19-private-provenance-baseline.md');
    expect(baselinePlan).toContain('Task 2A1');
    expect(historical).toContain('must not execute as written');
    expect(historical).toContain('Historical Task 11');
    expect(productRouting).toContain('**Status:** Routing document; not directly executable');
    expect(productRouting).toContain('Product 1A — First useful read-only vertical');
    expect(productRouting).toContain('Product 1B — Disposable-VM read and contributor path');
    expect(productRouting).toContain('GET /api/core/system/status');
    expect(productRouting).toContain('POST /api/core/service/search');
    expect(index).toContain('2026-07-19-opnsense-product-verticals.md');
    for (const milestone of [
      'Useful read-only server',
      'Central mutation envelope',
      'One verified mutation',
      'Independent use-case verticals',
      'Clients and pedagogy',
      'Pre-publication proof'
    ])
      expect(index).toContain(milestone);
    for (const focusRule of [
      'one user-visible demonstration',
      'New clean-room product code and new tests do not wait for private provenance',
      'one public MCP capability per immutable policy/effect'
    ])
      expect(index).toContain(focusRule);
    expect(index).toContain('clean-room product');
    expect(index).toContain('without legacy inputs');
  });

  it('documents exactly the tools the live catalogue exposes, and the experimental write triple', async () => {
    const readme = await readFile('README.md', 'utf8');
    const aliasAdapter = { available: true } as unknown as OPNsenseAliasAdapter;
    const readAdapter = { available: true } as unknown as OPNsenseReadAdapter;
    const catalog = createProductCapabilityCatalog(readAdapter, aliasAdapter);
    const defaults = catalog
      .listExposed({
        readOnly: true,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: null
      })
      .map(({ mcpName }) => mcpName);
    const experimental = catalog
      .listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(['experimental-alias-write']),
        allowedResourceScopes: new Set(['firewall.alias'])
      })
      .map(({ mcpName }) => mcpName)
      .filter((name) => !defaults.includes(name));

    // The README must name what the product actually exposes, derived from the catalogue rather
    // than from a hand-maintained list that can drift.
    for (const tool of [...defaults, ...experimental]) expect(readme).toContain(`\`${tool}\``);
    expect(experimental).toEqual(['opn_create', 'opn_delete']);

    // Every condition a write requires must be stated, and the retired false claim must be gone.
    expect(readme).toContain('`experimental-alias-write`');
    expect(readme).toContain('`ALLOWED_RESOURCES`');
    expect(readme).toContain('`READ_ONLY=false`');
    expect(readme).not.toContain('No mutation tool is registered');
    expect(readme).not.toContain('exactly four read-only tools');
  });

  it('documents the configure command, the proven ACLs, and the distribution status', async () => {
    const readme = await readFile('README.md', 'utf8');

    const prose = readme.replace(/\s+/gu, ' ');
    // The runnable form from a clone, plus the fact that the short name only exists once installed.
    expect(prose).toContain('node dist/main.js configure');
    expect(prose).toContain('npx -y @gabrielion/opnsense-mcp configure');
    expect(prose).toContain('ignores `OPNSENSE_CONFIG_FILE`');
    for (const privilege of [
      'page-system-status',
      'page-status-services',
      'user-config-readonly',
      'page-diagnostics-configurationhistory',
      'page-firewall-alias-edit'
    ]) {
      expect(readme).toContain(`\`${privilege}\``);
    }
    // The package is on the public registry since 0.1.0; the README must say so and must not keep
    // the pre-publication claim.
    expect(prose).toContain('published on npm as');
    expect(prose).not.toContain('not published');
    expect(readme).toContain('stdio');
  });

  it('never claims a durable backup or audit before P0-C lands', async () => {
    const readme = await readFile('README.md', 'utf8');

    const prose = readme.replace(/\s+/gu, ' ');
    // The honest statements: the backup is destroyed at shutdown, the audit is a bounded in-memory
    // ring, and there is no restore. Each must be present.
    expect(prose).toContain('deleted when the server shuts down');
    expect(prose).toContain('in-memory ring');
    expect(prose).toContain('no restore and no rollback');
  });
});

describe('commit-bound VM attestation verifier', () => {
  it('accepts the coherent pre-evidence state and the later sole-evidence commit', async () => {
    const fixture = await verifierFixture();

    const beforeCommit = await runVerifier(fixture.root);
    expect(beforeCommit).toEqual({ code: 0, stdout: '', stderr: '' });

    await commitVmEvidence(fixture.root);

    const afterCommit = await runVerifier(fixture.root);
    expect(afterCommit).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('rejects an unstaged tracked change after the later evidence commit', async () => {
    const fixture = await verifierFixture();
    await commitVmEvidence(fixture.root);
    await writeFile(join(fixture.root, 'tracked.txt'), 'unstaged dirty bytes\n', 'utf8');

    expect(await runVerifier(fixture.root)).toEqual({ code: 2, stdout: '', stderr: '' });
  });

  it('rejects a staged tracked change after the later evidence commit', async () => {
    const fixture = await verifierFixture();
    await commitVmEvidence(fixture.root);
    await writeFile(join(fixture.root, 'tracked.txt'), 'staged dirty bytes\n', 'utf8');
    await git(fixture.root, ['add', 'tracked.txt']);

    expect(await runVerifier(fixture.root)).toEqual({ code: 2, stdout: '', stderr: '' });
  });

  it('rejects an untracked path after the later evidence commit', async () => {
    const fixture = await verifierFixture();
    await commitVmEvidence(fixture.root);
    await writeFile(join(fixture.root, 'extra.txt'), 'untracked dirty bytes\n', 'utf8');

    expect(await runVerifier(fixture.root)).toEqual({ code: 2, stdout: '', stderr: '' });
  });

  it('accepts replacement evidence when the tested commit contains older evidence', async () => {
    const fixture = await verifierFixture();
    await git(fixture.root, ['add', 'docs/evidence/product3-vm.json']);
    await git(fixture.root, ['commit', '-qm', 'add older VM evidence']);
    await writeFile(join(fixture.root, 'tracked.txt'), 'later tested bytes\n', 'utf8');
    await git(fixture.root, ['add', 'tracked.txt']);
    await git(fixture.root, ['commit', '-qm', 'create later tested commit']);

    const testedCommit = await git(fixture.root, ['rev-parse', 'HEAD']);
    const testedTree = await git(fixture.root, ['rev-parse', 'HEAD^{tree}']);
    await writeFile(fixture.evidencePath, vmAttestation(testedCommit, testedTree), 'utf8');

    const beforeCommit = await runVerifier(fixture.root);
    expect(beforeCommit).toEqual({ code: 0, stdout: '', stderr: '' });

    await git(fixture.root, ['add', 'docs/evidence/product3-vm.json']);
    await git(fixture.root, ['commit', '-qm', 'replace VM evidence']);

    const afterCommit = await runVerifier(fixture.root);
    expect(afterCommit).toEqual({ code: 0, stdout: '', stderr: '' });
  });

  it('rejects unrelated tracked or untracked changes in a pre-evidence state', async () => {
    const untracked = await verifierFixture();
    await writeFile(join(untracked.root, 'extra.txt'), 'not evidence\n', 'utf8');
    expect(await runVerifier(untracked.root)).toEqual({ code: 2, stdout: '', stderr: '' });

    const tracked = await verifierFixture();
    await writeFile(join(tracked.root, 'tracked.txt'), 'unrelated working change\n', 'utf8');
    expect(await runVerifier(tracked.root)).toEqual({ code: 2, stdout: '', stderr: '' });
  });

  it('returns stale for an unresolved commit, a tree mismatch, or extra changed paths', async () => {
    const unresolved = await verifierFixture();
    await writeFile(
      unresolved.evidencePath,
      vmAttestation('f'.repeat(40), unresolved.testedTree),
      'utf8'
    );
    expect(await runVerifier(unresolved.root)).toEqual({ code: 2, stdout: '', stderr: '' });

    const mismatchedTree = await verifierFixture();
    await writeFile(
      mismatchedTree.evidencePath,
      vmAttestation(mismatchedTree.testedCommit, 'e'.repeat(40)),
      'utf8'
    );
    expect(await runVerifier(mismatchedTree.root)).toEqual({ code: 2, stdout: '', stderr: '' });

    const extraPath = await verifierFixture();
    await writeFile(join(extraPath.root, 'extra.txt'), 'not evidence\n', 'utf8');
    await git(extraPath.root, ['add', 'docs/evidence/product3-vm.json', 'extra.txt']);
    await git(extraPath.root, ['commit', '-qm', 'evidence and unrelated change']);
    expect(await runVerifier(extraPath.root)).toEqual({ code: 2, stdout: '', stderr: '' });
  });

  it('returns unreadable for a missing, malformed, or non-canonical document', async () => {
    const fixture = await verifierFixture();
    await unlink(fixture.evidencePath);
    expect(await runVerifier(fixture.root)).toEqual({ code: 1, stdout: '', stderr: '' });

    await writeFile(fixture.evidencePath, '{"schemaVersion":2}\n', 'utf8');
    expect(await runVerifier(fixture.root)).toEqual({ code: 1, stdout: '', stderr: '' });

    await writeFile(
      fixture.evidencePath,
      JSON.stringify(JSON.parse(vmAttestation(fixture.testedCommit, fixture.testedTree)), null, 2),
      'utf8'
    );
    expect(await runVerifier(fixture.root)).toEqual({ code: 1, stdout: '', stderr: '' });

    const wrongImage = await verifierFixture();
    await writeFile(
      wrongImage.evidencePath,
      vmAttestation(wrongImage.testedCommit, wrongImage.testedTree, 'a'.repeat(64)),
      'utf8'
    );
    expect(await runVerifier(wrongImage.root)).toEqual({ code: 1, stdout: '', stderr: '' });
  });

  it('returns unreadable for pre-evidence and committed symlink documents', async () => {
    const fixture = await verifierFixture();
    const attestation = await readFile(fixture.evidencePath, 'utf8');
    await writeFile(join(fixture.root, '.git/attestation-target'), attestation, 'utf8');
    await unlink(fixture.evidencePath);
    await symlink('../../.git/attestation-target', fixture.evidencePath);

    expect(await runVerifier(fixture.root)).toEqual({ code: 1, stdout: '', stderr: '' });

    await git(fixture.root, ['add', 'docs/evidence/product3-vm.json']);
    await git(fixture.root, ['commit', '-qm', 'add symlink evidence']);
    expect(await runVerifier(fixture.root)).toEqual({ code: 1, stdout: '', stderr: '' });
  });

  it('keeps package and VM evidence verification as distinct scripts', async () => {
    const manifest = JSON.parse(await readFile('package.json', 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };

    expect(manifest.scripts['evidence:check']).toBe(
      'npm run build && vitest run --project evidence'
    );
    expect(manifest.scripts['evidence:verify']).toBe('node scripts/verify-vm-attestation.mjs');
  });

  it('makes commit-bound VM evidence verification mandatory in CI and the release gate', async () => {
    const [workflow, contributing] = await Promise.all([
      readFile('.github/workflows/ci.yml', 'utf8'),
      readFile('CONTRIBUTING.md', 'utf8')
    ]);

    expect(workflow).toMatch(/- run: npm run verify\s+- run: npm run evidence:verify/u);
    expect(contributing.replace(/\s+/gu, ' ')).toContain(
      'npm run evidence:check && npm run evidence:verify'
    );
    expect(contributing.replace(/\s+/gu, ' ')).toContain(
      'The VM verifier accepts either the exact pre-evidence commit and tree or one later commit whose sole change is `docs/evidence/product3-vm.json`.'
    );
  });
});
