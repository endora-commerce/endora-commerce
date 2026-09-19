# @endora-commerce/cli

## 0.12.0

### Minor Changes

- 56ac8af: `endora generate` renders a host's test entity index, and `./lib` publishes the renderer

  A server-bound test needs the entity class **the ORM registered**, and a module package publishes
  one `entities` array and no entity class by name (D-168). _Which_ modules a host installed is the
  one fact `@endora-commerce/test-kit` may not know (feature 109 R2.2, FR-001), so the index is a
  generated per-host artefact: `backend/test/entities.generated.ts`, every installed module keyed by
  its own `endora.id`, with the `entities` array off its published `./backend`.

  `./lib/entity-index-artefact.js` is the renderer, one derivation over two populations
  (`instance-repository.md` R3.5) exactly as `./lib/admin-artefacts.js` is: `endora generate` runs it
  over an instance's installed packages and `composer:generate` runs it over this repository's
  workspace members. A module package publishing no `./backend` is refused rather than skipped — a
  skip reports an installed module as one nobody installed, which sends its operator to look at
  their install rather than at the artefact.

  It is the fifth artefact family and the first that belongs to **no member**, which narrows two
  things rather than weakening them. The `generate` script and the `@endora-commerce/cli`
  devDependency are now written for a headless instance that installed a module, because such an
  instance does have something to render. And `endora generate`'s exit-1 refusal — _a run that wrote
  nothing and said it succeeded_ — now fires on a workspace with no member, no deployment **and no
  installed module**, and its message names the third condition.

- ca34f24: `endora check` gains package-scope hosts for two rules that until now had none, and publishes
  their analyses on two new `./rules/*` subpaths.
  - **`check-entity-tenant-classification`** — every persisted entity class carries exactly one
    tenant-scope decorator (`@OrgScoped`, `@CustomerScoped`, `@GlobalEntity`,
    `@TransitivelyScoped`, `@RuleScoped`). It reads the **emitted** artefact, because that is what
    the platform loads: `@Entity(` does not survive compilation, and the class-level
    `__decorate([Entity({…}), OrgScoped()], C)` call does. A package that was never built, or whose
    source is newer than its `dist`, is reported `unreadable` with the build command — never
    answered from source. `@endora-commerce/cli/rules/entity-tenant-classification.js` exports
    `analyzeSource`, `analyzeEmitted`, `analyzeEmittedFiles`, `classifyFindings`,
    `declaredEntityClasses`, `packageEntityFindings`, `walk`, `walkEmitted` and `remedyFor`.
  - **`check:entry-presence`** — a timer, a process-lifecycle handler or a `ctx.onBoot` hook that
    nothing can catch a throw from must decide the module's presence before it works. The rule is
    unconditional; a `nonDeactivatable` manifest exempts the boot hooks and not the timers.
    `@endora-commerce/cli/rules/entry-presence.js` exports `checkEntryPresence`,
    `findUngatedEntries`, `collectPresenceFiles`, `keyOf`, `remedyFor`, `bootHookDoesWork`,
    `bootHookContributes`, `EXPLANATION` and the finding types.

  `checkEntryPresence(input, ledger)`'s second argument is **required**: a host states which
  exemptions it is judging against rather than inheriting whichever ledger the library carried.
  - **`check:port-catches`** — a `catch` around a gated-port call may not swallow
    `ModuleDisabledError`. `@endora-commerce/cli/rules/port-catches.js` exports
    `checkPortCatches`, `findPortCatches`, `collectPortCatchFiles`, `keyOf`,
    `resolvedPortNames`, `lockedOwners` and the site types.
    `checkPortCatches(input, ledger)`'s second argument is now **required**, and
    `PortCatchInput` gains `peerOwners` — the gated port names the subject's peers
    provide. Without it the analysis admits nothing a _consuming_ package wrote:
    measured over this repository, 31 of the 41 packages with sites saw every one
    of them disappear when analysed alone.

  `@endora-commerce/cli/checks` additionally exports `readPeerOwners`,
  `NO_PEER_OWNERS` and the `PeerOwners` / `UnreadablePeer` types — what a package's
  installed and workspace peers own, read synchronously out of their emitted
  artefacts. It is the input Phase 3's owner-map rules share.

### Patch Changes

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

- Updated dependencies [b413e2d]
  - @endora-commerce/contracts@0.13.0

## 0.11.0

### Minor Changes

- 919afc0: `check:queue-names` — a BullMQ queue name may not contain `:`.

  **`@endora-commerce/cli`** adds `rules/queue-names.js`: the analysis behind the new
  `check:queue-names`, plus its `endora check` package-scope host and its estate entry. A site is
  `new <Binding>(<arg0>, …)` where the binding is what the file imported from `bullmq` (alias
  followed) and the class is one whose first constructor parameter is the queue name. `arg0`
  resolves as a literal, as a `const` in the same file, or as a `const` imported one hop over a
  relative specifier; anything else is an unresolved site, counted in the read line and never
  judged. One finding, `colon-in-queue-name`, and no ledger — a ledgered colon is a queue that
  cannot be constructed. The rule is the colon alone; the repository's broader
  `<module_id>.<verb>` convention is deliberately not enforced.

  **`@endora-commerce/mod-comarch-xl`** renames its three queues from `comarch_xl:detect`,
  `comarch_xl:sync` and `comarch_xl:shop-export` to the dot spelling every other module already
  uses. BullMQ owns `:` as its Redis key-namespace separator and refuses such a name in
  `new QueueBase` before it reaches Redis, so the module's worker start threw, its plugin never
  finished loading and the backend never listened — and the same throw landed in the activation
  control's gate-off phase, so an operator could not switch the module off either. No queue had
  ever been constructed under the old names, so no data migration is needed.

