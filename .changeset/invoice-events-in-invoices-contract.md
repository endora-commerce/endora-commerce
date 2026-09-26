---
'@endora-commerce/contracts': minor
---

`invoiceIssuedEventSchema`, `invoiceCorrectedEventSchema`, `InvoiceIssuedEvent` and `InvoiceCorrectedEvent` are declared in the invoices contract

The payload schemas of `invoice.issued.v1` and `invoice.corrected.v1` belong to the module that raises those events, so they moved from `@endora-commerce/contracts/ksef` to `@endora-commerce/contracts/invoices`. The shapes are unchanged.

An import from the package root (`@endora-commerce/contracts`) keeps working. An import from the subpath has to change:

```ts
// before
import { invoiceIssuedEventSchema } from '@endora-commerce/contracts/ksef';
// after
import { invoiceIssuedEventSchema } from '@endora-commerce/contracts/invoices';
```

`minor` rather than `patch` because the `./ksef` subpath no longer exports the four names.
