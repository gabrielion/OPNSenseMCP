// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

type AssetClass = 'approved' | 'rewrite' | 'discard';

interface Asset {
  destination: string;
  class: AssetClass;
  contentSha256: string | null;
  auditVerdict:
    | 'approved-pending-migration'
    | 'approved-migrated'
    | 'pending-independent-rewrite'
    | 'independently-rewritten'
    | 'discarded';
}

interface Manifest {
  schemaVersion: number;
  assets: Asset[];
}

const MANIFEST_ARGUMENT = 'docs/provenance/migration-manifest.json';
const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const validatorScript = join(repositoryRoot, 'scripts', 'provenance', 'verify-manifest.mjs');
const inventoryScript = join(repositoryRoot, 'scripts', 'provenance', 'inventory.mjs');
const temporaryPrefix = 'opnsense-provenance-';
const temporaryRoots = new Set<string>();

const EXPECTED_INVENTORY = [
  ['.agents/plugins/marketplace.json', 'approved'],
  ['.claude-plugin/marketplace.json', 'approved'],
  ['CONTRIBUTING.md', 'rewrite'],
  ['README.md', 'rewrite'],
  ['SECURITY.md', 'approved'],
  ['docs/adding-api-modules.md', 'approved'],
  ['docs/api-coverage-matrix.md', 'approved'],
  ['docs/ground-truth-eval.md', 'approved'],
  ['docs/production.md', 'approved'],
  ['docs/release.md', 'approved'],
  ['docs/ssh-features.md', 'approved'],
  ['docs/superpowers/plans/2026-06-22-ssh-backed-coverage.md', 'approved'],
  ['docs/superpowers/plans/2026-07-17-agentic-run1-audit.json', 'approved'],
  ['docs/superpowers/plans/2026-07-17-agentic-run1-audit.md', 'approved'],
  ['docs/superpowers/plans/2026-07-17-release-install-safety-benchmark.md', 'approved'],
  ['docs/superpowers/specs/2026-06-21-cleanup-hardening-backlog.md', 'approved'],
  ['docs/superpowers/specs/2026-06-22-ssh-backed-coverage-design.md', 'approved'],
  ['docs/superpowers/specs/2026-07-17-release-install-safety-benchmark-design.md', 'approved'],
  ['docs/testing.md', 'approved'],
  ['docs/tool-descriptions.md', 'approved'],
  ['plugins/opnsense-mcp/.claude-plugin/plugin.json', 'approved'],
  ['plugins/opnsense-mcp/.codex-plugin/plugin.json', 'approved'],
  ['plugins/opnsense-mcp/.mcp.json', 'approved'],
  ['plugins/opnsense-mcp/skills/opnsense-guide/SKILL.md', 'approved'],
  ['plugins/opnsense-mcp/skills/opnsense-guide/agents/openai.yaml', 'approved'],
  ['scripts/setup/bootstrap-dev.sh', 'approved'],
  ['src/cli/install.ts', 'approved'],
  ['src/cli/serve.ts', 'approved'],
  ['src/features/backup/storage.ts', 'rewrite'],
  ['src/http/security.ts', 'approved'],
  ['src/security/audit-log.ts', 'approved'],
  ['src/security/operation-policy.ts', 'approved'],
  ['tests/README.md', 'approved'],
  ['tests/agentic/deepeval/exposed-tools.txt', 'approved'],
  ['tests/agentic/deepeval/gt_assurance.py', 'approved'],
  ['tests/agentic/deepeval/gt_attestation.py', 'approved'],
  ['tests/agentic/deepeval/gt_checkpoint.py', 'approved'],
  ['tests/agentic/deepeval/gt_lib.py', 'approved'],
  ['tests/agentic/deepeval/gt_metrics.py', 'approved'],
  ['tests/agentic/deepeval/gt_tool_policy.py', 'approved'],
  ['tests/agentic/deepeval/irreversible-exclusions.json', 'approved'],
  ['tests/agentic/deepeval/requirements.txt', 'approved'],
  ['tests/agentic/deepeval/run_eval.py', 'approved'],
  ['tests/agentic/deepeval/semantic-contracts.json', 'approved'],
  ['tests/agentic/deepeval/setup.sh', 'approved'],
  ['tests/agentic/deepeval/test_agent_trace.py', 'approved'],
  ['tests/agentic/deepeval/test_attestation_adversarial.py', 'approved'],
  ['tests/agentic/deepeval/test_checkpoint.py', 'approved'],
  ['tests/agentic/deepeval/test_config_hygiene.py', 'approved'],
  ['tests/agentic/deepeval/test_hygiene_gate.py', 'approved'],
  ['tests/agentic/deepeval/test_infra_classification.py', 'approved'],
  ['tests/agentic/deepeval/test_metrics_adversarial.py', 'approved'],
  ['tests/agentic/deepeval/test_predicate_inventory.py', 'approved'],
  ['tests/agentic/deepeval/test_result_claims.py', 'approved'],
  ['tests/agentic/deepeval/test_validate_adversarial.py', 'approved'],
  ['tests/agentic/ground-truth.csv', 'approved'],
  ['tests/agentic/model-config.json', 'approved'],
  ['tests/agentic/run-agentic.mjs', 'approved'],
  ['tests/agentic/temp-config-hygiene.mjs', 'approved'],
  ['tests/agentic/verify-bridge-cleanup.test.mjs', 'approved'],
  ['tests/agentic/verify-bridge.mjs', 'approved'],
  ['tests/helpers/live-api-client.mjs', 'approved'],
  ['tests/helpers/mcp-client.mjs', 'approved'],
  ['tests/helpers/private-temp-json.mjs', 'approved'],
  ['tests/inspect.sh', 'approved'],
  ['tests/installer/install.test.mjs', 'approved'],
  ['tests/integration/acme-live-test.mjs', 'discard'],
  ['tests/integration/backup-flow.mjs', 'approved'],
  ['tests/integration/backup-id-collision.mjs', 'approved'],
  ['tests/integration/dnsbl-live-test.mjs', 'discard'],
  ['tests/integration/guardrails.mjs', 'approved'],
  ['tests/integration/live-script-secret-hygiene.mjs', 'approved'],
  ['tests/integration/mcp-against-mock.mjs', 'approved'],
  ['tests/integration/mcp-against-vm.mjs', 'approved'],
  ['tests/integration/monit-live-test.mjs', 'discard'],
  ['tests/integration/ssh-config-sections-vm.mjs', 'approved'],
  ['tests/integration/ssh-features-vm.mjs', 'approved'],
  ['tests/integration/ssh-restore-vm.mjs', 'approved'],
  ['tests/integration/ssh-system-vm.mjs', 'approved'],
  ['tests/integration/test-auto-initialization.ts', 'discard'],
  ['tests/integration/test-iac-components.ts', 'discard'],
  ['tests/integration/transport-security.mjs', 'approved'],
  ['tests/mock-opnsense/server.mjs', 'approved'],
  ['tests/plugin/package.test.mjs', 'approved'],
  ['tests/setup/bootstrap-dev.test.mjs', 'approved'],
  ['tests/smoke/claude-doc-consistency.mjs', 'approved'],
  ['tests/smoke/list-tools.mjs', 'approved'],
  ['tests/smoke/log-file-mode.mjs', 'approved'],
  ['tests/smoke/redaction.mjs', 'approved'],
  ['tests/unit/acme-client.test.js', 'discard'],
  ['tests/unit/dnsbl-subscription.test.js', 'discard'],
  ['tests/unit/monit.test.js', 'discard'],
  ['tests/unit/ssh-config-editor.test.mjs', 'approved'],
  ['tests/vm/assign-wan.sh', 'approved'],
  ['tests/vm/bootstrap-apikey.py', 'approved'],
  ['tests/vm/build-registry-snapshot.test.mjs', 'approved'],
  ['tests/vm/build-registry.mjs', 'approved'],
  ['tests/vm/disable-pf.sh', 'approved'],
  ['tests/vm/enable-ssh.py', 'approved'],
  ['tests/vm/image-checksum.test.mjs', 'approved'],
  ['tests/vm/image-sha256.txt', 'approved'],
  ['tests/vm/install-extra-ca.sh', 'approved'],
  ['tests/vm/install-plugins.sh', 'approved'],
  ['tests/vm/install-plugins.test.mjs', 'approved'],
  ['tests/vm/introspect-api.py', 'approved'],
  ['tests/vm/provision-one-vm.test.mjs', 'approved'],
  ['tests/vm/provision.sh', 'approved'],
  ['tests/vm/registry-diff.mjs', 'approved'],
  ['tests/vm/registry-diff.test.mjs', 'approved'],
  ['tests/vm/start-vm-reproducibility.test.mjs', 'approved'],
  ['tests/vm/start-vm.sh', 'approved'],
  ['tests/vm/stop-vm.sh', 'approved'],
  ['tests/vm/test_bootstrap_secret_hygiene.py', 'approved'],
  ['tests/vm/vm-doctor.sh', 'approved'],
  ['tests/vm/vm-doctor.test.mjs', 'approved'],
  ['tests/vm/vm-exec.py', 'approved']
] as const satisfies readonly (readonly [string, AssetClass])[];

