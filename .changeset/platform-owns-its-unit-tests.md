---
'@endora-commerce/platform': minor
---

The platform's own unit tests move into this package, beside the sources they cover
(`specs/110-instance-repository/`, T119a) — fifty files under `packages/platform/src/**/*.test.ts`,
run by the package's new `test` script.

**What changes for a consumer: six names leave the host-internal `./lifecycle` subpath.**
`acquireLifecycleLock`, `LifecycleLockError`, `LedgerInput`, `DiscoveredManifestEntry`,
`OverlayModuleFound` and `PackageModuleFound` are no longer re-exported from
`@endora-commerce/platform/lifecycle`. They were on that barrel only because the tests that
name them were outside the package; those tests now import their subjects directly, and
`published-surface.test.ts`' ratchet — *a name on this barrel that no first-party source
outside the platform imports is surface parked against a future need* — removes them in the
same merge request. The declarations themselves are unchanged and still exported from their
own modules (`lifecycle/services/lock.ts`, `lifecycle/services/deactivation-ledger.ts`,
`lifecycle/manifest-registry.ts`).

No module may name `./lifecycle` at all (D-160.14): it is the operator surface, and a package
that could reach it could install, uninstall, enable or disable its siblings. `PUBLISHED_SUBPATHS`
is untouched and stays at five, and nothing on a published barrel moved.

`package.json` gains a `test` script and a `vitest` devDependency; `files` is unchanged, so
nothing new ships.
