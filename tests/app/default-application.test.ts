// SPDX-License-Identifier: AGPL-3.0-or-later
import { access, chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElicitResult } from '@modelcontextprotocol/client';
import * as z from 'zod/v4';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultApplicationRuntime,
  createOwnedApplicationRuntime,
  selectOPNsenseConfigFile
} from '../../src/app/default-application.js';
import {
  createApplicationContext,
  listApplicationCapabilities,
  settleApplicationConfirmation
} from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import { defineCapability } from '../../src/capabilities/kernel.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { KNOWN_RESOURCE_SCOPES } from '../../src/capabilities/resource-scopes.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';
import { connectLegacy } from '../helpers/connect.js';
import {
  startSyntheticOPNsenseTarget,
  type SyntheticOPNsenseTarget
} from '../support/https-opnsense-mock.js';

beforeEach(() => {
  vi.stubEnv('OPNSENSE_CONFIG_FILE', undefined);
  vi.stubEnv('HOME', '');
  vi.stubEnv('XDG_CONFIG_HOME', '');
  vi.stubEnv('APPDATA', '');
  // No ambient state root either: a test that does not name one must not reach the operator's own
  // durable state, and with no home to default to the composition root degrades instead of
  // guessing a directory.
  vi.stubEnv('OPNSENSE_MCP_STATE_DIR', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function writableConfig(): RuntimeConfig {
  return {
    readOnly: false,
    // A write is never authorized by an absent allow-list, so this writable harness names the
    // scopes its fixtures declare.
    allowedResourceScopes: new Set([...KNOWN_RESOURCE_SCOPES, 'test.read', 'test.write']),
    enabledFeatureFlags: new Set(),
    requestStateKey: new TextEncoder().encode('0123456789abcdef0123456789abcdef'),
    http: {
      enabled: false,
      host: '127.0.0.1',
      port: 3000,
      allowedHosts: ['localhost'],
      allowedOrigins: [],
      legacySseEnabled: false
    }
  };
}

function deferred() {
  let resolvePromise: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

interface AliasRow {
  readonly uuid: string;
  readonly name: string;
  readonly type: string;
  readonly description: string;
}

const CREATED_ALIAS_UUID = '00000000-0000-0000-0000-000000000001';

/** Points the composition root at a real synthetic target and returns the directory to remove. */
async function writeTargetConfig(target: SyntheticOPNsenseTarget): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'opnsense-composed-runtime-'));
  const caFile = join(directory, 'ca.pem');
  const configFile = join(directory, 'config.json');
  await writeFile(caFile, target.ca, { mode: 0o600 });
  await writeFile(
    configFile,
    JSON.stringify({ url: target.url, apiKey: 'test-key', apiSecret: 'test-secret', caFile }),
    { mode: 0o600 }
  );
  vi.stubEnv('OPNSENSE_CONFIG_FILE', configFile);
  return directory;
}

/** Alias writes need the exact triple: not read-only, the experimental flag, the named scope. */
function stubWriteGates(): void {
  vi.stubEnv('READ_ONLY', 'false');
  vi.stubEnv('ENABLED_FEATURE_FLAGS', 'experimental-alias-write');
  vi.stubEnv('ALLOWED_RESOURCES', 'server.status,system.status,core.services,firewall.alias');
}

describe('default application composition seam', () => {
  it('uses an explicit config path authoritatively and ignores missing or unsafe defaults', () => {
    const isRegularNonSymlinkFile = (path: string) => path === '/safe/default.json';

    expect(
      selectOPNsenseConfigFile(
        '/explicit/missing.json',
        '/safe/default.json',
        isRegularNonSymlinkFile
      )
    ).toBe('/explicit/missing.json');
    expect(
      selectOPNsenseConfigFile(undefined, '/missing/default.json', isRegularNonSymlinkFile)
    ).toBe(undefined);
    expect(
      selectOPNsenseConfigFile(undefined, '/unsafe/default.json', isRegularNonSymlinkFile)
    ).toBe(undefined);
    expect(selectOPNsenseConfigFile(undefined, '/safe/default.json', isRegularNonSymlinkFile)).toBe(
      '/safe/default.json'
    );
  });

  it('constructs the final four-tool Product 1A runtime without target credentials', async () => {
    const runtime = createDefaultApplicationRuntime();
    const connection = await connectLegacy(runtime.application);
    try {
      expect(
        listApplicationCapabilities(runtime.application, 'stdio').map(({ mcpName }) => mcpName)
      ).toEqual(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
      expect(
        listApplicationCapabilities(runtime.application, 'http').map(({ mcpName }) => mcpName)
      ).toEqual(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
      expect(Object.getOwnPropertyNames(runtime)).toEqual(['application', 'close']);
      expect(Object.isFrozen(runtime)).toBe(true);
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list'
      ]);
    } finally {
      await connection.close();
      await runtime.close();
    }
  });

  it('closes idempotently', async () => {
    const runtime = createDefaultApplicationRuntime();
    await Promise.all([runtime.close(), runtime.close(), runtime.close()]);
    await runtime.close();
  });

  it('fails startup with one sanitized error when the explicit private config is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opnsense-invalid-startup-'));
    const path = join(directory, 'config-SENTINEL_SECRET.json');
    await writeFile(
      path,
      JSON.stringify({
        url: 'http://SENTINEL_INVALID_URL',
        apiKey: 'SENTINEL_KEY',
        apiSecret: 'SENTINEL_SECRET'
      }),
      { mode: 0o600 }
    );
    vi.stubEnv('OPNSENSE_CONFIG_FILE', path);
    try {
      expect(() => createDefaultApplicationRuntime()).toThrow(
        /^Invalid OPNsense configuration\.$/u
      );
      try {
        createDefaultApplicationRuntime();
      } catch (error) {
        expect(String(error)).not.toContain('SENTINEL');
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('drains a real admitted HTTPS read before closing the product client', async () => {
    const started = deferred();
    const target = await startSyntheticOPNsenseTarget(() => {
      started.resolve();
      return {
        delayMs: 40,
        body: JSON.stringify({ metadata: { system: { status: 'ok' } }, subsystems: {} })
      };
    });
    const directory = await mkdtemp(join(tmpdir(), 'opnsense-runtime-drain-'));
    const caFile = join(directory, 'ca.pem');
    const configFile = join(directory, 'config.json');
    await writeFile(caFile, target.ca, { mode: 0o600 });
    await writeFile(
      configFile,
      JSON.stringify({
        url: target.url,
        apiKey: 'test-key',
        apiSecret: 'test-secret',
        caFile
      }),
      { mode: 0o600 }
    );
    vi.stubEnv('OPNSENSE_CONFIG_FILE', configFile);
    const runtime = createDefaultApplicationRuntime();
    try {
      const execution = dispatchCapability(
        { name: 'opn_get', arguments: { resource: 'system.status' } },
        { application: runtime.application, transport: 'stdio' }
      );
      await started.promise;
      const shutdown = runtime.close();
      let shutdownSettled = false;
      void shutdown.finally(() => {
        shutdownSettled = true;
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(shutdownSettled).toBe(false);
      await expect(execution).resolves.toEqual({
        kind: 'success',
        output: { item: { status: 'ok' } }
      });
      await shutdown;
      expect(shutdownSettled).toBe(true);
      await expect(
        dispatchCapability(
          { name: 'opn_get', arguments: { resource: 'system.status' } },
          { application: runtime.application, transport: 'stdio' }
        )
      ).rejects.toThrow(/^Application is closing$/u);
    } finally {
      await runtime.close().catch(() => undefined);
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(['read', 'write'] as const)(
    'closes application admission in the same turn before an initial %s dispatch',
    async (effect) => {
      const handler = vi.fn();
      const capability =
        effect === 'read'
          ? createReadFixture({
              handler: ({ value }) => {
                handler();
                return Promise.resolve({ echoed: value });
              }
            })
          : createMutationFixture(handler);
      const application = createApplicationContext(
        writableConfig(),
        new CapabilityCatalog([capability])
      );
      const runtime = createOwnedApplicationRuntime(application);

      const shutdown = runtime.close();
      const lateDispatch = dispatchCapability(
        { name: capability.mcpName, arguments: { value: 'late' } },
        { application, transport: 'stdio' }
      );

      await expect(lateDispatch).rejects.toThrow(/^Application is closing$/u);
      expect(handler).not.toHaveBeenCalled();
      await shutdown;
    }
  );

  it('closes application admission in the same turn before confirmation completion', async () => {
    const handler = vi.fn();
    const mutation = createMutationFixture(handler);
    const application = createApplicationContext(
      writableConfig(),
      new CapabilityCatalog([mutation])
    );
    const runtime = createOwnedApplicationRuntime(application);
    const request = { name: mutation.mcpName, arguments: { value: 'safe' } };
    const initial = await dispatchCapability(request, { application, transport: 'stdio' });
    if (initial.kind !== 'confirmation-required') {
      throw new Error('Expected a confirmation challenge');
    }

    const shutdown = runtime.close();
    const lateCompletion = settleApplicationConfirmation(
      application,
      'accept',
      initial.challenge,
      request,
      { transport: 'stdio' }
    );

    await expect(lateCompletion).rejects.toThrow(/^Application is closing$/u);
    expect(handler).not.toHaveBeenCalled();
    await shutdown;
  });

  it('drains an already-admitted initial dispatch before owned services close', async () => {
    const started = deferred();
    const release = deferred();
    let serviceOpen = true;
    const read = createReadFixture({
      handler: async ({ value }) => {
        started.resolve();
        await release.promise;
        return { echoed: serviceOpen ? value : 'service-closed-too-early' };
      }
    });
    const application = createApplicationContext(writableConfig(), new CapabilityCatalog([read]));
    const closeService = vi.fn(() => {
      serviceOpen = false;
      return Promise.resolve();
    });
    const runtime = createOwnedApplicationRuntime(application, [closeService]);

    const execution = dispatchCapability(
      { name: read.mcpName, arguments: { value: 'safe' } },
      { application, transport: 'stdio' }
    );
    await started.promise;
    const shutdown = runtime.close();
    expect(runtime.close()).toBe(shutdown);
    await Promise.resolve();
    expect(closeService).not.toHaveBeenCalled();
    release.resolve();

    await expect(execution).resolves.toEqual({ kind: 'success', output: { echoed: 'safe' } });
    await shutdown;
    expect(closeService).toHaveBeenCalledTimes(1);
    expect(serviceOpen).toBe(false);
  });

  it('retains an abort-ignoring read until its hidden handler settlement before service close', async () => {
    const started = deferred();
    const release = deferred();
    const controller = new AbortController();
    let serviceOpen = true;
    const read = createReadFixture({
      handler: async ({ value }) => {
        started.resolve();
        await release.promise;
        return { echoed: serviceOpen ? value : 'service-closed-too-early' };
      }
    });
    const application = createApplicationContext(writableConfig(), new CapabilityCatalog([read]));
    const closeService = vi.fn(() => {
      serviceOpen = false;
      return Promise.resolve();
    });
    const runtime = createOwnedApplicationRuntime(application, [closeService]);

    try {
      const execution = dispatchCapability(
        { name: read.mcpName, arguments: { value: 'safe' } },
        { application, transport: 'stdio', signal: controller.signal }
      );
      await started.promise;
      controller.abort();
      await expect(execution).resolves.toMatchObject({ kind: 'refused', code: 'CANCELLED' });

      const shutdown = runtime.close();
      let shutdownSettled = false;
      void shutdown.finally(() => {
        shutdownSettled = true;
      });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(serviceOpen).toBe(true);
      expect(closeService).not.toHaveBeenCalled();
      expect(shutdownSettled).toBe(false);

      release.resolve();
      await shutdown;
      expect(shutdownSettled).toBe(true);
      expect(closeService).toHaveBeenCalledTimes(1);
      expect(serviceOpen).toBe(false);
    } finally {
      release.resolve();
      await runtime.close().catch(() => undefined);
    }
  });

  it('keeps an owned service open until a real delayed confirmed local write settles', async () => {
    const started = deferred();
    const release = deferred();
    let serviceOpen = true;
    let writes = 0;
    const mutation = defineCapability({
      id: 'test.delayed.local.write',
      mcpName: 'delayed_local_write',
      title: 'Delayed local write',
      description: 'Hold a process-local write open to prove shutdown drainage.',
      inputSchema: z.object({ value: z.string() }).strict(),
      outputSchema: z.object({ accepted: z.string() }).strict(),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      transports: ['stdio', 'http'],
      policy: {
        effect: 'local-write',
        resourceScopes: ['test.write'],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'elicitation',
        timeoutMs: 5_000,
        redactFields: []
      },
      handler: async ({ value }) => {
        writes += 1;
        started.resolve();
        await release.promise;
        return { accepted: serviceOpen ? value : 'service-closed-too-early' };
      }
    });
    const application = createApplicationContext(
      writableConfig(),
      new CapabilityCatalog([mutation])
    );
    const closeService = vi.fn(() => {
      serviceOpen = false;
      return Promise.resolve();
    });
    const runtime = createOwnedApplicationRuntime(application, [closeService]);
    const connection = await connectLegacy(application, {
      capabilities: { elicitation: { form: {} } }
    });
    connection.client.setRequestHandler('elicitation/create', () =>
      Promise.resolve({ action: 'accept', content: { confirm: true } } as ElicitResult)
    );
    try {
      const execution = connection.client.callTool({
        name: mutation.mcpName,
        arguments: { value: 'committed' }
      });
      await started.promise;
      const shutdown = runtime.close();
      expect(runtime.close()).toBe(shutdown);
      let shutdownSettled = false;
      void shutdown.finally(() => {
        shutdownSettled = true;
      });
      await Promise.resolve();

      expect(serviceOpen).toBe(true);
      expect(closeService).not.toHaveBeenCalled();
      expect(shutdownSettled).toBe(false);
      await expect(
        dispatchCapability(
          { name: mutation.mcpName, arguments: { value: 'late' } },
          { application, transport: 'stdio' }
        )
      ).rejects.toThrow(/^Application is closing$/u);
      expect(writes).toBe(1);

      release.resolve();
      await expect(execution).resolves.toMatchObject({
        structuredContent: { accepted: 'committed' }
      });
      await shutdown;
      expect(shutdownSettled).toBe(true);
      expect(closeService).toHaveBeenCalledTimes(1);
      expect(serviceOpen).toBe(false);
    } finally {
      release.resolve();
      await connection.close();
      await runtime.close().catch(() => undefined);
    }
  });

  it('composes the mutation envelope: write tools are listed and the backup is taken from the configured target', async () => {
    const aliases: AliasRow[] = [];
    const target = await startSyntheticOPNsenseTarget((request) => {
      if (request.path === '/api/core/backup/download/this') {
        return {
          headers: { 'content-type': 'application/xml' },
          body: '<?xml version="1.0"?><opnsense><system><hostname>lab</hostname></system></opnsense>'
        };
      }
      if (request.path === '/api/firewall/alias/searchItem') {
        const query = JSON.parse(request.body) as { current: number; rowCount: number };
        return {
          body: JSON.stringify({
            total: aliases.length,
            rowCount: query.rowCount,
            current: query.current,
            rows: aliases
          })
        };
      }
      if (request.path === '/api/firewall/alias/addItem') {
        aliases.push({
          uuid: CREATED_ALIAS_UUID,
          name: 'lab_hosts',
          type: 'host',
          description: 'lab'
        });
        return { body: JSON.stringify({ result: 'saved', uuid: CREATED_ALIAS_UUID }) };
      }
      if (request.path === '/api/firewall/alias/reconfigure') {
        return { body: JSON.stringify({ status: 'ok' }) };
      }
      return { statusCode: 404, body: '{}' };
    });
    const directory = await writeTargetConfig(target);
    // The durable state root, pointed at a private scratch directory: `OPNSENSE_MCP_STATE_DIR` is
    // the only override the resolver accepts, and it is what keeps this test off the operator's
    // real state.
    const stateDir = await mkdtemp(join(tmpdir(), 'opnsense-composed-state-'));
    vi.stubEnv('OPNSENSE_MCP_STATE_DIR', stateDir);
    stubWriteGates();
    const runtime = createDefaultApplicationRuntime();
    const connection = await connectLegacy(runtime.application, {
      capabilities: { elicitation: { form: {} } }
    });
    connection.client.setRequestHandler('elicitation/create', () =>
      Promise.resolve({ action: 'accept', content: { confirm: true } } as ElicitResult)
    );
    try {
      // A composition that failed to build the envelope's services could not list a write at all:
      // the kernel refuses to hold one without them.
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list',
        'opn_create',
        'opn_delete'
      ]);

      await expect(
        connection.client.callTool({
          name: 'opn_create',
          arguments: {
            resource: 'firewall.alias',
            attributes: {
              name: 'lab_hosts',
              type: 'host',
              content: ['192.0.2.10'],
              description: 'lab'
            }
          }
        })
      ).resolves.toMatchObject({
        structuredContent: { item: { uuid: CREATED_ALIAS_UUID, name: 'lab_hosts' } }
      });

      // The backup service is bound to the product client: the strict pre-write snapshot is fetched
      // from the configured target, before the change it protects.
      const paths = target.requests.map(({ path }) => path);
      expect(paths).toContain('/api/core/backup/download/this');
      expect(paths.indexOf('/api/core/backup/download/this')).toBeLessThan(
        paths.indexOf('/api/firewall/alias/addItem')
      );

      // The snapshot is a real pair of files under the resolved state root, filed against the
      // target the configured origin derives — not a per-process scratch directory.
      const targetsDir = join(stateDir, 'targets');
      const targetIds = await readdir(targetsDir);
      expect(targetIds).toHaveLength(1);
      expect(targetIds[0]).toMatch(/^[a-z2-7]{52}$/u);
      const targetDir = join(targetsDir, targetIds[0] ?? '');
      // The spec's fixed layout, all three of it. The lock file is the tell that the kernel lock
      // is the one wired: an in-process manager would have left nothing on disk.
      expect((await readdir(targetDir)).sort()).toEqual(['audit', 'backups', 'lock']);
      const backupIds = await readdir(join(targetDir, 'backups'));
      expect(backupIds).toHaveLength(1);
      expect(backupIds[0]).toMatch(/^[0-9a-f]{32}$/u);
      const backupDir = join(targetDir, 'backups', backupIds[0] ?? '');
      expect(await readFile(join(backupDir, 'config.xml'), 'utf8')).toContain(
        '<hostname>lab</hostname>'
      );
      expect(
        JSON.parse(await readFile(join(backupDir, 'metadata.json'), 'utf8')) as Record<
          string,
          unknown
        >
      ).toMatchObject({ schemaVersion: 1, backupId: backupIds[0], mcpName: 'opn_create' });

      // Both audit lines of the run are on disk, in this month's segment, under one transaction.
      const auditDir = join(targetDir, 'audit');
      const segments = await readdir(auditDir);
      expect(segments).toHaveLength(1);
      expect(segments[0]).toMatch(/^\d{4}-\d{2}\.jsonl$/u);
      const records = (await readFile(join(auditDir, segments[0] ?? ''), 'utf8'))
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as { phase: string; transactionId: string });
      expect(records.map(({ phase }) => phase)).toEqual(['intent', 'result']);
      expect(new Set(records.map(({ transactionId }) => transactionId)).size).toBe(1);

      // Durable across a restart: shutting the server down must leave the state where it is, and
      // the next start must derive the same target from the same published identity key.
      await connection.close();
      await runtime.close();
      const restarted = createDefaultApplicationRuntime();
      try {
        expect(await readdir(targetsDir)).toEqual(targetIds);
        expect(await readdir(join(targetDir, 'backups'))).toEqual(backupIds);
        expect(await readFile(join(backupDir, 'config.xml'), 'utf8')).toContain(
          '<hostname>lab</hostname>'
        );
      } finally {
        await restarted.close();
      }
    } finally {
      await connection.close();
      await runtime.close();
      await target.close();
      await rm(directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('derives a durable target for a firewall reached on the default HTTPS port', async () => {
    // The private configuration carries a URL ORIGIN, and an origin drops :443 — which is the
    // spelling of every firewall reachable at `https://<host>`. A target id is derived from the
    // canonical origin, and deriving one from `https://host` verbatim throws, so the
    // canonicalization at the seam is the whole difference between that deployment and a server
    // with no writes at all. Composing touches no network, so an unreachable host proves it.
    const directory = await mkdtemp(join(tmpdir(), 'opnsense-default-port-'));
    const stateDir = await mkdtemp(join(tmpdir(), 'opnsense-default-port-state-'));
    const configFile = join(directory, 'config.json');
    await writeFile(
      configFile,
      JSON.stringify({
        url: 'https://firewall.invalid',
        apiKey: 'test-key',
        apiSecret: 'test-secret'
      }),
      { mode: 0o600 }
    );
    vi.stubEnv('OPNSENSE_CONFIG_FILE', configFile);
    vi.stubEnv('OPNSENSE_MCP_STATE_DIR', stateDir);
    stubWriteGates();

    const runtime = createDefaultApplicationRuntime();
    try {
      expect(
        listApplicationCapabilities(runtime.application, 'stdio').map(({ mcpName }) => mcpName)
      ).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list',
        'opn_create',
        'opn_delete'
      ]);
      const targetIds = await readdir(join(stateDir, 'targets'));
      expect(targetIds).toHaveLength(1);
      expect(targetIds[0]).toMatch(/^[a-z2-7]{52}$/u);
    } finally {
      await runtime.close();
      await rm(directory, { recursive: true, force: true });
      await rm(stateDir, { recursive: true, force: true });
    }
  });

  it('refuses to place durable state relative to the working directory', async () => {
    // `os.homedir()` answers with an empty string when HOME is one, and the platform defaults are
    // built from it: macOS would resolve `Library/Application Support/…` and Linux
    // `.local/state/…` RELATIVE to wherever the server was started — a service manager's working
    // directory, whatever its mode — and every integrity check would then pass on the wrong
    // directory, because the root is created before it is canonicalized. There is nothing to
    // repair, so the composition root refuses and degrades to reads.
    const target = await startSyntheticOPNsenseTarget(() => ({
      body: JSON.stringify({ metadata: { system: { status: 'ok' } }, subsystems: {} })
    }));
    const directory = await writeTargetConfig(target);
    // Named here rather than inherited from the suite's setup, because this environment IS the
    // subject: an empty HOME, and no override to stand in for it. `XDG_STATE_HOME` is emptied with
    // it so the Linux default falls to its relative spelling too, instead of a configured absolute
    // state home that would put the leak somewhere this test does not look.
    vi.stubEnv('HOME', '');
    vi.stubEnv('OPNSENSE_MCP_STATE_DIR', undefined);
    vi.stubEnv('XDG_STATE_HOME', '');
    stubWriteGates();

    const runtime = createDefaultApplicationRuntime();
    try {
      expect(
        listApplicationCapabilities(runtime.application, 'stdio').map(({ mcpName }) => mcpName)
      ).toEqual(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
      // Nothing was written where the defaults would have pointed. Both spellings, because the
      // suite must fail the same way on the platform that is not this one.
      await expect(access(join(process.cwd(), 'Library'))).rejects.toMatchObject({
        code: 'ENOENT'
      });
      await expect(access(join(process.cwd(), '.local'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await runtime.close();
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  // One case per directory the wiring creates, so each validation answers for itself: a single
  // case would keep passing while the other directory's check was deleted.
  it.each(['backups', 'audit'] as const)(
    'refuses the envelope when the %s directory stops being private',
    async (widened) => {
      const target = await startSyntheticOPNsenseTarget((request) => {
        if (request.path === '/api/firewall/alias/searchItem') {
          const query = JSON.parse(request.body) as { current: number; rowCount: number };
          return {
            body: JSON.stringify({
              total: 0,
              rowCount: query.rowCount,
              current: query.current,
              rows: []
            })
          };
        }
        return { body: JSON.stringify({ metadata: { system: { status: 'ok' } }, subsystems: {} }) };
      });
      const directory = await writeTargetConfig(target);
      const stateDir = await mkdtemp(join(tmpdir(), 'opnsense-lax-subdirectory-state-'));
      vi.stubEnv('OPNSENSE_MCP_STATE_DIR', stateDir);
      stubWriteGates();

      // First start: the layout is created privately and the writes are offered.
      const first = createDefaultApplicationRuntime();
      let targetDir = '';
      try {
        expect(
          listApplicationCapabilities(first.application, 'stdio').map(({ mcpName }) => mcpName)
        ).toContain('opn_create');
        const targetIds = await readdir(join(stateDir, 'targets'));
        targetDir = join(stateDir, 'targets', targetIds[0] ?? '');
      } finally {
        await first.close();
      }

      // Between the two runs the directory is widened to group- and other-readable. Both stores
      // create their own directory with `mkdir`, which is a silent no-op over one that already
      // exists, so nothing downstream would ever notice. Planted with chmod: a mode argument to
      // mkdir is masked by the umask, and a test that plants permission bits that way plants none.
      await chmod(join(targetDir, widened), 0o755);

      const second = createDefaultApplicationRuntime();
      try {
        expect(
          listApplicationCapabilities(second.application, 'stdio').map(({ mcpName }) => mcpName)
        ).toEqual(['server_status', 'opn_describe', 'opn_get', 'opn_list']);
        // Fail closed, not fail dead: the target is reachable, so its reads still answer.
        await expect(
          dispatchCapability(
            {
              name: 'opn_list',
              arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
            },
            { application: second.application, transport: 'stdio' }
          )
        ).resolves.toMatchObject({ kind: 'success' });
      } finally {
        await second.close();
        await target.close();
        await rm(directory, { recursive: true, force: true });
        await rm(stateDir, { recursive: true, force: true });
      }
    }
  );

  it('degrades to a read-only server when the mutation envelope cannot own a backup root', async () => {
    const target = await startSyntheticOPNsenseTarget((request) => {
      if (request.path === '/api/firewall/alias/searchItem') {
        const query = JSON.parse(request.body) as { current: number; rowCount: number };
        return {
          body: JSON.stringify({
            total: 0,
            rowCount: query.rowCount,
            current: query.current,
            rows: []
          })
        };
      }
      return { body: JSON.stringify({ metadata: { system: { status: 'ok' } }, subsystems: {} }) };
    });
    const directory = await writeTargetConfig(target);
    stubWriteGates();
    // The real seam, not an injected one: the resolved state root is created before it is
    // validated, and a regular file can never become the parent of a directory. So this is the
    // locked-down host — a root the server may not create — reproduced without depending on the
    // permissions of the account running the tests.
    const blocker = join(directory, 'blocker');
    await writeFile(blocker, '', { mode: 0o600 });
    vi.stubEnv('OPNSENSE_MCP_STATE_DIR', join(blocker, 'state'));

    const runtime = createDefaultApplicationRuntime();
    const connection = await connectLegacy(runtime.application);
    try {
      // Fail closed, not fail dead: the writes are gone even though every write gate is open, and
      // the reads the operator asked for still answer.
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status',
        'opn_describe',
        'opn_get',
        'opn_list'
      ]);
      await expect(
        dispatchCapability(
          { name: 'opn_get', arguments: { resource: 'system.status' } },
          { application: runtime.application, transport: 'stdio' }
        )
      ).resolves.toEqual({ kind: 'success', output: { item: { status: 'ok' } } });

      // The target is reachable; only the LOCAL backup root failed. Target-reachability and
      // write-availability are separate flags, so sealing the alias writes does not seal the alias
      // reads with them: `openResolvedStateRoot` throws unconditionally on win32, which makes this
      // degrade the ordinary win32 path, and a Windows operator must still get every read.
      await expect(
        dispatchCapability(
          {
            name: 'opn_list',
            arguments: { resource: 'firewall.alias', page: 1, pageSize: 10, query: '' }
          },
          { application: runtime.application, transport: 'stdio' }
        )
      ).resolves.toMatchObject({ kind: 'success' });
    } finally {
      await connection.close();
      await runtime.close();
      await target.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('is the only default executable composition root and records the downstream replacement seam', async () => {
    const [factory, main, httpEntrypoint] = await Promise.all([
      readFile('src/app/default-application.ts', 'utf8'),
      readFile('src/main.ts', 'utf8'),
      readFile('src/entrypoints/http.ts', 'utf8')
    ]);

    expect(factory).toContain('const config = loadRuntimeConfig()');
    expect(factory).toContain('createOwnedApplicationRuntime');
    expect(factory).toContain('loadOPNsenseConnectionConfig');
    expect(factory).toContain('createProductCapabilityCatalog(readAdapter, aliasAdapter)');
    expect(factory).toContain('client?.close()');
    expect(main).toContain('startStdio');
    expect(httpEntrypoint).toContain('createDefaultApplicationRuntime');
    expect(main).not.toContain('createApplicationContext');
    expect(main).not.toContain('loadRuntimeConfig');
    expect(httpEntrypoint).not.toContain('createApplicationContext');
    expect(httpEntrypoint).not.toContain('loadRuntimeConfig');
    async function sourceFiles(directory: string): Promise<string[]> {
      const entries = await readdir(directory, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
        else if (entry.isFile() && path.endsWith('.ts')) files.push(path);
      }
      return files;
    }
    const matches: string[] = [];
    for (const path of await sourceFiles('src')) {
      if (
        (await readFile(path, 'utf8')).includes(
          'createProductCapabilityCatalog(readAdapter, aliasAdapter)'
        )
      ) {
        matches.push(path);
      }
    }
    expect(matches).toEqual(['src/app/default-application.ts']);
  });
});
