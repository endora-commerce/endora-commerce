# Tasks: the open-source launch

**Input**: [spec.md](spec.md), [plan.md](plan.md)
**State as of**: 2026-09-30 — the repository is public

## Format

`- [ ] **ID** (hands) description` — *hands*: **O** owner, **A** architect, **D** developer.
The id is the origin row's own (`T0nn` from the migration feature, `Wn.n` from the publication
feature) or, for a row that had none, the sequencing label D-283 §5 gave it (`Pn`, `Fn`, `Nn`)
— plan decision 1. The scaffold defects keep the `S1`–`S6` labels of the private register they
are recorded in. The footnote on each row names where it came from; those records are private
and the footnote is provenance, not a link. A row is ticked in the pull request that does it; a
row whose work is a setting is ticked by the next pull request after it, citing how it was
verified.

---

## Done before this directory

- [x] **T031** (O) The history pushed to this repository while private: `master` =
  `59a212961`, no tag[^t031].
- [x] **T035** (D) The published floor made green — `check:root-dispositions` retired, read sizes
  re-recorded, the two tests that read unpublished files given a subject here, the Docker probe
  made to hold on a hosted runner. Pull request #4[^t035].

---

## Phase A — before the flip, while private

Pull requests here merged with no branch protection behind them: the owner merged on an explicit
*ready* with every check green, as before the migration.

- [x] **T032** (D, then O) `specs/pre-migration-history/`: the commit map, byte-identical to the
  migration's artefact, its `README.md` and the two numbering floors; the `CONTRIBUTING.md`
  sentence; `create-new-feature.sh` reading the feature floor. Pull request #7[^t032].
- [x] **P4** (A, then O) This directory[^d283-43].
- [x] **T050** (D, then O) Every published package's `repository.url` names this repository, with
  its changeset, landed ahead of N4. Pull request #8[^t050].
- [x] **S2** (D, then O) A scaffolded storefront's `.gitignore` ignores `.env`, `node_modules` and
  `.next`. Pull request #5[^cli].
- [x] **S3** (D, then O) The storefront scaffold declares every package its vendored ESLint
  configuration imports. Pull request #9[^cli].
- [x] **S4** — **not a defect** (alias load-bearing): the admin `tsconfig`'s `@/*` alias did not
  reproduce as a defect; `endora generate` depends on it. No fix[^cli].
- [x] **S5** (D, then O) The rendered worker's `shutdown` uses the `signal` it receives. Pull
  request #9[^cli].
- [x] **S6** (D, then O) `NEWSLETTER_TOKEN_SECRET` reaches the backend in the deploy compose
  examples. Pull request #9[^cli].
- [x] **Unnumbered** (D, then O) Two further defects fixed in pull request #9: the vendored ESLint
  configuration was written to the storefront's own `eslint.config.js` path and replaced it; and an
  empty `NEWSLETTER_TOKEN_SECRET` line crashed the backend at boot.
- [x] **S1** — **not a defect** (exact pin by design; owner, 2026-09-30): the scaffold pins
  `@endora-commerce/contracts` to an exact version. Every release publishes all 71 packages in
  lockstep at one number, so the exact pin always names a version that exists beside the rest of
  the set, and a caret range could install a second copy of `contracts` next to the one the
  platform packages pin exactly. No fix, and no longer a precondition of N4[^cli].
- [x] **P7** (O) The repository variables `.github/workflows/demo.yml` reads — `API_DOMAIN`,
  `STOREFRONT_DOMAIN`, `SALES_CHANNEL_CODE`, `DEFAULT_LOCALE` — set; verified 2026-09-30 by
  reading `actions/variables`[^p7].
- [ ] **P8** (O) The historical repository's scheduled pipelines paused, and its project description
  saying it is historical[^p8].
- [x] **P9** (O) The private records project exists[^p9].
- **Standing, until F4:** Dependabot pull requests #1–#3 stayed unmerged. F4 is done; they are
  ordinary pull requests under the ruleset now[^dependabot].

---

## Phase B — the sitting: immediately after the flip

**Nobody links to or announces the repository before F2 is verified**[^d283-6].

- [x] **F1** (O) Visibility → public, 2026-09-30[^d282].
- [x] **F2** (O) Private vulnerability reporting on — `private-vulnerability-reporting` answers
  `enabled: true` (read 2026-09-30), and the owner confirmed from a signed-out browser that the
  *Security* tab offers *Report a vulnerability*, which is what `SECURITY.md` says. Part of
  **W6.6**[^f2].
