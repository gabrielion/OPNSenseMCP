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

interface BuiltMutationServices {
  readonly services: MutationEnvelopeServices;
  readonly dispose: () => void;
  /**
   * The target this envelope writes to. Nothing consumes it yet; it is returned rather than
   * dropped so the identity the durable state root will be derived from is already carried by the
   * value that owns the store, instead of being rediscovered later.
   */
  readonly origin: string;
}

/**
 * Builds the mutation envelope's owned services, or nothing at all.
 *
 * Returning `undefined` rather than throwing is the fail-closed degrade: a server that cannot own
 * a backup store must not start with writes, but it must still answer the reads it was asked for.
 * The kernel enforces the other half — it refuses to hold a write capability without these
 * services — so the caller pairs an absent result with a catalogue that has no write in it.
 */
function buildMutationServices(
  client: OPNsenseHttpsClient,
  origin: string
): BuiltMutationServices | undefined {
  let backupRoot: string | undefined;
  try {
    const root = mkdtempSync(join(tmpdir(), 'opnsense-mcp-backup-'));
    backupRoot = root;
    const services: MutationEnvelopeServices = {
      lock: createInProcessMutationLockManager(),
      backup: createOPNsenseConfigBackupService(client, join(root, 'store')),
      audit: createBoundedAuditSink()
    };
    return Object.freeze({
      services,
      dispose: () => {
        rmSync(root, { recursive: true, force: true });
      },
      origin
    });
  } catch {
    // A half-built envelope is never handed out, so its scratch root is removed here: no shutdown
    // path will ever learn about it.
    if (backupRoot !== undefined) {
      try {
        rmSync(backupRoot, { recursive: true, force: true });
      } catch {
        // Failing closed means starting read-only, not failing to start.
      }
    }
    return undefined;
  }
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
  let envelope: BuiltMutationServices | undefined;
  try {
    const parsed = loadOPNsenseConnectionConfig(configPath);
    client = createOPNsenseHttpsClient(parsed);
    const readAdapter = createOPNsenseReadAdapter(client);
    const aliasAdapter = createOPNsenseAliasAdapter(client);
    envelope = buildMutationServices(client, parsed.url);
    const application = createApplicationContext(
      config,
      // Without the envelope's services there is no protected write, so the alias target is not
      // offered as one: the catalogue seals the writes exactly as it does for an unreachable
      // target, and the reads stay listed.
      envelope === undefined
        ? createProductCapabilityCatalog(readAdapter)
        : createProductCapabilityCatalog(readAdapter, aliasAdapter),
      envelope?.services
    );
    const ownedClient = client;
    const closeClient = () => {
      ownedClient.close();
    };
    return createOwnedApplicationRuntime(
      application,
      envelope === undefined ? [closeClient] : [closeClient, envelope.dispose]
    );
  } catch (error) {
    client?.close();
    envelope?.dispose();
    throw error;
  }
}