const INVALID_PORTABLE_DESTINATIONS = [
  '',
  '/absolute',
  'C:/drive',
  '//server/share',
  'dir\\file',
  'dir//file',
  'dir/',
  './file',
  'dir/../file',
  'dir/.git/file',
  'dir/.GIT/file',
  'dir/NUL.txt',
  'dir/COM1',
  'dir/COM¹.txt',
  'dir/LPT³',
  'dir/name.',
  'dir/name ',
  'dir/na:me',
  'dir/na*me',
  `dir/nu\u0000ll`,
  'dir/e\u0301.txt'
] as const;

const LIFECYCLE_VERDICTS: readonly Asset['auditVerdict'][] = [
  'approved-pending-migration',
  'approved-migrated',
  'pending-independent-rewrite',
  'independently-rewritten',
  'discarded'
];
const LOWERCASE_DIGEST = 'a'.repeat(64);

function fixtureLifecycleIsValid(
  assetClass: AssetClass,
  digest: string | null,
  verdict: Asset['auditVerdict']
): boolean {
  return (
    (assetClass === 'approved' &&
      ((digest === null && verdict === 'approved-pending-migration') ||
        (digest === LOWERCASE_DIGEST && verdict === 'approved-migrated'))) ||
    (assetClass === 'rewrite' &&
      ((digest === null && verdict === 'pending-independent-rewrite') ||
        (digest === LOWERCASE_DIGEST && verdict === 'independently-rewritten'))) ||
    (assetClass === 'discard' && digest === null && verdict === 'discarded')
  );
}

