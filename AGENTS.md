# Repository agent rules

- Use Node.js 22.19.0 or newer within major 22. On the current workstation prepend `/opt/homebrew/opt/node@22/bin` to PATH; never validate with the default Node 26. Install with `npm ci --ignore-scripts`.
- Never develop or test against a production firewall. Never log, commit, or pass credentials in process arguments. Preserve unrelated changes and keep commits local and atomic.
- Before a final commit run `npm run license:check`, `npm run verify`, `npm run test:conformance`, and `git diff --check`. A task may run only its focused red/green gate before the later conformance task exists.
- Capability modules, handlers, Zod schemas, refinements, transforms, and their captured callback state are trusted static startup code. Do not mutate a schema after `defineCapability()` and do not load third-party capability code in-process. A future untrusted extension boundary must use a validated declarative schema and process isolation; it must not accept executable Zod objects or callbacks.
