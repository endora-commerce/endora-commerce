---
'@endora-commerce/mod-languages': patch
'@endora-commerce/mod-dictionaries': patch
'@endora-commerce/platform': patch
---

`languages` now creates `languages.native_label`, `is_rtl`, `fallback_code` and the
`languages_fallback_fk` self-reference itself, in the new
`Migration20261114T003519LanguagesDictionaryColumns` (issue #611). Until now only
`dictionaries`' `Migration20260506T112634DictionariesDictionaryInit` created them, although they
belong to `languages`' `Language` entity. That migration keeps its class name and no longer alters
`languages` in `up()` or `down()`. The new migration uses `if not exists` and a `pg_constraint`
check with the same types, defaults and constraint name, so a database that has already applied
the old migration does not change. `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists
`dictionaries` writing `languages`. The `currencies` columns the same `dictionaries` migration adds
stay where they are: `currencies` does not create its own table yet.
