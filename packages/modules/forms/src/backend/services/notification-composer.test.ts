import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type AnswerValue, type FormDefinition, type FormDefinitionInput } from '@endora-commerce/contracts';
import { composeConfirmation, composeShopNotification, type MailTranslate } from './notification-composer.js';

/**
 * `specs/170-forms-module/` T084 — what the shop notification and the confirmation e-mail say
 * (FR-057, FR-058, A-3, research R-13).
 *
 * The built-in wording is the module bundle's, reached through a translate function bound to one
 * language; here it echoes the key and its parameters, so a case can tell which sentence was used
 * and with what. The operator's wording is the entry's version, resolved in the language asked for
 * with the version's default language behind it.
 */

const translate: MailTranslate = async (key, params) =>
  params ? `${key}(${Object.entries(params).map(([name, value]) => `${name}=${value}`).join(',')})` : key;

function definition(extra: Partial<FormDefinitionInput> = {}): FormDefinition {
  return formDefinitionSchema.parse({
    schemaVersion: 1,
    sections: [
      {
        id: 's1',
        columns: 1,
        fields: [
          { id: 'f_name', type: 'text', key: 'name', required: true },
          { id: 'f_mail', type: 'email', key: 'email', submitterEmail: true },
          { id: 'f_msg', type: 'textarea', key: 'message' },
          {
            id: 'f_topic',
            type: 'select',
            key: 'topic',
            options: [
              { id: 'o_doors', value: 'doors' },
              { id: 'o_windows', value: 'windows' },
            ],
          },
          {
            id: 'f_tags',
            type: 'checkboxes',
            key: 'tags',
            options: [
              { id: 't_a', value: 'a' },
              { id: 't_b', value: 'b' },
            ],
          },
          { id: 'f_qty', type: 'number', key: 'quantity' },
          {
            id: 'f_addr',
            type: 'address',
            key: 'address',
            parts: {
              street: { enabled: true, required: false },
              line2: { enabled: false, required: false },
              postalCode: { enabled: true, required: false },
              city: { enabled: true, required: false },
              country: { enabled: true, required: false },
            },
          },
          { id: 'f_utm', type: 'hidden', key: 'utm', source: 'query_param', paramName: 'utm' },
          { id: 'f_intro', type: 'content' },
          { id: 'f_news', type: 'marketing_consent', key: 'newsletter' },
          { id: 'f_unused', type: 'text', key: 'unused' },
        ],
      },
    ],
    behaviour: {
      confirmation: { type: 'message' },
      captchaRequired: false,
      confirmationEmail: { enabled: true, includeSummary: false },
    },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts: {
      'en-US': {
        'form.title': 'Contact us',
        'fields.f_name.label': 'Name',
        'fields.f_mail.label': 'E-mail',
        'fields.f_msg.label': 'Message',
        'fields.f_topic.label': 'Topic',
        'fields.f_topic.options.o_doors': 'Doors',
        'fields.f_topic.options.o_windows': 'Windows',
        'fields.f_tags.label': 'Tags',
        'fields.f_tags.options.t_a': 'Alpha',
        'fields.f_tags.options.t_b': 'Beta',
        'fields.f_qty.label': 'Quantity',
        'fields.f_addr.label': 'Address',
        'fields.f_utm.label': 'Campaign',
        'fields.f_intro.content': '<p>Intro</p>',
        'fields.f_news.content': '<p>Send me <strong>news</strong></p>',
        'fields.f_unused.label': 'Unused',
        'email.confirmation.subject': 'We got your message',
        'email.confirmation.body': '<p>Thanks, we will <a href="https://shop.example/help">reply</a> soon.</p><script>alert(1)</script>',
      },
      'pl-PL': {
        'fields.f_name.label': 'Imię',
        'fields.f_topic.options.o_doors': 'Drzwi',
        'email.confirmation.subject': 'Otrzymaliśmy wiadomość',
      },
    },
    ...extra,
  });
}

