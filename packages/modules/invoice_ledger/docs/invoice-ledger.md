---
title: Invoice ledger
description: Shared vendor mutex, numbering and KSeF routing, and durable invoice deliveries for ledger adapters.
---

# Invoice ledger

The `invoice_ledger` module owns the shared rails every accounting adapter uses: mutual exclusion so only one vendor is operator-active, numbering and KSeF routing settings, client and document maps, deliveries, and webhook receipts.

Vendor adapter modules own the HTTP to their vendor. This module calls no vendor.

## Operators

- **Invoice ledger** in Sales opens deliveries. Routing is a tab on the same strip.
- A vendor adapter module adds its connection tab when that adapter is on.
- Routing (Endora vs vendor numbering, native vs vendor KSeF) is a confirmed write.
- Switching a vendor adapter off hides its tab. Delivery history on this module stays.
- Switching Invoice ledger off on `/platform/modules` also switches off every active adapter. Adapters cannot be switched on again until the ledger is on. Switching the ledger back on leaves adapters off.

## Engineers

Schema lives here. A vendor adapter ships no migration of its own. Invoice ids on maps and deliveries are UUIDs with no foreign key to the invoices module.
