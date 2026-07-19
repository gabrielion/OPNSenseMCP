// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { devNull } from 'node:os';
import { join, resolve } from 'node:path';

const MANIFEST_ARGUMENT = 'docs/provenance/migration-manifest.json';
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_GIT_OUTPUT_BYTES = 32 * 1024 * 1024;
const DIGEST = /^[a-f0-9]{64}$/u;
const TOP_LEVEL_KEYS = ['schemaVersion', 'assets'];
const ASSET_KEYS = ['destination', 'class', 'contentSha256', 'auditVerdict'];
let inventoryContract;

class ProvenanceFailure extends Error {
  constructor(code, exitCode) {
    super(code);
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(code = 'PROVENANCE_MANIFEST', exitCode = 1) {
  throw new ProvenanceFailure(code, exitCode);
}

async function loadInventoryContract() {
  let loaded;
  try {
    loaded = await import('./inventory.mjs');
  } catch {
    fail();
  }
  if (
    !Array.isArray(loaded.MIGRATION_INVENTORY) ||
    loaded.MIGRATION_CLASS_COUNTS === null ||
    typeof loaded.MIGRATION_CLASS_COUNTS !== 'object' ||
    typeof loaded.compareDestinations !== 'function' ||
    typeof loaded.isPortableDestination !== 'function' ||
    typeof loaded.portableCollisionKey !== 'function'
  ) {
    fail();
  }
  return {
    inventory: loaded.MIGRATION_INVENTORY,
    counts: loaded.MIGRATION_CLASS_COUNTS,
    collisionKey: loaded.portableCollisionKey,
    compare: loaded.compareDestinations,
    isPortable: loaded.isPortableDestination
  };
}

function requireInventoryContract() {
  if (inventoryContract === undefined) fail();
  return inventoryContract;
}

function gitEnvironment() {
  const environment = Object.fromEntries(
    ['ComSpec', 'PATH', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'TMPDIR', 'WINDIR']
      .map((key) => [key, process.env[key]])
      .filter((entry) => typeof entry[1] === 'string')
  );
  environment.GIT_ATTR_NOSYSTEM = '1';
  environment.GIT_CONFIG_GLOBAL = devNull;
  environment.GIT_CONFIG_NOSYSTEM = '1';
  environment.GIT_LITERAL_PATHSPECS = '1';
  environment.GIT_NO_REPLACE_OBJECTS = '1';
  environment.GIT_OPTIONAL_LOCKS = '0';
  environment.LC_ALL = 'C';
  return environment;
}

function runGit(root, arguments_) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...arguments_], {
    cwd: root,
    encoding: null,
    env: gitEnvironment(),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    shell: false,
    timeout: 10_000
  });

  return result;
}

function requireGit(root, arguments_, code = 'PROVENANCE_MANIFEST', exitCode = 1) {
  const result = runGit(root, arguments_);
  if (result.error !== undefined || result.signal !== null || result.status !== 0)
    fail(code, exitCode);
  return result.stdout;
}

async function requireRepositoryRoot() {
  let root;
  try {
    root = await realpath(resolve(process.cwd()));
  } catch {
    fail('PROVENANCE_REPOSITORY', 2);
  }

  const result = runGit(root, ['rev-parse', '--show-toplevel']);
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    fail('PROVENANCE_REPOSITORY', 2);
  }

  let gitRoot;
  try {
    gitRoot = await realpath(result.stdout.toString('utf8').trim());
  } catch {
    fail('PROVENANCE_REPOSITORY', 2);
  }
  if (gitRoot !== root) fail('PROVENANCE_REPOSITORY', 2);
  return root;
}

function foldedName(value) {
  return requireInventoryContract().collisionKey(value);
}

function createFilesystemInspector(root) {
  const directoryCache = new Map();

  async function entries(directory) {
    let cached = directoryCache.get(directory);
    if (cached === undefined) {
      try {
        cached = await readdir(directory);
      } catch {
        fail();
      }
      directoryCache.set(directory, cached);
    }
    return cached;
  }

  return async function inspect(destination) {
    let current = root;
    const segments = destination.split('/');

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const names = await entries(current);
      const foldedMatches = names.filter((name) => foldedName(name) === foldedName(segment));
      const exactMatches = foldedMatches.filter((name) => name === segment);
      if (foldedMatches.length > 1 || (foldedMatches.length === 1 && exactMatches.length === 0))
        fail();
      if (exactMatches.length === 0) return { exists: false };

      current = join(current, segment);
      let stats;
      try {
        stats = await lstat(current);
      } catch {
        fail();
      }
      if (stats.isSymbolicLink()) fail();

      const leaf = index === segments.length - 1;
      if (!leaf && !stats.isDirectory()) fail();
      if (leaf) return { exists: true, stats };
    }

    fail();
  };
}

function hasExactKeys(value, expected) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function lifecycleIsValid(asset) {
  if (asset.class === 'approved') {
    return (
      (asset.contentSha256 === null && asset.auditVerdict === 'approved-pending-migration') ||
      (typeof asset.contentSha256 === 'string' &&
        DIGEST.test(asset.contentSha256) &&
        asset.auditVerdict === 'approved-migrated')
    );
  }
  if (asset.class === 'rewrite') {
    return (
      (asset.contentSha256 === null && asset.auditVerdict === 'pending-independent-rewrite') ||
      (typeof asset.contentSha256 === 'string' &&
        DIGEST.test(asset.contentSha256) &&
        asset.auditVerdict === 'independently-rewritten')
    );
  }
  return (
    asset.class === 'discard' && asset.contentSha256 === null && asset.auditVerdict === 'discarded'
  );
}

