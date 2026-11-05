# Contract: public API (anonymous)

Source of truth: Zod schemas in `packages/contracts/src/organization-registry-lookup.ts` and
`packages/contracts/src/organizations.ts` (Principle II). Owner: `organizations`. All three routes
are registered through the module's `ctx.routes` and carry `config: { salesChannelAccess: 'open' }`
(a business may apply on a store closed to anonymous visitors, `specs/154-sales-channel-access/`).
None is channel-scoped.

---

## 1. `GET /api/v1/organizations/registration-options`

Always answers `200`.

```ts
export const registrationOptionsResponseSchema = z.object({
  data: z.object({
    registryLookup: z.object({
      enabled: z.boolean(),
      /** Countries the lookup serves; `[]` when disabled. ISO alpha-2 as the form's picker sends it (GR, not EL). */
      countries: z.array(z.string().length(2)),
    }),
  }),
});
```

`enabled` is `organizations.registration.registry_lookup_enabled`, read fail-closed.

**The Polish-sources mode (`registry_lookup_pl_sources`) is deliberately not exposed**, and
`countries` contains `PL` in every mode (research R-11): the storefront needs nothing from the mode —
each lookup answer names its own `source`, and `vatStatus: 'unknown'` is rendered the same way
whatever caused it. The storefront
caches this under the Next tag `organizations:registration-options` (300 s); the backend revalidates
the tag when either registration setting changes.

---

## 2. `POST /api/v1/organizations/registry-lookup`

**Route config**: `rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: r =>
'org-registry-lookup:' + r.ip }`, `salesChannelAccess: 'open'`. Response header
`Cache-Control: no-store`.

### Request

```ts
export const registryLookupRequestSchema = z.object({
  /** As typed: spaces, dashes, dots and an EU prefix are accepted. */
  taxId: z.string().trim().min(1).max(32),
  /** The country chosen in the form; an EU prefix in `taxId` overrides it. */
  country: z.string().length(2).transform((c) => c.toUpperCase()),
});
```

### Response `200`

```ts
export const registryLookupStatusSchema = z.enum([
  'found', 'not_found', 'unavailable', 'invalid_tax_id', 'unsupported_country',
]);
export const registryVatStatusSchema = z.enum(['active', 'exempt', 'not_registered', 'unknown']);
export const registryActivityStatusSchema = z.enum(['active', 'ceased', 'unknown']);
export const registrySourceSchema = z.enum(['gus', 'mf', 'vies']);
export const registryLookupIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const registryLookupResponseSchema = z.object({
  data: z.object({
    status: registryLookupStatusSchema,
    /** Present for found / not_found / unavailable; send it back on registration. */
    lookupId: registryLookupIdSchema.nullable(),
    /** The normalised identifier the lookup used, e.g. "5260250995"; null when invalid. */
    normalizedTaxId: z.string().nullable(),
    /** The country the lookup used (an EU prefix may have changed it). Picker form: GR, not EL. */
    country: z.string().length(2),
    /** The registry the company data came from; null unless found. */
    source: registrySourceSchema.nullable(),
    company: z
      .object({
        legalName: z.string().nullable(),
        /** Field names match `registerOrganizationRequestSchema.organization.registeredAddress`. */
        registeredAddress: z.object({
          street: z.string().nullable(),
          postalCode: z.string().nullable(),
          city: z.string().nullable(),
          country: z.string().length(2),
        }),
        regon: z.string().nullable(),
        vatStatus: registryVatStatusSchema,
        activityStatus: registryActivityStatusSchema,
      })
      .nullable(),
    fetchedAt: isoDateTimeSchema.nullable(),
  }),
});
```

| `status` | `company` | `lookupId` | Registries contacted |
| --- | --- | --- | --- |
| `found` | set | set | per research R-3 (or none, from cache) |
| `not_found` | `null` | set | yes (or cache) |
| `unavailable` | `null` | set | tried, or refused by budget / Redis |
| `invalid_tax_id` | `null` | `null` | **none** |
| `unsupported_country` | `null` | `null` | **none** |

**`source` per Polish-sources mode** (non-Polish lookups are always `vies`):

| Mode | Possible `source` on `found` | `company.vatStatus` |
| --- | --- | --- |
| `gus_mf` | `gus` (GUS supplied the data) or `mf` (White List fallback) | from the White List; `unknown` if its leg failed or was over budget |
| `gus` | `gus` only | always `unknown` |
| `mf` | `mf` only | from the White List |

Under `gus`, a Polish lookup with GUS not configured, failing or over budget answers
`status: 'unavailable'` (with a `lookupId`) and contacts nothing else.

`status: 'found'` with `company.vatStatus: 'exempt' | 'not_registered'` or
`company.activityStatus: 'ceased'` is still `found`; the client words it (storefront-ux §3).

The response never says whether the tax ID belongs to an Organization on this platform, and never
carries attempts, error kinds, the GUS session or anything else not listed here.

### Errors

| Status | Code | When |
| --- | --- | --- |
| `400` | `VALIDATION_ERROR` | body fails the request schema |
| `404` | the platform's unknown-route answer, byte-identical | `registry_lookup_enabled` is off |
| `429` | `RATE_LIMITED` | over the per-client limit |

No new error code.

### Behaviour (normative)

1. Toggle read first; off → `404` before anything else.
2. Normalise (research R-17); invalid / unsupported → answer with no Redis and no registry access.
3. Read the Polish-sources mode (PL only; fail-closed to `gus_mf`). Answer cache read; hit → mint
   ticket, answer (`fromCache: true` in the ticket).
4. Miss → run the legs the Polish-sources mode selects (research R-3; non-PL: VIES only), each
   guarded by its budget (R-7) and timeout — an excluded registry is neither called nor charged;
   merge; write the answer cache (keyed by country, mode and tax ID) with the TTL of its status;
   mint ticket; answer.
5. A Redis error at any step → `status: 'unavailable'`, `lookupId: null`.
6. Total handler time ≤ 8 s.

---

## 3. `POST /api/v1/organizations/register` — extended

`registerOrganizationRequestSchema` gains one optional **top-level** member:

```ts
registryLookupId: registryLookupIdSchema.optional(),
```

Not inside `organization`: `AdminOrganizationCreateBodySchema` is derived from
`registerOrganizationRequestSchema.shape.organization` and must not accept it.

Response, status codes and errors unchanged. Behaviour added (research R-13):

- toggle on **and** ticket present **and** ticket's normalised `(country, taxId)` equals the
  submission's normalised `(organization.registeredAddress.country, organization.taxId)` → one
  `OrganizationTaxIdValidation` row with `origin: 'registration'` in the registration's
  transaction, Organization summary stamped, ticket deleted after commit;
- otherwise nothing extra; the registration never fails, waits or contacts a registry because of
  the reference.

---

## 4. Headless parity

A third-party storefront implements the same flow with these three calls; the reference
storefront uses nothing else. The lookup's codes (`status`, `vatStatus`, `activityStatus`,
`source`) are machine tokens the client translates (research R-18).
