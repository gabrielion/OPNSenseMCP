# MCP v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a safe, strictly typed MCP v2 foundation with a closed capability catalog, a fail-closed policy kernel, pedagogical MCP guidance, dual-era stdio and hardened Streamable HTTP, and executable conformance evidence for MCP `2025-11-25` and draft `2026-07-28`.

**Architecture:** A transport-neutral `buildServer(application, transport): McpServer` factory registers every primary v2 tool from one typed capability catalog and routes every call through one closed policy kernel. The handler vault and one-shot confirmation ledger are lexical kernel authorities and are not package exports. Stdio uses the dual-era `serveStdio` factory entry, HTTP uses `createMcpHandler` through the official Node adapter on a direct Express application, and signed request state carries only a kernel-issued confirmation challenge across protocol rounds without trusting caller booleans. One default-off compatibility module owns all deprecated v1 SSE server and transport types; it re-registers only catalog metadata and calls the same transport-neutral dispatch facade, never passing a v1 transport to a v2 server. The foundation exposes only a read-only server status capability; mutation fixtures exist only under `tests/` until backup and audit enforcement are present.

**Tech Stack:** Node.js 22.19.0, TypeScript 5.9.3 strict ESM, Zod 4.2.0, `@modelcontextprotocol/server@2.0.0-beta.4`, `@modelcontextprotocol/client@2.0.0-beta.4` for tests, `@modelcontextprotocol/node@2.0.0-beta.4`, isolated deprecated-SSE compatibility through `@modelcontextprotocol/sdk@1.29.0`, Express 5.2.1, Vitest 4.1.10, official MCP conformance `0.2.0-alpha.9`.

## Global Constraints

- Every project file is AGPL-3.0-or-later; every TypeScript and JavaScript source file has `// SPDX-License-Identifier: AGPL-3.0-or-later` as its first line, or as its first non-shebang line for an executable.
- Runtime and CI use Node.js `22.19.0` or newer within major 22; `package.json` rejects versions outside `>=22.19 <23`.
- The current workstation's default Node is outside the supported major. Before executing any local command block in this plan, prepend `/opt/homebrew/opt/node@22/bin` when it exists and run the version assertion in Task 1; never treat a Node 26 result as foundation evidence.
- Pin `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and `@modelcontextprotocol/node` exactly to `2.0.0-beta.4`; use no range or dist-tag.
- Pin the deprecated compatibility-only `@modelcontextprotocol/sdk` exactly to `1.29.0` when Task 7b adds it. Only `src/http/legacy-sse.ts` and its focused test may import that package; all primary MCP imports remain the official beta.4 packages above.
- Treat that beta pin as a foundation-only interoperability target. Before any public package publication, replace all three pins with the same stable MCP v2 release, regenerate the lockfile, and rerun every deterministic and conformance gate in this plan.
- Pin Zod exactly to `4.2.0`; import it as `zod/v4` and pass complete Standard Schema objects such as `z.object(...)`.
- Keep `exactOptionalPropertyTypes` enabled. When a value may be absent, omit the optional key with a conditional spread as shown in the snippets; never materialize an absent optional property with an undefined value.
- Import no symbol from `@modelcontextprotocol/core-internal`.
- `buildServer(application, transport): McpServer` is the only primary beta.4 MCP assembly point. The sole exception is Task 7b's isolated deprecated-SSE v1 adapter, which may import only shared catalog metadata and `dispatchCapability`; capability handlers import no MCP transport type and v1 objects never cross into the v2 server.
- Stdio is the default executable path and uses `serveStdio`; production Streamable HTTP uses
  `createMcpHandler` plus `toNodeHandler` on a plain Express application so project Host, exact-Origin,
  body, and authentication middleware run in the required order. The optional Express helper package is
  intentionally not installed because its preinstalled middleware does not preserve the stricter exact
  Host -> exact serialized Origin -> shutdown admission gate -> bounded body -> authentication order.
- The capability catalog is closed: undeclared, hidden, disabled, transport-incompatible, and read-only-forbidden calls fail before a handler runs.
- The foundation registers no local-write or firewall-write product capability. Mutation execution remains unavailable until strict backup and audit gates are implemented in a separately reviewed plan.
- MCP instructions and prompts guide behavior but never authorize a change. Form elicitation is used only when the client advertises it, and missing support fails closed.
- Request state is HMAC-protected with the SDK `createRequestStateCodec`, expires after 300 seconds, and is bound to the MCP method plus authenticated client identity when present.
- HTTP is disabled by default, binds only to `127.0.0.1` or `localhost`, validates Host, applies an exact serialized-Origin allow-list before authentication and MCP routing, requires a 32-character bearer token, and never logs that token. Browser Origin access defaults to an empty allow-list; a configured entry includes scheme, host, and port.
- Streamable HTTP remains the primary HTTP transport. Deprecated SSE compatibility is isolated behind `MCP_LEGACY_SSE_ENABLED=true`, is off by default, and shares the same bearer, Host, exact-Origin, policy, body, request, stream, session, concurrency, and time limits.
- Source-header enforcement is available from Task 1 as `npm run license:check`. It is intentionally scoped to JavaScript and TypeScript source headers; the later provenance plan owns the release-tree/history-wide license, lineage, and forbidden-expression scan.
- Use only real Vitest 4 matchers: catch an error and apply `toMatchObject` when structured error fields are needed. For a Zod IP union use `z.union([z.ipv4(), z.ipv6()])`. Build TypeScript and execute the emitted JavaScript with Node; do not add an on-the-fly TypeScript runner.
- Conformance runs have no expected-failure baseline and must pass the six official targeted invocations named in Task 8 against the real product server; never describe that gate as full-suite conformance.
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
│   │   ├── exposure.ts                      # Shared allow-list predicate
│   │   ├── foundation/server-status.ts      # Only product capability in this phase
│   │   ├── kernel.ts                        # Closed handler/policy/confirmation authority
│   │   └── types.ts                         # Pure capability and policy contracts
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
│       └── canonical-json.ts                # Stable argument digest
├── tests/
│   ├── architecture/execution-boundary.test.ts
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
│   ├── security/canonical-json.test.ts
│   └── security/policy-kernel.test.ts
├── tsconfig.build.json
├── tsconfig.json
└── vitest.config.ts
```

The dependency direction is fixed:

