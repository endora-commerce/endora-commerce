import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, type FormDefinition, type FormDefinitionInput } from './forms.js';
import {
  definitionIssues,
  neutraliseSpreadsheetCell,
  resolveTexts,
  searchTextOf,
  sharedAnswers,
  textCompleteness,
  validateSubmission,
  visibleElements,
} from './forms-logic.js';
import {
  FORMS_SUBMISSION_FIXTURES,
  FORMS_VISIBILITY_FIXTURES,
  fixtureDefinition,
} from './forms-logic.fixtures.js';

/**
 * `specs/170-forms-module/` T008 — the shared evaluator of `contracts/form-definition.md` §2, one
 * test per behaviour line of §3, driven where it can be by the shared fixture set (B12).
 */

const parse = (definition: FormDefinitionInput): FormDefinition => formDefinitionSchema.parse(definition);

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('visibleElements — the shared fixture set (FR-030–FR-032, B2–B4)', () => {
  it.each(FORMS_VISIBILITY_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const visible = visibleElements(parse(fixture.definition), fixture.answers);
    expect(sorted(visible.sections)).toEqual(sorted(fixture.expected.sections));
    expect(sorted(visible.fields)).toEqual(sorted(fixture.expected.fields));
  });

  it('is deterministic: the same input twice gives the same sets', () => {
    for (const fixture of FORMS_VISIBILITY_FIXTURES) {
      const definition = parse(fixture.definition);
      const first = visibleElements(definition, fixture.answers);
      const second = visibleElements(definition, fixture.answers);
      expect(sorted(second.fields)).toEqual(sorted(first.fields));
    }
  });
});

describe('validateSubmission — the shared fixture set (B1–B11)', () => {
  it.each(FORMS_SUBMISSION_FIXTURES.map((f) => [f.name, f] as const))('%s', (_name, fixture) => {
    const known = new Set(fixture.knownCountries);
    const result = validateSubmission(parse(fixture.definition), fixture.raw, {
      isKnownCountry: (code) => known.has(code),
    });
    expect(result).toEqual(fixture.expected);
  });

  it('is byte-identical across runs (B12)', () => {
    for (const fixture of FORMS_SUBMISSION_FIXTURES) {
      const known = new Set(fixture.knownCountries);
      const ctx = { isKnownCountry: (code: string) => known.has(code) };
      const definition = parse(fixture.definition);
      expect(JSON.stringify(validateSubmission(definition, fixture.raw, ctx))).toBe(
        JSON.stringify(validateSubmission(definition, fixture.raw, ctx)),
      );
    }
  });
});

/** A publishable definition, mutated per case. */
function publishable(): FormDefinitionInput {
  return fixtureDefinition(
    [
      {
        id: 's1',
        columns: 2,
        fields: [
          { id: 'fname', type: 'text', key: 'name', required: true },
          { id: 'femail', type: 'email', key: 'email', submitterEmail: true },
          {
            id: 'ftopic',
            type: 'select',
            key: 'topic',
            options: [
              { id: 'o1', value: 'sales' },
              { id: 'o2', value: 'support' },
            ],
          },
          { id: 'fprivacy', type: 'privacy_consent', key: 'privacy', required: true },
          { id: 'fintro', type: 'content' },
        ],
      },
    ],
    {
      en: {
        'fields.fname.label': 'Name',
        'fields.femail.label': 'E-mail',
        'fields.ftopic.label': 'Topic',
        'fields.fprivacy.content': '<p>I accept the privacy policy</p>',
      },
    },
  );
}

type SectionInput = FormDefinitionInput['sections'][number];
type FieldInput = SectionInput['fields'][number];

function withFields(extra: FieldInput[], columns: 1 | 2 | 3 = 2): FormDefinitionInput {
  const definition = publishable();
  const section = definition.sections[0]!;
  return { ...definition, sections: [{ ...section, columns, fields: [...section.fields, ...extra] }] };
}

/** Every case below passes the shape (saving validates the shape only); the rules are publish-time. */
const codes = (definition: FormDefinitionInput, defaultLanguage = 'en'): string[] =>
  definitionIssues(parse(definition), defaultLanguage).map((issue) => issue.code);

