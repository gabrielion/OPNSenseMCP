// SPDX-License-Identifier: AGPL-3.0-or-later
import { createInterface } from 'node:readline/promises';
import { emitKeypressEvents } from 'node:readline';
import type { ConfigureTerminal } from './configure.js';

interface PromptPrimitives {
  visible(message: string): Promise<string>;
  masked(message: string): Promise<string>;
  stdout(message: string): void;
  stderr(message: string): void;
}

export function createConfigureTerminal(primitives: PromptPrimitives): ConfigureTerminal {
  return Object.freeze({
    prompt: (message: string, options: { readonly masked: boolean }) =>
      options.masked ? primitives.masked(message) : primitives.visible(message),
    writeStdout: (message: string) => {
      primitives.stdout(message);
    },
    writeStderr: (message: string) => {
      primitives.stderr(message);
    }
  });
}

function requireInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Interactive terminal unavailable');
  }
}

function askVisible(message: string): Promise<string> {
  requireInteractiveTerminal();
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
  });
  return terminal.question(message).finally(() => {
    terminal.close();
  });
}

interface Keypress {
  readonly name?: string;
  readonly ctrl?: boolean;
}

function askMasked(message: string): Promise<string> {
  requireInteractiveTerminal();
  if (typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Interactive terminal unavailable');
  }
  process.stdout.write(message);
  emitKeypressEvents(process.stdin);
  const restoreRawMode = !process.stdin.isRaw;
  if (restoreRawMode) process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = '';
    const cleanup = () => {
      process.stdin.off('keypress', onKeypress);
      if (restoreRawMode) process.stdin.setRawMode(false);
      process.stdout.write('\n');
    };
    const resolveValue = (result: string) => {
      cleanup();
      resolve(result);
    };
    const rejectError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onKeypress = (character: string, key: Keypress) => {
      if (key.ctrl && key.name === 'c') {
        rejectError(new Error('Interactive terminal unavailable'));
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        resolveValue(value);
        return;
      }
      if (key.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.write('\b \b');
        }
        return;
      }
      if (!key.ctrl && character.length > 0 && !/[\r\n]/u.test(character)) {
        value += character;
        process.stdout.write('*');
      }
    };
    process.stdin.on('keypress', onKeypress);
  });
}

export function createProcessConfigureTerminal(): ConfigureTerminal {
  return createConfigureTerminal({
    visible: askVisible,
    masked: askMasked,
    stdout: (message) => {
      process.stdout.write(message);
    },
    stderr: (message) => {
      process.stderr.write(message);
    }
  });
}
