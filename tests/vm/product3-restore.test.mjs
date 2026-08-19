// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  VM_RESTORE_ATTESTATION_CHECK_KEYS,
  buildVmRestoreAttestation,
  serializeVmAttestation,
  serializeVmRestoreAttestation
} from '../../scripts/vm/attestation.mjs';
import {
  FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES,
  Product1bBootstrapError
} from '../../scripts/vm/product1b-bootstrap.mjs';
import { buildQemuArguments } from '../../scripts/vm/product1b-lifecycle.mjs';
import {
  FRAME_BEGIN,
  FRAME_END,
  Product3RestoreConsoleError,
  deriveQmpQemuArguments,
  parseProduct3RestoreArguments,
  restoreOverConsole,
  runProduct3Restore,
  writeVmRestoreAttestationAtomic
} from '../../scripts/vm/product3-restore.mjs';

const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);
// Deliberately shaped like something that would be embarrassing to leak: it carries both the
// "SENTINEL" token the other no-leak assertions already grep for and a recognizable XML fragment,
// so a summary or attestation payload that accidentally inlined the backup content trips on sight.
const SENTINEL_BACKUP_XML =
  '<?xml version="1.0"?><opnsense><SENTINEL_RESTORE_CONFIG_SIGIL/></opnsense>';

const socketRoots = [];
const attestationRoots = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    [...socketRoots.splice(0), ...attestationRoots.splice(0)].map((root) =>
      rm(root, { recursive: true, force: true })
    )
  );
});

async function temporarySocketPath(name) {
  const root = await mkdtemp(join(tmpdir(), 'p3-restore-console-'));
  socketRoots.push(root);
  return join(root, name);
}

function captureStream() {
  const stream = new PassThrough();
  let output = '';
  stream.on('data', (chunk) => {
    output += chunk.toString('utf8');
  });
  return { stream, output: () => output };
}

function mutationChecks() {
  return {
    writableSurface: true,
    aliasAbsentBefore: true,
    aliasCreated: true,
    aliasPresent: true,
    aliasDeleted: true,
    aliasAbsentAfter: true
  };
}

function reobserveChecks() {
  return { stateReverted: true };
}

function completeChecks() {
  return {
    doctor: true,
    vmStarted: true,
    bootstrap: true,
    packageInstalled: true,
    ...mutationChecks(),
    backupRestored: true,
    ...reobserveChecks(),
    vmStopped: true,
    residueFree: true
  };
}

// Mirrors product3-alias.test.mjs's own `attestationInput()` field-for-field (same commit/tree,
// image, scenario, node pattern — Task 12's brief pins every field but `checks` as shared,
// unchanged, across the alias and restore scenarios), swapping in this file's own 14-key
// `completeChecks()` for the `checks` field.
function restoreAttestationInput(overrides = {}) {
  return {
    schemaVersion: 2,
    commit: COMMIT,
    tree: TREE,
    node: '22.19.0',
    host: 'macos',
    protocolVersion: '2026-07-28',
    clientVersion: '0.1.0',
    image: {
      release: '26.7',
      sha256: '28d5e2f37e40d87468a924e3006ef10e2ddc6de485b85333d9e3958c84d0cb9d'
    },
    scenario: {
      readOnly: false,
      flags: ['experimental-alias-write'],
      scopes: ['server.status', 'system.status', 'core.services', 'firewall.alias']
    },
    checks: completeChecks(),
    ...overrides
  };
}

function defaultRunInstalled({ phase }) {
  if (phase === 'mutate') {
    return Promise.resolve({ checks: mutationChecks(), backupXml: SENTINEL_BACKUP_XML });
  }
  return Promise.resolve({ checks: reobserveChecks() });
}

