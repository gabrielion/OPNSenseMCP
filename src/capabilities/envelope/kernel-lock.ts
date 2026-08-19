// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn as nodeSpawn } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { Duplex } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { LockHandle, MutationLockManager } from '../types.js';

// Descriptor 3 carries the validated lock file into the helper, which is handed it as the path
// `/dev/fd/3` — a reference to the descriptor, never the file's own name. Descriptor 4 is the
// socketpair this process keeps the other end of.
const LOCK_FD = 3;
const PIPE_FD = 4;

// The manager's hard bound on acquisition, and the helper's own shorter one. The helper timeout
// must expire strictly INSIDE the hard bound: contention then ends in the helper's own clean exit
// and the bound below stays what it is meant to be — a backstop for a helper that has wedged. If
// the two were equal they would race, and every contended acquire would take the kill path.
const ACQUIRE_TIMEOUT_MS = 5_000;
const HELPER_WAIT_SECONDS = 4;
// A release closes a socket and waits for one small process to notice; anything slower than this
// is not slowness, it is a helper that will not go.
const RELEASE_TIMEOUT_MS = 5_000;
const KILL_GRACE_MS = 1_000;

const NOFOLLOW = (constants.O_NOFOLLOW as number | undefined) ?? 0;

// Fixed absolute paths, never composed from configuration: the point of validating them is lost if
// a caller can choose what gets executed. `flock` is the Linux spelling of `lockf`; a platform with
// neither has no kernel lock and therefore gets no mutation.
const PLATFORM_HELPERS: Readonly<Record<string, string>> = {
  darwin: '/usr/bin/lockf',
  linux: '/usr/bin/flock'
};
const WAITER_PATH = join(import.meta.dirname, 'lock-waiter.mjs');

export type SpawnLockHelper = (
  command: string,
  args: readonly string[],
  options: SpawnOptions
) => ChildProcess;

export interface KernelLockDependencies {
  readonly platform?: NodeJS.Platform;
  readonly spawn?: SpawnLockHelper;
  // Seams for the trust checks, not an escape from them. Production passes neither and gets the
  // fixed paths above; whichever path is in use is validated identically before anything is
  // executed, so pointing these at an untrusted file proves the refusal rather than bypassing it.
  // The platform still decides both the argv dialect and whether a kernel lock exists at all, so
  // an unsupported platform refuses regardless of what is injected here.
  readonly helperPath?: string;
  readonly waiterPath?: string;
}

function ownedByThisUser(uid: number): boolean {
  return uid === process.getuid?.();
}

function closeQuietly(fd: number): void {
  try {
    closeSync(fd);
  } catch {
    // A failed close changes nothing about the lock, which lives on the descriptor the child holds.
  }
}

// Both executables this module runs are checked the same way: a real file (an `lstat` rejects a
// symlink outright), belonging to root or to us, and not writable by anyone else. A helper someone
// else can rewrite is a helper that can be made to lie about holding the lock.
function trustedExecutable(path: string): boolean {
  try {
    const stats = lstatSync(path);
    return (
      stats.isFile() &&
      (stats.uid === 0 || ownedByThisUser(stats.uid)) &&
      (stats.mode & 0o022) === 0
    );
  } catch {
    return false;
  }
}

// Opened `O_NOFOLLOW`, then judged on its own descriptor rather than on its name, so a path swapped
// between the two cannot change what gets locked. A symlink at the path fails the open and lands
// here as `null` — the same fail-closed answer as every other fault in this module.
function openPrivateLockFile(path: string): number | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDWR | constants.O_CREAT | NOFOLLOW, 0o600);
  } catch {
    return null;
  }
  try {
    const stats = fstatSync(fd);
    if (
      !stats.isFile() ||
      !ownedByThisUser(stats.uid) ||
      stats.nlink !== 1 ||
      (stats.mode & 0o777) !== 0o600
    ) {
      closeQuietly(fd);
      return null;
    }
  } catch {
    closeQuietly(fd);
    return null;
  }
  return fd;
}

