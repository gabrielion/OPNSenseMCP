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
  realpathSync,
  unlinkSync,
  writeSync,
  type PathLike,
  type Stats
} from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, normalize, parse, relative, sep } from 'node:path';
import {
  resolveDefaultOPNsenseConfigPath,
  type DefaultConfigPathEnvironment
} from './runtime-config.js';
import { validateOPNsenseConnectionConfigDocument } from '../opnsense/config.js';

const CONFIGURATION_ERROR = 'Invalid OPNsense configuration.';
const INCOMPLETE_CONFIGURATION_ERROR = 'Incomplete OPNsense configuration requires manual removal.';
export const INCOMPLETE_CONFIGURATION_WARNING =
  'Configuration cleanup is incomplete. Remove the private config file before retrying.\n';

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
  readonly writePrivateConfigFile?: (
    path: string,
    document: ConfigurationDocument,
    platform: NodeJS.Platform
  ) => void;
}

export interface ConfigureFileSystem {
  readonly closeSync: (descriptor: number) => void;
  readonly fstatSync: (descriptor: number) => Stats;
  readonly fsyncSync: (descriptor: number) => void;
  readonly linkSync: (existingPath: PathLike, newPath: PathLike) => void;
  readonly lstatSync: (path: PathLike) => Stats;
  readonly mkdirSync: (path: PathLike, options: { readonly mode: number }) => void;
  readonly openSync: (path: PathLike, flags: number, mode?: number) => number;
  readonly randomBytes: (size: number) => Buffer;
  readonly realpathSync: (path: PathLike) => string;
  readonly unlinkSync: (path: PathLike) => void;
  readonly writeSync: (
    descriptor: number,
    buffer: Uint8Array,
    offset: number,
    length: number
  ) => number;
}

export const DEFAULT_CONFIGURE_FILE_SYSTEM: ConfigureFileSystem = Object.freeze({
  closeSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  randomBytes,
  realpathSync,
  unlinkSync,
  writeSync
});

export class IncompleteConfigurationError extends Error {
  constructor() {
    super(INCOMPLETE_CONFIGURATION_ERROR);
  }
}

class PathIntegrityError extends Error {}

function invalidConfiguration(): never {
  throw new Error(CONFIGURATION_ERROR);
}

function currentUserId(): number {
  if (typeof process.getuid !== 'function') invalidConfiguration();
  return process.getuid();
}

function requireSafeAncestor(stats: Stats, userId: number): void {
  if (
    !stats.isDirectory() ||
    stats.isSymbolicLink() ||
    (stats.uid !== 0 && stats.uid !== userId) ||
    (stats.mode & 0o022) !== 0
  ) {
    invalidConfiguration();
  }
}

function requirePrivateDirectory(stats: Stats, userId: number): void {
  requireSafeAncestor(stats, userId);
  if (stats.uid !== userId || (stats.mode & 0o7777) !== 0o700) invalidConfiguration();
}

function requirePrivateFile(stats: Stats, userId: number, expectedLinks: number): void {
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.uid !== userId ||
    stats.nlink !== expectedLinks ||
    (stats.mode & 0o7777) !== 0o600
  ) {
    invalidConfiguration();
  }
}

interface PathIdentity {
  readonly path: string;
  readonly dev: number;
  readonly ino: number;
  readonly realPath: string;
}

function sameIdentity(stats: Stats, identity: Pick<PathIdentity, 'dev' | 'ino'>): boolean {
  return stats.dev === identity.dev && stats.ino === identity.ino;
}

function directoryComponents(path: string): readonly string[] {
  const root = parse(path).root;
  const suffix = relative(root, path);
  return suffix === ''
    ? [root]
    : [
        root,
        ...suffix.split(sep).map((_part, index, parts) => join(root, ...parts.slice(0, index + 1)))
      ];
}

