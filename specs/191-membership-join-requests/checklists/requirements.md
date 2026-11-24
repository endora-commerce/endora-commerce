# Specification Quality Checklist: Membership moves and join requests on an existing tax ID

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — Q1 was answered by the owner on 2026-11-23
  (variant B, spec OR-8); the other owner questions are OR-9 – OR-12
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

- US1 and FR-001 – FR-011 describe an operation that automated integrations call. They are written
  in terms of what the operation does and who may use it, not how it is exposed; the exposure is
  `contracts/membership-port.md`.
- Validation iteration 1: the edge case on blocked accounts was corrected to match today's operator
  behaviour (a blocked account may be moved; it may not be approved into a company).
- Validation iteration 2 (2026-11-23, owner answers): OR-8 – OR-12 recorded; OQ-5 changed to "yes,
  now", so FR-100 – FR-107, US3 scenarios 7 – 11, US4 scenario 5, SC-009 and the branch edge cases
  were added. The *Interfaces and ownership* section names the two published interfaces on purpose:
  issue #1832 is written against that split, and the section states ownership, not mechanics.