const INVALID_LIFECYCLE_COMBINATIONS = (
  ['approved', 'rewrite', 'discard'] as const satisfies readonly AssetClass[]
)
  .flatMap((assetClass) =>
    ([null, LOWERCASE_DIGEST] as const).flatMap((digest) =>
      LIFECYCLE_VERDICTS.map((verdict) => ({ assetClass, digest, verdict }))
    )
  )
  .filter(
    ({ assetClass, digest, verdict }) => !fixtureLifecycleIsValid(assetClass, digest, verdict)
  );

const MALFORMED_DIGESTS: readonly unknown[] = [
  'A'.repeat(64),
  'g'.repeat(64),
  'a'.repeat(63),
  'a'.repeat(65),
  42,
  true,
  {},
  []
];

function initialManifest(): Manifest {
  return {
    schemaVersion: 1,
    assets: EXPECTED_INVENTORY.map(([destination, assetClass]) => ({
      destination,
      class: assetClass,
      contentSha256: null,
      auditVerdict:
        assetClass === 'approved'
          ? 'approved-pending-migration'
          : assetClass === 'rewrite'
            ? 'pending-independent-rewrite'
            : 'discarded'
    }))
  };
}

function canonicalManifest(manifest: Manifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function minimalEnvironment(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    GIT_CONFIG_NOSYSTEM: '1',
    LC_ALL: 'C',
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    TMPDIR: process.env.TMPDIR,
    ...extra
  };

  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

function run(
  executable: string,
  arguments_: readonly string[],
  cwd: string,
  options: { input?: string; env?: NodeJS.ProcessEnv } = {}
): SpawnSyncReturns<string> {
  return spawnSync(executable, [...arguments_], {
    cwd,
    encoding: 'utf8',
    env: minimalEnvironment(options.env),
    input: options.input,
    maxBuffer: 1024 * 1024,
    shell: false,
    timeout: 10_000
  });
}

function git(cwd: string, arguments_: readonly string[], input?: string): string {
  const result = run('git', arguments_, cwd, input === undefined ? {} : { input });
  if (result.status !== 0) throw new Error(`Git fixture command failed (${String(result.status)})`);
  return result.stdout;
}

async function createFixture(manifest: Manifest = initialManifest()): Promise<string> {
  const base = await realpath(tmpdir());
  const created = await mkdtemp(join(base, temporaryPrefix));
  const root = await realpath(created);
  temporaryRoots.add(root);
  await mkdir(join(root, 'docs', 'provenance'), { recursive: true });
  await writeFile(join(root, MANIFEST_ARGUMENT), canonicalManifest(manifest), 'utf8');
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'fixture@example.invalid']);
  git(root, ['config', 'user.name', 'Provenance Fixture']);
  git(root, ['config', 'core.autocrlf', 'false']);
  return root;
}

async function removeFixture(root: string): Promise<void> {
  const canonicalTemporary = await realpath(tmpdir());
  if (
    dirname(root) !== canonicalTemporary ||
    !basename(root).startsWith(temporaryPrefix) ||
    relative(canonicalTemporary, root).startsWith(`..${sep}`)
  ) {
    throw new Error('Refusing unsafe fixture cleanup');
  }
  temporaryRoots.delete(root);
  await rm(root, { recursive: true, force: true });
}

async function withFixture(
  callback: (root: string, manifest: Manifest) => Promise<void> | void,
  manifest = initialManifest()
): Promise<void> {
  const root = await createFixture(manifest);
  try {
    await callback(root, manifest);
  } finally {
    await removeFixture(root);
  }
}

async function writeManifest(root: string, manifest: Manifest, raw?: string): Promise<void> {
  await writeFile(join(root, MANIFEST_ARGUMENT), raw ?? canonicalManifest(manifest), 'utf8');
}

async function writeDestination(root: string, destination: string, bytes: string): Promise<void> {
  const target = join(root, ...destination.split('/'));
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, bytes, 'utf8');
}

