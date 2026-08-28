---
'@endora-commerce/contracts': minor
---

`receivePaymentRequestSchema` and `operatorProviderDetailsSchema` are new, and they bound what an
**operator** may write into `payments.provider_details`:

```ts
export const operatorProviderDetailsSchema: z.ZodType<
  Record<string, string | number | boolean | null>
>;
export const receivePaymentRequestSchema: z.ZodType<ReceivePaymentRequest>;
```

`receivePaymentRequestSchema` is `receivePaymentSchema` with `providerDetails` narrowed from
`z.record(z.string(), z.unknown())` to that flat scalar map — at most 50 entries, keys up to 64
characters, string values up to 1000. It is the body of `POST /api/v1/payments/receive`, whose
`providerDetails` was persisted verbatim into a JSON column that
`GET /api/v1/admin/orders/:id/payments` echoes back in full: any document, of any depth and any
size, chosen by the caller rather than by the schema.

A flat map rather than a named field set because the column has several authors — the key
vocabulary belongs to whichever adapter wrote the row — so enumerating keys here would claim an
ownership this route does not have. What it refuses is the part that makes an unbounded bag
dangerous.

`receivePaymentSchema` and `ReceivePayment` are **unchanged**. If you build a `ReceivePayment` in
code — every gateway integration does, with its own nested provider shapes — nothing about your
call changes. The bound applies to the HTTP body only, and `ReceivePaymentRequest` is assignable
to `ReceivePayment`, so a handler typed on the latter needs no edit.

`minor`: both exports are additive and no existing symbol changed shape.
