---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

**`@endora-commerce/platform` gains a `./lifecycle` subpath, and it is not public API** (D115-4; `specs/115-lifecycle-container-move/contracts/operator-half.md` §5).

It carries `_lifecycle`'s operator surface — the orchestrator and its `LifecycleError`, the lifecycle lock, the dependency and gating graphs, the deactivation ledger, the manifest loader, the static registry, the presence loader, the module origin helpers, the module's own `registerModule`, `manifest` and admin routes. The set is derived rather than curated: it is exactly the fourteen platform-lifecycle files the application reaches today by relative path into `packages/platform/dist/`, so every one of those reaches has an address to be written as instead.

**Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged, and `PUBLISHED_SUBPATHS` stays at five. `./lifecycle` joins `./composition` and `./migrations` as **host-internal**: declared by the `exports` map, so the host, its five `module:*` entry points and the test kit resolve it, and carried by no published barrel, so `check:platform-surface` reports a module naming it as `host-internal-subpath`. **No module may name it** — this surface drives the platform's presence axis, and a module that could name it could install, uninstall, enable or disable its siblings. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer, and leaves this one in the same merge request.

`@endora-commerce/cli` publishes `HOST_INTERNAL_SUBPATHS` from `lib/platform-surface.js`: the host-internal class as a record of subpath → the reason it is not public API. It was a literal inside one assertion, then a bare set duplicated across two test files with the reasons in the prose of one of them. **If you enumerate the host's subpaths**, read `HostPackage.declaredSubpaths` for what the manifest declares and this record for which of them are host-internal; the published five stay `PUBLISHED_SUBPATHS`. Nothing is removed and no signature changes.
