import { describe, expect, it } from 'vitest';
import { HttpError } from '@endora-commerce/platform/http';
import { createContactFormRecipientsValidator } from './recipients-validator.js';

/**
 * Feature 169 (T095, data-model §3.1) — `cms.contact_form_recipients` takes 0–10 e-mail
 * addresses on write, whichever path writes it (the generic Settings screen or its API).
 */
describe('createContactFormRecipientsValidator', () => {
  const validator = createContactFormRecipientsValidator();
  const code = 'cms.contact_form_recipients';
  const run = (proposedValue: unknown) =>
    validator.validate({ code, ownerModuleId: 'cms', proposedValue } as Parameters<typeof validator.validate>[0]);

  it('answers for its code only, as cms', () => {
    expect(validator.contributorModuleId).toBe('cms');
    expect(validator.codes).toEqual([code]);
  });

  it('accepts an empty list and up to ten addresses', async () => {
    await expect(run([])).resolves.toBeUndefined();
    await expect(run(['shop@example.com'])).resolves.toBeUndefined();
    await expect(run(Array.from({ length: 10 }, (_, i) => `sales${i}@example.com`))).resolves.toBeUndefined();
  });

  it.each([
    ['eleven addresses', Array.from({ length: 11 }, (_, i) => `sales${i}@example.com`)],
    ['a non-address', ['shop@example.com', 'not an address']],
    ['a non-string entry', ['shop@example.com', 42]],
    ['a non-array', 'shop@example.com'],
    ['null', null],
  ])('refuses %s with 400 VALIDATION_FAILED on the value', async (_name, value) => {
    const error = await run(value).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED' });
    expect((error as HttpError & { details?: Array<{ path: string }> }).details?.[0]?.path).toBe('value');
  });
});
