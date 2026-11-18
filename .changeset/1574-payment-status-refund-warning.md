---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-i18n': patch
---

The admin order page's payment-status "Change…" dialog offers exactly the statuses the server accepts (issue #1574): `paid` for an unpaid order, `refunded` for a paid one, and nothing for a refunded one. Choosing `refunded` shows a warning that this only records the refund, moves no money and cannot be changed afterwards (new key `orderDetail.statusChange.paymentConsequenceRefunded`, English and Polish).
