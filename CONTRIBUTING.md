# Contributing to Endora Commerce

Thank you for looking at this. Endora Commerce is a modular B2B/B2C commerce platform — a
Fastify + MikroORM backend, a React admin, a Next.js storefront, and a large set of domain
modules published as npm packages. It is MIT-licensed, and so is every contribution to it.

This project is unusual in two ways that will save you time to know up front.

1. **It is spec-driven.** A feature starts as a document in `specs/NNN-slug/` and the code
   follows it. Feature directories written from the migration to this repository onward are
   **here, and are meant to be read**. The design record from before then — including the
   `specs/NNN-slug/` and `D-nnn` citations you will meet throughout the code and the comments —
   is kept in the project's private historical repository. **Those citations are left in place
   deliberately, as provenance: they are footnotes, not broken links.** The documents a change is
   actually judged against are `specs/conventions/` and `.specify/memory/constitution.md`, and
   both are here.
2. **Most of its rules are instruments, not conventions.** A large static-check estate runs on
   every change and reports by name. You are unlikely to break a rule silently — but you are
   also unlikely to talk a check out of a finding, so it is cheaper to read the rule first.

Everybody taking part — in issues, pull requests, reviews and anywhere else the project meets —
is held to the [Code of Conduct](CODE_OF_CONDUCT.md). Conduct you want to report goes to
community@endora.software, never into a public thread.

---

## Read these three, in this order

| Document | What it is |
| --- | --- |
| `.specify/memory/constitution.md` | The binding principles and the quality gates every change is reviewed against. Several principles are marked **NON-NEGOTIABLE**; those are not style preferences and a change that violates one is rejected regardless of how good it is. |
| `AGENTS.md` | The practical entry point: the stack, the repository map, the commands, and a routing table saying which document to open for the thing you are about to do. Start here for anything operational. |
| `specs/conventions/` | The bodies `AGENTS.md` routes to — module composition, migrations, i18n, admin permissions, module activation, the check estate, release intent, the test suite. One subject, one home. `ls specs/conventions` lists them; there is deliberately no index file. |

`AGENTS.md` is addressed to AI coding agents, and it is the same set of rules a human is held
to. Nothing in it is agent-specific except the section that says so.

---

## Spec-driven development

The workflow is **Spec Kit**'s (the `.specify/` directory is its project structure), in
four steps:

```
/speckit.specify   →  /speckit.plan  →  /speckit.tasks  →  /speckit.implement
   spec.md            plan.md,           tasks.md           the code
                      research.md,
                      data-model.md,
                      contracts/
```

They are slash commands in an AI coding tool, and **you do not need that tool to contribute**.
What the flow produces is ordinary Markdown in `specs/NNN-slug/`, and what matters is the
artefacts rather than how they were typed:

- **`spec.md`** — what the feature must do, as numbered functional requirements (`FR-nnn`).
  Written for the person deciding whether to build it, not for the person building it.
- **`plan.md`** — how, including a Constitution Check block and a Complexity Tracking section.
  A new runtime dependency is justified there or it is not added (Principle IV).
- **`research.md`** — the measurements the plan rests on, each with the command that produced
  it, so the next reader can re-derive rather than believe.
- **`contracts/`** — the API shapes and the rules a module's implementation is judged against.
- **`tasks.md`** — the work, as rows with a *"done when"* column.

### What this asks of a contribution

**Read the closest prior spec directory before you implement — and if there is not one you can
open, read the convention.** For a change in the ground this repository has already covered, the
closest prior feature directory is in the private historical repository and you will meet it only
as a citation. That is not a gap you have to work around: `specs/conventions/` is the operational
half of the record and it is here in full, one document per subject, and it is what a change is
judged against. Where a public feature directory does exist, it will tell you why the code looks
the way it does; the fastest route in is to find the module you are touching and grep `specs/`
for its id.

**A feature's `tasks.md` is ticked in the same pull request as its code.** A row marked done
in a later change is a status nobody can trust afterwards, and the whole point of the file is
that somebody arriving in six months can tell what is finished from what was merely started.
If your change completes a task, tick it and say what you measured; if it completes it
*partly*, say which part and leave the row open.

**A feature number is not unique — cite the slug.** Two different features have landed on the
same number many times. Write `specs/123-oss-install-experience/`, not "feature 123", wherever
the reference has to survive a reader who was not in the conversation. This command lists the
numbers that are ambiguous today:

```bash
ls -d specs/[0-9]* | sed 's|specs/||; s/-.*//' | sort | uniq -d
```

**Not every change needs a spec.** A bug fix, a one-file repair, a documentation correction, a
test that should have existed — these need a failing test and a clear commit message, not a
`specs/` directory. The flow exists for features, and reaching for it on a two-line fix helps
nobody. If you are unsure which yours is, it is almost certainly the small one.

---

## Setting up

```bash
pnpm install
pnpm run build:packages        # FIRST, and again after editing anything under packages/
pnpm run dev:infra             # PostgreSQL, Redis, Meilisearch in Docker
pnpm run dev                   # backend + admin + storefront
```

