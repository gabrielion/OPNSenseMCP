# Product 1B — disposable OPNsense 26 read proof

**Goal:** turn the Product 1A tarball into one reproducible live read against a disposable local OPNsense 26
VM, then document the exact host prerequisites and observed service-search transport.

**Sources:** current public OPNsense install/release/API documentation and current QEMU documentation only.
No legacy repository, private bundle, production firewall, Packer, Vagrant, plugin, SSH feature, mutation, or
benchmark is in scope.

## 1. Doctor and immutable base image

- [x] Add `scripts/vm/product1b.mjs doctor` and `npm run vm:doctor`.
- [x] Check Node 22, macOS/Linux, `qemu-system-x86_64`, `qemu-img`, `curl`, and `bzip2`; print only fixed
  actionable capability results and make no download or filesystem mutation.
- [x] Pin the official `OPNsense-26.1.6-nano-amd64.img.bz2` SHA-256
  `3c16267c791abfc3e41d5249fcb0c245c03cb91e2f1aa4d53017f0f3454d03a1` from the OPNsense 26.1 release
  page.
- [x] Download only into a user cache, verify before decompression, keep the raw base immutable, and create a
  per-run qcow2 overlay. Offline tests own fake commands/files and cover wrong digest, partial download,
  existing VM ownership, timeout, cleanup, and secret-free output.

## 2. One owned VM and lab-only credentials

- [x] Start one QEMU process with serial console, loopback-only user networking/forwarding, bounded startup,
  an explicit PID/ownership record, and unconditional stop/residue proof.
- [x] Bootstrap only the nano lab image through its serial console. Create a dedicated API key inside the
  disposable guest and write the MCP connection JSON as `0600` outside the repository; never expose the
  secret in argv, logs, reports, or Git.
- [x] Probe only `GET /api/core/system/status` and safe GET/POST variants of
  `/api/core/service/search`. Record method/status and bounded shape digests, never raw responses.

## 3. Seal the observation and prove the package

- [x] Select the single service-search request shape observed on OPNsense 26; update the versioned operation
  contract, generated descriptors, closed HTTPS client, mock, and tests together.
- [x] Pack/install the same npm artifact and execute `opn_get system.status` plus
  `opn_list core.services` through MCP against the VM.
- [x] Add `npm run test:product1b`, a sanitized machine-readable result, and concise README/CONTRIBUTING
  commands. State the exact firmware/QEMU/host used and retain all Internet/public-DNS/mutation/Windows/
  benchmark non-claims.

## Exit gate

`vm:doctor` is non-mutating; `test:product1b` owns download verification, one VM, credentials, live package
reads, shutdown, and residue checks. Product 1B is incomplete if setup, either read, observation sealing,
shutdown, or cleanup is indeterminate.
