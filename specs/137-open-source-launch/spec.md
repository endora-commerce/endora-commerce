# Feature Specification: the open-source launch — from a private canonical repository to a public release

**Feature directory**: `specs/137-open-source-launch/`
**Created**: 2026-09-29
**Status**: Tracking — the work is defined elsewhere and continued here
**Input**: the rows the migration left open[^d283-43], restated in the repository where their
pull requests land.

## 0. What this feature is, and what it is not

The repository you are reading was published from the project's historical GitLab repository on
2026-09-29 (commit `59a212961`)[^t031]. The design work that led here — the migration itself, the
licence, the publication programme — was written before that cut and stays in the historical
repository; you will meet it only as footnotes. That is deliberate: `CONTRIBUTING.md` says why,
and `specs/conventions/` and the constitution are what a change here is judged against.

A task list is ticked **in the same pull request as its code**, and the code now lands here. A
pull request on GitHub cannot tick a file on GitLab, so every row the migration left open is
restated in this directory, with a footnote naming the row it came from. The origin rows are not
ticked again.

**This feature designs nothing new.** Every row below was decided before it arrived here; the
decision is cited, not repeated. Where a row's text changed on the way, the change is stated.
It rules nothing either: no `D-nnn` is allocated by this directory.

**Out of scope, and where it lives instead:**

- The paid tier's own work — its packages, its CI, its demonstration deployment — is tracked in
  the paid repository's `specs/`[^d283-43]. This repository does not name or link that
  deployment[^fr107].
- The private design record (the defect register, session notes) moves to a private project of
  its own and is not described here beyond the rows that close the historical repository.

## User Scenarios & Testing

### User Story 1 — a stranger finds a public repository whose promises hold (Priority: P1)

The repository becomes public before its protection can exist: on the organisation's plan, branch
protection, private vulnerability reporting and reviewer-gated environments are refused while the
repository is private[^d282]. So the visibility flips first, and the settings that make
`SECURITY.md` and `CONTRIBUTING.md` § *Governance* true follow in one sitting.

**Independent test**: signed out, open the repository's *Security* tab and see *Report a
vulnerability*; open any merged pull request after the sitting and see every required check green
and a maintainer's approval.

**Acceptance scenarios**:

1. **Given** the repository has just become public, **When** a signed-out visitor opens the
   *Security* tab, **Then** it offers *Report a vulnerability* — verified before the repository is
   linked or announced anywhere.
2. **Given** protection is on, **When** a pull request has a red required check or no approving
   review, **Then** it cannot merge — for an administrator too.
3. **Given** `master` goes red on GitHub, **When** the run finishes, **Then** a named person is
   notified.

### User Story 2 — a stranger installs Endora Commerce from the public registry (Priority: P1)

**Independent test**: on a machine with no `.npmrc`, `npx create-endora-commerce@latest` resolves
`0.100.0` from `registry.npmjs.org`, each package carries a provenance attestation that names this
repository, and each package's *Repository* link opens.

**Acceptance scenarios**:

1. **Given** `0.100.0` is published, **When** a stranger runs the documented install, **Then** it
   resolves from npmjs alone and the scaffolded instance builds.
2. **Given** any published package, **When** its *Repository* link is opened, **Then** it opens this
   repository, not a host a stranger cannot reach.
3. **Given** the first public release, **When** the public-mode acceptance run executes on a
   GitHub-hosted runner with no registry configuration, **Then** it is green.

### User Story 3 — an old citation still resolves (Priority: P2)

**Independent test**: take a nine-character commit id from a published commit message and find
its counterpart here, or learn that it touched only unpublished paths.

**Acceptance scenario**: **Given** `specs/pre-migration-history/`, **When** a reader greps the
commit map for `^<id>`, **Then** they get the commit here that carries the same change, or a
null id meaning the commit has no counterpart[^t032].

### User Story 4 — every gate runs on one host (Priority: P2)

GitLab ran 23 jobs; on migration day the canonical repository carried five on Actions. The
remainder are ported, dispositioned or retired inside a 28-day window whose day 0 is
2026-09-29[^window].

**Acceptance scenario**: **Given** 2026-10-27, **When** the estate is read, **Then**
`.gitlab-ci.yml` is gone from this repository and every job it held either runs on Actions or has a
written disposition.

### User Story 5 — anybody can see the free product running (Priority: P3)

**Acceptance scenario**: **Given** the open-source demo's first deploy is verified, **When** a
visitor follows the front page's demo link, **Then** it opens a deployment built from this
repository's `master` running the free module set[^w710].

### Edge cases

- **The window between the flip and the sitting.** From F1 to F2, `SECURITY.md` says a channel is
  enabled that is not; from F1 to F4, `CONTRIBUTING.md` says merges need green required checks that
  are not yet required. The gap is bounded by the sitting, not by a temporary note: a note added
  and removed would be two merges, the second in the one interval with no protection. **The
  condition that makes the bound honest: nobody links to or announces the repository before F2 is
  verified**[^d283-6].
- **The install commands before the first release.** `README.md` § *Quick start* and
  `docs/docs/getting-started.md` already say the packages are not on npmjs yet and route to the
  from-a-clone path, which works today. Nothing to change[^d283-6].
