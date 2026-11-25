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
- Routing (Endora vs vendor numbering, native vs vendor KSeF) is a confirmed write. A write that changes the stored numbering mode without `confirm: true` is refused with `400 INVOICE_LEDGER_NUMBERING_CHANGE_UNCONFIRMED` (`details.field: "confirm"`, `from`, `to`), and the operator reads the sentence in their own language. This also happens when another operator changed the mode after the page loaded. The code was `400 VALIDATION_FAILED` until issue #644.
- Switching a vendor adapter off hides its tab. Delivery history on this module stays.
- Invoice ledger cannot be switched off on `/platform/modules`: it is non-deactivatable, because its registry is what refuses a second vendor adapter while one is already active (`INVOICE_LEDGER_VENDOR_ALREADY_ACTIVE`). Switch the active adapter off first to change vendors.

## Engineers

Schema lives here. A vendor adapter ships no migration of its own. Invoice ids on maps and deliveries are UUIDs with no foreign key to the invoices module.

## When organizations are merged {#when-organizations-are-merged}

The organization that stays keeps its own client mapping in the accounting system for each
adapter and credential; a mapping only the duplicate had is adopted, and one that conflicts
stays with the duplicate and is listed in the merge preview. Document mappings move to the
organization that stays; the delivery history stays as it was recorded. See *Merging duplicate
organizations* in the Organizations documentation.
