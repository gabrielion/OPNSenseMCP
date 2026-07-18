# MCP v2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a safe, strictly typed MCP v2 foundation with a closed capability catalog, a fail-closed policy kernel, pedagogical MCP guidance, dual-era stdio and hardened Streamable HTTP, and executable conformance evidence for MCP `2025-11-25` and draft `2026-07-28`.

**Architecture:** A transport-neutral `buildServer(application, transport): McpServer` factory registers every primary v2 tool from one typed capability catalog and routes every call through one closed policy kernel. The handler vault and one-shot confirmation ledger are lexical kernel authorities and are not package exports. Stdio uses the dual-era `serveStdio` factory entry, HTTP uses `createMcpHandler` behind the official Node and Express adapters, and signed request state carries only a kernel-issued confirmation challenge across protocol rounds without trusting caller booleans. One default-off compatibility module owns all deprecated v1 SSE server and transport types; it re-registers only catalog metadata and calls the same transport-neutral dispatch facade, never passing a v1 transport to a v2 server. The foundation exposes only a read-only server status capability; mutation fixtures exist only under `tests/` until backup and audit enforcement are present.

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
- `buildServer(application, transport): McpServer` is the only primary beta.4 MCP assembly point. The sole exception is Task 7b's isolated deprecated-SSE v1 adapter, which may import only shared catalog metadata and `dispatchCapability`; capability handlers import no MCP transport type and v1 objects never cross into the v2 server.
- Stdio is the default executable path and uses `serveStdio`; Streamable HTTP uses `createMcpHandler` plus `toNodeHandler` and `createMcpExpressApp`.
- The capability catalog is closed: undeclared, hidden, disabled, transport-incompatible, and read-only-forbidden calls fail before a handler runs.
- The foundation registers no local-write or firewall-write product capability. Mutation execution remains unavailable until strict backup and audit gates are implemented in a separately reviewed plan.
- MCP instructions and prompts guide behavior but never authorize a change. Form elicitation is used only when the client advertises it, and missing support fails closed.
- Request state is HMAC-protected with the SDK `createRequestStateCodec`, expires after 300 seconds, and is bound to the MCP method plus authenticated client identity when present.
- HTTP is disabled by default, binds only to `127.0.0.1` or `localhost`, validates Host, applies an exact serialized-Origin allow-list before authentication and MCP routing, requires a 32-character bearer token, and never logs that token. Browser Origin access defaults to an empty allow-list; a configured entry includes scheme, host, and port.
- Streamable HTTP remains the primary HTTP transport. Deprecated SSE compatibility is isolated behind `MCP_LEGACY_SSE_ENABLED=true`, is off by default, and shares the same bearer, Host, exact-Origin, policy, body, request, stream, session, concurrency, and time limits.
- Source-header enforcement is available from Task 1 as `npm run license:check`. It is intentionally scoped to JavaScript and TypeScript source headers; the later provenance plan owns the release-tree/history-wide license, lineage, and forbidden-expression scan.
- Use only real Vitest 4 matchers: catch an error and apply `toMatchObject` when structured error fields are needed. For a Zod IP union use `z.union([z.ipv4(), z.ipv6()])`. Build TypeScript and execute the emitted JavaScript with Node; do not add an on-the-fly TypeScript runner.
- Conformance runs have no expected-failure baseline and must pass the five official targeted invocations named in Task 8 against the real product server; never describe that gate as full-suite conformance.
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
  { application, close }. Foundation owns no external service, so close is an idempotent no-op; Product Task 5
  replaces the body with the real product composition and owned cleanup, and Guided Task 5 later adds
  workflows.
- startStdio(application?) serves both eras. When no application is injected it owns the default runtime and
  its returned close() settles both server and runtime exactly once. An injected application remains owned by
  the caller.
- buildApplicationHttpSecurity(application) is source-internal and returns public HTTP settings plus a bearer
  middleware closure; it never returns the token or internal config.
- startHttp(application, options?) returns { url, limits, close }. The caller owns application; runtime close
  independently settles handler and Node server.
- HTTP is loopback-only, exact Host/Origin, authenticated, bounded, and disabled by default.

