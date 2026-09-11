# @endora-commerce/cli

## 0.7.0

### Major Changes

- 08d22de: The admin layout answers for an application that has no module surfaces left.

  `AdminSurfaceLayout.moduleRoot` is now `string | null`. It is `null` when no directory under
  the admin source root holds a child named after a registered module — the state
  `specs/091-module-owned-admin-surfaces/` reaches once every module's admin screens live in
  that module's own package. **Zero module roots is a measurement, not a failure**; two is still
  `AdminLayoutUnresolvableError`, because picking one narrows every walk to it without saying so.
  - `findAdminModuleRoot(sourceRoot, registered)` returns `string | null` instead of `string`,
    and no longer throws for zero. **A consumer that assumed a non-null return does not
    compile**; the answer at every call site is the same trivial one, because nothing is under a
    directory that does not exist. Old: `const root = findAdminModuleRoot(src, ids); walk(root)`.
    New: `const root = findAdminModuleRoot(src, ids); if (root !== null) walk(root);`
  - `AdminSurfaceLayout.directories` and `AdminSurfaceLayout.moduleOfDirectory` and
    `AdminSurfaceLayout.componentDirectories` are empty when `moduleRoot` is `null`. Each is a
    measurement on the same terms.
  - **New: `adminRegistryPathOf(members, readText?)`** — the generated admin contribution
    registry's absolute path, or `null` for a workspace with no admin application. It needs the
    alias member and its target and nothing else, so a caller gating a population floor on that
    artefact's presence cannot have the gate go true for an unrelated reason.
    `AdminSurfaceLayout.generatedRegistryFile` is built from it, so there is one derivation with
    two entry points.
  - **New: `ModuleTreeLayout.adminSurfacesRefusal()`** — the `AdminLayoutUnresolvableError`
    message that produced `adminSurfaces()`'s `null`, memoised on the same call and non-null
    exactly when the layout is `null`. `adminSurfaces()` collapsed four distinct causes into one
    bare `null` and every caller printed a sentence of its own choosing; measured, a tree that
    refused on the module root had both of its callers report the alias, which sends a reader to
    repair a file that is correct. A consumer printing an admin refusal should print this string.

### Minor Changes

- e3eb042: `lib/admin-surfaces` names the admin application as an owner, and names the three
  registries the layout is read from.

  Three additions, all of them so that a consumer can exclude or attribute without spelling a
  path twice:
  - **`ADMIN_HOST_OWNER`** — the owner id of the admin application itself, `'host'`. It was a
    literal in `backend/scripts/ledgers/admin-registrations.ts`, which is deleted when the
    last module's registrations move out of `App.tsx`; the boundary ledger that now uses the
    same id outlives it, so the spelling moved here and that ledger re-exports it under the
    name its own consumers already use.
  - **`ADMIN_REGISTRY_ARTEFACT`** — `'modules.generated.ts'`, the generated contribution
    registry's filename. `generate-composer.ts` renders it under the alias member's source
    root and now derives the path from this constant, so a reader that has to exempt the
    artefact and the writer that produces it cannot end up naming different files.
  - **`AdminSurfaceLayout.registryFiles` and `.generatedRegistryFile`** — `App.tsx`,
    `components/AppShell.tsx` and the artefact above, absolute. The first two are the paths
    `resolveAdminSurfaces` already opened to read the route table and the nav; returning them
    is what lets a caller exclude the pair without a second copy of it.

  ```diff
   const layout = resolveAdminSurfaces(members, registered);
  +// The two hand-written registries, as the layout itself names them.
  +for (const file of layout.registryFiles) skip(file);
  ```

  Both new fields are required on `AdminSurfaceLayout`, so a caller that **constructs** one
  by hand — a test fixture, not a consumer of `resolveAdminSurfaces` — has to add them.

