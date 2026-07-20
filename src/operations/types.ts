// SPDX-License-Identifier: AGPL-3.0-or-later
export type OperationEffect = 'read' | 'firewall-write';

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
  readonly runtime: OperationRuntimeDescriptor;
}

export interface OperationCommand {
  readonly method: 'GET' | 'POST';
  readonly path: string;
}

export interface OperationLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxItems: number;
}

export interface RuntimeOperationDescriptor {
  readonly name: string;
  readonly effect: OperationEffect;
  readonly command: OperationCommand;
  readonly applyCommand?: OperationCommand;
  readonly resourceScope: string;
  readonly capabilityId: string;
  readonly limits: OperationLimits;
}

export interface OperationRuntimeDescriptor {
  readonly operations: readonly RuntimeOperationDescriptor[];
  readonly [key: string]: unknown;
}