```text
entrypoints/http ─┐
entrypoints/stdio ├─> server-factory -> build-server -> register-capabilities -> dispatch
tests             ┘                         │                    │            │
                                           prompts             catalog      kernel -> handlers
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
- Produces: `FeatureFlag`, `RuntimeConfig`, and `loadRuntimeConfig(env?: NodeJS.ProcessEnv): RuntimeConfig` for the catalog, policy kernel, request-state codec, and HTTP entry.

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

### Task 4: Enforce a closed policy kernel before every handler

**Files:**
- Create: src/capabilities/exposure.ts
- Create: src/capabilities/kernel.ts
- Create: src/security/canonical-json.ts
- Create: tests/security/canonical-json.test.ts
- Create: tests/security/policy-kernel.test.ts
- Create: tests/architecture/execution-boundary.test.ts
- Modify: src/capabilities/types.ts
- Modify: src/capabilities/catalog.ts
- Modify: src/capabilities/foundation/server-status.ts
- Modify: tests/fixtures/capabilities.ts
- Modify: tests/capabilities/catalog.test.ts

**Interfaces:**
- Consumes: CapabilityCatalog, CapabilityDefinition metadata, RuntimeConfig, FeatureFlag, and
  TransportKind.
- Produces internally: defineCapability(), createCapabilityDispatcher(), the handler vault, the
  bounded confirmation ledger, and the adapter-only confirmation-completion closure.
- Produces as transport-neutral contracts: CapabilityRequest, CapabilityInvocationContext,
  package-internal CapabilityDispatcher, CapabilityResult, ConfirmationChallenge, RefusalCode,
  canonicalJson(), and sha256Json(). Task 6 binds the dispatcher to an opaque ApplicationContext and adds
  the sole package-root dispatchCapability(request, context) facade.
- The root must not export a dispatcher object/constructor, raw handler invoker, handler vault,
  confirmation mint, settlement closure, or policy options.

The handler vault, defineCapability(), dispatcher implementation, and confirmation ledger live together in
src/capabilities/kernel.ts. Moving them into one lexical module is intentional: no importable function may
invoke a handler without traversing the policy checks. CapabilityDefinition remains immutable metadata and
contains no handler, resolver, service, confirmation authority, or mutable policy field.

- [ ] **Step 1: Write canonical-JSON and exposure tests first**

Create tests/security/canonical-json.test.ts. Cover all of these cases:

- recursively sort object keys with the JavaScript UTF-16 code-unit relational order, including
  numeric-looking keys, nested objects, a BMP key, and an astral key; never use localeCompare();
- produce the same SHA-256 digest for semantically identical objects inserted in different orders;
- preserve dense array order;
- reject top-level and nested sparse arrays by checking every index with Object.hasOwn();
- reject undefined, bigint, symbol, function, NaN, positive/negative Infinity, Date, class instances,
  accessors, symbol keys, non-enumerable fields, cyclic references, and arrays with extra properties;
- reject depth greater than 64, more than 10000 serialized nodes, or more than 262144 UTF-8 bytes before
  building an unbounded result;
- accept only null, booleans, strings, finite numbers, dense arrays, and enumerable data properties on
  Object.prototype/null-prototype records;
- prove canonicalization errors never include the rejected value.

Implement src/capabilities/exposure.ts with one shared predicate:

~~~ts
export function areDeclaredResourceScopesAllowed(
  scopes: readonly string[],
  allowed: ReadonlySet<string> | null
): boolean {
  return allowed === null || (scopes.length > 0 && scopes.every((scope) => allowed.has(scope)));
}
~~~

Modify CapabilityCatalog.listExposed() to use that exact predicate. With an active allow-list, an empty
declared scope is hidden and every declared scope must be allowed. With no allow-list, an empty scope remains
eligible for the other gates. Add catalog tests for allowed, partially allowed, disallowed, and empty scopes.
Direct dispatch must later call the same predicate, so listing and execution cannot drift.

Run:

~~~bash
npx vitest run tests/security/canonical-json.test.ts tests/capabilities/catalog.test.ts
~~~

Expected: RED for the missing canonical and exposure modules, not for a fixture or import error.

- [ ] **Step 2: Specify the pure contracts and closed definition boundary**

Refactor src/capabilities/types.ts into pure types only. It must not contain a WeakMap, handler, invoker, or
definition factory. Keep the existing metadata vocabulary and add these transport-neutral shapes:

~~~ts
export interface CapabilityRequest {
  readonly name: string;
  readonly arguments: unknown;
}

export interface CapabilityInvocationContext {
  readonly transport: TransportKind;
  readonly signal?: AbortSignal;
  readonly principalId?: string;
}

export interface ConfirmationChallenge {
  readonly confirmationId: string;
  readonly capabilityId: string;
  readonly argumentsSha256: string;
  readonly expiresAt: string;
}

export type RefusalCode =
  | 'CANCELLED'
  | 'CONFIRMATION_DECLINED'
  | 'CONFIRMATION_INVALID'
  | 'CONFIRMATION_UNAVAILABLE'
  | 'EXECUTION_FAILED'
  | 'FEATURE_DISABLED'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'INVALID_POLICY'
  | 'OUTCOME_INDETERMINATE'
  | 'READ_ONLY'
  | 'RESOURCE_NOT_ALLOWED'
  | 'TIMEOUT'
  | 'UNKNOWN_CAPABILITY'
  | 'UNSUPPORTED_TRANSPORT';

export type CapabilityResult =
  | { readonly kind: 'success'; readonly output: Record<string, unknown> }
  | { readonly kind: 'confirmation-required'; readonly challenge: ConfirmationChallenge }
  | { readonly kind: 'refused'; readonly code: RefusalCode; readonly message: string };

export interface CapabilityDispatcher {
  listExposed(transport: TransportKind): readonly CapabilityDefinition[];
  dispatch(
    request: CapabilityRequest,
    context: CapabilityInvocationContext
  ): Promise<CapabilityResult>;
}
~~~

CapabilityDispatcher is exported only from its source module for internal composition and tests; src/index.ts
must not re-export it. Keep package.json exports exactly { ".": ... }; internal source paths are not package
subpath exports.

Move TypedCapabilityDefinition, defineCapability(), and the private handler WeakMap from types.ts into
src/capabilities/kernel.ts. Update server-status.ts and test fixtures to import defineCapability() from the
kernel. Validate definition.policy.timeoutMs synchronously as an integer in the inclusive range 1..300000.
At definition time, capture the input schema, output schema, their bound parser functions, and handler into
lexical constants before constructing or returning anything; no stored closure may dereference the mutable
caller-owned definition object later. Copy and freeze all caller-owned arrays/metadata exactly as Task 3
already requires. Reassigning the source object's handler, either schema, annotations, policy, or nested
arrays after defineCapability() must have no effect on parsing, metadata, or execution. Before invoking a
handler, defensively revalidate the timeout so a structurally forged catalog entry yields sanitized
INVALID_POLICY rather than a thrown RangeError or an unbounded call.

This capture boundary protects against mutable declaration containers and adapter/request bypasses; it is
not an isolation boundary for executable code already loaded into the server process. Capability modules,
handlers, Zod schema graphs, refinements/transforms, and callback closure state are trusted static startup
code and must not be mutated after definition. Arbitrary Zod schemas cannot be faithfully snapshotted into
an immutable parser: cloning is shallow, lazy/cached internals are undocumented, and callbacks retain
mutable lexical state. The rebuilt server therefore loads no dynamic third-party capability code. If that
becomes a future requirement, it needs a separate process plus a validated, callback-free declarative
schema language rather than in-process Zod objects.

The kernel also records every returned definition in a private WeakSet. Export one source-internal predicate
isKernelDefinedCapability() for CapabilityCatalog construction only; it conveys no handler authority.
CapabilityCatalog rejects any structural/spread/forged definition before indexing it. The architecture test
allows only catalog.ts to import that predicate. Update the Task 3 duplicate-name fixture to create a second
sealed definition through defineCapability() instead of spreading an existing definition. Likewise replace
every existing catalog test that currently spreads a definition to alter transports, feature flags, or
resource scopes with a fixture factory that creates a new sealed definition through defineCapability(); no
positive-path test may normalize forgery by inserting a structural clone. Keep one explicit negative test
that proves such a spread is rejected.

Add tests proving NaN, Infinity, -1, 0, 1.5, and 300001 are rejected while 1 and 300000 are accepted. Prove
the real catalog rejects an unsealed structural definition. Then inject a test-only structural catalog view
that returns malformed timeout metadata and prove dispatch still returns INVALID_POLICY without throwing or
invoking any handler. Retain a mutable source definition object in a test, replace its handler and both schema
fields after defineCapability(), mutate its metadata/arrays, and prove the sealed capability still uses only
the captured original parser/handler and copied metadata.

- [ ] **Step 3: Write the adversarial kernel tests before implementation**

Create tests/security/policy-kernel.test.ts. A helper may call the internal
createCapabilityDispatcher(catalog, options, installCompletion?, testRuntime?) factory, but production
package exports must not expose that factory. The factory consumes a minimal type-only CapabilityCatalogView
with getByMcpName() and listExposed(); CapabilityCatalog is its production implementation, while one focused
test view supplies malformed metadata to prove defensive refusal.

The immutable options are:

~~~ts
interface CapabilityPolicyOptions {
  readonly readOnly: boolean;
  readonly allowedResourceScopes: ReadonlySet<string> | null;
  readonly enabledFeatureFlags: ReadonlySet<FeatureFlag>;
}
~~~

The factory copies both sets, freezes the returned dispatcher, and never exposes its catalog or options as
mutable properties. The test-only runtime dependency object may inject now(), randomBytes(), confirmation
TTL, and ledger capacity; production defaults are Date.now, node:crypto randomBytes, 300000 ms, and 1024
pending challenges. Validate those injected bounds at construction.

Write failing tests for this exact pre-handler order:

1. catalog lookup;
2. transport;
3. read-only;
4. required feature flags;
5. declared resource allow-list via areDeclaredResourceScopesAllowed();
6. pre-aborted caller cancellation;
7. Zod input parsing;
8. canonical argument digest;
9. timeout-policy validation;
10. confirmation issuance/validation when declared;
11. handler invocation;
12. Zod output parsing.

Every refusal before step 10 asserts that the handler was not called. Mutate the caller-owned option sets
after construction and prove listing/dispatch retains the copied state. Prove Object.isFrozen(dispatcher)
and that no catalog/options/handler property is reachable from it.

Cover at least:

- unknown name -> UNKNOWN_CAPABILITY;
- unsupported transport -> UNSUPPORTED_TRANSPORT;
- write in read-only mode -> READ_ONLY;
- missing feature -> FEATURE_DISABLED;
- active allow-list with empty, partially allowed, or disallowed declared scopes ->
  RESOURCE_NOT_ALLOWED;
- pre-aborted caller -> CANCELLED without allocating a confirmation challenge;
- malformed input or schema transform to Date -> INVALID_INPUT;
- invalid output -> INVALID_OUTPUT;
- handler error containing a sentinel secret -> EXECUTION_FAILED with no sentinel in any result;
- malformed timeout metadata -> INVALID_POLICY;
- all refusal messages are fixed literals and contain no supplied argument, schema issue, secret, or
  downstream exception text.

Parsing never hands a Zod-returned reference directly to a resolver or handler. Immediately after a
successful parse, canonicalize the normalized value once, compute the digest from those exact canonical
UTF-8 bytes, parse those same bytes into a fresh plain JSON tree, and deeply freeze that tree. Resolvers and
handlers receive only this canonical snapshot. This deliberately normalizes representations that canonical
JSON treats as equal (including `-0` to `0`), so two equal digests cannot produce observably different
handler inputs. Repeated aliases are materialized as independent JSON subtrees. Test mutation of nested
`z.unknown()`/`z.any()` values before and after handler startup, source-object/schema/handler replacement,
aliasing, and `Object.is(value, -0)`.

The operation runner accepts a thunk, not an already-started Promise. It checks caller cancellation before
installing listeners, installs caller and timeout listeners, rechecks cancellation, and only then calls the
handler thunk inside try/catch. The first observed abort stores a private typed cause and wins permanently.
Use a cancellable injected/setTimeout timer plus an internal AbortController rather than an uncollectable
AbortSignal.timeout timer. Clean every listener and clear the timer on success, synchronous throw, rejected
Promise, caller cancellation, and timeout.

Abort completion is effect-aware. Before handler entry every effect may return CANCELLED. After handler
entry, a read may return CANCELLED/TIMEOUT promptly and safely observe any late read rejection. A
local-write or firewall-write must never return while its handler can still produce a late side effect: the
kernel aborts the internal signal, then awaits the handler's settlement. If abort/timeout won the race, the
eventual value/error is discarded and the fixed result is OUTCOME_INDETERMINATE. Therefore `timeoutMs` is a
cancellation deadline, not a false hard-stop claim for an in-flight write. A non-cooperative write that never
settles leaves dispatch pending; downstream product code must use bounded transport operations and retain its
lock/audit/backup ownership until settlement. Product Task 5 adds audited reconciliation semantics for this
code. No timer/listener is cleaned before the late write promise settles.

Add deterministic cancellation tests:

- a pre-aborted caller signal returns CANCELLED and the handler is never invoked;
- for a read fixture, caller-first returns CANCELLED even if the timeout later fires;
- for a read fixture, timeout-first returns TIMEOUT even if the caller later aborts;
- a read and a write handler waiting on context.signal both observe abortion with their distinct result
  semantics;
- a write handler that ignores context.signal and performs a delayed side effect cannot outlive the dispatch
  result: dispatch stays pending, then returns OUTCOME_INDETERMINATE only after handler settlement;
- the same ignored-signal fixture proves no side effect occurs after the result and no success/output leaks;
- listener counts return to baseline on every path;
- fake-timer counts return to zero on every path;
- synchronous throw and Promise rejection containing different sentinel secrets both become sanitized
  EXECUTION_FAILED;
- no timer/listener race can turn a genuine handler exception into TIMEOUT or CANCELLED.

Use fake timers or injected controllable AbortSignals; never rely on wall-clock sleeps.

Implement steps 1–9 once in a private synchronous authorizeRequest() helper that returns the sealed
definition, fresh deeply frozen canonical input snapshot, canonical argument digest computed from that same
snapshot string, and a frozen effectiveResourceScopes array.
Both initial dispatch and accepted/declined settlement call this same helper; neither copies the gates.
Foundation effective scopes equal the declared scopes. With an active allow-list they must be non-empty and
all allowed; with no allow-list an empty declaration may pass. Product Task 5 extends this single helper with
its sealed dynamic resolver rather than adding a second authorization path.

- [ ] **Step 4: Implement canonical hashing and the closed kernel**

Implement src/security/canonical-json.ts without JSON-object locale sorting and without Array.map() over
unvalidated arrays. Iterate dense indices with a for loop, inspect property descriptors, and recurse with an
ancestor stack so cycles fail deterministically while repeated non-cyclic references serialize normally.
Track depth, serialized node count, and cumulative UTF-8 byte count against the exact limits above before
concatenating an unbounded result. Provide an internal canonical-snapshot helper that parses the completed
canonical string into a fresh plain JSON tree and recursively freezes it; hashing and execution consume that
same completed string, never two serializations. Wrap input snapshot failures as INVALID_INPUT and
post-schema output snapshot failures as INVALID_OUTPUT.

Implement src/capabilities/kernel.ts with these private authorities:

- capabilityHandlers: WeakMap<CapabilityDefinition, handler>;
- kernelDefinedCapabilities: WeakSet<CapabilityDefinition>;
- pendingConfirmations: Map<string, PendingConfirmation> owned by each dispatcher;
- a private invoke function that is never exported;
- a private abort-cause type;
- the operation thunk/cleanup helper;
- the static refusal constructor.

No file named verified-confirmation.ts and no VerifiedConfirmation type or mint function may exist.

For a capability whose policy.confirmation is elicitation, the first valid dispatch must not invoke the
handler. It creates a cryptographically random 32-byte base64url confirmationId, records a private pending
entry, and returns only a deeply frozen primitive challenge. The pending entry binds:

- confirmationId;
- capability ID and MCP name;
- canonical argument digest;
- frozen effective resource scopes used by the authorization decision;
- transport;
- principalId, including the explicit absence of one;
- expiry;

Do not retain normalized input or raw arguments in the ledger. On accepted completion, reparse the repeated
arguments and use that fresh normalized value only after its canonical digest matches the pending digest.

Prune expired entries before capacity checks. Refuse with CONFIRMATION_UNAVAILABLE if the bounded ledger is
full or a unique ID cannot be allocated after exactly four attempts. Never evict an unexpired challenge
to admit another one.

The dispatcher factory accepts an optional installation callback that receives one adapter settlement
closure. That closure is adapter authority and remains outside CapabilityDispatcher. It accepts an exact
decision (accept or decline), claims (confirmationId, capabilityId, argumentsSha256), the repeated
CapabilityRequest, and the current CapabilityInvocationContext. For either decision it must synchronously,
before its first await and before handler startup:

1. locate the pending entry; an unknown ID changes nothing;
2. delete a known entry immediately so every settlement attempt is one-shot, including malformed, expired,
   cross-capability, cross-transport, or cross-principal attempts;
3. validate expiry, capability, digest, MCP name, transport, and principal binding;
4. rerun authorizeRequest() to reparse the repeated arguments and recompute their canonical digest;
5. require an exact effective-scope array match, thereby repeating the current
   transport/read-only/feature/resource gates;
6. execute only the fresh normalized input returned by this settlement's authorizeRequest() call.

Any mismatch returns CONFIRMATION_INVALID, leaves no known challenge reusable, and does not invoke the
handler. A valid decline returns
CONFIRMATION_DECLINED without invoking. Whether the decision is decline or accepted execution succeeds,
fails, times out, is cancelled, or produces invalid output, the deleted confirmation remains consumed.
Sequential and concurrent replay therefore both fail. Confirmation of one request can never authorize
another capability, arguments object, transport, or principal.

After successful output-schema parsing, canonical-snapshot and deeply freeze the output before placing it in
CapabilityResult. Never return a schema-owned or handler-owned reference. Mutation of a nested output after
handler resolution must not alter the result or introduce an unvalidated/sensitive value.

The completion closure is passed only to the MCP adapter during composition in Task 6. It is never attached
to ApplicationContext, ServerContext, CapabilityDispatcher, a definition, the package root, or a global.
The Task 4 test captures it directly only to exercise the security boundary.

Write confirmation tests for:

- challenge format, TTL, and absence of CapabilityDefinition/handler data;
- exact success once;
- exact decline once followed by a rejected replay;
- wrong ID, capability, digest, repeated arguments, transport, and principal;
- mutation of a nested caller-owned object after challenge issuance; settlement hashes and executes only a
  fresh parse and never the mutated first-round reference;
- mutation of repeated arguments after settlement begins and mutation of handler-owned nested output after
  resolution; both returned snapshots remain unchanged and deeply frozen;
- expiration;
- sequential replay;
- two concurrent completion calls, exactly one of which can reach the handler;
- handler failure consumes the challenge;
- ledger capacity and expired-entry pruning;
- no confirmation settlement field on CapabilityRequest, CapabilityInvocationContext, CapabilityDispatcher,
  or any result.

- [ ] **Step 5: Add the architecture gate before application composition**

Create tests/architecture/execution-boundary.test.ts. It reads source/package metadata and fails if:

- invokeCapabilityHandler, VerifiedConfirmation, verifiedConfirmationFromAdapter, or a public confirmation
  property reappears;
- any module outside src/capabilities/kernel.ts declares or reads capabilityHandlers;
- any module other than src/capabilities/catalog.ts imports isKernelDefinedCapability;
- src/index.ts exports CapabilityDispatcher, createCapabilityDispatcher, a settlement closure/type, handler
  authority, policy options, or raw kernel internals;
- package.json adds an internal subpath export;
- a CapabilityDefinition exposes handler, preflight, service, or confirmation authority.

Task 4 adds no execution export at the package root. defineCapability() remains an internal relative import
for capability factories. Task 6 adds the opaque application binding and public free-function facade.

- [ ] **Step 6: Run focused and complete deterministic gates**

Run with Node 22:

~~~bash
npx vitest run \
  tests/security/canonical-json.test.ts \
  tests/security/policy-kernel.test.ts \
  tests/capabilities/catalog.test.ts \
  tests/architecture/execution-boundary.test.ts
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm audit --omit=dev
git diff --check
~~~

Expected: all tests and static gates exit 0; npm audit reports zero production vulnerabilities; no handler
can be reached outside the kernel; allow-list/listing behavior is identical; confirmation replay and
cross-binding tests pass without sleeps; no result contains test secrets.

- [ ] **Step 7: Commit the policy kernel atomically**

~~~bash
git add src/capabilities src/security tests/capabilities \
  tests/security tests/architecture tests/fixtures/capabilities.ts
git commit -m "feat: enforce closed capability policy kernel"
~~~
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

### Task 6: Assemble an opaque application, buildServer, and signed one-shot elicitation

**Files:**
- Create: src/app/application-context.ts
- Create: src/capabilities/dispatch.ts
- Create: src/mcp/results.ts
- Create: src/mcp/confirmation.ts
- Create: src/mcp/register-capabilities.ts
- Create: src/server/build-server.ts
- Create: src/mcp/server-factory.ts
- Create: tests/helpers/connect.ts
- Create: tests/capabilities/dispatch.test.ts
- Create: tests/mcp/factory.test.ts
- Create: tests/mcp/elicitation.test.ts
- Modify: src/capabilities/types.ts
- Modify: tests/architecture/execution-boundary.test.ts
- Modify: src/index.ts

**Interfaces:**
- createApplicationContext(config, catalog?) snapshots runtime policy/secrets, owns one catalog, one closed
  dispatcher, and one one-shot confirmation settlement authority.
- Public ApplicationContext exposes exactly the safe catalog reference. Configuration, HMAC key, HTTP token,
  dispatcher, settlement authority, and future product services live only in a module-private WeakMap.
- dispatchCapability(request, context) is the sole package-root execution facade.
- buildServer(application, transport): McpServer is the only MCP registration point.
- createServerFactory(application, transport): McpServerFactory adapts that function to the v2 beta SDK.
- Signed request state proves SDK round continuity; the kernel ledger remains authoritative for capability,
  exact arguments/effective scopes, transport, principal, expiry, and replay prevention.
- Unsupported, declined, expired, tampered, replayed, or argument-mismatched consent never invokes a handler.

The confirmation ledger is deliberately process-local because the supported product deployment is one local
MCP process. createMcpHandler() may create a fresh McpServer per HTTP request, but every factory call closes
over the same opaque ApplicationContext internals. Multi-worker/horizontally scaled HTTP is unsupported until
a shared atomic consume-if-present store exists; signed requestState alone is not replay prevention. A future
worker-mode option must fail closed until that store and cross-worker tests exist.

- [ ] **Step 1: Write opaque-context, dispatch, dual-era, and elicitation tests first**

Create tests/capabilities/dispatch.test.ts. Prove:

- a valid context reaches the bound kernel and a forged/stale name still traverses every gate;
- spreading, cloning, or constructing an ApplicationContext-shaped object is rejected with a fixed
  initialization refusal/error;
- dispatchCapability() contains no duplicate policy condition;
- the caller cannot obtain a dispatcher or settlement function.

Create tests/helpers/connect.ts with two no-socket clients:

- connectLegacy(application, options?) uses InMemoryTransport.createLinkedPair() and
  buildServer(application, 'stdio');
- connectModern(application, options?, authInfo?) creates
  createMcpHandler(createServerFactory(application, 'http')), then gives StreamableHTTPClientTransport a
  custom fetch that calls handler.fetch(new Request(...), { authInfo }); there is no linked-pair modern HTTP
  transport in beta.4;
- the modern client pins exactly
  `versionNegotiation: { mode: { pin: '2026-07-28' } }`; the legacy client exercises 2025 behavior;
- both connectors independently close every resource in a finally-capable close function.

Create tests/mcp/factory.test.ts and parameterize across both connectors:

- initialize returns the exact server name/version/instructions;
- tools/list contains the immutable exposed catalog and hides read-only mutations;
- server_status returns textual plus structured output;
- invalid arguments return a sanitized MCP error result;
- Task 5 pedagogical prompts are registered;
- a forged cached tool name is refused;
- closing creates no process-global listener.

Create tests/mcp/elicitation.test.ts with a confirmed write fixture. Prove across both eras:

- a form-capable client receives one input-required round with a fixed pedagogical question and opaque signed
  requestState;
- accept executes exactly once; decline/cancel/missing/malformed accepted content consumes the known
  challenge and executes zero times;
- successful, declined, malformed, or binding-mismatched state cannot be replayed;
- changed nested arguments, post-challenge mutation of caller-owned nested data, wrong capability, transport,
  or principal fails;
- tampered, unsigned, expired, or malformed requestState never reaches the settlement authority;
- URL-only or absent form support is refused before challenge allocation;
- an envelope present on a modern request is authoritative even if its form-capability key is absent; only a
  truly absent envelope may use 2025 initialization capabilities;
- no MCP result/input-required payload contains a definition, handler, HMAC key, HTTP token, ledger entry, or
  sentinel secret.

Mutate every caller-owned RuntimeConfig collection and requestStateKey byte after createApplicationContext().
Prove dispatch, listing, codec verification, Origin/Host lists later read by Task 7, and feature/scope gates
retain the internal snapshot. Object.getOwnPropertyNames(), Object.getOwnPropertySymbols(), spread,
structured serialization, and direct property access on ApplicationContext reveal only catalog.

Run:

~~~bash
npx vitest run tests/capabilities/dispatch.test.ts tests/mcp/factory.test.ts \
  tests/mcp/elicitation.test.ts
~~~

Expected: RED because opaque application composition and MCP assembly do not exist.

- [ ] **Step 2: Bind the kernel to an opaque ApplicationContext**

Extend src/capabilities/types.ts with a type-only ApplicationContext import and:

~~~ts
export interface ServerContext extends CapabilityInvocationContext {
  readonly application: ApplicationContext;
}
~~~

Create src/app/application-context.ts. Its public shape is exact:

~~~ts
export interface ApplicationContext {
  readonly catalog: CapabilityCatalog;
}

export function createApplicationContext(
  config: RuntimeConfig,
  catalog: CapabilityCatalog = CAPABILITY_CATALOG
): ApplicationContext;
~~~

On construction, copy every caller-owned value without trying to Object.freeze mutable native containers.
Encode the copied request-state bytes to a private base64url string and recreate fresh bytes only inside the
codec helper; normalize sets to frozen arrays and recreate private Sets only when constructing the kernel;
copy/freeze ordinary arrays and records. Object.freeze(Uint8Array) throws on Node and Object.freeze(Set) does
not block add(), so neither is an immutability mechanism. Create one dispatcher from the normalized snapshot
and capture the kernel-installed settlement closure. Store all three in a
module-private WeakMap keyed by the frozen { catalog } object. Never place internals on string/symbol
properties, getters, methods, globals, or exported debug state.

Expose only these source-internal narrow helpers:

- listApplicationCapabilities(application, transport) -> immutable definitions;
- dispatchApplicationCapability(application, request, invocation) -> CapabilityResult;
- settleApplicationConfirmation(application, decision, claims, request, invocation) -> CapabilityResult;
- createApplicationRequestStateCodec(application, bind) -> RequestStateCodec.

The last helper constructs the codec internally from a copied key; it never returns key bytes. No helper
returns a dispatcher, config snapshot, settlement closure, or token. An unknown/spread/forged application
fails with a fixed secret-free initialization error. Architecture tests allow imports respectively only from
register-capabilities.ts, dispatch.ts, confirmation.ts, and build-server.ts. Task 7 may add one equally narrow
HTTP runtime constructor/helper without exposing its config.

The kernel settlement function consumes a known confirmation ID before validating the remainder. Unknown IDs
change nothing; any known attempt, including expiry or wrong bindings, is one-shot.

- [ ] **Step 3: Add the sole package-root dispatch facade**

Create src/capabilities/dispatch.ts:

~~~ts
export function dispatchCapability(
  request: CapabilityRequest,
  context: ServerContext
): Promise<CapabilityResult> {
  return dispatchApplicationCapability(context.application, request, {
    transport: context.transport,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
    ...(context.principalId === undefined ? {} : { principalId: context.principalId })
  });
}
~~~

The file has no catalog lookup or policy branch. Root-export this function and safe
CapabilityRequest/CapabilityResult/ServerContext/ConfirmationChallenge/RefusalCode types, but not
CapabilityDispatcher or any application helper.

- [ ] **Step 4: Add secret-safe MCP result formatting**

Create src/mcp/results.ts. successResult() returns JSON text plus structuredContent only from validated
output. refusalResult() returns isError true, the fixed message, and only RefusalCode in structuredContent.
Unit-test every code with sentinel raw inputs, Zod issues, exceptions, state, and secrets that must stay
absent.

- [ ] **Step 5: Implement signed elicitation against the exact beta.4 API**

Create src/mcp/confirmation.ts with a strict ConfirmationStateSchema containing exactly a 43-character
base64url confirmationId, non-empty capabilityId, and 64-character lowercase-hex argumentsSha256.

Use acceptedContent(responses, 'confirmation', ConfirmationResponseSchema), never its unvalidated two-
argument overload. Use inputResponse() to distinguish accept, decline, cancel, and missing/malformed content.

For client capability detection, add one tiny typed adapter around the beta.4 declaration bug where
RequestMetaEnvelope is generated as {}:

- when context.mcpReq.envelope is present, read CLIENT_CAPABILITIES_META_KEY through the local checked cast;
  that modern per-request envelope is authoritative even if the key is absent, so absent form support refuses;
- only when the envelope itself is absent may the 2025 compatibility path read initialization capabilities;
- no broader any cast and no fallback from a present modern envelope to legacy capabilities.

The adapter flow is exact:

1. A verified prior state round never performs a fresh initial dispatch.
2. Strictly parse decoded requestState and the named response.
3. Call settleApplicationConfirmation() with accept only for action accept plus schema-valid confirm: true.
4. For confirm: false, decline, cancel, missing, dropped, or malformed content with otherwise valid signed
   state, call settlement with decline so the known challenge is consumed without a handler.
5. Format success/refusal; a second confirmation-required outcome becomes CONFIRMATION_INVALID.
6. With no prior state, reject unexpected input responses.
7. Before initial dispatch of an elicitation definition, reject clients without form support so no challenge
   is allocated.
8. Dispatch normally. For confirmation-required, call await codec.mint(claims, context) — passing context is
   mandatory when bind is configured — and return inputRequired() with the fixed form request.
9. Codec TTL is 300 seconds. Its bind callback includes MCP method plus exact principal:
   stdio:local-connection for stdio, the validated AuthInfo.clientId for authenticated HTTP. The Foundation
   bearer runtime intentionally represents its single shared local bearer as http:local-bearer; it does not
   claim per-human identity.

Never create a VerifiedConfirmation object or import a confirmation mint/port.

- [ ] **Step 6: Register the catalog and assemble one v2 server**

Create src/mcp/register-capabilities.ts:

~~~ts
export function registerCapabilities(
  server: McpServer,
  application: ApplicationContext,
  transport: TransportKind,
  codec: RequestStateCodec<ConfirmationState>
): void;
~~~

List only through listApplicationCapabilities(). Register immutable metadata. Each callback builds a
ServerContext containing the opaque application plus transport, request signal, and exact principal; ordinary
calls go only through dispatchCapability(). Continuation/decline calls use the narrow settlement helper from
confirmation.ts, never raw authority. No policy rule is copied into the adapter.

Create src/server/build-server.ts:

~~~ts
export function buildServer(
  application: ApplicationContext,
  transport: TransportKind
): McpServer;
~~~

It creates the codec through createApplicationRequestStateCodec(), then constructs the beta.4 McpServer with
requestState: { verify: codec.verify }, SERVER_INSTRUCTIONS, and the legacy input-required shim bounded to
four rounds/120000 ms. Register prompts and capabilities exactly once. Do not spread ApplicationContext.

Create src/mcp/server-factory.ts returning () => buildServer(application, transport).

- [ ] **Step 7: Strengthen the architecture gate**

tests/architecture/execution-boundary.test.ts fails if:

- ApplicationContext exposes config, capabilities, dispatcher, HTTP token, HMAC bytes, service, settlement,
  completion, or any symbol property;
- any narrow application helper is imported outside its exact adapter allow-list;
- a dispatcher/settlement/config object crosses a helper return;
- root exports CapabilityDispatcher, createCapabilityDispatcher, application internals, confirmation
  state/schema, codec, kernel constructor, or settlement authority;
- register/confirmation/build-server duplicate policy conditions;
- package.json adds any internal subpath export.

- [ ] **Step 8: Run dual-era and deterministic gates**

Run with Node 22:

~~~bash
npx vitest run tests/capabilities/dispatch.test.ts tests/mcp/factory.test.ts \
  tests/mcp/elicitation.test.ts tests/architecture/execution-boundary.test.ts
npm run build
npm run typecheck
npm run lint
npm run format:check
npm test
npm audit --omit=dev
git diff --check
~~~

Expected: all cases pass; handlers execute once only after valid acceptance; opaque application inspection
reveals no authority/secret; the beta.4 modern envelope cast is isolated; all static gates and production
audit exit 0.

- [ ] **Step 9: Commit server assembly atomically**

~~~bash
git add src/app src/capabilities/dispatch.ts src/capabilities/types.ts src/mcp src/server \
  src/index.ts tests/helpers/connect.ts tests/capabilities/dispatch.test.ts \
  tests/mcp/factory.test.ts tests/mcp/elicitation.test.ts \
  tests/architecture/execution-boundary.test.ts
git commit -m "feat: assemble opaque dual-era MCP v2 application"
~~~
### Task 7: Add owned stdio and hardened opt-in HTTP entrypoints

**Files:**
- Create: src/app/default-application.ts
- Create: src/entrypoints/stdio.ts
- Create: src/main.ts
- Create: src/http/auth.ts
- Create: src/http/origin.ts
- Create: src/http/limits.ts
- Create: src/http/runtime.ts
- Create: src/entrypoints/http.ts
- Create: tests/app/default-application.test.ts
- Create: tests/mcp/stdio.test.ts
- Create: tests/http/runtime.test.ts
- Create: tests/integration/process-lifecycle.test.ts
- Modify: src/app/application-context.ts
- Modify: tests/architecture/execution-boundary.test.ts
- Modify: package.json
- Modify: src/index.ts

**Interfaces:**
- createDefaultApplicationRuntime() is the only executable composition seam and returns
  { application, close }. Its idempotent private lifecycle barrier refuses new dispatch/confirmation
  execution after close begins and drains every admitted execution before the next close phase. Foundation
  owns no external service; Product Task 5 replaces the body with the real product composition, passes all
  OPNsense/audit/backup/lock/limiter service closers to that shared barrier-backed runtime, and Guided Task 5
  later adds workflows.
- startStdio(application?) serves both eras. When no application is injected it owns the default runtime and
  its returned close() settles both server and runtime exactly once. An injected application remains owned by
  the caller.
- buildApplicationHttpSecurity(application) is source-internal and returns public HTTP settings plus a bearer
  middleware closure; it never returns the token or internal config.
- startHttp(application, options?) returns { url, limits, close }. The caller owns application; runtime close
  first closes its synchronous shutdown admission gate and initiates `server.close()` for listener/socket
  drainage, then independently settles the modern handler and optional legacy owner, and finally bounds any
  remaining connections and awaits Node drainage. Every later phase runs even if an earlier phase fails.
- HTTP is loopback-only, uses an exact hostname allow-list plus an exact serialized-Origin allow-list,
  is authenticated, bounded, and disabled by default. Host ports are intentionally ignored after strict
  hostname parsing; Origin entries retain scheme, host, and port.

Exact limits: 256 KiB JSON body, 32 concurrent requests, 16 subscriptions, 10-second body receipt,
30-second ordinary execution, 5-minute absolute stream lifetime, 5-second headers/keep-alive timeouts, and
100 requests per socket. Primary Streamable HTTP keeps 2025 compatibility stateless with
`legacy: 'stateless'` and therefore owns no legacy session store. The 2-minute idle timeout and 8-session
cap belong exclusively to Task 7b's deprecated SSE store.

- [ ] **Step 1: Write executable, HTTP, ownership, and partial-failure tests first**

tests/app/default-application.test.ts proves the Foundation default runtime lists only server_status, close()
is idempotent, and src/main.ts plus src/entrypoints/http.ts reach application construction only through this
seam. It also records the downstream contract: later plans must replace this exact body and binary tests,
not add a parallel factory.

tests/mcp/stdio.test.ts spawns dist/main.js for both 2025 and pinned 2026-07-28, passes only sentinel
environment, proves stdout is protocol-clean, stderr contains no secret, tools/list is server_status, and
SIGINT/SIGTERM/explicit close settle owned cleanup once.

tests/http/runtime.test.ts uses injected Foundation applications and covers:

- HTTP-disabled refusal;
- loopback host only;
- missing/wrong bearer 401 with no dispatch;
- foreign Host 403;
- absent Origin allowed for non-browser clients, present Origin exact-match only, default browser deny;
- scheme/host/port variants, null, opaque, malformed, and duplicate Origin headers denied before auth;
- oversized/slow bodies, request concurrency, the absolute ordinary/stream deadlines, subscription bounds,
  and the absence of a primary HTTP session store;
- validated auth reaches beta.4 createMcpHandler/toNodeHandler and receives server_status in both supported
  eras;
- AuthInfo has token, scopes [], and the honest single-principal clientId http:local-bearer;
- no log/error/result contains the bearer.

tests/integration/process-lifecycle.test.ts injects controlled close functions and proves:

- listen/start failure closes any handler/server/default runtime already created;
- handler close failure cannot skip server or application cleanup;
- server close failure cannot skip application cleanup;
- SIGINT and SIGTERM use one idempotent aggregate shutdown;
- two close callers execute each owned cleanup once and receive an AggregateError containing every failure.

Run build plus these tests; expected RED for missing entrypoints/runtime.

- [ ] **Step 2: Add the narrow HTTP security projection**

Modify application-context.ts with one source-internal
buildApplicationHttpSecurity(application): ApplicationHttpSecurity. It looks up the private snapshot and
returns a frozen object containing enabled/host/port/copied allowedHosts/copied allowedOrigins/
legacySseEnabled plus an authenticate RequestHandler already closed over the expected token. The token is
never a property, callback argument, serialization value, or return value. Only src/http/runtime.ts may
import this helper; add the import allow-list to the architecture test.

Create src/http/auth.ts. Compare SHA-256 digests with timingSafeEqual and set validated AuthInfo through a
narrow local Request projection.
Do not use any or add another global mutable augmentation. `toNodeHandler` reads this `req.auth`. Set exactly:

~~~ts
{
  token: expectedToken,
  clientId: 'http:local-bearer',
  scopes: []
}
~~~

The closure must never log/throw the token, digest, or Authorization value.

Create exact Origin middleware that treats a present Origin as a single exact serialized value; reject
duplicates and comma-joined values. Absence is allowed. Host validation uses the official adapter helper or
an equivalently strict exact hostname allow-list and runs first; it parses Host strictly but intentionally
does not bind the allow-list entry to a port.

- [ ] **Step 3: Implement the replaceable owned default runtime and stdio**

Create src/app/default-application.ts:

~~~ts
export interface OwnedApplicationRuntime {
  readonly application: ApplicationContext;
  close(): Promise<void>;
}

export function createOwnedApplicationRuntime(
  application: ApplicationContext,
  serviceClosers: readonly CloseOperation[] = []
): OwnedApplicationRuntime {
  return Object.freeze({
    application,
    close: createPhasedClose([
      [() => closeApplicationContext(application)],
      Object.freeze([...serviceClosers])
    ])
  });
}

export function createDefaultApplicationRuntime(): OwnedApplicationRuntime {
  const application = createApplicationContext(loadRuntimeConfig());
  return createOwnedApplicationRuntime(application);
}
~~~

No other production file calls createApplicationContext(loadRuntimeConfig()). Product Task 5 must replace
this function body rather than adding another default composition root. It must retain
`createOwnedApplicationRuntime()` and pass product-owned service closers to it so OPNsense, audit, backup,
lock, and limiter resources close only after admitted initial dispatch and confirmation completion settle.

Create startStdio(application?). Wrap serveStdio(createServerFactory(...), { legacy: 'serve', ... }). When no
application is supplied, create one owned runtime. Because beta.4 `serveStdio().close()` reports individual
server-close failures through `onerror` and resolves, wrap the factory/onerror path with a private failure
recorder (including discovery probes) and merge recorded failures after `serveStdio.close()` with the owned
runtime close result. Its returned handle close() uses an idempotent aggregate settler so every cleanup is
attempted once and all failures are retained. Diagnostic errors write only error.name to stderr.

main.ts starts stdio, installs once-only SIGINT/SIGTERM handlers that await handle.close(), sets a non-zero
exit code on failure, and never writes to stdout. Do not put credentials in process arguments.

- [ ] **Step 4: Implement bounded Streamable HTTP and independent cleanup**

Create DEFAULT_HTTP_LIMITS and the documented body/concurrency/subscription/request/stream/session/socket
bounds. Reject invalid option overrides at construction.

startHttp(application, options?) obtains buildApplicationHttpSecurity(application), refuses disabled or
unsafe configuration, then creates the beta.4 handler and Node adapter on plain `express()`. The optional
Express helper package is intentionally not installed because its preinstalled JSON and hostname-only
  Origin middleware would precede project guards. Middleware order is exact: exact Host -> exact serialized
  Origin -> shutdown admission gate -> bounded body receipt/time/size and concurrency -> bearer
  authentication -> `/mcp`. Keep 2025 traffic stateless. An injected options port of `0` is allowed only for ephemeral test
listeners; environment-derived configuration remains constrained to 1024..65535.

The SDK has no ordinary-execution or absolute-stream deadline option. Add a project-owned per-response
deadline wrapper around the Node adapter: start at 30 seconds, clear on `finish`/`close`, and abort/destroy the
response on expiry. Detect an established SSE response through a narrow response/writeHead projection and
replace that timer with one absolute 5-minute lifetime; keepalive traffic must never extend it. Socket
inactivity and Node `requestTimeout` are not substitutes for these execution deadlines.

Construction/listen is wrapped in try/finally: if any stage fails, close every resource already created in
explicit phases. Returned close() is idempotent: a synchronous request gate first stops admission and
`server.close()` begins listener/socket drainage; the runtime then closes the modern handler and optional
legacy owner so SSE/dispatch can settle, then uses
`closeAllConnections()` only as a bounded fallback before awaiting the original Node close callback. One
phase failure never skips a later phase and an AggregateError retains all failures in phase/operation order.

src/entrypoints/http.ts creates the owned default runtime, starts HTTP, and installs the same once-only
SIGINT/SIGTERM aggregate shutdown over HTTP plus application runtime. If startHttp fails, it still closes the
owned application. Log only the public listening origin or error.name.

Add start/start:http scripts. Root-export startStdio, startHttp, and safe runtime/limit types, but not default
composition internals, HTTP security projection, expected token, or middleware authority.

- [ ] **Step 5: Run transport, lifecycle, architecture, and regression gates**

~~~bash
npm run build
npx vitest run tests/app/default-application.test.ts tests/mcp/stdio.test.ts \
  tests/http/runtime.test.ts tests/integration/process-lifecycle.test.ts \
  tests/architecture/execution-boundary.test.ts
npm test
npm run typecheck
npm run lint
npm run format:check
npm audit --omit=dev
git diff --check
~~~

Expected: both eras pass; HTTP checks run before dispatch; all partial-init/close branches settle independently;
ApplicationContext/config/token remain opaque; stdout is protocol-only; audit is zero.

- [ ] **Step 6: Commit entrypoints atomically**

~~~bash
git add package.json src/app/default-application.ts src/app/application-context.ts \
  src/entrypoints src/http src/main.ts src/index.ts tests/app/default-application.test.ts \
  tests/mcp/stdio.test.ts tests/http/runtime.test.ts \
  tests/integration/process-lifecycle.test.ts tests/architecture/execution-boundary.test.ts
git commit -m "feat: add owned hardened MCP entrypoints"
~~~
### Task 7b: Add isolated default-off deprecated SSE transport compatibility

**Files:**
- Create: `src/http/legacy-sse.ts`
- Create: `tests/http/legacy-sse.test.ts`
- Create: `scripts/check-legacy-sse-dependency.mjs`
- Modify: `src/http/limits.ts`
- Modify: `src/http/runtime.ts`
- Modify: `tests/http/runtime.test.ts`
- Modify: `tests/http/task-7-review-fixes.test.ts`
- Modify: `tests/integration/process-lifecycle.test.ts`
- Modify: `tests/architecture/execution-boundary.test.ts`
- Modify: `tests/foundation/package-contract.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces and non-negotiable boundaries:**
- Pin `@modelcontextprotocol/sdk` exactly to `1.29.0` as a production dependency. The npm
  package is not registry-deprecated, and neither its package nor its high-level `McpServer` may be
  described as deprecated. This dependency exists only to support the package's deprecated
  `SSEServerTransport` and test-only `SSEClientTransport`.
