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
import { createOPNsenseReadAdapter } from '../opnsense/read-adapter.js';
import { createOPNsenseAliasAdapter } from '../opnsense/alias-adapter.js';
import { createInProcessMutationLockManager } from '../capabilities/envelope/lock.js';
import { createBoundedAuditSink } from '../capabilities/envelope/audit.js';
import { createOPNsenseConfigBackupService } from '../capabilities/envelope/config-backup.js';
import type { MutationEnvelopeServices } from '../capabilities/types.js';
import { lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  if (configPath === undefined) {
    return createOwnedApplicationRuntime(
      createApplicationContext(config, createProductCapabilityCatalog())
    );
  }

  let client: OPNsenseHttpsClient | undefined;
  let backupRoot: string | undefined;
  try {
    client = createOPNsenseHttpsClient(loadOPNsenseConnectionConfig(configPath));
    const readAdapter = createOPNsenseReadAdapter(client);
    const aliasAdapter = createOPNsenseAliasAdapter(client);
    backupRoot = mkdtempSync(join(tmpdir(), 'opnsense-mcp-backup-'));
    const services: MutationEnvelopeServices = {
      lock: createInProcessMutationLockManager(),
      backup: createOPNsenseConfigBackupService(client, join(backupRoot, 'store')),
      audit: createBoundedAuditSink()
    };
    const application = createApplicationContext(
      config,
      createProductCapabilityCatalog(readAdapter, aliasAdapter),
      services
    );
    const ownedClient = client;
    const ownedBackupRoot = backupRoot;
    return createOwnedApplicationRuntime(application, [
      () => {
        ownedClient.close();
      },
      () => {
        rmSync(ownedBackupRoot, { recursive: true, force: true });
      }
    ]);
  } catch (error) {
    client?.close();
    if (backupRoot !== undefined) rmSync(backupRoot, { recursive: true, force: true });
    throw error;
  }
}
