import { describe, expect, it, vi } from 'vitest';
import {
  formDefinitionSchema,
  publicFormDefinitionSchema,
  type AvailablePublicFormDefinition,
  type FormDefinition,
  type FormDefinitionInput,
} from '@endora-commerce/contracts';
import { fixtureDefinition } from '@endora-commerce/contracts/forms-logic.fixtures';
import { confirmationPagePath, formAvailability, publicFormDefinition, type PublicReadSource } from './form-public-read.js';

/**
 * `specs/170-forms-module/` T030 — the public read of a form (`contracts/public-api.md` §1): a
 * version and a language become a `PublicFormDefinition` with every text resolved (R-7 fallback),
 * and **nothing** an operator keeps to themselves — no recipients, retention, counts, share flags or
 * CAPTCHA secret. Draft, deleted and never-existing forms are one indistinguishable `unavailable`.
 */

const FORM_ID = '00000000-0000-4000-8000-0000000000f1';
const NOW = new Date('2026-11-02T12:00:00.000Z');

const ADDRESS_PARTS = {
  street: { enabled: true, required: true },
  line2: { enabled: false, required: false },
  postalCode: { enabled: true, required: false },
  city: { enabled: true, required: true },
  country: { enabled: true, required: false },
} as const;

function definitionOf(input: FormDefinitionInput): FormDefinition {
  return formDefinitionSchema.parse(input);
}

const DEFINITION = definitionOf(
  fixtureDefinition(
    [
      {
        id: 's1',
        columns: 2,
        fields: [
          { id: 'f1', type: 'text', key: 'name', required: true, width: 2, shareWithIntegrations: true },
          { id: 'f2', type: 'email', key: 'email', submitterEmail: true },
          { id: 'f3', type: 'select', key: 'topic', options: [{ id: 'o1', value: 'sales' }, { id: 'o2', value: 'support' }] },
          { id: 'f4', type: 'address', key: 'address', parts: ADDRESS_PARTS },
          { id: 'f5', type: 'content' },
          { id: 'f6', type: 'privacy_consent', key: 'privacy', required: true },
          { id: 'f7', type: 'hidden', key: 'source', source: 'static', staticValue: 'web' },
        ],
      },
    ],
    {
      en: {
        'form.title': 'Contact us',
        'form.submitLabel': 'Send',
        'sections.s1.title': 'About you',
        'fields.f1.label': 'Name',
        'fields.f1.placeholder': 'Your name',
        'fields.f1.errors.required': 'Tell us your name',
        'fields.f2.label': 'E-mail',
        'fields.f3.label': 'Topic',
        'fields.f3.options.o1': 'Sales',
        'fields.f3.options.o2': 'Support',
        'fields.f4.label': 'Address',
        'fields.f4.parts.street.label': 'Street',
        'fields.f5.content': '<p>We answer within a day.</p>',
        'fields.f6.label': 'Privacy',
        'fields.f6.content': '<p>I accept the privacy policy.</p>',
        'fields.f7.label': 'Source',
        'messages.closed': 'Closed for now',
      },
      pl: {
        'form.title': 'Napisz do nas',
        'fields.f1.label': 'Imię',
        'fields.f3.options.o1': 'Sprzedaż',
      },
    },
  ),
);

function source(overrides: Partial<PublicReadSource> = {}): PublicReadSource {
  return {
    formId: FORM_ID,
    key: 'contact',
    status: 'published',
    version: { number: 3, definition: DEFINITION, defaultLanguage: 'en' },
    acceptedEntryCount: 0,
    ...overrides,
  };
}

function available(read: ReturnType<typeof publicFormDefinition>): AvailablePublicFormDefinition {
  if (read.availability === 'unavailable') throw new Error('expected an available form');
  return read;
}

