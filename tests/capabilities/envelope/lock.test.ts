// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { createInProcessMutationLockManager } from '../../../src/capabilities/envelope/lock.js';

const signal = new AbortController().signal;

describe('in-process mutation lock manager', () => {
  it('grants a target once and refuses a held target until release', async () => {
    const manager = createInProcessMutationLockManager();
    const first = await manager.acquire('target', signal);
    expect(first).not.toBeNull();
    expect(await manager.acquire('target', signal)).toBeNull();
    // An in-process token cannot fail to be released, so the handle always reports it released.
    expect(await first?.release(signal)).toBe('released');
    const second = await manager.acquire('target', signal);
    expect(second).not.toBeNull();
    await second?.release(signal);
  });

  it('locks targets independently and tolerates a double release', async () => {
    const manager = createInProcessMutationLockManager();
    const a = await manager.acquire('a', signal);
    const b = await manager.acquire('b', signal);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await a?.release(signal)).toBe('released');
    expect(await a?.release(signal)).toBe('released');
    expect(await manager.acquire('a', signal)).not.toBeNull();
    expect(await manager.acquire('b', signal)).toBeNull();
  });
});
