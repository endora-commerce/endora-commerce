---
'@endora-commerce/mod-orders': patch
---

A refused admin-created order (issue #1937) no longer leaves its inline addresses in the Organization's address
book. An address typed on the create-order form with "save to address book" was written before the
basket and placement checks ran, and only the one-time addresses were removed when the order was
refused, so every refused attempt added a saved address to the book. Now a refused order removes
every inline address it wrote; a placed order keeps the saved ones, as before.