- Production v1 imports are confined to `src/http/legacy-sse.ts`: low-level `Server` from
  `@modelcontextprotocol/sdk/server/index.js`, `SSEServerTransport` from
  `@modelcontextprotocol/sdk/server/sse.js`, and request schemas/result metadata types from
  `@modelcontextprotocol/sdk/types.js`. The focused test alone may additionally import
  `Client` and `SSEClientTransport` from the v1 client subpaths plus the low-level v1 `Server` class
  at its exact construction seam for rejected-close ownership testing. No v1 object or transport is
  passed to the beta.4 server. Architecture scanning treats both the package root and every
  subpath as v1 imports, then requires exactly those three production specifiers and these three test
  specifiers: `@modelcontextprotocol/sdk/client/index.js`,
  `@modelcontextprotocol/sdk/client/sse.js`, and
  `@modelcontextprotocol/sdk/server/index.js`; a root-package or unapproved-subpath import fails the
  gate.
- Do not use v1 `McpServer.registerTool()`. It parses and transforms arguments before its callback
  and validates output again, which would make the sealed kernel parse a transformed value a second
  time. Install low-level `ListToolsRequestSchema` and `CallToolRequestSchema` handlers instead.
  The call handler looks up prepared metadata and passes
  `request.params.arguments ?? {}` directly to `dispatchCapability()`; the kernel remains the
  sole capability-schema parser.
- Prepare all v1 tool metadata exactly once while mounting, before the TCP listener starts. Convert
  input schemas with `z.toJSONSchema(schema, { io: 'input' })` and output schemas with
  `z.toJSONSchema(schema, { io: 'output' })`. A runtime type predicate must require an object
  schema, object-valued entries in `properties`, and a string-only `required` array. A conversion
  throw or guard failure rejects startup with the fixed message
  `Legacy SSE capability schema is not representable`. Never use
  `unrepresentable: 'any'`, because it silently degrades a schema to `{}`.
- Filter every definition whose `policy.confirmation !== 'none'` before JSON Schema conversion and
  before building the name map. Legacy SSE has no safe confirmation continuation. A forged call to a
  filtered or nonexistent name returns the project's fixed
  `UNKNOWN_CAPABILITY` `CallToolResult` and never dispatches. Do not assert JSON-RPC
  method-not-found: v1's high-level server resolves the call as
  `{ content: [{ type: 'text', text: 'MCP error -32602: Tool sealed_tool not found' }], isError: true }`.
  This adapter deliberately replaces that InvalidParams-style text with the project's stable refusal.
- Add `maxLegacySseSessions` and `legacySessionIdleTimeoutMs` to `HttpLimits`, with defaults
  `8` and `120_000`. Resolve and validate them with every other HTTP limit, add the idle timeout
  to Task 7's timer-valued limit set so the Node maximum of `2_147_483_647` ms still applies, and
  pass the resolved values into the compatibility store; `legacy-sse.ts` must not import defaults.
- Enabled legacy `GET /sse` and `POST /messages` share the existing global Host, exact-Origin,
  concurrent-request, body-receipt, declared-size, JSON-body, and response-deadline middleware.
  Both routes then apply the same bearer middleware as `/mcp`. The modern endpoint remains
  `/mcp`, and its handler is usable concurrently with legacy sessions.
- Refactor Task 7's `withResponseDeadline(handler, limits, clock)` into generic
  `responseDeadline(limits, clock)` middleware plus a thin `invokeNodeHandler(handler)` adapter.
  Preserve `DeadlineClock` as the fourth `buildHttpExpressApplication()` argument and add the
  compatibility mount hook separately rather than replacing that injectable clock.
  Mount the generic deadline before both protocol route families. Execution timeout applies to
  ordinary GET and POST responses; the first `text/event-stream` write switches to the absolute
  stream-lifetime timer.
- Add an injectable `loadLegacySse()` runtime dependency whose default is
  `() => import('./legacy-sse.js')`. It is never called when the flag is false. Legacy close,
  beta handler close, and Node server close are independently settled on normal close and partial
  startup failure, with deterministic `AggregateError` ordering. Cleanup invocation stays behind
  Task 7's delayed `Promise.resolve().then(operation)` boundary so a synchronous legacy close throw
  cannot prevent later handler or Node-server cleanup.
- `npm run release:check:legacy-sse` is a networked release gate. It validates the package and lock
  exact pin, unique lock node and approved integrity, then checks registry version metadata and the
  exact `latest` tag. Release review must also run `npm audit --omit=dev` and decide whether the
  compatibility adapter can be removed.

**Post-review implementation addendum (`f4ec4a3`):** This addendum records the shipped defensive
follow-up and is normative wherever an earlier baseline sketch below describes unowned dispatch,
eager session removal, a plain admission counter, or only two v1 test imports. The atomic review
commit changes exactly these six code/test files:

- `src/http/legacy-sse.ts`
- `src/http/runtime.ts`
- `tests/architecture/execution-boundary.test.ts`
- `tests/http/legacy-sse.test.ts`
- `tests/http/runtime.test.ts`
- `tests/integration/process-lifecycle.test.ts`

The shared HTTP admission owner is a private `WeakMap` from the admitted `GET /sse` response to a
reference-counted retain operation. Each legacy session permits one active capability dispatch. It
retains the GET lease synchronously before the first asynchronous dispatch boundary and releases that
retained reference exactly once in `finally`. If the SSE connection disconnects, only the GET's base
reference is released; the retained dispatch reference continues to consume the same global slot
until real settlement. The transient POST remains independently admitted and is never transferred or
double-counted.

Each session owns an `AbortController`; dispatch uses `AbortSignal.any([session signal, SDK signal])`.
The idle timer is cleared/suspended while the session is busy and rearmed only after dispatch
settlement when the adapter/session remains open. Dispatch Promises and session-close Promises live in
distinct adapter-owned Sets. Atomic idempotent `close()` first marks the adapter closing, aborts and
starts every session close, awaits the de-duplicated close owners, then awaits the captured active
dispatches. A rejected idle close remains owned in the session map and close Set so concurrent runtime
shutdown reports it rather than losing it.

Before the v1 transport sees a POST body, a non-object or array envelope is rejected with exact fixed
JSON `{"error":"invalid_legacy_message"}` and cannot reflect caller input. The import allow-list is
AST-based and covers static, side-effect, dynamic, import-type, type import/export, value export,
`import = require()`, and direct `require()` forms. Production remains exactly the three tuples in
`src/http/legacy-sse.ts`; tests remain exactly these three tuples in
`tests/http/legacy-sse.test.ts`:
`@modelcontextprotocol/sdk/client/index.js`, `@modelcontextprotocol/sdk/client/sse.js`, and
`@modelcontextprotocol/sdk/server/index.js`.

The review proof also covers partial start after a successful legacy mount: a throwing
`createNodeServer` closes the legacy and beta owners exactly once and never calls `listen`. The Node
constructor receives exactly `{ connectionsCheckingInterval: 1000, headersTimeout: 5000,
keepAliveTimeout: 5000, requestTimeout: 10000 }` plus the Express listener. Direct deadline tests prove
both `finish` and `close` clear the active response timer exactly once and a later deadline callback
cannot destroy or rearm the terminal response.

TDD evidence was recorded against `e018ad4`: the first RED reproductions observed 13 dispatches
instead of one, HTTP 200 instead of the bounded 503 after disconnect, and premature runtime close; a
second RED run observed idle cancellation during an active dispatch and caller-body reflection. The
added rejected-idle-close ownership test was also RED because shutdown lost the rejection. Fresh GREEN
evidence for `f4ec4a3` is 4 focused files with 64/64 tests, then `npm run verify` with 17 files and
292/292 tests, `npm audit --omit=dev` with 0 vulnerabilities, and
`npm run release:check:legacy-sse` reporting the dependency contract current. That networked release
gate plus the production audit must still be rerun before release.

Two P3 observations are recorded only for final triage, not claimed fixed or delivered here: a UUID
session-identifier collision is cryptographically negligible but could receive explicit collision
hardening, and one internal `application` parameter is unused.

- [ ] **Step 1: Write static package, limit, and architecture tests first**

Extend the exact limits assertion in `tests/http/runtime.test.ts` before changing production code:

```ts
expect(DEFAULT_HTTP_LIMITS).toEqual({
  bodyBytes: 256 * 1024,
  maxConcurrentRequests: 32,
  maxSubscriptions: 16,
  maxLegacySseSessions: 8,
  legacySessionIdleTimeoutMs: 120_000,
  bodyReceiptTimeoutMs: 10_000,
  executionTimeoutMs: 30_000,
  streamLifetimeMs: 5 * 60_000,
  headersTimeoutMs: 5_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100
});
```

Also add invalid override cases for both new fields. In particular, assert that
`legacySessionIdleTimeoutMs: 2_147_483_647` is accepted and `2_147_483_648` is rejected, while
`maxLegacySseSessions` remains a positive safe integer rather than a timer-valued limit:

```ts
expect(
  resolveHttpLimits({ legacySessionIdleTimeoutMs: 2_147_483_647 })
    .legacySessionIdleTimeoutMs
).toBe(2_147_483_647);
expect(() =>
  resolveHttpLimits({ legacySessionIdleTimeoutMs: 2_147_483_648 })
).toThrow('Invalid HTTP limit: legacySessionIdleTimeoutMs');
```

Extend `tests/foundation/package-contract.test.ts` to parse both manifests and assert the complete
root and lock contract:

```ts
interface LockPackage {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly dev?: boolean;
}

interface LockDocument {
  readonly packages: Record<string, LockPackage & {
    readonly dependencies?: Record<string, string>;
  }>;
}

expect(document.dependencies).toMatchObject({
  '@modelcontextprotocol/node': '2.0.0-beta.4',
  '@modelcontextprotocol/server': '2.0.0-beta.4',
  '@modelcontextprotocol/sdk': '1.29.0',
  express: '5.2.1',
  zod: '4.2.0'
});
expect(document.devDependencies['@modelcontextprotocol/client']).toBe('2.0.0-beta.4');
expect(document.scripts['release:check:legacy-sse']).toBe(
  'node scripts/check-legacy-sse-dependency.mjs'
);

const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as LockDocument;
expect(lock.packages['']?.dependencies?.['@modelcontextprotocol/sdk']).toBe('1.29.0');
const sdkNodes = Object.entries(lock.packages).filter(([path]) =>
  /(?:^|\/)node_modules\/@modelcontextprotocol\/sdk$/u.test(path)
);
expect(sdkNodes.map(([path]) => path)).toEqual(['node_modules/@modelcontextprotocol/sdk']);
expect(sdkNodes[0]?.[1]).toMatchObject({
  version: '1.29.0',
  resolved: 'https://registry.npmjs.org/@modelcontextprotocol/sdk/-/sdk-1.29.0.tgz',
  integrity:
    'sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ=='
});
expect(sdkNodes[0]?.[1].dev).toBeUndefined();
```

Extend `tests/architecture/execution-boundary.test.ts` with all of these static assertions:

1. Add `src/http/legacy-sse.ts` to the exact `listApplicationCapabilities` helper allow-list.
2. Parse the TypeScript AST in production and classify a v1 import when the specifier is
   exactly `@modelcontextprotocol/sdk` **or** starts with `@modelcontextprotocol/sdk/`. Sort and
   require the complete `(file, specifier)` set to equal exactly these three entries:
   `src/http/legacy-sse.ts` with `@modelcontextprotocol/sdk/server/index.js`,
   `@modelcontextprotocol/sdk/server/sse.js`, and `@modelcontextprotocol/sdk/types.js`.
3. Apply the same root-equality-or-subpath classification to test TypeScript. Sort and require the
   complete set to equal exactly three entries, all in `tests/http/legacy-sse.test.ts`:
   `@modelcontextprotocol/sdk/client/index.js` and
   `@modelcontextprotocol/sdk/client/sse.js`, plus
   `@modelcontextprotocol/sdk/server/index.js`.
4. Assert the legacy source contains none of `@modelcontextprotocol/server`, `buildServer`,
   `createServerFactory`, `settleApplicationConfirmation`, or
   `handleConfirmationCall`.
5. Assert the source contains no cast from a v1 SSE transport to a beta transport type. The legacy
   module may import only catalog metadata, `dispatchCapability`, neutral capability types, shared
   instructions, Express types, HTTP limits, Zod, and the v1 low-level server/transport/types paths.

Use the existing recursive `sourceFiles()` helper, and compare exact normalized file/specifier tuples
rather than substring counts. The AST fixture must cover static imports, side-effect imports, dynamic
imports, import types, type imports/exports, value exports, `import = require()`, and direct CommonJS
`require()`. This must fail on a bare root-package import, any seventh v1 import, or an approved
specifier imported from a second file.

- [ ] **Step 2: Write the full legacy behavior and lifecycle tests before implementation**

Create `tests/http/legacy-sse.test.ts` with the v1 imports below. The single `requestInit.headers`
object is intentional: executable v1.29 verification showed it reaches both the EventSource GET and
the recurring POST.

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { request as httpRequest } from 'node:http';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Server as LegacyServer } from '@modelcontextprotocol/sdk/server/index.js';
import { Client, StreamableHTTPClientTransport, type ElicitResult } from '@modelcontextprotocol/client';
import * as z from 'zod/v4';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createApplicationContext,
  type ApplicationContext
} from '../../src/app/application-context.js';
import { CAPABILITY_CATALOG, CapabilityCatalog } from '../../src/capabilities/catalog.js';
import { dispatchCapability } from '../../src/capabilities/dispatch.js';
import { defineCapability } from '../../src/capabilities/kernel.js';
import { loadRuntimeConfig } from '../../src/config/runtime-config.js';
import { startHttp, type HttpRuntime } from '../../src/http/runtime.js';
import { connectLegacy } from '../helpers/connect.js';

const TOKEN = 'LEGACY_SSE_SENTINEL_TOKEN_0123456789';
const ORIGIN = 'https://console.example:8443';
const openRuntimes = new Set<HttpRuntime>();

function legacyHeaders(): Record<string, string> {
  return {
    authorization: `Bearer ${TOKEN}`,
    origin: ORIGIN
  };
}

async function connectLegacySse(runtime: HttpRuntime) {
  const transport = new SSEClientTransport(new URL('/sse', runtime.url), {
    requestInit: { headers: legacyHeaders() }
  });
  const client = new LegacyClient(
    { name: 'legacy-sse-test', version: '0.1.0' },
    { capabilities: {} }
  );
  await client.connect(transport);
  return {
    client,
    transport,
    close: () => Promise.allSettled([client.close(), transport.close()])
  };
}

function application(
  catalog: CapabilityCatalog = CAPABILITY_CATALOG,
  enabled = true
): ApplicationContext {
  return createApplicationContext(
    loadRuntimeConfig({
      READ_ONLY: 'false',
      MCP_HTTP_ENABLED: 'true',
      MCP_HTTP_TOKEN: TOKEN,
      MCP_ALLOWED_ORIGINS: ORIGIN,
      MCP_LEGACY_SSE_ENABLED: enabled ? 'true' : 'false'
    }),
    catalog
  );
}
```

Keep a teardown that closes clients first and then all runtimes with `Promise.allSettled`. Add raw
HTTP helpers that can: send GET or POST with an explicit Host, stream until the v1
`event: endpoint` frame yields its `sessionId`, leave an SSE response open, destroy that response,
send declared-oversize and headers-only slow bodies, and wait for the stream's `close` event. Those
helpers must reject unexpected socket errors and must not swallow response status codes.

Implement these exact test cases:

1. **Default-off and coexistence.** With the flag false, authenticated `GET /sse` and JSON
   `POST /messages?sessionId=valid-but-absent` both return 404. A beta
   `StreamableHTTPClientTransport` connected to `runtime.url` still lists
   `server_status`. With the flag true, keep a beta client and a v1 SSE client connected
   concurrently; both list exactly `server_status`, both call it successfully, and
   `runtime.url` remains a string ending in `/mcp`.
2. **GET and POST route guards.** For each route, missing and wrong bearer values return 401; a wrong
   exact Origin and a foreign Host return 403. For POST, a malformed session identifier such as
   `../escape` returns 400 and a valid absent identifier returns 404. A declared body larger than
   `bodyBytes` returns 413 before authentication, and a headers-only slow POST returns 408 before
   authentication. Assert neither response body nor captured diagnostics contains `TOKEN`.
3. **Shared concurrency.** Start with `maxConcurrentRequests: 2`, open two authenticated SSE GETs,
   and prove a third request to `/mcp` and a third request to `/messages` each return 503 with
   `{ error: 'request_limit_reached' }`. Close one stream and prove a modern `/mcp` tools/list
   request succeeds, showing capacity is reclaimed.
4. **Bounded sessions and reclamation.** Open exactly eight sessions under default limits; the ninth
   authenticated `GET /sse` returns 503. Destroy one of the eight streams, wait for its close
   processing, then open a replacement successfully. Do not merely close the whole runtime to prove
   reclamation.
5. **Idle expiry.** Start with
   `legacySessionIdleTimeoutMs: 25` and `streamLifetimeMs: 1_000`. Capture a session ID from a raw
   SSE stream, wait for the server to end it, then assert POST to that old ID returns 404.
6. **Absolute stream expiry.** Start with
   `streamLifetimeMs: 25` and `legacySessionIdleTimeoutMs: 1_000`. Prove the same stream closure
   and old-session 404. This independently proves the generic deadline recognizes
   `text/event-stream`.
7. **One sealed parse.** Define a read capability whose input string has one `refine` and one
   `transform(Number)`, and whose output has one `refine`. Call it through the v1 client with
   raw `{ port: '443' }`; assert output success and counters
   `{ inputRefine: 1, inputTransform: 1, outputRefine: 1, handler: 1 }`. Then call an unknown name
   and assert the exact fixed result below while all counters remain unchanged:

   ```ts
   expect(unknown).toEqual({
     isError: true,
     content: [{ type: 'text', text: 'Capability is not available.' }],
     structuredContent: { code: 'UNKNOWN_CAPABILITY' }
   });
   ```

8. **Fail-closed metadata.** Define an otherwise exposed capability whose output schema contains a
   transform. Enabling legacy SSE must make `startHttp(..., { port: 0 })` reject with exactly
   `Legacy SSE capability schema is not representable` before a listener exists. Repeat with a
   deliberately non-object top-level schema. Do not accept `{}` metadata.
9. **Confirmation filtering, forged calls, and ledger capacity.** Use
   `createMutationFixture(onCall, { id: 'test.sealed', mcpName: 'sealed_tool' })` plus the normal
   catalog, with `READ_ONLY=false`. Assert legacy `tools/list` omits `sealed_tool`. Fill 1023 of
   the kernel's default 1024 ledger slots with direct, unique stdio dispatches:

   ```ts
   for (let sequence = 0; sequence < 1023; sequence += 1) {
     const issued = await dispatchCapability(
       { name: 'sealed_tool', arguments: { value: String(sequence) } },
       {
         application: sealedApplication,
         transport: 'stdio',
         principalId: 'stdio:local-connection'
       }
     );
     expect(issued.kind).toBe('confirmation-required');
   }
   ```

   Make sixteen forged v1 calls to `sealed_tool`; every call must equal the fixed
   `UNKNOWN_CAPABILITY` result above, and `onCall` remains untouched. Then connect with the
   existing beta `connectLegacy()` helper, advertise `{ elicitation: { form: {} } }`, register
   `elicitation/create` to return
   `{ action: 'accept', content: { confirm: true } } satisfies ElicitResult`, and call
   `sealed_tool` with `{ value: '1023' }`. It must temporarily consume the final available slot,
   settle only its own fresh confirmation, return `{ accepted: '1023' }`, and invoke `onCall`
   exactly once. Then issue a new direct stdio dispatch with unique arguments
   `{ value: 'ledger-final-pending' }`; it must return `confirmation-required` and occupy the one
   remaining slot. A subsequent direct dispatch with `{ value: 'ledger-overflow' }` must return the
   exact refusal code `CONFIRMATION_UNAVAILABLE`. This final capacity proof demonstrates that the
   original 1023 confirmations remain pending: forged legacy calls neither allocate nor settle
   confirmation state, while the beta acceptance settled only the confirmation it created.
10. **Owned shutdown.** Open multiple raw SSE sessions, call `runtime.close()` twice concurrently,
    assert both callers receive the same promise, every stream ends, every old session is gone, and a
    later close returns the already-settled promise.

Extend `tests/http/runtime.test.ts` with a unit test for the refactored
`responseDeadline(limits, clock)`: it calls `next` without invoking an MCP handler, uses the
execution timeout for an ordinary response, switches exactly once to `streamLifetimeMs` on an SSE
`writeHead`, and clears the active timer on both `finish` and `close`. Update existing adapter
tests to call `invokeNodeHandler(handler)` separately. Preserve Task 7's constructor spy assertion:
`createNodeServer` receives the complete timeout options object and the Express listener in one call,
including `connectionsCheckingInterval: Math.min(1_000, headersTimeoutMs)` and
`requestTimeout: Math.max(bodyReceiptTimeoutMs, headersTimeoutMs)`. Keep the real partial-header
socket test proving the configured deadline is effective; property assignment after construction is
not an acceptable substitute.

Extend `tests/integration/process-lifecycle.test.ts` with injectable-loader tests:

- `loadLegacySse` is a spy that is not called when `legacySseEnabled=false`.
- Loader rejection and mount-time schema rejection close the already-created beta handler.
- After a successful mount, a Node construction failure closes the legacy handle and beta handler
  once each. A later listen failure closes the legacy handle, beta handler, and Node server once each.
- On normal shutdown, make legacy close **throw synchronously** with `legacy-close`, beta handler
  close reject `handler-close`, and Node close reject `server-close`. Assert one `AggregateError` with
  `.errors` exactly `[handlerFailure, legacyFailure, serverFailure]`, even for concurrent close
  callers, and assert every cleanup was attempted once. This must use the real aggregate settler,
  not a mock that turns the synchronous throw into a rejected promise first.
- On failed startup, repeat the synchronous legacy close throw while later beta-handler and Node
  close operations reject. Assert all later cleanup functions were still invoked once and the
  primary startup error precedes the phased
  `[handlerFailure, legacyFailure, serverFailure]` errors.

- [ ] **Step 3: Run the new tests and record the expected red state**

Use the repository's required Node 22 toolchain:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx vitest run   tests/http/legacy-sse.test.ts   tests/http/runtime.test.ts   tests/integration/process-lifecycle.test.ts   tests/architecture/execution-boundary.test.ts   tests/foundation/package-contract.test.ts
```

