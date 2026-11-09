# Audit state: what a Command may record (D-288, issue #470)

**Open this before writing a Command's audit state** — `capture` / `before` / `after` of a
Command outcome, or `stateBefore` / `stateAfter` of an `auditLog.record` / `recordWithin` call —
**or a record history that reads audit entries back.** One of the bodies `AGENTS.md` routes to;
it is the single home for this rule, so never restate it in `AGENTS.md` or in a tool-specific
pointer file.

Constitution XIII is the principle and is unchanged: every domain write is one Command and one
audit entry, committed together. This document narrows what that entry's before/after state may
hold. It does not change what the bus guarantees.

## The rule

**Owner decision 2026-10-27 (#470, option A).** The platform audit log (`audit_log_entries`) is a
platform-global table — `AuditLogEntry` is `@GlobalEntity()` and has no organization column — read
under one permission (`audit_log:read`) without Organization reach, by the global audit screen, the
`audit_logs read` CLI and any future export. So for a **tenant-scoped record**, meaning one whose
entity is `@OrgScoped`, `@CustomerScoped`, `@TransitivelyScoped` or `@RuleScoped`, its
`stateBefore` / `stateAfter` carry **names and structure, never values**.

### 1. May be recorded

A closed list. The **shape** decides, not the business meaning:

- the ids of the audited record and of its own child rows; ids of platform-global records (admin
  users, sales channels, warehouses, API keys);
- ids of other records (any module, tenant-scoped or not) — a linked Order, a causing Order, a carry's
  source document: an id is an opaque reference that reveals nothing without reach to that record;
- document numbers (`number`, `revisionNumber`);
- code-shaped values: status, kind, mode, source and decision codes from a closed set, plus
  dictionary codes (not their labels);
- booleans, `version`, counts and lengths (`itemCount`, `lineCount`, `descriptionLength`);
- dates and timestamps;
- `changedFields` / `changedCustomFields`: the sorted names of what changed;
- an opaque id pointing to a row in the module's own value store (`valueChangeId`).

### 2. Must not be recorded

- free text of any length: titles, names, descriptions, notes, reasons, messages, file names,
  event names, tag labels;
- money and quantities: amounts, prices, totals, limits, multipliers, credited sums;
- custom-field values (their keys go in `changedCustomFields`);
- personal data: e-mail, phone, tax id, address lines;
- the **tenant anchor**: `organizationId` / `customerAccountId` of the record being audited. A move
  between tenants is recorded as `changedFields: ['organizationId']`.

**Anything not in list 1 counts as list 2.** A new field is excluded until somebody classifies it
on purpose.

### 3. A record history that shows values

A history that shows values (before → after) reads them from a store the module owns, never from
the audit row. The store:

- is classified like the record (a child of an `@OrgScoped` record is
  `@TransitivelyScoped` under it);
- has one row per Command that changed a value;
- is written **in the same Command** — the same transaction, so the bus's "one unit" covers it and a
  rolled-back Command leaves neither the row nor the audit entry;
- is read only after the record has been loaded through the module's scoped access path, and only
  by that record's id.

The audit entry names the fields and carries the store row's id as `valueChangeId`. Precedent:
`project_value_changes` (`specs/163-projects-and-tasks/`, T145).

### 4. Undo is not affected

A reversible Command keeps its pre-state in its own operation row (`RevertRecord[]`,
`@endora-commerce/platform/commands`), never in the audit entry. Nothing reverts from
`audit_log_entries.stateBefore`.

### 5. Platform-global records

Catalog, settings, dictionaries and the other platform-global records are outside this rule and
may record values. That includes what such a record says when it is quoted in a tenant
record's entry: a custom-field **definition's** label in a carry's `skipped[].label` is the
definition's (global) text, not a value of the record being audited. A global module that writes **about** a tenant-scoped record follows this rule
for that write.

### 6. Test obligation

Every Command that writes a tenant-scoped record has a **sentinel** test:

1. seed every list-2 field with a distinctive sentinel — `'S470-TITLE'`, `'S470-DESC'`,
   `470470.47`, a custom-field value `'S470-CF'`, a fresh Organization id, `s470@example.test`;
2. run the Command through the real `CommandBus` with a recording audit port;
3. hand what was recorded to `expectNoAuditValues(entries, sentinels)` from
   `@endora-commerce/test-kit/audit` — it fails on a sentinel at any depth, under an object key, in
   another case or as a decimal string, and it fails when there is no entry to inspect;
4. assert that `changedFields` / `changedCustomFields` name what changed.

Export the module's allowlist as a `<MODULE>_AUDIT_KEYS` constant beside its snapshot helper, and
assert in a unit test that the snapshot's keys (and the top-level keys of every state the sentinel
tests record) are a subset of it. A module with a value-reading history adds integration tests: the
rollback leaves neither a store row nor an audit row; an in-reach reader is served the values; an
out-of-reach reader gets a 404 indistinguishable from a missing record; custom-field values reach
only a `custom_fields:read` holder. The global `GET /api/v1/admin/audit-log` gets one contract
assertion per module: a row written by the module's update Command carries no sentinel.

## What is still open

These are the owner's to rule (`#470`); until they are, do not decide them in code:

- **O-1 titles.** The ruling recommends that a record's title is a value (list 2). Projects and
  Tasks still record `title`.
- **O-2 the tenant root.** `Organization` is `@GlobalEntity`, so this rule does not yet cover its
  `name`, `taxId`, `blockedReason` or `rejectedReason`.
- **O-3 price books.** RuleScoped, so covered in principle; the price-change history is staged
  D-287 work.
- **O-4 historical rows.** The rule applies from now on. Values already in `audit_log_entries`
  stay; nothing scrubs them.