describe('definitionIssues — the publish rules (data-model §3.5, FR-011, FR-033)', () => {
  it('finds nothing in a publishable definition', () => {
    expect(definitionIssues(parse(publishable()), 'en')).toEqual([]);
  });

  it('reports each issue with its element id and path', () => {
    const issues = definitionIssues(parse(withFields([{ id: 'fdup', type: 'text', key: 'name' }])), 'en');
    expect(issues).toContainEqual({ code: 'duplicate_key', elementId: 'fdup', path: 'sections[0].fields[5].key' });
  });

  it('duplicate_key', () => {
    expect(codes(withFields([{ id: 'fdup', type: 'phone', key: 'email' }]))).toContain('duplicate_key');
  });

  it('missing_options and duplicate_option_value', () => {
    expect(codes(withFields([{ id: 'fr', type: 'radio', key: 'r', options: [] }]))).toContain('missing_options');
    expect(
      codes(
        withFields([
          {
            id: 'fc',
            type: 'checkboxes',
            key: 'c',
            options: [
              { id: 'o1', value: 'a' },
              { id: 'o2', value: 'a' },
            ],
          },
        ]),
      ),
    ).toContain('duplicate_option_value');
  });

  it('unknown_condition_field and condition_on_layout_element', () => {
    expect(
      codes(
        withFields([
          {
            id: 'fx',
            type: 'text',
            key: 'x',
            visibility: { connective: 'and', groups: [[{ fieldId: 'nowhere', operator: 'is_empty' }]] },
          },
        ]),
      ),
    ).toContain('unknown_condition_field');
    expect(
      codes(
        withFields([
          {
            id: 'fx',
            type: 'text',
            key: 'x',
            visibility: { connective: 'and', groups: [[{ fieldId: 'fintro', operator: 'is_empty' }]] },
          },
        ]),
      ),
    ).toContain('condition_on_layout_element');
  });

  it('operator_not_allowed for the referenced type', () => {
    expect(
      codes(
        withFields([
          {
            id: 'fx',
            type: 'text',
            key: 'x',
            visibility: {
              connective: 'and',
              groups: [[{ fieldId: 'ftopic', operator: 'greater_than', value: 3 }]],
            },
          },
        ]),
      ),
    ).toContain('operator_not_allowed');
  });

  it('cyclic_visibility, direct', () => {
    expect(
      codes(
        withFields([
          {
            id: 'fa',
            type: 'text',
            key: 'a',
            visibility: { connective: 'and', groups: [[{ fieldId: 'fb', operator: 'is_empty' }]] },
          },
          {
            id: 'fb',
            type: 'text',
            key: 'b',
            visibility: { connective: 'and', groups: [[{ fieldId: 'fa', operator: 'is_empty' }]] },
          },
        ]),
      ),
    ).toContain('cyclic_visibility');
  });

  it('cyclic_visibility, indirect through a section rule', () => {
    const definition = publishable();
    const issues = codes({
      ...definition,
      sections: [
        definition.sections[0]!,
        {
          id: 's2',
          columns: 1,
          visibility: { connective: 'and', groups: [[{ fieldId: 'fc', operator: 'is_not_empty' }]] },
          fields: [
            {
              id: 'fb',
              type: 'text',
              key: 'b',
              visibility: { connective: 'and', groups: [[{ fieldId: 'fname', operator: 'is_not_empty' }]] },
            },
          ],
        },
        {
          id: 's3',
          columns: 1,
          fields: [
            {
              id: 'fc',
              type: 'text',
              key: 'c',
              visibility: { connective: 'and', groups: [[{ fieldId: 'fb', operator: 'is_not_empty' }]] },
            },
          ],
        },
      ],
      texts: { en: { ...definition.texts['en'], 'fields.fb.label': 'B', 'fields.fc.label': 'C' } },
    });
    expect(issues).toContain('cyclic_visibility');
  });

  it('multiple_submitter_email', () => {
    expect(codes(withFields([{ id: 'fe2', type: 'email', key: 'email2', submitterEmail: true }]))).toContain(
      'multiple_submitter_email',
    );
  });

  it('min_above_max for lengths, numbers, selections and dates', () => {
    for (const field of [
      { id: 'fx', type: 'text', key: 'x', minLength: 10, maxLength: 5 },
      { id: 'fx', type: 'number', key: 'x', min: 10, max: 5 },
      { id: 'fx', type: 'textarea', key: 'x', minLength: 10, maxLength: 5 },
      {
        id: 'fx',
        type: 'checkboxes',
        key: 'x',
        minSelected: 2,
        maxSelected: 1,
        options: [
          { id: 'o1', value: 'a' },
          { id: 'o2', value: 'b' },
        ],
      },
      { id: 'fx', type: 'datetime', key: 'x', mode: 'date', earliest: '2026-12-01', latest: '2026-01-01' },
    ] as FieldInput[]) {
      expect(codes(withFields([field]))).toContain('min_above_max');
    }
  });

  it('invalid_redirect_url and invalid_page_reference', () => {
    for (const url of ['ftp://example.com', '/relative', 'not a url']) {
      const definition = publishable();
      expect(
        codes({ ...definition, behaviour: { ...definition.behaviour, confirmation: { type: 'redirect', url } } }),
      ).toContain('invalid_redirect_url');
    }
    const definition = publishable();
    expect(
      codes({
        ...definition,
        behaviour: { ...definition.behaviour, confirmation: { type: 'page', cmsPageId: 'not-a-uuid' } },
      }),
    ).toContain('invalid_page_reference');
    expect(
      codes({
        ...definition,
        behaviour: { ...definition.behaviour, confirmation: { type: 'redirect', url: 'https://example.com/thanks' } },
      }),
    ).toEqual([]);
  });

  it('consent_must_be_required and marketing_consent_required', () => {
    expect(
      codes(
        withFields([{ id: 'ft', type: 'terms', key: 'terms', required: false }]),
      ),
    ).toContain('consent_must_be_required');
    expect(codes(withFields([{ id: 'fm', type: 'marketing_consent', key: 'm', required: true }]))).toContain(
      'marketing_consent_required',
    );
  });

  it('width_exceeds_columns', () => {
    expect(codes(withFields([{ id: 'fw', type: 'text', key: 'w', width: 3 }], 2))).toContain('width_exceeds_columns');
  });

  it('missing_default_language_label — an input field with no label in the default language', () => {
    expect(codes(withFields([{ id: 'fnew', type: 'text', key: 'fresh' }]))).toContain(
      'missing_default_language_label',
    );
    expect(codes(publishable(), 'pl')).toContain('missing_default_language_label');
  });

  it('the limits and the window, defensively, on a definition that skipped the shape', () => {
    const base = parse(publishable());
    const first = base.sections[0]!.fields[0]!;
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ ...first, id: `f${i}`, key: `k${i}` }));
    const tooManyFields = { ...base, sections: [{ ...base.sections[0]!, fields: many(101) }] } as FormDefinition;
    expect(definitionIssues(tooManyFields, 'en').map((i) => i.code)).toContain('too_many_fields');
    const tooManySections = {
      ...base,
      sections: Array.from({ length: 31 }, (_, i) => ({ ...base.sections[0]!, id: `s${i}`, fields: [] })),
    } as FormDefinition;
    expect(definitionIssues(tooManySections, 'en').map((i) => i.code)).toContain('too_many_sections');
    const select = base.sections[0]!.fields[2]!;
    const tooManyOptions = {
      ...base,
      sections: [
        {
          ...base.sections[0]!,
          fields: [
            { ...select, options: Array.from({ length: 201 }, (_, i) => ({ id: `o${i}`, value: `v${i}` })) },
          ],
        },
      ],
    } as FormDefinition;
    expect(definitionIssues(tooManyOptions, 'en').map((i) => i.code)).toContain('too_many_options');
    const condition = { fieldId: 'fname', operator: 'is_empty' } as const;
    const tooManyConditions = {
      ...base,
      sections: [{ ...base.sections[0]!, visibility: { connective: 'and', groups: [Array(21).fill(condition)] } }],
    } as FormDefinition;
    expect(definitionIssues(tooManyConditions, 'en').map((i) => i.code)).toContain('too_many_conditions');
    const badWindow = {
      ...base,
      restrictions: {
        ...base.restrictions,
        availableFrom: '2026-12-01T00:00:00.000Z',
        availableUntil: '2026-11-01T00:00:00.000Z',
      },
    } as FormDefinition;
    expect(definitionIssues(badWindow, 'en').map((i) => i.code)).toContain('invalid_window');
    const badKey = {
      ...base,
      sections: [{ ...base.sections[0]!, fields: [{ ...base.sections[0]!.fields[0]!, key: 'Bad Key' }] }],
    } as FormDefinition;
    expect(definitionIssues(badKey, 'en').map((i) => i.code)).toContain('invalid_key');
  });
});

