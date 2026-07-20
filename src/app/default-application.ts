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
import { lstatSync } from 'node:fs';
import { resolveDefaultOPNsenseConfigPath } from '../config/runtime-config.js';

export interface OwnedApplicationRuntime {
  readonly application: ApplicationContext;
  close(): Promise<void>;
}

function isRegularNonSymlinkFile(path: string): boolean {
  try {
    const stats = lstatSync(path);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export function selectOPNsenseConfigFile(
  explicitPath: string | undefined,
  defaultPath: string | undefined,
  isRegularFile: (path: string) => boolean = isRegularNonSymlinkFile
): string | undefined {
  if (explicitPath !== undefined) return explicitPath;
  return defaultPath !== undefined && isRegularFile(defaultPath) ? defaultPath : undefined;
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
  const defaultPath = resolveDefaultOPNsenseConfigPath(process.platform, {
    ...(process.env.HOME === undefined ? {} : { HOME: process.env.HOME }),
    ...(process.env.XDG_CONFIG_HOME === undefined
      ? {}
      : { XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME }),
    ...(process.env.APPDATA === undefined ? {} : { APPDATA: process.env.APPDATA })
  });
  const configPath = selectOPNsenseConfigFile(config.opnsenseConfigFile, defaultPath);
  let client: OPNsenseHttpsClient | undefined;
  try {
    const adapter =
      configPath === undefined
        ? UNAVAILABLE_OPNSENSE_READ_ADAPTER
        : (() => {
            client = createOPNsenseHttpsClient(loadOPNsenseConnectionConfig(configPath));
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
