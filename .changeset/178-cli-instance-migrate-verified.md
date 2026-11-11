---
'@endora-commerce/cli': patch
---

The instance scaffold's `backend/src/migrate.ts` migrates through `migrateUpVerified(orm)` instead of a bare `orm.getMigrator().up()`, so an instance's `pnpm run setup` gets the verified run of declared extension columns (one transaction, the verifier before commit, generated-step history pruning, orphan marking of vanished packages). An existing instance should apply the same one-line change to its own `backend/src/migrate.ts`.
