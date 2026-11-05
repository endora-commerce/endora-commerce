# Specification Quality Checklist: One scope switcher for the product editor

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-29
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- **`[NEEDS CLARIFICATION]` markers: 0; clarify exhausted after round 5 (2026-10-30)** — 19 remained after round
  1; rounds 2–5 resolved them and every follow-up. Round 4 added FR-047 and FR-110…FR-115; round 5 added
  FR-048 (saved import profile), FR-116 (in-place change of `null`) and FR-117 (scoped product values only,
  named follow-ups in *Out of Scope*). FR-001 and FR-021…FR-025 are kept as "Removed (round …)" so citations
  stay stable. Ready for `/speckit.plan`.
- **Round 6 (2026-10-30, from `plan.md`)**: the five owner questions of the plan are answered and written into
  the spec — FR-013 (SEO empty → derived value; alt text empty → `alt=""`), FR-043 (export without an import
  profile), FR-070 (Save scope; immediate actions), FR-074 (before-state re-appliable through the API; no
  restore UI; "Restore this save" a named follow-up), new FR-094 (`/seo` product mode becomes a link), and the
  prototype gate in *Assumptions*. Still 0 `[NEEDS CLARIFICATION]` markers. `plan.md`, `tasks.md` and
  `contracts/` are the architect's to update.
- **Round 7 (2026-10-30, from security / schema review)**: FR-016's uniqueness space changed to one product per
  key per channel across its languages (DB-enforced); new FR-118 (CSV formula-injection prefix); two security
  notes in *Assumptions*. Still 0 `[NEEDS CLARIFICATION]` markers.
- **Left to the plan** (no user-visible behaviour at stake): which existing `import_export` permission gates
  managing import profiles (no new permission code, 163 FR-084), profile writes through the Command Bus
  (Constitution XIII), command-palette reachability of the profile screen (XVI), and how
  `product_editor_preferences` encodes G / C / C×L (FR-056).
- **Dependencies**: per-connector locale-mapping screens are an external dependency (PIM connectors live outside
  this repository; FR-045, *Assumptions*). The plan carries a security review of FR-093.
- **Implementation detail, accepted deliberately**: the *Current state* section and a few requirements cite
  file paths, endpoints and the `product_editor_preferences` table. This is evidence for a brownfield
  correction (F1, F2, F4, F5, F8, G1–G8), following the precedent of `specs/163-product-data-scopes/spec.md`;
  the requirements themselves state behaviour. FR-002 / FR-003 are regression tests against the new model (round 3; no
  patch to the old model).
- **Stakeholder readability**: user stories and success criteria are written for an operator / product
  owner; FR wording assumes familiarity with 163's scope vocabulary, defined in *Terms used in this spec*.
- SC-012 is relative ("no perceptible regression against a product page load") because no baseline was
  measured; the plan should record one.
