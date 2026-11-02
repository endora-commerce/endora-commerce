import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type FormDefinition } from '@endora-commerce/contracts';
import { fixtureDefinition } from '@endora-commerce/contracts/forms-logic.fixtures';
import { formWarnings, isCaptchaConfigured, type FormWarningsInput } from './form-warnings.js';

/**
 * `specs/170-forms-module/` T029 — the builder's warnings (FR-018): what the operator is told before
 * publishing, and **never** a reason to refuse a publish. Derived per read (data-model §7), from the
 * live recipients, the CAPTCHA settings and the storefront languages of the active channels.
 */

const CHANNEL_A = '00000000-0000-4000-8000-00000000000a';
const CHANNEL_B = '00000000-0000-4000-8000-00000000000b';

function definition(overrides: { captchaRequired?: boolean; texts?: FormDefinition['texts'] } = {}): FormDefinition {
  const parsed = formDefinitionSchema.parse(
    fixtureDefinition(
      [{ id: 's1', columns: 1, fields: [{ id: 'f1', type: 'text', key: 'name' }] }],
      overrides.texts ?? { en: { 'fields.f1.label': 'Name', 'form.title': 'Contact' } },
    ),
  );
  return { ...parsed, behaviour: { ...parsed.behaviour, captchaRequired: overrides.captchaRequired ?? false } };
}

function input(overrides: Partial<FormWarningsInput> = {}): FormWarningsInput {
  return {
    definition: definition(),
    publishedDefinition: null,
    defaultLanguage: 'en',
    recipients: ['shop@example.com'],
    channelRecipients: {},
    ...overrides,
  };
}

const ONE_CHANNEL = { channels: [{ id: CHANNEL_A, languages: ['en'] }], captchaConfigured: true };

describe('formWarnings (FR-018)', () => {
  it('says nothing for a form with recipients, no CAPTCHA and every language complete', () => {
    expect(formWarnings(input(), ONE_CHANNEL)).toEqual([]);
  });

  it('no_recipients: neither a default list nor an override for some active channel', () => {
    expect(formWarnings(input({ recipients: [] }), ONE_CHANNEL)).toEqual([{ code: 'no_recipients' }]);
  });

  it('no_recipients: an override replaces the default, so an empty override on one channel warns', () => {
    const environment = {
      channels: [
        { id: CHANNEL_A, languages: ['en'] },
        { id: CHANNEL_B, languages: ['en'] },
      ],
      captchaConfigured: true,
    };
    expect(formWarnings(input({ channelRecipients: { [CHANNEL_B]: [] } }), environment)).toEqual([
      { code: 'no_recipients' },
    ]);
    // Every channel covered by its own list: no warning, even with no default.
    expect(
      formWarnings(
        input({ recipients: [], channelRecipients: { [CHANNEL_A]: ['a@example.com'], [CHANNEL_B]: ['b@example.com'] } }),
        environment,
      ),
    ).toEqual([]);
  });

  it('captcha_not_configured: the working copy or the published version requires it and the provider is not set up', () => {
    const noProvider = { ...ONE_CHANNEL, captchaConfigured: false };
    expect(formWarnings(input({ definition: definition({ captchaRequired: true }) }), noProvider)).toEqual([
      { code: 'captcha_not_configured' },
    ]);
    expect(formWarnings(input({ publishedDefinition: definition({ captchaRequired: true }) }), noProvider)).toEqual([
      { code: 'captcha_not_configured' },
    ]);
    expect(formWarnings(input(), noProvider)).toEqual([]);
    expect(formWarnings(input({ definition: definition({ captchaRequired: true }) }), ONE_CHANNEL)).toEqual([]);
  });

  it('untranslated: one warning per storefront language whose texts fall back, with how many', () => {
    const environment = {
      channels: [
        { id: CHANNEL_A, languages: ['en', 'pl'] },
        { id: CHANNEL_B, languages: ['de', 'en'] },
      ],
      captchaConfigured: true,
    };
    const texts = {
      en: { 'fields.f1.label': 'Name', 'form.title': 'Contact' },
      pl: { 'fields.f1.label': 'Imię' },
      de: { 'fields.f1.label': 'Name', 'form.title': 'Kontakt' },
    };
    expect(formWarnings(input({ definition: definition({ texts }) }), environment)).toEqual([
      { code: 'untranslated', language: 'pl', missing: 1 },
    ]);
  });

  it('lists every warning that applies, in a stable order', () => {
    const environment = { channels: [{ id: CHANNEL_A, languages: ['en', 'pl'] }], captchaConfigured: false };
    expect(
      formWarnings(input({ recipients: [], definition: definition({ captchaRequired: true }) }), environment),
    ).toEqual([{ code: 'no_recipients' }, { code: 'captcha_not_configured' }, { code: 'untranslated', language: 'pl', missing: 2 }]);
  });
});

describe('isCaptchaConfigured', () => {
  it('needs a provider other than none, a site key and a secret key', () => {
    expect(isCaptchaConfigured({ provider: 'turnstile', siteKey: 'site', secretKey: 'secret' })).toBe(true);
    expect(isCaptchaConfigured({ provider: 'none', siteKey: 'site', secretKey: 'secret' })).toBe(false);
    expect(isCaptchaConfigured({ provider: 'hcaptcha', siteKey: '', secretKey: 'secret' })).toBe(false);
    expect(isCaptchaConfigured({ provider: 'hcaptcha', siteKey: 'site', secretKey: '  ' })).toBe(false);
  });
});
