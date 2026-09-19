# @endora-commerce/platform

## 0.12.0

### Minor Changes

- b413e2d: Connector family membership is declared in each module's own manifest and derived by the
  platform, replacing three hand-maintained arrays and the three boolean flags that
  duplicated them.

  ## Breaking: three manifest fields are removed

  _(Declared `minor` rather than `major` per **D-225**: no package leaves `0.x` before the
  move to public npmjs. In a `0.x` series the two carry the identical consumer-facing
  contract — `^0.9.0` excludes `0.10.0` exactly as it excludes `1.0.0` — so `minor` already
  forces the explicit opt-in that is what "breaking" means to a caller. The break is
  described below, which is where it belongs.)_

  `pimConnector`, `invoiceLedger` and `erpConnector` are gone from `ModuleManifestSchema`,
  along with `PIM_CONNECTOR_MODULES`, `INVOICE_LEDGER_MODULES` and `ERP_CONNECTOR_MODULES`.
  A module that declared one replaces it with a single additive line:

  ```ts
  capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],   // 'pim-connector'
  ```

  A capability's **owner** declares it mutually exclusive and mints the refusal code:

  ```ts
  exclusiveCapabilities: [
    { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
  ],
  ```

  The declaration carries membership only, creates no lifecycle edge, and requires no
  dependency on the owner's package — a key is a string literal, on the same terms as an
  error code. That is the point of the change: a connector installed from npm, and a
  per-deployment overlay module, can now join a family, which an array inside
  `@endora-commerce/contracts` could never let them do without editing a file they do not
  own.

  ## Breaking behaviour on upgrade: three PIM connectors become inactive

  **Read this before upgrading if you run Akeneo, Ergonode or Pimcore.**

  `pim_akeneo`, `pim_ergonode` and `pim_pimcore` shipped activated by default. They now ship
  **deactivated**, as every member of a mutually exclusive capability must
  (owner ruling, 2026-09-15).
  - **If you chose explicitly** — you switched the connector on or off on
    `/platform/modules` at any point — a settings row records that choice and **nothing
    changes for you**. The new default applies only where no override exists.
  - **If you never chose**, those three connectors were running on the shipped default and
    will be **off** after this upgrade. Switch the one you use back on at
    `/platform/modules`; the choice is recorded and survives every later upgrade.

  Nothing is deleted. Connections, identity maps, field protections and run history are
  preserved exactly as they were, and come back when the connector is switched on — the
  reversal is two clicks and no data is touched. **No migration writes an activation row**:
  changing a shipped default must not rewrite an operator's recorded choice, and the two
  migration-shaped alternatives were considered and rejected — materialising the effective
  value for everyone would persist three simultaneous exclusive claims attributed to an
  operator who made none, and materialising it only where a connection exists would put a
  read across four connectors' tables inside another module's migration and would pick one
  arbitrarily wherever several qualified.

  **Why the default had to move rather than being tolerated.** Exclusivity is enforced when a
  module is _activated_, so it guards the transition and not the state a deployment starts
  in. Three connectors shipping activated were therefore all active from the first boot, with
  no transition to refuse and nothing to report it — and the one connector that consulted the
  registry was refused activation out of the box, naming a connector the operator had never
  configured. A member of an exclusive capability declaring `default: true` is now refused
  when the platform derives the family, because the activation resolver returns booleans and
  carries no provenance: nothing downstream can tell a recorded choice from a shipped
  default, so a member that ships activated holds a claim nobody made.

  ## Also in this change
  - Exclusivity is **one** seam per family — a single `pre` interceptor on
    `POST /api/v1/admin/modules/:id/activation`, registered by the capability's owner over
    the derived family. It previously lived on one member with that member's id hard-coded,
    which is why only 1 of the 12 ordered pairs of the four PIM connectors was refused; all
    12 are now.
  - Exclusion resolves **effective** module presence — platform availability _and_ operator
    activation. A connector a deployment never installed no longer holds a claim.
  - `pim_akeneo` no longer refuses a connection save because another connector has a
    connection; that path validates its own module's activation and nothing else. The
    refusal an operator meets is the activation one, with the same code and the same
    `{ activeModuleId }` detail.
  - `PimErgonodeConnectorActivityPort` is removed from `@endora-commerce/contracts`: it
    existed so one connector could ask another about its connections, and has no caller.
  - Two keys never exclude each other. One ERP connector, one PIM connector and one
    invoice-ledger vendor may run together, which was always true and is now asserted.

- 0c59e92: An install hook is no longer silenced for ever by a database that booted before it installed

  Boot convergence marks a shipped module `installed` without running its `installHook` — it cannot,
  and D-157.6(b) is why it must not. `install` then short-circuited on that row and answered
  `already-installed`, so on a database whose first action after the migrations was a boot, an install
  hook never ran and never would: no migration, no settings reconcile, no participant pass, no hook,
  and nothing saying so.

  ## What changes

  **A new nullable column, `module_registrations.boot_converged_at`** (migration
  `Migration20260919T101500CoreModuleRegistrationsBootConverged`). The boot reconciler stamps it on
  every row _it_ wrote; it means _"boot convergence wrote this and no install has run"_. The reconciler
  still inserts only and still decides nothing.

  **`install` completes a row it did not write.** The `already-installed` short-circuit now needs
  `state === 'installed'` **and** a null marker. With the marker set the normal body runs and step 4
  clears it, so the second run is the ordinary no-op again. Every step is already safe on a converged
  database: `getPendingMigrations()` returns none so the rollback set is empty, the settings reconcile
  is idempotent, the participants upsert-and-prune, and the hook is idempotent by contract. This makes
  `module:install --all` the command that **repairs** a boot-first database.

  **The convergence stops being silent.** One warning per converged manifest that declares an
  `installHook`, naming `module:install <id>`. A warning and not a refusal: it must not break a first
  boot.

  ## Upgrading

  **No backfill and no action for an already-installed deployment.** The column arrives `null`
  everywhere, which reads as _"an install produced this"_, and that is true of every historical row: no
  version of this package published before 2026-09-19 shipped alongside a module declaring an
  `installHook`, so none can have been skipped. The cost on an installed deployment is one null check
  per `module:install`.

  **One residual.** A database converged _before_ this column existed holds `null`, so a module that
  gains its first `installHook` afterwards is still answered `already-installed` there.
  `module:uninstall <id> && module:install <id>` completes it, and a rebuilt database is unaffected.

  **If you compose the platform yourself**, `ShippedModuleEntry` gains an optional `installHook` field
  and `firstBootInsertPopulation` answers with entries rather than manifests — both source-compatible
  with handing `resolvedManifestEntries()` straight through, which is what every root does.

### Patch Changes

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0

## 0.11.1

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

## 0.11.0

### Minor Changes

- c7b3512: A scaffolded instance now carries a **runnable** development environment, and the operator CLI
  stops printing a command line that resolves to a different program.

  **`@endora-commerce/cli`** — `endora new instance` writes `compose.dev.yml` at the instance
  root: PostgreSQL, Redis, Meilisearch and Mailpit, started with
  `docker compose -f compose.dev.yml up -d --wait` in a tree whose `.env` has never been opened.
  Everything under `deploy/` pulls images the client has not built yet, so those three services
  were theirs to provision by hand. The new file is rendered from the **same** service catalogue
  the production examples are rendered from, so no second statement of what Endora needs to run
  enters a client's tree. Two new exports on `new-instance/deploy.js`: `developmentComposeFile`
  and `undefaultedExpansions`, plus `DEV_COMPOSE_PATH`.

  **`@endora-commerce/platform`** — `./cli` replaces the `CLI_USAGE` constant with
  `cliUsage(program?)` and `DEFAULT_CLI_PROGRAM`, and `dispatchCli`/`runCli` take a `program`
  option. The constant opened `usage: endora <module id> <command>`, and in a scaffolded instance
  `endora` on the path is the scaffolder — a different program, with no `demo` verb and no
  `<module id>` positional. The default is now `pnpm run cli`, which is what an instance's own
  next-steps block prints. `demoHelpFor(verb, program?)` takes the same parameter.

- c9a64de: `@endora-commerce/platform/lifecycle` carries `runInstanceOperatorCommand` and
  no longer carries `instanceOperatorRuntime`, `instanceManifestEntries` or
  `InstanceOperatorRuntimeOptions`.

  The one an instance imports is `runInstanceOperatorCommand`, which is what the
  `backend/src/module-commands/runtime.ts` that `endora new instance` renders
  calls, and it is unchanged. The other three were published in the same release
  and no consumer outside the platform ever named one: they remain exported from
  `lifecycle/commands/operator-entry.js` for the platform's own use, and a merge
  request that gives one of them a consumer out here puts it back on the barrel in
  the same breath. A client who imported one directly — nobody does, the symbols
  are one release old — takes `runInstanceOperatorCommand` instead, which builds
  the runtime, runs the body under a system scope, disposes and exits.

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

- Updated dependencies [0eeb9b5]
  - @endora-commerce/contracts@0.11.0

## 0.10.0

### Minor Changes

- 08dcbd9: An instance's five `module:*` entry points share a fourteen-line `runtime.ts`
  instead of a ninety-line one. `instanceOperatorRuntime` and
  `runInstanceOperatorCommand` are new on `@endora-commerce/platform/lifecycle`
  and hold the manifest resolution, the lazily opened `MikroORM` + `Redis` and
  the system scope that `endora new instance` used to render into a client's
  tree; the instance supplies the directory holding `apps/` and its own
  `mikro-orm.config.js`, and nothing else. `instanceManifestEntries` is exported
  with them and `cli/dispatch.ts` now reads it instead of carrying a second copy
  of the same three suppliers.

  R1.4's wiring budget goes from 248 lines over thirteen files to 176, which is
  what takes A14 of the instance acceptance criterion under the 250-line bound in
  `registry` mode, where the `.npmrc` puts eleven more lines in the count.

### Patch Changes

- Updated dependencies [5bfefe0]
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

- e6f053a: An overlay module is a whole lifecycle participant, a wrapped `asValue` no longer kills the boot,
  and the divergence report attributes the deployment's own registrations.

  **`@endora-commerce/platform`**
  - `composeApp`'s default composition — the one an instance takes, having no generated manifest
    index — resolves overlay module **manifests** from the same root it composes overlay module
    **entries** from. It passed `overlay: async () => []` to `resolveManifestEntries`, so a
    deployment's overlay module reached the container, the permission gate and the presence
    projection and never `lifecycleManifestRegistry`: no `module_registrations` row from the boot
    reconcile, no activation Setting, and nothing for an operator to switch it off against. Both
    seams now come off one `overlayModulesUnder(root, claims)` reader, so the id-collision claim set
    is asserted once over one array.
  - `ctx.di.decorate` over a registration awilix marks leak-safe and gives no lifetime — which is
    exactly `asValue`, and exactly what a composition root's `registerValues` produces for
    `commandBus`, `auditLogService`, `eventBus` and `emFactory` — registers the wrapper
    `.singleton()` instead of asserting TRANSIENT. Wrapping any of those names used to boot until
    the first singleton resolved it and then throw `AwilixResolutionError: … has a shorter lifetime
than its ancestor`, which made D-156.4 a ruling sanctioning an operation that could not be
    performed. Every other inner resolver keeps the lifetime it had, and a wrap reaching for a
    genuinely scoped registration still throws.

  **`@endora-commerce/cli`**
  - `endora generate`'s owner map now includes the container names the deployment's own overlay
    modules register, merged per deployment and keyed from each source's own module id. A client
    decorating a name their own overlay module registered was attributed to nobody and drew an
    `unowned-subject` finding whose remedy text — "Composition throws for it at boot" — was untrue
    of a tree that had booted.
  - `endora generate` evaluates the report's refusals and exits 2 on one, instead of rendering a
    report over inputs it could not read.
  - A seam call in an overlay module written in JavaScript, or in TypeScript with no `ModuleContext`
    annotation, is read: the first parameter of an exported `registerModule` is a context receiver,
    which is the loader's own contract rather than a naming convention. Such a client used to get a
    clean report over a tree full of decorations.
  - A new refusal: a rendering that both lists `registration:<module>:<name>` and reports
    `unowned-subject` for `<name>` is refused rather than printed.

- 6bd9ae9: A scaffolded instance runs the operator commands its modules declare, and can create the
  administrator that logs in to it (`specs/123-oss-install-experience/` G2).

  **The defect.** `endora new instance` reported `backend/src/cli.ts` as an omission, on the written
  reason _"the demo layer around it is exported under no subpath"_. A client's instance therefore had
  **no module-declared CLI command at all** — no `admin_users create`, no `search reindex`, no
  `_i18n reload` — so the admin bundle acceptance assertions A5 and A13 prove is built and styled had
  nobody to log in as. Half of that reason had already been discharged: `./demo` has been a declared
  subpath since `specs/110-instance-repository/` T119b. What was still unpublished was
  `backend/src/cli/demo-command.ts`, which `test/unit/kernel/host-residue-partition.test.ts` had
  ledgered as platform-shaped residue with a `retiredBy` naming exactly this move.

  **`@endora-commerce/platform`** gains the dispatch on the subpath that already carried half of it.
  `./cli` adds `runCli`, `dispatchCli`, `cliFailureExitCode` and `CLI_USAGE`; `./demo` adds
  `DEMO_HOST_COMMANDS`, `demoEntriesFrom`, `isDemoInvocation`, `parseDemoVerb`, `demoHelpFor`,
  `formatHostCommandList`, `ShadowedHostCommandError`, `NO_DEMO_COMPOSITION_NOTICE` and the
  `DemoCompositionLoader` shape. **No subpath is added and `PUBLISHED_SUBPATHS` stays at five** — both
  are host-internal under D-160.14, a module naming either is still `host-internal-subpath`, and
  `check:platform-surface` is green with no ledger key moved.

  What did **not** move is what names a path in the tree that installs the platform, which is
  `operator-half.md` §1.1's whole partition: a build's generated core index, its own `composeApp`, its
  demo-composition probe and the one directory holding `apps/`. All four are parameters of `runCli`
  with defaults an instance can take, so this repository's `backend/src/cli.ts` supplies four of them
  and a scaffolded instance's supplies one and is five lines.

  **`@endora-commerce/cli`** writes `backend/src/cli.ts` — six lines, `kind: 'wiring'` — and the
  `omitted.push` block is deleted rather than reworded, because an omission whose reason has been
  discharged must not survive as prose. The instance's manifests gain `cli` (the generic pass-through:
  any installed module's declared command is addressable with no file in the tree edited) and, derived
  from the resolved module set rather than written, `admin:create` when `admin_users` is installed.
  `nextSteps()` gains the administrator step after `module:install --all` and the demo step its own
  docstring has claimed was there since D-216.

  **No `demo:seed` or `demo:reset` script is written**, and G2's T2-D asked for both. D-216 is the
  owner's and is more specific than the task: _"a client scaffolding an instance for their own trading
  receives no demo artefact in a tree they own: no composition, **no script**, no example and no
  placeholder"_ — and it names where the capability does belong, which is the next-steps block.
  `pnpm run cli demo seed` reaches both verbs, so nothing is unavailable.

  Proved end to end rather than at plan level. On a scaffolded instance installed from tarballs into
  `os.tmpdir()`, with no checkout of this repository anywhere and no symlink back:
  `pnpm run cli --list` enumerates the six commands its installed modules declare plus the two host
  demo verbs, `pnpm run admin:create` exits 0, and the row lands in `admin_users` with an argon2id
  hash, `status=active` and a `platform_admin` role holding `["*"]`. **A15 is added to the instance
  acceptance criterion and is green** — `POST /api/v1/auth/admin/login` answers 200 with the admin
  session cookie set. It needed this change _and_ `fix/instance-500-pipeline`, which landed the same
  day, and it is the only assertion that measures their conjunction. Re-measured once more after
  feature 121 merged, the criterion reads `pass=11 fail=0 unmeasured=4 of 15` — no red at all. A15
  also corrects a premise
  three documents carry: the route is `/api/v1/auth/admin/login`, and `/api/v1/admin/auth/login`,
  which `research.md` §4.3/§4.4 and A4's own reason all name, is registered by nothing.

  Wiring cost, re-measured rather than computed from a delta: **237** lines over 12 files on the
  plan without the admin member, and **248 over 13 files on the created tree** with it, against
  R1.4's bound of 250 — two lines of headroom left.

