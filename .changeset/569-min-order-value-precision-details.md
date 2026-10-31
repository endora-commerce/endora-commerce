---
'@endora-commerce/mod-orders': minor
---

Saving `orders.min_order_value` with more than two decimal places still answers `400 AMOUNT_PRECISION_EXCEEDED`, but the setting's code now travels as `details.setting`; `details.code` no longer carries `orders.min_order_value`, and the error has no `details.code` at all. The envelope read that value as a refusal token and answered the validator's English in every language; the message is now the translated sentence every money field shares (`Kwota może mieć najwyżej dwa miejsca po przecinku.` in Polish). A client that read the setting from `details.code` reads `details.setting` instead.
