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
import { createKernelMutationLockManager } from '../capabilities/envelope/kernel-lock.js';
import { createDurableAuditSink } from '../capabilities/envelope/durable-audit.js';
import { createOPNsenseConfigBackupService } from '../capabilities/envelope/config-backup.js';
import {
  canonicalizeOrigin,
  deriveTargetId,
  ensureIdentityKey,
  ensurePrivateDirectory,
  ensureTargetDirectory,
  openResolvedStateRoot,
  type StateRoot
} from '../state/index.js';
import type { MutationEnvelopeServices } from '../capabilities/types.js';
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
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

const NO_STATE_ROOT = 'Durable state root is unavailable';

/**
 * Opens the durable state root this server owns.
 *
 * `OPNSENSE_MCP_STATE_DIR` is the only override; without it the root is the platform default,
 * which is built from the home directory. `os.homedir()` answers with an empty string when HOME is
 * set to one, and the default would then be a RELATIVE path — durable state created wherever the
 * server happened to be started, under whatever mode that directory carries. Nothing here can
 * repair that into an intended location, so it refuses, and the refusal degrades the server to
 * reads like every other fault on this path. An override needs no home and is not held to it.
 */
function openDurableStateRoot(environment: NodeJS.ProcessEnv): StateRoot {
  const override = environment.OPNSENSE_MCP_STATE_DIR;
  const homeDirectory = homedir();
  if (override === undefined && !isAbsolute(homeDirectory)) throw new Error(NO_STATE_ROOT);
  return openResolvedStateRoot(override, {
    platform: process.platform,
    // Only the single variable the resolver reads. The server's environment is where the target
    // credentials live, so no helper of this composition root is ever handed all of it.
    env:
      environment.XDG_STATE_HOME === undefined
        ? {}
        : { XDG_STATE_HOME: environment.XDG_STATE_HOME },
    homeDir: homeDirectory
  });
}

/**
 * Builds the mutation envelope's owned services on the durable state root, or nothing at all.
 *
 * Returning `undefined` rather than throwing is the fail-closed degrade: a server that cannot own
 * its durable state must not start with writes, but it must still answer the reads it was asked
 * for. The kernel enforces the other half — it refuses to hold a write capability without these
 * services — so the caller pairs an absent result with a catalogue that has no write in it. Every
 * fault lands here: an unsupported platform (win32 throws unconditionally, which makes this the
 * ordinary Windows path), a root the server may not create or that fails its integrity checks, an
 * identity key that cannot be published, an origin that is not a canonical HTTPS origin.
 *
 * There is nothing to dispose of afterwards. The state is durable by design — retention, not
 * shutdown, is what bounds it — and the lock manager owns no process between envelopes: its helper
 * is spawned inside `acquire` and dies with the release of the handle, or with this process.
 */
function buildMutationServices(
  client: OPNsenseHttpsClient,
  origin: string
): MutationEnvelopeServices | undefined {
  try {
    const root = openDurableStateRoot(process.env);
    // The origin is canonicalized HERE, at the seam: the identity of a target is its canonical
    // origin and nothing else, and `deriveTargetId` re-checks that rather than trusting it.
    const targetId = deriveTargetId(ensureIdentityKey(root), canonicalizeOrigin(origin));
    const targetDirectory = ensureTargetDirectory(root, targetId);
    // `ensureTargetDirectory` vouches for the target directory itself; these two are ours, so they
    // are held to the same owner-and-0700 discipline before either store is handed out. Both
    // stores create their own directory lazily, and `mkdir` is a silent no-op over a pre-existing
    // group-readable one — which is exactly the gap that would otherwise survive here.
    const backupsDirectory = join(targetDirectory, 'backups');
    const auditDirectory = join(targetDirectory, 'audit');
    ensurePrivateDirectory(backupsDirectory);
    ensurePrivateDirectory(auditDirectory);
    return Object.freeze({
      // No injected dependencies: the helper and waiter paths are seams for the trust tests, and
      // production takes the fixed, validated defaults.
      lock: createKernelMutationLockManager(join(targetDirectory, 'lock')),
      backup: createOPNsenseConfigBackupService(client, backupsDirectory),
      audit: createDurableAuditSink(auditDirectory)
    });
  } catch {
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
  try {
    const parsed = loadOPNsenseConnectionConfig(configPath);
    client = createOPNsenseHttpsClient(parsed);
    const readAdapter = createOPNsenseReadAdapter(client);
    const aliasAdapter = createOPNsenseAliasAdapter(client);
    const envelope = buildMutationServices(client, parsed.url);
    const application = createApplicationContext(
      config,
      // Without the envelope's services there is no protected write, so the alias target is not
      // offered as one: the catalogue seals the writes. The target itself is still reachable, so
      // the adapter is still handed over and the alias reads keep answering — withholding the
      // writes must not cost the operator a read.
      envelope === undefined
        ? createProductCapabilityCatalog(readAdapter, aliasAdapter, false)
        : createProductCapabilityCatalog(readAdapter, aliasAdapter),
      envelope
    );
    const ownedClient = client;
    const closeClient = () => {
      ownedClient.close();
    };
    // The client is the only thing this runtime owns that must be closed. The durable state stays
    // on disk, deliberately: a shutdown that removed it would take the very backups a failed
    // mutation has to be reconciled against.
    return createOwnedApplicationRuntime(application, [closeClient]);
  } catch (error) {
    client?.close();
    throw error;
  }
}
