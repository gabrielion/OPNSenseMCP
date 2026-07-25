// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { lockProductionProjection, startLocalNpmRegistry } from './local-npm-registry.mjs';

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

function requiredNpmCli() {
  const npmCli = process.env.npm_execpath;
  if (typeof npmCli !== 'string' || npmCli === '') throw new Error('npm CLI path is unavailable');
  return npmCli;
}

/**
 * Packs the repository package and installs it into a fully isolated consumer served only by the
 * lock-derived loopback registry. No user npm cache, public registry, proxy, or developer
 * working-tree module is a fallback.
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
  const npmCli = requiredNpmCli();
  const registry = await startLocalNpmRegistry({ repositoryRoot, workRoot });
  const secrets = [workRoot, repositoryRoot];
  let prepared;
  try {
    const packed = await run(process.execPath, [npmCli, 'pack', '--json'], {
      cwd: packageCopy,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: 180_000
    });
    if (packed.code !== 0 || packed.signal !== null) {
      throw redactedCommandFailure('npm pack', packed, secrets);
    }
    const archives = (await readdir(packageCopy)).filter((entry) => entry.endsWith('.tgz'));
    if (archives.length !== 1) throw new Error('npm pack output was not unique');
    const archive = join(packageCopy, archives[0]);
    const archiveSha256 = createHash('sha256')
      .update(await readFile(archive))
      .digest('hex');

    await writeFile(
      join(consumer, 'package.json'),
      `${JSON.stringify(
        { name: 'opnsense-mcp-consumer', version: '0.0.0', private: true },
        null,
        2
      )}\n`,
      { mode: 0o600 }
    );
    const installed = await run(
      process.execPath,
      [npmCli, 'install', '--ignore-scripts', '--no-audit', '--no-fund', archive],
      {
        cwd: consumer,
        environment: isolatedNpmEnvironment(paths, registry.url, {
          npm_config_ignore_scripts: 'true'
        }),
        timeoutMs: 300_000
      }
    );
    if (installed.code !== 0 || installed.signal !== null) {
      throw redactedCommandFailure('npm install', installed, secrets);
    }

    const listed = await run(process.execPath, [npmCli, 'ls', '--all', '--json', '--omit=dev'], {
      cwd: consumer,
      environment: isolatedNpmEnvironment(paths, registry.url),
      timeoutMs: 120_000
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
