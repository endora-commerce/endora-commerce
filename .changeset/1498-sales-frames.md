---
'@endora-commerce/mod-orders': patch
'@endora-commerce/mod-quote-requests': patch
---

Sales screens draw no frame inside a card (UX audit SALES-13, #1498). On the order detail, the comments tab lists the comments as rows divided by a rule. The quote-request history tab does the same with its entries. Neither draws a bordered box per item any more. On order create, a new address's fields sit in the Parties card with no frame around them. The order's comment and note boxes use the kit `Textarea`.
