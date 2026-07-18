// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultApplicationRuntime } from '../../src/app/default-application.js';
import { listApplicationCapabilities } from '../../src/app/application-context.js';
import { connectLegacy } from '../helpers/connect.js';

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

  it('is the only default executable composition root and records the downstream replacement seam', async () => {
    const [factory, main, httpEntrypoint] = await Promise.all([
      readFile('src/app/default-application.ts', 'utf8'),
      readFile('src/main.ts', 'utf8'),
      readFile('src/entrypoints/http.ts', 'utf8')
    ]);

    expect(factory).toContain('createApplicationContext(loadRuntimeConfig())');
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