Exact limits: 256 KiB JSON body, 32 concurrent requests, 16 subscriptions, 10-second body receipt,
30-second ordinary execution, 5-minute stream lifetime, 2-minute legacy-session idle timeout, 8 legacy
sessions, 5-second headers/keep-alive timeouts, and 100 requests per socket. Primary Streamable HTTP keeps
2025 compatibility stateless with legacy: 'stateless'.

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
- oversized/slow bodies, request concurrency, execution deadline, stream/subscription/session bounds;
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

Create src/http/auth.ts. Compare SHA-256 digests with timingSafeEqual and set validated AuthInfo using a local
typed Express Request & { auth?: AuthInfo } cast because Express 5 Request has no auth declaration while
toNodeHandler reads req.auth. Do not use any or a global mutable augmentation. Set exactly:

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
an equivalently strict exact allow-list and runs first.

- [ ] **Step 3: Implement the replaceable owned default runtime and stdio**

Create src/app/default-application.ts:

~~~ts
export interface OwnedApplicationRuntime {
  readonly application: ApplicationContext;
  close(): Promise<void>;
}

export function createDefaultApplicationRuntime(): OwnedApplicationRuntime {
  const application = createApplicationContext(loadRuntimeConfig());
  let closed = false;
  return Object.freeze({
    application,
    close: async () => {
      if (closed) return;
      closed = true;
    }
  });
}
~~~

No other production file calls createApplicationContext(loadRuntimeConfig()). Product Task 5 must replace
this function body rather than adding another default composition root.

Create startStdio(application?). Wrap serveStdio(createServerFactory(...), { legacy: 'serve', ... }). When no
application is supplied, create one owned runtime. Its returned handle close() uses an idempotent aggregate
settler so server close and owned runtime close are both attempted and all failures retained. Diagnostic
errors write only error.name to stderr.

main.ts starts stdio, installs once-only SIGINT/SIGTERM handlers that await handle.close(), sets a non-zero
exit code on failure, and never writes to stdout. Do not put credentials in process arguments.

- [ ] **Step 4: Implement bounded Streamable HTTP and independent cleanup**

Create DEFAULT_HTTP_LIMITS and the documented body/concurrency/subscription/request/stream/session/socket
bounds. Reject invalid option overrides at construction.

startHttp(application, options?) obtains buildApplicationHttpSecurity(application), refuses disabled or
unsafe configuration, then creates the beta.4 handler and Node/Express adapter. Middleware order is exact:
Host, Origin, body/time/size/concurrency bounds, bearer auth, then /mcp. Keep 2025 traffic stateless.

Construction/listen is wrapped in try/finally: if any stage fails, independently close every resource already
created. Returned close() is idempotent and independently settles handler.close() and server.close(); one
failure never skips another and an AggregateError retains all failures.

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
- `buildLegacySseServer(application)` is private to `src/http/legacy-sse.ts`; it derives listed tools through
  the narrow `listApplicationCapabilities(application, 'http')` helper and calls the shared
  `dispatchCapability` facade with `{ application, transport: 'http', ... }`. It contains no firewall or
  business handler. The architecture allow-list permits this one additional listing-helper import; it still
  receives no dispatcher or settlement authority.
- Legacy SSE has no safe elicitation continuation channel. Before registration it omits every sealed
  definition whose `policy.confirmation !== 'none'`; it never dispatches a call merely to translate an
  unusable confirmation challenge. This prevents deprecated clients from filling the process-wide
  confirmation ledger.
- `mountLegacySseCompatibility(...)` adds authenticated `GET /sse` and `POST /messages` only when `MCP_LEGACY_SSE_ENABLED=true`. The routes sit behind the same global Host, exact-Origin, body, concurrency, and deadline middleware as `/mcp`, enforce bearer authentication on both requests, cap sessions at 8, expire idle sessions after 2 minutes, and use the normal HTTP policy context.
- `startHttp` still exposes Streamable HTTP at `/mcp`; the deprecated package is dynamically imported only when compatibility is enabled.
- `npm run release:check:legacy-sse` is a networked pre-release drift gate. It fails if the registry's sole `latest` tag differs from the exact approved pin; release review must also decide whether the adapter can be removed and run `npm audit --omit=dev`.

- [ ] **Step 1: Write the default-off, security, capacity, and compatibility tests first**

