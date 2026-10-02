# Release intent — changesets

**Open this before changing anything a package publishes, and before cutting a release.** It
carries the rule (a pull request that changes what a package publishes carries a changeset),
the versioning model (lockstep, one `fixed` group), and the two `.changeset/config.json`
fields that look like boilerplate and decide whether the gate is looking at all. One of the
bodies `AGENTS.md` routes to; it is the single home for these rules, so never restate them in
`AGENTS.md` or in a tool-specific pointer file.

Release tooling is **Changesets** (`@changesets/cli`, a root devDependency), adopted by owner
ruling **D-107**; **D-108** set the versioning model, and the owner's ruling of 2026-10-01 replaced
its independent versioning with lockstep (below). Both are in
`specs/080-f4-real-scope/rulings.md` and are settled — do not re-open them, and in particular
do not reach for Lerna, `semantic-release` or conventional-commit inference.

**The rule: a pull request that changes what a package publishes carries a changeset.**
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
one per pull request. **The bump level is your judgement and cannot be delegated** — that is
why D-107 chose this tool: a change to `@endora-commerce/contracts` can be breaking for
`@endora-commerce/admin-kit`, which depends on it, and inert for
`@endora-commerce/cms-components`, which does not; no commit prefix knows which. (This sentence
named `@endora-commerce/api-client` as the breaking side until 2026-09-11, a package D-202 had
deleted.)

**One level is not yours to choose: `major` is refused while the package is in `0.x`** (D-225,
owner ruling of 2026-09-11, amended 2026-09-13 — no package leaves `0.x` until a release
deliberately does, and the move to public npmjs is not that release: its first version is
`0.100.0`, D-234). Write
`minor`, and nothing is lost by it: `^0.7.0` is `>=0.7.0 <0.8.0`, so in a `0.x` series a minor
already takes every caret dependent out of range, which is the whole consumer-facing meaning of a
break, and *leaving the series* is the only thing `major` says that `minor` does not. The
instrument is `check:release-intent`'s `major-bump-in-a-zero-series`, which is derived per package
from that package's own manifest and has no override and no ledger — its one escape is deletion,
by the pull request that takes the estate to `1.0.0`. **It survives the npmjs move** (123 T7-D):
this sentence read *"by the merge request that performs the npmjs move"* until D-225's amendment,
and a `major` that slips through after publication is a `1.0.0` on npmjs, which cannot be taken
back. Its row in `check-inventory.md` says why it
had to be an instrument rather than a remembered rule: the failure is silent, because
`changeset status` reports a `major` as ordinary intent, which it is.

**Every release publishes every package at one number — lockstep** (owner, 2026-10-01; it
supersedes D-108's independent versioning and the `linked` group built around
`@endora-commerce/page-builder-core`). The internal pins are **exact**: `pnpm pack` turns every
`workspace:*` into the sibling's version, and the scaffold pins `@endora-commerce/contracts`
exactly (S1, closed as by design on that ground), so a package versioned on its own would pin a
sibling at a number the rest of the set never carried. `.changeset/config.json` expresses it as
**one `fixed` group** whose entries are a glob for the scope and the unscoped front door —
`["@endora-commerce/*", "create-endora-commerce"]` — and an empty `linked`. Changesets matches
group entries with picomatch (`@changesets/config@4`), so a package added under the scope joins
the group without an edit. One changeset on any package releases all of them, at the highest bump
any pending changeset declares: a patch to one package after `0.100.0` is `0.100.1` for every
package.

`check:release-intent` holds it: `outside-the-release-group` reports a public versionable package
the one `fixed` group does not cover — an unscoped package added beside the front door, a second
`fixed` group, or a `linked` group standing in for `fixed` — and `stale-group-member` reports a
group entry, name or glob, that matches no workspace package. Measured over the real manifests and
this config in `backend/test/unit/release/changeset-flow.test.ts`, which seeds its own base, in
both the `0.x` and the `1.x` regime: under `fixed` the caret regime no longer decides anything,
which is what the old `linked` table spent a paragraph explaining.

