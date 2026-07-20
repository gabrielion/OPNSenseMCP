// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  unlinkSync,
  writeSync,
  type Stats
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute } from 'node:path';
import {
  resolveDefaultOPNsenseConfigPath,
  type DefaultConfigPathEnvironment
} from './runtime-config.js';
import { validateOPNsenseConnectionConfigDocument } from '../opnsense/config.js';

const CONFIGURATION_ERROR = 'Invalid OPNsense configuration.';

export interface ConfigureTerminal {
  prompt(message: string, options: { readonly masked: boolean }): Promise<string>;
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

interface ConfigurationDocument {
  readonly url: string;
  readonly apiKey: string;
  readonly apiSecret: string;
  readonly caFile?: string;
  readonly tlsServerName?: string;
}

export interface ConfigureCommandDependencies {
  readonly platform: NodeJS.Platform;
  readonly environment: DefaultConfigPathEnvironment;
  readonly resolveDefaultPath: (
    platform: NodeJS.Platform,
    environment: DefaultConfigPathEnvironment
  ) => string | undefined;
}

function invalidConfiguration(): never {
  throw new Error(CONFIGURATION_ERROR);
}

function currentUserId(): number {
  if (typeof process.getuid !== 'function') invalidConfiguration();
  return process.getuid();
}

function requirePrivateDirectory(stats: Stats): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUserId() ||
    (stats.mode & 0o7777) !== 0o700
  ) {
    invalidConfiguration();
  }
}

function requirePrivateNewFile(stats: Stats): void {
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== currentUserId() ||
    stats.nlink !== 1 ||
    (stats.mode & 0o7777) !== 0o600
  ) {
    invalidConfiguration();
  }
}

function ensurePrivateDirectory(path: string): void {
  try {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    requirePrivateDirectory(lstatSync(path));
  } catch {
    invalidConfiguration();
  }
}

function fsyncDirectory(path: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function writePrivateOPNsenseConfigFile(
  path: string,
  document: ConfigurationDocument,
  platform: NodeJS.Platform = process.platform
): void {
  try {
    if (platform === 'win32' || !isAbsolute(path)) invalidConfiguration();
    validateOPNsenseConnectionConfigDocument(document);
    const directory = dirname(path);
    ensurePrivateDirectory(directory);
    const temporaryPath = `${path}.${randomBytes(16).toString('hex')}.tmp`;
    let temporaryFileExists = false;
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      temporaryFileExists = true;
      requirePrivateNewFile(fstatSync(descriptor));
      const contents = Buffer.from(JSON.stringify(document), 'utf8');
      let offset = 0;
      while (offset < contents.length) {
        offset += writeSync(descriptor, contents, offset, contents.length - offset);
      }
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      linkSync(temporaryPath, path);
      unlinkSync(temporaryPath);
      temporaryFileExists = false;
      requirePrivateNewFile(lstatSync(path));
      fsyncDirectory(directory);
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
      if (temporaryFileExists) unlinkSync(temporaryPath);
    }
  } catch {
    invalidConfiguration();
  }
}

function optional(value: string): string | undefined {
  return value === '' ? undefined : value;
}

export async function runConfigureCommand(
  arguments_: readonly string[],
  terminal: ConfigureTerminal,
  dependencies: ConfigureCommandDependencies
): Promise<0 | 1> {
  if (arguments_.length !== 0 || dependencies.platform === 'win32') {
    terminal.writeStderr('Error\n');
    return 1;
  }

  try {
    const path = dependencies.resolveDefaultPath(dependencies.platform, dependencies.environment);
    if (path === undefined) invalidConfiguration();
    const url = await terminal.prompt('OPNsense HTTPS origin: ', { masked: false });
    const apiKey = await terminal.prompt('OPNsense API key: ', { masked: true });
    const apiSecret = await terminal.prompt('OPNsense API secret: ', { masked: true });
    const caFile = optional(await terminal.prompt('Optional CA file: ', { masked: false }));
    const tlsServerName = optional(
      await terminal.prompt('Optional DNS TLS server name: ', { masked: false })
    );
    const document: ConfigurationDocument = {
      url,
      apiKey,
      apiSecret,
      ...(caFile === undefined ? {} : { caFile }),
      ...(tlsServerName === undefined ? {} : { tlsServerName })
    };
    validateOPNsenseConnectionConfigDocument(document);
    writePrivateOPNsenseConfigFile(path, document, dependencies.platform);
    terminal.writeStdout('Configured.\n');
    return 0;
  } catch {
    terminal.writeStderr('Error\n');
    return 1;
  }
}

export const DEFAULT_CONFIGURE_COMMAND_DEPENDENCIES: ConfigureCommandDependencies = Object.freeze({
  platform: process.platform,
  environment: {
    ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
    ...(process.env.XDG_CONFIG_HOME === undefined
      ? {}
      : { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }),
    ...(process.env.APPDATA === undefined ? {} : { APPDATA: process.env.APPDATA })
  },
  resolveDefaultPath: resolveDefaultOPNsenseConfigPath
});
