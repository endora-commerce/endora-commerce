---
'@endora-commerce/platform': patch
---

`composeApp` registers `auditRedactionService`, the platform-owned `AuditRedactionPort`, beside `auditLogService`, now that its first caller, the customers retention sweep, reads it (issue #844).
