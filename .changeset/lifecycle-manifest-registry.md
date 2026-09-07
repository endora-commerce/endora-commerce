---
'@endora-commerce/platform': minor
---

**`@endora-commerce/platform/lifecycle` gains the manifest-registry derivation, and takes its input as a parameter** (D115-2; `specs/115-lifecycle-container-move/contracts/operator-half.md` §3).

New on the `./lifecycle` barrel: `coreManifestEntries(discovered)`, `resolveManifestEntries(sources)`, `ManifestPathMissingError`, and the types `DiscoveredManifestEntry`, `RegisteredManifestEntry`, `ManifestSources`, `OverlayModuleFound`, `PackageModuleFound`. Together they are the whole of *"which modules exist, where does each one live, and did two of them claim one id"*: the core entries, the `origin` field and its three construction sites, the `manifestPath` refusal, the collision assembly and the three-way merge of core ∪ overlay ∪ installed packages.

**The generated manifest index is supplied to the platform, never reached by it.** That artefact is a fact about one repository's tree — bare core under every value of `DEPLOYMENT`, host-owned — so the platform declares the shape and the host passes the array. An instance binds three suppliers against its own answers in about twenty lines; nothing in the package names a generated file, a deployment root or a `node_modules` path.

The module-id collision rule moves with the merge, from the application to `lifecycle/services/module-id-claims.ts`: `assertNoModuleIdCollisions`, `moduleIdCollisions`, `ModuleIdCollisionError` and the `ModuleIdClaim` / `ModuleIdCollision` types are now published on the same barrel. It is pure — no disk, no environment, no layout — and the assembly that calls it is the three-way merge, which a platform file cannot make while the rule sits in a file the platform may not name.

**Nothing became public API and nothing is removed.** `PUBLISHED_SUBPATHS` stays at five; `./lifecycle` remains host-internal, so a module naming any of these symbols is still a `host-internal-subpath` finding.