- 7140eed: `adminUiPackages` / `declaresAdminUi`: a workspace member may now declare
  `endora: { type: 'admin-ui' }`, the third value of that block beside
  `'platform'` and `'module'`, and `@endora-commerce/cli/lib/workspace-packages.js`
  exports the two functions that read it.

  `@endora-commerce/admin-kit` declares it. Nothing about what the kit publishes
  changes; the declaration is what puts its sources into two static checks'
  populations — `i18n:hardcoded`'s walk, which found the kit by name until now,
  and `check:admin-zones`' third `foreign-module-id` population, which found it
  not at all. A second admin-ui package (feature 091 P5b's
  `@endora-commerce/page-builder-admin`) is judged from its first commit by
  declaring the same block, with no edit to either check.

  The declaration only ever _adds_ obligations, which is what distinguishes it
  from the self-certified exemption D-171 refused: forgetting it is a hard-coded
  string that goes unread and a `HARDCODED_STRINGS_BASELINE` entry that reports
  itself drained in the same run.

- 2a97fca: `ESTATE` gains `check:test-ownership`, feature 106's ownership instrument
  (`specs/106-module-owned-tests/contracts/module-test-ownership.md`).

  For a consumer of this package the change is one new member of the exported
  `ESTATE` array, so `ESTATE.length` moves and anything iterating it reports one
  more rule. Its verdict is `scope: 'package'` with `host: pending(…)`: the rule's
  subject is one module package's test tree, which is exactly the question a
  package asks about itself, and what a lone package cannot supply is the
  _application's_ own `backend/test/**` — `misplaced-test`'s whole population.
  That signal is declared in the entry's `partial` list rather than dropped, so
  `endora check` will report it as unevaluated with a reason instead of leaving it
  silently absent.

  No exported type changes and no existing entry moves.

- ce5be77: Add `@endora-commerce/cli/lib/emitted-freshness.js`: "is the artefact this run read still the one
  its source says it is?"

  A package resolves through its own `exports` map at its build output, so a conformance check that
  imports a module's manifest by bare specifier reads `dist/manifest.js` and never opens
  `src/manifest.ts` — an author who edits the source and runs the check is answered about the previous
  build, in green. The new module derives, from a package's own `pnpm-workspace.yaml` membership,
  `exports` map and `tsconfig.build.json`, which file a run actually read and whether its source has
  outrun it.

  New exports: `emittingPackages`, `checkEmittedFreshness`, `freshnessRefusal`,
  `refuseStaleEmittedArtefacts`, `readArtefactOf`, `rootExportOf`, `sourceOfEmitted`, `originOf`,
  `packageHolding`, `nodeFreshnessFs`, and the types `EmittingPackage`, `FreshnessFs`,
  `FreshnessInput`, `FreshnessResult`, `FreshnessFinding`, `FreshnessFindingKind`, `ArtefactOrigin`.

  A consumer that wants the refusal calls `refuseStaleEmittedArtefacts(prefix, result, displayOf)`,
  which prints and exits **2** — the input could not be read, which is neither "clean" nor "found
  something".

