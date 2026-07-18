# MCP v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a safe, strictly typed MCP v2 foundation with a closed capability catalog, a minimal fail-closed policy envelope, pedagogical MCP guidance, dual-era stdio and hardened Streamable HTTP, and executable conformance evidence for MCP `2025-11-25` and draft `2026-07-28`.

**Architecture:** A transport-neutral `buildServer(context): McpServer` factory registers every primary v2 tool from one typed capability catalog and routes every call through one policy envelope. Stdio uses the dual-era `serveStdio` factory entry, HTTP uses `createMcpHandler` behind the official Node and Express adapters, and signed request state carries elicitation confirmation across protocol rounds without trusting caller booleans. One default-off compatibility module owns all deprecated v1 SSE server and transport types; it re-registers only catalog metadata and calls the same transport-neutral dispatch facade, never passing a v1 transport to a v2 server. The foundation exposes only a read-only server status capability; mutation fixtures exist only under `tests/` until backup and audit enforcement are present.

**Tech Stack:** Node.js 22.19.0, TypeScript 5.9.3 strict ESM, Zod 4.2.0, `@modelcontextprotocol/server@2.0.0-beta.4`, `@modelcontextprotocol/client@2.0.0-beta.4` for tests, `@modelcontextprotocol/node@2.0.0-beta.4`, `@modelcontextprotocol/express@2.0.0-beta.4`, isolated deprecated-SSE compatibility through `@modelcontextprotocol/sdk@1.29.0`, Express 5.2.1, Vitest 4.1.10, official MCP conformance `0.2.0-alpha.9`.

## Global Constraints

- Every project file is AGPL-3.0-or-later; every TypeScript and JavaScript source file has `// SPDX-License-Identifier: AGPL-3.0-or-later` as its first line, or as its first non-shebang line for an executable.
- Runtime and CI use Node.js `22.19.0` or newer within major 22; `package.json` rejects versions outside `>=22.19 <23`.
- The current workstation's default Node is outside the supported major. Before executing any local command block in this plan, prepend `/opt/homebrew/opt/node@22/bin` when it exists and run the version assertion in Task 1; never treat a Node 26 result as foundation evidence.
- Pin `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/node`, and `@modelcontextprotocol/express` exactly to `2.0.0-beta.4`; use no range or dist-tag.
- Pin the deprecated compatibility-only `@modelcontextprotocol/sdk` exactly to `1.29.0` when Task 7b adds it. Only `src/http/legacy-sse.ts` and its focused test may import that package; all primary MCP imports remain the official beta.4 packages above.
- Treat that beta pin as a foundation-only interoperability target. Before any public package publication, replace all four pins with the same stable MCP v2 release, regenerate the lockfile, and rerun every deterministic and conformance gate in this plan.
- Pin Zod exactly to `4.2.0`; import it as `zod/v4` and pass complete Standard Schema objects such as `z.object(...)`.
- Keep `exactOptionalPropertyTypes` enabled. When a value may be absent, omit the optional key with a conditional spread as shown in the snippets; never materialize an absent optional property with an undefined value.
- Import no symbol from `@modelcontextprotocol/core-internal`.
- `buildServer(context): McpServer` is the only primary beta.4 MCP assembly point. The sole exception is Task 7b's isolated deprecated-SSE v1 adapter, which may import only shared catalog metadata and `dispatchCapability`; capability handlers import no MCP transport type and v1 objects never cross into the v2 server.
- Stdio is the default executable path and uses `serveStdio`; Streamable HTTP uses `createMcpHandler` plus `toNodeHandler` and `createMcpExpressApp`.
- The capability catalog is closed: undeclared, hidden, disabled, transport-incompatible, and read-only-forbidden calls fail before a handler runs.
- The foundation registers no local-write or firewall-write product capability. Mutation execution remains unavailable until strict backup and audit gates are implemented in a separately reviewed plan.
- MCP instructions and prompts guide behavior but never authorize a change. Form elicitation is used only when the client advertises it, and missing support fails closed.
- Request state is HMAC-protected with the SDK `createRequestStateCodec`, expires after 300 seconds, and is bound to the MCP method plus authenticated client identity when present.
- HTTP is disabled by default, binds only to `127.0.0.1` or `localhost`, validates Host, applies an exact serialized-Origin allow-list before authentication and MCP routing, requires a 32-character bearer token, and never logs that token. Browser Origin access defaults to an empty allow-list; a configured entry includes scheme, host, and port.
- Streamable HTTP remains the primary HTTP transport. Deprecated SSE compatibility is isolated behind `MCP_LEGACY_SSE_ENABLED=true`, is off by default, and shares the same bearer, Host, exact-Origin, policy, body, request, stream, session, concurrency, and time limits.
- Source-header enforcement is available from Task 1 as `npm run license:check`. It is intentionally scoped to JavaScript and TypeScript source headers; the later provenance plan owns the release-tree/history-wide license, lineage, and forbidden-expression scan.
- Use only real Vitest 4 matchers: catch an error and apply `toMatchObject` when structured error fields are needed. For a Zod IP union use `z.union([z.ipv4(), z.ipv6()])`. Build TypeScript and execute the emitted JavaScript with Node; do not add an on-the-fly TypeScript runner.
- Conformance runs have no expected-failure baseline and must pass the four official targeted invocations named in Task 8 against the real product server; never describe that gate as full-suite conformance.
- Use TDD for each behavior-bearing task: red test, focused implementation, green test, broader regression gate, atomic commit.

---

## File Structure

Create these focused units during the tasks below:

```text
.
├── .github/workflows/ci.yml                 # Node 22.19 offline and protocol gates
├── .gitignore                               # Generated output and local secrets
├── .node-version                            # Node major used locally
├── .npmrc                                   # Exact-save and engine enforcement
├── .prettierignore                          # Generated and planning artifacts
├── AGENTS.md                                # Minimal Node, safety, and required gates
├── CLAUDE.md                                # Same repository rules for Claude workers
├── CONTRIBUTING.md                          # Foundation contributor commands
├── LICENSE                                  # Existing canonical AGPL-3.0 text; verify, never overwrite
├── README.md                                # Foundation scope and evidence boundary
├── eslint.config.js                         # Strict typed lint rules
├── package.json                             # Exact runtime and test dependencies
├── package-lock.json                        # Committed resolved dependency graph
├── prettier.config.js                       # Formatting contract
├── scripts/
│   ├── clean.mjs                            # Safe generated-output cleanup
│   ├── check-license-headers.mjs             # JS/TS SPDX header gate
│   ├── check-legacy-sse-dependency.mjs       # Release-only registry drift gate
│   └── run-conformance.mjs                  # Test-only loopback conformance host
├── src/
│   ├── app/application-context.ts           # Immutable runtime composition
│   ├── capabilities/
│   │   ├── catalog.ts                       # Closed indexed catalog
│   │   ├── dispatch.ts                      # Sole public execution facade
│   │   ├── foundation/server-status.ts      # Only product capability in this phase
│   │   └── types.ts                         # Capability and policy contracts
│   ├── config/
│   │   ├── feature-flags.ts                 # Allowed feature flag vocabulary
│   │   └── runtime-config.ts                # Secret-safe environment parsing
│   ├── entrypoints/
│   │   ├── http.ts                          # Explicit HTTP executable
│   │   └── stdio.ts                         # Default dual-era executable
│   ├── http/
│   │   ├── auth.ts                          # Constant-time bearer verification
│   │   ├── legacy-sse.ts                    # Default-off deprecated compatibility routes
│   │   ├── limits.ts                        # Body, request, stream, session, and time bounds
│   │   ├── origin.ts                        # Exact serialized-Origin middleware
│   │   └── runtime.ts                       # Hardened Express/Node adapter wiring
│   ├── index.ts                             # Public foundation exports
│   ├── main.ts                              # npm executable shim
│   ├── mcp/
│   │   ├── confirmation.ts                  # Signed elicitation round handling
│   │   ├── instructions.ts                  # Short server-wide guidance
│   │   ├── prompts.ts                       # Three discoverable user prompts
│   │   ├── register-capabilities.ts         # Catalog-to-MCP adapter
│   │   ├── results.ts                       # Safe MCP result formatting
│   │   └── server-factory.ts                # Transport-aware factory adapter
│   ├── server/
│   │   └── build-server.ts                  # Single MCP assembly function
│   └── security/
│       ├── canonical-json.ts                # Stable argument digest
│       ├── policy-envelope.ts               # Central minimal enforcement
│       └── verified-confirmation.ts         # Branded internal consent proof
├── tests/
│   ├── capabilities/catalog.test.ts
│   ├── capabilities/dispatch.test.ts
│   ├── config/runtime-config.test.ts
│   ├── fixtures/capabilities.ts
│   ├── foundation/documentation.test.ts
│   ├── foundation/package-contract.test.ts
│   ├── helpers/connect.ts
│   ├── http/runtime.test.ts
│   ├── http/legacy-sse.test.ts
│   ├── mcp/elicitation.test.ts
│   ├── mcp/factory.test.ts
│   ├── mcp/instructions.test.ts
│   ├── mcp/prompts.test.ts
│   ├── mcp/stdio.test.ts
│   └── security/policy-envelope.test.ts
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

The dependency direction is fixed:

```text
entrypoints/http ─┐
entrypoints/stdio ├─> server-factory -> build-server -> register-capabilities -> policy-envelope
tests             ┘                         │                    │
                                           prompts             catalog -> handlers
```

Capability handlers depend only on `CapabilityExecutionContext`; they never depend on `McpServer`, `ServerContext`, `Request`, Express, or a transport.

### Task 1: Bootstrap the exact Node 22.19, AGPL, and test toolchain

**Files:**
- Create: `.gitignore`
- Create: `.node-version`
- Create: `.npmrc`
- Create: `.prettierignore`
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Verify: `LICENSE` from root commit `1f809e6`; modify only in a separately reviewed licensing change if its canonical byte check ever fails
- Preserve: `docs/superpowers/specs/2026-07-17-independent-mcp-v2-rebuild-design.md` and all other already committed design records
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.build.json`
- Create: `eslint.config.js`
- Create: `prettier.config.js`
- Create: `vitest.config.ts`
- Create: `src/index.ts`
- Create: `scripts/check-license-headers.mjs`
- Create: `scripts/clean.mjs`
- Create: `tests/foundation/package-contract.test.ts`
- Create: `package-lock.json` through `npm install --package-lock-only`

**Interfaces:**
- Consumes: the exact version and license constraints in this plan.
- Produces: `npm run build`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run format:check`, `npm run license:check`, `npm run verify`, minimal repository-agent safety instructions, and exact installed MCP/test dependencies for every later task.

- [ ] **Step 1: Select and prove the supported runtime, then record the empty-foundation-scaffold red gate**

Run:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
node --version
npm --version
test -f package.json
```

Expected: the runtime assertion exits `0`; this workstation prints Node `v22.23.1` and npm `10.9.8` (another host may use any Node satisfying `>=22.19 <23`); only the final `test -f package.json` exits `1` because the foundation scaffold is absent. The already committed `LICENSE` and design documents remain untouched. Keep this selected PATH for every later local command block.

- [ ] **Step 2: Create the project metadata, repository-agent rules, and exact dependency contract**

Create `.node-version`:

```text
22.19.0
```

Create `.npmrc`:

```ini
save-exact=true
engine-strict=true
fund=false
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.env
*.log
results/
.DS_Store
```

Create `AGENTS.md`:

````markdown
# Repository agent rules

- Use Node.js 22.19.0 or newer within major 22. On the current workstation prepend `/opt/homebrew/opt/node@22/bin` to PATH; never validate with the default Node 26. Install with `npm ci --ignore-scripts`.
- Never develop or test against a production firewall. Never log, commit, or pass credentials in process arguments. Preserve unrelated changes and keep commits local and atomic.
- Before a final commit run `npm run license:check`, `npm run verify`, `npm run test:conformance`, and `git diff --check`. A task may run only its focused red/green gate before the later conformance task exists.
````

Create `CLAUDE.md`:

````markdown
# Claude repository rules

Follow `AGENTS.md`. Use Node.js 22.19.0 or newer within major 22; on the current workstation prepend `/opt/homebrew/opt/node@22/bin` and never validate with the default Node 26. Never target a production firewall or expose credentials. Preserve unrelated work.

Before a final commit run `npm run license:check`, `npm run verify`, `npm run test:conformance`, and `git diff --check`; during foundation bootstrap run the focused gates that already exist.
````

Create `package.json`:

```json
{
  "name": "@gabrielion/opnsense-mcp",
  "version": "0.1.0",
  "description": "A safety-first MCP server for OPNsense",
  "license": "AGPL-3.0-or-later",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.19 <23"
  },
  "bin": {
    "opnsense-mcp": "dist/main.js"
  },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "LICENSE",
    "README.md"
  ],
  "scripts": {
    "clean": "node scripts/clean.mjs",
    "build": "npm run clean && tsc -p tsconfig.build.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint . --max-warnings 0",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "license:check": "node scripts/check-license-headers.mjs",
    "test": "npm run build && vitest run",
    "test:watch": "vitest",
    "test:conformance:2025": "node scripts/run-conformance.mjs 2025-11-25",
    "test:conformance:2026": "node scripts/run-conformance.mjs 2026-07-28",
    "test:conformance": "npm run test:conformance:2025 && npm run test:conformance:2026",
    "verify": "npm run format:check && npm run lint && npm run typecheck && npm run license:check && npm test"
  },
  "dependencies": {
    "@modelcontextprotocol/express": "2.0.0-beta.4",
    "@modelcontextprotocol/node": "2.0.0-beta.4",
    "@modelcontextprotocol/server": "2.0.0-beta.4",
    "express": "5.2.1",
    "zod": "4.2.0"
  },
  "devDependencies": {
    "@eslint/js": "9.39.2",
    "@modelcontextprotocol/client": "2.0.0-beta.4",
    "@modelcontextprotocol/conformance": "0.2.0-alpha.9",
    "@types/express": "5.0.6",
    "@types/node": "22.20.1",
    "eslint": "9.39.2",
    "globals": "17.7.0",
    "prettier": "3.6.2",
    "typescript": "5.9.3",
    "typescript-eslint": "8.48.1",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Step 3: Verify the already committed canonical AGPL-3.0 bytes without overwriting them**

Run:

```bash
test "$(shasum -a 256 LICENSE | awk '{print $1}')" = "0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0"
test "$(wc -c < LICENSE | tr -d ' ')" = "34523"
head -n 1 LICENSE | grep -F 'GNU AFFERO GENERAL PUBLIC LICENSE'
```

Expected: all three commands exit `0`; the existing `LICENSE` remains byte-for-byte canonical. If any command fails, stop and request a separate licensing review—do not download over or otherwise replace the root license in this task.

- [ ] **Step 4: Create strict TypeScript, lint, format, and test configuration**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022", "DOM"],
    "types": ["node", "vitest/globals"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": false,
    "resolveJsonModule": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
  "exclude": ["dist", "node_modules", "coverage"]
}
```

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["tests", "dist", "node_modules"]
}
```

Create `src/index.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export {};
```

Create `eslint.config.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'results/**'] },
  { languageOptions: { globals: globals.node } },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/only-throw-error': 'error'
    }
  },
  {
    files: ['**/*.{js,mjs}'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node }
  }
);
```

Create `prettier.config.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
export default {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'none'
};
```

Create `.prettierignore`:

```text
dist/
coverage/
node_modules/
results/
LICENSE
package-lock.json
docs/superpowers/
.superpowers/
```

Create `vitest.config.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    restoreMocks: true,
    clearMocks: true
  }
});
```

Create `scripts/clean.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const generatedDirectories = ['coverage', 'dist'];

for (const directory of generatedDirectories) {
  await rm(resolve(process.cwd(), directory), { force: true, recursive: true });
}
```

Create `scripts/check-license-headers.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

