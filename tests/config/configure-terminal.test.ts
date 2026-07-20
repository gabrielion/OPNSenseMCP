// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { createConfigureTerminal } from '../../src/config/configure-terminal.js';

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
});
