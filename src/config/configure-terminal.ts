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

type KeypressListener = (character: string | undefined, key: Keypress) => void;
type VoidListener = () => void;
type ErrorListener = (error: unknown) => void;

export interface MaskedPromptPrimitives {
  inputIsTTY(): boolean;
  outputIsTTY(): boolean;
  hasRawMode(): boolean;
  inputIsRaw(): boolean;
  inputIsPaused(): boolean;
  setRawMode(enabled: boolean): void;
  resumeInput(): void;
  pauseInput(): void;
  writeOutput(message: string): void;
  emitKeypressEvents(): void;
  onKeypress(listener: KeypressListener): unknown;
  offKeypress(listener: KeypressListener): unknown;
  onInputEnd(listener: VoidListener): unknown;
  offInputEnd(listener: VoidListener): unknown;
  onInputClose(listener: VoidListener): unknown;
  offInputClose(listener: VoidListener): unknown;
  onInputError(listener: ErrorListener): unknown;
  offInputError(listener: ErrorListener): unknown;
  onSignal(signal: 'SIGINT' | 'SIGTERM', listener: VoidListener): unknown;
  offSignal(signal: 'SIGINT' | 'SIGTERM', listener: VoidListener): unknown;
}

function unavailable(): Error {
  return new Error('Interactive terminal unavailable');
}

export function askMasked(message: string, primitives: MaskedPromptPrimitives): Promise<string> {
  if (!primitives.inputIsTTY() || !primitives.outputIsTTY() || !primitives.hasRawMode()) {
    throw new Error('Interactive terminal unavailable');
  }
  const wasRaw = primitives.inputIsRaw();
  const wasPaused = primitives.inputIsPaused();
  primitives.writeOutput(message);

  return new Promise<string>((resolve, reject) => {
    let value = '';
    let settled = false;
    let changedRawMode = false;
    let resumedInput = false;
    const cleanup = (): Error | undefined => {
      let cleanupError: Error | undefined;
      const attempt = (operation: () => void) => {
        try {
          operation();
        } catch {
          cleanupError = unavailable();
        }
      };
      attempt(() => {
        primitives.offKeypress(onKeypress);
      });
      attempt(() => {
        primitives.offInputEnd(onEnd);
      });
      attempt(() => {
        primitives.offInputClose(onClose);
      });
      attempt(() => {
        primitives.offInputError(onError);
      });
      attempt(() => {
        primitives.offSignal('SIGINT', onSignal);
      });
      attempt(() => {
        primitives.offSignal('SIGTERM', onSignal);
      });
      if (changedRawMode) {
        attempt(() => {
          primitives.setRawMode(wasRaw);
        });
      }
      if (resumedInput) {
        attempt(() => {
          primitives.pauseInput();
        });
      }
      attempt(() => {
        primitives.writeOutput('\n');
      });
      return cleanupError;
    };
    const resolveValue = (result: string) => {
      if (settled) return;
      settled = true;
      const cleanupError = cleanup();
      if (cleanupError === undefined) resolve(result);
      else reject(cleanupError);
    };
    const rejectUnavailable = () => {
      if (settled) return;
      settled = true;
      reject(cleanup() ?? unavailable());
    };
    const onKeypress = (character: string | undefined, key: Keypress) => {
      if (character === '\u0003' || (key.ctrl === true && key.name === 'c')) {
        rejectUnavailable();
        return;
      }
      if (character === '\u0004' || (key.ctrl === true && key.name === 'd')) {
        rejectUnavailable();
        return;
      }
      if (key.name === 'return' || key.name === 'enter') {
        resolveValue(value);
        return;
      }
      if (key.name === 'backspace') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          primitives.writeOutput('\b \b');
        }
        return;
      }
      if (
        key.ctrl !== true &&
        typeof character === 'string' &&
        character.length > 0 &&
        !/[\r\n]/u.test(character)
      ) {
        value += character;
        primitives.writeOutput('*');
      }
    };
    const onEnd = () => {
      rejectUnavailable();
    };
    const onClose = () => {
      rejectUnavailable();
    };
    const onError = () => {
      rejectUnavailable();
    };
    const onSignal = () => {
      rejectUnavailable();
    };

    try {
      primitives.emitKeypressEvents();
      primitives.onKeypress(onKeypress);
      primitives.onInputEnd(onEnd);
      primitives.onInputClose(onClose);
      primitives.onInputError(onError);
      primitives.onSignal('SIGINT', onSignal);
      primitives.onSignal('SIGTERM', onSignal);
      if (!wasRaw) {
        changedRawMode = true;
        primitives.setRawMode(true);
      }
      if (wasPaused) {
        resumedInput = true;
        primitives.resumeInput();
      }
    } catch {
      rejectUnavailable();
    }
  });
}

const PROCESS_MASKED_PROMPT_PRIMITIVES: MaskedPromptPrimitives = {
  inputIsTTY: () => process.stdin.isTTY,
  outputIsTTY: () => process.stdout.isTTY,
  hasRawMode: () => typeof process.stdin.setRawMode === 'function',
  inputIsRaw: () => process.stdin.isRaw,
  inputIsPaused: () => process.stdin.isPaused(),
  setRawMode: (enabled) => {
    process.stdin.setRawMode(enabled);
  },
  resumeInput: () => {
    process.stdin.resume();
  },
  pauseInput: () => {
    process.stdin.pause();
  },
  writeOutput: (message) => {
    process.stdout.write(message);
  },
  emitKeypressEvents: () => {
    emitKeypressEvents(process.stdin);
  },
  onKeypress: (listener) => process.stdin.on('keypress', listener),
  offKeypress: (listener) => process.stdin.off('keypress', listener),
  onInputEnd: (listener) => process.stdin.on('end', listener),
  offInputEnd: (listener) => process.stdin.off('end', listener),
  onInputClose: (listener) => process.stdin.on('close', listener),
  offInputClose: (listener) => process.stdin.off('close', listener),
  onInputError: (listener) => process.stdin.on('error', listener),
  offInputError: (listener) => process.stdin.off('error', listener),
  onSignal: (signal, listener) => process.on(signal, listener),
  offSignal: (signal, listener) => process.off(signal, listener)
};

export function createProcessConfigureTerminal(): ConfigureTerminal {
  return createConfigureTerminal({
    visible: askVisible,
    masked: (message) => askMasked(message, PROCESS_MASKED_PROMPT_PRIMITIVES),
    stdout: (message) => {
      process.stdout.write(message);
    },
    stderr: (message) => {
      process.stderr.write(message);
    }
  });
}
