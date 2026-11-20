# Contract: published ports

All types live in `packages/contracts/src/related-payers.ts` (and `orders.ts` for
`PaidOrderReadPort`), written **before** any implementation (Principle II). Consumers resolve them
with `lazyPort<T>(ctx, '<literal>')`; owners register them with `ctx.di.providePort`, so a call while
the owner is off answers `503 MODULE_DISABLED` (`specs/conventions/module-composition.md` items 2–4).
No consumer wraps a call in a bare `catch` (item 7).

## 1. `relatedPayerPolicyPort` — owner `related_payers`

Consumers: `orders` (`nonBindingDependencies`, `refuses-without`), `carts` (`degrades-without`).

```ts
export type PayerCommercialTerms = 'buyer' | 'payer';

export interface PayerPolicySubject {
  buyerOrganizationId: string;      // from the session / cart, never from a body
  customerAccountId: string;        // the person acting
  salesChannelId: string;           // the request's resolved channel
}

export interface UsablePayer {
  linkId: string;
  payerOrganizationId: string;
  payerName: string;
  payerTaxId: string;
  commercialTerms: PayerCommercialTerms;
  billingAddressIds: readonly string[];   // allowed ∩ live billing addresses of the payer
}

export interface RelatedPayerPolicyPort {
  /** Payers this person may order with now (FR-012 ∧ the person holds related_payers.order_with_payer). Empty when the capability is off on the channel. */
  usablePayers(subject: PayerPolicySubject): Promise<readonly UsablePayer[]>;
  /** Throws 422 RELATED_PAYER_NOT_USABLE when not usable; runs on the caller's transaction when given. */
  assertUsable(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
    opts?: { tx?: unknown; billingAddressId?: string },
  ): Promise<UsablePayer>;
  /** Y's allowed billing addresses, read under system scope after the link check (research R-5). */
  payerBillingAddresses(subject: PayerPolicySubject, payerOrganizationId: string): Promise<readonly AddressRecord[]>;
  /** The pricing subject for a cart in a payer's-terms context, or null (research R-4). */
  pricingContext(
    subject: PayerPolicySubject,
    payerOrganizationId: string,
  ): Promise<{ organizationId: string; customerGroupId: string | null } | null>;
  /** Cache-only, no database read: does the buyer hold any payer's-terms link at all? */
  hasPayerTermsLinks(buyerOrganizationId: string, salesChannelId: string): Promise<boolean>;
}
```

## 2. `relatedPayerWritePort` — owner `related_payers`

Consumer: deployment overlays (FR-030). Each call is one Command (`related_payers.link.create` /
`.revoke`) with actor kind `automation` and `origin_source = source`.

```ts
export interface AddPayerInput {
  buyerOrganizationId: string;
  payerOrganizationId: string;
  source: string;                       // ^[a-z0-9_.-]{1,64}$
  addressScope?: { kind: 'all' } | { kind: 'one'; billingAddressId: string };
  validFrom?: string | null;            // ISO-8601 instant with offset (RP-15)
  validTo?: string | null;              // ISO-8601 instant with offset (RP-15)
  commercialTerms?: PayerCommercialTerms;   // RP-11: allowed here
}
export interface RelatedPayerWritePort {
  /** Idempotent on an active link: answers it unchanged ({ created: false }). Refuses FR-010 violations with 422. */
  addPayer(input: AddPayerInput): Promise<{ linkId: string; created: boolean }>;
  /** Revokes the non-revoked link of the pair; { revoked: false } when there is none. */
  revokePayer(input: { buyerOrganizationId: string; payerOrganizationId: string; source: string }): Promise<{ revoked: boolean }>;
}
```

## 3. `paidOrderReadPort` — owner `orders`

Consumer: `related_payers` only. Implemented in `orders` under
`withSystemScope('orders: orders billed to a related payer', …)` with the predicate
`payer_organization_id = payerOrganizationId`. The caller has already checked the reader's
`related_payers.view_paid_orders` permission; the port does not know about it.

```ts
export interface PaidOrderReadPort {
  list(payerOrganizationId: string, query: PaidOrderListQuery): Promise<PaidOrderListPage>;
  /** null when the order does not name this payer — the caller answers 404. */
  find(payerOrganizationId: string, orderId: string): Promise<PaidOrderDetail | null>;
}
```

`PaidOrderDetail` is a read-only projection: business id, placed at, status label, buyer name, lines,
totals, billing snapshot, payer snapshot, delivery method name, invoice ids and numbers. It carries no
delivery address phone, no customer note and no comment thread.

## 4. Pricing-subject resolver slot — owner `@endora-commerce/platform/http`

```ts
export type PricingSubjectResolver = (input: {
  actor: Actor;
  salesChannelId: string;
}) => Promise<{ organizationId: string; customerGroupId: string | null } | null>;

/** Async twin of productAudienceOf: adds pricingOrganizationId when the slot answers. */
export function pricedAudienceOf(request: FastifyRequest): Promise<ProductAudience>;
```

One contributor (`carts`), `contributes-to`; the host calls it only while the contributor is
effectively present and treats a missing contributor as "no subject". `ProductAudience` gains
`readonly pricingOrganizationId?: string | null` (additive; visibility never reads it).

## 5. Changed existing contracts

- `placeOrderRequestSchema` (`orders.ts`): `payerOrganizationId: uuidSchema.optional()`; a
  `superRefine` refuses it with a non-empty `billingCompanyName` or `billingTaxId`
  (refused at validation: `400 VALIDATION_FAILED` with the issue `payer_billing_override_conflict`,
  FR-062, RP-16).
- Order shapes (customer, admin): `payer: { organizationId, name, taxId, terms } | null`.
- `OrderReturnContext`: `payerOrganizationId: string | null`.
- Cart shape: `buyingFor: { organizationId, name, terms } | null`; new
  `setCartBuyingForRequestSchema` / `cartRepricingSummarySchema` (FR-113).
- `ERROR_CODES`: `RELATED_PAYER_NOT_USABLE`, `RELATED_PAYER_REQUEST_LIMIT`,
  `RELATED_PAYER_REQUEST_DECIDED`, `RELATED_PAYER_LINK_EXISTS`, `RELATED_PAYER_INVALID_PAIR`.
