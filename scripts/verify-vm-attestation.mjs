#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildVmAttestation,
  buildVmRestoreAttestation,
  serializeVmAttestation,
  serializeVmRestoreAttestation
} from './vm/attestation.mjs';

export const ALIAS_EVIDENCE_RELATIVE_PATH = 'docs/evidence/product3-vm.json';
export const RESTORE_EVIDENCE_RELATIVE_PATH = 'docs/evidence/product3-restore-vm.json';
// Both scenarios' evidence commits may land in either order at the landing sequence, so from
// EITHER attestation's own point of view the other one's path is harmless "evidence churn", not a
// foreign, stale-making change. `evidencePathsSubset`/`gitStateIsCoherent` below check membership
// in this shared set rather than either path alone.
const EVIDENCE_RELATIVE_PATHS = Object.freeze([
  ALIAS_EVIDENCE_RELATIVE_PATH,
  RESTORE_EVIDENCE_RELATIVE_PATH
]);
const GIT_OBJECT_PATTERN = /^[0-9a-f]{40}$/u;
const GIT_MAX_OUTPUT_BYTES = 1024 * 1024;
const EVIDENCE_MAX_BYTES = 64 * 1024;

function runGit(arguments_, repositoryRoot) {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      arguments_,
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: { PATH: process.env.PATH ?? '' },
        maxBuffer: GIT_MAX_OUTPUT_BYTES,
        windowsHide: true
      },
      (error, stdout) => {
        const code =
          error === null
            ? 0
            : typeof error.code === 'number' && Number.isInteger(error.code)
              ? error.code
              : -1;
        resolvePromise({ code, stdout: typeof stdout === 'string' ? stdout : '' });
      }
    );
  });
}

function nulSeparatedPaths(output) {
  return output.split('\0').filter((entry) => entry !== '');
}

function evidencePathsSubset(...outputs) {
  const paths = outputs.flatMap((output) => nulSeparatedPaths(output));
  return paths.length > 0 && paths.every((path) => EVIDENCE_RELATIVE_PATHS.includes(path));
}

async function completeWorktreeMatches(repositoryRoot, allowedPaths) {
  const trackedChanges = await runGit(['diff', '--name-only', '-z', 'HEAD', '--'], repositoryRoot);
  const untracked = await runGit(
    ['ls-files', '--others', '--exclude-standard', '-z'],
    repositoryRoot
  );
  return (
    trackedChanges.code === 0 &&
    untracked.code === 0 &&
    allowedPaths(nulSeparatedPaths(trackedChanges.stdout), nulSeparatedPaths(untracked.stdout))
  );
}

async function readEvidenceFile(evidencePath) {
  let handle;
  try {
    handle = await open(evidencePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = await handle.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size < 1 ||
      before.size > EVIDENCE_MAX_BYTES
    ) {
      throw new Error('VM_ATTESTATION_UNREADABLE');
    }
    const bytes = Buffer.alloc(EVIDENCE_MAX_BYTES + 1);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (
      offset < 1 ||
      offset > EVIDENCE_MAX_BYTES ||
      !after.isFile() ||
      after.nlink !== 1 ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== offset
    ) {
      throw new Error('VM_ATTESTATION_UNREADABLE');
    }
    return bytes.subarray(0, offset).toString('utf8');
  } finally {
    if (handle !== undefined) await handle.close().catch(() => undefined);
  }
}

