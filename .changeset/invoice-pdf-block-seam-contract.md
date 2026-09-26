---
'@endora-commerce/contracts': minor
---

Add the contributed invoice PDF block contract: `InvoicePdfBlockRegistration`, `InvoicePdfBlockRegistryPort`, `InvoiceTemplateBlockDescription` and `InvoiceTemplateBlockField`

A module that declares an invoice template block now renders, describes and enriches it itself, by registering an `InvoicePdfBlockRegistration` into `invoices`' `invoicePdfBlockRegistry` from its composition root:

```ts
lazyPort<InvoicePdfBlockRegistryPort>(ctx, 'invoicePdfBlockRegistry').register({
  name: 'acme.InvoiceStamp', // `<moduleId>.<LocalName>`, as your manifest declares it
  moduleId: 'acme',
  describe: () => ({ label: 'Stamp', fields: {} }),
  resolve: (invoiceId) => loadStampData(invoiceId), // optional, read once per render
  render: ({ props, invoice, locale, resolved }) => ({ text: '…' }), // one pdfmake content node
});
```

Additive only; nothing existing changes shape. `minor` because it is new published surface.
