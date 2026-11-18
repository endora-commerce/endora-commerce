---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-i18n': patch
---

The orders list (`/orders`) uses the kit's list toolbar (issue #1440). The **Filters** button is now **More filters**. It shows how many hidden filters are in use, as **More filters (2)**, and no longer turns into a filled primary button when filters are applied. **Clear all** is now **Clear all filters**, and each applied-filter chip is named "Remove filter: …". Every hidden filter is now named by its own label, where before several labels pointed at controls that did not exist.
