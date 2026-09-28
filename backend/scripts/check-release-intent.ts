/**
 * CI check — the release-intent gate cannot silently stop asking (feature 080, T043).
 *
 * ## The defect this exists for
 *
 * `release:changeset` runs `changeset status --since=origin/<target>` on every
 * merge request, and D-107 makes that the gate: a branch that changes a package
 * under `packages/` and carries no changeset fails. The gate is the changesets
 * CLI's own command, so there is nothing of *ours* in it to keep correct — which
 * was the stated reason it needed no check of its own, and which is exactly
 * backwards. The CLI is correct. What decides whether it is *looking* is
 * `.changeset/config.json`, and every way that file can be wrong produces
 * **exit 0 with an empty release plan**, which is byte-identical to a clean
 * branch.
 *
 * Measured on this repository, against the real five manifests, with a branch
 * that changes `packages/contracts/src/index.ts` and carries no changeset:
 *
 * ```
 * privatePackages: { version: true,  tag: false }   exit 1   <- the gate
 * privatePackages: { version: false, tag: false }   exit 0   "Packages to be bumped:" (none)
 * privatePackages omitted entirely                  exit 0   "Packages to be bumped:" (none)
 * ```
 *
 * All five packages are `"private": true`, and `@changesets/config@4` defaults
 * `privatePackages` to `false`. So the single most damaging edit anyone can make
 * to the release flow is **deleting four lines of what looks like boilerplate**,
 * and before this file nothing in the repository would have noticed: no test
 * read the config, and an MR that touches only `.changeset/` matches no rung of
 * `.backend-test-rules`, so no suite ran against it either.
 *
 * ## What it refuses
 *
 * The findings below, each a way the flow goes quiet rather than red. This line
 * read *"Eight findings"* against a list that already held eleven, and the two
 * were never going to be corrected together — a count of a derived fact,
 * written down (D-100), in the header of the check whose whole population is
 * derived. `ReleaseIntentFindingKind` is the list, and it is the one that
 * cannot go stale. Every finding is
 * derived from the tree on every run — the workspace globs, the manifests, the
 * changeset files — because a rule of the form "these four names are the
 * applications" is a derived fact written down (D-100), and the 67-package
 * future of D-160.2 is precisely the moment such a list stops describing the
 * repository.
 *
 *   * `version-disabled` — a versionable member is `"private": true` while
 *     `privatePackages.version` is not `true`. The measurement above.
 *   * `unpublished-package` — a versionable member that **is**
 *     `"private": true`. The third spelling of one question, and the direction
 *     the question now has a subject in — see *The publication set* below.
 *     One derived exemption (D-267), printed as `exempt-private=`: see *The
 *     exemption, and where it expires* below.
 *   * `incomplete-public-package` — a public versionable member that declares
 *     no `repository` or no `publishConfig.access`. Fitness to be published,
 *     which is the question `publishable-package` was standing in for.
 *   * `unlicensed-package` — a public versionable member that declares no
 *     `license`. D-203's amendment deferred this to *"the merge request that
 *     makes a package public on npmjs"*; the owner's ruling of 2026-09-06 is
 *     that one — open core `MIT`, a paid package `SEE LICENSE IN LICENSE.md`,
 *     the split by **package**, entitlement contractual. Its own kind rather
 *     than a third field on `incomplete-public-package`, because the remedy is
 *     a decision rather than a value and because one number over three fields
 *     cannot say which of them is missing.
 *   * `unresolvable-license-file` — a member whose licence is the
 *     `SEE LICENSE IN <file>` form while that file is not in the package
 *     directory. The only licence value that makes a second claim, and the only
 *     part of the vocabulary this check judges: an SPDX identifier list is a
 *     derived fact written down (D-100) that moves without this repository.
 *   * `restricted-public-package` — a public versionable member whose effective
 *     access resolves to `restricted`. On npmjs a scoped package is private by
 *     default and a private package needs a paid account, so this is a publish
 *     that fails or a package that is quietly unreachable; GitLab ignores
 *     `--access` entirely, so the rehearsal exercises no access decision and
 *     the value has to be judged statically (feature 104, FR-012).
 *   * `unresolvable-scope` — a public versionable member whose scope the
 *     configured registry cannot serve (feature 104, FR-013). See *The scope*
 *     below: the failure is **silent**, which is why it is a static finding
 *     rather than something a failing install would reveal.
 *   * `tag-policy-unstated` — the total replacement of
 *     `tag-without-publication`. See *Tags* below.
 *   * `ignored-family-member` — an `ignore` pattern matching a package that a
 *     *family* workspace glob produced. This is the 67-package failure mode:
 *     `ignore` is glob-matched against package **names**, so one entry reading
 *     `@endora-commerce/*` would exempt every module package from the gate at
 *     once, and `changeset status` would go on printing a cheerful exit 0.
 *   * `unignored-application` — the same rule pointing the other way: a package
 *     from a *literal* workspace entry that no `ignore` pattern matches. It says
 *     the ignore list is **complete**, not merely safe.
 *   * `stale-ignore-entry` — an `ignore` pattern matching no member at all. A
 *     path written where a name belongs (`packages/*`) matches nothing, and the
 *     entry it replaced stops being ignored — loud for an application, and the
 *     reason `AGENTS.md` says a typo fails safe. It is still a claim about this
 *     repository that this repository no longer contains.
 *   * `stale-group-member` — a `linked` or `fixed` group naming a package that
 *     is not a workspace member. The group silently stops covering it; nothing
 *     else reports that.
 *   * `unversionable-changeset` — a `.changeset/*.md` naming a package that is
 *     ignored, or that is not a member. This is the reconciliation: the
 *     changeset files are written by hand, the classification is derived from
 *     the workspace, and a disagreement between them means somebody's release
 *     intent will be dropped on the floor by `changeset version`.
 *   * `major-bump-in-a-zero-series` — a changeset entry declaring `major` for a
 *     package whose own `version` has major `0`. **D-225**: no package leaves
 *     `0.x` before the move to public npmjs, which is that ruling's retiring
 *     condition. See *The series* below.
 *
 * ## The ninth, and the one that needs a diff — `--since <ref>`
 *
 * `changeset status` decides *which* packages a branch changed by asking which
 * package **directory** each changed file sits under. That is right for a
 * package whose sources are its own directory, and it is wrong — silently, and
 * in the dangerous direction — for one whose sources are not.
 *
 * `@endora-commerce/platform` is the case. Its `tsconfig.build.json` sets
 * `rootDir` to `../../backend/src` and includes five directories of it, so
 * `packages/platform/` holds a manifest, two tsconfigs and a README while the
 * code it publishes lives under `backend` — which is in `ignore`. Measured on
 * `origin/feat/080-t042a-host-package`: a commit editing
 * `backend/src/kernel/settings/settings-cache.ts`, compiled straight into the
 * published `dist`, reports `Packages to be bumped:` **empty** and exits 0,
 * while a commit editing `packages/platform/README.md`, which ships in nothing,
 * exits 1. The gate demands a changeset for the changes that cannot reach a
 * consumer and waives it for the changes that can.
 *
 *   * `unattributed-published-change` — this branch changes a file that a
 *     versionable package compiles into its published `dist`, that file is
 *     outside the package's own directory, and the branch adds no changeset.
 *
 * The population is derived from each versionable package's own
 * `tsconfig.build.json` — its `include` and `exclude`, following `extends` —
 * because the answer to *"does this commit change what a package emits?"* is a
 * function of the compilation and not of a directory name, and a second copy of
 * the include list written into a check is the derived fact D-100 forbids.
 *
 * It is the same question the CLI asks, at the CLI's granularity: *did a
 * versionable package change while this branch carries zero changesets*, not
 * *is there a changeset per package*. One rule, one grammar; reviewers close the
 * per-package gap for both halves.
 *
 * This mode needs a git diff, so it runs in `release:changeset` — the one job
 * that installs git and resolves the target branch — rather than in `quality`.
 * The default mode is untouched by it and reads no build configuration at all.
 *
 * ## And it classifies the branch before it asks — `--since`, feature 114
 *
 * `release:changeset` used to decide, in twelve lines of shell, whether a branch
 * was a *release* — and it decided it by a **tool's signature**: changeset files
 * deleted and none added, which is what `changeset version` leaves behind.
 * D-210 performs a release **without** that tool, in two acts, and neither
 * carries the signature, so neither had a verdict. Measured:
 *
 * ```
 * the hand-set release (79 `version` fields moved, nothing consumed)
 *     -> ordinary branch -> `changeset status` -> exit 1
 * the history landing (215 changesets consumed, no `version` moved)
 *     -> classified a release -> "it moved no package version" -> exit 1
 * either shape, plus one EMPTY changeset
 *     -> exit 0, and for the landing the branch leaves the release class
 *        entirely, so nothing asks whether it released anything
 * ```
 *
 * The gap was never that the gate refused these shapes. It is that **the only
 * way past it was a lockpick**, and AGENTS.md's own instruction about the empty
 * changeset — *"write the empty changeset rather than looking for a way past the
 * gate"* — is the thing that ruled the repair out while the measurement showed
 * it available.
 *
 * D-212 replaces the signature with the **artefact**:
 *
 *   * `vacuous-release` — the branch deleted changeset files and produced no
 *     release artefact of any kind. The refusal the shell already carried, with
 *     its teeth where they were: under `privatePackages.version: false` the
 *     no-op writes no version, writes no changelog and does not even delete the
 *     changeset files, so widening the artefact to *a changelog section* cannot
 *     reach it.
 *   * `manifest-changed-beyond-version` — a versionable package's manifest moved
 *     in some key other than `version` while the branch adds no changeset.
 *     Release-neutrality is **field-level**: an accidental version edit passes,
 *     an accidental `exports` narrowing does not, and that is the half nothing
 *     else in this repository can see.
 *   * `unattributed-package-change` — `changeset status`' own exit, attributed
 *     rather than relayed. FR-007: the command is unchanged and is not
 *     reimplemented; what moved is the decision of which branch to ask it of,
 *     which was never the CLI's. That decision is here rather than in the shell
 *     because a shell cannot take a fixture at the top of its analysis
 *     (issue #130), and its only judge was a *second implementation* of the same
 *     two `git diff` invocations inside `changeset-gate.test.ts` — two
 *     derivations of one predicate.
 *
 * {@link classifyReleaseShape} is the table, {@link readReleaseArtefacts} is
 * where the facts come from, and `contracts/release-shape-classification.md` in
 * `specs/114-release-shape-gate/` is normative for both.
 *
 * ## The series — `major-bump-in-a-zero-series` (D-225, FR-017)
 *
 * The owner, 2026-09-11: no package leaves `0.x` before the move to public
 * npmjs, because what is on the registry is still not a production solution.
 * That is a decision about one thing only — *leave the series* — and in a `0.x`
 * series it is the **only** thing `major` says that `minor` does not: `^0.7.0`
 * is `>=0.7.0 <0.8.0`, so `0.8.0` and `1.0.0` are both out of range for every
 * caret dependent. Measured on the `linked` group, where a *minor* on
 * `page-builder-core` moves all four packages precisely because the peers go
 * out of range, which is the propagation a major causes.
 *
 * So the rule is refused rather than remembered, and the reason it is an
 * instrument is that the failure is **silent**: a `major` changeset sits in
 * `.changeset/` for weeks and is applied by a release nobody is watching.
 * `changeset status` reports it as ordinary intent — it is ordinary intent —
 * and nothing else in this repository reads a bump level at all.
 *
 * Three properties, each of them the requirement rather than an implementation
 * note:
 *
 *   * **Derived per package**, from that package's own manifest — never a
 *     global "the estate is in `0.x`" flag and never a list. A mixed estate is
 *     judged correctly, and a package that has left `0.x` stops being judged in
 *     the same run that moves it.
 *   * **No override and no ledger.** The rule has one escape and it is
 *     deletion: the merge request that performs the npmjs move removes this
 *     finding in the same diff that performs the bump, which is the visibility
 *     a one-way door deserves. A flag would be a switch somebody could flip
 *     quietly, and a ledger entry could only license the thing D-225 forbids.
 *   * **The empty changeset is untouched.** `---`, `---`, then a summary is
 *     what AGENTS.md tells an author to write for a change with no release
 *     meaning, and ten of the eighty-four files pending when this landed are
 *     one. The discriminator between that and a file carrying no front matter
 *     at all is the **presence of the delimiters**, never the entry count —
 *     a predicate keyed on the count refuses every empty changeset in the tree.
 *     {@link readChangesetDocument} is where the two are told apart.
 *
 * ## Family or application, derived
 *
 * `pnpm-workspace.yaml` is the authority and the discriminator is the **shape of
 * the entry**: one containing a glob character enumerates a *family* — a set of
 * libraries whose membership is not known in advance, which is what a library
 * directory is — and a literal entry names one deployable. Today that reads
 * `backend`, `storefront`, `admin`, `docs` as applications and `packages/*` as
 * the family, which is the split `AGENTS.md` states in prose. It costs nothing
 * when 66 module packages arrive under a second scope and a directory deeper:
 * they arrive through a glob, so they are versionable by default and the
 * `ignore` list does not grow.
 *
 * A member matched by both a literal and a family entry counts as **family**.
 * That is the failing-safe direction: a versionable package demands a changeset,
 * and an ignored one demands nothing.
 *
 * ## The publication set — and why it stopped being a closure
 *
 * This question has had three subjects, and each one was retired by the ruling
 * that made its answer constant.
 *
 * `publishable-package` refused **every** public versionable member, which is
 * what forced the first publication to be a merge request (D-160.5). D-203
 * published four, so the predicate fired four times on a correct tree, forever.
 *
 * `unexpected-public-package` replaced it with *may this package be public*,
 * answered by the transitive closure, over `dependencies` and
 * `peerDependencies`, of what a client obtains directly: the reference
 * storefront's dependencies, and every versionable member declaring a `bin`
 * (feature 104, FR-001; D-208's second root).
 *
 * **The owner's publication ruling of 2026-09-05 retires that one too, and the
 * arithmetic is the argument.** Every `@endora-commerce` package publishes,
 * because a deployment builds its own instance (D-208) and an instance takes the
 * platform, the admin kit and all 70 module packages as dependencies while
 * holding a copy of none. Measured on this tree, the honest closure — the two
 * roots above, plus the module packages an instance composes, read off the
 * `endora.type` each package declares about itself — reaches **78 of the 79**
 * versionable members. The 79th is `@endora-commerce/test-kit`, which
 * `specs/109-backend-test-kit/` FR-001 independently requires to be published
 * ("A published package MUST exist that composes a backend server for a test")
 * and which **no** closure can reach: a test kit is a `devDependency` by
 * construction, and excluding `devDependencies` is load-bearing — the one
 * package that dev-depends on five siblings a consumer installs none of is
 * `page-builder-admin`.
 *
 * A derivation that answers *all of them but one, and the one is mandated
 * elsewhere* discriminates nothing. It is an expensive way to compute the whole
 * set, with a hand-written exception waiting to be added to it — which is this
 * estate's own retiring condition for a predicate that has outgrown its
 * population: narrow it, never add the entry.
 *
 * So the population is now every versionable member, and the question inverts
 * to the direction that has a subject: **`unpublished-package`**, a versionable
 * member that is `"private": true`.
 *
 * That is not the old rule with its sign flipped for tidiness. It is a
 * strictly better finding, because it guards a hazard the old one could not see
 * and the generator's own default used to produce. `pnpm pack` rewrites a
 * `workspace:*` range to the sibling's **exact** version, so one package left
 * behind is every dependent's packed manifest pinning `0.7.0` of something the
 * registry never receives — `ERR_PNPM_NO_MATCHING_VERSION` at the first
 * consumer's install, from a `changeset publish` that reported success. Nothing
 * else in the flow says so: `changeset publish` skips a private package in
 * silence, which is the same silence `version-disabled` is about, one field
 * over.
 *
 * The escape is unchanged and symmetric. A package that genuinely must not
 * publish declares `private` and this check goes red, so *not* publishing
 * something is its own decision made in a merge request that says so — exactly
 * as publishing something used to be.
 *
 * ## The exemption, and where it expires (D-267)
 *
 * `create-endora-commerce` is unscoped and goes to public npmjs only, so while
 * the configured target is GitLab's namespace-keyed endpoint it cannot be green
 * as either state: public, it is `unresolvable-scope` and {@link publishScope}
 * refuses it; private, it is `unpublished-package`. The ruling keeps it private
 * and makes the exemption **derived** rather than declared — a private
 * versionable member is not reported when {@link unservableScope} answers a
 * sentence for its name **and** no workspace member names it in any dependency
 * field, so the harm the finding is about (a dependent pinning a version the
 * registry never receives) cannot occur. No name, no list, no ledger: both are
 * facts this file already computes, and the `@endora-commerce` scope is always
 * servable, so no package of the scope can be exempted. Every exempted member
 * is printed by name and counted, the zero included
 * ({@link publicationExemptionLine}).
 *
 * Its expiry is a refusal where its reason expires: `--publish-registry` refuses
 * public npmjs while any member is exempted ({@link publicRegistryExemptions}),
 * so the first npmjs publish cannot go out with the front door left private.
 * The merge request that satisfies it flips `private` and makes the scope rules
 * target-aware; that design is its own.
 *
 * ## The scope, and the failure that is silent
 *
 * `contracts/registry-and-scope.md` R2: GitLab's instance-level npm endpoint
 * resolves a scoped package by turning its **scope** into a top-level namespace
 * path (`lib/api/npm_instance_packages.rb` —
 * `Namespace.top_level.by_path(::Packages::Npm.scope_of(name))`). A scope that
 * resolves to no such namespace is **not an error**: the request is forwarded to
 * `registry.npmjs.org` (`npm_package_requests_forwarding`, default on) and the
 * client is told the package is not in the npm registry. Measured — 302, to
 * npmjs, for `@endora-commerce/contracts` before the group existed.
 *
 * So the scope is judged here, statically, because no install will report it:
 * a public package must be **scoped**, its scope must be spellable as a GitLab
 * top-level namespace path, and every public package must share **one** scope —
 * the client holds one `.npmrc` line naming one scope (R3), so a second scope is
 * a package that silently forwards to a registry that does not have it.
 *
 * ## Tags — and why the old rule went quiet through its own repair
 *
 * `tag-without-publication` asked its question under
 * `privateVersionable.length === versionable.length`. The first public package
 * makes that condition false, so the finding stops firing **in both
 * directions** — and nothing else in the repository holds `privatePackages.tag`.
 * That is this estate's own failure, a check that quietly stops asking,
 * arriving through the repair (feature 104, FR-011).
 *
 * `tag-policy-unstated` is therefore **total**: there is no tree, and no value
 * of that field, for which no rule applies.
 *
 *   * **While any versionable package is private**, `tag` must be exactly
 *     `false`. `changeset publish` would otherwise write one ref per private
 *     package per release, naming a version no registry serves — a fact derived
 *     from the commit that wrote it (D-100), written into a ref every clone
 *     fetches. This is the old rule, with its guard widened from *every* to
 *     *any*, which is the direction that keeps it alive in the mixed state.
 *   * **Once no versionable package is private**, the field governs nothing —
 *     `getUntaggedPrivatePackages` is where changesets consults it, and a public
 *     package is git-tagged regardless of it (`@changesets/cli@3.0.1`,
 *     `dist/git-tag.mjs`). An absent field is then the `@changesets/config@4`
 *     default rather than anybody's decision, so it must be **explicitly
 *     present and boolean**: a reader has to be able to tell a policy from a
 *     silence.
 *
 * ## Exit 2 — eight ways it refuses to report on what it did not read
 *
 * A missing or unparseable `.changeset/config.json`; a `pnpm-workspace.yaml`
 * that yields no globs (`workspace-packages.ts` is a block-sequence reader, so a
 * flow-style list reads as none — a refusal, never an empty workspace); no
 * workspace member at all; a non-negated glob that matched no member, which is
 * issue #215's short walk over this population — move `packages/` and the four
 * application manifests still answer every question above; an `ignore` pattern
 * in a grammar richer than `*` and `?`, since micromatch has one and this file
 * does not, and a pattern it cannot read must not be reported as matching
 * nothing; and a `.changeset/` directory this check could not list.
 *
 * Feature 104 added two more, and the owner's ruling of 2026-09-05 retires
 * them with the closure they guarded: a checkout with no reference storefront,
 * or with two, made *which packages may be public* undecidable. The population
 * is now every versionable member, which the glob refusal above already covers
 * — a workspace that produced no member, and a non-negated glob that produced
 * none, are the two ways this check can stop seeing packages, and neither the
 * storefront nor its dependency graph is consulted any more.
 *
 * `--since` adds four of its own, for the same reason: a versionable package
 * with no readable `tsconfig.build.json`, a build configuration with no
 * `include` at all, an `extends` chain this file cannot follow, and a git
 * invocation that failed. Each of them would otherwise mean "this package
 * publishes nothing outside its own directory", which is the answer that lets
 * the gate stay quiet.
 *
 * Feature 114 adds four more, one per input whose absence would make the
 * *classification* vacuous (contract §7), and all four live **inside** the
 * analysis so that a red proof entering where a real run enters can reach them:
 * a `CHANGELOG.md` side that could not be read; a `package.json` side that does
 * not parse; a branch that changed a versionable package's directory and for
 * which the artefact walk produced no fact at all; and `changeset status`
 * failing to *run*, as opposed to exiting 1, which is a finding. The first two
 * are a pair on purpose — the same defect on the two file kinds the
 * classification reads — because a check that refused one and skipped the other
 * would be a check whose blindness depends on which file went wrong.
 *
 * Feature 114's FR-017 adds four more, one per input whose absence would make
 * the series rule vacuously clean, and all four live inside the analysis for
 * the same reason: **no versionable package at all** — every member is an
 * application or is ignored, so there is nothing a changeset could bump and no
 * series to judge; a **changeset file carrying no `---` block**, since reading
 * it as *"no `major` declared here"* agrees with the defect (issue #113); an
 * **entry naming a versionable member whose `version` has no readable major**,
 * since the predicate is *is this package in `0.x`* and an unreadable version
 * must never be read as *not* `0.x`; and **front-matter text that parsed to no
 * entry at all**, which is issue #237's shape over this population — the entry
 * reader gone blind, printing a cheerful `changesets=0` beside a healthy
 * `files=`.
 *
 * The first of those was recorded in FR-017 as one the check already made, and
 * it was not: `checkBranchIntent` refuses a workspace with no versionable
 * package because the `--since` mode has no published surface to attribute a
 * diff to, and the default mode had no such refusal at all.
 *
 * ## The empty diff is two facts, and only one of them is a refusal
 *
 * Pipeline 11491 failed a correct merge request. !916 changed three Dockerfiles,
 * a `.dockerignore`, a shell script and a test, and this mode exited 2 on *"the
 * branch changes no file at all"*. It had been **merged** before the job fetched
 * its baseline, so `HEAD` was already an ancestor of `origin/master`.
 *
 * The baseline is not the bug, and it is worth saying plainly because it is the
 * first place anyone looks: the diff has been `${since}...HEAD` since !882, and
 * `git diff A...B` **is** the merge-base diff — a merge request's own diff, and
 * arguably what `--since` always meant. That is exactly why re-baselining
 * repairs nothing here. When the branch has been merged, `merge-base` returns
 * `HEAD`, so the merge base is what produces the empty diff.
 *
 * What separates the two cases is a fact the diff does not carry, and one git
 * command answers it: `git merge-base --is-ancestor HEAD <baseline>`.
 * {@link ReleaseIntentContainment} has the reasoning in full; the short version
 * is that a contained branch adds nothing to the baseline **by construction**,
 * which is a measured verdict, while an empty diff from a real fork point is a
 * measurement that came back empty and stays exit 2.
 *
 * ## A third mode that reports no verdict — `--print-publish-scope`
 *
 * `publish:packages` needs the npm scope *before* it publishes: it writes one
 * `.npmrc` line per scope and pnpm reads that line to find the registry and the
 * credential. The job derived it itself, with a `readdir('packages')` one level
 * deep, and `packages/modules` — a directory with no `package.json` — threw into
 * a `catch` that swallowed it, hiding 70 module packages. That is the
 * `build:packages` single-star problem in a second place, and it is exactly the
 * second copy of a derived answer D-100 forbids: this check already classifies
 * every workspace member as versionable-or-not and public-or-not, and already
 * holds the public ones to a single scope (`unresolvable-scope`, 2e). So the job
 * asks the same program the same question instead of keeping its own answer, and
 * {@link publishScope} is that question.
 *
 * It prints the scope on **stdout** and everything else on stderr, and it is a
 * derivation rather than a judgement: no read-size line, no findings, and exit 2
 * for every way the scope cannot be resolved.
 *
 * ## A fourth, about the target rather than the tree — `--publish-registry <url>`
 *
 * The publish job sends the workspace to whichever registry its environment
 * names. A package declaring `SEE LICENSE IN` is legitimate on the private
 * registry and refused on public npmjs, so the job hands the registry over and
 * {@link publicRegistryLicence} answers for the pair
 * (`specs/136-open-source-publication/` FR-011). The same mode refuses public
 * npmjs while a member is exempted under D-267 ({@link publicRegistryExemptions}),
 * printing both refusals when both hold. Like the scope, a precondition of one
 * job rather than the check's verdict: no read-size line.
 *
 * Usage: `tsx scripts/check-release-intent.ts [--root <dir>] [--since <ref>]`
 *        `tsx scripts/check-release-intent.ts --print-publish-scope`
 *        `tsx scripts/check-release-intent.ts --publish-registry <url>`
 * Exit 0 = the flow can still go red; 1 = a finding; 2 = it did not read.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  perClassToken,
  scanCommercialVocabulary,
  type VocabularyScan,
} from './lib/commercial-vocabulary.js';
import { readSizeRefusal, reportReadSize, type ReadCoverage } from './lib/read-size.js';
import {
  classifyWorkspaceMembers,
  nodeWorkspaceFs,
  workspaceGlobs,
  type WorkspaceFs,
} from './lib/workspace-packages.js';

/** The check's log prefix, brackets included. */
export const PREFIX = '[release-intent]';