### Patch Changes

- aa12ebf: `endora check`'s estate manifest gains a row for `check:root-dispositions`, the
  rule that refuses a top-level repository entry carrying no recorded disposition.

  It is `repository-only`, and here that claim about the rule's _subject_ is
  unusually literal: a module package holds no root entry of its own — it
  contributes paths under `packages/` — and the question the rule asks has already
  been answered for anything a consumer installed from a registry. The row exists
  anyway because the manifest is not a curated subset: a rule that can never run
  for a package is printed with its reason rather than left absent, which is what
  stops `endora check` becoming a list somebody updates or does not.

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

## 0.10.0

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

- 040617b: `endora install <dir>` — one command from nothing to an installed Endora Commerce.

  It composes `endora new instance` and `endora new storefront` and reimplements neither: it
  writes the instance, writes the storefront beside it as a sibling, derives the instance's
  `.env` from the `compose.dev.yml` the same run rendered, and then runs the sequence that block
  prints — `pnpm install`, `dev:services`, `setup`, `admin:create` and, when asked, `cli demo
seed`. Every step is echoed before it runs, a failing step exits with **its own** code and
  prints the remaining steps as a resumable list, and the seeding is the one step whose failure
  does not fail the install.

  **It never prompts**, and that is the whole reason this half could ship now: a command that
  asks nothing is under `cli-product.md` R2.5c's ceiling by construction, so the pipeline needed
  no amendment. The wizard is a later phase.

  Preconditions are decided completely before anything is written and reported in one refusal:
  the target directory, Node's version, a package-manager runner (`pnpm` on `PATH`, then
  `corepack pnpm@latest` — never `corepack enable`), a reachable Docker daemon unless
  `--no-services`, a reference storefront unless `--no-storefront`, all four administrator
  answers and the demo answer, which has deliberately no default.

  `REVALIDATE_SECRET` is generated **once** and written into both trees — the one value no
  sequence of the two existing commands can agree on.

- e647ea4: The root scripts that drive the development environment, and a next-steps block that is four
  lines shorter than the sequence it replaces.

  `endora new instance` now declares `dev:services` and `dev:services:down` (the `compose.dev.yml`
  this command writes, with `--wait` so `migrate` cannot race an initialising Postgres), the
  composite `setup` — `generate && build && migrate && module:install --all`, derived from those
  named root scripts rather than spelled out, so a change to one of them reaches it with nothing
  edited — and `preview:admin` with the admin member, which serves the bundle `build:admin`
  produced and which no root script and no printed step had ever named.

  `nextSteps()` takes a fifth argument, an options object carrying whether the admin member was
  written, the addresses read off the rendered `compose.dev.yml` and the mail catcher's URL. The
  block prints the services step first, names what `setup` runs so any step can still be taken by
  hand, and prints the development addresses rather than writing them — writing them into `.env`
  is FR-105 and waits on a ruling. `endora new storefront`'s block gains `pnpm run start`, which
  that manifest has declared all along and which was printed nowhere.

- d18aaaa: `endora new instance` closes its module set over `acknowledgedDependencies` as well as
  `dependencies`.

  The two spellings differ in one thing only — `acknowledgedDependencies` withdraws the install
  **ordering** a `dependencies` entry claims, for an edge whose ordering would close a cycle.
  `assertLockedModulesPresent` makes no such distinction: a module named in either array that the
  deployment does not ship raises `ReducedDeploymentError` out of `loadModulePresence`, before
  anything listens. So a scaffolded instance could be written with a set the platform then refused
  to boot, and was: `carts` names `promotions` through two ports, `promotions` was not in the
  derived set, and neither `pnpm run start` nor `pnpm run admin:create` got as far as a database.

  If you scaffolded an instance before this and it refuses to boot with `ReducedDeploymentError`,
  `pnpm add` the module the message names and run `pnpm run migrate && pnpm run module:install
--all`. A new instance needs nothing: the set it writes now contains it.

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

## 0.9.1

### Patch Changes

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

- Updated dependencies [5bfefe0]
  - @endora-commerce/contracts@0.10.0

## 0.9.0

### Minor Changes