In addition to transport tests, inject one confirmed-write definition. Prove it is absent from legacy
`tools/list`, a forged legacy call is method-not-found, repeated attempts allocate no pending confirmation,
and a subsequent modern/stdio confirmation still succeeds when tested at ledger capacity. Ordinary
registered legacy calls must still traverse dispatchCapability().

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
        await fetch(new URL('/messages?sessionId=missing-session-1', runtime.url), {
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
import {
  listApplicationCapabilities,
  type ApplicationContext
} from '../app/application-context.js';
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
    content: [{ type: 'text', text: 'The requested operation is unavailable on deprecated SSE.' }],
    structuredContent: { code: 'CONFIRMATION_INVALID' }
  };
}

function buildLegacySseServer(application: ApplicationContext): LegacyMcpServer {
  const server = new LegacyMcpServer(
    { name: 'opnsense-mcp-legacy-sse', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  for (const capability of listApplicationCapabilities(application, 'http')) {
    if (capability.policy.confirmation !== 'none') continue;
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
            application,
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
      const results = await Promise.allSettled(
        [...sessions.keys()].map((sessionId) => closeSession(sessionId))
      );
      const failures = results
        .filter((result) => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length > 0) {
        throw new AggregateError(failures, 'Legacy SSE cleanup failed.');
      }
    }
  };
}
```

The deprecated SDK imports are confined to this file. In particular, do not cast `SSEServerTransport` to a beta.4 `Transport` and do not call the beta.4 `buildServer` with it. Catalog exposure and `dispatchCapability` are the shared seams, so read-only, feature, allow-list, timeout, output-validation, and confirmation refusal policy remain authoritative.

- [ ] **Step 4: Dynamically mount compatibility without replacing `/mcp`**

In `src/http/runtime.ts`, replace the authentication and route-mounting block with:

```ts
const authentication = http.authenticate;
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

Add `legacySse.close()` as another independently settled operation in Task 7's existing idempotent aggregate
close path beside `handler.close()` and the listener-close promise. Never replace that path with sequential
awaits: every owned resource is attempted exactly once and all failures are retained in one AggregateError.
`runtime.url` remains `/mcp`, proving Streamable HTTP has not been replaced.

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
- `node scripts/run-conformance.mjs 2026-07-28` runs official `tools-list` and `input-required-result-unsupported-methods` at the draft revision against the real product server.
- The harness reaches the final executable composition seam, binds the real factory to an ephemeral loopback port, passes no expected-failure file, propagates every non-zero exit, and always independently closes the handler, listener, owned application runtime, and private temporary state directory.
- The runner forcibly replaces ambient firewall credentials with inert sentinels and forces read-only mode. Listing and lifecycle scenarios must never contact an OPNsense target.

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
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createDefaultApplicationRuntime } from '../dist/app/default-application.js';
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

const stateDirectory = await mkdtemp(join(tmpdir(), 'opnsense-mcp-conformance-'));
for (const key of Object.keys(process.env)) {
  if (
    /^(OPNSENSE_|MCP_|ENABLE_|IAC_)/.test(key) ||
    key === 'READ_ONLY' ||
    key === 'ALLOWED_RESOURCES' ||
    key === 'ENABLED_FEATURE_FLAGS'
  ) {
    delete process.env[key];
  }
}
Object.assign(process.env, {
  READ_ONLY: 'true',
  ALLOWED_RESOURCES: '',
  ENABLED_FEATURE_FLAGS: '',
  MCP_REQUEST_STATE_SECRET: '0'.repeat(32),
  MCP_HTTP_ENABLED: 'false',
  MCP_LEGACY_SSE_ENABLED: 'false',
  MCP_ALLOWED_HOSTS: '127.0.0.1,localhost',
  MCP_ALLOWED_ORIGINS: '',
  OPNSENSE_URL: 'https://127.0.0.1:9/api',
  OPNSENSE_API_KEY: 'conformance-sentinel-key',
  OPNSENSE_API_SECRET: 'conformance-sentinel-secret',
  OPNSENSE_VERIFY_TLS: 'true',
  OPNSENSE_BACKUP_PATH: join(stateDirectory, 'backups'),
  OPNSENSE_AUDIT_LOG: join(stateDirectory, 'audit.jsonl')
});

let applicationRuntime;
let handler;
let server;

function listen(app) {
  return new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => {
      resolve();
    });
    server = listening;
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
    : ['tools-list', 'input-required-result-unsupported-methods'];

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