- bd596a9: The sales-channel bridge tables are declared by the modules that own them, not by the platform.

  **`@endora-commerce/platform`** — `SalesChannelMembershipService` no longer holds a map total over
  `ChannelMemberEntityTypeSchema`. It resolves `{ table, entityIdColumn }` through a new
  `ChannelBridgeRegistry`, which each owning module fills at compose time, and a composition root
  contributes as the container name `salesChannelBridgeRegistry`. `composeSalesChannelsKernel` takes
  an optional `bridgeRegistry` and returns the one it used on `SalesChannelsKernel.bridgeRegistry`.

  For a consumer the visible change is at the call site: a membership call for an entity type **no
  installed module registered** now refuses with `503 MODULE_DISABLED`, naming the entity type in
  `error.details`, **before** it reaches the database. It previously executed SQL against the table
  the map named, which on an instance that never installed the owning module is a relation that does
  not exist — inside whatever transaction the caller had already opened. `ChannelMemberEntityType`
  is unchanged and stays the published vocabulary; the registry decides which of its members are
  live.

  `SalesChannelMembershipService`'s constructor takes the registry as an optional fourth argument,
  defaulting to the process-level one, so an existing construction site compiles and runs unchanged.

  **The module packages** — each now exports `salesChannelBridges`, the bridge or bridges it owns,
  from its `./backend` subpath, and registers them from a boot hook. `catalog` owns two (`product`
  and `category`); the other seven own one each. The registration is a contribution and carries no
  presence probe: the rows outlive an operator switching the module off, so the bridge stays
  readable, exactly as the asset-reference and language-reference registries state for their own
  contributions.

  **`@endora-commerce/mod-sales-channels`** — `SalesChannelsService` held a second copy of the same
  nine triples, read by the channel-delete sweep, justified by a circular import that had not existed
  since the membership service moved into the kernel. It is gone; the service takes the registry as a
  new required constructor argument, in fifth position, and the delete sweep iterates the bridges
  that are actually registered — so a channel can be deleted on an instance that never installed
  `cms`.

- def780b: A contribution to a registry that was never registered is dropped.

  A module resolving a container name that **its own manifest declares as a `contributes-to`
  edge** now receives an inert sink when nothing in the composition registers that name,
  instead of an `AwilixResolutionError`. Every method on the sink is a no-op returning
  `undefined`. New host-internal exports on `kernel/contribution-sinks.ts`:
  `provideDeclaredContributions`, `isDeclaredContribution`, `DROPPED_CONTRIBUTION_SINK` and
  the `DeclaredContribution` type; `installGatingGraph` and `provideDefaultGatingManifests`
  supply the declaration set, so a consumer that already establishes manifests wires nothing.

  Why a consumer cares: a module's `dependencies` guarantee the owner is installed, and
  `nonBindingDependencies` deliberately withdraws that guarantee — which is the whole reason
  `contributes-to` exists, since declaring the dependency would make an optional module
  undeactivatable for as long as a non-deactivatable one is present. An instance that installs
  a contributor without the owner is therefore a supported state, and until now the eager read
  in the contributor's boot hook exited the process before it served a request. A contributor
  needs no change and learns nothing: it pushes without knowing whether the registry is here.

  It is deliberately narrow, and the narrowness is the whole safety argument. The drop is not
  "an unregistered name resolves to something" — that would turn every typo and every missing
  dependency into a silent `undefined`. It fires only when the reading module's own manifest
  declares that exact name as `contributes-to`, nothing in the composition registers it, and a
  manifest set has been supplied at all. A process that established no manifests keeps the
  previous behaviour.

  The bound, stated rather than discovered: this covers `contributes-to` and not
  `degrades-without`. A contribution is a push, so nothing observes the result and dropping it
  is the declared outcome. A `degrades-without` read is a pull whose declaration promises a
  _degrade_ — a different branch, not a silent no-op — and answering `undefined` from a
  registry's `get` is indistinguishable from "no entry for this code", which is a fail-open.

- 8e86e55: Eleven container names a module read and nothing defaulted are now defaulted by
  the module that reads them, so a composition that contributes nothing can
  resolve every one of them.

  `@endora-commerce/platform` — `composeApp` registers two more names:
  `customerOrganizationIdResolver`, the tenth actor-shaped name, whose value
  expression reads `request.actor` and nothing else; and `newsletterTokenSecret`,
  the resolved `NEWSLETTER_TOKEN_SECRET`.

  `@endora-commerce/mod-newsletter` — `newsletterModule`'s `defaultChannelId`
  option becomes `resolveDefaultChannelId: () => Promise<string | null>`. A
  consumer composing the module through `registerModule` is unaffected; a consumer
  calling `newsletterModule` directly passes `async () => null` where it passed
  `null`. The `NewsletterBridge` interface is removed — the module reads its nine
  members itself.

  `mod-catalog`, `mod-customers`, `mod-ksef`, `mod-orders`, `mod-quote-requests` —
  each registers the names it reads. No published shape changes; a composition
  that contributes one of them still overrides the default, which is what the
  contribution window is for.

  `mod-catalog`, `mod-customers` and `mod-orders` declare new manifest edges for
  ports they now resolve themselves: `catalog` -> `search:searchReindexPort`,
  `customers` -> `admin_roles`, `orders` -> `admin_users` and `admin_roles`. Every
  one of those owners declares `activation.nonDeactivatable`, so no operator loses
  an activation control.

- 2fe0b8d: Each sales-channel bridge table is now created by the module that owns its far side.

  Under D-226 a bridge between an always-present near side and a switchable far side belongs to the
  far side. All nine `sales_channel_*` tables move accordingly, so an instance that does not install
  `cms` no longer carries a migration corpus naming `cms_pages`.

  **Nothing is re-offered to a database you have already migrated, and no reset is required.**
  `mikro_orm_migrations` stores the migration class **name** and no checksum — measured on
  `@mikro-orm/migrations@6.6.13`: `MigrationStorage.ensureTable()` builds `id`, `name` and
  `executed_at`, `logMigration` inserts `{ name }`, and `getPendingMigrations()` is `umzug.pending()`
  over those names. No class is renamed and no stamp moves, so the two edited bodies are not pending
  anywhere.

  **`@endora-commerce/platform`** — two frozen migrations lose statements and keep their class names.
  `Migration20260430T170044CoreSalesChannelsPromote` loses eight `create table "sales_channel_*"`
  statements with their indexes from `up()` and the matching eight `drop table` from `down()`;
  `Migration20260424T165847CoreFoundationInit` loses `create table "sales_channel_products"`, its
  index and its `drop table`. Everything those migrations do to a kernel table is untouched — the
  channel identity columns, the backfills, the one-system-default partial unique index and the
  `quote_requests.sales_channel_id` column all stay exactly where they were. `BASELINE_MIGRATIONS` is
  byte-identical, so no position in the frozen prefix moves.

  **Each far-side module** gains one migration (`@endora-commerce/mod-catalog` gains two, for
  `sales_channel_products` and `sales_channel_categories`). Each is a `create table if not exists`
  carrying the frozen statement's own column list, primary key, both foreign keys and index, plus a
  `create index if not exists`, and each drops its own table in `down()`. On a database that has
  applied the frozen migrations every one of them is a no-op: measured on a throwaway database
  migrated at the previous release and then upgraded, all nine relations keep their `pg_class` OID,
  so no table is recreated and no row is touched. On a fresh database they are the creation, later in
  the computed order than before — which is where they have to be for an instance that omits one of
  these modules to migrate at all.

  **One behaviour changes on purpose.** A hard uninstall reverts by registry `moduleId`, so
  `module:uninstall --hard cms` now drops `sales_channel_cms_pages` along with the rest of that
  module's schema. That is the ownership rule doing what it says, and it is what an operator would
  expect of a table whose far side has just been removed.

  The published `ChannelMemberEntityTypeSchema` vocabulary is unchanged, and no wire shape moves.

### Patch Changes

- 6c8d958: Eight migration statements move to the module whose dependency closure guarantees the table they
  name (D-226, `specs/120-migration-closure-bridge-ownership/` Phase 3).

  A migration may name a table only if its own module creates it, a module in its transitive manifest
  `dependencies` closure creates it, or the platform creates it. Where that did not hold, an instance
  that omitted the creating module could not migrate a fresh database at all — the failure this rule
  was ruled from was `relation "cms_pages" does not exist`.

  **No class is renamed and no stamp moves.** `mikro_orm_migrations` persists the migration class name
  and holds no checksum (measured on `@mikro-orm/migrations@6.6.13`), so a database that has applied
  one of the reduced bodies is offered nothing from it. What an upgrading consumer receives is the
  five new migrations below, each written idempotently, each a no-op against a database that already
  has the object and the real change against a fresh one. Measured on a database migrated at the
  previous revision: exactly five pending, every table's `pg_class` OID unchanged after applying
  them, and the resulting schema byte-identical to the previous revision's fresh schema.

  **`@endora-commerce/platform`** — two frozen bodies lose statements they could never have been
  ordered for, the platform declaring no dependencies and so never being orderable after a module's
  table. `Migration20260430T170044CoreSalesChannelsPromote` no longer adds `quote_requests.sales_channel_id`,
  its foreign key or its index. `Migration20260717T134752CoreTenantScopeIndexes` is now **empty** —
  all three of its indexes were on module-owned tables — and the class stays, because its name is on
  `BASELINE_MIGRATIONS` and removing it would move seventy frozen positions.

  **`@endora-commerce/mod-quote-requests`** — new `Migration20260912T125614QuoteRequestsQuoteRequestChannelAttribution`:
  the `sales_channel_id` column, its `ON DELETE RESTRICT` foreign key and its index, `add column if not exists`
  with the constraint add guarded by a `pg_constraint` probe. The column is still NULLABLE.

  **`@endora-commerce/mod-analytics`** — new `Migration20260912T125655AnalyticsEventsTenantScopeIndexes`:
  the two tenant-key indexes on `analytics_events`, verbatim and `if not exists`.

  **`@endora-commerce/mod-newsletter`** — new `Migration20260912T125702NewsletterSubscriberTenantScopeIndex`:
  the tenant-key index on `newsletter_subscribers.customer_account_id`, verbatim and `if not exists`.

  **`@endora-commerce/mod-cms`** — new `Migration20260912T125709CmsPageBodyAssetRefIndex`: the GIN
  index on `cms_pages.body`. It exists for `assets_library`' reference-protection scan and now lives
  with the table it is on; `cms` declares `assets_library` and not the other way round, so this is the
  only direction in which the closure holds.

  **`@endora-commerce/mod-assets-library`** — `Migration20260505T102206AssetsLibraryInit` no longer
  creates that index. An instance installing this package without `cms` no longer carries a migration
  that indexes a table nothing builds.

  **`@endora-commerce/mod-inventory`** — new `Migration20260912T125716InventoryOrganizationWarehouses`:
  the `organization_warehouses` bridge, `create table if not exists`, verbatim columns, primary key and
  both foreign keys. This is D-226's bridge rule one namespace over — an always-present near side
  (`organizations`) and a switchable far side — and it has a visible consequence:
  `module:uninstall --hard inventory` now reverts this table, a hard uninstall reverting by registry
  module id.

  **`@endora-commerce/mod-organizations`** — `Migration20260611T140349OrganizationsConsolidation` no
  longer creates `organization_warehouses`. Its `warehouses` foreign key named a table this module
  neither owns nor declares, and could not declare: `inventory` already declares `organizations`.

- 30430d1: `composeApp` establishes the system-default sales channel itself, so an instance stops answering
  `500 INTERNAL` to every request.

  Every request on a scaffolded instance answered `500 INTERNAL` with **nothing logged** —
  `/api/v1/_openapi.json` included, a route that touches no module and no database. The underlying
  error was `NoSystemDefaultChannel`, thrown by `SalesChannelResolverService.getSystemDefault()`
  inside the global `onRequest` hook `registerSalesChannelResolverMiddleware` installs. That hook
  runs for every `/api/v1/*` path except `/api/v1/_health`, which is why the health route was the
  only one answering anything else.

  The boot-time default-channel reconciliation stood in the **reference deployment's** contribution
  callback, not in `composeApp`. An instance supplies no contribution callback
  (`contracts/instance-repository.md` R2.4), so it never ran, and the `sales_channels` table of a
  freshly migrated instance stayed empty. `composeApp` now runs `DefaultChannelReconciler` itself,
  before `composeModules`, so every root that mounts the resolver also guarantees the row the
  resolver falls back to. A deployment that ran its own is unaffected: the reconciler is idempotent
  and answers `no_change` when the flag is already held.

  **A 5xx `HttpError` is now logged.** `registerErrorEnvelope`'s `HttpError` branch returned before
  the `request.log.error` at the bottom of the handler, so a server fault raised as an `HttpError`
  — `NoSystemDefaultChannel`, and every `HttpError(500, …)` a module throws — answered in complete
  silence. Faults with `statusCode >= 500` now emit one `error`-level line carrying the error, the
  status and the code; 4xx stays silent, because that is the client saying something wrong and its
  own envelope already says what. Consumers filtering their logs at `error` will see lines they did
  not see before, and each one is a fault that was already happening.

- 97f9233: No published surface changes. The changeset records that
  `check:port-dependencies` gained a third composition's question
  (`instance-unsupplied`): a container name a module reads that no module
  registers, no kernel source supplies, and `composeApp` does not register
  either. It lands at zero.
- ee80d6b: `overlay/index.ts`' header no longer says the divergence renderer stays beside the two
  committed renderings it produces. It moved to `@endora-commerce/cli` with the derivation that
  feeds it: the report has a second host — a client's instance renders one over its own `apps/`
  tree — and a build-time renderer has no runtime reader that would justify a package every
  instance loads at boot carrying it. No exported value or type changes.
- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- eb01958: Every URL `assets_library` produces is absolute, and the module resolves the public API
  origin itself (owner ruling **D-223**).

  **What an upgrader sees.** `AssetDetail.url`, `AssetSummary.url`,
  `getAssetUrlResponse.url`, a CMS embed's `url` and a product feed's image URL all carry an
  origin now. On a deployment that never set `assets.local.public_url_base` — the shipped
  default, blank — the same asset used to answer `/assets/file/<id>`:

  ```diff
  -{ "url": "/assets/file/2b1c…" }
  +{ "url": "https://api.example.com/assets/file/2b1c…" }
  ```

  Nothing breaks on the day this lands: both frontend helpers (`toAbsoluteAssetUrl` in the
  storefront and in `@endora-commerce/admin-kit`) pass an absolute URL through untouched, and
  `absolutizeMediaUrl` in `@endora-commerce/cms-components` does the same. What does change is
  any consumer that **compares** or **stores** the string — a test asserting
  `'/assets/file/…'`, a cache key, a stored HTML body diffed against a fresh render. It is a
  `major` for that reason and not because a signature moved.

  **The precedence, which an operator may rely on.** A configured base still wins:
  `assets.local.public_url_base`, `assets.s3.public_base_url` and `assets.gcs.public_base_url`
  are unchanged in meaning. Blank now means _this deployment's public API origin_ for
  local-FS, and still means _the bucket's own origin_ for S3 and GCS — pointing a bucket
  object at the API host would name a host that does not serve those bytes. A configured base
  written as a path (`/media`) is rebased onto the API origin rather than left relative.

  **Two required options** — a module composed by the kernel gets them from
  `registerModule`, so this is only a break for a caller constructing the module by hand:
  `assetsLibraryModule({ publicApiBaseUrl })` and `new AdapterRegistry({ publicApiBaseUrl })`,
  plus `publicApiBaseUrl` on each adapter's own options. Required rather than optional
  deliberately: an omitted origin is not a failure, it is a host-relative URL inside an
  e-mail, a push payload and a partner's feed.

  `legacyAssetResolver` (the `storage_backend='legacy'` resolver) is now the factory
  `createLegacyAssetResolver(publicApiBaseUrl)`. It still serves a stored absolute URL
  verbatim; a stored host-relative one is rebased.

  **`@endora-commerce/platform`**: `absolutizePublicUrl` is no longer exported from
  `@endora-commerce/platform/composition`. It existed for the two composition-root sites that
  rebased an asset URL, and those are gone — a consumer that rebases a URL the module already
  made absolute is a consumer that can disagree with it. The declaration is untouched in
  `kernel/public-api-base-url.ts` and returns to the barrel the day an application needs one.
  `./composition` is a host-internal subpath, so no module could name it.

