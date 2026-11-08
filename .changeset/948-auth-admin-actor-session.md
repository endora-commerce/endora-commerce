---
'@endora-commerce/mod-auth': minor
---

Issue #349 (E-349-1) — the admin actor resolved from the admin session cookie now carries `sessionId`, the id of that session. A write that reaches its consequence through an event can then spare the acting session without carrying the cookie, which is a credential.
