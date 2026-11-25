---
'@endora-commerce/platform': minor
---

Principle XI at boot (issue #1849, `specs/190-overlay-full-modules/` FR-020 – FR-021). The platform
refuses to configure the ORM when a persisted entity carries no tenancy classification
(`@OrgScoped`, `@CustomerScoped`, `@TransitivelyScoped`, `@RuleScoped` or `@GlobalEntity`), or more
than one. The refusal is `UnclassifiedEntityError`, raised by `configuredEntitiesFrom` before any
connection opens. It names every such class and who contributed it (`core` or the npm package name),
in every process that configures the ORM: the API, the worker, `migrate`, `module:*` and the test
harness. Embeddables and abstract bases are exempt, as MikroORM's own metadata records them.

**Upgrade note.** An installed third-party package whose entity has no classification, or two, now
stops the boot instead of running untenanted. Add exactly one classification decorator to each such
entity. No package in this repository is affected.
