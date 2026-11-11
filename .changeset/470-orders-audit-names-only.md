---
'@endora-commerce/mod-orders': minor
---

Issue #470 (D-288): an order's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without organization reach, so a tenant's order data no longer reaches it.

- `order.custom_fields.update` and `order.custom_fields.carry` record the changed custom field keys as `changedCustomFields` instead of the custom field values before and after.
- `order.place_on_behalf` no longer records the order's `total` and `currency`, and its `groups` hold each group's `lineCount` without the group's `name`.
- `order.place_via_api_key` no longer records `organizationId` and `customerAccountId` (the order's tenant anchor). It keeps `apiKeyId` and `businessId`.
- `ORDER_AUDIT_KEYS` lists the keys an Order audit state may hold, and a sentinel test per audited write holds it to that list.
- No order history reads values back from the audit log, so no value store is added: the order row holds the values. Audit entries written before the upgrade are not rewritten.

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new order entries show field names instead of values. See *Order values leave the platform audit log* in the upgrade guide.