let primaryError;
try {
  applicationRuntime = createDefaultApplicationRuntime();
  handler = createMcpHandler(
    createServerFactory(applicationRuntime.application, 'http'),
    {
      legacy: 'stateless',
      maxSubscriptions: DEFAULT_HTTP_LIMITS.maxSubscriptions,
      onerror: (error) => process.stderr.write(`Conformance host error: ${error.name}\n`)
    }
  );
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

  await listen(app);
  const address = server?.address();
  if (address === undefined || address === null || typeof address === 'string') {
    throw new Error('Conformance listener did not expose a TCP address.');
  }
  const url = `http://127.0.0.1:${address.port}/mcp`;
  for (const scenario of scenarios) await runScenario(url, scenario);
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  for (const closePhase of [
    () => closeServer(),
    () => handler?.close() ?? Promise.resolve(),
    () => applicationRuntime?.close() ?? Promise.resolve(),
    () => rm(stateDirectory, { recursive: true, force: true })
  ]) {
    const [result] = await Promise.allSettled([Promise.resolve().then(closePhase)]);
    if (result.status === 'rejected') cleanupErrors.push(result.reason);
  }
  if (primaryError !== undefined || cleanupErrors.length > 0) {
    throw new AggregateError(
      primaryError === undefined ? cleanupErrors : [primaryError, ...cleanupErrors],
      'Conformance host or cleanup failed.'
    );
  }
}
```

This loopback listener is deliberately test-only. It still applies the product exact-Origin and finite HTTP limits, but omits bearer authentication solely because the official conformance process has no token option. Product HTTP continues to go through `startHttp` and therefore cannot bypass authentication, Host validation, exact-Origin validation, or limits.

The atomic `server-stateless` scenario mixes useful generic checks with mandatory conformance-only tools,
dynamic list mutation, and fixture behavior; the remaining unselected `input-required-result-*` scenarios
similarly prescribe named `test_*` tools or response schemas that are not product APIs. The harness cannot
select only the generic assertions inside one scenario. Do not add those tools to the product catalog merely
to make a generic server look conformant. Task 6 directly covers the omitted generic stateless/MRTR
guarantees through beta.4: modern metadata validation, discovery/capabilities, version binding, signed request
state, method/principal binding, tamper and replay rejection, and multi-round confirmation. This is an
explicit coverage limit, not an expected-failure baseline.

- [ ] **Step 3: Ensure every conformance script builds first**

Replace the three conformance scripts in `package.json` with:

```json
"test:conformance:2025": "npm run build && node scripts/run-conformance.mjs 2025-11-25",
"test:conformance:2026": "npm run build && node scripts/run-conformance.mjs 2026-07-28",
"test:conformance": "npm run test:conformance:2025 && npm run test:conformance:2026"
```

- [ ] **Step 4: Run all five targeted official invocations without a baseline**

Run:

```bash
npm run test:conformance:2025
npm run test:conformance:2026
```

Expected: all five scenario invocations report zero failures and warnings; both commands exit `0`; no invocation uses `--suite`, `--force`, or `--expected-failures`. This is targeted interoperability evidence against the product surface, not full-suite conformance.

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

`npm run verify` runs formatting, lint, strict TypeScript, the JavaScript/TypeScript AGPL header gate, build, and deterministic Vitest tests. `npm run test:conformance` runs five targeted official invocations: `server-initialize`, `ping`, and `tools-list` at `2025-11-25`, then `tools-list` and `input-required-result-unsupported-methods` at draft `2026-07-28`. There is no expected-failure baseline. This is targeted interoperability evidence, not full-suite conformance.

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

The first command runs targeted `server-initialize`, `ping`, and `tools-list` scenarios at `2025-11-25`. The second runs targeted `tools-list` and `input-required-result-unsupported-methods` at draft `2026-07-28`. Do not introduce an expected-failure baseline or describe these five invocations as a full suite.

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
- the five targeted official invocations report zero failures and warnings;
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

Expected: every command exits `0`, all five targeted protocol invocations remain clean, and `git status --short` prints nothing.

The implementation is ready for a separate firewall-adapter plan only after this final state is reproduced. Public package publication remains blocked until the four MCP v2 beta pins are changed together to one stable release, the isolated legacy `@modelcontextprotocol/sdk@1.29.0` pin is removed or explicitly re-approved after its drift/audit gate, Guided Task 8 finalizes the independently authored public docs, and the same final state is reproduced again.
