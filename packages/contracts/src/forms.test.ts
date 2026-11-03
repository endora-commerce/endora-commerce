import { describe, expect, it } from 'vitest';
import {
  FORM_FIELD_TYPES,
  FORM_INPUT_FIELD_TYPES,
  FORMS_EVENTS,
  FORMS_LIMITS,
  FORMS_WEBHOOK_EVENT_SCHEMAS,
  FORMS_WEBHOOK_EVENT_TYPES,
  FormEntrySubmittedEventV1Schema,
  formDefinitionSchema,
  formElementIdSchema,
  formFieldSchema,
  formKeySchema,
  formLanguagesResponseSchema,
  formRestrictionsSchema,
  formSubmitBodySchema,
  publicFormDefinitionSchema,
  visibilityRuleSchema,
  type FormDefinitionInput,
} from './forms.js';
import { fixtureDefinition } from './forms-logic.fixtures.js';
import { FORMS_STOREFRONT_CACHE_TAGS } from './storefront-cache-tags.js';

/**
 * `specs/170-forms-module/` T007 — the shapes of `contracts/form-definition.md` §1, the admin and
 * public API bodies and the event of `contracts/events-and-webhook.md` §1.
 */

/** Any well-formed id; these cases are about shape, not identity. */
const UUID = '6a1f2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b';

const accepts = (schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): boolean =>
  schema.safeParse(value).success;

/** One minimal, valid field of every type. */
const MINIMAL_FIELDS: Record<(typeof FORM_FIELD_TYPES)[number], Record<string, unknown>> = {
  text: { id: 'f1', type: 'text', key: 'name' },
  email: { id: 'f2', type: 'email', key: 'email' },
  phone: { id: 'f3', type: 'phone', key: 'phone' },
  number: { id: 'f4', type: 'number', key: 'qty' },
  textarea: { id: 'f5', type: 'textarea', key: 'message' },
  select: { id: 'f6', type: 'select', key: 'topic', options: [{ id: 'o1', value: 'a' }] },
  radio: { id: 'f7', type: 'radio', key: 'pick', options: [{ id: 'o1', value: 'a' }] },
  checkboxes: { id: 'f8', type: 'checkboxes', key: 'many', options: [{ id: 'o1', value: 'a' }] },
  checkbox: { id: 'f9', type: 'checkbox', key: 'one' },
  datetime: { id: 'f10', type: 'datetime', key: 'when', mode: 'datetime' },
  country: { id: 'f11', type: 'country', key: 'country' },
  address: {
    id: 'f12',
    type: 'address',
    key: 'address',
    parts: {
      street: { enabled: true, required: true },
      line2: { enabled: false, required: false },
      postalCode: { enabled: true, required: false },
      city: { enabled: true, required: true },
      country: { enabled: false, required: false },
    },
  },
  hidden: { id: 'f13', type: 'hidden', key: 'source', source: 'static', staticValue: 'ad' },
  content: { id: 'f14', type: 'content' },
  section_break: { id: 'f15', type: 'section_break' },
  privacy_consent: { id: 'f16', type: 'privacy_consent', key: 'privacy', required: true },
  marketing_consent: { id: 'f17', type: 'marketing_consent', key: 'marketing' },
  terms: { id: 'f18', type: 'terms', key: 'terms', required: true },
};

