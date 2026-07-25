// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import {
  access,
  chmod,
  cp,
  mkdir,
  opendir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  REGISTRY_BUDGET_MS,
  lockProductionProjection,
  startLocalNpmRegistry
} from './local-npm-registry.mjs';

export const PACKAGE_INPUTS = Object.freeze([
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'src',
  'scripts',
  'tsconfig.json',
  'tsconfig.build.json'
]);

const DIAGNOSTIC_LIMIT = 512;
export const PACKED_FILE_MODE = 0o644;
export const PACKED_DIRECTORY_MODE = 0o755;
export const BUILD_TIMEOUT_MS = 120_000;
export const PACK_TIMEOUT_MS = 120_000;
export const INSTALL_TIMEOUT_MS = 180_000;
export const LIST_TIMEOUT_MS = 60_000;
/** Every child budget the helper owns; a consumer's outer timeout must exceed this sum. */
export const PREPARATION_BUDGET_MS =
  BUILD_TIMEOUT_MS + PACK_TIMEOUT_MS + INSTALL_TIMEOUT_MS + LIST_TIMEOUT_MS + REGISTRY_BUDGET_MS;
const INSTALLED_BIN_PREFIX = Buffer.from(
  '#!/usr/bin/env node\n// SPDX-License-Identifier: AGPL-3.0-or-later\n',
  'utf8'
);

/**
 * Command failures must expose their causal exit code and a bounded stderr tail, never a fixed
 * "npm install failed" that hides the real error. Private absolute paths are redacted first.
 */
export function redactedCommandFailure(label, result, secrets) {
  const tail = `${result.stderr ?? ''}`.slice(-DIAGNOSTIC_LIMIT);
  const redacted = secrets
    .filter((secret) => typeof secret === 'string' && secret !== '')
    .reduce((text, secret) => text.split(secret).join('<redacted>'), tail)
    .replace(/[^\t\n -~]/gu, '?');
  return new Error(
    `${label} failed (exit ${String(result.code)}, signal ${String(result.signal)}): ${redacted}`
  );
}

function isolatedNpmEnvironment(paths, registryUrl, extra = {}) {
  return {
    PATH: process.env.PATH ?? '',
    LANG: process.env.LANG ?? 'C.UTF-8',
    HOME: paths.home,
    npm_config_cache: paths.cache,
    npm_config_userconfig: paths.userconfig,
    npm_config_globalconfig: paths.globalconfig,
    npm_config_registry: registryUrl,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    npm_config_fetch_retries: '0',
    npm_config_loglevel: 'error',
    npm_config_proxy: 'http://127.0.0.1:1/',
    npm_config_https_proxy: 'http://127.0.0.1:1/',
    npm_config_noproxy: '127.0.0.1,localhost',
    ...extra
  };
}

function installedGraph(node, collected = new Set()) {
  const dependencies = node?.dependencies;
  if (typeof dependencies !== 'object' || dependencies === null) return collected;
  for (const [name, entry] of Object.entries(dependencies)) {
    if (typeof entry?.version === 'string') collected.add(`${name}@${entry.version}`);
    installedGraph(entry, collected);
  }
  return collected;
}

/**
 * npm's portable tar normalization is `mode = (mode | 0o600) & ~0o22`: it collapses 0644 and 0664,
 * but PRESERVES the group/other read bits. A host with umask 027 would therefore pack 0640 and
 * produce a different archive digest for byte-identical content. Normalizing the tree before
 * packing makes the packed identity a function of content alone, on any umask.
 */
export async function normalizeTreeModes(root) {
  const directory = await opendir(root);
  for await (const entry of directory) {
    if (entry.isSymbolicLink()) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      await chmod(path, PACKED_DIRECTORY_MODE);
      await normalizeTreeModes(path);
    } else if (entry.isFile()) {
      await chmod(path, PACKED_FILE_MODE);
    }
  }
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requiredNpmCli() {
  const npmCli = process.env.npm_execpath;
  if (typeof npmCli !== 'string' || npmCli === '') throw new Error('npm CLI path is unavailable');
  return npmCli;
}

/**
 * The exact argv of the hermetic consumer install. Network isolation and the complete local
 * fixture, not npm's cache mode, prove that the installed package has no Internet dependency.
 */
export function hermeticInstallArguments(archive) {
  return Object.freeze(['install', '--ignore-scripts', '--no-audit', '--no-fund', archive]);
}

/**
 * Packs the repository package and installs it into a fully isolated consumer served only by the
 * lock-derived loopback registry. The CONSUMER INSTALL has no fallback to a user npm cache, public
 * registry, proxy, or developer working-tree module.
 *
 * The pack step is deliberately different: `prepack` runs `tsc` against the repository's own
 * `node_modules` (the `npm ci --ignore-scripts` tree), exactly as the design specifies, so the
 * archive's bytes are a function of that tree. Fixture tarballs are repacked from the same tree
 * and are therefore not integrity-verified against the lock; "hermetic" here means no network, not
 * a supply-chain proof.
 */