- [x] **F3** (O, or A/D reading the API) Actions on the public repository: `gh workflow list --all`
  lists all seven files — `quality`, `dco`, `demo`, `pack-gate`, `boot-gate`, `publish`,
  `acceptance-public` — the last two registered by pull request #12, which also replaced the
  `SETTINGS_SECRET_ENCRYPTION_KEY` placeholder in the environment examples. `quality` is green on
  `master`'s head `129a5afa3` (read 2026-09-30)[^d283-5].
- [x] **F4 = T033** (O) A ruleset on `master`: a pull request is required; required status checks
  `quality`, `quality:static`, `test:backend:unit`, `test:frontend`, `release:changeset` and `dco`;
  merge commits only; deletion and force-push blocked; **no bypass actor**, administrators
  included. A second ruleset on `release/version-*` and `support/v*` blocks deletion and
  force-push. Verified 2026-09-30 by reading `rulesets`. Completes **W6.6**[^t033].
  **Deviation, recorded:** **0 required approvals**, not one through `CODEOWNERS` — the owner is the
  sole maintainer and cannot approve his own pull request, so a required approval would stop every
  merge. Repository settings beside the ruleset, confirmed by the owner: *Require contributors to
  sign off on web-based commits* is on (`web_commit_signoff_required: true`), and fork pull-request
  workflows use *Require approval for all external contributors* — stricter than the first-time
  contributors D-283 asked for.
- [ ] **F4b** (O) Raise the `master` ruleset to **one approving review, code-owner review
  required**, when a second maintainer joins. Until then `CONTRIBUTING.md` § *Governance*'s
  *"only after a maintainer's review"* holds only for pull requests the owner did not open.
- [x] **F5** (O) Environments, verified 2026-09-30 by reading `environments`:
  - `npm-publish` (from T041): a required reviewer; deployment branches `master` and
    `release/version-*`; variable `ENDORA_NPM_REGISTRY`; secret `ENDORA_NPM_TOKEN`, a **granular**
    token scoped to the `@endora-commerce` packages and `create-endora-commerce`, with no
    organisation access.
  - `demo`: a required reviewer; deployment branch `master`; the five secrets `demo.yml` reads.
  - The container packages `backend`, `storefront` and `admin` are public, and the organisation's
    policy allows public packages; an anonymous pull token lists their tags (read 2026-09-30).
  Reviewer-gated environments do exist on the public repository, confirming the one premise D-282
  left unmeasured[^f5].
- [ ] **F6 = T047** (O) Somebody is notified when `master` goes red on GitHub — the owner's watch
  and notification settings. The historical repository's failed-pipeline notification was a
  project setting and did not travel[^t047].
- [x] **L1** (D, then O) The copyright line reads *"Endora sp. z o.o. and the Endora Commerce
  contributors"* now that contributions arrive from outside. Pull request #13.
  - [ ] The documentation site's footer reads *"© 2026 Endora Commerce"*. **In progress**, as a
    separate documentation pull request.
- [x] **B1** (D, then O) `docs/docs/deployment/first-deployment-checklist.md` § B1 describes each
  secret as the code reads it — how to generate it, and what an empty or wrong value does — in
  English and Polish, after #9 and #12 changed the environment examples. Pull request #14.

---

## Phase C — publication, in this order

- [x] **N1 = T042b**, part (D) `pack-gate` and `boot-gate` on Actions, ahead of N4. Pull request
  #10[^t042b].
- [ ] **N1b = T042b**, rest (D) `build:docs` on Actions, by **2026-10-06**. It reads
  `specs/133-docs-site-publication/url-inventory.txt`, a pre-migration file this repository does not
  hold; it is published here under D-247's option A — cleaned against the definition — in the same
  pull request as the job[^t042b].
- [ ] **N2 = T051** (D prepares, O dispatches) The provenance probe on the public repository. A
  throwaway rehearsal of `publish.yml`; it leaves nothing in the tree. Needs F3[^t051].
- [x] **N3** (D) The pull request that takes `create-endora-commerce` out of `private` and makes
  `check:release-intent --publish-registry` accept an unscoped name on the npmjs target[^d267].
  The scope rules take a target: the default mode judges public npmjs, which serves an unscoped
  name, so the D-267 exemption computes to nothing; a registry that is not public npmjs refuses an
  unscoped member; `publish.yml` hands its registry to `--print-publish-scope` and names the
  default registry for the unscoped front door. **Landed ahead of N2**: nothing it changes
  publishes, and N4 still waits on N2.
- [ ] **N4 = T052** (D prepares, O dispatches and approves `npm-publish`) `0.100.0` with provenance,
  through `.github/workflows/publish.yml`. **Do not skip the fail-closed dry step**: it is the only
  thing between a misconfiguration and a permanently spent version. Precondition: N1, N2, N3,
  F3 (S1 was closed as by design on 2026-09-30)[^t052].
