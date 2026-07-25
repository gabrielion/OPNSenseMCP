// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BoundedCommandFailure,
  OUTPUT_LIMIT_BYTES,
  buildOpenCodeEvidence,
  collectToolEvidence,
  run,
  runModelCommand,
  runSmoke
} from '../../scripts/run-opencode-smoke.mjs';
import {
  PRIVATE_FIXTURE_BASE_NAME,
  createPrivateFixtureRoot,
  removeOutstandingPrivateFixtureRoots,
  removePrivateFixtureRoot
} from '../../scripts/testing/private-fixture-root.mjs';
import { prepareInstalledPackage } from '../../scripts/testing/prepare-installed-package.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runner = join(repository, 'scripts', 'run-opencode-smoke.mjs');
const smokePrefix = 'opnsense-opencode-smoke-';
const packageInputs = [
  'package.json',
  'package-lock.json',
  'README.md',
  'LICENSE',
  'src',
  'scripts',
  'tsconfig.json',
  'tsconfig.build.json'
];

function runCli(arguments_, environment, runnerPath = runner) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [runnerPath, ...arguments_], {
      cwd: repository,
      env: { ...process.env, ...environment },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', rejectRun);
    child.once('close', (code, signal) =>
      resolveRun({
        code,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8')
      })
    );
  });
}

async function smokeRoots() {
  return (await readdir(tmpdir())).filter((entry) => entry.startsWith(smokePrefix)).sort();
}

/**
 * The smoke now builds below the private fixture base, so residue must be proven where it can
 * actually appear. Listing the global temporary directory alone would be a tautology.
 */
async function privateFixtureEntries() {
  try {
    return (await readdir(join(homedir(), PRIVATE_FIXTURE_BASE_NAME))).sort();
  } catch {
    return [];
  }
}

function runFixtureCommand(command, argumentsList, options) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, [...argumentsList], {
      cwd: options.cwd,
      env: { ...options.environment },
      detached: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', () =>
      finish(() => rejectRun(new Error('Fixture command failed to start')))
    );
    child.once('close', (code, signal) =>
      finish(() =>
        resolveRun({
          code,
          signal,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8')
        })
      )
    );
    const deadline = setTimeout(() => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The rejection below remains authoritative.
      }
      finish(() => rejectRun(new Error('Fixture command timed out')));
    }, options.timeoutMs);
    deadline.unref();
  });
}

let preparationRoot;
let prepared;

beforeAll(async () => {
  preparationRoot = await createPrivateFixtureRoot('opnsense-opencode-package');
  prepared = await prepareInstalledPackage({
    repositoryRoot: repository,
    workRoot: preparationRoot,
    run: runFixtureCommand
  });
}, 600_000);

afterAll(async () => {
  if (prepared !== undefined) await prepared.cleanup();
  if (preparationRoot !== undefined) await removePrivateFixtureRoot(preparationRoot);
  // A leaked root means some path (including a hard test timeout) skipped its own cleanup.
  expect(await removeOutstandingPrivateFixtureRoots()).toEqual([]);
});

