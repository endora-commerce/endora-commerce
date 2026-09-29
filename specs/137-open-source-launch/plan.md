# Implementation Plan: the open-source launch

**Directory**: `specs/137-open-source-launch/` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

## Summary

A tracking feature. It carries the rows the migration left open into the repository where their
pull requests land, and fixes the order they run in. The order is split at the visibility flip:
what can be done while private first, then a single sitting that makes the public repository's
promises true, then publication, with the CI window's deadlines running alongside. Every row was
decided before it arrived here; `tasks.md` holds the rows and a footnote per row naming its
origin.

## Technical Context

**Language/Version**: none of its own — the rows touch GitHub settings, `.github/workflows/`,
package manifests and the release flow already in the tree
**Primary Dependencies**: no new dependency
**Storage**: n/a
**Testing**: each row that changes code carries its own red-first test in its own pull request; the
settings rows are verified by reading the GitHub API or, for F2, a signed-out browser
**Target Platform**: `github.com/endora-commerce/endora-commerce`, GitHub-hosted runners, npmjs
**Constraints**: the organisation's plan refuses protection, private vulnerability reporting and
reviewer-gated environments on a private repository[^d282]; the CI window closes on 2026-10-27

## Decisions

1. **Row ids are the origin ids, not a new series.** A row keeps the id it had — `T033`, `W5.5` —
   and rows that had none take the sequencing label D-283 §5 gave them (`P7`, `F2`, `N11`).
   *Rationale*: those ids are what every pull request, commit message and footnote already cites;
   a renumbering would break each of them to buy uniqueness nothing needs. The ids cannot collide:
   the two origin features used `T0nn` and `Wn.n`, and D-283 used `Pn`, `Fn` and `Nn`. The one
   group with no label anywhere — the five scaffold defects — takes `S1`–`S5`, this directory's own.
   *Rejected*: a fresh `T001…` series with the origin id in a column — it makes every existing
   citation resolve through a lookup table.
2. **No cost figure travels with a row.** The origin rows carried effort estimates; a forward
   estimate is class C1 of `specs/conventions/commercial-data.md` and is dropped, not rephrased.
   Deadlines that are engineering bounds — the CI window's day 0 + 14/21/28 — are kept.
3. **Rows about private records are tracked here as outcomes, not contents.** Closing the
   historical repository (seeding the private records project, the last record-only merge, the
   archive) is the owner's and the architect's work on another host. It is listed so the deadline
   is visible where the rest of the launch is tracked, and it is ticked here when done, with no
   description of what those records hold.
4. **`T044` rides with `T045`.** D-283 corrected T045 to remove `.gitlab-ci.yml` entirely rather
   than keep jobs for an exception that no longer exists; the 20 test files that assert on it are
   re-pointed in that change, so T044's *"a second source for `readJobs()`, once"* happens there
   or not at all.
5. **`T046` is decided and has no row of its own.** D-274 chose an environment with a required
   reviewer for the open-source demo; its canonical-repository half is `F5`'s `demo` environment
   and `W7.10`. T046b — the documentation site's delivery — is the part still open.

## Order

```
done        T031 push (59a212961)   T035 floor green (#4)   storefront .gitignore (#5)

before the flip (private)
            T032 commit map (in progress)   137 (this directory)
            T050 repository.url — may land here; must land before T052
            P7 demo variables   P8 GitLab schedule paused   P9 private records project (exists)
            hold: Dependabot #1–#3 until F4

the sitting — one person, uninterrupted, in order
            F1 public → F2 reporting, verified signed-out → F3 Actions confirmed, quality green
            → F4 T033 protection (binding admins) → F5 npm-publish + demo environments → F6 T047

then        N1 T042b pack-gate → N2 T051 → N3 D-267 flip → N4 T052 0.100.0
            → N5 deprecate 0.0.1 → N6 W5.5 → N7 W4.3/W4.4 → N8 T060 → N11 trusted publishing

alongside   T043 by 10-13 · T043p by 10-20 · T045 (with T044, W7.11) by 10-27
            N9 seed private records + N10 archive the historical repository by 10-27
            T046b before the docs describe 0.100.0 · CLI scaffold fixes before N4 where on
            a first-install path · W7.10 after O-e, P7, the first demo.yml build and the
            shared host's capacity confirmed (O-a answered 2026-09-29)
```

**Why this order.** The flip is first among the settings because the plan leaves no other choice
(D-282). Publication follows the flip because a package whose *Repository* link or provenance
points at a private repository is exactly what the migration was ordered first to prevent (D-242,
reason 1). `pack-gate` precedes `0.100.0` whatever the calendar says, because a mis-packed tarball
is a permanently spent version.

## Open questions

- **[NEEDS CLARIFICATION]** Which of the four open scaffold defects touch the path a stranger's
  first install takes, and so must land before N4? The records hold the defects but not that
  classification; it is answered per defect in its pull request.
- **[NEEDS CLARIFICATION]** Whether T050 lands before or after the flip. Either satisfies FR-004;
  the owner chooses. Before is preferred — seventy-odd manifests stop naming a host a stranger
  cannot open on the day they become visible.

- **[NEEDS CLARIFICATION]** Whether the reverse proxy on the demo's host reaches a stack through
  loopback binds, which is what makes W7.10's switch a proxy reload (tasks.md, Phase E). The owner
  verifies it on the host; if it does not, the binds or the proxy change before the first deploy,
  not after.

## Constitution Check

| Principle | Verdict |
| --- | --- |
| I Modular architecture | Not engaged — no module is changed by this directory |
| II API-first | Not engaged |
| III TDD | Each code row's pull request carries its red-first test; settings rows are verified by reading their result, stated per row |
| IV YAGNI & minimal dependencies | Pass — no new dependency; the one workflow change (N11) removes a stored credential rather than adding a tool |
| V TypeScript / VI Naming / VIII English | Pass — prose only, English |
| VII SEO | Not engaged |
| IX UI reuse | Not engaged |
| X Queue consumers | Not engaged |
| XI Tenant isolation / XII Channel scoping / XIII Command Bus / XIV Custom fields | Not engaged |
| XV Untouched core | Not engaged |
| XVI Command palette / XVII Toggleable modules | Not engaged |

The disclosure gate, `specs/conventions/commercial-data.md` §7, applied to the three files of this
directory, class by class: **C1** 0 (the origin rows' estimates were dropped, decision 2); **C2**
0; **C3** 0; **C4** 0 — the paid tier is referred to only as N4 permits (that it exists and has its
own repository); **N1** present (rulings cited); **N2** present (dates, counts); **N3** present
(pull-request numbers, commit ids); **N4** present (the paid tier's existence). **Verdict:
publishable.**

**Verdict: pass.** Nothing here needs a Complexity Tracking entry.

## Complexity Tracking

None.

## Handoff summary for `endora-commerce-dev`

- Work from `tasks.md`, top to bottom within a phase; each row names its hands. Rows marked **O**
  are the owner's and need no pull request; do not change a repository setting on the owner's
  behalf.
- One pull request per row that changes files, ticking that row in the same pull request.
- Before the flip, there is no branch protection: a pull request merges on the owner's explicit
  *ready* with every check green, as it did on GitLab.
- Adding or removing files moves recorded read sizes; re-measure per
  `specs/conventions/check-estate.md` on a pristine clone after merging `origin/master` in.
- The scaffold defect fixes: the owner or the architect gives the defect in the brief. Do not copy
  the private record's text into a pull request — describe the defect in terms of the code.

[^d282]: D-282, with the measurements it rests on.
