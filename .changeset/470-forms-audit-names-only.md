---
'@endora-commerce/mod-forms': minor
---

Issue #470 (D-288) — a form entry export's audit entry no longer carries the search text. `forms.entries.export` is recorded against the global form, but it writes about `@CustomerScoped` entries, and the platform audit log is read under `audit_log:read` without Organization reach (`specs/conventions/audit-state.md` §2, §5).

- `forms.entries.export` no longer records `filter.q`. With a search text, `filter` records `hasQuery: true` and `queryLength` instead; without one, neither. The statuses, submission dates, sales channel id, form id and row count are unchanged.
- `FORMS_AUDIT_KEYS` and `FORMS_EXPORT_FILTER_AUDIT_KEYS`, constants in `src/backend/services/entry-audit-state.ts` (not on a published barrel), list every key the entry Commands' audit state may hold, held by a sentinel test.
- No screen reads values back from the audit log, so no value store is added. Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** See *A form entry export's search text leaves the platform audit log* in the upgrade guide.