/** One workspace member, with the workspace entry that produced it. */
export interface ClassifiedMember {
  readonly name: string;
  /** Repository-relative directory, for messages. */
  readonly dir: string;
  /** Whether the manifest declares `"private": true`. */
  readonly isPrivate: boolean;
  /**
   * True when a *glob* workspace entry produced it — a library family. False
   * when every entry that produced it is a literal directory — an application.
   */
  readonly family: boolean;
  /** The workspace entries that matched it, for the message. */
  readonly globs: readonly string[];
  /**
   * Whether the manifest declares a `repository` — a string, or an object with
   * a `url`. npm publishes without one; what is lost is the path from the
   * package page back to the code, and provenance, which npm's own
   * documentation makes conditional on it.
   */
  readonly repository: boolean;
  /** `publishConfig.access`, verbatim, or `null` when it declares none. */
  readonly access: string | null;
  /**
   * The SPDX expression the manifest declares, trimmed, or `null` when it
   * declares none or declares an empty one. The two are one state on purpose:
   * npm treats `""` exactly as it treats an absent field, and a package whose
   * licence is a blank string has said nothing about its terms while looking as
   * though it has.
   */
  readonly license: string | null;
  /**
   * For a `SEE LICENSE IN <file>` licence, whether that file is in the package
   * directory. `null` when the licence is not of that form and there is nothing
   * to resolve — never `false`, which would read as "the file is missing".
   */
  readonly licenseFileFound: boolean | null;
  /** The path {@link licenseFileFound} answered about, for the message. */
  readonly licenseFile: string | null;
  /**
   * The `version` the manifest declares, trimmed, or `null` when it declares
   * none or declares an empty one.
   *
   * It is here because `major-bump-in-a-zero-series` is derived **per package**
   * from that package's own manifest (D-225, FR-017) — never from a global
   * *"the estate is in `0.x`"* flag and never from a list. A mixed estate is
   * therefore judged correctly, and a package that has left `0.x` stops being
   * judged in the same run that moves it.
   */
  readonly version: string | null;
  /**
   * Every package name this manifest declares in any of the four dependency
   * fields — `dependencies`, `devDependencies`, `peerDependencies`,
   * `optionalDependencies` — sorted and de-duplicated.
   *
   * It is here for D-267's second condition: a private member is exempt from
   * `unpublished-package` only while **no** member depends on it, because the
   * finding's harm is a dependent's packed manifest pinning a version the
   * registry never receives. All four fields, including `devDependencies`: a
   * development dependency is still resolved from the registry by whoever
   * installs the dependent from source, and a narrower reading would be the
   * permissive guess.
   */
  readonly dependsOn: readonly string[];
}

/** One `<name>: <bump>` line in the front matter of a `.changeset/*.md`. */
export interface ChangesetRelease {
  /** File name, e.g. `contracts-ships-dist.md`. */
  readonly file: string;
  readonly packageName: string;
  readonly bump: string;
}

/** Everything the analysis reads, in the shape it reads it. */
export interface ReleaseIntentInputs {
  readonly config: Readonly<Record<string, unknown>>;
  readonly members: readonly ClassifiedMember[];
  readonly changesets: readonly ChangesetRelease[];
  /**
   * The same changeset files, unflattened. {@link changesets} loses which file
   * an *empty* one was, and the empty changeset is a state this check has to be
   * able to tell from a file carrying no front matter at all (FR-017).
   */
  readonly documents: readonly ChangesetDocument[];
  /** Non-negated workspace entries, and how many members each produced. */
  readonly globCoverage: ReadonlyMap<string, number>;
  /** Files opened, for the read line. */
  readonly files: number;
}

export type ReleaseIntentFindingKind =
  | 'version-disabled'
  | 'unpublished-package'
  | 'incomplete-public-package'
  | 'unlicensed-package'
  | 'unresolvable-license-file'
  | 'restricted-public-package'
  | 'unresolvable-scope'
  | 'tag-policy-unstated'
  | 'ignored-family-member'
  | 'unignored-application'
  | 'stale-ignore-entry'
  | 'stale-group-member'
  | 'unversionable-changeset'
  | 'major-bump-in-a-zero-series'
  | 'vacuous-release'
  | 'manifest-changed-beyond-version'
  | 'unattributed-package-change'
  | 'unattributed-published-change'
  | 'commercial-disclosure-in-changeset'
  | 'stale-disclosure-clearance';

export interface ReleaseIntentFinding {
  readonly kind: ReleaseIntentFindingKind;
  /** The package name, pattern or setting the finding is about. */
  readonly subject: string;
  readonly message: string;
}

/** Why this run may not report a verdict. Distinct from "no findings". */
export interface ReleaseIntentRefusal {
  readonly reason: string;
}

export interface ReleaseIntentResult {
  readonly findings: readonly ReleaseIntentFinding[];
  readonly inputs: ReleaseIntentInputs;
  /** Decisions taken inside the files, for the read line. */
  readonly sites: number;
  readonly coverage: readonly ReadCoverage[];
}

// --- reading ---------------------------------------------------------------

/**
 * Micromatch constructs this file does not implement — a character class, a
 * brace expansion, an alternation, a leading negation, and the five extglob
 * heads, each of which is a metacharacter **only** when a `(` follows it.
 *
 * That last distinction is load-bearing rather than pedantic. `@` and `+` are
 * ordinary characters in a package name: `@endora-commerce/*` is the pattern
 * the 67-package future would be exempted by, and a reader that refused it
 * would turn this check's most valuable finding — `ignored-family-member` —
 * into an exit 2 that an author clears by deleting the check from the job.
 */
