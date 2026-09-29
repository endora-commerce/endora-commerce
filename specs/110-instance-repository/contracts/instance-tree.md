# Contract — the tree `endora new instance` writes

**Normative for** `specs/110-instance-repository/` FR-001…FR-004, FR-010, FR-012, FR-020, and for
`contracts/instance-repository.md` §5, which this file makes file-level.
**Created** 2026-09-05. **Measurements**: `research.md` §7, re-derived on `master` at `5d365a32a`.
**Published** 2026-09-29 under D-247's option A (129 T035), alone of its directory: it is the other
side of `packages/cli/test/new-instance/manifest-reconciliation.test.ts`, which a public tree has to
be able to run. The rest of `specs/110-instance-repository/` stays in the pre-migration record, so
the citations to it here are provenance rather than links.

**What this adds to `instance-repository.md`.** That contract says what an instance *is* — six
rows of a table — and `cli-product.md` says what the *tool* must be. Neither says which files
exist, what is in them, where each value comes from, or what the command refuses. A scaffold
specified at the granularity of *"the backend entry points — a thin `index.ts`, `worker.ts` and
`cli.ts`"* is a scaffold three implementers write three ways.

---

## §1 — The shape, and the one rule that generates it

**R1.1** Every file the command writes is one of exactly three kinds, and the kind is what
decides whether it may exist at all:

| Kind | Rule |
| --- | --- |
| **the client's own** | a value only they can supply, or code they will edit. Written once, never regenerated, never read by us again |
| **wiring** | the smallest expression that hands the platform something it cannot derive: a database handle, a root directory, a process's argv. Bounded by R1.4 |
| **derived** | rendered from a fact the platform or the module set already holds. Written by a generator the instance runs, and **never committed** |

**R1.2 A file that is none of the three may not be written.** That is the whole test, and it is
what refuses the fork one file at a time: a composition root is not the client's (it is ours), is
not wiring (it is 2 628 lines), and is not derived (nothing generates it). `instance-repository.md`
R2.4 states the same refusal for that one file; this is the rule it is an instance of.

**R1.3** The command writes **no** copy of anything under `instance-repository.md` R2.2 and **no**
outward reference (R1.5 there). Under D-207 nothing is copied, so — unlike `endora new storefront`
— there is nothing to rewrite, and a rewriting step appearing in this command is evidence that
something was copied that should not have been (NFR-002).

**R1.4 Wiring is bounded and the bound is asserted, not intended.** The whole of the wiring the
command writes is **under 250 lines**, and the acceptance criterion counts it (A13). The bound
exists because "thin entry point" is exactly the phrase under which a second composition root
grows: the file that is 40 lines at scaffold time and 900 lines two features later is how Magento 1
ended up with core in every shop's repository, which D-207 cites as the decision already taken
against.

---

## §2 — The file manifest

Every path is relative to `<dir>`. **`kind`** is §1.1's. **`source`** is where each value comes
from; a value with no source is one the command would have to invent, which R2.5 of
`cli-product.md` forbids.

### §2.1 — the workspace root