describe('resolveTexts — the R-7 fallback', () => {
  const definition = parse(
    fixtureDefinition([{ id: 's1', columns: 1, fields: [] }], {
      en: { 'form.title': 'Contact', 'form.description': 'Write to us', 'form.submitLabel': 'Send' },
      pl: { 'form.title': 'Kontakt', 'form.description': '   ' },
    }),
  );

  it('answers the requested language, then the default, then nothing', () => {
    const text = resolveTexts(definition, 'pl', 'en');
    expect(text('form.title')).toBe('Kontakt');
    expect(text('form.description')).toBe('Write to us');
    expect(text('form.submitLabel')).toBe('Send');
    expect(text('messages.closed')).toBeUndefined();
  });

  it('treats a language with no texts as the default', () => {
    expect(resolveTexts(definition, 'de', 'en')('form.title')).toBe('Contact');
  });
});

describe('textCompleteness — FR-018, US7-2', () => {
  it('lists, per language, the texts that fall back', () => {
    const definition = parse(
      fixtureDefinition([{ id: 's1', columns: 1, fields: [] }], {
        en: { 'form.title': 'Contact', 'form.description': 'Write to us' },
        pl: { 'form.title': 'Kontakt', 'form.description': '' },
      }),
    );
    expect(textCompleteness(definition, ['en', 'pl', 'de'], 'en')).toEqual([
      { language: 'en', missing: [] },
      { language: 'pl', missing: ['form.description'] },
      { language: 'de', missing: ['form.description', 'form.title'] },
    ]);
  });
});

