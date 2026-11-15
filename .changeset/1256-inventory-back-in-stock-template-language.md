---
'@endora-commerce/mod-inventory': patch
---

**The back-in-stock e-mail is the editable template, in the subscriber's language.** The stock worker that `inventory.adjusted.v1` triggers sent a fixed English plain-text message. It now sends the `availability_back_in_stock` transactional e-mail (the "Back in stock notification" in the e-mail builder), as the restock fan-out already did. Both render it in the sales channel and language the subscription recorded (issue #696): the channel's override for that language, else the global override, else the shipped English or Polish default. A subscription without a recorded channel, or whose channel was deleted, is rendered on the system-default channel in its default language.

- An operator who switches the e-mail off stops it: the subscriptions are consumed and nothing is sent. The fixed English text is sent only when no template definition exists for the code.