const UNREADABLE_CONSTRUCT = /[[\]{}|]|^!|[?*+@!]\(/;

/**
 * Whether `name` matches an `ignore` pattern.
 *
 * `*` spans any run of characters including `/`, because the thing being matched
 * is a package **name** and a scope separator is not a path separator. `?` is
 * one character. Everything richer belongs to micromatch and is refused by
 * {@link unreadablePattern} before this is called — a pattern this file cannot
 * read must not be reported as matching nothing, which would turn an ignored
 * application into an `unignored-application` finding and an over-broad
 * `@scope/*` into silence.
 */
export function matchesPattern(pattern: string, name: string): boolean {
  const source = pattern
    .split(/([*?])/)
    .map((part) => (part === '*' ? '.*' : part === '?' ? '.' : escapeRegExp(part)))
    .join('');
  return new RegExp(`^${source}$`).test(name);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The first `ignore` pattern this file cannot read, or `null`. */
export function unreadablePattern(patterns: readonly string[]): string | null {
  return patterns.find((pattern) => UNREADABLE_CONSTRUCT.test(pattern)) ?? null;
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Every package name named by a `linked` or `fixed` group. */
export function groupMembers(config: Readonly<Record<string, unknown>>): readonly string[] {
  const groups = [config['linked'], config['fixed']].flatMap((value) =>
    Array.isArray(value) ? (value as unknown[]) : [],
  );
  return groups.flatMap((group) => stringList(group));
}

/** One `.changeset/*.md`, read as the front matter it opens with. */
export interface ChangesetDocument {
  readonly file: string;
  /**
   * Whether the file **opens with a `---` delimiter block** — an opening `---`
   * line and a later line that is exactly `---`.
   *
   * This is the discriminator, and it is deliberately not the entry count
   * (FR-017). A changeset whose block is empty — `---`, `---`, then a body — is
   * the *empty changeset* AGENTS.md sanctions for a change with no release
   * meaning, and ten of the eighty-four files pending when this landed are one.
   * A predicate keyed on "the front matter yielded no entry" refuses every one
   * of them; a predicate keyed on the delimiters tells them apart from a file
   * that carries no front matter at all, which is the state this check must
   * refuse rather than read as *"no `major` here"* (issue #113).
   */
  readonly hasFrontMatter: boolean;
  /** The non-blank lines inside the block, parsed or not. */
  readonly frontMatterLines: number;
  readonly releases: readonly ChangesetRelease[];
  /**
   * The summary below the closing delimiter — the prose R3 reads.
   *
   * It is kept because **this is the surface with the leak**: a changeset body
   * is written by an author who thinks they are writing to the team, and
   * `changeset version` renders it into a CHANGELOG that ships. The one real
   * commercial disclosure this estate found in a published artefact came
   * through here, and nothing stood between the author and the render. The
   * front-matter reader above deliberately stops at the delimiter; this field
   * is what is on the other side of it.
   */
  readonly body: string;
}

/**
 * One changeset, read as its front-matter block and the entries inside it.
 *
 * Deliberately a reader of the front matter rather than of the whole document:
 * the summary below it is prose and may quote anything, including a package
 * name and a colon. The closing delimiter is the **first** line that is exactly
 * `---` after the opening one, so a `---` inside the summary is body text.
 */
export function readChangesetDocument(file: string, source: string): ChangesetDocument {
  const open = /^---[ \t]*\r?\n/.exec(source);
  // A file with no front matter still has prose, and R3 reads prose: the whole
  // source is the body in that case rather than nothing. `hasFrontMatter` is a
  // separate question with its own refusal (FR-017) and the two must not be
  // collapsed — a file the front-matter reader cannot parse is exactly the one
  // whose prose nobody has looked at.
  if (open === null) {
    return { file, hasFrontMatter: false, frontMatterLines: 0, releases: [], body: source };
  }
  const rest = source.slice(open[0].length);
  const close = /^---[ \t]*\r?$/m.exec(rest);
  if (close === null) {
    return { file, hasFrontMatter: false, frontMatterLines: 0, releases: [], body: source };
  }

  const releases: ChangesetRelease[] = [];
  let frontMatterLines = 0;
  for (const line of rest.slice(0, close.index).split('\n')) {
    if (line.trim() === '') continue;
    frontMatterLines += 1;
    const entry = /^\s*(?:"([^"]+)"|'([^']+)'|([^:\s]+))\s*:\s*(\S+)\s*$/.exec(line);
    if (entry === null) continue;
    const packageName = entry[1] ?? entry[2] ?? entry[3];
    const bump = entry[4];
    if (packageName === undefined || bump === undefined) continue;
    releases.push({ file, packageName, bump });
  }
  return {
    file,
    hasFrontMatter: true,
    frontMatterLines,
    releases,
    body: rest.slice(close.index + close[0].length),
  };
}

/** {@link readChangesetDocument}'s entries, for a caller that wants only those. */
export function parseChangeset(file: string, source: string): readonly ChangesetRelease[] {
  return readChangesetDocument(file, source).releases;
}

/** Whether a manifest declares a `repository` — a string, or an object with a `url`. */
export function declaresRepository(manifest: Readonly<Record<string, unknown>>): boolean {
  const repository = manifest['repository'];
  if (typeof repository === 'string') return repository.trim().length > 0;
  if (typeof repository !== 'object' || repository === null || Array.isArray(repository)) {
    return false;
  }
  const url = (repository as Record<string, unknown>)['url'];
  return typeof url === 'string' && url.trim().length > 0;
}

/**
 * npm's `SEE LICENSE IN <filename>` form, which is the SPDX spelling for a
 * licence that is not one of the standard identifiers.
 *
 * It is the whole of what this check understands about the *vocabulary* of a
 * licence, and deliberately so: judging the rest would mean carrying the SPDX
 * identifier list, which is a derived fact written down (D-100) and one that
 * moves without this repository. What the form buys is the one licence value
 * that makes a **second** claim — that a file exists — and a claim about a file
 * is a claim a check can settle.
 */
const SEE_LICENSE_IN = /^SEE LICENSE IN\s+(\S.*)$/;

/** The trimmed `license` a manifest declares, or `null` for absent or empty. */
export function declaredLicense(
  manifest: Readonly<Record<string, unknown>>,
): string | null {
  const license = manifest['license'];
  if (typeof license !== 'string') return null;
  const trimmed = license.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** The `version` a manifest declares, trimmed, or `null` for an absent or empty one. */
export function declaredVersion(manifest: Readonly<Record<string, unknown>>): string | null {
  const version = manifest['version'];
  if (typeof version !== 'string') return null;
  const trimmed = version.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * The major component of a declared version, or `null` when there is none to
 * read.
 *
 * `null` is never read as *"not `0.x`"*: the question
 * `major-bump-in-a-zero-series` asks is *is this package in `0.x`*, and an
 * unreadable version is an answer this run did not obtain, which is exit 2 and
 * not a clean verdict (FR-017, issue #113). The reader is deliberately shallow
 * — the leading run of digits before the first `.` — rather than a semver
 * parser: a prerelease or build suffix (`0.8.0-rc.1`, `1.0.0+build`) is in the
 * series its major says it is, and carrying a semver grammar here would be a
 * second implementation of something the release tool already owns.
 */
export function versionMajor(version: string | null): number | null {
  if (version === null) return null;
  const match = /^(\d+)\./.exec(version);
  return match === null ? null : Number(match[1]);
}

/** The file a `SEE LICENSE IN <file>` licence names, or `null` for any other form. */
export function licenseFileNamedBy(license: string | null): string | null {
  if (license === null) return null;
  const match = SEE_LICENSE_IN.exec(license);
  return match === null ? null : match[1]!.trim();
}

/** `publishConfig.access` as the manifest writes it, or `null`. */
export function publishConfigAccess(
  manifest: Readonly<Record<string, unknown>>,
): string | null {
  const publishConfig = manifest['publishConfig'];
  if (typeof publishConfig !== 'object' || publishConfig === null || Array.isArray(publishConfig)) {
    return null;
  }
  const access = (publishConfig as Record<string, unknown>)['access'];
  return typeof access === 'string' ? access : null;
}

/**
 * Read the whole release-intent configuration off a checkout.
 *
 * Takes a {@link WorkspaceFs} so a red proof can hand in a synthetic repository
 * at the top of the analysis (issue #130) rather than a half-classified record
 * at the bottom of it. `listChangesets` is separate because `WorkspaceFs` lists
 * directories and not files.
 */
export function readReleaseIntent(
  repoRoot: string,
  fs: WorkspaceFs,
  listChangesets: (dir: string) => readonly string[] | null,
): ReleaseIntentInputs | ReleaseIntentRefusal {
  const configText = fs.readText(join(repoRoot, '.changeset', 'config.json'));
  if (configText === null) {
    return { reason: '`.changeset/config.json` is missing — there is no release intent to read' };
  }
  let config: unknown;
  try {
    config = JSON.parse(configText) as unknown;
  } catch (error) {
    return { reason: `\`.changeset/config.json\` does not parse: ${String(error)}` };
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return { reason: '`.changeset/config.json` is not an object' };
  }

  const globs = workspaceGlobs(repoRoot, fs).filter((glob) => !glob.startsWith('!'));
  if (globs.length === 0) {
    return {
      reason:
        '`pnpm-workspace.yaml` yielded no `packages:` entries — a flow-style list reads as ' +
        'none, and an empty workspace would make every question below vacuous',
    };
  }

  // The family/application split is `lib/workspace-packages.ts`' derivation and
  // no longer this check's own: `test/unit/packages/package-dist-build.test.ts`
  // asks the same question of the same members — *"is this a library we publish
  // or an application we deploy?"* — and a second answer to it is two answers
  // waiting to disagree about the package that arrives next.
  const { members, globCoverage } = classifyWorkspaceMembers(repoRoot, fs);
  if (members.length === 0) {
    return { reason: 'the workspace globs matched no package at all' };
  }

  // The licence files this run opened, added to `files` below. Zero on a tree
  // where every package takes an SPDX identifier, which is where this estate
  // stands: the probe happens only for the `SEE LICENSE IN` form, so it is a
  // count that moves when a paid package arrives and not before.
  let licenseFilesRead = 0;
  const classified: ClassifiedMember[] = members.map((member) => {
    const license = declaredLicense(member.manifest);
    const licenseFile = licenseFileNamedBy(license);
    let licenseFileFound: boolean | null = null;
    if (licenseFile !== null) {
      licenseFileFound = fs.readText(join(member.dir, licenseFile)) !== null;
      licenseFilesRead += 1;
    }
    return {
      name: member.name,
      dir: member.dir.startsWith(repoRoot) ? member.dir.slice(repoRoot.length + 1) : member.dir,
      isPrivate: member.manifest['private'] === true,
      family: member.family,
      globs: member.globs,
      repository: declaresRepository(member.manifest),
      access: publishConfigAccess(member.manifest),
      license,
      licenseFileFound,
      licenseFile,
      version: declaredVersion(member.manifest),
      dependsOn: declaredDependencyNames(member.manifest),
    };
  });

  const changesetDir = join(repoRoot, '.changeset');
  const entries = listChangesets(changesetDir);
  if (entries === null) {
    return { reason: '`.changeset/` could not be listed' };
  }
  const changesetFiles = entries.filter(
    (name) => name.endsWith('.md') && name.toLowerCase() !== 'readme.md',
  );
  const documents = changesetFiles.map((name) =>
    readChangesetDocument(name, fs.readText(join(changesetDir, name)) ?? ''),
  );
  const changesets = documents.flatMap((document) => document.releases);

  return {
    config: config as Record<string, unknown>,
    members: classified,
    changesets,
    documents,
    globCoverage,
    // config.json + pnpm-workspace.yaml + one manifest per member. What the
    // walk *opened*, never what it found in.
    //
    // **The changesets are read and deliberately not counted here**, and the
    // reason is what `files` is for. It is the vacuous-pass floor: a green
    // result must not be able to mean "nothing was read". For this check that
    // means the workspace manifests and the config — without them every
    // predicate is vacuously true. The changeset files are the *subject* of one
    // question rather than the population of the analysis, their count is
    // already printed beside it as `changesets=`, and **zero of them is a
    // legitimate state** — a freshly released tree has none.
    //
    // Folding them in made the counted population oscillate with the release
    // cycle rather than with the tree, so no single recorded band could bound
    // it: at 30 pending changesets `files` sat exactly on the +50% ceiling and
    // the next merge request to add one failed, while a release consuming them
    // would have dropped it under the −10% floor in the same week. Measured on
    // `a059e56e`: 51 with them, 17 without.
    //
    // The licence files are counted, and they are not the changesets' shape:
    // one is opened per member declaring a `SEE LICENSE IN` licence, which
    // follows the tree rather than the release cycle, and today there are none.
    files: 2 + members.length + licenseFilesRead,
  };
}

/**
 * GitLab's top-level reserved routes, the ones a package scope could plausibly
 * be. From `lib/gitlab/path_regex.rb` (`TOP_LEVEL_ROUTES`), which is GitLab's
 * own constant and not a fact about this repository — a namespace cannot be
 * created at any of these paths, so a scope spelling one can never resolve.
 *
 * It is deliberately not the whole list: the entries omitted are ones no scope
 * would be, and a missing entry fails in the direction the tree is in already —
 * the silent forward this finding exists to describe — rather than as a false
 * red on a legitimate scope.
 */
const GITLAB_RESERVED_PATHS: ReadonlySet<string> = new Set([
  'admin',
  'api',
  'assets',
  'dashboard',
  'explore',
  'files',
  'groups',
  'health_check',
  'help',
  'import',
  'jwt',
  'login',
  'oauth',
  'profile',
  'projects',
  'public',
  'robots.txt',
  's',
  'search',
  'sitemap',
  'snippets',
  'unsubscribes',
  'uploads',
  'users',
  'v2',
]);

/** The four manifest fields a dependency can be declared in. */
const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
] as const;

/** Every name a manifest declares in {@link DEPENDENCY_FIELDS}, sorted and unique. */
function declaredDependencyNames(manifest: Readonly<Record<string, unknown>>): readonly string[] {
  const names = new Set<string>();
  for (const field of DEPENDENCY_FIELDS) {
    const block = manifest[field];
    if (typeof block !== 'object' || block === null || Array.isArray(block)) continue;
    for (const name of Object.keys(block)) names.add(name);
  }
  return [...names].sort();
}

/** The scope of a package name — `@fx/alpha` → `fx` — or `null` when unscoped. */
export function scopeOf(name: string): string | null {
  const match = /^@([^/]+)\//.exec(name);
  return match === null ? null : match[1]!;
}

/**
 * The one scope `publish:packages` writes an `.npmrc` line for, or why it
 * cannot be derived.
 *
 * A record rather than a string, because a job that cannot resolve the scope
 * must say which of the four ways it failed: no member at all, nothing public,
 * a public package with no scope to authenticate for, and more than one scope.
 */
export interface PublishScope {
  /** The scope, without its `@` — `endora-commerce` — or `null` on a refusal. */
  readonly scope: string | null;
  /** The public versionable package names, sorted. Populated on a refusal too. */
  readonly packages: readonly string[];
  /** Why no scope was resolved. Empty exactly when {@link scope} is not `null`. */
  readonly refusal: string;
}

/**
 * The scope of the packages this checkout would publish (feature 104).
 *
 * `publish:packages` writes one `.npmrc` line per scope and pnpm needs it before
 * `changeset publish` runs, so the job has to know the scope *before* the
 * publish rather than after. It derived it by walking `packages` one level deep
 * — which is the `build:packages` single-star problem arriving a second time
 * through a `readdir`: `packages/modules` carries no `package.json`, the read
 * threw, the `catch` swallowed it, and every module package under it was
 * invisible. Measured on the tree that repaired it: 9 directories walked, one of
 * them the parent of **70** members the derivation never saw. Nothing was wrong
 * yet only because those 70 are private; the first public one would have been
 * published under a scope the job never authenticated for, or not published at
 * all, while the job reported success.
 *
 * So the population is the **workspace members** — `pnpm-workspace.yaml` is
 * already the one authority for which directories are packages, and it already
 * enumerates `packages/*` and `packages/modules/*`. Nothing here names a
 * directory, and a third workspace entry changes the answer by being written in
 * that file and by nothing else (D-100).
 *
 * The predicate is *family and not private* — versionable, and public — which is
 * the set `changeset publish` will actually publish. `family` is
 * `lib/workspace-packages.ts`' classification rather than the `ignore` list, and
 * the two cannot silently disagree: `ignored-family-member` and
 * `unignored-application` are the findings this check reconciles them with.
 */
export function publishScope(members: readonly ClassifiedMember[]): PublishScope {
  if (members.length === 0) {
    return {
      scope: null,
      packages: [],
      refusal:
        'the workspace declares no member at all, so there is no manifest to read a scope off. ' +
        'A flow-style `packages:` list in `pnpm-workspace.yaml` reads as no entry ' +
        '(`lib/workspace-packages.ts`), and an empty population would leave the publish running ' +
        'against whatever registry the client `.npmrc` already names',
    };
  }

  const publishable = members
    .filter((member) => member.family && !member.isPrivate)
    .map((member) => member.name)
    .sort();
  if (publishable.length === 0) {
    return {
      scope: null,
      packages: [],
      refusal:
        `no versionable package is public among the ${String(members.length)} workspace ` +
        'members, so this branch would publish nothing. `changeset publish` exits 0 on an ' +
        'empty plan, which is byte-identical to a successful publish',
    };
  }

  const unscoped = publishable.filter((name) => scopeOf(name) === null);
  if (unscoped.length > 0) {
    return {
      scope: null,
      packages: publishable,
      refusal:
        `${unscoped.join(', ')} is public and unscoped, so there is no scope for an \`.npmrc\` ` +
        'line to name and no namespace path for the endpoint to resolve. Skipping it would ' +
        'publish it to whatever the client default registry is — the `unresolvable-scope` ' +
        'finding this check already reports, arriving here as a refusal rather than a silence',
    };
  }

  const scopes = [...new Set(publishable.map((name) => scopeOf(name)!))].sort();
  if (scopes.length !== 1) {
    return {
      scope: null,
      packages: publishable,
      refusal:
        `the public packages carry ${String(scopes.length)} scopes ` +
        `(${scopes.map((scope) => `@${scope}`).join(', ')}). One \`.npmrc\` line covers one ` +
        'scope, so every scope after the first resolves through the default registry, which ' +
        'serves none of them (`contracts/registry-and-scope.md` R3)',
    };
  }

  return { scope: scopes[0]!, packages: publishable, refusal: '' };
}

/** What {@link publicRegistryLicence} decided about one publish target. */
export interface PublicRegistryLicence {
  /**
   * Whether the registry is public npmjs; `null` when the value could not be
   * read as a URL at all, which is refused rather than guessed at.
   */
  readonly publicRegistry: boolean | null;
  /** The public versionable members declaring `SEE LICENSE IN`, sorted. */
  readonly ownLicence: readonly string[];
  /** Why the publish is refused, or `''` when it is not. */
  readonly refusal: string;
}

/**
 * The hosts `npm publish` reaches public npmjs through. A host, not a URL
 * prefix, so a trailing slash, a scheme or a capital letter cannot move the
 * answer.
 */
const PUBLIC_NPM_HOSTS: ReadonlySet<string> = new Set(['registry.npmjs.org', 'registry.npmjs.com']);

/**
 * Whether this checkout may be published to `registry` as far as licence
 * terms go (`specs/136-open-source-publication/` FR-011).
 *
 * A package declaring `SEE LICENSE IN <file>` states terms of its own, and
 * such a package belongs on the private registry — `unresolvable-license-file`
 * already holds it to shipping the file, and nothing refused it going to
 * npmjs, where a version is permanent and readable by anyone. The publish job
 * sends the same workspace to whichever registry its environment names, so the
 * question is asked about the **pair**: the private registry is answered yes,
 * public npmjs is answered no for as long as any public member declares that
 * form.
 *
 * The population is {@link publishScope}'s — family and not private, the set
 * `changeset publish` packs — and nothing here names a package. A registry that
 * is not a URL is refused, because answering "private" for a value this could
 * not read would be the permissive guess in the one direction that cannot be
 * taken back.
 */
export function publicRegistryLicence(
  members: readonly ClassifiedMember[],
  registry: string,
): PublicRegistryLicence {
  const ownLicence = members
    .filter((member) => member.family && !member.isPrivate)
    .filter((member) => member.license !== null && SEE_LICENSE_IN.test(member.license))
    .map((member) => member.name)
    .sort();

  const publicRegistry = isPublicNpmRegistry(registry);
  if (publicRegistry === null) {
    return {
      publicRegistry: null,
      ownLicence,
      refusal:
        `the registry \`${registry}\` is not a URL, so whether it is public npmjs cannot be ` +
        'told. Treating it as private would let a package with terms of its own go wherever ' +
        'the client default registry points',
    };
  }

  if (!publicRegistry || ownLicence.length === 0) {
    return { publicRegistry, ownLicence, refusal: '' };
  }
  return {
    publicRegistry,
    ownLicence,
    refusal:
      `${ownLicence.join(', ')} ${ownLicence.length === 1 ? 'declares' : 'declare'} ` +
      '`SEE LICENSE IN`, and this publish targets public npmjs. Terms of their own belong on ' +
      'the private registry; a version on npmjs is permanent and readable by anyone, whatever ' +
      'the file it names says',
  };
}

/** One private versionable member `unpublished-package` does not report (D-267). */
export interface PublicationExemption {
  readonly name: string;
  /** Repository-relative directory, for the printed line. */
  readonly dir: string;
  /** {@link unservableScope}'s sentence — why the configured target cannot serve it. */
  readonly reason: string;
}

/**
 * The private versionable members `unpublished-package` exempts — D-267 clause 2.
 *
 * A member is exempt when **both** hold, and both are facts this check already
 * computes, so there is no list, no ledger and no package name here:
 *
 *   1. {@link unservableScope} answers a sentence for its name — the configured
 *      target cannot serve it, so the member would be `unresolvable-scope` the
 *      moment it went public, and `private` is the only state in which the tree
 *      can be green; and
 *   2. **no workspace member depends on it** in any dependency field — so the
 *      finding's harm, a dependent's packed manifest pinning a version the
 *      registry never receives, cannot occur.
 *
 * The `@endora-commerce` scope is always servable, so condition 1 never holds
 * for it and the owner's ruling of 2026-09-05 — every `@endora-commerce`
 * package publishes — loses nothing. The exemption expires where its reason
 * does: {@link publicRegistryExemptions} refuses a publish to public npmjs
 * while any member is exempted (clause 3). Every exempted member is printed by
 * name and counted ({@link publicationExemptionLine}), never skipped in silence.
 */
export function publicationExemptions(
  members: readonly ClassifiedMember[],
): readonly PublicationExemption[] {
  const depended = new Set(members.flatMap((member) => member.dependsOn));
  const exempt: PublicationExemption[] = [];
  for (const member of members) {
    if (!member.family || !member.isPrivate || depended.has(member.name)) continue;
    const reason = unservableScope(member.name);
    if (reason === null) continue;
    exempt.push({ name: member.name, dir: member.dir, reason });
  }
  return exempt.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The line the default mode prints about {@link publicationExemptions} — the
 * count **including the zero**, and each member by name. A skip nobody can see
 * is the silence `unpublished-package` exists to end.
 */
export function publicationExemptionLine(exempt: readonly PublicationExemption[]): string {
  const head = `${PREFIX} exempt-private=${String(exempt.length)}`;
  if (exempt.length === 0) return head;
  return (
    `${head} (D-267: private, the configured target cannot serve the name, and no workspace ` +
    `member depends on it) — ${exempt.map((entry) => `${entry.name} (${entry.dir})`).join(', ')}`
  );
}

/**
 * Whether `registry` is public npmjs; `null` when it could not be read as a
 * URL at all. The one predicate both `--publish-registry` verdicts share.
 */
function isPublicNpmRegistry(registry: string): boolean | null {
  try {
    return PUBLIC_NPM_HOSTS.has(new URL(registry.trim()).hostname.toLowerCase());
  } catch {
    return null;
  }
}

/** What {@link publicRegistryExemptions} decided about one publish target. */
export interface PublicRegistryExemptions {
  /** As {@link PublicRegistryLicence.publicRegistry}. */
  readonly publicRegistry: boolean | null;
  /** The members {@link publicationExemptions} exempts, by name, sorted. */
  readonly exempt: readonly string[];
  /** Why the publish is refused, or `''` when it is not. */
  readonly refusal: string;
}

/**
 * D-267 clause 3 — the exemption's expiry, placed where its reason expires.
 *
 * The exemption rests on the configured target being GitLab's namespace-keyed
 * endpoint, which cannot serve an unscoped name. Public npmjs can, and the
 * first publish there is the day the front door must stop being private
 * (`specs/136-open-source-publication/` §5.3). So a publish to public npmjs is
 * refused while any member is exempted; the private-registry rehearsal is not
 * touched. The merge request that satisfies this refusal flips `private` and
 * teaches `unresolvable-scope` and {@link publishScope} which target they judge
 * — its design, not this function's.
 */
export function publicRegistryExemptions(
  members: readonly ClassifiedMember[],
  registry: string,
): PublicRegistryExemptions {
  const exempt = publicationExemptions(members).map((entry) => entry.name);
  const publicRegistry = isPublicNpmRegistry(registry);
  if (publicRegistry === null) {
    return {
      publicRegistry,
      exempt,
      refusal:
        `the registry \`${registry}\` is not a URL, so whether it is public npmjs cannot be ` +
        'told, and a private member exempted for the private registry could be left behind by ' +
        'the publish that makes the product public',
    };
  }
  if (!publicRegistry || exempt.length === 0) return { publicRegistry, exempt, refusal: '' };
  return {
    publicRegistry,
    exempt,
    refusal:
      `${exempt.join(', ')} ${exempt.length === 1 ? 'is' : 'are'} \`"private": true\` under ` +
      "D-267's exemption, and this publish targets public npmjs, which serves an unscoped name. " +
      'The exemption held only while the target could not serve it: publishing to npmjs now ' +
      'would leave the front door unpublished (`specs/136-open-source-publication/` §5.3). ' +
      'Flip `private` and make `unresolvable-scope` and `publishScope()` target-aware in the ' +
      'same merge request, then publish',
  };
}

/**
 * Why a GitLab instance-level npm endpoint cannot serve this package, or `null`.
 *
 * A sentence rather than a boolean, because the three ways it fails have
 * nothing in common for the reader: no scope at all, a scope that is not a legal
 * namespace path, and a scope at a path GitLab reserves for itself.
 */
export function unservableScope(name: string): string | null {
  const scope = scopeOf(name);
  if (scope === null) {
    return (
      'is unscoped, so there is no scope for the endpoint to turn into a namespace path — ' +
      '`Packages::Npm.scope_of` answers nothing and the lookup never happens.'
    );
  }
  if (!/^[a-z0-9_](?:[a-z0-9._-]*[a-z0-9_-])?$/.test(scope)) {
    return (
      `is scoped \`@${scope}\`, which is not spellable as a GitLab namespace path (a path ` +
      'starts with a letter, a digit or `_`, carries only letters, digits, `_`, `-` and `.`, ' +
      'and does not end in a dot).'
    );
  }
  if (/\.(?:git|atom)$/.test(scope)) {
    return `is scoped \`@${scope}\`, and GitLab reserves the \`.git\` and \`.atom\` suffixes.`;
  }
  if (GITLAB_RESERVED_PATHS.has(scope)) {
    return (
      `is scoped \`@${scope}\`, which is one of GitLab's reserved top-level routes ` +
      '(`lib/gitlab/path_regex.rb`), so no namespace can exist at that path.'
    );
  }
  return null;
}

// --- analysis --------------------------------------------------------------

/**
 * Every way this configuration would let the gate go quiet.
 *
 * Pure over the record {@link readReleaseIntent} produces, so the CLI and a red
 * proof run the same predicates over the same shape.
 */
export function analyzeReleaseIntent(inputs: ReleaseIntentInputs): readonly ReleaseIntentFinding[] {
  const findings: ReleaseIntentFinding[] = [];
  const ignorePatterns = stringList(inputs.config['ignore']);
  const isIgnored = (name: string): boolean =>
    ignorePatterns.some((pattern) => matchesPattern(pattern, name));

  const versionable = inputs.members.filter((member) => member.family);
  const privateVersionable = versionable.filter((member) => member.isPrivate);

  const privatePackages = inputs.config['privatePackages'];
  const settings =
    typeof privatePackages === 'object' && privatePackages !== null && !Array.isArray(privatePackages)
      ? (privatePackages as Record<string, unknown>)
      : {};

  // 1 — the four lines that look like boilerplate.
  if (privateVersionable.length > 0 && settings['version'] !== true) {
    findings.push({
      kind: 'version-disabled',
      subject: 'privatePackages.version',
      message:
        `is ${JSON.stringify(settings['version'] ?? null)} while ${privateVersionable.length} ` +
        'versionable package(s) are `"private": true`. `@changesets/config@4` defaults it to ' +
        '`false`, and with it false every changesets command — `status`, `version`, and the ' +
        '`release:changeset` gate — reports a cheerful nothing and exits 0. Set it to `true`.',
    });
  }

  // 2 — publication, and whether each public package is fit for it (feature 104).
  const publicVersionable = versionable.filter((member) => !member.isPrivate);
  const configAccess = typeof inputs.config['access'] === 'string' ? inputs.config['access'] : null;

  // 2a — the ruling of 2026-09-05, in the direction that now has a subject.
  // `changeset publish` skips a private package in silence, and `pnpm pack`
  // has already rewritten every sibling's `workspace:*` to its exact version,
  // so one package left behind is every dependent pinning a version the
  // registry never receives.
  //
  // D-267 clause 2: a private member the configured target cannot serve and no
  // member depends on is exempt — derived, printed by name and counted by the
  // CLI, and refused at a public-npmjs publish (`publicationExemptions`).
  const exempted = new Set(publicationExemptions(inputs.members).map((entry) => entry.name));
  for (const member of versionable.filter(
    (candidate) => candidate.isPrivate && !exempted.has(candidate.name),
  )) {
    findings.push({
      kind: 'unpublished-package',
      subject: member.name,
      message:
        `(${member.dir}) is \`"private": true\`, so \`changeset publish\` skips it without a ` +
        "word. Every `@endora-commerce` package publishes (D-208, and the owner's publication " +
        'ruling of 2026-09-05): a deployment builds its own instance, and an instance takes the ' +
        'platform, the admin kit and every module package as a dependency while holding a copy ' +
        "of none. `pnpm pack` rewrites a `workspace:*` range to the sibling's exact version, so " +
        "a package left behind is every dependent's packed manifest pinning a version the " +
        "registry does not have — `ERR_PNPM_NO_MATCHING_VERSION` at the first consumer's " +
        'install, from a publish that reported success. Not publishing something is its own ' +
        'decision — so make it in a merge request that says so, and change this check in the ' +
        'same commit.',
    });
  }

  for (const member of publicVersionable) {
    // 2b — fitness. What a published package owes a consumer, and what npm's
    // own provenance prerequisite needs.
    const missing: string[] = [];
    if (!member.repository) missing.push('`repository`');
    if (member.access === null) missing.push('`publishConfig.access`');
    if (missing.length > 0) {
      findings.push({
        kind: 'incomplete-public-package',
        subject: member.name,
        message:
          `(${member.dir}) is public and declares no ${missing.join(' and no ')}. ` +
          '`repository` is what gives a consumer a path from the package page back to the ' +
          'code, and npm makes provenance conditional on it; `publishConfig.access` is a ' +
          'property of the package rather than of where it happens to be published, and it ' +
          'is the value that decides whether a scoped package lands public or private.',
      });
    }

    // 2b-i — the licence, which used to sit inside 2b's list as a comment
    // explaining why it was not judged: *"the owner deferred the licence to the
    // merge request that makes a package public on npmjs (D-203, amended
    // 2026-09-04)"*. This is that merge request. The owner's ruling of
    // 2026-09-06 settles the model — the open core is `MIT`, a paid package
    // carries `SEE LICENSE IN LICENSE.md`, the split is by **package**, and
    // entitlement is contractual rather than a registry gate — which is what
    // gives the question an answer a check can hold a package to.
    //
    // **It is a kind of its own rather than a third entry in 2b's `missing`
    // list**, and the reason is the remedy rather than the field. `repository`
    // and `publishConfig.access` have one correct value each and a generator
    // writes them; a licence is a *decision*, and the finding has to be able to
    // say which of the two the owner's model offers and where the default comes
    // from. Folded into 2b it would also be invisible as a count — one number
    // over three fields cannot say that seventy-nine packages are unlicensed
    // and none is missing a repository.
    //
    // **No ledger, deliberately**: every finding here is one field in one file,
    // and an entry could only license publishing a package whose terms nobody
    // stated — which is the state this rule exists to end.
    if (member.license === null) {
      findings.push({
        kind: 'unlicensed-package',
        subject: member.name,
        message:
          `(${member.dir}) is public and declares no \`license\`. npm publishes it anyway and ` +
          'the package page reads "no license", which for a consumer — and for every licence ' +
          "scanner in their pipeline — is not a permissive default but an absence of terms. " +
          "The owner's ruling of 2026-09-06: the open core is `MIT`, a paid package is " +
          '`SEE LICENSE IN LICENSE.md`. A **module package** takes the workspace root\'s ' +
          '`license` from `manifests:generate` and overrides it by exporting `packageLicense` ' +
          'from its own `src/manifest.ts`, so the repair there is to regenerate rather than to ' +
          'edit this file; every other package declares the field itself.',
      });
    }

    // 2b-ii — and the one licence value that makes a second claim. `SEE LICENSE
    // IN <file>` is SPDX's spelling for terms that are not a standard
    // identifier, and it names a file: without that file the manifest points a
    // consumer at nothing, and the package is *less* informative than one
    // carrying no licence at all, because it looks answered.
    //
    // Only the form is judged, never the vocabulary — an SPDX identifier list
    // is a derived fact written down (D-100) that moves without this
    // repository, and `UNLICENSED` is a legitimate npm value this check has no
    // business refusing. npm always packs a `LICENSE*` file whatever `files`
    // says, so existence on disk is the whole question.
    if (member.licenseFileFound === false) {
      findings.push({
        kind: 'unresolvable-license-file',
        subject: member.name,
        message:
          `(${member.dir}) declares \`"license": "${member.license ?? ''}"\` and ` +
          `\`${member.licenseFile ?? ''}\` is not in the package directory. The consumer is ` +
          'pointed at terms that do not exist, which is worse than declaring none — a scanner ' +
          'reads the field as answered and a human finds nothing to read. Add the file beside ' +
          "the package's `package.json`; npm packs a `LICENSE*` file whether or not `files` " +
          'names it.',
      });
    }

    // 2c — the access decision the rehearsal cannot exercise. GitLab ignores
    // `--access` and takes visibility from the project, so nothing about a
    // private-registry publish would reveal this before the first public one.
    const effectiveAccess = member.access ?? configAccess ?? 'restricted';
    if (effectiveAccess === 'restricted') {
      findings.push({
        kind: 'restricted-public-package',
        subject: member.name,
        message:
          `(${member.dir}) resolves \`access\` to \`restricted\` ` +
          `(${member.access !== null ? 'its own `publishConfig.access`' : configAccess !== null ? '`.changeset/config.json`' : "the changesets default, since neither the package nor `.changeset/config.json` states one"}). ` +
          'On npmjs a scoped package is private by default and a private package requires a ' +
          'paid account, so this publishes to nobody or fails outright. GitLab ignores ' +
          '`--access` entirely, which is why the rehearsal cannot discover it and this check ' +
          'has to (feature 104, FR-012).',
      });
    }

    // 2d — a scope the registry cannot serve. Silent, by R2.1: the request is
    // forwarded to npmjs and the client is told the package does not exist.
    const problem = unservableScope(member.name);
    if (problem !== null) {
      findings.push({
        kind: 'unresolvable-scope',
        subject: member.name,
        message:
          `(${member.dir}) ${problem} GitLab's instance-level npm endpoint resolves a package ` +
          'by turning its scope into a top-level namespace path, and a scope that resolves to ' +
          'none is **not** an error: the request is forwarded to `registry.npmjs.org` and the ' +
          'client is told the package is not in the npm registry ' +
          '(`contracts/registry-and-scope.md` R2/R2.1, measured).',
      });
    }
  }

  // 2e — one client `.npmrc`, one scope (R3). A second scope resolves through
  // whatever the client's default registry is, which is the same silence.
  const scopes = [...new Set(publicVersionable.map((member) => scopeOf(member.name)))].sort();
  if (scopes.length > 1) {
    findings.push({
      kind: 'unresolvable-scope',
      subject: scopes.map((scope) => scope ?? '(unscoped)').join(', '),
      message:
        'are the scopes the public packages are published under. A consumer holds one `.npmrc` ' +
        'line per scope (`contracts/registry-and-scope.md` R3) and the scaffolded storefront ' +
        'writes one, so every scope after the first resolves through the client\'s default ' +
        'registry instead — which serves none of them and says so as "not in the npm registry".',
    });
  }

  // 3 — the tag policy, total in both states. The old rule asked only while
  // *every* versionable package was private, so the first public one made it
  // stop firing in either direction and nothing then held the field at all.
  if (privateVersionable.length > 0 && settings['tag'] !== false) {
    findings.push({
      kind: 'tag-policy-unstated',
      subject: 'privatePackages.tag',
      message:
        `is ${JSON.stringify(settings['tag'] ?? null)} while ${privateVersionable.length} ` +
        'versionable package(s) are private. `changeset tag` would then write one ref per ' +
        'private package per release, naming a version no registry serves — a fact derived ' +
        'from the commit that wrote it (D-100), written into a ref every clone fetches. Set ' +
        'it to `false`; a public package is git-tagged regardless of this field.',
    });
  }
  if (privateVersionable.length === 0 && typeof settings['tag'] !== 'boolean') {
    findings.push({
      kind: 'tag-policy-unstated',
      subject: 'privatePackages.tag',
      message:
        'is not stated, and no versionable package is private any more. The field then governs ' +
        'nothing — `changeset publish` tags a public package whatever it says — so its absence ' +
        'is the `@changesets/config@4` default rather than a decision, and a reader cannot ' +
        'tell the policy from the silence. Write it, `true` or `false`, in the merge request ' +
        'that made the last package public.',
    });
  }

  // 4/5 — the ignore list, both directions.
  for (const member of inputs.members) {
    if (member.family && isIgnored(member.name)) {
      findings.push({
        kind: 'ignored-family-member',
        subject: member.name,
        message:
          `(${member.dir}) is produced by the workspace entr${member.globs.length === 1 ? 'y' : 'ies'} ` +
          `${member.globs.map((glob) => `\`${glob}\``).join(', ')} — a library family — and an ` +
          '`ignore` pattern matches its name, so a merge request may change it without saying ' +
          'what that means for anyone consuming it. `ignore` is for applications nobody ' +
          'resolves by version.',
      });
    }
    if (!member.family && !isIgnored(member.name)) {
      findings.push({
        kind: 'unignored-application',
        subject: member.name,
        message:
          `(${member.dir}) comes from the literal workspace entr${member.globs.length === 1 ? 'y' : 'ies'} ` +
          `${member.globs.map((glob) => `\`${glob}\``).join(', ')} — one deployable, not a ` +
          'library — and no `ignore` pattern matches it, so every merge request touching it ' +
          'will demand a changeset for something nobody installs by version. Add its **name** ' +
          'to `ignore` (the list is glob-matched against names, never paths).',
      });
    }
  }

  // 6 — a claim about this repository that this repository no longer holds.
  for (const pattern of ignorePatterns) {
    if (inputs.members.some((member) => matchesPattern(pattern, member.name))) continue;
    findings.push({
      kind: 'stale-ignore-entry',
      subject: pattern,
      message:
        'matches no workspace package. `ignore` is glob-matched against package **names**, ' +
        'so a path written there (`packages/*`) matches nothing at all and the entry it was ' +
        'meant to replace stops being ignored.',
    });
  }

  // 7 — a group that has quietly stopped covering one of its members.
  for (const name of groupMembers(inputs.config)) {
    if (inputs.members.some((member) => member.name === name)) continue;
    findings.push({
      kind: 'stale-group-member',
      subject: name,
      message:
        'is named by a `linked` or `fixed` group and is not a workspace package. The group ' +
        'goes on applying to the others and nothing reports that it stopped applying to this ' +
        'one — which for a `linked` group means the version agreement it exists to enforce is ' +
        'quietly one package short.',
    });
  }

  // 8 — the reconciliation: written intent against derived classification.
  for (const release of inputs.changesets) {
    const member = inputs.members.find((candidate) => candidate.name === release.packageName);
    if (member === undefined) {
      findings.push({
        kind: 'unversionable-changeset',
        subject: `${release.file}:${release.packageName}`,
        message:
          'names a package that is not a workspace member. `changeset version` will refuse ' +
          'the run, or drop the intent, depending on how the name got there.',
      });
      continue;
    }
    if (isIgnored(member.name)) {
      findings.push({
        kind: 'unversionable-changeset',
        subject: `${release.file}:${release.packageName}`,
        message:
          'names a package that `ignore` matches, so the bump written here will never be ' +
          'applied. Either the package belongs in the release, or the changeset does not.',
      });
      continue;
    }

    // 9 — D-225: no package leaves `0.x` before the move to public npmjs.
    //
    // Per package, from that package's own `version`. The estate is not asked
    // whether it is "in `0.x`" and no list of series-bound packages exists: a
    // mixed estate is judged member by member, and the merge request that takes
    // a package to `1.0.0` stops this rule applying to it in the same diff that
    // moves it.
    //
    // It is an instrument rather than a note in a checklist because the failure
    // is **silent**. A `major` changeset sits in `.changeset/` for weeks and is
    // applied by a release nobody is watching; `changeset status` reports it as
    // ordinary intent, and nothing else in the tree says a word.
    if (release.bump !== 'major') continue;
    const major = versionMajor(member.version);
    // `null` is the refusal above, not a pass. Reaching it here would mean the
    // refusal stopped firing, and reading an unknown series as "not `0.x`" is
    // the direction that agrees with the defect.
    if (major !== 0) continue;
    findings.push({
      kind: 'major-bump-in-a-zero-series',
      subject: `${release.file}:${release.packageName}`,
      message:
        `declares \`major\` for a package at \`${member.version ?? '?'}\`, which the next ` +
        '`changeset version` would take out of `0.x`. **D-225**: no package leaves `0.x` ' +
        'before the move to public npmjs, which is that ruling\'s retiring condition. Write ' +
        '`minor` — in a `0.x` series the two have the identical consumer-facing contract, ' +
        'because `^0.7.0` is `>=0.7.0 <0.8.0` and `0.8.0` is out of range for every caret ' +
        'dependent exactly as `1.0.0` is, so `minor` already forces the explicit opt-in that ' +
        'is the whole consumer-facing meaning of "breaking". Keep the summary body as it is: ' +
        'it is where the break is described, and preserving it is why D-225 calls this a ' +
        'translation. There is deliberately no override and no ledger — the escape is ' +
        'deletion, in the merge request that performs the npmjs move.',
    });
  }

  findings.push(...scanChangesetProse(inputs.documents));

  return findings;
}

/**
 * **R3 over the changeset bodies** — the gate on the surface that had none
 * (`specs/129-github-canonical-migration/` T017 / FR-031; 126's FR-020).
 *
 * This is the *only* pre-existing instrument in this estate whose subject
 * survives the migration to a canonical public repository. R1 and R2 — the
 * population and the projection — stop having a subject the moment there is one
 * tree; newly written prose does not. So it is here, in the gate a merge request
 * already has to pass, rather than in a check of its own that would run over an
 * artefact nobody writes.
 *
 * The rule's weakness is stated where it belongs, in
 * `backend/scripts/lib/commercial-vocabulary.ts` and in this check's inventory
 * row: precision ≈ 28 %, **recall unknown**. It is a tripwire on prose, not a
 * structural gate, and a green from it guarantees nothing.
 */
function scanChangesetProse(
  documents: readonly ChangesetDocument[],
): readonly ReleaseIntentFinding[] {
  const findings: ReleaseIntentFinding[] = [];
  for (const document of documents) {
    if (document.file === 'README.md') continue;
    const scan = scanCommercialVocabulary(document.body);
    for (const hit of scan.hits) {
      findings.push({
        kind: 'commercial-disclosure-in-changeset',
        subject: `${document.file}:${hit.line}`,
        message:
          `\`${hit.term}\` (${hit.klass}) — "${hit.text.slice(0, 120)}". A changeset body is ` +
          'rendered into a `CHANGELOG.md` that ships, and the one real commercial disclosure ' +
          'this estate found in a published artefact came through this surface. Judge it ' +
          'against `specs/conventions/commercial-data.md` §1 rather than against the word ' +
          'that matched: §4(b) and §4(c) narrow this rule sharply, and its measured precision ' +
          'is about 28 %. If it is a false positive, clear it **beside the paragraph that ' +
          'carries it** with `<!-- commercial-data: cleared `' +
          hit.term +
          '` — why -->` and a reason somebody can disagree with. Do not widen the term list: ' +
          'that silently stops the rule refusing a real finding somewhere else.',
      });
    }
    for (const stale of scan.staleClearances) {
      findings.push({
        kind: 'stale-disclosure-clearance',
        subject: `${document.file}:${stale.line}`,
        message:
          `clears \`${stale.term}\`, and its own paragraph no longer contains it. Remove the ` +
          'annotation, so that every clearance left is one somebody still has to agree with — ' +
          'the same direction every other ledger in this estate is held to.',
      });
    }
  }
  return findings;
}

/** The whole check over a checkout: read, refuse, or analyse. */
export function checkReleaseIntent(
  repoRoot: string,
  fs: WorkspaceFs,
  listChangesets: (dir: string) => readonly string[] | null,
): ReleaseIntentResult | ReleaseIntentRefusal {
  const inputs = readReleaseIntent(repoRoot, fs, listChangesets);
  if ('reason' in inputs) return inputs;

  const unreadable = unreadablePattern(stringList(inputs.config['ignore']));
  if (unreadable !== null) {
    return {
      reason:
        `the \`ignore\` pattern \`${unreadable}\` uses a glob grammar this check does not ` +
        'implement (micromatch has extglobs, braces and negation; this file has `*` and `?`). ' +
        'Reporting it as matching nothing would be a claim this run never made.',
    };
  }

  // Feature 104's two refusals went with the closure they guarded (the ruling
  // of 2026-09-05): with the population every versionable member, no reference
  // storefront is consulted and there is nothing about it left to be
  // undecidable. What replaced them is the glob floor above — the two ways this
  // check can stop seeing packages at all.
  const publicVersionable = inputs.members.filter((member) => member.family && !member.isPrivate);

  const ignorePatterns = stringList(inputs.config['ignore']);
  const isIgnored = (name: string): boolean =>
    ignorePatterns.some((pattern) => matchesPattern(pattern, name));

  // One per decision taken inside the files read: each member classified, each
  // ignore pattern resolved, each group member looked up, plus the two
  // `privatePackages` settings. Feature 104 added four per public versionable
  // member; the ruling of 2026-09-05 splits them, because the publication
  // decision is no longer asked only of the public ones. It is asked of **every
  // versionable member** — does this package publish — and the three fitness
  // decisions (is it complete, what does its access resolve to, can the
  // registry serve its scope) stay per public member, with one more for the
  // scope agreement across the set, which is a decision about the set rather
  // than about a member. The licensing ruling of 2026-09-06 makes them **four**
  // per public member: is this package licensed, and — for the one licence form
  // that names a file — is that file there. The two are one decision per member
  // because the second is only reachable through the first, and counting the
  // file probe separately would make this number oscillate with how many paid
  // packages the estate happens to hold.
  //
  // **The changeset reconciliations are decisions and are deliberately not
  // counted here**, for the reason given at `files` above: their number follows
  // the release cycle rather than the tree, and a band over an oscillating
  // quantity jams in both directions. They are printed beside this as
  // `changesets=`, which is where a reader should look for how many there were.
  const sites =
    inputs.members.length +
    ignorePatterns.length +
    groupMembers(inputs.config).length +
    2 +
    inputs.members.filter((member) => member.family).length +
    publicVersionable.length * 4 +
    (publicVersionable.length > 0 ? 1 : 0);
  const globs = [...inputs.globCoverage.keys()];
  // The independent derivation: `pnpm-workspace.yaml` says how many entries
  // should produce a member, and the manifests on disk say how many did. Move
  // `packages/` and the four application entries still answer every question
  // above — which is issue #215's short walk over exactly this population.
  // The second author (FR-017): the distinct package names the changeset files
  // name, which are written by hand, reconciled against the members the
  // workspace globs produce. It puts the changeset population on the `read:`
  // line in the estate's grammar **without** folding it into `files` or
  // `sites`, which !966 took it out of on purpose — that count follows the
  // release cycle rather than the tree, and a ±band cannot bound a quantity
  // that oscillates in both directions.
  //
  // It is **omitted** rather than printed `0/0` when no changeset names a
  // subject. After a release `.changeset/` holds `config.json` and `README.md`
  // and nothing else, and `read-size.ts` refuses `expected=0` as
  // `no-expectation` — so a token printed there would exit 2 on every
  // post-release tree, which is a refusal about the calendar rather than about
  // the tree. `check:action-route-permissions`' `emitted-manifests` is the
  // precedent for both halves.
  //
  // Its expected and covered are the same number **on purpose**, which is
  // `check:module-docs`' `sidebar-entries` precedent: a name resolving to no
  // member is `unversionable-changeset`, a finding about the changeset, and not
  // a blind run. Turning it into a shortfall would refuse before the analysis
  // reported that finding, and the refusal would blame the walk for a typo the
  // check had already read correctly.
  const namedSubjects = new Set(inputs.changesets.map((release) => release.packageName));
  const coverage: readonly ReadCoverage[] = [
    {
      source: 'workspace-globs',
      expected: globs.length,
      covered: globs.filter((glob) => (inputs.globCoverage.get(glob) ?? 0) > 0).length,
    },
    ...(namedSubjects.size > 0
      ? [{ source: 'changeset-subjects', expected: namedSubjects.size, covered: namedSubjects.size }]
      : []),
  ];

  // The read-size floor is part of the analysis and not of the printing. It sat
  // in the CLI's `reportReadSize` first, which meant a red proof entering where
  // a real run enters could not reach it — the exact shape issue #130 is about,
  // one layer down from the checks it was found in.
  const short = readSizeRefusal({ prefix: PREFIX, files: inputs.files, sites, coverage });
  if (short !== null) return { reason: short.message };

  // FR-017's four refusals, one per input whose absence would make
  // `major-bump-in-a-zero-series` vacuously clean. They live here, inside the
  // analysis, so that a red proof entering where a real run enters reaches each
  // of them (issue #130), and **below** the read-size floor on purpose: a
  // library tree that moved leaves no versionable package either, and issue
  // #215's floor is the more specific diagnosis of that tree. Asked first, this
  // block would answer *"no versionable package"* for a workspace whose only
  // defect is that one glob stopped resolving.
  //
  // The first was **written down as already held and was not** (feature 114,
  // T3-E). `checkBranchIntent` refuses a workspace with no versionable package,
  // because the `--since` mode has no published surface to attribute a diff to;
  // the default mode did not, and with no versionable member every question
  // below — this one included — is vacuously true while `files` and the glob
  // coverage stay perfectly healthy.
  //
  // It is keyed on the **family** and deliberately not on "family and not
  // ignored". An `ignore` pattern swallowing a whole library family is
  // `ignored-family-member` — the 67-package failure mode and this check's most
  // valuable finding — so a refusal over that state would mask the finding
  // whose whole subject it is. Measured: with the refusal keyed the other way,
  // `ignore: ['host', '@fx/*']` refuses instead of reporting.
  const library = inputs.members.filter((member) => member.family);
  if (library.length === 0) {
    return {
      reason:
        'no versionable package — every workspace member comes from a literal ' +
        '`pnpm-workspace.yaml` entry, which names one deployable rather than a library family, ' +
        'so there is nothing a changeset could bump and no package whose series could be judged',
    };
  }
  const versionable = library.filter((member) => !isIgnored(member.name));

  // A changeset file that does not open with a `---` block at all. Reading it
  // as *"no `major` declared here"* agrees with the defect (issue #113), and it
  // is emphatically **not** the empty changeset: that one has the delimiters
  // and nothing between them, is what AGENTS.md tells an author to write for a
  // change with no release meaning, and is left alone (FR-017, A15).
  const withoutFrontMatter = inputs.documents.find((document) => !document.hasFrontMatter);
  if (withoutFrontMatter !== undefined) {
    return {
      reason:
        `\`.changeset/${withoutFrontMatter.file}\` carries no \`---\` front-matter block — an ` +
        'opening `---` line and a later line that is exactly `---`. `changeset version` reads ' +
        'no release intent out of it, and this check will not report it as declaring none. An ' +
        '*empty* changeset (`---`, `---`, then the summary) is a different thing and is fine',
    };
  }

  // An entry naming a versionable member whose own `version` has no readable
  // major. The predicate is *is this package in `0.x`*, and an unreadable
  // version must never be read as *not* `0.x`.
  for (const release of inputs.changesets) {
    const member = versionable.find((candidate) => candidate.name === release.packageName);
    if (member === undefined) continue;
    if (versionMajor(member.version) !== null) continue;
    return {
      reason:
        `\`${member.name}\` (${member.dir}) declares ` +
        `${member.version === null ? 'no `version`' : `the version \`${member.version}\``} and ` +
        `\`.changeset/${release.file}\` names it, so this run cannot say which series that ` +
        'package is in. D-225 is a rule about the series, and an unreadable version answered ' +
        'as "not `0.x`" is the direction that agrees with the defect',
    };
  }

  // Issue #237's shape, over this population: front matter was read and nothing
  // came out of it. Keyed on the **lines**, not on the files, because a tree of
  // nothing but empty changesets is a legitimate state that yields zero entries
  // honestly — while front-matter text that parses to no entry at all is the
  // entry reader having gone blind, which prints a cheerful `changesets=0`
  // beside a healthy `files=`.
  const frontMatterLines = inputs.documents.reduce(
    (total, document) => total + document.frontMatterLines,
    0,
  );
  if (frontMatterLines > 0 && inputs.changesets.length === 0) {
    return {
      reason:
        `the changeset files carry ${String(frontMatterLines)} non-blank front-matter line(s) ` +
        'and not one of them parsed as a `<package>: <bump>` entry — the entry reader has gone ' +
        'blind, and every question this check asks of a release declaration would be vacuously ' +
        'clean',
    };
  }


  return { findings: analyzeReleaseIntent(inputs), inputs, sites, coverage };
}

// --- the published surface, and the diff that reaches it -------------------

/** What one versionable package compiles into its published `dist`. */
export interface PublishedSurface {
  readonly name: string;
  /** Repository-relative package directory — what `changeset status` watches. */
  readonly dir: string;
  /** Repository-relative `include` patterns, resolved from the build config. */
  readonly include: readonly string[];
  /** Repository-relative `exclude` patterns, same resolution. */
  readonly exclude: readonly string[];
  /** How many tsconfigs the `extends` chain opened to answer. */
  readonly filesRead: number;
}

/**
 * The branch as git alone answers it: lists of repository-relative paths against
 * a named baseline, with nothing read out of a file.
 *
 * It is told apart from {@link BranchDiff} because the release-shape
 * classification (feature 114, contract §5.1) rests on facts that are **not** in
 * the commit graph — whether a `version` field moved, and whether a
 * `CHANGELOG.md` gained a section. Both are properties of the two sides'
 * *contents*, so they are resolved inside the analysis, where a red proof can
 * hand it a two-sided reader; a git reader that resolved them would put them
 * where no fixture can enter (issue #130).
 */
export interface BranchPaths {
  /** The ref the branch was measured against, as it was given on the command line. */
  readonly baseline: string;
  /**
   * Whether every commit of `HEAD` is already reachable from the baseline —
   * `git merge-base --is-ancestor HEAD <baseline>`.
   *
   * This is a **different fact** from an empty {@link changedPaths}, and telling
   * the two apart is the whole reason it is carried: see
   * {@link ReleaseIntentContainment}.
   */
  readonly containedInBaseline: boolean;
  /** Every file the branch changes, relative to the repository root. */
  readonly changedPaths: readonly string[];
  /** The `.changeset/*.md` files the branch **adds** (README excluded). */
  readonly addedChangesets: readonly string[];
  /**
   * The `.changeset/*.md` files the branch **deletes** (README excluded).
   *
   * Consumption is deliberately *not* part of the classification (D-212,
   * contract §3.1) — it appears only in {@link ReleaseIntentFindingKind}'s
   * `vacuous-release` refusal, which is what gives the hand-set release and the
   * history landing one verdict apiece while keeping the teeth of the refusal
   * the `privatePackages.version: false` no-op arrives through.
   */
  readonly deletedChangesets: readonly string[];
}

/**
 * What one versionable package's manifest and changelog say about this branch.
 *
 * The three booleans are the two derived facts of contract §2, per package:
 * `versionMoved` and `changelogSectionAdded` are §2.1's *release artefact*, and
 * `manifestChangedBeyondVersion` is §2.2's release-neutrality. A record exists
 * for every versionable package the branch **touched**, whether or not any of
 * the three is true — an all-false record is the answer "this package changed
 * and released nothing", and it is what makes contract §7.3's refusal (a
 * touched package for which the walk produced no fact at all) mean the walk
 * stopped working rather than the branch being ordinary.
 */
export interface ReleaseArtefact {
  /** The versionable package's name, as its manifest declares it. */
  readonly package: string;
  /** Its `package.json` `version` differs between the two sides of the diff. */
  readonly versionMoved: boolean;
  /** Its `CHANGELOG.md` gains a `## <version>` heading the baseline has not. */
  readonly changelogSectionAdded: boolean;
  /**
   * Its `package.json` changed in some key other than `version`.
   *
   * The exemption is **field-level, never file-level** (contract §2.2):
   * `exports`, `peerDependencies`, `files` and `types` are consumer-facing, they
   * compile into nothing, and so neither `changeset status` nor this check's
   * published-surface pass can see them move — every versionable package's
   * surface resolves to its own `src` tree. A file-level exemption would open
   * exactly that hole, which is scenario 3 of the spec.
   */
  readonly manifestChangedBeyondVersion: boolean;
}

/** The branch, with the artefact facts contract §2 derives from both sides of it. */
export interface BranchDiff extends BranchPaths {
  /** One record per versionable package the branch touched. */
  readonly releaseArtefacts: readonly ReleaseArtefact[];
}

/**
 * One side of one file, as text.
 *
 * Three answers, and the middle one is why this is not `string | null`:
 *
 *   * the text — the file is there at that ref;
 *   * `''` — the ref does not carry that path *at all*. A `CHANGELOG.md` the
 *     branch creates has no baseline side, and the history landing creates one
 *     per released package, so reading that absence as a failure would refuse
 *     the largest release-shaped branch in this repository's history;
 *   * `null` — the read **failed**. That is contract §7.1/§7.2's exit 2: an
 *     artefact question answered by a silence is not an answer, and the silence
 *     reads as "no release", which is the direction that agrees with the defect.
 *
 * The distinction is git's own — `git cat-file -e <ref>:<path>` exits 1 for a
 * path the ref does not carry and 128 for anything else — and not a guess made
 * from an error message.
 */
export type SideReader = (ref: string, path: string) => string | null;

/** What `changeset status` answered, or `null` when it could not be run at all. */
export interface ChangesetStatusAnswer {
  readonly status: number;
  readonly output: string;
}

/**
 * The changesets CLI's own command, injected.
 *
 * FR-007: `changeset status` is **not** reimplemented and this contract does not
 * change what it asks. What moved is the decision of *which* branch to ask it
 * of, which was never the CLI's. Injecting it is what lets a red proof drive
 * contract §8's fixture 5 — an ordinary branch whose CLI answer is red — without
 * a git repository, and what makes "the invocation could not run at all"
 * (contract §7.4) reachable from a fixture as the refusal it is, rather than as
 * a finding.
 */
export type ChangesetStatusRunner = (baseline: string) => ChangesetStatusAnswer | null;

/**
 * The baseline already contains the branch, so there is no delta to judge.
 *
 * **This is a verdict, not a refusal, and the distinction is the repair of
 * pipeline 11491.** A merge request that changed six files exited 2 on *"the
 * branch changes no file at all"* because it had already been merged when the
 * job fetched its baseline: `HEAD` was an ancestor of `origin/master`, so
 * `merge-base(origin/master, HEAD)` **was** `HEAD` and the three-dot diff
 * compared the branch with itself. At this project's merge cadence that fires
 * regularly, and a gate that is red for a reason no author can act on is a gate
 * people learn to scroll past — which is the same silence issue #113 refuses,
 * wearing the other costume.
 *
 * So the empty diff splits in two, and only one half is a refusal:
 *
 *   * **Not contained, and the diff is empty** — a branch with a real fork point
 *     whose commits change no file. The measurement came back empty; it was not
 *     empty by construction. That stays exit 2, verbatim.
 *   * **Contained** — every question this mode asks is of the form *"does this
 *     branch add X to the baseline without a changeset?"*, and the set of files
 *     it adds is empty **because the baseline holds them all already**. That is
 *     a measured answer, established by one git command that returns a definite
 *     yes, and it is reported as such.
 *
 * Containment cannot be manufactured to slip past the gate, which is what makes
 * the pass safe: to be an ancestor of the target, every commit must already be
 * in the target — and getting them there needed a merge, whose own pipeline ran
 * this gate against a baseline that did not yet contain them. A **squash** merge
 * copies the content and leaves the commit outside that history, so such a
 * branch is *not* contained and is judged normally.
 *
 * The configuration half of this check is unaffected: it runs in `quality`, on
 * every merge request, with no diff and no baseline.
 */
export interface ReleaseIntentContainment {
  /** Why there is no delta to judge, in full. */
  readonly contained: string;
}

/**
 * What the `--since` mode measured about one branch.
 *
 * It was `PublishedSurfaceResult` while the mode asked one question; feature 114
 * gave the mode the release-shape classification, so the result carries the
 * verdict (`shape`) and the facts it was reached from (`artefacts`) beside the
 * surfaces the D-162 question is asked over.
 */
export interface BranchIntentResult {
  readonly findings: readonly ReleaseIntentFinding[];
  readonly surfaces: readonly PublishedSurface[];
  /** The classification (D-212, contract §3), printed so the verdict is readable. */
  readonly shape: 'release' | 'vacuous' | 'ordinary';
  /** One record per versionable package the branch touched. */
  readonly artefacts: readonly ReleaseArtefact[];
  readonly files: number;
  readonly sites: number;
  readonly coverage: readonly ReadCoverage[];
}

/**
 * Strip `//` line comments — the tsconfigs in this repository carry them, and
 * `packages/platform/tsconfig.json` carries more comment than configuration.
 * Line comments only: no block comment is written in one here.
 */
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line))
    .join('\n');
}

/**
 * Collapse `.` and `..` in a POSIX path. Deliberately string-only: the patterns
 * being resolved are `include` entries relative to a tsconfig, and turning them
 * into absolute filesystem paths would make the analysis depend on where the
 * checkout is rather than on what it declares.
 */
export function normalizeRelative(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out.join('/');
}

/**
 * Whether `path` matches a tsconfig `include`/`exclude` pattern.
 *
 * The three constructs tsconfig defines: `**` spans any number of segments
 * including none, `*` any run inside one segment, `?` one character inside one.
 * A pattern with no glob character at all names a directory, which tsconfig
 * reads as everything under it — the shape `"include": ["src"]` takes.
 */
export function matchesTsGlob(pattern: string, path: string): boolean {
  const effective = /[*?]/.test(pattern) ? pattern : `${pattern}/**/*`;
  const patternSegments = effective.split('/');
  const pathSegments = path.split('/');

  const walk = (p: number, s: number): boolean => {
    if (p === patternSegments.length) return s === pathSegments.length;
    const head = patternSegments[p]!;
    if (head === '**') {
      for (let skip = s; skip <= pathSegments.length; skip += 1) {
        if (walk(p + 1, skip)) return true;
      }
      return false;
    }
    if (s === pathSegments.length) return false;
    const source = head
      .split(/([*?])/)
      .map((part) => (part === '*' ? '[^/]*' : part === '?' ? '[^/]' : escapeRegExp(part)))
      .join('');
    if (!new RegExp(`^${source}$`).test(pathSegments[s]!)) return false;
    return walk(p + 1, s + 1);
  };

  return walk(0, 0);
}

/**
 * The `include`/`exclude` of one package's emit configuration, resolved to
 * repository-relative patterns.
 *
 * Follows `extends` because that is where the answer actually lives: !891 puts
 * `include` in `tsconfig.json` and `rootDir` in the `tsconfig.build.json` that
 * extends it, so a reader of the build file alone would find no `include` and
 * conclude the package publishes nothing outside itself — the exact silence
 * this mode exists to remove. Only relative `extends` is followed; a package
 * reference (`extends: "@scope/tsconfig/base"`) is reported as unreadable
 * rather than treated as absent.
 */
export function readPublishedSurface(
  repoRoot: string,
  packageDir: string,
  packageName: string,
  fs: WorkspaceFs,
): PublishedSurface | ReleaseIntentRefusal {
  const seen = new Set<string>();
  let current = `${packageDir}/tsconfig.build.json`;
  let include: readonly string[] | null = null;
  let exclude: readonly string[] = [];
  let excludeFrom = '';

  while (current !== '') {
    if (seen.has(current)) {
      return { reason: `\`${current}\` is part of an \`extends\` cycle` };
    }
    seen.add(current);
    const text = fs.readText(join(repoRoot, current));
    if (text === null) {
      return { reason: `\`${current}\` could not be read, so what \`${packageName}\` publishes is unknown` };
    }
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(stripLineComments(text)) as Record<string, unknown>;
    } catch (error) {
      return { reason: `\`${current}\` does not parse: ${String(error)}` };
    }

    const dir = current.slice(0, current.lastIndexOf('/'));
    const resolve = (pattern: string): string => normalizeRelative(`${dir}/${pattern}`);
    if (include === null && Array.isArray(config['include'])) {
      include = stringList(config['include']).map(resolve);
    }
    if (excludeFrom === '' && Array.isArray(config['exclude'])) {
      exclude = stringList(config['exclude']).map(resolve);
      excludeFrom = current;
    }
    // The nearest `include` wins and there is nothing further to learn: a base
    // config above it describes a different compilation. Stopping here is also
    // what keeps the chain short — `tsconfig.base.json` declares no `include`
    // and is not this package's statement about what it publishes.
    if (include !== null) break;

    const parent = config['extends'];
    if (parent === undefined) break;
    if (typeof parent !== 'string' || !parent.startsWith('.')) {
      return {
        reason:
          `\`${current}\` extends \`${String(parent)}\`, which is not a relative path — this ` +
          `check cannot follow it, and treating it as absent would report \`${packageName}\` ` +
          'as publishing nothing outside its own directory',
      };
    }
    current = normalizeRelative(`${dir}/${parent}`);
  }

  if (include === null) {
    return {
      reason:
        `\`${packageDir}/tsconfig.build.json\` and its \`extends\` chain declare no \`include\`, ` +
        `so every file in the checkout is a candidate source of \`${packageName}\` and none of ` +
        'them can be attributed',
    };
  }

  // `dist` is never a source. Without this a rebuilt artefact under a package
  // whose `include` is written broadly reads as a published-source change.
  return {
    name: packageName,
    dir: packageDir,
    include,
    exclude: [...exclude, `${packageDir}/dist`],
    filesRead: seen.size,
  };
}

/** Whether the package's build configuration compiles `path`. */
export function compilesPath(surface: PublishedSurface, path: string): boolean {
  if (!surface.include.some((pattern) => matchesTsGlob(pattern, path))) return false;
  return !surface.exclude.some((pattern) => matchesTsGlob(pattern, path));
}

/**
 * The `## <version>` headings a changelog carries.
 *
 * A section is recognised by its heading being a version, not by its being a
 * level-two heading: `applyReleasePlan` writes `## 0.7.0`, and a changelog is
 * ordinary markdown in which `## Unreleased` or `## Migration notes` is a
 * heading somebody wrote by hand and not a release.
 */
export function changelogSections(text: string): readonly string[] {
  const sections: string[] = [];
  for (const line of text.split('\n')) {
    const match = /^##\s+v?(\d+\.\d+\.\d+\S*)\s*$/.exec(line.trim());
    if (match !== null) sections.push(match[1]!);
  }
  return sections;
}

/**
 * A value as text, with every object's keys in a fixed order.
 *
 * Written out rather than reached for through `JSON.stringify`'s array
 * replacer, which looks like the same thing and is not: an array replacer is a
 * **key filter applied at every level**, so a top-level key list drops every
 * nested key. Measured — with it, `exports` compared equal to a narrowed
 * `exports`, because both serialised to `{}` — which is the one comparison
 * FR-004 exists for.
 */
function stableText(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableText).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, member]) => `${JSON.stringify(key)}:${stableText(member)}`).join(',')}}`;
}

/**
 * Every key of a manifest except `version`, as comparable text.
 *
 * Contract §2.2: both sides are parsed, `version` is removed from each, and the
 * remainders are compared. Parsed rather than diffed as text because a
 * reformatting — `changeset version` rewrites the file through the workspace's
 * own formatter — is not a consumer-facing change, and the question is about the
 * *values* a consumer resolves.
 */
function manifestBeyondVersion(manifest: Record<string, unknown>): string {
  const rest: Record<string, unknown> = { ...manifest };
  delete rest['version'];
  return stableText(rest);
}

/**
 * Contract §2, per versionable package, over both sides of the branch.
 *
 * Pure over `(versionable, diff, readSide)`: every byte it judges arrives
 * through the reader, so a red proof supplies a synthetic diff and a two-sided
 * reader and reaches every one of the refusals below — which is what contract
 * §7 asks for and what `reportReadSize` living in the CLI could not give
 * (issue #130).
 *
 * Three of contract §7's four refusals are here, because this is where their
 * input is: an unreadable `CHANGELOG.md` side, a `package.json` side that does
 * not parse, and a branch that touched a versionable package's directory and
 * produced no fact at all. The first two are stated as a pair on purpose — they
 * are the same defect on the two file kinds this reads, and a check that refused
 * one and skipped the other would be a check whose blindness depends on which
 * file went wrong.
 */
export function readReleaseArtefacts(
  versionable: readonly { readonly name: string; readonly dir: string }[],
  diff: BranchPaths,
  readSide: SideReader,
): readonly ReleaseArtefact[] | ReleaseIntentRefusal {
  const changed = new Set(diff.changedPaths);
  const artefacts: ReleaseArtefact[] = [];

  for (const member of versionable) {
    const touched =
      changed.has(`${member.dir}/package.json`) ||
      diff.changedPaths.some((path) => path.startsWith(`${member.dir}/`));
    if (!touched) continue;

    const manifestPath = `${member.dir}/package.json`;
    let versionMoved = false;
    let manifestChangedBeyondVersion = false;
    if (changed.has(manifestPath)) {
      const sides: Record<string, unknown>[] = [];
      for (const ref of [diff.baseline, 'HEAD']) {
        const text = readSide(ref, manifestPath);
        if (text === null) {
          return {
            reason:
              `\`${manifestPath}\` could not be read at \`${ref}\` — the manifest is what ` +
              'answers whether this branch moved a version and whether it changed anything ' +
              'else, and a silence there reads as "no release", which is the direction that ' +
              'agrees with the defect',
          };
        }
        // An empty read is the ref not carrying the path at all — a package the
        // branch adds. Its baseline remainder is `{}`, so every key it declares
        // is a change beyond `version`, which is the fail-closed answer: a new
        // package reaches a consumer and needs a changeset.
        if (text.trim() === '') {
          sides.push({});
          continue;
        }
        try {
          const parsed: unknown = JSON.parse(text);
          if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('not an object');
          }
          sides.push(parsed as Record<string, unknown>);
        } catch {
          return {
            reason:
              `\`${manifestPath}\` does not parse at \`${ref}\` — never "changed beyond ` +
              'version" and never "release-neutral"; a manifest this run could not read is a ' +
              'manifest it has no verdict about',
          };
        }
      }
      const [before, after] = sides as [Record<string, unknown>, Record<string, unknown>];
      versionMoved =
        typeof before['version'] === 'string' &&
        typeof after['version'] === 'string' &&
        before['version'] !== after['version'];
      manifestChangedBeyondVersion =
        manifestBeyondVersion(before) !== manifestBeyondVersion(after);
    }

    const changelogPath = `${member.dir}/CHANGELOG.md`;
    let changelogSectionAdded = false;
    if (changed.has(changelogPath)) {
      const sides: string[] = [];
      for (const ref of [diff.baseline, 'HEAD']) {
        const text = readSide(ref, changelogPath);
        if (text === null) {
          return {
            reason:
              `\`${changelogPath}\` could not be read at \`${ref}\` — an added changelog ` +
              'section is one of the two release artefacts this branch is classified by, and ' +
              'a question answered by a silence reads as "no release"',
          };
        }
        sides.push(text);
      }
      const [before, after] = sides as [string, string];
      const had = new Set(changelogSections(before));
      changelogSectionAdded = changelogSections(after).some((section) => !had.has(section));
    }

    artefacts.push({
      package: member.name,
      versionMoved,
      changelogSectionAdded,
      manifestChangedBeyondVersion,
    });
  }

  // Contract §7.3, and it is a floor over a population **the walk did not
  // compute**: the changed files that carry a release — a manifest or a
  // changelog — sitting where a versionable package sits, under a directory that
  // holds one. If the walk attributed *none* of them to any member while the
  // branch changed one, the walk has stopped matching the tree, and what it
  // would otherwise print is a clean line over an unjudged branch.
  //
  // Why it is narrow: it fires only when the walk produced **nothing at all**,
  // so a branch that edits one stray manifest beside a package it did attribute
  // is judged normally. And why it is exit 2 rather than a finding: a manifest
  // under the library tree that belongs to no workspace member — a package the
  // branch deletes, or one the workspace globs stopped reaching — is a
  // consumer-facing change this check has no member to attribute, which is a
  // measurement it did not take rather than a verdict about the branch.
  const versionableDirs = new Set(versionable.map((member) => member.dir));
  const parents = new Set(versionable.map((member) => parentOf(member.dir)));
  const unattributed = diff.changedPaths.filter((path) => {
    const base = path.slice(path.lastIndexOf('/') + 1);
    if (base !== 'package.json' && base !== 'CHANGELOG.md') return false;
    const dir = parentOf(path);
    return parents.has(parentOf(dir)) && !versionableDirs.has(dir);
  });
  if (unattributed.length > 0 && artefacts.length === 0) {
    return {
      reason:
        `this branch changes ${String(unattributed.length)} release-bearing file(s) where a ` +
        `versionable package sits and the artefact walk attributed none of them: ` +
        `${unattributed.slice(0, 5).join(', ')}${unattributed.length > 5 ? ', …' : ''}. ` +
        'Either a package left the workspace while its manifest stayed, or the walk has ' +
        'stopped matching the tree; a clean line over an unjudged branch is what this would ' +
        'otherwise print',
    };
  }
  return artefacts;
}

