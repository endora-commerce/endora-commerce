---
'@endora-commerce/mod-customer-accounts': patch
---

`CUSTOMER_ALREADY_DELETED` now has a sentence in English and Polish in `customer_accounts`' bundle (issue #828), so deleting an already-deleted customer answers in the admin's language instead of the raiser's English fallback. The sentence is worded to fit every raise site, including the refusal to impersonate a deleted customer (issue #814).
