---
---

`@endora-commerce/mod-returns` changes nothing it publishes in this branch, so nothing is
released by it.

What it removes is four files reachable through **no** `exports` subpath:
`src/backend/ports/{corrective-invoice,credit-topup,order-return-context,payment-refund}.port.ts`.
Each was a type-only re-export of declarations that moved to `@endora-commerce/contracts` in
feature 075's Phase P, and each said so in its own header — *"re-exported here for the length of
Phase P"*. The `./backend` barrel never named them, so a consumer could reach them only by a deep
filesystem path into the package's sources, which the `exports` map already refuses.

For a consumer, the four interfaces are where they have been since Phase P and where D-171 says
they belong:

```ts
import type {
  CorrectiveInvoicePort,
  CreditTopupPort,
  OrderReturnContextPort,
  PaymentRefundPort,
} from '@endora-commerce/contracts';
```

They do **not** move to a `./ports` subpath, and `@endora-commerce/mod-returns` declares none.
D-171's test is *"does this signature stop the interface living in `packages/contracts`"*, and
for all four the answer is no — they name no MikroORM type and are contract DTOs end to end.
`invoices`' and `payments`' own `ports/index.ts` headers say exactly that about
`CorrectiveInvoicePort` and `PaymentRefundPort` by name.
