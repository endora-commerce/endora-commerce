# Release intent — changesets

**Open this before changing anything a package publishes, and before cutting a release.** It
carries the rule (a merge request that changes what a package publishes carries a changeset),
the versioning model, the `linked` group's real behaviour, and the two `.changeset/config.json`
fields that look like boilerplate and decide whether the gate is looking at all. One of the
bodies `AGENTS.md` routes to; it is the single home for these rules, so never restate them in
`AGENTS.md` or in a tool-specific pointer file.

Release tooling is **Changesets** (`@changesets/cli`, a root devDependency), adopted by owner
ruling **D-107**; **D-108** sets the versioning model. Both are in
`specs/080-f4-real-scope/rulings.md` and are settled — do not re-open them, and in particular
do not reach for Lerna, `semantic-release` or conventional-commit inference.

**The rule: a merge request that changes what a package publishes carries a changeset.**
For every package in this repository today that reads "a file under `packages/`", which is the
entire trigger; `backend`, `admin`, `storefront` and `docs` are in the config's `ignore` list
and never need one — they are applications, and nobody consumes them by version.

It is stated as *publishes* rather than as a directory because the two came apart (D-162).
`changeset status` asks the directory question, and `@endora-commerce/platform` (!891) keeps a
manifest, two tsconfigs and a README under `packages/platform` while compiling five directories
of `backend/src` — so the CLI waives a changeset for the code the package ships and demands one
for the README, which ships in nothing. **The honest question is "does this commit change what
a published package emits?"**, and the answer is a function of the package's
`tsconfig.build.json`, not of a path. `check:release-intent -- --since`, the second command in
`release:changeset`, asks it; nothing else in this repository can.

```bash
pnpm changeset             # write one (interactive)
pnpm changeset --empty     # record "this change carries no release meaning"
pnpm changeset:status      # what would be bumped
pnpm run version:packages  # cut a release branch: consume the changesets, bump, commit
```

`pnpm changeset:version` is the bare CLI underneath and is **not** the step to run by hand:
it exits 0 when it bumps nothing, which is exactly what a broken `.changeset/config.json`
produces. `version:packages` wraps it with the two refusals that turn that silence into a
failure.

Where a change genuinely has no release meaning — a comment, a test, a rename crossing no
export — write the empty changeset rather than looking for a way past the gate. It puts a
human's "I looked, there is nothing to release" in the diff, where a reviewer can disagree
with it.

A good changeset is written **for the consumer of the package**, not for the reviewer of the
branch: name the exported symbol, and for a `major` give the old call and the new one, because
nothing else in this repository will tell an upgrader what to do. One file per meaning, not
one per merge request. **The bump level is your judgement and cannot be delegated** — that is
why D-107 chose this tool: a change to `@endora-commerce/contracts` can be breaking for
`@endora-commerce/admin-kit`, which depends on it, and inert for
`@endora-commerce/cms-components`, which does not; no commit prefix knows which. (This sentence
named `@endora-commerce/api-client` as the breaking side until 2026-09-11, a package D-202 had
deleted.)

**One level is not yours to choose: `major` is refused while the package is in `0.x`** (D-225,
owner ruling of 2026-09-11 — no package leaves `0.x` before the move to public npmjs). Write
`minor`, and nothing is lost by it: `^0.7.0` is `>=0.7.0 <0.8.0`, so in a `0.x` series a minor
already takes every caret dependent out of range, which is the whole consumer-facing meaning of a
break, and *leaving the series* is the only thing `major` says that `minor` does not. The
instrument is `check:release-intent`'s `major-bump-in-a-zero-series`, which is derived per package
from that package's own manifest and has no override and no ledger — its one escape is deletion,
by the merge request that performs the npmjs move. Its row in `check-inventory.md` says why it
had to be an instrument rather than a remembered rule: the failure is silent, because
`changeset status` reports a `major` as ordinary intent, which it is.

**Versioning is independent, with one `linked` group** (D-108), built around
`@endora-commerce/page-builder-core`: its members take one version number whenever a release
includes more than one of them. **Who the members are is not written here** — `.changeset/config.json`'s
`linked` answers it, and this sentence named three of them while the file declared four
(`page-builder-admin` joined and nothing said so), which is D-100 met in the paragraph that
exists to explain the group. `page-builder-core` is a **peer** dependency of the rest and ships
React contexts and hooks, so the consuming application resolves exactly one copy; ranges that
disagree resolve two, and a provider in one copy against a consumer in the other is a `null`
context at runtime, not a type error. Everything outside the group versions on its own —
Changesets patch-bumps a dependent by itself (`updateInternalDependencies: "patch"`).

**Read `linked` precisely, because it does less than its name suggests and the regime decides
the rest.** `linked` **raises a package that is already in a release** to the group's highest
number; it never *adds* one. What puts the other members into a `page-builder-core` release is
their `peerDependencies` range going **out of range**, so the behaviour is a fact about the
version the group currently sits at and not about the group:

| seeded at | patch on one member | minor on `page-builder-core` | major |
| --- | --- | --- | --- |
| `0.0.0` | the member **and its dependents** (`^0.0.0` is `>=0.0.0 <0.0.1`) | the whole group | the whole group |
| `0.<n>.0`, n > 0 | the member alone | **the whole group** (`^0.7.0` is `>=0.7.0 <0.8.0`) | the whole group |
| `1.4.2` | the member alone | `page-builder-core` alone | the whole group |

