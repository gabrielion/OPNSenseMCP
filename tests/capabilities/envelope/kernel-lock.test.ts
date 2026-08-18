// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn as realSpawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createKernelMutationLockManager } from '../../../src/capabilities/envelope/kernel-lock.js';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { LockHandle, MutationLockManager } from '../../../src/capabilities/types.js';

// The legs below exercise the real OS helper, because a mocked lock proves nothing about the kernel
// semantics the whole module exists for. Where the host has no helper the kernel legs skip rather
// than pretend; the branches that fail closed before any spawn run everywhere.
const HOST_HELPER: Record<string, string> = { darwin: '/usr/bin/lockf', linux: '/usr/bin/flock' };
const helperPath = HOST_HELPER[process.platform];
const noKernelHelper = helperPath === undefined || !existsSync(helperPath);

// Generous on purpose: the assertion that matters is that a contended acquire RETURNS rather than
// hangs. A tight ceiling would only measure how loaded the machine is.
const BOUNDED_MS = 10_000;

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
  for (const handle of held) await handle.release();
  rmSync(root, { force: true, recursive: true });
});

async function acquire(manager: MutationLockManager): Promise<LockHandle | null> {
  const handle = await manager.acquire('target', signal);
  if (handle !== null) held.push(handle);
  return handle;
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

      expect(await holder?.release()).toBe('released');
      expect(await acquire(second)).not.toBeNull();
    }
  );

  it.skipIf(noKernelHelper)('reports a release and grants the lock again', async () => {
    const manager = createKernelMutationLockManager(lockPath);

    const first = await acquire(manager);
    expect(first).not.toBeNull();
    expect(await first?.release()).toBe('released');
    // A release that already happened is still a release, and must not resurrect the helper.
    expect(await first?.release()).toBe('released');

    expect(await acquire(manager)).not.toBeNull();
  });

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
    expect(await handle?.release()).toBe('released');
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
