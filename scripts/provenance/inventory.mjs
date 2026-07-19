// SPDX-License-Identifier: AGPL-3.0-or-later

const RAW_INVENTORY = [
  ['.agents/plugins/marketplace.json', 'approved'],
  ['.claude-plugin/marketplace.json', 'approved'],
  ['CONTRIBUTING.md', 'rewrite'],
  ['README.md', 'rewrite'],
  ['SECURITY.md', 'approved'],
  ['docs/adding-api-modules.md', 'approved'],
  ['docs/api-coverage-matrix.md', 'approved'],
  ['docs/ground-truth-eval.md', 'approved'],
  ['docs/production.md', 'approved'],
  ['docs/release.md', 'approved'],
  ['docs/ssh-features.md', 'approved'],
  ['docs/superpowers/plans/2026-06-22-ssh-backed-coverage.md', 'approved'],
  ['docs/superpowers/plans/2026-07-17-agentic-run1-audit.json', 'approved'],
  ['docs/superpowers/plans/2026-07-17-agentic-run1-audit.md', 'approved'],
  ['docs/superpowers/plans/2026-07-17-release-install-safety-benchmark.md', 'approved'],
  ['docs/superpowers/specs/2026-06-21-cleanup-hardening-backlog.md', 'approved'],
  ['docs/superpowers/specs/2026-06-22-ssh-backed-coverage-design.md', 'approved'],
  ['docs/superpowers/specs/2026-07-17-release-install-safety-benchmark-design.md', 'approved'],
  ['docs/testing.md', 'approved'],
  ['docs/tool-descriptions.md', 'approved'],
  ['plugins/opnsense-mcp/.claude-plugin/plugin.json', 'approved'],
  ['plugins/opnsense-mcp/.codex-plugin/plugin.json', 'approved'],
  ['plugins/opnsense-mcp/.mcp.json', 'approved'],
  ['plugins/opnsense-mcp/skills/opnsense-guide/SKILL.md', 'approved'],
  ['plugins/opnsense-mcp/skills/opnsense-guide/agents/openai.yaml', 'approved'],
  ['scripts/setup/bootstrap-dev.sh', 'approved'],
  ['src/cli/install.ts', 'approved'],
  ['src/cli/serve.ts', 'approved'],
  ['src/features/backup/storage.ts', 'rewrite'],
  ['src/http/security.ts', 'approved'],
  ['src/security/audit-log.ts', 'approved'],
  ['src/security/operation-policy.ts', 'approved'],
  ['tests/README.md', 'approved'],
  ['tests/agentic/deepeval/exposed-tools.txt', 'approved'],
  ['tests/agentic/deepeval/gt_assurance.py', 'approved'],
  ['tests/agentic/deepeval/gt_attestation.py', 'approved'],
  ['tests/agentic/deepeval/gt_checkpoint.py', 'approved'],
  ['tests/agentic/deepeval/gt_lib.py', 'approved'],
  ['tests/agentic/deepeval/gt_metrics.py', 'approved'],
  ['tests/agentic/deepeval/gt_tool_policy.py', 'approved'],
  ['tests/agentic/deepeval/irreversible-exclusions.json', 'approved'],
  ['tests/agentic/deepeval/requirements.txt', 'approved'],
  ['tests/agentic/deepeval/run_eval.py', 'approved'],
  ['tests/agentic/deepeval/semantic-contracts.json', 'approved'],
  ['tests/agentic/deepeval/setup.sh', 'approved'],
  ['tests/agentic/deepeval/test_agent_trace.py', 'approved'],
  ['tests/agentic/deepeval/test_attestation_adversarial.py', 'approved'],
  ['tests/agentic/deepeval/test_checkpoint.py', 'approved'],
  ['tests/agentic/deepeval/test_config_hygiene.py', 'approved'],
  ['tests/agentic/deepeval/test_hygiene_gate.py', 'approved'],
  ['tests/agentic/deepeval/test_infra_classification.py', 'approved'],
  ['tests/agentic/deepeval/test_metrics_adversarial.py', 'approved'],
  ['tests/agentic/deepeval/test_predicate_inventory.py', 'approved'],
  ['tests/agentic/deepeval/test_result_claims.py', 'approved'],
  ['tests/agentic/deepeval/test_validate_adversarial.py', 'approved'],
  ['tests/agentic/ground-truth.csv', 'approved'],
  ['tests/agentic/model-config.json', 'approved'],
  ['tests/agentic/run-agentic.mjs', 'approved'],
  ['tests/agentic/temp-config-hygiene.mjs', 'approved'],
  ['tests/agentic/verify-bridge-cleanup.test.mjs', 'approved'],
  ['tests/agentic/verify-bridge.mjs', 'approved'],
  ['tests/helpers/live-api-client.mjs', 'approved'],
  ['tests/helpers/mcp-client.mjs', 'approved'],
  ['tests/helpers/private-temp-json.mjs', 'approved'],
  ['tests/inspect.sh', 'approved'],
  ['tests/installer/install.test.mjs', 'approved'],
  ['tests/integration/acme-live-test.mjs', 'discard'],
  ['tests/integration/backup-flow.mjs', 'approved'],
  ['tests/integration/backup-id-collision.mjs', 'approved'],
  ['tests/integration/dnsbl-live-test.mjs', 'discard'],
  ['tests/integration/guardrails.mjs', 'approved'],
  ['tests/integration/live-script-secret-hygiene.mjs', 'approved'],
  ['tests/integration/mcp-against-mock.mjs', 'approved'],
  ['tests/integration/mcp-against-vm.mjs', 'approved'],
  ['tests/integration/monit-live-test.mjs', 'discard'],
  ['tests/integration/ssh-config-sections-vm.mjs', 'approved'],
  ['tests/integration/ssh-features-vm.mjs', 'approved'],
  ['tests/integration/ssh-restore-vm.mjs', 'approved'],
  ['tests/integration/ssh-system-vm.mjs', 'approved'],
  ['tests/integration/test-auto-initialization.ts', 'discard'],
  ['tests/integration/test-iac-components.ts', 'discard'],
  ['tests/integration/transport-security.mjs', 'approved'],
  ['tests/mock-opnsense/server.mjs', 'approved'],
  ['tests/plugin/package.test.mjs', 'approved'],
  ['tests/setup/bootstrap-dev.test.mjs', 'approved'],
  ['tests/smoke/claude-doc-consistency.mjs', 'approved'],
  ['tests/smoke/list-tools.mjs', 'approved'],
  ['tests/smoke/log-file-mode.mjs', 'approved'],
  ['tests/smoke/redaction.mjs', 'approved'],
  ['tests/unit/acme-client.test.js', 'discard'],
  ['tests/unit/dnsbl-subscription.test.js', 'discard'],
  ['tests/unit/monit.test.js', 'discard'],
  ['tests/unit/ssh-config-editor.test.mjs', 'approved'],
  ['tests/vm/assign-wan.sh', 'approved'],
  ['tests/vm/bootstrap-apikey.py', 'approved'],
  ['tests/vm/build-registry-snapshot.test.mjs', 'approved'],
  ['tests/vm/build-registry.mjs', 'approved'],
  ['tests/vm/disable-pf.sh', 'approved'],
  ['tests/vm/enable-ssh.py', 'approved'],
  ['tests/vm/image-checksum.test.mjs', 'approved'],
  ['tests/vm/image-sha256.txt', 'approved'],
  ['tests/vm/install-extra-ca.sh', 'approved'],
  ['tests/vm/install-plugins.sh', 'approved'],
  ['tests/vm/install-plugins.test.mjs', 'approved'],
  ['tests/vm/introspect-api.py', 'approved'],
  ['tests/vm/provision-one-vm.test.mjs', 'approved'],
  ['tests/vm/provision.sh', 'approved'],
  ['tests/vm/registry-diff.mjs', 'approved'],
  ['tests/vm/registry-diff.test.mjs', 'approved'],
  ['tests/vm/start-vm-reproducibility.test.mjs', 'approved'],
  ['tests/vm/start-vm.sh', 'approved'],
  ['tests/vm/stop-vm.sh', 'approved'],
  ['tests/vm/test_bootstrap_secret_hygiene.py', 'approved'],
  ['tests/vm/vm-doctor.sh', 'approved'],
  ['tests/vm/vm-doctor.test.mjs', 'approved'],
  ['tests/vm/vm-exec.py', 'approved']
];