Expected: failures report the missing legacy module, loader, two limit fields, exact root production
pin, and route behavior. Do not weaken an assertion because the pre-existing dev-only transitive copy
makes v1 client imports resolvable.

- [ ] **Step 4: Add only the exact approved v1 dependency**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm install --save-exact @modelcontextprotocol/sdk@1.29.0
npm ls @modelcontextprotocol/sdk --all
```

Expected lock review:

- one `node_modules/@modelcontextprotocol/sdk` node at `1.29.0`;
- integrity
  `sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==`;
- the existing conformance `^1.29.0` edge reuses that one node;
- the root lock dependency becomes exact and the SDK node is production-reachable;
- the beta.4 MCP roots, `express@5.2.1`, and `zod@4.2.0` do not move.

The expected lock churn promotes the existing SDK graph from dev-only reachability; it must not add a
second SDK version. Review every unrelated lock change before continuing.

- [ ] **Step 5: Implement the low-level v1 adapter and bounded store**

The code sketch below records the initial RED-to-GREEN baseline only. Its unowned dispatch/session
lifecycle is superseded by the normative `f4ec4a3` addendum above; the shipped adapter must use the
lease, abort, busy, idle, dispatch-Set, close-Set, and fixed-envelope invariants from that addendum.
Keep the result formatter structural so no beta MCP type enters this file.

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { Server as LegacyServer } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult as LegacyCallToolResult,
  type Tool as LegacyTool
} from '@modelcontextprotocol/sdk/types.js';
import type { Express, RequestHandler } from 'express';
import * as z from 'zod/v4';
import {
  listApplicationCapabilities,
  type ApplicationContext
} from '../app/application-context.js';
import { dispatchCapability } from '../capabilities/dispatch.js';
import type {
  CapabilityDefinition,
  CapabilityResult,
  ServerContext
} from '../capabilities/types.js';
import { SERVER_INSTRUCTIONS } from '../mcp/instructions.js';
import type { HttpLimits } from './limits.js';

export const LEGACY_SCHEMA_ERROR = 'Legacy SSE capability schema is not representable';

export interface LegacySseHandle {
  close(): Promise<void>;
}

export interface LegacySseMountOptions {
  readonly application: ApplicationContext;
  readonly authenticate: RequestHandler;
  readonly limits: Pick<
    HttpLimits,
    'maxLegacySseSessions' | 'legacySessionIdleTimeoutMs'
  >;
  readonly lookupRequestLease: (response: object) => (() => (() => void) | undefined) | undefined;
  readonly onerror: (error: Error) => void;
}

interface PreparedLegacyTool {
  readonly definition: CapabilityDefinition;
  readonly listed: LegacyTool;
}

interface LegacySession {
  readonly server: LegacyServer;
  readonly transport: SSEServerTransport;
  readonly abortController: AbortController;
  readonly retainRequestLease: () => (() => void) | undefined;
  readonly dispatches: Set<Promise<LegacyCallToolResult>>;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  busy: boolean;
  closing: boolean;
  closePromise: Promise<void> | undefined;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function flattenError(value: unknown): Error[] {
  return value instanceof AggregateError
    ? value.errors.flatMap(flattenError)
    : [toError(value)];
}

function rejectedErrors(results: readonly PromiseSettledResult<void>[]): Error[] {
  return results.flatMap((result) =>
    result.status === 'rejected' ? flattenError(result.reason) : []
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isLegacyObjectSchema(value: unknown): value is LegacyTool['inputSchema'] {
  if (!isRecord(value) || value.type !== 'object') return false;
  if (
    value.properties !== undefined &&
    (!isRecord(value.properties) || !Object.values(value.properties).every(isRecord))
  ) {
    return false;
  }
  return (
    value.required === undefined ||
    (Array.isArray(value.required) &&
      value.required.every((entry): entry is string => typeof entry === 'string'))
  );
}

function toLegacyObjectSchema(
  schema: z.ZodType,
  io: 'input' | 'output'
): LegacyTool['inputSchema'] {
  let converted: unknown;
  try {
    converted = z.toJSONSchema(schema, { io });
  } catch {
    throw new Error(LEGACY_SCHEMA_ERROR);
  }
  if (!isLegacyObjectSchema(converted)) throw new Error(LEGACY_SCHEMA_ERROR);
  return converted;
}

function prepareLegacyTools(application: ApplicationContext): readonly PreparedLegacyTool[] {
  const prepared = listApplicationCapabilities(application, 'http')
    .filter((definition) => definition.policy.confirmation === 'none')
    .map((definition): PreparedLegacyTool => {
      const listed: LegacyTool = {
        name: definition.mcpName,
        title: definition.title,
        description: definition.description,
        inputSchema: toLegacyObjectSchema(definition.inputSchema, 'input'),
        outputSchema: toLegacyObjectSchema(definition.outputSchema, 'output'),
        annotations: { ...definition.annotations }
      };
      return Object.freeze({ definition, listed: Object.freeze(listed) });
    });
  return Object.freeze(prepared);
}

function unknownLegacyResult(): LegacyCallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: 'Capability is not available.' }],
    structuredContent: { code: 'UNKNOWN_CAPABILITY' }
  };
}

function formatLegacyResult(result: CapabilityResult): LegacyCallToolResult {
  if (result.kind === 'success') {
    return {
      content: [{ type: 'text', text: JSON.stringify(result.output) }],
      structuredContent: result.output
    };
  }
  if (result.kind === 'refused') {
    return {
      isError: true,
      content: [{ type: 'text', text: result.message }],
      structuredContent: { code: result.code }
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: 'Capability confirmation is unavailable.' }],
    structuredContent: { code: 'CONFIRMATION_UNAVAILABLE' }
  };
}

function buildLegacySseServer(
  application: ApplicationContext,
  prepared: readonly PreparedLegacyTool[],
  onerror: (error: Error) => void
): LegacyServer {
  const byName = new Map(prepared.map((entry) => [entry.definition.mcpName, entry] as const));
  const server = new LegacyServer(
    { name: 'opnsense-mcp', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );
  server.onerror = onerror;
  server.registerCapabilities({ tools: {} });
  server.setRequestHandler(ListToolsRequestSchema, () =>
    Promise.resolve({ tools: prepared.map(({ listed }) => listed) })
  );
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const entry = byName.get(request.params.name);
    if (entry === undefined) return unknownLegacyResult();
    const context: ServerContext = {
      application,
      transport: 'http',
      signal: extra.signal,
      principalId: extra.authInfo?.clientId ?? 'http:local-bearer'
    };
    return formatLegacyResult(
      await dispatchCapability(
        {
          name: entry.definition.mcpName,
          arguments: request.params.arguments ?? {}
        },
        context
      )
    );
  });
  return server;
}

export function mountLegacySseCompatibility(
  router: Express,
  options: LegacySseMountOptions
): LegacySseHandle {
  const prepared = prepareLegacyTools(options.application);
  const sessions = new Map<string, LegacySession>();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  function forgetSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    sessions.delete(sessionId);
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer);
    session.idleTimer = undefined;
  }

  async function closeSession(sessionId: string): Promise<void> {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    forgetSession(sessionId);
    await session.server.close();
  }

  function touchSession(sessionId: string): void {
    const session = sessions.get(sessionId);
    if (session === undefined) return;
    if (session.idleTimer !== undefined) clearTimeout(session.idleTimer);
    const idleTimer = setTimeout(() => {
      void closeSession(sessionId).catch(options.onerror);
    }, options.limits.legacySessionIdleTimeoutMs);
    idleTimer.unref();
    session.idleTimer = idleTimer;
  }

  router.get('/sse', options.authenticate, (_request, response, next) => {
    void (async () => {
      if (closing || sessions.size >= options.limits.maxLegacySseSessions) {
        response.status(503).json({ error: 'legacy_sse_capacity_reached' });
        return;
      }
      const transport = new SSEServerTransport('/messages', response);
      const server = buildLegacySseServer(options.application, prepared, options.onerror);
      const sessionId = transport.sessionId;
      const session: LegacySession = { server, transport, idleTimer: undefined };
      sessions.set(sessionId, session);
      server.onclose = () => {
        forgetSession(sessionId);
      };
      try {
        await server.connect(transport);
        touchSession(sessionId);
      } catch (startupFailure) {
        const cleanup = await Promise.allSettled([closeSession(sessionId)]);
        const cleanupFailures = rejectedErrors(cleanup);
        if (cleanupFailures.length > 0) {
          throw new AggregateError(
            [...flattenError(startupFailure), ...cleanupFailures],
            'Legacy SSE session startup and cleanup failed'
          );
        }
        throw startupFailure;
      }
    })().catch(next);
  });

  router.post('/messages', options.authenticate, (request, response, next) => {
    void (async () => {
      const candidate = request.query.sessionId;
      if (typeof candidate !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(candidate)) {
        response.status(400).json({ error: 'invalid_legacy_session' });
        return;
      }
      const session = sessions.get(candidate);
      if (session === undefined) {
        response.status(404).json({ error: 'legacy_session_not_found' });
        return;
      }
      touchSession(candidate);
      const parsedBody = (request as unknown as { readonly body?: unknown }).body;
      await session.transport.handlePostMessage(request, response, parsedBody);
      touchSession(candidate);
    })().catch(next);
  });

  return Object.freeze({
    close() {
      closePromise ??= (async () => {
        closing = true;
        const results = await Promise.allSettled([...sessions.keys()].map(closeSession));
        const failures = rejectedErrors(results);
        if (failures.length > 0) {
          throw new AggregateError(failures, 'Legacy SSE cleanup failed');
        }
      })();
      return closePromise;
    }
  });
}
```

The steady-state owner closes each session through `LegacyServer.close()`; v1 `Server` owns its
transport and closes it. Do not double-close the transport or cast it to a beta transport.

- [ ] **Step 6: Integrate resolved limits, the generic deadline, dynamic loading, and aggregate cleanup**

Add the two owned limits in `src/http/limits.ts`:

```ts
export interface HttpLimits {
  readonly bodyBytes: number;
  readonly maxConcurrentRequests: number;
  readonly maxSubscriptions: number;
  readonly maxLegacySseSessions: number;
  readonly legacySessionIdleTimeoutMs: number;
  readonly bodyReceiptTimeoutMs: number;
  readonly executionTimeoutMs: number;
  readonly streamLifetimeMs: number;
  readonly headersTimeoutMs: number;
  readonly keepAliveTimeoutMs: number;
  readonly maxRequestsPerSocket: number;
}

export const DEFAULT_HTTP_LIMITS: HttpLimits = Object.freeze({
  bodyBytes: 256 * 1024,
  maxConcurrentRequests: 32,
  maxSubscriptions: 16,
  maxLegacySseSessions: 8,
  legacySessionIdleTimeoutMs: 120_000,
  bodyReceiptTimeoutMs: 10_000,
  executionTimeoutMs: 30_000,
  streamLifetimeMs: 5 * 60_000,
  headersTimeoutMs: 5_000,
  keepAliveTimeoutMs: 5_000,
  maxRequestsPerSocket: 100
});
```

Preserve Task 7's positive-safe-integer loop and maximum timer guard. Add only the new timer-valued
field to the existing set; `maxLegacySseSessions` deliberately does not belong in it:

```ts
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const TIMER_LIMIT_NAMES = new Set<keyof HttpLimits>([
  'legacySessionIdleTimeoutMs',
  'bodyReceiptTimeoutMs',
  'executionTimeoutMs',
  'streamLifetimeMs',
  'headersTimeoutMs',
  'keepAliveTimeoutMs'
]);
```

`resolveHttpLimits()` must continue rejecting any timer above `MAX_TIMER_DELAY_MS`; do not rely on
Node's overflowing-timer clamp.

In `src/http/runtime.ts`, replace `withResponseDeadline` with these two composable middleware
functions. Preserve Task 7's current content-type detection and clock abstraction exactly.

```ts
export function responseDeadline(
  limits: Pick<HttpLimits, 'executionTimeoutMs' | 'streamLifetimeMs'>,
  clock: DeadlineClock = SYSTEM_CLOCK
): RequestHandler {
  return (_request, response, next) => {
    const projected = response as unknown as WritableResponseProjection;
    const originalWriteHead = projected.writeHead;
    let terminal = false;
    let deadline = clock.set(() => {
      if (terminal) return;
      terminal = true;
      projected.destroy();
    }, limits.executionTimeoutMs);
    let cleared = false;
    let streaming = false;
    const clear = () => {
      if (cleared || terminal) return;
      cleared = true;
      terminal = true;
      clock.clear(deadline);
    };
    projected.once('finish', clear);
    projected.once('close', clear);
    projected.writeHead = (...arguments_: unknown[]) => {
      const contentType = contentTypeFromWriteHead(arguments_);
      if (
        !terminal &&
        !streaming &&
        contentType?.split(';', 1)[0]?.trim().toLowerCase() === 'text/event-stream'
      ) {
        streaming = true;
        clock.clear(deadline);
        deadline = clock.set(() => {
          if (terminal) return;
          terminal = true;
          projected.destroy();
        }, limits.streamLifetimeMs);
      }
      return Reflect.apply(originalWriteHead, response, arguments_);
    };
    next();
  };
}

export function invokeNodeHandler(handler: NodeMcpRequestHandler): RequestHandler {
  return (request, response, next) => {
    const parsedBody = (request as unknown as { readonly body?: unknown }).body;
    void handler(request, response, parsedBody).catch(next);
  };
}
```

Define structural loader contracts in `runtime.ts`; do not statically import the v1 module. Preserve
Task 7's `RequestListener` and `ServerOptions` type imports from `node:http` so Node timeout options
remain constructor-time invariants:

```ts
interface LegacySseHandle {
  close(): Promise<void>;
}

type ReleaseRequestLease = () => void;
type RetainRequestLease = () => ReleaseRequestLease | undefined;
type RequestLeaseLookup = (response: object) => RetainRequestLease | undefined;

interface LegacySseModule {
  readonly mountLegacySseCompatibility: (
    router: Express,
    options: {
      readonly application: ApplicationContext;
      readonly authenticate: RequestHandler;
      readonly limits: Pick<
        HttpLimits,
        'maxLegacySseSessions' | 'legacySessionIdleTimeoutMs'
      >;
      readonly lookupRequestLease: RequestLeaseLookup;
      readonly onerror: (error: Error) => void;
    }
  ) => LegacySseHandle;
}

export interface HttpRuntimeDependencies {
  readonly createHandler: typeof createMcpHandler;
  readonly adaptHandler: typeof toNodeHandler;
  readonly createNodeServer: (options: ServerOptions, listener: RequestListener) => Server;
  readonly listen: (server: Server, port: number, host: string) => Promise<AddressInfo>;
  readonly loadLegacySse: () => Promise<LegacySseModule>;
}

function listenNodeServer(server: Server, port: number, host: string): Promise<AddressInfo> {
  return new Promise<AddressInfo>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('HTTP server did not expose a TCP address'));
        return;
      }
      resolve(address);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const DEFAULT_DEPENDENCIES: HttpRuntimeDependencies = Object.freeze({
  createHandler: createMcpHandler,
  adaptHandler: toNodeHandler,
  createNodeServer: (options: ServerOptions, listener: RequestListener) =>
    createServer(options, listener),
  listen: listenNodeServer,
  loadLegacySse: () => import('./legacy-sse.js')
});
```

Keep Task 7's injectable clock as the fourth argument, add the optional synchronous mount hook as a
separate fifth argument, and use this exact order:

```ts
export function buildHttpExpressApplication(
  security: ApplicationHttpSecurity,
  limits: HttpLimits,
  handler: NodeMcpRequestHandler,
  clock: DeadlineClock = SYSTEM_CLOCK,
  mountCompatibility?: (application: Express, lookupRequestLease: RequestLeaseLookup) => void
): Express {
  const application = express();
  const admission = concurrentRequestAdmission(limits.maxConcurrentRequests);
  application.use(exactHostValidation(security.allowedHosts));
  application.use(exactOriginValidation(security.allowedOrigins));
  application.use(admission.middleware);
  application.use(bodyReceiptDeadline(limits.bodyReceiptTimeoutMs));
  application.use(bodyTypeAndDeclaredSize(limits.bodyBytes));
  application.use(express.json({ limit: limits.bodyBytes }));
  application.use(bodyErrorHandler);
  application.use(stopAfterAnswered);
  application.use(responseDeadline(limits, clock));
  mountCompatibility?.(application, admission.lookupRequestLease);
  application.all('/mcp', security.authenticate, invokeNodeHandler(handler));
  application.use(terminalErrorHandler);
  return application;
}
```

Update `startHttpWithDependencies()` in its current Task 7 location, not a parallel runtime. Create the
beta handler first, dynamically load only when enabled, and capture the legacy handle through the mount
hook before Node server construction:

```ts
let handler: McpHttpHandler | undefined;
let legacy: LegacySseHandle | undefined;
let server: Server | undefined;
try {
  handler = dependencies.createHandler(createServerFactory(application, 'http'), {
    legacy: 'stateless',
    maxSubscriptions: limits.maxSubscriptions,
    onerror: diagnose
  });
  const nodeHandler = dependencies.adaptHandler(handler, { onerror: diagnose });
  let mountCompatibility:
    | ((expressApplication: Express, lookupRequestLease: RequestLeaseLookup) => void)
    | undefined;
  if (security.legacySseEnabled) {
    const legacyModule = await dependencies.loadLegacySse();
    mountCompatibility = (expressApplication, lookupRequestLease) => {
      legacy = legacyModule.mountLegacySseCompatibility(expressApplication, {
        application,
        authenticate: security.authenticate,
        limits,
        lookupRequestLease,
        onerror: diagnose
      });
    };
  }
  const expressApplication = buildHttpExpressApplication(
    security,
    limits,
    nodeHandler,
    SYSTEM_CLOCK,
    mountCompatibility
  );
  server = dependencies.createNodeServer(
    {
      connectionsCheckingInterval: Math.min(1_000, limits.headersTimeoutMs),
      headersTimeout: limits.headersTimeoutMs,
      keepAliveTimeout: limits.keepAliveTimeoutMs,
      requestTimeout: Math.max(limits.bodyReceiptTimeoutMs, limits.headersTimeoutMs)
    },
    expressApplication
  );
  server.maxRequestsPerSocket = limits.maxRequestsPerSocket;
  const address = await dependencies.listen(server, port, security.host);

  const ownedLegacy = legacy;
  const ownedHandler = handler;
  const ownedServer = server;
  const serverDrain = createNodeServerDrain(ownedServer);
  const close = createPhasedClose([
    [() => serverDrain.stopAdmission()],
    [
      () => ownedHandler.close(),
      ...(ownedLegacy === undefined ? [] : [() => ownedLegacy.close()])
    ],
    [() => serverDrain.forceAndWait()]
  ]);
  return Object.freeze({
    url: `http://${security.host}:${String(address.port)}/mcp`,
    limits,
    close
  });
} catch (startupFailure) {
  const serverDrain = server === undefined ? undefined : createNodeServerDrain(server);
  const cleanupFailures = await settleClosePhases([
    serverDrain === undefined ? [] : [() => serverDrain.stopAdmission()],
    [
      ...(handler === undefined ? [] : [() => handler.close()]),
      ...(legacy === undefined ? [] : [() => legacy.close()])
    ],
    serverDrain === undefined ? [] : [() => serverDrain.forceAndWait()]
  ]);
  if (cleanupFailures.length > 0) {
    throw new AggregateError(
      [...flattenFailure(startupFailure), ...cleanupFailures],
      'HTTP startup and cleanup failed'
    );
  }
  throw startupFailure;
}
```

Real `mountLegacySseCompatibility()` performs all fallible metadata preparation before registering
routes, so a mount failure has no unreturned session owner. A failure after the mount returns is owned
by the captured legacy handle and is aggregated by the existing startup path.

- [ ] **Step 7: Add the exact registry drift and audit release contract**

Create `scripts/check-legacy-sse-dependency.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';

const PACKAGE_NAME = '@modelcontextprotocol/sdk';
const APPROVED_VERSION = '1.29.0';
const APPROVED_INTEGRITY =
  'sha512-zo37mZA9hJWpULgkRpowewez1y6ML5GsXJPY8FI0tBBCd77HEvza4jDqRKOXgHNn867PVGCyTdzqpz0izu5ZjQ==';
