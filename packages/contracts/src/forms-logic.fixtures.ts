import type { FormDefinitionInput, FormFieldErrorCode } from './forms.js';
import type { AnswerValue, ConsentInput } from './forms-logic.js';

/**
 * The shared fixture set of the forms evaluator (`specs/170-forms-module/contracts/form-definition.md`
 * B12). **Plain data**: no test runner is imported, so the same file is run by the contracts suite
 * (`forms-logic.test.ts`), by `mod-forms`' submission tests and by `cms-components`' block-state
 * test — three consumers, one expectation, which is what makes "the client and the server agree" a
 * fact rather than a hope.
 *
 * A definition is written in the schema's **input** shape (`FormDefinitionInput`) and parsed by
 * the consumer with `formDefinitionSchema.parse`, so the defaults (`width`, `required`,
 * `shareWithIntegrations`) are the schema's and not restated here.
 */

/** One visibility case: the answers given and the element ids that must be visible. */
export interface FormsVisibilityFixture {
  readonly name: string;
  /** The behaviour line of form-definition.md §3 this case holds. */
  readonly behaviour: string;
  readonly definition: FormDefinitionInput;
  readonly answers: Readonly<Record<string, unknown>>;
  readonly expected: { readonly sections: readonly string[]; readonly fields: readonly string[] };
}

/** One submission case: the raw posted values and the server's verdict. */
export interface FormsSubmissionFixture {
  readonly name: string;
  readonly behaviour: string;
  readonly definition: FormDefinitionInput;
  readonly raw: Readonly<Record<string, string | readonly string[]>>;
  /** The country codes the context's `isKnownCountry` accepts. */
  readonly knownCountries: readonly string[];
  readonly expected:
    | {
        readonly ok: true;
        readonly answers: Readonly<Record<string, AnswerValue>>;
        readonly consents: readonly ConsentInput[];
      }
    | { readonly ok: false; readonly errors: readonly { fieldKey: string; code: FormFieldErrorCode }[] };
}

type SectionInput = FormDefinitionInput['sections'][number];

/** A definition with the neutral behaviour and restrictions; only the sections vary. */
export function fixtureDefinition(
  sections: readonly SectionInput[],
  texts: FormDefinitionInput['texts'] = {},
): FormDefinitionInput {
  return {
    schemaVersion: 1,
    sections: [...sections],
    behaviour: {
      confirmation: { type: 'message' },
      captchaRequired: false,
      confirmationEmail: { enabled: false, includeSummary: false },
    },
    restrictions: { maxEntries: null, availableFrom: null, availableUntil: null, signedInOnly: false },
    texts,
  };
}

const ADDRESS_PARTS = {
  street: { enabled: true, required: true },
  line2: { enabled: false, required: false },
  postalCode: { enabled: true, required: false },
  city: { enabled: true, required: true },
  country: { enabled: true, required: false },
} as const;

/** `(a = x ∧ b = y) ∨ (a = z)` on `c` — the `and` connective inside groups, `or` between them. */
const AND_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 1,
    fields: [
      { id: 'fa', type: 'text', key: 'a' },
      { id: 'fb', type: 'text', key: 'b' },
      {
        id: 'fc',
        type: 'text',
        key: 'c',
        visibility: {
          connective: 'and',
          groups: [
            [
              { fieldId: 'fa', operator: 'equals', value: 'x' },
              { fieldId: 'fb', operator: 'equals', value: 'y' },
            ],
            [{ fieldId: 'fa', operator: 'equals', value: 'z' }],
          ],
        },
      },
    ],
  },
]);

/** `(a = x ∨ n > 5) ∧ (n < 100)` on `c` — the `or` connective inside groups, `and` between them. */
const OR_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 1,
    fields: [
      { id: 'fa', type: 'text', key: 'a' },
      { id: 'fn', type: 'number', key: 'n' },
      {
        id: 'fc',
        type: 'text',
        key: 'c',
        visibility: {
          connective: 'or',
          groups: [
            [
              { fieldId: 'fa', operator: 'equals', value: 'x' },
              { fieldId: 'fn', operator: 'greater_than', value: 5 },
            ],
            [{ fieldId: 'fn', operator: 'less_than', value: 100 }],
          ],
        },
      },
    ],
  },
]);

