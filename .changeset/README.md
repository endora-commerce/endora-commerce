# Changesets

This folder holds the release intent for the workspace packages under `packages/` and
`packages/modules/`. How many there are, and how many of them publish, is not written here: the
count moves with every module package and every `"private"` flag, so it does not belong in a
sentence (D-100). Ask the program that decides it:

```bash
pnpm --filter backend exec tsx scripts/check-release-intent.ts --print-publish-scope
```

It prints the npm scope on stdout and, on stderr, how many workspace members are public and
which — the same derivation the publish workflow uses to write its `.npmrc`.
The tooling is [Changesets](https://changesets.dev), adopted by owner ruling **D-107**
(`specs/080-f4-real-scope/rulings.md`); **D-108** sets the versioning model.

The rules themselves live in `specs/conventions/release-intent.md`, which is their single
home. This page is the practical guide, for the moment you are actually writing a file here;
where the two disagree, the convention wins and this page is the one to fix.

## When you need one

**A pull request that changes what a package publishes needs a changeset.** For almost
every package that reads "a file under `packages/`", but the rule is stated as *publishes*
because the two came apart (D-162): `@endora-commerce/platform` compiles code from outside its
own directory, so the honest question is "does this commit change what a published package
emits?", and it is answered by the package's `tsconfig.build.json`, not by a path. `backend`,
`admin`, `storefront` and `docs` are in the config's `ignore` list and never need one — they
are applications, not packages, and nobody consumes them by version.

CI enforces it: the `release:changeset` job (`.github/workflows/quality.yml`) runs
`pnpm --filter backend run check:release-intent -- --since origin/<base>` on every pull
request and fails when a published package changed and the branch carries no changeset. Run
the same command locally, with `--since origin/master`, before you push.

If the change genuinely carries no release meaning — a comment, a test, a rename that
crosses no export — record that decision instead of skipping the gate:

```bash
pnpm changeset --empty
```

An empty changeset is a claim in the diff that a human looked and said "nothing to
release". It is reviewable. A skipped check is not.

## Writing one

```bash
pnpm changeset
```

Pick the packages, pick the bump, write the summary. The summary is read by whoever is
deciding whether to upgrade, so:

- **Write it for the consumer, not for the reviewer.** "Add `channel` to
  `productListQuerySchema`" — not "refactor query schema per !812".
- **A breaking change says what breaks and what to do instead.** Give the old call and the
  new one. Nothing else in this repository will tell an upgrader that.
- **Write `minor`, not `major`, while the package is in `0.x`** (D-225). `check:release-intent`
  refuses a `major` there as `major-bump-in-a-zero-series`. Nothing is lost: `^0.7.0` is
  `>=0.7.0 <0.8.0`, so in a `0.x` series a minor already takes every caret dependent out of
  range, which is the whole consumer-facing meaning of a break.
- **One changeset per meaning, not per merge request.** A branch that fixes a bug and adds
  a field carries two files, so the changelog carries two lines.
- **The bump is a judgement, and it is yours.** D-107 chose this tool precisely because
  "is this breaking?" cannot be recovered from a commit prefix: a change to
  `@endora-commerce/contracts` can be breaking for `@endora-commerce/admin-kit` and inert for
  `@endora-commerce/cms-components`. Decide it deliberately.

## What the bumps do here

Versioning is **independent** (D-108), with one `linked` group built around
`@endora-commerce/page-builder-core`. **Who its members are is not written here** —
`.changeset/config.json`'s `linked` answers it; this page once named three while the file
declared four.

`page-builder-core` is a **peer** dependency of the other members and ships React contexts and
hooks. The consuming application resolves exactly one copy; version ranges that disagree
resolve two, and a provider in one copy with a consumer in the other is a `null` context, not
a type error. So `linked` gives the members one number **whenever a release includes more than
one of them**.

Read `linked` precisely. It **raises a package that is already in a release** to the group's
highest number; it never *adds* one. What puts the other members into a `page-builder-core`
release is their `peerDependencies` range going **out of range**, so the behaviour depends on
the version the group currently sits at:

| Seeded at | Patch on one member | Minor on `page-builder-core` | Major |
| --- | --- | --- | --- |
| `0.0.0` | the member **and its dependents** (`^0.0.0` is `>=0.0.0 <0.0.1`) | the whole group | the whole group |
| `0.<n>.0`, n > 0 | the member alone | **the whole group** (`^0.7.0` is `>=0.7.0 <0.8.0`) | the whole group |
| `1.4.2` | the member alone | `page-builder-core` alone | the whole group |

The middle row is the one this repository is in;
`node -p "require('./packages/contracts/package.json').version"` answers where it sits today.
The `1.4.2` divergence is correct rather than broken: the requirement is that the application
resolve one copy of `page-builder-core`, and `^1.4.2` satisfied by `1.5.0` resolves one copy.
The shared number was the mechanism, never the requirement. Every row is asserted by
`backend/test/unit/release/changeset-flow.test.ts`, which seeds its own base version over the
real manifests and this config, so nobody meets the `1.4.2` row for the first time in a release
pull request.

`@endora-commerce/contracts` and its dependents version independently. Changesets patch-bumps a
dependent automatically (`updateInternalDependencies: "patch"`), so a `contracts` release
carries `@endora-commerce/admin-kit` and `@endora-commerce/page-builder-core` with it without
either sharing its number. They are deliberately *not* linked: what a consumer of those
packages really has to agree with is the **server's** version — the supported-set question
D-108 defers — and a shared number would churn every dependent on each contracts change
without saying anything true. `@endora-commerce/api-client` was this paragraph's worked
example until D-202 deleted the package.

**Every workspace package under `packages/` is public unless a ruling keeps it private, and
`access` is `public`** — the owner's publication ruling of 2026-09-05. Not publishing something
is the exception, and it takes a pull request that says so: `check:release-intent` reports
`unpublished-package` the moment `"private": true` appears on a versionable package. No package
is private by ruling any more: `create-endora-commerce`, unscoped, was kept private under D-267
while the configured target could not serve its name, and `specs/137-open-source-launch/` N3
made it public. The scope rules now take a target. Public npmjs, which the default mode judges,
serves an unscoped name from its default registry, so the D-267 exemption computes to nothing
and the `exempt-private=` line prints `0`; `--publish-registry` with any other registry refuses
an unscoped public package rather than letting it fall through to npm's default registry. Which
packages publish today is whatever `--print-publish-scope` (above) reports, not a number or a
list on this page.

`privatePackages` is `{ "version": true, "tag": false }`. `version: true` is what makes the
tooling see a private package at all — with the `@changesets/config@4` default (`false`), every
command here would report a cheerful nothing for it. `tag: false` keeps a release from writing
a git tag for a private version no registry serves. Neither field affects a public package: it
is versioned, published and tagged regardless of that block.

## Commands

| Command | Does |
| --- | --- |
| `pnpm changeset` | Write a changeset (interactive) |
| `pnpm changeset --empty` | Record "no release meaning" |
| `pnpm changeset:status` | What would be bumped, and by how much |
| `pnpm changeset:status --verbose` | …and to which version, and from which files |
| `pnpm run version:packages` | Cut a release branch: consume the changesets, bump, commit |
| `pnpm changeset:version` | The bare CLI underneath. Prefer the row above — see below |

`changeset status` with no `--since` compares against `baseBranch`, which is the **local**
`master` — usually stale, and then it reports every package touched in the commits you have
not pulled. Pass the remote ref when you want the answer CI gives:
`pnpm changeset:status --since=origin/master`.

## Releasing

```bash
pnpm run version:packages
git push -u origin release/version-<date>
gh pr create --base master --head release/version-<date>
```

That is the whole flow, and it runs **on your machine** rather than in CI. The reasoning is in
`scripts/version-packages.mjs`' header in full; the short version is that a version bump is a
change to `packages/`, every change to `packages/` lands through a pull request, and a CI job
that could open one needs a push credential D-160.5 deferred and CI still does not hold.

**Do not run `pnpm changeset:version` by hand.** It exits **0** when it bumps nothing —
measured on this repository, with `privatePackages.version` at the `@changesets/config@4`
default of `false` and a pending changeset naming `@endora-commerce/contracts`: exit 0, "All files have
been updated", no version moved, and the changeset still on disk. `version:packages` refuses
that, and refuses a release with nothing to consume, and restores the tree either way.

The resulting pull request deletes every changeset it consumed and carries none, which is
precisely the shape `release:changeset` would otherwise fail. Since feature 114 (D-212) the job
recognises a release branch by what it **produced**: a moved `version` in a versionable
package's manifest, an added `## <version>` CHANGELOG section, or both. A branch that deleted
changeset files and produced neither is refused, and an added changeset, empty or not,
reclassifies nothing.

**Publishing is a CI workflow, not a script here.** `publish:packages`
(`.github/workflows/publish.yml`, `workflow_dispatch` only, in the `npm-publish` environment,
which carries the credentials and the required reviewer) runs `changeset publish` against the
registry `ENDORA_NPM_REGISTRY` names, with npm provenance and with the token as an environment
reference in an `.npmrc` written outside the checkout. It derives the scope from
`--print-publish-scope`, refuses an unset registry or token rather than falling through to
`registry.npmjs.org` or publishing anonymously, refuses a registry/licence pair or a D-267
exemption that public npmjs cannot take, and refuses a run whose publish plan turns out to be
empty. There is still no `release` script in `package.json`: the credential belongs to CI and
a script that cannot reach it is worse than its absence.

## Tags

`privatePackages.tag` is `false`. It is consulted only where changesets asks *which private
packages to tag*, so it governs only the members D-267 keeps private (see above), and `false`
is what keeps a release from writing a tag for a version no registry serves. A private package's
version is re-derivable from the commit that wrote its `version` field; a tag for it would be a
derived fact written down (D-100), in a ref every clone then fetches.

A public package is git-tagged by `changeset publish` whatever the field says
(`@changesets/cli@3.0.1`, `dist/git-tag.mjs`). **Whether the repository keeps and pushes those
tags is a separate question, and it is the owner's**: a tag asserts that this exact tree is
what a registry serves under that version, which is worth asserting only once something is
actually published there.

**The field is enforced in both states.** `check:release-intent`'s `tag-policy-unstated`
requires `tag: false` while any versionable package is private and, once none is, still
requires the field to be explicitly present and boolean — so an absent one cannot be mistaken
for a decision when it is only the `@changesets/config@4` default.
