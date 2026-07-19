// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  closeApplicationContext,
  createApplicationContext,
  type ApplicationContext
} from './application-context.js';
import { createPhasedClose, type CloseOperation } from './shutdown.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';

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
      applicationDrain = Promise.reject(error);
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

// Product Task 5 must replace this function body, not add a parallel composition root. It must pass
// product-owned OPNsense, audit, backup, lock, and limiter service closers to the shared runtime so
// the application barrier drains admitted handlers before any service close begins.
export function createDefaultApplicationRuntime(): OwnedApplicationRuntime {
  const application = createApplicationContext(loadRuntimeConfig());
  return createOwnedApplicationRuntime(application);
}