/** A section shown only when `a` is `show`; its fields go with it. */
const SECTION_RULE_DEFINITION = fixtureDefinition([
  { id: 's1', columns: 1, fields: [{ id: 'fa', type: 'radio', key: 'a', options: [
    { id: 'o1', value: 'show' },
    { id: 'o2', value: 'hide' },
  ] }] },
  {
    id: 's2',
    columns: 2,
    visibility: { connective: 'and', groups: [[{ fieldId: 'fa', operator: 'equals', value: 'show' }]] },
    fields: [
      { id: 'fd', type: 'text', key: 'd' },
      { id: 'fe', type: 'email', key: 'e' },
    ],
  },
]);

/** `b` shown when `a` is `x`; `c` shown when `b` is empty; `g` shown when `b` is not `filled`. */
const HIDDEN_AS_EMPTY_FIELDS: SectionInput['fields'] = [
  { id: 'fa', type: 'text', key: 'a' },
  {
    id: 'fb',
    type: 'text',
    key: 'b',
    visibility: { connective: 'and', groups: [[{ fieldId: 'fa', operator: 'equals', value: 'x' }]] },
  },
  {
    id: 'fc',
    type: 'text',
    key: 'c',
    visibility: { connective: 'and', groups: [[{ fieldId: 'fb', operator: 'is_empty' }]] },
  },
  {
    id: 'fg',
    type: 'text',
    key: 'g',
    visibility: { connective: 'and', groups: [[{ fieldId: 'fb', operator: 'not_equals', value: 'filled' }]] },
  },
];

const HIDDEN_AS_EMPTY_DEFINITION = fixtureDefinition([
  { id: 's1', columns: 1, fields: [...HIDDEN_AS_EMPTY_FIELDS] },
]);

/** The same rules with the dependants written **before** what they depend on (B4). */
const HIDDEN_AS_EMPTY_REVERSED = fixtureDefinition([
  { id: 's1', columns: 1, fields: [...HIDDEN_AS_EMPTY_FIELDS].reverse() },
]);

/** `a` and `b` each shown only when the other is filled — a cycle `definitionIssues` refuses. */
const CYCLE_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 1,
    fields: [
      {
        id: 'fa',
        type: 'text',
        key: 'a',
        visibility: { connective: 'and', groups: [[{ fieldId: 'fb', operator: 'is_not_empty' }]] },
      },
      {
        id: 'fb',
        type: 'text',
        key: 'b',
        visibility: { connective: 'and', groups: [[{ fieldId: 'fa', operator: 'is_not_empty' }]] },
      },
      { id: 'fz', type: 'text', key: 'z' },
    ],
  },
]);

/** A checkbox group, a single checkbox and a date, each driving a field. */
const TYPED_CONDITIONS_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 1,
    fields: [
      {
        id: 'ftopics',
        type: 'checkboxes',
        key: 'topics',
        options: [
          { id: 'o1', value: 'sales' },
          { id: 'o2', value: 'support' },
        ],
      },
      {
        id: 'fsupport',
        type: 'textarea',
        key: 'support_detail',
        visibility: {
          connective: 'and',
          groups: [[{ fieldId: 'ftopics', operator: 'contains', value: 'support' }]],
        },
      },
      { id: 'fagree', type: 'checkbox', key: 'company' },
      {
        id: 'fvat',
        type: 'text',
        key: 'vat',
        visibility: { connective: 'and', groups: [[{ fieldId: 'fagree', operator: 'equals', value: 'true' }]] },
      },
      { id: 'fdate', type: 'datetime', key: 'visit', mode: 'date' },
      {
        id: 'flate',
        type: 'text',
        key: 'late_reason',
        visibility: {
          connective: 'and',
          groups: [[{ fieldId: 'fdate', operator: 'greater_than', value: '2026-12-01' }]],
        },
      },
    ],
  },
]);