- a6a9d30: `composeApp` is the platform's, and it takes a deployment's contributions as a callback.

  `@endora-commerce/platform/composition` gains `composeApp`, `ComposeAppOptions`,
  `ComposeAppHandle` and `ComposedAppContext`. It performs the whole assembly a deployment used
  to write out — refuse a boot with no `PUBLIC_API_BASE_URL`, open the ORM, build the container,
  register the host values, load module presence, compose the settings and sales-channel kernels,
  run `composeModules` once, open the contribution window once, install the request-scope hook,
  reconcile the settings manifests, run the boot phase once, assemble the error envelope — and
  returns a handle you pass straight to `buildServer`.

  Everything a deployment cannot share reaches it through options, and every one of them is
  optional:

  ```ts
  const composition = await composeApp({ deploymentRoot });
  ```

  is a complete composition of whatever module packages are installed. Supply
  `composition.modules` / `composition.manifests` / `composition.orm` when your build has
  compiled-in modules and committed registries, `contribute` for values only your deployment can
  supply, `values` for host names no module defaults, `buildTenantContext` for the actor mapping,
  `plugins` / `scopedPlugins` for route plugins on either side of the request scope, and
  `decorationOrder` / `declaredOmissions` for what your deployment's `divergence.ts` declares.
  Omitting `composition` entirely means "no compiled-in half", which is what an instance is: its
  modules, entities and migrations are the packages it installed.

  `contribute` runs **after** the twenty contributions the platform makes itself, so a deployment
  can still overwrite one; it runs inside the single contribution window (D-45, issue #52), so a
  contribution made after the boot phase has started still throws `ContributionWindowClosedError`.

  `AppComposition` and `AppOrmLifecycle` are exported from the module but deliberately not from
  the barrel: a caller builds those object literals without naming either type.

  `endora new instance` renders `composeApp({ deploymentRoot })` in the backend member's
  `index.ts` and `worker.ts`, with `deploymentRoot` derived from the entry point's own location —
  and renders no contribute callback, because a client's tree holds no composition root.

- 016524f: Retire the two module-package **value** imports the production composition root
  still held.

  `backend/src/composition.ts` names a module package 23 times over 21 packages.
  Nineteen of those packages are reached type-only; two were reached by value, and
  a value import does not retire by moving a type. That matters because
  `specs/110-instance-repository/` T118 moves this root's contribution wiring, ORM
  boot, request-scope hook, error-envelope options and tenant-context resolution
  into `@endora-commerce/platform`, **where a platform file may not import a
  module** (D-52, D-53). Each of the two needed a seam of its own, and they did not
  want the same one.

  **`@endora-commerce/mod-auth` — a port.** `promoteAdminActor` is no longer
  exported from `./backend`. The implementation has not moved and must not: `auth`
  reads it itself from `require-admin.ts`, and promotion is about `request.actor`
  and `request.adminActor`, two decorations this module's plugin applies. It is
  registered instead under the container name `promoteAdminActor`, which is the
  step the old export's own doc block and
  `test/contract/kernel/harness-parity.test.ts` both recorded as open — _"actor
  promotion published as a port, resolved from the container"_.

  ```diff
  -import { promoteAdminActor } from '@endora-commerce/mod-auth/backend';
  -promoteAdminActor(request);
  +import type { AdminActorPromotion } from '@endora-commerce/platform/kernel/ports/require-admin.js';
  +// resolved from the container, never captured — the gate is transient
  +const promote = container.cradle.promoteAdminActor as AdminActorPromotion;
  +promote(request);
  ```

  The module gains two things. The port, above. And **the actor types**, published
  as `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey`,
  because retiring the value import took something nobody had noticed it was
  carrying: `plugin.ts` holds a `declare module 'fastify'` block adding `actor` and
  `adminActor` to `FastifyRequest`, an ambient augmentation reaches a consumer only
  if the declaring file is in that consumer's program, and the value import was the
  only thing putting it there. Thirty reads of `request.actor` stopped compiling
  the moment it went. A consumer that reads `request.actor` now writes a
  **type-only** import from `./backend` and the augmentation travels with it.

  **`@endora-commerce/mod-i18n` — a relocation, and a port was structurally
  unavailable.** `buildErrorTranslationTargets`, `describeErrorCodeCollisions` and
  their five shapes are gone from `./backend`; they are
  `@endora-commerce/platform`'s now, at `kernel/i18n/error-translation.ts`, beside
  `request-language.ts` — the producer of the other `ErrorEnvelopeOptions` member a
  composition root injects.

  ```diff
  -import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +// the platform's; no published subpath carries it, and no module calls it
  ```

  The line it moved across is _the routing is derived from manifests, the
  translation is a service_. `I18nService.translate` — what the envelope's
  `translateErrorMessage` closure calls — stays here and is unchanged. The
  derivation translated nothing: it read `manifest.errorCodes` off the resolved
  manifest set, which is a composition-root input, and it had **no consumer inside
  this package at all** — the barrel re-exported it and nothing here called it,
  which is T040b's criterion 8, the test `absolutizePublicUrl` moved out of `email`
  under. A port was not a design choice rejected on taste: the production root
  calls this _before_ `composeModules`, so there is no container to resolve one
  from, and moving the call after composition would move the collision warning with
  it — a diagnostic logged where it is so that an operator reads it before the
  first request that renders wrong.

  The aggregate return type is renamed `ErrorTranslationRouting`.
  `http/error-envelope.ts` declares an `ErrorTranslationTargets` of its own — the
  record this one's `targets` member is assigned to — and two types of one name in
  one package, one being the input to the other's consumer, is a confusion with a
  real cost. Nothing outside the package named the aggregate.

  **`@endora-commerce/platform`** gains both targets and publishes neither on a
  barrel: no module calls the derivation and no module resolves the promotion port,
  so `specs/080-f4-real-scope/contracts/host-package.md` §1.3 classifies both
  _unreached_, and putting a host-only name into the module-facing contract is what
  that classification exists to prevent. `AdminActorPromotion` sits in
  `kernel/ports/require-admin.ts` beside `RequireAdminFactory` and
  `RequireCustomerGuard`, which is where a Fastify-shaped port type lives —
  `@endora-commerce/contracts` declares no dependency on Fastify.

  Behaviour is unchanged. `composition.ts` computes the same map at the same point
  in the boot, logs the same collision warning, and promotes the same actor in the
  same closure; the existing composition, error-envelope and harness-parity tests
  are the assertion and none of them moved.

- fb2659a: `DemoComposition` gains an optional **foundation** phase: `applyFoundation()` runs before the
  first module's `seed`, and `withdrawFoundation()` after the last module's `reset`.

  ```ts
  const composition: DemoComposition = {
    applyFoundation: async () => ({ applied: ['the shop’s sales channels'], skipped: [] }),
    apply: async () => ({ applied: ['products joined to the channel'], skipped: [] }),
    withdraw: async () => ({ applied: ['products joined to the channel'], skipped: [] }),
    withdrawFoundation: async () => ({ applied: ['the shop’s sales channels'], skipped: [] }),
  };
  ```

  **Both methods are optional and a composition that declares neither is unchanged**, including
  the shape of the report `formatDemoReport` produces — so no caller has to do anything.

  Reach for it only for a row a module's own demo body **reads** and no module may own. The single
  after-the-modules position `apply` occupies is right for wiring, which needs both sides to
  exist, and wrong for a precondition: a module whose body enumerates sales channels and places a
  warehouse against each cannot see a channel the composition creates afterwards, and loses the
  assignment with nothing failing. A step placed in the foundation to avoid thinking about
  ordering is a step that will read an empty table.

  The withdrawal's position is forced rather than symmetric for its own sake. Taking the
  foundation away _before_ the modules' own `reset` deletes rows those modules' rows reference and
  removes them through the database's cascade instead of through the module that owns them.

  `DemoCompositionResult` also gains an optional `credentials`, merged into `DemoRunResult.
credentials` and printed by `formatDemoReport` alongside the modules' own. A composition creates
  accounts a module cannot — a tenant-scoped buyer whose `organization_id` is `NOT NULL` is
  created by the composition and by nothing else — and until now nothing could print its sign-in.

  `SEED_SCOPE_REASON` is **removed** from `@endora-commerce/platform/composition`. It was the scope
  reason of a legacy developer seed script; use `DEMO_SEED_SCOPE_REASON` or
  `DEMO_RESET_SCOPE_REASON`, which name the two commands that exist.

- 7e80824: The demo runner now resolves `demo.package`, the escape hatch a module takes when its demo data
  would be too heavy to ship in the module itself.

  Declaring the field used to record an intent and change nothing. It now answers three ways, and
  the second and third are deliberately not the same answer:

  |                               |                                                                                        |
  | ----------------------------- | -------------------------------------------------------------------------------------- |
  | resolvable, loads             | the module's demo data is the package's                                                |
  | **not resolvable**            | reported by name as _not installed_; the module contributes nothing; the run continues |
  | resolvable, **fails to load** | a failure, reported as one, naming the module                                          |

  The probe happens **before** the import and by a different mechanism — `require.resolve`, which
  answers without evaluating — so a demo package that is installed and broken cannot be reported as
  an absent one. A single `try { await import(name) } catch { … }` around both would collapse those
  two rows into one and continue quietly on a package that is there and does not work.

  **A demo package exports `demo`**: an object with a `summary` string and `seed` and `reset`
  functions. When it loads it replaces the module's declared `summary`, `seed` and `reset` — it has
  to, because the module's own sources may not name the package, so a declared body could not reach
  the data. `after` is not read from the package: ordering is decided from the declarations before
  anything is loaded. A package that loads and carries no such export is a `DemoPackageShapeError`
  naming the field to fix, rather than a `TypeError` from the first call.

  New exports: `createDemoPackageResolver`, `demoBodyFromPackage`, `DemoPackageShapeError`,
  `DemoPackageResolver`, `DemoPackageSkip`, `DemoRunSkip`.

  `RunDemoInput` gains an optional `demoPackages`. It defaults to Node's own resolution from
  `process.cwd()`, which for `endora demo seed` is the instance root — never the platform's own
  `node_modules`, where a client's demo package is not and must not be. Pass your own if you run
  from somewhere else.

  `DemoRunResult.skipped` widens from `DemoPlanSkip[]` to `DemoRunSkip[]`, which adds one member
  carrying `reason: 'demo-package-not-installed'` and the package's name. `formatDemoReport` prints
  the two reasons apart, because they ask an operator for different things: switch a module on, or
  install a package.

- e1748da: `@endora-commerce/platform/overlay` gains four functions that take the deployment root as a
  parameter: `selectedDeployment`, `overlayModulesRootFor`, `deploymentsOnDisk` and
  `activeOverlayModulesRoot`.

  The deployment root is the directory that holds `apps/`. It is now **supplied** rather than
  derived: nothing under `packages/platform/` works it out from its own `import.meta.url`, because
  in an instance the platform came out of `node_modules` and `apps/` is a sibling of the backend
  member, so any root the package could derive names a directory holding no deployment at all.

  ```diff
  -// The application computed all four itself, from one `import.meta.url`.
  -const root = activeOverlayModulesRoot(process.env);
  +import { activeOverlayModulesRoot } from '@endora-commerce/platform/overlay';
  +
  +// One expression the application still owns, handed in.
  +const deploymentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  +const root = activeOverlayModulesRoot(deploymentRoot, process.env);
  ```

  `selectedDeployment(env)` reads `DEPLOYMENT` and names no path, so its signature is unchanged.
  The other three take the root **first**, before their existing arguments.

  `./overlay` is host-internal (D-160.14): declared by the `exports` map, carried by no published
  barrel, and named by no module. A module reaching for it is a `host-internal-subpath` finding.

- fd7db00: Added the environment-input declaration, and the four-tier input resolution every
  scaffolding command now shares.

  **`@endora-commerce/contracts`** publishes the shape:
  `EnvironmentInput`, `EnvironmentInputSchema`, `EnvironmentInputsSchema`,
  `EnvironmentConsumer` / `ENVIRONMENT_CONSUMERS`, `EnvironmentRequirement`,
  `EnvironmentInputOwner`, `LocalizedSentence`, and three predicates —
  `isReadByAnyOf`, `scopeToMembers` and `isRequiredGiven`. One entry per environment
  variable a running platform reads: what it configures, in both shipped languages;
  whether it is `required`, `requiredWhen` another input holds a value, or `optional`
  with a sentence saying **what is lost**; whether it is a secret; whether a command
  may generate it; who owns it; and which trees read it.

  There is deliberately **no `default` field**. A declaration that could carry one
  would become another home for an invented value, which is what the provenance line
  below exists to make impossible.

  **`@endora-commerce/platform`** declares the 21 inputs the host and the platform
  read, on a new `./env` subpath:

  ```ts
  import { PLATFORM_ENVIRONMENT_INPUTS } from '@endora-commerce/platform/env';
  ```

  The subpath is host-internal — declared, resolvable by a CLI and by the host, and
  nameable by no module. A module declares its **own** inputs in its manifest, and the
  shape it does so in is `@endora-commerce/contracts`'.

  **`@endora-commerce/cli`** resolves those inputs, in one fixed order that is not
  configurable: an explicit `--<input>` flag, then a `.env` already placed in the
  target directory, then an interactive prompt, then a refusal. `endora new
storefront` takes it first, and writes the answers into the copy's own `.env`.

  Three properties are contract rather than behaviour:
  - **the tool invents no value.** Every run prints one provenance line —
    `[inputs] resolved: total=5 flags=5 env-file=0 prompted=0 generated=0 defaulted=0`
    — whose `defaulted` count is the _residue_ of the four tiers rather than a counter
    nothing increments, so a value from outside them shows up in the arithmetic
    instead of disappearing;
  - **no command blocks on a question nobody can answer.** A prompt is issued only
    when stdin and stdout are both TTYs, `--non-interactive` and `--dry-run` are
    absent and no CI marker is set. Otherwise a missing required input is exit `1`
    naming **every** missing input and the flag that supplies each, in one refusal;
  - **the one class of value a command may generate is a cryptographic secret** whose
    declaration marks it `generable` — written into the target's `.env` where the
    operator can read it, named in the provenance line, and printed nowhere.

  **If you call `runNewStorefront` directly**, it now resolves inputs and will refuse
  a run that has none and cannot ask:

  ```diff
  -await runNewStorefront({ dir: target, cwd });
  +await runNewStorefront({
  +  dir: target,
  +  cwd,
  +  inputs: { NEXT_PUBLIC_API_BASE_URL: 'https://api.example.com', /* … */ },
  +});
  ```

  `MissingInputsError` is the refusal; `DeclarationLoadError` is a tree whose
  declaration could not be read, which is exit `2` rather than `1`. A target
  directory holding nothing but a `.env` is now accepted, which is what makes the
  second tier reachable for that command.

- 6521134: Make a scaffolded instance able to migrate, compose and install its own module set.

  **`@endora-commerce/cli`.** `endora new instance` wrote every root script as
  `pnpm --filter backend run <x>` while the member it delegates to is named
  `<name>-backend`: pnpm matched no project, printed `No projects matched the
filters` and exited **0**, so `migrate`, `build`, `start`, `dev` and the five
  `module:*` scripts were silent no-ops. They are now `pnpm -C backend run <x>`,
  which names the directory `pnpm-workspace.yaml` declares and exits 1 when the
  directory or the script is missing. The five generated `module:*` entry points
  now close the ORM and Redis handles they open and exit — they previously printed
  their answer and hung forever — and run inside a system scope, as the host's own
  scripts do. The next-steps block and the generated README now name
  `pnpm run build` and `pnpm run module:install --all`, the two steps a client
  needs and was not told about.

  **`@endora-commerce/platform`.**
  - `configuredEntitiesFrom` and `discoverConfiguredMigrations` now merge the
    platform's **own** six entity classes and twelve migrations, published as
    `PLATFORM_ENTITIES` and `PLATFORM_MIGRATION_ENTRIES` on `./db`. A host that
    already names them — this repository's generated registries do — is unchanged:
    the merge is an identity de-duplication over the same objects. An instance
    supplies `coreEntities: []` and `coreEntries: []` and previously therefore ran
    none of the platform's own schema.
  - `resolveManifestEntries` and `composeApp`'s default composition now contribute
    `_lifecycle`, whose sources are this package's. An instance ships no generated
    manifest index, so it composed `_lifecycle` nowhere and its boot refused with
    `not-shipped: _lifecycle`.
  - `composeApp` now contributes a default `lifecycleManifestRegistry`. Both
    composition roots in the Endora repository override it; an instance supplies
    no contribute callback, so the name resolved to nothing and the boot died in
    `_i18n`'s bundle reconcile.
  - `module:install` accepts **`--all`**: every registered module that is not
    already installed, in the dependency order `ModuleDepGraph` computes. An
    instance's modules are installed packages, whose `module_registrations` rows no
    boot writes, and the single-module command refuses on unmet dependencies —
    so there was no performable way to install a scaffolded set.
  - `PackageSchemaContribution` gains a required `dependencies` field, read from
    the package's own manifest. `configuredMigrationsFrom` used to fall back to
    `[]` for any module id the host's committed index did not carry; in an
    instance that is every module, so the per-module migration order degenerated to
    the tie-break. Construct one and you must now supply the field.
  - `CORE_MODULE_ID` is declared in `./db`'s `platform-schema.ts` and re-exported
    from its previous home unchanged.

- 74a4797: **`@endora-commerce/platform/lifecycle` gains the divergence declaration's shape rule, and only that half** (D115-3; `specs/115-lifecycle-container-move/contracts/operator-half.md` §4).

  New on the `./lifecycle` barrel: `parseDivergenceDeclaration(value, path)` and `emptyDivergenceDeclaration()`. Between them they answer _"is this a declaration, and what does an absent one say"_ — pure over `DeploymentDivergenceDeclarationSchema`, with `path` a caller-supplied string that appears in a refusal and is never composed, resolved or read. Measured on the moved code: zero reads of `DEPLOYMENT`, zero `process.env`, zero `import.meta`, zero Node builtins, zero path composition and zero disk; its only import is `@endora-commerce/contracts`.

  **The locator did not come with them, and that is the point rather than a tidy-up.** `divergencePathFor`, `declarationPathFor` and `loadDivergenceDeclaration` compose and read a path in the deployment tree, which belongs to the tree that owns `apps/`. They stay in the application, at `backend/src/overlay/divergence-loader.ts`, and `loadDivergenceDeclaration(env, root)` now takes the application source root as a parameter instead of deriving it from its own location — so the answer survives the file moving, and the application has one `import.meta.url` root derivation rather than two byte-identical ones.

  The reason is a measured defect and not a preference. That derivation was one `dirname` too high once: it composed `backend/apps/<d>/divergence.ts`, `existsSync` said no, and every deployment read as declaring nothing — with nothing able to see it, because an absent file and an empty declaration are deliberately the same answer. Three `dirname`s from `packages/platform/src/lifecycle/services/` give `packages/platform/src`, so moving the loader here would reproduce that state exactly, in the one mechanism where a wrong answer is silent.

  **Nothing became public API and nothing is removed.** `PUBLISHED_SUBPATHS` stays at five; `./lifecycle` remains host-internal, so a module naming either symbol is still a `host-internal-subpath` finding. The platform's own consumption is unchanged: `composeApp` has always received the parsed declaration as a field of `ComposeModulesOptions` and has never called the loader.

- 9a5d4d2: **`@endora-commerce/platform/lifecycle` gains the manifest-registry derivation, and takes its input as a parameter** (D115-2; `specs/115-lifecycle-container-move/contracts/operator-half.md` §3).

  New on the `./lifecycle` barrel: `coreManifestEntries(discovered)`, `resolveManifestEntries(sources)`, `ManifestPathMissingError`, and the types `DiscoveredManifestEntry`, `RegisteredManifestEntry`, `ManifestSources`, `OverlayModuleFound`, `PackageModuleFound`. Together they are the whole of _"which modules exist, where does each one live, and did two of them claim one id"_: the core entries, the `origin` field and its three construction sites, the `manifestPath` refusal, the collision assembly and the three-way merge of core ∪ overlay ∪ installed packages.

  **The generated manifest index is supplied to the platform, never reached by it.** That artefact is a fact about one repository's tree — bare core under every value of `DEPLOYMENT`, host-owned — so the platform declares the shape and the host passes the array. An instance binds three suppliers against its own answers in about twenty lines; nothing in the package names a generated file, a deployment root or a `node_modules` path.

  The module-id collision rule moves with the merge, from the application to `lifecycle/services/module-id-claims.ts`: `assertNoModuleIdCollisions`, `moduleIdCollisions`, `ModuleIdCollisionError` and the `ModuleIdClaim` / `ModuleIdCollision` types are now published on the same barrel. It is pure — no disk, no environment, no layout — and the assembly that calls it is the three-way merge, which a platform file cannot make while the rule sits in a file the platform may not name.

  **Nothing became public API and nothing is removed.** `PUBLISHED_SUBPATHS` stays at five; `./lifecycle` remains host-internal, so a module naming any of these symbols is still a `host-internal-subpath` finding.

- a655909: **`@endora-commerce/platform/lifecycle` gains the five `module:*` command bodies and the seam they take** (D115-1, D115-6, D115-7; `specs/115-lifecycle-container-move/contracts/operator-half.md` §2 and §2.1).

  New on the `./lifecycle` barrel: `runInstallCommand`, `runUninstallCommand`, `runEnableCommand`, `runDisableCommand`, `runStatusCommand` — each `(argv, rt) => Promise<number>` — and the `OperatorRuntime` and `OperatorResources` interfaces they take. Together they are the whole of what an operator's terminal does to a platform: the argv grammar, the exit-code table of `specs/018-module-lifecycle/contracts/cli-commands.md` §C-1, the orchestrator wiring, `mapError`, and every sentence a `module:install`, `module:uninstall`, `module:enable`, `module:disable` or `module:status` prints. All 827 lines of it used to sit in `backend/src`, which under D-207 a client instance never receives, so an instance that installed the platform got the orchestrator and none of the ways to drive it.

  **`OperatorRuntime` carries no container, and that is the design rather than an omission.** It is the resource thunk below, the instance-resolved manifest entries, an optional migration-ownership reader, an optional `confirm` capability and two output functions. A command that cannot reach a composition cannot run one, so D-157.2/.4's failure — composition's own reconciler marking every shipped module `installed`, whereupon `module:install X` returns `already-installed` at exit 0 having applied no migration and run no install hook — is structurally unreachable rather than remembered.

  **The resources are opened on first use** (D115-6, R2.6). `OperatorResources` — the ORM handle, the `EntityManager` factory and the Redis connection — is what only the tree that installs the platform can build, and `resources: () => Promise<OperatorResources>` is a thunk that tree memoises. The caller cannot know whether an invocation needs a database without parsing argv, and argv belongs to the body, so the knowledge of which flags need a connection stays with the grammar. Three properties follow, each of them the rule rather than a side effect: §C-1's own step order, where steps 1–2 load the manifests and resolve the id and answer above step 3's lock; `module:install --dry-run` without a database; and **exit 64 for misuse on a machine whose database is not up**, which is the one refusal an operator meets before their instance works and which an eagerly awaited ORM handle turned into an unhandled rejection and exit 1 — a code §C-1's table does not contain. `orchestratorFor` is the one place the thunk is called, at the point in each body where an eager handle would have been read, so a resource failure surfaces exactly where it always did; no call site moved, and `status` still builds its orchestrator outside its `try`. The caller closes what it opened and an invocation that never called the thunk has nothing to close.

  **A destructive step asks the caller, not `process`** (D115-7, R2.7). `confirm?: (question: string) => Promise<boolean>` is how `uninstall` learns whether this run can obtain a confirmation; **absent means it cannot ask**, and `--hard` without `--force` is refused with exit 64. It replaces a `process.stdout.isTTY` read inside the command body. That read defeated both of R2.4's reasons — _testable without a process_, and _an instance may frame the output_ — exactly as writing to a process global would: a body test had to mutate a global to reach the branch, and a deploy script, a `systemd` unit or an admin action had its destructive-write policy decided by whether _its own_ stdout happened to be a terminal, which is a fact about the wrapper and not about the operator. It was also wrong on its own terms, testing stdout alone, so `docker run -t` or any CI configuration that allocates a terminal for coloured output read as interactive and took the branch that proceeds. No file under `packages/platform/` now reads `process.stdout.isTTY`, `process.stdin` or `process.env` to decide an operator question. **Nothing supplies `confirm` yet, deliberately**: whether a terminal is asked at all — §C-2 step 6's _"or a tty prompt confirming "yes" verbatim"_, which has never been implemented — is the owner's, drafted as `D-217`, and either answer is a change to the caller and to that branch rather than to this interface.

  **Nothing became public API and nothing is removed.** `PUBLISHED_SUBPATHS` stays at five; `./lifecycle` remains host-internal, so a module naming any of these symbols is still a `host-internal-subpath` finding. The bump is `minor` rather than `major` because every symbol here is new: `0.7.0` published no `OperatorRuntime`, so the shape D115-6 and D115-7 settle has no consumer to break. That is the whole reason they ride in this release rather than the next one. In this repository the five entry points at `backend/src/lifecycle/scripts/*.ts` keep their paths and their `backend/package.json` script names, and are now the memoised resource opener, the manifest resolution and the system scope — about twenty lines each, which is what an instance writes against its own configuration.

- 1beac89: Narrowed `@endora-commerce/platform/lifecycle` to the names its consumers import, which is
  what the last nine `_lifecycle` re-export shims stopped being able to hide.

  `backend/src/lifecycle/` held nine 20-line shims — `routes.admin.ts` and eight under
  `services/` — each spelling `export * from '../../../../packages/platform/dist/lifecycle/…'`.
  A relative path into this package's build output resolves in the monorepo and in no tree
  that installs the platform, so the application was not a consumer of the package it ships.
  112 reaches across 50 files in `backend/test/**` were the only thing still holding them
  open; they now name this subpath and the shims are deleted, which empties
  `backend/src/lifecycle/services/` entirely.

  That changes what decides the barrel's contents. A shim holds its target's **whole
  namespace**, so while one existed the barrel had to carry every name the file exported or
  the reach could not retire onto it. With none left, the only rule is the one
  `./composition` has had all along — _a name here is one a consumer outside the platform
  actually imports_ — and 28 names fell to it:

  ```diff
   export {
  -  registerApiInterceptorAdminRoutes,
     registerLifecycleAdminRoutes,
  -  registerModulePresenceRoutes,
  -  type ApiInterceptorAdminDeps,
  -  type LifecycleAdminDeps,
  -  type ModulePresenceAdminDeps,
   } from './routes.admin.js';
   export {
     LifecycleError,
     ModuleLifecycleOrchestrator,
  -  type DisableResult,
  -  type EnableResult,
  -  type InstallResult,
  -  type OrchestratorDeps,
  -  type UninstallResult,
   } from './services/orchestrator.js';
  ```

  and the same for `LOCK_TTL_SECONDS`, `LOCK_REFRESH_INTERVAL_MS`, `LifecycleLeaseHandle`,
  `orderModulesByDependencies`, `AcknowledgedPortEdge`, `PresencePredicate`, `ConsequenceRow`,
  `DeactivationOutcome`, `UnassignedShape`, `collectLifecycleParticipants`, `isLoadError`,
  `loadProjectManifests`, `resolveFromFile`, `DiscoverOptions`, `LoadedModuleEntry`,
  `NeededBy`, `ReducedDeploymentFinding` and `StaticRegistryEntry`. Each is still exported
  from its own file inside the package; what it no longer has is an address outside it.

  **If you named one of the 28**, you were naming a host-internal subpath no module may name
  at all — `check:platform-surface` reports that as `host-internal-subpath`. There is no
  replacement address, deliberately: this surface drives the platform's own presence axis,
  and a module that could name it could install, uninstall, enable or disable its siblings.

- 7fb0567: Narrowed `@endora-commerce/platform/lifecycle` by six names, and made it the address the
  generated composition and manifest index use for `_lifecycle`.

  The two generated artefacts named `_lifecycle`'s `backend.ts` and `manifest.ts` through
  `../../packages/platform/dist/lifecycle/…` — a relative path into this package's build
  output, which resolves in the monorepo and in no tree that installs the platform. So the
  artefact whose whole job is to register the modules a build ships could not register
  `_lifecycle` anywhere else. They now name this subpath, which is what it was added for.

  That made `backend.ts`, `manifest.ts`, `plugin.ts` and `services/module-origin.ts` reached
  by nothing relative, so the barrel's second rule applies to them alone — _a name here is
  one a consumer outside the platform actually imports_ — and six names fell to it:

  ```diff
  -export { registerModule, type LifecycleCradle } from './backend.js';
  -export {
  -  lifecycleModule,
  -  lifecycleModuleFromStaticEntries,
  -  type LifecycleModule,
  -  type LifecycleModuleDeps,
  -  type LifecycleModuleHandle,
  -} from './plugin.js';
  +export { registerModule } from './backend.js';
  +export { lifecycleModuleFromStaticEntries } from './plugin.js';
  ```

  `OriginatedManifestEntry` leaves `./lifecycle` on the same reasoning;
  `deploymentShippedEntries` and `ModuleIdClaimOrigin` stay.

  **If you named one of the six**, you were naming a host-internal subpath no module may
  name at all — `check:platform-surface` reports that as `host-internal-subpath`. There is
  no replacement address, deliberately: this surface drives the platform's own presence axis
  and a module that could name it could install, uninstall, enable or disable its siblings.

- 304f6d8: **`@endora-commerce/platform` gains a `./lifecycle` subpath, and it is not public API** (D115-4; `specs/115-lifecycle-container-move/contracts/operator-half.md` §5).

  It carries `_lifecycle`'s operator surface — the orchestrator and its `LifecycleError`, the lifecycle lock, the dependency and gating graphs, the deactivation ledger, the manifest loader, the static registry, the presence loader, the module origin helpers, the module's own `registerModule`, `manifest` and admin routes. The set is derived rather than curated: it is exactly the fourteen platform-lifecycle files the application reaches today by relative path into `packages/platform/dist/`, so every one of those reaches has an address to be written as instead.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged, and `PUBLISHED_SUBPATHS` stays at five. `./lifecycle` joins `./composition` and `./migrations` as **host-internal**: declared by the `exports` map, so the host, its five `module:*` entry points and the test kit resolve it, and carried by no published barrel, so `check:platform-surface` reports a module naming it as `host-internal-subpath`. **No module may name it** — this surface drives the platform's presence axis, and a module that could name it could install, uninstall, enable or disable its siblings. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer, and leaves this one in the same merge request.

  `@endora-commerce/cli` publishes `HOST_INTERNAL_SUBPATHS` from `lib/platform-surface.js`: the host-internal class as a record of subpath → the reason it is not public API. It was a literal inside one assertion, then a bare set duplicated across two test files with the reasons in the prose of one of them. **If you enumerate the host's subpaths**, read `HostPackage.declaredSubpaths` for what the manifest declares and this record for which of them are host-internal; the published five stay `PUBLISHED_SUBPATHS`. Nothing is removed and no signature changes.

- db1ec0b: A module can declare its demo data in `manifest.ts`, and the platform can run it.

  **`@endora-commerce/contracts`** gains one optional field on `ModuleManifest`,
  `demo`, plus `ModuleDemoManifest`, `ModuleDemoContext`, `DemoSeedResult`,
  `DemoResetResult`, `DemoEntityCount`, `DemoCredential`,
  `ModuleDemoManifestSchema` and `ModuleDemoDeclarationSchema`. Three states, and
  they are `docs`': an object — this module ships demo rows for its own tables;
  `false` — it has nothing to demonstrate, deliberately; **absent** — nobody has
  decided. Write the body behind a relative `await import()`, in `cliCommands`'
  shape, so a manifest every composing process loads does not pull a service graph
  with it:

  ```ts
  const demo: ModuleDemoManifest<ModuleContext> = {
    summary: 'A demo warehouse and stock for the seeded products.',
    seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
    reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
  };
  ```

  `defineModuleManifest` refuses a malformed one, and the two `demo.after` entries
  that cannot mean anything: the declaring module itself, and the same id twice.
  `after` is **advisory** — `permissions[].requires`' shape under D-175. It puts no
  module in `dependencies`, creates no lifecycle edge and changes no migration
  order, which is what lets `megamenu`'s demo order itself after `catalog`'s
  without declaring a dependency it does not have.

  **`@endora-commerce/platform`** gains `src/demo/` — the production guard
  (relocated from `backend/src/seeds/dev-seed-guard.ts`, which is now a re-export
  shim), the scope reasons, the plan, the runner and the report. It is reached by
  the host CLI and by nothing else; it is deliberately **not** on the
  `./composition` subpath, whose 27 symbols are D-160.14's ruled set.
  `sortComponentsTopologically` and `orderModulesByDependencies` join
  `stronglyConnectedComponents` on `lifecycle/services/dep-graph.ts`, so the demo
  order and the migration order are one walk rather than two that can disagree.

  Nothing else changes: no module declares demo data yet, `seed:dev` still runs,
  and no package gains a dependency.

- f7147b0: Removed the module licence tier: `ModuleLicenseTierSchema`, the `ModuleLicenseTier` type, the
  optional `license` field on a module manifest, and the required `license` field on
  `ModuleListItem`.

  It was reserved for edition-gating and was read by nothing. D-194 removed the tier
  meta-packages it existed for, and the field survived them: no gate consulted it, no route
  branched on it, the `/platform/modules` screen never rendered it, and `module:status` never
  printed a column for it. The only two references outside its own declaration were the
  orchestrator lines copying it from the manifest onto the list item — a value carried the
  length of the system so that nobody could look at it.

  **If you declared it in a manifest**, delete the line. A Zod object is non-strict, so a
  manifest that still declares one is not refused; the key is dropped on parse. There is no
  replacement, and there is no entitlement axis to move it to — the manifest's one presence
  declaration is `activation`, which is the operator's runtime control and was always a
  different question (Constitution XVII).

  ```diff
   export const manifest = defineModuleManifest({
     id: 'my_module',
     name: 'My Module',
     version: '1.0.0',
     dependencies: [],
  -  license: 'pro',
     activation: { settingCode: 'my_module.enabled', default: true },
   });
  ```

  **If you read `ModuleListItem.license`**, the field is gone from
  `GET /api/v1/admin/modules` and from `ModuleLifecycleOrchestrator.status()`. Nothing
  replaces it. A consumer that rendered it was rendering `null` for every module in this
  repository, no manifest having ever declared a tier.

  ```diff
  -import type { ModuleLicenseTier } from '@endora-commerce/contracts';
  -const tier: ModuleLicenseTier | null = item.license;
  ```

- 72013ed: Published `OrganizationTaxProfilePort`, and moved the error envelope's assembly into the
  platform.

  **`@endora-commerce/contracts` gains `OrganizationTaxProfilePort`.** It described the
  `organizationTaxProfilePort` container name and was declared by
  `@endora-commerce/mod-organizations/backend`, so a consumer resolving that port had to name
  the provider's own package to spell the type — which is the reach a port exists to remove,
  and which `@endora-commerce/platform` may not write at all. The declaration is unchanged
  member for member.

  ```diff
  -import type { OrganizationTaxProfilePort } from '@endora-commerce/mod-organizations/backend';
  +import type { OrganizationTaxProfilePort } from '@endora-commerce/contracts';

   const taxProfile = lazyPort<OrganizationTaxProfilePort>(ctx, 'organizationTaxProfilePort');
  ```

  **`@endora-commerce/mod-organizations/backend` no longer exports it**, and that is the
  breaking half. A re-export was written and withdrawn: a barrel re-exporting a name whose
  source is another package makes _"does this barrel carry an entity class by name"_ unknown
  rather than false, which D-168 may not be wrong about, and two spellings for one type is the
  shape this repository removes rather than adds. Change the specifier; the type is
  unchanged.

  **`@endora-commerce/platform/composition` gains `composeErrorEnvelopeOptions` and loses
  `createRequestLanguageResolver`.** The two callbacks a composition root passes to
  `registerErrorEnvelope` — the language ladder and the translation lookup — were assembled
  by each root itself, identically, in twenty lines apiece. They are one function now, and
  what a root supplies is only what a root knows: its own resolved error-code routing table
  and the two container names the callbacks read.

  ```diff
  -errorEnvelope: {
  -  errorTranslationTargets: routing.targets,
  -  resolvePreferredLanguage: createRequestLanguageResolver({
  -    adminPreferredLanguage: async (id) =>
  -      (await adminUserReadPort().findById(id))?.preferredLanguage ?? null,
  -  }),
  -  translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
  -    const t = await i18n().translate(moduleId, key, language, params);
  -    return t === `${moduleId}.${key}` ? originalMessage : t;
  -  },
  -},
  +errorEnvelope: composeErrorEnvelopeOptions({
  +  errorTranslationTargets: routing.targets,
  +  adminUserReadPort: () => identityPorts().adminUserReadPort,
  +  translate: () => cradle().adminI18nService,
  +}),
  ```

  `createRequestLanguageResolver` is off the barrel because no composition root constructs it
  any more; the ladder it builds is unchanged and is now built inside the assembly. If you
  called it directly, call `composeErrorEnvelopeOptions` instead. Both are on `./composition`,
  which is host-internal — no module may name it — so this affects a host and never a module.

- ec09593: `./cli` — the host's side of a module-declared operator command.

  Everything a `<module id> <command name>` invocation decides with no process and no
  database is the platform's now (`specs/110-instance-repository/` T117, FR-013): the
  enumeration of every command the resolved manifest set declares, the two refusals a
  declaration can earn, the lookup, the `--list` and `--help` renderings, and the
  find-gate-invoke that decides presence from the module that **declared** the command,
  first and outside every `try`. A client's copy of that is a copy that diverges the first
  time we correct ours.

  **`./cli` is a new host-internal subpath.** Declared by the `exports` map and carried by
  no published barrel (D-160.14), so `node` and `tsc` resolve it for a host and a
  composition root while a module reaching it is answered `host-internal-subpath` by
  `check:platform-surface`. The reason is `./composition`'s own, one surface over: this is
  the code that decides which command runs and whether the module that declared it is
  present at all, so a module that could name it could enumerate its siblings' operator
  commands and invoke one. A module declares its commands in its own `manifest.ts` and
  receives a `ModuleContext`; that is the whole of the surface it is entitled to.

  ```ts
  import {
    collectModuleCommands,
    findModuleCommand,
    formatCommandList,
    helpFor,
    runModuleCommand,
    InvalidCommandDeclarationError,
    UnknownCommandError,
    type CommandDeclaringEntry,
    type DeclaredCommand,
    type RunModuleCommandOptions,
  } from '@endora-commerce/platform/cli';
  ```

  **Nothing is removed and no signature changes.** `runModuleCommand` still takes the
  resolved manifest entries and the composition's own `contextFor`, so a host that already
  holds a `ComposeAppHandle` passes exactly what it passed before. What a host still writes
  itself is the **process**: reading `process.argv`, composing, opening one system scope over
  the composed container, disposing it, and turning the answer into an exit code. That is
  this repository's `backend/src/cli.ts` and an instance's own, because every one of those
  is a fact about a deployment's entry point rather than about the platform.

  **It is not the `module:*` path and must not become one.** Those five operate _on_ the
  platform, compose nothing (D-157.2/.4), and keep their own entry points over
  `@endora-commerce/platform/lifecycle`'s `commands/<verb>.ts`.

  `@endora-commerce/cli` takes a patch: `HOST_INTERNAL_SUBPATHS` gains `cli` with the reason
  it is not public API, which is what makes the estate's checks and
  `published-surface.test.ts` answer for the new subpath in both directions.

- dcface9: Complete the host-internal `./composition` barrel, and give the demo-data layer
  `./demo`.

  Both are **host-internal** subpaths (D-160.14): they are declared by the
  `exports` map, so `node` and `tsc` resolve them for a composition root, a host
  CLI and a test kit — and they are not public API, so `check:platform-surface`
  answers a _module_ that names either one with `host-internal-subpath`.
  `PUBLISHED_SUBPATHS` is unchanged at five and no published barrel gains a name.

  **`@endora-commerce/platform`**

  `./composition` gains twelve names, every one of them a symbol
  `kernel/index.ts`' own header already enumerated as excluded — _"the composition
  machinery … and the errors they raise"_:

  ```ts
  import {
    registerErrorEnvelope, // http/error-envelope.ts
    parseTrustedProxy, // http/trusted-proxy.ts
    type TrustedProxy,
    ModuleCompositionError, // kernel/compose.ts
    type ModuleEntry,
    createModuleContext, // kernel/module-context.ts
    createModuleRegistrationSink,
    type ModuleRegistrationSink,
    AmbiguousDecorationError,
    ForeignDecorationError,
    PackageDecorationNotOfferedError,
    type AdminActorPromotion, // kernel/ports/require-admin.ts
    absolutizePublicUrl, // kernel/public-api-base-url.ts
  } from '@endora-commerce/platform/composition';
  ```

  `./http` carries `HttpError`, which is what a module _raises_, and not the
  registration that attaches the envelope to an app — a module owns no app to
  attach one to. `./kernel` carries `RequireAdminFactory` and
  `PublicApiBaseUrlNotConfiguredError`, which are what a module reads; the
  promotion hook and the absolutiser are what a root _supplies_.

  `./demo` is new. It carries `runDemo`, `unwrapDemoFailure`, `formatDemoReport`,
  `mustBeNonProduction`, `TEST_DATABASE_NAME_PATTERN`, `DEMO_SEED_SCOPE_REASON`,
  `DEMO_RESET_SCOPE_REASON` and the four types those name. `packages/platform/src/demo/`
  was the one platform directory with a barrel and **no subpath at all**, so its
  consumers reached `packages/platform/dist/demo/index.js` by relative path — a
  specifier that resolves in the monorepo and in no installed instance, which for
  this directory means a demo an instance cannot run.

  **The demo barrel exports eighteen fewer names than the directory declares**, and
  under `exports` that is not a removal: none of them was reachable from outside
  the package before, because there was no subpath. `planDemoRun`,
  `classifySeedTarget`, `createDemoPackageResolver`, `DemoRunFailedError`,
  `demoBodyFromPackage`, `DemoPackageShapeError` and the plan and run-result shapes
  stay internal until something asks for one by name. Adding a name back is not a
  breaking change.

  **`@endora-commerce/cli`**

  `HOST_INTERNAL_SUBPATHS` gains a `demo` member with its reason. The record is
  what `check:platform-surface` and `test/unit/kernel/published-surface.test.ts`
  both read, so a subpath cannot join the class without a written statement of who
  may name it and why.

- 40e6e96: `./db` — the ORM configuration, the migration ordering and the bootstrap, plus the
  platform's own twelve migrations on `./migrations`.

  Everything between a committed registry and an open `MikroORM` is the platform's now
  (`specs/110-instance-repository/` T116, FR-013): a client's schema is not a client's to
  edit, and the code that decides which entity classes the ORM registers and which
  migrations run at all was in the application it now composes.

  **`./db` is a new host-internal subpath.** Declared by the `exports` map and carried by no
  published barrel (D-160.14), so `node` and `tsc` resolve it for a host and
  `check:platform-surface` answers a module's reach into it with `host-internal-subpath`. It
  carries `PluralizingNamingStrategy` / `pluralize` / `toSnakeCase`; `orderMigrations`,
  `historicalBaselineOrder`, `findModuleCycles`, `BASELINE_THROUGH`, `MigrationOrderError`
  and the ordering types; `configuredEntitiesFrom`; `configuredMigrationsFrom`,
  `migrationOwnershipOf`, `committedMigrationOwnership`, `committedModuleDependencies`,
  `discoverConfiguredMigrations` and `CORE_MODULE_ID`; `mikroOrmConfigFrom`;
  `createOrmBootstrap`; and `runMigrationCommand`.

  **Nothing on it reads a generated artefact.** The committed migration registry, the
  committed entity registry and the generated manifest index are facts about one
  repository's tree, so they arrive as parameters. For a host that used to call the
  application's own functions, the calls are:

  ```ts
  // before — the application's src/db/, which imported the registries itself
  const migrations = await configuredMigrations();
  const ownership = coreMigrationOwnership();
  const graph = coreModuleDependencies();
  const entities = await configuredEntities();
  const config = await mikroOrmConfig();

  // after — the same computations, over registries the host supplies
  import {
    committedMigrationOwnership,
    committedModuleDependencies,
    configuredEntitiesFrom,
    createOrmBootstrap,
    discoverConfiguredMigrations,
    mikroOrmConfigFrom,
  } from '@endora-commerce/platform/db';

  const sources = { coreEntries: MIGRATION_REGISTRY, manifests: DISCOVERED_MANIFESTS };
  const migrations = await discoverConfiguredMigrations(sources);
  const ownership = committedMigrationOwnership(sources);
  const graph = committedModuleDependencies(DISCOVERED_MANIFESTS);
  const entities = await configuredEntitiesFrom({ coreEntities: ALL_ENTITIES });
  const config = mikroOrmConfigFrom({ entities, migrations });
  const { initOrm, getOrm, closeOrm } = createOrmBootstrap(async () => config);
  ```

  `configuredMigrationsFrom` and `migrationOwnershipOf` keep their names and signatures.

  **`./migrations` now publishes the twelve core migration classes** beside
  `BASELINE_MIGRATIONS`. They moved unchanged — no rename, no consolidation, no re-stamping
  (R7.5) — because `mikro_orm_migrations` persists the class name, so a rename would make
  every migrated database see the migration as pending. There is no `migrations` array on
  that subpath, unlike a module package's: nothing discovers the platform, and an array here
  would be a claim nothing reads.

  **Two removals from `./lifecycle`.** `moduleDependencyCycles`,
  `sortComponentsTopologically` and `stronglyConnectedComponents` left it, and so did the
  `MigrationOwnership` type: their one consumer outside the platform was the ordering code,
  which is inside it now. A consumer that named them there takes the graph walk from
  `ModuleDepGraph` and `MigrationOwnership` from `./db`.

  **`@mikro-orm/migrations` is a new peer dependency**, on the same reasoning as
  `@mikro-orm/core`: the configuration registers the `Migrator` extension and the twelve
  migrations extend `Migration`, and a second copy of the package is a second `Migration`
  base class.

  The `@endora-commerce/cli` bump is `lib/platform-surface`'s `HOST_INTERNAL_SUBPATHS`
  gaining its `db` entry, with the reason that entry is required to carry.

- d321c67: The platform's own unit tests move into this package, beside the sources they cover
  (`specs/110-instance-repository/`, T119a) — fifty files under `packages/platform/src/**/*.test.ts`,
  run by the package's new `test` script.

  **What changes for a consumer: six names leave the host-internal `./lifecycle` subpath.**
  `acquireLifecycleLock`, `LifecycleLockError`, `LedgerInput`, `DiscoveredManifestEntry`,
  `OverlayModuleFound` and `PackageModuleFound` are no longer re-exported from
  `@endora-commerce/platform/lifecycle`. They were on that barrel only because the tests that
  name them were outside the package; those tests now import their subjects directly, and
  `published-surface.test.ts`' ratchet — _a name on this barrel that no first-party source
  outside the platform imports is surface parked against a future need_ — removes them in the
  same merge request. The declarations themselves are unchanged and still exported from their
  own modules (`lifecycle/services/lock.ts`, `lifecycle/services/deactivation-ledger.ts`,
  `lifecycle/manifest-registry.ts`).

  No module may name `./lifecycle` at all (D-160.14): it is the operator surface, and a package
  that could reach it could install, uninstall, enable or disable its siblings. `PUBLISHED_SUBPATHS`
  is untouched and stays at five, and nothing on a published barrel moved.

  `package.json` gains a `test` script and a `vitest` devDependency; `files` is unchanged, so
  nothing new ships.

- 03dec57: Two new host-internal subpaths, `./packages` and `./overlay`
  (`specs/110-instance-repository/` T113 and T114).

  `./packages` carries installed extension-package discovery: `nodeModulesRootsFor`,
  `scanNodeModulesRoots`, `discoverPackageModuleManifests`, `loadPackageModuleEntries`,
  `packageModuleEntriesUnder`, `packageModuleManifestsUnder`, `discoverPackageSchema`,
  `packageSchemaContributionsUnder`, `installedPackageModuleIdClaims` and `entityNamed`, with
  `InstalledPackage`, `InstalledPackageScan`, `SkippedPackage`, `PackageModuleManifest`,
  `PackageSchemaContribution`, `EntityClassLike`, `MigrationRegistryEntry` and
  `EntityRowTypeIsRequired`. `./overlay` carries the overlay loader:
  `listOverlayModuleDirs`, `resolveOverlay`, `resolveOverlayUnit`, `overlayModuleIdsUnder`,
  `overlayModuleManifestsUnder` and `overlayModuleEntriesUnder`, with `OverlayResolution` and
  `OverlayModuleManifest`.

  Both are **host-internal** (D-160.14): declared by the `exports` map, carried by no
  published barrel, and named by no module. `check:platform-surface` answers a module's reach
  into either with `host-internal-subpath`.

  Two behavioural notes for a composition root. `nodeModulesRootsFor` derives its search chain
  from its own location, so the chain now starts at `@endora-commerce/platform` rather than at
  the application — which is where the platform actually runs from in an instance, and is what
  `ENDORA_INSTANCE_ROOT` exists to override. And the overlay loader derives **no** path: the
  overlay root and the claims already made on a module id are parameters, because both are
  facts about the application and R7.4 says a relocated platform file receives such a thing
  rather than reaching for it. The two entry points that used to answer "the active
  deployment's" — `discoverOverlayModuleManifests(env)` and `loadOverlayModuleEntries(env)` —
  are the application's binding and are not on this subpath.

- 8249bb7: **`@endora-commerce/platform` gains a seventh subpath, `./migrations`, carrying `BASELINE_MIGRATIONS` — the frozen historical prefix of the migration order, as an ordered list of class names** (`specs/110-instance-repository/contracts/instance-migration-order.md`, R1.1/R1.5).

  The migration execution order is a frozen historical prefix, whose order is history and which the manifest dependency graph contradicts in 37 places, followed by the modules in a topological order of that graph. Membership of that prefix was `origin === 'core' && timestamp <= BASELINE_THROUGH`, which encodes _"came out of this repository's build"_ and was being used to mean _"is one of the migrations whose order is history"_. Those coincide exactly while every module is compiled into the application and come apart completely when a module is installed from a package, because a package's migrations are tagged `origin: 'external'` — deliberately. Measured over the real registry: the prefix falls from **112** entries to **11**, **181 of 182** positions move, and six migrations — three of them `core`'s — land before the migration that creates a table they touch. An instance installing the same modules could not migrate a fresh database at all.

  So membership is now by **identity**. `orderMigrations`' `baselineThrough: string` input is replaced by `baseline: readonly string[]`, the class names whose order is history, emitted in the order the list holds them; `BASELINE_THROUGH` survives as a **generation-time** rule (`migration:new` clamps a scaffolded stamp past it, and the list is rendered from what the committed core registry contributes at or below it) and no ordering decision is taken on `origin` any more.

  **No module may name `./migrations`** — it is declared by the `exports` map and carried by no published barrel, which is D-160.14's third state, and `check:platform-surface` reports a module's reach into one as `host-internal-subpath`. The reader is the host's ORM configuration, the one program that composes an execution order. A module package's own `./migrations` subpath is unaffected: it publishes that module's classes, and this publishes the order the platform applies them in.

- 5ba2e97: `request.actor` is declared by the platform, and `Actor` no longer carries the session.

  **`@endora-commerce/mod-auth` — breaking, two ways.**

  `Actor`, `ActorAnonymous`, `ActorCustomer`, `ActorAdmin` and `ActorApiKey` are no
  longer exported from `@endora-commerce/mod-auth/backend`. Import them from
  `@endora-commerce/contracts` instead:

  ```ts
  // before
  import type { Actor, ActorAdmin } from '@endora-commerce/mod-auth/backend';

  // after
  import type { Actor, ActorAdmin } from '@endora-commerce/contracts';
  ```

  And the `declare module 'fastify'` block that adds `actor` and `adminActor` to
  `FastifyRequest` is no longer in this package. If you imported from
  `@endora-commerce/mod-auth/backend` only to make `request.actor` compile — a
  type-only import whose real job was to put the ambient declaration in your
  program — the import to write now is a normal one you probably already have:

  ```ts
  // before — erased at build time, and load-bearing anyway
  import type { Actor } from '@endora-commerce/mod-auth/backend';

  // after — any import from this subpath carries the declaration
  import { HttpError } from '@endora-commerce/platform/http';
  ```

  **`ActorCustomer.session` and `ActorAdmin.session` are gone.** They were the
  `Session` ORM entity, written onto every authenticated request. If you read one,
  resolve `authSessionPort` or `authSessionReadPort` from the container: both are
  declared in `@endora-commerce/contracts` and both answer with `AuthSessionRecord`,
  a plain shape rather than an entity. Nothing else about the actor changed — the
  same four kinds, the same fields, resolved by the same `onRequest` hook.

  **`@endora-commerce/contracts`** gains `Actor` and its four members, at
  `./actor.js` and on the root barrel. It imports neither Fastify nor the ORM.

  **`@endora-commerce/platform`** gains the Fastify augmentation on its existing
  `./http` subpath — no new subpath and no new export, because the file declares
  the two request properties and exports no symbol. Any import from
  `@endora-commerce/platform/http` brings it.

- 0222f04: `@endora-commerce/platform/composition` exports `ModuleRegistration`, the entity class the
  `module_registrations` table is mapped by.

  `host-package.md` §1.3 classifies this class **A** — not public API — and that classification is
  applied here rather than revised: `./composition` is not public API either, and a consumer that may
  name it has already composed the platform. It is deliberately **not** on `./kernel`, which would let
  every module package name the row recording whether its siblings are installed.

  Why it needed an address at all: an instance's generated entity registry has to hand this class to
  MikroORM, and it was the one platform entity class no barrel carried — so the generator named all
  six of them by relative path into `packages/platform/dist/`, which resolves in the Endora checkout
  and in no client's. With this export the registry names each class by the subpath that publishes it
  (`@endora-commerce/platform/kernel` for `AuditLogEntry`, `SalesChannel`, `Setting`, `SettingGroup`
  and `SettingValue`; `@endora-commerce/platform/composition` for `ModuleRegistration`).

  For a consumer this is additive: nothing moves off a barrel, no published subpath is added, and
  `./kernel`'s surface is unchanged.

### Patch Changes

- ca43192: `EnvironmentInput` gains a required `addressOf`, and the CLI stops guessing which of a
  storefront's variables names a backend from the shape of the value.

  **Why.** Two programs ask _"which of these variables names the backend"_ — `endora new
storefront`, whose next step tells an author to point them at theirs, and that command's
  acceptance criterion, which does the pointing. Both answered it by reading
  `storefront/.env.example` for a value that looked like an absolute `http(s)` URL. That is
  right only while such a file declares no address but the backend's, and the reference
  storefront now declares its **own** public origin (`NEXT_PUBLIC_SITE_URL`) there — so the
  old predicate would have told a client, in a file they own outright and nobody revisits,
  that the shop's canonical origin "names the backend this storefront talks to".

  `addressOf` is a declaration of what a value **is**: which member of the instance it is
  the address of, or `null` where it is the address of none.

  **If you ship a declaration** — an application's `environment-inputs.mjs`, or the
  platform's — every entry needs the field. It is required rather than optional on purpose:
  an optional one is forgotten exactly once, by whoever adds the next address, in silence.
  Zod refuses a declaration without it at `loadTreeDeclaration`, so the failure is a
  sentence naming the entry rather than a variable that quietly stops being configured.

  ```diff
   {
     name: 'NEXT_PUBLIC_API_BASE_URL',
     requirement: { kind: 'required' },
     secret: false,
     generable: false,
     owner: { kind: 'application', application: 'storefront' },
     consumers: ['storefront'],
  +  addressOf: 'backend',
   },
  ```

  `null` is an answer and not an absence. A third party's address is `null` —
  `DATABASE_URL` and `REDIS_URL` are addresses, of a database and a cache, and neither is a
  member of the instance — and so is a value naming _several_ origins, `CORS_ALLOWED_ORIGINS`
  being the worked example: "the address of" is singular.

  **`@endora-commerce/contracts`** adds `addressVariablesFor(inputs, member)`, the one
  derivation both consumers take.

  **`@endora-commerce/cli`** replaces `backendAddressVariables(envExampleText)` with
  `addressVariables(declared, member)`, over a loaded declaration rather than over
  `.env.example` text. `backendAddressVariablesOf(dir)` keeps its name and its meaning and
  is now **async**, because it loads that directory's own declaration; there is a
  `storefrontAddressVariablesOf(dir)` beside it. `envExampleDeclarations` and
  `envExampleDeclarationsOf` are unchanged — the file is still the storefront's worked
  example of its _values_.

  ```diff
  -const names = backendAddressVariables(readFileSync('.env.example', 'utf8'));
  -const names = backendAddressVariablesOf(storefrontDir);
  +const names = await backendAddressVariablesOf(storefrontDir);
  ```

  `STOREFRONT_DOMAIN` also becomes a per-instance build input in
  `@endora-commerce/cli/lib/instance-build-inputs.js`, supplying the storefront build's
  `NEXT_PUBLIC_SITE_URL`. A pipeline rendered from that declaration gains one
  `--build-arg`; one that does not pass it builds a storefront whose canonicals, sitemap and
  `robots.txt` name `http://localhost:3000`.

  **`@endora-commerce/platform`** only annotates its own twenty-one declared inputs; no
  exported behaviour changes.

- Updated dependencies [5394b8f]
- Updated dependencies [0c9a799]
- Updated dependencies [e20276c]
- Updated dependencies [9f7591b]
- Updated dependencies [142fcdd]
- Updated dependencies [4eeb5cd]
- Updated dependencies [9eb0cb6]
- Updated dependencies [ca43192]
- Updated dependencies [fd7db00]
- Updated dependencies [089d2d4]
- Updated dependencies [e83be80]
- Updated dependencies [db1ec0b]
- Updated dependencies [f7147b0]
- Updated dependencies [72013ed]
- Updated dependencies [5ba2e97]
- Updated dependencies [0ab2044]
  - @endora-commerce/contracts@0.8.0

## 0.7.0

### Major Changes

- c53fef3: **`WorkerLogger` is gone; the type is `PlatformLogger`.** One structured-logger shape had
  three exported names, and two of them were the same word.

  `@endora-commerce/platform/kernel` no longer exports `WorkerLogger`. The identical interface —
  `info(obj, msg)` / `warn(obj, msg)` / `error(obj, msg)` — is exported as `PlatformLogger`,
  from the file that documents and produces it. It is the type of `ModuleContext.log`, of
  `DefineModuleWorkerOptions.logger`, and of every `log` a module is handed or holds.

  ```ts
  // before
  import type { WorkerLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: WorkerLogger) {}
  }

  // after
  import type { PlatformLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: PlatformLogger) {}
  }
  ```

  The rename is the whole migration: the shape is byte-identical, so nothing but the imported
  name changes. A `type WorkerLogger = PlatformLogger` shim in your own code compiles, but it
  re-creates the second name this release exists to remove.

  Also removed: `ModuleLifecycleLogger` from `kernel/module-context.ts`, an alias of the same
  interface that no barrel published — a module could not name it, only meet it by hovering
  `ctx.log`. Nothing importable is lost.

  **Why it was a defect and not untidiness.** `@endora-commerce/contracts` exports a
  `ModuleLifecycleLogger` of its own, and it is a _different_ shape: the install/uninstall hook
  logger, `info(msg: string)`, one argument. The platform's alias claimed the same name for the
  two-argument shape. An author who read the published contracts package — the package whose job
  is to be the published shape — and wrote `ctx.log.info('…')` got `TS2554: Expected 2
arguments, but got 1`, with two names resolving and both of them ours.

  `@endora-commerce/contracts` keeps `ModuleLifecycleLogger` unchanged. Its name was the accurate
  one: it is the logger of `ModuleLifecycleContext` and of the two lifecycle-participant events,
  all called by the orchestrator, which tags the module id so the hook author writes plain
  messages. Its doc block now says what it is not.

- a84ad28: Remove `enroll` and `verifyTotp` from the kernel barrel, and delete
  `kernel/crypto/totp` with them.

  The primitive had no caller left once the superseded `/api/v1/me/two-factor/*`
  path was deleted: `mfa` ships its own TOTP over its own `otpauth` dependency,
  and nothing else in the tree named these symbols. `otpauth` is dropped from
  the platform's and the backend's manifests and stays where it is used.

  Withdrawing a published export is `major` even though the measured consumer
  count is zero — the barrel is what a third-party module compiles against, and
  this repository cannot see who has already done so.

- 2cd9c14: `@TransitivelyScoped` chains are now walked to their end, and one that reaches no tenant is refused at boot.

  `assertTransitiveParentsResolve()` used to check each transitive entity's **immediate** parent and stop.
  It now walks the whole chain and requires it to terminate at a classification that carries a tenant key —
  `@OrgScoped` or `@CustomerScoped`. Four shapes that used to pass now throw
  `UnresolvableTenantParentError` (the same error class as before — there is deliberately no second one)
  and stop the boot:
  - a chain terminating at a `@GlobalEntity` parent;
  - a chain terminating at a `@RuleScoped` parent (a foreign key cannot evaluate a rule);
  - a cycle, `A → B → A`, which resolves at every step and grounds nowhere;
  - a run of `@TransitivelyScoped` entities that reaches none of the above.

  Each of them left the child entity reachable with no tenant predicate anywhere on its path.

  **If your package ships an entity that now fails to boot**, the message names the entity, its foreign key
  and the whole chain. Either point the chain at an ancestor that owns the tenant, or — if the entity
  genuinely has no tenant — classify it `@GlobalEntity()` itself, which is a one-word change in the same
  decorator block.

  A chain terminating at a `@CustomerScoped` parent stays legal and now emits one `info` line naming the
  chain: `customerFilterCond()` yields no predicate in `allowed-set` mode, so such a chain is unfiltered for
  an org-scoped admin.

  `assertTransitiveParentsResolve()` also takes an optional reporter — `{ info(obj, msg) }`, which a
  `PlatformLogger` satisfies — as its first argument, for that line. Existing zero-argument calls keep
  working and write to `console.info`.

- 764b379: **`customerFilterCond`'s `allowed-set` arm stops returning `{}`, and the function takes an
  argument.**

  `customerFilterCond()` is now `customerFilterCond(organizationColumn: CustomerOrganizationColumn)`,
  where `CustomerOrganizationColumn` is `'present' | 'absent'` — both exported from
  `@endora-commerce/platform/tenancy`'s `filters` module. Any direct caller must pass one:

  ```ts
  // before
  const where = customerFilterCond();
  // after — `'present'` iff the entity you are filtering carries `organizationId`
  const where = customerFilterCond('absent');
  ```

  `@CustomerScoped()` itself is source-compatible and takes no new argument. It derives the answer
  per query from the ORM's discovered metadata, so an entity that gains an `organizationId` column
  starts being filtered on it with no further change.

  **The behaviour change is confined to the `allowed-set` mode** — the mode a scoped
  (assignment-limited) administrator resolves to. It previously contributed **no predicate at all**
  to any `@CustomerScoped` entity, so such an entity behaved as if it were `@GlobalEntity` for that
  actor. It now contributes `{ organizationId: { $in: allowed } }` when the entity carries the
  column, and a predicate that matches nothing when it does not. `all`, `system` and `single-org`
  are unchanged, and a buyer resolves `single-org`.

  A surface that has already established the caller's authority by other means and reads a
  `@CustomerScoped` entity with no organization column will now read nothing under a scoped
  administrator. Cross that deliberately with `withSystemScope(reason, fn)` after the check that
  establishes the authority; do not catch.

  `@endora-commerce/mod-quick-order`'s `registerQuickOrderAdminRoutes` takes a new required dep,
  `customerAccounts: CustomerAccountReadPort`. It is the tenant boundary of the admin build route:
  `onBehalfOf` names the customer account and organization the built Cart or Quote Request is
  written to, and it arrives in the request body, where no read filter can reach it.

- 0a2bbd4: `TransitivelyScoped` names its parent aggregate by **class name** instead of by a class
  thunk, so an entity can express a tenancy chain into a module whose package publishes an
  `entities` array and no named entity class.

  ```diff
  -import { Order } from '../../orders/entities/order.entity.js';
  -
  -@TransitivelyScoped(() => Order, 'orderId')
  +@TransitivelyScoped('Order', 'orderId')
   @Entity({ tableName: 'invoices' })
   export class Invoice {}
  ```

  The thunk overload is **gone**, not deprecated: it had no remaining call site once the
  platform's own two were converted, and keeping both forms would have been two ways to say
  one thing.

  `ClassificationMeta.parent` (`() => EntityClass`) is replaced by
  `ClassificationMeta.parentClassName` (`string`). Nothing in the platform read the old field.

  **Three new exports on `tenancy/org-scoped.decorator.js`**, none of them on the `./tenancy`
  barrel — they are the host's, as `tenantClassifications` already is:
  - `resolveTransitiveParent(child)` — the parent's `ClassificationMeta`, resolved lazily
    against the registry, so a child decorated before its parent is imported resolves fine.
  - `assertTransitiveParentsResolve()` — reconciles every transitive chain at once. Call it
    where the host enumerates its entity classes, after every classification decorator has
    run and before the ORM is configured.
  - `UnresolvableTenantParentError` — thrown by both when a parent name matches no classified
    entity, or matches more than one. There is no fallback: a transitively scoped entity has
    no tenant column of its own, so a chain that stopped resolving would be an untenanted
    read.

  The class name is the key because the registry is already addressed by it and MikroORM
  refuses two entities sharing one at discovery. The schema does not change — same foreign
  key, same column, same chain.

### Minor Changes

- 4db867c: **`@endora-commerce/platform` gains a sixth subpath, `./composition`, and it is not public API** (D-160.14; `specs/080-f4-real-scope/contracts/host-package.md` §2.7).

  It carries the 27 composition symbols a composition root needs and no published barrel carries — `buildServer`, `composeModules`, `createRootContainer`, `registerOrm`, `registerValues`, `createRegistrationOwnership`, `registerRequestScopeHook`, `platformLogger`, `registryCache`, `publishStateChanged`, `activationDeclarationsFrom`, `requiredModulesFrom`, `composeSettingsKernel`, `ManifestReconciler`, `composeSalesChannelsKernel`, `DefaultChannelReconciler`, `createRequestLanguageResolver`, `AuditLogService`, `forkScopedEm`, `resolveTenantContext`, `systemTenantContext`, and the types `ModulePlugin`, `ApiInterceptorRegistry`, `KernelContainer`, `DecorationRecord`, `SettingsKernel`, `SalesChannelsKernel`.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged. **No module may name `./composition`** — production source or test alike; a module's server-bound test composes through the test kit's `composeTestServer`, never through `composeModules`. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer.

  `@endora-commerce/cli` learns the rule: `resolveHostSpecifier` answers a third way — `host-internal-subpath`, a subpath the host's `exports` map declares and no barrel carries — and `check:platform-surface` reports a module's reach into one as a finding of its own kind. `HostPackage` gains a required `declaredSubpaths` field, read off the host manifest's own `exports` map; a consumer constructing a `HostPackage` by hand must supply it.

- fbf1bf8: `ctx.di.decorate` now **enqueues**, and `composeModules` drains the queue after the last module
  has registered — plus a new refusal, `PackageDecorationNotOfferedError`, for a deployment's
  overlay wrapping a registration an installed extension package owns (D-176).

  **The drain.** A decoration used to write the container at the call, while the registration pass
  was still running, so array order decided whether it was possible at all: a module composed
  before the owner of the name it wraps got _"nothing is registered under that name"_ — the right
  error for the wrong reason. That is now one pass and one drain, with no sort and no dependency
  graph. Three consequences for a caller:
  - **A decoration may name any registration in the composition, whatever the order.** Nothing that
    composed before is affected: an entry that worked at the call works at the drain.
  - **`hasRegistration`'s refusal changed meaning, and its message with it.** It now means _"no
    module in this composition ever registers that name"_ — check the spelling, and that the owner
    is composed — where it used to say the owning module had to be composed first. There is no such
    order any more, so any code matching on the old wording should stop.
  - **Refusals are raised at the drain, not inside `registerModule`.** `ForeignDecorationError` and
    `AmbiguousDecorationError` are unchanged and still name every module they named. Anything else a
    wrap throws is now wrapped as `ModuleCompositionError` with a new phase, `'decorate'` — so
    `ModuleCompositionError['phase']` is `'register' | 'decorate' | 'boot'`. Narrow on it rather
    than assuming two values.

  Call order is preserved: one module decorating one name twice still wraps in the order it wrote
  the calls, which is why that case is exempt from `AmbiguousDecorationError` and why the queue is a
  queue.

  **The refusal.** `ModuleEntry` gains `installedPackage?: boolean`, set by the host that discovers
  a package and never by the package. When the owner of a decorated name carries it, `decorate`
  throws `PackageDecorationNotOfferedError` — including for a deployment's overlay module, which is
  otherwise exempt from the ownership rule. Nothing that composed before is affected: an overlay
  wrapping a core or overlay registration is unchanged, a package wrapping its own registration is
  unchanged, and a module wrapping another module's is refused exactly as it was, one error class
  more specifically where the owner is a package.

  Its reason, which the message carries in full: a package's `exports` map publishes
  `registerModule`, its entities, its migrations and `./ports`, and a container name it registers
  internally is published by none of them — so the wrap would be written against a name the package
  never offered and may rename in a patch release. The message says _not offered yet_ rather than
  _forbidden_, and names the exit: a package declaring which of its registrations are decoratable,
  `./ports` being the natural home, where changing the shape costs a major bump.

  `PackageDecorationNotOfferedError` and `createDecorationQueue` are exported from
  `kernel/compose.js` and `kernel/module-context.js` beside the errors already there.

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

- 4e964e0: The lifecycle subsystem now ships with the platform (D-160.11).

  `_lifecycle`'s platform-safe files moved into `packages/platform/src/lifecycle/`:
  the module's manifest, its composition entry, its admin and storefront routes,
  its activation Commands, its i18n bundles, and eight services — the
  orchestrator, the manifest loader, the static registry, the dependency graph,
  the gating graph, the deactivation ledger, the lease lock and the presence load.
  An instance that installs the platform now has the lifecycle machinery with it,
  rather than depending on a separate package it could be missing.

  Two new modules are emitted from this package and are internal:
  `lifecycle/services/migration-ownership.js` declares the `MigrationOwnership`
  shape the orchestrator consumes (the host builds the value), and
  `lifecycle/services/module-origin.js` declares `ModuleIdClaimOrigin` and
  `deploymentShippedEntries`. `lifecycle/services/dep-graph.js` gains
  `stronglyConnectedComponents` and `moduleDependencyCycles`, which are now the
  one graph walk both the install refusal and the migration order read.

  Three behaviour changes for a caller that constructs the machinery itself:
  - `ModuleLifecycleOrchestrator` no longer defaults `migrationOwnership` to the
    committed core registry. Omitting it refuses every hard uninstall, naming the
    field; pass `coreMigrationOwnership()` for the previous behaviour, or
    `(await configuredMigrations()).ownership` from a composition root.
  - `gatingGraph()` no longer falls back to the host's manifest registry on its
    own. A composed process is unaffected — the presence load installs the real
    graph — and anything else calls `provideDefaultGatingManifests(supplier)`
    first or gets a throw instead of an empty graph that refuses nothing.
  - `loadModulePresence({ em, entries })` takes `declaredOmissions` instead of
    reading the deployment's reduced-deployment declaration itself. Omitting it
    declares no omission, which is the fail-closed direction.

  No published subpath changed: the `exports` map is still the five of D-160.7.
  The package's build now copies its runtime assets, so `dist/lifecycle/i18n/`
  travels with it.

- 63be98c: A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

  Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
  differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
  what the composition roots inject.

  **`@endora-commerce/contracts`**
  - `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
    module owns. The sentence for each still lives in the module's own
    `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
    because the raising code's own English already exists and can interpolate.
    `defineModuleManifest` refuses four things, naming the module and the code: a code that is
    not SCREAMING*SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
    match `^[a-z]a-z0-9*]\*$`, and the same token twice under one code.
  - New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
    `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
    mandatory rather than a convenience — a bare string literal is assignable to neither
    `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
    **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
    measured.
  - New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
  - `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
    regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
    `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
    `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

  **`@endora-commerce/platform`**
  - `HttpError`'s `code` parameter and field widen from `ErrorCode` to
    `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

  **`@endora-commerce/mod-i18n`**
  - New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
    modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
    code routes it to **neither** and names every claimant with the file that declares it —
    there is no tie-break by origin, order or id, because each of those renders one raiser's
    condition under the other's sentence with no symptom anyone can detect. Exported but not
    yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
  - `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.

- 1f4475e: `InProcessCacheRegistry` now carries the platform's cross-process cache
  invalidation, so a module can drop a snapshot on a module-state change without
  naming the Redis channel that announces it (D-174).

  Two additions to `@endora-commerce/platform/kernel`, both on the already
  published `InProcessCacheRegistry`:
  - `register(namespace, layer, opts?)` takes a third argument,
    `{ invalidateOnModuleStateChange?: boolean }`, default `false`. Existing
    two-argument calls are unaffected and keep the old behaviour exactly.
  - `invalidateForModuleStateChange(): Promise<void>` drops every layer that
    opted in. Every layer is started synchronously before the first `await`, and a
    layer that throws is reported and skipped rather than propagated.

  `ModuleRegistryCache.watch` calls it on each `b2b:module:state-changed` message,
  before the PostgreSQL refresh — so the drop lands on receipt.

  Why a consumer would want it: `registryCache.presenceVersion()` is a content
  hash of the two presence axes and of nothing else, so a cache derived from what
  an install _rewrites_ — a module's command-palette rows, another module's
  translation bundles — is structurally blind to those inputs. The notification is
  the only cross-process announcement of them, and it is not something a module
  should be subscribing to itself: the channel is a transport detail and the
  payload is one the consumer does not read.

  ```ts
  import { inProcessCaches } from '@endora-commerce/platform/kernel';

  const unregister = inProcessCaches.register(
    'my_module',
    {
      invalidateAll: async () => {
        cache.clear();
        return 0;
      },
    },
    { invalidateOnModuleStateChange: true },
  );
  ```

  Opt in only where the layer's content really is derived from module state. A
  layer that owns a Redis key space clears it with SCAN+DEL, and running that in
  every API and worker process on every operator flip is a storm — which is why
  the flag exists instead of the notification dropping everything registered.

- ce1d197: New package: `@endora-commerce/platform`, the host an extension package compiles against
  (feature 080, T042a; contract `specs/080-f4-real-scope/contracts/host-package.md`, rulings
  D-160.1 and D-160.7).

  **Five enumerated subpaths, no root export and no wildcard.**

  ```ts
  import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';
  import { HttpError } from '@endora-commerce/platform/http';
  import { GlobalEntity } from '@endora-commerce/platform/tenancy';
  import { CommandBus } from '@endora-commerce/platform/commands';
  import { EventBus } from '@endora-commerce/platform/events';
  ```

  `@endora-commerce/platform` itself, `/db`, `/overlay`, `/packages` and any deep file path are
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and that is the contract rather than an omission: a wildcard
  map would publish all fourteen accidental-reach platform files as supported API — `db/index`
  among them, which cannot be published at all, because it reaches the ORM configuration and
  through it 219 module-owned entity references, making the host import every module. The five
  subpaths are also the boundaries a five-package split would take, so that option stays open at
  the price of one release.

  **`@mikro-orm/core`, `@mikro-orm/postgresql`, `fastify` and `zod` are peer dependencies, and
  the host is a non-optional peer of every module package** — never a `dependencies` entry.
  Measured: two copies of `@mikro-orm/core` share one metadata registry (`globalThis`, no
  version in the key) and the package's entity is registered and then **silently dropped from
  discovery** — no throw, no warning, exit 0, and a table nobody creates. Two copies of the
  _host_ are the loud case, `MetadataError: Duplicate entity names are not allowed`.

  The package emits from `backend/src`'s five platform directories, so nothing in the
  application tree moved and every existing relative specifier is untouched.

- 028d8b4: The package's sources are now its own: `kernel`, `http`, `tenancy`, `commands` and `events`
  live in `packages/platform/src/`, and `tsconfig.build.json` compiles them with
  `rootDir: "./src"`.

  **No exported symbol, subpath or type changes.** The five enumerated subpaths and their
  contents are byte-identical, and a consumer's imports need no edit:

  ```ts
  import { lazyPort, SalesChannel } from '@endora-commerce/platform/kernel';
  import { HttpError } from '@endora-commerce/platform/http';
  ```

  **What changes is identity.** The package used to emit `dist/` from
  `rootDir: ../../backend/src`, so its artefact was the application's own five directories
  _compiled a second time_. The application ran the originals; anything resolving the bare
  specifier ran the copy. Measured across the two: **59 identity-bearing exports, none of them
  shared** — `new HttpError(…) instanceof HttpError` was `false` across the boundary, so a
  packaged module's every 404 and 409 rendered as a 500; `effectiveState` and
  `getResolvedChannel` were module-scoped singletons the host never populated; and
  `MikroORM.init` over both copies of `SalesChannel` threw
  `MetadataError: Duplicate entity names are not allowed`.

  Everything the acceptance fixture took from the host was a **type**, and types are erased —
  which is why nothing had noticed, and why the criterion could be 9/9 throughout. There is now
  exactly one copy of every one of those 59 values, and
  `backend/test/unit/kernel/platform-single-copy.test.ts` fails if a second one returns.

  The package also declares `"endora": { "type": "platform" }`, the block the host's own tooling
  reads to find it — the same shape a module package uses for `{ "type": "module", "id" }`.

- 81f4b08: `defineModuleWorker` now stops a queue consumer whose module is switched off, on **both**
  presence axes and in **every** process (Constitution XVII).

  Before this, `pauseWorkersFor` was the only thing that could stop a worker, and it had two
  call sites — both on the platform-availability axis, inside the lifecycle orchestrator's
  `disable`. A business operator's deactivation refreshed the presence cache, took the module's
  routes to 503 and left the BullMQ worker consuming. `pauseWorkersFor` is also process-local:
  it iterates a registry the calling process filled, so it never reached a `BACKEND_ROLE=worker`
  process, and never reached anything at all from the `module:*` CLI, which composes no modules.

  Two gates, both reading the `ModuleRegistryCache` that every composed process already keeps
  fresh from `b2b:module:state-changed`:
  - **the fetch gate** — every presence install reconciles every registered worker to
    `effectiveState.isPresent`, pausing the absent and resuming the present. Level-triggered and
    idempotent, so a missed notification is retried by the degraded-mode refresh rather than
    lost.
  - **the work gate** — `defineModuleWorker` wraps the worker's processor, so a job already
    fetched when presence flipped does not run.

  **A refused job is left waiting**, never failed and never dropped: the work gate uses BullMQ's
  `Worker.rateLimit` + `RateLimitError`, which returns the job to the wait list with no attempt
  consumed and no `failed` event, and it drains when the module comes back.

  New API on `ModuleRegistryCache`:

  ```ts
  const stop = registryCache.onPresenceInstalled(() => reconcileMyThing());
  ```

  Called on every presence install — the pub/sub refresh, the degraded-mode refresh, the cold
  load. Use it where `presenceVersion()` is not enough because the thing you own is stateful
  rather than memoised. Listeners must be idempotent; their throws are contained and logged.

  Also exported from `kernel/lifecycle/plugin-helpers`: `reconcileModuleWorkers()` and the test
  seam `resetModuleWorkersForTesting()`.

  **One behavioural requirement on callers.** `defineModuleWorker` now **throws** when the value
  it is given carries no BullMQ processor, instead of registering a worker it cannot gate. A
  hand-written stub passed as `as unknown as Worker` must supply `processFn`, `isPaused()` and
  `on()` alongside `pause()` / `resume()`; a real `Worker` already does.

- 31975ca: `SalesChannelResolutionPort` and `SalesChannelMembershipPort` each gain one method, both
  implemented by the kernel services behind the `salesChannelResolutionPort` and
  `salesChannelMembershipPort` container names.
  - `SalesChannelResolutionPort.listAll(): Promise<CachedChannel[]>` — every channel, ordered by
    code. A consumer that needed the whole list previously had to reach the module's admin
    service or query `sales_channels` itself; both are boundary violations.
  - `SalesChannelMembershipPort.replaceChannelsForEntity(entityType, entityId, channelIds,
options?)` — replace an entity's complete membership set in one transaction. Composing
    `removeFromChannel` and `addToChannel` cannot express it: the intermediate state either
    trips the at-least-one-channel invariant or leaves the system default bound alongside the
    channel the caller actually wants. Callers are complete-record integrations, where the
    delivered record names the exact set.

  Both are additive. An existing implementation of either interface written outside this
  repository needs the new method; every implementation inside it is the kernel's own service.

- 456ffa7: A listing that a viewer's organization scope emptied now says so.

  `@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
  `ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
  The last is the reader both sides share: `meta.scopeNotice` on any successful response,
  absent when there is nothing to say.

  ```ts
  import { scopeNoticeOf } from '@endora-commerce/contracts';

  const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
  const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
  ```

  `@endora-commerce/platform` adds `TenantScopeNotices` and
  `noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
  `TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
  the code on the envelope. **This changes what every route registered behind that hook
  answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
  filter refused a whole table during that request. Error bodies, arrays, buffers and string
  bodies are untouched, and a viewer whose reach is not restricted never sees the key,
  because only an `allowed-set` context carries a sink for the filter to write to.

  Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
  table on the day that table gains an `organization_id`, because the same filter arm starts
  granting instead of refusing.

  `@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
  `en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.

### Patch Changes

- 469a5f4: Removed `ERROR_TRANSLATION_KEYS` and `composeErrorTranslationTargets` from
  `@endora-commerce/mod-i18n/backend`. Error-code routing is now nothing but the modules' own
  `errorCodes` declarations, composed by `buildErrorTranslationTargets`, which was already
  published and is unchanged.

  `ERROR_TRANSLATION_KEYS` was a static table generated by a private prefix chain
  (`moduleIdForErrorCode`) over the closed `ERROR_CODES` enumeration, so a module written outside
  this repository could not produce a translated error at all: its code was in neither, and the
  envelope answered whatever English the raising code wrote, for ever. The chain's last line was
  `return 'core'`, so a code no rule matched was routed silently to the platform bundle and
  rendered as a raw code with nothing anywhere reporting it.

  **If you named `ERROR_TRANSLATION_KEYS`**, build the map from the manifests instead. The input is
  every registered manifest — core, this deployment's overlay modules and every installed package.

  ```diff
  -import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
  -const target = ERROR_TRANSLATION_KEYS[code];
  +import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +const { targets, collisions } = buildErrorTranslationTargets(await resolvedManifestEntries());
  +const target = targets[code];
  ```

  **If you called `composeErrorTranslationTargets`**, call `buildErrorTranslationTargets` with the
  same argument. It was a transitional shape that laid the declarations over the chain so the
  migration could be delivered one owning module per merge request; all eighteen owners have
  declared, so there is nothing left to lay them over.

  Two behavioural differences follow, and both are the point rather than side effects. A code **no
  registered manifest declares** is now absent from the map, so the envelope answers the raising
  code's own message — there is no fall-through to the platform bundle. And a code **more than one
  module declares** is absent too, and named in `collisions` with every claimant and the file it
  was declared in: nobody wins, because routing one raiser's condition under another's sentence is
  good prose about the wrong thing, with no symptom a client can detect.

  `ErrorTranslationTarget`, `ErrorTranslationTargets`, `ErrorCodeDeclarationSource`,
  `ErrorCodeClaim`, `ErrorCodeCollision` and `describeErrorCodeCollisions` are unchanged.

  `@endora-commerce/platform` carries a documentation correction only: the
  `ErrorEnvelopeOptions.errorTranslationTargets` doc block no longer describes the injected map as
  a static table, and records that a deployment's overlay module can now own a code by declaring
  it. No emitted behaviour changes.

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

- cc9c2f4: `registerErrorEnvelope` no longer lets a failing localisation replace the error
  it was localising.

  The `preSerialization` hook that swaps an error's written message for the
  registered sentence in the caller's language calls two host-injected callbacks —
  `resolvePreferredLanguage` and `translateErrorMessage`. Either can throw, and a
  throw there is not an ordinary failure: the hook runs while a reply Fastify is
  already treating as an error is being serialised, so Fastify cannot route it
  back through `setErrorHandler` and falls back to its own serialiser. The
  response then stops being an `ErrorEnvelope` at all — `{ statusCode, code,
error, message }`, in which `error` is the status phrase and `error.code` is
  `undefined`, so the admin's API client builds an `ApiError` reading
  `undefined: undefined`.

  Every other exit from that hook already returns the payload unchanged (no
  translation target, a `VALIDATION_FAILED` carrying a machine-readable token, a
  sentence with an unfilled placeholder). The throw now does the same: the
  untranslated envelope is served, in `LANGUAGE_FALLBACK`, and the failure is
  logged at `warn`. Nothing about a successful response passes through the guard —
  a payload that is not an error envelope never enters the decoration.

  No exported signature changes. The behavioural change is visible to a host whose
  `resolvePreferredLanguage` reads a gated port: that host now gets the envelope
  plus a `warn` line instead of a bare Fastify error body.

  `RequestLanguageDeps.adminPreferredLanguage`'s doc block is corrected in the same
  change. It asserted that the dependency is supplied by the composition root
  "rather than resolved as a port" precisely so it could not throw here; a host in
  this repository has supplied it out of a gated port since the module packaging
  work removed the named entity class it used to read. The dependency may throw,
  and the guarantee is now stated at the renderer instead.

- a47dcc8: `kernel/public-api-base-url.ts` gains `absolutizePublicUrl`, which makes an asset or API path
  absolute for a consumer that is not a browser on this host.

  It is **not** on the `./kernel` barrel and is not public API: no module reaches it, and its
  only caller is the composition root, for the PWA asset bridge and the transactional-email
  asset URL. It arrived from `backend/src/modules/email/`, where it was filed under the module
  that first needed it and had no consumer inside that module at all.

  Its default base is still `BACKEND_PUBLIC_URL ?? PUBLIC_API_BASE_URL`, deliberately rather
  than `configuredPublicApiBaseUrl` beside it: the two disagree on precedence when both
  variables name different origins, so unifying them would move a URL rather than move a file.

- aab1f32: `runWithoutTenantContext` now keeps the context cleared across an `await` on Node 22.

  It was implemented with `AsyncLocalStorage.exit(fn)`, which on every runtime before Node 24
  is `disable(); try { fn() } finally { enable() }` — a synchronous try/finally around a
  callback that may be `async`. Where the caller's context had been installed with
  `enterTenantContext` and the callback opened a nested `runWithTenantContext` of its own, the
  re-enable resurfaced the caller's context and everything after that point read it: the
  function's documented "no ambient context" ended partway through, silently. Node 24 made
  `AsyncContextFrame` the default and the same call became frame-scoped, so the defect was
  invisible on a newer local runtime and live on the 22.17 floor `engines.node` declares.

  The implementation is now `storage.run(undefined, fn)`. The contract is unchanged —
  `getTenantContext()` answers `undefined` inside, the caller's context is restored on both
  return and throw — and it holds across `await` on 22.17 and on 26 alike. Callers need no
  change; a caller that had worked around the old behaviour by re-asserting the clear after an
  await can drop the workaround.

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
