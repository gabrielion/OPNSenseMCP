// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ElicitResult } from '@modelcontextprotocol/client';
import * as z from 'zod/v4';
import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultApplicationRuntime,
  createOwnedApplicationRuntime
} from '../../src/app/default-application.js';
import {
  createApplicationContext,
  listApplicationCapabilities
} from '../../src/app/application-context.js';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import { defineCapability } from '../../src/capabilities/kernel.js';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
import { createReadFixture } from '../fixtures/capabilities.js';
import { connectLegacy } from '../helpers/connect.js';

function writableConfig(): RuntimeConfig {
  return {
    readOnly: false,
    allowedResourceScopes: null,
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

describe('default application composition seam', () => {
  it('constructs the replaceable Foundation runtime with only server_status', async () => {
    const runtime = createDefaultApplicationRuntime();
    const connection = await connectLegacy(runtime.application);
    try {
      expect(
        listApplicationCapabilities(runtime.application, 'stdio').map(({ mcpName }) => mcpName)
      ).toEqual(['server_status']);
      expect(
        listApplicationCapabilities(runtime.application, 'http').map(({ mcpName }) => mcpName)
      ).toEqual(['server_status']);
      expect(Object.getOwnPropertyNames(runtime)).toEqual(['application', 'close']);
      expect(Object.isFrozen(runtime)).toBe(true);
      expect((await connection.client.listTools()).tools.map(({ name }) => name)).toEqual([
        'server_status'
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

  it('is the only default executable composition root and records the downstream replacement seam', async () => {
    const [factory, main, httpEntrypoint] = await Promise.all([
      readFile('src/app/default-application.ts', 'utf8'),
      readFile('src/main.ts', 'utf8'),
      readFile('src/entrypoints/http.ts', 'utf8')
    ]);

    expect(factory).toContain('createApplicationContext(loadRuntimeConfig())');
    expect(factory).toContain('createOwnedApplicationRuntime');
    expect(factory).toContain('Product Task 5 must replace this function body');
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
        (await readFile(path, 'utf8')).includes('createApplicationContext(loadRuntimeConfig())')
      ) {
        matches.push(path);
      }
    }
    expect(matches).toEqual(['src/app/default-application.ts']);
  });
});
