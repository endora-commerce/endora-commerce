---
'@endora-commerce/test-kit': patch
---

`composeTestServer` registers `auditRedactionService` beside `auditLogService`, as `composeApp` does, so a composed test server runs the customers retention sweep's audit redaction (issue #844).