describe('publicFormDefinition (public-api.md §1)', () => {
  it('parses with the public schema and carries the version, key and language', () => {
    const read = publicFormDefinition(source(), FORM_ID, { language: 'en', now: NOW, captcha: null });
    expect(publicFormDefinitionSchema.safeParse(read).success).toBe(true);
    expect(read).toMatchObject({ formId: FORM_ID, key: 'contact', version: 3, language: 'en', availability: 'open' });
  });

  it('resolves every text for the language, falling back to the default language (R-7)', () => {
    const read = available(publicFormDefinition(source(), FORM_ID, { language: 'pl', now: NOW, captcha: null }));
    expect(read.texts.title).toBe('Napisz do nas');
    expect(read.texts.submitLabel).toBe('Send');
    expect(read.texts.closed).toBe('Closed for now');
    const [section] = read.sections;
    expect(section).toMatchObject({ id: 's1', columns: 2, title: 'About you' });
    const byId = new Map(section!.fields.map((field) => [field.id, field]));
    expect(byId.get('f1')).toMatchObject({ label: 'Imię', placeholder: 'Your name', width: 2, required: true });
    expect(byId.get('f1')).toMatchObject({ errors: { required: 'Tell us your name' } });
    expect(byId.get('f3')).toMatchObject({
      options: [
        { id: 'o1', value: 'sales', label: 'Sprzedaż' },
        { id: 'o2', value: 'support', label: 'Support' },
      ],
    });
    expect(byId.get('f4')).toMatchObject({ parts: { street: { enabled: true, required: true, label: 'Street' } } });
    expect(byId.get('f5')).toMatchObject({ content: '<p>We answer within a day.</p>' });
    expect(byId.get('f6')).toMatchObject({ content: '<p>I accept the privacy policy.</p>' });
    expect(byId.get('f7')).toMatchObject({ source: 'static', staticValue: 'web' });
  });

  it('never carries what the operator keeps to themselves', () => {
    const read = publicFormDefinition(source(), FORM_ID, { language: 'en', now: NOW, captcha: null });
    const text = JSON.stringify(read);
    for (const word of ['shareWithIntegrations', 'submitterEmail', 'recipients', 'retention', 'acceptedEntryCount', 'secret']) {
      expect(text).not.toContain(word);
    }
  });

  it('offers CAPTCHA only when the version requires it and the caller says it is configured (R-14)', () => {
    const required = definitionOf({
      ...fixtureDefinition([{ id: 's1', columns: 1, fields: [] }]),
      behaviour: { confirmation: { type: 'message' }, captchaRequired: true, confirmationEmail: { enabled: false, includeSummary: false } },
    });
    const captcha = { provider: 'turnstile' as const, siteKey: 'site-key' };
    const withRequired = source({ version: { number: 1, definition: required, defaultLanguage: 'en' } });
    expect(available(publicFormDefinition(withRequired, FORM_ID, { language: 'en', now: NOW, captcha })).captcha).toEqual(captcha);
    expect(available(publicFormDefinition(withRequired, FORM_ID, { language: 'en', now: NOW, captcha: null })).captcha).toBeNull();
    expect(available(publicFormDefinition(source(), FORM_ID, { language: 'en', now: NOW, captcha })).captcha).toBeNull();
  });

  it('a draft, a deleted form and one that never existed are the same unavailable body (R-11)', () => {
    const draft = publicFormDefinition(source({ status: 'draft', version: null }), FORM_ID, { language: 'en', now: NOW, captcha: null });
    const missing = publicFormDefinition(null, FORM_ID, { language: 'en', now: NOW, captcha: null });
    expect(draft).toEqual({ formId: FORM_ID, availability: 'unavailable' });
    expect(missing).toEqual(draft);
  });

  it('a closed form is served as closed with its texts', () => {
    const read = publicFormDefinition(source({ status: 'closed' }), FORM_ID, { language: 'en', now: NOW, captcha: null });
    expect(read.availability).toBe('closed');
  });

  it('confirmation: message and redirect as stored; a page only with the path the caller resolved', () => {
    const page = definitionOf({
      ...fixtureDefinition([{ id: 's1', columns: 1, fields: [] }]),
      behaviour: {
        confirmation: { type: 'page', cmsPageId: '00000000-0000-4000-8000-0000000000aa' },
        captchaRequired: false,
        confirmationEmail: { enabled: false, includeSummary: false },
      },
    });
    const withPage = source({ version: { number: 1, definition: page, defaultLanguage: 'en' } });
    expect(available(publicFormDefinition(withPage, FORM_ID, { language: 'en', now: NOW, captcha: null })).confirmation).toEqual({
      type: 'message',
    });
    expect(
      available(
        publicFormDefinition(withPage, FORM_ID, { language: 'en', now: NOW, captcha: null, confirmationPagePath: '/thank-you' }),
      ).confirmation,
    ).toEqual({ type: 'page', path: '/thank-you' });
  });
});

