// SPDX-License-Identifier: AGPL-3.0-or-later
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
  readonly packageName: string;
  readonly packageVersion: string;
  readonly installedCommand: { readonly command: string; readonly arguments: readonly string[] };
  readonly installedTarget: string;
  readonly consumerRoot: string;
  readonly registryUnknownRequests: readonly string[];
  cleanup(): Promise<void>;
}

export declare const PACKAGE_INPUTS: readonly string[];
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