const LOCK_PATH = 'node_modules/@modelcontextprotocol/sdk';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const packageDocument = JSON.parse(await readFile('package.json', 'utf8'));
const lockDocument = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert(
  packageDocument.dependencies?.[PACKAGE_NAME] === APPROVED_VERSION,
  'Legacy SSE dependency must be an exact production pin'
);
assert(
  lockDocument.packages?.['']?.dependencies?.[PACKAGE_NAME] === APPROVED_VERSION,
  'Legacy SSE root lock pin must be exact'
);
const sdkNodes = Object.entries(lockDocument.packages).filter(([path]) =>
  /(?:^|\/)node_modules\/@modelcontextprotocol\/sdk$/u.test(path)
);
assert(
  sdkNodes.length === 1 && sdkNodes[0]?.[0] === LOCK_PATH,
  'Legacy SSE lock must contain one root SDK node'
);
const locked = sdkNodes[0]?.[1];
assert(locked?.version === APPROVED_VERSION, 'Legacy SSE lock version drifted');
assert(locked?.integrity === APPROVED_INTEGRITY, 'Legacy SSE lock integrity drifted');
assert(locked?.dev === undefined, 'Legacy SSE SDK must be production-reachable');

const response = await fetch('https://registry.npmjs.org/@modelcontextprotocol%2Fsdk');
assert(response.ok, `Registry request failed with HTTP ${String(response.status)}`);
const metadata = await response.json();
assert(
  JSON.stringify(metadata['dist-tags']) === JSON.stringify({ latest: APPROVED_VERSION }),
  'Legacy SSE registry dist-tags drifted'
);
const approved = metadata.versions?.[APPROVED_VERSION];
assert(approved?.version === APPROVED_VERSION, 'Approved registry version is missing');
assert(approved?.dist?.integrity === APPROVED_INTEGRITY, 'Approved registry integrity drifted');
assert(approved?.engines?.node === '>=18', 'Approved registry Node engine drifted');
assert(
  !Object.hasOwn(metadata, 'deprecated') && !Object.hasOwn(approved, 'deprecated'),
  'Approved registry package is deprecated'
);
process.stdout.write('Legacy SSE dependency contract is current\n');
```

Add the exact package script:

```json
"release:check:legacy-sse": "node scripts/check-legacy-sse-dependency.mjs"
```

Run the focused static and networked gates immediately:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx vitest run   tests/http/legacy-sse.test.ts   tests/http/runtime.test.ts   tests/integration/process-lifecycle.test.ts   tests/architecture/execution-boundary.test.ts   tests/foundation/package-contract.test.ts
npm run typecheck
npm run release:check:legacy-sse
npm audit --omit=dev
```

Expected: all tests and typecheck pass, the registry script prints its one success line, and the
production audit reports zero vulnerabilities. Any registry tag, metadata, integrity, duplicate-node,
or audit change blocks release and requires explicit review; do not update the pin automatically.

- [ ] **Step 8: Run all deterministic gates and commit the compatibility slice atomically**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run format:check
npm run lint
npm run typecheck
npm run license:check
npm test
npm audit --omit=dev
npm run release:check:legacy-sse
git diff --check
git status --short
```

Expected: every deterministic gate passes; the networked dependency gate still confirms the approved
registry state; only the twelve Task 7b files named above are part of this slice. Do not run against a
production firewall.

```bash
git add \
  src/http/legacy-sse.ts \
  src/http/limits.ts \
  src/http/runtime.ts \
  tests/http/legacy-sse.test.ts \
  tests/http/runtime.test.ts \
  tests/http/task-7-review-fixes.test.ts \
  tests/integration/process-lifecycle.test.ts \
  tests/architecture/execution-boundary.test.ts \
  tests/foundation/package-contract.test.ts \
  scripts/check-legacy-sse-dependency.mjs \
  package.json \
  package-lock.json
git commit -m "feat: add isolated legacy SSE compatibility"
```

### Task 8: Make official 2025 and draft 2026 conformance executable

**Files:**
- Create: `scripts/run-conformance.mjs`
- Create: `tests/conformance/run-conformance.test.mjs`
- Modify: `tests/architecture/execution-boundary.test.ts`
- Modify: `tests/foundation/package-contract.test.ts`
- Modify: `vitest.config.ts`
- Modify: `package.json`

**Interfaces and non-negotiable boundaries:**
- `node scripts/run-conformance.mjs 2025-11-25` runs exactly three official scenarios in order:
  `server-initialize`, `ping`, `tools-list`.
- `node scripts/run-conformance.mjs 2026-07-28` runs exactly three official scenarios in order:
  `tools-list`, `input-required-result-unsupported-methods`, `http-header-validation`.
  Across both commands there are exactly six child invocations. The official package and lock remain
  pinned exactly at `@modelcontextprotocol/conformance@0.2.0-alpha.9`.
- The executable composition is the product composition: call `createDefaultApplicationRuntime()`,
  then real `startHttp(applicationRuntime.application, { port: 0 })`. Do not import or call
  `createMcpHandler`, `toNodeHandler`, `createMcpExpressApp`, `createServerFactory`, HTTP middleware,
  or limit internals. Task 8 does not modify `src/http/runtime.ts`; Task 7b must retain Task 7's
  terminal response-deadline state from `5438f21` and Task 8 consumes the resulting runtime only.
- Before opening either listener, run an executable fail-closed product preflight against the real
  application. The first capability exposed on HTTP must be object-identical to the foundation
  `serverStatusCapability`, named exactly `server_status`, accept strict `{}`, and retain the exact
  local read policy: `effect=read`, only `server.status`, no feature flag, backup/audit/confirmation
  `none`, `readOnlyHint=true`, `destructiveHint=false`, and `openWorldHint=false`. Dispatch that real
  capability through `dispatchApplicationCapability()` and require the exact read-only success shape.
  Its source dependency contract allows only Zod plus the closed kernel and forbids OPNsense client,
  network, filesystem, process, or transport imports. Identity, dependency reachability, and real
  dispatch together prove the foundation handler used by alpha.9 does not contact OPNsense. Any order,
  schema, metadata, identity, dependency, or output drift raises one stable
  `ConformanceProductContractError` before `startHttp`, without a fixture capability or auth/policy
  bypass.
- The official server CLI has no custom-header flag. Put a narrowly owned, test-only HTTP proxy on
  ephemeral `127.0.0.1`; it injects one static sentinel `Authorization: Bearer ...`, replaces only
  upstream `Host` with the real runtime host, and forwards the request method/body and all relevant
  MCP headers. It streams upstream status, headers, JSON, and SSE back without buffering. The real
  `/mcp` endpoint still performs product bearer, Host, exact-Origin, body, concurrency, deadline,
  protocol, and Task 7b default-off legacy-SSE enforcement. This private static bearer is neither
  OAuth nor suitable for remote or production use, and no production auth bypass or API is added.
- Both product and proxy URLs must match the raw canonical grammar
  `http://127.0.0.1:<1..65535>/mcp` before constructing a `URL`; explicit ports `1`, `80`, and `65535`
  are valid, while omission, zero, a leading zero, overflow, credentials, query, fragment (including
  bare `?`/`#`), or any other protocol/hostname/path is invalid. Return an immutable parsed projection
  containing the original href, numeric port, and exact `Host` authority so proxy code never depends
  on `URL.port`, which normalizes explicit port `80` to empty. Reject non-TCP listener addresses. The
  proxy accepts only `/mcp`, owns a finite maximum of 16 sockets, and sets
  `server.maxRequestsPerSocket` to the separate exact constant
  `MAX_PROXY_REQUESTS_PER_SOCKET=16`; it never inherits the product's larger limit. It uses finite
  Node header/request/keepalive limits,
  tracks every accepted socket, and force-destroys active sockets during close so `server.close()`
  cannot hang cleanup. It also enforces the product `bodyBytes` limit itself: reject a declared
  oversized `Content-Length` before opening upstream, count streamed/chunked bytes, and terminate
  both legs with a generic `413` as soon as the running count crosses the limit.
- Header forwarding is an ordered `rawHeaders` transform, not an object spread. On requests remove
  every inbound `Host` and `Authorization`, all standard hop-by-hop fields, and every field nominated
  by every `Connection` occurrence; append exactly one upstream `Host` and exactly one sentinel
  `Authorization`. Apply the same standard-plus-`Connection`-nominated filtering to upstream response
  `rawHeaders`. Preserve all remaining duplicates, casing, order, MCP semantic headers, response
  status/status-message, and streaming chunk boundaries.
- Every conformance child has a fixed 60-second wall deadline. On expiry send `SIGTERM`, wait a fixed
  2 seconds, then send `SIGKILL` if the child has not closed. Allow a final fixed 2 seconds for the
  `close` event, then call `child.unref()` and reject rather than hang if even SIGKILL is not observed. Clear all
  timers and reject on timeout, signal termination, spawn error, null code, or any non-zero code.
  Child deadline/grace/confirmation timers remain referenced until their single settlement; a pending
  Promise is not a Node event-loop owner and an `unref()`'d deadline could otherwise let the runner exit
  `0` before it fires. Only the direct-process watchdog installed after a reported failure is unreferenced.
  Spawn exactly `process.execPath` with the output of `buildScenarioArgv(...)` and
  `{ stdio: 'inherit', env: process.env }`; never duplicate or hand-build the argv in the child
  runner. Never pass `--suite`, `--force`, or `--expected-failures`; there is no expected-failure
  baseline.
- A child exit code of `0` is necessary but insufficient because conformance alpha.9 exits `0` when a
  scenario contains `WARNING` checks. Before starting the next scenario, validate exactly one
  alpha.9 `checks.json` below that scenario's private output directory. The directory chain and report
  must be real, non-symbolic-link entries whose resolved paths stay below the real state directory;
  the report must be a non-empty regular file no larger than 1 MiB, valid JSON, a non-empty array of
  check records, contain at least one `SUCCESS`, and contain only `SUCCESS` or `INFO` statuses. Missing,
  duplicate, escaped, symbolic-link, oversized, malformed, empty, `WARNING`, `FAILURE`, `SKIPPED`, or
  unknown-status evidence fails closed with a redacted `ConformanceReportError`. Put a referenced
  1-second deadline around each report validation and keep observing the underlying Promise if it
  settles late.
- Put a separate referenced 1-second acquisition deadline around each of these seven sequential phases:
  `makeStateDirectory`, `installEnvironment`, `createApplicationRuntime`, product preflight,
  `startProductHttp`, `startProxy`, and `resolveExecutable`. A timeout is a stable
  `ConformanceStartupTimeoutError`; the underlying Promise stays observed. If a timed-out acquisition
  later fulfills, immediately remove its state directory, restore its environment owner, or close its
  application/HTTP/proxy owner as applicable. Track those late cleanup Promises in original startup
  order, give arriving cleanup operations their own referenced 1-second deadlines, and wait a final
  referenced 1-second late-arrival grace before state removal and final environment restoration.
  Rejection or fulfillment after the grace remains observed, but is reported honestly as closure not
  confirmed; it must never become an unhandled rejection or a success claim.
- Cleanup has fixed deterministic ownership order: proxy listener, product HTTP runtime, owned
  application runtime. Start all three close operations concurrently and put an independent finite
  1-second deadline around each owner. Every owner, report, state-removal, and environment-restoration
  deadline remains referenced until settlement; tests must prove this with real timer handles.
  Only after all three have fulfilled, rejected, or timed out, recursively remove the private
  state/results directory under its own finite 1-second deadline. A timed-out owner is reported as
  **not confirmed closed**; the deadline only guarantees that the runner settles. Aggregate errors as
  primary, proxy, HTTP, application, late-startup, temp-state, environment, flattening nested
  `AggregateError`s within each position. A proxy-start failure must independently force-close the listener/sockets it
  created before rejecting because it has not yet returned an owner. The loop stops on its first
  child failure: seven successful startup/preflight phases consume less than 7 seconds; two
  just-under-60-second child successes, two 1-second report validations, and one 64-second timeout
  consume less than 186; owner, temp, environment, and direct-exit phases consume at most 4 more. The
  direct failure bound is therefore strictly below 197 seconds. That direct child-failure path has no
  late-startup slot, so it does not wait the late-arrival grace. The all-success path is below 193
  seconds. A startup timeout path is strictly below 13 seconds: less than 7 seconds of sequential
  startup, then at most 1 second for concurrent normal owners, 2 seconds for late-arrival plus late
  cleanup, 1 second each for state and environment, and the 1-second direct-exit watchdog.
  The real subprocess test installs its own referenced watchdog immediately after spawn: `SIGTERM` at
  198 seconds, `SIGKILL` 2 seconds later, final close confirmation 2 seconds later, all before its
  210-second Vitest timeout. PID capture and a `finally` kill/residue check are mandatory; Vitest's
  timeout alone is not process ownership.
- Before constructing the default application, delete all ambient `OPNSENSE_*`, `MCP_*`, `ENABLE_*`,
  and `IAC_*` values plus the exact guardrail names `READ_ONLY`, `ALLOWED_RESOURCES`,
  `ENABLED_FEATURE_FLAGS`, `AUTO_BACKUP`, `AUTO_BACKUP_STRICT`, `AUDIT_LOG`, `AUDIT_LOG_STRICT`, and
  `BACKUP_PATH`. Replace them with an explicit read-only, loopback-only environment: HTTP enabled,
  legacy SSE disabled, empty origins/resources/features, inert OPNsense URL `https://127.0.0.1:9/api`,
  sentinel credentials, every shell/SSH/restore/IaC switch false, and all backup/audit paths beneath
  the private temp directory. No scenario may contact a firewall, and no sentinel may appear in child
  argv, stdout, stderr, response bodies, thrown diagnostics, or retained files.
- `installConformanceEnvironment(...)` returns an idempotent environment owner. Before its first
  deletion it snapshots exact presence/value pairs for every owned prefix/exact/replacement name. Its
  `restore()` deletes all currently owned names (including names added during the run) and restores
  the snapshot, while leaving every non-owned name and any mutation to it untouched. Installation
  rolls itself back if assignment fails part-way. The runner has exclusive ownership of those names
  in its short-lived process; a concurrent writer to an owned name is intentionally overwritten by
  restoration, while unrelated mutations survive. Restoration runs in the final cleanup phase after
  every partial-start path, under its own 1-second deadline, and its failure is aggregated last.
- The direct executable delegates to an exported `runConformanceCli(...)` process-boundary seam. On
  failure it emits one fixed diagnostic with no caller-controlled error name or message, marks exit
  status `1`, and installs the sole unreferenced timer in this runner: a 1-second `process.exit(1)`
  watchdog. If no handle remains, normal event-loop exhaustion exits with status `1`; if a failed or
  timed-out owner retains a referenced handle, the watchdog forces termination. A real subprocess test
  must keep an interval referenced, inject a poison-named failure through the seam, and prove exact
  redacted stderr, exit `1`, no signal, and bounded termination.

**Official evidence fixed for this task:**
- Use only the installed official package from
  `https://github.com/modelcontextprotocol/conformance` and the official Streamable HTTP draft at
  `https://modelcontextprotocol.io/specification/draft/basic/transports/streamable-http`.
- The installed official CLI `server --help` has `--url`, `--scenario`, `--suite`,
  `--expected-failures`, `--output-dir`, `--spec-version`, `--force`, and `--verbose`, but no custom
  request-header or server-timeout option. Therefore auth injection belongs only in the private proxy,
  while the parent owns the child deadline.
- Official draft Streamable HTTP requires intermediaries to forward unrecognized MCP headers and
  preserves JSON-or-SSE responses; it requires `MCP-Protocol-Version`, `Mcp-Method`, and applicable
  `Mcp-Name` validation. The alpha.9 `http-header-validation` implementation sends raw positive and
  negative header cases, so the proxy must not synthesize or normalize MCP semantic headers.

- [ ] **Step 1: Write the failing package and architecture contracts**

Extend `tests/foundation/package-contract.test.ts` to assert the scripts and both manifest/lock pins:

```ts
expect(document.scripts['test:conformance:2025']).toBe(
  'npm run build && node scripts/run-conformance.mjs 2025-11-25'
);
expect(document.scripts['test:conformance:2026']).toBe(
  'npm run build && node scripts/run-conformance.mjs 2026-07-28'
);
expect(document.scripts['test:conformance']).toBe(
  'npm run test:conformance:2025 && npm run test:conformance:2026'
);
expect(document.devDependencies['@modelcontextprotocol/conformance']).toBe('0.2.0-alpha.9');
expect(lock.packages['']?.devDependencies?.['@modelcontextprotocol/conformance']).toBe(
  '0.2.0-alpha.9'
);
expect(lock.packages['node_modules/@modelcontextprotocol/conformance']).toMatchObject({
  version: '0.2.0-alpha.9',
  resolved:
    'https://registry.npmjs.org/@modelcontextprotocol/conformance/-/conformance-0.2.0-alpha.9.tgz',
  integrity:
    'sha512-Bi5P5TQlOQGPJxCT7UAHbpG7wsR7sNZskHGtCoZBo6vDu416D2FXPgM4wKbg91teIgj4HjGkhnzlvP7U2dszfQ==',
  dev: true
});
```

Add `devDependencies?: Record<string, string>` to the existing lock root projection. Do not run
`npm install`; package and lock already carry the required exact alpha.9 pin.

Also read `vitest.config.ts` in this contract and assert its exact discovery glob:

```ts
expect(vitestConfig).toContain("include: ['tests/**/*.test.{ts,mjs}']");
```

After creating the dynamically importing harness in Step 2, change only that line in
`vitest.config.ts` before recording RED:

```ts
include: ['tests/**/*.test.{ts,mjs}'],
```

Do not defer the config change to the green implementation. The executable JavaScript harness must be
listed before its runner module exists and be part of plain `vitest run`, `npm test`, and
`npm run verify`; a focused positional filter does not override an excluding configured `include`.

Extend `tests/architecture/execution-boundary.test.ts` with a source contract:

```ts
it('routes conformance only through the owned default product HTTP stack', async () => {
  const source = await readFile('scripts/run-conformance.mjs', 'utf8');
  expect(source).toContain("from '../dist/app/default-application.js'");
  expect(source).toContain("from '../dist/app/application-context.js'");
  expect(source).toContain(
    "from '../dist/capabilities/foundation/server-status.js'"
  );
  expect(source).toContain("from '../dist/http/runtime.js'");
  expect(source).toContain('createApplicationRuntime: () => createDefaultApplicationRuntime()');
  expect(source).toContain('startProductHttp: startHttp');
  expect(source).toContain(
    'dependencies.startProductHttp(applicationRuntime.application, { port: 0 })'
  );
  expect(source).toMatch(
    /buildScenarioArgv\(\s*executable,\s*proxyUrl,\s*version,\s*scenario,\s*stateDirectory\s*\)/u
  );
  expect(source).toContain('process.execPath');
  expect(source).toContain("stdio: 'inherit'");
  expect(source).toContain('request.rawHeaders');
  expect(source).toContain('upstreamResponse.rawHeaders');
  expect(source).toContain('limits.bodyBytes');
  expect(source).toContain('MAX_PROXY_REQUESTS_PER_SOCKET = 16');
  expect(source).toContain('server.maxRequestsPerSocket = MAX_PROXY_REQUESTS_PER_SOCKET');
  expect(source).toContain('assertConformanceProductContract');
  expect(source).toContain('dependencies.assertProductContract');
  expect(source).toContain('validateScenarioReport');
  expect(source).toContain('dependencies.validateReport');
  expect(source).toContain('environmentOwner.restore()');
  expect(source).toContain('export async function runConformanceCli');
  expect(source).toContain('dependencies.exit(1)');
  expect(source.match(/handle\.unref\(\)/gu)).toHaveLength(1);
  for (const forbidden of [
    'createMcpHandler',
    'toNodeHandler',
    'createMcpExpressApp',
    'createServerFactory',
    'configureNodeHttpLimits',
    'enforceHttpLimits',
    'jsonBodyLimit'
  ]) {
    expect(source).not.toContain(forbidden);
  }
  expect(source).not.toMatch(/MCP_HTTP_TOKEN\s*:\s*['"]false/u);
});
```

Add a second architecture contract over
`src/capabilities/foundation/server-status.ts`. Parse its import specifiers and require exactly
`['zod/v4', '../kernel.js']`; reject any import containing `opnsense`, `client`, `http`, `net`, `fs`,
`process`, or `transport`, plus direct `fetch`, socket, filesystem, process, or environment access.
Assert the Task 8 runner references the exported `serverStatusCapability` by identity and dispatches
only through `dispatchApplicationCapability`. Permit those two application-context exports only in
the test-owned `scripts/run-conformance.mjs` preflight; this exception must not widen any permitted
import edge in `src/` or the production architecture graph. The runtime tests, not these strings, prove exact
ordering, metadata, strict empty input, dispatch output, and refusal before listener creation.

Also assert that Task 8 does not edit or import the deprecated SSE module. The proxy may use
`node:http`; it may not import Express or any MCP server package. These source checks establish the
composition boundary only; the executable tests below—not string matching—prove raw duplicate
headers, body bounds, exact spawn options, report validation, referenced deadlines, direct-process
termination, and bounded ownership behavior.

- [ ] **Step 2: Write the failing executable harness tests**