/** A broken variant of every type, each refused by the shape. */
const BROKEN_FIELDS: Record<(typeof FORM_FIELD_TYPES)[number], Record<string, unknown>> = {
  text: { ...MINIMAL_FIELDS.text, maxLength: FORMS_LIMITS.singleLineChars + 1 },
  email: { ...MINIMAL_FIELDS.email, submitterEmail: 'yes' },
  phone: { ...MINIMAL_FIELDS.phone, pattern: 'digits' },
  number: { ...MINIMAL_FIELDS.number, step: 0 },
  textarea: { ...MINIMAL_FIELDS.textarea, maxLength: FORMS_LIMITS.multiLineChars + 1 },
  select: { ...MINIMAL_FIELDS.select, options: [{ id: 'o1' }] },
  radio: { ...MINIMAL_FIELDS.radio, options: [{ id: 'bad id!', value: 'a' }] },
  checkboxes: { ...MINIMAL_FIELDS.checkboxes, minSelected: -1 },
  checkbox: { ...MINIMAL_FIELDS.checkbox, defaultChecked: 'on' },
  datetime: { ...MINIMAL_FIELDS.datetime, mode: 'week' },
  country: { ...MINIMAL_FIELDS.country, allowedCountries: ['pol'] },
  address: {
    ...MINIMAL_FIELDS.address,
    parts: { ...(MINIMAL_FIELDS.address['parts'] as object), city: { enabled: false, required: false } },
  },
  hidden: { ...MINIMAL_FIELDS.hidden, source: 'query_param', paramName: 'bad name' },
  content: { ...MINIMAL_FIELDS.content, key: 'content' },
  section_break: { ...MINIMAL_FIELDS.section_break, required: true },
  privacy_consent: { ...MINIMAL_FIELDS.privacy_consent, defaultChecked: true },
  marketing_consent: { ...MINIMAL_FIELDS.marketing_consent, defaultChecked: true },
  terms: { ...MINIMAL_FIELDS.terms, key: 'Terms' },
};

function definitionWith(fields: Record<string, unknown>[], extra: Record<string, unknown> = {}): unknown {
  return {
    ...fixtureDefinition([{ id: 's1', columns: 3, fields: fields as never }]),
    ...extra,
  };
}

describe('FORMS_LIMITS (research R-27)', () => {
  it('holds the limits the plan fixes', () => {
    expect(FORMS_LIMITS).toEqual({
      fieldsPerForm: 100,
      sectionsPerForm: 30,
      optionsPerChoice: 200,
      conditionsPerRule: 20,
      groupsPerRule: 10,
      singleLineChars: 1000,
      multiLineChars: 10000,
      hiddenChars: 1000,
      richTextChars: 20000,
      keyChars: 64,
      nameChars: 200,
      recipients: 10,
      channelOverrides: 50,
      noteChars: 5000,
      retentionDaysMax: 3650,
      bulkDeleteMax: 200,
      submissionBytes: 262144,
      searchTextChars: 20000,
      pageUrlChars: 2048,
    });
  });

  it('lists eighteen field types, sixteen of them inputs', () => {
    expect(FORM_FIELD_TYPES).toHaveLength(18);
    expect(FORM_INPUT_FIELD_TYPES).toHaveLength(16);
    expect(FORM_INPUT_FIELD_TYPES).not.toContain('content');
    expect(FORM_INPUT_FIELD_TYPES).not.toContain('section_break');
  });
});

describe('formFieldSchema — every field type', () => {
  it.each(FORM_FIELD_TYPES)('accepts a minimal %s field', (type) => {
    expect(accepts(formFieldSchema, MINIMAL_FIELDS[type])).toBe(true);
  });

  it.each(FORM_FIELD_TYPES)('refuses a broken %s field', (type) => {
    expect(accepts(formFieldSchema, BROKEN_FIELDS[type])).toBe(false);
  });

  it('defaults width, required and shareWithIntegrations', () => {
    expect(formFieldSchema.parse(MINIMAL_FIELDS.text)).toMatchObject({
      width: 1,
      required: false,
      shareWithIntegrations: false,
    });
  });

  it('refuses an unknown field type and an unknown key on a field', () => {
    expect(accepts(formFieldSchema, { id: 'f1', type: 'signature', key: 'sig' })).toBe(false);
    expect(accepts(formFieldSchema, { ...MINIMAL_FIELDS.text, colour: 'red' })).toBe(false);
  });
});