const SPDX = '// SPDX-License-Identifier: AGPL-3.0-or-later';
const roots = ['scripts', 'src', 'tests'];
const rootSources = ['eslint.config.js', 'prettier.config.js', 'vitest.config.ts'];
const sourceExtensions = new Set(['.js', '.mjs', '.ts']);

async function walk(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

const files = [...rootSources];
for (const root of roots) files.push(...(await walk(root)));

const missing = [];
for (const file of files.sort()) {
  const lines = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n').split('\n');
  const headerLine = lines[0]?.startsWith('#!') ? 1 : 0;
  if (lines[headerLine] !== SPDX) missing.push(file);
}

if (missing.length > 0) {
  process.stderr.write(`Missing AGPL SPDX header:\n${missing.join('\n')}\n`);
  process.exitCode = 1;
}
```

This gate is deliberately reusable and narrow: it verifies current JavaScript and TypeScript source headers. The provenance phase later consumes it as one gate but remains solely responsible for scanning every release-tree file and the complete new Git history for license, lineage, secrets, and forbidden references.

- [ ] **Step 5: Generate and commit the exact lockfile**

Run:

```bash
npm install --package-lock-only --ignore-scripts
npm ci --ignore-scripts
```

Expected: both commands exit `0`; `package-lock.json` records each direct dependency without a range and installs `@modelcontextprotocol/server@2.0.0-beta.4`.

- [ ] **Step 6: Write the package contract test**

Create `tests/foundation/package-contract.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

interface PackageDocument {
  name: string;
  license: string;
  engines: { node: string };
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

describe('package contract', () => {
  it('pins the MCP v2 beta and AGPL foundation exactly', async () => {
    const document = JSON.parse(await readFile('package.json', 'utf8')) as PackageDocument;

    expect(document.name).toBe('@gabrielion/opnsense-mcp');
    expect(document.license).toBe('AGPL-3.0-or-later');
    expect(document.engines.node).toBe('>=22.19 <23');
    expect(document.scripts['license:check']).toBe('node scripts/check-license-headers.mjs');
    expect(document.dependencies).toMatchObject({
      '@modelcontextprotocol/server': '2.0.0-beta.4',
      '@modelcontextprotocol/node': '2.0.0-beta.4',
      '@modelcontextprotocol/express': '2.0.0-beta.4',
      zod: '4.2.0'
    });
    expect(document.devDependencies['@modelcontextprotocol/client']).toBe('2.0.0-beta.4');
    expect(document.devDependencies['@modelcontextprotocol/conformance']).toBe(
      '0.2.0-alpha.9'
    );
    expect(document.devDependencies.vitest).toBe('4.1.10');
  });

  it('contains no forbidden internal MCP dependency', async () => {
    const packageText = await readFile('package.json', 'utf8');
    const lockText = await readFile('package-lock.json', 'utf8');

    expect(packageText).not.toContain('@modelcontextprotocol/core-internal');
    expect(lockText).not.toContain('node_modules/@modelcontextprotocol/core-internal');
  });

  it('gives repository agents the minimum runtime, safety, and gate contract', async () => {
    const [agents, claude] = await Promise.all([
      readFile('AGENTS.md', 'utf8'),
      readFile('CLAUDE.md', 'utf8')
    ]);

    for (const instructions of [agents, claude]) {
      expect(instructions).toContain('Node.js 22.19.0');
      expect(instructions).toContain('production firewall');
      expect(instructions).toContain('npm run verify');
      expect(instructions).toContain('npm run test:conformance');
      expect(instructions).toContain('git diff --check');
    }
  });
});
```

- [ ] **Step 7: Run the bootstrap gate**

Run:

```bash
npx vitest run tests/foundation/package-contract.test.ts
npm run build
npm run typecheck
npm run lint
npm run format:check
npm run license:check
npm test
npm run verify
npm audit --audit-level=high
git diff --check
```

Expected: three package tests pass; build, typecheck, lint, formatting, the source-header gate, test, verify, the high-severity audit gate, and the whitespace check exit `0`.

- [ ] **Step 8: Commit the bootstrap atomically**

```bash
git add .gitignore .node-version .npmrc .prettierignore AGENTS.md CLAUDE.md \
  package.json package-lock.json \
  tsconfig.json tsconfig.build.json eslint.config.js prettier.config.js vitest.config.ts \
  src/index.ts scripts/check-license-headers.mjs scripts/clean.mjs \
  tests/foundation/package-contract.test.ts
git commit -m "chore: bootstrap AGPL MCP v2 foundation"
```

### Task 2: Parse runtime policy and secrets without leaking values

**Files:**
- Create: `src/config/feature-flags.ts`
- Create: `src/config/runtime-config.ts`
- Create: `tests/config/runtime-config.test.ts`

**Interfaces:**
- Consumes: Node.js environment data supplied as `NodeJS.ProcessEnv`.
- Produces: `FeatureFlag`, `RuntimeConfig`, and `loadRuntimeConfig(env?: NodeJS.ProcessEnv): RuntimeConfig` for the catalog, policy envelope, request-state codec, and HTTP entry.

- [ ] **Step 1: Write the failing runtime configuration tests**

Create `tests/config/runtime-config.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';

describe('loadRuntimeConfig', () => {
  it('defaults to read-only stdio with a private ephemeral request-state key', () => {
    const config = loadRuntimeConfig({});

    expect(config.readOnly).toBe(true);
    expect(config.http.enabled).toBe(false);
    expect(config.http.host).toBe('127.0.0.1');
    expect(config.http.allowedOrigins).toEqual([]);
    expect(config.http.legacySseEnabled).toBe(false);
    expect(config.requestStateKey).toBeInstanceOf(Uint8Array);
    expect(config.requestStateKey).toHaveLength(32);
    expect(config.allowedResourceScopes).toBeNull();
    expect(config.enabledFeatureFlags.size).toBe(0);
  });

  it('parses explicit policy lists and a supplied request-state key', () => {
    const config = loadRuntimeConfig({
      READ_ONLY: 'false',
      ALLOWED_RESOURCES: 'firewall.rule, dns.host,firewall.rule',
      ENABLED_FEATURE_FLAGS: 'advanced-api,ssh',
      MCP_ALLOWED_ORIGINS: 'https://console.example:8443',
      MCP_REQUEST_STATE_SECRET: '0123456789abcdef0123456789abcdef'
    });

    expect(config.readOnly).toBe(false);
    expect(config.allowedResourceScopes).toEqual(new Set(['firewall.rule', 'dns.host']));
    expect(config.enabledFeatureFlags).toEqual(new Set(['advanced-api', 'ssh']));
    expect(config.http.allowedOrigins).toEqual(['https://console.example:8443']);
    expect(new TextDecoder().decode(config.requestStateKey)).toBe(
      '0123456789abcdef0123456789abcdef'
    );
  });

  it('requires authentication whenever HTTP is enabled', () => {
    expect(() => loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true' })).toThrow(
      'Invalid runtime configuration: MCP_HTTP_TOKEN'
    );
  });

  it('never includes a supplied secret in an error', () => {
    const secret = 'short-secret';

    expect(() =>
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: secret })
    ).toThrow('Invalid runtime configuration: MCP_HTTP_TOKEN');

    try {
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });

  it('rejects unknown feature flags and non-loopback HTTP hosts', () => {
    expect(() => loadRuntimeConfig({ ENABLED_FEATURE_FLAGS: 'unknown' })).toThrow(
      'Invalid runtime configuration: ENABLED_FEATURE_FLAGS'
    );
    expect(() => loadRuntimeConfig({ MCP_HTTP_HOST: '0.0.0.0' })).toThrow(
      'Invalid runtime configuration: MCP_HTTP_HOST'
    );
  });

  it('requires exact serialized HTTP origins and rejects opaque or malformed values', () => {
    for (const origin of [
      'null',
      'not-an-origin',
      'https://console.example/',
      'https://console.example:443'
    ]) {
      expect(() => loadRuntimeConfig({ MCP_ALLOWED_ORIGINS: origin })).toThrow(
        'Invalid runtime configuration: MCP_ALLOWED_ORIGINS'
      );
    }
  });

  it('does not enable deprecated SSE independently of hardened HTTP', () => {
    expect(() => loadRuntimeConfig({ MCP_LEGACY_SSE_ENABLED: 'true' })).toThrow(
      'Invalid runtime configuration: MCP_LEGACY_SSE_ENABLED'
    );
  });
});
```

- [ ] **Step 2: Run the tests and verify the red state**

Run:

```bash
npx vitest run tests/config/runtime-config.test.ts
```

Expected: FAIL because `src/config/runtime-config.ts` does not exist.

- [ ] **Step 3: Define the feature flag vocabulary**

Create `src/config/feature-flags.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';

export const FeatureFlagSchema = z.enum(['advanced-api', 'restore', 'shell', 'ssh']);

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;
```

- [ ] **Step 4: Implement secret-safe environment parsing**

Create `src/config/runtime-config.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { randomBytes } from 'node:crypto';
import * as z from 'zod/v4';
import { FeatureFlagSchema, type FeatureFlag } from './feature-flags.js';

const BooleanTextSchema = z.enum(['true', 'false']).transform((value) => value === 'true');

const CsvSchema = z.string().transform((value) => {
  return [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
});

function isSerializedHttpOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

const SerializedOriginSchema = z
  .string()
  .refine(isSerializedHttpOrigin, 'must be an exact serialized HTTP Origin');
const OriginCsvSchema = CsvSchema.pipe(z.array(SerializedOriginSchema));

const EnvironmentSchema = z
  .object({
    READ_ONLY: BooleanTextSchema.prefault('true'),
    ALLOWED_RESOURCES: CsvSchema.prefault(''),
    ENABLED_FEATURE_FLAGS: CsvSchema.prefault(''),
    MCP_HTTP_ENABLED: BooleanTextSchema.prefault('false'),
    MCP_LEGACY_SSE_ENABLED: BooleanTextSchema.prefault('false'),
    MCP_HTTP_HOST: z.enum(['127.0.0.1', 'localhost']).default('127.0.0.1'),
    MCP_HTTP_PORT: z.coerce.number().int().min(1024).max(65_535).default(3000),
    MCP_HTTP_TOKEN: z.string().min(32).optional(),
    MCP_ALLOWED_HOSTS: CsvSchema.prefault('127.0.0.1,localhost,[::1]'),
    MCP_ALLOWED_ORIGINS: OriginCsvSchema.prefault(''),
    MCP_REQUEST_STATE_SECRET: z.string().min(32).optional()
  })
  .superRefine((value, context) => {
    if (value.MCP_HTTP_ENABLED && value.MCP_HTTP_TOKEN === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'required when MCP_HTTP_ENABLED=true',
        path: ['MCP_HTTP_TOKEN']
      });
    }

    if (value.MCP_LEGACY_SSE_ENABLED && !value.MCP_HTTP_ENABLED) {
      context.addIssue({
        code: 'custom',
        message: 'requires MCP_HTTP_ENABLED=true',
        path: ['MCP_LEGACY_SSE_ENABLED']
      });
    }

    for (const flag of value.ENABLED_FEATURE_FLAGS) {
      if (!FeatureFlagSchema.safeParse(flag).success) {
        context.addIssue({
          code: 'custom',
          message: 'unknown feature flag',
          path: ['ENABLED_FEATURE_FLAGS']
        });
      }
    }
  });

export interface RuntimeConfig {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
  readonly requestStateKey: Uint8Array;
  readonly http: {
    readonly enabled: boolean;
    readonly host: '127.0.0.1' | 'localhost';
    readonly port: number;
    readonly allowedHosts: readonly string[];
    readonly allowedOrigins: readonly string[];
    readonly legacySseEnabled: boolean;
    readonly token?: string;
  };
}

function configurationError(error: z.ZodError): Error {
  const paths = [...new Set(error.issues.map((issue) => issue.path.join('.') || 'environment'))];
  return new Error(`Invalid runtime configuration: ${paths.join(', ')}`);
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = EnvironmentSchema.safeParse(env);
  if (!parsed.success) {
    throw configurationError(parsed.error);
  }

  const featureFlags = parsed.data.ENABLED_FEATURE_FLAGS.map((flag) =>
    FeatureFlagSchema.parse(flag)
  );
  const requestStateKey = parsed.data.MCP_REQUEST_STATE_SECRET
    ? new TextEncoder().encode(parsed.data.MCP_REQUEST_STATE_SECRET)
    : Uint8Array.from(randomBytes(32));

  return {
    readOnly: parsed.data.READ_ONLY,
    allowedResourceScopes:
      parsed.data.ALLOWED_RESOURCES.length === 0
        ? null
        : new Set(parsed.data.ALLOWED_RESOURCES),
    enabledFeatureFlags: new Set<FeatureFlag>(featureFlags),
    requestStateKey,
    http: {
      enabled: parsed.data.MCP_HTTP_ENABLED,
      host: parsed.data.MCP_HTTP_HOST,
      port: parsed.data.MCP_HTTP_PORT,
      allowedHosts: parsed.data.MCP_ALLOWED_HOSTS,
      allowedOrigins: parsed.data.MCP_ALLOWED_ORIGINS,
      legacySseEnabled: parsed.data.MCP_LEGACY_SSE_ENABLED,
      ...(parsed.data.MCP_HTTP_TOKEN === undefined
        ? {}
        : { token: parsed.data.MCP_HTTP_TOKEN })
    }
  };
}
```

- [ ] **Step 5: Run focused and static gates**

Run:

```bash
npx vitest run tests/config/runtime-config.test.ts
npm run typecheck
npm run lint
```

Expected: seven configuration tests pass; typecheck and lint exit `0`; browser Origin access defaults to an empty list, configured origins remain exact serialized values, deprecated SSE cannot be enabled without HTTP, and no error text contains a supplied secret.

- [ ] **Step 6: Commit runtime configuration atomically**

```bash
git add src/config/feature-flags.ts src/config/runtime-config.ts \
  tests/config/runtime-config.test.ts
git commit -m "feat: add fail-closed runtime configuration"
```

### Task 3: Create the closed capability catalog and read-only status capability

**Files:**
- Create: `src/capabilities/types.ts`
- Create: `src/capabilities/catalog.ts`
- Create: `src/capabilities/foundation/server-status.ts`
- Create: `tests/fixtures/capabilities.ts`
- Create: `tests/capabilities/catalog.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `FeatureFlag` from `src/config/feature-flags.ts`.
- Produces: `defineCapability`, `CapabilityDefinition`, `CapabilityCatalog`, `CapabilityExecutionContext`, `CAPABILITY_CATALOG`, `getCapability(name)`, and the stable MCP tool name `server_status`.

- [ ] **Step 1: Write catalog and exposure tests first**

Create `tests/fixtures/capabilities.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { defineCapability } from '../../src/capabilities/types.js';

export function createReadFixture() {
  return defineCapability({
    id: 'test.read',
    mcpName: 'test_read',
    title: 'Test read',
    description: 'Return a test value without changing state.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ echoed: z.string() }).strict(),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'read',
      resourceScopes: ['test.read'],
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'none',
      timeoutMs: 1000,
      redactFields: []
    },
    handler: ({ value }) => Promise.resolve({ echoed: value })
  });
}

export function createMutationFixture(onCall: () => void = () => undefined) {
  return defineCapability({
    id: 'test.write',
    mcpName: 'test_write',
    title: 'Test write',
    description: 'Exercise the confirmation boundary using process-local test state.',
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ accepted: z.string() }).strict(),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    transports: ['stdio', 'http'],
    policy: {
      effect: 'local-write',
      resourceScopes: ['test.write'],
      requiredFeatureFlags: [],
      backup: 'none',
      audit: 'none',
      confirmation: 'elicitation',
      timeoutMs: 1000,
      redactFields: []
    },
    handler: ({ value }) => {
      onCall();
      return Promise.resolve({ accepted: value });
    }
  });
}
```