/** The parent of a repository-relative POSIX path, or `''` at the top. */
function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? '' : path.slice(0, cut);
}

/**
 * What shape of branch this is (D-212, contract §3).
 *
 * | Release artefact | Verdict |
 * | --- | --- |
 * | present | `release` |
 * | absent, and changeset files were deleted | `vacuous` |
 * | absent, otherwise | `ordinary` |
 *
 * Three properties of that table are load-bearing, and a fourth is a
 * reconciliation this function has to state rather than leave to a reader.
 *
 * **Consumption is not in the classification.** It appears only in the refusal:
 * a branch that deleted changeset files and produced nothing is refused, and a
 * branch that produced something is a release whether it consumed or not. That
 * is what gives the hand-set release (D-210's first act, which consumes nothing)
 * and the history landing (its second, which consumes everything and moves no
 * version) one verdict apiece.
 *
 * **An added changeset does not reclassify.** Neither row consults
 * {@link BranchPaths.addedChangesets}. An empty changeset is a human's *"I
 * looked, there is nothing to release"* and never a declaration that a release
 * happened — measured, one empty changeset turned both unrecognised shapes green
 * under the superseded rule, and for the history landing it removed the branch
 * from the release class entirely, so nothing asked whether it released
 * anything.
 *
 * **The refusal keeps its teeth.** Under `privatePackages.version: false` —
 * the silent no-op the refusal exists to catch — `changeset version` writes no
 * version, writes no changelog, and does not even delete the changeset files. So
 * a changelog section is written by the operation the gate wants to see and by
 * nothing else, and widening the artefact from *a moved version* to *a moved
 * version or an added changelog section* cannot reach the no-op.
 *
 * **And release-neutrality is part of being a release**, which is the
 * reconciliation: contract §8's proof 4 is a branch that moves a `version`
 * **and** narrows an `exports` map, and its expectation is both the
 * `manifest-changed-beyond-version` finding *and* §4.1 being asked. A manifest
 * that changed in another key carries a change needing a changeset, so the
 * branch is not exempt from the ordinary questions; §2.1's artefact is what
 * makes it a release, §2.2's neutrality is what makes the release *all* it is.
 */
