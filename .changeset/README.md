# Changesets

This folder holds the release intent for the five workspace packages under `packages/`.
The tooling is [Changesets](https://changesets.dev), adopted by owner ruling **D-107**
(`specs/080-f4-real-scope/rulings.md`); **D-108** sets the versioning model.

The short version of the rule lives in `AGENTS.md` § *Release intent — changesets*. This
page is the longer one, for the moment you are actually writing a file here.

## When you need one

**A merge request that changes a file under `packages/` needs a changeset.** That is the
whole trigger. `backend`, `admin`, `storefront` and `docs` are in the config's `ignore`
list and never need one — they are applications, not packages, and nobody consumes them by
version.

CI enforces it: the `release:changeset` job runs `changeset status --since=origin/<target>`
on every merge request and fails when a package changed and the branch carries no changeset.

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
- **A `major` says what breaks and what to do instead.** Give the old call and the new one.
  Nothing else in this repository will tell an upgrader that.
- **One changeset per meaning, not per merge request.** A branch that fixes a bug and adds
  a field carries two files, so the changelog carries two lines.
- **The bump is a judgement, and it is yours.** D-107 chose this tool precisely because
  "is this breaking?" cannot be recovered from a commit prefix: a change to
  `@endora-commerce/contracts` can be breaking for `@endora-commerce/admin-kit` and inert for
  `@endora-commerce/cms-components`. Decide it deliberately.

## What the bumps do here

Versioning is **independent** (D-108), with one `linked` group:

| Group | Packages | Why |
| --- | --- | --- |
| Page Builder | `@endora-commerce/page-builder-core`, `@endora-commerce/cms-components`, `@endora-commerce/email-components` | `page-builder-core` is a **peer** dependency of the other two and ships React contexts and hooks. The consuming application resolves exactly one copy; version ranges that disagree resolve two, and a provider in one copy with a consumer in the other is a `null` context, not a type error. So `linked` gives them one number **whenever a release includes more than one of them**. `cms-components` can still move on its own — it does not carry the runtime, so nothing skews. |

Read `linked` precisely, and precisely is narrower than this page used to claim. It **raises a
package that is already in a release** to the group's highest number; it never *adds* one. It
does not force the other two out whenever one moves — a patch on `@endora-commerce/cms-components` alone
leaves the other two where they are, which is right, because `cms-components` carries no
runtime the app has to resolve once.

The sentence that stood here — *"a release of `page-builder-core` always includes all three,
since the other two peer-depend on it"* — was measured wrong in feature 080's T043. What puts
the peers into a `page-builder-core` release is their `peerDependencies` range going **out of
range**, and every package sits at `0.0.0`, where `workspace:^` resolves to `^0.0.0` and any
bump at all breaks it. So it holds today by accident of the version, and stops holding at the
first real release:

| Seeded at | Change | Result |
| --- | --- | --- |
| `0.0.0` | minor on `page-builder-core` | all three → `0.1.0` |
| `0.0.0` | patch on `cms-components` | `cms-components` → `0.0.1`, others unmoved |
| `1.4.2` | minor on `page-builder-core` | `page-builder-core` → `1.5.0`, **others unmoved** |
| `1.4.2` | major on `page-builder-core` | all three → `2.0.0` |

The third row is correct rather than broken: the requirement is that the application resolve
one copy of `page-builder-core`, and `^1.4.2` satisfied by `1.5.0` resolves one copy. The
shared number was the mechanism, never the requirement. Every row is asserted by
`backend/test/unit/release/changeset-flow.test.ts`, against these manifests and this config,
so nobody meets the third one for the first time in a release merge request.

`@endora-commerce/contracts` and its dependents version independently. Changesets patch-bumps a
dependent automatically (`updateInternalDependencies: "patch"`), so a `contracts` release
carries `@endora-commerce/admin-kit` and `@endora-commerce/page-builder-core` with it without
either sharing its number. They are deliberately *not* linked: what a consumer of those
packages really has to agree with is the **server's** version — the supported-set question
D-108 defers — and a shared number would churn every dependent on each contracts change
without saying anything true. `@endora-commerce/api-client` was this paragraph's worked
example until D-202 deleted the package.

Nothing is published yet — every package under `packages/` is still `"private": true`. `privatePackages`
is set to `{ "version": true, "tag": false }`, which is what makes the tooling see them at
all: with the `@changesets/config@4` default (`false`), every command here would report a
cheerful nothing.

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
git push -o merge_request.create -o merge_request.remove_source_branch -u origin release/version-<date>
```

That is the whole flow, and it runs **on your machine** rather than in CI. The reasoning is in
`scripts/version-packages.mjs`' header in full; the short version is that a version bump is a
change to `packages/`, every change to `packages/` lands through a merge request, and a CI job
that could open one needs a push credential that D-160.5 defers to the merge request that
makes a package public.

**Do not run `pnpm changeset:version` by hand.** It exits **0** when it bumps nothing —
measured on this repository, with `privatePackages.version` at the `@changesets/config@4`
default of `false` and a pending changeset naming `@endora-commerce/contracts`: exit 0, "All files have
been updated", no version moved, and the changeset still on disk. `version:packages` refuses
that, and refuses a release with nothing to consume, and restores the tree either way.

The resulting merge request deletes every changeset it consumed and carries none, which is
precisely the shape `release:changeset` exists to fail. The job recognises it from the diff —
files deleted under `.changeset/` and none added — and asks the inverted question instead: did
any package's `version` actually move.

There is deliberately no `release` / `publish` script. Nothing in this repository is
published, and a script named for an action it cannot perform is worse than its absence.
Adding it belongs to the merge request that makes a package public — and
`pnpm --filter backend run check:release-intent` goes red the moment `private` comes off a
package, so that merge request has to say so out loud.

## Tags

There are none, and that is an answer rather than a default.

`privatePackages.tag` is `false`. While every package is private, a git tag naming a package
version anchors nothing a reader cannot re-derive from the commit that wrote the `version`
field — which is a derived fact written down (D-100), here written into a ref that every clone
then fetches, and there would be 67 of them per release once the module packages land. What
would make a tag *anchor* something is publication: a tag is how you assert that this exact
tree is what a registry serves under that version, and git history alone cannot say anything
about a registry.

So the answer is **coupled to publication rather than written down**:
`check:release-intent` requires `tag: false` exactly while every versionable package is
private, and reports the first package that stops being private. The tag decision therefore
lands in the merge request that creates the need for it, which is the only one that can make
it.
