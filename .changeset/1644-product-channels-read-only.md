---
'@endora-commerce/mod-sales-channels': patch
---

The product editor's Channels tab is read-only for an operator without `catalog:write` or `sales_channels:write` (issue #1644). It lists the product's channels and shows no channel picker, no *Add*, no *Remove* and no "Applies immediately" badge. Before, every operator saw these controls, and the server refused the write only after the click. `EntityChannelMembership` takes a new optional `readOnly` prop.
