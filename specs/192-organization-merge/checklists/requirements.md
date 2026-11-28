# Specification Quality Checklist: Merging duplicate Organizations and duplicate Projects

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain. The owner answered OQ-1 to OQ-4 on 2026-11-25,
  each as recommended (spec *Clarifications*, ruling D-299). OQ-5 to OQ-12 stand as stated
  assumptions the owner may overturn, and `plan.md` § *Open items* lists them.
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded (customer-account merge, duplicate detection and cross-installation
  merges are out of scope)
- [x] Dependencies and assumptions identified (`specs/186-aggregate-ports/`,
  `specs/191-membership-join-requests/`, `specs/176-command-hooks-outbox/`)

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria (FR-009, FR-022, FR-023 and
  FR-070 settled by D-299)
- [x] No implementation details leak into specification

## Notes

- The two inventories (*Organization references on master*, *Project references on master*) name
  modules and entity files on purpose. The issue asks which records follow the survivor, and the
  answer is ownership, not mechanics. They were derived on `67351db04` and must be re-derived by
  the plan. FR-045 makes the static check, not this table, the source of truth.
- *Interfaces and ownership* names the ports the merge is published on, because D-293 requires
  every aggregate operation to be reachable from server code. Shapes are left to `contracts/`.
- Feature number 192 was the next free number above the floor (136) and the highest directory on
  `master` (191) when this was written. It has not been checked against open pull requests.
- Validation iteration 2 (2026-11-25): the owner's answers to OQ-1 to OQ-4 were recorded as a
  *Clarifications* session and ruling D-299, and the four markers were resolved in FR-009,
  FR-022, FR-023 and FR-070. The plan artefacts were written the same day.
