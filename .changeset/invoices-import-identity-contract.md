---
'@endora-commerce/contracts': minor
---

An ERP-imported sale document is identified by `(system, externalId)`, and the import contract names no vendor

**If you call `ErpSaleDocumentWritePort.upsertImportedDocument`, rename three fields.** The source system's own document id, document number and attachment id lose their `xl` prefix:

```diff
  externalDocumentRef: {
    system: 'my_erp',
-   xlSaleDocumentId: doc.id,
-   xlDocumentNumber: doc.number,
+   externalId: doc.id,
+   externalNumber: doc.number,
    documentKind: 'invoice',
  },
  attachments: doc.attachments.map((a) => ({
-   xlAttachmentId: a.id,
+   externalAttachmentId: a.id,
    fileName: a.fileName,
  })),
```

**`externalDocumentRefSchema.externalId` is required and non-empty** (at most 128 characters); `xlSaleDocumentId` accepted an empty string. A reference that carries only `xlSaleDocumentId` no longer parses.

**`ErpSaleDocumentAttachmentContext`** — what `resolveAttachmentContext` answers — carries `externalId` and `externalAttachmentId` in place of `xlSaleDocumentId` and `xlAttachmentId`.

The pair is the identity: the same `externalId` from another `system` is another document. The Comarch XL vendor schemas in `comarch-xl.ts` keep their `xl*` names, which describe Comarch XL's own API.
