import { describe, expect, it } from 'vitest';
import type { ContactFormSubmission } from '@endora-commerce/contracts';
import { composeContactFormMail } from './contact-form-mail.js';

/**
 * Feature 169 (T099, data-model §3.3) — the e-mail a contact-form submission becomes. The
 * translator is a fake that answers `key|params`, so the test reads which sentence went where
 * without depending on either bundle's wording.
 */
const fakeTranslate = async (key: string, params?: Record<string, string | number>): Promise<string> =>
  params && Object.keys(params).length > 0 ? `${key}|${JSON.stringify(params)}` : key;

const MINIMUM: ContactFormSubmission = {
  email: 'shopper@example.com',
  message: 'Hello',
  privacyConsent: true,
};

describe('composeContactFormMail (feature 169)', () => {
  it('has a fixed subject naming the channel and nothing the shopper typed', async () => {
    const mail = await composeContactFormMail({
      submission: { ...MINIMUM, subject: 'Secret subject', name: 'Ada' },
      channelName: 'Acme Store',
      translate: fakeTranslate,
    });
    expect(mail.subject).toBe('contactForm.mail.subject|{"channel":"Acme Store"}');
    expect(mail.subject).not.toContain('Secret subject');
    expect(mail.subject).not.toContain('Ada');
  });

  it('lists one line per submitted field only, with the translated label', async () => {
    const mail = await composeContactFormMail({
      submission: { ...MINIMUM, name: 'Ada Lovelace', company: 'Acme' },
      channelName: 'Acme Store',
      translate: fakeTranslate,
    });
    expect(mail.text).toContain('contactForm.mail.field.name: Ada Lovelace');
    expect(mail.text).toContain('contactForm.mail.field.email: shopper@example.com');
    expect(mail.text).toContain('contactForm.mail.field.company: Acme');
    expect(mail.text).not.toContain('contactForm.mail.field.phone');
    expect(mail.text).not.toContain('contactForm.mail.field.subject');
    expect(mail.text).toContain('contactForm.mail.field.message');
    expect(mail.text).toContain('Hello');
  });

  it('labels the choice with the label the shopper saw', async () => {
    const mail = await composeContactFormMail({
      submission: { ...MINIMUM, choiceLabel: 'Region', choice: 'North' },
      channelName: 'Acme Store',
      translate: fakeTranslate,
    });
    expect(mail.text).toContain('Region: North');
    expect(mail.html).toContain('Region');
    expect(mail.html).toContain('North');
  });

  it('states both consents, the marketing one as yes or no', async () => {
    const yes = await composeContactFormMail({
      submission: { ...MINIMUM, marketingConsent: true },
      channelName: 'Acme Store',
      translate: fakeTranslate,
    });
    expect(yes.text).toContain('contactForm.mail.consent.privacy');
    expect(yes.text).toContain('contactForm.mail.consent.marketing.yes');
    const no = await composeContactFormMail({ submission: MINIMUM, channelName: 'Acme Store', translate: fakeTranslate });
    expect(no.text).toContain('contactForm.mail.consent.marketing.no');
    expect(no.text).not.toContain('contactForm.mail.consent.marketing.yes');
  });

  it('names the page it was sent from, when known', async () => {
    const mail = await composeContactFormMail({
      submission: { ...MINIMUM, pagePath: '/pl/contact' },
      channelName: 'Acme Store',
      translate: fakeTranslate,
    });
    expect(mail.text).toContain('contactForm.mail.page: /pl/contact');
    const without = await composeContactFormMail({ submission: MINIMUM, channelName: 'Acme Store', translate: fakeTranslate });
    expect(without.text).not.toContain('contactForm.mail.page');
  });

  it('escapes what the shopper typed in the HTML body and keeps the message line breaks', async () => {
    const mail = await composeContactFormMail({
      submission: { ...MINIMUM, name: '<b>Ada</b>', message: '<script>alert(1)</script>\nsecond line' },
      channelName: 'Acme & Sons',
      translate: fakeTranslate,
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(mail.html).toContain('&lt;b&gt;Ada&lt;/b&gt;');
    expect(mail.html).toContain('second line');
    expect(mail.html).not.toContain('Acme & Sons');
    expect(mail.text).toContain('<script>alert(1)</script>\nsecond line');
  });

  it('always has a plain-text body', async () => {
    const mail = await composeContactFormMail({ submission: MINIMUM, channelName: 'Acme Store', translate: fakeTranslate });
    expect(mail.text.trim().length).toBeGreaterThan(0);
    expect(mail.text).toContain('contactForm.mail.heading|{"channel":"Acme Store"}');
  });
});
