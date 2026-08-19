// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn as realSpawn } from 'node:child_process';
import { once } from 'node:events';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createKernelMutationLockManager } from '../../../src/capabilities/envelope/kernel-lock.js';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { LockHandle, MutationLockManager } from '../../../src/capabilities/types.js';

// The legs below exercise the real OS helper, because a mocked lock proves nothing about the kernel
// semantics the whole module exists for. Where the host has no helper the kernel legs skip rather
// than pretend; the branches that fail closed before any spawn run everywhere.
const HOST_HELPER: Record<string, string> = { darwin: '/usr/bin/lockf', linux: '/usr/bin/flock' };
const hostHelper = HOST_HELPER[process.platform];
const noKernelHelper = hostHelper === undefined || !existsSync(hostHelper);

const WAITER_SOURCE = fileURLToPath(
  new URL('../../../src/capabilities/envelope/lock-waiter.mjs', import.meta.url)
);

// The ownership branch cannot be provoked with a file we create: without root we cannot hand a file
// to a third user. This is a stock executable belonging to neither root nor us — regular, and not
// writable by group or other, so ownership is the only check left that can reject it. Guarded, so a
// host that lacks it skips instead of asserting nothing.
const THIRD_PARTY_EXECUTABLE = '/usr/bin/uucp';
const noThirdPartyExecutable = ((): boolean => {
  try {
    const stats = lstatSync(THIRD_PARTY_EXECUTABLE);
    return !(
      stats.isFile() &&
      stats.uid !== 0 &&
      stats.uid !== process.getuid?.() &&
      (stats.mode & 0o022) === 0
    );
  } catch {
    return true;
  }
})();

// Generous on purpose: the assertion that matters is that a contended acquire RETURNS rather than
// hangs. A tight ceiling would only measure how loaded the machine is.
const BOUNDED_MS = 10_000;
// This one has to be tight enough to MEAN something: it must sit well below the module's own
// five-second release bound, or an implementation that ignored the signal would pass it too.
const ABORTED_RELEASE_MS = 1_000;
// Tighter still, and deliberately so: once the socket is closed there is nothing left to wait for,
// so a second manager should win the flock almost immediately. A bound this close only fails if the
// close never happened.
const REACQUIRE_MS = 100;

const signal = new AbortController().signal;

let root: string;
let lockPath: string;
let held: LockHandle[];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'kernel-lock-'));
  lockPath = join(root, 'mutation.lock');
  held = [];
});

afterEach(async () => {
  // Every handle owns a live helper process, so a leaked one would keep the worker's event loop
  // alive and hold the lock for the next test.
  for (const handle of held) await handle.release(signal);
  vi.unstubAllEnvs();
  rmSync(root, { force: true, recursive: true });
});

async function acquire(
  manager: MutationLockManager,
  targetKey = 'target'
): Promise<LockHandle | null> {
  const handle = await manager.acquire(targetKey, signal);
  if (handle !== null) held.push(handle);
  return handle;
}

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: SpawnOptions;
}

// A wrapper, not a copy: macOS SIGKILLs a copied platform binary at exec, so the only helper this
// test can both own and run is one it writes itself. `exec` keeps the inherited descriptors, so the
// wrapper takes a genuine kernel lock and is a real control rather than a stand-in.
function writeHelperWrapper(path: string, mode: number): void {
  if (hostHelper === undefined) throw new Error('guarded by skipIf');
  writeFileSync(path, `#!/bin/sh\nexec ${hostHelper} "$@"\n`);
  // Explicitly, and not via writeFileSync's mode: that one is masked by the umask, which on a
  // stock host strips the very group and other write bits this leg exists to plant.
  chmodSync(path, mode);
}