async function createIsolatedRunner(fixtureRoot) {
  const packageCopy = join(fixtureRoot, 'runner-package');
  await mkdir(packageCopy);
  await Promise.all(
    packageInputs.map((input) =>
      cp(join(repository, input), join(packageCopy, input), { recursive: true })
    )
  );
  await symlink(
    join(repository, 'node_modules'),
    join(packageCopy, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir'
  );
  return join(await realpath(packageCopy), 'scripts', 'run-opencode-smoke.mjs');
}

describe('OpenCode Product 1A smoke evidence', () => {
  it('keeps only closed tool names and SHA-256 digests from OpenCode events', () => {
    const events = [
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_describe',
          state: {
            status: 'completed',
            input: { resource: 'system.status' },
            output: '{"mode":"resource"}'
          }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_get',
          state: {
            status: 'completed',
            input: { resource: 'system.status' },
            output: '{"status":"ok"}'
          }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_list',
          state: {
            status: 'completed',
            input: { resource: 'core.services' },
            output: '{"total":1}'
          }
        }
      }
    ];

    const tools = collectToolEvidence(events);

    expect(tools.map(({ name }) => name)).toEqual(['opn_describe', 'opn_get', 'opn_list']);
    for (const tool of tools) {
      expect(tool.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(tool.resultSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(tool)).toEqual(['name', 'inputSha256', 'resultSha256']);
    }
    expect(JSON.stringify(tools)).not.toContain('system.status');
  });

  it('rejects foreign, non-terminal, errored, and error-bearing tool events', () => {
    const events = [
      {
        type: 'tool_use',
        part: {
          tool: 'foreign_opn_get',
          state: { status: 'completed', input: {}, output: '{"status":"ok"}' }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_get',
          state: { status: 'error', input: {}, output: '{"status":"ok"}' }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_list',
          state: { input: {}, output: '{"total":1}' }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_describe',
          state: {
            status: 'completed',
            input: {},
            output: { isError: true, content: [{ type: 'text', text: 'refused' }] }
          }
        }
      }
    ];

    expect(collectToolEvidence(events)).toEqual([]);
  });

  it.each(['spawn', 'timeout', 'output-limit'])(
    'classifies a bounded model %s failure as external unavailability',
    async (kind) => {
      const outcome = await runModelCommand(async () => {
        throw new BoundedCommandFailure(kind);
      });

      expect(outcome).toEqual({ status: 'blocked', failure: kind, groupCleanupConfirmed: false });
    }
  );

  it('maps the smoke result onto the shipped command-line exit code and report', async () => {
    const blockedWrites = [];
    const passedWrites = [];
    const seen = [];

    const blockedExit = await run(['--evidence-out', '/tmp/evidence.json'], {
      runSmoke: (options) => {
        seen.push(options.evidencePath);
        return Promise.resolve({ status: 'blocked', exitCode: 3 });
      },
      writeStdout: (message) => blockedWrites.push(message)
    });
    const passedExit = await run([], {
      runSmoke: () => Promise.resolve({ status: 'passed', exitCode: 0 }),
      writeStdout: (message) => passedWrites.push(message)
    });

    expect(blockedExit).toBe(3);
    expect(blockedWrites).toEqual(['OpenCode Product 1A smoke: blocked\n']);
    expect(seen).toEqual(['/tmp/evidence.json']);
    expect(passedExit).toBe(0);
    expect(passedWrites).toEqual(['OpenCode Product 1A smoke: passed\n']);
  });

  it('rejects unusable command-line arguments before running a smoke', async () => {
    let executed = false;

    await expect(
      run(['--unknown'], {
        runSmoke: () => {
          executed = true;
          return Promise.resolve({ status: 'passed', exitCode: 0 });
        },
        writeStdout: () => undefined
      })
    ).rejects.toThrow('Usage: run-opencode-smoke.mjs [--evidence-out <path>]');
    expect(executed).toBe(false);
  });

  it('carries a confirmed process-group cleanup through the model command seam', async () => {
    const outcome = await runModelCommand(async () => {
      throw new BoundedCommandFailure('output-limit', true);
    });

    expect(outcome).toEqual({
      status: 'blocked',
      failure: 'output-limit',
      groupCleanupConfirmed: true
    });
  });

  it('classifies a non-zero model result as external unavailability', async () => {
    const outcome = await runModelCommand(async () => ({
      code: 17,
      signal: null,
      stdout: '',
      stderr: 'service unavailable'
    }));

    expect(outcome).toEqual({ status: 'blocked' });
  });

  it('preserves unknown local failures from the model command seam', async () => {
    await expect(
      runModelCommand(async () => {
        throw new Error('local-programming-failure');
      })
    ).rejects.toThrow('local-programming-failure');
  });

  it('reaches the fake client, exceeds the configured cap, and confirms group cleanup', async () => {
    const fixtureRoot = await createPrivateFixtureRoot('opnsense-opencode-output-limit');
    const fakeOpenCode = join(fixtureRoot, 'opencode');
    const evidencePath = join(fixtureRoot, 'evidence.json');
    const rootsBefore = await smokeRoots();
    const privateEntriesBefore = await privateFixtureEntries();
    try {
      await writeFile(
        fakeOpenCode,
        `#!/usr/bin/env node
const command = process.argv.slice(2);
if (command[0] === '--version') {
  process.stdout.write('1.18.3\\n');
} else if (command[0] === 'mcp' && command[1] === 'list') {
  process.stdout.write('opnsense connected\\n');
} else if (command[0] === 'run') {
  process.stdout.write('x'.repeat(4096));
  setInterval(() => {}, 1_000);
} else {
  process.exitCode = 64;
}
`,
        { mode: 0o700 }
      );
      await chmod(fakeOpenCode, 0o700);

      const result = await runSmoke({
        evidencePath,
        preparePackage: () => Promise.resolve(prepared),
        openCodeBinary: fakeOpenCode,
        outputLimitBytes: 64,
        workRoot: fixtureRoot
      });
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));

      expect(result).toEqual({
        status: 'blocked',
        exitCode: 3,
        blockedReason: 'model-service-unavailable',
        modelFailure: 'output-limit',
        groupCleanupConfirmed: true
      });
      expect(OUTPUT_LIMIT_BYTES).toBe(4 * 1024 * 1024);
      expect(evidence).toMatchObject({
        status: 'blocked',
        blockedReason: 'model-service-unavailable',
        checks: { mcpConnected: true, cleanupConfirmed: true }
      });
      expect(JSON.stringify(evidence)).not.toContain(fixtureRoot);
      expect(await smokeRoots()).toEqual(rootsBefore);
      // The injected work root is the only place this run may build, and its working directory
      // must be gone; no new private fixture root may have appeared either.
      expect((await readdir(fixtureRoot)).filter((entry) => entry.startsWith('smoke-'))).toEqual(
        []
      );
      expect(await privateFixtureEntries()).toEqual(privateEntriesBefore);
    } finally {
      await removePrivateFixtureRoot(fixtureRoot);
    }
  }, 120_000);

  it('reports an unmeasured process-group cleanup as unknown rather than confirmed', async () => {
    const fixtureRoot = await createPrivateFixtureRoot('opnsense-opencode-unmeasured');
    const fakeOpenCode = join(fixtureRoot, 'opencode');
    const evidencePath = join(fixtureRoot, 'evidence.json');
    try {
      await writeFile(
        fakeOpenCode,
        `#!/usr/bin/env node
const command = process.argv.slice(2);
if (command[0] === '--version') {
  process.stdout.write('1.18.3\\n');
} else if (command[0] === 'mcp' && command[1] === 'list') {
  process.stdout.write('opnsense connected\\n');
} else if (command[0] === 'run') {
  process.stdout.write('{"type":"text"}\\n');
} else {
  process.exitCode = 64;
}
`,
        { mode: 0o700 }
      );
      await chmod(fakeOpenCode, 0o700);

      const result = await runSmoke({
        evidencePath,
        preparePackage: () => Promise.resolve(prepared),
        openCodeBinary: fakeOpenCode,
        workRoot: fixtureRoot
      });

      // The model command completed, so no bounded failure was raised and nothing was measured.
      // Reporting `true` here would be an unearned cleanup claim.
      expect(result).toEqual({
        status: 'blocked',
        exitCode: 3,
        blockedReason: 'tool-routing-unverified',
        modelFailure: null,
        groupCleanupConfirmed: null
      });
    } finally {
      await removePrivateFixtureRoot(fixtureRoot);
    }
  }, 120_000);

  it('leaves existing evidence untouched and exits locally after a configuration failure', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'opnsense-opencode-test-'));
    const evidencePath = join(fixtureRoot, 'evidence.json');
    const existingEvidence = '{"status":"passed","sentinel":"keep"}\n';
    const rootsBefore = await smokeRoots();
    try {
      const isolatedRunner = await createIsolatedRunner(fixtureRoot);
      await writeFile(evidencePath, existingEvidence, { mode: 0o600 });

      const result = await runCli(
        ['--evidence-out', evidencePath],
        {
          OPENCODE_BIN: 'relative-opencode'
        },
        isolatedRunner
      );

      expect(result).toMatchObject({
        code: 1,
        signal: null,
        stdout: '',
        stderr: 'OpenCode Product 1A smoke failed locally.\n'
      });
      expect(await readFile(evidencePath, 'utf8')).toBe(existingEvidence);
      expect(await smokeRoots()).toEqual(rootsBefore);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('builds a path-free narrow claim for passed and blocked runs', () => {
    const common = {
      clientVersion: '1.18.3',
      model: 'opencode/north-mini-code-free',
      packageName: '@gabrielion/opnsense-mcp',
      packageVersion: '0.1.0',
      packageSha256: 'a'.repeat(64),
      packageTarSha256: 'b'.repeat(64),
      tools: [],
      cleanupConfirmed: true,
      secretAbsent: true
    };
    const passed = buildOpenCodeEvidence({
      ...common,
      status: 'passed',
      mcpConnected: true,
      expectedReadsObserved: true
    });
    const blocked = buildOpenCodeEvidence({
      ...common,
      status: 'blocked',
      blockedReason: 'model-service-unavailable',
      mcpConnected: true,
      expectedReadsObserved: false
    });

    expect(passed.schemaVersion).toBe(2);
    expect(passed.package).toEqual({
      name: '@gabrielion/opnsense-mcp',
      version: '0.1.0',
      sha256: 'a'.repeat(64),
      tarSha256: 'b'.repeat(64)
    });
    expect(passed.claim).toContain('only OpenCode 1.18.3');
    expect(passed.claim).toContain('synthetic HTTPS');
    expect(blocked.claim).toContain('No OpenCode routing claim');
    expect(blocked.blockedReason).toBe('model-service-unavailable');
    expect(JSON.stringify([passed, blocked])).not.toMatch(/\/private\/|\/var\/folders\/|SECRET/u);
  });
});