function helperArguments(platform: NodeJS.Platform, waiterPath: string): readonly string[] {
  const descriptor = `/dev/fd/${String(LOCK_FD)}`;
  const waiter = [process.execPath, waiterPath];
  // `lockf -s` is silent and `-k` is implied for a descriptor, so the lock file is never unlinked.
  // Both helpers fork, keep the locked descriptor in the parent, and exec the waiter in the child;
  // BSD `lockf` closes that descriptor in the child before exec, and util-linux `flock` only does
  // so under `-o` — without it the waiter inherits a dup of the LOCKED description, so killing the
  // helper frees nothing while the waiter lives (proven on Linux: kill-then-reacquire fails without
  // `-o` and succeeds with it; darwin needs no flag).
  return platform === 'darwin'
    ? ['-s', '-t', String(HELPER_WAIT_SECONDS), descriptor, ...waiter]
    : ['-x', '-w', String(HELPER_WAIT_SECONDS), '-o', descriptor, ...waiter];
}

function exitOf(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    child.once('exit', () => {
      resolve();
    });
    child.once('error', () => {
      resolve();
    });
  });
}

// The caller's bound and this module's own, whichever ends first. The signal ends the WAIT and not
// the release: by the time this is called the socket is already closed, so an abort means only that
// nobody is left to watch for the proof.
function settledWithin(settled: Promise<void>, ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // A signal that has already fired leaves no budget to wait on. Reporting the exit unobserved is
    // the conservative direction: 'unconfirmed' overstates a risk, where a false 'released' would
    // hide one.
    if (signal.aborted) {
      resolve(false);
      return;
    }
    // Armed before the handlers it calls, as in waitForReadiness: a timer cannot fire until this
    // executor has returned.
    const timer = setTimeout(() => {
      finish(false);
    }, ms);
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(exited);
    };
    const onAbort = (): void => {
      finish(false);
    };
    signal.addEventListener('abort', onAbort);
    void settled.then(() => {
      finish(true);
    });
  });
}

// Every failed acquisition must leave nothing behind that could hold the lock. Closing our end
// releases a waiter that did start; the signal accounts for a helper that never got that far.
function abandon(child: ChildProcess, pipe: Duplex | undefined): void {
  pipe?.destroy();
  try {
    child.kill('SIGKILL');
  } catch {
    // Already gone, which is the state we were asking for.
  }
}

// Resolves true only once the waiter's readiness byte has arrived, which the helper cannot produce
// before the kernel lock is held. Every listener is attached in the same tick as the spawn, before
// the event loop can deliver anything, so neither the byte nor a premature exit can be raced past.
function waitForReadiness(
  child: ChildProcess,
  pipe: Duplex,
  signal: AbortSignal
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Armed before the handlers it calls, which is safe because a timer cannot fire until this
    // executor has returned — and it lets the handle stay `const`.
    const timer = setTimeout(() => {
      settle(false);
    }, ACQUIRE_TIMEOUT_MS);
    const settle = (acquired: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      pipe.off('data', onData);
      child.off('exit', onExit);
      child.off('error', onExit);
      resolve(acquired);
    };
    const onData = (): void => {
      settle(true);
    };
    const onExit = (): void => {
      settle(false);
    };
    const onAbort = (): void => {
      settle(false);
    };

    pipe.on('data', onData);
    child.on('exit', onExit);
    child.on('error', onExit);
    signal.addEventListener('abort', onAbort);
  });
}

async function releaseHolder(
  child: ChildProcess,
  pipe: Duplex,
  signal: AbortSignal
): Promise<'released' | 'unconfirmed'> {
  const gone = exitOf(child);
  // Closing our end IS the release: the waiter reads EOF, exits, and the helper holding the kernel
  // lock exits with it. Nothing here writes a file or clears a flag, so there is no state left to
  // go stale — and the identical close happens by itself if this process dies. It happens before
  // the signal is consulted for the same reason: an abort must never leave the socket open.
  pipe.destroy();
  if (await settledWithin(gone, RELEASE_TIMEOUT_MS, signal)) return 'released';
  // An abort is not evidence of a wedged helper, only of a caller out of budget, and the escalation
  // below is a remedy for wedging. The socket is already closed, so the helper frees the lock as
  // soon as it notices; what cannot be claimed is that it already has.
  if (signal.aborted) return 'unconfirmed';
  try {
    child.kill('SIGKILL');
  } catch {
    // Nothing to signal means nothing to wait for; the check below decides.
  }
  // A helper that is provably dead has provably dropped the lock, however it died. Only a helper we
  // cannot account for is reported unconfirmed.
  return (await settledWithin(gone, KILL_GRACE_MS, signal)) ? 'released' : 'unconfirmed';
}