class FileSymlinkFixtureUnavailable extends Error {
  readonly code: string;

  constructor(code: string) {
    super(`File symlink fixture unavailable (${code})`);
    this.code = code;
  }
}

async function createFileSymlinkFixture(target: string, path: string): Promise<void> {
  try {
    await symlink(target, path, 'file');
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      typeof error.code === 'string' &&
      ['EACCES', 'EINVAL', 'ENOSYS', 'EPERM'].includes(error.code)
    ) {
      throw new FileSymlinkFixtureUnavailable(error.code);
    }
    throw error;
  }
}

async function createDirectoryLinkFixture(target: string, path: string): Promise<void> {
  await symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
}

function runValidator(
  cwd: string,
  arguments_: readonly string[] = [MANIFEST_ARGUMENT],
  env: NodeJS.ProcessEnv = {}
): SpawnSyncReturns<string> {
  return run(process.execPath, [validatorScript, ...arguments_], cwd, { env });
}

function expectFailure(
  result: SpawnSyncReturns<string>,
  exitCode: 1 | 2,
  forbidden: readonly string[] = []
): void {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(exitCode);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/^PROVENANCE_[A-Z_]+(?: [A-Za-z0-9._/-]+)?\n$/);
  for (const value of forbidden) {
    if (value.length > 0) expect(result.stderr).not.toContain(value);
  }
}

function expectValid(result: SpawnSyncReturns<string>, pending = 108, sealed = 0): void {
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    `PROVENANCE_OK approved=105 rewrite=3 discard=8 pending=${String(pending)} sealed=${String(sealed)}\n`
  );
}

function firstAsset(manifest: Manifest, assetClass: AssetClass): Asset {
  const asset = manifest.assets.find((candidate) => candidate.class === assetClass);
  if (asset === undefined) throw new Error(`Missing ${assetClass} fixture row`);
  return asset;
}

function assetAt(manifest: Manifest, index: number): Asset {
  const asset = manifest.assets[index];
  if (asset === undefined) throw new Error('Missing fixture row');
  return asset;
}

afterAll(async () => {
  for (const root of [...temporaryRoots]) await removeFixture(root);
});

describe('committed public migration manifest', () => {
  it('locks the exact independent 116-row destination-to-class mapping and initial lifecycle', async () => {
    const manifestText = await readFile(join(repositoryRoot, MANIFEST_ARGUMENT), 'utf8');
    const manifest = JSON.parse(manifestText) as Manifest;

    expect(manifestText).toBe(canonicalManifest(manifest));
    expect(manifest.schemaVersion).toBe(1);
    expect(Object.keys(manifest)).toEqual(['schemaVersion', 'assets']);
    expect(manifest.assets).toHaveLength(116);
    expect(
      manifest.assets.map(({ destination, class: assetClass }) => [destination, assetClass])
    ).toEqual(EXPECTED_INVENTORY);
    expect(
      [...manifest.assets.map((asset) => asset.destination)].sort((left, right) =>
        Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
      )
    ).toEqual(manifest.assets.map((asset) => asset.destination));
    expect(
      manifest.assets.reduce<Record<AssetClass, number>>(
        (counts, asset) => ({ ...counts, [asset.class]: counts[asset.class] + 1 }),
        { approved: 0, rewrite: 0, discard: 0 }
      )
    ).toEqual({ approved: 105, rewrite: 3, discard: 8 });

    for (const asset of manifest.assets) {
      expect(Object.keys(asset)).toEqual(['destination', 'class', 'contentSha256', 'auditVerdict']);
      expect(asset.contentSha256).toBeNull();
      expect(asset.auditVerdict).toBe(
        asset.class === 'approved'
          ? 'approved-pending-migration'
          : asset.class === 'rewrite'
            ? 'pending-independent-rewrite'
            : 'discarded'
      );
    }
  });

  it('verifies the real repository without consulting private environment values', () => {
    const baselineSentinel = 'PRIVATE_BASELINE_SENTINEL_7ab2';
    const sourceSentinel = 'PRIVATE_SOURCE_SENTINEL_19ce';
    const result = runValidator(repositoryRoot, [MANIFEST_ARGUMENT], {
      OPNSENSE_MIGRATION_SOURCE: sourceSentinel,
      OPNSENSE_PROVENANCE_BASELINE: baselineSentinel
    });
    expectValid(result);
    expect(`${result.stdout}${result.stderr}`).not.toContain(baselineSentinel);
    expect(`${result.stdout}${result.stderr}`).not.toContain(sourceSentinel);
  });

  it('exports an actually deep-frozen production inventory', () => {
    const source = [
      `import { MIGRATION_INVENTORY } from ${JSON.stringify(pathToFileURL(inventoryScript).href)};`,
      'let refused = 0;',
      'try { MIGRATION_INVENTORY.push({ destination: "x", class: "approved" }); } catch { refused += 1; }',
      'try { MIGRATION_INVENTORY[0].destination = "x"; } catch { refused += 1; }',
      'process.stdout.write(String(refused));'
    ].join('\n');
    const result = run(process.execPath, ['--input-type=module', '--eval', source], repositoryRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('2');
    expect(result.stderr).toBe('');
  });

  it('exercises the production portable-path predicate independently of exact mapping', () => {
    const paths = [...INVALID_PORTABLE_DESTINATIONS, 'portable/path.txt'];
    const source = [
      `import { isPortableDestination, portableCollisionKey } from ${JSON.stringify(pathToFileURL(inventoryScript).href)};`,
      `const paths = ${JSON.stringify(paths)};`,
      'process.stdout.write(JSON.stringify({',
      '  portable: paths.map((path) => isPortableDestination(path)),',
      '  sigmaCollision: portableCollisionKey("docs/σ.txt") === portableCollisionKey("docs/ς.txt"),',
      '  longSCollision: portableCollisionKey("docs/s.txt") === portableCollisionKey("docs/ſ.txt")',
      '}));'
    ].join('\n');
    const result = run(process.execPath, ['--input-type=module', '--eval', source], repositoryRoot);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout) as unknown).toEqual({
      portable: [...INVALID_PORTABLE_DESTINATIONS.map(() => false), true],
      sigmaCollision: true,
      longSCollision: true
    });
    expect(result.stderr).toBe('');
  });

  it('keeps the two private ignore rules exact and narrow', async () => {
    const ignoreText = await readFile(join(repositoryRoot, '.gitignore'), 'utf8');
    const rules = ignoreText.split('\n');
    expect(rules.filter((rule) => rule === '.migration-private/')).toHaveLength(1);
    expect(rules.filter((rule) => rule === '*.provenance-baseline.json')).toHaveLength(1);

    const ignore = git(repositoryRoot, [
      'check-ignore',
      '--verbose',
      '--non-matching',
      '.migration-private/sentinel',
      'sentinel.provenance-baseline.json',
      '.migration-private-sibling/sentinel',
      'sentinel.provenance-baseline.json.extra'
    ]);
    const lines = ignore.trimEnd().split('\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('.migration-private/');
    expect(lines[1]).toContain('*.provenance-baseline.json');
    expect(lines[2]).toMatch(/^::\t/);
    expect(lines[3]).toMatch(/^::\t/);
  });
});

