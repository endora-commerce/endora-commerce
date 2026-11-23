# Specification Quality Checklist: Overlay modules as full modules

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-23
**Feature**: `specs/190-overlay-full-modules/spec.md`

## Content Quality

- [x] Requirements state what must hold, not how the code is written (file names appear only where
  the requirement is about a named file an author writes or a refusal names)
- [x] Focused on the author's and operator's outcomes (instance author, deployment operator)
- [x] All mandatory sections completed

## Requirement Completeness

- [x] `[NEEDS CLARIFICATION]` markers ≤ 3. OQ-190-1 – OQ-190-3 were raised with recommendations and
  closed by the owner on 2026-11-23 (OR-11 – OR-13); none open
- [x] Requirements are testable and unambiguous; every refusal has a named verdict
- [x] Success criteria are measurable (SC-001 – SC-006)
- [x] Acceptance scenarios defined for every P1/P2 story
- [x] Edge cases identified (deployment switch, hard uninstall with directory present, absent sources,
  nesting, duplicate tables, naming, baseline, two deployments)
- [x] Scope bounded: side tables are 187's, middleware, the origin type and tiers 189's (OR-10),
  policies 188's
- [x] Dependencies and assumptions identified (#1866 gate, 187, 189, #1835)

## Feature Readiness

- [x] Every FR maps to at least one task in `tasks.md`
- [x] Owner rulings recorded as binding (OR-1 – OR-13, D-297)
- [x] No new runtime dependency

## Notes

- The spec names platform files in *Context* only as evidence of today's behaviour, as prior specs in
  this repository do; the FRs are about behaviour.