describe('formAvailability', () => {
  const restrictions = DEFINITION.restrictions;

  it('open, closed, not yet open, full', () => {
    expect(formAvailability('published', restrictions, 0, NOW)).toBe('open');
    expect(formAvailability('closed', restrictions, 0, NOW)).toBe('closed');
    expect(formAvailability('published', { ...restrictions, availableFrom: '2026-11-03T00:00:00.000Z' }, 0, NOW)).toBe(
      'not_yet_open',
    );
    expect(formAvailability('published', { ...restrictions, availableUntil: '2026-11-01T00:00:00.000Z' }, 0, NOW)).toBe(
      'closed',
    );
    expect(formAvailability('published', { ...restrictions, maxEntries: 5 }, 5, NOW)).toBe('full');
    expect(formAvailability('published', { ...restrictions, maxEntries: 5 }, 4, NOW)).toBe('open');
  });
});

/**
 * T053 — a "show a CMS page" confirmation is resolved to the page's path through `cmsPageReadPort`
 * only while `cms` is present, decided **in front of** the port (no `catch`); without `cms`, for a
 * page the channel does not serve, and for every other confirmation there is no path, and the
 * read and the submission answer the message (FR-038, US2-8).
 */
describe('confirmationPagePath', () => {
  const PAGE = '00000000-0000-4000-8000-0000000000aa';
  const SCOPE = { salesChannelId: '00000000-0000-4000-8000-0000000000c1', language: 'pl-PL' };

  function ports(present: boolean, url: string | null) {
    return {
      cmsPresent: vi.fn(() => present),
      cmsPages: { findStorefrontLinks: vi.fn(async () => (url === null ? [] : [{ id: PAGE, name: 'Thanks', url }])) },
    };
  }

  it('answers the page path in the scope while cms is present', async () => {
    const deps = ports(true, '/dziekujemy');
    await expect(confirmationPagePath({ type: 'page', cmsPageId: PAGE }, SCOPE, deps)).resolves.toBe('/dziekujemy');
    expect(deps.cmsPages.findStorefrontLinks).toHaveBeenCalledWith([PAGE], SCOPE);
  });

  it('does not ask cms while it is absent', async () => {
    const deps = ports(false, '/dziekujemy');
    await expect(confirmationPagePath({ type: 'page', cmsPageId: PAGE }, SCOPE, deps)).resolves.toBeNull();
    expect(deps.cmsPages.findStorefrontLinks).not.toHaveBeenCalled();
  });

  it('answers no path for a page the channel does not serve', async () => {
    await expect(confirmationPagePath({ type: 'page', cmsPageId: PAGE }, SCOPE, ports(true, null))).resolves.toBeNull();
  });

  it('asks nothing for a message or a redirect', async () => {
    const deps = ports(true, '/x');
    await expect(confirmationPagePath({ type: 'message' }, SCOPE, deps)).resolves.toBeNull();
    await expect(confirmationPagePath({ type: 'redirect', url: 'https://example.com' }, SCOPE, deps)).resolves.toBeNull();
    expect(deps.cmsPresent).not.toHaveBeenCalled();
  });
});