async function gitStateIsCoherent(repositoryRoot, attestation) {
  const commitExists = await runGit(
    ['cat-file', '-e', `${attestation.commit}^{commit}`],
    repositoryRoot
  );
  if (commitExists.code !== 0) return false;

  const testedTree = await runGit(
    ['rev-parse', '--verify', `${attestation.commit}^{tree}`],
    repositoryRoot
  );
  if (
    testedTree.code !== 0 ||
    !GIT_OBJECT_PATTERN.test(testedTree.stdout.trim()) ||
    testedTree.stdout.trim() !== attestation.tree
  ) {
    return false;
  }

  const headResult = await runGit(['rev-parse', '--verify', 'HEAD^{commit}'], repositoryRoot);
  const head = headResult.stdout.trim();
  if (headResult.code !== 0 || !GIT_OBJECT_PATTERN.test(head)) return false;

  const ancestor = await runGit(
    ['merge-base', '--is-ancestor', attestation.commit, 'HEAD'],
    repositoryRoot
  );
  if (ancestor.code !== 0) return false;

  if (head === attestation.commit) {
    return completeWorktreeMatches(repositoryRoot, (trackedChanges, untracked) => {
      const combined = [...trackedChanges, ...untracked];
      return (
        combined.length > 0 && combined.every((path) => EVIDENCE_RELATIVE_PATHS.includes(path))
      );
    });
  }

  const changedPaths = await runGit(
    ['diff', '--name-only', '-z', `${attestation.commit}..HEAD`, '--'],
    repositoryRoot
  );
  if (changedPaths.code !== 0 || !evidencePathsSubset(changedPaths.stdout)) return false;
  return completeWorktreeMatches(
    repositoryRoot,
    (trackedChanges, untracked) => trackedChanges.length === 0 && untracked.length === 0
  );
}

async function verifyEvidenceFile({ repositoryRoot, evidencePath, build, serialize }) {
  let attestation;
  try {
    const raw = await readEvidenceFile(evidencePath);
    const parsed = JSON.parse(raw);
    attestation = build(parsed);
    if (raw !== serialize(attestation)) return { code: 1, missing: false };
  } catch (error) {
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    return { code: 1, missing };
  }
  try {
    return {
      code: (await gitStateIsCoherent(repositoryRoot, attestation)) ? 0 : 2,
      missing: false
    };
  } catch {
    return { code: 2, missing: false };
  }
}

// Verifies BOTH evidence files independently — the alias evidence against buildVmAttestation, the
// restore round-trip evidence against buildVmRestoreAttestation — and fails non-zero if either one
// fails. `missingPaths` names which evidence file(s), if any, are not present at all (as opposed to
// present-but-invalid/stale), purely so the CLI can report which one without leaking anything about
// its content.
export async function verifyVmAttestation({ repositoryRoot = resolve('.') } = {}) {
  const alias = await verifyEvidenceFile({
    repositoryRoot,
    evidencePath: join(repositoryRoot, ALIAS_EVIDENCE_RELATIVE_PATH),
    build: buildVmAttestation,
    serialize: serializeVmAttestation
  });
  const restore = await verifyEvidenceFile({
    repositoryRoot,
    evidencePath: join(repositoryRoot, RESTORE_EVIDENCE_RELATIVE_PATH),
    build: buildVmRestoreAttestation,
    serialize: serializeVmRestoreAttestation
  });
  const missingPaths = Object.freeze([
    ...(alias.missing ? [ALIAS_EVIDENCE_RELATIVE_PATH] : []),
    ...(restore.missing ? [RESTORE_EVIDENCE_RELATIVE_PATH] : [])
  ]);
  const code =
    alias.code === 0 && restore.code === 0 ? 0 : alias.code === 1 || restore.code === 1 ? 1 : 2;
  return { code, missingPaths };
}

export async function runVmAttestationVerifier(arguments_ = process.argv.slice(2), options = {}) {
  if (!Array.isArray(arguments_) || arguments_.length !== 0) return 1;
  const { code, missingPaths } = await verifyVmAttestation();
  const stderr = options.stderr ?? process.stderr;
  // Static, content-free: only ever one of the two well-known, already-public evidence relative
  // paths — never anything read from either document.
  for (const evidencePath of missingPaths) {
    stderr.write(`Missing VM evidence file: ${evidencePath}\n`);
  }
  return code;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runVmAttestationVerifier()
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      process.exitCode = 1;
    });
}
