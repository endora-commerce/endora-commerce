# The package-schema acceptance criterion

**"A package can ship schema" is met when a fixture package, built into a tarball and installed
into a throwaway directory outside this repository, contributes one entity and one migration that
both reach a real PostgreSQL database — with no symlink leading back into the repository on its
resolution path.**

That sentence is D-110 (`specs/080-f4-real-scope/README.md` §6); the normative form, with the
nine assertions, is `specs/080-f4-real-scope/contracts/package-schema-acceptance.md`.

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
| `expected-state.json` | The two-way ratchet: what the criterion answers on this tree today, per assertion, with a reason for every non-`pass`. |
| `../scripts/acceptance/package-schema.ts` | The runner: build, pack, install, A8/A9, database, four probe phases, report. |
| `../scripts/acceptance/instance-probe.ts` | One platform process per phase — it boots the real composition root and answers A1 … A7. |
| `../scripts/acceptance/assertions.ts` | Every judgement, pure. Unit-tested in `test/unit/scripts/package-schema-acceptance.test.ts`. |

## Reading the result

Three exit codes, and the third is the point: **0** the criterion is met, **1** it is not, **2** it
could not be measured (no PostgreSQL, no `pnpm`, a database name the guard refuses, a phase that
threw). "The services were missing" is not spellable as either colour.

Today the run prints two `FAIL` and seven `PASS`, and CI is green. That is not a contradiction:
the criterion is *supposed* to be red until feature 080's Wave 3 finishes, so what CI enforces is
drift against `expected-state.json` in **both** directions. A8 or A9 going red fails the job; A6
going green fails it too, and the remedy is to record the green in the merge request that earned
it. Never edit that file to make a pipeline pass.

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

**A6 and A7 are the two that remain, and they are one defect.** A6's activation Setting is never
created, because `composition.ts` reconciles settings from bare-core `REGISTERED_MANIFESTS` and
because the probe's `gate-off` phase reads the row before any phase has composed anything. A7
then short-circuits on `already-uninstalled`: the `module_registrations` row it would revert from
is written during composition, and nothing composed. Fix the ordering and A7 follows without the
revert being touched. That is T036's, and its own precondition is T033a — the first-boot
reconciler must stop converging a package nobody installed (§D-157.6(b)).

**A8 and A9 carry the contract.** A1 … A7 are satisfiable by a moved directory, which is the trap.
A8 says the installed package's resolution path stays inside the instance; A9 runs A8's own
predicate over the same package consumed by link from inside this repository and passes only when
A8 comes back **false**. Both pass today, and they have to: they measure the harness rather than
the platform, and an anti-trap assertion nobody has ever seen refuse anything is decoration.

## Two things the fixture cannot do, and says so

- **It classifies no tenant scope.** `@GlobalEntity()` / `@OrgScoped()` / `@CustomerScoped()` live
  in `backend/src/tenancy/` and no package publishes them, so a third-party module physically
  cannot classify its own entity today. Importing them by a relative path back into the repository
  is the trap A8 refuses. The migration still creates the tenant column, and A3 reads it back.
- **It takes `@mikro-orm/core` from the host.** The runner links the platform's copy into the
  instance, because two copies mean two `MetadataStorage` instances and an entity the host's ORM
  cannot see — a red with nothing to do with packaging. That link is on a *peer's* path, never on
  the package's own, which is precisely the distinction A8 measures and A9 proves can still say no.