function dependencies(overrides = {}) {
  const instanceRoot = '/private/SENTINEL_INSTANCE';
  const temporaryRoot = '/private/SENTINEL_TEMPORARY';
  const calls = [];
  return {
    instanceRoot,
    cacheRoot: '/private/SENTINEL_CACHE',
    repositoryRoot: '/private/SENTINEL_REPOSITORY',
    attestationPath: '/private/SENTINEL_ATTESTATION.json',
    nodeVersion: '22.19.0',
    inspectGit: vi.fn(async () => ({ clean: true, commit: COMMIT, tree: TREE })),
    writeAttestation: vi.fn(async () => undefined),
    doctor: vi.fn(() => ({ ready: true, host: 'macos', accelerator: 'tcg' })),
    statusVm: vi.fn(async () => ({ state: 'stopped', cleaned: false })),
    prepareBase: vi.fn(async () => undefined),
    // Mirrors the owned start in product3-alias.mjs: the console consumer runs between launch
    // and readiness.
    startVm: vi.fn(async ({ bootstrapConsole }) => {
      calls.push('start');
      await bootstrapConsole?.({ consolePath: `${instanceRoot}/console.sock` });
      return { state: 'running' };
    }),
    bootstrap: vi.fn(async () => ({
      key: 'SENTINEL_API_KEY',
      secret: 'SENTINEL_API_SECRET',
      serverName: 'OPNsense.internal'
    })),
    createArtifacts: vi.fn(async () => ({
      configPath: `${instanceRoot}/SENTINEL_CONNECTION.json`,
      caPath: `${instanceRoot}/SENTINEL_CA.pem`
    })),
    createTemporaryRoot: vi.fn(async () => temporaryRoot),
    installPackage: vi.fn(async () => ({
      invocation: {
        command: `${temporaryRoot}/consumer/node_modules/.bin/opnsense-mcp`,
        arguments: [],
        cwd: `${temporaryRoot}/consumer`
      },
      cleanup: async () => undefined
    })),
    runInstalled: vi.fn(defaultRunInstalled),
    restoreOverConsole: vi.fn(async () => undefined),
    stopVm: vi.fn(async () => {
      calls.push('stop');
      return { state: 'stopped', cleaned: true };
    }),
    removeTemporaryRoot: vi.fn(async () => {
      calls.push('remove');
    }),
    removeQmpSocket: vi.fn(async () => {
      calls.push('qmp');
    }),
    verifyResidue: vi.fn(async () => true),
    calls,
    ...overrides
  };
}

