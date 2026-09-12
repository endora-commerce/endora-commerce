---
'@endora-commerce/mod-transactional-emails': patch
---

`Migration20260801T111001TransactionalEmailsEmailDefaultsReseed` no longer writes `newsletter`'s
table (`specs/120-migration-closure-bridge-ownership/` Phase 5, FR-019; feature 097's already-written
retiring condition, executed).

Two statements are removed from `up()`, in place:

```sql
update "newsletter_email_blocks" set "content" = …, "version" = "version" + 1, "updated_at" = now()
  where "code" = 'newsletter_default_header' and "is_system" = true;
update "newsletter_email_blocks" set "content" = …, "version" = "version" + 1, "updated_at" = now()
  where "code" = 'newsletter_default_footer' and "is_system" = true;
```

`newsletter_email_blocks` is `@endora-commerce/mod-newsletter`'s table, and this module cannot
legally reach it: `transactional_emails` declares `activation: { nonDeactivatable: true }` while
`newsletter` declares an activation control, so naming `newsletter` in this module's `dependencies`
would turn that control into a dead switch — the lifecycle orchestrator refuses a disable with live
dependents, and a `--cascade` would have to disable a module that refuses.

**The removal loses nothing on a fresh database.** `newsletter`'s own
`Migration20260629T200954NewsletterInit` seeds those two blocks from the identical
`envelopeFromTree(defaultHeaderTree(), DEFAULT_LANGUAGES)` call against the same
`@endora-commerce/email-components` defaults, so the statements wrote bytes their owner had already
written and bumped `version` for nothing. The only database on which they did anything is one that
ran `newsletter_init` before those components changed — and there the module that should refresh
`newsletter`'s system blocks is `newsletter`. **No replacement migration is added here**, and none
should be: that refresh is `newsletter`'s to ship, in a `newsletter`-owned migration that needs no
cross-module edge at all.

**The class is not renamed and no stamp moves.** `mikro_orm_migrations` persists the class name and
holds no checksum — measured again on `@mikro-orm/migrations@6.6.13`, whose `ensureTable()` builds
`id` / `name` / `executed_at`, whose `logMigration` inserts `{ name }`, and whose pending set is
`umzug`'s name diff — so a database that has applied this migration is offered nothing from it and
its schema does not move.

**What an instance gets is the ability to migrate at all.** Until now a consumer that installed this
package without `@endora-commerce/mod-newsletter` aborted its first migration on
`relation "newsletter_email_blocks" does not exist`, inside the install of a module the platform
refuses to run without. The `endora new instance` acceptance criterion now applies its 118 migrations
and exits 0, where it previously failed on this class.
