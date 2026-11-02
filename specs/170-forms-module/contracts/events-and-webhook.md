# Contract: domain events, the webhook payload and the anonymisation event

## §1 `forms.entry.submitted.v1` — the webhook payload (FR-064, FR-065)

```ts
// packages/contracts/src/forms.ts
export const FormEntrySubmittedEventV1Schema = z.object({
  eventId: z.string().min(1),
  occurredAt: isoDateTimeSchema,
  eventType: z.literal('forms.entry.submitted.v1'),
  entryId: z.string().uuid(),
  formId: z.string().uuid(),
  formKey: formKeySchema,
  formVersion: z.number().int().min(1),
  salesChannelId: z.string().uuid(),
  organizationId: z.string().uuid().nullable(),
  language: z.string().min(2).max(16),
  pageUrl: z.string().max(2048).nullable(),
  submittedAt: isoDateTimeSchema,
  /** Visible answers of fields this version marks "Share with integrations"; {} when none. */
  answers: z.record(formKeySchema, answerValueSchema),
}).strict();
```

- Emitted by the `forms.entry.submit` Command's `event()` → dispatched **once, on commit**; a rolled
  back submit emits nothing (Principle XIII). Never for a honeypot hit, a refusal or a spam
  classification (entries are never spam at creation; US8-3).
- **Never contains** internal notes, recipients, consent texts, `submitterEmail` (unless the e-mail
  field itself is marked shared), `customerAccountId`, search text.
- Contributed from a **contribution-only** boot hook:
  `lazyPort<WebhookEventRegistryPort>(ctx, 'webhookEventRegistry').register({ ownerModuleId: 'forms',
  eventType })` for each of `FORMS_WEBHOOK_EVENT_TYPES` — no presence probe (module-activation.md
  item 3; crm precedent). Manifest `nonBindingDependencies` entry `contributes-to` `webhooks`.
- `webhooks` offers and delivers the type only while `forms` is present (`list()`/`isDeliverable`).
- Delivery headers carry `X-Webhook-Event-Type`; the payload repeats it as `eventType` because the spec
  requires the payload to carry it.
- **Disclosed**: shared answers persist in `webhook_deliveries.payload` and in the delivery job until
  `webhooks` prunes them; the builder's flag help text and the docs say so.

Tests: `packages/contracts/src/forms.test.ts` (accept, strictness: an `internalNote` key is refused,
envelope required); `backend/test/integration/forms/webhook-event.test.ts` (event once per accepted
entry, none for honeypot/refusal, answers = shared ∩ visible of the entry's version, registry lists
the type only while present, delivered payload parses).

## §2 `forms.form.changed` — internal

`{ eventId, occurredAt, formId }`. Emitted on commit by publish, close, reopen, delete. Subscriber
(`ctx.subscribe`) posts `FORMS_STOREFRONT_CACHE_TAGS.form(formId)` through the module's
`StorefrontRevalidator` (never throws; logs). Not offered to webhooks.

## §3 `customer_account.anonymized.v1` — new, owned by `customer_accounts`

```ts
// packages/contracts/src/customer-accounts.ts
export const CUSTOMER_ACCOUNT_ANONYMIZED_EVENT = 'customer_account.anonymized.v1';
export const CustomerAccountAnonymizedEventV1Schema = z.object({
  eventId: z.string().min(1),
  occurredAt: isoDateTimeSchema,
  customerAccountId: z.string().uuid(),
  organizationId: z.string().uuid(),
}).strict();
```

- Emitted by `CustomerAccountLifecycleWritePort.anonymize` **after** its flush and audit, only on the
  transition (an already-anonymised account emits nothing), dispatched in a bus scope the caller
  awaits (`bus.run`, cms' precedent) so subscribers run within the sweep step.
- Not offered to webhooks in this feature.
- Consumer: `forms` (`ctx.subscribe`) → Command `forms.entries.erase_for_account` under
  `withSystemScope('forms: erase the entries of an anonymised customer account')`. A failure is
  logged and left to the maintenance reconciliation (research R-17 c) — it never fails the sweep.

Tests: `packages/modules/customer_accounts/src/backend/services/customer-account-lifecycle-ports.test.ts`
(emitted once, payload, not on a repeat); `backend/test/integration/forms/anonymisation.test.ts`
(entries + notes of the account gone in the same sweep; anonymous entries with the same e-mail kept;
another account's entries kept; with `forms` off the entries stay until the next maintenance tick
after reactivation, which deletes them).