describe('Product 3 restore round-trip runner', () => {
  it('drives observe/backup/mutate, the console restore, and the REST reobserve to a passing sanitized summary', async () => {
    const stdout = captureStream();
    const deps = dependencies();

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    expect(deps.statusVm).toHaveBeenCalledWith({ instanceRoot: deps.instanceRoot });
    expect(deps.bootstrap).toHaveBeenCalledWith({
      consolePath: `${deps.instanceRoot}/console.sock`,
      privileges: FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES
    });
    expect(deps.runInstalled).toHaveBeenCalledTimes(2);
    expect(deps.runInstalled).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        invocation: {
          command: '/private/SENTINEL_TEMPORARY/consumer/node_modules/.bin/opnsense-mcp',
          arguments: [],
          cwd: '/private/SENTINEL_TEMPORARY/consumer'
        },
        configPath: `${deps.instanceRoot}/SENTINEL_CONNECTION.json`,
        stateDir: '/private/SENTINEL_TEMPORARY/mcp-state',
        phase: 'mutate',
        signal: expect.any(AbortSignal)
      })
    );
    expect(deps.runInstalled).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        configPath: `${deps.instanceRoot}/SENTINEL_CONNECTION.json`,
        phase: 'reobserve',
        signal: expect.any(AbortSignal)
      })
    );
    expect(deps.restoreOverConsole).toHaveBeenCalledWith({
      consolePath: `${deps.instanceRoot}/console.sock`,
      backupXml: SENTINEL_BACKUP_XML
    });
    expect(deps.calls).toEqual(['start', 'qmp', 'stop', 'remove']);
    expect(deps.writeAttestation).toHaveBeenCalledOnce();
    expect(deps.writeAttestation).toHaveBeenCalledWith(
      deps.attestationPath,
      expect.objectContaining({ checks: completeChecks() })
    );

    const output = stdout.output();
    expect(output.split('\n').filter(Boolean)).toHaveLength(1);
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      status: 'passed',
      failureStage: null,
      checks: completeChecks()
    });
  });

  it('orders the mutate session before the console restore before the reobserve session', async () => {
    const order = [];
    const stdout = captureStream();
    const deps = dependencies({
      runInstalled: vi.fn(async ({ phase }) => {
        order.push(`runInstalled:${phase}`);
        return defaultRunInstalled({ phase });
      }),
      restoreOverConsole: vi.fn(async () => {
        order.push('restoreOverConsole');
      })
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    expect(order).toEqual(['runInstalled:mutate', 'restoreOverConsole', 'runInstalled:reobserve']);
  });

  it('writes an attestation payload with exactly the expected key set, schemaVersion 2, and no leaked private data', async () => {
    const stdout = captureStream();
    let capturedAttestation;
    const deps = dependencies({
      writeAttestation: vi.fn(async (_path, attestation) => {
        capturedAttestation = attestation;
      })
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    // Exact key set, not objectContaining: a payload with any extra field (a leaked path, a
    // credential, an XML fragment) must fail this, not just a payload missing an expected one.
    expect(Object.keys(capturedAttestation).sort()).toEqual([
      'checks',
      'clientVersion',
      'commit',
      'host',
      'image',
      'node',
      'protocolVersion',
      'scenario',
      'schemaVersion',
      'tree'
    ]);
    expect(capturedAttestation.schemaVersion).toBe(2);
    expect(capturedAttestation.checks).toEqual(completeChecks());
    expect(JSON.stringify(capturedAttestation)).not.toMatch(
      /SENTINEL|\/private|opnsense\.internal|192\.0\.2|<opnsense>|<\?xml|opnsense-mcp|console\.sock/iu
    );
  });

  it('wires the QMP-transformed spawn into the VM launch', async () => {
    const stdout = captureStream();
    const spawnQemuFake = vi.fn(() => ({ pid: 424_242, unref: () => undefined }));
    const deps = dependencies({ spawnQemu: spawnQemuFake });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    expect(deps.startVm).toHaveBeenCalledWith(
      expect.objectContaining({ spawnVm: expect.any(Function) })
    );
    // Invoke the captured closure directly (never through the always-faked `startVm`, which never
    // calls it itself) against buildQemuArguments' real output, and check it delegates to the
    // injected spawn with deriveQmpQemuArguments' transform applied — never a real subprocess
    // spawn, since `spawnQemuFake` replaces the real `spawnQemu` for this call entirely.
    const passedSpawnVm = deps.startVm.mock.calls[0][0].spawnVm;
    const realArguments = buildQemuArguments({
      overlayPath: '/private/SENTINEL_OVERLAY/overlay.qcow2',
      consolePath: `${deps.instanceRoot}/console.sock`,
      pidPath: `${deps.instanceRoot}/qemu.pid`,
      accelerator: 'tcg',
      nonce: 'a'.repeat(16)
    });

    passedSpawnVm('qemu-system-x86_64', realArguments);

    expect(spawnQemuFake).toHaveBeenCalledWith(
      'qemu-system-x86_64',
      deriveQmpQemuArguments(realArguments, `${deps.instanceRoot}/qmp.sock`)
    );
  });

  it('removes its own QMP socket before the shared VM stop runs', async () => {
    const stdout = captureStream();
    const order = [];
    const deps = dependencies({
      removeQmpSocket: vi.fn(async (path) => {
        order.push(`removeQmpSocket:${path}`);
      }),
      stopVm: vi.fn(async () => {
        order.push('stop');
        return { state: 'stopped', cleaned: true };
      })
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    // product1b-lifecycle.mjs's shared stop only unlinks its own fixed file list and then rmdir's
    // instanceRoot, swallowing ENOTEMPTY — so this scenario's own qmp.sock must be gone BEFORE
    // that rmdir runs, or a real run would leave instanceRoot behind and residueFree would go
    // false on an otherwise-perfect restore.
    expect(order).toEqual([`removeQmpSocket:${deps.instanceRoot}/qmp.sock`, 'stop']);
  });

  it('treats a failed QMP socket removal as a cleanup failure, refusing residue-free and the attestation', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      removeQmpSocket: vi.fn(async () => Promise.reject(new Error('EACCES')))
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
    const parsed = JSON.parse(stdout.output());
    expect(parsed.checks.residueFree).toBe(false);
    expect(parsed.failureStage).toBe('cleanup');
    expect(deps.writeAttestation).not.toHaveBeenCalled();
  });

  it('leaves backupRestored and stateReverted false with a set failure stage when the console restore throws, and writes no attestation', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      restoreOverConsole: vi.fn(async () => {
        throw new Error('console restore boom');
      })
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.runInstalled).toHaveBeenCalledTimes(1);
    // The QMP socket cleanup is not conditioned on a clean run: `failureStage` is 'restore' (not
    // null) by the time cleanup runs here, and the unlink must still happen — a real `qmp.sock`
    // left behind on ANY failure path is exactly what would silently defeat `residueFree` later.
    expect(deps.removeQmpSocket).toHaveBeenCalledWith(`${deps.instanceRoot}/qmp.sock`);
    expect(deps.calls).toEqual(['start', 'qmp', 'stop', 'remove']);
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdout.output());
    expect(parsed.status).toBe('failed');
    expect(parsed.failureStage).toBe('restore');
    expect(parsed.checks.aliasCreated).toBe(true);
    expect(parsed.checks.backupRestored).toBe(false);
    expect(parsed.checks.stateReverted).toBe(false);
    expect(stdout.output()).not.toMatch(/SENTINEL|\/private/iu);
  });

  it('reports a safe console stage when the console restore throws a Product3RestoreConsoleError', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      restoreOverConsole: vi.fn(async () => {
        throw new Product3RestoreConsoleError('loader');
      })
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.calls).toEqual(['start', 'qmp', 'stop', 'remove']);
    const parsed = JSON.parse(stdout.output());
    expect(parsed.failureStage).toBe('loader');
    expect(parsed.checks.backupRestored).toBe(false);
  });

  it('leaves stateReverted false when the post-restore REST readback still shows the mutation', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      runInstalled: vi.fn(async ({ phase }) =>
        phase === 'mutate'
          ? { checks: mutationChecks(), backupXml: SENTINEL_BACKUP_XML }
          : { checks: { stateReverted: false } }
      )
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.restoreOverConsole).toHaveBeenCalledOnce();
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdout.output());
    expect(parsed.checks.backupRestored).toBe(true);
    expect(parsed.checks.stateReverted).toBe(false);
  });

  it('emits a sanitized boolean-only summary with no path, credential, or XML content', async () => {
    const stdout = captureStream();
    const deps = dependencies();

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(0);

    const output = stdout.output();
    expect(output).not.toMatch(
      /SENTINEL|\/private|opnsense\.internal|192\.0\.2|<opnsense>|<\?xml|opnsense-mcp/iu
    );
  });

  it('does not attempt the console restore when the mutate session itself fails', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      runInstalled: vi.fn(async ({ phase }) =>
        phase === 'mutate'
          ? { checks: { ...mutationChecks(), aliasPresent: false }, backupXml: undefined }
          : { checks: reobserveChecks() }
      )
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.restoreOverConsole).not.toHaveBeenCalled();
    expect(deps.runInstalled).toHaveBeenCalledTimes(1);
    expect(deps.calls).toEqual(['start', 'qmp', 'stop', 'remove']);
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    const parsed = JSON.parse(stdout.output());
    expect(parsed.checks.aliasPresent).toBe(false);
    expect(parsed.checks.backupRestored).toBe(false);
    expect(parsed.checks.stateReverted).toBe(false);
  });

  it('fails closed before startup when the VM is not freshly stopped', async () => {
    const stdout = captureStream();
    const deps = dependencies({ statusVm: vi.fn(async () => ({ state: 'running' })) });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.startVm).not.toHaveBeenCalled();
    expect(deps.runInstalled).not.toHaveBeenCalled();
    expect(deps.restoreOverConsole).not.toHaveBeenCalled();
    expect(deps.stopVm).not.toHaveBeenCalled();
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'preflight'
    });
  });

  it('rejects a dirty starting tree before doctor or VM startup', async () => {
    const stdout = captureStream();
    const deps = dependencies({ inspectGit: vi.fn(async () => ({ clean: false })) });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.doctor).not.toHaveBeenCalled();
    expect(deps.startVm).not.toHaveBeenCalled();
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'preflight'
    });
  });

  it('reports a safe Product 1B bootstrap stage after stopping the owned VM', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      bootstrap: vi.fn(async () => Promise.reject(new Product1bBootstrapError('heredoc-lines')))
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.calls).toEqual(['start', 'qmp', 'stop']);
    expect(deps.runInstalled).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'heredoc-lines'
    });
    expect(stdout.output()).not.toMatch(/SENTINEL|\/private/iu);
  });

  it('refuses to bind evidence when the commit changes during the live run', async () => {
    const stdout = captureStream();
    const inspectGit = vi
      .fn()
      .mockResolvedValueOnce({ clean: true, commit: COMMIT, tree: TREE })
      .mockResolvedValueOnce({ clean: true, commit: '3'.repeat(40), tree: '4'.repeat(40) });
    const deps = dependencies({ inspectGit });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(inspectGit).toHaveBeenCalledTimes(2);
    expect(deps.writeAttestation).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'attestation'
    });
  });

  it('reports cleanup failure and refuses to claim residue-free state', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      removeTemporaryRoot: vi.fn(async () => Promise.reject(new Error('cleanup'))),
      verifyResidue: vi.fn(async () => false)
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'cleanup',
      checks: { vmStopped: true, residueFree: false }
    });
    expect(deps.writeAttestation).not.toHaveBeenCalled();
  });

  it('cancels an in-flight mutate session without waiting for it to settle, and skips the console restore', async () => {
    const stdout = captureStream();
    const signalSource = new EventEmitter();
    let started;
    const mutateStarted = new Promise((resolve) => {
      started = resolve;
    });
    const deps = dependencies({
      signalSource,
      runInstalled: vi.fn(
        ({ phase, signal }) =>
          new Promise((_resolve, reject) => {
            if (phase === 'mutate') started();
            signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
          })
      )
    });

    const run = runProduct3Restore({ ...deps, stdout: stdout.stream });
    await mutateStarted;
    signalSource.emit('SIGTERM');

    await expect(run).resolves.toBe(3);
    expect(deps.calls).toEqual(['start', 'qmp', 'stop', 'remove']);
    expect(deps.restoreOverConsole).not.toHaveBeenCalled();
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'interrupted'
    });
  });

  it('finishes cleanup after a signal received between the mutate session and the console restore', async () => {
    const stdout = captureStream();
    const signalSource = new EventEmitter();
    const deps = dependencies({
      signalSource,
      runInstalled: vi.fn(async ({ phase }) => {
        if (phase === 'mutate') {
          signalSource.emit('SIGTERM');
          return { checks: mutationChecks(), backupXml: SENTINEL_BACKUP_XML };
        }
        return { checks: reobserveChecks() };
      })
    });

    const run = runProduct3Restore({ ...deps, stdout: stdout.stream });

    await expect(run).resolves.toBe(3);
    expect(deps.restoreOverConsole).not.toHaveBeenCalled();
    expect(deps.runInstalled).toHaveBeenCalledTimes(1);
    expect(deps.calls).toEqual(['start', 'qmp', 'stop', 'remove']);
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
    expect(JSON.parse(stdout.output())).toMatchObject({
      status: 'failed',
      failureStage: 'interrupted'
    });
  });

  it('accepts exactly one absolute attestation-output CLI flag', () => {
    const outputPath = join(tmpdir(), 'product3-restore-vm.json');

    expect(parseProduct3RestoreArguments(['--attestation-out', outputPath])).toEqual({
      attestationPath: outputPath
    });
    for (const argumentsList of [
      [],
      ['--attestation-out'],
      ['--attestation-out', 'docs/evidence/product3-restore-vm.json'],
      ['--attestation-out', outputPath, 'extra'],
      ['--unknown', outputPath]
    ]) {
      expect(() => parseProduct3RestoreArguments(argumentsList)).toThrow(
        'Usage: product3-restore.mjs --attestation-out <absolute-path>'
      );
    }
  });
});