Create `tests/capabilities/catalog.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_CATALOG,
  CapabilityCatalog,
  getCapability
} from '../../src/capabilities/catalog.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';

describe('CapabilityCatalog', () => {
  it('indexes stable IDs and MCP names', () => {
    const read = createReadFixture();
    const catalog = new CapabilityCatalog([read]);

    expect(catalog.getById('test.read')).toBe(read);
    expect(catalog.getByMcpName('test_read')).toBe(read);
    expect(catalog.getByMcpName('missing')).toBeUndefined();
  });

  it('rejects duplicate IDs and duplicate MCP names', () => {
    const read = createReadFixture();
    const duplicateName = { ...createMutationFixture(), mcpName: read.mcpName };

    expect(() => new CapabilityCatalog([read, read])).toThrow('Duplicate capability id: test.read');
    expect(() => new CapabilityCatalog([read, duplicateName])).toThrow(
      'Duplicate MCP capability name: test_read'
    );
  });

  it('freezes the catalog instance after constructing its indexes', () => {
    const catalog = new CapabilityCatalog([createReadFixture()]);
    const all = catalog.all;

    expect(Object.isFrozen(catalog)).toBe(true);
    expect(Reflect.set(catalog, 'all', [])).toBe(false);
    expect(catalog.all).toBe(all);
  });

  it('hides writes in read-only mode and keeps direct metadata immutable', () => {
    const read = createReadFixture();
    const write = createMutationFixture();
    const catalog = new CapabilityCatalog([read, write]);

    const exposed = catalog.listExposed({
      readOnly: true,
      transport: 'stdio',
      enabledFeatureFlags: new Set(),
      allowedResourceScopes: null
    });

    expect(exposed).toEqual([read]);
    expect(Object.isFrozen(exposed)).toBe(true);
    expect(Object.isFrozen(catalog.all)).toBe(true);
    expect(Object.isFrozen(read)).toBe(true);
    expect(Object.isFrozen(read.annotations)).toBe(true);
    expect(Object.isFrozen(read.policy)).toBe(true);
    expect(Object.isFrozen(read.policy.resourceScopes)).toBe(true);
  });

  it('filters capabilities unavailable on the selected transport', () => {
    const read = createReadFixture();
    const httpOnly = { ...read, transports: ['http'] as const };
    const catalog = new CapabilityCatalog([httpOnly]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: null
      })
    ).toEqual([]);
  });

  it('filters capabilities whose feature flags are disabled', () => {
    const read = createReadFixture();
    const sshOnly = {
      ...read,
      policy: { ...read.policy, requiredFeatureFlags: ['ssh'] as const }
    };
    const catalog = new CapabilityCatalog([sshOnly]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: null
      })
    ).toEqual([]);
  });

  it('filters capabilities outside the active resource scope allow-list', () => {
    const read = createReadFixture();
    const restricted = {
      ...read,
      policy: { ...read.policy, resourceScopes: ['restricted'] as const }
    };
    const catalog = new CapabilityCatalog([restricted]);

    expect(
      catalog.listExposed({
        readOnly: false,
        transport: 'stdio',
        enabledFeatureFlags: new Set(),
        allowedResourceScopes: new Set(['test.read'])
      })
    ).toEqual([]);
  });

  it('ships only the read-only server status capability', () => {
    expect(CAPABILITY_CATALOG.all.map((capability) => capability.mcpName)).toEqual([
      'server_status'
    ]);
    expect(getCapability('server_status')?.policy.effect).toBe('read');
    expect(getCapability('missing')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the catalog tests and verify the red state**

Run:

```bash
npx vitest run tests/capabilities/catalog.test.ts
```

Expected: FAIL because the capability modules do not exist.

- [ ] **Step 3: Define the transport-neutral capability contracts**

Create `src/capabilities/types.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';
import type { FeatureFlag } from '../config/feature-flags.js';

export type TransportKind = 'stdio' | 'http';
export type CapabilityEffect = 'read' | 'local-write' | 'firewall-write';
export type BackupPolicy = 'none' | 'strict';
export type AuditPolicy = 'none' | 'required';
export type ConfirmationPolicy = 'none' | 'elicitation';

export interface CapabilityExecutionContext {
  readonly signal: AbortSignal;
  readonly readOnly: boolean;
  readonly transport: TransportKind;
  readonly principalId?: string;
}

export interface CapabilityPolicy {
  readonly effect: CapabilityEffect;
  readonly resourceScopes: readonly string[];
  readonly requiredFeatureFlags: readonly FeatureFlag[];
  readonly backup: BackupPolicy;
  readonly audit: AuditPolicy;
  readonly confirmation: ConfirmationPolicy;
  readonly timeoutMs: number;
  readonly redactFields: readonly string[];
}

export interface CapabilityDefinition {
  readonly id: string;
  readonly mcpName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType;
  readonly outputSchema: z.ZodType;
  readonly annotations: ToolAnnotations;
  readonly transports: readonly TransportKind[];
  readonly policy: CapabilityPolicy;
  readonly parseInput: (value: unknown) => unknown;
  readonly parseOutput: (value: unknown) => Record<string, unknown>;
}

const capabilityHandlers = new WeakMap<
  CapabilityDefinition,
  (input: unknown, context: CapabilityExecutionContext) => Promise<unknown>
>();

interface TypedCapabilityDefinition<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
> {
  readonly id: string;
  readonly mcpName: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly outputSchema: z.ZodType<TOutput>;
  readonly annotations: ToolAnnotations;
  readonly transports: readonly TransportKind[];
  readonly policy: CapabilityPolicy;
  readonly handler: (
    input: TInput,
    context: CapabilityExecutionContext
  ) => Promise<TOutput>;
}

export function defineCapability<
  TInput extends Record<string, unknown>,
  TOutput extends Record<string, unknown>
>(definition: TypedCapabilityDefinition<TInput, TOutput>): CapabilityDefinition {
  const capability: CapabilityDefinition = Object.freeze({
    id: definition.id,
    mcpName: definition.mcpName,
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: Object.freeze({ ...definition.annotations }),
    transports: Object.freeze([...definition.transports]),
    policy: Object.freeze({
      ...definition.policy,
      resourceScopes: Object.freeze([...definition.policy.resourceScopes]),
      requiredFeatureFlags: Object.freeze([...definition.policy.requiredFeatureFlags]),
      redactFields: Object.freeze([...definition.policy.redactFields])
    }),
    parseInput: (value: unknown) => definition.inputSchema.parse(value),
    parseOutput: (value: unknown) => definition.outputSchema.parse(value)
  });
  capabilityHandlers.set(capability, (input, context) =>
    definition.handler(input as TInput, context)
  );
  return capability;
}

export function invokeCapabilityHandler(
  capability: CapabilityDefinition,
  input: unknown,
  context: CapabilityExecutionContext
): Promise<unknown> {
  const handler = capabilityHandlers.get(capability);
  if (handler === undefined) return Promise.reject(new Error('Undeclared capability handler'));
  return handler(input, context);
}

export interface ExposureContext {
  readonly readOnly: boolean;
  readonly transport: TransportKind;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
}
```

- [ ] **Step 4: Implement the closed catalog**

Create `src/capabilities/catalog.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CapabilityDefinition, ExposureContext } from './types.js';
import { serverStatusCapability } from './foundation/server-status.js';

function isExposed(capability: CapabilityDefinition, context: ExposureContext): boolean {
  if (!capability.transports.includes(context.transport)) return false;
  if (context.readOnly && capability.policy.effect !== 'read') return false;
  if (
    capability.policy.requiredFeatureFlags.some(
      (flag) => !context.enabledFeatureFlags.has(flag)
    )
  ) {
    return false;
  }
  if (
    context.allowedResourceScopes !== null &&
    capability.policy.resourceScopes.some(
      (resource) => !context.allowedResourceScopes?.has(resource)
    )
  ) {
    return false;
  }
  return true;
}

export class CapabilityCatalog {
  readonly all: readonly CapabilityDefinition[];
  readonly #byId = new Map<string, CapabilityDefinition>();
  readonly #byMcpName = new Map<string, CapabilityDefinition>();

  constructor(definitions: readonly CapabilityDefinition[]) {
    for (const definition of definitions) {
      if (this.#byId.has(definition.id)) {
        throw new Error(`Duplicate capability id: ${definition.id}`);
      }
      if (this.#byMcpName.has(definition.mcpName)) {
        throw new Error(`Duplicate MCP capability name: ${definition.mcpName}`);
      }
      this.#byId.set(definition.id, definition);
      this.#byMcpName.set(definition.mcpName, definition);
    }
    this.all = Object.freeze([...definitions]);
    Object.freeze(this);
  }

  getById(id: string): CapabilityDefinition | undefined {
    return this.#byId.get(id);
  }

  getByMcpName(name: string): CapabilityDefinition | undefined {
    return this.#byMcpName.get(name);
  }

  listExposed(context: ExposureContext): readonly CapabilityDefinition[] {
    return Object.freeze(this.all.filter((capability) => isExposed(capability, context)));
  }
}

export const CAPABILITY_CATALOG = new CapabilityCatalog([serverStatusCapability]);

export function getCapability(name: string): CapabilityDefinition | undefined {
  return CAPABILITY_CATALOG.getByMcpName(name);
}
```

- [ ] **Step 5: Add the only foundation product capability**

Create `src/capabilities/foundation/server-status.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { defineCapability } from '../types.js';

export const serverStatusCapability = defineCapability({
  id: 'server.status',
  mcpName: 'server_status',
  title: 'Server status',
  description: 'Report whether the MCP server is healthy and operating in read-only mode.',
  inputSchema: z.object({}).strict(),
  outputSchema: z
    .object({
      status: z.literal('ok'),
      readOnly: z.boolean(),
      version: z.literal('0.1.0')
    })
    .strict(),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  },
  transports: ['stdio', 'http'],
  policy: {
    effect: 'read',
    resourceScopes: ['server.status'],
    requiredFeatureFlags: [],
    backup: 'none',
    audit: 'none',
    confirmation: 'none',
    timeoutMs: 1000,
    redactFields: []
  },
  handler: (_input, context) =>
    Promise.resolve({
      status: 'ok' as const,
      readOnly: context.readOnly,
      version: '0.1.0' as const
    })
});
```

Create `src/index.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export { CapabilityCatalog } from './capabilities/catalog.js';
export { CAPABILITY_CATALOG, getCapability } from './capabilities/catalog.js';
export type {
  CapabilityDefinition,
  CapabilityExecutionContext,
  CapabilityPolicy,
  TransportKind
} from './capabilities/types.js';
export { loadRuntimeConfig } from './config/runtime-config.js';
export type { RuntimeConfig } from './config/runtime-config.js';
```

- [ ] **Step 6: Run catalog and regression gates**

Run:

```bash
npx vitest run tests/capabilities/catalog.test.ts tests/config/runtime-config.test.ts
npm run typecheck
npm run lint
```

Expected: fifteen focused tests pass; typecheck and lint exit `0`. The catalog instance and every
`listExposed()` result are frozen at runtime; the focused catalog tests cover read-only, transport,
feature-flag, and resource-scope exposure filters.

- [ ] **Step 7: Commit the catalog atomically**

```bash
git add src/capabilities src/index.ts tests/capabilities tests/fixtures/capabilities.ts
git commit -m "feat: add closed capability catalog"
```

### Task 4: Enforce the minimal policy envelope before every handler

**Files:**
- Create: `src/capabilities/dispatch.ts`
- Create: `src/security/canonical-json.ts`
- Create: `src/security/verified-confirmation.ts`
- Create: `src/security/policy-envelope.ts`
- Create: `tests/security/policy-envelope.test.ts`
- Create: `tests/capabilities/dispatch.test.ts`
- Modify: `src/capabilities/types.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `CapabilityCatalog`, `CapabilityDefinition`, `RuntimeConfig`, and `TransportKind`.
- Produces: `PolicyEnvelope`, `DispatchRequest`, `DispatchOutcome`, `CapabilityRequest`,
  `CapabilityResult`, `ServerContext`, `VerifiedConfirmation`,
  `verifiedConfirmationFromAdapter()`, `sha256Json()`, and the sole public execution facade
  `dispatchCapability(request, context)` for every adapter.

- [ ] **Step 1: Write adversarial policy tests before implementation**

Create `tests/security/policy-envelope.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import * as z from 'zod/v4';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { defineCapability } from '../../src/capabilities/types.js';
import { PolicyEnvelope } from '../../src/security/policy-envelope.js';
import {
  verifiedConfirmationFromAdapter,
  type VerifiedConfirmation
} from '../../src/security/verified-confirmation.js';
import { createMutationFixture, createReadFixture } from '../fixtures/capabilities.js';

function envelope(
  catalog: CapabilityCatalog,
  options: {
    readOnly?: boolean;
    allowedResourceScopes?: ReadonlySet<string> | null;
  } = {}
) {
  return new PolicyEnvelope(catalog, {
    readOnly: options.readOnly ?? true,
    allowedResourceScopes: options.allowedResourceScopes ?? null,
    enabledFeatureFlags: new Set()
  });
}

describe('PolicyEnvelope', () => {
  it('validates input and output around a declared read handler', async () => {
    const policy = envelope(new CapabilityCatalog([createReadFixture()]));

    await expect(
      policy.dispatch({ mcpName: 'test_read', rawInput: { value: 'safe' }, transport: 'stdio' })
    ).resolves.toEqual({ kind: 'success', output: { echoed: 'safe' } });

    await expect(
      policy.dispatch({ mcpName: 'test_read', rawInput: { value: 4 }, transport: 'stdio' })
    ).resolves.toMatchObject({ kind: 'refused', code: 'INVALID_INPUT' });
  });

  it('refuses unknown and forged hidden calls before a handler runs', async () => {
    const handler = vi.fn();
    const write = createMutationFixture(handler);
    const policy = envelope(new CapabilityCatalog([write]), { readOnly: true });

    await expect(
      policy.dispatch({ mcpName: 'missing', rawInput: {}, transport: 'stdio' })
    ).resolves.toMatchObject({ kind: 'refused', code: 'UNKNOWN_CAPABILITY' });
    await expect(
      policy.dispatch({ mcpName: 'test_write', rawInput: { value: 'x' }, transport: 'stdio' })
    ).resolves.toMatchObject({ kind: 'refused', code: 'READ_ONLY' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('requires a verified digest instead of a caller confirmation boolean', async () => {
    const handler = vi.fn();
    const policy = envelope(new CapabilityCatalog([createMutationFixture(handler)]), {
      readOnly: false
    });

    const first = await policy.dispatch({
      mcpName: 'test_write',
      rawInput: { value: 'approved' },
      transport: 'stdio'
    });
    expect(first).toMatchObject({ kind: 'confirmation-required', capabilityId: 'test.write' });
    expect(handler).not.toHaveBeenCalled();
    if (first.kind !== 'confirmation-required') throw new Error('Expected confirmation request');

    const forgedShape = {
      capabilityId: first.capabilityId,
      argumentsSha256: first.argumentsSha256
    } as unknown as VerifiedConfirmation;
    await expect(
      policy.dispatch({
        mcpName: 'test_write',
        rawInput: { value: 'approved' },
        transport: 'stdio',
        confirmation: forgedShape
      })
    ).resolves.toMatchObject({ kind: 'refused', code: 'CONFIRMATION_INVALID' });
    expect(handler).not.toHaveBeenCalled();

    const forged = verifiedConfirmationFromAdapter('test.write', 'wrong-digest');
    await expect(
      policy.dispatch({
        mcpName: 'test_write',
        rawInput: { value: 'approved' },
        transport: 'stdio',
        confirmation: forged
      })
    ).resolves.toMatchObject({ kind: 'refused', code: 'CONFIRMATION_INVALID' });
    expect(handler).not.toHaveBeenCalled();

    const verified = verifiedConfirmationFromAdapter(first.capabilityId, first.argumentsSha256);
    await expect(
      policy.dispatch({
        mcpName: 'test_write',
        rawInput: { value: 'approved' },
        transport: 'stdio',
        confirmation: verified
      })
    ).resolves.toEqual({ kind: 'success', output: { accepted: 'approved' } });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('enforces resource allow-lists at direct dispatch', async () => {
    const policy = envelope(new CapabilityCatalog([createReadFixture()]), {
      allowedResourceScopes: new Set(['different.scope'])
    });

    await expect(
      policy.dispatch({ mcpName: 'test_read', rawInput: { value: 'x' }, transport: 'stdio' })
    ).resolves.toMatchObject({ kind: 'refused', code: 'RESOURCE_NOT_ALLOWED' });
  });

  it('bounds execution time and sanitizes handler failures', async () => {
    const slow = defineCapability({
      id: 'test.slow',
      mcpName: 'test_slow',
      title: 'Slow test',
      description: 'Wait beyond the declared timeout.',
      inputSchema: z.object({}).strict(),
      outputSchema: z.object({ complete: z.boolean() }).strict(),
      annotations: { readOnlyHint: true },
      transports: ['stdio'],
      policy: {
        effect: 'read',
        resourceScopes: ['test.slow'],
        requiredFeatureFlags: [],
        backup: 'none',
        audit: 'none',
        confirmation: 'none',
        timeoutMs: 5,
        redactFields: []
      },
      handler: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        throw new Error('sensitive downstream detail');
      }
    });
    const policy = envelope(new CapabilityCatalog([slow]));
    const outcome = await policy.dispatch({ mcpName: 'test_slow', rawInput: {}, transport: 'stdio' });

    expect(outcome).toMatchObject({ kind: 'refused', code: 'TIMEOUT' });
    expect(JSON.stringify(outcome)).not.toContain('sensitive downstream detail');
  });
});
```