describe('validator CLI preflight and canonical manifest boundary', () => {
  it.each([
    { arguments_: [] as string[] },
    { arguments_: [MANIFEST_ARGUMENT, MANIFEST_ARGUMENT] },
    { arguments_: ['manifest.json'] },
    { arguments_: ['./docs/provenance/migration-manifest.json'] },
    { arguments_: ['/tmp/manifest.json'] }
  ])('rejects any invocation except the one literal manifest argument', async ({ arguments_ }) => {
    await withFixture((root) => {
      expectFailure(runValidator(root, arguments_), 2, arguments_);
    });
  });

  it('rejects a cwd that is not the canonical Git worktree root', async () => {
    await withFixture(async (root) => {
      const nested = join(root, 'nested');
      await mkdir(nested);
      expectFailure(runValidator(nested), 2, [root]);
    });
  });

  it('accepts a complete pending manifest with absent destinations', async () => {
    await withFixture((root) => {
      expectValid(runValidator(root));
    });
  });

  it('ignores caller Git repository-selection environment', async () => {
    await withFixture((root) => {
      expectValid(
        runValidator(root, [MANIFEST_ARGUMENT], {
          GIT_DIR: join(root, 'poisoned-git-dir'),
          GIT_INDEX_FILE: join(root, 'poisoned-index'),
          GIT_WORK_TREE: join(root, 'poisoned-worktree')
        })
      );
    });
  });

  it.each([
    ['extra top-level key', (manifest: Manifest) => Object.assign(manifest, { source: 'secret' })],
    [
      'extra asset key',
      (manifest: Manifest) => Object.assign(assetAt(manifest, 0), { source: 'secret' })
    ],
    ['wrong schema', (manifest: Manifest) => Object.assign(manifest, { schemaVersion: 2 })],
    [
      'duplicate destination',
      (manifest: Manifest) => {
        assetAt(manifest, 1).destination = assetAt(manifest, 0).destination;
      }
    ],
    [
      'count-preserving class swap',
      (manifest: Manifest) => {
        const approved = firstAsset(manifest, 'approved');
        const rewrite = firstAsset(manifest, 'rewrite');
        approved.class = 'rewrite';
        rewrite.class = 'approved';
      }
    ]
  ])('rejects %s', async (_name, mutate) => {
    const manifest = initialManifest();
    mutate(manifest);
    await withFixture((root) => {
      expectFailure(runValidator(root), 1);
    }, manifest);
  });

  it.each([
    ['malformed JSON', '{"MALFORMED_SENTINEL_8d91":'],
    [
      'duplicate top-level member',
      canonicalManifest(initialManifest()).replace(
        '  "schemaVersion": 1,',
        '  "schemaVersion": 1,\n  "schemaVersion": 1,'
      )
    ],
    [
      'duplicate asset member',
      canonicalManifest(initialManifest()).replace(
        '      "destination": ".agents/plugins/marketplace.json",',
        '      "destination": ".agents/plugins/marketplace.json",\n      "destination": ".agents/plugins/marketplace.json",'
      )
    ],
    ['noncanonical whitespace', JSON.stringify(initialManifest())],
    ['UTF-8 BOM', `\uFEFF${canonicalManifest(initialManifest())}`],
    ['oversize input', `${' '.repeat(256 * 1024)}\n`]
  ])('rejects %s without echoing malformed bytes', async (_name, raw) => {
    await withFixture(async (root, manifest) => {
      await writeManifest(root, manifest, raw);
      expectFailure(runValidator(root), 1, ['MALFORMED_SENTINEL_8d91', 'schemaVersion', root]);
    });
  });

  it('rejects a symlinked manifest', async (context) => {
    await withFixture(async (root) => {
      const path = join(root, MANIFEST_ARGUMENT);
      const target = join(root, 'real-manifest.json');
      await writeFile(target, canonicalManifest(initialManifest()), 'utf8');
      await rm(path);
      try {
        await createFileSymlinkFixture(target, path);
      } catch (error) {
        if (error instanceof FileSymlinkFixtureUnavailable) {
          context.skip(error.message);
          return;
        }
        throw error;
      }
      expectFailure(runValidator(root), 1, [target]);
    });
  });

  it('rejects a symlinked manifest parent component', async () => {
    await withFixture(async (root) => {
      const realDocs = join(root, 'real-docs');
      await mkdir(join(realDocs, 'provenance'), { recursive: true });
      await writeFile(
        join(realDocs, 'provenance', 'migration-manifest.json'),
        canonicalManifest(initialManifest()),
        'utf8'
      );
      await rm(join(root, 'docs'), { recursive: true });
      await createDirectoryLinkFixture(realDocs, join(root, 'docs'));
      expectFailure(runValidator(root), 1, [realDocs]);
    });
  });
});

