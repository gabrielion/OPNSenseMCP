// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { resolveStateRootPath } from '../../src/state/state-root.js';

const HOME = '/home/operator';

function environment(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {}
): { platform: NodeJS.Platform; env: Record<string, string | undefined>; homeDir: string } {
  return { platform, env, homeDir: HOME };
}

describe('resolveStateRootPath', () => {
  it('uses the absolute override verbatim on any supported platform', () => {
    expect(resolveStateRootPath('/private/tmp/state', environment('linux'))).toBe(
      '/private/tmp/state'
    );
  });

  it('rejects a relative override', () => {
    expect(() => resolveStateRootPath('relative/state', environment('linux'))).toThrow(
      'OPNSENSE_MCP_STATE_DIR must be an absolute path'
    );
  });

  it('defaults to Application Support on macOS', () => {
    expect(resolveStateRootPath(undefined, environment('darwin'))).toBe(
      `${HOME}/Library/Application Support/opnsense-mcp/state`
    );
  });

  it('prefers an absolute XDG_STATE_HOME on Linux and falls back to ~/.local/state', () => {
    expect(
      resolveStateRootPath(undefined, environment('linux', { XDG_STATE_HOME: '/var/state' }))
    ).toBe('/var/state/opnsense-mcp');
    expect(
      resolveStateRootPath(undefined, environment('linux', { XDG_STATE_HOME: 'not-absolute' }))
    ).toBe(`${HOME}/.local/state/opnsense-mcp`);
    expect(resolveStateRootPath(undefined, environment('linux'))).toBe(
      `${HOME}/.local/state/opnsense-mcp`
    );
  });

  it('fails closed on Windows and on unknown platforms, even with an override', () => {
    for (const platform of ['win32', 'freebsd'] as const) {
      expect(() => resolveStateRootPath(undefined, environment(platform))).toThrow(
        'Durable state is not supported on this platform'
      );
      expect(() => resolveStateRootPath('/abs', environment(platform))).toThrow(
        'Durable state is not supported on this platform'
      );
    }
  });
});