- [ ] **Step 2: Run the policy tests and verify the red state**

Run:

```bash
npx vitest run tests/security/policy-envelope.test.ts
```

Expected: FAIL because the security modules do not exist.

- [ ] **Step 3: Add deterministic argument hashing**

Create `src/security/canonical-json.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from 'node:crypto';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalize(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Only plain JSON objects can be canonicalized');
    }
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }
  throw new TypeError('Value is not canonical JSON');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function sha256Json(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
```

- [ ] **Step 4: Define the branded adapter-only confirmation value**

Create `src/security/verified-confirmation.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
const verifiedConfirmationBrand: unique symbol = Symbol('verified-confirmation');
const verifiedConfirmations = new WeakSet<object>();

export interface VerifiedConfirmation {
  readonly capabilityId: string;
  readonly argumentsSha256: string;
  readonly [verifiedConfirmationBrand]: true;
}

export function verifiedConfirmationFromAdapter(
  capabilityId: string,
  argumentsSha256: string
): VerifiedConfirmation {
  const confirmation: VerifiedConfirmation = Object.freeze({
    capabilityId,
    argumentsSha256,
    [verifiedConfirmationBrand]: true as const
  });
  verifiedConfirmations.add(confirmation);
  return confirmation;
}

export function isVerifiedConfirmation(value: unknown): value is VerifiedConfirmation {
  return typeof value === 'object' && value !== null && verifiedConfirmations.has(value);
}
```

- [ ] **Step 5: Implement the central policy envelope**

Create `src/security/policy-envelope.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CapabilityCatalog } from '../capabilities/catalog.js';
import type {
  CapabilityDefinition,
  CapabilityExecutionContext,
  TransportKind
} from '../capabilities/types.js';
import { invokeCapabilityHandler } from '../capabilities/types.js';
import type { FeatureFlag } from '../config/feature-flags.js';
import { sha256Json } from './canonical-json.js';
import {
  isVerifiedConfirmation,
  type VerifiedConfirmation
} from './verified-confirmation.js';

export type RefusalCode =
  | 'CANCELLED'
  | 'CONFIRMATION_INVALID'
  | 'EXECUTION_FAILED'
  | 'FEATURE_DISABLED'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'READ_ONLY'
  | 'RESOURCE_NOT_ALLOWED'
  | 'TIMEOUT'
  | 'UNKNOWN_CAPABILITY'
  | 'UNSUPPORTED_TRANSPORT';

export type DispatchOutcome =
  | { readonly kind: 'success'; readonly output: Record<string, unknown> }
  | {
      readonly kind: 'confirmation-required';
      readonly capability: CapabilityDefinition;
      readonly capabilityId: string;
      readonly argumentsSha256: string;
    }
  | {
      readonly kind: 'refused';
      readonly code: RefusalCode;
      readonly message: string;
    };

export interface DispatchRequest {
  readonly mcpName: string;
  readonly rawInput: unknown;
  readonly transport: TransportKind;
  readonly principalId?: string;
  readonly signal?: AbortSignal;
  readonly confirmation?: VerifiedConfirmation;
}

export interface PolicyEnvelopeOptions {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
}

function refused(code: RefusalCode, message: string): DispatchOutcome {
  return { kind: 'refused', code, message };
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = () =>
    signal.reason instanceof Error ? signal.reason : new Error('Capability operation aborted');
  if (signal.aborted) throw abortError();
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export class PolicyEnvelope {
  constructor(
    readonly catalog: CapabilityCatalog,
    readonly options: PolicyEnvelopeOptions
  ) {}

  listExposed(transport: TransportKind): readonly CapabilityDefinition[] {
    return this.catalog.listExposed({
      readOnly: this.options.readOnly,
      transport,
      enabledFeatureFlags: this.options.enabledFeatureFlags,
      allowedResourceScopes: this.options.allowedResourceScopes
    });
  }

  async dispatch(request: DispatchRequest): Promise<DispatchOutcome> {
    const capability = this.catalog.getByMcpName(request.mcpName);
    if (capability === undefined) {
      return refused('UNKNOWN_CAPABILITY', 'The requested capability is not declared.');
    }
    if (!capability.transports.includes(request.transport)) {
      return refused('UNSUPPORTED_TRANSPORT', 'The capability is unavailable on this transport.');
    }
    if (this.options.readOnly && capability.policy.effect !== 'read') {
      return refused('READ_ONLY', 'The server is operating in read-only mode.');
    }
    if (
      capability.policy.requiredFeatureFlags.some(
        (flag) => !this.options.enabledFeatureFlags.has(flag)
      )
    ) {
      return refused('FEATURE_DISABLED', 'A required feature is disabled.');
    }
    if (
      this.options.allowedResourceScopes !== null &&
      capability.policy.resourceScopes.some(
        (resource) => !this.options.allowedResourceScopes?.has(resource)
      )
    ) {
      return refused('RESOURCE_NOT_ALLOWED', 'The capability is outside the resource allow-list.');
    }

    let normalizedInput: unknown;
    try {
      normalizedInput = capability.parseInput(request.rawInput);
    } catch {
      return refused('INVALID_INPUT', 'The capability arguments are invalid.');
    }

    const argumentsSha256 = sha256Json(normalizedInput);
    if (capability.policy.confirmation === 'elicitation') {
      if (request.confirmation === undefined) {
        return {
          kind: 'confirmation-required',
          capability,
          capabilityId: capability.id,
          argumentsSha256
        };
      }
      if (
        !isVerifiedConfirmation(request.confirmation) ||
        request.confirmation.capabilityId !== capability.id ||
        request.confirmation.argumentsSha256 !== argumentsSha256
      ) {
        return refused('CONFIRMATION_INVALID', 'The confirmation does not match this request.');
      }
    }

    const timeoutSignal = AbortSignal.timeout(capability.policy.timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeoutSignal])
      : timeoutSignal;
    const executionContext: CapabilityExecutionContext = {
      signal,
      readOnly: this.options.readOnly,
      transport: request.transport,
      ...(request.principalId === undefined ? {} : { principalId: request.principalId })
    };

    try {
      const rawOutput = await raceWithAbort(
        invokeCapabilityHandler(capability, normalizedInput, executionContext),
        signal
      );
      try {
        return { kind: 'success', output: capability.parseOutput(rawOutput) };
      } catch {
        return refused('INVALID_OUTPUT', 'The capability returned an invalid result.');
      }
    } catch {
      if (timeoutSignal.aborted) {
        return refused('TIMEOUT', 'The capability exceeded its execution timeout.');
      }
      if (request.signal?.aborted) {
        return refused('CANCELLED', 'The capability call was cancelled.');
      }
      return refused('EXECUTION_FAILED', 'The capability could not complete safely.');
    }
  }
}
```

- [ ] **Step 6: Add and test the sole public dispatch facade**

Now that the policy and confirmation modules exist, add these type-only imports to
`src/capabilities/types.ts`:

```ts
import type { CapabilityCatalog } from './catalog.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import type { DispatchOutcome, PolicyEnvelope } from '../security/policy-envelope.js';
import type { VerifiedConfirmation } from '../security/verified-confirmation.js';
```

Append the adapter request/context contracts to that file:

```ts
export interface CapabilityRequest {
  readonly name: string;
  readonly arguments: unknown;
}

export type CapabilityResult = DispatchOutcome;

export interface ServerContext {
  readonly config: RuntimeConfig;
  readonly catalog: CapabilityCatalog;
  readonly policy: PolicyEnvelope;
  readonly transport: TransportKind;
  readonly signal?: AbortSignal;
  readonly principalId?: string;
  readonly confirmation?: VerifiedConfirmation;
}
```

Create `src/capabilities/dispatch.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
  CapabilityRequest,
  CapabilityResult,
  ServerContext
} from './types.js';

export function dispatchCapability(
  request: CapabilityRequest,
  context: ServerContext
): Promise<CapabilityResult> {
  return context.policy.dispatch({
    mcpName: request.name,
    rawInput: request.arguments,
    transport: context.transport,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.principalId === undefined ? {} : { principalId: context.principalId }),
    ...(context.confirmation === undefined ? {} : { confirmation: context.confirmation })
  });
}
```

Create `tests/capabilities/dispatch.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it, vi } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { PolicyEnvelope } from '../../src/security/policy-envelope.js';
import { createMutationFixture } from '../fixtures/capabilities.js';

describe('dispatchCapability', () => {
  it('cannot bypass the policy envelope for a forged direct call', async () => {
    const handler = vi.fn();
    const catalog = new CapabilityCatalog([createMutationFixture(handler)]);
    const config = loadRuntimeConfig({ MCP_REQUEST_STATE_SECRET: '0'.repeat(32) });
    const policy = new PolicyEnvelope(catalog, config);

    await expect(
      dispatchCapability(
        { name: 'test_write', arguments: { value: 'forged' } },
        { config, catalog, policy, transport: 'stdio' }
      )
    ).resolves.toMatchObject({ kind: 'refused', code: 'READ_ONLY' });
    expect(handler).not.toHaveBeenCalled();
  });
});
```

Run:

```bash
npx vitest run tests/capabilities/dispatch.test.ts
```

Expected: one facade test passes and its handler is never called.

- [ ] **Step 7: Export the envelope surface**

Append to `src/index.ts`:

```ts
export { PolicyEnvelope } from './security/policy-envelope.js';
export { dispatchCapability } from './capabilities/dispatch.js';
export type {
  CapabilityRequest,
  CapabilityResult,
  ServerContext
} from './capabilities/types.js';
export type {
  DispatchOutcome,
  DispatchRequest,
  PolicyEnvelopeOptions,
  RefusalCode
} from './security/policy-envelope.js';
```

- [ ] **Step 8: Run policy and full deterministic tests**

Run:

```bash
npx vitest run tests/security/policy-envelope.test.ts tests/capabilities/dispatch.test.ts
npm test
npm run typecheck
npm run lint
```

Expected: five policy tests and one facade test pass, the full test suite passes, and static gates exit `0`.

- [ ] **Step 9: Commit the envelope atomically**

```bash
git add src/security src/capabilities/dispatch.ts src/capabilities/types.ts src/index.ts \
  tests/security/policy-envelope.test.ts tests/capabilities/dispatch.test.ts
git commit -m "feat: enforce minimal capability policy envelope"
```

### Task 5: Add concise instructions and three pedagogical prompts

**Files:**
- Create: `src/mcp/instructions.ts`
- Create: `src/mcp/prompts.ts`
- Create: `tests/mcp/instructions.test.ts`
- Create: `tests/mcp/prompts.test.ts`

**Interfaces:**
- Consumes: `McpServer` and Zod 4 Standard Schemas.
- Produces: `SERVER_INSTRUCTIONS`, `PROMPT_NAMES`, and `registerPedagogicalPrompts(server: McpServer): void` with prompt names `diagnose_network_problem`, `publish_internal_service`, and `block_domain_for_device`.

- [ ] **Step 1: Write guidance contract tests first**

Create `tests/mcp/instructions.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { SERVER_INSTRUCTIONS } from '../../src/mcp/instructions.js';

describe('SERVER_INSTRUCTIONS', () => {
  it('places the essential safety guidance in the first 512 characters', () => {
    const firstWindow = SERVER_INSTRUCTIONS.slice(0, 512);

    expect(firstWindow).toContain('everyday language');
    expect(firstWindow).toContain('read-only discovery');
    expect(firstWindow).toContain('never invent');
    expect(firstWindow).toContain('Before any change');
  });

  it('stays concise and forbids secret collection through chat or forms', () => {
    expect(SERVER_INSTRUCTIONS.length).toBeLessThan(2000);
    expect(SERVER_INSTRUCTIONS).toContain('Never request or reveal secrets through chat');
    expect(SERVER_INSTRUCTIONS).toContain('stop and explain the next safe step');
  });
});
```

Create `tests/mcp/prompts.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  PROMPT_NAMES,
  renderDeviceDomainBlockPrompt,
  renderInternalPublicationPrompt,
  renderNetworkDiagnosisPrompt
} from '../../src/mcp/prompts.js';

describe('pedagogical prompts', () => {
  it('exports stable discoverable names', () => {
    expect(PROMPT_NAMES).toEqual([
      'diagnose_network_problem',
      'publish_internal_service',
      'block_domain_for_device'
    ]);
  });

  it('keeps diagnosis read-only and separates evidence from hypotheses', () => {
    const prompt = renderNetworkDiagnosisPrompt({ symptom: 'Internet is slow' });

    expect(prompt).toContain('read-only');
    expect(prompt).toContain('verified observation');
    expect(prompt).toContain('hypothesis');
  });

  it('keeps publication and blocking in prepare-only mode', () => {
    expect(
      renderInternalPublicationPrompt({ serviceUrl: 'http://10.0.0.20:8080' })
    ).toContain('Do not change the firewall');
    expect(renderDeviceDomainBlockPrompt({ domain: 'tiktok.com' })).toContain(
      'Never replace this with a global block'
    );
  });
});
```

- [ ] **Step 2: Run prompt tests and verify the red state**

Run:

```bash
npx vitest run tests/mcp/instructions.test.ts tests/mcp/prompts.test.ts
```

Expected: FAIL because the instruction and prompt modules do not exist.

- [ ] **Step 3: Add the server-wide instructions**

Create `src/mcp/instructions.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
export const SERVER_INSTRUCTIONS =
  'You are a patient OPNsense guide. Accept goals in everyday language. Begin with read-only discovery, ask one material question at a time, and never invent devices, interfaces, addresses, DNS names, or user intent. Before any change, explain exactly what would change, who or what it affects, expected interruption, backup, verification, and recovery. In READ_ONLY mode, diagnose and propose a plan without changing the firewall. Distinguish every verified observation from each hypothesis. Define networking terms briefly. Never request or reveal secrets through chat or form elicitation. If required information or confirmation cannot be obtained safely, stop and explain the next safe step.';
```

- [ ] **Step 4: Implement the prompt renderers and MCP registration**

