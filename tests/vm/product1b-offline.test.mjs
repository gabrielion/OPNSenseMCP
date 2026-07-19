// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IMAGE_SPEC,
  Product1bImageError,
  downloadArchive,
  doctorHost,
  formatDoctorReport,
  formatImageFailure,
  prepareImage
} from '../../scripts/vm/product1b.mjs';

const roots = [];

async function temporaryRoot() {
  const root = await mkdtemp(join(tmpdir(), 'opnsense-product1b-offline-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function commandResult(stdout = '') {
  return { ok: true, missing: false, stdout };
}

function fixtureSpec(archiveBytes = Buffer.from('fixture archive', 'utf8')) {
  return {
    release: 'fixture',
    archiveName: 'fixture.img.bz2',
    rawName: 'fixture.img',
    url: 'https://example.invalid/fixture.img.bz2',
    archiveBytes: archiveBytes.byteLength,
    archiveSha256: createHash('sha256').update(archiveBytes).digest('hex'),
    rawMaxBytes: 1024
  };
}

function fakeDownload(bytes, onCall = () => undefined) {
  return async ({ destination, url, maxBytes }) => {
    onCall({ url, maxBytes });
    await writeFile(destination, bytes);
  };
}

function fakeDecompress(bytes = Buffer.from('raw image', 'utf8')) {
  return async ({ destination }) => {
    await writeFile(destination, bytes);
  };
}

async function waitForFile(path) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error('fixture child did not reach the requested phase');
}

async function runInterruptedCli({ signal, phase }) {
  const root = await temporaryRoot();
  const cacheRoot = join(root, 'cache');
  const bin = join(root, 'bin');
  const marker = join(root, 'phase-ready');
  const archive = Buffer.from('fixture archive', 'utf8');
  const spec = fixtureSpec(archive);
  await mkdir(cacheRoot);
  await mkdir(bin);

  const markerCommand = `: > ${JSON.stringify(marker)}`;
  const curlBody =
    phase === 'curl'
      ? `printf %s ${JSON.stringify(archive.toString('utf8'))}\n${markerCommand}\nexec sleep 30\n`
      : `printf %s ${JSON.stringify(archive.toString('utf8'))}\n`;
  const bzip2Body =
    phase === 'bzip2'
      ? `printf partial-raw\n${markerCommand}\nexec sleep 30\n`
      : 'printf raw-image\n';
  await writeFile(join(bin, 'curl'), `#!/bin/sh\n${curlBody}`, { mode: 0o755 });
  await writeFile(join(bin, 'bzip2'), `#!/bin/sh\n${bzip2Body}`, { mode: 0o755 });

  const moduleUrl = new URL('../../scripts/vm/product1b.mjs', import.meta.url).href;
  const source = [
    `import { runPrepareImageCli } from ${JSON.stringify(moduleUrl)};`,
    `const spec = ${JSON.stringify(spec)};`,
    'process.exitCode = await runPrepareImageCli({',
    '  cacheRoot: process.env.PRODUCT1B_TEST_CACHE,',
    '  spec',
    '});'
  ].join('\n');
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    env: {
      PATH: `${bin}:/bin:/usr/bin`,
      PRODUCT1B_TEST_CACHE: cacheRoot,
      PRODUCT1B_SECRET_SENTINEL: '/private/cache PRODUCT_1B_SECRET_SENTINEL'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  await waitForFile(marker);
  child.kill(signal);
  const outcome = await Promise.race([
    new Promise((resolve) =>
      child.once('close', (code, childSignal) => resolve({ code, childSignal }))
    ),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('interrupted CLI did not close in time')), 3000)
    )
  ]);

  return { cacheRoot, spec, stdout, stderr, outcome };
}