- 471defd: A scaffolded instance's `.env.example` declares everything that instance reads,
  and the `.env` beside it is the file a client actually edits.

  `endora new instance` wrote a `.env.example` carrying the **five build inputs**
  and nothing else, while the platform declared 23 runtime inputs and nine module
  packages declared nineteen more. The instance acceptance criterion had been
  reporting the gap in its own output for weeks — _"supplied `DATABASE_URL`,
  `REDIS_URL`, `SESSION_COOKIE_SECRET`, `PUBLIC_API_BASE_URL`, `NODE_ENV` to the
  instance's own processes; its `.env.example` declares none of them, so a client
  who fills in the file the command wrote has nothing to put them in"_.

  The file is now derived, never listed: the **resolved platform's**
  `PLATFORM_ENVIRONMENT_INPUTS`, unioned with the `env` of every module manifest
  the run installed, scoped to the members it wrote, each entry carrying that
  declaration's own `describes` and its `requirement` sentence rather than a
  rewrite. A different `--module` set is a different file with nothing edited.

  Three further changes make the file reach the process that needs it.
  - **A `.env` is written**, holding the secrets the run generated
    (`cli-product.md` R2.5d — the `generable && secret` class, four of them over
    the default module set) and a **commented-out** placeholder for every other
    declared input. Commented, because Node's `--env-file` reads `NAME=` as the
    empty string and the platform's `??` fallbacks treat that as a value: a file
    of blanks turned twenty *unset*s into twenty empty strings and the acceptance
    run's health route answered 503 over a search engine that was running. A
    `.env` the operator placed there first is merged into, never rewritten.
  - **Every `node` script the backend member declares carries
    `--env-file-if-exists=../.env`.** Without it the file was inert: the root
    scripts are `pnpm -C backend run …`, so a `.env` at the root of the tree was
    read by nothing and a client who filled it in still could not start.
  - The next-steps block no longer says `cp .env.example .env`, which would now
    overwrite the generated secrets with empty strings.

  New in `@endora-commerce/contracts`: `unionEnvironmentInputs`, the join over
  several authors' declarations, first author wins. New in
  `@endora-commerce/cli`: `instanceEnvironmentInputs`, `declaredEnvironmentInputs`,
  `generableEnvironmentInputs`, `backendScripts`, and `parseEnvFile` /
  `renderEnvValue` / `writeEnvFile` re-exported from the package root.
  `ModuleCandidate` gains `env`, `PlanInput` gains `declared`, `existingEnv` and
  `generated`, `DeployInput` gains `declared`, and `loadModuleCandidates` returns
  `{ candidates, platformEnv }` instead of the map alone — all four are breaking
  for a caller that constructs one of those shapes, and `major` is refused in a
  `0.x` series (D-225).

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

- 9f9b1b3: `check:env-inputs` judges the module tree. Its population was the three trees a
  running Endora is made of — the backend's sources plus the platform's, the
  storefront's, the admin's — and every run printed the bound it could not reach:
  `not judged: 74 module packages`. That line is gone, because the walk now answers
  for them.

  A read resolves against the platform's declaration, the application tree's, and
  **the reading module's own** — never another module's. Two findings for the two
  ways that goes wrong: `undeclared-module-input`, a module read nothing declares,
  and `module-declares-a-platform-input`, a module restating a fact the platform
  already owns.

  Two more for the Settings-debt ledger (FR-004):
  `module-input-without-a-settings-verdict` and `stale-settings-verdict`, over
  `backend/scripts/ledgers/module-environment-inputs/`.

  `evaluateManifestEnvDeclaration` and `loadModuleVerdictShards` are new exports of
  `@endora-commerce/cli/rules/env-inputs.js`; `EnvironmentRead` and `EnvSourceFile`
  gain an optional `module`, and `EnvInputsInput` an optional `settingsVerdicts`.
  Every addition is optional, so an existing caller compiles unchanged.

- bf58f33: `endora new instance` writes example deployment files, and takes `--topology`.

  A scaffolded instance was handed **no deployment file at all** — no compose file, no nginx
  configuration, no `.env` for a running stack and no Dockerfile — while
  `instance-repository.md` R2.1 listed three of them as always present. A client asked for the
  owner's three-host topology wrote three deployment files from scratch.

  It now writes a `deploy/` directory derived from two axes and nothing else: the resolved
  member set, and `--topology single-host|three-host` (default `single-host`, an unrecognised
  value exits 1 naming the vocabulary).
  - `single-host` — `compose.prod.yml`, `.env.example`, `nginx.example.conf`.
  - `three-host` — `three-host/compose.{backend,storefront,admin}.yml` with one
    `.env.<host>.example` each. Every stateful service is on the backend host; the one
    `depends_on` edge that crosses a layer boundary is dropped rather than translated, and
    nothing replaces it.
  - Both — `deploy/README.md` and an example `Dockerfile` per image, whose every `--build-arg`
    and `ARG` is emitted from `instance-build-inputs.ts` rather than written.

  The admin files are written only when the admin member is. The topology is recorded in no
  file and read back by nothing: it selects which examples are written and the machine layout
  stays the client's.

  `nextSteps` now takes an optional third argument, the topology, and prints one additional line
  under `three-host`. `PlanInput` gains a required `topology`; `NewInstanceOptions` gains an
  optional `topology` string.

  Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §3, under
  owner ruling D-230.

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

- 5b808ea: `endora new instance` names the per-layer builds in the tree it writes. The root manifest gains
  `build:backend`, plus `build:admin` and `build:docs` for the members that were written, and the
  composite `build` is now the conjunction of exactly those entries — same value as before, in the
  same `backend, admin, docs` order, derived from one list rather than spelled a second time.

  Under D-230 the backend, the admin and the storefront are deployed to hosts of their own, on
  schedules of their own; a CI job on the admin host could not cite a command it had never been
  told, because the per-member commands existed only inside the composite's value.

  The emitted `README.md`'s command block is now rendered from the root manifest's own `scripts`,
  so it names every command the tree declares and no command it does not — `dev`, `module:status`
  and the three per-layer builds were all absent from it before.

  Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §2 R2.1.

