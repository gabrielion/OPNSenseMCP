// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  chmodSync,
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
  requireSafeComponent,
  resolveStateRootPath
} from '../../src/state/state-root.js';
import { deriveTargetId } from '../../src/state/target-identity.js';
import {
  assertPrivateAncestors,
  createPrivateFixtureRoot,
  removePrivateFixtureRoot
} from '../support/private-fixture-root.js';

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

  it('refuses a root spelled through a symlinked ancestor this account could have planted', async () => {
    // Canonicalizing before the integrity checks used to make this case fail OPEN: the redirect
    // resolved, the leaf checks passed on the far side of it, and the run proceeded — so
    // `identity.key` and every backup landed wherever the redirect pointed. Only root may own a
    // symlink on the way to the state root; a same-uid one is indistinguishable from a redirect
    // planted by anything else running as this account.
    const base = await createPrivateFixtureRoot('opnsense-state-symlinked-ancestor');
    try {
      const real = join(base, 'real');
      mkdirSync(real, { mode: 0o700 });
      const link = join(base, 'link');
      symlinkSync(real, link);
      expect(() =>
        openResolvedStateRoot(join(link, 'state'), {
          platform: process.platform,
          env: {},
          homeDir: '/home/unused'
        })
      ).toThrow('State directory failed its integrity checks');
      // And nothing was created on the far side of the redirect before the refusal.
      expect(() => lstatSync(join(real, 'state'))).toThrow();
    } finally {
      await removePrivateFixtureRoot(base);
    }
  });

  it.each([
    ['a group-writable', 0o770],
    ['an other-writable', 0o707],
    // The sticky bit alone buys nothing: the exemption below is for the platform's own public
    // directories, which are root's. A sticky directory THIS account owns is not one of those, and
    // an account that can chmod it can also empty it.
    ['a sticky but self-owned', 0o1777]
  ])('refuses a root under %s ancestor', async (_shape, mode) => {
    // Planted with chmod: a mode argument to mkdir is masked by the umask, and a test that plants
    // permission bits that way plants none.
    const base = await createPrivateFixtureRoot('opnsense-state-lax-ancestor');
    try {
      const lax = join(base, 'lax');
      mkdirSync(lax, { mode: 0o700 });
      chmodSync(lax, mode);
      expect(() =>
        openResolvedStateRoot(join(lax, 'state'), {
          platform: process.platform,
          env: {},
          homeDir: '/home/unused'
        })
      ).toThrow('State directory failed its integrity checks');
    } finally {
      await removePrivateFixtureRoot(base);
    }
  });

  it('accepts a root whose every ancestor is private', async () => {
    // The control for the two refusals above: the same entry point, the same leaf, an ancestry the
    // fixture helper has itself asserted safe. Without it a walk that refused everything would
    // still be green.
    const base = await createPrivateFixtureRoot('opnsense-state-private-ancestry');
    try {
      assertPrivateAncestors(base);
      const override = join(base, 'state');
      expect(
        openResolvedStateRoot(override, {
          platform: process.platform,
          env: {},
          homeDir: '/home/unused'
        }).path
      ).toBe(override);
    } finally {
      await removePrivateFixtureRoot(base);
    }
  });

  it('accepts a root under the root-owned sticky public temporary directory', () => {
    // /tmp is 1777 and root's on both supported platforms — directly on Linux, and on macOS
    // through the root-owned /tmp symlink onto /private/tmp, so this one leg exercises both of the
    // walk's relaxations. It is not a curiosity: every suite that points
    // `OPNSENSE_MCP_STATE_DIR` at `mkdtemp(tmpdir())` runs here on CI, and the walk without this
    // exemption refuses all of them. Sticky is what makes it safe — the kernel forbids renaming or
    // removing an entry you do not own, and whatever an outsider can still create is caught by the
    // ownership check the walk carries on every component.
    const base = mkdtempSync('/tmp/opnsense-state-public-tmp-');
    try {
      const override = join(base, 'state');
      expect(
        openResolvedStateRoot(override, {
          platform: process.platform,
          env: {},
          homeDir: '/home/unused'
        }).path
      ).toBe(realpathSync(override));
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

describe('requireSafeComponent', () => {
  // Two clauses of the walk are unreachable through a real filesystem from an unprivileged test,
  // so they are asserted against the predicate itself rather than left unpinned. A foreign-owned
  // ancestor cannot be created by this account, and any directory it could be created in is
  // already group- or other-writable, which the walk refuses one clause earlier. A non-directory
  // ancestor can be built, but not observed: `mkdir -p` fails ENOTDIR immediately after and raises
  // the same integrity error, so deleting the walk's own refusal would change nothing visible.
  const userId = process.getuid?.() ?? 0;
  const directory = { isDirectory: () => true, isSymbolicLink: () => false };

  it('refuses an ancestor owned by neither root nor this account', () => {
    expect(() => {
      requireSafeComponent({ ...directory, uid: userId + 1, mode: 0o700 }, userId);
    }).toThrow('State directory failed its integrity checks');
  });

  it('refuses an ancestor that is not a directory', () => {
    expect(() => {
      requireSafeComponent(
        { isDirectory: () => false, isSymbolicLink: () => false, uid: userId, mode: 0o600 },
        userId
      );
    }).toThrow('State directory failed its integrity checks');
  });
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
