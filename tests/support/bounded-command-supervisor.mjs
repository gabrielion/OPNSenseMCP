// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { win32 } from 'node:path';

let target;
let startAccepted = false;
let spawnFailed = false;

// Test commands are cooperative: they must not daemonize, start a new session, or break away from this
// supervisor's inherited process family.

function hasExactKeys(value, expected) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isStartMessage(value) {
  return (
    hasExactKeys(value, ['arguments', 'command', 'environment', 'type']) &&
    value.type === 'start' &&
    typeof value.command === 'string' &&
    value.command.length > 0 &&
    Array.isArray(value.arguments) &&
    value.arguments.every((argument) => typeof argument === 'string') &&
    typeof value.environment === 'object' &&
    value.environment !== null &&
    !Array.isArray(value.environment) &&
    Object.values(value.environment).every((entry) => typeof entry === 'string')
  );
}

function send(message) {
  if (!process.connected) return;
  process.send(message, (error) => {
    if (error instanceof Error && process.connected) process.disconnect();
  });
}

function terminateAfterOwnerDisconnect() {
  if (process.platform !== 'win32') {
    try {
      process.kill(-process.pid, 'SIGKILL');
    } catch {
      process.exitCode = 1;
    }
    return;
  }
  const systemRoot = process.env.SystemRoot;
  if (
    typeof systemRoot === 'string' &&
    /^[A-Za-z]:\\[^\0/]+(?:\\[^\0/]+)*$/u.test(systemRoot) &&
    win32.normalize(systemRoot) === systemRoot
  ) {
    const killer = spawn(
      win32.join(systemRoot, 'System32', 'taskkill.exe'),
      ['/pid', String(process.pid), '/t', '/f'],
      {
        shell: false,
        stdio: 'ignore',
        windowsHide: true
      }
    );
    killer.once('error', () => {
      target?.kill('SIGKILL');
      process.exitCode = 1;
    });
    killer.unref();
    return;
  }
  target?.kill('SIGKILL');
  process.exitCode = 1;
}

process.on('message', (message) => {
  if (isStartMessage(message) && !startAccepted) {
    startAccepted = true;
    try {
      target = spawn(message.command, [...message.arguments], {
        cwd: process.cwd(),
        env: message.environment,
        shell: false,
        stdio: 'inherit',
        windowsHide: true
      });
    } catch {
      spawnFailed = true;
      send({ type: 'target-close', code: null, signal: null, spawnFailed: true });
      return;
    }
    target.once('spawn', () => {
      send({ type: 'started' });
    });
    target.once('error', () => {
      spawnFailed = true;
    });
    target.once('close', (code, signal) => {
      send({
        type: 'target-close',
        code: spawnFailed ? null : code,
        signal: spawnFailed ? null : signal,
        spawnFailed
      });
    });
  }
});

process.once('disconnect', terminateAfterOwnerDisconnect);
send({ type: 'ready' });
