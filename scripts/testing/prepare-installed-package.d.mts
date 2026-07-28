// SPDX-License-Identifier: AGPL-3.0-or-later
import type { InstalledInvocation } from './installed-invocation.mjs';

export interface PreparedCommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export type PreparedCommandRunner = (
  command: string,
  argumentsList: readonly string[],
  options: {
    readonly cwd: string;
    readonly environment: Readonly<Record<string, string>>;
    readonly timeoutMs: number;
  }
) => Promise<PreparedCommandResult>;

export interface PreparedInstalledPackage {
  readonly archiveSha256: string;
  /** Digest of the uncompressed archive: the portable identity of the packaged content. */
  readonly archiveTarSha256: string;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installedCommand: InstalledInvocation;
  readonly installedTarget: string;
  readonly consumerRoot: string;
  readonly registryUnknownRequests: readonly string[];
  cleanup(): Promise<void>;
}

export declare const PACKAGE_INPUTS: readonly string[];
export declare const BUILD_TIMEOUT_MS: number;
export declare const PACK_TIMEOUT_MS: number;
export declare const PACKED_FILE_MODE: number;
export declare const PACKED_DIRECTORY_MODE: number;
export declare function normalizeTreeModes(root: string): Promise<void>;
export declare const INSTALL_TIMEOUT_MS: number;
export declare const LIST_TIMEOUT_MS: number;
export declare const PREPARATION_BUDGET_MS: number;
export declare function hermeticInstallArguments(archive: string): readonly string[];
export declare function redactedCommandFailure(
  label: string,
  result: PreparedCommandResult,
  secrets: readonly string[]
): Error;
export declare function prepareInstalledPackage(options: {
  readonly repositoryRoot: string;
  readonly workRoot: string;
  readonly run: PreparedCommandRunner;
}): Promise<PreparedInstalledPackage>;
