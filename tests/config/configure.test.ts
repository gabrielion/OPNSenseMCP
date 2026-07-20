// SPDX-License-Identifier: AGPL-3.0-or-later
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIGURE_FILE_SYSTEM,
  IncompleteConfigurationError,
  runConfigureCommand,
  writePrivateOPNsenseConfigFile,
  type ConfigureFileSystem,
  type ConfigureTerminal
} from '../../src/config/configure.js';

const KEY = 'CONFIGURE_KEY_MUST_NOT_LEAK';
const SECRET = 'CONFIGURE_SECRET_MUST_NOT_LEAK';
let directory = '';

beforeEach(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'opnsense-configure-test-')));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function terminal(answers: readonly string[]) {
  const prompts: { message: string; masked: boolean }[] = [];
  const stdout: string[] = [];
  const stderr: string[] = [];
  const instance: ConfigureTerminal = {
    prompt: (message, options) => {
      prompts.push({ message, masked: options.masked });
      const answer = answers[prompts.length - 1];
      if (answer === undefined) throw new Error('Missing synthetic answer');
      return Promise.resolve(answer);
    },
    writeStdout: (message) => {
      stdout.push(message);
    },
    writeStderr: (message) => {
      stderr.push(message);
    }
  };
  return { instance, prompts, stdout, stderr };
}

function commandDependencies(path: string) {
  return {
    platform: 'darwin' as const,
    environment: { HOME: directory },
    resolveDefaultPath: () => path
  };
}

const document = {
  url: 'https://firewall.example',
  apiKey: KEY,
  apiSecret: SECRET
} as const;

type FailureOperation = 'writeSync' | 'closeSync' | 'linkSync' | 'unlinkSync' | 'fsyncSync';

function failAfter(
  operation: FailureOperation,
  occurrence: number,
  afterOperation = true
): ConfigureFileSystem {
  let calls = 0;
  const original = DEFAULT_CONFIGURE_FILE_SYSTEM[operation] as (...values: never[]) => unknown;
  return {
    ...DEFAULT_CONFIGURE_FILE_SYSTEM,
    [operation]: (...arguments_: never[]) => {
      calls += 1;
      if (calls === occurrence && !afterOperation) throw new Error(`injected ${operation} failure`);
      const result = original(...arguments_);
      if (calls === occurrence) throw new Error(`injected ${operation} failure`);
      return result;
    }
  } as ConfigureFileSystem;
}

async function expectNoTransactionSecrets(parent: string, finalPath: string): Promise<void> {
  const entries = await readdir(parent);
  expect(entries).not.toContain('config.json');
  for (const entry of entries) {
    const contents = await readFile(join(parent, entry), 'utf8').catch(() => '');
    expect(contents).not.toContain(KEY);
    expect(contents).not.toContain(SECRET);
  }
  await expect(lstat(finalPath)).rejects.toMatchObject({ code: 'ENOENT' });
}

