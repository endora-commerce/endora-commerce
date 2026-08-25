# The package-schema acceptance criterion

**"A package can ship schema" is met when a fixture package, built into a tarball and installed
into a throwaway directory outside this repository, contributes one entity and one migration that
both reach a real PostgreSQL database — with no symlink leading back into the repository on its
resolution path.**

That sentence is D-110 (`specs/080-f4-real-scope/README.md` §6); the normative form, with the
nine assertions, is `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.

**A10 is a tenth and is not in that contract** (T053(c)) — see *The tenth assertion* below.

```bash
# locally, against a disposable database (the name must contain "test")
ACCEPTANCE_DATABASE_URL=postgresql://b2b:b2b@localhost:5432/b2b_acceptance_test \
  pnpm --filter backend run acceptance:package-schema

# what CI runs: the same procedure, compared to backend/acceptance/expected-state.json
pnpm --filter backend run acceptance:package-schema:ci
```

## Why it is not a test in `backend/test/`

F4's own wording — "move `backend/src/modules/<id>/` to `packages/modules/<id>/`" — cannot tell
success from the status quo. A moved directory is still inside the tree the composer walks, still
inside relative-specifier range, and pnpm symlinks a workspace member into `node_modules`. A test
that runs inside the repository therefore passes on a package that is not one. So the criterion
leaves: `pnpm pack` → `pnpm add ./x.tgz` into `os.tmpdir()` → boot this platform against it.

## The parts

| Path | What it is |
| --- | --- |
| `fixture-package/` | `@endora-commerce/mod-acceptance-probe` — a synthetic third-party module: one entity, one migration, one permission, an activation block, one palette action, flat `en`/`pl` bundles. **Not a `pnpm-workspace.yaml` member**, so pnpm cannot link it. Publishes `dist` + `i18n` with comments stripped, so a source-text probe for `@Entity(` finds nothing. |
| `expected-state.json` | The two-way ratchet: what the criterion answers on this tree today, per assertion, with a reason for every entry. |
| `../scripts/acceptance/package-schema.ts` | The runner: build, pack, install, A8/A9, database, seven probe phases, report. |
| `../scripts/acceptance/instance-probe.ts` | One platform process per phase — `schema`, `boot`, `install`, `overlay-decoration`, `gate-off`, `gate-on`, `uninstall`. It boots the real composition root and answers A1 … A7 and A10. |
| `../../src/apps/acceptance/` | The deployment the `overlay-decoration` phase composes: one overlay module whose whole content is a decoration over a registration the fixture **package** owns. |
| `../scripts/acceptance/assertions.ts` | Every judgement, pure. Unit-tested in `test/unit/scripts/package-schema-acceptance.test.ts`. |

## Reading the result

Three exit codes, and the third is the point: **0** the criterion is met, **1** it is not, **2** it
could not be measured (no PostgreSQL, no `pnpm`, a database name the guard refuses, a phase that
threw). "The services were missing" is not spellable as either colour.

Today the run prints nine `PASS` and one `FAIL` — A1 … A9 green, A10 red — so the **schema**
criterion is met and the tenth assertion is not. What CI enforces is unchanged and is still drift
against `expected-state.json` in **both** directions — the ratchet was never "is it red", it was
"does it answer what this repository says it answers". Both remedies are the same one: record the
move in the merge request that earned it. Never edit that file to make a pipeline pass.

Two consequences of A10's red worth stating plainly, because both look like defects and are not.
A plain `pnpm --filter backend run acceptance:package-schema` now exits **1** and prints "the
criterion is NOT met" — its headline sentence is about D-110's schema question and A10 is not that
question, so read the per-assertion lines rather than the summary. And the CI job
(`:ci`, `--against-expectation`) exits **0**, because a recorded red that reproduces is exactly
what the ratchet is for: it is what makes A10 a standing measurement rather than a note.

**A5 was the first to move**, in the merge request that landed T031: an installed package now
reaches `resolvedManifestEntries()` and both composition roots, so its identity, its grantable
permission and its `en`/`pl` palette bundles travel with it. A6's and A7's recorded reasons moved
with it, because both had read *"follows A5"* and stopped being true the moment A5 did — A7 in
particular now runs the hard uninstall for real and fails only on the migration count. What is
still red is the **schema** half, A1 … A4, which is what T033 closes.

**T032 finished A5 without moving it**, which is the shape a two-way ratchet is least good at
showing. It passed reading the package's `en`/`pl` files with `loadModuleBundles` at a path the
assertion computed itself — which proves the files were published and says nothing about the code
that actually populates `translation_bundles`. It now runs `reconcileBundles` over the whole
resolved manifest set and reads the action keys back out of `getMergedBundleForLanguage`, the read
the Admin SPA and the command palette serve from. Same colour, different claim: a package whose
bundles the reconciler cannot reach now fails A5 with its `i18n/` sitting in `node_modules`. The
recorded reason in `expected-state.json` is the only artefact that carries that difference, so it
was rewritten in the same merge request — a stale reason is drift the ratchet cannot detect.

**T033 moved the whole schema half.** A1 … A4 went green together, and they are kept as four
assertions rather than one because each is satisfiable without the one below it: A1 says the
package's class is in the applied order, A2 that the table exists *because the migration body
ran*, A3 that the tenant column and the named index are in `information_schema` as declared — the
assertion that separates a migration that ran from a row in `mikro_orm_migrations` standing in for
one — and A4 that the host's own ORM answers `em.find` against the package's entity. The committed
registries did not move and are not supposed to: what moved is that the *configured* order and the
*configured* entity set are no longer the committed ones. `src/db/configured-migrations.ts` and
its sibling `configured-entities.ts` merge each installed package's exports at runtime, the
migrations tagged `origin: 'external'` so a stranger's stamp cannot join the frozen historical
prefix.

**T046 closed A6 and A7, and the fix was a phase rather than a mechanism.** Both were recorded as
one defect and they were, but not the one the reasons named. The platform half of each already
worked: `install` reconciles the installed module's `manifest.settings` (step 2) and reverts
exactly its own migrations (T033's injected `MigrationOwnership`), and since D-157.6(b) `install`
is a package's **only** author — of its settings rows and of its `module_registrations` row alike,
because no boot may converge a package before its migrations have run. What was missing was the
call: no phase installed. The probe now runs the sequence an operator runs — `schema`, then `boot`
(one `composeApp()`, which converges `module_registrations` for what this *build* ships, so the
package's `auth` dependency is installed, and which asserts the package itself is still absent),
then `install` in the shape `scripts/install.ts` builds it, then the two gate phases and the hard
uninstall.

Two things moved with it and neither is what made the criterion green, which is worth saying
plainly because a reader will otherwise take the bigger change for the load-bearing one:

- The **boot** settings reconcile stopped reading bare-core `REGISTERED_MANIFESTS` in both
  composition roots. Its population is `deploymentShippedEntries(resolvedRegistry)` — core plus
  this deployment's overlay, never an installed package, the same split D-157.6(b) ruled for the
  first-boot presence insert and the same function rather than a second copy of the origin test.
  That cut had a live cost on an **overlay** module, whose presence is converged at boot and which
  therefore has no `install` to author its settings: `example_overlay` declares an activation
  control and had no row for it, so it was installed, gated and switchable in every respect except
  that the operator had nothing to switch. It was measured not to move this criterion — with the
  fix in and the probe's two new phases reverted, the run still answers 7 pass / 2 fail.
- The `uninstall` phase's registry was built from an identity map written before
  `lifecycleParticipant` existed, so a hard uninstall took the package's schema away and left its
  `translation_bundles` and `module_actions` rows behind — the one case D-159 §7 records as having
  no other cure. The entries are handed over unmapped now, the way `composition.ts` hands its own
  registry over.

**A5's fourth quarter is now measured for the first time**, without moving: `gate-off` used to
return early on the missing activation Setting and `gate-on` with it, so *"and enforced"* — an
anonymous `GET` on the package's own route answering 401 — was never reached. Same colour,
stronger claim, exactly as T032 did to the other three quarters.

**A8 and A9 carry the contract.** A1 … A7 are satisfiable by a moved directory, which is the trap.
A8 says the installed package's resolution path stays inside the instance; A9 runs A8's own
predicate over the same package consumed by link from inside this repository and passes only when
A8 comes back **false**. Both pass today, and they have to: they measure the harness rather than
the platform, and an anti-trap assertion nobody has ever seen refuse anything is decoration.

## The tenth assertion

**A10 asks whether a per-deployment overlay can decorate a registration owned by an installed
package**, and it is the only entry recorded `fail`.

It is here rather than in a test of its own for one reason: the thing it needs is an installed
package — packed, installed outside the working tree, composed — and this harness is the only
place that exists. Building a second one to ask a single question would be a second answer to
"what is an installed package". Asking it here costs one phase and one deployment.

The mechanism it exercises is the overlay pattern's, not the packaging programme's. A deployment
overrides a service by decorating the **registration** (feature 072, D-28) — a module of its own
under `backend/src/apps/<deployment>/modules/`, calling `ctx.di.decorate('<name>', …)`. A core
module wrapping someone else's registration is refused; an overlay module is exempt, and the
exemption is structural (`overlay: true`, set from the root the module was discovered under —
issue #203). A registration name says nothing about where its owner's code lives, so a package
ought to be exactly as decoratable as a module in `backend/src/modules/`. Nobody had measured it.

**It is not, and the layer is exactly one: the order of the arrays in the composition root.**
`composeApp` calls `composeModules([...MODULES, ...overlayModuleEntries, ...packageModuleEntries], …)`
and registration runs in array order — `composeModules` has no topological pass, deliberately,
because registration resolves nothing. So a deployment's overlay module registers *before* the
package whose name it wraps, and `ctx.di.decorate` refuses:

> `[kernel] module 'acceptance_overlay' cannot decorate 'acceptanceProbeGreeter': nothing is
> registered under that name. Decoration wraps an existing registration; register order is
> topological, so the owning module must come first.`

`composeModules` wraps that as `ModuleCompositionError`, so the deployment does not degrade — it
does not boot.

**Nothing else is wrong, and that was measured rather than assumed.** The overlay module was
discovered, was composed and reached `decorate` at all, which is what says the `overlay: true`
marking was applied. With the two arrays swapped and nothing else changed, A10 answers `pass`:
`acceptanceProbeGreeter` resolves to `"overlay:acceptance probe"`, the deployment's wrap
delegating into the package's own implementation. So the decoration exemption over a **package**
owner works today and is reached by nobody.

The swap is not committed. The comment above that call already claims *"overlay last, so a
deployment's decoration wins"* as structural, and for a package owner it is not — which array
composes last is a ruling about the overlay pattern (a package would then register before the
deployment that may wrap it, and `DuplicateRegistrationError`'s owner/claimant attribution moves
with it), and a task row that adds an assertion is not where that gets decided.

## Two things the fixture cannot do, and says so

- **It classifies no tenant scope.** `@GlobalEntity()` / `@OrgScoped()` / `@CustomerScoped()` live
  in `backend/src/tenancy/` and no package publishes them, so a third-party module physically
  cannot classify its own entity today. Importing them by a relative path back into the repository
  is the trap A8 refuses. The migration still creates the tenant column, and A3 reads it back.
- **It takes `@mikro-orm/core` from the host.** The runner links the platform's copy into the
  instance, because two copies mean two `MetadataStorage` instances and an entity the host's ORM
  cannot see — a red with nothing to do with packaging. That link is on a *peer's* path, never on
  the package's own, which is precisely the distinction A8 measures and A9 proves can still say no.
