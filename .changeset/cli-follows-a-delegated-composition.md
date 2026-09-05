---
'@endora-commerce/cli': minor
---

New shared library `@endora-commerce/cli/lib/delegated-composer.js`: *"this
composition root does not compose, it hands its composition to somebody — where is
that somebody's source?"*

A composition root used to be one file. Since feature 109's Phase 1c
`backend/test/helpers/test-server.ts` supplies a `PlatformComposition` and
`@endora-commerce/test-kit/server` performs the composition — `registerValues`,
`composeModules`, the two Redis clients, the contribution window, the boot phase,
`buildServer`. Every instrument whose subject is *what a root supplies* therefore has
to follow the delegation or start measuring half a composition, and the failure is
silent in the worst direction: it reports the delegating root as registering nothing.

Measured on the merge request that made the harness the kit's first caller,
`check:port-dependencies` reported **16 root issues** — `redis`, `eventBus`,
`commandBus`, `apiInterceptors`, `resolvedModuleRegistry` and eleven more "registered
by production only" — every one of them a name the harness composition does register.
Both remedies it printed were wrong: a `ROOT_DIVERGENCE_ALLOWED` entry states that the
two compositions genuinely differ on that name, and *"register it in both roots"* asks
for something already done.

`delegatedComposerOf(rootSource, rootPath, repoRoot, binding)` follows the specifier a
root imports `binding` from back to that composer's **source** directory — through the
workspace member's own `exports` map and its `tsconfig.build.json` emit layout, so no
package name, no `dist` and no `src` is written down (D-100), and reading the artefact
cannot hold a run to the previous build (D-164). `delegatedSupplyFields` reads which
option field that composer spreads into its own `registerValues`, and
`delegatedSuppliedNames` collects the names a root hands over through it — because a
delegating root supplies its host values as *data*, which no call-shape reader sees.

Five refusals, each an exit-2 for its caller rather than an empty answer, with
`delegationRefusalMessage` writing the sentence: the binding is imported by nobody, no
workspace member owns the specifier, the package declares no such subpath, no source
under its `rootDir` emits the target, and the composer's directory holds no source.
