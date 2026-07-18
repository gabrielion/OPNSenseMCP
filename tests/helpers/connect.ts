// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Client,
  StreamableHTTPClientTransport,
  type ClientOptions
} from '@modelcontextprotocol/client';
import { InMemoryTransport, createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import type { ApplicationContext } from '../../src/app/application-context.js';
import { createServerFactory } from '../../src/mcp/server-factory.js';
import { buildServer } from '../../src/server/build-server.js';

export interface TestConnection {
  readonly client: Client;
  close(): Promise<void>;
}

const CLIENT_INFO = Object.freeze({ name: 'opnsense-mcp-tests', version: '0.1.0' });

export async function connectLegacy(
  application: ApplicationContext,
  options: ClientOptions = {}
): Promise<TestConnection> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(application, 'stdio');
  const client = new Client(CLIENT_INFO, { ...options, versionNegotiation: { mode: 'legacy' } });
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    client,
    async close() {
      await Promise.allSettled([
        client.close(),
        clientTransport.close(),
        server.close(),
        serverTransport.close()
      ]);
    }
  };
}

export async function connectModern(
  application: ApplicationContext,
  options: ClientOptions = {},
  authInfo?: AuthInfo
): Promise<TestConnection> {
  const handler = createMcpHandler(createServerFactory(application, 'http'));
  const transport = new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), {
    fetch: (input, init) =>
      handler.fetch(new Request(input, init), authInfo === undefined ? {} : { authInfo })
  });
  const client = new Client(CLIENT_INFO, {
    ...options,
    versionNegotiation: { mode: { pin: '2026-07-28' } }
  });
  await client.connect(transport);

  return {
    client,
    async close() {
      await Promise.allSettled([client.close(), transport.close(), handler.close()]);
    }
  };
}
