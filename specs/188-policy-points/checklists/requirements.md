# Specification Quality Checklist: Declared policy points, and the organization moderation policy

**Purpose**: Check that the specification is complete and of sufficient quality before
implementation starts.
**Created**: 2026-11-23
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] CHK001 The user stories describe behaviour visible to module authors, deployers and
  operators. Mechanism detail is confined to `contracts/`.
- [x] CHK002 The owner ruling D-295 is recorded verbatim as binding (`plan.md` § Ruling D-295).
  The architect's decisions are kept apart from it (research R-1 to R-24).
- [x] CHK003 Every artefact is in English.

## Requirement Completeness

- [x] CHK004 Every FR is testable and traced in `plan.md` § Requirement → test traceability.
- [x] CHK005 Off-state (XVII) is specified for a participant, an absent owner and a moderation
  rule: US1-6, FR-012, FR-004, US3-7, T029, T061.
- [x] CHK006 Tenant scoping is specified, including the system scope with an explicit organization
  id (FR-031, research R-10).
- [x] CHK007 Audit is specified as codes only (FR-037, `data-model.md` §7).
- [x] CHK008 The pl and en labels and their home are specified (FR-041, research R-11).
- [x] CHK009 Palette actions and permissions are specified (FR-015, FR-042). No new permission
  code is added.
- [x] CHK010 The edge cases cover an absent owner, a superseded evaluation, late results, missing
  labels, pre-release organizations and a lost reactor.
- [ ] CHK011 OQ-1 (package participants) is open. The default refuses (D-295).
- [ ] CHK012 OQ-2 (whether rules can approve under `manual`) awaits confirmation. It is
  implemented as specified.
- [ ] CHK013 OQ-3 (an automatic retry worker) awaits a decision. No worker is added.

## Feature Readiness

- [x] CHK014 No new runtime dependency. One table (WP-B). One MINOR constitution amendment
  (FR-020).
- [x] CHK015 Two merge requests: WP-A has no database work, and WP-B follows 186 and #1073.
- [x] CHK016 The second point (`specs/191-membership-join-requests/`) fits FR-050 and research R-21.
