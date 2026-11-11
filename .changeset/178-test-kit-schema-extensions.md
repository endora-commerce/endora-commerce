---
'@endora-commerce/test-kit': patch
---

`composeTestServer` mirrors `composeApp` for declared extension columns (`specs/178-extensible-columns/`): it verifies the declarations against the database right after opening the ORM (no statement when nothing is declared) and registers `schemaExtensionReads`, so a host route's `?extensions=` resolves in a test composition as it does in production.
