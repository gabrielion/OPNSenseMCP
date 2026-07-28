// SPDX-License-Identifier: AGPL-3.0-or-later
export interface InstalledInvocation {
  readonly command: string;
  readonly arguments: readonly string[];
  readonly cwd: string;
}

export declare function validateInstalledInvocation(value: unknown): InstalledInvocation;