const ANSWERS_DEFINITION = parse(
  fixtureDefinition([
    {
      id: 's1',
      columns: 1,
      fields: [
        { id: 'f1', type: 'text', key: 'name', shareWithIntegrations: true },
        { id: 'f2', type: 'email', key: 'email' },
        { id: 'f3', type: 'textarea', key: 'message', shareWithIntegrations: true },
        { id: 'f4', type: 'phone', key: 'phone' },
        { id: 'f5', type: 'hidden', key: 'campaign', source: 'static', staticValue: 'autumn' },
        { id: 'f6', type: 'marketing_consent', key: 'marketing', shareWithIntegrations: true },
        { id: 'f7', type: 'number', key: 'qty' },
      ],
    },
  ]),
);

describe('sharedAnswers — FR-064', () => {
  it('keeps the answers of fields marked shared, and nothing else', () => {
    expect(
      sharedAnswers(ANSWERS_DEFINITION, {
        name: 'Ann',
        email: 'ann@example.com',
        phone: '+48 600 100 200',
        marketing: true,
        qty: 2,
      }),
    ).toEqual({ name: 'Ann', marketing: true });
  });

  it('is empty when no field is shared', () => {
    const none = parse(fixtureDefinition([{ id: 's1', columns: 1, fields: [{ id: 'f1', type: 'text', key: 'a' }] }]));
    expect(sharedAnswers(none, { a: 'x' })).toEqual({});
  });
});

describe('searchTextOf — R-18', () => {
  it('joins the lower-cased text answers, hidden values excluded', () => {
    expect(
      searchTextOf(ANSWERS_DEFINITION, {
        name: 'Ann SMITH',
        email: 'Ann@Example.com',
        message: 'Need a QUOTE',
        phone: '+48 600',
        campaign: 'AUTUMN',
        qty: 3,
      }),
    ).toBe('ann smith\nann@example.com\nneed a quote\n+48 600');
  });

  it('caps the text at 20 000 characters', () => {
    expect(searchTextOf(ANSWERS_DEFINITION, { message: 'x'.repeat(30000) })).toHaveLength(20000);
  });
});

describe('neutraliseSpreadsheetCell — R-18', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@cmd', '\tx', '\rx'])('prefixes %j with an apostrophe', (value) => {
    expect(neutraliseSpreadsheetCell(value)).toBe(`'${value}`);
  });

  it.each(['plain', '', '1=1', 'a@b'])('leaves %j alone', (value) => {
    expect(neutraliseSpreadsheetCell(value)).toBe(value);
  });
});
