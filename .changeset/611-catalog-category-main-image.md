---
'@endora-commerce/mod-catalog': patch
'@endora-commerce/mod-assets-library': patch
'@endora-commerce/platform': patch
---

`catalog` now creates `categories.main_image_asset_id`, its `categories_main_image_fk` foreign
key to `assets` and `categories_main_image_asset_id_index` itself, in the new
`Migration20261114T000706CatalogCategoryMainImage` (issue #611). Until now only
`assets_library`'s `Migration20260505T102206AssetsLibraryInit` created them, although the column
belongs to `catalog`'s `Category` entity. That migration keeps its class name and no longer
names `categories` in `up()` or `down()`. The new migration uses `if not exists` and a
`pg_constraint` check, so a database that has already applied the old migration does not change.
Its `down()` is empty: the `categories` rows outlive `catalog`, so a hard uninstall keeps their
main images. `FIRST_PARTY_FOREIGN_WRITE_EXEMPTIONS` no longer lists `assets_library` writing
`categories`.
