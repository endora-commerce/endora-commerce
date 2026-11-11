---
'@endora-commerce/mod-organizations': minor
---

Issue #470 (D-288, owner ruling O-2) — the `organization.admin_patch` audit entry (`PATCH /api/v1/admin/organizations/:id`) holds field names, not values. The Organization is the tenant, and its name, tax ID, reasons and custom field values are that tenant's values; the platform audit log is read under `audit_log:read` without Organization reach.

- The entry no longer records the Organization's snapshot (name, legal name, tax ID, registered address, order-confirmation e-mails, block and rejection reasons, custom field values).
- `stateBefore` holds the `status`, `vatStatus` and `fulfilmentStrategy` codes. `stateAfter` holds the same codes after the write, `changedFields` (the sorted names of the changed columns) and `changedCustomFields` (the sorted keys of the changed custom fields).
- The request, the response, the `409 VERSION_CONFLICT` and the `422 CUSTOM_FIELD_VALUE_INVALID` envelope are unchanged. There is still one entry per PATCH.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new `organization.admin_patch` entries show no Organization values. See *An Organization edit's values leave the platform audit log* in the upgrade guide.