| Path | Kind | Content and source |
| --- | --- | --- |
| `package.json` | derived + client's | `name` from `<dir>`'s basename; `private: true`; `packageManager` from the CLI's own declaration; `dependencies` = `@endora-commerce/platform` + the resolved module set (§3), each at `^<version>` taken from the platform version being installed, **plus the packages those modules declare optional** (§2.4); `devDependencies` = the platform's four peers (`@mikro-orm/core`, `@mikro-orm/postgresql`, `fastify`, `zod`) plus `@mikro-orm/migrations`, `tsx`, `typescript`; `scripts` = §2.5 |
| `pnpm-workspace.yaml` | wiring | the two members (§2.3, §2.4). **One list, one place** — `instance-repository.md` R5.4 |
| `tsconfig.json` | client's | standalone. **No `extends` above `<dir>`** (R1.5 there) |
| `.npmrc` | wiring | written **only** under `--registry`: the scope line and the endpoint, token as `${ENDORA_NPM_TOKEN}`. Never a token. `new-storefront/npmrc.ts` is the writer and is reused verbatim (R5.7) |
| `.env.example` | client's | **everything this instance reads from its environment** (`specs/123-oss-install-experience/` FR-010): one entry per `INSTANCE_BUILD_INPUTS` member (T103's declaration), each with the meaning and the example that declaration already carries and **no default where the declaration's is `null`**, then one entry per input the **resolved platform** declares (`PLATFORM_ENVIRONMENT_INPUTS`) unioned with the `env` of every module manifest this run installed — each carrying that declaration's own `describes` and its `requirement` sentence, neither rewritten. Scoped to the members this run writes (`specs/118-instance-member-selection/`), and a `generable` secret appears here in **no** case: it is in `.env` instead (R2.5d) |
| `.env` | client's | the instance's own configuration, written by the command: the secrets it generated filled in, a blank for every other declared input, and a `.env` the operator placed there first merged into rather than rewritten. Git-ignored, so it leaves this tree with nobody but them having seen it. It exists so that the file a client edits is the file their instance reads — `cp .env.example .env` after this command has run would overwrite the generated secrets with empty strings |
| `.gitignore` | derived | the four generated artefacts (§2.6), `node_modules`, `dist`, `.env` |
| `compose.dev.yml` | derived | the backing services this instance needs on a **development** machine — PostgreSQL, Redis, Meilisearch and a mail catcher — runnable as written: `docker compose -f compose.dev.yml up -d --wait`. Rendered from the **same** service catalogue `deploy/compose.prod.yml` is (`packages/cli/src/new-instance/deploy.ts`'s `services()`, in its `development` mode), so no second statement of what Endora needs to run enters the tree. Every `${NAME}` it expands carries an inline default, so it works in a tree whose `.env` has never been opened; it publishes a host port per service, because the application members run natively from this workspace; and it holds no application service. It is **not** under `deploy/` and **not** at one of Compose's four default filenames — a bare `docker compose up` in this tree finds nothing. Normative: `specs/125-first-mile-install/spec.md` §4.1 (FR-100…FR-112) |
| `README.md` | client's | what this tree is, what it depends on, **the commands the root manifest declares** — every one of them and no other, rendered from §2.5's own `scripts` so the block cannot name a command the tree lacks or omit one it has — and `endora new storefront` as the next step (R3.4) |

**There is no `endora.config.ts` and no module list file.** `spec.md` §5 is the argument; the
`dependencies` above **are** the list (`instance-repository.md` R1.2).

### §2.2 — the deployment

| Path | Kind | Content |
| --- | --- | --- |
| `apps/<deployment>/divergence.ts` | client's | the empty declaration — `{ omittedModules: [], decorationOrder: {}, reasons: {} }` — written **out in full with its doc block**, for `backend/src/apps/example/divergence.ts`'s stated reason: *"the mechanism is easier to find than to remember … a field an author never sees is a field they never learn they have"* |
| `apps/<deployment>/modules/.gitkeep` | client's | the directory an overlay module goes in, present so the answer to *"where do I put my own code"* is visible before the question is asked (`instance-repository.md` §8 R8.3) |

`<deployment>` is `--deployment <name>`, defaulting to the workspace name. It is `DEPLOYMENT`'s
value and nothing else reads it.

**The deployment's third file is generated and is not in this table** (T138a).
`pnpm run generate` writes `apps/<deployment>/divergence.generated.md` and `.json`, derived from
the two rows above; it belongs to §2.6 and its row is there. `endora new instance` does not write
it, deliberately: on the first run there is nothing to derive but the statement that this
deployment diverges by nothing, and putting a generated file in a manifest of authored ones would
be a row this table's own reconciliation
(`packages/cli/test/new-instance/manifest-reconciliation.test.ts`) is right to call `unwritten`.

### §2.3 — the backend member

| Path | Kind |
| --- | --- |
| `backend/package.json` | derived — the member's own name and its `scripts`; **no dependency of its own**: the module set is the root's |
| `backend/tsconfig.json` | client's, standalone |
| `backend/src/index.ts` | **wiring** — port, `SESSION_COOKIE_SECRET`, trusted-proxy parse, `composeApp()`, listen. The shape of `backend/src/index.ts` in this repository, which is already 114 lines and already reads only environment |
| `backend/src/worker.ts` | **wiring** — 61 lines here |
| `backend/src/cli.ts` | **wiring** — the operator CLI. Five lines: `runCli({ deploymentRoot })` over `<scope>platform/cli`. It was this table's one **omitted** row until `specs/123-oss-install-experience/` G2, on the reason *"the demo layer around it is exported under no subpath"* — discharged by moving `backend/src/cli/demo-command.ts` into `<scope>platform/demo` and the dispatch itself into `<scope>platform/cli`, rather than by widening the `exports` map |
| `backend/src/mikro-orm.config.ts` | **wiring** — `DATABASE_URL` and the platform's `mikroOrmConfigFrom()`. The one file that has to exist because *"a bin has no ORM configuration and cannot get one"* (`specs/115-lifecycle-container-move/` §3) |
| `backend/src/migrate.ts` | **wiring** — the entry point `pnpm run migrate` runs. It is not `mikro-orm.config.ts`: that file is a *configuration* an ORM reads, and something has to open it and call the migrator |
| `backend/src/module-commands/runtime.ts` | **wiring** — the `OperatorRuntime` the five commands below share. One file rather than five copies of the same fifteen lines, and it is the manifest-sources assembly `resolveManifestEntries` needs, which no `module:*` verb differs about |
| `backend/src/module-commands/{install,uninstall,enable,disable,status}.ts` | **wiring** — five ~20-line entry points over `OperatorRuntime`, exactly the shape `specs/115-lifecycle-container-move/contracts/operator-half.md` §2 defines and this repository's own five will hold after that feature's Phase 5 |

**Two rows above were missing and one named symbols that do not exist**, recorded here rather
than quietly corrected (T137, measured on a real run 2026-09-11 and again 2026-09-12).
`backend/src/migrate.ts` and `backend/src/module-commands/runtime.ts` are written by the
command and were in no list — the omission was this table's rather than the design's, in
exactly the shape §2.4 records for the admin member's `package.json` and `tsconfig.json`. And
`configuredMigrations()` / `configuredEntities()` were never the platform's names: the
template's own header said so while the text above repeated them, the repair in Phase 4's audit
note is `mikroOrmConfigFrom`, and a contract naming a symbol nothing exports is a contract an
implementer follows into a compile error.

**`composeApp` is imported, never written** (R1.2). Until 110 T118 splits `composition.ts` there
is nothing to import it from, which is §4's prerequisite and the reason A4 is red on purpose
rather than absent.

### §2.4 — the admin member

**Written, since T138.** `@endora-commerce/admin-shell` is published and Phase 3 is complete, so
the premise the first landing stood on — *"the shell does not exist"* — has expired. What the
member is:

| Path | Kind | Content and source |
| --- | --- | --- |
| `admin/package.json` | derived | the member's own name and its `scripts` (§2.5); `dependencies` = the shell, the design system, `react` and `react-dom`; `devDependencies` = `@endora-commerce/cli` and the four build tools. **No module**, ever — R3.6 |
| `admin/tsconfig.json` | client's | standalone. It declares `"@/*"`, which is what locates this project for the generator; renaming it moves both artefacts, deleting it leaves the generator with nothing to write to |
| `admin/index.html` | client's | the document the bundle mounts into, and the client's to brand |
| `admin/vite.config.ts` | client's | two plugins and a port. Build-tool configuration, exactly as `backend/tsconfig.json` is |
| `admin/src/main.tsx` | **wiring** | `createRoot(...).render(<AdminRoot contributions={…} />)`. The registry is the one fact the shell cannot derive (R3.2) |
| `admin/src/index.css` | client's | three imports and the override slot, in that order — `admin-stylesheet-composition.md` R2.3, R3.1, R3.4 |

**Why an omission is still the answer when a package is absent, and never a refusal.** The owner's
subject is a *backend* instance, and a command that refused to write one until an unrelated package
existed would be a command nobody could use to find out whether any of this works. **Why not
silence**: `instance-repository.md` R8.2's reasoning one surface over — *"a module that is simply
not there is indistinguishable from a module nobody installed"* — and a client who does not know
they have no operator interface spends their first hour looking for one. There are two ways to
reach the omission and they are reported apart: the shell or the kit does not resolve, or a range
one of them should have declared is not there (R2.5a — the sentence names the range).

**Three nouns in the paragraph this replaces did not describe the tree**, recorded rather than
quietly dropped. **`admin/tailwind.config.ts` does not exist** anywhere: Tailwind v4 has no
configuration file, and its `@theme` and `@source` are CSS, so `src/index.css` is where §2.4's
*"theme overrides"* live. **`package.json` and `tsconfig.json` were not in the list** and a
workspace member is neither without them — §2.3 lists both for the backend, so the omission was the
list's rather than the design's. And **the brand assets are not written**: a logo, a favicon and a
PWA icon set are exactly the values `cli-product.md` R2.5 says a command may not invent, so
`admin/public/` is the client's to create and `index.html` says so in place. The entry point
therefore does **not** call `registerAdminServiceWorker`, which would register an asset the tree
does not serve.

**The optional peers go in the root manifest, not here** — and it is a mechanical fact rather than
a preference. pnpm resolves a package's peers from its **dependent's** context; a module package's
dependent in an instance is the root, because the module set is the root's (R3.6). So an optional
peer declared in this member satisfies nothing: measured on the acceptance criterion's own tree,
`mod-invoices`' `@endora-commerce/page-builder-admin` stayed unresolved with the package installed
and declared one member over, and Vite bound the import to an `__vite-optional-peer-dep:` stub
whose every named export is missing — which takes out the whole admin bundle. Declaring the module
set a second time here would satisfy them and is the one thing R3.6 forbids.

**Which packages those are is derived, from `peerDependenciesMeta`.** `manifests:generate` marks a
peer optional *"when every non-test reach into it came from a UI layer"* (FR-022), which says
something exact about the other consumer: an admin project composes those UI layers, so for an
admin project the optional peers are **required**, and they are the only statement in either tree
of what an admin host must have. The walk starts at the packages the member mounts and follows
their `@endora-commerce/*` peers. A module package is never collected — the module set is the
root's, and a module peering on a module the client did not install is a module set that is short,
which Vite says loudly.

*"The theme tokens"* stood here until 2026-09-07 and was the wrong noun: the
token **declarations** are the design system package's and the instance holds redeclarations of the
values it changes — `admin-stylesheet-composition.md` R3.1 and R3.4, `spec.md` §6.4.

### §2.4a — the documentation member

**Written, since T137.** §2.6 has listed *the documentation registry* among the three artefacts
an instance generates since this contract was written, and the `.gitignore` the command emits
has named `docs/sidebars.modules.generated.js` since the command landed — while §2 listed no
member that would hold either. A client installs thirty module packages, every one of them
shipping its own `docs/` layer inside its tarball (feature 100, `module-documentation-layer.md`
R1.2), and until this member existed there was nowhere for a human to read one.

| Path | Kind | Content and source |
| --- | --- | --- |
| `docs/package.json` | derived | the member's own name and its `scripts` (§2.5); `dependencies` = `@docusaurus/core` and `@docusaurus/preset-classic`; `devDependencies` = `@endora-commerce/cli`. **No module**, ever — R3.6, exactly as for the admin member |
| `docs/docusaurus.config.js` | client's | the site's title, URL and navbar, which are theirs to brand. Build-tool configuration, exactly as `admin/vite.config.ts` is |
| `docs/sidebars.js` | client's | their navigation, with **one** generated category in it. `admin/src/index.css`'s shape rather than `admin/src/main.tsx`'s: the file is the client's and one line of it names a file a generator writes |
| `docs/docs/intro.md` | client's | the page the site opens on |

**Three things that look like detail and are not.**

**`.js` and not `.ts`, for both configuration files.** Docusaurus reads either. A TypeScript
configuration would put `@docusaurus/tsconfig`, `@docusaurus/types` and
`@docusaurus/module-type-aliases` in the member's manifest — three more ranges this command
would have to find a source for (R2.5a) in order to write two object literals — and a
`tsconfig.json` beside them. `sidebars.js` is also the name `resolveDocsLayout` looks for, so
it is not a free choice.

**`onBrokenLinks: 'throw'` is load-bearing.** It is what makes a navigation entry naming a page
that is not there fail the build rather than serve a 404 nobody notices, which is the property
feature 100's own `build:docs` job exists for and the property A6 measures. A client who
removes it has a site that lies quietly.

**The ranges are declared and *reconciled*, and this is the one member whose ranges are not
read off a resolved manifest.** Every other range this command writes has an owner — the
platform's four peers are the platform's statement, the admin build tools are the shell's — and
**nothing in the estate owns a statement about Docusaurus**: no module package peers on it, the
platform does not, the admin shell does not. Two ways of inventing an owner were tried and both
were measured wrong. An **optional `peerDependencies` entry on `@endora-commerce/cli`**, which
is the shell's mechanism asked of the package that renders the navigation, is installed by pnpm
anyway — `auto-install-peers` is on by default, `packages/cli/node_modules/@docusaurus/`
appeared after one `pnpm install --frozen-lockfile` and 279 lines of lockfile moved with it, and
an instance's admin member declares this CLI, so every client with an operator interface and no
documentation site would have installed a documentation toolchain. A **`devDependencies`**
entry a consumer never installs would be a range this package neither builds nor tests with,
which is a statement nobody could check.

So it is `DOCS_TOOLCHAIN` in the CLI's own source, each entry carrying its reason, and
`docs-toolchain.test.ts` holds it **both ways** to the documentation site *this repository
builds*: the Docusaurus we ask a client to build their documentation with is the Docusaurus we
build ours with, and a bump on either side is red until it is a bump on both. That is what
R2.5a asks for — a range with a reviewer and an owner that can disagree with it — rather than a
value the tool chose. A name with no range is **not written and not guessed**: the member is
omitted, naming it, for the reason `devDependenciesFor` leaves one out.

**React is nobody's to declare here.** `@docusaurus/core` declares `react` and `react-dom` as
its own **non-optional** peers, and pnpm's `auto-install-peers` resolves those — the same
mechanism by which this instance's install already pulls in eight `@endora-commerce` packages
its manifest never names, which the acceptance criterion reports in a note. Declaring them in
this member would be a second spelling of a range `@docusaurus/core` already owns.

**The member is omitted, never refused**, on §2.4's reasoning verbatim: the owner's subject is
a *backend* instance, and a command that refused to write one until a documentation toolchain
had a range would be a command nobody could use. And not silently: a client who does not know
they have no documentation site goes looking for one.

**This member makes the workspace three, where `instance-repository.md` R5.4 says two.** That
is recorded rather than repaired here, because R5.4 is that contract's sentence and not this
one's. The *reason* it gives — *"two members because they build differently; one list because
they must not disagree"* — is satisfied by three: a Docusaurus site builds differently again,
and the module list is still the root manifest's and appears exactly once (R3.6). What has gone
stale is the **count**, and it was already inconsistent with §2.6's third artefact on the day
both were written. The owner's is the edit to R5.4.

### §2.5 — the scripts, and what each is

| Script | Runs |
| --- | --- |
| `migrate` | the platform's migrator over `mikro-orm.config.ts` |
| `generate` | `endora generate` — **one run renders every member's artefacts** (§2.6) **and the deployment's divergence report**, so this is the command itself and not a forward to a member. Two root scripts forwarding to two members would be two spellings of one run, and the binary is a root `devDependency` for exactly this reason. T138a added the fourth family and changed nothing about the script: the deployment is not a member, which is the other reason a per-member forward would have been wrong |
| `dev`, `build`, `start` | the member's own. `build` reaches **every** member, and each member's own `build` runs `endora generate` first: Vite, Tailwind and Docusaurus are all static builds, so a stale registry is a bundle with screens missing, a stale enumeration is a stylesheet with classes missing, and a stale navigation is a site with pages missing. Only the last of the three fails loudly, and only because `onBrokenLinks: 'throw'` makes it |
| `build:backend`, `build:admin`, `build:docs` | one member each, and `build` is their conjunction in that order. Under D-230 the three layers are deployed to hosts of their own, on schedules of their own, so each is built by a command of its own — a CI job on the admin host cannot cite a command it was never told. The two conditional entries are written on the **same** two predicates as the composite's terms (`admin.written`, `docs.written`) and never on a third. Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §2 R2.1 |
| `module:install` … `module:status` | the five entry points of §2.3 |
| `dev:services`, `dev:services:down` | the backing services a **development** machine needs, from the `compose.dev.yml` §2.1 writes — `docker compose -f compose.dev.yml up -d --wait` and its `down`. The `--wait` is not decoration: it blocks until every health check in that document passes, which is what stops `migrate` racing a Postgres that is still initialising. `down` keeps the volumes, a development database being not a scratch file. Normative: `specs/125-first-mile-install/spec.md` §4.1 FR-108 |
| `setup` | `generate && build && migrate && module:install --all`, **derived from those named entries** exactly as `build` is derived from the per-layer builds — each term is `pnpm run <name>` over a script this same manifest declares, so a change to what one of them runs reaches the composite with nothing edited. The four survive beside it: an operator who wants the steps still has them (FR-109) |
| `preview:admin` | the admin bundle `build:admin` produced, served — `pnpm -C admin run preview`, **only with the member**. The member has declared `preview` since it existed and no root script and no printed step named it, so a client who built the bundle had no command to look at it with (FR-110) |

An instance with **nothing to generate** gets no `generate` at all, rather than a script
that fails on a directory nobody wrote — and no `@endora-commerce/cli` in its `devDependencies`
either, that being a tool with nothing to run. One member absent is not that state: the
documentation site generates its own artefacts and the admin project generates its own. **And
since T065 a module installed is not that state either**: the entity index belongs to no member,
so the predicate is *an admin project, or a documentation site, or one installed module package*,
and what remains without a `generate` is a headless instance that installed nothing. The
predicate is named once in `template.ts` (`generatesArtefacts`) and read by the script, by
`setup`'s term for it and by the devDependency; it was spelled three times, which is how three
copies of one condition come to disagree.

This table read *"through the admin member's own `endora generate`"* and *"`build` reaches
**both** members"* until T137 gave the documentation site its own pair of artefacts, at which
point a root script naming one member would have left the other's navigation unrendered.

**No `check:*`, no `test`, no `composer:generate`.** The check estate is this repository's
(`instance-repository.md` R2.2), and whether `endora check` has anything to say about an
*instance* is `spec.md` §7's open clarification, untouched here.

### §2.6 — what the instance generates

**The heading read *"and commits nothing of"* until T138a, and that is now false of one of
the four families rather than of the artefacts it was written about.** `endora generate`
renders the divergence report too, and the report contract's §1 predicate puts it on the
other side of the line: *an artefact is committed when its content is a fact about the tree,
and resolved at runtime when it is a fact about the process*. Which packages a client
installed is a fact about their install; what their own overlay modules decorate is a fact
about their repository. Rendering both in one run is right — one walk of `node_modules`
answers both — and the four below that are facts about an install stay `.gitignore`d while the
divergence report does not.

| Artefact | Generated because | Population | Committed? |
| --- | --- | --- | --- |
| the admin contribution registry | Vite is a static build (R3.2) | the **installed** packages, through T102's parameterised generator, run by `endora generate` | no |
| the admin stylesheet enumeration | Tailwind is a static scan, and a package's utilities are dropped in silence when it is not scanned (`instance-repository.md` R3.2, `admin-stylesheet-composition.md` R2) | the same walk, one predicate wider — *declares `./tailwind.css`* rather than *declares `./admin`* | no |
| the documentation registry | Docusaurus is a static build (R3.2) | the same, through T101's | no |
| the divergence report — `apps/<deployment>/divergence.generated.{md,json}` | D-30: *"every override is visible in a generated artefact"*, and until T138a no instance could produce one (`specs/107-override-report-and-ladder/contracts/divergence-report.md`) | the deployment's own `modules/` tree and its `divergence.ts`, attributed against the installed packages and the installed platform | **yes** |
| the test entity index — `backend/test/entities.generated.ts` | a server-bound test needs the entity class **the ORM registered**, and a module package publishes one `entities` array and no class by name (D-168). *Which* modules a host installed is the one fact `@endora-commerce/test-kit` may not know (109 R2.2, FR-001), which is why `backend/test/helpers/package-entities.ts` is permanently host-owned (`module-package-layout.md` R10) and its successor is this (`specs/109-backend-test-kit/` T065) | the same walk, with no predicate at all: every installed module package, keyed by its `endora.id`, with the `entities` array off its own `./backend`. A module publishing no `./backend` is **refused**, because a skip reports a module the client installed as one they did not | no |

**The third is a population and not a file**, which is why §2.4a's `.gitignore` entries are
directories. `endora generate` renders the navigation fragment, the module map, **one reference
page per module** from that module's own manifest (feature 100 Phase 3), and **copies** every
page a module ships into the site's content root — a copy and never a symlink, for research
D-8's reason, so the doc id, the permalink and every relative link written against it survive
the move. A stamp beside them (`docs/.module-docs-copies.json`) is what lets one run remove the
copies the previous run wrote and no longer writes, so a module the client uninstalls takes its
pages with it.

**The reference category is *swept* in an instance and *refused* here**, and that is one rule
over two trees rather than two rules. In this repository those pages are committed artefacts,
so one nothing renders is a module that has gone and the remedy is `git rm`; sweeping would be
a generator deleting a tracked file no reviewer asked about. In an instance the category is
generated and git-ignored, `git rm` names a tool the file is not under, and a refusal would
mean a module the client uninstalled breaks every subsequent `endora generate` for ever.

**The fifth belongs to no member, and it is the only entry here that does not.** Its consumer is
a test, and a test is not a member of a client's workspace — so there is no omission branch above
it and nothing about it that can be absent: it is rendered whenever the host installed a module at
all. Two consequences were taken deliberately. **Every** instance gets it, including one that
runs no test, because the population is *which modules this host installed* and that is this
section's own predicate for a generated artefact; the cost is one ignored file a client never
imports, and the alternative is a flag nobody asked for. And it **narrows §2.5's `generate`
predicate and the exit-1 refusal rather than weakening them**: a headless instance with a module
installed now has an artefact and therefore a `generate` script, and the state `endora generate`
refuses is a workspace with no member, no deployment **and no module** — which is a directory the
command genuinely has nothing to say about. Without it a repository built on published packages
could write no server-bound test at all; `specs/134-paid-module-extraction/` T018's host is the
first, and its acceptance includes one row written and read back through this file.

**The first three are `.gitignore`d, and `foreign` is not applied to any of them** (R3.4,
feature 100 §6.4). This table and the two lines above carried **two** artefacts until
2026-09-07; T124 added the third and `instance-repository.md` R3.2 already said three; T138a
added the fourth, which is the first one an instance is told to commit. The
instance generates **none** of `composition.generated.ts`, `manifest-index.generated.ts`,
`entities-registry.generated.ts` or `migrations-registry.generated.ts` (R3.3) — in an instance
those four are the platform's constants, and `research.md` §7.6 is the arithmetic.

**What the instance's divergence report answers with, per input, and what it cannot** (T138a).
Every one of the nine kinds is derived exactly as it is in this repository, because the
population of all nine is the deployment's own overlay tree, which is the client's own source
either way. The inputs that are *not* that tree each have an instance answer:

| The renderer reads | In this repository | In an instance |
| --- | --- | --- |
| the overlay population | `backend/src/apps/<d>/modules/**` | `apps/<d>/modules/**` — §2.2's own tree, walked identically |
| the deployment's declaration | `import()`ed under `tsx` | the **source text** of `apps/<d>/divergence.ts`, read as literals. A computed field is *named*, never read as "declares nothing" |
| container-name ownership | module sources, plus a composition root's bridging table, plus installed packages | each installed package's published `./backend` artefact. Measured on `packages/modules/blog`: its `dist/backend` yields the same six names its `src` does |
| route identities | the same three walks | the same `./backend` walk, plus the platform's own `dist` |
| names a composition root supplies | `backend/src/composition.ts` and the harness | the platform's own `dist` — in an instance `composeApp` **is** the composition root |
| `ModuleContext`'s members | `packages/platform/src/kernel/module-context.ts` | the platform's shipped `kernel` declarations. Measured: the same sixteen members, in the same order |
| the emitted-manifest freshness refusal | the generated manifest index's `manifestPath`s | **no subject** — an installed package is not built from a source in that tree, so there is no staleness question to refuse |

**One thing is genuinely narrower and the artefact says so in its own `boundary.notRecorded`**
(FR-018's field): a container name a composition root registers *on a module's behalf* is
reported as a composition root's rather than as that module's. That mapping is
`check:port-dependencies`' hand-written bridging table — a judgement about **this
repository's** roots, with a retiring condition per entry — and nothing derives it, so an
instance has no equivalent and every such name comes out root-supplied. That is true of the
instance and simply less specific than ours; it is written into the report because a report
that is silently narrower is worse than no report.

**Two differences in the artefact set, neither of them in what a report records.** An
instance renders **markdown and JSON and never a typed TS module**: the `.ts` rendering's two
readers here are a program and `overlay:check`'s byte-comparison, an instance has no check
estate (§2.5), and the emitted module imports `DivergenceReport` by a **relative** path that
`backend/src/overlay/types.ts` carries and an instance has no equivalent of — a bare
specifier there would be the one generated artefact whose import depends on the client's
dependency graph, which is the state that file's own header exists to refuse. And an instance
renders **no bare-core report**: `DEPLOYMENT` is legitimately unset here, while an instance is
scaffolded with exactly one deployment and every build composes it.

**The discovery reports what it excluded.** A `link:`, a `file:` and a workspace member are
invisible to runtime discovery by design (§8 R8.1), so `generate` prints
`links-out-of-node-modules` with the package name and the real path (R8.2). A silent exclusion is
the one failure mode a client cannot diagnose.

### §2.7 — the deployment examples

**Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §3**,
under owner ruling **D-230**. What is here is the manifest — which paths, of which kind — and
not a second statement of the rules that decide their content; the derivation, the two axes and
the reason a topology is recorded nowhere all live in that contract and are not restated.

They are the **client's** kind throughout: rendered once, edited by them, and read back by
nothing. Under D-215 they are **examples** — no real registry, no real domain, no real secret
and none of this repository's container names — and under §3 R3.1 there they are derived from
the resolved member set and from `--topology`, which selects and records nothing.

| Path | Kind | Content and source |
| --- | --- | --- |
| `deploy/README.md` | client's | which file goes on which machine, in what order, and — under `three-host` — that the three `.env` files are not interchangeable. Written for both topologies, and the **only** rendered file in which the word *topology* appears (§3 R3.2 there) |
| `deploy/compose.prod.yml` | client's | `single-host` only: every service on one machine, member-derived. The stateful three, the migration job, the backend, the storefront and — with the member — the admin |
| `deploy/.env.example` | client's | `single-host` only: exactly the variables that compose file expands, each with its meaning and an example value. Derived from the rendered document, so the two cannot come apart. **Not** the root `.env.example`, which is the *build* inputs (§2.1) |
| `deploy/nginx.example.conf` | client's | `single-host` only: one `server` block per public origin this instance has, member-derived — an admin-less instance has no admin block and names no `ADMIN_DOMAIN` |
| `deploy/three-host/compose.{backend,storefront,admin}.yml` | client's | `three-host` only, and the admin file only with the member. One machine each; every stateful service is the backend's (§1 R1.4 there). An edge whose target is in another file is dropped rather than translated, which is §3 R3.6's *"replaced by nothing"* |
| `deploy/three-host/.env.{backend,storefront,admin}.example` | client's | `three-host` only, and the admin file only with the member. One per machine, each holding exactly what its own compose file expands — which is what makes them non-interchangeable rather than a sentence saying so |
| `deploy/Dockerfile.backend` | client's | an example image for the API and its queue consumers, built through §2.5's `build:backend`. Every `--build-arg` in its header and every `ARG` in its body is emitted from `packages/cli/src/lib/instance-build-inputs.ts` (§2 R2.3 there) |
| `deploy/Dockerfile.admin` | client's | the same, for the admin bundle, and **only with the member**. There is no `Dockerfile.storefront`: that image is the storefront repository's (D-195). There is no `Dockerfile.docs` either — the documentation site is a service in neither topology's example, and the build-input declaration names no `docs` target, so an image for it would have to invent both |

---

## §3 — The module set: derived, refused before writing, never a list

**R3.1** The set is `--module <id>` (repeatable, comma-splittable, `new module`'s
`--depends` grammar) **unioned with its own closure** over the manifests' `dependencies` **and
their `acknowledgedDependencies`** (R3.1a).

**R3.1a The closure follows both spellings of an edge, because the platform does.**
`acknowledgedDependencies` withdraws the *install ordering* a `dependencies` entry claims and
nothing else — `carts` names `promotions` there only because `promotion_usages_order_fk` obliges
`promotions` to declare `orders` while `carts` declares `orders` too, so `dependencies` would
close a cycle; the edge itself *"is a real bind"* in that manifest's own words.
`assertLockedModulesPresent` makes no distinction: a module named in **either** array that the
deployment does not ship raises `ReducedDeploymentError` out of `loadModulePresence`, before
anything listens. A set closed over `dependencies` alone is therefore a set the platform refuses
to boot — measured on 2026-09-14 as the instance criterion's A4 and A15, which are one failure of
this and not two, `pnpm run start` and the instance's own `admin:create` both composing. It went
unseen because the criterion's `tarball` mode pins every auto-installed peer as a real dependency
of the instance, which puts `mod-promotions` at the top level of `node_modules` where package
discovery looks; a registry install leaves it inside `.pnpm`, where that walk deliberately does
not look. **That difference is repaired and instrumented since 2026-09-15**: the pin stays —
pnpm applies no override to an auto-installed peer, measured again under 9.15.0 and 10.28.2 — and
the criterion removes the module packages it pinned beyond the declared set from the top level once
the install has succeeded, leaving them where a registry install leaves them. A16
(`instance-repository.md` R6.3) is the assertion that holds it, in either mode and without a
cross-mode comparison: the module packages an instance installs are exactly the ones its own
manifests declare.

**R3.2 With no `--module` the command writes the smallest set that composes**: the modules
declaring `activation.nonDeactivatable`, closed over `dependencies` and `acknowledgedDependencies`.
**The number is derived on every run and appears in no source file** (D-100): un-locking a module
changes the default in the same run. A count written here would be that same fact stated twice —
the sentence that stood here named 26 and was measured before R3.1a.

**R3.3 The refusal is the platform's own** (R5.6). `requiredModulesFrom(manifests)` supplies the
required set and each manifest's `activation.reason` supplies the sentence; the command adds the
remedy (`--module <id>`) and nothing else. A second list would be a second answer to a question
the platform already answers, waiting to disagree.

**R3.4 It refuses before writing** (R5.2). The manifests come from the packages the command
resolved — always from a `node_modules` beside the target or the working directory; a registry is
reached only by installing from it into such a directory, which is what `endora install`'s
temporary host does when nothing is installed there yet (D-271), under `--registry` when one is
given — so the refusal is about the set the client will actually install and not about a
snapshot. `endora new instance` itself makes no network call and provisions nothing.

**R3.5 There is no meta-package and no tier.** D-194 withdrew the tier packages and D-160.6
answered the shape *no* at five packages; a client installs a list a scaffold writes for them.

**R3.6 The set appears exactly once in the written tree** — the root manifest's `dependencies`
(R5.4). The backend member declares none, the admin member declares none, and the generated
registries derive theirs. **The admin member declares the shell, the design system and its build
tools**, which are not modules; what the *modules* declare optional is the root's, beside the
modules themselves, for the mechanical reason §2.4 records. Two spellings of one set is D-100 in a tree we cannot grep, and it is the
one disagreement nothing in a client's tree could detect (`spec.md` §6.2).

---

## §4 — What the command refuses, with its exit code

`cli-surface.md` §2 unchanged: **0** it did what it was asked, **1** a refusal the author can act
on, **2** an input it could not read. Every refusal names what it refused **and what to do
instead** (R2.4).

| # | Condition | Code |
| --- | --- | --- |
| F1 | the target directory exists and is not empty | 1 |
| F2 | the module set cannot compose — a required module absent, or a `dependencies` entry unsatisfied (§3.3) | 1 |
| F3 | `--module` names an id no resolvable package declares | 1 |
| F4 | `--deployment` is not a valid deployment name | 1 |
| F5 | the registry configuration cannot be read, or `--registry` is not a URL | **2** |
| F6 | the platform version cannot be resolved, so no range can be written | **2** |
| F7 | a resolved package's manifest cannot be read or parsed | **2** |
| F8 | the CLI cannot determine its own version, so `^<version>` has no source | **2** |

F5–F8 are **2 rather than 1** for the reason the estate states everywhere: a run that could not
read its input has said nothing, and a scaffold written from values it could not read is worse than
no scaffold. F8 is the one an implementer will be tempted to default; it is exactly the
*"a value the tool invented is a value nobody reviewed"* case (R2.5).

**`--dry-run` reports every file it would write, the resolved module set with its closure, every
range, every omission (§2.4), and writes nothing** (R5.3). It exercises F1–F8 in full: a dry run
that skipped validation would be a dry run that cannot answer the question it is for.

---

## §5 — The guard, and why it is a test rather than a check

**`packages/cli/test/new-instance/template-reconciliation.test.ts`.** Its subject is the CLI's own
template, not this repository's tree, so it is not a `check:*` script — the estate's population is
the tree, and adding a check whose subject is a template would need an inventory entry, a read-size
band and an `endora check` estate verdict for a rule that can say nothing about a module package.
The neighbouring precedent is `published-surface.test.ts`, which holds a barrel to a contract and
is a test for the same reason.

Five assertions, **each two-way**:

| | Assertion |
| --- | --- |
| **T1** | every `@endora-commerce/*` specifier the template writes resolves to a subpath the target package's `exports` map **declares** — and every subpath it declares that the template ought to name is named. Derived from the manifests, never a list (the `check:platform-surface` derivation, reused) |
| **T2** | every environment variable the template renders is a member of `INSTANCE_BUILD_INPUTS` (T103), and every member is rendered. This is the reconciliation `instance-build-inputs.test.ts` already performs for our three build jobs, over a fourth consumer |
| **T3** | the template writes **none** of the four backend registries, and **both** of the two generated artefacts are `.gitignore`d (R3.3, R3.2) |
| **T4** | the wiring total is under R1.4's bound, and every file the template writes is classified into one of §1.1's three kinds. A file in no kind fails — so a new file joins a kind by what it is, never by an entry somebody adds (`spec.md` SC-007's own discipline) |
| **T5** | **the created tree is exactly §2's manifest** — both directions, and **both sides derived**: the contract's from §2's own tables, the tree's from a real plan. A path §2 names is accounted for two ways and only two, the plan **writes** it or the plan **omits** it with a reason, and the reason is printed to the client on every run. `backend/src/cli.ts` was this clause's worked example of the second state and is now written (G2), so the test asserts the transition in both directions — the file is written *and* no omission names it — because an omission whose reason has been discharged must not survive as prose. Added by T137, which is the row whose done-when this clause is; it lives in `packages/cli/test/new-instance/manifest-reconciliation.test.ts` rather than beside T1 because T1's subject is the platform **names** a rendered file writes and this one's is the **set of files** |

**Red proofs, one per assertion, entering as the template's own output** (issue #130 — never a
pre-classified plan):

| Proof | Produces |
| --- | --- |
| a template naming `@endora-commerce/platform/db`, which the map does not declare | **T1** red, naming the specifier and the declared set |
| a template rendering `SALES_CHANNEL` where the declaration says `SALES_CHANNEL_CODE` | **T2** red, both directions asserted separately |
| a template writing `composition.generated.ts` | **T3** red |
| a template whose `index.ts` grows past the bound | **T4** red, with the line count |
| a contract with a §2 row nothing writes; a template writing a file §2 does not name | **T5** red, one direction each, the fixture entering as the contract's text or as the plan |
| a template that writes no file at all | **exit 2** — an empty plan makes all five vacuously true, and it is the state a broken resolver produces. T5 refuses three ways: a contract with no §2 section, a §2 naming no path, and a plan writing no file |

**No ledger, deliberately.** Every finding is the template's own file and one edit from compliance;
an entry could only license the template drifting from what the platform publishes, which is the
one thing this guard exists to refuse.

---

## §6 — Acceptance

The criterion is `contracts/instance-repository.md` §6's, unchanged, plus one assertion this
contract adds. **The numbering is R6.3's, not this contract's** — an extension takes the next free
number in the list it extends, and cannot renumber it. This assertion was written as `A13` when
that was the next free number; R6.3 has since grown an A13 of its own (the built admin stylesheet,
FR-023/SC-011), so **this one is A14**. The two were never alternatives to be chosen between: they
are different subjects that collided on an id, and the extension is the side that moves.

**A14** — the wiring the created tree holds is under R1.4's bound, measured on the created tree
rather than on the template, so a scaffold that expanded a file after rendering is caught.

**And A3 gains a precondition**: it asserts the order `migration-order.ts` computes **over the
installed manifests**, which is `contracts/instance-migration-order.md`'s subject. Until R1.1 there
lands, A3 is red on purpose and `expected-state.json` names that contract as the reason — not
"unimplemented", which is the entry a reader learns nothing from.

**A2's two modes are `acceptance:storefront-scaffold`'s**: `tarball` by default, `registry` when
`ENDORA_NPM_REGISTRY` is set, the assertions identical under both. That is what makes the criterion
green before publication and *about* publication after it.