function createHandle(child: ChildProcess, pipe: Duplex): LockHandle {
  let outcome: Promise<'released' | 'unconfirmed'> | undefined;
  return Object.freeze({
    release(signal: AbortSignal): Promise<'released' | 'unconfirmed'> {
      // Memoized: a second release must report what the first established, not poke a dead child.
      // The first caller's signal is therefore the one that bounds the wait, and its answer is the
      // answer — which is the point of memoizing, not a limitation of it.
      outcome ??= releaseHolder(child, pipe, signal);
      return outcome;
    }
  });
}

// An exclusive mutation lock held by the OS kernel rather than by this process's memory, so a
// SECOND SERVER PROCESS aimed at the same target serializes against the first instead of walking
// straight through it — which is exactly what the in-process manager cannot do.
//
// The lock is a `flock(2)` on `lockFilePath` taken by the platform helper, and the helper is kept
// alive for the envelope's lifetime by a bundled waiter it runs. That indirection is forced: the
// helper's command form drops the lock the moment its command exits, so the command has to be a
// process that outlives the acquisition. The waiter blocks on a socketpair whose other end this
// process holds, which makes release and crash the same event — closing that end, deliberately or
// by dying, frees the lock. Nothing is written to disk to say the lock is held, so there is no PID
// file to go stale and no heuristic deciding whether a previous holder is really gone.
//
// It fails closed everywhere: an unsupported platform, a helper that is missing or that someone
// else could rewrite, a lock path that is a symlink or is not our private 0600 file, a helper that
// exits before it can prove the lock is held, an abort, or five seconds of silence all return
// `null`, and a refused mutation is the safe outcome of every one of them.
//
// `targetKey` does not reach the lock: the file is fixed at construction, so one manager guards one
// target and the key never travels to the child, where it would be visible in `ps`. A manager given
// several targets over-serializes them, which is safe; separating them is the composition root's
// job, by constructing one manager per lock file.
export function createKernelMutationLockManager(
  lockFilePath: string,
  dependencies: KernelLockDependencies = {}
): MutationLockManager {
  const platform = dependencies.platform ?? process.platform;
  const spawn = dependencies.spawn ?? nodeSpawn;
  const waiterPath = dependencies.waiterPath ?? WAITER_PATH;

  return Object.freeze({
    async acquire(targetKey: string, signal: AbortSignal): Promise<LockHandle | null> {
      // The platform gate comes first: without a known helper there is no argv dialect to speak,
      // and an injected path cannot supply one.
      const helper = dependencies.helperPath ?? PLATFORM_HELPERS[platform];
      if (
        PLATFORM_HELPERS[platform] === undefined ||
        helper === undefined ||
        !trustedExecutable(helper) ||
        !trustedExecutable(waiterPath)
      ) {
        return null;
      }
      if (signal.aborted) return null;

      const fd = openPrivateLockFile(lockFilePath);
      if (fd === null) return null;

      let child: ChildProcess;
      const stdio: SpawnOptions['stdio'] = ['ignore', 'ignore', 'ignore', fd, 'pipe'];
      try {
        // An empty environment, not an inherited one: the server's environment is where the
        // firewall credentials live, and the waiter needs none of it.
        child = spawn(helper, helperArguments(platform, waiterPath), { stdio, env: {} });
      } catch {
        closeQuietly(fd);
        return null;
      }
      // The spawn has already duplicated the descriptor into the child. Holding our own copy any
      // longer would keep the locked open file description alive after the helper died — the exact
      // stale lock this module exists to make impossible.
      closeQuietly(fd);

      const pipe = child.stdio[PIPE_FD];
      if (!(pipe instanceof Duplex)) {
        abandon(child, undefined);
        return null;
      }
      // The socket's own faults are noise; the child's death is observed through 'exit'. Without
      // this listener an EPIPE would be an unhandled 'error' and would take the server down.
      pipe.on('error', () => {
        // Intentionally ignored.
      });

      if (!(await waitForReadiness(child, pipe, signal))) {
        abandon(child, pipe);
        return null;
      }
      return createHandle(child, pipe);
    }
  });
}
