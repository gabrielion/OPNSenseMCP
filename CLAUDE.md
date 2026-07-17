# Claude repository rules

Follow `AGENTS.md`. Use Node.js 22.19.0 or newer within major 22; on the current workstation prepend `/opt/homebrew/opt/node@22/bin` and never validate with the default Node 26. Never target a production firewall or expose credentials. Preserve unrelated work.

Before a final commit run `npm run license:check`, `npm run verify`, `npm run test:conformance`, and `git diff --check`; during foundation bootstrap run the focused gates that already exist.
