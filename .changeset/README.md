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
  `@b2b/contracts` can be breaking for `@b2b/api-client` and inert for
  `@b2b/cms-components`. Decide it deliberately.

## What the bumps do here

Versioning is **independent** (D-108), with one `linked` group:

| Group | Packages | Why |
| --- | --- | --- |
| Page Builder | `@b2b/page-builder-core`, `@b2b/cms-components`, `@b2b/email-components` | `page-builder-core` is a **peer** dependency of the other two and ships React contexts and hooks. The consuming application resolves exactly one copy; version ranges that disagree resolve two, and a provider in one copy with a consumer in the other is a `null` context, not a type error. So `linked` gives them one number **whenever a release includes more than one of them**, and a release of `page-builder-core` always includes all three, since the other two peer-depend on it. `cms-components` can still move on its own — it does not carry the runtime, so nothing skews. |

Read `linked` precisely: it makes the group agree on a number when a release includes more
than one of them. It does not force the other two out whenever one moves — a patch on
`@b2b/cms-components` alone leaves the other two where they are, which is right, because
`cms-components` carries no runtime the app has to resolve once.

`@b2b/contracts` and `@b2b/api-client` version independently. Changesets patch-bumps a
dependent automatically (`updateInternalDependencies: "patch"`), so a `contracts` release
carries `api-client` with it without either sharing the other's number. They are deliberately
*not* linked: `api-client` names exactly one erased type from `contracts`, the version the pair
really has to agree with is the **server's** — the supported-set question D-108 defers — and a
shared number would churn `api-client` on every contracts change without saying anything true.

Nothing is published yet — all five packages are still `"private": true`. `privatePackages`
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
| `pnpm changeset:version` | Consume the changesets: bump versions, write `CHANGELOG.md` |

`changeset status` with no `--since` compares against `baseBranch`, which is the **local**
`master` — usually stale, and then it reports every package touched in the commits you have
not pulled. Pass the remote ref when you want the answer CI gives:
`pnpm changeset:status --since=origin/master`.

There is deliberately no `release` / `publish` script. Nothing in this repository is
published, and a script named for an action it cannot perform is worse than its absence.
Adding it belongs to the merge request that makes a package public.