function ensurePrivateDirectory(
  path: string,
  userId: number,
  fileSystem: ConfigureFileSystem
): readonly PathIdentity[] {
  const components = directoryComponents(path);
  for (const [index, component] of components.entries()) {
    let stats: Stats;
    try {
      stats = fileSystem.lstatSync(component);
    } catch (error) {
      if (
        index === 0 ||
        typeof error !== 'object' ||
        error === null ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
      try {
        fileSystem.mkdirSync(component, { mode: 0o700 });
      } catch (mkdirError) {
        if (
          typeof mkdirError !== 'object' ||
          mkdirError === null ||
          !('code' in mkdirError) ||
          mkdirError.code !== 'EEXIST'
        ) {
          throw mkdirError;
        }
      }
      stats = fileSystem.lstatSync(component);
    }
    if (index === components.length - 1) requirePrivateDirectory(stats, userId);
    else requireSafeAncestor(stats, userId);
    if (fileSystem.realpathSync(component) !== component) invalidConfiguration();
  }
  return components.map((component) => {
    const stats = fileSystem.lstatSync(component);
    return {
      path: component,
      dev: stats.dev,
      ino: stats.ino,
      realPath: fileSystem.realpathSync(component)
    };
  });
}

function revalidateDirectories(
  identities: readonly PathIdentity[],
  userId: number,
  fileSystem: ConfigureFileSystem
): void {
  for (const [index, identity] of identities.entries()) {
    const stats = fileSystem.lstatSync(identity.path);
    if (!sameIdentity(stats, identity)) invalidConfiguration();
    if (index === identities.length - 1) requirePrivateDirectory(stats, userId);
    else requireSafeAncestor(stats, userId);
    if (fileSystem.realpathSync(identity.path) !== identity.realPath) invalidConfiguration();
  }
}

function revalidateHeldDirectory(
  descriptor: number,
  managedDirectory: PathIdentity,
  directoryIdentities: readonly PathIdentity[],
  userId: number,
  fileSystem: ConfigureFileSystem
): void {
  const validateDescriptor = () => {
    const stats = fileSystem.fstatSync(descriptor);
    if (!sameIdentity(stats, managedDirectory)) invalidConfiguration();
    requirePrivateDirectory(stats, userId);
  };
  validateDescriptor();
  revalidateDirectories(directoryIdentities, userId, fileSystem);
  fileSystem.fsyncSync(descriptor);
  validateDescriptor();
  revalidateDirectories(directoryIdentities, userId, fileSystem);
}

function removeOnlyOwnedPath(
  path: string,
  identity: Pick<PathIdentity, 'dev' | 'ino'>,
  fileSystem: ConfigureFileSystem
): boolean {
  try {
    const stats = fileSystem.lstatSync(path);
    if (!sameIdentity(stats, identity)) return true;
    try {
      fileSystem.unlinkSync(path);
    } catch {
      // The unlink may have completed before reporting failure. Verify below.
    }
    try {
      return !sameIdentity(fileSystem.lstatSync(path), identity);
    } catch (error) {
      return (
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
      );
    }
  } catch (error) {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    );
  }
}