- [ ] **N5** (O) Deprecate the `create-endora-commerce@0.0.1` placeholder; the other reserved
  names stay reserved[^d267].
- [ ] **N6 = W5.5** (O dispatches) The first `public`-mode acceptance run against `0.100.0` on a
  GitHub-hosted runner with no registry configuration; then nightly and on every release; then the
  `next` → `latest` promotion[^w55].
- [ ] **N7 = W4.3 + W4.4** (O, D) The free packages leave the private registry's namespace, so a
  consumer resolves them from npmjs. Verified with an authenticated probe: a free name forwards to
  npmjs, a paid name is refused without forwarding for a credential that cannot read it. The paid
  repository's consumers re-resolve against the result; that half is tracked there[^w43].
- [ ] **N8 = T060** (D, O approves the artefact) The manual command that opens the
  stranger-actionable subset of known defects as issues here. Local, reviewable, producing an
  artefact a human approves; **never a CI job, never scheduled**[^t060].
- [ ] **N11** (D, then O) Trusted publishing: a pull request changing `publish.yml`'s token guard;
  the trusted publisher configured on npmjs; `ENDORA_NPM_TOKEN` revoked once trusted publishing has
  carried one release. **Hard deadline: before npm ends publishing with a stored token, relayed as
  January 2027** — re-read npm's own notice for the date before planning against it[^n11].

---

## Phase D — the CI window (day 0 = 2026-09-29), alongside Phase C

- [ ] **T043** (D) **By 2026-10-13.** The service-bound suites on Actions: `test:backend` (five
  shards), `test:backend:deployment`, `acceptance:package-schema`, `test:kit`,
  `acceptance:storefront-scaffold`, `acceptance:instance`, `conformance:storefront`. The
  `pull_request` trigger is present from the day each workflow is written. If the runner answer
  turns out to be one shared machine again, skipping these suites on pull requests has to be
  re-ruled by the owner, publicly, not carried across by silence[^t043].
- [ ] **T043p** (D) **By 2026-10-20, or the jobs stay off with a written disposition.** `perf:backend`,
  `perf:backend:heavy`, `perf:storefront`. Their budgets are absolute wall-clock figures calibrated
  on one machine class: decide the machine, re-baseline, record the machine beside the number,
  then wire the job. Never a guessed budget[^t043p].
- [ ] **T045 + T044 + W7.11** (D) **By 2026-10-27.** Remove `.gitlab-ci.yml` from this repository
  entirely. Every job it held runs on Actions or carries a written disposition (`build:backend`,
  `build:storefront` and `build:admin`: *moved to `.github/workflows/demo.yml`*). The test files
  that assert on it are re-pointed in the same change — **add on GitHub before removing on
  GitLab**, and `instance-build-inputs.test.ts` reads `demo.yml`. The one-time history scripts
  `public-history-filter.ts` and `pre-publication-scan.ts` may retire here too[^t045].
- [ ] **T046b** (O decides, D builds) The documentation site's delivery from this repository. It was
  a GitLab job with no Actions twin, so the published site is frozen at its last GitLab publish. An
  environment with a required reviewer, as for `demo`. **Before the documentation needs to describe
  `0.100.0`** — in practice before N4[^t046b].

---

## Phase E — the open-source demo

- [ ] **W7.9** (O) The paid tier's demonstration goes live from the paid repository, and the
  deployment the `demo.` names serve today is retired. Tracked there; listed here only because
  W7.10's first deploy is ordered after it on the shared host[^fr107].
- [ ] **W7.10** (O, D) The first deploy through `.github/workflows/demo.yml` — its **O-e** half
  (F5) and P7 are done — after the first green `demo.yml` build. Then verification over
  loopback, then the `demo.` names switched to it, then the front page links it[^w710].
  **O-a is answered (owner, 2026-09-29): the demo runs on a host that already serves other
  deployments.** No address or hostname goes into this repository. What follows from it:
  - **Switching the `demo.` names is a reverse-proxy upstream change on that host**, with no DNS
    move and no certificate transfer: the names already resolve there and their certificates are
    already served from there (measured 2026-09-29). Rollback is reverting the upstreams.
    *Premise to verify on the host before relying on it:* the reverse proxy there reaches a stack
    through the loopback binds `deploy/compose.prod.yml` publishes.
  - **The stack is a separate compose project on that host** — which `deploy/compose.prod.yml`
    was written to allow (no `container_name`, no external network): project `endora-demo`, which
    `demo.yml` already passes as `-p`; its own `DEPLOY_PATH`; its own `.env` from
    `deploy/.env.prod.example`, with fresh secrets, the `demo.` names and **`*_HOST_PORT` binds
    distinct from every other stack on the host** — never the file's defaults, which a stack
    already on the host may hold or take back on a rollback; its own deploy user and SSH key.
    **`demo.yml` does not change.**
  - **The deploy key is root-equivalent on the whole host**, because its user runs Docker. A user
    and key of its own give revocation and attribution, not isolation; the owner accepted that
    exposure with this answer.
  - **The first `demo:deploy` is approved only once the host has measured room** for every stack
    that will run beside it at that moment, at `deploy/README.md`'s per-stack floor. What stops
    first, and when, is recorded privately with the other deployments' plans.

