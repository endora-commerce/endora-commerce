---
'@endora-commerce/mod-payments': patch
---

Removed unused internal code from `payments` (issue #1342): the `BankTransferDriver`, `PickupDriver` and `GatewayAdapterPort` files in `src/backend/drivers/`. Nothing used them, and the package never exported them. Bank-transfer, pickup and gateway payments still run through the built-in payment adapters, so nothing changes at runtime. A comment that pointed to a non-existent "integrations module" now says where a payment-gateway adapter comes from.
