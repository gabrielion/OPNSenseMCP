// SPDX-License-Identifier: AGPL-3.0-or-later
import { isAbsolute } from 'node:path';

const INSTALLED_INVOCATION_KEYS = Object.freeze(['arguments', 'command', 'cwd']);

function hasExactKeys(value) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === INSTALLED_INVOCATION_KEYS.length &&
    keys.every((key, index) => key === INSTALLED_INVOCATION_KEYS[index])
  );
}

function isSafeAbsolutePath(value) {
  return (
    typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value)
  );
}

export function validateInstalledInvocation(value) {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !hasExactKeys(value) ||
    !isSafeAbsolutePath(value.command) ||
    !isSafeAbsolutePath(value.cwd) ||
    !Array.isArray(value.arguments) ||
    value.arguments.some((argument) => typeof argument !== 'string' || argument.includes('\0'))
  ) {
    throw new Error('Invalid installed invocation');
  }
  return Object.freeze({
    command: value.command,
    arguments: Object.freeze([...value.arguments]),
    cwd: value.cwd
  });
}
