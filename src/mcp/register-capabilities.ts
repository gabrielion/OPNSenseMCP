// SPDX-License-Identifier: AGPL-3.0-or-later
import type { McpServer, RequestStateCodec } from '@modelcontextprotocol/server';
import {
  listApplicationCapabilities,
  type ApplicationContext
} from '../app/application-context.js';
import { dispatchCapability } from '../capabilities/dispatch.js';
import type { CapabilityRequest, ServerContext, TransportKind } from '../capabilities/types.js';
import {
  definitionUsesElicitation,
  handleConfirmationCall,
  principalForRequest,
  type ConfirmationState
} from './confirmation.js';
import { formatCapabilityResult } from './results.js';

export function registerCapabilities(
  server: McpServer,
  application: ApplicationContext,
  transport: TransportKind,
  codec: RequestStateCodec<ConfirmationState>
): void {
  for (const definition of listApplicationCapabilities(application, transport)) {
    server.registerTool(
      definition.mcpName,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        annotations: definition.annotations
      },
      async (argumentsValue, mcpContext) => {
        const request: CapabilityRequest = {
          name: definition.mcpName,
          arguments: argumentsValue
        };
        if (definitionUsesElicitation(definition)) {
          return handleConfirmationCall(
            server,
            application,
            definition,
            request,
            transport,
            codec,
            mcpContext
          );
        }
        const context: ServerContext = {
          application,
          transport,
          signal: mcpContext.mcpReq.signal,
          principalId: principalForRequest(transport, mcpContext)
        };
        return formatCapabilityResult(await dispatchCapability(request, context));
      }
    );
  }
}
