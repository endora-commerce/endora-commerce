---
'@endora-commerce/mod-quote-requests': minor
---

Issue #470 (D-288): a quote request's audit entries carry names and structure, never its values. The platform audit log is one table read under `audit_log:read` without organization reach, so a tenant's quote data no longer reaches it.

- `quote_request.cancel` records `hasReason` instead of the free-text `reason`.
- `quote_request.modify` and `quote_request.create_on_behalf` record `groups` as one `{ lineCount }` per group, without the group's `name`.
- `quote_request.send_document` records `recipientCount` and `failedRecipientCount` instead of the `recipients` / `failedRecipients` addresses.
- `quote_request.prepare_customer_basket` no longer records `customerAccountId` (the request's tenant anchor). It keeps `cartId` and `itemCount`.
- `quote_request.custom_fields.carry` records the carried keys as `changedCustomFields` instead of the custom field values before and after.
- `QUOTE_REQUEST_AUDIT_KEYS` lists the keys a quote request audit state may hold, and a sentinel test holds the recorded states to it.
- No new value store: the values already live in the module's own revisions, history events and request row, which the request's **History** reads under its own visibility. Nothing read them back from the audit log. Audit entries written before the upgrade are not rewritten.

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new quote request entries show names and counts instead of values. The **History** tab is unchanged. See *Quote request values leave the platform audit log* in the upgrade guide.
