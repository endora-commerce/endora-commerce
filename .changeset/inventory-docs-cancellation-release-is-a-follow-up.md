---
'@endora-commerce/mod-inventory': patch
---

The module page this package ships describes how a cancellation gives stock back as it works since
`0.103.0`. It named `OrderService.releaseAllocations` as what a cancellation runs; a cancellation
now owes the release as a follow-up that `orders` records with the status, attempts at once and
retries until it completes, and that waits while `inventory` is switched off. The page also names
the port that performs the write, `InventoryReservationApplyPort.releaseForOrderItems`. No code
changes.
