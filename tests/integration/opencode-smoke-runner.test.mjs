// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { buildOpenCodeEvidence, collectToolEvidence } from '../../scripts/run-opencode-smoke.mjs';

describe('OpenCode Product 1A smoke evidence', () => {
  it('keeps only closed tool names and SHA-256 digests from OpenCode events', () => {
    const events = [
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_describe',
          state: { input: { resource: 'system.status' }, output: '{"mode":"resource"}' }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_get',
          state: { input: { resource: 'system.status' }, output: '{"status":"ok"}' }
        }
      },
      {
        type: 'tool_use',
        part: {
          tool: 'opnsense_opn_list',
          state: { input: { resource: 'core.services' }, output: '{"total":1}' }
        }
      }
    ];

    const tools = collectToolEvidence(events);

    expect(tools.map(({ name }) => name)).toEqual(['opn_describe', 'opn_get', 'opn_list']);
    for (const tool of tools) {
      expect(tool.inputSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(tool.resultSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(Object.keys(tool)).toEqual(['name', 'inputSha256', 'resultSha256']);
    }
    expect(JSON.stringify(tools)).not.toContain('system.status');
  });

  it('builds a path-free narrow claim for passed and blocked runs', () => {
    const common = {
      clientVersion: '1.18.3',
      model: 'opencode/north-mini-code-free',
      packageName: '@gabrielion/opnsense-mcp',
      packageVersion: '0.1.0',
      packageSha256: 'a'.repeat(64),
      tools: [],
      cleanupConfirmed: true,
      secretAbsent: true
    };
    const passed = buildOpenCodeEvidence({
      ...common,
      status: 'passed',
      mcpConnected: true,
      expectedReadsObserved: true
    });
    const blocked = buildOpenCodeEvidence({
      ...common,
      status: 'blocked',
      blockedReason: 'model-service-unavailable',
      mcpConnected: true,
      expectedReadsObserved: false
    });

    expect(passed.claim).toContain('only OpenCode 1.18.3');
    expect(passed.claim).toContain('synthetic HTTPS');
    expect(blocked.claim).toContain('No OpenCode routing claim');
    expect(blocked.blockedReason).toBe('model-service-unavailable');
    expect(JSON.stringify([passed, blocked])).not.toMatch(/\/private\/|\/var\/folders\/|SECRET/u);
  });
});