describe('formKeySchema and formElementIdSchema', () => {
  it.each(['a', 'name', 'company_name', 'a1', 'a'.repeat(64)])('accepts the key %s', (key) => {
    expect(accepts(formKeySchema, key)).toBe(true);
  });

  it.each(['', 'Name', '1a', '_a', 'a-b', 'a b', 'a'.repeat(65)])('refuses the key %j', (key) => {
    expect(accepts(formKeySchema, key)).toBe(false);
  });

  it.each(['f1', 'A_b-9', 'x'.repeat(40)])('accepts the element id %s', (id) => {
    expect(accepts(formElementIdSchema, id)).toBe(true);
  });

  it.each(['', 'a b', 'a.b', 'x'.repeat(41)])('refuses the element id %j', (id) => {
    expect(accepts(formElementIdSchema, id)).toBe(false);
  });
});

describe('visibilityRuleSchema — bounds', () => {
  const condition = { fieldId: 'f1', operator: 'equals', value: 'x' } as const;

  it('accepts ten groups and twenty conditions', () => {
    const groups = Array.from({ length: 10 }, () => [condition, condition]);
    expect(accepts(visibilityRuleSchema, { connective: 'and', groups })).toBe(true);
  });

  it('refuses an eleventh group', () => {
    const groups = Array.from({ length: 11 }, () => [condition]);
    expect(accepts(visibilityRuleSchema, { connective: 'and', groups })).toBe(false);
  });

  it('refuses a twenty-first condition across groups', () => {
    const groups = [Array.from({ length: 11 }, () => condition), Array.from({ length: 10 }, () => condition)];
    expect(accepts(visibilityRuleSchema, { connective: 'or', groups })).toBe(false);
  });

  it('refuses an empty rule, an empty group and an unknown operator', () => {
    expect(accepts(visibilityRuleSchema, { connective: 'and', groups: [] })).toBe(false);
    expect(accepts(visibilityRuleSchema, { connective: 'and', groups: [[]] })).toBe(false);
    expect(
      accepts(visibilityRuleSchema, { connective: 'and', groups: [[{ ...condition, operator: 'matches' }]] }),
    ).toBe(false);
  });

  it('accepts the two empty tests without a value', () => {
    expect(
      accepts(visibilityRuleSchema, { connective: 'and', groups: [[{ fieldId: 'f1', operator: 'is_empty' }]] }),
    ).toBe(true);
  });
});