describe('scenario-scoped QMP QEMU argument derivation', () => {
  function baseArguments() {
    return buildQemuArguments({
      overlayPath: '/private/SENTINEL_OVERLAY/overlay.qcow2',
      consolePath: '/private/SENTINEL_INSTANCE/console.sock',
      pidPath: '/private/SENTINEL_INSTANCE/qemu.pid',
      accelerator: 'tcg',
      nonce: 'a'.repeat(16)
    });
  }

  it('adds a QMP unix-socket monitor beside the pinned -monitor none and drops -no-reboot', () => {
    const qmpPath = '/private/SENTINEL_INSTANCE/qmp.sock';
    const base = baseArguments();

    const derived = deriveQmpQemuArguments(base, qmpPath);

    expect(base).toContain('-no-reboot');
    expect(derived).not.toContain('-no-reboot');
    // '-monitor none' is pinned, deliberate suppression of the default HMP monitor; '-qmp' is an
    // independent channel that must not turn that suppression back off, so the pair survives
    // untouched rather than being replaced.
    const monitorIndex = derived.indexOf('-monitor');
    expect(monitorIndex).toBeGreaterThan(-1);
    expect(derived[monitorIndex + 1]).toBe('none');
    const qmpIndex = derived.indexOf('-qmp');
    expect(qmpIndex).toBeGreaterThan(-1);
    expect(derived[qmpIndex + 1]).toBe(`unix:${qmpPath},server=on,wait=off`);
    expect(derived).toHaveLength(base.length + 1);
    // Nothing besides the trailing reboot flag is removed, and nothing besides the new '-qmp'
    // pair is added: every flag/value the shared builder produced is still present, in the same
    // relative order.
    const untouchedBase = base.filter((token) => token !== '-no-reboot');
    const untouchedDerived = [...derived];
    untouchedDerived.splice(qmpIndex, 2);
    expect(untouchedDerived).toEqual(untouchedBase);
  });

  it('rejects an argument list without the expected -monitor none pair', () => {
    expect(() =>
      deriveQmpQemuArguments(['-display', 'none'], '/private/SENTINEL_INSTANCE/qmp.sock')
    ).toThrow();
  });

  it('rejects a non-absolute QMP socket path', () => {
    expect(() => deriveQmpQemuArguments(baseArguments(), 'relative/qmp.sock')).toThrow();
  });
});