`pnpm run build:packages` is a **precondition**, not an optimisation: every workspace package
resolves through its own `exports` map at `./dist`, so an unbuilt workspace is an unresolvable
specifier rather than a slightly stale one. A stale `dist` also means the type-checker and the
test run are reading different files — `tsc` stays on source through `tsconfig.base.json`'s
`paths`. Edit a package, build that package, restart the loop.

Node ≥ 22.18 and pnpm 9 are required; the versions are declared in the root `package.json`.

---

## Tests come first

Test-driven development is **Principle III and non-negotiable**: the failing test is written
before the implementation, and every functional requirement traces to a test.

Where a test lives follows what it is about:

| Subject | Where |
| --- | --- |
| A module's own logic | beside it, `packages/modules/<id>/src/**/*.test.ts` — there is no `test/` directory in a module package |
| Backend unit, contract, integration and performance suites | `backend/test/{unit,contract,integration,perf}/` |
| Admin and storefront | the app's own suite |

```bash
pnpm --filter backend run test:unit:fast      # no Postgres, no Redis, no Meilisearch
pnpm --filter backend exec vitest run <path>  # targeted — prefer this while iterating
pnpm --filter backend run test                # the complete suite; needs all three services
pnpm --filter '!backend' run test             # every other workspace member, packages included
```

`specs/conventions/backend-test-suite.md` says which command's green result means what, and it
is worth reading before you rely on one: `test:unit:fast` is the one everybody runs and it
skips the contract and integration trees entirely.

---

## Before you send a change

The verification list is **whatever the `quality` and `quality:static` jobs run** — in
`.github/workflows/quality.yml`, which a test holds equal to the same two jobs in
`.gitlab-ci.yml` — not a subset of them, and not a remembered list. Read the jobs; they are a
flat list of commands and they are all fast. The ones that catch the most:

```bash
pnpm -r run typecheck
pnpm -r run lint
pnpm run check:naming && pnpm run check:language
pnpm --filter backend run manifests:check
```

Four things catch people out, and each has a document:

- **A check reported something you do not recognise.** `specs/conventions/check-inventory.md`
  has a row per finding: what it means, why it exists, and what the escape hatch is if there is
  one. `specs/conventions/check-estate.md` is the rules for changing a check.
- **You added or deleted files.** That moves recorded *read sizes* — the number of files each
  check opened — and they are re-measured on a clean checkout, never computed from a delta and
  never widened to make a run pass. `check-estate.md` § *Measuring a read size* first; the test
  prints which entries moved.
- **You changed what a package publishes.** Then the change carries a **changeset**
  (`pnpm changeset`), written for the consumer of the package rather than for the reviewer of
  the branch. `major` is refused while a package is in `0.x` — write `minor`. Where a change
  genuinely has no release meaning, `pnpm changeset --empty` records that you looked.
  `specs/conventions/release-intent.md`.
- **You touched something generated.** The composer and the package manifests are generated
  artefacts, and one left stale is a silent defect rather than a crash — an unregistered
  migration simply does not run. Regenerate and commit in the same change, and run
  `pnpm install --lockfile-only` beside `manifests:generate`.

Report failures with their output. A pull request that says "tests pass" while one does not
costs the next person more than the change was worth.

---

## Writing the code

- **Modules are the unit of everything.** A module owns its entities, services, routes,
  migrations, translations and tests. Cross-module interaction goes through an exported
  service, a port resolved by container name, or the in-process `EventBus` — never an import
  into another module's internals. Design every module so it could be detached.
- **Define the API shape first**, as a Zod schema in `packages/contracts/` (Principle II).
- **Domain writes go through the Command Bus** so auditing and undo stay uniform
  (Principle XIII).
- **Tenant isolation and sales-channel scoping are structural** (Principles XI and XII). Use
  the guards and the sanctioned accessors; a hand-rolled `organization_id` condition or a
  channel bypass is rejected even when it is correct, because the next one will not be.
- **Reuse before you add.** The admin design system, `@dnd-kit`, the `<EChart>` wrapper and the
  existing services are there to be used (Principle IX). A new runtime dependency needs written
  justification (Principle IV); the default answer is no.
- **Match the surrounding style.** The code is heavily commented, and the comments explain
  *why* — often naming the measurement or the failure a rule came from. That is deliberate:
  keep it up where you change something a comment describes.

`AGENTS.md`'s routing table says which `specs/conventions/` document to open for the specific
thing you are doing — adding an admin permission, writing a migration, shipping a user-facing
string, gating on a module's presence, adding a `check-*` script.

## Documentation

The published documentation is the Docusaurus site under `docs/`, and a module's own pages
live in that module's package (`packages/modules/<id>/docs/`) and are composed into the site —
so documentation travels with the code it describes rather than with whoever remembered to
update a central tree. A change that adds a module or moves something an operator relies on
updates its page in the same pull request. `specs/conventions/module-documentation.md` says
where a page belongs and what the check that enforces it looks at.