- c63d640: `endora new instance` writes a documentation member, and `endora generate` renders its
  artefacts.

  **New exports.** `@endora-commerce/cli/lib/docs-artefacts.js` carries the documentation
  renderers — `docsRegistryOf`, `renderDocsSidebarFrom`, `renderModuleMapFrom`,
  `renderModuleReferencesFrom`, `collectDocsIntoSiteFrom`, `installedDocsModules` and the
  emitters underneath them. They were `backend/scripts/generate-composer.ts`', which no client
  can reach; the population is now a parameter and one program serves both hosts, exactly as
  `lib/admin-artefacts.js` does for the admin pair. `lib/module-packages.js` gains
  `publishedManifestEntryOf`, and `new-instance/docs-toolchain.js` exports `DOCS_TOOLCHAIN`.

  **Changed signature.** `runGenerate` is now `async` and returns
  `Promise<GenerateResult>`; the result gains `omitted`, `collected` and `swept`. A caller
  awaiting it needs no other change. An instance with an admin project but no documentation site
  — or the other way round — is now an **omission** the command names rather than a refusal; only
  a tree with neither member exits 1.

  **New behaviour.** A scaffolded instance gains a `docs/` member (four files: the manifest, a
  Docusaurus configuration, a sidebar and an intro page), the root `generate` script becomes
  `endora generate` rather than a forward to the admin member, and `build` reaches every member.
  `GENERATED_TREES` names the directories a client's `.gitignore` has to cover.

- ee80d6b: The divergence report can be rendered for an instance.

  `@endora-commerce/cli/lib/divergence.js` and `@endora-commerce/cli/lib/divergence-artefacts.js`
  are new subpaths carrying the derivation, the two renders and the assembly between them; they
  were `backend/scripts/lib/divergence.ts` and `backend/src/overlay/divergence-report.ts`, which
  no consumer outside this repository could reach.
  `@endora-commerce/cli/lib/registration-owners.js` moved with them.

  `endora generate` now renders `apps/<deployment>/divergence.generated.md` and `.json` beside
  the three artefacts it already wrote — one per deployment the instance holds. **Unlike the
  other three it is committed**: it is derived from the deployment's own overlay tree and its
  `divergence.ts`, so it is a fact about the client's repository rather than about their install,
  and the diff is where an upgrade that changes behaviour they depended on shows up.

  New exports on `lib/divergence-artefacts.js`: `renderDivergenceArtefacts`, `instanceComposition`,
  `readDivergenceDeclaration`, `seamsFromKernel`, `overlaySourcesUnder`, `walkAnalysableSources`,
  `overlayTreeSpellsASeamCall`, `INSTANCE_BOUNDARY_NOTES`, `unreadableCompositionReason`, and the
  two default artefact headers. `lib/port-registrations.js` gains `rootRegisteredNames`, the
  composition root's own registration spelling — `registerValues(container, { … })`,
  `container.register({ … })`, `composedModules.contribute({ … })` — which is a different
  predicate from `registeredNames` and is what tells _a root registers it_ from _nobody
  registers it_. `DivergenceInput` gains two optional fields, `hostNotRecorded` and
  `declarationPath`, both defaulting to what the derivation did before. `serializeDivergenceModule` and `renderDivergenceMarkdown` each
  take an optional trailing `header` argument; both default to what they emitted before, so no
  existing call changes what it produces. `lib/module-packages.js` gains
  `scanInstalledPlatformPackage`.

  An instance's report records all nine kinds exactly as this repository's does. What it cannot
  derive — the module behind a container name a composition root registers on that module's
  behalf — is written into the report's own `boundary.notRecorded` rather than left silent.

- a71344d: `endora new instance` writes the admin member, and `endora generate` renders what it is built from.

  **`@endora-commerce/cli`** — two new surfaces and one moved one.
  - `endora generate` is a new command. Run anywhere inside a scaffolded instance, it renders the
    admin contribution registry and the admin stylesheet enumeration over the module packages that
    instance installed, and reports every candidate the discovery excluded. Programmatically:
    `runGenerate({ cwd, dryRun })`, with `generateReport`, `findInstanceRoot`, `artefactIsCurrent`,
    `GenerateInputError` (exit 1) and `GenerateHostError` (exit 2).
  - `endora new instance` now writes `admin/` — `package.json`, `tsconfig.json`, `index.html`,
    `vite.config.ts`, `src/main.tsx` and `src/index.css` — and the workspace, the root scripts and
    the `.gitignore` follow. The member is still omitted, in the same grammar, when
    `@endora-commerce/admin-shell` or `@endora-commerce/admin-kit` does not resolve, or when a range
    one of them should have declared is not there; the omission now names which.
  - `@endora-commerce/cli/lib/admin-artefacts.js` and `@endora-commerce/cli/lib/tailwind-sources.js`
    are new module specifiers. They hold the two artefacts' renderer, which this repository's
    `composer:generate` and a client's `endora generate` now share; the emitted bytes are unchanged.

  **`@endora-commerce/admin-shell`** — `AdminRoot` is a new export: the four wrappers `App` has to be
  mounted inside, which a project used to have to reproduce. Three of the four are this package's
  requirements rather than the project's, `unstable_useTransitions={false}` most of all — without it
  every module screen's URL changes and the outlet does not, with no error anywhere. `App`,
  `AuthProvider` and `registerAdminServiceWorker` are unchanged and still exported.

  The package now declares `vite`, `@vitejs/plugin-react`, `tailwindcss` and `@tailwindcss/vite` as
  **optional** peer dependencies. Nothing is required of an existing consumer that already has them;
  what they add is a statement, readable by a tool, of what kind of application a host that mounts
  this shell is.

  **`@endora-commerce/mod-settings`** — `ConfigurationReferenceInput` loads
  `@endora-commerce/mod-credentials`' preview modal lazily. `credentials` is an optional peer, so an
  admin bundle built in a tree that did not install it previously failed at build time on a named
  import of an unresolved stub, taking every module's screens with it over one button. The render was
  already gated on the module's presence and is unchanged.