export const FORMS_VISIBILITY_FIXTURES: readonly FormsVisibilityFixture[] = [
  {
    name: 'and inside a group, or between groups: first group holds',
    behaviour: 'FR-030',
    definition: AND_DEFINITION,
    answers: { a: 'x', b: 'y' },
    expected: { sections: ['s1'], fields: ['fa', 'fb', 'fc'] },
  },
  {
    name: 'and inside a group, or between groups: half of the first group holds',
    behaviour: 'FR-030',
    definition: AND_DEFINITION,
    answers: { a: 'x', b: 'n' },
    expected: { sections: ['s1'], fields: ['fa', 'fb'] },
  },
  {
    name: 'and inside a group, or between groups: the second group holds alone',
    behaviour: 'FR-030',
    definition: AND_DEFINITION,
    answers: { a: 'z' },
    expected: { sections: ['s1'], fields: ['fa', 'fb', 'fc'] },
  },
  {
    name: 'or inside a group, and between groups: a coerced number satisfies both groups',
    behaviour: 'FR-030, B2',
    definition: OR_DEFINITION,
    answers: { a: 'no', n: '10' },
    expected: { sections: ['s1'], fields: ['fa', 'fn', 'fc'] },
  },
  {
    name: 'or inside a group, and between groups: the second group fails',
    behaviour: 'FR-030, B2',
    definition: OR_DEFINITION,
    answers: { a: 'x', n: '150' },
    expected: { sections: ['s1'], fields: ['fa', 'fn'] },
  },
  {
    name: 'or inside a group: a comma decimal is a number',
    behaviour: 'B2, B5',
    definition: OR_DEFINITION,
    answers: { a: 'no', n: '5,5' },
    expected: { sections: ['s1'], fields: ['fa', 'fn', 'fc'] },
  },
  {
    name: 'a section rule shows the section and its fields',
    behaviour: 'US3-2',
    definition: SECTION_RULE_DEFINITION,
    answers: { a: 'show' },
    expected: { sections: ['s1', 's2'], fields: ['fa', 'fd', 'fe'] },
  },
  {
    name: 'a section rule hides the section and every field in it',
    behaviour: 'US3-2',
    definition: SECTION_RULE_DEFINITION,
    answers: { a: 'hide', d: 'typed anyway' },
    expected: { sections: ['s1'], fields: ['fa'] },
  },
  {
    name: 'a hidden field counts as empty in a dependent condition',
    behaviour: 'B3, US3-6',
    definition: HIDDEN_AS_EMPTY_DEFINITION,
    answers: { a: 'no', b: 'filled' },
    expected: { sections: ['s1'], fields: ['fa', 'fc', 'fg'] },
  },
  {
    name: 'a visible filled field is not empty',
    behaviour: 'B3',
    definition: HIDDEN_AS_EMPTY_DEFINITION,
    answers: { a: 'x', b: 'filled' },
    expected: { sections: ['s1'], fields: ['fa', 'fb'] },
  },
  {
    name: 'order independence: dependants written first evaluate the same',
    behaviour: 'B4',
    definition: HIDDEN_AS_EMPTY_REVERSED,
    answers: { a: 'no', b: 'filled' },
    expected: { sections: ['s1'], fields: ['fa', 'fc', 'fg'] },
  },
  {
    name: 'a cycle evaluates as hidden, defensively',
    behaviour: 'B4',
    definition: CYCLE_DEFINITION,
    answers: { a: 'one', b: 'two' },
    expected: { sections: ['s1'], fields: ['fz'] },
  },
  {
    name: 'contains on a checkbox group, equals true on a checkbox, greater than on a date',
    behaviour: 'R-6',
    definition: TYPED_CONDITIONS_DEFINITION,
    answers: { topics: ['support'], company: 'on', visit: '2026-12-24' },
    expected: { sections: ['s1'], fields: ['ftopics', 'fsupport', 'fagree', 'fvat', 'fdate', 'flate'] },
  },
  {
    name: 'an unticked checkbox and an earlier date hide their dependants',
    behaviour: 'R-6',
    definition: TYPED_CONDITIONS_DEFINITION,
    answers: { topics: ['sales'], visit: '2026-11-15' },
    expected: { sections: ['s1'], fields: ['ftopics', 'fagree', 'fdate'] },
  },
];

