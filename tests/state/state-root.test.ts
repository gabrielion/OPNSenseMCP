// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ensurePrivateDirectory,
  ensureTargetDirectory,
  openResolvedStateRoot,
  openStateRoot,
  resolveStateRootPath
} from '../../src/state/state-root.js';
import { deriveTargetId } from '../../src/state/target-identity.js';

const HOME = '/home/operator';

function environment(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {}
): { platform: NodeJS.Platform; env: Record<string, string | undefined>; homeDir: string } {
  return { platform, env, homeDir: HOME };
}

describe('resolveStateRootPath', () => {
  it('uses the absolute override verbatim on any supported platform', () => {
    expect(resolveStateRootPath('/private/tmp/state', environment('linux'))).toBe(
      '/private/tmp/state'
    );
  });

  it('rejects a relative override', () => {
    expect(() => resolveStateRootPath('relative/state', environment('linux'))).toThrow(
      'OPNSENSE_MCP_STATE_DIR must be a normalized absolute path'
    );
  });

  it('defaults to Application Support on macOS', () => {
    expect(resolveStateRootPath(undefined, environment('darwin'))).toBe(
      `${HOME}/Library/Application Support/opnsense-mcp/state`
    );
  });

  it('prefers an absolute XDG_STATE_HOME on Linux and falls back to ~/.local/state', () => {
    expect(
      resolveStateRootPath(undefined, environment('linux', { XDG_STATE_HOME: '/var/state' }))
    ).toBe('/var/state/opnsense-mcp');
    expect(
      resolveStateRootPath(undefined, environment('linux', { XDG_STATE_HOME: 'not-absolute' }))
    ).toBe(`${HOME}/.local/state/opnsense-mcp`);
    expect(resolveStateRootPath(undefined, environment('linux'))).toBe(
      `${HOME}/.local/state/opnsense-mcp`
    );
  });

  it('fails closed on Windows and on unknown platforms, even with an override', () => {
    for (const platform of ['win32', 'freebsd'] as const) {
      expect(() => resolveStateRootPath(undefined, environment(platform))).toThrow(
        'Durable state is not supported on this platform'
      );
      expect(() => resolveStateRootPath('/abs', environment(platform))).toThrow(
        'Durable state is not supported on this platform'
      );
    }
  });
});

function scratch(): string {
  // realpathSync: on macOS tmpdir() is /var/..., a symlink to /private/var/..., and the canonical
  // path check must operate on the canonical form.
  return mkdtempSync(join(realpathSync(tmpdir()), 'opnsense-state-test-'));
}

describe('ensurePrivateDirectory / openStateRoot', () => {
  it('creates missing directories 0700 and accepts them on re-open', () => {
    const base = scratch();
    try {
      const rootPath = join(base, 'state');
      const root = openStateRoot(rootPath);
      expect(root.path).toBe(rootPath);
      expect(root.targetsPath).toBe(join(rootPath, 'targets'));
      // Idempotent and still valid on a second open.
      expect(openStateRoot(rootPath).targetsPath).toBe(join(rootPath, 'targets'));
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a pre-existing directory with drifted permissions instead of repairing it', () => {
    const base = scratch();
    try {
      const rootPath = join(base, 'state');
      mkdirSync(rootPath, { mode: 0o755 });
      expect(() => openStateRoot(rootPath)).toThrow('State directory failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a symlinked root', () => {
    const base = scratch();
    try {
      const real = join(base, 'real');
      mkdirSync(real, { mode: 0o700 });
      const alias = join(base, 'alias');
      symlinkSync(real, alias);
      expect(() => openStateRoot(alias)).toThrow('State directory failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a regular file where a directory is required', () => {
    const base = scratch();
    try {
      const rootPath = join(base, 'state');
      writeFileSync(rootPath, 'not a directory', { mode: 0o600 });
      expect(() => {
        ensurePrivateDirectory(rootPath);
      }).toThrow('State directory failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('openResolvedStateRoot', () => {
  it('accepts an override whose realpath differs (macOS /var vs /private/var) and returns the canonical root', () => {
    // tmpdir() without realpathSync IS the non-canonical spelling on macOS; on Linux the two are
    // equal and the test still passes.
    const base = mkdtempSync(join(tmpdir(), 'opnsense-state-canon-'));
    try {
      const override = join(base, 'state');
      const root = openResolvedStateRoot(override, {
        platform: process.platform,
        env: {},
        homeDir: '/home/unused'
      });
      expect(root.path).toBe(realpathSync(override));
      expect(lstatSync(root.path).mode & 0o777).toBe(0o700);
      expect(openStateRoot(root.path).path).toBe(root.path);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('canonicalizes a symlinked spelling that the strict entry point keeps refusing', () => {
    // The test above is vacuous wherever tmpdir() is already canonical (Linux, i.e. CI): a symlinked
    // ancestor is the only way to make the canonicalization observable on every platform.
    const base = scratch();
    try {
      const real = join(base, 'real');
      mkdirSync(real, { mode: 0o700 });
      const link = join(base, 'link');
      symlinkSync(real, link);
      const override = join(link, 'state');
      const root = openResolvedStateRoot(override, {
        platform: process.platform,
        env: {},
        homeDir: '/home/unused'
      });
      expect(root.path).not.toBe(override);
      expect(root.path).toBe(realpathSync(override));
      expect(() => openStateRoot(override)).toThrow('State directory failed its integrity checks');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it.each([['/tmp/state/'], ['/tmp//state'], ['/tmp/a/../state'], ['relative/state']])(
    'rejects the non-normalized or relative override %s',
    (override) => {
      expect(() =>
        openResolvedStateRoot(override, { platform: 'linux', env: {}, homeDir: '/home/x' })
      ).toThrow('OPNSENSE_MCP_STATE_DIR must be a normalized absolute path');
    }
  );
});

describe('ensureTargetDirectory', () => {
  it('creates targets/<id> with the same discipline and returns its path', () => {
    const base = scratch();
    try {
      const root = openStateRoot(join(base, 'state'));
      const id = deriveTargetId(randomBytes(32), 'https://a.example:443');
      const targetPath = ensureTargetDirectory(root, id);
      expect(targetPath).toBe(join(root.targetsPath, id));
      expect(ensureTargetDirectory(root, id)).toBe(targetPath);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('rejects a malformed id before touching the filesystem', () => {
    const base = scratch();
    try {
      const root = openStateRoot(join(base, 'state'));
      expect(() => ensureTargetDirectory(root, '../escape')).toThrow('Invalid target id');
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
