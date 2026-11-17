---
'@endora-commerce/mod-currencies': patch
'@endora-commerce/mod-languages': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/platform': patch
---

`currencies` now creates its own `currencies` table in the new
`Migration20261117T065542CurrenciesTable` (issue #611), and the package publishes a
`./migrations` subpath. The migration creates the table, its two indexes, the `symbol_position`
and `decimal_places` columns and their two checks. It inserts the `PLN` (default) and `EUR` rows
only when it created the table itself. Until now `languages`'
`Migration20260425T161557LanguagesCurrenciesInit` created the table and its rows, and
`dictionaries`' `Migration20260506T112634DictionariesDictionaryInit` added the columns and checks.
Both keep their class names and no longer name `currencies` in `up()` or `down()`. Every statement
in the new migration is guarded, so a database that has already applied the old migrations does
not change, and a currency an operator edited or deleted stays as it is.
`FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `languages` or `dictionaries` writing
`currencies`.