describe('configure command', () => {
  it('collects both credentials through masked prompts and writes a private validated document', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const io = terminal([
      'https://firewall.example:8443',
      KEY,
      SECRET,
      '/etc/ssl/opnsense-ca.pem',
      'firewall.internal'
    ]);

    await expect(runConfigureCommand([], io.instance, commandDependencies(path))).resolves.toBe(0);

    expect(io.prompts).toEqual([
      { message: 'OPNsense HTTPS origin: ', masked: false },
      { message: 'OPNsense API key: ', masked: true },
      { message: 'OPNsense API secret: ', masked: true },
      { message: 'Optional CA file: ', masked: false },
      { message: 'Optional DNS TLS server name: ', masked: false }
    ]);
    expect(io.stdout).toEqual(['Configured.\n']);
    expect(io.stderr).toEqual([]);
    expect(io.stdout.join('')).not.toContain(SECRET);
    expect(io.stdout.join('')).not.toContain(KEY);
    expect(io.stderr.join('')).not.toContain(SECRET);
    expect(io.stderr.join('')).not.toContain(KEY);
    const [parent, config] = await Promise.all([lstat(dirname(path)), lstat(path)]);
    expect(parent.isDirectory()).toBe(true);
    expect(parent.isSymbolicLink()).toBe(false);
    expect(parent.mode & 0o7777).toBe(0o700);
    expect(parent.uid).toBe(process.getuid?.());
    expect(config.isFile()).toBe(true);
    expect(config.isSymbolicLink()).toBe(false);
    expect(config.nlink).toBe(1);
    expect(config.mode & 0o7777).toBe(0o600);
    expect(config.uid).toBe(process.getuid?.());
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      url: 'https://firewall.example:8443',
      apiKey: KEY,
      apiSecret: SECRET,
      caFile: '/etc/ssl/opnsense-ca.pem',
      tlsServerName: 'firewall.internal'
    });
  });

  it('refuses unknown arguments before prompting and emits only a fixed diagnostic', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const io = terminal([SECRET]);

    await expect(
      runConfigureCommand(['--api-secret', SECRET], io.instance, commandDependencies(path))
    ).resolves.toBe(1);

    expect(io.prompts).toEqual([]);
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual(['Error\n']);
    expect(io.stderr.join('')).not.toContain(SECRET);
    expect(io.stderr.join('')).not.toContain(KEY);
  });

  it('refuses to overwrite an existing configuration without disclosing input', async () => {
    const parent = join(directory, 'opnsense-mcp');
    const path = join(parent, 'config.json');
    await mkdir(parent, { mode: 0o700 });
    await writeFile(path, 'ORIGINAL', { mode: 0o600 });
    await chmod(parent, 0o700);
    const io = terminal(['https://firewall.example', KEY, SECRET, '', '']);

    await expect(runConfigureCommand([], io.instance, commandDependencies(path))).resolves.toBe(1);

    expect(await readFile(path, 'utf8')).toBe('ORIGINAL');
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual(['Error\n']);
    expect(io.stderr.join('')).not.toContain(SECRET);
    expect(io.stderr.join('')).not.toContain(KEY);
  });

  it('rejects an invalid document before creating a file and uses a fixed diagnostic', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const io = terminal(['http://invalid.example', KEY, SECRET, '', '']);

    await expect(runConfigureCommand([], io.instance, commandDependencies(path))).resolves.toBe(1);

    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual(['Error\n']);
    expect(io.stderr.join('')).not.toContain(SECRET);
    expect(io.stderr.join('')).not.toContain(KEY);
  });

  it('warns without reflecting private input when cleanup is incomplete', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const privateCaPath = '/private/configure-warning-ca.pem';
    const io = terminal(['https://firewall.example', KEY, SECRET, privateCaPath, '']);

    await expect(
      runConfigureCommand([], io.instance, {
        ...commandDependencies(path),
        writePrivateConfigFile: () => {
          throw new IncompleteConfigurationError();
        }
      })
    ).resolves.toBe(1);

    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual([
      'Configuration cleanup is incomplete. Remove the private config file before retrying.\n'
    ]);
    expect(io.stderr.join('')).not.toContain(path);
    expect(io.stderr.join('')).not.toContain(privateCaPath);
    expect(io.stderr.join('')).not.toContain(KEY);
    expect(io.stderr.join('')).not.toContain(SECRET);
  });

  it('refuses symlink application directories and existing symlink files', async () => {
    const target = join(directory, 'target');
    await writeFile(target, 'not a directory', { mode: 0o600 });
    const linkedDirectory = join(directory, 'opnsense-mcp');
    await symlink(target, linkedDirectory);
    const path = join(linkedDirectory, 'config.json');

    expect(() => {
      writePrivateOPNsenseConfigFile(path, {
        url: 'https://firewall.example',
        apiKey: 'key',
        apiSecret: SECRET
      });
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
  });

  it('rejects a symlinked ancestor without writing through it', async () => {
    const target = join(directory, 'target');
    const linkedAncestor = join(directory, 'linked-ancestor');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, linkedAncestor);
    const path = join(linkedAncestor, 'opnsense-mcp', 'config.json');

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document);
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
    await expect(lstat(join(target, 'opnsense-mcp'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a group-writable ancestor', async () => {
    const writableAncestor = join(directory, 'writable');
    await mkdir(writableAncestor, { mode: 0o770 });
    await chmod(writableAncestor, 0o770);

    expect(() => {
      writePrivateOPNsenseConfigFile(
        join(writableAncestor, 'opnsense-mcp', 'config.json'),
        document
      );
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
  });

  it('refuses existing symlink and hardlink configuration targets without replacing them', async () => {
    const parent = join(directory, 'opnsense-mcp');
    await mkdir(parent, { mode: 0o700 });
    const original = join(directory, 'original.json');
    await writeFile(original, 'ORIGINAL', { mode: 0o600 });
    const linked = join(parent, 'config.json');

    await symlink(original, linked);
    expect(() => {
      writePrivateOPNsenseConfigFile(linked, {
        url: 'https://firewall.example',
        apiKey: 'key',
        apiSecret: SECRET
      });
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
    await rm(linked);
    await link(original, linked);
    expect(() => {
      writePrivateOPNsenseConfigFile(linked, {
        url: 'https://firewall.example',
        apiKey: 'key',
        apiSecret: SECRET
      });
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
    expect(await readFile(original, 'utf8')).toBe('ORIGINAL');
  });

  it('installs only the private single-link final file', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');

    writePrivateOPNsenseConfigFile(path, document);

    expect(await readdir(dirname(path))).toEqual(['config.json']);
    const stats = await lstat(path);
    expect(stats.isFile()).toBe(true);
    expect(stats.isSymbolicLink()).toBe(false);
    expect(stats.uid).toBe(process.getuid?.());
    expect(stats.mode & 0o7777).toBe(0o600);
    expect(stats.nlink).toBe(1);
  });

  it.each([
    ['writeSync', 1],
    ['linkSync', 1],
    ['unlinkSync', 1],
    ['fsyncSync', 2]
  ] as const)(
    'rolls back its secret-bearing files when %s fails after the operation',
    async (operation, occurrence) => {
      const path = join(directory, 'opnsense-mcp', 'config.json');

      expect(() => {
        writePrivateOPNsenseConfigFile(
          path,
          document,
          process.platform,
          failAfter(operation, occurrence)
        );
      }).toThrow(/^Invalid OPNsense configuration\.$/u);

      await expectNoTransactionSecrets(dirname(path), path);
    }
  );

  it('reports incomplete configuration when closing a written temporary file is ambiguous', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, failAfter('closeSync', 1));
    }).toThrow(/^Incomplete OPNsense configuration requires manual removal\.$/u);
    await expectNoTransactionSecrets(dirname(path), path);
  });

  it('stops rather than retrying when a write makes no forward progress', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    let writes = 0;
    const noProgressWrite: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      writeSync: () => {
        writes += 1;
        if (writes === 1) return 0;
        throw new Error('write retried after no progress');
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, noProgressWrite);
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
    expect(writes).toBe(1);
    await expectNoTransactionSecrets(dirname(path), path);
  });

  it('reports incomplete configuration when rollback directory fsync cannot be confirmed', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    let fsyncs = 0;
    const rollbackSyncFailure: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      linkSync: () => {
        throw new Error('injected link failure');
      },
      fsyncSync: (descriptor) => {
        fsyncs += 1;
        if (fsyncs > 1) throw new Error('injected rollback directory fsync failure');
        DEFAULT_CONFIGURE_FILE_SYSTEM.fsyncSync(descriptor);
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, rollbackSyncFailure);
    }).toThrow(/^Incomplete OPNsense configuration requires manual removal\.$/u);
    expect(fsyncs).toBe(2);
    await expectNoTransactionSecrets(dirname(path), path);
  });

  it('reports incomplete configuration when rollback directory revalidation fails', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    let cleanupStarted = false;
    const rollbackValidationFailure: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      linkSync: () => {
        cleanupStarted = true;
        throw new Error('injected link failure');
      },
      lstatSync: (target) => {
        if (cleanupStarted && target === dirname(path)) {
          throw new Error('injected rollback directory validation failure');
        }
        return DEFAULT_CONFIGURE_FILE_SYSTEM.lstatSync(target);
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, rollbackValidationFailure);
    }).toThrow(/^Incomplete OPNsense configuration requires manual removal\.$/u);
    await expectNoTransactionSecrets(dirname(path), path);
  });

  it('does not remove an unverified temporary replacement after initial fstat failure', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const temporaryPath = `${path}.${'01'.repeat(16)}.tmp`;
    let fstats = 0;
    const initialTemporaryFstatFailure: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      randomBytes: () => Buffer.alloc(16, 1),
      fstatSync: (descriptor) => {
        fstats += 1;
        if (fstats === 2) {
          unlinkSync(temporaryPath);
          writeFileSync(temporaryPath, 'RACING TEMPORARY TARGET', { mode: 0o600, flag: 'wx' });
          throw new Error('injected temporary fstat failure');
        }
        return DEFAULT_CONFIGURE_FILE_SYSTEM.fstatSync(descriptor);
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(
        path,
        document,
        process.platform,
        initialTemporaryFstatFailure
      );
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
    expect(await readFile(temporaryPath, 'utf8')).toBe('RACING TEMPORARY TARGET');
    expect(await readFile(temporaryPath, 'utf8')).not.toContain(KEY);
    expect(await readFile(temporaryPath, 'utf8')).not.toContain(SECRET);
  });

  it('keeps a durably installed configuration when closing its directory descriptor reports failure', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    let closes = 0;
    const finalCloseFailure: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      closeSync: (descriptor) => {
        closes += 1;
        DEFAULT_CONFIGURE_FILE_SYSTEM.closeSync(descriptor);
        if (closes === 2) throw new Error('injected final directory close failure');
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, finalCloseFailure);
    }).not.toThrow();
    expect(closes).toBe(2);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(document);
  });

  it('rolls back after validation of the installed one-link final fails', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    let failed = false;
    const finalValidationFailure: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      lstatSync: (target) => {
        const stats = DEFAULT_CONFIGURE_FILE_SYSTEM.lstatSync(target);
        if (!failed && target === path && stats.nlink === 1) {
          failed = true;
          throw new Error('injected final validation failure');
        }
        return stats;
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, finalValidationFailure);
    }).toThrow(/^Invalid OPNsense configuration\.$/u);
    expect(failed).toBe(true);
    await expectNoTransactionSecrets(dirname(path), path);
  });

  it('attempts final rollback even when temporary cleanup is impossible', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const cannotRemoveTemporary: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      unlinkSync: (target) => {
        if (target !== path) throw new Error('injected permanent temporary unlink failure');
        DEFAULT_CONFIGURE_FILE_SYSTEM.unlinkSync(target);
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, cannotRemoveTemporary);
    }).toThrow(/^Incomplete OPNsense configuration requires manual removal\.$/u);

    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(dirname(path))).filter((entry) => entry.endsWith('.tmp'))).toHaveLength(
      1
    );
  });

  it('does not delete an unknown final target introduced by a link race', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const racingFileSystem: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      linkSync: () => {
        writeFileSync(path, 'RACING TARGET', { mode: 0o600, flag: 'wx' });
        throw new Error('injected link race');
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, racingFileSystem);
    }).toThrow(/^Invalid OPNsense configuration\.$/u);

    expect(await readFile(path, 'utf8')).toBe('RACING TARGET');
    expect((await readdir(dirname(path))).filter((entry) => entry.endsWith('.tmp'))).toEqual([]);
  });

  it('fails distinctly when a same-UID ancestor swap prevents verified cleanup', async () => {
    const parent = join(directory, 'opnsense-mcp');
    const displaced = join(directory, 'displaced');
    const path = join(parent, 'config.json');
    let swapped = false;
    const swappingFileSystem: ConfigureFileSystem = {
      ...DEFAULT_CONFIGURE_FILE_SYSTEM,
      writeSync: (...arguments_) => {
        const written = DEFAULT_CONFIGURE_FILE_SYSTEM.writeSync(...arguments_);
        if (!swapped) {
          swapped = true;
          renameSync(parent, displaced);
          mkdirSync(parent, { mode: 0o700 });
        }
        return written;
      }
    };

    expect(() => {
      writePrivateOPNsenseConfigFile(path, document, process.platform, swappingFileSystem);
    }).toThrow(/^Incomplete OPNsense configuration requires manual removal\.$/u);

    expect((await readdir(displaced)).some((entry) => entry.endsWith('.tmp'))).toBe(true);
  });
});