const ANSWERS: Record<string, AnswerValue> = {
  name: 'Ada <b>Lovelace</b>',
  email: 'ada@example.com',
  message: 'Line one\nLine & two',
  topic: 'doors',
  tags: ['a', 'b'],
  quantity: 3,
  address: { street: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
  utm: 'spring-campaign',
  newsletter: true,
};

const SOURCE = {
  formName: 'Contact form (admin)',
  definition: definition(),
  versionDefaultLanguage: 'en-US',
  answers: ANSWERS,
  pageUrl: '/contact?ref=a',
};

describe('composeShopNotification (FR-057, A-3)', () => {
  it('names the form in the subject and nothing the shopper typed', async () => {
    const mail = await composeShopNotification({ ...SOURCE, language: 'en-US', translate, hasReplyTo: true });
    expect(mail.subject).toBe('mail.notification.subject(form=Contact form (admin))');
    for (const value of ['Ada', 'ada@example.com', 'Line one', 'spring-campaign']) expect(mail.subject).not.toContain(value);
  });

  it('lists the visible answers with the version labels, option labels, the address and the page', async () => {
    const mail = await composeShopNotification({ ...SOURCE, language: 'en-US', translate, hasReplyTo: true });
    expect(mail.text).toContain('Name: Ada <b>Lovelace</b>');
    expect(mail.text).toContain('E-mail: ada@example.com');
    expect(mail.text).toContain('Message:\nLine one\nLine & two');
    expect(mail.text).toContain('Topic: Doors');
    expect(mail.text).toContain('Tags: Alpha, Beta');
    expect(mail.text).toContain('Quantity: 3');
    expect(mail.text).toContain('Address: Main 1, 00-001 Warsaw, PL');
    expect(mail.text).toContain('Send me news: mail.yes');
    expect(mail.text).toContain('mail.notification.page: /contact?ref=a');
    expect(mail.text).toContain('mail.notification.replyHint');
  });

  it('leaves out hidden fields, layout elements and fields with no answer', async () => {
    const mail = await composeShopNotification({ ...SOURCE, language: 'en-US', translate, hasReplyTo: true });
    for (const body of [mail.text, mail.html]) {
      expect(body).not.toContain('spring-campaign');
      expect(body).not.toContain('Campaign');
      expect(body).not.toContain('Intro');
      expect(body).not.toContain('Unused');
    }
  });

  it('is composed in the language it is given, the version default behind it', async () => {
    const mail = await composeShopNotification({ ...SOURCE, language: 'pl-PL', translate, hasReplyTo: true });
    expect(mail.text).toContain('Imię: Ada');
    expect(mail.text).toContain('Topic: Drzwi');
    expect(mail.text).toContain('E-mail: ada@example.com');
  });

  it('escapes every answer in the HTML alternative', async () => {
    const mail = await composeShopNotification({ ...SOURCE, language: 'en-US', translate, hasReplyTo: true });
    expect(mail.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(mail.html).toContain('Line one\nLine &amp; two');
    expect(mail.html).not.toContain('<b>Lovelace</b>');
  });

  it('says nothing about replying when there is no Reply-To, and nothing about a page when there is none', async () => {
    const mail = await composeShopNotification({ ...SOURCE, pageUrl: null, language: 'en-US', translate, hasReplyTo: false });
    expect(mail.text).not.toContain('mail.notification.replyHint');
    expect(mail.text).not.toContain('mail.notification.page');
  });
});

describe('composeConfirmation (FR-058)', () => {
  it("uses the operator's subject and body in the submission language, sanitised", async () => {
    const mail = await composeConfirmation({ ...SOURCE, language: 'pl-PL', translate });
    expect(mail.subject).toBe('Otrzymaliśmy wiadomość');
    // The Polish copy has no body: the version's default language stands in.
    expect(mail.html).toContain('<a href="https://shop.example/help" target="_blank" rel="noreferrer">reply</a>');
    expect(mail.html).not.toContain('<script');
    expect(mail.text).toContain('Thanks, we will reply soon.');
    expect(mail.text).not.toContain('alert');
  });

  it('falls back to the built-in wording when the operator wrote none', async () => {
    const bare = definition({ texts: { 'en-US': { 'form.title': 'Contact us', 'fields.f_name.label': 'Name' } } });
    const mail = await composeConfirmation({ ...SOURCE, definition: bare, language: 'en-US', translate });
    expect(mail.subject).toBe('mail.confirmation.subject(form=Contact us)');
    expect(mail.text).toContain('mail.confirmation.body');
  });

  it('carries no answer unless the operator chose a summary', async () => {
    const without = await composeConfirmation({ ...SOURCE, language: 'en-US', translate });
    expect(without.text).not.toContain('Ada');
    expect(without.text).not.toContain('mail.confirmation.summary');

    const summarised = definition({
      behaviour: {
        confirmation: { type: 'message' },
        captchaRequired: false,
        confirmationEmail: { enabled: true, includeSummary: true },
      },
    });
    const mail = await composeConfirmation({ ...SOURCE, definition: summarised, language: 'en-US', translate });
    expect(mail.text).toContain('mail.confirmation.summary');
    expect(mail.text).toContain('Name: Ada <b>Lovelace</b>');
    expect(mail.html).toContain('Ada &lt;b&gt;Lovelace&lt;/b&gt;');
    expect(mail.text).not.toContain('spring-campaign');
  });
});