---

## Phase F — closing the historical repository (private records; outcomes only)

- [x] **P6** (A) The origin rows marked *continued in `specs/137-open-source-launch/`* in the
  historical repository[^d283-43].
- [x] **N9** (A) The private records project seeded, and the historical repository's record bridge
  closed by its last record-only merge, 2026-09-30[^n9].
- [ ] **N10** (O) **By 2026-10-27, after N9.** Archive the historical repository[^n9].

---

## Dependencies

```
done: T031 T035 T032 T050 S2 S3 S5 S6 (S4 not a defect) P4 P6 P7 P9 F1 F2 F3 F4 F5 L1 B1 N1(pack-gate, boot-gate) N9
open, in order:
  F6 (T047) · L1's documentation footer
  N1b build:docs (10-06) → N2 (T051) → N3 → N4 (T052) → N5 → N6 (W5.5) → N7 (W4.3/W4.4) → N8 (T060)
  T046b → N4 (in practice)                   (S1 closed as by design, 2026-09-30)
  N4 → N11 (before npm ends stored-token publishing)
  T043 (10-13), T043p (10-20), T045 + T044 + W7.11 (10-27)          independent of Phase C
  W7.9 + first demo.yml build + host capacity confirmed → W7.10
  N10 (10-27)          F4b when a second maintainer joins
```

---

[^t031]: 129 T031; its full record is D-283 §1.
[^t035]: 129 T035, added by D-283 §4.7.
[^t032]: 129 T032; D-283 §2 and §4.6; D-283 §5 P3.
[^d283-43]: D-283 §4.3 and §5 P4, P6.
[^t050]: 129 T050; D-242 step 5; D-283 §4.5 and §5 P5; owner answer B of 2026-09-29.
[^cli]: D-283 §4.5 names the class and counts six; the entries, `S1`–`S6`, were recorded through
    the historical repository's record bridge on 2026-09-29.
[^p7]: D-283 §5 P7; D-280, amending D-274 O-e.
[^p8]: D-283 §3 and §5 P8.
[^p9]: D-283, owner answer A of 2026-09-29, and §5 P9.
[^dependabot]: D-283 §5, the row marked *not before the flip*.
[^d283-6]: D-283 §6.
[^d282]: D-282.
[^f2]: D-283 §5 F2; 129 T033; 136 plan W6.6.
[^d283-5]: D-283 §5 F3.
[^t033]: 129 T033 as amended by D-282; D-283 §5 F4 and owner answer E; 136 O-7 for `dco`; 136 plan
    W6.6.
[^f5]: D-283 §5 F5 and owner answer D; 129 T041; D-274 O-e as amended by D-280; D-282 fact 4.
[^t047]: 129 T047; D-283 §5 F6.
[^t042b]: 129 T042b; D-283 §5 N1.
[^t051]: 129 T051; 123 T6a-A; D-283 §5 N2.
[^d267]: D-267; D-283 §5 N3 and N5.
[^t052]: 129 T052; 123 T7-A … T7-D2 (the dry step is T7-D1); D-283 §5 N4.
[^w55]: 136 plan W5.5; 136 FR-070, FR-071; D-283 §5 N6.
[^w43]: 136 plan W4.3, W4.4; 136 FR-030 … FR-032; D-283 §5 N7. The paid-repository half is 136
    W7.12.
[^t060]: 129 T060; D-243; D-283 §5 N8.
[^n11]: D-283, owner answer D, and §5 N11.
[^t043]: 129 T043; 129 `contracts/gate-window.md` §6 on the suspension that was not carried
    across.
[^t043p]: 129 T043p.
[^t045]: 129 T044, T045 as corrected by D-283 §5; 136 plan W7.11; D-274; D-283 §4.7 on the two
    one-time scripts.
[^t046b]: 129 T046b, added by D-283 §5; 129 T046 as decided by D-274.
[^w710]: 136 plan W7.10; D-274 O-a, O-e; D-279 clause 3 (the same-host branch of P3) and its
    owner answer to O-a of 2026-09-29; D-280.
[^fr107]: 136 FR-107; D-274.
[^n9]: D-283, owner answer A of 2026-09-29, and §5 N9, N10.