/** One field of every input type that validates, for the submission cases. */
const EVERY_TYPE_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 3,
    fields: [
      { id: 'f1', type: 'text', key: 'name', required: true, minLength: 2, maxLength: 40 },
      { id: 'f2', type: 'email', key: 'email', required: true, submitterEmail: true },
      { id: 'f3', type: 'phone', key: 'phone' },
      { id: 'f4', type: 'number', key: 'quantity', min: 1, max: 10, step: 0.5 },
      { id: 'f5', type: 'textarea', key: 'message', maxLength: 200 },
      {
        id: 'f6',
        type: 'select',
        key: 'topic',
        options: [
          { id: 'o1', value: 'sales' },
          { id: 'o2', value: 'support' },
        ],
      },
      {
        id: 'f7',
        type: 'radio',
        key: 'contact_by',
        options: [
          { id: 'o1', value: 'email' },
          { id: 'o2', value: 'phone' },
        ],
      },
      {
        id: 'f8',
        type: 'checkboxes',
        key: 'interests',
        minSelected: 1,
        maxSelected: 2,
        options: [
          { id: 'o1', value: 'doors' },
          { id: 'o2', value: 'windows' },
          { id: 'o3', value: 'gates' },
        ],
      },
      { id: 'f9', type: 'checkbox', key: 'company' },
      { id: 'f10', type: 'datetime', key: 'visit', mode: 'date', earliest: '2026-01-01', latest: '2026-12-31' },
      { id: 'f11', type: 'country', key: 'country', allowedCountries: ['PL', 'DE'] },
      { id: 'f12', type: 'address', key: 'address', parts: ADDRESS_PARTS },
      { id: 'f13', type: 'hidden', key: 'campaign', source: 'query_param', paramName: 'utm_campaign' },
      { id: 'f14', type: 'privacy_consent', key: 'privacy', required: true },
      { id: 'f15', type: 'marketing_consent', key: 'marketing' },
      { id: 'f16', type: 'terms', key: 'terms', required: true },
      { id: 'f17', type: 'content' },
      { id: 'f18', type: 'section_break' },
    ],
  },
]);

const EVERY_TYPE_VALID_RAW = {
  name: '  Ann Smith  ',
  email: ' Ann@Example.COM ',
  phone: '+48 600 100 200',
  quantity: '2,5',
  message: 'Line one\nLine two',
  topic: 'support',
  contact_by: 'email',
  interests: ['doors', 'gates'],
  company: 'on',
  visit: '2026-06-30',
  country: 'pl',
  'address.street': 'Main 1',
  'address.postalCode': '00-001',
  'address.city': 'Warsaw',
  'address.country': 'PL',
  campaign: 'autumn',
  privacy: 'on',
  terms: 'true',
} as const;

/** The patterns, and a hidden value over the cap. */
const PATTERN_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 1,
    fields: [
      { id: 'p1', type: 'text', key: 'digits', pattern: 'digits' },
      { id: 'p2', type: 'text', key: 'letters', pattern: 'letters' },
      { id: 'p3', type: 'text', key: 'alnum', pattern: 'alphanumeric' },
      { id: 'p4', type: 'text', key: 'site', pattern: 'url' },
      { id: 'p5', type: 'hidden', key: 'page', source: 'page_url' },
    ],
  },
]);

/** A required field behind a rule, for B2/B3 at the server. */
const CONDITIONAL_REQUIRED_DEFINITION = fixtureDefinition([
  {
    id: 's1',
    columns: 1,
    fields: [
      {
        id: 'fa',
        type: 'radio',
        key: 'kind',
        required: true,
        options: [
          { id: 'o1', value: 'person' },
          { id: 'o2', value: 'company' },
        ],
      },
      {
        id: 'fb',
        type: 'text',
        key: 'company_name',
        required: true,
        visibility: { connective: 'and', groups: [[{ fieldId: 'fa', operator: 'equals', value: 'company' }]] },
      },
    ],
  },
]);