export function classifyReleaseShape(diff: BranchDiff): 'release' | 'vacuous' | 'ordinary' {
  const produced = diff.releaseArtefacts.some(
    (artefact) => artefact.versionMoved || artefact.changelogSectionAdded,
  );
  if (!produced) return diff.deletedChangesets.length > 0 ? 'vacuous' : 'ordinary';
  return diff.releaseArtefacts.some((artefact) => artefact.manifestChangedBeyondVersion)
    ? 'ordinary'
    : 'release';
}

/**
 * The classification's own findings: the vacuous release, and the manifest that
 * changed in a key a release does not.
 *
 * Pure over the classified diff, like every other analysis in this file, so a
 * red proof enters with a synthetic one.
 */
export function analyzeReleaseShape(diff: BranchDiff): readonly ReleaseIntentFinding[] {
  const findings: ReleaseIntentFinding[] = [];

  if (classifyReleaseShape(diff) === 'vacuous') {
    findings.push({
      kind: 'vacuous-release',
      subject: diff.baseline,
      message:
        `deletes ${String(diff.deletedChangesets.length)} changeset file(s) and produced no ` +
        'release artefact: no versionable package moved its `version` and none gained a ' +
        '`## <version>` changelog section. That is what `changeset version` does when ' +
        '`.changeset/config.json` cannot see the packages — it exits 0, reports success and ' +
        'bumps nothing — followed by a human deleting the files while tidying up. Run ' +
        '`pnpm --filter backend run check:release-intent`. An **empty changeset does not ' +
        'answer this**: the classification is over artefacts, and adding one is the lockpick ' +
        'D-212 closes.',
    });
  }

  // Suppressed by an added changeset for the same reason the published-surface
  // question is: the branch has said what it releases, and the per-package gap
  // is a reviewer's to close.
  if (diff.addedChangesets.length === 0) {
    for (const artefact of diff.releaseArtefacts) {
      if (!artefact.manifestChangedBeyondVersion) continue;
      findings.push({
        kind: 'manifest-changed-beyond-version',
        subject: artefact.package,
        message:
          'changed its `package.json` in a key other than `version`, and this branch adds no ' +
          'changeset. A `version` field is release-neutral; `exports`, `peerDependencies`, ' +
          '`files`, `types` and every other key is consumer-facing and compiles into nothing, ' +
          'so neither `changeset status` nor the published-surface pass above can see it move. ' +
          'Write the changeset, or an empty one if the change carries no release meaning.',
      });
    }
  }

  return findings;
}