// Ports tests/vm/product1b-bootstrap.test.mjs's own fixture shape (createServer, readUntil,
// step(): read-then-echo-then-reprompt) — a real serial tty echoes a typed line back before the
// guest ever executes it, which is exactly the invariant C-1 broke: the frame markers were typed
// in cleartext, so the driver's own search matched the echo before the command's real,
// executed-looking output ever arrived. `resetGuest`/`probePort` are faked so these tests drive
// only the serial console dialogue — nothing here opens a QMP socket or touches the network.
describe('the console restore driver against an echoing single-user guest', () => {
  const RESTORE_LOADER_MENU_TEXT = '\r\n1. Boot Multi user [Enter]\r\n2. Boot Single User\r\n';
  const RESTORE_SHELL_PROMPT_TEXT = 'root@:/ # ';
  const RESTORE_CONTINUATION_PROMPT_TEXT = '> ';

  function readUntil(socket, predicate, maximumChunkBytes = Number.POSITIVE_INFINITY) {
    return new Promise((resolve, reject) => {
      let received = '';
      const onData = (chunk) => {
        received += chunk.subarray(0, maximumChunkBytes).toString('utf8');
        if (predicate(received)) {
          cleanup();
          resolve(received);
        }
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onClose = () => {
        cleanup();
        reject(new Error('fixture socket closed early'));
      };
      const cleanup = () => {
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('close', onClose);
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('close', onClose);
    });
  }

  function encodedLines(xml) {
    const lines = Buffer.from(xml, 'utf8')
      .toString('base64')
      .match(/.{1,76}/gu);
    if (lines === null) throw new Error('fixture encoding failed');
    return lines;
  }

  // Drives the fixed single-user dialogue this driver expects, up to and including the
  // decode/apply command, and returns every byte the driver typed. `decodeReply` is the fake
  // guest's own choice of what the command's REAL, executed output looks like — a real,
  // duplicated, or mismatched framed digest, entirely independent of the echo the guest sends
  // first, exactly modeling how a real tty separates the two.
  async function runSingleUserRestoreGuest(socket, { backupXml, decodeReply }) {
    const sent = [];
    const step = async (prompt, limit = 512) => {
      const command = await readUntil(socket, (input) => input.endsWith('\n'), limit);
      sent.push(command);
      // A real serial tty echoes the typed line before printing the next prompt.
      socket.write(command.replace(/\n$/u, '\r\n'));
      if (prompt !== '') socket.write(prompt);
      return command;
    };

    socket.write(RESTORE_LOADER_MENU_TEXT);
    sent.push(await readUntil(socket, (input) => input.length >= 1, 8));
    socket.write('2\r\nBooting [single user]...\r\n');
    socket.write('Enter full pathname of shell or RETURN for /bin/sh: ');
    sent.push(await readUntil(socket, (input) => input.endsWith('\n'), 8));
    socket.write(`\r\n${RESTORE_SHELL_PROMPT_TEXT}`);

    await step(RESTORE_SHELL_PROMPT_TEXT); // remount
    await step(RESTORE_SHELL_PROMPT_TEXT); // umask
    await step(RESTORE_CONTINUATION_PROMPT_TEXT); // heredoc-open
    for (const line of encodedLines(backupXml)) {
      const uploaded = await step(RESTORE_CONTINUATION_PROMPT_TEXT, 128);
      if (uploaded !== `${line}\n`) throw new Error('fixture upload mismatch');
    }
    await step(RESTORE_SHELL_PROMPT_TEXT, 128); // heredoc-close (the EOF marker line)

    // The decode/apply command: echo it verbatim first — the exact invariant under test — then
    // separately emit whatever this fake guest was told to answer with as the command's real
    // output. The two are never the same bytes on the wire in a fixed run, by construction.
    const applyCommand = await readUntil(socket, (input) => input.endsWith('\n'), 4096);
    sent.push(applyCommand);
    socket.write(applyCommand.replace(/\n$/u, '\r\n'));
    socket.write(decodeReply);

    return { sent: sent.join(''), applyCommand };
  }

  async function serveRestoreConsole(socketPath, { backupXml, decodeReply }) {
    const observed = {};
    const server = createServer((socket) => {
      runSingleUserRestoreGuest(socket, { backupXml, decodeReply })
        .then((result) => {
          observed.sent = result.sent;
          observed.applyCommand = result.applyCommand;
        })
        .catch(() => socket.destroy());
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    return { server, observed };
  }

  it('lands the restore over a console that echoes every typed line before the guest executes it', async () => {
    const socketPath = await temporarySocketPath('console.sock');
    const backupXml = '<opnsense><SAMPLE_RESTORE_FIXTURE/></opnsense>';
    const expectedDigest = createHash('sha256').update(backupXml, 'utf8').digest('hex');
    const { server, observed } = await serveRestoreConsole(socketPath, {
      backupXml,
      decodeReply: `${FRAME_BEGIN}${expectedDigest}${FRAME_END}\r\n`
    });

    await expect(
      restoreOverConsole({
        consolePath: socketPath,
        backupXml,
        timeoutMs: 2_000,
        resetGuest: async () => undefined,
        probePort: async () => true
      })
    ).resolves.toBeUndefined();

    // The core C-1 property: the bytes actually typed (and therefore echoed) never spell the
    // contiguous frame marker — only the fake guest's separately written "real output" does.
    expect(observed.applyCommand).not.toContain(FRAME_BEGIN);
    expect(observed.applyCommand).not.toContain(FRAME_END);
    // The digest invocation form specifically — not just any occurrence of '/usr/bin/openssl',
    // which the earlier, unrelated base64-decode clause of the same command already contains and
    // would satisfy trivially regardless of which tool computes the digest.
    expect(observed.applyCommand).toContain('openssl dgst -sha256');
    expect(observed.applyCommand).not.toContain('/sbin/sha256');

    // The staging discipline: `umask 077` must be typed strictly between the remount and the
    // heredoc upload it protects, so the staged base64 config lands 0600, not the default 0644.
    const remountIndex = observed.sent.indexOf('/sbin/mount -u -o rw /\n');
    const umaskIndex = observed.sent.indexOf('umask 077\n');
    const heredocOpenIndex = observed.sent.indexOf(
      '/bin/cat > /usr/local/etc/mcpr.b64 <<__OPNSENSE_MCP_RESTORE_EOF__\n'
    );
    expect(remountIndex).toBeGreaterThan(-1);
    expect(umaskIndex).toBeGreaterThan(remountIndex);
    expect(heredocOpenIndex).toBeGreaterThan(umaskIndex);

    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects a console reply whose digest does not match the uploaded backup', async () => {
    const socketPath = await temporarySocketPath('console.sock');
    const backupXml = '<opnsense><SAMPLE_RESTORE_FIXTURE/></opnsense>';
    const { server } = await serveRestoreConsole(socketPath, {
      backupXml,
      decodeReply: `${FRAME_BEGIN}${'0'.repeat(64)}${FRAME_END}\r\n`
    });

    await expect(
      restoreOverConsole({
        consolePath: socketPath,
        backupXml,
        timeoutMs: 2_000,
        resetGuest: async () => undefined,
        probePort: async () => true
      })
    ).rejects.toMatchObject({ code: 'PRODUCT3_RESTORE_CONSOLE_FAILED', stage: 'decode' });

    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects a console reply that frames the digest twice', async () => {
    const socketPath = await temporarySocketPath('console.sock');
    const backupXml = '<opnsense><SAMPLE_RESTORE_FIXTURE/></opnsense>';
    const expectedDigest = createHash('sha256').update(backupXml, 'utf8').digest('hex');
    const framed = `${FRAME_BEGIN}${expectedDigest}${FRAME_END}`;
    const { server } = await serveRestoreConsole(socketPath, {
      backupXml,
      decodeReply: `${framed}${framed}\r\n`
    });

    await expect(
      restoreOverConsole({
        consolePath: socketPath,
        backupXml,
        timeoutMs: 2_000,
        resetGuest: async () => undefined,
        probePort: async () => true
      })
    ).rejects.toMatchObject({ code: 'PRODUCT3_RESTORE_CONSOLE_FAILED', stage: 'decode' });

    await new Promise((resolve) => server.close(resolve));
  });
});

describe('Product 3 restore VM attestation schema', () => {
  it('exports the restore check-key set as the alias set plus backupRestored and stateReverted, sorted and frozen', () => {
    expect(VM_RESTORE_ATTESTATION_CHECK_KEYS).toEqual([
      'aliasAbsentAfter',
      'aliasAbsentBefore',
      'aliasCreated',
      'aliasDeleted',
      'aliasPresent',
      'backupRestored',
      'bootstrap',
      'doctor',
      'packageInstalled',
      'residueFree',
      'stateReverted',
      'vmStarted',
      'vmStopped',
      'writableSurface'
    ]);
    expect(Object.isFrozen(VM_RESTORE_ATTESTATION_CHECK_KEYS)).toBe(true);
  });

  it('accepts a 14-key all-true checks record and produces stable, recursively key-sorted canonical bytes', () => {
    const reordered = restoreAttestationInput({
      checks: {
        stateReverted: true,
        vmStopped: true,
        residueFree: true,
        writableSurface: true,
        aliasPresent: true,
        aliasDeleted: true,
        bootstrap: true,
        aliasAbsentAfter: true,
        packageInstalled: true,
        vmStarted: true,
        aliasCreated: true,
        aliasAbsentBefore: true,
        backupRestored: true,
        doctor: true
      }
    });

    const canonical = serializeVmRestoreAttestation(reordered);

    expect(canonical).toBe(serializeVmRestoreAttestation(restoreAttestationInput()));
    expect(buildVmRestoreAttestation(reordered)).toEqual(JSON.parse(canonical));
    expect(JSON.parse(canonical)).toMatchObject({ schemaVersion: 2, checks: completeChecks() });
  });

  it('rejects an input missing either new key (backupRestored or stateReverted)', () => {
    const missingBackupRestored = completeChecks();
    delete missingBackupRestored.backupRestored;
    expect(() =>
      serializeVmRestoreAttestation(restoreAttestationInput({ checks: missingBackupRestored }))
    ).toThrow('VM_ATTESTATION_INVALID');

    const missingStateReverted = completeChecks();
    delete missingStateReverted.stateReverted;
    expect(() =>
      serializeVmRestoreAttestation(restoreAttestationInput({ checks: missingStateReverted }))
    ).toThrow('VM_ATTESTATION_INVALID');
  });

  it('rejects the sealed alias serializer given a 14-key checks record — the alias shape must stay untouched', () => {
    // The regression this task must not cause: widening the alias-only VM_ATTESTATION_CHECK_KEYS
    // instead of adding a separate restore set would make this assertion fail (the sealed alias
    // evidence's serializer would silently start accepting a shape it never sealed against).
    expect(() => serializeVmAttestation(restoreAttestationInput())).toThrow(
      'VM_ATTESTATION_INVALID'
    );
  });
});

describe('Product 3 restore VM attestation atomic writer', () => {
  it('writes through serializeVmRestoreAttestation, accepting the 14-check shape', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-restore-attestation-'));
    attestationRoots.push(root);
    const outputPath = join(root, 'product3-restore-vm.json');

    await writeVmRestoreAttestationAtomic(outputPath, restoreAttestationInput());

    expect(await readFile(outputPath, 'utf8')).toBe(
      serializeVmRestoreAttestation(restoreAttestationInput())
    );
  });

  it('rejects an alias-shaped 12-check attestation and a schemaVersion-3 attestation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-restore-attestation-'));
    attestationRoots.push(root);
    const outputPath = join(root, 'product3-restore-vm.json');
    const aliasShapedChecks = completeChecks();
    delete aliasShapedChecks.backupRestored;
    delete aliasShapedChecks.stateReverted;

    // Validation runs (and throws VM_ATTESTATION_INVALID, via serializeVmRestoreAttestation)
    // before any file-system mechanics start — mirroring writeVmAttestationAtomic's own
    // established shape, where a shape rejection is distinct from an I/O failure.
    await expect(
      writeVmRestoreAttestationAtomic(
        outputPath,
        restoreAttestationInput({ checks: aliasShapedChecks })
      )
    ).rejects.toThrow('VM_ATTESTATION_INVALID');
    await expect(
      writeVmRestoreAttestationAtomic(outputPath, restoreAttestationInput({ schemaVersion: 3 }))
    ).rejects.toThrow('VM_ATTESTATION_INVALID');
  });

  // Mirrors product3-alias.test.mjs's own "cleans the same-directory temporary file when the
  // atomic rename fails" leg exactly, against this file's duplicated copy of the same mechanics:
  // a failed rename must still remove the `.pending-<nonce>` temp file it created, or a leaked
  // temp file next to the real evidence path would trip the verifier's worktree-clean check at
  // landing (an unrelated untracked file, not one of the two allowed evidence paths).
  it('cleans the same-directory temporary file when the atomic rename fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-restore-attestation-'));
    attestationRoots.push(root);
    const outputPath = join(root, 'product3-restore-vm.json');
    await writeFile(outputPath, 'old\n', 'utf8');

    await expect(
      writeVmRestoreAttestationAtomic(outputPath, restoreAttestationInput(), {
        renameFile: async () => {
          throw new Error('rename failed');
        }
      })
    ).rejects.toThrow('VM_ATTESTATION_WRITE_FAILED');

    expect(await readFile(outputPath, 'utf8')).toBe('old\n');
    expect(await readdir(root)).toEqual(['product3-restore-vm.json']);
  });

  // Mirrors product3-alias.test.mjs's own "creates a missing output parent and still leaves only
  // the final atomic file" leg: the directory-creation path is exercised, and no stray temp file
  // or partial directory is left behind alongside the real one.
  it('creates a missing output parent and still leaves only the final atomic file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-restore-attestation-'));
    attestationRoots.push(root);
    const missingParent = join(root, 'missing');
    const outputPath = join(missingParent, 'product3-restore-vm.json');

    await writeVmRestoreAttestationAtomic(outputPath, restoreAttestationInput());

    expect(await readFile(outputPath, 'utf8')).toBe(
      serializeVmRestoreAttestation(restoreAttestationInput())
    );
    expect(await readdir(root)).toEqual(['missing']);
    expect(await readdir(missingParent)).toEqual(['product3-restore-vm.json']);
  });
});

