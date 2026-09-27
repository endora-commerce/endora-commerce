---
'@endora-commerce/mod-pim-ergonode': patch
---

The connector's section tab strip reads its tabs from an exported `ERGONODE_SECTION_TABS` table (`{ to, labelKey }` per tab), so the package's own tests can state which tab a route selects without rendering the strip. The rendered strip is unchanged: the same three tabs, the same routes, the same labels.