Create `src/mcp/prompts.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

export const PROMPT_NAMES = [
  'diagnose_network_problem',
  'publish_internal_service',
  'block_domain_for_device'
] as const;

const DiagnosisArgsSchema = z.object({
  symptom: z.string().min(1).max(500),
  device: z.string().min(1).max(200).optional()
});

const PublicationArgsSchema = z.object({
  serviceUrl: z.url(),
  desiredName: z.string().min(1).max(253).optional(),
  audience: z.enum(['single-device', 'local-network', 'vpn-users']).optional()
});

const DomainBlockArgsSchema = z.object({
  domain: z.string().regex(/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i),
  device: z.string().min(1).max(200).optional()
});

type DiagnosisArgs = z.infer<typeof DiagnosisArgsSchema>;
type PublicationArgs = z.infer<typeof PublicationArgsSchema>;
type DomainBlockArgs = z.infer<typeof DomainBlockArgsSchema>;

export function renderNetworkDiagnosisPrompt(args: DiagnosisArgs): string {
  return [
    `Investigate this symptom using read-only checks only: ${JSON.stringify(args.symptom)}.`,
    args.device
      ? `The user identifies the affected device as ${JSON.stringify(args.device)}.`
      : 'Ask one simple question to identify the affected device if that changes the diagnosis.',
    'Explain each verified observation in plain language, list each hypothesis separately, and propose the smallest next check. Do not change configuration.'
  ].join(' ');
}

export function renderInternalPublicationPrompt(args: PublicationArgs): string {
  return [
    `Prepare an internal-only publication plan for ${JSON.stringify(args.serviceUrl)}.`,
    args.desiredName
      ? `The requested internal name is ${JSON.stringify(args.desiredName)}.`
      : 'Ask for the desired internal DNS name.',
    args.audience
      ? `The intended audience is ${args.audience}.`
      : 'Ask whether the service is for one device, the local network, or VPN users.',
    'Explain internal DNS, certificate, HAProxy, verification, backup, and recovery in plain language. Do not change the firewall; return a preparation plan only.'
  ].join(' ');
}

export function renderDeviceDomainBlockPrompt(args: DomainBlockArgs): string {
  return [
    `Prepare a device-scoped DNS block for ${JSON.stringify(args.domain)}.`,
    args.device
      ? `The named device is ${JSON.stringify(args.device)}; verify its stable identity before proposing a rule.`
      : 'Ask which device should be affected and how it can be identified safely.',
    'Explain DNS-level limitations and verification in plain language. Never replace this with a global block. Do not change configuration; return a preparation plan only.'
  ].join(' ');
}

export function registerPedagogicalPrompts(server: McpServer): void {
  server.registerPrompt(
    'diagnose_network_problem',
    {
      title: 'Diagnose a network problem',
      description: 'Investigate a user-described network problem using read-only evidence.',
      argsSchema: DiagnosisArgsSchema
    },
    (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: renderNetworkDiagnosisPrompt(args) } }]
    })
  );

  server.registerPrompt(
    'publish_internal_service',
    {
      title: 'Plan an internal service publication',
      description: 'Clarify and prepare an internal DNS, certificate, and HAProxy publication.',
      argsSchema: PublicationArgsSchema
    },
    (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: renderInternalPublicationPrompt(args) } }]
    })
  );

  server.registerPrompt(
    'block_domain_for_device',
    {
      title: 'Plan a device-scoped domain block',
      description: 'Clarify and prepare a DNS block that affects one identified device.',
      argsSchema: DomainBlockArgsSchema
    },
    (args) => ({
      messages: [{ role: 'user', content: { type: 'text', text: renderDeviceDomainBlockPrompt(args) } }]
    })
  );
}
```

- [ ] **Step 5: Run guidance and deterministic gates**

Run:

```bash
npx vitest run tests/mcp/instructions.test.ts tests/mcp/prompts.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: five guidance tests pass; static gates exit `0`.

- [ ] **Step 6: Commit pedagogical guidance atomically**

```bash
git add src/mcp/instructions.ts src/mcp/prompts.ts \
  tests/mcp/instructions.test.ts tests/mcp/prompts.test.ts
git commit -m "feat: add pedagogical MCP guidance"
```

### Task 6: Assemble `buildServer`, signed elicitation, and dual-era in-memory tests

**Files:**
- Create: `src/app/application-context.ts`
- Create: `src/mcp/results.ts`
- Create: `src/mcp/confirmation.ts`
- Create: `src/mcp/register-capabilities.ts`
- Create: `src/server/build-server.ts`
- Create: `src/mcp/server-factory.ts`
- Create: `tests/helpers/connect.ts`
- Create: `tests/mcp/factory.test.ts`
- Create: `tests/mcp/elicitation.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- `createApplicationContext(config, catalog?)` owns immutable configuration, catalog, and policy.
- `buildServer(context: ServerContext): McpServer` is the only registration point.
- `createServerFactory(application, transport): McpServerFactory` adapts that function to the SDK.
- `completeConfirmation(...)` accepts only SDK-verified request state and client-advertised form elicitation; unsupported, declined, expired, or argument-mismatched consent returns a refusal and never calls the handler.

- [ ] **Step 1: Write factory and elicitation tests before assembly code**

Create `tests/helpers/connect.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  Client,
  InMemoryTransport,
  StreamableHTTPClientTransport,
  type ClientOptions
} from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { ApplicationContext } from '../../src/app/application-context.js';
import { buildServer } from '../../src/server/build-server.js';
import { createServerFactory } from '../../src/mcp/server-factory.js';

export interface ConnectedClient {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

export async function connectLegacy(
  application: ApplicationContext,
  options: ClientOptions = {}
): Promise<ConnectedClient> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer({
    ...application,
    transport: 'stdio'
  });
  const client = new Client({ name: 'foundation-test', version: '1.0.0' }, options);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    }
  };
}

export async function connectModern(
  application: ApplicationContext,
  options: ClientOptions = {}
): Promise<ConnectedClient> {
  const handler = createMcpHandler(createServerFactory(application, 'http'));
  const client = new Client(
    { name: 'foundation-test', version: '1.0.0' },
    {
      ...options,
      versionNegotiation: { mode: { pin: '2026-07-28' } }
    }
  );
  const transport = new StreamableHTTPClientTransport(new URL('http://mcp.test/mcp'), {
    fetch: async (input, init) => handler.fetch(new Request(input, init))
  });
  await client.connect(transport);
  return {
    client,
    close: async () => {
      await client.close();
      await handler.close();
    }
  };
}
```

Create `tests/mcp/factory.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { SERVER_INSTRUCTIONS } from '../../src/mcp/instructions.js';
import { connectLegacy, connectModern, type ConnectedClient } from '../helpers/connect.js';

const open: ConnectedClient[] = [];
afterEach(async () => Promise.all(open.splice(0).map((connection) => connection.close())));

describe.each([
  ['2025-11-25', connectLegacy],
  ['2026-07-28', connectModern]
] as const)('buildServer on %s', (era, connect) => {
  it('exposes the same instructions, prompts, and read-only status tool', async () => {
    const application = createApplicationContext(loadRuntimeConfig({}));
    const connection = await connect(application);
    open.push(connection);

    expect(connection.client.getProtocolEra()).toBe(era === '2026-07-28' ? 'modern' : 'legacy');
    expect(connection.client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect((await connection.client.listPrompts()).prompts.map((prompt) => prompt.name)).toEqual([
      'diagnose_network_problem',
      'publish_internal_service',
      'block_domain_for_device'
    ]);
    expect((await connection.client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'server_status'
    ]);

    const result = await connection.client.callTool({ name: 'server_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ status: 'ok', readOnly: true, version: '0.1.0' });
  });
});
```

Create `tests/mcp/elicitation.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { createApplicationContext } from '../../src/app/application-context.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { createMutationFixture } from '../fixtures/capabilities.js';
import { connectLegacy, connectModern, type ConnectedClient } from '../helpers/connect.js';

const open: ConnectedClient[] = [];
afterEach(async () => Promise.all(open.splice(0).map((connection) => connection.close())));

describe.each([connectLegacy, connectModern])('elicitation confirmation', (connect) => {
  it('runs a confirmed fixture exactly once', async () => {
    const called = vi.fn();
    const application = createApplicationContext(
      loadRuntimeConfig({ READ_ONLY: 'false', ALLOWED_RESOURCES: 'test.write' }),
      new CapabilityCatalog([createMutationFixture(called)])
    );
    const connection = await connect(application, { capabilities: { elicitation: {} } });
    open.push(connection);
    connection.client.setRequestHandler('elicitation/create', async () => ({
      action: 'accept',
      content: { confirm: true }
    }));

    const result = await connection.client.callTool({
      name: 'test_write',
      arguments: { value: 'approved' }
    });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ accepted: 'approved' });
    expect(called).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the client does not advertise form elicitation', async () => {
    const called = vi.fn();
    const application = createApplicationContext(
      loadRuntimeConfig({ READ_ONLY: 'false', ALLOWED_RESOURCES: 'test.write' }),
      new CapabilityCatalog([createMutationFixture(called)])
    );
    const connection = await connect(application);
    open.push(connection);

    const result = await connection.client.callTool({
      name: 'test_write',
      arguments: { value: 'unconfirmed' }
    });

    expect(result.isError).toBe(true);
    expect(called).not.toHaveBeenCalled();
  });

  it('fails closed for a URL-only elicitation client', async () => {
    const called = vi.fn();
    const application = createApplicationContext(
      loadRuntimeConfig({ READ_ONLY: 'false', ALLOWED_RESOURCES: 'test.write' }),
      new CapabilityCatalog([createMutationFixture(called)])
    );
    const connection = await connect(application, {
      capabilities: { elicitation: { url: {} } }
    });
    open.push(connection);

    const result = await connection.client.callTool({
      name: 'test_write',
      arguments: { value: 'url-only' }
    });

    expect(result.isError).toBe(true);
    expect(called).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests and verify the red state**

Run:

```bash
npx vitest run tests/mcp/factory.test.ts tests/mcp/elicitation.test.ts
```

Expected: FAIL because the application context and MCP assembly modules do not exist.

- [ ] **Step 3: Compose application state and safe result formatting**

Create `src/app/application-context.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { CAPABILITY_CATALOG, type CapabilityCatalog } from '../capabilities/catalog.js';
import type { RuntimeConfig } from '../config/runtime-config.js';
import { PolicyEnvelope } from '../security/policy-envelope.js';

export interface ApplicationContext {
  readonly config: RuntimeConfig;
  readonly catalog: CapabilityCatalog;
  readonly policy: PolicyEnvelope;
}

export function createApplicationContext(
  config: RuntimeConfig,
  catalog: CapabilityCatalog = CAPABILITY_CATALOG
): ApplicationContext {
  return Object.freeze({
    config,
    catalog,
    policy: new PolicyEnvelope(catalog, {
      readOnly: config.readOnly,
      allowedResourceScopes: config.allowedResourceScopes,
      enabledFeatureFlags: config.enabledFeatureFlags
    })
  });
}
```

Create `src/mcp/results.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { DispatchOutcome } from '../security/policy-envelope.js';

type RefusalOutcome = Extract<DispatchOutcome, { kind: 'refused' }>;

export function successResult(output: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],
    structuredContent: output
  };
}

export function refusalResult(refusal: RefusalOutcome): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: refusal.message }],
    structuredContent: { code: refusal.code }
  };
}
```

- [ ] **Step 4: Implement SDK-verified confirmation rounds**

Create `src/mcp/confirmation.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  acceptedContent,
  inputRequired,
  inputResponse,
  type CallToolResult,
  type InputRequiredResult,
  type McpServer,
  type RequestStateCodec,
  type ServerContext as McpHandlerContext
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { dispatchCapability } from '../capabilities/dispatch.js';
import type { CapabilityDefinition, ServerContext } from '../capabilities/types.js';
import type { DispatchOutcome } from '../security/policy-envelope.js';
import { verifiedConfirmationFromAdapter } from '../security/verified-confirmation.js';
import { refusalResult, successResult } from './results.js';

