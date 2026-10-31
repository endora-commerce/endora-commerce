---
'@endora-commerce/contracts': minor
---

The audit-log row type inferred from `auditLogEntrySchema` is now `AuditLogEntryResponse`, in line with the package's `…Response` suffix for API shapes. `@endora-commerce/platform/kernel` publishes `AuditLogEntry` as the MikroORM entity of an `audit_logs` row, so a consumer importing both packages met two different declarations under one name (issue #84).

**Deprecation:** `AuditLogEntry` is still exported from `@endora-commerce/contracts` as a `@deprecated` alias of `AuditLogEntryResponse`, and is removed in the next minor release. Replace `import type { AuditLogEntry } from '@endora-commerce/contracts'` with `import type { AuditLogEntryResponse } from '@endora-commerce/contracts'`; the shape is unchanged. `auditLogEntrySchema` keeps its name.