/**
 * The findings `changeset status` structurally cannot produce.
 *
 * Pure over the resolved surfaces and the diff, so a red proof drives it with a
 * synthetic repository rather than with a pre-computed verdict.
 */
export function analyzePublishedSurfaceIntent(
  surfaces: readonly PublishedSurface[],
  diff: BranchPaths,
): readonly ReleaseIntentFinding[] {
  if (diff.addedChangesets.length > 0) return [];

  const findings: ReleaseIntentFinding[] = [];
  for (const surface of surfaces) {
    const unseen = diff.changedPaths.filter(
      (path) => !path.startsWith(`${surface.dir}/`) && compilesPath(surface, path),
    );
    if (unseen.length === 0) continue;
    findings.push({
      kind: 'unattributed-published-change',
      subject: surface.name,
      message:
        `compiles ${unseen.length} changed file(s) into its published \`dist\` from outside ` +
        `\`${surface.dir}/\`, and this branch adds no changeset: ` +
        `${unseen.slice(0, 5).join(', ')}${unseen.length > 5 ? ', …' : ''}. ` +
        '`changeset status` attributes a change to a package by the package\'s own directory, ' +
        'so it reports nothing for these — the gate waives a changeset for the files that ' +
        'reach a consumer while demanding one for the files that do not. Write the changeset, ' +
        'or an empty one if the change carries no release meaning.',
    });
  }
  return findings;
}