export const FORMS_SUBMISSION_FIXTURES: readonly FormsSubmissionFixture[] = [
  {
    name: 'every input type, valid, normalised',
    behaviour: 'B1, B5, B10, B11',
    definition: EVERY_TYPE_DEFINITION,
    raw: { ...EVERY_TYPE_VALID_RAW, bogus: 'ignored' },
    knownCountries: ['PL', 'DE', 'FR'],
    expected: {
      ok: true,
      answers: {
        name: 'Ann Smith',
        email: 'ann@example.com',
        phone: '+48 600 100 200',
        quantity: 2.5,
        message: 'Line one\nLine two',
        topic: 'support',
        contact_by: 'email',
        interests: ['doors', 'gates'],
        company: true,
        visit: '2026-06-30',
        country: 'PL',
        address: { street: 'Main 1', postalCode: '00-001', city: 'Warsaw', country: 'PL' },
        campaign: 'autumn',
        privacy: true,
        marketing: false,
        terms: true,
      },
      consents: [
        { fieldKey: 'privacy', kind: 'privacy', given: true },
        { fieldKey: 'marketing', kind: 'marketing', given: false },
        { fieldKey: 'terms', kind: 'terms', given: true },
      ],
    },
  },
  {
    // An empty optional field skips every check (`minSelected` included); an optional address with
    // no part typed is skipped as a whole — its parts' `required` binds once any part is typed.
    name: 'empty optional fields are not stored; required ones and the consents are refused',
    behaviour: 'B6',
    definition: EVERY_TYPE_DEFINITION,
    raw: { name: '   ', email: '' },
    knownCountries: ['PL'],
    expected: {
      ok: false,
      errors: [
        { fieldKey: 'name', code: 'required' },
        { fieldKey: 'email', code: 'required' },
        { fieldKey: 'privacy', code: 'consent_required' },
        { fieldKey: 'terms', code: 'consent_required' },
      ],
    },
  },
  {
    name: 'coercion and limits refuse each malformed value with its own code',
    behaviour: 'B5, B7, B8, B10',
    definition: EVERY_TYPE_DEFINITION,
    raw: {
      ...EVERY_TYPE_VALID_RAW,
      name: 'A',
      email: 'not-an-address',
      phone: '12',
      quantity: '1,2',
      message: 'x'.repeat(201),
      topic: 'billing',
      contact_by: 'fax',
      interests: ['doors', 'windows', 'gates'],
      visit: '2026-02-31',
      country: 'FR',
      'address.country': 'XX',
    },
    knownCountries: ['PL', 'DE', 'FR'],
    expected: {
      ok: false,
      errors: [
        { fieldKey: 'name', code: 'too_short' },
        { fieldKey: 'email', code: 'invalid_email' },
        { fieldKey: 'phone', code: 'invalid_phone' },
        { fieldKey: 'quantity', code: 'step_mismatch' },
        { fieldKey: 'message', code: 'too_long' },
        { fieldKey: 'topic', code: 'unknown_option' },
        { fieldKey: 'contact_by', code: 'unknown_option' },
        { fieldKey: 'interests', code: 'too_many' },
        { fieldKey: 'visit', code: 'invalid_date' },
        { fieldKey: 'country', code: 'invalid_country' },
        { fieldKey: 'address.country', code: 'invalid_country' },
      ],
    },
  },
  {
    name: 'bounds: below the minimum, above the maximum, too early, a line break in a single line',
    behaviour: 'B5, B7',
    definition: EVERY_TYPE_DEFINITION,
    raw: {
      ...EVERY_TYPE_VALID_RAW,
      name: 'Ann\nSmith',
      quantity: '0.5',
      visit: '2025-12-31',
      country: 'DE',
    },
    knownCountries: ['PL'],
    expected: {
      ok: false,
      errors: [
        { fieldKey: 'name', code: 'single_line' },
        { fieldKey: 'quantity', code: 'below_min' },
        { fieldKey: 'visit', code: 'too_early' },
        { fieldKey: 'country', code: 'invalid_country' },
      ],
    },
  },
  {
    name: 'above the maximum, too late, not a number',
    behaviour: 'B5, B7',
    definition: EVERY_TYPE_DEFINITION,
    raw: { ...EVERY_TYPE_VALID_RAW, quantity: '11', visit: '2027-01-01', phone: 'call me' },
    knownCountries: ['PL', 'DE'],
    expected: {
      ok: false,
      errors: [
        { fieldKey: 'phone', code: 'invalid_phone' },
        { fieldKey: 'quantity', code: 'above_max' },
        { fieldKey: 'visit', code: 'too_late' },
      ],
    },
  },
  {
    name: 'an address with one part typed requires its required parts',
    behaviour: 'B6',
    definition: EVERY_TYPE_DEFINITION,
    raw: {
      ...EVERY_TYPE_VALID_RAW,
      'address.street': '',
      'address.city': ' ',
      'address.line2': 'ignored: the part is not enabled',
    },
    knownCountries: ['PL', 'DE'],
    expected: {
      ok: false,
      errors: [
        { fieldKey: 'address.street', code: 'required' },
        { fieldKey: 'address.city', code: 'required' },
      ],
    },
  },
  {
    name: 'a number that is not one',
    behaviour: 'B5',
    definition: EVERY_TYPE_DEFINITION,
    raw: { ...EVERY_TYPE_VALID_RAW, quantity: 'two' },
    knownCountries: ['PL'],
    expected: { ok: false, errors: [{ fieldKey: 'quantity', code: 'invalid_number' }] },
  },
  {
    name: 'patterns refuse; a hidden value over the cap is truncated, not refused',
    behaviour: 'B7, B9',
    definition: PATTERN_DEFINITION,
    raw: { digits: '12a', letters: 'Zażółć1', alnum: 'abc-1', site: 'ftp://example.com', page: 'x'.repeat(1200) },
    knownCountries: [],
    expected: {
      ok: false,
      errors: [
        { fieldKey: 'digits', code: 'pattern' },
        { fieldKey: 'letters', code: 'pattern' },
        { fieldKey: 'alnum', code: 'pattern' },
        { fieldKey: 'site', code: 'pattern' },
      ],
    },
  },
  {
    name: 'patterns accept Unicode letters and an absolute https address',
    behaviour: 'B7, B9',
    definition: PATTERN_DEFINITION,
    raw: { digits: '0042', letters: 'Zażółć', alnum: 'Gęś42', site: 'https://example.com/a?b=1', page: 'x'.repeat(1200) },
    knownCountries: [],
    expected: {
      ok: true,
      answers: {
        digits: '0042',
        letters: 'Zażółć',
        alnum: 'Gęś42',
        site: 'https://example.com/a?b=1',
        page: 'x'.repeat(1000),
      },
      consents: [],
    },
  },
  {
    name: 'a value posted for a hidden field is dropped; a hidden required field is not required',
    behaviour: 'B2, B3, US3-3',
    definition: CONDITIONAL_REQUIRED_DEFINITION,
    raw: { kind: 'person', company_name: 'Smuggled Ltd' },
    knownCountries: [],
    expected: { ok: true, answers: { kind: 'person' }, consents: [] },
  },
  {
    name: 'a required field becomes required once its rule shows it',
    behaviour: 'B6',
    definition: CONDITIONAL_REQUIRED_DEFINITION,
    raw: { kind: 'company' },
    knownCountries: [],
    expected: { ok: false, errors: [{ fieldKey: 'company_name', code: 'required' }] },
  },
  {
    name: 'a section rule drops the values of every field in it',
    behaviour: 'B2, US3-2',
    definition: SECTION_RULE_DEFINITION,
    raw: { a: 'hide', d: 'typed anyway', e: 'x@example.com' },
    knownCountries: [],
    expected: { ok: true, answers: { a: 'hide' }, consents: [] },
  },
];
