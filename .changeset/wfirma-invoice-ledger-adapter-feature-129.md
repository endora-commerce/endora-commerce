---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-invoice-ledger': minor
'@endora-commerce/mod-wfirma': minor
---

wFirma invoice-ledger adapter (`specs/131-wfirma-integration/`): a second vendor on the
existing ledger, with no schema of its own.

**`@endora-commerce/mod-wfirma`** is a new switchable module package — connection screen and
credential type, synchronous VAT copy, corrections, paid alignment, webhook ingress and a
BullMQ delivery worker, plus KSeF delegation when the ledger's routing setting says `vendor`.
Subpaths: `.`, `./backend`, `./admin`, `./tailwind.css`. Ships `i18n/` (`en`, `pl`) and its
operator documentation under `docs/`. Activation is `wfirma.activation`, default off; while
off it performs no wFirma HTTP, its screens and palette entry are gone and the webhook
answers 503.

**`@endora-commerce/contracts`** adds `wfirma.ts` (admin and wire schemas, `WfirmaHttpPort`,
the two `WFIRMA_*` error codes) and extends `invoice-ledger.ts`: `wfirma` joins
`INVOICE_LEDGER_MODULES`, and `InvoiceLedgerDeliveryPort.markAwaitingRemote` /
`markSucceeded` take an optional `remoteVendorNumber`, which `LedgerDeliveryRecord` and
`InvoiceLedgerDeliveryAttempt` now carry. Both port changes are additive — an existing
implementation keeps compiling and an existing caller keeps its behaviour.

**`@endora-commerce/mod-invoice-ledger`** implements those two fields: the vendor's own
document number is recorded on the succeeding attempt and projected onto the record, and
`markAwaitingRemote` may now also stamp the remote document id and the document map, which a
vendor that assigns a number before the document is final needs.

This changeset is written by the reviewer, not by the branch's author: the branch carried
none, and `check:release-intent --since` refuses it on two counts —
`manifest-changed-beyond-version` for the new package's manifest and
`unattributed-package-change` relaying `changeset status`' own exit 1.
