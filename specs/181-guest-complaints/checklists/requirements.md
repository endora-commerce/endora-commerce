# Specification Quality Checklist: Complaints from guests without a customer account

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-16
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — FR-071 resolved by owner ruling (G10: comments kept)
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

- Iteration 1 found one failing item: FR-040 ("long and random enough that it cannot be guessed")
  was not testable. Rewritten to: not derivable from the reference, the id or the address, openings
  rate limited, never passed on to linked sites. Iteration 2 passed every item except the open
  clarification.
- Terms carried over from `specs/180-off-platform-complaints/` (transactional template, submission
  key, reference, origin filter, *settled outside the platform*) are the predecessor's domain
  vocabulary, not implementation detail.
- Plan-level items the spec deliberately leaves open, each named in the spec: the Principle XI
  review (Assumptions, G2), the rate-limit figures, and whether shipment records can hold a
  recipient with no organization (replacement for a guest case).
- SC-009 is an operator-measured business outcome; every other criterion is verifiable by test.
- FR-071 resolved 2026-11-16 (G10). The attachments tenant column was settled in 180 (G11). Ready for
  `/speckit.plan`.