const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com(?:[1-9]|[¹²³])|lpt(?:[1-9]|[¹²³]))(?:\.|$)/iu;

function hasWindowsInvalidCharacter(segment) {
  return [...segment].some((character) => {
    const codePoint = character.codePointAt(0);
    return (codePoint !== undefined && codePoint < 0x20) || '<>:"|?*'.includes(character);
  });
}

export function compareDestinations(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

export function portableCollisionKey(destination) {
  return destination.normalize('NFC').toUpperCase().normalize('NFC');
}

export function isPortableDestination(destination) {
  if (
    typeof destination !== 'string' ||
    destination.length === 0 ||
    destination !== destination.normalize('NFC') ||
    destination.startsWith('/') ||
    /^[A-Za-z]:/u.test(destination) ||
    destination.includes('\\')
  ) {
    return false;
  }

  const segments = destination.split('/');
  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== '.' &&
      segment !== '..' &&
      segment.toLowerCase() !== '.git' &&
      !hasWindowsInvalidCharacter(segment) &&
      !/[. ]$/u.test(segment) &&
      !WINDOWS_DEVICE.test(segment)
  );
}

function buildInventory() {
  const seen = new Set();
  const folded = new Set();
  const counts = { approved: 0, rewrite: 0, discard: 0 };
  let previous;

  const inventory = RAW_INVENTORY.map(([destination, assetClass]) => {
    if (
      !isPortableDestination(destination) ||
      !Object.hasOwn(counts, assetClass) ||
      seen.has(destination) ||
      folded.has(portableCollisionKey(destination)) ||
      (previous !== undefined && compareDestinations(previous, destination) >= 0)
    ) {
      throw new Error('Invalid migration inventory');
    }

    seen.add(destination);
    folded.add(portableCollisionKey(destination));
    counts[assetClass] += 1;
    previous = destination;
    return Object.freeze({ destination, class: assetClass });
  });

  if (
    inventory.length !== 116 ||
    counts.approved !== 105 ||
    counts.rewrite !== 3 ||
    counts.discard !== 8
  ) {
    throw new Error('Invalid migration inventory');
  }

  return { inventory: Object.freeze(inventory), counts: Object.freeze(counts) };
}

const built = buildInventory();

export const MIGRATION_INVENTORY = built.inventory;
export const MIGRATION_CLASS_COUNTS = built.counts;
