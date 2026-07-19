// SPDX-License-Identifier: AGPL-3.0-or-later
export type OperationEffect = 'read';

export interface PublicOperationDescriptor {
  readonly name: string;
  readonly effect: OperationEffect;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly inputSchemaDigest: string;
  readonly outputSchemaDigest: string;
}

export interface RequiredPluginDescriptor {
  readonly name: string;
  readonly versionRange: string;
}

export interface OperationDescriptor {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly description: string;
  readonly requiredPlugin: RequiredPluginDescriptor | null;
  readonly requiredFeatures: readonly string[];
  readonly operations: readonly PublicOperationDescriptor[];
  readonly contractDigest: string;
  readonly runtime: Readonly<Record<string, unknown>>;
}