// Records exactly what the manager asked the OS for, then performs it. The recording is what the
// secrecy and trust legs assert against; a manager that never spawns leaves the log empty, which is
// itself the assertion for every leg that must refuse before executing anything.
function recordingSpawn(
  log: SpawnCall[]
): (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess {
  return (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
    log.push({ command, args, options });
    return realSpawn(command, args, options);
  };
}

describe('kernel-backed mutation lock manager', () => {
  it.skipIf(noKernelHelper)(
    'serializes two managers over the same lock file and frees it on release',
    async () => {
      const first = createKernelMutationLockManager(lockPath);
      const second = createKernelMutationLockManager(lockPath);

      const holder = await acquire(first);
      expect(holder).not.toBeNull();

      const startedAt = Date.now();
      expect(await second.acquire('target', signal)).toBeNull();
      expect(Date.now() - startedAt).toBeLessThan(BOUNDED_MS);

      expect(await holder?.release(signal)).toBe('released');
      expect(await acquire(second)).not.toBeNull();
    }
  );

  it.skipIf(noKernelHelper)('reports a release and grants the lock again', async () => {
    const manager = createKernelMutationLockManager(lockPath);

    const first = await acquire(manager);
    expect(first).not.toBeNull();
    expect(await first?.release(signal)).toBe('released');
    // A release that already happened is still a release, and must not resurrect the helper.
    expect(await first?.release(signal)).toBe('released');

    expect(await acquire(manager)).not.toBeNull();
  });

  it.skipIf(noKernelHelper)(
    'stops waiting for a deaf helper when the release is aborted',
    async () => {
      // The five-second bound above exists for a helper that will not go. The signal is what lets the
      // CALLER's bound be shorter than that: without it, one wedged helper pins the whole envelope to
      // this module's patience. Proving that takes a helper that really is deaf to the release's EOF
      // — a merely slow one would exit on its own and hide the difference.
      const waiterPath = join(root, 'deaf-waiter.mjs');
      // It signals readiness so the acquire succeeds, never reads the socket so the EOF goes
      // unnoticed, and exits by itself so the leg strands nothing behind it.
      writeFileSync(
        waiterPath,
        [
          'import { writeSync } from "node:fs";',
          'writeSync(4, Buffer.of(1));',
          'setTimeout(() => { process.exit(0); }, 3000);',
          ''
        ].join('\n')
      );
      // Explicitly, for the same reason as the helper wrapper: writeFileSync's mode is umask-masked.
      chmodSync(waiterPath, 0o600);

      const spawned: ChildProcess[] = [];
      const manager = createKernelMutationLockManager(lockPath, {
        waiterPath,
        spawn: (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
          const child = realSpawn(command, args, options);
          spawned.push(child);
          return child;
        }
      });
      const handle = await manager.acquire('target', signal);
      expect(handle).not.toBeNull();

      const controller = new AbortController();
      const startedAt = Date.now();
      const abort = setTimeout(() => {
        controller.abort();
      }, 50);
      // Honest rather than optimistic: the socket is closed, so the lock will go, but this helper has
      // not been SEEN to go and only a helper we can account for is reported released.
      expect(await handle?.release(controller.signal)).toBe('unconfirmed');
      expect(Date.now() - startedAt).toBeLessThan(ABORTED_RELEASE_MS);
      clearTimeout(abort);

      const child = spawned[0];
      if (child === undefined) throw new Error('the manager spawned no helper');
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  );

  it.skipIf(noKernelHelper)(
    'closes the socket before it consults an already-aborted signal',
    async () => {
      // The code comment's claim, pinned: even when there is no budget left to confirm the exit,
      // the socket must already be closed by the time this resolves, or the helper is never told to
      // let go and the lock it holds outlives the caller that gave up on confirming it.
      const manager = createKernelMutationLockManager(lockPath);
      const handle = await acquire(manager);
      expect(handle).not.toBeNull();

      const controller = new AbortController();
      controller.abort();
      expect(await handle?.release(controller.signal)).toBe('unconfirmed');

      const startedAt = Date.now();
      expect(await acquire(createKernelMutationLockManager(lockPath))).not.toBeNull();
      expect(Date.now() - startedAt).toBeLessThan(REACQUIRE_MS);
    }
  );

  it.skipIf(noKernelHelper)('frees the lock when the helper process is killed', async () => {
    const spawned: ChildProcess[] = [];
    const manager = createKernelMutationLockManager(lockPath, {
      spawn: (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
        const child = realSpawn(command, args, options);
        spawned.push(child);
        return child;
      }
    });

    const handle = await acquire(manager);
    expect(handle).not.toBeNull();
    const child = spawned[0];
    if (child === undefined) throw new Error('the manager spawned no helper');
    expect(child.pid).toBeGreaterThan(0);

    // Awaiting the exit is what removes the timing guesswork: once the parent has reaped the
    // helper its descriptors are closed, so the kernel lock is provably gone — no sleep needed.
    const exit = once(child, 'exit');
    child.kill('SIGKILL');
    await exit;

    expect(await acquire(createKernelMutationLockManager(lockPath))).not.toBeNull();
    // The handle's helper is already gone, so the release has nothing left to confirm but that.
    expect(await handle?.release(signal)).toBe('released');
  });

  it.skipIf(noKernelHelper)(
    'fails closed when the helper exits before signalling readiness',
    async () => {
      const manager = createKernelMutationLockManager(lockPath, {
        spawn: (_command: string, _args: readonly string[], options: SpawnOptions): ChildProcess =>
          realSpawn(process.execPath, ['-e', 'process.exit(0)'], options)
      });

      expect(await manager.acquire('target', signal)).toBeNull();
      // Nothing was ever locked, so the file is free for a manager that spawns the real helper.
      expect(await acquire(createKernelMutationLockManager(lockPath))).not.toBeNull();
    }
  );

  it('refuses a lock path that is a symlink', async () => {
    const decoy = join(root, 'decoy');
    writeFileSync(decoy, '', { mode: 0o600 });
    const linked = join(root, 'linked.lock');
    symlinkSync(decoy, linked);

    expect(await createKernelMutationLockManager(linked).acquire('target', signal)).toBeNull();
  });

  it('fails closed on a platform with no kernel lock helper', async () => {
    let spawns = 0;
    const manager = createKernelMutationLockManager(lockPath, {
      platform: 'win32',
      spawn: (command: string, args: readonly string[], options: SpawnOptions): ChildProcess => {
        spawns += 1;
        return realSpawn(command, args, options);
      }
    });

    expect(await manager.acquire('target', signal)).toBeNull();
    expect(spawns).toBe(0);
  });
});

// The module's headline security property: the child is told nothing. Everything it needs arrives
// as an inherited descriptor, so `ps` and the child's environment reveal no lock path, no target
// and no credential. Nothing else in the suite would notice if that stopped being true.
describe('kernel mutation lock secrecy', () => {
  it.skipIf(noKernelHelper)(
    'hands the helper a descriptor and never a path, a target or an environment',
    async () => {
      // One token standing in for every secret at once: it names the lock file, it is the target
      // key, and it is the value of an environment variable this process is carrying.
      const secret = 'canary-a17f3c9d';
      vi.stubEnv('OPNSENSE_KERNEL_LOCK_CANARY', secret);
      const secretLockPath = join(root, `${secret}.lock`);
      const log: SpawnCall[] = [];

      const manager = createKernelMutationLockManager(secretLockPath, {
        spawn: recordingSpawn(log)
      });
      expect(await acquire(manager, `${secret}-target`)).not.toBeNull();

      const call = log[0];
      if (call === undefined) throw new Error('the manager spawned no helper');

      // argv, as `ps` would print it.
      const argv = [call.command, ...call.args].join(' ');
      expect(argv).not.toContain(secret);
      expect(argv).not.toContain(secretLockPath);
      expect(argv).not.toContain(root);

      // The lock reaches the child as an inherited descriptor and by no other route.
      expect(call.args).toContain('/dev/fd/3');
      expect(call.options.stdio).toEqual([
        'ignore',
        'ignore',
        'ignore',
        expect.any(Number),
        'pipe'
      ]);

      // An inherited environment is precisely where the firewall credentials would travel.
      expect(call.options.env).toEqual({});
      expect(JSON.stringify(call.options.env ?? {})).not.toContain(secret);
    }
  );
});

// Both executables are validated before either is run. Without these legs the checks could be
// deleted outright and every other test would stay green.
describe('kernel mutation lock executable trust', () => {
  it.skipIf(noKernelHelper)('refuses a waiter that anyone else could rewrite', async () => {
    const waiterPath = join(root, 'lock-waiter.mjs');
    copyFileSync(WAITER_SOURCE, waiterPath);
    chmodSync(waiterPath, 0o666);
    const log: SpawnCall[] = [];

    const manager = createKernelMutationLockManager(lockPath, {
      waiterPath,
      spawn: recordingSpawn(log)
    });
    expect(await manager.acquire('target', signal)).toBeNull();
    expect(log).toHaveLength(0);

    // The control: the same waiter, at the same path, differing only in who may rewrite it. Without
    // this the leg would pass just as well for a waiter that was refused for the wrong reason.
    chmodSync(waiterPath, 0o600);
    expect(await acquire(createKernelMutationLockManager(lockPath, { waiterPath }))).not.toBeNull();
  });

  it.skipIf(noKernelHelper)('refuses a helper path that does not exist', async () => {
    const log: SpawnCall[] = [];
    const manager = createKernelMutationLockManager(lockPath, {
      helperPath: join(root, 'no-such-helper'),
      spawn: recordingSpawn(log)
    });

    expect(await manager.acquire('target', signal)).toBeNull();
    expect(log).toHaveLength(0);
  });

  it.skipIf(noKernelHelper)('refuses a helper that anyone else could rewrite', async () => {
    const helperPath = join(root, 'helper-wrapper');
    writeHelperWrapper(helperPath, 0o777);
    const log: SpawnCall[] = [];

    const manager = createKernelMutationLockManager(lockPath, {
      helperPath,
      spawn: recordingSpawn(log)
    });
    expect(await manager.acquire('target', signal)).toBeNull();
    expect(log).toHaveLength(0);

    // The control: the same helper at the same path, differing only in who may rewrite it, takes a
    // real kernel lock. Without it the leg would pass just as well for a refusal of the wrong kind.
    chmodSync(helperPath, 0o700);
    expect(await acquire(createKernelMutationLockManager(lockPath, { helperPath }))).not.toBeNull();
  });

  it.skipIf(noKernelHelper)('refuses a helper that is not a regular file', async () => {
    if (hostHelper === undefined) throw new Error('guarded by skipIf');
    // A directory owned by us at 0700 passes every check but this one, so it isolates the
    // regular-file branch; the symlink is the shape an attacker would actually leave behind.
    const asDirectory = join(root, 'helper-dir');
    mkdirSync(asDirectory, { mode: 0o700 });
    const asSymlink = join(root, 'helper-link');
    symlinkSync(hostHelper, asSymlink);

    for (const helperPath of [asDirectory, asSymlink]) {
      const log: SpawnCall[] = [];
      const manager = createKernelMutationLockManager(lockPath, {
        helperPath,
        spawn: recordingSpawn(log)
      });
      expect(await manager.acquire('target', signal)).toBeNull();
      expect(log).toHaveLength(0);
    }
  });

  it.skipIf(noKernelHelper || noThirdPartyExecutable)(
    'refuses a helper owned by neither root nor this user',
    async () => {
      const log: SpawnCall[] = [];
      const manager = createKernelMutationLockManager(lockPath, {
        helperPath: THIRD_PARTY_EXECUTABLE,
        spawn: recordingSpawn(log)
      });

      expect(await manager.acquire('target', signal)).toBeNull();
      expect(log).toHaveLength(0);
    }
  );
});