Pages under `docs/` must be in English (Principle VIII).

## Working language

Principle VIII requires English in exactly two places: **inline comments and docstrings inside
source files**, and **every page under the `/docs/` Docusaurus site**. `check:language`
enforces both. The principle explicitly frees everything else — identifiers, string literals,
specs, commit messages, review prose — from the requirement.

In practice the whole repository is written in English and new work should be too; the
narrowness above exists so that a rule about *comments* is not used to reject a commit message.

## Commits

- English, imperative, and explaining the *why*.
- **No `Co-Authored-By` trailer for an AI assistant, and no AI/LLM attribution of any kind.**
  This applies whether or not a tool helped you write the change.
- **Signed off by you** — see the next section. The `dco` check refuses a pull request with an
  unsigned commit.
- Branch from `origin/master` — never from a local `master`, which goes stale — and deliver
  through a pull request. Nothing is committed to `master` directly.

## Sign your commits

Every commit in a pull request ends with a **`Signed-off-by:` trailer carrying your name and the
address the commit is authored with**:

```text
Signed-off-by: Ada Lovelace <ada@example.com>
```

With it you certify the [Developer Certificate of Origin 1.1](https://developercertificate.org/)
for that commit: in short, that you wrote the change or otherwise have the right to submit it
under the project's licence, and that you understand the contribution and the sign-off are
recorded publicly. Read the four clauses once; they are short. There is **no contributor licence
agreement** — the sign-off is the whole of it, and your contribution stays yours, licensed as the
§ *Licence* section below says.

`git commit -s` adds the trailer for you. `git config format.signOff true` does not affect
`git commit`, so the flag is the reliable habit.

**The `dco` check enforces it.** It is a required status on `master`, it reads every commit the
pull request adds, and it accepts a commit only when one of its `Signed-off-by` trailers names the
**commit author's address** — a sign-off by somebody else, or a line in the body that merely
looks like one, does not count. Merge commits are not asked. If it refuses, sign off the commits
you already have and update the branch:

```bash
git rebase --signoff origin/master
git push --force-with-lease
```

A sign-off is a statement you make, so nobody can add it on your behalf: a maintainer will not
sign off a commit for you, and a bot's commits carry the bot's own sign-off.

---

## Licence

Endora Commerce is **MIT** (`LICENSE`), and every published package declaring `MIT` carries the
same text in its own directory. By contributing you agree that your contribution is licensed
under MIT.

A package whose `package.json` declares `SEE LICENSE IN LICENSE.md` is **not** MIT: it ships its
own `LICENSE.md` in place of the MIT text, and that file is what applies to it.
`LICENSING.md` at the root explains that mechanism. It is not a licence — it carries no
terms, grants nothing and names no package; each package's own declaration is the only list.

---

## Where to send a change

**This repository is canonical.** Issues, pull requests and releases all live here, and every
gate described above runs here. **Pull requests are accepted** — a pull request opened here is
reviewed and merged like any other change, and nothing has to carry it anywhere else.

Endora Commerce was built on the project's own self-hosted GitLab, which is kept as the
**historical repository**: reachable by the team, not written to. That is where the `specs/`
and `D-nnn` citations in the code resolve, and it is why they are left in place rather than
stripped. **If you are reading this file inside that GitLab repository, the migration has not
completed yet** — the paragraph above is the decided destination rather than today's address, so
ask before investing effort in a large change.

**A suspected vulnerability does not go in an issue or a pull request.** `SECURITY.md` is the
route, and it is the only one: the security class is kept off the public tracker deliberately.
Read that file before reporting — it is not finished, and it says exactly what is missing.

**What is safe to start on right now:** a bug fix with a failing test, a documentation
correction, a missing test for existing behaviour, or a small repair a check reported. Those are
reviewable on their own terms.

---

## Governance

**The project owner decides.** Endora Commerce is maintained by Endora sp. z o.o., and the owner
has the final word on what is merged, what the product includes and when it is released. That is a statement of who is accountable, not of who may take part: proposals,
objections and alternatives are welcome in issues and pull requests, and a decision that goes
against yours comes with its reasoning written down.

**Rulings are numbered and public.** A decision that settles a design or process question —
rather than a single review comment — is recorded as a **ruling** with an identifier of the form
`D-nnn`, its reasoning, and the date, in the document it changes: a feature's specification
under `specs/`, a convention under `specs/conventions/`, or `.specify/memory/constitution.md`.
The numbering continues the series from before this repository was public, which is why older
`D-nnn` citations in the code point at a record you cannot open (see the top of this file);
every ruling from the migration onward is made here and can be read here. A ruling is changed by
a later ruling that says what it amends, never by editing the old one silently.

**Maintainers review; the owner appoints them.** `.github/CODEOWNERS` routes each review request,
and a pull request merges only after a maintainer's review and with every required check green.

**The project's names are covered separately.** The code is MIT; the names *Endora* and *Endora
Commerce* are not licensed by it. [TRADEMARKS.md](TRADEMARKS.md) says what you may call a fork or
a product built on this one.
