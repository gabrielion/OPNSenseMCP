// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  askMasked,
  createConfigureTerminal,
  type MaskedPromptPrimitives
} from '../../src/config/configure-terminal.js';

class ControlledMaskedPrompt extends EventEmitter {
  readonly output: string[] = [];
  raw = false;
  paused = true;
  readonly rawModes: boolean[] = [];
  readonly stateChanges: string[] = [];

  readonly primitives: MaskedPromptPrimitives = {
    inputIsTTY: () => true,
    outputIsTTY: () => true,
    hasRawMode: () => true,
    inputIsRaw: () => this.raw,
    inputIsPaused: () => this.paused,
    setRawMode: (enabled) => {
      this.raw = enabled;
      this.rawModes.push(enabled);
      this.stateChanges.push(`raw:${String(enabled)}`);
    },
    resumeInput: () => {
      this.paused = false;
      this.stateChanges.push('resume');
    },
    pauseInput: () => {
      this.paused = true;
      this.stateChanges.push('pause');
    },
    writeOutput: (message) => {
      this.output.push(message);
    },
    emitKeypressEvents: vi.fn(),
    onKeypress: (listener) => this.on('keypress', listener),
    offKeypress: (listener) => this.off('keypress', listener),
    onInputEnd: (listener) => this.on('end', listener),
    offInputEnd: (listener) => this.off('end', listener),
    onInputClose: (listener) => this.on('close', listener),
    offInputClose: (listener) => this.off('close', listener),
    onInputError: (listener) => this.on('error', listener),
    offInputError: (listener) => this.off('error', listener),
    onSignal: (signal, listener) => this.on(signal, listener),
    offSignal: (signal, listener) => this.off(signal, listener)
  };

  listenerTotal(): number {
    return ['keypress', 'end', 'close', 'error', 'SIGINT', 'SIGTERM'].reduce(
      (total, event) => total + this.listenerCount(event),
      0
    );
  }
}

describe('configure terminal adapter', () => {
  it('routes API key and secret prompts to the masked terminal primitive', async () => {
    const visible = vi.fn(() => Promise.resolve('origin'));
    const masked = vi.fn(() => Promise.resolve('credential'));
    const stdout = vi.fn();
    const stderr = vi.fn();
    const terminal = createConfigureTerminal({ visible, masked, stdout, stderr });

    await expect(terminal.prompt('OPNsense API key: ', { masked: true })).resolves.toBe(
      'credential'
    );
    await expect(terminal.prompt('OPNsense API secret: ', { masked: true })).resolves.toBe(
      'credential'
    );
    await expect(terminal.prompt('OPNsense HTTPS origin: ', { masked: false })).resolves.toBe(
      'origin'
    );

    expect(masked).toHaveBeenNthCalledWith(1, 'OPNsense API key: ');
    expect(masked).toHaveBeenNthCalledWith(2, 'OPNsense API secret: ');
    expect(visible).toHaveBeenCalledWith('OPNsense HTTPS origin: ');
    terminal.writeStdout('Configured.\n');
    terminal.writeStderr('Error\n');
    expect(stdout).toHaveBeenCalledWith('Configured.\n');
    expect(stderr).toHaveBeenCalledWith('Error\n');
  });

  it('runs the real masked state machine without writing credentials and restores paused state', async () => {
    const controlled = new ControlledMaskedPrompt();
    const pending = askMasked('Secret: ', controlled.primitives);

    controlled.emit('keypress', 's', { name: 's' });
    controlled.emit('keypress', 'e', { name: 'e' });
    controlled.emit('keypress', 'c', { name: 'c' });
    controlled.emit('keypress', 'r', { name: 'r' });
    controlled.emit('keypress', 'e', { name: 'e' });
    controlled.emit('keypress', 't', { name: 't' });
    controlled.emit('keypress', '\r', { name: 'return' });

    await expect(pending).resolves.toBe('secret');
    expect(controlled.output.join('')).toBe('Secret: ******\n');
    expect(controlled.output.join('')).not.toContain('secret');
    expect(controlled.stateChanges).toEqual(['raw:true', 'resume', 'raw:false', 'pause']);
    expect(controlled.listenerTotal()).toBe(0);
  });

  it('preserves an already-raw, already-resumed input without toggling its state', async () => {
    const controlled = new ControlledMaskedPrompt();
    controlled.raw = true;
    controlled.paused = false;
    const pending = askMasked('Secret: ', controlled.primitives);

    controlled.emit('keypress', '\r', { name: 'enter' });

    await expect(pending).resolves.toBe('');
    expect(controlled.stateChanges).toEqual([]);
    expect(controlled.listenerTotal()).toBe(0);
  });

  it.each([
    [
      'raw Ctrl-C',
      (controlled: ControlledMaskedPrompt) => controlled.emit('keypress', '\u0003', {})
    ],
    [
      'Ctrl-D',
      (controlled: ControlledMaskedPrompt) =>
        controlled.emit('keypress', '\u0004', { name: 'd', ctrl: true })
    ],
    ['EOF', (controlled: ControlledMaskedPrompt) => controlled.emit('end')],
    ['stream close', (controlled: ControlledMaskedPrompt) => controlled.emit('close')],
    [
      'stream error',
      (controlled: ControlledMaskedPrompt) => controlled.emit('error', new Error('SENTINEL'))
    ],
    ['SIGINT', (controlled: ControlledMaskedPrompt) => controlled.emit('SIGINT')],
    ['SIGTERM', (controlled: ControlledMaskedPrompt) => controlled.emit('SIGTERM')]
  ] as const)('rejects on %s and restores terminal state exactly once', async (_name, settle) => {
    const controlled = new ControlledMaskedPrompt();
    const pending = askMasked('Secret: ', controlled.primitives);

    settle(controlled);

    await expect(pending).rejects.toThrow(/^Interactive terminal unavailable$/u);
    expect(controlled.stateChanges).toEqual(['raw:true', 'resume', 'raw:false', 'pause']);
    expect(controlled.output.join('')).toBe('Secret: \n');
    expect(controlled.output.join('')).not.toContain('SENTINEL');
    expect(controlled.listenerTotal()).toBe(0);
    if (_name === 'stream error') controlled.on('error', () => undefined);
    settle(controlled);
    expect(controlled.stateChanges).toEqual(['raw:true', 'resume', 'raw:false', 'pause']);
  });
});