/**
 * The two readers the `--since` mode's analysis is driven by.
 *
 * They are parameters rather than calls because both reach outside the
 * checkout's *files* — one into the commit graph's contents, one into another
 * program — and a red proof that could not supply them would have to enter the
 * analysis below the classification, which is the defect issue #130 records.
 */
export interface BranchProbe {
  readonly readSide: SideReader;
  readonly askChangesetStatus: ChangesetStatusRunner;
}

/**
 * The `--since` mode over a checkout: classify the branch by what it produced,
 * and ask the ordinary branch the ordinary questions.
 *
 * The order is the contract's (§3 then §4) and each step's refusal is inside
 * this function, never in the printing: a red proof entering here — where a real
 * run enters — reaches all four of contract §7's refusals.
 */
export function checkBranchIntent(
  repoRoot: string,
  fs: WorkspaceFs,
  listChangesets: (dir: string) => readonly string[] | null,
  diff: BranchPaths,
  probe: BranchProbe,
): BranchIntentResult | ReleaseIntentContainment | ReleaseIntentRefusal {
  // First, and before anything is read: containment is a property of the commit
  // graph, so nothing below it has an input. Answering it here rather than in
  // the CLI is what lets a red proof drive it where a real run enters, and what
  // keeps it ahead of the empty-diff refusal it has to be told apart from.
  if (diff.containedInBaseline) {
    return {
      contained:
        `every commit of HEAD is already reachable from \`${diff.baseline}\`, so the branch is ` +
        `already contained in \`${diff.baseline}\` and adds no file to it. That is what a merge ` +
        'request looks like once it has been merged while its own pipeline was still running: ' +
        'the merge base is HEAD itself, so the diff is the branch against itself. Nothing is ' +
        'left to attribute to a package and nothing is left to demand a changeset for — this is ' +
        'an answer, not an empty measurement. The configuration half of this check ran in ' +
        '`quality` and is unaffected.',
    };
  }

  const inputs = readReleaseIntent(repoRoot, fs, listChangesets);
  if ('reason' in inputs) return inputs;

  const ignorePatterns = stringList(inputs.config['ignore']);
  const versionable = inputs.members.filter(
    (member) => member.family && !ignorePatterns.some((p) => matchesPattern(p, member.name)),
  );
  if (versionable.length === 0) {
    return { reason: 'no versionable package — there is no published surface to attribute a diff to' };
  }

  const surfaces: PublishedSurface[] = [];
  for (const member of versionable) {
    const surface = readPublishedSurface(repoRoot, member.dir, member.name, fs);
    if ('reason' in surface) return surface;
    surfaces.push(surface);
  }

  if (diff.changedPaths.length === 0) {
    return {
      reason:
        'the branch changes no file at all — every question below would be vacuously true, ' +
        'and a merge request with an empty diff is not the input this mode was asked about. ' +
        `It is **not already contained in \`${diff.baseline}\`** either (that answer has its ` +
        'own line and exits 0), so this is a branch with a real fork point whose commits change ' +
        'nothing: the measurement came back empty rather than being empty by construction',
    };
  }

  const artefacts = readReleaseArtefacts(versionable, diff, probe.readSide);
  if ('reason' in artefacts) return artefacts;
  const classified: BranchDiff = { ...diff, releaseArtefacts: artefacts };
  const shape = classifyReleaseShape(classified);

  const coverage: readonly ReadCoverage[] = [
    { source: 'versionable-packages', expected: versionable.length, covered: surfaces.length },
  ];
  // Every tsconfig each `extends` chain actually opened, on top of what the
  // default mode opened. Files, not chains: `files` is what the walk opened.
  const files = inputs.files + surfaces.reduce((total, surface) => total + surface.filesRead, 0);
  // One decision per (surface, changed path) pair — does this package compile it,
  // and can the CLI see that it does — plus the three artefact questions
  // (feature 114) asked of every versionable package: did its `version` move,
  // did its changelog gain a section, did its manifest change in any other key.
  const sites = surfaces.length * diff.changedPaths.length + versionable.length * 3;

  const short = readSizeRefusal({ prefix: PREFIX, files, sites, coverage });
  if (short !== null) return { reason: short.message };

  const findings: ReleaseIntentFinding[] = [...analyzeReleaseShape(classified)];

  // §4 — the ordinary branch's questions, asked of the ordinary branch. A
  // release is exempt from them because the files it changes *are* the release;
  // one that also changed a manifest beyond `version` is not classified as a
  // release in the first place (see `classifyReleaseShape`), so it is asked them
  // here with the rest.
  if (shape === 'ordinary') {
    findings.push(...analyzePublishedSurfaceIntent(surfaces, diff));

    const answer = probe.askChangesetStatus(diff.baseline);
    if (answer === null) {
      return {
        reason:
          '`changeset status` could not be run at all — that is contract §7.4 and not a ' +
          'finding: an exit code this run never obtained is not a verdict about the branch. ' +
          'The command is the changesets CLI\'s own and is not reimplemented here; what this ' +
          'check decides is which branch to ask it of',
      };
    }
    if (answer.status !== 0) {
      findings.push({
        kind: 'unattributed-package-change',
        subject: 'changeset status',
        message:
          `exited ${String(answer.status)} for this branch: a versionable package changed and ` +
          'the branch carries no changeset. This is the changesets CLI\'s own verdict, ' +
          'attributed rather than relayed — the branch is not a release (no `version` moved ' +
          'and no changelog section was added), so it is asked the ordinary question. Its ' +
          `output follows.\n${answer.output.trim()}`,
      });
    }
  }

  return { findings, surfaces, shape, artefacts, files, sites, coverage };
}

