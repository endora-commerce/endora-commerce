---
'@endora-commerce/mod-invoices': minor
---

Issue #470 (D-288) — invoice audit entries hold no amount. An invoice is `@TransitivelyScoped` through its Order, and the platform audit log is read under `audit_log:read` without Organization reach.

- `invoice.issued` no longer records `grossTotal`. It keeps `number`, `kind`, `orderId` and `salesChannelId`.
- `invoice.corrected` no longer records `credited` or `charges` (charge kind mapped to amount). It records `chargeKinds`, the sorted kinds of the credited charges, beside `number`, `orderId`, `originalInvoiceId` and `priceReductionLines`.
- Audit entries written before the upgrade are not rewritten (owner ruling O-4).

**Behaviour change on upgrade.** On the platform **Audit log** screen and in `audit_logs read`, new invoice entries show no totals. See *Invoice amounts leave the platform audit log* in the upgrade guide.