- 3411727: `relativeLinksIn` now reports whether a link left the modules category.

  `RelativeLink` gains `leavesCategory: boolean`. `docId === null` alone did not
  say this: a link that climbs above the category (`../architecture/x.md`) and a
  link that resolves to the category root both came back with no doc id, and a
  consumer could not tell them apart. The first names a page only the host
  repository's own site tree has and is broken in every instance; the second names
  a page the generator writes into every instance.

  Consumers reading the field: none is required to. Existing code that reads
  `target` and `docId` is unaffected; code that constructs a `RelativeLink`
  literal must add the field.

### Patch Changes

- 670851a: `endora new instance` declares each `@endora-commerce/*` package at **that package's own**
  version, not at the platform's.

  Every module entry in the scaffolded root `package.json` was written as `^<platform version>`.
  That is correct only while a release moves every package together, and a release does not: of the
  packages published on 2026-09-11, 68 moved to `0.8.0` and 15 to `0.7.1`. A tree scaffolded from
  such a release asked a registry for a version that does not exist, and the first `pnpm install`
  in it failed:

  ```
  ERR_PNPM_NO_MATCHING_VERSION  No matching version found for @endora-commerce/mod-addresses@^0.8.0
  The latest release of @endora-commerce/mod-addresses is "0.7.1".
  ```

  The version now comes from the manifest of the package the command **resolved beside the target
  directory** — the same manifest, on the same install, that the platform will read when it composes
  that instance — so the tree a client gets back is pinned to what they already have. Nothing about
  the platform entry changes: it was, and remains, `^` over the platform's own version.

  **Regenerate a scaffolded instance, or edit its root `package.json`.** A tree written by an earlier
  build carries one range per module that may name a version its package never published; the ranges
  are the only affected file, and every other entry in the manifest is unchanged.

- Updated dependencies [10a17f0]
- Updated dependencies [471defd]
- Updated dependencies [c1d281f]
- Updated dependencies [52c2bfd]
  - @endora-commerce/contracts@0.9.0

## 0.8.0

### Minor Changes

- 77772dc: New shared library `@endora-commerce/cli/lib/delegated-composer.js`: _"this
  composition root does not compose, it hands its composition to somebody — where is
  that somebody's source?"_

  A composition root used to be one file. Since feature 109's Phase 1c
  `backend/test/helpers/test-server.ts` supplies a `PlatformComposition` and
  `@endora-commerce/test-kit/server` performs the composition — `registerValues`,
  `composeModules`, the two Redis clients, the contribution window, the boot phase,
  `buildServer`. Every instrument whose subject is _what a root supplies_ therefore has
  to follow the delegation or start measuring half a composition, and the failure is
  silent in the worst direction: it reports the delegating root as registering nothing.

  Measured on the merge request that made the harness the kit's first caller,
  `check:port-dependencies` reported **16 root issues** — `redis`, `eventBus`,
  `commandBus`, `apiInterceptors`, `resolvedModuleRegistry` and eleven more "registered
  by production only" — every one of them a name the harness composition does register.
  Both remedies it printed were wrong: a `ROOT_DIVERGENCE_ALLOWED` entry states that the
  two compositions genuinely differ on that name, and _"register it in both roots"_ asks
  for something already done.

  `delegatedComposerOf(rootSource, rootPath, repoRoot, binding)` follows the specifier a
  root imports `binding` from back to that composer's **source** directory — through the
  workspace member's own `exports` map and its `tsconfig.build.json` emit layout, so no
  package name, no `dist` and no `src` is written down (D-100), and reading the artefact
  cannot hold a run to the previous build (D-164). `delegatedSupplyFields` reads which
  option field that composer spreads into its own `registerValues`, and
  `delegatedSuppliedNames` collects the names a root hands over through it — because a
  delegating root supplies its host values as _data_, which no call-shape reader sees.

  Five refusals, each an exit-2 for its caller rather than an empty answer, with
  `delegationRefusalMessage` writing the sentence: the binding is imported by nobody, no
  workspace member owns the specifier, the package declares no such subpath, no source
  under its `rootDir` emits the target, and the composer's directory holds no source.

