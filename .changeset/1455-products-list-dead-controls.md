---
'@endora-commerce/mod-catalog': patch
---

The products list (`/catalog/products`) no longer shows controls that do nothing (issue #1455). The header's **Import** and **Export** buttons, which had no action, are replaced by one **Import / export** link to the import–export centre, shown only while the `import_export` module is on. The **Category** and **Channel** chips are removed because clicking them did nothing. The **Stock** chip is removed too: the list has no stock data, so choosing it always showed an empty list. Use the Inventory list to filter by stock. The always-disabled **Edit price** button and the per-row "more" icon, which opened nothing, are removed.

The filter row is now the kit's list toolbar. It has a labelled search box and a labelled **Type** select that lists every product type, which replaces the chip that moved to the next type on each click. The clear-selection icon has an accessible name, and load and selection errors are shown as alerts.