Create `tests/conformance/run-conformance.test.mjs` with the AGPL header. Load the named test seams
from `scripts/run-conformance.mjs` dynamically in `beforeAll` and implement all of these tests before
the runner:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { EventEmitter, once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

let runner;
beforeAll(async () => {
  runner = await import('../../scripts/run-conformance.mjs');
});
```

Destructure the named seams inside each test (or a helper called only after `beforeAll`):
`CONFORMANCE_SENTINELS`, `MAX_CONFORMANCE_REPORT_BYTES`,
`MAX_PROXY_REQUESTS_PER_SOCKET`, `SCENARIOS_BY_VERSION`, `STARTUP_PHASE_TIMEOUT_MS`,
`assertConformanceProductContract`, `buildScenarioArgv`, `installConformanceEnvironment`,
`parseExactLoopbackMcpUrl`, `runConformance`, `runConformanceChild`, `runConformanceCli`,
`startLoopbackProxy`, and `validateScenarioReport`. Do not use a top-level static import of the missing
runner: `vitest list` must collect this file during RED, while `vitest run` fails in `beforeAll` because
the module/seams do not yet exist.

Use real local upstream/proxy listeners for forwarding tests and injectable fake children/owners for
lifecycle tests. The file must cover these exact behaviors:

1. **Raw streaming proxy, header boundaries, and auth injection.** Start a real upstream loopback
   server that records method, URL, `rawHeaders`, and streamed body. Use `node:net` to send a raw POST
   containing two `Host` lines, two wrong `Authorization` lines, two `Connection` lines nominating
   `X-Hop-In-A` and `X-Hop-In-B`, both nominated fields, `Accept: application/json,
   text/event-stream`, `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`, a duplicated
   `Mcp-Param-Region`, and an exact-limit body. Compare the upstream `rawHeaders` array: all four
   hostile Host/Auth occurrences, both Connection lines, and both nominated fields are absent;
   exactly one upstream Host and one sentinel bearer are appended; all MCP fields retain their
   original spelling, order, duplicates, and values; the body is byte-identical. Make upstream reply
   with `207 Custom`, two `Connection` lines nominating `X-Hop-Out-A`/`X-Hop-Out-B`, both nominated
   fields, duplicated `Mcp-Session-Id`, and two SSE chunks separated by a deferred promise. Assert the
   raw client receives neither Connection-nominated field, receives the exact MCP duplicates plus
   status/status-message, and observes chunk one before chunk two is released. This proves both
   forwarding directions from raw arrays; object-level `request.headers` assertions are insufficient.
2. **Body and connection bounds.** With `bodyBytes: 4`, send `Content-Length: 5` without completing
   the body and assert a generic `413`, `Connection: close`, and zero upstream connections. Send a
   chunked `2 + 3` byte body, assert the running counter returns the same generic `413`, destroys the
   partially opened upstream leg, and leaves no retained socket; send exactly four streamed bytes and
   assert success. Open held sockets beyond the limit, prove admission above 16 is destroyed, then
   call `close()` twice and prove both calls return the same promise and every accepted socket closes.
   Assert `MAX_PROXY_REQUESTS_PER_SOCKET === 16`; on one real raw keep-alive socket send 17 complete
   requests and prove exactly the first 16 reach upstream. Depending on the current Node 22 close
   timing, the seventeenth must either receive Node's local `503` plus `Connection: close` or find the
   socket already closed; it must never be forwarded. Also assert the constructed server property is
   exactly 16 even when `limits.maxRequestsPerSocket` is larger.
   Separately abort inbound, upstream-request, upstream-response, and downstream legs and assert the
   coupled peer is destroyed without an unhandled error or credential-bearing body.
3. **Exact raw URL/path table.** Assert `parseExactLoopbackMcpUrl()` accepts canonical explicit ports
   `1`, `80`, and `65535` and returns `{ href, hostname: '127.0.0.1', port: <number>,
   host: '127.0.0.1:<digits>', pathname: '/mcp' }`; specifically prove explicit `:80` remains numeric
   `80` with Host `127.0.0.1:80` even though `new URL(...).port` would be empty. Reject `:0`, omitted
   port, `:01`, `:080`, `:00080`, `:65536`, uppercase/alternate protocol or host, `localhost`, IPv6,
   credentials, whitespace/percent-encoded authority tricks, `/`, `/other`, `/mcp/`, query and
   fragment variants including bare `/mcp?` and `/mcp#`.
   Also reject every canonical-looking URL prefixed or suffixed by LF, CRLF, tab, space, or NUL.
   Stub the global `URL` constructor for that invalid-input table and assert it is never called: raw
   syntax and complete-input consumption must fail before normalization.

   ```js
   const canonical = 'http://127.0.0.1:80/mcp';
   const urlConstructor = vi.fn();
   vi.stubGlobal('URL', urlConstructor);
   try {
     for (const boundary of ['\n', '\r\n', '\t', ' ', '\0']) {
       expect(() => parseExactLoopbackMcpUrl(`${boundary}${canonical}`)).toThrow(
         'Invalid loopback MCP URL'
       );
       expect(() => parseExactLoopbackMcpUrl(`${canonical}${boundary}`)).toThrow(
         'Invalid loopback MCP URL'
       );
     }
     expect(urlConstructor).not.toHaveBeenCalled();
   } finally {
     vi.unstubAllGlobals();
   }
   ```

   Through a real proxy, raw-request
   `/`, `/other`, `/mcp/`, `/mcp?x=1`, and absolute-form URLs; each returns local `404` and creates no
   upstream request. Assert the returned proxy URL and the accepted upstream URL both expose TCP
   `127.0.0.1`, an ephemeral non-zero port, and exact `/mcp`. Inject a real occupied-port listen
   failure and a non-TCP address result; prove the unreturned proxy server and all sockets are forced
   closed before rejection.
4. **Environment replacement, rollback, and restoration.** Seed an isolated environment with poison
   values for every owned prefix/exact guardrail, absent replacement keys, and an unrelated key. Call
   `installConformanceEnvironment(temp, env)` and assert the complete replacement object:
   `READ_ONLY=true`, HTTP true on `127.0.0.1`, legacy SSE false, empty resource/origin/feature values,
   inert port-9 OPNsense URL, false privileged switches, and backup/audit paths below `temp`. Mutate
   the unrelated key and add a new `OPNSENSE_*` name after installation; call `restore()` twice and
   assert the exact original presence/values return, the new owned name disappears, and the unrelated
   mutation survives. Repeat with a Proxy environment whose setter throws half-way through assignment
   and assert installation restores the pre-call snapshot before rejecting. Assert no poison survives
   while installed and no sentinel credential is included in `buildScenarioArgv()`.
5. **Real product preflight before listeners.** Test `assertConformanceProductContract()` with
   injectable list/dispatch seams. Accept only an object-identical first `serverStatusCapability`,
   exact title/description, exact `server_status` identity, exact HTTP/stdio transports,
   annotations (including `idempotentHint=true`), policy, strict `{}` parsing, and exact dispatched
   `{ status:'ok', readOnly:true, version:'0.1.0' }` success. Independently vary ordering, identity,
   name, schema acceptance, each policy/annotation field, dispatch refusal/confirmation/malformed
   output, synchronous throw, and rejection; every drift case is the same stable
   `ConformanceProductContractError`. A never-settling dispatch is instead exercised through the
   referenced product-preflight startup phase and yields the stable `ConformanceStartupTimeoutError`.
   In orchestration record
   `application -> product-preflight -> startHttp`; any preflight drift creates no HTTP/proxy listener
   and no child. Run the default seam once against the real default application. Combined with the
   architecture import contract, this proves the exercised handler is the network-free foundation
   implementation, not a test fixture or direct handler bypass.
6. **Exact scenarios, argv, and spawn call.** Assert `SCENARIOS_BY_VERSION` equals the two ordered
   three-entry arrays above. Build all invocations and compare the six complete arrays, each exactly:

   ```js
   [
     executable,
     'server',
     '--url',
     proxyUrl,
     '--scenario',
     scenario,
     '--spec-version',
     version,
     '--verbose',
     '--output-dir',
     `${stateDirectory}/results/${version}/${scenario}`
   ]
   ```

   Assert the flattened argv contains none of `--suite`, `--force`, `--expected-failures`, any
   `Authorization` string, or any sentinel. With a spawn spy that immediately emits `close(0, null)`,
   call `runConformanceChild()` and assert its single call is exactly
   `spawnProcess(process.execPath, buildScenarioArgv(...), { stdio: 'inherit', env: process.env })`.
   This is the executable proof that the runner and argv builder cannot drift.
7. **Strict machine-readable scenario reports.** Materialize the real alpha.9 layout
   `<scenario-output>/server-<scenario>-<timestamp>/checks.json` and assert
   `validateScenarioReport()` accepts a non-empty array containing `SUCCESS` and `INFO`. Assert
   `MAX_CONFORMANCE_REPORT_BYTES` is exactly `1_048_576`. Then cover, independently: missing scenario
   directory, missing report, two run directories/reports, unexpected sibling entries, symlinked
   results/version/scenario/run/report entries, a realpath outside the state root, a directory instead of a regular
   report, zero bytes, more than 1 MiB, malformed JSON, non-array JSON, empty array, non-record rows,
   missing/non-string status, no `SUCCESS`, and each of `WARNING`, `FAILURE`, `SKIPPED`, or an unknown
   status. Every rejection is the same message-free `ConformanceReportError` and contains no path,
   report content, scenario-controlled text, poison, or sentinel. In orchestration, record
   `child -> report -> child -> report`; prove a warning or malformed first report prevents the next
   child, a never-settling validator is rejected by its referenced 1-second deadline, and late
   fulfillment/rejection stays observed. A child `0` without accepted evidence is not success.
8. **Child deadline, propagation, and real kill.** Under fake timers, return a fake EventEmitter child
   whose `kill` records signals. Advance 60 seconds and assert one `SIGTERM`; advance 2 seconds without
   `close` and assert one `SIGKILL`; emit `close` and assert a timeout rejection. Independently assert
   close code `0` resolves, code `7`, null code, unexpected signal, and spawn `error` reject. In every
   case assert deadline/grace/kill-confirmation timers remain referenced while active, are cleared on
   settlement, and one child outcome settles once. A real child timeout handle must report
   `hasRef() === true`; do not substitute a mere `unref()` spy.
   Add a no-close-after-SIGKILL case and prove it rejects at the final fixed bound and calls
   `child.unref()`. Then inject a real `spawnProcess` that first asserts the requested executable,
   exact built argv, and options, but launches this inline fixture instead:

   ```js
   spawn(process.execPath, [
     '-e',
     "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"
   ], { stdio: 'ignore' });
   ```

   Map the requested 60-second/2-second timers to 1,000 ms/500 ms real test timers so Node has time
   to install its signal handler even on a loaded CI host. Capture its PID,
   assert the runner reaches `SIGKILL`, rejects, and poll `process.kill(pid, 0)` until it throws
   `ESRCH`. In `finally`, kill any still-live PID. A timeout test is invalid if it leaves a child.
9. **Every partial-start, never-settling owner, and cleanup mode.** Use `it.each` over synchronous
   throw and rejected promise for
   `createDefaultApplicationRuntime`, `startHttp`, `startLoopbackProxy`, and each of the six scenario
   children. For each of `makeStateDirectory`, `installEnvironment`, `createApplicationRuntime`,
   product preflight, `startHttp`, `startLoopbackProxy`, and `resolveExecutable`, inject a
   never-settling Promise and prove its exact referenced 1-second startup deadline terminates the run.
   Then fulfill each timed-out acquisition during the late-arrival grace: late state is removed, late
   environment is restored, and late application/HTTP/proxy owners are closed exactly once; late
   executable fulfillment is observed and discarded. Reject after timeout and prove no unhandled
   rejection. Hold fulfillment beyond the grace and require an honest not-confirmed-closed error,
   while the attached late handler remains observed. Assert only owners successfully returned before the failure are closed, all returned
   owners are attempted, temp removal starts only after the three bounded owner outcomes, environment
   restoration is attempted in a final phase, and the primary error is first. For proxy, HTTP, and
   application in turn, return a promise that never settles; advance the injectable 1-second timer
   and prove `runConformance()` terminates with a named `ConformanceCleanupTimeoutError` in that
   owner's stable slot, while explicitly recording that closure was not confirmed. Repeat with a
   never-settling temp removal and environment restore. Give every owner/temp/restore failure in both
   synchronous-throw and rejected-promise forms; assert the three owner operations begin before any
   is released, temp removal waits for all owner outcomes, an installed environment owner restores
   last after every later partial-start failure, a partially failed installation rolls itself back
   immediately, every real owner/temp/environment timer reports `hasRef() === true` until it is
   cleared, and final errors are exactly
   the redacted stable slots
   `[primary?, proxy, http, application, late-startup, temp-state, environment]`, with
   `ConformanceCleanupTimeoutError` only in timed-out slots and no injected message retained. Include
   nested aggregates and assert flattening remains within each owner slot.
10. **Direct CLI failure and real forced exit.** Unit-test `runConformanceCli()` with injected success
   and failure functions: success writes nothing and schedules nothing; failure with poison in both
   `.name` and `.message` writes exactly `Conformance run failed\n`, marks status `1`, schedules exactly
   one 1-second watchdog, and calls `unref()` only on that direct-watchdog handle. Then spawn a real
   Node `--input-type=module -e` fixture which imports the repository runner after `npm run build`, creates a referenced
   interval, and calls the seam with a poison-named rejected Promise. Assert stdout is empty, stderr is
   exactly the fixed diagnostic with no poison/sentinel, exit code is `1`, signal is null, and the
   process closes after the 1-second grace and before a 3-second outer bound. Register the PID before
   awaiting output and kill it in `finally`; a source substring assertion is not termination evidence.
11. **No sentinel leak, owned outer watchdog, and dedicated TMPDIR real runs.** Exercise proxy upstream failure, child
   non-zero/timeout, cleanup timeout, and aggregate
   cleanup failure while capturing returned bodies and `stderr`; assert no value from
   `CONFORMANCE_SENTINELS` and no poison ambient credential appears. Diagnostics contain only the
   fixed CLI failure line or stable internal categories—not caller-controlled error names/messages,
   environment values, paths, report contents, or argv.
   For each version create a dedicated empty directory, pass it as the subprocess `TMPDIR`, and spawn
   the built runner with ambient poison `OPNSENSE_*`, `MCP_*`, `ENABLE_*`, `IAC_*`, and guardrail
   variables. Immediately record the PID and install a referenced test-owned watchdog which sends
   `SIGTERM` at 198 seconds, `SIGKILL` at 200 seconds if still open, and rejects if `close` is still
   absent at 202 seconds. Give the Vitest case a 210-second bound, register stdout/stderr and cleanup
   before its first assertion, and in `finally` kill any remaining PID then poll for `ESRCH`. A plain
   Vitest timeout with no child destruction is forbidden. Assert exit `0`, captured stdout/stderr contains
   no poison or sentinel, every selected child produced a strictly accepted machine-readable report
   before cleanup, the dedicated `TMPDIR` is still exactly empty after exit, and no `results/`
   or conformance state exists in the repository. Remove the dedicated parent in test teardown. These
   are the real alpha.9 processes against the real authenticated default product HTTP runtime through
   the private proxy, not mocks; a repository-only residue assertion is vacuous and insufficient.

Use teardown with `Promise.allSettled` and force-destroy test sockets/children so a failed assertion
cannot hang Vitest. Snapshot every `process.env` name a test changes and restore exact presence/value
in `afterEach`, including `TMPDIR`, even after a partial assertion failure. Do not relax the real-run
assertions or skip them in `npm test`.

#### Task 8 review-remediation addendum

The post-implementation security and quality reviews are part of Task 8's executable contract, not a later
documentation task:

- Open the single `checks.json` evidence file once with `O_NOFOLLOW`; use `fstat({ bigint: true })`, a bounded
  `MAX_CONFORMANCE_REPORT_BYTES + 1` positional read on that same handle, and final path-chain revalidation.
  Compare device, inode, size, type, `ctimeNs`, and `mtimeNs` before open, after read, and at final
  revalidation. Reject atomic replacement, symlink substitution, growth, and same-inode equal-length
  `WARNING -> SUCCESS -> WARNING` rewrites with the same redacted `ConformanceReportError`. Bound and verify
  the handle close on every path.
- Do not publish an upstream response before the inbound request body has ended within its byte bound.
  Couple inbound request, upstream request, upstream response, and downstream response failures in both
  directions; an early response followed by an oversized chunked body must still produce the fixed `413`
  and close both legs.
- The real 2025 and 2026 subprocess cases require stderr to be exactly empty. Alpha.9 verbose stdout is
  accepted only through a strict parser proving exactly three ordered scenario blocks, one canonical
  loopback proxy URL, result paths strictly below the dedicated `TMPDIR`, parseable check arrays containing
  only `SUCCESS`/`INFO`, and no repository/executable/argv/auth/poison/sentinel value. Every `finally` that
  may send `SIGKILL` must poll for `ESRCH` before releasing PID ownership.
- The harness must independently prove all report symlink boundaries, a real occupied-port failure, the
  seventeenth socket refusal before proxy close, every product-preflight field, all seven late-startup
  acquisitions, and synchronous plus asynchronous cleanup failures. Assertions after global cleanup are
  not evidence of the admission or ownership boundary being tested.

Now change `vitest.config.ts` to `include: ['tests/**/*.test.{ts,mjs}']`. This is test-discovery
infrastructure, not the runner implementation. Run
`npx vitest list tests/conformance/run-conformance.test.mjs` and require it to print the harness test
names successfully even though `scripts/run-conformance.mjs` is still absent.

- [ ] **Step 3: Build and record the expected red state**

Run with the repository's Node 22 toolchain:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run build
npx vitest list tests/conformance/run-conformance.test.mjs
npx vitest run \
  tests/conformance/run-conformance.test.mjs \
  tests/architecture/execution-boundary.test.ts \
  tests/foundation/package-contract.test.ts
```

Expected: `vitest list` succeeds and names the `.mjs` harness; `vitest run` then FAILS from its dynamic
`beforeAll` import because `scripts/run-conformance.mjs` and its named seams do not exist, while the
package scripts also do not build first. The exact package/lock alpha.9 assertions already pass. Do
not use `--passWithNoTests`; collection and failing module load are both required RED evidence.

- [ ] **Step 4: Implement the owned runner around the real product runtime**

The `.mjs` harness is already discoverable from RED. Do not add a second Vitest config or a special
conformance-only test command.

Create `scripts/run-conformance.mjs` with the AGPL header and these public seams/constants:

```js
// SPDX-License-Identifier: AGPL-3.0-or-later
import { spawn } from 'node:child_process';
import { lstat, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dispatchApplicationCapability,
  listApplicationCapabilities
} from '../dist/app/application-context.js';
import { createDefaultApplicationRuntime } from '../dist/app/default-application.js';
import { serverStatusCapability } from '../dist/capabilities/foundation/server-status.js';
import { startHttp } from '../dist/http/runtime.js';

const LOOPBACK = '127.0.0.1';
const CHILD_TIMEOUT_MS = 60_000;
const CHILD_KILL_GRACE_MS = 2_000;
const CHILD_KILL_CONFIRM_MS = 2_000;
const REPORT_VALIDATION_TIMEOUT_MS = 1_000;
export const STARTUP_PHASE_TIMEOUT_MS = 1_000;
const LATE_STARTUP_ARRIVAL_GRACE_MS = 1_000;
const LATE_STARTUP_CLEANUP_TIMEOUT_MS = 1_000;
const OWNER_CLEANUP_TIMEOUT_MS = 1_000;
const STATE_CLEANUP_TIMEOUT_MS = 1_000;
const ENVIRONMENT_RESTORE_TIMEOUT_MS = 1_000;
const DIRECT_EXIT_GRACE_MS = 1_000;
const MAX_PROXY_CONNECTIONS = 16;
export const MAX_PROXY_REQUESTS_PER_SOCKET = 16;
const CONFORMANCE_VERSION = '0.2.0-alpha.9';

export const MAX_CONFORMANCE_REPORT_BYTES = 1_048_576;

export const SCENARIOS_BY_VERSION = Object.freeze({
  '2025-11-25': Object.freeze(['server-initialize', 'ping', 'tools-list']),
  '2026-07-28': Object.freeze([
    'tools-list',
    'input-required-result-unsupported-methods',
    'http-header-validation'
  ])
});

export const CONFORMANCE_SENTINELS = Object.freeze({
  token: 'CONFORMANCE_HTTP_SENTINEL_TOKEN_0123456789',
  requestState: 'CONFORMANCE_REQUEST_STATE_0123456789',
  apiKey: 'conformance-sentinel-key',
  apiSecret: 'conformance-sentinel-secret'
});
```

Define the owned environment namespace and the injectable real timer once:

```js
const OWNED_ENVIRONMENT_PREFIXES = Object.freeze(['OPNSENSE_', 'MCP_', 'ENABLE_', 'IAC_']);
const OWNED_ENVIRONMENT_EXACT = Object.freeze([
  'READ_ONLY',
  'ALLOWED_RESOURCES',
  'ENABLED_FEATURE_FLAGS',
  'AUTO_BACKUP',
  'AUTO_BACKUP_STRICT',
  'AUDIT_LOG',
  'AUDIT_LOG_STRICT',
  'BACKUP_PATH'
]);

const SYSTEM_TIMER = Object.freeze({
  set: setTimeout,
  clear: clearTimeout
});

function scheduleReferencedTimer(clock, callback, milliseconds) {
  return clock.set(callback, milliseconds);
}

function isOwnedEnvironmentName(name) {
  return (
    OWNED_ENVIRONMENT_EXACT.includes(name) ||
    OWNED_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}
```

Implement `installConformanceEnvironment(stateDirectory, environment = process.env)` as a
transactional owner. Build the replacement object below first; snapshot exact `{ present, value }`
entries for the union of its keys and every currently owned key; delete all currently owned keys;
then assign the explicit inert set (including both current and historical backup/audit path names so
later product composition cannot inherit a host path):

```js
const replacements = Object.freeze({
  READ_ONLY: 'true',
  ALLOWED_RESOURCES: '',
  ENABLED_FEATURE_FLAGS: '',
  AUTO_BACKUP: 'false',
  AUTO_BACKUP_STRICT: 'true',
  AUDIT_LOG_STRICT: 'true',
  MCP_HTTP_ENABLED: 'true',
  MCP_HTTP_HOST: LOOPBACK,
  MCP_HTTP_PORT: '3000',
  MCP_HTTP_TOKEN: CONFORMANCE_SENTINELS.token,
  MCP_LEGACY_SSE_ENABLED: 'false',
  MCP_ALLOWED_HOSTS: LOOPBACK,
  MCP_ALLOWED_ORIGINS: '',
  MCP_REQUEST_STATE_SECRET: CONFORMANCE_SENTINELS.requestState,
  OPNSENSE_URL: 'https://127.0.0.1:9/api',
  OPNSENSE_API_KEY: CONFORMANCE_SENTINELS.apiKey,
  OPNSENSE_API_SECRET: CONFORMANCE_SENTINELS.apiSecret,
  OPNSENSE_VERIFY_TLS: 'true',
  ENABLE_SSH_FEATURES: 'false',
  ENABLE_SHELL_TOOLS: 'false',
  ENABLE_RESTORE_TOOLS: 'false',
  IAC_ENABLED: 'false',
  BACKUP_PATH: join(stateDirectory, 'backups'),
  AUDIT_LOG: join(stateDirectory, 'audit.jsonl'),
  OPNSENSE_BACKUP_PATH: join(stateDirectory, 'backups'),
  OPNSENSE_AUDIT_LOG: join(stateDirectory, 'audit.jsonl')
});
const snapshotNames = new Set([
  ...Object.keys(replacements),
  ...Object.keys(environment).filter(isOwnedEnvironmentName)
]);
const snapshot = new Map(
  [...snapshotNames].map((name) => [
    name,
    { present: Object.hasOwn(environment, name), value: environment[name] }
  ])
);
for (const name of Object.keys(environment)) {
  if (isOwnedEnvironmentName(name) || Object.hasOwn(replacements, name)) delete environment[name];
}
Object.assign(environment, replacements);
```

Return `Object.freeze({ restore })`, where `restore` is idempotent and executes this exact algorithm:

```js
function restore() {
  for (const name of Object.keys(environment)) {
    if (isOwnedEnvironmentName(name) || Object.hasOwn(replacements, name)) {
      delete environment[name];
    }
  }
  for (const [name, entry] of snapshot) {
    if (entry.present) environment[name] = entry.value;
  }
}
```

If any delete or assignment throws during installation, call `restore()` before rethrowing the
original error; if rollback also throws, throw `AggregateError([original, rollback])` in that order.
Restoration owns only the prefixes, exact names, and explicit replacement keys. The process-isolation
contract deliberately restores the initial value of an owned key even if another writer changed it
during the run, but it never rewinds a non-owned key.

Validate the exact product behavior alpha.9 will exercise before opening a listener:

```js
function conformanceProductContractError() {
  const error = new Error('Conformance product contract is unavailable');
  error.name = 'ConformanceProductContractError';
  return error;
}

export async function assertConformanceProductContract(application, overrides = {}) {
  const dependencies = {
    list: listApplicationCapabilities,
    dispatch: dispatchApplicationCapability,
    expected: serverStatusCapability,
    ...overrides
  };
  try {
    const exposed = dependencies.list(application, 'http');
    const first = exposed[0];
    if (
      first !== dependencies.expected ||
      first.id !== 'server.status' ||
      first.mcpName !== 'server_status' ||
      first.title !== 'Server status' ||
      first.description !==
        'Report whether the MCP server is healthy and operating in read-only mode.' ||
      first.annotations.readOnlyHint !== true ||
      first.annotations.destructiveHint !== false ||
      first.annotations.idempotentHint !== true ||
      first.annotations.openWorldHint !== false ||
      first.transports.length !== 2 ||
      first.transports[0] !== 'stdio' ||
      first.transports[1] !== 'http' ||
      first.policy.effect !== 'read' ||
      first.policy.backup !== 'none' ||
      first.policy.audit !== 'none' ||
      first.policy.confirmation !== 'none' ||
      first.policy.timeoutMs !== 1_000 ||
      first.policy.resourceScopes.length !== 1 ||
      first.policy.resourceScopes[0] !== 'server.status' ||
      first.policy.requiredFeatureFlags.length !== 0 ||
      first.policy.redactFields.length !== 0
    ) {
      throw conformanceProductContractError();
    }
    const parsed = first.parseInput({});
    if (parsed === null || typeof parsed !== 'object' || Object.keys(parsed).length !== 0) {
      throw conformanceProductContractError();
    }
    let rejectsExtra = false;
    try {
      first.parseInput({ unexpected: true });
    } catch {
      rejectsExtra = true;
    }
    if (!rejectsExtra) throw conformanceProductContractError();

    const result = await dependencies.dispatch(
      application,
      { name: 'server_status', arguments: {} },
      { transport: 'http', principalId: 'conformance:preflight' }
    );
    if (
      result.kind !== 'success' ||
      result.output.status !== 'ok' ||
      result.output.readOnly !== true ||
      result.output.version !== '0.1.0' ||
      Object.keys(result.output).sort().join(',') !== 'readOnly,status,version'
    ) {
      throw conformanceProductContractError();
    }
  } catch {
    throw conformanceProductContractError();
  }
}
```

Never call a handler property directly: the definition intentionally exposes no handler. The exact
foundation object identity plus application dispatch preserves the closed kernel, timeout, exposure,
and policy path. The architecture contract on the foundation module proves this exact object has no
OPNsense/network dependency.

Implement these remaining seams exactly by responsibility:

```js
export function buildScenarioArgv(executable, proxyUrl, version, scenario, stateDirectory) {
  return [
    executable,
    'server',
    '--url',
    proxyUrl,
    '--scenario',
    scenario,
    '--spec-version',
    version,
    '--verbose',
    '--output-dir',
    join(stateDirectory, 'results', version, scenario)
  ];
}

export async function resolveConformanceExecutable() {
  const packagePath = fileURLToPath(
    new URL('../node_modules/@modelcontextprotocol/conformance/package.json', import.meta.url)
  );
  const document = JSON.parse(await readFile(packagePath, 'utf8'));
  if (document.version !== CONFORMANCE_VERSION) {
    throw new Error('Conformance package version mismatch');
  }
  return join(dirname(packagePath), 'dist', 'index.js');
}

export function parseExactLoopbackMcpUrl(value) {
  if (typeof value !== 'string') throw new Error('Invalid loopback MCP URL');
  const match = /^http:\/\/127\.0\.0\.1:(?<port>0|[1-9][0-9]{0,4})\/mcp(?![\s\S])/u.exec(value);
  if (match?.[0] !== value) throw new Error('Invalid loopback MCP URL');
  const portText = match?.groups?.port;
  const port = portText === undefined ? Number.NaN : Number(portText);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error('Invalid loopback MCP URL');
  }
  const parsed = new URL(value);
  return Object.freeze({
    href: value,
    url: parsed,
    hostname: LOOPBACK,
    port,
    host: `${LOOPBACK}:${portText}`,
    pathname: '/mcp'
  });
}
```

The raw start anchor plus the absolute `(?![\s\S])` end assertion and full-match equality run before
`new URL()`. They consume the entire input, including rejecting leading or trailing LF, CRLF, tab,
space, and NUL, so normalization cannot erase explicit `:80`, accept a leading-zero port, or hide
empty query/fragment delimiters. `startLoopbackProxy()` must use
only the returned numeric `port`, `hostname`, `host`, and `pathname` for its upstream request and Host
injection; `projection.url.port` is never an authority source.

Validate alpha.9 evidence through filesystem structure, never through console text or exit code alone:

```js
function conformanceReportError() {
  const error = new Error('Conformance scenario report is invalid');
  error.name = 'ConformanceReportError';
  return error;
}

function isStrictDescendant(parent, candidate) {
  const child = relative(parent, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export async function validateScenarioReport(stateDirectory, version, scenario) {
  try {
    const stateMetadata = await lstat(stateDirectory);
    if (stateMetadata.isSymbolicLink() || !stateMetadata.isDirectory()) throw conformanceReportError();
    const stateRoot = await realpath(stateDirectory);

    const resultsPath = join(stateRoot, 'results');
    const resultsMetadata = await lstat(resultsPath);
    if (resultsMetadata.isSymbolicLink() || !resultsMetadata.isDirectory()) {
      throw conformanceReportError();
    }
    const resultsRoot = await realpath(resultsPath);
    if (!isStrictDescendant(stateRoot, resultsRoot)) throw conformanceReportError();

    const versionPath = join(resultsRoot, version);
    const versionMetadata = await lstat(versionPath);
    if (versionMetadata.isSymbolicLink() || !versionMetadata.isDirectory()) {
      throw conformanceReportError();
    }
    const versionRoot = await realpath(versionPath);
    if (!isStrictDescendant(resultsRoot, versionRoot)) throw conformanceReportError();

    const scenarioPath = join(versionRoot, scenario);
    const scenarioMetadata = await lstat(scenarioPath);
    if (scenarioMetadata.isSymbolicLink() || !scenarioMetadata.isDirectory()) {
      throw conformanceReportError();
    }
    const scenarioRoot = await realpath(scenarioPath);
    if (!isStrictDescendant(versionRoot, scenarioRoot)) throw conformanceReportError();

    const runEntries = await readdir(scenarioRoot, { withFileTypes: true });
    if (
      runEntries.length !== 1 ||
      !runEntries[0].isDirectory() ||
      runEntries[0].isSymbolicLink() ||
      !runEntries[0].name.startsWith(`server-${scenario}-`)
    ) {
      throw conformanceReportError();
    }
    const runPath = join(scenarioRoot, runEntries[0].name);
    const runMetadata = await lstat(runPath);
    if (runMetadata.isSymbolicLink() || !runMetadata.isDirectory()) throw conformanceReportError();
    const runRoot = await realpath(runPath);
    if (!isStrictDescendant(scenarioRoot, runRoot)) throw conformanceReportError();

    const reportEntries = await readdir(runRoot, { withFileTypes: true });
    if (
      reportEntries.length !== 1 ||
      reportEntries[0].name !== 'checks.json' ||
      reportEntries[0].isSymbolicLink() ||
      !reportEntries[0].isFile()
    ) {
      throw conformanceReportError();
    }
    const reportPath = join(runRoot, 'checks.json');
    const reportMetadata = await lstat(reportPath);
    if (
      reportMetadata.isSymbolicLink() ||
      !reportMetadata.isFile() ||
      reportMetadata.size < 1 ||
      reportMetadata.size > MAX_CONFORMANCE_REPORT_BYTES
    ) {
      throw conformanceReportError();
    }
    const reportRoot = await realpath(reportPath);
    if (!isStrictDescendant(runRoot, reportRoot) || reportRoot !== reportPath) {
      throw conformanceReportError();
    }

    const checks = JSON.parse(await readFile(reportRoot, 'utf8'));
    if (!Array.isArray(checks) || checks.length === 0) throw conformanceReportError();
    const statuses = checks.map((check) => {
      if (check === null || typeof check !== 'object' || Array.isArray(check)) {
        throw conformanceReportError();
      }
      return check.status;
    });
    if (
      !statuses.includes('SUCCESS') ||
      statuses.some((status) => status !== 'SUCCESS' && status !== 'INFO')
    ) {
      throw conformanceReportError();
    }
  } catch {
    throw conformanceReportError();
  }
}
```

The fixed error deliberately omits version, scenario, paths, parsed checks, and nested filesystem or
JSON errors. A fresh private state directory means exactly one run directory and one report are
expected per selected scenario; accepting an older or additional report would make the attestation
ambiguous. The 1 MiB pre-read bound is part of the public seam contract.

Use one case-insensitive raw-header filter in both directions:

```js
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

function filterRawHeaders(rawHeaders, additionalNames = []) {
  const dropped = new Set([...HOP_BY_HOP, ...additionalNames.map((name) => name.toLowerCase())]);
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() !== 'connection') continue;
    for (const value of rawHeaders[index + 1].split(',')) {
      const name = value.trim().toLowerCase();
      if (name !== '') dropped.add(name);
    }
  }
  const result = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (!dropped.has(rawHeaders[index].toLowerCase())) {
      result.push(rawHeaders[index], rawHeaders[index + 1]);
    }
  }
  return result;
}
```

`startLoopbackProxy(upstreamUrl, token, limits, overrides = {})` has injectable
`createProxyServer`, `listenProxy`, and `requestUpstream` defaults for deterministic listen/error
tests, and must:

- validate upstream as exact loopback `/mcp`;
- create the proxy with constructor-time `headersTimeout: limits.headersTimeoutMs`,
  `requestTimeout: limits.bodyReceiptTimeoutMs`, `keepAliveTimeout: limits.keepAliveTimeoutMs`, and
  `connectionsCheckingInterval: Math.min(1_000, limits.headersTimeoutMs,
  limits.bodyReceiptTimeoutMs)`, then set
  `server.maxRequestsPerSocket = MAX_PROXY_REQUESTS_PER_SOCKET` and
  `server.maxConnections = MAX_PROXY_CONNECTIONS`; never use `limits.maxRequestsPerSocket` for the
  proxy;
- track sockets on `connection` and destroy an admission above 16;
- reject every target except exact origin-form `/mcp` before opening upstream;
- copy request `rawHeaders` in order while removing inbound `Host`, `Authorization`, and hop-by-hop
  fields (including names nominated by `Connection`), append only upstream `Host` and sentinel
  `Authorization`, and use `agent: false`;
- inspect declared `Content-Length` before `requestUpstream`: if it is greater than
  `limits.bodyBytes`, return a fixed generic `413` with `Connection: close`, finish the response, then
  destroy the unread request without creating upstream. For every other body, count actual Buffer byte
  lengths while forwarding with pause/resume backpressure; on the first byte above `bodyBytes`, pause
  and detach body forwarding, destroy the upstream request, return the same generic `413`, and destroy
  the inbound request after response finish. This counter applies to chunked and undeclared bodies;
- stream request to upstream and upstream response to downstream, preserve status/status-message and
  filtered response `rawHeaders`, and couple abort/error/close destruction in both directions. A
  pre-header upstream failure returns fixed generic `502`; a post-header failure destroys the
  downstream response. Fixed local `404`/`413`/`502` bodies contain no error detail, URL, header, or
  credential;
- return frozen `{ url, close }`, where `close` is idempotent, calls `server.close()` and
  `server.closeAllConnections()`, destroys all tracked sockets, independently settles those actions,
  and deterministically aggregates failures. Every call returns the identical memoized close Promise.
  If listen fails or the resolved address is non-TCP before return, perform that same forced cleanup
  before rejecting.

`runConformanceChild({ executable, proxyUrl, version, scenario, stateDirectory }, dependencies = {})`
must construct no local argv variant. Its spawn line is exactly:

```js
const child = dependencies.spawnProcess(
  process.execPath,
  buildScenarioArgv(executable, proxyUrl, version, scenario, stateDirectory),
  { stdio: 'inherit', env: process.env }
);
```

Implement the fixed deadline state machine described above around `close`, not merely `exit`; timeout
must still reject after the terminated process closes. The injectable dependencies are
`spawnProcess`, `setTimer`, and `clearTimer`, with `spawn`, `setTimeout`, and `clearTimeout` defaults.
Create every timeout through `scheduleReferencedTimer({ set: dependencies.setTimer, clear:
dependencies.clearTimer }, ...)`; do not call `unref()` on those handles, and clear every active
handle on the single settlement path. On the
final no-close bound, call `child.unref()` before rejecting. Error objects contain only stable
version/scenario/category/signal/code data and never argv, environment, URL, output, or child error
messages.

Use the same referenced finite-operation primitive for report validation and runner cleanup:

```js
function operationTimeout(label) {
  const error = new Error(`Conformance cleanup timed out: ${label}`);
  error.name = 'ConformanceCleanupTimeoutError';
  return error;
}

