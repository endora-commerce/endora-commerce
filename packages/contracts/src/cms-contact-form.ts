import { z } from 'zod';

/**
 * Feature 169 — the contact form's submission (`specs/169-page-builder-contact-form/`
 * contracts/contact-form-api.md §1, FR-017, FR-018).
 *
 * One schema for both hops: the storefront handler checks a posted form against it before it
 * calls the backend, and the backend's public endpoint
 * (`POST /api/v1/storefront/cms/contact-form`) checks the body again, because the endpoint is
 * public and a client other than the reference storefront may call it.
 *
 * It is the **server's** minimum — an e-mail, a message and the privacy consent — whatever the
 * `cms.ContactForm` block's own "required" switches say; those are enforced by the block and the
 * storefront handler. `.strict()` refuses an unknown key, so nothing a client sends can name a
 * recipient or a header: the recipients are a per-channel setting the server reads itself.
 */
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

/**
 * The most addresses `cms.contact_form_recipients` holds per sales channel: one send per
 * recipient happens inside the shopper's request (plan § Rejected — a queue).
 */
export const CONTACT_FORM_MAX_RECIPIENTS = 10;

/** An e-mail address as the contact form takes it — the submitter's and every recipient's. */
export const contactFormEmailSchema = z.string().trim().max(CONTACT_FORM_LIMITS.email).email();

/** Any C0 control character or DEL. */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** A control character other than a line break or a tab. */
function hasNonLayoutControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/** One line of text: trimmed, no CR/LF/other control character, at most `max`. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !hasControlCharacter(value), { message: 'single_line' });

/** An optional single line: `''` reads as absent. */
const optionalLine = (max: number) =>
  line(max)
    .transform((value) => (value === '' ? undefined : value))
    .optional();

export const contactFormSubmissionSchema = z
  .object({
    email: contactFormEmailSchema,
    message: z
      .string()
      .trim()
      .min(1)
      .max(CONTACT_FORM_LIMITS.message)
      // Line breaks allowed; other control characters refused.
      .refine((value) => !hasNonLayoutControlCharacter(value), { message: 'control_character' }),
    privacyConsent: z.literal(true),
    marketingConsent: z.boolean().optional(),
    name: optionalLine(CONTACT_FORM_LIMITS.name),
    phone: optionalLine(CONTACT_FORM_LIMITS.phone),
    company: optionalLine(CONTACT_FORM_LIMITS.company),
    subject: optionalLine(CONTACT_FORM_LIMITS.subject),
    /** The label of the editor's select (for example "Region") and the picked option's label. Both or neither. */
    choiceLabel: optionalLine(CONTACT_FORM_LIMITS.choiceLabel),
    choice: optionalLine(CONTACT_FORM_LIMITS.choice),
    /** The storefront path the form was sent from, without an origin. */
    pagePath: z
      .string()
      .max(CONTACT_FORM_LIMITS.pagePath)
      .regex(/^\/(?!\/)[^\s\\]*$/)
      .optional(),
    /** Honeypot — must be empty; a filled one is answered as sent and nothing is sent. */
    website: z.string().max(CONTACT_FORM_LIMITS.honeypot).optional(),
  })
  .strict()
  .refine((value) => (value.choice === undefined) === (value.choiceLabel === undefined), {
    path: ['choice'],
    message: 'choice_pair',
  });

export type ContactFormSubmission = z.infer<typeof contactFormSubmissionSchema>;

/** The endpoint's answer, inside the platform's `{ data }` envelope. */
export const contactFormSubmissionResponseSchema = z.object({ status: z.literal('sent') });
export type ContactFormSubmissionResponse = z.infer<typeof contactFormSubmissionResponseSchema>;
