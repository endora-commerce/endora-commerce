# Contract: public form API and the storefront handler

Two surfaces: the backend's public storefront API (the headless contract, FR-039) and the reference
storefront's no-JS handler. Shapes are Zod schemas in `packages/contracts/src/forms.ts`.

## §1 `GET /api/v1/storefront/forms/:formId` — public definition

- Owner `forms`, `ctx.routes` (`503 MODULE_DISABLED` while off). No auth. Ordinary sales-channel
  access rule. Query `language?`; else `Accept-Language`; constrained to the resolved channel's
  languages, else its default (R-12 step 2).
- **Always `200`** for a syntactically valid uuid (research R-11); `400` for a malformed id.
- `Cache-Control: public, max-age=0, s-maxage=60` (the storefront's Data Cache is the cache).

```ts
type PublicFormDefinition =
  | { formId: string; availability: 'unavailable' }                     // draft, deleted, never existed
  | {
      formId: string; key: string; version: number; language: string;
      availability: 'open' | 'closed' | 'not_yet_open' | 'full';
      signedInOnly: boolean;
      captcha: { provider: 'turnstile' | 'hcaptcha'; siteKey: string } | null;  // only when required AND configured
      texts: { title?: string; description?: string; submitLabel?: string;
               closed?: string; notYetOpen?: string; full?: string; signIn?: string; success?: string };
      sections: PublicSection[];   // definition minus shareWithIntegrations, texts resolved for `language`
      confirmation: { type: 'message' } | { type: 'redirect'; url: string } | { type: 'page'; path: string };
    };
```

`PublicSection`/`PublicField` = `data-model.md` §3 with every text replaced by its resolved string
(field `label`, `placeholder`, `help`, `content`, option `label`s, part labels, operator error
overrides as `errors: Partial<Record<FormFieldErrorCode, string>>`). **Never present**: recipients,
channel recipients, retention, counts, `shareWithIntegrations`, the CAPTCHA secret, notes, the
working copy. `confirmation.type === 'page'` is resolved to the page's logical path in `language`
through `cmsPageReadPort.findStorefrontLinks` while `cms` is present; otherwise, or when the channel
does not serve the page, it degrades to `{ type: 'message' }` (FR-038, R-2).

## §2 `POST /api/v1/storefront/forms/:formId/entries` — submit

- Owner `forms`, `ctx.routes`. No auth required; a `b2b_session` cookie attributes the entry
  (Principle XI review). `bodyLimit: 262144`. Rate limit `{ max: 10, timeWindow: '10 minutes',
  keyGenerator: r => \`forms-submit:${r.ip}\` }`.
- Body (`.strict()`):

```ts
{
  values: Record<string, string | string[]>;   // raw posted values by field key / "<key>.<part>"
  pageUrl?: string;                            // same-origin path + query, ≤ 2048, ^\/(?!\/)
  hp?: string;                                 // honeypot; non-empty ⇒ accepted, nothing done
  captchaToken?: string;                       // ≤ 4096
}
```

- Answers:

| Status | Body | When |
| --- | --- | --- |
| `201` | `{ status: 'accepted', confirmation: { type: 'message', message } \| { type: 'redirect', url } \| { type: 'page', path } }` | accepted, **and** honeypot hits (indistinguishable) |
| `400` | `FORM_SUBMISSION_INVALID`, `details.fields: { fieldKey, code, message }[]` | contract validation (messages in the submission language, operator overrides applied) |
| `400` | `FORM_CAPTCHA_FAILED` | provider says no / token missing |
| `409` | `FORM_NOT_ACCEPTING`, `details.code` ∈ `closed`, `not_yet_open`, `full`, `sign_in_required`, `unavailable` | restrictions, status, draft/deleted |
| `413` | `FORM_SUBMISSION_TOO_LARGE` | body over the limit |
| `429` | platform `RATE_LIMITED` | rate limit |
| `503` | `FORM_CAPTCHA_UNAVAILABLE` | provider unreachable (retryable, `Retry-After: 30`) |
| `503` | `MODULE_DISABLED` | module off |

No refused submission stores, sends or publishes anything (FR-034).

## §3 Storefront handler `POST /forms/submit` (`storefront/app/forms/submit/route.ts`)

- `forms` absent (`getModulePresence().isPresent('forms')` false) → `404`.
- `content-length` > 262 144 → outcome `error`/`too_large` without parsing.
- Reads the `multipart/form-data` or `application/x-www-form-urlencoded` body: `formId` (uuid),
  `blockId` (`^[A-Za-z0-9_-]{1,64}$`), `returnTo` (same-origin path — `safeReturnTo` of F-4),
  `anchor` (`SECTION_ANCHOR_RE`), `hp_extra`, `cf-turnstile-response` / `h-captcha-response`, every
  other entry as `values` (repeated names → arrays).
- Calls §2 through `storefront/lib/api/forms.ts` `submitFormEntry({ formId, body, channelCode,
  locale, sessionCookie, forwardedFor })` (`apiMutate` with `sessionCookie` and `x-forwarded-for`).
- **JSON mode** (`Accept: application/json`): answers `200 { status: 'accepted', confirmation }` or
  `400 { error: 'invalid', fields } | { error: 'captcha' } | { error: 'not_accepting', reason }`,
  `429 { error: 'rate_limited' }`, `503 { error: 'captcha_unavailable' }` (the CAPTCHA provider
  could not be reached — retryable), `503 { error: 'unavailable' }`. `Cache-Control: no-store`.
- **No-JS mode**: `303` with a relative `Location`:
  - accepted, `message` → `<returnTo>?formsBlock=<blockId>&formsOutcome=accepted#<anchor>`;
  - accepted, `redirect` → the URL; `page` → the localised page path (`localizePath`);
  - refused → `<returnTo>?formsBlock=<blockId>&formsOutcome=error&formsReason=<invalid|captcha|
    captcha_unavailable|not_accepting|rate_limited|unavailable|too_large>&formsAttempt=<id>#<anchor>`, and for
    `invalid` the `forms_attempt` cookie of research R-10.
- Every key the handler owns (`formsBlock`, `formsOutcome`, `formsReason`, `formsAttempt`) is
  removed from `returnTo` before it adds its own; `contact`/`form` (169) are left alone.

## §4 Tests

- `backend/test/contract/forms/forms-public.contract.test.ts` — every row of §1/§2, the strictness of
  §2's body, the absence list of §1, rate limiting (429 on the 11th), body limit (413).
- `storefront/test/forms/forms-submit-route.test.ts` — 404 while absent, JSON and 303 modes, every
  outcome, cookie set only on `invalid`, budget truncation, query-key hygiene, session cookie and
  `x-forwarded-for` forwarded, `/forms/contact` untouched.
- `storefront/test/forms/forms-api.test.ts` — the client maps statuses to outcomes, tags and
  revalidate on the GET.