- **A free-package fix needed by a consumer before `0.100.0`.** It waits for `0.100.0`: no free
  package is released to any other registry before it[^d283-c].

## Requirements

### Functional requirements

- **FR-001** — The visibility flips before protection, environments and publication, and after
  every item that can be done while private[^d282].
- **FR-002** — Immediately after the flip, in one sitting, in order: private vulnerability
  reporting verified signed-out; Actions confirmed; protection with required checks, binding
  administrators; the two environments; red-`master` notification[^d283-5].
- **FR-003** — `master` MUST be protected: a pull request, one approving review through
  `CODEOWNERS`, the required checks `quality`, `quality:static`, `test:backend:unit`,
  `test:frontend`, `release:changeset` and `dco`, force-push and deletion blocked, sign-off
  required on web commits, first-time fork contributors' workflows needing approval, and **no
  bypass for administrators**[^t033].
- **FR-004** — Every published package's `repository.url` MUST name this repository before any of
  them is published to npmjs[^t050].
- **FR-005** — `0.100.0` MUST be published through `.github/workflows/publish.yml` with
  provenance, from the public repository, after `pack-gate` runs on Actions and after the
  provenance probe[^t052].
- **FR-006** — The `create-endora-commerce@0.0.1` placeholder MUST be deprecated once a real
  version exists[^d267].
- **FR-007** — After `0.100.0`, the free packages MUST resolve for a consumer from npmjs, and the
  paid packages MUST NOT resolve for a credential without access to them[^w43].
- **FR-008** — Publishing MUST move from a stored token to npm trusted publishing after the first
  release, and the token MUST be revoked once trusted publishing has carried one release[^n11].
- **FR-009** — By 2026-10-27, `.gitlab-ci.yml` MUST be gone from this repository, with every job it
  held run on Actions or dispositioned in writing[^t045].
- **FR-010** — The documentation site MUST have a delivery path from this repository before the
  documentation needs to describe `0.100.0`[^t046b].
- **FR-011** — The stranger-actionable subset of known defects MUST be opened as issues here by a
  manual, reviewable command, never by a scheduled job[^t060].
- **FR-012** — Every file this feature adds MUST pass the disclosure gate,
  `specs/conventions/commercial-data.md`, reported class by class.

### Key entities

- **Origin row** — a task in a pre-migration feature directory. Cited here by its feature number
  and row id in a footnote; never restated with a cost figure.
- **The sitting** — F1 to F6, performed by one person without interruption.

## Success criteria

- **SC-001** — A signed-out visitor can report a vulnerability through the *Security* tab, and was
  able to before the repository was linked from anywhere.
- **SC-002** — No pull request merged after F4 lacks a green required check or an approval.
- **SC-003** — On a clean machine with no registry configuration, the documented install of
  `0.100.0` produces a building instance, and every package's provenance names this repository.
- **SC-004** — On 2026-10-27 this repository holds no `.gitlab-ci.yml`.
- **SC-005** — Every row in `tasks.md` is ticked or carries a written disposition, and no origin row
  was ticked in the historical repository after 2026-09-29.

## Assumptions

- The organisation stays on its current plan; the order in FR-001 exists because of it[^d282].
- Environments with a required reviewer are available once public. Not measured while private;
  F5 is where it is confirmed[^d282].

---

[^d283-43]: D-283 §4.3 — the rule that the open rows continue in this directory, and that the
    paid-repository rows continue there. D-283 and D-282 are the last two rulings of the private
    record; the public series continues at D-284 (see `CONTRIBUTING.md` § *Governance*).
[^t031]: 129 T031 — `specs/129-github-canonical-migration/tasks.md`, with its record in D-283 §1.
[^fr107]: 136 FR-107 — `specs/136-open-source-publication/spec.md`.
[^d282]: D-282 — the flip precedes protection, publication and the switchover; amends 129 T033 and
    136 plan W6.6.
[^t032]: 129 T032, decided by D-283 §2 and §4.6.
[^window]: 129 T040 and its `contracts/gate-window.md`, which closes the window at day 0 + 28 with T045; D-283 §5 set day 0.
[^w710]: 136 plan W7.10; D-274, as amended by D-279 and D-280.
[^d283-6]: D-283 §6 — what the public tree promises that is false while the repository is public
    and the packages are not.
[^d283-c]: D-283, owner answer C (2026-09-29).
[^d283-5]: D-283 §5 and its owner answers of 2026-09-29.
[^t033]: 129 T033 as amended by D-282; D-283 §5 F4 and owner answer E; the `dco` check is 136 O-7.
[^t050]: 129 T050; D-242 step 5; D-283 §4.5 and owner answer B.
[^t052]: 129 T051 and T052; 123 T7-A … T7-D2; T042b's `pack-gate` precondition.
[^d267]: D-267.
[^w43]: 136 plan W4.3 and W4.4; 136 FR-030 … FR-032.
[^n11]: D-283, owner answer D and §5 N11.
[^t045]: 129 T045 as corrected by D-283 §5.
[^t046b]: 129 T046b, added by D-283 §5.
[^t060]: 129 T060; D-243.