Measured, over the real manifests, in `backend/test/unit/release/changeset-flow.test.ts` — which
seeds its own base rather than reading the tree's, because the tree's version is a release
decision that moves and it falsified four of these measurements once already. **The middle row is
the one this repository is in**, and its label is a shape rather than a number for the same
reason: it read `0.7.0` and `release/version-0.8.0` moved 83 packages out from under it within
the week. `node -p "require('./packages/contracts/package.json').version"` answers where the
estate sits today; what the row asserts is the *series*, and while it holds, D-225's
`major` → `minor` translation costs nothing — in `0.x` a minor already takes every caret peer
out of range, which is the whole consumer-facing meaning of a break.

The `1.4.2` divergence is correct, not a defect: the requirement is that the application resolve
one copy, and `^1.4.2` satisfied by `1.5.0` resolves one copy. The shared number was the
mechanism, never the requirement.

**The version step is `pnpm run version:packages`, and it runs locally.** It cuts a
`release/version-<date>` branch, runs `changeset version`, and refuses two things a bare
`pnpm changeset:version` cannot: a run with no changeset to consume, and a run that exited 0
having moved nothing it consumed. The second is the whole reason it exists — see the
`check:release-intent` row in `check-inventory.md`. It runs locally rather than in CI because a
version bump changes `packages/`, every change to `packages/` lands through a merge request,
and a CI job that could open one needs a push credential that D-160.5 defers to the merge
request that makes a package public. The reasoning is in the script's own header, in full.
`release:changeset` recognises the resulting branch from the **diff**, and since feature 114
(D-212) it recognises it by what the branch **produced** rather than by what it consumed: a
moved `version` in a versionable package's manifest, an added `## <version>` CHANGELOG section,
or both. A branch that deleted changeset files and produced neither is refused, which is the
inverted question in its new clothes — and an added changeset, empty or not, reclassifies
nothing.

**Tags: `privatePackages.tag` is `false`.** It is consulted only where changesets asks *which
private packages to tag* (`getUntaggedPrivatePackages`). Between the publication ruling of
2026-09-05 and D-267 there were none and the field decided nothing; since D-267 there is one —
`create-endora-commerce`, private until the first npmjs publish — and `false` is what keeps a
release from writing a tag for a version no registry serves. A public package is git-tagged by `changeset publish` regardless of it
(`@changesets/cli@3.0.1`, `dist/git-tag.mjs`). So the field is now held for the **reader**
rather than for the tool — `check:release-intent`'s `tag-policy-unstated` is total in both
states and, with nothing private left, requires it to be explicitly present and boolean, so
that an absent one cannot be mistaken for a decision when it is the `@changesets/config@4`
default.

**Whether the repository carries a git tag for a release is a separate question and is the
owner's.**
Nothing in this repository decides it, and nothing here should: a tag is how you assert that
this exact tree is what a registry serves under that version, which git history alone cannot say
about a registry, and that assertion is worth making only once something is actually published.
The tag question is therefore not the same question as this field, and reading the two together
is what made the paragraph above wrong twice.

Two things about `.changeset/config.json` that are load-bearing and look like boilerplate:

- **`privatePackages: { "version": true, "tag": false }`.** This bullet described a
  repository in which every package under `packages/` was `"private": true`; after the
  publication ruling of 2026-09-05 **none was**, and D-267 made one private again
  (`create-endora-commerce`), so `version: true` is once more what lets changesets version it. The measurement it records still holds for that state and is why it is
  written down at all. `@changesets/config@4` defaults
  `privatePackages` to `false`, which makes every changesets command skip all five and report
  a cheerful nothing — including the CI gate. `version: true` is what makes the tooling see
  them; `tag: false` keeps it from tagging things nobody publishes.
- **`ignore` matches package *names*, not paths.** It is glob-matched against
  `backend` / `admin` / `storefront` / `docs`, the names in those manifests. The
  `pnpm-workspace.yaml` globs decide only what is discovered as a workspace; they do not reach
  `ignore`, and `packages/*` written there would match nothing. A typo fails safe — the app
  stops being ignored and starts demanding changesets, loudly. **An over-broad pattern does
  not**: one entry reading `@endora-commerce/*` would exempt every module package at once,
  silently, and that is what `check:release-intent` refuses as `ignored-family-member`.

Neither bullet is enforced by being written here — both are `check:release-intent` findings,
in the `quality` job, on every merge request. They were written here and read by nothing until
feature 080's T043.

**Every package under `packages/` is public and `access` is `public`**, since the owner's
publication ruling of 2026-09-05 (D-208's consequence): four were already on the rehearsal
registry at `0.7.0` and the remaining 75 joined them in one commit, because `pnpm pack` rewrites
a `workspace:*` range to the sibling's **exact** version and a package left behind is every
dependent pinning a version the registry does not have. This paragraph read *"nothing is
published yet: every package is `"private": true` … `check:release-intent` goes red the moment
`private` comes off one"* — the direction has inverted, and the check now goes red the moment
`private` goes **on** one. Not publishing something is what takes a merge request that says so. **One member is private by
ruling rather than by accident** (D-267): `create-endora-commerce` is unscoped, the configured
target cannot serve an unscoped name, and nothing depends on it — `check:release-intent`
exempts exactly that conjunction, prints it, and refuses a publish to public npmjs while it
holds, so the first npmjs publish is the merge request that flips it.
The meta-package / supported-set question D-108 defers is still open, and so is the move to
public npmjs, which D-203 makes its own step. The longer guide, for the moment you are writing
the file, is `.changeset/README.md`.

