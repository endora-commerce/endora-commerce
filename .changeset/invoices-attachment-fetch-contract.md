---
'@endora-commerce/contracts': minor
---

The ERP attachment download seam is now `invoices`' own, and the imported document's source system is open

**If you implement or import `ComarchXlSaleDocumentAttachmentPort` or `COMARCH_XL_SALE_DOCUMENT_ATTACHMENT_PORT`, this release removes them.** The interface moves, unchanged in shape, to `InvoiceAttachmentFetchPort`, and a connector no longer publishes it under a container name of its own; it registers it into `invoices`' `invoiceAttachmentFetchRegistry` (`INVOICE_ATTACHMENT_FETCH_REGISTRY`) under the source system it imports from:

```diff
- import type { ComarchXlSaleDocumentAttachmentPort } from '@endora-commerce/contracts';
- ctx.di.providePort('comarchXlSaleDocumentAttachmentPort', …);
+ import type { InvoiceAttachmentFetchRegistryPort } from '@endora-commerce/contracts';
+ ctx.onBoot(() => {
+   lazyPort<InvoiceAttachmentFetchRegistryPort>(ctx, 'invoiceAttachmentFetchRegistry').register({
+     system: 'my_erp',        // the value your import writes into externalDocumentRef.system
+     moduleId: 'my_erp',      // your module id; its effective presence is read on every download
+     provider: { ensureAttachmentBytes: (input) => … },
+   });
+ });
```

New exports: `InvoiceAttachmentFetchPort`, `InvoiceAttachmentFetchRegistration`, `InvoiceAttachmentFetchRegistryPort` and `INVOICE_ATTACHMENT_FETCH_REGISTRY`.

**`externalDocumentRefSchema.system` is a non-empty string (at most 64 characters) instead of `z.literal('comarch_xl')`.** Every value that parsed before still parses; code that narrowed on the literal type now sees `string`.

**`ErpSaleDocumentAttachmentContext` gains a required `system: string`** — the imported document's `externalDocumentRef.system`. An implementation of `ErpSaleDocumentWritePort.resolveAttachmentContext` outside `@endora-commerce/mod-invoices` has to return it.
