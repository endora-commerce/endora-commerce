---
'@endora-commerce/mod-orders': minor
---

Migration `Migration20261108T073238OrdersChargeLines` adds a nullable `orders.charge_lines` (jsonb) and lets `orders.vat_method` hold `per_rate_charges` (issue #904). `Order.chargeLines` and `OrderReadPort`'s `OrderRecord.chargeLines` expose the column. Nothing writes either value yet: orders are still placed `per_rate`, with delivery and the surcharge at 0 %. Nothing is backfilled.