function settleWithin(
  label,
  operation,
  milliseconds,
  clock,
  timeoutError = operationTimeout
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let handle;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (handle !== undefined) clock.clear(handle);
      callback(value);
    };
    handle = scheduleReferencedTimer(
      clock,
      () => finish(reject, timeoutError(label)),
      milliseconds
    );
    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
  });
}
```

Use a distinct acquisition primitive for startup. Its timer is referenced; after timeout the original
Promise remains observed and any owner that appears is handed to the late tracker exactly once:

```js
function startupTimeout() {
  const error = new Error('Conformance startup phase timed out');
  error.name = 'ConformanceStartupTimeoutError';
  return error;
}

function waitReferenced(clock, milliseconds) {
  return new Promise((resolve) => {
    scheduleReferencedTimer(clock, resolve, milliseconds);
  });
}

function createLateStartupTracker(clock) {
  const slots = [];
  return Object.freeze({
    reserve(label) {
      const slot = { label, state: 'pending', cleanupResult: undefined };
      slots.push(slot);
      return slot;
    },
    rejected(slot) {
      slot.state = 'rejected';
    },
    fulfilled(slot, value, cleanupLate) {
      slot.state = 'fulfilled';
      slot.cleanupResult =
        cleanupLate === undefined
          ? Promise.resolve(fulfilled())
          : settleWithin(
              'late-startup',
              () => cleanupLate(value),
              LATE_STARTUP_CLEANUP_TIMEOUT_MS,
              clock
            ).then(
              () => fulfilled(),
              (reason) => ({ status: 'rejected', reason })
            );
    },
    async drain() {
      if (slots.length === 0) return fulfilled();
      await waitReferenced(clock, LATE_STARTUP_ARRIVAL_GRACE_MS);
      const results = await Promise.all(
        slots.map((slot) => {
          if (slot.state === 'pending') {
            return { status: 'rejected', reason: operationTimeout('late-startup') };
          }
          if (slot.state === 'rejected') return fulfilled();
          return slot.cleanupResult;
        })
      );
      const reasons = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      return reasons.length === 0
        ? fulfilled()
        : { status: 'rejected', reason: new AggregateError(reasons) };
    }
  });
}

function acquireStartupPhase(label, operation, cleanupLate, lateTracker, clock) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let lateSlot;
    let handle;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      if (handle !== undefined) clock.clear(handle);
      callback(value);
    };
    handle = scheduleReferencedTimer(clock, () => {
      timedOut = true;
      lateSlot = lateTracker.reserve(label);
      finish(reject, startupTimeout());
    }, STARTUP_PHASE_TIMEOUT_MS);
    Promise.resolve()
      .then(operation)
      .then(
        (value) => {
          if (timedOut) lateTracker.fulfilled(lateSlot, value, cleanupLate);
          else finish(resolve, value);
        },
        (error) => {
          if (timedOut) lateTracker.rejected(lateSlot);
          else finish(reject, error);
        }
      );
  });
}
```

`slots` is appended only when a startup deadline fires, so normal child-failure and success cleanup
do not wait the late-arrival grace. After the grace, a still-pending acquisition produces the honest
`late-startup` not-confirmed result; its attached fulfillment/rejection handlers remain active, and a
later owner cleanup is still observed under its own referenced deadline.

The deadline does not cancel JavaScript promises and must never be described as proof that a timed-out
owner closed or report validator stopped. It only produces a stable failure and lets later cleanup
phases run. Late fulfillment or rejection stays observed by the attached handlers and cannot become an
unhandled rejection. For reports pass `() => conformanceReportError()` as `timeoutError`; cleanup uses
the default `operationTimeout`.

Normalize aggregation without retaining arbitrary error messages or non-Error string values:

```js
const NO_FAILURE = Symbol('no-failure');

function fulfilled() {
  return { status: 'fulfilled', value: undefined };
}

function failuresForSlot(slot, value) {
  if (value instanceof AggregateError) {
    return value.errors.flatMap((entry) => failuresForSlot(slot, entry));
  }
  const timedOut = value instanceof Error && value.name === 'ConformanceCleanupTimeoutError';
  const startupTimedOut =
    slot === 'primary' && value instanceof Error && value.name === 'ConformanceStartupTimeoutError';
  const productDrift =
    slot === 'primary' &&
    value instanceof Error &&
    value.name === 'ConformanceProductContractError';
  const error = new Error(
    startupTimedOut
      ? 'Conformance startup phase timed out'
      : productDrift
        ? 'Conformance product contract is unavailable'
        : timedOut
          ? `Conformance cleanup timed out: ${slot}`
          : `Conformance operation failed: ${slot}`
  );
  error.name = startupTimedOut
    ? 'ConformanceStartupTimeoutError'
    : productDrift
      ? 'ConformanceProductContractError'
      : timedOut
        ? 'ConformanceCleanupTimeoutError'
        : slot === 'primary'
          ? 'ConformanceRunError'
          : 'ConformanceCleanupError';
  return [error];
}
```

`collectFailuresInOrder(primary, ownedResults, lateResult, stateResult, environmentResult)` applies
`failuresForSlot` in exact `primary`, `proxy`, `http`, `application`, `late-startup`, `temp-state`, `environment`
order, skips `NO_FAILURE` and fulfilled results, and flattens an aggregate only within its current
slot. It preserves only the two fixed safe primary categories
`ConformanceStartupTimeoutError`/`ConformanceProductContractError`, never injected text. Tests compare
the resulting name/message arrays, not identities of injected errors. This makes aggregation order
observable without retaining a poison error message.

Finally implement the orchestration with injectable defaults:

```js
export async function runConformance(version, overrides = {}) {
  if (!Object.hasOwn(SCENARIOS_BY_VERSION, version)) {
    throw new Error('Usage: node scripts/run-conformance.mjs 2025-11-25|2026-07-28');
  }
  const dependencies = {
    makeStateDirectory: () => mkdtemp(join(tmpdir(), 'opnsense-mcp-conformance-')),
    removeStateDirectory: (path) => rm(path, { recursive: true, force: true }),
    installEnvironment: installConformanceEnvironment,
    createApplicationRuntime: () => createDefaultApplicationRuntime(),
    assertProductContract: assertConformanceProductContract,
    startProductHttp: startHttp,
    startProxy: startLoopbackProxy,
    resolveExecutable: resolveConformanceExecutable,
    runChild: runConformanceChild,
    validateReport: validateScenarioReport,
    clock: SYSTEM_TIMER,
    ...overrides
  };
  let stateDirectory;
  let environmentOwner;
  let applicationRuntime;
  let httpRuntime;
  let proxyRuntime;
  const lateTracker = createLateStartupTracker(dependencies.clock);
  let primaryFailure = NO_FAILURE;
  try {
    stateDirectory = await acquireStartupPhase(
      'makeStateDirectory',
      dependencies.makeStateDirectory,
      (latePath) => dependencies.removeStateDirectory(latePath),
      lateTracker,
      dependencies.clock
    );
    environmentOwner = await acquireStartupPhase(
      'installEnvironment',
      () => dependencies.installEnvironment(stateDirectory),
      (lateOwner) => lateOwner.restore(),
      lateTracker,
      dependencies.clock
    );
    applicationRuntime = await acquireStartupPhase(
      'createApplicationRuntime',
      dependencies.createApplicationRuntime,
      (lateOwner) => lateOwner.close(),
      lateTracker,
      dependencies.clock
    );
    await acquireStartupPhase(
      'productPreflight',
      () => dependencies.assertProductContract(applicationRuntime.application),
      undefined,
      lateTracker,
      dependencies.clock
    );
    httpRuntime = await acquireStartupPhase(
      'startProductHttp',
      () => dependencies.startProductHttp(applicationRuntime.application, { port: 0 }),
      (lateOwner) => lateOwner.close(),
      lateTracker,
      dependencies.clock
    );
    proxyRuntime = await acquireStartupPhase(
      'startProxy',
      () =>
        dependencies.startProxy(
          httpRuntime.url,
          CONFORMANCE_SENTINELS.token,
          httpRuntime.limits
        ),
      (lateOwner) => lateOwner.close(),
      lateTracker,
      dependencies.clock
    );
    const executable = await acquireStartupPhase(
      'resolveExecutable',
      dependencies.resolveExecutable,
      undefined,
      lateTracker,
      dependencies.clock
    );
    for (const scenario of SCENARIOS_BY_VERSION[version]) {
      await dependencies.runChild({
        executable,
        proxyUrl: proxyRuntime.url,
        version,
        scenario,
        stateDirectory
      });
      await settleWithin(
        'scenario-report',
        () => dependencies.validateReport(stateDirectory, version, scenario),
        REPORT_VALIDATION_TIMEOUT_MS,
        dependencies.clock,
        () => conformanceReportError()
      );
    }
  } catch (error) {
    primaryFailure = error;
  }

  let ownedResults = [fulfilled(), fulfilled(), fulfilled()];
  let lateResult = fulfilled();
  let stateResult = fulfilled();
  let environmentResult = fulfilled();
  try {
    ownedResults = await Promise.allSettled([
      settleWithin(
        'proxy',
        () => proxyRuntime?.close(),
        OWNER_CLEANUP_TIMEOUT_MS,
        dependencies.clock
      ),
      settleWithin(
        'http',
        () => httpRuntime?.close(),
        OWNER_CLEANUP_TIMEOUT_MS,
        dependencies.clock
      ),
      settleWithin(
        'application',
        () => applicationRuntime?.close(),
        OWNER_CLEANUP_TIMEOUT_MS,
        dependencies.clock
      )
    ]);
    const [lateDrainResult] = await Promise.allSettled([lateTracker.drain()]);
    lateResult =
      lateDrainResult.status === 'fulfilled' ? lateDrainResult.value : lateDrainResult;
    if (stateDirectory !== undefined) {
      [stateResult] = await Promise.allSettled([
        settleWithin(
          'temp-state',
          () => dependencies.removeStateDirectory(stateDirectory),
          STATE_CLEANUP_TIMEOUT_MS,
          dependencies.clock
        )
      ]);
    }
  } finally {
    if (environmentOwner !== undefined) {
      [environmentResult] = await Promise.allSettled([
        settleWithin(
          'environment',
          () => environmentOwner.restore(),
          ENVIRONMENT_RESTORE_TIMEOUT_MS,
          dependencies.clock
        )
      ]);
    }
  }

  const failures = collectFailuresInOrder(
    primaryFailure,
    ownedResults,
    lateResult,
    stateResult,
    environmentResult
  );
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Conformance host or cleanup failed');
  }
}
```

`collectFailuresInOrder` converts non-Errors and recursively flattens nested aggregates without
reordering within the fixed primary/proxy/HTTP/application/late-startup/temp/environment slots. `fulfilled()`
returns `{ status: 'fulfilled', value: undefined }`. A missing owner resolves. Do not sequentially
await proxy, HTTP, and application close. The late tracker drains only after those three outcomes and
before temp removal; environment restoration is the unconditional final phase.

Use an exported process-boundary seam and keep the direct-execution guard declarative:

```js
export async function runConformanceCli(version, overrides = {}) {
  const dependencies = {
    run: runConformance,
    writeDiagnostic: (value) => process.stderr.write(value),
    markFailed: () => {
      process.exitCode = 1;
    },
    setTimer: setTimeout,
    exit: (code) => process.exit(code),
    ...overrides
  };
  try {
    await dependencies.run(version);
  } catch {
    try {
      dependencies.writeDiagnostic('Conformance run failed\n');
    } catch {
      // Exit behavior must not depend on a writable diagnostic stream.
    }
    dependencies.markFailed();
    const handle = dependencies.setTimer(
      () => dependencies.exit(1),
      DIRECT_EXIT_GRACE_MS
    );
    handle.unref();
  }
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
  void runConformanceCli(process.argv[2]);
}
```

Do not print error names/messages, argv, paths, report contents, environment values, or tokens in this
terminal path. Child output remains official CLI output through inherited stdio. This direct-exit
watchdog is the only Task 8 timer whose handle is unreferenced: it has no effect when all other handles
are released naturally, while a timed-out owner retaining a live handle lets it force termination.

- [ ] **Step 5: Make every public conformance command build first**

Replace only these scripts in `package.json`:

```json
"test:conformance:2025": "npm run build && node scripts/run-conformance.mjs 2025-11-25",
"test:conformance:2026": "npm run build && node scripts/run-conformance.mjs 2026-07-28",
"test:conformance": "npm run test:conformance:2025 && npm run test:conformance:2026"
```

Do not change the exact conformance dependency or lockfile.

- [ ] **Step 6: Run focused harness, architecture, and real official evidence**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run build
npx vitest list tests/conformance/run-conformance.test.mjs
npx vitest run \
  tests/conformance/run-conformance.test.mjs \
  tests/architecture/execution-boundary.test.ts \
  tests/foundation/package-contract.test.ts
npm run test:conformance:2025
npm run test:conformance:2026
```