async function expectImageError(promise, code) {
  try {
    await promise;
    throw new Error('expected prepareImage to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(Product1bImageError);
    expect(error.code).toBe(code);
    return error;
  }
}

describe('Product 1B host doctor', () => {
  it('exposes separate diagnostic and image-preparation npm commands', async () => {
    const packageJson = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    );

    expect(packageJson.scripts['vm:doctor']).toBe('node scripts/vm/product1b.mjs doctor');
    expect(packageJson.scripts['vm:prepare-image']).toBe(
      'node scripts/vm/product1b.mjs prepare-image'
    );
  });

  it('checks only the four required commands and selects the host accelerator', () => {
    const calls = [];
    const report = doctorHost({
      platform: 'darwin',
      nodeVersion: 'v22.23.1',
      runCommand(command, arguments_) {
        calls.push([command, arguments_]);
        return commandResult(
          command === 'qemu-system-x86_64'
            ? 'Accelerators supported in QEMU binary:\nhvf\ntcg\n'
            : 'available\n'
        );
      }
    });

    expect(report).toEqual({
      ready: true,
      node: 'ready',
      host: 'macos',
      commands: {
        'qemu-system-x86_64': 'ready',
        'qemu-img': 'ready',
        curl: 'ready',
        bzip2: 'ready'
      },
      accelerator: 'hvf'
    });
    expect(calls).toEqual([
      ['qemu-system-x86_64', ['-accel', 'help']],
      ['qemu-img', ['--version']],
      ['curl', ['--version']],
      ['bzip2', ['--help']]
    ]);
    expect(formatDoctorReport(report)).toBe(
      [
        'Product 1B host: READY',
        'Node 22: ready',
        'Host: macOS',
        'qemu-system-x86_64: ready',
        'qemu-img: ready',
        'curl: ready',
        'bzip2: ready',
        'Accelerator: hvf'
      ].join('\n') + '\n'
    );
  });

  it('fails closed on an unsupported host without probing commands', () => {
    const runCommand = vi.fn();
    const report = doctorHost({ platform: 'win32', nodeVersion: 'v22.23.1', runCommand });

    expect(report.ready).toBe(false);
    expect(report.host).toBe('unsupported');
    expect(runCommand).not.toHaveBeenCalled();
    expect(formatDoctorReport(report)).toBe(
      'Product 1B host: NOT READY\nHost: unsupported; use macOS or Linux\n'
    );
  });

  it('gives a fixed actionable result for a missing dependency', () => {
    const report = doctorHost({
      platform: 'linux',
      nodeVersion: 'v22.23.1',
      runCommand(command) {
        if (command === 'qemu-img') return { ok: false, missing: true, stdout: '' };
        return commandResult(
          command === 'qemu-system-x86_64'
            ? 'Accelerators supported in QEMU binary:\nkvm\ntcg\n'
            : ''
        );
      }
    });

    expect(report.ready).toBe(false);
    expect(report.accelerator).toBe('kvm');
    expect(formatDoctorReport(report)).toContain(
      'qemu-img: missing; install the QEMU system and image utilities\n'
    );
  });

  it('never reflects command output, paths, environment values, or secrets', () => {
    const sentinel = '/private/cache PRODUCT_1B_SECRET_SENTINEL';
    const report = doctorHost({
      platform: 'darwin',
      nodeVersion: 'v22.23.1',
      runCommand(command) {
        if (command === 'qemu-system-x86_64') {
          return commandResult(`hvf\ntcg\n${sentinel}`);
        }
        return { ok: false, missing: false, stdout: sentinel };
      }
    });

    const output = formatDoctorReport(report);
    expect(output).not.toContain(sentinel);
    expect(output).not.toContain('/private/cache');
    expect(output).not.toContain('SECRET');
  });
});

