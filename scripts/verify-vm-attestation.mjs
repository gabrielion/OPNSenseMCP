#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildVmAttestation, serializeVmAttestation } from './vm/attestation.mjs';

const EVIDENCE_RELATIVE_PATH = 'docs/evidence/product3-vm.json';
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

function soleEvidencePath(output) {
  const paths = nulSeparatedPaths(output);
  return paths.length === 1 && paths[0] === EVIDENCE_RELATIVE_PATH;
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

  const testedEvidence = await runGit(
    ['ls-tree', '--name-only', '-z', attestation.commit, '--', EVIDENCE_RELATIVE_PATH],
    repositoryRoot
  );
  if (testedEvidence.code !== 0 || testedEvidence.stdout !== '') return false;

  if (head === attestation.commit) {
    const trackedChanges = await runGit(['diff', '--quiet', 'HEAD', '--'], repositoryRoot);
    if (trackedChanges.code !== 0) return false;
    const untracked = await runGit(
      ['ls-files', '--others', '--exclude-standard', '-z'],
      repositoryRoot
    );
    return untracked.code === 0 && soleEvidencePath(untracked.stdout);
  }

  const changedPaths = await runGit(
    ['diff', '--name-only', '-z', `${attestation.commit}..HEAD`, '--'],
    repositoryRoot
  );
  if (changedPaths.code !== 0 || !soleEvidencePath(changedPaths.stdout)) return false;
  const workingEvidence = await runGit(
    ['diff', '--quiet', 'HEAD', '--', EVIDENCE_RELATIVE_PATH],
    repositoryRoot
  );
  return workingEvidence.code === 0;
}

export async function verifyVmAttestation({
  repositoryRoot = resolve('.'),
  evidencePath = join(repositoryRoot, EVIDENCE_RELATIVE_PATH)
} = {}) {
  let attestation;
  try {
    const raw = await readEvidenceFile(evidencePath);
    const parsed = JSON.parse(raw);
    attestation = buildVmAttestation(parsed);
    if (raw !== serializeVmAttestation(attestation)) return 1;
  } catch {
    return 1;
  }

  try {
    return (await gitStateIsCoherent(repositoryRoot, attestation)) ? 0 : 2;
  } catch {
    return 2;
  }
}

export async function runVmAttestationVerifier(arguments_ = process.argv.slice(2)) {
  if (!Array.isArray(arguments_) || arguments_.length !== 0) return 1;
  return verifyVmAttestation();
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