Expected: proxy/lifecycle tests pass; the two real-run tests pass; then the public scripts run the same
six official alpha.9 scenario invocations successfully. Each child exit `0` is followed by a strict
accepted `checks.json` containing only `SUCCESS`/`INFO` before the next child starts. There are zero
failures, zero warnings, zero skipped/unknown checks, no expected-failure file, no retained `results/`,
no temp state in the repository, and no sentinel output.
This is targeted interoperability evidence against the authenticated product surface, not full-suite
conformance and not an OAuth or remote-deployment claim.

The atomic `server-stateless` scenario still mixes generic checks with mandatory conformance-only
fixtures and dynamic list mutation; other unselected MRTR scenarios prescribe named `test_*` product
tools or response schemas. Do not add fixture tools to the product catalog. Task 6 supplies direct
deterministic coverage for the omitted modern metadata, request-state binding, tamper/replay, and
multi-round guarantees. This remains an explicit coverage limit, never an expected-failure baseline.

- [ ] **Step 7: Run full gates and commit executable protocol evidence atomically**

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run verify
npm run test:conformance
git diff --check
git status --short
```

Expected: formatting, lint, strict TypeScript, AGPL headers, build, all deterministic tests (including
the real conformance subprocess tests), and all six explicit public invocations pass. Only the six
Task 8 files named above are added/modified by this task; Task 7b's preceding files remain its own
slice. Do not run against a production firewall.

```bash
git add \
  scripts/run-conformance.mjs \
  tests/conformance/run-conformance.test.mjs \
  tests/architecture/execution-boundary.test.ts \
  tests/foundation/package-contract.test.ts \
  vitest.config.ts \
  package.json
git commit -m "test: enforce MCP v2 conformance"
```

### Task 9: Author initial foundation docs, add CI, and verify the foundation

**Files:**
- Create: `README.md`
- Create: `CONTRIBUTING.md`
- Create: `tests/foundation/documentation.test.ts`
- Create: `tests/foundation/ci-workflow.test.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- README and CONTRIBUTING are new, independently authored, temporary foundation documents, not migrated
  artifacts and not product-release documentation. They say prominently that this phase does not connect to
  or administer OPNsense, distinguish implemented foundation facts from future firewall integration, and name
  the beta-to-stable publication gate.
- `tests/foundation/documentation.test.ts` is a phase-scoped contract. The first later task that registers a
  firewall mutation must replace its no-mutation assertion in the same commit, and Guided Task 8 must modify
  or remove the remaining foundation-only assertions when it expands and finalizes the public documents.
- CONTRIBUTING gives one guarded deterministic local sequence and one explicit protocol sequence for this
  foundation phase. Every copyable Node/npm block selects supported Node 22 and rejects a runtime outside
  `>=22.19 <23`; every install uses exactly `npm ci --ignore-scripts`.
- CI runs a lightweight Node 22.19.0 compatibility-floor lane, the full verification gate on the current
  patched Node 22.23.1 runtime, then the public 2025 and draft 2026 protocol scripts on Node 22.23.1. GitHub
  actions are immutable full-SHA pins and checkout never persists credentials. The compatibility floor also
  executes the real stdio entrypoint tests; build plus typecheck alone are not runtime compatibility evidence.
- The six scenario/version tuples run once inside `npm run verify`'s real subprocess tests and once through
  `npm run test:conformance`'s public scripts: twelve official child invocations in the combined local gate,
  but exactly six public-script invocations. Expected negative header-validation probes are silent on stderr;
  every accepted report contains only `SUCCESS`/`INFO` and there is no expected-failure baseline.

- [ ] **Step 1: Write the documentation, CI, and silent-conformance contracts first**

Create `tests/foundation/documentation.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const NODE_22_PREFLIGHT = [
  'if test -x /opt/homebrew/opt/node@22/bin/node; then',
  'export PATH="/opt/homebrew/opt/node@22/bin:$PATH"',
  'fi',
  'node -e "const [major, minor] = process.versions.node.split(\'.\').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&'
] as const;

function bashBlocks(document: string): readonly string[] {
  return [...document.matchAll(/```bash\n(?<body>[\s\S]*?)\n```/gu)].map(
    (match) => match.groups?.body ?? ''
  );
}

function commandLines(document: string): readonly string[] {
  return bashBlocks(document).flatMap((block) =>
    block
      .split('\n')
      .map((line) => line.trim().replace(/\s+&&$/u, ''))
      .filter((line) => line !== '')
  );
}

function logicalCommandsAfterPreflight(block: string): readonly string[] {
  const lines = block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  const preflightIndex = lines.indexOf(NODE_22_PREFLIGHT.at(-1) ?? '');
  if (preflightIndex < 0) return [];
  const commands: string[] = [];
  let current = '';
  for (const line of lines.slice(preflightIndex)) {
    const continued = line.endsWith('\\');
    current = `${current}${current === '' ? '' : ' '}${continued ? line.slice(0, -1).trim() : line}`;
    if (!continued) {
      commands.push(current);
      current = '';
    }
  }
  if (current !== '') commands.push(current);
  return commands;
}

describe('foundation documentation', () => {
  it('states the implemented safety and protocol evidence boundaries', async () => {
    const readme = await readFile('README.md', 'utf8');
    expect(readme).toContain('Foundation development snapshot');
    expect(readme).toContain('does not connect to or administer OPNsense');
    expect(readme).toContain('not the complete OPNsense MCP product');
    expect(readme).toContain('No firewall mutation capability is registered');
    expect(readme).toContain('2025-11-25');
    expect(readme).toContain('2026-07-28');
    expect(readme).toContain('http-header-validation');
    expect(readme).toContain('2.0.0-beta.4');
    expect(readme).toContain('six public-script invocations');
    expect(readme).toContain('twelve official child invocations');
    expect(readme).toContain('stderr remains empty');
    expect(readme).toContain('only `SUCCESS` or `INFO`');
    expect(readme).toContain('repinned to one stable MCP v2 release');
    expect(readme).toContain('AGPL-3.0-or-later');
    expect(readme).toContain('exact serialized origin');
    expect(readme).toContain('Deprecated SSE compatibility is disabled by default');
  });

  it('publishes exact guarded contributor commands', async () => {
    const [readme, contributing, stdioTest] = await Promise.all([
      readFile('README.md', 'utf8'),
      readFile('CONTRIBUTING.md', 'utf8'),
      readFile('tests/mcp/stdio.test.ts', 'utf8')
    ]);
    const readmeLines = commandLines(readme);
    const contributingLines = commandLines(contributing);
    const installLines = [...readmeLines, ...contributingLines].filter((line) =>
      /^npm (?:ci|i|install)(?:\s|$)/u.test(line)
    );
    expect(installLines).toEqual([
      'npm ci --ignore-scripts',
      'npm ci --ignore-scripts'
    ]);
    for (const exactCommand of [
      'npm ci --ignore-scripts',
      'npm run verify',
      'npm run test:conformance:2025',
      'npm run test:conformance:2026',
      'git diff --check'
    ]) {
      expect(contributingLines).toContain(exactCommand);
    }
    for (const block of [...bashBlocks(readme), ...bashBlocks(contributing)]) {
      if (!/(?:^|\n)(?:node|npm|npx)\b/mu.test(block)) continue;
      const lines = block.split('\n').map((line) => line.trim());
      for (const preflightLine of NODE_22_PREFLIGHT) {
        expect(lines).toContain(preflightLine);
      }
      const commands = logicalCommandsAfterPreflight(block);
      expect(commands.length).toBeGreaterThan(1);
      for (const command of commands.slice(0, -1)) {
        expect(command).toMatch(/ &&$/u);
      }
    }
    expect(readmeLines).toContain('node dist/main.js');
    expect(readmeLines).not.toContain('npm start');
    expect(stdioTest).toContain("spawn(process.execPath, ['dist/main.js']");
    expect(readme).toContain('the same random 32-or-more-character value');
    expect(readme).toContain('local secret manager');
    expect(readme).toContain(': "${MCP_HTTP_TOKEN:?Set MCP_HTTP_TOKEN in the server shell}" &&');
    expect(readme).toContain(
      `MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" node -e 'process.exit(process.env.MCP_HTTP_TOKEN?.length >= 32 ? 0 : 1)' &&`
    );
    expect(readme).toContain('MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" \\');
    expect(readme).not.toContain('MCP_HTTP_TOKEN="$(');
    expect(readme).not.toContain('0123456789abcdef0123456789abcdef');
  });
});
```

Create `tests/foundation/ci-workflow.test.ts`:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

function actionUses(workflow: string): readonly string[] {
  return workflow
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(?:- )?uses:/u.test(line));
}

describe('foundation CI workflow', () => {
  it('detects both step actions and reusable workflow jobs', () => {
    expect(
      actionUses(`jobs:
  steps-job:
    steps:
      - uses: owner/step@0000000000000000000000000000000000000000
  reusable-job:
    uses: owner/repository/.github/workflows/example.yml@main`)
    ).toEqual([
      '- uses: owner/step@0000000000000000000000000000000000000000',
      'uses: owner/repository/.github/workflows/example.yml@main'
    ]);
  });

  it('pins supported runtimes, immutable actions, guarded installs, and residue checks', async () => {
    const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
    const lines = workflow.split('\n').map((line) => line.trim());
    const count = (line: string): number => lines.filter((candidate) => candidate === line).length;

    expect(count('- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0')).toBe(3);
    expect(count('- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0')).toBe(3);
    expect(actionUses(workflow)).toEqual([
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
      '- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0',
      '- uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0'
    ]);
    expect(count('persist-credentials: false')).toBe(3);
    expect(count('node-version: 22.19.0 # compatibility floor')).toBe(1);
    expect(count('node-version: 22.23.1 # current patched Node 22')).toBe(2);
    expect(count('- run: npm ci --ignore-scripts')).toBe(3);
    expect(count('- run: npm ci')).toBe(0);
    const installInvocations = [
      ...workflow.matchAll(
        /(?:^|[^A-Za-z0-9_-])(?<command>npm[ \t]+(?:ci|i|install)\b[^\r\n]*)/gmu
      )
    ].map((match) => match.groups?.command?.trim());
    expect(installInvocations).toEqual([
      'npm ci --ignore-scripts',
      'npm ci --ignore-scripts',
      'npm ci --ignore-scripts'
    ]);
    expect(count('- run: npm run build')).toBe(1);
    expect(count('- run: npm run typecheck')).toBe(1);
    expect(count('- run: npm test -- tests/mcp/stdio.test.ts')).toBe(1);
    expect(count('- run: npm run verify')).toBe(1);
    expect(count('- run: npm run test:conformance')).toBe(1);
    expect(count('needs: [compatibility-floor, verify]')).toBe(1);
    expect(lines).toContain('timeout-minutes: 10');
    expect(lines).toContain('timeout-minutes: 20');
    expect(lines).toContain('timeout-minutes: 15');
    expect(count('test ! -e results')).toBe(3);
    expect(count('test -z "$(git status --porcelain=v1 --untracked-files=all)"')).toBe(3);
    expect(workflow).toContain('permissions:\n  contents: read');
    expect(workflow.match(/^[ \t]*permissions:/gmu)).toHaveLength(1);
    expect(workflow).not.toMatch(/^[ \t]*permissions:[ \t]*write-all[ \t]*$/gmu);
    expect(workflow).not.toMatch(/^[ \t]+[A-Za-z][A-Za-z-]*:[ \t]*write[ \t]*$/gmu);
    expect(workflow).not.toContain('pull_request_target');
  });
});
```

Task 8 already owns the executable empty-stderr assertion for both `2025-11-25` and `2026-07-28` without
changing the six selected scenarios. Keep that contract green here. The five negative
`http-header-validation` requests remain required protocol evidence, but their expected validation
responses are handled without diagnostic logging; acceptance still comes from exit `0` plus strictly
validated `checks.json` records containing only `SUCCESS`/`INFO`.

This foundation documentation contract is intentionally temporary. Do not carry the literal no-mutation
claim into a product phase that has registered mutations.

- [ ] **Step 2: Run the contracts and verify the red state**

Run:

```bash
set -e
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
npx --no-install vitest run \
  tests/foundation/documentation.test.ts \
  tests/foundation/ci-workflow.test.ts \
  tests/conformance/run-conformance.test.mjs
```

Expected: FAIL because README, CONTRIBUTING, and the CI workflow do not exist. Test discovery and the
supported-Node assertion both succeed; the conformance assertion also exposes any 2025 or 2026 stderr
diagnostic. No package is downloaded by `npx`.

- [ ] **Step 3: Write an evidence-bounded README**

Create `README.md`:

````markdown
# OPNsense MCP

> **Foundation development snapshot:** This is not the complete OPNsense MCP product, is not
> release-ready, and does not connect to or administer OPNsense.

A safety-first Model Context Protocol and policy foundation for future guided OPNsense administration.

## Current scope

This temporary foundation provides one local read-only `server_status` tool, pedagogical prompts, a closed capability catalog, centralized policy checks, dual-era stdio, primary opt-in Streamable HTTP, and isolated deprecated-SSE compatibility. It has no OPNsense API or SSH adapter, so it performs no firewall reads and no firewall writes. No firewall mutation capability is registered. Firewall access is added only after its independent adapters, backup rules, audit rules, VM tests, and recovery checks exist.

The default is `READ_ONLY=true`. A caller cannot enable a capability by inventing its name or by passing a confirmation boolean: exposure comes from the catalog, and confirmation state is signed and checked by the server.

## Run locally

Requirements: Node.js 22.19.0 or newer within major 22, and npm.

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm ci --ignore-scripts &&
npm run build &&
node dist/main.js
```

`node dist/main.js` is a protocol-clean stdio MCP process. Configure an MCP client to run that exact
command with this repository as its working directory. The server instructions ask the agent to explain
concepts in plain language, clarify ambiguity, investigate read-only first, and obtain exact confirmation
before any future mutation.

HTTP is an explicit local-development option:

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
: "${MCP_HTTP_TOKEN:?Set MCP_HTTP_TOKEN in the server shell}" &&
MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" node -e 'process.exit(process.env.MCP_HTTP_TOKEN?.length >= 32 ? 0 : 1)' &&
MCP_HTTP_ENABLED=true \
MCP_HTTP_TOKEN="$MCP_HTTP_TOKEN" \
node dist/entrypoints/http.js
```

Set `MCP_HTTP_TOKEN` to the same random 32-or-more-character value in the server shell and the client
configuration, preferably through a local secret manager. The command refuses a missing or short value and
does not print it. HTTP binds to loopback, validates Host, applies finite body/request/stream/session limits,
and requires that bearer. Non-browser clients may omit Origin. Browser Origin access is denied by default;
`MCP_ALLOWED_ORIGINS` accepts only comma-separated exact serialized origin values including scheme, host,
and port, for example `https://console.example:8443`. A same-host value with another scheme or port is not
equivalent. This is not a remote deployment endpoint.

Deprecated SSE compatibility is disabled by default. `MCP_LEGACY_SSE_ENABLED=true` adds authenticated `GET /sse` and `POST /messages` on the same hardened loopback listener without replacing Streamable HTTP at `/mcp`. It exists only for migration and must be re-reviewed or removed before release.

## Discoverable prompts

- `diagnose_network_problem`: turn a simple symptom into a read-only investigation.
- `publish_internal_service`: clarify and prepare an internal DNS, certificate, and HAProxy plan without applying it.
- `block_domain_for_device`: clarify and prepare a device-scoped DNS block without broadening it to the whole network.

Prompts guide an MCP client; they are not authorization and they do not bypass policy.

## Tested evidence

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run verify &&
npm run test:conformance
```

`npm run verify` runs formatting, lint, strict TypeScript, the JavaScript/TypeScript AGPL header gate,
build, and deterministic Vitest tests. Its real subprocess test makes six official child invocations,
captured inside Vitest. The public `npm run test:conformance` command runs the same six scenario/version
tuples again: `server-initialize`, `ping`, and `tools-list` at `2025-11-25`, then `tools-list`,
`input-required-result-unsupported-methods`, and `http-header-validation` at draft `2026-07-28`.
Consequently the combined gate makes six public-script invocations and twelve official child invocations.
For both protocol versions stderr remains empty, including the five expected negative header probes, and
accepted `checks.json` records contain only `SUCCESS` or `INFO`. There is no expected-failure baseline.
This is targeted interoperability evidence, not full-suite conformance.

The three MCP v2 packages `@modelcontextprotocol/server`, `@modelcontextprotocol/client`, and
`@modelcontextprotocol/node` are deliberately pinned to `2.0.0-beta.4` for this foundation. Before public
package publication, all three must be repinned to one stable MCP v2 release together and every
deterministic and conformance gate must pass again. The optional `@modelcontextprotocol/express` helper
package is intentionally not installed: direct Express integration preserves the project-owned guard
order of exact Host -> exact serialized Origin -> shutdown admission gate -> bounded body receipt ->
authentication.

Separately, the isolated deprecated-SSE adapter pins the legacy `@modelcontextprotocol/sdk@1.29.0`
exactly. Before release run `npm run release:check:legacy-sse` and `npm audit --omit=dev`, then decide
explicitly whether compatibility can be removed.

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
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
node --version &&
npm ci --ignore-scripts &&
npm run verify &&
git diff --check
```

The Node version must satisfy `>=22.19 <23` and every command must exit `0`.

## Protocol verification

```bash
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)" &&
npm run test:conformance:2025 &&
npm run test:conformance:2026
```

The first command runs targeted `server-initialize`, `ping`, and `tools-list` scenarios at `2025-11-25`.
The second runs targeted `tools-list`, `input-required-result-unsupported-methods`, and
`http-header-validation` at draft `2026-07-28`. These are six public-script invocations. If they follow
`npm run verify`, the combined gate has twelve official child invocations because Vitest already ran the
same six tuples. Both versions keep stderr empty, including expected negative header probes, and accepted
reports contain only `SUCCESS` or `INFO`. Do not introduce an expected-failure baseline or describe these
six public invocations as a full suite.

## Change discipline

1. Add a focused failing test for the behavior.
2. Make the smallest implementation change that passes it.
3. Run the focused test, then `npm run verify`.
4. Run protocol conformance for any server, schema, prompt, or transport change.
5. Commit one coherent change with no generated output, secret, or local result directory.

Every JavaScript and TypeScript source begins with `// SPDX-License-Identifier: AGPL-3.0-or-later`.

`npm run license:check` enforces those source headers. The later provenance workflow owns the broader release-tree and history scan; do not treat the source-header check as provenance evidence.
````

- [ ] **Step 5: Run the documentation and silent-conformance contracts**

Run:

```bash
set -e
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
npx --no-install vitest run \
  tests/foundation/documentation.test.ts \
  tests/conformance/run-conformance.test.mjs
```

Expected: the documentation contract passes, both real subprocess cases pass (three official child
invocations per version), stderr is exactly empty for both versions, and accepted reports contain only
`SUCCESS`/`INFO`.

- [ ] **Step 6: Add immutable, current-patch-primary CI with a Node 22.19 compatibility floor**

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
  compatibility-floor:
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22.19.0 # compatibility floor
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run build
      - run: npm run typecheck
      - run: npm test -- tests/mcp/stdio.test.ts
      - name: Assert no generated or repository residue
        run: |
          git diff --check
          test ! -e results
          test -z "$(git status --porcelain=v1 --untracked-files=all)"

  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22.23.1 # current patched Node 22
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run verify
      - name: Assert no generated or repository residue
        run: |
          git diff --check
          test ! -e results
          test -z "$(git status --porcelain=v1 --untracked-files=all)"

  protocol:
    needs: [compatibility-floor, verify]
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22.23.1 # current patched Node 22
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npm run test:conformance
      - name: Assert no generated or repository residue
        run: |
          git diff --check
          test ! -e results
          test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Run the exact CI contract:

```bash
set -e
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
npx --no-install vitest run tests/foundation/ci-workflow.test.ts
```

Expected: PASS. The workflow test verifies the exact action pins and version comments, disabled checkout
credential persistence, every step-action and reusable-workflow `uses:` entry, the single read-only
permission block, three guarded installs, the compatibility/current runtime split, the real stdio smoke,
timeouts, and clean/residue assertions. The primary `verify` and `protocol` jobs use the current patched
Node 22; the 22.19.0 lane is an additional compatibility floor.

- [ ] **Step 7: Run the complete local release gate**

Run exactly:

```bash
set -e
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
npm ci --ignore-scripts
npm run verify
npm run test:conformance
git diff --check
test ! -e results
task9_expected_status="$(printf '%s\n' \
  '?? .github/workflows/ci.yml' \
  '?? CONTRIBUTING.md' \
  '?? README.md' \
  '?? tests/foundation/ci-workflow.test.ts' \
  '?? tests/foundation/documentation.test.ts')"
test "$(git status --short --untracked-files=all)" = "$task9_expected_status"
```

Expected:
- dependency installation exits `0` under supported Node 22 without running lifecycle scripts;
- formatting, lint, typecheck, build, and all Vitest tests pass;
- `npm run verify` makes six captured official child invocations and the public conformance script makes
  the same six again, for twelve official child invocations in the combined gate but six public-script
  invocations;
- both versions keep stderr exactly empty and all accepted report records contain only `SUCCESS`/`INFO`;
- whitespace and residue validation exit `0`; and
- the exact five-path pre-commit status matches, with no additional tracked or untracked file.

- [ ] **Step 8: Commit docs and CI atomically**

```bash
git add README.md CONTRIBUTING.md tests/foundation/documentation.test.ts \
  tests/foundation/ci-workflow.test.ts .github/workflows/ci.yml
git commit -m "docs: define MCP foundation evidence"
```

- [ ] **Step 9: Verify a clean, reproducible final state**

Run:

```bash
set -e
if test -x /opt/homebrew/opt/node@22/bin/node; then
  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
fi
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major === 22 && minor >= 19 ? 0 : 1)"
npm ci --ignore-scripts
npm run verify
npm run test:conformance
git diff --check
test ! -e results
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

Expected: every command exits `0`, the combined gate makes twelve official child invocations (six through
the public script), stderr remains empty for both protocol versions, accepted reports contain only
`SUCCESS`/`INFO`, no `results` directory exists, and the final clean-worktree assertion fails on any tracked
or untracked residue.

The foundation is ready only for a separately reviewed next implementation phase after this final state is
reproduced; it is neither the complete product nor release-ready. The first task that registers a mutation
must update the phase-scoped documentation contract in the same commit. Guided Task 8 later modifies or
removes the remaining foundation-only assertions as it finalizes the independently authored public docs.
Public package publication remains blocked until `@modelcontextprotocol/server`,
`@modelcontextprotocol/client`, and `@modelcontextprotocol/node` move together from `2.0.0-beta.4` to one
stable MCP v2 release, the separate legacy
`@modelcontextprotocol/sdk@1.29.0` pin is removed or explicitly re-approved after its drift/audit gate, and
the final state is reproduced again.
