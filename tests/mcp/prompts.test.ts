// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  PROMPT_NAMES,
  renderDeviceDomainBlockPrompt,
  renderInternalPublicationPrompt,
  renderNetworkDiagnosisPrompt
} from '../../src/mcp/prompts.js';

describe('pedagogical prompts', () => {
  it('exports stable discoverable names', () => {
    expect(PROMPT_NAMES).toEqual([
      'diagnose_network_problem',
      'publish_internal_service',
      'block_domain_for_device'
    ]);
  });

  it('keeps diagnosis read-only and separates evidence from hypotheses', () => {
    const prompt = renderNetworkDiagnosisPrompt({ symptom: 'Internet is slow' });

    expect(prompt).toContain('read-only');
    expect(prompt).toContain('verified observation');
    expect(prompt).toContain('hypothesis');
  });

  it('keeps publication and blocking in prepare-only mode', () => {
    expect(renderInternalPublicationPrompt({ serviceUrl: 'http://10.0.0.20:8080' })).toContain(
      'Do not change the firewall'
    );
    expect(renderDeviceDomainBlockPrompt({ domain: 'tiktok.com' })).toContain(
      'Never replace this with a global block'
    );
  });
});