describe('Product 1B immutable image cache', () => {
  it('pins the official OPNsense 26.1.6 nano archive', () => {
    expect(IMAGE_SPEC).toMatchObject({
      release: '26.1.6',
      archiveName: 'OPNsense-26.1.6-nano-amd64.img.bz2',
      rawName: 'OPNsense-26.1.6-nano-amd64.img',
      url: 'https://mirror.wdc1.us.leaseweb.net/opnsense/releases/26.1/OPNsense-26.1.6-nano-amd64.img.bz2',
      archiveBytes: 556_631_322,
      archiveSha256: '3c16267c791abfc3e41d5249fcb0c245c03cb91e2f1aa4d53017f0f3454d03a1'
    });
    expect(Object.isFrozen(IMAGE_SPEC)).toBe(true);
  });

  it('downloads to a partial file, verifies it, and installs an immutable raw base atomically', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    const observed = [];

    const result = await prepareImage({
      cacheRoot,
      spec,
      download: fakeDownload(archive, (call) => observed.push(call)),
      decompress: fakeDecompress()
    });

    expect(result).toEqual({ archive: 'downloaded', raw: 'created' });
    expect(observed).toEqual([{ url: spec.url, maxBytes: spec.archiveBytes }]);
    expect(await readFile(join(cacheRoot, spec.archiveName))).toEqual(archive);
    expect((await lstat(join(cacheRoot, spec.rawName))).mode & 0o222).toBe(0);
    expect((await lstat(join(cacheRoot, `${spec.rawName}.integrity.json`))).mode & 0o222).toBe(0);
    expect((await readdir(cacheRoot)).some((name) => name.includes('.partial-'))).toBe(false);
  });

  it('does not miss close from a download command that exits immediately', async () => {
    const root = await temporaryRoot();
    const bin = join(root, 'bin');
    const destination = join(root, 'download.partial');
    await mkdir(bin);
    const argumentsLog = join(root, 'curl-arguments');
    await writeFile(
      join(bin, 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(argumentsLog)}\nprintf fast\n`,
      { mode: 0o755 }
    );
    await writeFile(destination, '');
    const previousPath = process.env.PATH;
    process.env.PATH = bin;
    let closeTimer;

    try {
      await expect(
        Promise.race([
          downloadArchive({ destination, url: 'https://example.invalid/fixed', maxBytes: 4 }),
          new Promise(
            (_, reject) =>
              (closeTimer = setTimeout(() => reject(new Error('download close was missed')), 2000))
          )
        ])
      ).resolves.toBeUndefined();
      expect(await readFile(destination, 'utf8')).toBe('fast');
      expect((await readFile(argumentsLog, 'utf8')).trim().split('\n')).toEqual([
        '--disable',
        '--fail',
        '--silent',
        '--show-error',
        '--location',
        '--proto',
        '=https',
        '--proto-redir',
        '=https',
        '--max-filesize',
        '4',
        '--max-time',
        '900',
        '--output',
        '-',
        'https://example.invalid/fixed'
      ]);
    } finally {
      clearTimeout(closeTimer);
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
    }
  });

  it('gives one concurrent caller exclusive cache ownership and a fixed busy result to the other', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    let releaseDownload;
    let announceDownload;
    const downloadStarted = new Promise((resolve) => {
      announceDownload = resolve;
    });
    const first = prepareImage({
      cacheRoot,
      spec,
      download: async ({ destination }) => {
        await writeFile(destination, archive);
        announceDownload();
        await new Promise((resolve) => {
          releaseDownload = resolve;
        });
      },
      decompress: fakeDecompress()
    });
    await downloadStarted;

    const competingError = await expectImageError(
      prepareImage({
        cacheRoot,
        spec,
        download: vi.fn(),
        decompress: vi.fn()
      }),
      'CACHE_BUSY'
    );
    expect(formatImageFailure(competingError)).toBe(
      'Product 1B image: FAILED; image preparation is already running, retry later\n'
    );

    releaseDownload();
    await expect(first).resolves.toEqual({ archive: 'downloaded', raw: 'created' });
    expect((await readdir(cacheRoot)).some((name) => name.includes('.partial-'))).toBe(false);
    expect((await readdir(cacheRoot)).some((name) => name.includes('.lock'))).toBe(false);
  });

  it('treats an exclusively created lock whose owner record is still being written as busy', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    await writeFile(join(cacheRoot, '.prepare-image.lock'), '', { mode: 0o600 });

    const error = await expectImageError(
      prepareImage({
        cacheRoot,
        spec,
        download: vi.fn(),
        decompress: vi.fn()
      }),
      'CACHE_BUSY'
    );

    expect(formatImageFailure(error)).toBe(
      'Product 1B image: FAILED; image preparation is already running, retry later\n'
    );
    expect(await readdir(cacheRoot)).toEqual(['.prepare-image.lock']);
  });

  it('lets only one caller recover a dead owner and preserves every non-owned cache entry', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    const deadOwner = { schemaVersion: 1, pid: 2_147_483_647, nonce: '0123456789abcdef' };
    const unrelatedName = `.unrelated.partial-${deadOwner.pid}-${deadOwner.nonce}`;
    await writeFile(join(cacheRoot, '.prepare-image.lock'), `${JSON.stringify(deadOwner)}\n`, {
      mode: 0o600
    });
    await writeFile(
      join(cacheRoot, `.${spec.rawName}.partial-${deadOwner.pid}-${deadOwner.nonce}`),
      'owned stale bytes'
    );
    await writeFile(join(cacheRoot, unrelatedName), 'unrelated sentinel');

    const outcomes = await Promise.allSettled([
      prepareImage({
        cacheRoot,
        spec,
        download: fakeDownload(archive),
        decompress: fakeDecompress()
      }),
      prepareImage({
        cacheRoot,
        spec,
        download: fakeDownload(archive),
        decompress: fakeDecompress()
      })
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const refusal = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(refusal?.reason).toBeInstanceOf(Product1bImageError);
    expect(refusal?.reason.code).toBe('CACHE_BUSY');
    expect(await readFile(join(cacheRoot, unrelatedName), 'utf8')).toBe('unrelated sentinel');
    expect((await readdir(cacheRoot)).some((name) => name.includes('.lock'))).toBe(false);
  });

  it.each([
    ['SIGTERM', 'curl'],
    ['SIGINT', 'bzip2']
  ])(
    'unwinds an interrupted CLI after %s while %s is active without cache residue',
    async (signal, phase) => {
      const { cacheRoot, spec, stdout, stderr, outcome } = await runInterruptedCli({
        signal,
        phase
      });

      expect(outcome).toEqual({ code: 3, childSignal: null });
      expect(stdout).toBe('');
      expect(stderr).toBe(
        'Product 1B image: FAILED; image preparation interrupted, retry image preparation\n'
      );
      expect(`${stdout}${stderr}`).not.toContain('PRODUCT1B_SECRET_SENTINEL');
      expect(`${stdout}${stderr}`).not.toContain('/private/cache');
      const entries = await readdir(cacheRoot);
      expect(entries.some((name) => name.includes('.partial-'))).toBe(false);
      expect(entries.some((name) => name.includes('.lock'))).toBe(false);
      expect(entries).not.toContain(spec.rawName);
      expect(entries).not.toContain(`${spec.rawName}.integrity.json`);
    }
  );

  it.each([
    ['oversize', Buffer.from('fixture archive plus one byte', 'utf8'), 'ARCHIVE_TOO_LARGE'],
    ['partial', Buffer.from('short', 'utf8'), 'ARCHIVE_SIZE_MISMATCH'],
    ['wrong digest', Buffer.from('wrong bytes----', 'utf8'), 'ARCHIVE_DIGEST_MISMATCH']
  ])('removes a %s archive without installing it', async (_case, bytes, code) => {
    const cacheRoot = await temporaryRoot();
    const expected = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(expected);

    await expectImageError(
      prepareImage({
        cacheRoot,
        spec,
        download: fakeDownload(bytes),
        decompress: fakeDecompress()
      }),
      code
    );

    expect(await readdir(cacheRoot)).toEqual([]);
  });

  it('rehashes an existing archive before reuse and replaces same-size corrupt bytes', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    const archivePath = join(cacheRoot, spec.archiveName);
    await writeFile(archivePath, Buffer.from('corrupt archive', 'utf8'));
    const download = vi.fn(fakeDownload(archive));

    const result = await prepareImage({
      cacheRoot,
      spec,
      download,
      decompress: fakeDecompress()
    });

    expect(result.archive).toBe('downloaded');
    expect(download).toHaveBeenCalledOnce();
    expect(await readFile(archivePath)).toEqual(archive);
  });

  it('reuses an existing archive only after streaming verification', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    await writeFile(join(cacheRoot, spec.archiveName), archive);
    const download = vi.fn();

    const result = await prepareImage({
      cacheRoot,
      spec,
      download,
      decompress: fakeDecompress()
    });

    expect(result.archive).toBe('reused');
    expect(download).not.toHaveBeenCalled();
  });

  it('rehashes the immutable raw base against its archive-bound integrity proof before reuse', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const raw = Buffer.from('raw image', 'utf8');
    const spec = fixtureSpec(archive);
    await prepareImage({
      cacheRoot,
      spec,
      download: fakeDownload(archive),
      decompress: fakeDecompress(raw)
    });
    const rawPath = join(cacheRoot, spec.rawName);
    await chmod(rawPath, 0o644);
    await writeFile(rawPath, Buffer.from('bad image', 'utf8'));
    await chmod(rawPath, 0o444);
    const decompress = vi.fn(fakeDecompress(raw));

    const result = await prepareImage({
      cacheRoot,
      spec,
      download: vi.fn(),
      decompress
    });

    expect(result).toEqual({ archive: 'reused', raw: 'created' });
    expect(decompress).toHaveBeenCalledOnce();
    expect(await readFile(rawPath)).toEqual(raw);
  });

  it('cleans a partial raw base when decompression fails', async () => {
    const cacheRoot = await temporaryRoot();
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    const failure = new Error('/private/cache PRODUCT_1B_SECRET_SENTINEL');

    const error = await expectImageError(
      prepareImage({
        cacheRoot,
        spec,
        download: fakeDownload(archive),
        decompress: async ({ destination }) => {
          await writeFile(destination, 'partial raw');
          throw failure;
        }
      }),
      'DECOMPRESSION_FAILED'
    );

    expect(error.cause).toBe(failure);
    expect((await readdir(cacheRoot)).sort()).toEqual([spec.archiveName]);
    expect(formatImageFailure(error)).toBe(
      'Product 1B image: FAILED; decompression failed, retry image preparation\n'
    );
    expect(formatImageFailure(error)).not.toContain('SECRET');
    expect(formatImageFailure(error)).not.toContain('/private/cache');
  });

  it('refuses symlink and non-regular cache entries without touching their targets', async () => {
    const cacheRoot = await temporaryRoot();
    const outside = join(await temporaryRoot(), 'outside.img.bz2');
    const archive = Buffer.from('fixture archive', 'utf8');
    const spec = fixtureSpec(archive);
    await writeFile(outside, archive);
    await symlink(outside, join(cacheRoot, spec.archiveName));

    await expectImageError(
      prepareImage({
        cacheRoot,
        spec,
        download: vi.fn(),
        decompress: fakeDecompress()
      }),
      'UNSAFE_CACHE_ENTRY'
    );

    expect(await readFile(outside)).toEqual(archive);

    const rawPath = join(cacheRoot, spec.rawName);
    await rm(join(cacheRoot, spec.archiveName));
    await writeFile(join(cacheRoot, spec.archiveName), archive);
    await writeFile(rawPath, 'mutable raw');
    await chmod(rawPath, 0o644);
    await expectImageError(
      prepareImage({
        cacheRoot,
        spec,
        download: vi.fn(),
        decompress: fakeDecompress()
      }),
      'UNSAFE_CACHE_ENTRY'
    );
  });
});
