---
'@endora-commerce/mod-audit-logs': patch
---

The audit log screen labels the CRM module's actions. An entry whose action begins with `crm.`
is attributed to the `crm` module, so it reads as the sentence that module's bundle carries
for it (`auditLog.crm.…`) instead of its action code. Entries of every other module are
unchanged.