// --- CLI -------------------------------------------------------------------

function listDirectoryFiles(dir: string): readonly string[] | null {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return null;
  }
}

/**
 * The branch, read with git. A failure here is exit 2 rather than an empty
 * diff: "nothing changed" and "git could not answer" are the same silence the
 * whole file exists to refuse.
 */
function readBranchDiff(repoRoot: string, since: string): BranchPaths | ReleaseIntentRefusal {
  const run = (args: readonly string[]): string[] | null => {
    try {
      return execFileSync('git', [...args], { cwd: repoRoot, encoding: 'utf8' })
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    } catch {
      return null;
    }
  };

  if (run(['rev-parse', '--verify', '--quiet', `${since}^{commit}`]) === null) {
    return { reason: `\`${since}\` does not resolve to a commit` };
  }
  if (run(['merge-base', since, 'HEAD']) === null) {
    return { reason: `there is no merge base between HEAD and \`${since}\`` };
  }

  // `--is-ancestor` answers with an exit code, and 1 is an *answer* rather than
  // a failure, so this one cannot go through `run` — which reads every non-zero
  // status as "git could not answer". Anything other than 0 or 1 still is.
  const containment = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', since], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (containment.status !== 0 && containment.status !== 1) {
    return { reason: `\`git merge-base --is-ancestor HEAD ${since}\` failed` };
  }
  const containedInBaseline = containment.status === 0;

  // The diff stays three-dot, which is `merge-base(since, HEAD)..HEAD` — a merge
  // request's own diff, and already the right baseline. It is stated here
  // because "compare against the merge base" is the first repair anyone reaches
  // for on seeing pipeline 11491, and it is a no-op: on a merged branch the
  // merge base *is* HEAD, so the merge base is exactly what produces the empty
  // diff. The fact above is what tells that case from a branch that changes
  // nothing; re-baselining cannot.
  const changedPaths = run(['diff', '--no-renames', '--name-only', `${since}...HEAD`]);
  if (changedPaths === null) return { reason: `\`git diff ${since}...HEAD\` failed` };
  const added = run([
    'diff',
    '--no-renames',
    '--diff-filter=A',
    '--name-only',
    `${since}...HEAD`,
    '--',
    '.changeset',
  ]);
  if (added === null) return { reason: `\`git diff --diff-filter=A ${since}...HEAD\` failed` };
  // `--no-renames` on both halves, and it is not tidiness: without it git folds
  // "a changeset consumed and another written" into one rename — two changeset
  // files differing by a single word are well over the similarity threshold —
  // and the branch's consumption becomes a function of how alike two summaries
  // happen to read. Measured in `test/release/changeset-gate.test.ts`.
  const deleted = run([
    'diff',
    '--no-renames',
    '--diff-filter=D',
    '--name-only',
    `${since}...HEAD`,
    '--',
    '.changeset',
  ]);
  if (deleted === null) return { reason: `\`git diff --diff-filter=D ${since}...HEAD\` failed` };

  const changesetFiles = (paths: readonly string[]): readonly string[] =>
    paths.filter((path) => path.endsWith('.md') && !path.toLowerCase().endsWith('readme.md'));

  return {
    baseline: since,
    containedInBaseline,
    changedPaths,
    addedChangesets: changesetFiles(added),
    deletedChangesets: changesetFiles(deleted),
  };
}

/**
 * Both sides of a file, through git.
 *
 * `git ls-tree` first, because the two answers this reader has to keep apart are
 * *"the ref does not carry this path"* and *"the read failed"*, and `git show`
 * spells both as a non-zero exit with a message on stderr. `ls-tree` answers the
 * first as **exit 0 with no output** and the second as a non-zero exit, which is
 * git's own discrimination and not one inferred from an error string.
 *
 * `git cat-file -e <ref>:<path>` was the obvious reader and is the wrong one,
 * measured: it exits **128** for a path a ref does not carry, exactly as it does
 * for a ref that does not exist. Every changelog the history landing creates has
 * no baseline side, so reading that absence as a failure refused the largest
 * release-shaped branch in this repository's history — which is what it did,
 * here, before this note was written. See {@link SideReader}.
 */
function gitSideReader(repoRoot: string): SideReader {
  return (ref, path) => {
    const listed = spawnSync('git', ['ls-tree', '--name-only', ref, '--', path], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (listed.status !== 0) return null;
    if ((listed.stdout ?? '').trim() === '') return '';
    try {
      return execFileSync('git', ['show', `${ref}:${path}`], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return null;
    }
  };
}

/**
 * `changeset status --since=<baseline>`, spawned.
 *
 * The command is the changesets CLI's own and is byte-for-byte the one
 * `.gitlab-ci.yml` used to run (FR-007); what moved into this file is the
 * *decision* to ask it, which was never the CLI's. The binary is resolved from
 * **this script's** own module graph rather than from `repoRoot`, because
 * `--root` routinely names a synthetic checkout with no `node_modules` — which
 * is how `test/release/changeset-gate.test.ts` drives the gate over real
 * branches — and a resolution that could not answer there would put the whole
 * classification outside that file's reach.
 *
 * `null` is *"it did not run"*, never *"it passed"*: contract §7.4.
 */
function changesetStatusRunner(repoRoot: string): ChangesetStatusRunner {
  return (baseline) => {
    let bin: string;
    try {
      bin = createRequire(import.meta.url).resolve('@changesets/cli/bin.js');
    } catch {
      return null;
    }
    const result = spawnSync(process.execPath, [bin, 'status', `--since=${baseline}`], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (result.error !== undefined || result.status === null) return null;
    return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` };
  };
}

/**
 * The `--print-publish-scope` half of the CLI. Returns the process exit code.
 *
 * **Stdout carries the scope and nothing else**, spelled as `.npmrc` spells it
 * — `@endora-commerce`, leading `@` included — because `publish:packages`
 * captures it in a command substitution and writes it straight into a
 * `<scope>:registry=` line.
 * The disclosure of what was read goes to stderr for the same reason, and the
 * read-size line — which `reportReadSize` prints on stdout — is deliberately not
 * printed here: this mode reports no verdict, and the check's ordinary mode is
 * what `check-read-size.test.ts` spawns.
 */
function reportPublishScope(repoRoot: string): number {
  const inputs = readReleaseIntent(repoRoot, nodeWorkspaceFs(), listDirectoryFiles);
  if ('reason' in inputs) {
    console.error(`${PREFIX} ${inputs.reason}; refusing to name a scope it did not derive.`);
    return 2;
  }

  const resolved = publishScope(inputs.members);
  if (resolved.scope === null) {
    console.error(`${PREFIX} --print-publish-scope: ${resolved.refusal}.`);
    return 2;
  }

  console.error(
    `${PREFIX} --print-publish-scope: @${resolved.scope} ` +
      `(${String(resolved.packages.length)} public of ${String(inputs.members.length)} ` +
      `workspace members: ${resolved.packages.join(', ')})`,
  );
  console.log(`@${resolved.scope}`);
  return 0;
}

/**
 * The `--publish-registry <url>` half of the CLI. Returns the process exit code:
 * 0 when this checkout may go to that registry, 1 when a package declaring its
 * own terms would reach public npmjs, 2 when the checkout or the registry could
 * not be read. Reports no read size, like `--print-publish-scope`: it is a
 * precondition of one job, not the check's verdict.
 */
function reportPublishRegistry(repoRoot: string, registry: string): number {
  const inputs = readReleaseIntent(repoRoot, nodeWorkspaceFs(), listDirectoryFiles);
  if ('reason' in inputs) {
    console.error(`${PREFIX} ${inputs.reason}; refusing to judge a publish it did not read.`);
    return 2;
  }

  const verdict = publicRegistryLicence(inputs.members, registry);
  if (verdict.publicRegistry === null) {
    console.error(`${PREFIX} --publish-registry: ${verdict.refusal}.`);
    return 2;
  }
  // D-267 clause 3, asked beside the licence question and reported with it:
  // both refusals are printed when both hold, so one repair does not uncover
  // the other a run later.
  const exemptions = publicRegistryExemptions(inputs.members, registry);
  const refusals = [verdict.refusal, exemptions.refusal].filter((refusal) => refusal !== '');
  if (refusals.length > 0) {
    for (const refusal of refusals) console.error(`${PREFIX} --publish-registry: ${refusal}.`);
    return 1;
  }
  console.log(
    `${PREFIX} --publish-registry: ${verdict.publicRegistry ? 'public npmjs' : 'not public npmjs'}, ` +
      `${String(verdict.ownLicence.length)} public member(s) declaring \`SEE LICENSE IN\`, ` +
      `${String(exemptions.exempt.length)} private member(s) exempted under D-267` +
      `${exemptions.exempt.length > 0 ? ` (${exemptions.exempt.join(', ')})` : ''} — nothing refused`,
  );
  return 0;
}

/** The `--since` half of the CLI. Returns the process exit code. */
function reportPublishedSurface(repoRoot: string, since: string): number {
  const diff = readBranchDiff(repoRoot, since);
  if ('reason' in diff) {
    console.error(`${PREFIX} ${diff.reason}; refusing to report a verdict it did not measure.`);
    return 2;
  }

  const result = checkBranchIntent(repoRoot, nodeWorkspaceFs(), listDirectoryFiles, diff, {
    readSide: gitSideReader(repoRoot),
    askChangesetStatus: changesetStatusRunner(repoRoot),
  });
  if ('contained' in result) {
    // Loud on stdout rather than a bare exit 0: the verdict is a pass, and a
    // pass nobody can tell from an ordinary one is how "measured nothing" would
    // creep back in through the door this branch opened.
    console.log(`${PREFIX} --since=${since} contained=yes changed=0 violations=0`);
    console.log(`${PREFIX} ${result.contained}`);
    return 0;
  }
  if ('reason' in result) {
    console.error(`${PREFIX} ${result.reason}; refusing to report a verdict it did not measure.`);
    return 2;
  }

  reportReadSize({
    prefix: PREFIX,
    files: result.files,
    sites: result.sites,
    coverage: result.coverage,
  });
  // The classification is printed whatever it is, and the artefact counts with
  // it: a pass that does not say *why* it passed is a pass nobody can tell from
  // one the gate stopped asking for.
  const released = result.artefacts.filter(
    (artefact) => artefact.versionMoved || artefact.changelogSectionAdded,
  );
  console.log(
    `${PREFIX} --since=${since} shape=${result.shape} surfaces=${result.surfaces.length} ` +
      `changed=${diff.changedPaths.length} changesets-added=${diff.addedChangesets.length} ` +
      `changesets-deleted=${diff.deletedChangesets.length} ` +
      `versions-moved=${result.artefacts.filter((a) => a.versionMoved).length} ` +
      `changelog-sections=${result.artefacts.filter((a) => a.changelogSectionAdded).length} ` +
      `released=${released.length} violations=${result.findings.length}`,
  );

  if (result.findings.length > 0) {
    console.error(
      '\nThis branch is refused. Each finding below is a question `changeset status` either ' +
        'answered or structurally cannot ask:',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.subject} ${finding.message}`);
    }
  }

  return result.findings.length === 0 ? 0 : 1;
}

function main(): void {
  const rootFlag = process.argv.indexOf('--root');
  const repoRoot =
    rootFlag >= 0 && process.argv[rootFlag + 1] !== undefined
      ? process.argv[rootFlag + 1]!
      : fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');

  if (process.argv.includes('--print-publish-scope')) {
    const code = reportPublishScope(repoRoot);
    // Not `process.exit(0)`: this mode's stdout is read through a pipe, and
    // exiting while a pipe write is still buffered truncates it. A refusal has
    // nothing on stdout to lose.
    if (code !== 0) process.exit(code);
    return;
  }

  const registryFlag = process.argv.indexOf('--publish-registry');
  if (registryFlag >= 0) {
    const registry = process.argv[registryFlag + 1];
    if (registry === undefined || registry.startsWith('--')) {
      console.error(`${PREFIX} \`--publish-registry\` needs a URL; refusing to judge a publish it cannot name.`);
      process.exit(2);
    }
    process.exit(reportPublishRegistry(repoRoot, registry));
  }

  const sinceFlag = process.argv.indexOf('--since');
  if (sinceFlag >= 0) {
    const since = process.argv[sinceFlag + 1];
    if (since === undefined || since.startsWith('--')) {
      console.error(`${PREFIX} \`--since\` needs a ref; refusing to report a verdict it did not measure.`);
      process.exit(2);
    }
    process.exit(reportPublishedSurface(repoRoot, since));
  }

  const result = checkReleaseIntent(repoRoot, nodeWorkspaceFs(), listDirectoryFiles);
  if ('reason' in result) {
    console.error(`${PREFIX} ${result.reason}; refusing to report a verdict it did not measure.`);
    process.exit(2);
  }

  reportReadSize({
    prefix: PREFIX,
    files: result.inputs.files,
    sites: result.sites,
    coverage: result.coverage,
  });
  const versionable = result.inputs.members.filter((member) => member.family).length;
  // R3's own census, printed **per class including the zeros** — §4(d) of
  // `specs/conventions/commercial-data.md` is a rule, not advice: a class a
  // measurement did not scan for is reported as a zero indistinguishable from a
  // real one, so a report that printed only the classes with a hit would be the
  // exact failure that rule exists about. `prose-lines` is what the scan read
  // and belongs on the same line for the same reason `files=` does.
  //
  // It is deliberately **not** folded into `sites`: the changeset population
  // follows the release cycle rather than the tree, and a ±band cannot bound a
  // quantity that oscillates in both directions (!966's measurement, over this
  // very population).
  const prose = result.inputs.documents
    .filter((document) => document.file !== 'README.md')
    .map((document) => scanCommercialVocabulary(document.body));
  const proseLines = prose.reduce((sum, scan) => sum + scan.lines, 0);
  const clearedCount = prose.reduce((sum, scan) => sum + scan.cleared.length, 0);
  const merged: VocabularyScan = {
    hits: prose.flatMap((scan) => scan.hits),
    cleared: prose.flatMap((scan) => scan.cleared),
    staleClearances: prose.flatMap((scan) => scan.staleClearances),
    lines: proseLines,
    perClass: {
      C1: prose.reduce((sum, scan) => sum + scan.perClass.C1, 0),
      C2: prose.reduce((sum, scan) => sum + scan.perClass.C2, 0),
      C3: prose.reduce((sum, scan) => sum + scan.perClass.C3, 0),
      C4: prose.reduce((sum, scan) => sum + scan.perClass.C4, 0),
    },
  };
  console.log(
    `${PREFIX} versionable=${versionable} ignored=${result.inputs.members.length - versionable} ` +
      `changesets=${result.inputs.changesets.length} prose-lines=${proseLines} ` +
      `${perClassToken(merged)} cleared=${clearedCount} ` +
      `violations=${result.findings.length}`,
  );
  console.log(publicationExemptionLine(publicationExemptions(result.inputs.members)));

  if (result.findings.length > 0) {
    console.error(
      '\nThe release-intent gate would stop asking. Every finding below produces `exit 0` ' +
        'from `changeset status`, which is byte-identical to a clean branch:',
    );
    for (const finding of result.findings) {
      console.error(`  - [${finding.kind}] ${finding.subject} ${finding.message}`);
    }
  }

  process.exit(result.findings.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module from a test must not scan and exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
