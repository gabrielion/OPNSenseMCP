// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApplicationContext, type ApplicationContext } from './application-context.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';

export interface OwnedApplicationRuntime {
  readonly application: ApplicationContext;
  close(): Promise<void>;
}

// Product Task 5 must replace this function body, not add a parallel composition root.
export function createDefaultApplicationRuntime(): OwnedApplicationRuntime {
  const application = createApplicationContext(loadRuntimeConfig());
  let closed = false;
  return Object.freeze({
    application,
    // eslint-disable-next-line @typescript-eslint/require-await -- Foundation owns no external service yet.
    close: async () => {
      if (closed) return;
      closed = true;
    }
  });
}