**The changesets that predate `0.100.0` are deleted by the release pull request that cuts
`0.100.1`** (owner, 2026-10-01). `0.100.0` was a hand-set of every manifest and consumed none of
them, so the nineteen files still pending afterwards describe work that version already shipped;
consuming them would release it twice. They are deleted there rather than on their own because
`release:changeset` refuses a branch that deletes changesets and produces no release artefact
(`vacuous-release`, D-212) — and while they are pending, lockstep plans every package at the
highest bump among them, `0.101.0`.

**The release pull request also re-records the read sizes.** After `version:packages`, on the
release branch, re-measure on a pristine clone and re-record every entry the `[read-size drift]`
block names, in one commit — ordinary pull requests leave drift inside the band alone
(`check-estate.md` § *When a read size is re-recorded*), so this is where the record returns to
`0 drifted`.

**The version step is `pnpm run version:packages`, and it runs locally.** It cuts a
`release/version-<date>` branch, runs `changeset version`, and refuses two things a bare
`pnpm changeset:version` cannot: a run with no changeset to consume, and a run that exited 0
having moved nothing it consumed. The second is the whole reason it exists — see the
`check:release-intent` row in `check-inventory.md`. It runs locally rather than in CI because a
version bump changes `packages/`, every change to `packages/` lands through a pull request,
and a CI job that could open one needs a push credential D-160.5 deferred and CI still does not
hold. The reasoning is in the script's own header, in full.
`release:changeset` recognises the resulting branch from the **diff**, and since feature 114
(D-212) it recognises it by what the branch **produced** rather than by what it consumed: a
moved `version` in a versionable package's manifest, an added `## <version>` CHANGELOG section,
or both. A branch that deleted changeset files and produced neither is refused, which is the
inverted question in its new clothes — and an added changeset, empty or not, reclassifies
nothing.

*Amended 2026-09-30.* The D-160.5 sentence above said the credential was deferred *"to the merge
request that makes a package public"*. That step has happened — the publication ruling of
2026-09-05 made the packages public — and it did not bring the credential, so the deferral no
longer points at a future step; it describes a standing state. On GitHub Actions the state is
visible in the workflows themselves: `grep -n 'contents:' .github/workflows/*.yml` shows no job
granted more than `contents: read`, so no job can push a release branch or open its pull request.
The rule is unchanged — the version step runs locally — and giving CI that credential is an open
decision for the owner, not one waiting on an event. `scripts/version-packages.mjs`' header says
the same.

**Publishing is a separate, deliberate step and it runs in CI.** Since the move to GitHub
(2026-09-29) it is `.github/workflows/publish.yml` (`specs/129-github-canonical-migration/`
T041), written to replace `.gitlab-ci.yml`'s `publish:packages` — a job that file still carries
and that no longer runs anywhere canonical. `workflow_dispatch` is the deliberate act, the
`npm-publish` environment holds the registry and token and its required reviewer, and the job
requests npm provenance and refuses to publish without it. The publish credential it holds is
an npm token, not a push credential, so it changes nothing in the paragraph above. The workflow's
own header lists every fail-closed refusal it carries; they are not restated here.

**The first public version is a floor, and one instrument holds it for every release** (D-234;
123 §6a; `specs/137-open-source-launch/` N4). The first npmjs publish was `max(0.100.0, the highest
version any publishable package had reached)` — `0.100.0` — reached by a **hand-set** of `version`
in every publishable manifest on a `release/version-<n>` branch, never by `changeset version`,
which bumps minor by minor and could not get there. `check:release-intent --publish-registry
<npmjs>` refuses any publishable package below `FIRST_PUBLIC_VERSION`
(`public-version-below-the-declared-floor`, a refusal of that mode rather than a default-mode
finding, because every package was below the floor until the release branch set it). It
**stays**: after the first publish it refuses a package added to the workspace at a number of its
own — a new package joins at the release's current number — and a publish that would move npm's
`latest` down. Its network twin, `backend/scripts/first-publish-preconditions.ts`, asked npmjs
whether a publish really was the first and was deleted by the pull request after `0.100.0`, as
it was written to be: left in place it refused every later release.