function parseAndValidateManifest(raw) {
  const contract = requireInventoryContract();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail();
  }
  if (
    !hasExactKeys(parsed, TOP_LEVEL_KEYS) ||
    parsed.schemaVersion !== 1 ||
    !Array.isArray(parsed.assets)
  ) {
    fail();
  }
  if (parsed.assets.length !== contract.inventory.length) fail();

  const seen = new Set();
  const folded = new Set();
  const counts = { approved: 0, rewrite: 0, discard: 0 };
  const canonicalAssets = [];
  let previous;

  for (let index = 0; index < parsed.assets.length; index += 1) {
    const asset = parsed.assets[index];
    const expected = contract.inventory[index];
    if (!hasExactKeys(asset, ASSET_KEYS) || typeof asset.destination !== 'string') fail();
    if (!contract.isPortable(asset.destination)) fail();
    if (
      seen.has(asset.destination) ||
      folded.has(foldedName(asset.destination)) ||
      (previous !== undefined && contract.compare(previous, asset.destination) >= 0)
    ) {
      fail();
    }
    if (asset.destination !== expected.destination || asset.class !== expected.class) fail();
    if (!lifecycleIsValid(asset)) fail();

    seen.add(asset.destination);
    folded.add(foldedName(asset.destination));
    counts[asset.class] += 1;
    previous = asset.destination;
    canonicalAssets.push({
      destination: asset.destination,
      class: asset.class,
      contentSha256: asset.contentSha256,
      auditVerdict: asset.auditVerdict
    });
  }

  if (
    counts.approved !== contract.counts.approved ||
    counts.rewrite !== contract.counts.rewrite ||
    counts.discard !== contract.counts.discard
  ) {
    fail();
  }

  const canonical = `${JSON.stringify({ schemaVersion: 1, assets: canonicalAssets }, null, 2)}\n`;
  if (canonical !== raw) fail();
  return { assets: canonicalAssets, counts };
}

function indexEntries(root, destination) {
  const output = requireGit(root, ['ls-files', '--stage', '-z', '--', destination]);
  if (output.length === 0) return [];

  return output
    .toString('utf8')
    .split('\0')
    .filter((record) => record.length > 0)
    .map((record) => {
      const match = /^(\d{6}) ([0-9a-f]+) ([0-3])\t([\s\S]+)$/u.exec(record);
      if (match === null) fail();
      return { mode: match[1], objectId: match[2], stage: match[3], destination: match[4] };
    });
}

function worktreeIsClean(root, destination) {
  const result = runGit(root, [
    'diff',
    '--quiet',
    '--no-ext-diff',
    '--no-textconv',
    '--',
    destination
  ]);
  if (result.error !== undefined || result.signal !== null || result.status === null) fail();
  if (result.status > 1) fail();
  return result.status === 0;
}

function verifySealedIndex(root, asset) {
  const entries = indexEntries(root, asset.destination);
  if (
    entries.length !== 1 ||
    entries[0].stage !== '0' ||
    !['100644', '100755'].includes(entries[0].mode) ||
    entries[0].destination !== asset.destination ||
    !worktreeIsClean(root, asset.destination)
  ) {
    fail();
  }

  const blob = requireGit(root, ['cat-file', 'blob', entries[0].objectId]);
  const actual = createHash('sha256').update(blob).digest('hex');
  if (actual !== asset.contentSha256 || !worktreeIsClean(root, asset.destination)) fail();
}

async function verifyManifest(root) {
  const inspect = createFilesystemInspector(root);
  const manifestState = await inspect(MANIFEST_ARGUMENT);
  if (!manifestState.exists || !manifestState.stats.isFile()) fail();
  if (manifestState.stats.size > MAX_MANIFEST_BYTES) fail();

  let raw;
  try {
    raw = await readFile(join(root, MANIFEST_ARGUMENT), 'utf8');
  } catch {
    fail();
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_MANIFEST_BYTES) fail();

  const manifest = parseAndValidateManifest(raw);
  let pending = 0;
  let sealed = 0;

  for (const asset of manifest.assets) {
    const state = await inspect(asset.destination);
    if (state.exists && !state.stats.isFile()) fail();

    if (asset.class === 'discard') {
      if (state.exists || indexEntries(root, asset.destination).length !== 0) fail();
      continue;
    }

    if (asset.contentSha256 === null) {
      pending += 1;
      continue;
    }

    if (!state.exists) fail();
    verifySealedIndex(root, asset);
    sealed += 1;
  }

  process.stdout.write(
    `PROVENANCE_OK approved=${String(manifest.counts.approved)} rewrite=${String(
      manifest.counts.rewrite
    )} discard=${String(manifest.counts.discard)} pending=${String(pending)} sealed=${String(sealed)}\n`
  );
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== MANIFEST_ARGUMENT) {
    fail('PROVENANCE_USAGE', 2);
  }
  inventoryContract = await loadInventoryContract();
  const root = await requireRepositoryRoot();
  await verifyManifest(root);
}

try {
  await main();
} catch (error) {
  const failure =
    error instanceof ProvenanceFailure ? error : new ProvenanceFailure('PROVENANCE_INTERNAL', 1);
  process.stderr.write(`${failure.code}\n`);
  process.exitCode = failure.exitCode;
}
