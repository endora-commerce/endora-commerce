---
'@endora-commerce/mod-inventory': patch
---

The admin warehouses list and the availability-notification requests list now order by `id` after their time key, so rows sharing it no longer repeat or go missing across pages (#1760).
