// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeApplicationContext,
  createApplicationContext,
  type ApplicationContext
} from './application-context.js';
import { createPhasedClose, type CloseOperation } from './shutdown.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { createProductCapabilityCatalog } from '../capabilities/catalog.js';
import { loadOPNsenseConnectionConfig } from '../opnsense/config.js';
import { createOPNsenseHttpsClient, type OPNsenseHttpsClient } from '../opnsense/https-client.js';
import {
  createOPNsenseReadAdapter,
  UNAVAILABLE_OPNSENSE_READ_ADAPTER
} from '../opnsense/read-adapter.js';

export interface OwnedApplicationRuntime {
  readonly application: ApplicationContext;
  close(): Promise<void>;
}

export function createOwnedApplicationRuntime(
  application: ApplicationContext,
  serviceClosers: readonly CloseOperation[] = []
): OwnedApplicationRuntime {
  const ownedServiceClosers = Object.freeze([...serviceClosers]);
  let applicationDrain: Promise<void> | undefined;
  const beginApplicationClose = (): Promise<void> => {
    if (applicationDrain !== undefined) return applicationDrain;
    try {
      applicationDrain = closeApplicationContext(application);
    } catch (error) {
      applicationDrain = Promise.reject(
        error instanceof Error ? error : new Error('Application cleanup failed')
      );
    }
    return applicationDrain;
  };
  const aggregateClose = createPhasedClose(
    [[beginApplicationClose], ownedServiceClosers],
    undefined,
    'Application cleanup failed'
  );
  return Object.freeze({
    application,
    close: () => {
      const settlement = aggregateClose();
      void beginApplicationClose().catch(() => undefined);
      return settlement;
    }
  });
}

export function createDefaultApplicationRuntime(): OwnedApplicationRuntime {
  const config = loadRuntimeConfig();
  let client: OPNsenseHttpsClient | undefined;
  try {
    const adapter =
      config.opnsenseConfigFile === undefined
        ? UNAVAILABLE_OPNSENSE_READ_ADAPTER
        : (() => {
            client = createOPNsenseHttpsClient(
              loadOPNsenseConnectionConfig(config.opnsenseConfigFile)
            );
            return createOPNsenseReadAdapter(client);
          })();
    const application = createApplicationContext(config, createProductCapabilityCatalog(adapter));
    return createOwnedApplicationRuntime(
      application,
      client === undefined
        ? []
        : [
            () => {
              client?.close();
            }
          ]
    );
  } catch (error) {
    client?.close();
    throw error;
  }
}
