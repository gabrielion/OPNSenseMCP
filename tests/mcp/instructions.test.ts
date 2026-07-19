// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../src/mcp/instructions.js';

describe('SERVER_INSTRUCTIONS', () => {
  it('places the essential safety guidance in the first 512 characters', () => {
    const firstWindow = SERVER_INSTRUCTIONS.slice(0, 512);

    expect(firstWindow).toContain('everyday language');
    expect(firstWindow).toContain('read-only discovery');
    expect(firstWindow).toContain('never invent');
    expect(firstWindow).toContain('Before any change');
  });

  it('stays concise and forbids secret collection through chat or forms', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2000);
    expect(SERVER_INSTRUCTIONS).toContain('Never request or reveal secrets through chat');
    expect(SERVER_INSTRUCTIONS).toContain('stop and explain the next safe step');
  });

  it('requires progressive discovery, material clarification, and explicit mutation permission', () => {
    expect(SERVER_INSTRUCTIONS).toContain('opn_describe');
    expect(SERVER_INSTRUCTIONS).toContain('unfamiliar resource');
    expect(SERVER_INSTRUCTIONS).toContain('ambiguous non-technical request');
    expect(SERVER_INSTRUCTIONS).toContain('Never infer permission to change');
  });
});