- 211060c: `platform-surface` gains a second consumer population: the application's own
  relative reaches into the host package.

  The rule was already _a reach into the host names a published subpath or a
  declared host-internal one, never a file inside the package by relative path_.
  It was asked of **modules** only, and the consumer that writes the most such
  reaches — the application — was outside the population by construction:
  `moduleIdOf` answers `null` for every one of its files, so a `violations=0` was
  honest about a population that did not contain them. On this repository's tree
  that hid 84 reaches, every one of which resolves in the checkout and in no
  instance built from published packages.

  New exports on `@endora-commerce/cli/rules/platform-surface.js`, all additive:
  - `scanApplicationReaches(input)` and `checkApplicationReaches(input, ledger)` —
    the pure analysis, over source text, file keys, barrel-derived surface and the
    two platform roots, so a fixture enters where a run does;
  - `canonicalPlatformFile(joined, input)` — the canonicalisation. It drops the
    member-relative path's **first segment**, whatever it is, and re-roots the
    remainder at the platform's source root, so `dist/x.js` and `src/x.ts` are one
    key and the word `dist` appears nowhere in the analysis;
  - `applicationReachRefusal({ canonicalTargets, applicationFiles })` — the two
    exit-2 refusals this half owns, both of which fail in the direction that
    produces a clean result;
  - `hostReachCoverage(ledger, onDisk, opened)` — the `sources=host-reaches:<n>/<n>`
    floor, derived from the ledger rather than from a count, and `null` rather than
    `expected: 0` once that ledger empties;
  - `LedgeredHostReach` — `{ reason, retiredBy }`, with no `permanent` member: this
    ledger is expected to empty, and an entry saying "this reach is correct" would
    mean the predicate has outgrown its population.

  **Two changes to existing shapes, and both can break a consumer that writes the
  type rather than reading it.** `PlatformSurfaceFindingKind` gains
  `'relative-host-reach'`, so an exhaustive `switch` over it no longer covers every
  member; and `PlatformSurface` gains a required `publishedBy` field —
  `<target file>` to the barrels that publish it, the provenance the merge in
  `publishedSurface` was dropping. It is what turns a target into an address, so a
  remedy can name `@endora-commerce/platform/kernel` instead of saying only that
  the reach is wrong. A consumer that builds a `PlatformSurface` literal by hand
  adds the field; one that calls `publishedSurface` gets it for nothing.

  `PlatformSurfaceFinding` also gains an optional `publishedAs`, carried by the new
  finding and by nothing else.

  The estate entry for `check:platform-surface` gains a second `partial`,
  `application-host-reach`: an installed module package has no application tree, so
  this half has no subject there and is declared vacuous rather than counted zero.

  Normative: `specs/115-lifecycle-container-move/contracts/host-reach-check.md`.

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

- 51a5fae: Two derivations for an instance's build-time artefacts (`specs/110-instance-repository/`
  Phase 1).

  `installedModulePackages(instanceRoot)` and `scanInstalledModulePackages(instanceRoot)` answer
  "which module packages did this instance install" over a `node_modules` tree, alongside the
  existing `discoverModulePackages(repoRoot)`, which answers it over workspace members. Both
  produce the same `ModulePackage` shape and share one `exports`-map derivation of how an
  artefact names a file inside a package, so a generator can render the admin contribution
  registry and the documentation navigation over either population without a second
  implementation. A candidate whose real path leaves the `node_modules` it was reached through —
  a `pnpm link`, a `link:` dependency, a workspace member — is excluded and **reported**, which
  is the rule the running platform already applies.

  `INSTANCE_BUILD_INPUTS` (`@endora-commerce/cli/lib/instance-build-inputs.js`) declares the four
  per-instance build inputs — `DEPLOYMENT`, `API_DOMAIN`, `SALES_CHANNEL_CODE`, `DEFAULT_LOCALE` —
  with each input's meaning, example, default and the build argument each image reads.
  `buildArgFlags(target)` emits the `--build-arg` flags one image build takes.

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

- 304f6d8: **`@endora-commerce/platform` gains a `./lifecycle` subpath, and it is not public API** (D115-4; `specs/115-lifecycle-container-move/contracts/operator-half.md` §5).

  It carries `_lifecycle`'s operator surface — the orchestrator and its `LifecycleError`, the lifecycle lock, the dependency and gating graphs, the deactivation ledger, the manifest loader, the static registry, the presence loader, the module origin helpers, the module's own `registerModule`, `manifest` and admin routes. The set is derived rather than curated: it is exactly the fourteen platform-lifecycle files the application reaches today by relative path into `packages/platform/dist/`, so every one of those reaches has an address to be written as instead.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged, and `PUBLISHED_SUBPATHS` stays at five. `./lifecycle` joins `./composition` and `./migrations` as **host-internal**: declared by the `exports` map, so the host, its five `module:*` entry points and the test kit resolve it, and carried by no published barrel, so `check:platform-surface` reports a module naming it as `host-internal-subpath`. **No module may name it** — this surface drives the platform's presence axis, and a module that could name it could install, uninstall, enable or disable its siblings. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer, and leaves this one in the same merge request.

  `@endora-commerce/cli` publishes `HOST_INTERNAL_SUBPATHS` from `lib/platform-surface.js`: the host-internal class as a record of subpath → the reason it is not public API. It was a literal inside one assertion, then a bare set duplicated across two test files with the reasons in the prose of one of them. **If you enumerate the host's subpaths**, read `HostPackage.declaredSubpaths` for what the manifest declares and this record for which of them are host-internal; the published five stay `PUBLISHED_SUBPATHS`. Nothing is removed and no signature changes.

