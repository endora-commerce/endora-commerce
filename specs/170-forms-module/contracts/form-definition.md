# Contract: the form definition and its shared evaluator

Normative for `specs/170-forms-module/`. Source of truth: Zod schemas in
`packages/contracts/src/forms.ts` and pure functions in `packages/contracts/src/forms-logic.ts`, both
re-exported from `packages/contracts/src/index.ts` (Principle II; research R-5). The JSON shape is
`data-model.md` §3; this file fixes the **exports** and their **behaviour**.

## §1 Exports of `forms.ts`

```ts
export const FORMS_LIMITS: {
  fieldsPerForm: 100; sectionsPerForm: 30; optionsPerChoice: 200;
  conditionsPerRule: 20; groupsPerRule: 10;
  singleLineChars: 1000; multiLineChars: 10000; hiddenChars: 1000; richTextChars: 20000;
  keyChars: 64; nameChars: 200; recipients: 10; channelOverrides: 50;
  noteChars: 5000; retentionDaysMax: 3650; bulkDeleteMax: 200;
  submissionBytes: 262144; searchTextChars: 20000; pageUrlChars: 2048;
};
export const FORM_FIELD_TYPES: readonly [
  'text','email','phone','number','textarea','select','radio','checkboxes','checkbox',
  'datetime','country','address','hidden','content','section_break',
  'privacy_consent','marketing_consent','terms',
];
export const FORM_INPUT_FIELD_TYPES: readonly FormFieldType[];       // all but content, section_break
export const FORM_CONDITION_OPERATORS: readonly [...8 operators];
export const FORM_CONDITION_OPERATORS_BY_TYPE: Readonly<Record<FormFieldType, readonly FormConditionOperator[]>>;
export const FORM_STATUSES: readonly ['draft','published','closed'];
export const FORM_ENTRY_STATUSES: readonly ['new','read','closed','spam'];
export const FORM_AVAILABILITY: readonly ['open','closed','not_yet_open','full','unavailable'];
export const FORM_FIELD_ERROR_CODES: readonly [
  'required','invalid_email','invalid_phone','invalid_number','too_short','too_long',
  'below_min','above_max','step_mismatch','invalid_date','too_early','too_late',
  'too_few','too_many','unknown_option','pattern','single_line','invalid_country',
  'consent_required',
];
export const FORM_DEFINITION_ISSUE_CODES: readonly [...data-model §3.5];
export const FORMS_ERROR_CODES: { /* R-25, 13 codes */ };
export const FORMS_EVENTS: { ENTRY_SUBMITTED: 'forms.entry.submitted.v1'; FORM_CHANGED: 'forms.form.changed' };
export const FORMS_WEBHOOK_EVENT_TYPES: readonly ['forms.entry.submitted.v1'];
export const FORMS_WEBHOOK_EVENT_SCHEMAS: { 'forms.entry.submitted.v1': typeof FormEntrySubmittedEventV1Schema };
export const FORMS_SETTING_CODES: { ENABLED; CAPTCHA_PROVIDER; CAPTCHA_SITE_KEY; CAPTCHA_SECRET_KEY };
export const FORMS_PERMISSIONS: { READ: 'forms:read'; WRITE: 'forms:write'; ENTRIES_READ: 'forms:entries_read';
                                  ENTRIES_WRITE: 'forms:entries_write'; ENTRIES_EXPORT: 'forms:entries_export' };

export const formKeySchema;            // ^[a-z][a-z0-9_]{0,63}$
export const formElementIdSchema;      // ^[A-Za-z0-9_-]{1,40}$
export const visibilityRuleSchema;
export const formFieldSchema;          // z.discriminatedUnion('type', [...18])
export const formSectionSchema;
export const formBehaviourSchema;
export const formRestrictionsSchema;
export const formTextsSchema;          // Record<lang, Record<textId, string>>, values ≤ richTextChars
export const formDefinitionSchema;     // shape only — saving a working copy
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export const answerValueSchema;
export const formConsentRecordSchema;
// + every admin/public request and response schema of admin-api.md and public-api.md
// + FormEntrySubmittedEventV1Schema, FormChangedEventSchema (events-and-webhook.md)
```

Every object schema is `.strict()`. `formDefinitionSchema` refuses unknown keys, so a client cannot
smuggle recipients or flags into a definition.

## §2 Exports of `forms-logic.ts` (pure, browser-safe, no Node built-in, no I/O)

