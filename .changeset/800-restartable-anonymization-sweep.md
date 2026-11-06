---
'@endora-commerce/mod-customers': minor
'@endora-commerce/mod-organizations': patch
'@endora-commerce/contracts': patch
'@endora-commerce/mod-customer-accounts': patch
---

The customer anonymization sweep is restartable (issue #800). It now scrubs a personal organization, then its saved addresses, and anonymizes the account last, so an account whose cascade was interrupted stays due and the next run completes it. Each account runs on its own: one that fails no longer stops the run, which anonymizes the others and then throws once, naming the failed account ids. A `ModuleDisabledError` still aborts the run.

`PersonalOrganizationPort.anonymizeIfOrphaned` is convergent. It writes only the part of the scrub that is still missing, keeps an existing `deletedAt` (an operator's soft-delete), and records `organization.anonymized` in the same transaction as the scrub, only when something changed. It answers the organization on a repeat call too, and answers `null` only for an org-less account, a non-personal organization, or one that still has a live member.

`POST /api/v1/admin/customers/:id/restore` answers `409 CUSTOMER_RESTORE_WINDOW_ELAPSED` once `customers.deletion_retention_days` has elapsed since the deletion, even before the sweep has anonymized the account. It used to succeed in that case. `CustomerDeletionService` takes the retention-days resolver as a new constructor argument. `CUSTOMER_RESTORE_WINDOW_ELAPSED` now has a sentence in English and Polish in `customer_accounts`' bundle, so both raise sites answer in the reader's language.