- 39e17ce: `endora new instance <dir>` — the command that writes an instance repository.

  New export `runNewInstance(options)` from `@endora-commerce/cli`, with
  `InstanceHostError` / `InstanceInputError` (each carrying the refusal class its
  exit code is read off), `resolveInstanceHost`, `loadModuleCandidates`,
  `resolveModuleSet` and `planInstance`.

  It writes a workspace whose root `package.json` **is** the module list, a
  deployment directory and a backend member of entry points, and copies nothing —
  so unlike `endora new storefront` there is no rewriting step and no outward
  reference to repair. With no `--module` it writes the smallest set that composes
  (the modules whose manifest declares `activation.nonDeactivatable`, closed over
  the manifests' own `dependencies`); with `--module <id>` it writes that set
  unioned with its closure. `--deployment <name>` names the deployment directory,
  `--registry <url>` writes an `.npmrc` naming the scope with the token as an
  environment reference, and `--dry-run` reports every file, the resolved set with
  its closure and every omission while writing nothing.

  Everything it needs is derived from what a client's machine can see: the scope
  and `engines.node` from this package's own manifest, the ranges from the
  `@endora-commerce/platform` installed beside the target, the module manifests
  from the packages themselves. It refuses in eight classes — an occupied target,
  an uncomposable set, an unknown module id and a bad deployment name at exit `1`;
  an unreadable registry, an unresolvable platform version, an unreadable package
  manifest and an undeterminable CLI version at exit `2`.

  The admin member and the host CLI dispatcher are reported as omissions rather
  than written: the first is `contracts/instance-tree.md` §2.4's, the second has no
  published entry point until that feature's Phase 2 lands.

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

- aa0a556: `declaredVariablesOf(storefrontDir)` — every variable a storefront's own process reads,
  off its own declaration.

  **Why a third derivation over the same file.** `backendAddressVariablesOf` and
  `storefrontAddressVariablesOf` answer _which of these names a member_, a subset chosen by
  `addressOf`. This one is the whole population, scoped with `scopeToMembers` to the member
  that runs there, and it is for a caller that **spawns** a storefront's toolchain rather
  than one that configures it.

  That caller exists, and the reason it needed this is worth stating: Next loads a `.env`
  and does **not** override a variable the process already carries. So any of these names
  present in a parent's environment silently displaces the value written into the copy's own
  `.env` — and a harness that passed its environment on wholesale measures its own
  configuration while reporting on the command's.

  ```ts
  import { declaredVariablesOf } from '@endora-commerce/cli';

  const declared = await declaredVariablesOf('/tmp/instance');
  // -> the names this storefront's process reads, in declaration order
  ```

  The measured case was `NODE_ENV`. `endora new storefront`'s acceptance criterion inherited
  its own environment into the instance's install, build and boot; a CI job set
  `NODE_ENV=development` job-wide and correctly, for the **backend** it booted; and
  `next build` inlines `process.env.NODE_ENV` as `"production"` into the server bundle it
  emits while the render worker reads the real one — two copies of Next's vendored pages
  runtime, two `React.createContext()` calls, and an `<Html>` looking for a provider
  installed on the other one. The build failed with
  _"`<Html>` should not be imported outside of pages/\_document"_, which names nothing true,
  in every CI run that criterion has ever had. Nothing of this repository's is involved: a
  four-file `app/` fails identically. What the repository _can_ do is stop handing a client's
  build an environment that is not the client's, and this is the derivation that makes the
  population the storefront's own declaration rather than a list of variable names somebody
  maintains.

  Additive. No existing export changes shape.

- 9e00c89: Publish the two derivations a caller needs to supply `endora new storefront` with
  the inputs it requires.

  Since the storefront's invented defaults went, the command resolves five required
  inputs in four tiers and refuses a non-interactive run that supplies none. A
  caller that has to _supply_ them needs the same population the command will
  _demand_, and deriving it a second time is two answers waiting to disagree —
  which is how this repository's own acceptance criterion came to invoke the
  command with no inputs at all.

  Three additions, all additive:

  ```ts
  import {
    storefrontDeclaredInputs, // the reference storefront's declaration,
    // scoped to the one member the command writes
    envExampleDeclarationsOf, // every declaration that copy's `.env.example` makes
    flagFor, // SESSION_COOKIE_SECRET -> --session-cookie-secret
  } from '@endora-commerce/cli';

  const declared = await storefrontDeclaredInputs(repoRoot);
  const example = envExampleDeclarationsOf(referenceDir);
  const argv = [flagFor('BACKEND_BASE_URL'), example.get('BACKEND_BASE_URL')];
  ```

  `storefrontDeclaredInputs` deliberately does not filter by requirement:
  `isRequiredGiven` reads a conditional requirement against the values a run has in
  hand, so which inputs are required is a property of the invocation rather than of
  the declaration.

  `envExampleDeclarations` / `envExampleDeclarationsOf` are the parser
  `backendAddressVariables` already ran, now named and exported —
  `backendAddressVariables` is defined over it, so the two questions asked of that
  file cannot come to disagree about what it says. One behaviour changes at the
  edge: a key whose **last** assignment is blank is no longer a declaration, in
  either answer. That matches `inputs/env-file.ts`, where a blank value does not
  resolve an input.

- d79a89f: `endora new storefront` now tells its author which variables the copy reads to find a
  backend, and exports the derivation that answers it.

  The step used to read _"set `PUBLIC_API_BASE_URL` (and the rest of `.env.example`) to the
  backend this storefront talks to. Nothing in the copy points at a backend."_ Both
  sentences were wrong. `PUBLIC_API_BASE_URL` is the **backend's** own variable — the public
  origin its payment-gateway callbacks are built from — and no file in the storefront has
  ever read it; and the copy does point at a backend, because every fetcher falls back to a
  compiled-in `http://localhost:3001` when the environment names none. So an author who
  followed the step had a storefront quietly talking to that address, with no error
  anywhere to say so.

  The step now names the variables the copy declares in its own `.env.example`, says that
  the fetchers fall back rather than refuse, and says which of them Next inlines at build
  time so they are set before `pnpm run build` rather than after.

  **New exports**, for a consumer that needs the same answer — the acceptance criterion for
  this command is the first:
  - `backendAddressVariables(envExampleText: string): readonly string[]` — every
    declaration whose value is an absolute `http(s)` URL, in declaration order. Pure over
    text.
  - `backendAddressVariablesOf(storefrontDir: string): readonly string[]` — the same answer
    read off a directory; a storefront with no `.env.example` answers with nothing rather
    than refusing.
  - `ENV_EXAMPLE_FILE` — the file name both read.

  Nothing is removed and no existing signature changes.

### Patch Changes

- 03dec57: `HOST_INTERNAL_SUBPATHS` gains `packages` and `overlay`, each with the sentence saying why it
  is not public API (`specs/110-instance-repository/` T113 and T114). Every consumer of
  `@endora-commerce/cli/lib/platform-surface.js` derives the two classes from this record, so
  `check:platform-surface`, `published-surface.test.ts` and `host-package.test.ts` all follow
  without a second list. `PUBLISHED_SUBPATHS` is unchanged: nothing became public API.
- 9eb0cb6: The static-check estate manifest gains `check:demo-data-budget` —
  `specs/113-module-owned-demo-data/` FR-016, a per-module budget on shipped non-`.ts` demo
  assets.

  `scope: 'package'`, tier `A`: a module's demo layer is located from that module's own
  manifest artefact and measured in that module's own source tree, so nothing about the
  answer needs a sibling, an owner map or an application.

  Its `host` is `pending`, and the phase is named rather than numbered because what a
  package-scope host waits for is neither of tier B's two halves. It is a **relocation**:
  _"does this file ship"_ has exactly one owner since D-218 —
  `scripts/lib/runtime-assets.mjs`' `classifyAssetFile`, the same function
  `copy-package-assets.mjs` and the manifest generator ask — and that file sits at the
  repository root, outside every package. A host here cannot reach it without a second copy
  of the classification, which is precisely the defect D-218 closed.

  Two `partial` signals are declared: the accepted per-module floors are this repository's
  ledger, and `undeclared-demo-assets` probes layer paths derived from _other_ modules'
  declarations, neither of which a lone package supplies.

- f05592f: `endora new instance` writes a backend that compiles.

  The template named three platform symbols that no barrel exports, three times each, so every
  scaffolded tree failed `tsc` on two of its ten backend files — a tree a client is meant to own
  and never to have written:

  ```
  src/mikro-orm.config.ts: TS2305 '@endora-commerce/platform/composition'
      has no exported member 'configuredEntities'.
  src/mikro-orm.config.ts: TS2305 '@endora-commerce/platform/composition'
      has no exported member 'configuredMigrations'.
  src/module-commands/runtime.ts: TS2724 '@endora-commerce/platform/lifecycle'
      has no exported member named 'resolvedManifestEntries'.
  ```

  The ORM configuration is now `configuredEntitiesFrom`, `discoverConfiguredMigrations` and
  **`mikroOrmConfigFrom`** on `@endora-commerce/platform/db` — the third name matters as much as
  the two corrected ones, because the file it replaces built its own `defineConfig`, which
  compiles and then creates tables under MikroORM's default naming with no `Migrator` extension
  registered: a tree that would have type-checked and failed at the first `pnpm run migrate`.
  The operator runtime assembles the `ManifestSources` that `resolveManifestEntries` takes, with
  `core: []` — an instance ships no generated manifest index, so its modules are its deployment's
  overlay modules plus the packages it installed — reaching `activeOverlayModulesRoot`,
  `overlayModuleIdsUnder` and `overlayModuleManifestsUnder` on `./overlay` and
  `discoverPackageModuleManifests`, `installedPackageModuleIdClaims` and `nodeModulesRootsFor` on
  `./packages`. It is the same shape the platform's own `defaultComposition` assembles.

  **If you scaffolded an instance with an earlier build**, re-scaffold into an empty directory and
  copy across `apps/<deployment>/` and any edits of your own, or replace those two files with the
  ones a current `endora new instance --dry-run` prints. Nothing else in the tree changed.

  The guard is `packages/cli/test/new-instance/template-reconciliation.test.ts`, which reconciles
  every platform name the template writes against the barrel carrying the subpath it writes it on.
  It is at symbol granularity deliberately: `./composition` and `./lifecycle` are both declared
  subpaths, so a reconciliation of the specifier alone passes over all three of the errors above.

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
