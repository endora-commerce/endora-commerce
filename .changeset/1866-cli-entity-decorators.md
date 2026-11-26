---
'@endora-commerce/cli': minor
---

MikroORM 7 (issue #1866). New rule `check:entity-decorators` (`@endora-commerce/cli/rules/entity-decorators.js`,
and in `endora check` over a module package): a MikroORM decorator imported from anywhere but
`@mikro-orm/decorators/legacy` — `@mikro-orm/core`, a driver package, `@mikro-orm/decorators/es`, or
applied through a namespace import — is a finding. `endora new module` scaffolds entities with
decorators from `@mikro-orm/decorators/legacy`, and `endora new instance` writes
`@mikro-orm/decorators` beside the other `@mikro-orm/*` packages, from the platform's declared range,
and no longer sets `emitDecoratorMetadata` in the backend's `tsconfig.json`.