describe('Product 3 restore live default attestation writer wiring', () => {
  it('wires the real default writer through serializeVmRestoreAttestation, not the sealed alias serializer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opnsense-product3-restore-live-attestation-'));
    attestationRoots.push(root);
    const outputPath = join(root, 'product3-restore-vm.json');
    const stdout = captureStream();
    const deps = dependencies();
    // Deleted, not overridden with a fake: this test's whole point is exercising the REAL default
    // writer `runProduct3Restore` falls back to when the caller supplies none, never the
    // always-faked `writeAttestation` every other test in this file injects.
    delete deps.writeAttestation;

    // If the default writer ever reverts to the sealed alias serializer (which hard-rejects any
    // 14-key `checks` record), this run's own attestation stage throws internally, flipping
    // `failureStage` to 'attestation' and the resolved exit code from 0 to 2 — so a correct result
    // here is itself proof the wiring point is `serializeVmRestoreAttestation`, not merely a
    // content assertion bolted on after the fact.
    await expect(
      runProduct3Restore({ ...deps, attestationPath: outputPath, stdout: stdout.stream })
    ).resolves.toBe(0);

    const written = await readFile(outputPath, 'utf8');
    expect(written).toBe(serializeVmRestoreAttestation(JSON.parse(written)));
    expect(JSON.parse(written)).toMatchObject({ schemaVersion: 2, checks: completeChecks() });
  });
});
