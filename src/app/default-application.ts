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
  return Object.freeze({
    application,
    close: createPhasedClose(
      [[() => closeApplicationContext(application)], ownedServiceClosers],
      undefined,
      'Application cleanup failed'
    )
  });
}

// Product Task 5 must replace this function body, not add a parallel composition root. It must pass
// product-owned OPNsense, audit, backup, lock, and limiter service closers to the shared runtime so
// the application barrier drains admitted handlers before any service close begins.
export function createDefaultApplicationRuntime(): OwnedApplicationRuntime {
  const application = createApplicationContext(loadRuntimeConfig());
  return createOwnedApplicationRuntime(application);
}
