// SPDX-License-Identifier: AGPL-3.0-or-later
export interface LocalNpmRegistryPackage {
  readonly name: string;
  readonly version: string;
  readonly installPath: string;
  readonly integrity: string;
  readonly shasum: string;
  readonly tarballBytes: number;
}

export interface LocalNpmRegistry {
  readonly url: string;
  readonly port: number;
  readonly packages: readonly LocalNpmRegistryPackage[];
  readonly expectedAbsentNames: readonly string[];
  requests(): readonly string[];
  unknownRequests(): readonly string[];
  absentRequests(): readonly string[];
  close(): Promise<void>;
}

export declare function lockProductionProjection(lock: unknown): readonly string[];
export declare function lockExpectedAbsentNames(lock: unknown): readonly string[];
export declare function startLocalNpmRegistry(options: {
  readonly repositoryRoot: string;
  readonly workRoot: string;
}): Promise<LocalNpmRegistry>;
export declare const FIXTURE_ARCHIVER: string;
export declare const REGISTRY_BUDGET_MS: number;
