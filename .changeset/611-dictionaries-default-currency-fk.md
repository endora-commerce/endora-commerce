---
'@endora-commerce/mod-dictionaries': patch
---

`dictionaries` now adds `countries_default_currency_fk` in the new
`Migration20261117T065601DictionariesDefaultCurrencyFk` (issue #611). Until now
`Migration20260506T112634DictionariesDictionaryInit` added it. `currencies` now creates its own
table in a migration that runs after every older migration, so the old migration could no longer
reference that table on a database migrated from empty. The old migration keeps its class name.
The new one adds the foreign key only when it is missing, with the same definition, so a database
that has already applied the old migration does not change.