describe('portable destinations and filesystem state', () => {
  it.each(INVALID_PORTABLE_DESTINATIONS)(
    'rejects nonportable destination form %#',
    async (destination) => {
      const manifest = initialManifest();
      assetAt(manifest, 0).destination = destination;
      await withFixture((root) => {
        expectFailure(runValidator(root), 1, [destination, root]);
      }, manifest);
    }
  );

  it('rejects normalization and case-fold collisions', async () => {
    const manifest = initialManifest();
    assetAt(manifest, 0).destination = 'docs/é.txt';
    assetAt(manifest, 1).destination = 'docs/e\u0301.txt';
    await withFixture((root) => {
      expectFailure(runValidator(root), 1);
    }, manifest);

    const caseManifest = initialManifest();
    assetAt(caseManifest, 0).destination = 'docs/File.txt';
    assetAt(caseManifest, 1).destination = 'docs/file.txt';
    await withFixture((root) => {
      expectFailure(runValidator(root), 1);
    }, caseManifest);
  });

  it('accepts an existing regular pending rewrite destination', async () => {
    await withFixture(async (root) => {
      await writeDestination(root, 'README.md', 'pending rewrite\n');
      git(root, ['add', '--', 'README.md']);
      expectValid(runValidator(root));
    });
  });

  it('rejects a pending destination that is a directory', async () => {
    await withFixture(async (root) => {
      await mkdir(join(root, 'README.md'));
      expectFailure(runValidator(root), 1);
    });
  });

  it('rejects an actual entry whose case differs from the manifest', async () => {
    await withFixture(async (root) => {
      await writeDestination(root, 'readme.md', 'wrong case\n');
      expectFailure(runValidator(root), 1);
    });
  });

  it('rejects a symlinked pending leaf', async (context) => {
    await withFixture(async (root) => {
      const target = join(root, 'target.txt');
      await writeFile(target, 'target\n', 'utf8');
      try {
        await createFileSymlinkFixture(target, join(root, 'README.md'));
      } catch (error) {
        if (error instanceof FileSymlinkFixtureUnavailable) {
          context.skip(error.message);
          return;
        }
        throw error;
      }
      expectFailure(runValidator(root), 1, [target]);
    });
  });

  it('rejects a junction or symlink in a pending path component', async () => {
    await withFixture(async (root) => {
      const realDirectory = join(root, 'real-src');
      await mkdir(join(realDirectory, 'features', 'backup'), { recursive: true });
      await writeFile(join(realDirectory, 'features', 'backup', 'storage.ts'), 'target\n', 'utf8');
      await createDirectoryLinkFixture(realDirectory, join(root, 'src'));
      expectFailure(runValidator(root), 1, [realDirectory]);
    });
  });

  it('rejects discard paths present in the filesystem or only in the index', async () => {
    await withFixture(async (root, manifest) => {
      const discard = firstAsset(manifest, 'discard');
      await writeDestination(root, discard.destination, 'discarded\n');
      expectFailure(runValidator(root), 1);
    });

    await withFixture(async (root, manifest) => {
      const discard = firstAsset(manifest, 'discard');
      await writeDestination(root, discard.destination, 'indexed discard\n');
      git(root, ['add', '--', discard.destination]);
      await rm(join(root, ...discard.destination.split('/')));
      expectFailure(runValidator(root), 1);
      expectFailure(
        runValidator(root, [MANIFEST_ARGUMENT], { GIT_INDEX_FILE: join(root, 'bypass-index') }),
        1
      );
    });
  });
});

