# POSIX Installed-Package Harness Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the unprovable Windows descendant-cleanup claim from the internal installed-package command
harness while retaining Windows npm/cmd path projections and reserving real native Windows evidence for the
product-specific release smoke.

**Architecture:** `runBoundedCommand()` remains a strong macOS/Linux process-group harness and refuses any
other platform before forking its supervisor. The supervisor becomes POSIX-only and contains no Windows tree
termination path. `packageHarnessPlatform()` remains a data-only projection helper so Windows `.cmd`, junction,
and absolute `cmd.exe` shapes can still be unit-tested without being reported as native execution evidence.

**Tech Stack:** Node.js `>=22.19 <23`, strict TypeScript ESM, Vitest, Node child-process groups, macOS/Linux
`/bin/ps`.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md` exactly.
- Native Windows remains a product target; no production runtime path may reject Windows because this internal
  test harness is POSIX-only.
- The internal bounded-command harness supports only macOS and Linux and must reject Windows before a child or
  supervisor is spawned.
- The Windows diagnostic must name the installed-package harness and direct maintainers to the native Windows
  product smoke; it must not say that OPNsenseMCP is unsupported on Windows.
- Retain `packageHarnessPlatform()` Windows `.cmd`, junction, and absolute `cmd.exe` projections as unit-only
  design checks.
- Do not add a Job Object, native helper, WSL requirement, Windows VM path, dependency, postinstall script, or
  shell-string execution.
- Use Node.js 22.23.1 for local evidence via `PATH=/opt/homebrew/opt/node@22/bin:$PATH`.
- Every task uses TDD, preserves fixed sanitized errors, ends in an atomic local commit, and is independently
  reviewed before the next task. Do not push.

---

## File structure

- `tests/support/installed-package-harness.ts`: platform assertion, POSIX group termination, package path
  projections, and bounded-command orchestration.
- `tests/support/bounded-command-supervisor.mjs`: POSIX-only target supervisor and owner-disconnect group kill.
- `tests/integration/installed-package-harness.test.ts`: platform-boundary, projection, real process-group, and
  failure-normalization proofs.
- `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md`: approved status of the implemented
  boundary.
- `.superpowers/sdd/progress.md`: durable Foundation acceptance and next-plan handoff.

### Task 1: Make the generic bounded-command harness POSIX-only

**Files:**
- Modify: `tests/integration/installed-package-harness.test.ts`
- Modify: `tests/support/installed-package-harness.ts`
- Modify: `tests/support/bounded-command-supervisor.mjs`

**Interfaces:**
- Consumes: `CommandInvocation`, `BoundedCommandOptions`, the existing structured-IPC supervisor protocol, and
  cooperative inherited POSIX process groups.
- Produces: exported constant `POSIX_COMMAND_HARNESS_ERROR`; POSIX-only
  `ownedTreeTerminationPlan(platform, pid, currentPid?)`; POSIX-only
  `terminateOwnedProcessTree(platform, pid, signal)`; unchanged `runBoundedCommand(invocation, options,
  dependencies?)` result semantics on macOS/Linux; unchanged `packageHarnessPlatform(input)` Windows path
  projections.

- [ ] **Step 1: Replace the three obsolete Windows-tree tests with the desired boundary tests**

Import the new fixed diagnostic:

```ts
import {
  COMMAND_SUPERVISOR_STARTUP_TIMEOUT_MS,
  POSIX_COMMAND_HARNESS_ERROR,
  localArchiveInstallArguments,
  ownedTreeTerminationPlan,
  packageHarnessPlatform,
  runBoundedCommand,
  terminateOwnedProcessTree
} from '../support/installed-package-harness.js';
```

Replace the test beginning `derives only validated owned POSIX groups` with:

```ts
it('derives only validated owned POSIX groups and refuses Windows containment', () => {
  expect(ownedTreeTerminationPlan('darwin', 4321, 1234)).toEqual({
    kind: 'posix-group',
    group: -4321
  });
  expect(() => ownedTreeTerminationPlan('win32', 4321, 1234)).toThrow(
    POSIX_COMMAND_HARNESS_ERROR
  );
  for (const unsafe of [undefined, Number.NaN, -1, 0, 1, 1234]) {
    expect(() => ownedTreeTerminationPlan('linux', unsafe, 1234)).toThrow(
      'Invalid owned process identifier'
    );
  }
  for (const unsafeRoot of [undefined, '', 'Windows', 'C:\\Windows\\..\\Temp']) {
    expect(() =>
      packageHarnessPlatform({
        platform: 'win32',
        consumer: 'C:\\Temp\\consumer',
        packageName: '@gabrielion/opnsense-mcp',
        nodeExecutable: 'C:\\node\\node.exe',
        npmCli: 'C:\\node\\npm-cli.js',
        windowsSystemRoot: unsafeRoot
      })
    ).toThrow('Invalid Windows system root');
  }
});
```

Replace `rejects an untrusted Windows system root before starting a supervisor` with a real no-spawn proof:

```ts
it('refuses simulated Windows before starting the generic supervisor', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mcp-posix-harness-boundary-'));
  const supervisorPath = join(temporaryRoot, 'must-not-start.mjs');
  const markerPath = join(temporaryRoot, 'started');
  await writeFile(
    supervisorPath,
    `import { writeFileSync } from 'node:fs';writeFileSync(${JSON.stringify(markerPath)}, 'started');`,
    'utf8'
  );
  try {
    await expect(
      runBoundedCommand(
        { command: process.execPath, arguments: ['-e', 'process.exit(0)'] },
        {
          cwd: process.cwd(),
          environment: process.env,
          input: '',
          timeoutMs: 1_000,
          cleanupTimeoutMs: 1_000
        },
        { platform: 'win32', supervisorPath }
      )
    ).rejects.toThrow(POSIX_COMMAND_HARNESS_ERROR);
    await expect(readFile(markerPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
```

Replace `does not start a Windows tree killer` with a source-boundary assertion:

```ts
it('keeps the command supervisor free of Windows tree-containment branches', async () => {
  const source = await readFile(
    new URL('../support/bounded-command-supervisor.mjs', import.meta.url),
    'utf8'
  );
  expect(source).not.toMatch(/\b(?:taskkill|SystemRoot|win32)\b/u);
});
```

- [ ] **Step 2: Run the focused test to prove the red state**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test -- tests/integration/installed-package-harness.test.ts
```

Expected: FAIL because `POSIX_COMMAND_HARNESS_ERROR` is not exported, the old Windows plan still exists, and
the supervisor source still contains its Windows containment branch.

- [ ] **Step 3: Collapse process-tree planning and termination to the supported POSIX contract**

In `tests/support/installed-package-harness.ts`, remove `windowsSystemRoot` from
`BoundedCommandDependencies`, replace the termination-plan union and Windows termination implementation with:

```ts
export const POSIX_COMMAND_HARNESS_ERROR =
  'Installed-package bounded-command harness requires POSIX process groups; use the native Windows product smoke for Windows validation';

export type OwnedTreeTerminationPlan = {
  readonly kind: 'posix-group';
  readonly group: number;
};

function assertSupportedCommandHarnessPlatform(
  platform: NodeJS.Platform
): asserts platform is 'darwin' | 'linux' {
  if (platform !== 'darwin' && platform !== 'linux') {
    throw new Error(POSIX_COMMAND_HARNESS_ERROR);
  }
}

export function ownedTreeTerminationPlan(
  platform: NodeJS.Platform,
  pid: number | undefined,
  currentPid = process.pid
): OwnedTreeTerminationPlan {
  assertSupportedCommandHarnessPlatform(platform);
  const ownedPid = validatedOwnedPid(pid, currentPid);
  return Object.freeze({ kind: 'posix-group', group: -ownedPid });
}
```

Delete `terminateWindowsTree()`. Replace `terminateOwnedProcessTree()` with:

```ts
export async function terminateOwnedProcessTree(
  platform: NodeJS.Platform,
  pid: number | undefined,
  signal: AbortSignal
): Promise<void> {
  const plan = ownedTreeTerminationPlan(platform, pid, process.pid);
  if (signal.aborted) throw new Error('Process tree termination aborted');
  try {
    process.kill(plan.group, 'SIGKILL');
  } catch (error) {
    if (errnoCode(error) === 'ESRCH') return;
    throw new Error('Process tree termination failed');
  }
  await waitForPosixGroupExit(plan.group, signal);
}
```

Keep `windowsSystemExecutable()` only for `packageHarnessPlatform()` and its absolute `cmd.exe` projection.

- [ ] **Step 4: Refuse unsupported platforms before forking the supervisor**

At the beginning of the `runBoundedCommand()` promise executor, replace platform/output validation and
supervisor construction with this ordering:

```ts
const platform = dependencies.platform ?? process.platform;
try {
  assertSupportedCommandHarnessPlatform(platform);
} catch {
  rejectCommand(new Error(POSIX_COMMAND_HARNESS_ERROR));
  return;
}
let outputLimit: number;
try {
  outputLimit = validatedOutputLimit(dependencies.outputLimitBytes);
} catch {
  rejectCommand(new Error('Command platform configuration failed'));
  return;
}
let supervisor: ReturnType<typeof fork>;
try {
  supervisor = fork(dependencies.supervisorPath ?? COMMAND_SUPERVISOR_PATH, [], {
    cwd: options.cwd,
    detached: true,
    env: Object.freeze({}),
    execArgv: [],
    serialization: 'json',
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
} catch {
  rejectCommand(new Error('Command failed to start'));
  return;
}
```

In `beginTermination()`, call the reduced function without a Windows root:

```ts
termination =
  dependencies.terminateOwnedTree === undefined
    ? terminateOwnedProcessTree(platform, ownedPid, terminationAbort.signal)
    : dependencies.terminateOwnedTree(ownedPid, terminationAbort.signal);
```

Do not change output capture, IPC validation, startup/command/cleanup deadlines, pre-ready exact-child cleanup,
or final POSIX group-disappearance proof.

- [ ] **Step 5: Remove the supervisor's Windows branch**

In `tests/support/bounded-command-supervisor.mjs`, retain only the `spawn` import, remove the `node:path`
import, and replace `terminateAfterOwnerDisconnect()` with:

```js
function terminateAfterOwnerDisconnect() {
  try {
    process.kill(-process.pid, 'SIGKILL');
  } catch {
    process.exitCode = 1;
  }
}
```

Keep target spawning shell-free, the structured IPC protocol unchanged, and `windowsHide: true` as a harmless
cross-platform child-process option; no product runtime imports this supervisor.

- [ ] **Step 6: Run the focused harness and installed-package gates**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test -- tests/integration/installed-package-harness.test.ts tests/integration/installed-package.test.ts
```

Expected: PASS, 18 tests total, with real POSIX descendant disappearance and installed tarball execution still
proved. No Windows execution claim is created by this test.

- [ ] **Step 7: Run the complete Foundation gate**

Run each command and require exit code 0:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:conformance
git diff --check
```

Expected: all deterministic tests and both applicable conformance profiles pass; no formatting or license issue
and no whitespace error remains.

- [ ] **Step 8: Commit the platform-boundary implementation**

```bash
git add tests/integration/installed-package-harness.test.ts \
  tests/support/installed-package-harness.ts \
  tests/support/bounded-command-supervisor.mjs
git commit -m "test: scope command harness to POSIX"
```

### Task 2: Record Foundation acceptance after independent review

**Precondition:** Task 1's implementation commit has passed both the specification-compliance and code-quality
reviews required by `superpowers:subagent-driven-development`, with every finding resolved and re-reviewed.

**Files:**
- Modify: `docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md`
- Modify: `.superpowers/sdd/progress.md`

**Interfaces:**
- Consumes: the independently approved Task 1 implementation and its fresh Node 22 evidence.
- Produces: an accurate approved-spec status and the durable handoff from Foundation to Provenance Task 1;
  Windows remains an unclaimed final release target.

- [ ] **Step 1: Mark the host design approved for implementation**

Replace the current status line with:

```markdown
**Status:** Approved for implementation
```

- [ ] **Step 2: Replace the obsolete Job Object blocker in the SDD progress record**

Replace the final `Remaining blocker` sentence with these paragraphs:

```markdown
Foundation platform-boundary remediation: complete and independently approved. The internal bounded-command
harness now refuses non-macOS/Linux platforms before supervisor spawn, proves complete cooperative POSIX group
disappearance, and contains no Windows descendant-containment path. Windows `.cmd`, junction, and absolute
`cmd.exe` projections remain unit-only design checks; native Windows evidence remains the final product-specific
release smoke, so no Job Object or extra installation prerequisite is introduced.

Final clean Foundation gate after platform-boundary remediation: Node 22.23.1; `npm run license:check`,
`npm run verify`, both applicable conformance profiles, and `git diff --check` all PASS. Foundation is accepted;
Provenance Task 1 is the next executable task. Native Windows support remains unclaimed until its final real
package, installer, runtime, ACL, client-isolation, mock-connectivity, and cleanup gate passes.
```

- [ ] **Step 3: Prove the acceptance record matches code and remains publication-safe**

Run:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH node --input-type=module -e '
import { spawnSync } from "node:child_process";
const scan = spawnSync("rg", [
  "-n",
  "windows-taskkill|taskkill\\.exe|terminateWindowsTree",
  "tests/support/installed-package-harness.ts",
  "tests/support/bounded-command-supervisor.mjs"
], { encoding: "utf8" });
if (scan.status !== 1 || scan.signal !== null || scan.error !== undefined) {
  process.stderr.write("Forbidden Windows containment branch found or scan failed\\n");
  process.exit(1);
}
'
git diff --check
```

Expected: the Node assertion exits 0 only when `rg` exits exactly 1 with no matches; `git diff --check` exits 0.

- [ ] **Step 4: Re-run the complete gate after the documentation change**

Run each command and require exit code 0:

```bash
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run license:check
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run verify
PATH=/opt/homebrew/opt/node@22/bin:$PATH npm run test:conformance
git diff --check
```

Expected: all deterministic and protocol gates pass under Node 22.23.1.

- [ ] **Step 5: Commit the accepted Foundation boundary**

```bash
git add docs/superpowers/specs/2026-07-19-supported-development-hosts-design.md \
  .superpowers/sdd/progress.md
git commit -m "docs: accept foundation platform boundary"
```

After Task 2 review, begin Provenance Task 1. Do not build the native Windows release gate early: its approved
position remains after deterministic product, VM, client, and canonical agentic validation.
