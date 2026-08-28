---
'@endora-commerce/mod-orders': minor
'@endora-commerce/mod-payments': minor
---

`orders` and `payments` are module packages. Each publishes a root export (its
manifest) and `./backend` (`registerModule` plus its `entities` array);
`mod-orders` also publishes `./migrations` and a type-only `./ports`.

**`mod-payments` publishes no `./ports`, and the interface you are looking for is
on `mod-orders`.** `PaymentPlacementApplyPort` and `PaymentOpened` are declared by
`@endora-commerce/mod-orders/ports` even though `payments` is what implements and
registers them:

```diff
-import type { PaymentPlacementApplyPort } from '@endora-commerce/mod-payments/ports';
+import type { PaymentPlacementApplyPort } from '@endora-commerce/mod-orders/ports';
```

The reason is structural rather than stylistic, and it is worth knowing if you are
writing a module of your own that pairs with another. The two modules reach each
other — order placement opens a payment row inside the order's transaction, and a
gateway settlement stamps the order's payment status inside the payment's — so
only one of the two npm edges can exist: a mutual devDependency between two module
packages is a build **deadlock** rather than a race, because every package build
sets `noEmitOnError`, so the side that loses emits nothing and the side that would
have won never gets the `.d.ts` it is waiting for. The declaration therefore goes
to the module the other names in its manifest `dependencies` — here `orders`,
because `payments` declares it — which is the direction that adds no claim the
manifest does not already make.

Nothing about the seam itself changed: the container name is still
`paymentPlacementApplyPort`, `payments` still provides it with a typed
`providePort<T>` and still names it at its `implements` clause, and the
`payments.order_id -> orders.id` foreign key that makes the call co-transactional
is untouched. Resolve it exactly as before:

```ts
const placement = lazyPort<PaymentPlacementApplyPort>(ctx, 'paymentPlacementApplyPort');
```

`OrderPaymentStatusApplyPort` is on `@endora-commerce/mod-orders/ports` too, where
it has always been, and is `orders`' own.
