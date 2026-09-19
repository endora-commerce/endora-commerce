# @endora-commerce/test-kit

## 0.11.0

### Minor Changes

- 0515a1b: A module package may publish its own test support, on a new `./test-support` subpath

  Eleven vendor test doubles — the scripted Ergonode, UnoPim, Comarch XL, Infakt and wFirma
  clients, the three scripted media fetchers, the two webhook signers and the XL installation
  fixture — moved out of `backend/test/helpers/` into the packages whose protocols they encode.
  Each is now published at `<package>/test-support`, which is the first consumer-visible change:
  a specifier that was a relative path into an application's test tree is a bare one.

  The tables a module's tests need emptied travel the same way. `pim_pimcore`, `pim_ergonode` and
  `ksef` declare their own `volatileTables`, and `@endora-commerce/test-kit/support` gains
  `collectVolatileTables` to merge them — refusing two modules that claim one table, and any name
  that is not an unquoted identifier, because the collected set is interpolated into a
  `truncate … cascade`.

  `@endora-commerce/cli`'s command-coverage rule prunes the new layer from its walk. A fixture
  writer is not a service write, for the same reason a migration is not.

- 15af64a: `./support` publishes the entity index's type and its lookup, and names no module

  A server-bound test writes rows, and to write one it needs the entity class **the ORM
  registered** — not a structurally identical copy read out of a package's source, which is a class
  the ORM never discovered (D-160.6.1). A module package publishes one `entities` array and no
  entity class by name (D-168), so the class is picked out of that array by name.

  _Which_ modules are there is the one fact a package that may name none is forbidden to know
  (feature 109 R2.2, FR-001), which is why `backend/test/helpers/package-entities.ts` is
  permanently host-owned (`module-package-layout.md` R10's closing paragraph). So the kit carries
  the **shape** — `InstalledEntityIndex`, keyed by module id — and the **lookup** —
  `entityNamedIn(index, moduleId, name)` — and the population arrives as an argument, rendered by
  the host's own generator.

  The lookup delegates to the platform's own `entityNamed` rather than re-implementing it: two
  implementations of one lookup are two answers waiting to disagree about what a missing name
  does. What it adds is the module dimension, because "no such entity" has two causes with
  different remedies — the module is not installed, or the module publishes no such class — and a
  host that gets `Cannot read properties of undefined` for the first has been told nothing.

- cd7b1ee: `composeTestServer` registers the sales-channel kernel it composes

  It composed the kernel — it has to, the subscriber ordering depends on that happening above
  `composeModules` — and then registered none of the four names `compose-app.ts` registers out of
  the same object, nor the out-of-request channel resolver a channel-scoped settings read needs. So
  the kernel existed and nothing could resolve it: `inventory`'s channel-scoped stock read,
  `payment_methods`' and `delivery_methods`' auto-bind and every channel-bridge declaration each
  failed with `AwilixResolutionError` on their first call, in a composition that had booted cleanly.

  It stayed invisible in the monorepo because the reference harness registers all four itself,
  under a comment reading _"mirrors `compose-app.ts`"_ — the one caller that would have noticed had
  already worked around it. An out-of-tree host booting the published platform through the kit found
  them one failed boot at a time.

  `registerValues` overwrites and the harness contributes identical values, so that workaround stays
  correct while it is removed. A caller that wants a different answer for one of the five still says
  so in `contribute`, which runs after.

### Patch Changes

- Updated dependencies [b413e2d]
- Updated dependencies [0c59e92]
  - @endora-commerce/contracts@0.13.0
  - @endora-commerce/platform@0.12.0

## 0.10.1

### Patch Changes

- 8f61a6b: Every published package now ships its own `LICENSE` and `README.md`.

  npm force-includes a file named `LICENSE` into the tarball exactly as it does `README.md`,
  whatever `files` says, so the text has to be in the package directory and not only at the
  repository root — `LICENSE-COMMERCIAL.md` states that rule and, until this release, no package
  obeyed it. Measured on `master`: **0** of the 82 publishable packages carried a `LICENSE` and
  **14** carried a `README.md`, so every tarball shipped without licence text and 68 registry
  pages would have rendered empty.

  Both files are **generated**, by `pnpm --filter backend run manifests:generate`, and refused
  when stale by `manifests:check` in the `quality` job:
  - the `LICENSE` is the repository's root `LICENSE`, copied verbatim — the same single source
    the `license: MIT` field is already rendered from. A package that declares a licence of its
    own in the `SEE LICENSE IN <file>` form is skipped and keeps the file it names.
  - the `README.md` is rendered from what the package's own manifest declares: its description,
    its module id where it has one, every published subpath with what that layer holds, its peer
    dependencies with the optional ones marked, the locales its `i18n/` carries and what the
    tarball ships. A `README.md` **without** the generated marker on its first line is a human's
    and is never rewritten — the fourteen that existed are untouched.

  Five module packages also get their npm description back. `@endora-commerce/mod-blog`,
  `mod-credit-limits`, `mod-dhl-parcel`, `mod-google-analytics` and `mod-quote-requests` carried
  the note written when they were moved out of `backend/src/modules` — _"the first module to
  leave backend/src/modules … the manifest id stays identity of record"_ — as the sentence a
  registry shows under the package name. Each now carries the sentence its own module manifest
  declares, which is where `descriptionFor` seeds one from in the first place.

  No API changes, no new dependency, no behaviour change: what moves is what the tarball carries
  and what a package page says.

- Updated dependencies [4915024]
- Updated dependencies [8f61a6b]
- Updated dependencies [6b2ed26]
- Updated dependencies [55fc950]
  - @endora-commerce/contracts@0.12.0
  - @endora-commerce/platform@0.11.1

## 0.10.0

### Minor Changes

- 0eeb9b5: Require Node >= 22.18.0.

  The previous floor was 22.17.0, which MikroORM 7 sets. 22.18.0 is the first release that
  strips TypeScript types without a flag, and that is what loads a deployment's overlay module:
  in a scaffolded instance `apps/` is outside every compiled member, so the unit the platform
  `import()`s is the client's own `.ts`. On 22.17.x that import throws
  `ERR_UNKNOWN_FILE_EXTENSION` and the process dies before it listens. Emitting a `.js` beside
  the client's source was measured and refused — the overlay loader resolves `.js` before `.ts`
  while the divergence derivation admits both, so the sibling doubles every seam site in the
  report.

  Derived by probing 22.17.0, 22.17.1, 22.18.0 and 22.19.0 against a `.ts` module imported with
  no flag; 22.18.0 is the lowest that loads it.

  If you run 22.17.x, upgrade to 22.18 or later. Nothing else in these packages changed.

### Patch Changes

- Updated dependencies [c7b3512]
- Updated dependencies [c9a64de]
- Updated dependencies [0eeb9b5]
  - @endora-commerce/platform@0.11.0
  - @endora-commerce/contracts@0.11.0

## 0.9.1

### Patch Changes

- 0ebc202: Two handles a composed test platform never gave back — a Redis connection nobody opened on purpose,
  and a five-minute `setInterval` whose `close()` nothing ever called. Together they were ending every
  `test:backend` shard.

  **Why two forgotten handles are worth 1.2 GB.** A libuv handle is a GC root, so everything its
  callback closes over is _live data_, not garbage. The `ksef` sweep's callback closes over that
  module's options, whose `auditLogService` holds the harness's entity-manager factory, which closes
  over the composition — every module entry, every module namespace, and therefore that test file's
  entire transformed module graph. The backend suite composes a whole platform **per test file** in
  one shared fork, so one uncleared timer per composition is one retained platform per test file.

  **`@endora-commerce/mod-ksef` — the reconcile sweep is disposed with its registration.**
  `ksefModule` has always returned a `close()` that clears the `setInterval` and drains the queue and
  worker; the container registration declared no `.disposer`, so `container.dispose()` walked past it.
  A heap snapshot taken after twelve compose/teardown cycles held twelve live `Timeout` objects,
  every one of them created by this plugin.

  **`@endora-commerce/test-kit` — the subscriber client is opened only when it is armed.**
  `composeTestServer` opened a second `ioredis` client on **every** composition so that
  `exercisePubSub` could choose between it and an inert stub, but handed it to `teardownTestServer`
  only when the option was set — which nearly no test sets. It is now created only when it will be
  subscribed to, which is also the shape that survives a teardown path throwing before it reaches a
  disconnect.

  **Measured, shard 1 of five, one process, `--max-old-space-size=2048`, post-GC live set after each
  test file:**

  | at file | neither repair                               | `ksef` only | both       |
  | ------- | -------------------------------------------- | ----------- | ---------- |
  | 16      | 634 MB                                       | 581 MB      | 582 MB     |
  | 46      | 980 MB                                       | 591 MB      | 640 MB     |
  | 76      | 1424 MB                                      | 587 MB      | 686 MB     |
  | 106     | **1914 MB**                                  | **728 MB**  | **728 MB** |
  | 297     | fork dead at 110 of 300; 190 files never ran | 723 MB      | 723 MB     |

  1914 MB at file 106 is the 93%-of-cap reading CI reported after that same file.

  **The attribution, since the two are shipped together:** the `ksef` disposer is the whole of the
  heap repair — a run with it and without the test-kit change is identical to the one with both, to
  0.8 MB at file 106. The test-kit change is a connection leak repaired on its own terms: it is worth
  one ioredis client and one socket per composition, which is what the new `TCPWRAP` assertion
  catches and what a developer's long-lived local Redis notices before the heap does.

  `backend/test/integration/kernel/heap-ceiling.test.ts` now brackets three composition cycles with
  `async_hooks` and refuses a surviving `Timeout` or `TCPWRAP`, which is the assertion the existing
  post-GC heap measurement in that file cannot make: a handle's graph is legitimately live, so it
  reads as retention rather than as a leak.

- Updated dependencies [08dcbd9]
- Updated dependencies [5bfefe0]
  - @endora-commerce/platform@0.10.0
  - @endora-commerce/contracts@0.10.0

## 0.9.0

### Minor Changes

- 10a17f0: The liveness and readiness probe is the platform's, and `@endora-commerce/mod-health-checks` is gone.

  `GET /api/v1/_health` is now registered by `@endora-commerce/platform` itself: `composeApp`
  puts `healthRoutePlugin({ orm, redis })` at the head of the module plugins it returns, and
  `composeTestServer` does the same, so an instance serves the probe because it is an Endora
  instance rather than because a module the scaffolder happened to select is installed. It was
  not: `endora new instance` writes the closure over the modules declaring
  `activation.nonDeactivatable`, `health_checks` declared no activation block at all, and no
  manifest named it as a dependency — so a scaffolded instance answered 404 on the route
  `deploy/compose.prod.yml` healthchecks, its API container never became healthy, and its
  storefront, which waits on `service_healthy`, never started. Moving the route also closes the
  withdrawal: `assertDeactivatable` returns early for a module with no activation block, so
  `module:uninstall health_checks` was accepted and an operator could take the liveness endpoint
  off a running instance with one command. Owner ruling D-229.

  **What a consumer has to do.** Nothing, if the instance composes through `composeApp` or
  `composeTestServer` — the route arrives with the platform. Remove
  `@endora-commerce/mod-health-checks` from the instance manifest; it no longer resolves. The
  route, its path, its payload and its status codes are unchanged.

  `@endora-commerce/platform/composition` gains `healthRoutePlugin`, `registerHealthRoutes`,
  `platformHealthProbes`, `healthResponseSchema`, `HealthDeps`, `HealthProbeSources` and
  `HealthResponse`. No new subpath: `./http` is untouched, because no module names any of this.

  `MEILISEARCH_URL` and `npm_package_version` are declared by the platform now, with the
  sentences the dissolved manifest carried. `@endora-commerce/mod-search` therefore stops
  declaring `MEILISEARCH_URL` — one variable may not carry two descriptions, and a module may not
  describe a platform input — while continuing to read it and to declare
  `MEILISEARCH_API_KEY`. **An operator-visible consequence:** the surviving declaration is
  `optional`, where `search`'s was `required`. Both readers have always defaulted to
  `http://localhost:7700`, so the requirement was aspirational, but a prompt built from these
  declarations will no longer insist on the value.

### Patch Changes

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [e6f053a]
- Updated dependencies [6c8d958]
- Updated dependencies [30430d1]
- Updated dependencies [6bd9ae9]
- Updated dependencies [c1d281f]
- Updated dependencies [bd596a9]
- Updated dependencies [def780b]
- Updated dependencies [97f9233]
- Updated dependencies [8e86e55]
- Updated dependencies [2fe0b8d]
- Updated dependencies [ee80d6b]
- Updated dependencies [52c2bfd]
  - @endora-commerce/platform@0.9.0
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 7f9bd93: `composeTestServer` gains two options and one ordering guarantee, all three found by making
  this repository's own harness its first caller (feature 109, Phase 1c).

  `decorationOrder` is forwarded to `composeModules` unchanged. It is the wrapping order an
  instance declares for a name more than one module decorates (feature 107) — read from
  `backend/src/apps/<deployment>/divergence.ts` here and from wherever an instance keeps it
  elsewhere. It is **checked, never applied**: the composer emits in its own topological order
  and drains decorations once, and `AmbiguousDecorationError` names this field when the two
  disagree. It is an option rather than a fifth `PlatformComposition` member because that
  type's four members are what a composition cannot be built without, and an instance that
  declares no ambiguity resolution composes perfectly well.

  `scopedPlugins` mounts route plugins **after** the request-scope hook, where `plugins`
  mounts them before it. The scope sits in the middle of the chain rather than at its end, so
  there are two sides to it and a caller needs both: authentication has to be ahead of the
  hook, because the `TenantContext` is built out of the actor that hook resolves, and the
  sales-channel resolver has to be behind it, because it writes the resolved channel into the
  open scope and refuses when there is none. Production's own root has had exactly this shape
  all along — `authModulePlugin`, `tenantContextModulePlugin`, `salesChannels.plugin`. With
  one slot, every request through a kit-composed server carrying that resolver answered
  `500 No request scope is open`.

  Both arrays are now read **after** the contribution window closes rather than before it, so
  a caller may push into either from inside `contribute`, where the value a plugin needs
  finally exists. That is a guarantee rather than a placement, and it is what lets a caller
  mount a plugin over a service the composed container only just produced.

  ```ts
  await composeTestServer({
    composition,
    decorationOrder: divergence.decorationOrder,
    plugins: [authenticate], // before the request scope
    scopedPlugins: laterPlugins, // after it; may be pushed to from `contribute`
  });
  ```

### Patch Changes

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [eb01958]
- Updated dependencies [4eeb5cd]
- Updated dependencies [a6a9d30]
- Updated dependencies [016524f]
- Updated dependencies [fb2659a]
- Updated dependencies [9eb0cb6]
- Updated dependencies [7e80824]
- Updated dependencies [e1748da]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [6521134]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [74a4797]
- Updated dependencies [9a5d4d2]
- Updated dependencies [a655909]
- Updated dependencies [1beac89]
- Updated dependencies [7fb0567]
- Updated dependencies [304f6d8]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [ec09593]
- Updated dependencies [dcface9]
- Updated dependencies [40e6e96]
- Updated dependencies [d321c67]
- Updated dependencies [03dec57]
- Updated dependencies [8249bb7]
- Updated dependencies [5ba2e97]
- Updated dependencies [0222f04]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0
  - @endora-commerce/platform@0.8.0

## 0.7.0

### Minor Changes

- fc0d289: New package: `@endora-commerce/test-kit`, the seam a server-bound test composes an Endora
  Commerce platform through. Three subpaths, and it declares **no module package** in any
  dependency field.

  `./server` — `composeTestServer(options)` takes a `PlatformComposition` and never builds
  one. Its four members are the four things only the caller knows: the module entries to
  compose, an ORM opener and closer, the loaded manifest registry, and the test-support
  contributions of exactly the modules being composed. Everything else it does is
  host-shaped and true of any platform — the container, the audit writer, the event and
  command buses, the two Redis clients, the settings and sales-channel kernels, one
  `composeModules` pass, one contribution window, the tenancy request-scope hook, one boot
  phase, `buildServer`, and `teardownTestServer` to take it all down again.

  ```ts
  import { composeTestServer, teardownTestServer } from '@endora-commerce/test-kit/server';

  const handle = await composeTestServer({
    composition: { modules, orm: { open, close }, manifests },
    buildTenantContext: async (request) => resolveTenantContext(actorOf(request)),
  });
  // handle.app.inject(...), handle.container.cradle.myService, handle.em()
  await teardownTestServer(handle);
  ```

  A composition whose `modules` lacks a module declaring `activation.nonDeactivatable` is
  refused by the platform's own `RequiredModuleAbsentError`, naming the module, the sentence
  its manifest gives and the remedy. The kit adds no second check and swallows nothing.

  `./database` — the per-invocation database lease (issue #189): one `vitest run` gets its
  own `create database … template` clone and its own Redis logical database, both released
  when the run ends and swept if it crashed. `BACKEND_TEST_ISOLATION=shared` and
  `BACKEND_TEST_KEEP_DATABASE=1` behave exactly as they always have. The two application
  facts are now the caller's: `identity`, the digest over its migration set, and
  `migrateTemplate`, the step that applies its schema.

  `./support` — `TestSupportContribution`, the four-member declaration a module package
  publishes at `./test-support`. `registrations` is applied today; `volatileTables` and
  `seed` are declared and not yet collected, so a module writes one declaration rather than
  two.

  Nothing here reads `process.env.DEPLOYMENT`, walks `node_modules` or reads a generated
  artefact: each of those is a fact about the caller's process, and a kit that answered them
  would answer them differently from the platform that composes for real.

### Patch Changes

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [b2552d5]
- Updated dependencies [cebad9c]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [4db867c]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [fbf1bf8]
- Updated dependencies [469a5f4]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [cc9c2f4]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
- Updated dependencies [4e964e0]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [1f4475e]
- Updated dependencies [ce1d197]
- Updated dependencies [028d8b4]
- Updated dependencies [81f4b08]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a84ad28]
- Updated dependencies [a47dcc8]
- Updated dependencies [a47dcc8]
- Updated dependencies [31975ca]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [2cd9c14]
- Updated dependencies [aab1f32]
- Updated dependencies [764b379]
- Updated dependencies [bbf9258]
- Updated dependencies [0a2bbd4]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
  - @endora-commerce/platform@0.7.0