export function writePrivateOPNsenseConfigFile(
  path: string,
  document: ConfigurationDocument,
  platform: NodeJS.Platform = process.platform,
  fileSystem: ConfigureFileSystem = DEFAULT_CONFIGURE_FILE_SYSTEM
): void {
  try {
    if (platform === 'win32' || !isAbsolute(path) || normalize(path) !== path) {
      invalidConfiguration();
    }
    validateOPNsenseConnectionConfigDocument(document);
    const userId = currentUserId();
    const directory = dirname(path);
    const directoryIdentities = ensurePrivateDirectory(directory, userId, fileSystem);
    // Node does not expose openat/linkat-style dirfd-relative path operations. These snapshots make
    // observed swaps fail closed, but cannot eliminate a same-UID swap entirely between syscalls.
    const revalidate = () => {
      try {
        revalidateDirectories(directoryIdentities, userId, fileSystem);
      } catch {
        throw new PathIntegrityError();
      }
    };
    revalidate();
    const temporaryPath = `${path}.${fileSystem.randomBytes(16).toString('hex')}.tmp`;
    let directoryDescriptor: number | undefined;
    let descriptor: number | undefined;
    let temporaryIdentity: PathIdentity | undefined;
    let failure: unknown;
    let successful = false;
    let temporaryCloseConfirmed = true;
    try {
      directoryDescriptor = fileSystem.openSync(
        directory,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
      );
      const directoryStats = fileSystem.fstatSync(directoryDescriptor);
      const managedDirectory = directoryIdentities.at(-1);
      if (
        managedDirectory === undefined ||
        !sameIdentity(directoryStats, managedDirectory) ||
        !directoryStats.isDirectory()
      ) {
        invalidConfiguration();
      }
      revalidate();
      descriptor = fileSystem.openSync(
        temporaryPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
      const temporaryStats = fileSystem.fstatSync(descriptor);
      requirePrivateFile(temporaryStats, userId, 1);
      temporaryIdentity = {
        path: temporaryPath,
        dev: temporaryStats.dev,
        ino: temporaryStats.ino,
        realPath: temporaryPath
      };
      revalidate();
      const contents = Buffer.from(JSON.stringify(document), 'utf8');
      let offset = 0;
      while (offset < contents.length) {
        const remaining = contents.length - offset;
        const written = fileSystem.writeSync(descriptor, contents, offset, remaining);
        if (written <= 0 || written > remaining) throw new Error('Unable to write configuration.');
        offset += written;
      }
      revalidate();
      fileSystem.fsyncSync(descriptor);
      const descriptorToClose = descriptor;
      descriptor = undefined;
      try {
        fileSystem.closeSync(descriptorToClose);
      } catch (error) {
        temporaryCloseConfirmed = false;
        throw error;
      }
      revalidate();
      fileSystem.linkSync(temporaryPath, path);
      revalidate();
      const linkedStats = fileSystem.lstatSync(path);
      requirePrivateFile(linkedStats, userId, 2);
      if (!sameIdentity(linkedStats, temporaryIdentity)) invalidConfiguration();
      fileSystem.unlinkSync(temporaryPath);
      revalidate();
      const finalStats = fileSystem.lstatSync(path);
      requirePrivateFile(finalStats, userId, 1);
      if (!sameIdentity(finalStats, temporaryIdentity)) invalidConfiguration();
      revalidateHeldDirectory(
        directoryDescriptor,
        managedDirectory,
        directoryIdentities,
        userId,
        fileSystem
      );
      const finalStatsAfterSync = fileSystem.lstatSync(path);
      requirePrivateFile(finalStatsAfterSync, userId, 1);
      if (!sameIdentity(finalStatsAfterSync, temporaryIdentity)) invalidConfiguration();
      const directoryDescriptorToClose = directoryDescriptor;
      directoryDescriptor = undefined;
      try {
        fileSystem.closeSync(directoryDescriptorToClose);
      } catch {
        // The durable final identity above is authoritative even if close reports ambiguously.
      }
      successful = true;
    } catch (error) {
      failure = error;
    }

    if (!successful) {
      if (descriptor !== undefined) {
        const descriptorToClose = descriptor;
        descriptor = undefined;
        try {
          fileSystem.closeSync(descriptorToClose);
        } catch {
          temporaryCloseConfirmed = false;
        }
      }
      let temporaryRemoved = temporaryIdentity === undefined;
      let finalRemoved = temporaryIdentity === undefined;
      if (temporaryIdentity !== undefined) {
        temporaryRemoved = removeOnlyOwnedPath(temporaryPath, temporaryIdentity, fileSystem);
        finalRemoved = removeOnlyOwnedPath(path, temporaryIdentity, fileSystem);
      }
      let rollbackDurable = temporaryIdentity === undefined;
      let rollbackCloseConfirmed = true;
      if (directoryDescriptor !== undefined) {
        if (temporaryIdentity !== undefined) {
          try {
            const managedDirectory = directoryIdentities.at(-1);
            if (managedDirectory === undefined) invalidConfiguration();
            if (!temporaryRemoved || !finalRemoved) invalidConfiguration();
            revalidateHeldDirectory(
              directoryDescriptor,
              managedDirectory,
              directoryIdentities,
              userId,
              fileSystem
            );
            rollbackDurable = true;
          } catch {
            rollbackDurable = false;
          }
        }
        const directoryDescriptorToClose = directoryDescriptor;
        directoryDescriptor = undefined;
        try {
          fileSystem.closeSync(directoryDescriptorToClose);
        } catch {
          rollbackCloseConfirmed = false;
        }
      }
      if (
        failure instanceof PathIntegrityError ||
        !temporaryRemoved ||
        !finalRemoved ||
        !rollbackDurable ||
        !rollbackCloseConfirmed ||
        !temporaryCloseConfirmed
      ) {
        throw new IncompleteConfigurationError();
      }
      throw failure;
    }
  } catch (error) {
    if (error instanceof IncompleteConfigurationError) throw error;
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
    (dependencies.writePrivateConfigFile ?? writePrivateOPNsenseConfigFile)(
      path,
      document,
      dependencies.platform
    );
    terminal.writeStdout('Configured.\n');
    return 0;
  } catch (error) {
    terminal.writeStderr(
      error instanceof IncompleteConfigurationError ? INCOMPLETE_CONFIGURATION_WARNING : 'Error\n'
    );
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
