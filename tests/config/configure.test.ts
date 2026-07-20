// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runConfigureCommand,
  writePrivateOPNsenseConfigFile,
  type ConfigureTerminal
} from '../../src/config/configure.js';

const SECRET = 'CONFIGURE_SECRET_MUST_NOT_LEAK';
let directory = '';

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'opnsense-configure-test-'));
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

describe('configure command', () => {
  it('collects both credentials through masked prompts and writes a private validated document', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const io = terminal([
      'https://firewall.example:8443',
      'test-key',
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
    const [parent, config] = await Promise.all([lstat(dirname(path)), lstat(path)]);
    expect(parent.isDirectory()).toBe(true);
    expect(parent.isSymbolicLink()).toBe(false);
    expect(parent.mode & 0o7777).toBe(0o700);
    expect(config.isFile()).toBe(true);
    expect(config.isSymbolicLink()).toBe(false);
    expect(config.nlink).toBe(1);
    expect(config.mode & 0o7777).toBe(0o600);
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      url: 'https://firewall.example:8443',
      apiKey: 'test-key',
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
  });

  it('refuses to overwrite an existing configuration without disclosing input', async () => {
    const parent = join(directory, 'opnsense-mcp');
    const path = join(parent, 'config.json');
    await mkdir(parent, { mode: 0o700 });
    await writeFile(path, 'ORIGINAL', { mode: 0o600 });
    await chmod(parent, 0o700);
    const io = terminal(['https://firewall.example', 'key', SECRET, '', '']);

    await expect(runConfigureCommand([], io.instance, commandDependencies(path))).resolves.toBe(1);

    expect(await readFile(path, 'utf8')).toBe('ORIGINAL');
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual(['Error\n']);
    expect(io.stderr.join('')).not.toContain(SECRET);
  });

  it('rejects an invalid document before creating a file and uses a fixed diagnostic', async () => {
    const path = join(directory, 'opnsense-mcp', 'config.json');
    const io = terminal(['http://invalid.example', 'key', SECRET, '', '']);

    await expect(runConfigureCommand([], io.instance, commandDependencies(path))).resolves.toBe(1);

    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(io.stdout).toEqual([]);
    expect(io.stderr).toEqual(['Error\n']);
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

  it('uses a same-directory temporary file and atomic no-clobber link installation', async () => {
    const source = await readFile('src/config/configure.ts', 'utf8');

    expect(source).toContain('linkSync(temporaryPath, path)');
    expect(source).toContain('unlinkSync(temporaryPath)');
    expect(source).not.toContain('renameSync(temporaryPath, path)');
  });
});
