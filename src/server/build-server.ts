// SPDX-License-Identifier: AGPL-3.0-or-later
import { McpServer } from '@modelcontextprotocol/server';
import {
  createApplicationRequestStateCodec,
  type ApplicationContext
} from '../app/application-context.js';
import type { TransportKind } from '../capabilities/types.js';
import { principalForRequest, type ConfirmationState } from '../mcp/confirmation.js';
import { SERVER_INSTRUCTIONS } from '../mcp/instructions.js';
import { registerPedagogicalPrompts } from '../mcp/prompts.js';
import { registerCapabilities } from '../mcp/register-capabilities.js';

export function buildServer(application: ApplicationContext, transport: TransportKind): McpServer {
  const codec = createApplicationRequestStateCodec<ConfirmationState>(
    application,
    (context) => `${context.mcpReq.method}\0${principalForRequest(transport, context)}`
  );
  const server = new McpServer(
    { name: 'opnsense-mcp', version: '0.1.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      inputRequired: { legacyShim: true, maxRounds: 4, roundTimeoutMs: 120_000 },
      requestState: { verify: (state, context) => codec.verify(state, context) }
    }
  );
  registerPedagogicalPrompts(server);
  registerCapabilities(server, application, transport, codec);
  return server;
}