```ts
/** Element ids visible for these answers (sections and fields), FR-030–FR-032. */
export function visibleElements(definition: FormDefinition, answers: Readonly<Record<string, unknown>>): {
  sections: ReadonlySet<string>; fields: ReadonlySet<string>;
};

/** The publish-time rules; [] = publishable. data-model §3.5. */
export function definitionIssues(definition: FormDefinition): FormDefinitionIssue[];

export interface SubmissionContext {
  /** Validates a country code; the server passes the dictionary check, the client a set lookup. */
  isKnownCountry(code: string): boolean;
  /** "Now" for date bounds that are relative — none in Phase 1; reserved for determinism in tests. */
  now?: Date;
}

/**
 * Server-authoritative validation of raw posted values (strings, string arrays) against a version:
 * drops values of hidden and unknown fields, coerces by type, applies required/limits/patterns,
 * and returns either the normalised answers + consents or per-field errors. FR-032, FR-034, FR-036.
 */
export function validateSubmission(
  definition: FormDefinition,
  raw: Readonly<Record<string, string | readonly string[]>>,
  ctx: SubmissionContext,
): { ok: true; answers: Record<string, AnswerValue>; consents: ConsentInput[] }
 | { ok: false; errors: { fieldKey: string; code: FormFieldErrorCode }[] };

/** Texts for one language with the R-7 fallback; built-ins are the caller's. */
export function resolveTexts(definition: FormDefinition, language: string, defaultLanguage: string):
  (textId: string) => string | undefined;

/** Per language, the text ids that fall back to the default language. FR-018, US7-2. */
export function textCompleteness(definition: FormDefinition, languages: readonly string[], defaultLanguage: string):
  { language: string; missing: string[] }[];

/** The answers that `shareWithIntegrations` fields of this version expose. FR-064. */
export function sharedAnswers(definition: FormDefinition, answers: Readonly<Record<string, AnswerValue>>):
  Record<string, AnswerValue>;

/** Text answers joined for search, lower-cased, capped. R-18. */
export function searchTextOf(definition: FormDefinition, answers: Readonly<Record<string, AnswerValue>>): string;

/** One CSV-safe cell: prefixes =, +, -, @, TAB, CR with an apostrophe. R-18. */
export function neutraliseSpreadsheetCell(value: string): string;
```

## §3 Behaviour (each line is a unit test in `forms-logic.test.ts`)

**B1 Raw input shape.** `raw` is the posted form: a string per single-valued field, a string array for
checkbox groups, `<key>.<part>` for address parts. Anything not named by an input field of the
version is ignored (US3-5).

**B2 Visibility first.** `visibleElements` is computed from the **coerced** raw values (so a number
condition sees a number); then every value of a field not in `fields` is dropped (US3-3).

**B3 Hidden counts as empty.** In conditions, a hidden field's value is empty — `is_empty` true,
`equals` false, `not_equals` true (US3-6).

**B4 Topological order.** Evaluation never depends on field order; a cycle is impossible after
`definitionIssues` (FR-033) and, defensively, an element in a cycle evaluates as hidden.

**B5 Coercion.** Strings are trimmed; `text`, `email`, `phone`, `hidden`, `datetime`, `select`,
`radio`, `country` refuse a CR/LF (`single_line`); `number` parses `.`/`,` decimal (`invalid_number`);
`checkbox` and consents are `true` iff the value is `on`/`true`; `datetime` must match its mode and
be a real date (`invalid_date`).

**B6 Required.** A visible required field with an empty value → `required`; for consents →
`consent_required`; privacy and terms are always required when visible; marketing never.

**B7 Limits.** Field limits, then the global caps (1 000 / 10 000 / 1 000 for hidden — hidden values
are **truncated**, not refused, as the edge case states), `too_short`/`too_long`,
`below_min`/`above_max`/`step_mismatch`, `too_early`/`too_late`, `too_few`/`too_many`.

**B8 Options.** A value not among the field's option values → `unknown_option`; a country outside
`allowedCountries` or refused by `ctx.isKnownCountry` → `invalid_country`.

**B9 Patterns.** `digits` `^[0-9]+$`, `letters` `^\p{L}+$`u, `alphanumeric` `^[\p{L}0-9]+$`u, `url`
absolute `http(s)` URL; no operator-supplied regex exists (A-8).

**B10 E-mail & phone.** E-mail: the contracts' shared `normalizeEmailAddress` + RFC-shape check;
phone: `^\+?[0-9][0-9 ()./-]{3,30}$` with ≥ 4 digits (FR-028).

**B11 Consents.** For each visible consent field, a `ConsentInput { fieldKey, kind, given }`; the
**text** is attached by the server from the version's texts in the submission language (never from
the client).

**B12 Determinism.** Same definition + same raw input ⇒ byte-identical output on Node and in the
browser. A shared fixture set (`packages/contracts/src/forms-logic.fixtures.ts`) is run by the
contracts tests, by `mod-forms`' submission test and by `cms-components`' block-state test.
