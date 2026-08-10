#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { DEFAULT_CONFIGURE_COMMAND_DEPENDENCIES, runConfigureCommand } from './config/configure.js';
import { createProcessConfigureTerminal } from './config/configure-terminal.js';
import { startStdio, type StdioRuntime } from './entrypoints/stdio.js';

interface SignalProcess {
  exitCode?: string | number | null | undefined;
  once(signal: 'SIGINT' | 'SIGTERM', listener: () => void | Promise<void>): unknown;
}

interface StdioInput {
  readonly readableEnded: boolean;
  once(event: 'end', listener: () => void | Promise<void>): unknown;
}

export function installStdioSignalHandlers(
  handle: StdioRuntime,
  target: SignalProcess = process,
  input: StdioInput = process.stdin
): void {
  let settlement: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    settlement ??= (async () => {
      const hold = setInterval(() => undefined, 2_147_483_647);
      try {
        await handle.close();
      } catch {
        process.stderr.write('Error\n');
        target.exitCode = 1;
      } finally {
        clearInterval(hold);
      }
    })();
    return settlement;
  };
  target.once('SIGINT', shutdown);
  target.once('SIGTERM', shutdown);
  input.once('end', shutdown);
  if (input.readableEnded) {
    void shutdown();
  }
}

export async function runStdioEntrypoint(): Promise<StdioRuntime> {
  const handle = await startStdio();
  installStdioSignalHandlers(handle);
  return handle;
}

export interface CommandLineDependencies {
  startStdio(): Promise<unknown>;
  runConfigure(arguments_: readonly string[]): Promise<0 | 1>;
  writeError(message: string): void;
  writeOutput(message: string): void;
}

// Must match the version in package.json and src/server/build-server.ts.
const CLI_VERSION = '0.1.0';

const CLI_USAGE = `opnsense-mcp ${CLI_VERSION} — MCP server for OPNsense

Usage:
  opnsense-mcp              start the MCP server on stdio (what MCP clients run)
  opnsense-mcp configure    store OPNsense connection settings interactively
  opnsense-mcp --help       show this help
  opnsense-mcp --version    print the version
`;

const DEFAULT_COMMAND_LINE_DEPENDENCIES: CommandLineDependencies = Object.freeze({
  startStdio: runStdioEntrypoint,
  runConfigure: (arguments_: readonly string[]) =>
    runConfigureCommand(
      arguments_,
      createProcessConfigureTerminal(),
      DEFAULT_CONFIGURE_COMMAND_DEPENDENCIES
    ),
  writeError: (message: string) => {
    process.stderr.write(message);
  },
  writeOutput: (message: string) => {
    process.stdout.write(message);
  }
});

export async function runCommandLine(
  arguments_: readonly string[],
  dependencies: CommandLineDependencies = DEFAULT_COMMAND_LINE_DEPENDENCIES
): Promise<0 | 1> {
  if (arguments_.length === 0) {
    await dependencies.startStdio();
    return 0;
  }
  if (arguments_[0] === 'configure') return dependencies.runConfigure(arguments_.slice(1));
  if (arguments_.length === 1 && (arguments_[0] === '--help' || arguments_[0] === '-h')) {
    dependencies.writeOutput(CLI_USAGE);
    return 0;
  }
  if (arguments_.length === 1 && arguments_[0] === '--version') {
    dependencies.writeOutput(`${CLI_VERSION}\n`);
    return 0;
  }
  dependencies.writeError('Error\n');
  return 1;
}

type RealPathResolver = (path: string) => Promise<string>;

export async function isDirectInvocation(
  moduleUrl: string,
  invokedPath: string | undefined,
  canonicalize: RealPathResolver = realpath
): Promise<boolean> {
  if (invokedPath === undefined) return false;
  try {
    const [modulePath, executablePath] = await Promise.all([
      canonicalize(fileURLToPath(moduleUrl)),
      canonicalize(resolve(invokedPath))
    ]);
    return modulePath === executablePath;
  } catch {
    return false;
  }
}

if (await isDirectInvocation(import.meta.url, process.argv[1])) {
  void runCommandLine(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      process.stderr.write('Error\n');
      process.exitCode = 1;
    });
}
