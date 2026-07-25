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
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  BoundedCommandFailure,
  buildOpenCodeEvidence,
  collectToolEvidence,
  runModelCommand
} from '../../scripts/run-opencode-smoke.mjs';

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

  it('writes blocked evidence and removes temporary state when model output exceeds the bound', async () => {
    const fixtureRoot = await mkdtemp(join(tmpdir(), 'opnsense-opencode-test-'));
    const fakeOpenCode = join(fixtureRoot, 'opencode');
    const evidencePath = join(fixtureRoot, 'evidence.json');
    const rootsBefore = await smokeRoots();
    try {
      const isolatedRunner = await createIsolatedRunner(fixtureRoot);
      await writeFile(
        fakeOpenCode,
        `#!/usr/bin/env node
const command = process.argv.slice(2);
if (command[0] === '--version') {
  process.stdout.write('1.18.3\\n');
} else if (command[0] === 'mcp' && command[1] === 'list') {
  process.stdout.write('opnsense connected\\n');
} else if (command[0] === 'run') {
  process.stdout.write('x'.repeat(4 * 1024 * 1024 + 1));
  setInterval(() => {}, 1_000);
} else {
  process.exitCode = 64;
}
`,
        { mode: 0o700 }
      );
      await chmod(fakeOpenCode, 0o700);

      const result = await runCli(
        ['--evidence-out', evidencePath],
        {
          OPENCODE_BIN: fakeOpenCode
        },
        isolatedRunner
      );
      const evidence = JSON.parse(await readFile(evidencePath, 'utf8'));

      expect(result).toMatchObject({ code: 3, signal: null, stderr: '' });
      expect(evidence).toMatchObject({
        status: 'blocked',
        blockedReason: 'model-service-unavailable',
        checks: { cleanupConfirmed: true }
      });
      expect(await smokeRoots()).toEqual(rootsBefore);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  }, 30_000);

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

    expect(passed.claim).toContain('only OpenCode 1.18.3');
    expect(passed.claim).toContain('synthetic HTTPS');
    expect(blocked.claim).toContain('No OpenCode routing claim');
    expect(blocked.blockedReason).toBe('model-service-unavailable');
    expect(JSON.stringify([passed, blocked])).not.toMatch(/\/private\/|\/var\/folders\/|SECRET/u);
  });
});