export const ConfirmationStateSchema = z
  .object({
    capabilityId: z.string().min(1),
    argumentsSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();
export type ConfirmationState = z.infer<typeof ConfirmationStateSchema>;
type ConfirmationRequired = Extract<DispatchOutcome, { kind: 'confirmation-required' }>;

const ConfirmationResponseSchema = z.object({ confirm: z.boolean() });

function hasFormElicitation(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || !('elicitation' in value)) return false;
  const elicitation = value.elicitation;
  if (typeof elicitation !== 'object' || elicitation === null) return false;
  if ('form' in elicitation || 'url' in elicitation) return 'form' in elicitation;
  return true;
}

function supportsFormElicitation(server: McpServer, context: McpHandlerContext): boolean {
  const modernCapabilities =
    context.mcpReq.envelope?.['io.modelcontextprotocol/clientCapabilities'];
  if (modernCapabilities !== undefined) return hasFormElicitation(modernCapabilities);

  // The 2025 shim has no per-request capability envelope; initialization is its authority.
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  return hasFormElicitation(server.server.getClientCapabilities());
}

export async function completeConfirmation(
  server: McpServer,
  codec: RequestStateCodec<ConfirmationState>,
  serverContext: ServerContext,
  capability: CapabilityDefinition,
  rawInput: unknown,
  context: McpHandlerContext,
  required: ConfirmationRequired
): Promise<CallToolResult | InputRequiredResult> {
  const priorState = context.mcpReq.requestState<ConfirmationState>();
  const priorResponse = inputResponse(context.mcpReq.inputResponses, 'confirmation');

  if (priorState !== undefined) {
    const parsedState = ConfirmationStateSchema.safeParse(priorState);
    if (
      !parsedState.success ||
      parsedState.data.capabilityId !== capability.id ||
      parsedState.data.argumentsSha256 !== required.argumentsSha256
    ) {
      return refusalResult({
        kind: 'refused',
        code: 'CONFIRMATION_INVALID',
        message: 'Confirmation is invalid.'
      });
    }
    const accepted = acceptedContent(
      context.mcpReq.inputResponses,
      'confirmation',
      ConfirmationResponseSchema
    );
    if (accepted?.confirm !== true) {
      return refusalResult({
        kind: 'refused',
        code: 'CONFIRMATION_INVALID',
        message: 'Confirmation was not accepted.'
      });
    }
    const principalId = context.http?.authInfo?.clientId;
    const outcome = await dispatchCapability(
      { name: capability.mcpName, arguments: rawInput },
      {
        ...serverContext,
        signal: context.mcpReq.signal,
        ...(principalId === undefined ? {} : { principalId }),
        confirmation: verifiedConfirmationFromAdapter(
          parsedState.data.capabilityId,
          parsedState.data.argumentsSha256
        )
      }
    );
    if (outcome.kind === 'success') return successResult(outcome.output);
    if (outcome.kind === 'refused') return refusalResult(outcome);
    return refusalResult({
      kind: 'refused',
      code: 'CONFIRMATION_INVALID',
      message: 'Confirmation could not be completed.'
    });
  }

  if (priorResponse.kind !== 'missing' || !supportsFormElicitation(server, context)) {
    return refusalResult({
      kind: 'refused',
      code: 'CONFIRMATION_INVALID',
      message: 'This client cannot collect the required confirmation.'
    });
  }

  const requestState = await codec.mint(
    {
      capabilityId: capability.id,
      argumentsSha256: required.argumentsSha256
    },
    context
  );
  return inputRequired({
    requestState,
    inputRequests: {
      confirmation: inputRequired.elicit({
        message: `Confirm ${capability.title} with the exact arguments already shown.`,
        requestedSchema: ConfirmationResponseSchema
      })
    }
  });
}
```

- [ ] **Step 5: Register the closed catalog through the policy envelope**

Create `src/mcp/register-capabilities.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { McpServer, RequestStateCodec } from '@modelcontextprotocol/server';
import { dispatchCapability } from '../capabilities/dispatch.js';
import type { ServerContext } from '../capabilities/types.js';
import { completeConfirmation, type ConfirmationState } from './confirmation.js';
import { refusalResult, successResult } from './results.js';

export function registerCapabilities(
  server: McpServer,
  serverContext: ServerContext,
  codec: RequestStateCodec<ConfirmationState>
): void {
  const exposed = serverContext.policy.listExposed(serverContext.transport);

  for (const capability of exposed) {
    server.registerTool(
      capability.mcpName,
      {
        title: capability.title,
        description: capability.description,
        inputSchema: capability.inputSchema,
        outputSchema: capability.outputSchema,
        annotations: capability.annotations
      },
      async (rawInput, context) => {
        const principalId = context.http?.authInfo?.clientId;
        const outcome = await dispatchCapability(
          { name: capability.mcpName, arguments: rawInput },
          {
            ...serverContext,
            signal: context.mcpReq.signal,
            ...(principalId === undefined ? {} : { principalId })
          }
        );
        if (outcome.kind === 'success') return successResult(outcome.output);
        if (outcome.kind === 'confirmation-required') {
          return completeConfirmation(
            server,
            codec,
            serverContext,
            capability,
            rawInput,
            context,
            outcome
          );
        }
        return refusalResult(outcome);
      }
    );
  }
}
```

- [ ] **Step 6: Make `buildServer` the single assembly point**

Create `src/server/build-server.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import {
  createRequestStateCodec,
  McpServer
} from '@modelcontextprotocol/server';
import type { ServerContext } from '../capabilities/types.js';
import { type ConfirmationState } from '../mcp/confirmation.js';
import { SERVER_INSTRUCTIONS } from '../mcp/instructions.js';
import { registerPedagogicalPrompts } from '../mcp/prompts.js';
import { registerCapabilities } from '../mcp/register-capabilities.js';

export function buildServer(context: ServerContext): McpServer {
  const codec = createRequestStateCodec<ConfirmationState>({
    key: context.config.requestStateKey,
    ttlSeconds: 300,
    bind: (serverContext) =>
      `${serverContext.mcpReq.method}\0${serverContext.http?.authInfo?.clientId ?? 'local-connection'}`
  });
  const server = new McpServer(
    { name: 'opnsense-mcp', version: '0.1.0' },
    {
      instructions: SERVER_INSTRUCTIONS,
      inputRequired: { legacyShim: true, maxRounds: 4, roundTimeoutMs: 120_000 },
      requestState: { verify: (state, serverContext) => codec.verify(state, serverContext) }
    }
  );
  registerPedagogicalPrompts(server);
  registerCapabilities(server, context, codec);
  return server;
}
```

Create `src/mcp/server-factory.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { McpServerFactory } from '@modelcontextprotocol/server';
import type { ApplicationContext } from '../app/application-context.js';
import type { TransportKind } from '../capabilities/types.js';
import { buildServer } from '../server/build-server.js';

export function createServerFactory(
  application: ApplicationContext,
  transport: TransportKind
): McpServerFactory {
  return () => buildServer({ ...application, transport });
}
```

Append to `src/index.ts`:

```ts
export { createApplicationContext } from './app/application-context.js';
export { buildServer } from './server/build-server.js';
export { createServerFactory } from './mcp/server-factory.js';
```

- [ ] **Step 7: Run both eras and all deterministic gates**

Run:

```bash
npx vitest run tests/mcp/factory.test.ts tests/mcp/elicitation.test.ts
npm run typecheck
npm run lint
npm run format:check
```

Expected: eight parameterized cases pass across legacy and modern eras; a confirmed fixture runs exactly once, and clients without form elicitation never reach the handler. All static gates exit `0`.

- [ ] **Step 8: Commit server assembly atomically**

```bash
git add src/app src/mcp src/server src/index.ts tests/helpers/connect.ts \
  tests/mcp/factory.test.ts tests/mcp/elicitation.test.ts
git commit -m "feat: assemble dual-era MCP server factory"
```

### Task 7: Add dual-era stdio and hardened opt-in HTTP entrypoints

**Files:**
- Create: `src/entrypoints/stdio.ts`
- Create: `src/main.ts`
- Create: `src/http/auth.ts`
- Create: `src/http/origin.ts`
- Create: `src/http/limits.ts`
- Create: `src/http/runtime.ts`
- Create: `src/entrypoints/http.ts`
- Create: `tests/mcp/stdio.test.ts`
- Create: `tests/http/runtime.test.ts`
- Modify: `package.json`
- Modify: `src/index.ts`

**Interfaces:**
- `startStdio(application?)` calls `serveStdio(createServerFactory(...))` and writes diagnostic errors only to stderr.
- `bearerAuthentication(expectedToken)` attaches a validated `AuthInfo` to `req.auth` using constant-time digest comparison.
- `exactOriginValidation(allowedOrigins)` compares a present raw Origin header against exact configured serialized origins. Absence is allowed for non-browser clients; `null`, malformed, scheme/host/port variants, and all browser origins under the default empty list receive HTTP 403 before authentication or MCP dispatch.
- `DEFAULT_HTTP_LIMITS` fixes a 256 KiB JSON body, 32 concurrent requests, 16 subscriptions, 10-second body receipt, 30-second ordinary execution, 5-minute stream lifetime, 2-minute legacy-session idle timeout, 8 legacy sessions, 5-second headers/keep-alive timeouts, and 100 requests per socket. The primary handler keeps 2025 Streamable HTTP explicitly stateless (`legacy: 'stateless'`), so it retains zero Streamable sessions between requests.
- `startHttp(application, options?)` returns `{ url, limits, close }`, accepts only loopback configuration, enforces Host, exact Origin, body, concurrency, request/stream deadlines, and bearer authentication before `/mcp`, then uses the official beta.4 `createMcpHandler` and `toNodeHandler`. Streamable HTTP remains present after Task 7b adds optional SSE routes.

- [ ] **Step 1: Write child-process stdio and live HTTP tests first**

Create `tests/mcp/stdio.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { describe, expect, it } from 'vitest';

describe.each([
  ['legacy', undefined],
  ['modern', { mode: { pin: '2026-07-28' as const } }]
] as const)('stdio %s era', (_name, versionNegotiation) => {
  it('starts from the package executable and keeps stdout protocol-clean', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['dist/main.js'],
      env: { PATH: process.env.PATH ?? '', READ_ONLY: 'true' },
      stderr: 'pipe'
    });
    const client = new Client(
      { name: 'stdio-test', version: '1.0.0' },
      versionNegotiation === undefined ? {} : { versionNegotiation }
    );
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        'server_status'
      ]);
      expect(client.getProtocolEra()).toBe(_name);
    } finally {
      await client.close();
    }
  });
});
```

Create `tests/http/runtime.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request as nodeRequest } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { DEFAULT_HTTP_LIMITS } from '../../src/http/limits.js';
import { startHttp, type HttpRuntime } from '../../src/http/runtime.js';

const token = '0123456789abcdef0123456789abcdef';
const open: HttpRuntime[] = [];
afterEach(async () => Promise.all(open.splice(0).map((runtime) => runtime.close())));

