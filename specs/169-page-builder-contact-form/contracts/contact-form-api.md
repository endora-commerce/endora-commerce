# Contract: contact-form submission (feature 169, WP-C)

Two HTTP surfaces and one Zod schema shared by both. The schema is the source of truth
(Principle II); it lives in `packages/contracts/src/cms-contact-form.ts` and is exported from
`packages/contracts/src/index.ts`.

## 1. Zod schema

```ts
import { z } from 'zod';

export const CONTACT_FORM_LIMITS = {
  name: 200,
  email: 320,
  phone: 50,
  company: 200,
  subject: 200,
  choiceLabel: 120,
  choice: 200,
  message: 5000,
  pagePath: 2048,
  honeypot: 500,
} as const;

/** One line of text: trimmed, no CR/LF/other control characters, at most `max`. */
const line = (max: number) =>
  z.string().trim().max(max).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), { message: 'single_line' });

/** Optional single line: '' reads as absent. */
const optionalLine = (max: number) =>
  line(max).optional().transform((v) => (v === undefined || v === '' ? undefined : v));

export const contactFormSubmissionSchema = z.object({
  email: z.string().trim().max(CONTACT_FORM_LIMITS.email).email(),
  message: z
    .string()
    .trim()
    .min(1)
    .max(CONTACT_FORM_LIMITS.message)
    // Line breaks allowed; other control characters refused.
    .refine((v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v), { message: 'control_character' }),
  privacyConsent: z.literal(true),
  marketingConsent: z.boolean().optional(),
  name: optionalLine(CONTACT_FORM_LIMITS.name),
  phone: optionalLine(CONTACT_FORM_LIMITS.phone),
  company: optionalLine(CONTACT_FORM_LIMITS.company),
  subject: optionalLine(CONTACT_FORM_LIMITS.subject),
  /** The label of the editor's select ("Region") and the picked option's label. Both or neither. */
  choiceLabel: optionalLine(CONTACT_FORM_LIMITS.choiceLabel),
  choice: optionalLine(CONTACT_FORM_LIMITS.choice),
  /** The storefront path the form was sent from (no origin). */
  pagePath: z
    .string()
    .max(CONTACT_FORM_LIMITS.pagePath)
    .regex(/^\/(?!\/)[^\s\\]*$/)
    .optional(),
  /** Honeypot — must be empty; filled answers success and sends nothing. */
  website: z.string().max(CONTACT_FORM_LIMITS.honeypot).optional(),
}).strict().refine((v) => (v.choice === undefined) === (v.choiceLabel === undefined), {
  path: ['choice'],
  message: 'choice_pair',
});

export type ContactFormSubmission = z.infer<typeof contactFormSubmissionSchema>;

export const contactFormSubmissionResponseSchema = z.object({ status: z.literal('sent') });
export type ContactFormSubmissionResponse = z.infer<typeof contactFormSubmissionResponseSchema>;
```

`.strict()` refuses unknown keys (a client cannot inject a recipient or a header). The schema is the
**server's** minimum: email + message + privacy consent, whatever the block's "required" flags say
(FR-018). The block's own required flags are enforced client-side and by the storefront handler.

## 2. Backend: `POST /api/v1/storefront/cms/contact-form`

- Owner `cms`, registered in `packages/modules/cms/src/backend/routes.storefront.ts` (through
  `ctx.routes`, so `cms` off → `503 MODULE_DISABLED`).
- Auth: none (public). Channel: `getResolvedChannel(request)`; ordinary sales-channel access rule
  (a channel closed to anonymous visitors refuses it as it refuses its pages).
- Rate limit: `config: { rateLimit: { max: 10, timeWindow: '10 minutes', keyGenerator: (r) =>
  \`cms-contact:${r.ip}\` } }`.
- Body: `application/json`, `contactFormSubmissionSchema`.

| Outcome | Status | Body |
| --- | --- | --- |
| Sent to ≥ 1 recipient (incl. console driver `logged`) | 200 | `{ data: { status: 'sent' } }` |
| Honeypot filled | 200 | `{ data: { status: 'sent' } }` (nothing sent) |
| Schema refused | 400 | error envelope `VALIDATION_FAILED`, `details` per field |
| No recipients for the channel | 409 | `CMS_CONTACT_FORM_UNAVAILABLE` |
| Every recipient's send threw | 500 | `INTERNAL` envelope (no transport detail) |
| Rate limited | 429 | the platform's rate-limit envelope |
| `cms` off | 503 | `MODULE_DISABLED` |

Never echoes the submitted values; never returns the recipients.

## 3. Storefront: `POST /forms/contact`

`storefront/app/forms/contact/route.ts`, the `newsletter.Signup` handler's shape
(`storefront/app/newsletter/subscribe/route.ts`).

Request: `application/x-www-form-urlencoded` or `multipart/form-data` from the block's form.

| Field | Meaning |
| --- | --- |
| `name`, `email`, `phone`, `company`, `subject`, `choice`, `choiceLabel`, `message` | as the schema |
| `privacyConsent`, `marketingConsent` | `on` when ticked |
| `website` | honeypot |
| `required` | repeated; the block's required field keys (`name`, `phone`, `company`, `subject`, `choice`) — checked here, not by the backend |
| `returnTo` | same-origin path to come back to (sanitised as in the newsletter handler) |
| `anchor` | the enclosing section's anchor (`SECTION_ANCHOR_RE`) |
| `form` | the block id (`^[A-Za-z0-9_-]{1,64}$`) |

Steps:

1. `getModulePresence().isPresent('cms')` else `404`.
2. Build the submission (`pagePath` = `returnTo`'s path), check the block's `required` keys, then
   `contactFormSubmissionSchema.safeParse`. Refused → `error: 'invalid'`.
3. `POST /api/v1/storefront/cms/contact-form` with the request's channel headers and
   `x-forwarded-for` copied from the incoming request. Map: 200 → sent; 400 → `invalid`;
   409/429/5xx/network → `unavailable`.
4. Sent, `marketingConsent` ticked and `getModulePresence().isPresent('newsletter')` →
   `subscribeNewsletter({ email, channelCode, source: 'cms-contact-form' })`; a failure is logged
   and does not change the outcome.
5. Answer:
   - `Accept: application/json` → `200 { status: 'sent' }` or `400 { error: 'invalid' | 'unavailable' }`;
   - otherwise `303` to `returnTo` with `?contact=sent` or `?contact=error&reason=invalid|unavailable`,
     plus `&form=<block id>`, and `#<anchor>`; `Cache-Control: no-store`.

## 4. Mailer contract change

`packages/contracts/src/email.ts`, `EmailMailerSendInput`:

```ts
/** Feature 169 — the Reply-To header; absent: none. Never written to the delivery record. */
replyTo?: string;
```

`SmtpMailer` passes it as nodemailer's `replyTo`; `ConsoleMailer` logs it beside `to`;
`RecordingMailer` passes it through untouched and leaves it out of `contextOf`.