- 76c541d: `@endora-commerce/cli` is published, and its `endora` binary works when it is installed rather than only when it is developed.

  Under D-208 this is the first package a client installs: somebody installs the CLI and, by running commands, builds their own Endora Commerce. It carried `"private": true`, so `changeset publish` filtered it out before it did anything. It now declares `repository`, `publishConfig.access` and no `private`, which is what the three packages published before it declare. It carries no `license`: D-203 defers that decision to the merge request that makes a package public **on npmjs**, and every package published so far carries none.

  **The binary was silent from an install, and that is the substantive fix.** `endora --help` printed nothing and exited 0 for every consumer who installed this package — measured on a packed tarball in a scratch directory. A package manager links the `bin` rather than executing the file in place (pnpm's shim execs a path through the `node_modules/@endora-commerce/cli` symlink into its content-addressed store; npm links the entry itself), so `process.argv[1]` names the link, while Node's ESM loader resolves a module URL to its real location before evaluating it. Comparing the two as written is false for every install and true only in the checkout that developed it. The entry guard now compares realpaths, and the negative direction is asserted too, so `import { runNewModule }` still runs no program as a side effect.

  **What this build's three commands do outside a checkout of the platform repository**, because installability and checkout-independence are two different properties and only the first is delivered here:
  - `endora check` **works**. It reads the module package it is pointed at and nothing above it — the `endora` block, the `exports` map and the sources those subpaths reach — so a module author outside this repository can be held to the platform's static-check estate. This is the command the publication is for.
  - `endora new module` and `endora new storefront` **refuse, at exit 2, naming what is missing**. The first derives the package manifest by running the platform's own manifest generator, which reads the workspace file for the npm scope, an application's manifest for the peer ranges and the root manifest for `engines.node`; the second copies the reference storefront out of the checkout and asks `git ls-files` what that application is. Neither invents those inputs. Making them work outside a checkout is `specs/110-instance-repository/`'s subject, not this change's.

- 3521978: `@endora-commerce/cli` now owns the shared library the static-check estate is built on, and
  publishes it on a `./lib/*.js` subpath.

  Fifteen modules moved out of the application's `backend/scripts/lib/` into this package's
  `src/lib/`, unchanged: `admin-surfaces`, `emitted-exports`, `module-package-subpaths`,
  `module-packages`, `module-population`, `module-roots`, `nested-checkouts`, `platform-root`,
  `platform-surface`, `read-size`, `repeating-timers`, `source-text`, `specifiers`,
  `switchable-modules` and `workspace-packages`. Every exported symbol keeps its name and its
  signature; a consumer writes

  ```ts
  import { requireModuleLayout } from '@endora-commerce/cli/lib/module-roots.js';
  ```

  `typescript` moves from `devDependencies` to `dependencies`: the relocated analyses read
  literal AST nodes, the specifier survives into the emitted declarations, and a devDependency
  is not installed for a consumer (D-181).

  Four modules stay in the application, each because it reads something the application owns and
  this package cannot: `sql-tables` and `package-declarations` reach `backend/src`'s naming
  strategy, installed-package enumerator and tenant-scope registry; `runtime-assets` and
  `module-package-manifest` reach the repository root's `scripts/lib/runtime-assets.mjs`, which
  is plain JavaScript at the root because 66 module package builds run it under bare `node`.
  They move when the host facts descriptor lands.

- e1465e0: Added `isNextApplication` to `@endora-commerce/cli/lib/workspace-packages.js`.

  _"Which workspace member is the reference storefront?"_ had one answer and one caller —
  `new-storefront/reference.ts`, which resolves the application it copies. It now has two:
  `check-release-intent.ts` derives the publication set from that same application's dependency
  closure, so the packages this repository may publish are what a storefront actually resolves and
  are written down nowhere.

  The predicate is unchanged — a member declaring `next` as a dependency **and** a `build` script
  that runs it — and it moves rather than being copied, because two implementations of it are two
  answers waiting to disagree about which application they mean.

- 239d29a: `endora new module` emits a module's admin layer, behind a new `--admin <navSection>` flag.

  Feature 091 Phase 2 made a module's admin screens arrive by the module existing: the generated
  registry `admin/src/modules.generated.ts` imports every module package's `./admin` layer, and
  `App.tsx` and `AppShell.tsx` render `[...host, ...registry]`. The mechanism landed with one
  converted module and no way to author a second without hand-writing the layer. This is that way.

  With `--admin catalog` (or any member of `AdminNavSectionNameSchema`) the command additionally
  writes:
  - `src/admin/index.ts` — the `AdminContributions` object and **nothing else**, so a consumer
    reaching into another module's `./admin` stays a counted boundary reach. One route whose
    `component` is a `() => import('./pages/…')` factory, and one sidebar entry, both carrying the
    permission code the module's own admin route enforces.
  - `src/admin/pages/<Pascal>Page.tsx` — a screen that reads the module's own
    `GET /api/v1/admin/<route>` through `@endora-commerce/admin-kit/lib`'s `apiClient` and renders
    it with `@endora-commerce/admin-kit/ui`. Every specifier is bare: `@/…` resolves for nothing an
    installed package runs under, and the environment is never read — a screen that has to build a
    URL itself takes the published `apiBaseUrl` instead of acquiring `vite/client` types.
  - `tsconfig.ui.json` — the layer's own emit configuration, sharing `rootDir`/`outDir` with the
    backend build and **replacing** the inherited `exclude` rather than extending it, which is
    otherwise `TS18003` over the one directory it compiles.
  - `test/unit/admin-contributions.test.ts`, and the `nav.*` / `admin.*` keys in both bundles.

  The flag is opt-in and takes the sidebar section as its value: a module with no admin surface is
  a real case, and where a screen belongs in an operator's sidebar is the one judgement the tool
  cannot default. It refuses a section outside the published set, and refuses without a
  `--permission` — there would be no code to gate the emitted screen with.

  `package.json` is still written by the platform's manifest generator and by nothing else: the
  `"./admin"` subpath, the second `tsc` invocation and the React peer set are all derived from the
  sources the command wrote.

- 4db867c: **`@endora-commerce/platform` gains a sixth subpath, `./composition`, and it is not public API** (D-160.14; `specs/080-f4-real-scope/contracts/host-package.md` §2.7).

  It carries the 27 composition symbols a composition root needs and no published barrel carries — `buildServer`, `composeModules`, `createRootContainer`, `registerOrm`, `registerValues`, `createRegistrationOwnership`, `registerRequestScopeHook`, `platformLogger`, `registryCache`, `publishStateChanged`, `activationDeclarationsFrom`, `requiredModulesFrom`, `composeSettingsKernel`, `ManifestReconciler`, `composeSalesChannelsKernel`, `DefaultChannelReconciler`, `createRequestLanguageResolver`, `AuditLogService`, `forkScopedEm`, `resolveTenantContext`, `systemTenantContext`, and the types `ModulePlugin`, `ApiInterceptorRegistry`, `KernelContainer`, `DecorationRecord`, `SettingsKernel`, `SalesChannelsKernel`.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged. **No module may name `./composition`** — production source or test alike; a module's server-bound test composes through the test kit's `composeTestServer`, never through `composeModules`. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer.

  `@endora-commerce/cli` learns the rule: `resolveHostSpecifier` answers a third way — `host-internal-subpath`, a subpath the host's `exports` map declares and no barrel carries — and `check:platform-surface` reports a module's reach into one as a finding of its own kind. `HostPackage` gains a required `declaredSubpaths` field, read off the host manifest's own `exports` map; a consumer constructing a `HostPackage` by hand must supply it.

- 7e71642: Added the deployment divergence report's shape, and gave `decorationOrder` a supply.

  **`@endora-commerce/contracts`** exports `DivergenceReport`, `DivergenceEntry`,
  `DivergenceKind`, `DivergenceDetail`, `DivergenceBoundary` and `DivergenceKey` — the shape of
  the committed record of how one deployment's tree differs from core. Nine kinds, one per seam a
  deployment can use, each entry naming what was changed, the module that changed it, the module
  that owns what was changed, the rung of the customisation ladder it sits on, and the
  deployment's own sentence.

  Two fields are nullable on purpose and a consumer has to handle both. `entry.rung` is `null`
  for `registration`, `worker` and `omission`: the ladder ranks ways of changing what _core_ does,
  and those three are a module contributing its own surface or a declaration. `detail.depth` is
  `null` on every `decoration` in a committed report, because depth is a fact about a composition
  rather than about a tree — the runtime half of the report fills it in.

  **`@endora-commerce/platform`**: `ComposeModulesOptions.decorationOrder` is read by both of
  this repository's composition roots for the first time. Nothing about the field's type or its
  semantics changed — it is still _checked, never applied_ — but a composition that passes it now
  gets the assertion it always described, and `AmbiguousDecorationError`'s message changes with
  it: it names the deployment's own declaration file and the field, and suggests the order
  composition would apply, instead of telling its reader that there is no way to declare one.

  `ForeignDecorationError`, `PackageDecorationNotOfferedError` and `DuplicateRegistrationError`
  each gained the rung they refused and the nearest lower rung that works, by mechanism. **If you
  assert on any of these four messages, they have moved.** `error.name` and the constructor
  arguments are unchanged.

  **`@endora-commerce/cli`**: one estate row, `check:divergence`, classified `repository-only` —
  a rule's subject there is a deployment, and a module package is not one.

- fe10845: New package: `@endora-commerce/cli`, one binary named `endora`, with its first command — `endora new module`.

  `endora new module <id> --name <text> --description <text> [options]` writes a module package that the platform composes, that the operator can switch off, that is discoverable in the command palette, and that type-checks and passes the platform's static-check estate with no hand edits. The layers are opt-in — `--entities`, `--ports`, `--worker`, `--subscriber` — and each one decides which of the platform's required checklists the emitted module has to satisfy, so the compliant shape is the default rather than something an author reconstructs from four checklists and 66 examples.

  It does **not** author the package's `package.json`. That file is derived from the sources — `exports` from which layers exist, `peerDependencies` from the bare specifiers the sources actually import, the ranges from the application that composes the modules — and it has an author already: the platform's manifest generator. The command writes the sources and then invokes that generator, so the two cannot disagree.

  Programmatic surface, for a caller that wants the scaffold without the argv layer: `runNewModule`, `buildScaffoldSpec`, `emitModuleFiles`, and the derivations around them (`npmNameFor`, `migrationStampFor`, `pascalOf`, …).

  `endora check` is not in this build and the program says so by name rather than pretending to run.

- 32cc6e4: A module can declare where its documentation lives, and the tooling can find it.

  `@endora-commerce/contracts` gains `ModuleDocsManifestSchema`,
  `ModuleDocsDeclarationSchema` and an optional `docs` field on `ModuleManifestSchema`.
  Its shape is `i18n`'s and it is located the same way — a directory at the **package
  root**, in the package's `files` list, with **no `exports` subpath**, found by joining
  `docs.dir` to `dirname(manifestPath)`. The anchor is the platform's, so nothing in a
  module names a package, a repository root or a build directory in order to find its own
  pages.

  ```ts
  export const manifest = defineModuleManifest({
    id: 'inpost',
    i18n: { bundlesDir: 'i18n' },
    docs: { dir: 'docs' }, // ships pages
    // docs: false,          // ships none, deliberately
  });
  ```

  **`false` and absent are not the same state**, and consumers must not collapse them:
  absent is a module nobody has decided about, `false` is a decision. A universal
  obligation over a population where some members legitimately owe nothing is repaired by
  empty files whose only effect is to make a check pass, which is why the decision has a
  spelling of its own.

  `@endora-commerce/cli` gains `lib/module-docs.js`: `resolveDocsLayout` (the Docusaurus
  site, from the workspace member declaring a configuration), `collectDocPages`,
  `parseFrontMatter`, `attributeDocs` and `moduleOfSlug`. It is the one derivation behind
  both the generated documentation navigation and the check that refuses its population
  defects — a second derivation of one population is two answers waiting to disagree, which
  is the state it replaces: three hand-maintained lists described the modules this platform
  composes and all three disagreed with it and with each other.

  No existing symbol changed, and a manifest that declares no `docs` is unaffected.

- c17fb1f: `endora check` runs eight more of the estate's rules against one module package,
  and ten more analyses now have one implementation and two hosts.

  **New on `@endora-commerce/cli/rules/*`** — each is the same function
  `backend/scripts/check-<name>.ts` calls, relocated rather than copied:
  `action-route-permissions`, `channel-resolution`, `default-language-prose`,
  `diacritic-folds`, `entry-scope`, `kernel-boundary`, `platform-surface`,
  `port-shape`, `singleton-identity`, `transaction-context`. Three shared readers
  move with them: `lib/sql-tables.js`, `lib/ui-layer.js` and a new
  `lib/port-registrations.js` (the container-registration and port-resolution
  readers, extracted from `check-port-dependencies.ts`).

  **Eight of them reach a package verdict.** `endora check` now evaluates
  `channel:resolution`, `check:default-language-prose`, `check:diacritic-folds`,
  `check:entry-scope`, `check:kernel-boundary`, `check:platform-surface`,
  `check:port-shape` and `check:transaction-context` over a package's own declared
  layers, taking `pending` from twenty-two to fourteen.

  **Breaking, for a consumer that called these analyses directly.** A ledger is a
  statement about one tree's debt and does not travel, so it is an argument now
  rather than a value the analysis reads:
  - `checkTransactionContext(input, ledger)` — the second argument is required.
  - `checkDiacriticFolds(files, ledger, slugLedger, roots?)` — the two ledgers are
    required; `roots` defaults to this repository's population roots.
  - `checkSingletonIdentity(input, allowed)` — required.
  - `checkPlatformSurface(input, ledger)` — required.
  - `analyse(input, ledger)` and `checkActionRoutePermissions(input, ledger)` —
    required.
  - `violationsOf(sites, allowed)` and `staleAllowances(sites, allowed)` from
    `rules/entry-scope.js` — the second argument is required.
  - `declaredTableNames(source, file, tableNameOf)` from `lib/sql-tables.js` takes
    the entity-class → table-name convention as a **required** parameter. The
    convention is the platform's own naming strategy, which lives in the
    application's runtime sources and cannot be reached from this package; writing
    a copy of the pluralizer here would make two authors of one convention.
  - `isScannablePath(path, roots?)` from `rules/diacritic-folds.js` takes the
    population roots, so a package can supply its own.

  `checkPortShape` gains four optional inputs — `platformOwnedNames`,
  `hostRegisteredPorts` and the two ledgers — and reads none of them from a
  constant of its own.

- 9dfb028: Add `endora check` — the platform's static-check estate evaluated against one module package.

  New on the `./checks` subpath: `runCheck(options)`, `ESTATE`, `PACKAGE_HOSTS`, `pendingEntries()`,
  `resolvePackageLayout(dir)` and the `RunReport` / `RuleResult` / `EstateEntry` shapes. New on
  `./rules/*.js`: the five relocated analyses this build hosts — `nul-bytes`, `bundle-pairing`,
  `container-imports`, `subscribe-seam` and `command-coverage`. Each is the **same function**
  `backend/scripts/check-<name>.ts` calls; a rule has one implementation and two hosts, and a
  consumer that wants a rule's analysis should import it from `./rules/<name>.js` rather than
  re-deriving its population.

  ```
  cd path/to/my-module-package
  endora check                # every rule, one verdict each
  endora check --list-rules   # the estate's ids
  endora check --as-platform  # acknowledged findings read as findings
  ```

  `endora check` exits **0** only when the whole estate was evaluated and found nothing, **1** when
  it was completely evaluated and there are findings, and **2** when the picture is incomplete —
  which in this build is every package, because twenty-one rules have no package-scope host yet and
  each says so with the phase that lands it. `findings=<n>` is printed on the arithmetic line
  whatever the exit code is.

  Two behaviours a consumer should know about. A rule is `not-applicable` only when the package's
  own `package.json` or manifest declares no subject for it, and the report names the declaration it
  looked for; a **declared** layer with no source is a short walk and exits 2. And a package may
  declare `endora.checkLedger` — a keyed, reasoned, two-way file of acknowledged findings which
  suppresses the author's exit code and never `--as-platform`'s.

  One breaking change to an existing export: `isMigratedModulePath(relPath, migrated)`'s second
  argument is now required. It defaulted to this repository's rollout ledger, which is a fact about
  these modules and has moved to `backend/scripts/check-command-coverage.ts` with its host.

- d1c2016: `endora new storefront` learns about a registry, and declares which package
  manager the scaffold is installed with.

  **`--registry <url>`** writes an `.npmrc` into the scaffolded storefront naming
  that endpoint for the scopes the storefront actually installs, and declares the
  credential for the endpoint **and for its host**:

  ```
  @endora-commerce:registry=https://<host>/api/v4/packages/npm/
  //<host>/api/v4/packages/npm/:_authToken=${ENDORA_NPM_TOKEN}
  //<host>/:_authToken=${ENDORA_NPM_TOKEN}
  ```

  The second line is not belt and braces. A registry serves the **packument** on
  the endpoint and chooses for itself where the `dist.tarball` inside it lives:
  GitLab answers an instance- or group-level endpoint with a tarball on the
  **owning project's** path, whose project id varies per package and is unknown
  when the file is written. With the endpoint line alone the metadata fetch is
  authenticated, that one tarball fetch is not, and the registry answers an absent
  credential with `404` — so an install fails with _the package is not there_
  immediately after asking about that same package successfully. A narrower
  prefix works mechanically and was rejected as a derivation: obtaining one means
  assuming a particular server's URL layout, and `--registry` names a registry
  rather than a GitLab. The cost accepted is that the token — a deploy token
  scoped `read_package_registry` — is offered to every request to the host you
  named; a registry serving tarballs from a _different_ host still needs a line of
  its own. A registry at the root of its host gets one line, not two.

  The token is written as an **environment reference and never as a value** — pnpm
  expands `${VAR}` in both the registry and the auth position — so the file holds no
  secret and is committable. A registry URL carrying its own credentials is refused
  rather than copied through, because that is the one shape that would put a secret
  into a client's repository. The trailing slash GitLab's own troubleshooting
  requires is appended; a blank value, a relative URL, a scheme npm cannot fetch
  from and a URL with a query or a fragment are each refused with the reason.

  **Omitting the flag writes no `.npmrc` at all**, and that is the default on
  purpose: it is what a consumer of the public registry holds, so the path the
  command takes without being told anything is the destination rather than the
  rehearsal.

  The scopes are derived from the reference storefront's own `workspace:` ranges —
  the packages that stop resolving the moment the copy leaves the workspace — so a
  checkout that grows a second scope gets a second registry line in the same run,
  and a storefront declaring no scoped workspace dependency is refused rather than
  handed a file that configures nothing.

  **The scaffolded manifest now declares `packageManager`**, taken from the
  storefront's own manifest if it has one and otherwise from the checkout's root. A
  pnpm lockfile records integrity and no registry; an npm lockfile records a
  `resolved` URL per package. So which one a client wrote decides whether moving
  between registries is one edited line or a regenerated lockfile, and that was
  previously left to their habits. A checkout declaring neither is refused rather
  than given an invented version.

  New exports: `TOKEN_VARIABLE`, `normalizeRegistry`, `npmrcContent`, `authKeys`,
  `installedScopes`, `packageManagerFor`, and `PlanOptions`. `StorefrontPlan` gains
  `registry`, the endpoint the copy installs from or `null` for the public one.
  `planStorefront` takes an optional fourth argument; existing three-argument calls
  are unchanged.

  The command's closing "Next steps" text no longer tells its reader to pack
  tarballs and pin them through `pnpm.overrides`. That was honest while nothing
  under `packages/` was published and became wrong the moment something was — and
  it is printed into a copy the client owns outright, which nobody comes back to
  correct.

### Patch Changes

- 48ccbb1: The check estate gains `check:block-names`.

  `ESTATE` is reconciled against `check-inventory.test.ts` in both directions, so the entry
  is what stops the new rule arriving as a silent skip — the thing the manifest exists
  against. It is classified `scope: 'package'`, `tier: 'B'`, `host: pending('Phase 4')`, with
  three `partial` signals whose subjects are a **pair** of manifests or another package's
  renderer map and which a lone module package therefore cannot supply:
  `duplicate-block-name`, `category-presentation-disagreement` and
  `renderer-without-declaration`. Its subject declaration is `blocks` in the module manifest,
  so a package that declares none is reported `not-applicable` with that sentence rather than
  skipped.

- ee02c59: The per-deployment declaration is `divergence`, and it is an object (D-205).

  `ReducedDeploymentDeclarationSchema` and its `ReducedDeploymentDeclaration` type
  are gone. The entry survives as `OmittedModuleSchema` / `OmittedModule`,
  unchanged in substance — a `moduleId` and a 20–800 character `reason` — and it
  now sits inside `DeploymentDivergenceDeclarationSchema`, which is what a
  deployment's `backend/src/apps/<deployment>/divergence.ts` exports as
  `divergence`.

  Before:

  ```ts
  import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

  export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [
    { moduleId: 'blog', reason: '…' },
  ];
  ```

  After:

  ```ts
  import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

  export const divergence: DeploymentDivergenceDeclaration = {
    omittedModules: [{ moduleId: 'blog', reason: '…' }],
    decorationOrder: {},
    reasons: {},
  };
  ```

  The file is renamed with the export, because _reduced_ encodes a direction two
  of the three new contents do not have: `decorationOrder` declares the wrapping
  order for a registration more than one of a deployment's overlay modules
  decorates, and `reasons` carries one sentence per divergence the platform
  derives, keyed by the derived entry's own key. Both parse today and are read by
  nothing yet — they are supplied and checked by later phases of
  `specs/107-override-report-and-ladder/`.

  Three details a consumer will meet:
  - Every field defaults to empty, so a declaration that leaves one out means
    "none of these" — the reading an absent file already gets.
  - The object is **strict**: a fourth field, or a misspelled one, is refused
    rather than stripped, because a stripped field reads as "this deployment
    declares nothing" for a file whose author wrote a declaration.
  - `@endora-commerce/platform`'s D-101 boot refusal is unchanged in behaviour and
    changed in wording: it names `divergence.ts` and the `omittedModules` inside
    it. `ReducedDeploymentError` keeps its name — all three of its findings are
    about a module set that is genuinely reduced.

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
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
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
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a47dcc8]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [bbf9258]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