describe('sealed rows use canonical stage-0 Git blobs', () => {
  async function sealFirstApproved(
    root: string,
    manifest: Manifest,
    bytes: string
  ): Promise<Asset> {
    const approved = firstAsset(manifest, 'approved');
    await writeDestination(root, approved.destination, bytes);
    git(root, ['add', '--', approved.destination]);
    const indexBytes = run('git', ['show', `:${approved.destination}`], root).stdout;
    approved.contentSha256 = createHash('sha256').update(indexBytes).digest('hex');
    approved.auditVerdict = 'approved-migrated';
    await writeManifest(root, manifest);
    return approved;
  }

  it('accepts matching approved and rewrite blobs and reports aggregate states', async () => {
    await withFixture(async (root, manifest) => {
      await sealFirstApproved(root, manifest, 'approved bytes\n');
      expectValid(runValidator(root), 107, 1);
    });

    await withFixture(async (root, manifest) => {
      const rewrite = firstAsset(manifest, 'rewrite');
      await writeDestination(root, rewrite.destination, 'rewrite bytes\n');
      git(root, ['add', '--', rewrite.destination]);
      const indexBytes = run('git', ['show', `:${rewrite.destination}`], root).stdout;
      rewrite.contentSha256 = createHash('sha256').update(indexBytes).digest('hex');
      rewrite.auditVerdict = 'independently-rewritten';
      await writeManifest(root, manifest);
      expectValid(runValidator(root), 107, 1);
    });
  });

  it('hashes Git blob bytes rather than autocrlf checkout bytes', async () => {
    await withFixture(async (root, manifest) => {
      git(root, ['config', 'core.autocrlf', 'true']);
      const approved = firstAsset(manifest, 'approved');
      await writeDestination(root, approved.destination, 'first\r\nsecond\r\n');
      git(root, ['add', '--', approved.destination]);
      const indexBytes = run('git', ['show', `:${approved.destination}`], root).stdout;
      expect(indexBytes).toBe('first\nsecond\n');
      approved.contentSha256 = createHash('sha256').update(indexBytes).digest('hex');
      approved.auditVerdict = 'approved-migrated';
      await writeManifest(root, manifest);
      expectValid(runValidator(root), 107, 1);
    });
  });

  it('ignores refs/replace while reading the sealed index blob', async () => {
    await withFixture(async (root, manifest) => {
      const approved = await sealFirstApproved(root, manifest, 'original indexed bytes\n');
      const stageEntry = git(root, ['ls-files', '--stage', '--', approved.destination]).trim();
      const match = /^100644 ([0-9a-f]+) 0\t/u.exec(stageEntry);
      expect(match).not.toBeNull();
      const originalObjectId = match?.[1];
      if (originalObjectId === undefined) throw new Error('Missing original fixture object ID');

      const replacementObjectId = git(
        root,
        ['hash-object', '-w', '--stdin'],
        'replacement bytes\n'
      ).trim();
      git(root, ['replace', originalObjectId, replacementObjectId]);
      expect(git(root, ['cat-file', 'blob', originalObjectId])).toBe('replacement bytes\n');

      expectValid(runValidator(root), 107, 1);
    });
  });

  it.each(INVALID_LIFECYCLE_COMBINATIONS)(
    'rejects every invalid basic lifecycle combination: $assetClass / $verdict',
    async ({ assetClass, digest, verdict }) => {
      const manifest = initialManifest();
      const asset = firstAsset(manifest, assetClass);
      Object.assign(asset, { contentSha256: digest, auditVerdict: verdict });
      await withFixture((root) => {
        expectFailure(runValidator(root), 1);
      }, manifest);
    }
  );

  it.each(
    (['approved', 'rewrite', 'discard'] as const).flatMap((assetClass) =>
      MALFORMED_DIGESTS.map((digest, index) => ({ assetClass, digest, index }))
    )
  )('rejects malformed digest $index for $assetClass', async ({ assetClass, digest }) => {
    const manifest = initialManifest();
    const asset = firstAsset(manifest, assetClass);
    Object.assign(asset, {
      contentSha256: digest,
      auditVerdict:
        assetClass === 'approved'
          ? 'approved-migrated'
          : assetClass === 'rewrite'
            ? 'independently-rewritten'
            : 'discarded'
    });
    await withFixture((root) => {
      expectFailure(runValidator(root), 1);
    }, manifest);
  });

  it.each([
    { mutation: { class: 'unknown' }, name: 'unknown class' },
    { mutation: { class: 42 }, name: 'non-string class' },
    { mutation: { auditVerdict: 'unknown' }, name: 'unknown verdict' },
    { mutation: { auditVerdict: 42 }, name: 'non-string verdict' }
  ])('rejects $name', async ({ mutation }) => {
    const manifest = initialManifest();
    Object.assign(firstAsset(manifest, 'approved'), mutation);
    await withFixture((root) => {
      expectFailure(runValidator(root), 1);
    }, manifest);
  });

  it('rejects digest mismatch and unstaged worktree drift', async () => {
    await withFixture(async (root, manifest) => {
      const approved = await sealFirstApproved(root, manifest, 'expected\n');
      approved.contentSha256 = '0'.repeat(64);
      await writeManifest(root, manifest);
      expectFailure(runValidator(root), 1);
    });

    await withFixture(async (root, manifest) => {
      const approved = await sealFirstApproved(root, manifest, 'indexed\n');
      await writeDestination(root, approved.destination, 'dirty\n');
      expectFailure(runValidator(root), 1);
    });
  });

  it('rejects missing, symlink, submodule, and unmerged index entries', async () => {
    await withFixture(async (root, manifest) => {
      const approved = firstAsset(manifest, 'approved');
      approved.contentSha256 = 'a'.repeat(64);
      approved.auditVerdict = 'approved-migrated';
      await writeDestination(root, approved.destination, 'not indexed\n');
      await writeManifest(root, manifest);
      expectFailure(runValidator(root), 1);
    });

    await withFixture(async (root, manifest) => {
      const approved = firstAsset(manifest, 'approved');
      const symlinkObject = git(root, ['hash-object', '-w', '--stdin'], 'target.txt').trim();
      git(root, [
        'update-index',
        '--add',
        '--cacheinfo',
        `120000,${symlinkObject},${approved.destination}`
      ]);
      await writeDestination(root, approved.destination, 'regular worktree replacement\n');
      approved.contentSha256 = 'a'.repeat(64);
      approved.auditVerdict = 'approved-migrated';
      await writeManifest(root, manifest);
      expectFailure(runValidator(root), 1, [symlinkObject]);
    });

    await withFixture(async (root, manifest) => {
      await writeDestination(root, 'seed.txt', 'seed\n');
      git(root, ['add', '--', 'seed.txt']);
      git(root, ['commit', '--quiet', '-m', 'fixture']);
      const approved = firstAsset(manifest, 'approved');
      const commit = git(root, ['rev-parse', 'HEAD']).trim();
      git(root, [
        'update-index',
        '--add',
        '--cacheinfo',
        `160000,${commit},${approved.destination}`
      ]);
      await writeDestination(root, approved.destination, 'regular worktree replacement\n');
      approved.contentSha256 = 'a'.repeat(64);
      approved.auditVerdict = 'approved-migrated';
      await writeManifest(root, manifest);
      expectFailure(runValidator(root), 1, [commit]);
    });

    await withFixture(async (root, manifest) => {
      const approved = firstAsset(manifest, 'approved');
      const first = git(root, ['hash-object', '-w', '--stdin'], 'first\n').trim();
      const second = git(root, ['hash-object', '-w', '--stdin'], 'second\n').trim();
      git(
        root,
        ['update-index', '--index-info'],
        `100644 ${first} 1\t${approved.destination}\n100644 ${second} 2\t${approved.destination}\n`
      );
      await writeDestination(root, approved.destination, 'regular conflicted worktree\n');
      approved.contentSha256 = 'a'.repeat(64);
      approved.auditVerdict = 'approved-migrated';
      await writeManifest(root, manifest);
      expectFailure(runValidator(root), 1, [first, second]);
    });

    await withFixture(async (root, manifest) => {
      const approved = firstAsset(manifest, 'approved');
      const objectId = git(root, ['hash-object', '-w', '--stdin'], 'indexed bytes\n').trim();
      const wrongCase = approved.destination.replace('marketplace.json', 'Marketplace.json');
      git(root, ['update-index', '--add', '--cacheinfo', `100644,${objectId},${wrongCase}`]);
      await writeDestination(root, approved.destination, 'indexed bytes\n');
      approved.contentSha256 = createHash('sha256').update('indexed bytes\n').digest('hex');
      approved.auditVerdict = 'approved-migrated';
      await writeManifest(root, manifest);
      expectFailure(runValidator(root), 1, [objectId]);
    });
  });
});
