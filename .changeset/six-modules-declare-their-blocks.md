---
'@endora-commerce/mod-cms': minor
'@endora-commerce/mod-catalog': minor
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-transactional-emails': minor
'@endora-commerce/mod-invoices': minor
'@endora-commerce/mod-ksef': minor
---

Six modules declare the Page Builder blocks they own — all 74 of them.

Each package's exported `manifest` gains `blocks` and `blockCategories`, and each
ships the `blocks.<local>.label`, `blocks.<local>.description` and
`blocks.category.<key>` entries for them in `i18n/en.json` and `i18n/pl.json`:

| Package | Blocks | Category declarations |
| --- | --- | --- |
| `mod-cms` | 30 | 8 CMS sections |
| `mod-catalog` | 8 (5 CMS, 3 e-mail) | 2 |
| `mod-orders` | 8 e-mail | 1 (`order`) |
| `mod-transactional-emails` | 17 e-mail | 4 |
| `mod-invoices` | 10 invoice | 1 (`invoice`) |
| `mod-ksef` | 1 invoice | 1 (`invoice`, joining) |

**Nothing reads these declarations yet.** The Page Builder registry is still
populated from the single hand-written `register('cms', …)` call, the three Puck
configs are still keyed by the bare names, and no stored document changes. Read
the block `name`s as the names those blocks will have, not as names anything
resolves today.

Two `(key, context)` sections are declared by two modules each and **merge**:
the e-mail `content` section (`mod-transactional-emails` names it,
`mod-catalog` joins) and the `invoice` section (`mod-invoices` names it,
`mod-ksef` joins). A joining declaration carries its own `titleKey` and omits
`weight` and `visible`, so it cannot take a presentation its author did not
intend to take while still being able to title the section on its own when the
namer is switched off.

Three sections change owner or gain a member, which is the point of the exercise
rather than a side effect: the CMS `catalog` section is `mod-catalog`'s (`cms`
hand-writes it and owns no block in it); the e-mail `order` section is
`mod-orders`'; `cms.InsertTemplate` and `transactional_emails.EmailInsertTemplate`
gain a section, having had none; and `transactional_emails.EmailColumn` moves into
a new hidden `internal` section.

`mod-cms`' bundles rename one key: `pageBuilder.categories._internal` becomes
`pageBuilder.categories.internal`, following the category key in
`@endora-commerce/cms-components`. The rendered title is unchanged.