async function rawStatus(url: URL, headers: Record<string, string>): Promise<number> {
  return await new Promise((resolve, reject) => {
    const req = nodeRequest(url, { method: 'POST', headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end('{}');
  });
}

describe('HTTP runtime', () => {
  it('rejects missing bearer and a foreign Host', async () => {
    const application = createApplicationContext(
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: token })
    );
    const runtime = await startHttp(application, { port: 0 });
    open.push(runtime);

    expect((await fetch(runtime.url, { method: 'POST' })).status).toBe(401);
    expect(
      await rawStatus(runtime.url, {
        authorization: `Bearer ${token}`,
        host: 'foreign.example',
        'content-type': 'application/json'
      })
    ).toBe(403);
  });

  it('uses an exact serialized Origin allow-list before authentication', async () => {
    const allowedOrigin = 'https://console.example:8443';
    const application = createApplicationContext(
      loadRuntimeConfig({
        MCP_HTTP_ENABLED: 'true',
        MCP_HTTP_TOKEN: token,
        MCP_ALLOWED_ORIGINS: allowedOrigin
      })
    );
    const runtime = await startHttp(application, { port: 0 });
    open.push(runtime);

    expect(
      (await fetch(runtime.url, { method: 'POST', headers: { origin: allowedOrigin } })).status
    ).toBe(401);

    for (const rejectedOrigin of [
      'http://console.example:8443',
      'https://other.example:8443',
      'https://console.example:9443',
      'null',
      'not-an-origin',
      'https://foreign.example'
    ]) {
      expect(
        (
          await fetch(runtime.url, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${token}`,
              origin: rejectedOrigin
            }
          })
        ).status
      ).toBe(403);
    }
  });

  it('defaults browser origins to deny and enforces explicit HTTP limits', async () => {
    const application = createApplicationContext(
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: token })
    );
    const runtime = await startHttp(application, { port: 0 });
    open.push(runtime);

    expect(runtime.limits).toEqual(DEFAULT_HTTP_LIMITS);
    expect(
      (
        await fetch(runtime.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            origin: 'http://localhost:3000'
          }
        })
      ).status
    ).toBe(403);

    const oversized = JSON.stringify({ padding: 'x'.repeat(DEFAULT_HTTP_LIMITS.jsonBodyBytes) });
    expect(
      (
        await fetch(runtime.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json'
          },
          body: oversized
        })
      ).status
    ).toBe(413);
  });

  it('serves modern MCP with validated authentication', async () => {
    const application = createApplicationContext(
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: token })
    );
    const runtime = await startHttp(application, { port: 0 });
    open.push(runtime);
    const transport = new StreamableHTTPClientTransport(runtime.url, {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    });
    const client = new Client(
      { name: 'http-test', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } }
    );
    await client.connect(transport);
    try {
      expect(client.getProtocolEra()).toBe('modern');
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        'server_status'
      ]);
    } finally {
      await client.close();
    }
  });
});
```

- [ ] **Step 2: Build and run the tests to establish the red state**

Run:

```bash
npm run build
npx vitest run tests/mcp/stdio.test.ts tests/http/runtime.test.ts
```

Expected: FAIL because the executable and HTTP runtime do not exist.

- [ ] **Step 3: Implement the default dual-era stdio executable**

Create `src/entrypoints/stdio.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { serveStdio, type StdioServerHandle } from '@modelcontextprotocol/server/stdio';
import { createApplicationContext, type ApplicationContext } from '../app/application-context.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { createServerFactory } from '../mcp/server-factory.js';

export function startStdio(
  application: ApplicationContext = createApplicationContext(loadRuntimeConfig())
): StdioServerHandle {
  return serveStdio(createServerFactory(application, 'stdio'), {
    legacy: 'serve',
    maxSubscriptions: 64,
    onerror: (error) => process.stderr.write(`MCP stdio error: ${error.name}\n`)
  });
}
```

Create `src/main.ts`:

```ts
#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
import { startStdio } from './entrypoints/stdio.js';

try {
  startStdio();
} catch (error) {
  const name = error instanceof Error ? error.name : 'Error';
  process.stderr.write(`Unable to start MCP stdio: ${name}\n`);
  process.exitCode = 1;
}
```

- [ ] **Step 4: Implement constant-time local bearer authentication**

Create `src/http/auth.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function bearerAuthentication(expectedToken: string): RequestHandler {
  const expectedDigest = digest(expectedToken);
  return (request, response, next) => {
    const authorization = request.header('authorization');
    const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!timingSafeEqual(digest(supplied), expectedDigest)) {
      response.setHeader('WWW-Authenticate', 'Bearer');
      response.status(401).json({ error: 'unauthorized' });
      return;
    }
    request.auth = {
      token: supplied,
      clientId: 'local-http-client',
      scopes: ['mcp:invoke']
    };
    next();
  };
}
```

- [ ] **Step 5: Implement exact serialized-Origin and finite HTTP limits**

Create `src/http/origin.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { RequestHandler } from 'express';

export function exactOriginValidation(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (request, response, next) => {
    const origin = request.header('origin');
    if (origin === undefined) {
      next();
      return;
    }
    if (!allowed.has(origin)) {
      response.status(403).json({ error: 'forbidden_origin' });
      return;
    }
    next();
  };
}

export function sdkOriginHostnames(allowedOrigins: readonly string[]): string[] {
  return [...new Set(allowedOrigins.map((origin) => new URL(origin).hostname))];
}
```

`sdkOriginHostnames` supplies the official Express adapter's supplemental hostname-only check. It is never the authorization decision: `exactOriginValidation` compares the complete serialized value, including scheme and port, and runs before bearer authentication and every MCP/SSE route.

Create `src/http/limits.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Server } from 'node:http';
import type { Request, RequestHandler } from 'express';

export interface HttpLimits {
  readonly jsonBodyLimit: '256kb';
  readonly jsonBodyBytes: 262_144;
  readonly maxConcurrentRequests: 32;
  readonly maxSubscriptions: 16;
  readonly requestBodyTimeoutMs: 10_000;
  readonly requestExecutionTimeoutMs: 30_000;
  readonly streamLifetimeMs: 300_000;
  readonly legacySessionIdleTimeoutMs: 120_000;
  readonly maxLegacySseSessions: 8;
  readonly headersTimeoutMs: 5_000;
  readonly keepAliveTimeoutMs: 5_000;
  readonly maxRequestsPerSocket: 100;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = Object.freeze({
  jsonBodyLimit: '256kb',
  jsonBodyBytes: 262_144,
  maxConcurrentRequests: 32,
  maxSubscriptions: 16,
  requestBodyTimeoutMs: 10_000,
  requestExecutionTimeoutMs: 30_000,
  streamLifetimeMs: 300_000,
  legacySessionIdleTimeoutMs: 120_000,
  maxLegacySseSessions: 8,
  headersTimeoutMs: 5_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100
});

function isLongLivedStream(request: Request): boolean {
  if (request.method === 'GET' && request.path === '/sse') return true;
  const body: unknown = request.body;
  return (
    typeof body === 'object' &&
    body !== null &&
    'method' in body &&
    body.method === 'subscriptions/listen'
  );
}

export function enforceHttpLimits(limits: HttpLimits = DEFAULT_HTTP_LIMITS): RequestHandler {
  let activeRequests = 0;
  return (request, response, next) => {
    if (activeRequests >= limits.maxConcurrentRequests) {
      response.status(503).json({ error: 'request_capacity_exceeded' });
      return;
    }

    activeRequests += 1;
    const lifetimeMs = isLongLivedStream(request)
      ? limits.streamLifetimeMs
      : limits.requestExecutionTimeoutMs;
    const deadline = setTimeout(() => {
      if (response.headersSent) response.destroy();
      else response.status(504).json({ error: 'request_deadline_exceeded' });
    }, lifetimeMs);
    deadline.unref();

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(deadline);
      activeRequests -= 1;
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
}

export function configureNodeHttpLimits(
  server: Server,
  limits: HttpLimits = DEFAULT_HTTP_LIMITS
): void {
  server.headersTimeout = limits.headersTimeoutMs;
  server.requestTimeout = limits.requestBodyTimeoutMs;
  server.keepAliveTimeout = limits.keepAliveTimeoutMs;
  server.maxRequestsPerSocket = limits.maxRequestsPerSocket;
}
```

- [ ] **Step 6: Wire official Express, Node, and MCP v2 adapters**

Create `src/http/runtime.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Server } from 'node:http';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { ApplicationContext } from '../app/application-context.js';
import { createServerFactory } from '../mcp/server-factory.js';
import { bearerAuthentication } from './auth.js';
import {
  configureNodeHttpLimits,
  DEFAULT_HTTP_LIMITS,
  enforceHttpLimits,
  type HttpLimits
} from './limits.js';
import { exactOriginValidation, sdkOriginHostnames } from './origin.js';

export interface HttpRuntime {
  readonly url: URL;
  readonly limits: HttpLimits;
  readonly close: () => Promise<void>;
}

export async function startHttp(
  application: ApplicationContext,
  options: { readonly port?: number; readonly onerror?: (error: Error) => void } = {}
): Promise<HttpRuntime> {
  const { http } = application.config;
  if (!http.enabled || http.token === undefined) {
    throw new Error('HTTP transport is disabled or missing authentication.');
  }
  const onerror = options.onerror ?? (() => undefined);
  const app = createMcpExpressApp({
    host: http.host,
    allowedHosts: [...http.allowedHosts],
    allowedOrigins: sdkOriginHostnames(http.allowedOrigins),
    jsonLimit: DEFAULT_HTTP_LIMITS.jsonBodyLimit
  });
  const handler = createMcpHandler(createServerFactory(application, 'http'), {
    legacy: 'stateless',
    maxSubscriptions: DEFAULT_HTTP_LIMITS.maxSubscriptions,
    onerror
  });
  const nodeHandler = toNodeHandler(handler, { onerror });
  app.use(exactOriginValidation(http.allowedOrigins));
  app.use(enforceHttpLimits());
  app.use('/mcp', bearerAuthentication(http.token));
  app.all('/mcp', (request, response) => {
    void nodeHandler(request, response, request.body);
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(options.port ?? http.port, http.host, () => resolve(listening));
    configureNodeHttpLimits(listening);
    listening.once('error', reject);
  });
  const address = server.address();
  if (address === undefined || address === null || typeof address === 'string') {
    await handler.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error('HTTP listener did not expose a TCP address.');
  }
  return {
    url: new URL(`http://${http.host}:${String(address.port)}/mcp`),
    limits: DEFAULT_HTTP_LIMITS,
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      );
    }
  };
}
```

Create `src/entrypoints/http.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { createApplicationContext } from '../app/application-context.js';
import { loadRuntimeConfig } from '../config/runtime-config.js';
import { startHttp } from '../http/runtime.js';

try {
  const runtime = await startHttp(createApplicationContext(loadRuntimeConfig()), {
    onerror: (error) => process.stderr.write(`MCP HTTP error: ${error.name}\n`)
  });
  process.stderr.write(`MCP HTTP listening on ${runtime.url.origin}\n`);
} catch (error) {
  const name = error instanceof Error ? error.name : 'Error';
  process.stderr.write(`Unable to start MCP HTTP: ${name}\n`);
  process.exitCode = 1;
}
```

Add these scripts to `package.json`:

```json
"start": "node dist/main.js",
"start:http": "node dist/entrypoints/http.js"
```

Append to `src/index.ts`:

```ts
export { startStdio } from './entrypoints/stdio.js';
export { startHttp } from './http/runtime.js';
export type { HttpRuntime } from './http/runtime.js';
```

- [ ] **Step 7: Run transport and regression gates**

Run:

```bash
npm run build
npx vitest run tests/mcp/stdio.test.ts tests/http/runtime.test.ts
npm test
npm run typecheck
npm run lint
```

Expected: both stdio eras connect; missing authentication and foreign Host are refused; an exact configured Origin reaches authentication while scheme, host, port, opaque, malformed, and foreign variants receive 403; the default empty browser-origin list receives 403; an oversized body receives 413; all finite limits have their declared values; the authenticated modern client lists only `server_status`; and all deterministic gates exit `0`.

- [ ] **Step 8: Commit transport adapters atomically**

```bash
git add package.json src/entrypoints src/http src/main.ts src/index.ts \
  tests/mcp/stdio.test.ts tests/http/runtime.test.ts
git commit -m "feat: add dual-era stdio and hardened HTTP"
```

### Task 7b: Add isolated default-off deprecated SSE compatibility

**Files:**
- Create: `src/http/legacy-sse.ts`
- Create: `tests/http/legacy-sse.test.ts`
- Create: `scripts/check-legacy-sse-dependency.mjs`
- Modify: `src/http/runtime.ts`
- Modify: `tests/foundation/package-contract.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- `@modelcontextprotocol/sdk@1.29.0` is the exact, installable legacy dependency and the only source of deprecated `McpServer`, `SSEServerTransport`, and test `SSEClientTransport` types. No v1 object is passed to `@modelcontextprotocol/server@2.0.0-beta.4`.
- `buildLegacySseServer(application)` is private to `src/http/legacy-sse.ts`; it derives listed tools from `application.policy.listExposed('http')` and calls the shared `dispatchCapability` facade. It contains no firewall or business handler.
- `mountLegacySseCompatibility(...)` adds authenticated `GET /sse` and `POST /messages` only when `MCP_LEGACY_SSE_ENABLED=true`. The routes sit behind the same global Host, exact-Origin, body, concurrency, and deadline middleware as `/mcp`, enforce bearer authentication on both requests, cap sessions at 8, expire idle sessions after 2 minutes, and use the normal HTTP policy context.
- `startHttp` still exposes Streamable HTTP at `/mcp`; the deprecated package is dynamically imported only when compatibility is enabled.
- `npm run release:check:legacy-sse` is a networked pre-release drift gate. It fails if the registry's sole `latest` tag differs from the exact approved pin; release review must also decide whether the adapter can be removed and run `npm audit --omit=dev`.

- [ ] **Step 1: Write the default-off, security, capacity, and compatibility tests first**

Create `tests/http/legacy-sse.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request as nodeRequest } from 'node:http';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { afterEach, describe, expect, it } from 'vitest';
import { createApplicationContext } from '../../src/app/application-context.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { DEFAULT_HTTP_LIMITS } from '../../src/http/limits.js';
import { startHttp, type HttpRuntime } from '../../src/http/runtime.js';

const token = '0123456789abcdef0123456789abcdef';
const browserOrigin = 'https://console.example:8443';
const open: HttpRuntime[] = [];
afterEach(async () => Promise.all(open.splice(0).map((runtime) => runtime.close())));

function legacyApplication() {
  return createApplicationContext(
    loadRuntimeConfig({
      MCP_HTTP_ENABLED: 'true',
      MCP_HTTP_TOKEN: token,
      MCP_ALLOWED_ORIGINS: browserOrigin,
      MCP_LEGACY_SSE_ENABLED: 'true'
    })
  );
}

async function rawGetStatus(url: URL, headers: Record<string, string>): Promise<number> {
  return await new Promise((resolve, reject) => {
    const request = nodeRequest(url, { method: 'GET', headers }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on('error', reject);
    request.end();
  });
}

describe('deprecated SSE compatibility', () => {
  it('is absent by default while Streamable HTTP remains mounted', async () => {
    const application = createApplicationContext(
      loadRuntimeConfig({ MCP_HTTP_ENABLED: 'true', MCP_HTTP_TOKEN: token })
    );
    const runtime = await startHttp(application, { port: 0 });
    open.push(runtime);

    expect(
      (
        await fetch(new URL('/sse', runtime.url), {
          headers: { authorization: `Bearer ${token}` }
        })
      ).status
    ).toBe(404);
    expect(runtime.url.pathname).toBe('/mcp');
  });

  it('applies the same bearer, exact-Origin, Host, and session lookup gates', async () => {
    const runtime = await startHttp(legacyApplication(), { port: 0 });
    open.push(runtime);
    const sseUrl = new URL('/sse', runtime.url);

    expect((await fetch(sseUrl, { headers: { origin: browserOrigin } })).status).toBe(401);
    expect(
      (
        await fetch(sseUrl, {
          headers: {
            authorization: `Bearer ${token}`,
            origin: 'https://console.example:9443'
          }
        })
      ).status
    ).toBe(403);
    expect(
      await rawGetStatus(sseUrl, {
        authorization: `Bearer ${token}`,
        origin: browserOrigin,
        host: 'foreign.example'
      })
    ).toBe(403);
    expect(
      (
        await fetch(new URL('/messages?sessionId=missing-session', runtime.url), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            origin: browserOrigin,
            'content-type': 'application/json'
          },
          body: '{}'
        })
      ).status
    ).toBe(404);
  });

  it('caps open deprecated sessions at the declared finite limit', async () => {
    const runtime = await startHttp(legacyApplication(), { port: 0 });
    open.push(runtime);
    const sseUrl = new URL('/sse', runtime.url);
    const headers = { authorization: `Bearer ${token}`, origin: browserOrigin };
    const streams: Response[] = [];

    for (let index = 0; index < DEFAULT_HTTP_LIMITS.maxLegacySseSessions; index += 1) {
      const response = await fetch(sseUrl, { headers });
      expect(response.status).toBe(200);
      streams.push(response);
    }
    expect((await fetch(sseUrl, { headers })).status).toBe(503);
    await Promise.all(streams.map(async (response) => response.body?.cancel()));
  });

  it('serves shared catalog tools through the isolated v1 transport', async () => {
    const runtime = await startHttp(legacyApplication(), { port: 0 });
    open.push(runtime);
    const transport = new SSEClientTransport(new URL('/sse', runtime.url), {
      requestInit: {
        headers: { authorization: `Bearer ${token}`, origin: browserOrigin }
      }
    });
    const client = new LegacyClient({ name: 'legacy-sse-test', version: '1.0.0' });

    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
        'server_status'
      ]);
      const result = await client.callTool({ name: 'server_status', arguments: {} });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toEqual({ status: 'ok', readOnly: true, version: '0.1.0' });
    } finally {
      await client.close();
    }
  });
});
```

Add this assertion to `tests/foundation/package-contract.test.ts` inside the exact-pin test:

```ts
expect(document.dependencies['@modelcontextprotocol/sdk']).toBe('1.29.0');
```

Run:

```bash
npx vitest run tests/foundation/package-contract.test.ts tests/http/legacy-sse.test.ts
```

Expected: FAIL because the exact legacy dependency and compatibility module are absent.

- [ ] **Step 2: Add only the exact approved deprecated transport dependency**

Add this exact entry to `package.json` dependencies; do not change the four beta.4 imports or pins:

```json
"@modelcontextprotocol/sdk": "1.29.0"
```

Regenerate and install the lockfile without lifecycle scripts:

```bash
npm install --package-lock-only --ignore-scripts
npm ci --ignore-scripts
```

Expected: both commands exit `0`; `package-lock.json` resolves `@modelcontextprotocol/sdk@1.29.0` exactly and retains all four official v2 packages at `2.0.0-beta.4`.

- [ ] **Step 3: Implement the isolated v1 assembly, transport, and bounded session store**

Create `src/http/legacy-sse.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { McpServer as LegacyMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { CallToolResult as LegacyCallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Express, RequestHandler } from 'express';
import type { ApplicationContext } from '../app/application-context.js';
import { dispatchCapability } from '../capabilities/dispatch.js';
import { SERVER_INSTRUCTIONS } from '../mcp/instructions.js';
import { DEFAULT_HTTP_LIMITS } from './limits.js';

type DispatchOutcome = Awaited<ReturnType<typeof dispatchCapability>>;

interface LegacySseSession {
  readonly server: LegacyMcpServer;
  readonly transport: SSEServerTransport;
  idleTimer: ReturnType<typeof setTimeout>;
}

export interface LegacySseHandle {
  readonly close: () => Promise<void>;
}

function legacyResult(outcome: DispatchOutcome): LegacyCallToolResult {
  if (outcome.kind === 'success') {
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.output) }],
      structuredContent: outcome.output
    };
  }
  if (outcome.kind === 'refused') {
    return {
      isError: true,
      content: [{ type: 'text', text: outcome.message }],
      structuredContent: { code: outcome.code }
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: 'Confirmation is unavailable on deprecated SSE.' }],
    structuredContent: { code: 'CONFIRMATION_INVALID' }
  };
}

function buildLegacySseServer(application: ApplicationContext): LegacyMcpServer {
  const server = new LegacyMcpServer(
    { name: 'opnsense-mcp-legacy-sse', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  for (const capability of application.policy.listExposed('http')) {
    server.registerTool(
      capability.mcpName,
      {
        title: capability.title,
        description: capability.description,
        inputSchema: capability.inputSchema,
        outputSchema: capability.outputSchema,
        annotations: capability.annotations
      },
      async (rawInput, extra) => {
        const principalId = extra.authInfo?.clientId;
        const outcome = await dispatchCapability(
          { name: capability.mcpName, arguments: rawInput },
          {
            ...application,
            transport: 'http',
            signal: extra.signal,
            ...(principalId === undefined ? {} : { principalId })
          }
        );
        return legacyResult(outcome);
      }
    );
  }
  return server;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Legacy SSE failure');
}

export function mountLegacySseCompatibility(
  app: Express,
  application: ApplicationContext,
  authentication: RequestHandler,
  onerror: (error: Error) => void
): LegacySseHandle {
  const sessions = new Map<string, LegacySseSession>();

  async function closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    sessions.delete(sessionId);
    clearTimeout(session.idleTimer);
    await session.server.close();
  }

  function armIdleTimeout(sessionId: string, session: LegacySseSession): void {
    clearTimeout(session.idleTimer);
    session.idleTimer = setTimeout(() => {
      void closeSession(sessionId).catch(onerror);
    }, DEFAULT_HTTP_LIMITS.legacySessionIdleTimeoutMs);
    session.idleTimer.unref();
  }

  app.get('/sse', authentication, (request, response) => {
    void (async () => {
      if (sessions.size >= DEFAULT_HTTP_LIMITS.maxLegacySseSessions) {
        response.status(503).json({ error: 'legacy_session_capacity_exceeded' });
        return;
      }

      const transport = new SSEServerTransport('/messages', response);
      const server = buildLegacySseServer(application);
      const sessionId = transport.sessionId;
      const idleTimer = setTimeout(() => {
        void closeSession(sessionId).catch(onerror);
      }, DEFAULT_HTTP_LIMITS.legacySessionIdleTimeoutMs);
      idleTimer.unref();
      const session: LegacySseSession = { server, transport, idleTimer };
      sessions.set(sessionId, session);
      response.once('close', () => void closeSession(sessionId).catch(onerror));

      try {
        await server.connect(transport);
      } catch (error) {
        await closeSession(sessionId);
        throw error;
      }
    })().catch((error) => {
      onerror(asError(error));
      if (response.headersSent) response.destroy();
      else response.status(500).json({ error: 'legacy_sse_failed' });
    });
  });

  app.post('/messages', authentication, (request, response) => {
    void (async () => {
      const rawSessionId = request.query.sessionId;
      if (
        typeof rawSessionId !== 'string' ||
        !/^[A-Za-z0-9_-]{16,128}$/.test(rawSessionId)
      ) {
        response.status(400).json({ error: 'invalid_session' });
        return;
      }
      const session = sessions.get(rawSessionId);
      if (session === undefined) {
        response.status(404).json({ error: 'unknown_session' });
        return;
      }
      armIdleTimeout(rawSessionId, session);
      await session.transport.handlePostMessage(request, response, request.body);
    })().catch((error) => {
      onerror(asError(error));
      if (response.headersSent) response.destroy();
      else response.status(500).json({ error: 'legacy_message_failed' });
    });
  });

  return {
    close: async () => {
      await Promise.all([...sessions.keys()].map((sessionId) => closeSession(sessionId)));
    }
  };
}
```

The deprecated SDK imports are confined to this file. In particular, do not cast `SSEServerTransport` to a beta.4 `Transport` and do not call the beta.4 `buildServer` with it. Catalog exposure and `dispatchCapability` are the shared seams, so read-only, feature, allow-list, timeout, output-validation, and confirmation refusal policy remain authoritative.

- [ ] **Step 4: Dynamically mount compatibility without replacing `/mcp`**

In `src/http/runtime.ts`, replace the authentication and route-mounting block with:

```ts
const authentication = bearerAuthentication(http.token);
app.use(exactOriginValidation(http.allowedOrigins));
app.use(enforceHttpLimits());
const legacySse = http.legacySseEnabled
  ? (await import('./legacy-sse.js')).mountLegacySseCompatibility(
      app,
      application,
      authentication,
      onerror
    )
  : { close: () => Promise.resolve() };
app.use('/mcp', authentication);
app.all('/mcp', (request, response) => {
  void nodeHandler(request, response, request.body);
});
```

Then replace the beginning of `HttpRuntime.close` with:

```ts
close: async () => {
  await legacySse.close();
  await handler.close();
```

Keep the existing listener-close promise after those two lines. `runtime.url` remains `/mcp`, proving Streamable HTTP has not been replaced.

- [ ] **Step 5: Add the explicit pre-release dependency-drift gate**

Create `scripts/check-legacy-sse-dependency.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const document = JSON.parse(await readFile('package.json', 'utf8'));
const pinned = document.dependencies?.['@modelcontextprotocol/sdk'];
if (pinned !== '1.29.0') {
  throw new Error('Deprecated SSE dependency is not at its reviewed exact pin.');
}

const { stdout } = await execFileAsync(
  'npm',
  ['view', '@modelcontextprotocol/sdk', 'dist-tags.latest', '--json'],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 }
);
const latest = JSON.parse(stdout);
if (latest !== pinned) {
  throw new Error('Deprecated SSE dependency drifted; re-review or remove compatibility.');
}
```

Add this exact script to `package.json`:

```json
"release:check:legacy-sse": "node scripts/check-legacy-sse-dependency.mjs"
```

Also add this assertion to the package contract test:

```ts
expect(document.scripts['release:check:legacy-sse']).toBe(
  'node scripts/check-legacy-sse-dependency.mjs'
);
```

- [ ] **Step 6: Run focused, static, regression, and current drift gates**

Run:

```bash
npx vitest run tests/http/legacy-sse.test.ts tests/http/runtime.test.ts \
  tests/foundation/package-contract.test.ts
npm run typecheck
npm run lint
npm test
npm run release:check:legacy-sse
```

Expected: default-off returns 404 without affecting `/mcp`; all legacy route guard checks return their specified statuses; the ninth open SSE session returns 503; the v1 test client lists and calls the same policy-backed `server_status`; the four beta.4 packages and isolated SDK 1.29.0 remain exact; all deterministic gates pass; and the registry still reports 1.29.0 as the sole `latest` tag.

Before any public release, rerun `npm run release:check:legacy-sse` and `npm audit --omit=dev`, inspect whether beta.4's stable replacement has gained an approved compatibility mechanism, and either remove this adapter or explicitly re-approve its exact pin. This networked release check does not become part of offline `npm run verify`.

- [ ] **Step 7: Commit deprecated compatibility atomically**

```bash
git add package.json package-lock.json scripts/check-legacy-sse-dependency.mjs \
  src/http/legacy-sse.ts src/http/runtime.ts tests/http/legacy-sse.test.ts \
  tests/foundation/package-contract.test.ts
git commit -m "feat: add isolated legacy SSE compatibility"
```

### Task 8: Make official 2025 and draft 2026 conformance executable

**Files:**
- Create: `scripts/run-conformance.mjs`
- Modify: `package.json`

**Interfaces:**
- `node scripts/run-conformance.mjs 2025-11-25` runs official `server-initialize`, `ping`, and `tools-list` scenarios against the real product server.
- `node scripts/run-conformance.mjs 2026-07-28` runs official `tools-list` at the draft revision against the real product server.
- The harness binds the real factory to an ephemeral loopback port, passes no expected-failure file, propagates every non-zero exit, and always closes both handler and listener.

- [ ] **Step 1: Prove the conformance entry is absent**

Run:

```bash
npm run build
node scripts/run-conformance.mjs 2025-11-25
```

Expected: FAIL with module-not-found because the runner is not created yet.

- [ ] **Step 2: Create the exact official conformance runner**

Create `scripts/run-conformance.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createApplicationContext } from '../dist/app/application-context.js';
import { loadRuntimeConfig } from '../dist/config/runtime-config.js';
import {
  configureNodeHttpLimits,
  DEFAULT_HTTP_LIMITS,
  enforceHttpLimits
} from '../dist/http/limits.js';
import { exactOriginValidation } from '../dist/http/origin.js';
import { createServerFactory } from '../dist/mcp/server-factory.js';

const version = process.argv[2];
if (version !== '2025-11-25' && version !== '2026-07-28') {
  throw new Error('Usage: node scripts/run-conformance.mjs 2025-11-25|2026-07-28');
}

const application = createApplicationContext(
  loadRuntimeConfig({ READ_ONLY: 'true', MCP_REQUEST_STATE_SECRET: '0'.repeat(32) })
);
const handler = createMcpHandler(createServerFactory(application, 'http'), {
  legacy: 'stateless',
  maxSubscriptions: DEFAULT_HTTP_LIMITS.maxSubscriptions,
  onerror: (error) => process.stderr.write(`Conformance host error: ${error.name}\n`)
});
const nodeHandler = toNodeHandler(handler, {
  onerror: (error) => process.stderr.write(`Conformance adapter error: ${error.name}\n`)
});
const app = createMcpExpressApp({
  host: '127.0.0.1',
  allowedHosts: ['127.0.0.1', 'localhost'],
  allowedOrigins: [],
  jsonLimit: DEFAULT_HTTP_LIMITS.jsonBodyLimit
});
app.use(exactOriginValidation([]));
app.use(enforceHttpLimits());
app.all('/mcp', (request, response) => void nodeHandler(request, response, request.body));
let server;

function listen() {
  return new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => {
      server = listening;
      resolve();
    });
    configureNodeHttpLimits(listening);
    listening.once('error', reject);
  });
}

function closeServer() {
  return new Promise((resolve, reject) => {
    if (server === undefined) resolve();
    else server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

const scenarios =
  version === '2025-11-25'
    ? ['server-initialize', 'ping', 'tools-list']
    : ['tools-list'];

async function runScenario(url, scenario) {
  const executable = fileURLToPath(
    new URL('../node_modules/@modelcontextprotocol/conformance/dist/index.js', import.meta.url)
  );
  const args = [
    executable,
    'server',
    '--url',
    url,
    '--scenario',
    scenario,
    '--spec-version',
    version,
    '--verbose'
  ];
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal !== null) reject(new Error(`Conformance terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
  if (exitCode !== 0) {
    throw new Error(`Conformance ${version}/${scenario} exited ${exitCode}`);
  }
}

await listen();
try {
  const address = server?.address();
  if (address === undefined || address === null || typeof address === 'string') {
    throw new Error('Conformance listener did not expose a TCP address.');
  }
  const url = `http://127.0.0.1:${address.port}/mcp`;
  for (const scenario of scenarios) await runScenario(url, scenario);
} finally {
  await handler.close();
  await closeServer();
}
```

This loopback listener is deliberately test-only. It still applies the product exact-Origin and finite HTTP limits, but omits bearer authentication solely because the official conformance process has no token option. Product HTTP continues to go through `startHttp` and therefore cannot bypass authentication, Host validation, exact-Origin validation, or limits.

- [ ] **Step 3: Ensure every conformance script builds first**

Replace the three conformance scripts in `package.json` with:

```json
"test:conformance:2025": "npm run build && node scripts/run-conformance.mjs 2025-11-25",
"test:conformance:2026": "npm run build && node scripts/run-conformance.mjs 2026-07-28",
"test:conformance": "npm run test:conformance:2025 && npm run test:conformance:2026"
```

- [ ] **Step 4: Run all four targeted official invocations without a baseline**

Run:

```bash
npm run test:conformance:2025
npm run test:conformance:2026
```

Expected: all four scenario invocations report zero failures and warnings; both commands exit `0`; no invocation uses `--suite`, `--force`, or `--expected-failures`. This is targeted interoperability evidence against the product surface, not full-suite conformance.

- [ ] **Step 5: Re-run deterministic gates**

Run:

```bash
npm run verify
git diff --check
```

Expected: all deterministic tests and static checks pass; whitespace validation exits `0`.

- [ ] **Step 6: Commit executable protocol evidence atomically**

```bash
git add package.json scripts/run-conformance.mjs
git commit -m "test: enforce MCP v2 conformance"
```

### Task 9: Author initial foundation docs, add CI, and verify the foundation

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `tests/foundation/documentation.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- README and CONTRIBUTING are new, independently authored foundation documents, not migrated artifacts. They distinguish implemented foundation facts from future firewall integration and name the beta-to-stable publication gate; Guided Task 8 later expands and finalizes them under its provenance and full-product evidence contract.
- CONTRIBUTING gives one deterministic local sequence and one explicit protocol sequence for this foundation phase.
- CI runs Node 22.19 deterministic gates first, then official 2025 and draft 2026 protocol gates with no baseline.

- [ ] **Step 1: Write the documentation contract test first**

Create `tests/foundation/documentation.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('foundation documentation', () => {
  it('states the implemented safety and protocol evidence boundaries', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme).toContain('No firewall mutation capability is registered');
    expect(readme).toContain('2025-11-25');
    expect(readme).toContain('2026-07-28');
    expect(readme).toContain('2.0.0-beta.4');
    expect(readme).toContain('repinned to one stable MCP v2 release');
    expect(readme).toContain('AGPL-3.0-or-later');
    expect(readme).toContain('exact serialized origin');
    expect(readme).toContain('Deprecated SSE compatibility is disabled by default');
  });

  it('publishes copyable contributor gates', async () => {
    const contributing = await readFile('CONTRIBUTING.md', 'utf8');
    for (const command of [
      'npm ci',
      'npm run verify',
      'npm run test:conformance',
      'git diff --check'
    ]) {
      expect(contributing).toContain(command);
    }
  });
});
```

- [ ] **Step 2: Run the contract and verify the red state**

Run:

```bash
npx vitest run tests/foundation/documentation.test.ts
```

Expected: FAIL because README and CONTRIBUTING do not exist.

- [ ] **Step 3: Write an evidence-bounded README**

Create `README.md`:

````markdown
# OPNsense MCP

A safety-first Model Context Protocol server foundation for guided OPNsense administration.

## Current scope

This foundation provides one read-only `server_status` tool, pedagogical prompts, a closed capability catalog, centralized policy checks, dual-era stdio, primary opt-in Streamable HTTP, and isolated deprecated-SSE compatibility. No firewall mutation capability is registered. Firewall reads and writes are added only after their independent adapters, backup rules, audit rules, VM tests, and recovery checks exist.

The default is `READ_ONLY=true`. A caller cannot enable a capability by inventing its name or by passing a confirmation boolean: exposure comes from the catalog, and confirmation state is signed and checked by the server.

## Run locally

Requirements: Node.js 22.19.0 or newer within major 22, and npm.

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
npm ci
npm run build
npm start
```

`npm start` is a stdio MCP process. Configure an MCP client to run `node dist/main.js` with this repository as its working directory. The server instructions ask the agent to explain concepts in plain language, clarify ambiguity, investigate read-only first, and obtain exact confirmation before any future mutation.

HTTP is an explicit local-development option:

```bash
MCP_HTTP_ENABLED=true \
MCP_HTTP_TOKEN=0123456789abcdef0123456789abcdef \
npm run start:http
```

HTTP binds to loopback, validates Host, applies finite body/request/stream/session limits, and requires the bearer token. Non-browser clients may omit Origin. Browser Origin access is denied by default; `MCP_ALLOWED_ORIGINS` accepts only comma-separated exact serialized origin values including scheme, host, and port, for example `https://console.example:8443`. A same-host value with another scheme or port is not equivalent. This is not a remote deployment endpoint.

Deprecated SSE compatibility is disabled by default. `MCP_LEGACY_SSE_ENABLED=true` adds authenticated `GET /sse` and `POST /messages` on the same hardened loopback listener without replacing Streamable HTTP at `/mcp`. It exists only for migration and must be re-reviewed or removed before release.

## Discoverable prompts

- `diagnose_network_problem`: turn a simple symptom into a read-only investigation.
- `publish_internal_service`: clarify and prepare an internal DNS, certificate, and HAProxy plan without applying it.
- `block_domain_for_device`: clarify and prepare a device-scoped DNS block without broadening it to the whole network.

Prompts guide an MCP client; they are not authorization and they do not bypass policy.

## Tested evidence

```bash
npm run verify
npm run test:conformance
```

`npm run verify` runs formatting, lint, strict TypeScript, the JavaScript/TypeScript AGPL header gate, build, and deterministic Vitest tests. `npm run test:conformance` runs four targeted official invocations: `server-initialize`, `ping`, and `tools-list` at `2025-11-25`, then `tools-list` at draft `2026-07-28`. There is no expected-failure baseline. This is targeted interoperability evidence, not full-suite conformance.

The MCP packages are deliberately pinned to `2.0.0-beta.4` for this foundation. Before public package publication, all MCP packages must be repinned to one stable MCP v2 release and every deterministic and conformance gate must pass again.

The isolated deprecated-SSE adapter pins `@modelcontextprotocol/sdk@1.29.0` exactly. Before release run `npm run release:check:legacy-sse` and `npm audit --omit=dev`, then decide explicitly whether compatibility can be removed.

## License

AGPL-3.0-or-later. See `LICENSE`.
````

- [ ] **Step 4: Write the exact contributor workflow**

Create `CONTRIBUTING.md`:

````markdown
# Contributing

Use Node.js 22.19.0 or newer within major 22. Never test against a production firewall. This foundation has no firewall adapter; future live tests must use a disposable, explicitly selected local VM.

## Install and deterministic verification

From the repository root:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
node --version
npm ci
npm run verify
git diff --check
```

The Node version must satisfy `>=22.19 <23` and every command must exit `0`.

## Protocol verification

```bash
npm run test:conformance:2025
npm run test:conformance:2026
```

The first command runs targeted `server-initialize`, `ping`, and `tools-list` scenarios at `2025-11-25`. The second runs targeted `tools-list` at draft `2026-07-28`. Do not introduce an expected-failure baseline or describe these four invocations as a full suite.

## Change discipline

1. Add a focused failing test for the behavior.
2. Make the smallest implementation change that passes it.
3. Run the focused test, then `npm run verify`.
4. Run protocol conformance for any server, schema, prompt, or transport change.
5. Commit one coherent change with no generated output, secret, or local result directory.

Every JavaScript and TypeScript source begins with `// SPDX-License-Identifier: AGPL-3.0-or-later`.

`npm run license:check` enforces those source headers. The later provenance workflow owns the broader release-tree and history scan; do not treat the source-header check as provenance evidence.
````

- [ ] **Step 5: Run the documentation contract**

Run:

```bash
npx vitest run tests/foundation/documentation.test.ts
```

Expected: two documentation tests pass.

- [ ] **Step 6: Add pinned Node 22.19.0 CI with separate deterministic and protocol jobs**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  deterministic:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.19.0
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run verify
      - run: git diff --check

  protocol:
    needs: deterministic
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 22.19.0
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run test:conformance
```

- [ ] **Step 7: Run the complete local release gate**

Run exactly:

```bash
npm ci --ignore-scripts
npm run verify
npm run test:conformance
git diff --check
git status --short
```

Expected:
- dependency installation exits `0` under Node 22.19.0;
- formatting, lint, typecheck, build, and all Vitest tests pass;
- the four targeted official invocations report zero failures and warnings;
- whitespace validation exits `0`;
- `git status --short` lists only the four files created by this task before commit.

- [ ] **Step 8: Commit docs and CI atomically**

```bash
git add README.md CONTRIBUTING.md tests/foundation/documentation.test.ts \
  .github/workflows/ci.yml
git commit -m "docs: define MCP foundation evidence"
```

- [ ] **Step 9: Verify a clean, reproducible final state**

Run:

```bash
npm ci --ignore-scripts
npm run verify
npm run test:conformance
git diff --check
git status --short
```

Expected: every command exits `0`, all four targeted protocol invocations remain clean, and `git status --short` prints nothing.

The implementation is ready for a separate firewall-adapter plan only after this final state is reproduced. Public package publication remains blocked until the four MCP v2 beta pins are changed together to one stable release, the isolated legacy `@modelcontextprotocol/sdk@1.29.0` pin is removed or explicitly re-approved after its drift/audit gate, Guided Task 8 finalizes the independently authored public docs, and the same final state is reproduced again.
