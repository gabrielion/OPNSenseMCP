// SPDX-License-Identifier: AGPL-3.0-or-later
export declare const ALIAS_EVIDENCE_RELATIVE_PATH: string;
export declare const RESTORE_EVIDENCE_RELATIVE_PATH: string;

export interface VmAttestationVerificationResult {
  readonly code: number;
  /** Relative evidence paths, if any, that are not present at all (as opposed to present but invalid/stale). */
  readonly missingPaths: readonly string[];
}

export declare function verifyVmAttestation(options?: {
  readonly repositoryRoot?: string;
}): Promise<VmAttestationVerificationResult>;

export declare function runVmAttestationVerifier(
  arguments_?: readonly string[],
  options?: { readonly stderr?: { write(chunk: string): unknown } }
): Promise<number>;
