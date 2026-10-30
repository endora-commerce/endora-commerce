import { describe, expect, it } from 'vitest';
import { cmsContactFormText } from '../../lib/page-builder/contact-form-text';

/**
 * Feature 169 (T113, data-model §5.4) — `cms.ContactForm`'s default words in the page's
 * language, handed to the render context by `CmsPageRenderer`: a shopper on a Polish page never
 * reads the block's English fallbacks.
 */
describe('cmsContactFormText', () => {
  it('answers every word in English', () => {
    const text = cmsContactFormText('en-US');
    expect(text.label).toBe('Contact form');
    expect(text.field).toMatchObject({ name: 'Name', email: 'E-mail', message: 'Message' });
    expect(text.submit).toBe('Send');
    for (const value of [
      text.label,
      text.choicePlaceholder,
      text.privacyConsent,
      text.marketingConsent,
      text.submit,
      text.success,
      text.error,
      text.unavailable,
      text.required,
      text.fieldRequired,
      text.fieldEmail,
      ...Object.values(text.field ?? {}),
    ]) {
      expect(value).toMatch(/\S/);
    }
    expect(Object.keys(text.field ?? {}).sort()).toEqual(['choice', 'company', 'email', 'message', 'name', 'phone', 'subject']);
  });

  it('answers Polish on a Polish page, different from the English', () => {
    const pl = cmsContactFormText('pl-PL');
    const en = cmsContactFormText('en-US');
    expect(pl.submit).toBe('Wyślij');
    expect(pl.field?.message).toBe('Wiadomość');
    for (const key of ['label', 'privacyConsent', 'success', 'error', 'unavailable', 'required'] as const) {
      expect(pl[key], key).not.toBe(en[key]);
    }
  });

  it('reads English for a language the catalogue does not carry', () => {
    expect(cmsContactFormText('de-DE').submit).toBe('Send');
  });
});
