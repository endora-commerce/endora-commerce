import { describe, expect, it } from 'vitest';
import {
  CONTACT_FORM_LIMITS,
  contactFormSubmissionResponseSchema,
  contactFormSubmissionSchema,
} from './cms-contact-form.js';

/**
 * Feature 169 (`specs/169-page-builder-contact-form/` contracts/contact-form-api.md §1, FR-017,
 * FR-018) — the server's own minimum for a contact-form submission, whatever the block's
 * "required" switches said: an e-mail, a message and the privacy consent.
 */
const MINIMUM = { email: 'shopper@example.com', message: 'Hello', privacyConsent: true } as const;

function parses(value: unknown): boolean {
  return contactFormSubmissionSchema.safeParse(value).success;
}

describe('contactFormSubmissionSchema (feature 169)', () => {
  it('accepts the minimum: e-mail, message and privacy consent', () => {
    expect(contactFormSubmissionSchema.parse(MINIMUM)).toEqual(MINIMUM);
  });

  it.each(['email', 'message', 'privacyConsent'] as const)('refuses a submission without %s', (key) => {
    const { [key]: _omitted, ...rest } = MINIMUM;
    expect(parses(rest)).toBe(false);
  });

  it('refuses a privacy consent that is not exactly true', () => {
    expect(parses({ ...MINIMUM, privacyConsent: false })).toBe(false);
    expect(parses({ ...MINIMUM, privacyConsent: 'on' })).toBe(false);
  });

  it('refuses an address that is not one, and an empty or blank message', () => {
    expect(parses({ ...MINIMUM, email: 'not-an-address' })).toBe(false);
    expect(parses({ ...MINIMUM, message: '' })).toBe(false);
    expect(parses({ ...MINIMUM, message: '   ' })).toBe(false);
  });

  it.each([
    ['name', CONTACT_FORM_LIMITS.name],
    ['phone', CONTACT_FORM_LIMITS.phone],
    ['company', CONTACT_FORM_LIMITS.company],
    ['subject', CONTACT_FORM_LIMITS.subject],
    ['message', CONTACT_FORM_LIMITS.message],
  ] as const)('caps %s at %i characters', (key, max) => {
    expect(parses({ ...MINIMUM, [key]: 'a'.repeat(max) })).toBe(true);
    expect(parses({ ...MINIMUM, [key]: 'a'.repeat(max + 1) })).toBe(false);
  });

  it('caps the choice pair, the e-mail, the page path and the honeypot', () => {
    expect(parses({ ...MINIMUM, choiceLabel: 'a'.repeat(CONTACT_FORM_LIMITS.choiceLabel + 1), choice: 'x' })).toBe(false);
    expect(parses({ ...MINIMUM, choiceLabel: 'Region', choice: 'a'.repeat(CONTACT_FORM_LIMITS.choice + 1) })).toBe(false);
    const local = 'a'.repeat(CONTACT_FORM_LIMITS.email - '@example.com'.length + 1);
    expect(parses({ ...MINIMUM, email: `${local}@example.com` })).toBe(false);
    expect(parses({ ...MINIMUM, pagePath: `/${'a'.repeat(CONTACT_FORM_LIMITS.pagePath)}` })).toBe(false);
    expect(parses({ ...MINIMUM, website: 'a'.repeat(CONTACT_FORM_LIMITS.honeypot + 1) })).toBe(false);
  });

  it.each(['name', 'phone', 'company', 'subject'] as const)('refuses a line break in %s', (key) => {
    expect(parses({ ...MINIMUM, [key]: 'first\nsecond' })).toBe(false);
    expect(parses({ ...MINIMUM, [key]: 'first\rsecond' })).toBe(false);
  });

  it('keeps line breaks in the message and refuses other control characters there', () => {
    expect(contactFormSubmissionSchema.parse({ ...MINIMUM, message: 'line one\r\nline two\n\tthree' }).message).toBe(
      'line one\r\nline two\n\tthree',
    );
    expect(parses({ ...MINIMUM, message: 'bell\u0007' })).toBe(false);
  });

  it('reads an empty optional field as absent', () => {
    const parsed = contactFormSubmissionSchema.parse({ ...MINIMUM, name: '', phone: '  ', company: '', subject: '' });
    expect(parsed.name).toBeUndefined();
    expect(parsed.phone).toBeUndefined();
    expect(parsed.company).toBeUndefined();
    expect(parsed.subject).toBeUndefined();
  });

  it('trims what it keeps', () => {
    const parsed = contactFormSubmissionSchema.parse({ ...MINIMUM, email: ' shopper@example.com ', name: '  Ada  ' });
    expect(parsed.email).toBe('shopper@example.com');
    expect(parsed.name).toBe('Ada');
  });

  it('takes the choice and its label together or not at all', () => {
    expect(parses({ ...MINIMUM, choiceLabel: 'Region', choice: 'North' })).toBe(true);
    expect(parses({ ...MINIMUM, choice: 'North' })).toBe(false);
    expect(parses({ ...MINIMUM, choiceLabel: 'Region' })).toBe(false);
    expect(parses({ ...MINIMUM, choiceLabel: '', choice: '' })).toBe(true);
  });

  it('refuses an unknown key, so a client cannot add a recipient or a header', () => {
    expect(parses({ ...MINIMUM, to: 'attacker@example.com' })).toBe(false);
    expect(parses({ ...MINIMUM, bcc: 'attacker@example.com' })).toBe(false);
  });

  it('takes a same-origin path as the page path and refuses anything else', () => {
    expect(parses({ ...MINIMUM, pagePath: '/contact?x=1' })).toBe(true);
    expect(parses({ ...MINIMUM, pagePath: '//evil.example' })).toBe(false);
    expect(parses({ ...MINIMUM, pagePath: 'https://evil.example/' })).toBe(false);
    expect(parses({ ...MINIMUM, pagePath: '/\\evil.example' })).toBe(false);
  });

  it('takes the marketing consent as a boolean and the honeypot as a string', () => {
    expect(parses({ ...MINIMUM, marketingConsent: true, website: '' })).toBe(true);
    expect(parses({ ...MINIMUM, marketingConsent: 'on' })).toBe(false);
  });

  it('answers sent', () => {
    expect(contactFormSubmissionResponseSchema.parse({ status: 'sent' })).toEqual({ status: 'sent' });
    expect(contactFormSubmissionResponseSchema.safeParse({ status: 'queued' }).success).toBe(false);
  });
});