describe('formRestrictionsSchema — the availability window', () => {
  const base = { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false };

  it('accepts an open window, a window and a maximum', () => {
    expect(accepts(formRestrictionsSchema, base)).toBe(true);
    expect(
      accepts(formRestrictionsSchema, {
        ...base,
        maxEntries: 100,
        availableFrom: '2026-11-01T00:00:00.000Z',
        availableUntil: '2026-12-01T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('refuses a window that ends before or when it starts', () => {
    for (const until of ['2026-10-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z']) {
      expect(
        accepts(formRestrictionsSchema, { ...base, availableFrom: '2026-11-01T00:00:00.000Z', availableUntil: until }),
      ).toBe(false);
    }
  });

  it('refuses a maximum outside 1…1 000 000', () => {
    expect(accepts(formRestrictionsSchema, { ...base, maxEntries: 0 })).toBe(false);
    expect(accepts(formRestrictionsSchema, { ...base, maxEntries: 1_000_001 })).toBe(false);
  });
});

describe('formDefinitionSchema — the working copy', () => {
  it('accepts a definition holding one field of every type', () => {
    expect(accepts(formDefinitionSchema, definitionWith(Object.values(MINIMAL_FIELDS)))).toBe(true);
  });

  it('refuses an unknown key, so recipients cannot be smuggled into a definition', () => {
    expect(accepts(formDefinitionSchema, definitionWith([], { recipients: ['x@example.com'] }))).toBe(false);
    const withFlag = definitionWith([]) as FormDefinitionInput;
    expect(
      accepts(formDefinitionSchema, { ...withFlag, behaviour: { ...withFlag.behaviour, notify: true } }),
    ).toBe(false);
  });

  it('refuses a definition with no section, and one with more than thirty', () => {
    const one = definitionWith([]) as FormDefinitionInput;
    expect(accepts(formDefinitionSchema, { ...one, sections: [] })).toBe(false);
    const sections = Array.from({ length: 31 }, (_, i) => ({ id: `s${i}`, columns: 1, fields: [] }));
    expect(accepts(formDefinitionSchema, { ...one, sections })).toBe(false);
  });

  it('refuses more than a hundred fields across sections', () => {
    const fields = (offset: number) =>
      Array.from({ length: 51 }, (_, i) => ({ id: `f${offset + i}`, type: 'text', key: `k${offset + i}` }));
    const one = definitionWith([]) as FormDefinitionInput;
    expect(
      accepts(formDefinitionSchema, {
        ...one,
        sections: [
          { id: 's1', columns: 1, fields: fields(0) },
          { id: 's2', columns: 1, fields: fields(100) },
        ],
      }),
    ).toBe(false);
  });

  it('refuses two elements with one id', () => {
    expect(
      accepts(
        formDefinitionSchema,
        definitionWith([MINIMAL_FIELDS.text, { ...MINIMAL_FIELDS.email, id: MINIMAL_FIELDS.text['id'] }]),
      ),
    ).toBe(false);
  });

  it('saves a half-built form: duplicate keys and missing options are publish rules, not shape', () => {
    expect(
      accepts(
        formDefinitionSchema,
        definitionWith([
          MINIMAL_FIELDS.text,
          { ...MINIMAL_FIELDS.email, key: 'name' },
          { ...MINIMAL_FIELDS.select, options: [] },
        ]),
      ),
    ).toBe(true);
  });

  it('refuses a schema version other than 1 and a text over the rich-text limit', () => {
    const one = definitionWith([]) as FormDefinitionInput;
    expect(accepts(formDefinitionSchema, { ...one, schemaVersion: 2 })).toBe(false);
    expect(
      accepts(formDefinitionSchema, {
        ...one,
        texts: { en: { 'form.title': 'x'.repeat(FORMS_LIMITS.richTextChars + 1) } },
      }),
    ).toBe(false);
  });
});

describe('publicFormDefinitionSchema (contracts/public-api.md §1)', () => {
  const FORM_ID = '0e8f3c1e-6c5c-4b39-9f55-6f7f1c2d9a10';

  it('accepts the unavailable arm, and nothing beside its two keys', () => {
    expect(accepts(publicFormDefinitionSchema, { formId: FORM_ID, availability: 'unavailable' })).toBe(true);
    expect(
      accepts(publicFormDefinitionSchema, { formId: FORM_ID, availability: 'unavailable', key: 'contact' }),
    ).toBe(false);
  });

  it('accepts an open form with resolved texts and refuses a share flag on a public field', () => {
    const open = {
      formId: FORM_ID,
      key: 'contact',
      version: 1,
      language: 'en',
      availability: 'open',
      signedInOnly: false,
      captcha: null,
      texts: { title: 'Contact us', submitLabel: 'Send' },
      sections: [
        {
          id: 's1',
          columns: 1,
          fields: [{ id: 'f1', type: 'text', key: 'name', width: 1, required: true, label: 'Name' }],
        },
      ],
      confirmation: { type: 'message' },
    };
    expect(accepts(publicFormDefinitionSchema, open)).toBe(true);
    const leaking = JSON.parse(JSON.stringify(open)) as typeof open;
    (leaking.sections[0]!.fields[0] as Record<string, unknown>)['shareWithIntegrations'] = true;
    expect(accepts(publicFormDefinitionSchema, leaking)).toBe(false);
    expect(accepts(publicFormDefinitionSchema, { ...open, recipients: [] })).toBe(false);
  });
});

describe('formSubmitBodySchema (contracts/public-api.md §2)', () => {
  it('accepts posted values, a page address, the honeypot and a token', () => {
    expect(
      accepts(formSubmitBodySchema, {
        values: { name: 'Ann', interests: ['a', 'b'], 'address.city': 'Warsaw' },
        pageUrl: '/contact?x=1',
        hp: '',
        captchaToken: 'token',
      }),
    ).toBe(true);
  });

  it('refuses a body naming the attribution, which only the server stamps (FR-045)', () => {
    expect(accepts(formSubmitBodySchema, { values: {}, customerAccountId: UUID })).toBe(false);
    expect(accepts(formSubmitBodySchema, { values: {}, organizationId: UUID })).toBe(false);
  });

  it('refuses a page address that is not a same-origin path', () => {
    for (const pageUrl of ['https://evil.example/', '//evil.example/', 'contact', `/${'x'.repeat(2048)}`]) {
      expect(accepts(formSubmitBodySchema, { values: {}, pageUrl })).toBe(false);
    }
  });

  it('refuses a token over 4 096 characters', () => {
    expect(accepts(formSubmitBodySchema, { values: {}, captchaToken: 'x'.repeat(4097) })).toBe(false);
  });
});

describe('FormEntrySubmittedEventV1Schema (contracts/events-and-webhook.md §1)', () => {
  const event = {
    eventId: 'evt-1',
    occurredAt: '2026-11-02T10:00:00.000Z',
    eventType: 'forms.entry.submitted.v1',
    entryId: UUID,
    formId: UUID,
    formKey: 'contact',
    formVersion: 2,
    salesChannelId: UUID,
    organizationId: null,
    language: 'pl',
    pageUrl: '/kontakt',
    submittedAt: '2026-11-02T10:00:00.000Z',
    answers: { email: 'ann@example.com', interests: ['doors'], company: true },
  };

  it('accepts its payload', () => {
    expect(FormEntrySubmittedEventV1Schema.parse(event)).toEqual(event);
  });

  it('refuses an internal note and any other key it does not declare', () => {
    expect(accepts(FormEntrySubmittedEventV1Schema, { ...event, internalNote: 'call back' })).toBe(false);
    expect(accepts(FormEntrySubmittedEventV1Schema, { ...event, customerAccountId: UUID })).toBe(
      false,
    );
  });

  it('requires the envelope', () => {
    for (const key of ['eventId', 'occurredAt', 'eventType'] as const) {
      const { [key]: _omitted, ...rest } = event;
      expect(accepts(FormEntrySubmittedEventV1Schema, rest)).toBe(false);
    }
  });

  it('is the one webhook type, versioned (OQ-3)', () => {
    expect(FORMS_WEBHOOK_EVENT_TYPES).toEqual(['forms.entry.submitted.v1']);
    expect(FORMS_EVENTS.ENTRY_SUBMITTED).toBe('forms.entry.submitted.v1');
    expect(FORMS_WEBHOOK_EVENT_SCHEMAS['forms.entry.submitted.v1']).toBe(FormEntrySubmittedEventV1Schema);
  });
});

describe('FORMS_STOREFRONT_CACHE_TAGS (research R-21, FR-063)', () => {
  it('names one public form read by its id', () => {
    expect(FORMS_STOREFRONT_CACHE_TAGS.form(UUID)).toBe(`forms:form:${UUID}`);
  });

  it('stays within the length Next keeps a tag at', () => {
    expect(FORMS_STOREFRONT_CACHE_TAGS.form(UUID).length).toBeLessThanOrEqual(FORMS_STOREFRONT_CACHE_TAGS.maxLength);
    expect(FORMS_STOREFRONT_CACHE_TAGS.maxLength).toBe(256);
  });
});

describe('formLanguagesResponseSchema (the builder\'s language list, T039 deviation)', () => {
  it('accepts the storefront languages and the default one among them', () => {
    expect(formLanguagesResponseSchema.parse({ languages: ['en-US', 'pl-PL'], defaultLanguage: 'en-US' })).toEqual({
      languages: ['en-US', 'pl-PL'],
      defaultLanguage: 'en-US',
    });
  });

  it('refuses a default language outside the list, and any other key', () => {
    expect(formLanguagesResponseSchema.safeParse({ languages: ['en-US'], defaultLanguage: 'pl-PL' }).success).toBe(false);
    expect(
      formLanguagesResponseSchema.safeParse({ languages: ['en-US'], defaultLanguage: 'en-US', channels: [] }).success,
    ).toBe(false);
  });
});
