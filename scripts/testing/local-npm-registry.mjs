// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, join, resolve, sep } from 'node:path';

const TAR = '/usr/bin/tar';
const TAR_TIMEOUT_MS = 30_000;
const LISTEN_TIMEOUT_MS = 10_000;
/**
 * Worst-case time the fixture may spend before it is serving: one archiver budget per locked
 * package plus the listen budget. A consumer's outer timeout must exceed this.
 */
export const REGISTRY_BUDGET_MS = TAR_TIMEOUT_MS + LISTEN_TIMEOUT_MS;
const MANIFEST_FIELDS = [
  'name',
  'version',
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'engines',
  'bin',
  'os',
  'cpu',
  'license'
];

function lockEntries(lock) {
  const packages = lock?.packages;
  if (typeof packages !== 'object' || packages === null) throw new Error('Unreadable lock file');
  return Object.entries(packages)
    .filter(([path, meta]) => path !== '' && meta?.dev !== true && meta?.link !== true)
    .map(([path, meta]) => {
      const marker = 'node_modules/';
      const index = path.lastIndexOf(marker);
      if (!path.startsWith(marker) || index < 0) {
        throw new Error(`Unsupported lock entry: ${path}`);
      }
      const name = path.slice(index + marker.length);
      if (typeof meta.version !== 'string' || meta.version === '') {
        throw new Error(`Lock entry without a version: ${path}`);
      }
      if (meta.name !== undefined && meta.name !== name) {
        throw new Error(`Lock entry name mismatch: ${path}`);
      }
      return { installPath: path, name, version: meta.version };
    });
}

export function lockProductionProjection(lock) {
  return Object.freeze([
    ...new Set(lockEntries(lock).map(({ name, version }) => `${name}@${version}`))
  ]);
}

function uniqueEntries(entries) {
  const unique = new Map();
  for (const entry of entries) {
    const key = `${entry.name}@${entry.version}`;
    if (!unique.has(key)) unique.set(key, entry);
  }
  return [...unique.values()];
}

async function verifiedPackage(repositoryRoot, entry) {
  const directory = resolve(repositoryRoot, entry.installPath);
  if (directory !== join(repositoryRoot, ...entry.installPath.split('/'))) {
    throw new Error(`Non-canonical package path: ${entry.installPath}`);
  }
  if (!directory.startsWith(`${repositoryRoot}${sep}`)) {
    throw new Error(`Package path escapes the repository: ${entry.installPath}`);
  }
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.name !== entry.name || manifest.version !== entry.version) {
    throw new Error(`Installed identity mismatch for ${entry.name}@${entry.version}`);
  }
  return { ...entry, directory, manifest };
}

function runTar(argumentsList) {
  return new Promise((resolveTar, rejectTar) => {
    const child = spawn(TAR, argumentsList, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(0, 512);
    });
    child.once('error', () => {
      finish(() => rejectTar(new Error('Fixture archiver is unavailable')));
    });
    child.once('close', (code, signal) => {
      finish(() => {
        if (code === 0 && signal === null) {
          resolveTar();
          return;
        }
        rejectTar(
          new Error(`Fixture archiver failed (${String(code)}/${String(signal)}): ${stderr}`)
        );
      });
    });
    // A hung archiver must fail closed rather than stall a suite until its outer timeout.
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      finish(() => rejectTar(new Error('Fixture archiver timed out')));
    }, TAR_TIMEOUT_MS);
    deadline.unref();
  });
}

async function packPackage(pkg, index, workRoot) {
  const stage = join(workRoot, 'stage', String(index));
  const contents = join(stage, 'package');
  await mkdir(stage, { mode: 0o700, recursive: true });
  await cp(pkg.directory, contents, { recursive: true, dereference: false });
  await rm(join(contents, 'node_modules'), { force: true, recursive: true });
  const file = `${pkg.name.replace('/', '+')}-${pkg.version}.tgz`;
  const archive = join(workRoot, 'tarballs', file);
  await runTar(['-czf', archive, '-C', stage, 'package']);
  const bytes = await readFile(archive);
  await rm(stage, { force: true, recursive: true });
  return {
    file,
    bytes,
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    shasum: createHash('sha1').update(bytes).digest('hex')
  };
}

function versionManifest(pkg, url) {
  const manifest = Object.fromEntries(
    MANIFEST_FIELDS.filter((field) => pkg.manifest[field] !== undefined).map((field) => [
      field,
      pkg.manifest[field]
    ])
  );
  return {
    ...manifest,
    name: pkg.name,
    version: pkg.version,
    dist: {
      tarball: `${url}tarballs/${pkg.file}`,
      integrity: pkg.integrity,
      shasum: pkg.shasum
    }
  };
}

function highestVersion(versions) {
  return [...versions]
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }))
    .at(-1);
}

