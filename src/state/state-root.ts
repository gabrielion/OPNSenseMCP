// SPDX-License-Identifier: AGPL-3.0-or-later
import { isAbsolute, join } from 'node:path';

export interface StateRootEnvironment {
  readonly platform: NodeJS.Platform;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly homeDir: string;
}

const UNSUPPORTED = 'Durable state is not supported on this platform';

export function resolveStateRootPath(
  override: string | undefined,
  environment: StateRootEnvironment
): string {
  // The platform gate comes first so Windows fails closed even with a configured override.
  if (environment.platform !== 'darwin' && environment.platform !== 'linux') {
    throw new Error(UNSUPPORTED);
  }
  if (override !== undefined) {
    if (!isAbsolute(override)) {
      throw new Error('OPNSENSE_MCP_STATE_DIR must be an absolute path');
    }
    return override;
  }
  if (environment.platform === 'darwin') {
    return join(environment.homeDir, 'Library', 'Application Support', 'opnsense-mcp', 'state');
  }
  const xdgStateHome = environment.env.XDG_STATE_HOME;
  if (xdgStateHome !== undefined && isAbsolute(xdgStateHome)) {
    return join(xdgStateHome, 'opnsense-mcp');
  }
  return join(environment.homeDir, '.local', 'state', 'opnsense-mcp');
}