export async function prepareInstalledPackage(options) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const workRoot = resolve(options.workRoot);
  const run = options.run;
  const packageCopy = join(workRoot, 'package');
  const consumer = join(workRoot, 'consumer');
  const paths = {
    home: join(workRoot, 'home'),
    cache: join(workRoot, 'cache'),
    userconfig: join(workRoot, 'home', '.npmrc'),
    globalconfig: join(workRoot, 'home', 'globalrc')
  };
  await Promise.all(
    [packageCopy, consumer, paths.home, paths.cache].map((path) =>
      mkdir(path, { mode: 0o700, recursive: true })
    )
  );
  await Promise.all(
    [paths.userconfig, paths.globalconfig].map((path) => writeFile(path, '', { mode: 0o600 }))
  );
  await Promise.all(
    PACKAGE_INPUTS.map((input) =>
      cp(join(repositoryRoot, input), join(packageCopy, input), { recursive: true })
    )
  );
  await symlink(join(repositoryRoot, 'node_modules'), join(packageCopy, 'node_modules'), 'dir');

  const manifest = JSON.parse(await readFile(join(packageCopy, 'package.json'), 'utf8'));
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('Package identity is unavailable');
  }
  // The copy must carry no pre-built output, so the packed archive can only contain what this
  // run's `prepack` produced.
  if (await pathExists(join(packageCopy, 'dist'))) {
    throw new Error('Package copy already contains a built dist directory');
  }
  const npmCli = requiredNpmCli();
  const registry = await startLocalNpmRegistry({ repositoryRoot, workRoot });
  const secrets = [workRoot, repositoryRoot];
  let prepared;
  try {
    // Build and pack are separate steps so the emitted tree can be mode-normalized in between;
    // `npm pack` alone would run `prepack` and read the freshly built modes before we could.
    const built = await run(process.execPath, [npmCli, 'run', 'build'], {
      cwd: packageCopy,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: BUILD_TIMEOUT_MS
    });
    if (built.code !== 0 || built.signal !== null) {
      throw redactedCommandFailure('npm run build', built, secrets);
    }
    await normalizeTreeModes(packageCopy);
    const packed = await run(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts'], {
      cwd: packageCopy,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: PACK_TIMEOUT_MS
    });
    if (packed.code !== 0 || packed.signal !== null) {
      throw redactedCommandFailure('npm pack', packed, secrets);
    }
    const archives = (await readdir(packageCopy)).filter((entry) => entry.endsWith('.tgz'));
    if (archives.length !== 1) throw new Error('npm pack output was not unique');
    const archive = join(packageCopy, archives[0]);
    const archiveBytes = await readFile(archive);
    const archiveSha256 = createHash('sha256').update(archiveBytes).digest('hex');
    // The gzip layer is NOT reproducible across platforms: different zlib builds deflate the same
    // bytes differently, so a .tgz digest can only ever match the host that produced it. The
    // uncompressed archive was verified byte-identical on macOS and on Linux (node:22.23.1), and
    // the mode normalization above removes the remaining umask dependency, so this digest is the
    // identity of the packaged content rather than of the packing host.
    const archiveTarSha256 = createHash('sha256').update(gunzipSync(archiveBytes)).digest('hex');

    await writeFile(
      join(consumer, 'package.json'),
      `${JSON.stringify(
        { name: 'opnsense-mcp-consumer', version: '0.0.0', private: true },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
    const installed = await run(process.execPath, [npmCli, ...hermeticInstallArguments(archive)], {
      cwd: consumer,
      environment: isolatedNpmEnvironment(paths, registry.url, {
        npm_config_ignore_scripts: 'true'
      }),
      timeoutMs: INSTALL_TIMEOUT_MS
    });
    if (installed.code !== 0 || installed.signal !== null) {
      throw redactedCommandFailure('npm install', installed, secrets);
    }

    const listed = await run(process.execPath, [npmCli, 'ls', '--all', '--json', '--omit=dev'], {
      cwd: consumer,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: LIST_TIMEOUT_MS
    });
    if (listed.code !== 0 || listed.signal !== null) {
      throw redactedCommandFailure('npm ls', listed, secrets);
    }
    const lock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'));
    const expected = [...lockProductionProjection(lock)].sort();
    const observed = [...installedGraph(JSON.parse(listed.stdout))]
      .filter((entry) => entry !== `${manifest.name}@${manifest.version}`)
      .sort();
    if (observed.join('\n') !== expected.join('\n')) {
      const missing = expected.filter((entry) => !observed.includes(entry));
      const unexpected = observed.filter((entry) => !expected.includes(entry));
      throw new Error(
        `Installed production graph differs from the committed lock projection; missing ${JSON.stringify(missing)}, unexpected ${JSON.stringify(unexpected)}`
      );
    }

    const installedTarget = join(consumer, 'node_modules', manifest.name, 'dist/main.js');
    const emitted = await readFile(installedTarget);
    if (!emitted.subarray(0, INSTALLED_BIN_PREFIX.length).equals(INSTALLED_BIN_PREFIX)) {
      throw new Error('Installed bin target lost its shebang or licence header');
    }
    const unknown = registry.unknownRequests();
    if (unknown.length !== 0) {
      throw new Error(
        `Fixture registry saw ${String(unknown.length)} unknown request(s): ${unknown.slice(0, 5).join(', ')}`
      );
    }

    prepared = {
      archiveSha256,
      archiveTarSha256,
      packageName: manifest.name,
      packageVersion: manifest.version,
      installedCommand: Object.freeze({
        command: join(consumer, 'node_modules/.bin/opnsense-mcp'),
        arguments: Object.freeze([])
      }),
      installedTarget,
      consumerRoot: consumer,
      registryUnknownRequests: unknown,
      cleanup: async () => {
        await registry.close();
        await rm(packageCopy, { force: true, recursive: true });
        await rm(consumer, { force: true, recursive: true });
        await rm(paths.home, { force: true, recursive: true });
        await rm(paths.cache, { force: true, recursive: true });
      }
    };
  } finally {
    if (prepared === undefined) {
      await registry.close().catch(() => undefined);
    }
  }
  return prepared;
}