/**
 * npm asks the registry about optional peer dependencies that the lock deliberately does not
 * install, so their absence is part of the lock-derived contract rather than an unknown request.
 * A missing REQUIRED peer is a fixture defect and fails closed here.
 */
export function lockExpectedAbsentNames(lock) {
  const entries = lockEntries(lock);
  const locked = new Set(entries.map(({ name }) => name));
  const absent = new Set();
  for (const [path, meta] of Object.entries(lock.packages ?? {})) {
    if (path === '' || meta?.dev === true || meta?.link === true) continue;
    for (const name of Object.keys(meta.peerDependencies ?? {})) {
      if (locked.has(name)) continue;
      if (meta.peerDependenciesMeta?.[name]?.optional !== true) {
        throw new Error(`Required peer dependency ${name} is absent from the lock (${path})`);
      }
      absent.add(name);
    }
  }
  return Object.freeze([...absent]);
}

export async function startLocalNpmRegistry(options) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const workRoot = resolve(options.workRoot);
  await mkdir(join(workRoot, 'tarballs'), { mode: 0o700, recursive: true });
  const lock = JSON.parse(await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'));
  const expectedAbsent = new Set(lockExpectedAbsentNames(lock));
  const entries = uniqueEntries(lockEntries(lock));
  const packages = [];
  for (const [index, entry] of entries.entries()) {
    const verified = await verifiedPackage(repositoryRoot, entry);
    packages.push({ ...verified, ...(await packPackage(verified, index, workRoot)) });
  }

  const requests = [];
  const unknown = [];
  const absent = [];
  const tarballs = new Map(packages.map((pkg) => [`/tarballs/${pkg.file}`, pkg]));
  const byName = new Map();
  for (const pkg of packages) {
    const existing = byName.get(pkg.name) ?? [];
    byName.set(pkg.name, [...existing, pkg]);
  }

  let url = '';
  const server = createServer((request, response) => {
    let path;
    try {
      path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    } catch {
      path = request.url ?? '/';
    }
    const line = `${request.method ?? ''} ${path}`;
    requests.push(line);
    const tarball = tarballs.get(path);
    if (request.method === 'GET' && tarball !== undefined) {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.end(tarball.bytes);
      return;
    }
    const versions = byName.get(path.startsWith('/') ? path.slice(1) : path);
    if (request.method === 'GET' && versions !== undefined) {
      const document = {
        name: versions[0].name,
        'dist-tags': { latest: highestVersion(versions.map(({ version }) => version)) },
        versions: Object.fromEntries(
          versions.map((pkg) => [pkg.version, versionManifest(pkg, url)])
        )
      };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(document));
      return;
    }
    const requested = path.startsWith('/') ? path.slice(1) : path;
    if (request.method === 'GET' && expectedAbsent.has(requested)) {
      absent.push(line);
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end('{"error":"Deliberately absent optional peer dependency"}');
      return;
    }
    unknown.push(line);
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{"error":"Not found in the lock-derived fixture registry"}');
  });
  const closeServer = () =>
    new Promise((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
  server.listen(0, '127.0.0.1');
  try {
    // A listen error or a hung bind must fail closed instead of never settling.
    await Promise.race([
      once(server, 'listening'),
      once(server, 'error').then((error) => {
        throw error instanceof Error ? error : new Error('Registry startup failed');
      }),
      new Promise((_resolveTimeout, rejectTimeout) => {
        const timer = setTimeout(
          () => rejectTimeout(new Error('Registry startup timed out')),
          LISTEN_TIMEOUT_MS
        );
        timer.unref();
      })
    ]);
  } catch (error) {
    await closeServer();
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer();
    throw new Error('Registry startup failed');
  }
  url = `http://127.0.0.1:${String(address.port)}/`;

  return {
    url,
    port: address.port,
    packages: Object.freeze(
      packages.map((pkg) =>
        Object.freeze({
          name: pkg.name,
          version: pkg.version,
          installPath: pkg.installPath,
          integrity: pkg.integrity,
          shasum: pkg.shasum,
          tarballBytes: pkg.bytes.byteLength
        })
      )
    ),
    expectedAbsentNames: Object.freeze([...expectedAbsent]),
    requests: () => Object.freeze([...requests]),
    unknownRequests: () => Object.freeze([...unknown]),
    absentRequests: () => Object.freeze([...absent]),
    close: async () => {
      await new Promise((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error === undefined) resolveClose();
          else rejectClose(error);
        });
        server.closeAllConnections();
      });
      await rm(join(workRoot, 'tarballs'), { force: true, recursive: true });
      await rm(join(workRoot, 'stage'), { force: true, recursive: true });
    }
  };
}

export const FIXTURE_ARCHIVER = TAR;
export const FIXTURE_TARBALL_NAME = (name, version) =>
  `${basename(name.replace('/', '+'))}-${version}.tgz`;