**Tags: `privatePackages.tag` is `false`.** It is consulted only where changesets asks *which
private packages to tag* (`getUntaggedPrivatePackages`). Between the publication ruling of
2026-09-05 and D-267 there were none and the field decided nothing; from D-267 until
`specs/137-open-source-launch/` N3 there was one — `create-endora-commerce`, private until the
first npmjs publish — and `false` kept a release from writing a tag for a version no registry
served. Since N3 there is none again. A public package is git-tagged by `changeset publish` regardless of it
(`@changesets/cli@3.0.1`, `dist/git-tag.mjs`). So the field is now held for the **reader**
rather than for the tool — `check:release-intent`'s `tag-policy-unstated` is total in both
states: it requires `false` while any versionable package is private and, once nothing private
is left, requires the field to be explicitly present and boolean, so
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
  publication ruling of 2026-09-05 **none was**, D-267 made one private again
  (`create-endora-commerce`) and N3 made it public, so today it decides nothing and stays for the
  next private member. The measurement it records still holds for that state and is why it is
  written down at all. `@changesets/config@4` defaults
  `privatePackages` to `false`, which makes every changesets command skip every private
  package and report a cheerful nothing — including the CI gate. (This read *"skip all five"*,
  the private population on the day it was measured; which members are private today is the
  complement of the public list `--print-publish-scope` prints — see the last section.) `version: true` is what makes the tooling see
  them; `tag: false` keeps it from tagging things nobody publishes.
- **`ignore` matches package *names*, not paths.** It is glob-matched against
  `backend` / `admin` / `storefront` / `docs`, the names in those manifests. The
  `pnpm-workspace.yaml` globs decide only what is discovered as a workspace; they do not reach
  `ignore`, and `packages/*` written there would match nothing. A typo fails safe — the app
  stops being ignored and starts demanding changesets, loudly. **An over-broad pattern does
  not**: one entry reading `@endora-commerce/*` would exempt every module package at once,
  silently, and that is what `check:release-intent` refuses as `ignored-family-member`.

Neither bullet is enforced by being written here — both are `check:release-intent` findings,
in the `quality` job, on every pull request. They were written here and read by nothing until
feature 080's T043.

**Every package under `packages/` is public and `access` is `public`**, since the owner's
publication ruling of 2026-09-05 (D-208's consequence): four were already on the rehearsal
registry at `0.7.0` and every other member joined them in one commit, because `pnpm pack` rewrites
a `workspace:*` range to the sibling's **exact** version and a package left behind is every
dependent pinning a version the registry does not have. This paragraph read *"nothing is
published yet: every package is `"private": true` … `check:release-intent` goes red the moment
`private` comes off one"* — the direction has inverted, and the check now goes red the moment
`private` goes **on** one. Not publishing something is what takes a pull request that says so.
**How many members publish, and which, is not written here** (D-100): this paragraph used to
count them, and the count moves with every module package and every `"private"` flag. Ask the
program that decides it — `pnpm --filter backend exec tsx scripts/check-release-intent.ts
--print-publish-scope --publish-registry <registry>` prints the scope on stdout and, on stderr,
how many workspace members are public and which, the same invocation `publish.yml` uses to write
its `.npmrc`. Without `--publish-registry` it judges public npmjs, the default mode's own target,
so the bare `--print-publish-scope` answers too; a registry that is not public npmjs refuses the
unscoped `create-endora-commerce` with exit 2. **No member is
private by ruling any more.** D-267 kept `create-endora-commerce` private while the configured target was
GitLab's namespace-keyed endpoint, which cannot serve an unscoped name, and made the first npmjs
publish refuse while it held. `specs/137-open-source-launch/` N3 flipped it and made the scope rules
**target-aware**: `check:release-intent` judges the core's own target, public npmjs, which serves an
unscoped name from its default registry, so the exemption computes to nothing; a scoped name is
still judged as a GitLab namespace path on both targets, because a consumer that maps the scope to
the private registry reaches every free package through it; and a publish job that hands over a
registry which is not public npmjs gets that endpoint's judgement, refusing an unscoped member rather
than letting it fall through to npm's default registry. `publish.yml` hands its registry to
`--print-publish-scope` for the same reason.
The meta-package / supported-set question D-108 defers is still open, and so is the move to
public npmjs, which D-203 makes its own step. The longer guide, for the moment you are writing
the file, is `.changeset/README.md`.

