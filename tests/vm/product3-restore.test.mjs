// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FIREWALL_ALIAS_BOOTSTRAP_PRIVILEGES,
  Product1bBootstrapError
} from '../../scripts/vm/product1b-bootstrap.mjs';
import { buildQemuArguments } from '../../scripts/vm/product1b-lifecycle.mjs';
import {
  Product3RestoreConsoleError,
  deriveQmpQemuArguments,
  parseProduct3RestoreArguments,
  runProduct3Restore
} from '../../scripts/vm/product3-restore.mjs';

const COMMIT = '1'.repeat(40);
const TREE = '2'.repeat(40);
// Deliberately shaped like something that would be embarrassing to leak: it carries both the
// "SENTINEL" token the other no-leak assertions already grep for and a recognizable XML fragment,
// so a summary or attestation payload that accidentally inlined the backup content trips on sight.
const SENTINEL_BACKUP_XML =
  '<?xml version="1.0"?><opnsense><SENTINEL_RESTORE_CONFIG_SIGIL/></opnsense>';

afterEach(() => {
  vi.useRealTimers();
});

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
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
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

  it('leaves backupRestored and stateReverted false with a set failure stage when the console restore throws, and writes no attestation', async () => {
    const stdout = captureStream();
    const deps = dependencies({
      restoreOverConsole: vi.fn(async () => {
        throw new Error('console restore boom');
      })
    });

    await expect(runProduct3Restore({ ...deps, stdout: stdout.stream })).resolves.toBe(2);

    expect(deps.runInstalled).toHaveBeenCalledTimes(1);
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
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

    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
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
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
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

    expect(deps.calls).toEqual(['start', 'stop']);
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
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
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
    expect(deps.calls).toEqual(['start', 'stop', 'remove']);
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

  it('replaces the -monitor none pair with a QMP unix-socket monitor and drops -no-reboot', () => {
    const qmpPath = '/private/SENTINEL_INSTANCE/qmp.sock';
    const base = baseArguments();

    const derived = deriveQmpQemuArguments(base, qmpPath);

    expect(base).toContain('-no-reboot');
    expect(derived).not.toContain('-no-reboot');
    expect(derived).not.toContain('-monitor');
    const qmpIndex = derived.indexOf('-qmp');
    expect(qmpIndex).toBeGreaterThan(-1);
    expect(derived[qmpIndex + 1]).toBe(`unix:${qmpPath},server=on,wait=off`);
    expect(derived).toHaveLength(base.length - 1);
    // Nothing besides the monitor pair and the trailing reboot flag changes: every other flag and
    // value the shared builder produced survives the transform, in the same relative order. Splice
    // out the exact pair/flag by position rather than filtering by value, since '-display none'
    // shares the literal token 'none' with '-monitor none' and must not be removed too.
    const monitorIndex = base.indexOf('-monitor');
    const untouchedBase = [...base];
    untouchedBase.splice(monitorIndex, 2);
    const rebootIndex = untouchedBase.indexOf('-no-reboot');
    untouchedBase.splice(rebootIndex, 1);
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
