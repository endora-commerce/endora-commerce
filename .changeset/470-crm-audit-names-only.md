---
'@endora-commerce/mod-crm': minor
---

Issue #470 (D-288) — a sales opportunity's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without organization reach, so a tenant's opportunity data no longer reaches it.

- Every `crm.opportunity.*` Command now records the opportunity's number, status and other codes, the assignee and sales channel ids, dates, and `changedFields` / `changedCustomFields` (the sorted names of what changed). It no longer records the title, description, manual value, currency, contact person, organization, tag names, custom field values, a transition's or a skipped propagation's reason, an event's name or an attachment's file name.
- Those values go to a new CRM-owned table, `crm_opportunity_value_changes` (`CrmOpportunityValueChange`, scoped through the opportunity, `on delete cascade`). The same Command writes it, so it commits or rolls back with the audit entry, and the entry points at the row by `valueChangeId`. The migration `Migration20261109T163616CrmOpportunityValueChanges` creates it.
- `GET /api/v1/admin/crm/opportunities/:id/history` reads the values back from that table. It reads them by the opportunity's id, after the opportunity was loaded through the scoped EntityManager, and serves them in `before` / `after` in the shape the entries had before, so the response contract is unchanged. Custom field values, and now the names of changed custom fields, still go only to `custom_fields:read` holders.
- `CRM_AUDIT_KEYS` is the allowlist of keys a `crm.opportunity.*` audit state may hold. The audit snapshot and every Command's recorded state are tested against it, with a sentinel test per Command.
- Audit entries written before the upgrade are not rewritten.

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new CRM opportunity entries show field names instead of values. The opportunity's own **Change history** tab is unchanged. See *Opportunity values leave the platform audit log* in the upgrade guide.
