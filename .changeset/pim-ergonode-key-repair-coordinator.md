---
'@endora-commerce/mod-pim-ergonode': minor
---

The attribute-key repair for keys derived before the `sanitiseSourceCode` fold no longer runs inside `Migration20260819T193653PimErgonodeFoldDerivedKeys`, which wrote other modules' tables. That class keeps its name and position and is now a no-op in both directions. The repair runs from the module instead: at boot whenever the module is present, before its import schedule is re-asserted, and at the start of every import, which waits for it. It renames through `custom_fields`' `applyRenameKey` and `catalog`'s `catalogAttributeValueKeyPort` in one transaction, records completion in a new table, `ergonode_key_repairs` (`Migration20260926T120000PimErgonodeKeyRepairs`), and takes a transaction-held advisory lock, so API and worker processes starting together apply it once. If the repair fails, imports are refused as `internal_error` with a detail naming the repair until it succeeds.

What an instance does: regenerate the migration registry (`endora generate`, or `pnpm --filter backend run composer:generate` in this repository) so the new migration runs, and upgrade `@endora-commerce/mod-custom-fields` and `@endora-commerce/mod-catalog` to the releases that publish those two seams. A database that already ran the old migration body finds nothing to rename and just records the checkpoint.
