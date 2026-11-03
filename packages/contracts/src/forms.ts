import { z } from 'zod';
import { isoDateTimeSchema } from './common.js';

/**
 * Forms (`specs/170-forms-module/`) — the definition of a form, the admin and public API shapes,
 * the events, and the module's constants. Normative: `contracts/form-definition.md` §1,
 * `contracts/admin-api.md`, `contracts/public-api.md`, `contracts/events-and-webhook.md` §1–§2.
 *
 * The behaviour over these shapes — visibility, the publish rules, server-side validation — is
 * `forms-logic.ts`, beside this file, so the backend, the storefront renderer and the admin preview
 * evaluate one implementation (research R-5).
 *
 * Every object schema is strict: a definition refuses an unknown key, so a client cannot smuggle
 * recipients or flags into it, and the public submission refuses an attribution it did not earn.
 */

// --- Constants ---------------------------------------------------------------------------------

/** Research R-27. */
export const FORMS_LIMITS = {
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
} as const;

export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'number',
  'textarea',
  'select',
  'radio',
  'checkboxes',
  'checkbox',
  'datetime',
  'country',
  'address',
  'hidden',
  'content',
  'section_break',
  'privacy_consent',
  'marketing_consent',
  'terms',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

/** The layout elements: they take no answer and carry no key. */
export const FORM_LAYOUT_ELEMENT_TYPES = ['content', 'section_break'] as const satisfies readonly FormFieldType[];

/** Every type that takes an answer. */
export const FORM_INPUT_FIELD_TYPES = FORM_FIELD_TYPES.filter(
  (type): type is Exclude<FormFieldType, (typeof FORM_LAYOUT_ELEMENT_TYPES)[number]> =>
    !(FORM_LAYOUT_ELEMENT_TYPES as readonly string[]).includes(type),
);
export type FormInputFieldType = (typeof FORM_INPUT_FIELD_TYPES)[number];

/** The three consent types; their answer is also recorded with the text shown (FR-029). */
export const FORM_CONSENT_TYPES = ['privacy_consent', 'marketing_consent', 'terms'] as const satisfies readonly FormFieldType[];

export const FORM_CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'greater_than',
  'less_than',
  'contains',
  'not_contains',
  'is_empty',
  'is_not_empty',
] as const;
export type FormConditionOperator = (typeof FORM_CONDITION_OPERATORS)[number];

const EMPTY_TESTS = ['is_empty', 'is_not_empty'] as const;
const TEXT_OPERATORS = ['equals', 'not_equals', 'contains', 'not_contains', ...EMPTY_TESTS] as const;
const ORDERED_OPERATORS = ['equals', 'not_equals', 'greater_than', 'less_than', ...EMPTY_TESTS] as const;
const CHOICE_OPERATORS = ['equals', 'not_equals', ...EMPTY_TESTS] as const;
const GROUP_OPERATORS = ['contains', 'not_contains', ...EMPTY_TESTS] as const;
const BOOLEAN_OPERATORS = ['equals', ...EMPTY_TESTS] as const;

/** Which operators a condition may apply to a referenced field of each type (data-model §3.2). */
export const FORM_CONDITION_OPERATORS_BY_TYPE: Readonly<Record<FormFieldType, readonly FormConditionOperator[]>> = {
  text: TEXT_OPERATORS,
  email: TEXT_OPERATORS,
  phone: TEXT_OPERATORS,
  textarea: TEXT_OPERATORS,
  hidden: TEXT_OPERATORS,
  number: ORDERED_OPERATORS,
  datetime: ORDERED_OPERATORS,
  select: CHOICE_OPERATORS,
  radio: CHOICE_OPERATORS,
  country: CHOICE_OPERATORS,
  checkboxes: GROUP_OPERATORS,
  checkbox: BOOLEAN_OPERATORS,
  privacy_consent: BOOLEAN_OPERATORS,
  marketing_consent: BOOLEAN_OPERATORS,
  terms: BOOLEAN_OPERATORS,
  address: EMPTY_TESTS,
  content: [],
  section_break: [],
};

export const FORM_STATUSES = ['draft', 'published', 'closed'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FORM_ENTRY_STATUSES = ['new', 'read', 'closed', 'spam'] as const;
export type FormEntryStatus = (typeof FORM_ENTRY_STATUSES)[number];

export const FORM_AVAILABILITY = ['open', 'closed', 'not_yet_open', 'full', 'unavailable'] as const;
export type FormAvailability = (typeof FORM_AVAILABILITY)[number];

/** The refusal tokens of `FORM_NOT_ACCEPTING` (research R-25). */
export const FORM_NOT_ACCEPTING_REASONS = ['closed', 'not_yet_open', 'full', 'sign_in_required', 'unavailable'] as const;
export type FormNotAcceptingReason = (typeof FORM_NOT_ACCEPTING_REASONS)[number];

export const FORM_FIELD_ERROR_CODES = [
  'required',
  'invalid_email',
  'invalid_phone',
  'invalid_number',
  'too_short',
  'too_long',
  'below_min',
  'above_max',
  'step_mismatch',
  'invalid_date',
  'too_early',
  'too_late',
  'too_few',
  'too_many',
  'unknown_option',
  'pattern',
  'single_line',
  'invalid_country',
  'consent_required',
] as const;
export type FormFieldErrorCode = (typeof FORM_FIELD_ERROR_CODES)[number];

/** The publish rules (data-model §3.5), the tokens of `FORM_DEFINITION_INVALID`. */
export const FORM_DEFINITION_ISSUE_CODES = [
  'duplicate_key',
  'invalid_key',
  'missing_options',
  'duplicate_option_value',
  'unknown_condition_field',
  'condition_on_layout_element',
  'operator_not_allowed',
  'cyclic_visibility',
  'multiple_submitter_email',
  'min_above_max',
  'invalid_redirect_url',
  'invalid_page_reference',
  'consent_must_be_required',
  'marketing_consent_required',
  'width_exceeds_columns',
  'too_many_fields',
  'too_many_sections',
  'too_many_options',
  'too_many_conditions',
  'invalid_window',
  'missing_default_language_label',
] as const;
export type FormDefinitionIssueCode = (typeof FORM_DEFINITION_ISSUE_CODES)[number];

/** The error codes this module raises (research R-25). Each joins `ERROR_CODES` with its first raise site. */
export const FORMS_ERROR_CODES = {
  FORM_NOT_FOUND: 'FORM_NOT_FOUND',
  FORM_KEY_TAKEN: 'FORM_KEY_TAKEN',
  FORM_DEFINITION_INVALID: 'FORM_DEFINITION_INVALID',
  FORM_REVISION_CONFLICT: 'FORM_REVISION_CONFLICT',
  FORM_HAS_ENTRIES: 'FORM_HAS_ENTRIES',
  FORM_SCOPE_REQUIRED: 'FORM_SCOPE_REQUIRED',
  FORM_NOT_ACCEPTING: 'FORM_NOT_ACCEPTING',
  FORM_SUBMISSION_INVALID: 'FORM_SUBMISSION_INVALID',
  FORM_SUBMISSION_TOO_LARGE: 'FORM_SUBMISSION_TOO_LARGE',
  FORM_CAPTCHA_FAILED: 'FORM_CAPTCHA_FAILED',
  FORM_CAPTCHA_UNAVAILABLE: 'FORM_CAPTCHA_UNAVAILABLE',
  FORM_ENTRY_NOT_FOUND: 'FORM_ENTRY_NOT_FOUND',
  FORM_ENTRY_STATUS_CONFLICT: 'FORM_ENTRY_STATUS_CONFLICT',
} as const;

export const FORMS_EVENTS = {
  /** An entry was accepted; the webhook payload too (events-and-webhook.md §1). */
  ENTRY_SUBMITTED: 'forms.entry.submitted.v1',
  /** What the public read answers changed — internal, drives storefront revalidation (§2). */
  FORM_CHANGED: 'forms.form.changed',
} as const;

export const FORMS_WEBHOOK_EVENT_TYPES = [FORMS_EVENTS.ENTRY_SUBMITTED] as const;

export const FORMS_SETTING_CODES = {
  ENABLED: 'forms.enabled',
  CAPTCHA_PROVIDER: 'forms.captcha_provider',
  CAPTCHA_SITE_KEY: 'forms.captcha_site_key',
  CAPTCHA_SECRET_KEY: 'forms.captcha_secret_key',
} as const;

export const FORM_CAPTCHA_PROVIDERS = ['none', 'turnstile', 'hcaptcha'] as const;
export type FormCaptchaProvider = (typeof FORM_CAPTCHA_PROVIDERS)[number];

export const FORMS_PERMISSIONS = {
  READ: 'forms:read',
  WRITE: 'forms:write',
  ENTRIES_READ: 'forms:entries_read',
  ENTRIES_WRITE: 'forms:entries_write',
  ENTRIES_EXPORT: 'forms:entries_export',
} as const;

export const FORM_TEXT_PATTERNS = ['digits', 'letters', 'alphanumeric', 'url'] as const;
export const FORM_DATETIME_MODES = ['date', 'time', 'datetime'] as const;
export const FORM_HIDDEN_SOURCES = ['static', 'page_url', 'page_title', 'query_param', 'referrer'] as const;
export const FORM_ADDRESS_PARTS = ['street', 'line2', 'postalCode', 'city', 'country'] as const;
export type FormAddressPart = (typeof FORM_ADDRESS_PARTS)[number];

/** The shape of a `datetime` value in each mode — also the shape of its bounds. */
export const FORM_DATETIME_PATTERNS: Readonly<Record<(typeof FORM_DATETIME_MODES)[number], RegExp>> = {
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^([01]\d|2[0-3]):[0-5]\d$/,
  datetime: /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/,
};

// --- Identifiers -------------------------------------------------------------------------------

/** A field key: the column name of an answer, in the export and the webhook payload. */
export const formKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'a-z, 0-9 and _, starting with a letter');

/** A stable element id (section, field, option) — text ids are derived from it (R-7). */
export const formElementIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/);

/** A BCP-47-shaped language code, as the storefront languages are spelled. */
export const formLanguageSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

const textIdSchema = z.string().regex(/^[A-Za-z0-9_.-]{1,200}$/);

const widthSchema = z.number().int().min(1).max(3);

const lengthSchema = (max: number) => z.number().int().min(0).max(max);

// --- Visibility --------------------------------------------------------------------------------

export const formConditionSchema = z
  .object({
    fieldId: formElementIdSchema,
    operator: z.enum(FORM_CONDITION_OPERATORS),
    value: z.union([z.string().max(FORMS_LIMITS.singleLineChars), z.number().finite()]).optional(),
  })
  .strict();
export type FormCondition = z.infer<typeof formConditionSchema>;

/** Conditions inside a group are joined by `connective`, groups by the opposite one (FR-030). */
export const visibilityRuleSchema = z
  .object({
    connective: z.enum(['and', 'or']),
    groups: z.array(z.array(formConditionSchema).min(1)).min(1).max(FORMS_LIMITS.groupsPerRule),
  })
  .strict()
  .refine((rule) => rule.groups.flat().length <= FORMS_LIMITS.conditionsPerRule, {
    message: `At most ${FORMS_LIMITS.conditionsPerRule} conditions`,
    path: ['groups'],
  });
export type VisibilityRule = z.infer<typeof visibilityRuleSchema>;

// --- Fields ------------------------------------------------------------------------------------

const optionSchema = z
  .object({
    id: formElementIdSchema,
    value: z.string().trim().min(1).max(FORMS_LIMITS.nameChars),
  })
  .strict();

const optionsSchema = z.array(optionSchema).max(FORMS_LIMITS.optionsPerChoice);

const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/);

const addressPartSchema = z.object({ enabled: z.boolean(), required: z.boolean() }).strict();
/** `street` and `city` are always part of an address (data-model §3.1). */
const alwaysEnabledPartSchema = z.object({ enabled: z.literal(true), required: z.boolean() }).strict();

/** What every input field carries (data-model §3.1). */
const inputBase = {
  id: formElementIdSchema,
  key: formKeySchema,
  width: widthSchema.default(1),
  required: z.boolean().default(false),
  visibility: visibilityRuleSchema.optional(),
  shareWithIntegrations: z.boolean().default(false),
};

/** What a layout element carries. */
const layoutBase = {
  id: formElementIdSchema,
  width: widthSchema.default(1),
  visibility: visibilityRuleSchema.optional(),
};

/** The type-specific settings of each type, shared by the definition and the public read. */
const typeSettings = {
  text: {
    minLength: lengthSchema(FORMS_LIMITS.singleLineChars).optional(),
    maxLength: lengthSchema(FORMS_LIMITS.singleLineChars).optional(),
    pattern: z.enum(FORM_TEXT_PATTERNS).optional(),
    defaultValue: z.string().max(FORMS_LIMITS.singleLineChars).optional(),
  },
  email: {
    /** The answer that is the submitter's address: Reply-To and the confirmation (≤ 1 per form). */
    submitterEmail: z.boolean().default(false),
    defaultValue: z.string().max(FORMS_LIMITS.singleLineChars).optional(),
  },
  phone: {
    defaultValue: z.string().max(FORMS_LIMITS.singleLineChars).optional(),
  },
  number: {
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    defaultValue: z.number().finite().optional(),
  },
  textarea: {
    minLength: lengthSchema(FORMS_LIMITS.multiLineChars).optional(),
    maxLength: lengthSchema(FORMS_LIMITS.multiLineChars).optional(),
    defaultValue: z.string().max(FORMS_LIMITS.multiLineChars).optional(),
  },
  choice: {
    defaultValue: z.string().max(FORMS_LIMITS.nameChars).optional(),
  },
  checkboxes: {
    minSelected: z.number().int().min(0).max(FORMS_LIMITS.optionsPerChoice).optional(),
    maxSelected: z.number().int().min(0).max(FORMS_LIMITS.optionsPerChoice).optional(),
    defaultValue: z.array(z.string().max(FORMS_LIMITS.nameChars)).max(FORMS_LIMITS.optionsPerChoice).optional(),
  },
  checkbox: {
    defaultChecked: z.boolean().optional(),
  },
  datetime: {
    mode: z.enum(FORM_DATETIME_MODES),
    earliest: z.string().max(16).optional(),
    latest: z.string().max(16).optional(),
  },
  country: {
    allowedCountries: z.array(countryCodeSchema).max(300).optional(),
    defaultValue: countryCodeSchema.optional(),
  },
  hidden: {
    source: z.enum(FORM_HIDDEN_SOURCES),
    staticValue: z.string().max(FORMS_LIMITS.hiddenChars).optional(),
    paramName: z
      .string()
      .regex(/^[A-Za-z0-9_.-]{1,64}$/)
      .optional(),
  },
} as const;

/** A `datetime` field's bounds are written in the shape of its mode. */
function datetimeBoundsHold(field: {
  mode: (typeof FORM_DATETIME_MODES)[number];
  earliest?: string | undefined;
  latest?: string | undefined;
}): boolean {
  const pattern = FORM_DATETIME_PATTERNS[field.mode];
  return [field.earliest, field.latest].every((bound) => bound === undefined || pattern.test(bound));
}

const datetimeBoundsMessage = { message: 'Bounds must be written in the shape of the mode', path: ['earliest'] };

export const formFieldSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), ...inputBase, ...typeSettings.text }).strict(),
  z.object({ type: z.literal('email'), ...inputBase, ...typeSettings.email }).strict(),
  z.object({ type: z.literal('phone'), ...inputBase, ...typeSettings.phone }).strict(),
  z.object({ type: z.literal('number'), ...inputBase, ...typeSettings.number }).strict(),
  z.object({ type: z.literal('textarea'), ...inputBase, ...typeSettings.textarea }).strict(),
  z.object({ type: z.literal('select'), ...inputBase, options: optionsSchema, ...typeSettings.choice }).strict(),
  z.object({ type: z.literal('radio'), ...inputBase, options: optionsSchema, ...typeSettings.choice }).strict(),
  z.object({ type: z.literal('checkboxes'), ...inputBase, options: optionsSchema, ...typeSettings.checkboxes }).strict(),
  z.object({ type: z.literal('checkbox'), ...inputBase, ...typeSettings.checkbox }).strict(),
  z
    .object({ type: z.literal('datetime'), ...inputBase, ...typeSettings.datetime })
    .strict()
    .refine(datetimeBoundsHold, datetimeBoundsMessage),
  z.object({ type: z.literal('country'), ...inputBase, ...typeSettings.country }).strict(),
  z
    .object({
      type: z.literal('address'),
      ...inputBase,
      parts: z
        .object({
          street: alwaysEnabledPartSchema,
          line2: addressPartSchema,
          postalCode: addressPartSchema,
          city: alwaysEnabledPartSchema,
          country: addressPartSchema,
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('hidden'), ...inputBase, ...typeSettings.hidden }).strict(),
  z.object({ type: z.literal('content'), ...layoutBase }).strict(),
  z.object({ type: z.literal('section_break'), ...layoutBase }).strict(),
  // Consents are never pre-ticked: there is no `defaultChecked` to set (FR-029).
  z.object({ type: z.literal('privacy_consent'), ...inputBase }).strict(),
  z.object({ type: z.literal('marketing_consent'), ...inputBase }).strict(),
  z.object({ type: z.literal('terms'), ...inputBase }).strict(),
]);
export type FormField = z.infer<typeof formFieldSchema>;
export type FormFieldInput = z.input<typeof formFieldSchema>;
export type FormInputField = Exclude<FormField, { type: 'content' | 'section_break' }>;

export const formSectionSchema = z
  .object({
    id: formElementIdSchema,
    columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    visibility: visibilityRuleSchema.optional(),
    fields: z.array(formFieldSchema),
  })
  .strict();
export type FormSection = z.infer<typeof formSectionSchema>;

// --- Behaviour, restrictions, texts ------------------------------------------------------------

export const formConfirmationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message') }).strict(),
  z.object({ type: z.literal('redirect'), url: z.string().max(FORMS_LIMITS.pageUrlChars) }).strict(),
  z.object({ type: z.literal('page'), cmsPageId: z.string().max(64) }).strict(),
]);

export const formBehaviourSchema = z
  .object({
    confirmation: formConfirmationSchema,
    captchaRequired: z.boolean(),
    confirmationEmail: z.object({ enabled: z.boolean(), includeSummary: z.boolean() }).strict(),
  })
  .strict();
export type FormBehaviour = z.infer<typeof formBehaviourSchema>;

export const formRestrictionsSchema = z
  .object({
    maxEntries: z.number().int().min(1).max(1_000_000).nullable(),
    availableFrom: isoDateTimeSchema.nullable(),
    availableUntil: isoDateTimeSchema.nullable(),
    signedInOnly: z.boolean(),
  })
  .strict()
  .refine(
    (r) => r.availableFrom === null || r.availableUntil === null || Date.parse(r.availableUntil) > Date.parse(r.availableFrom),
    { message: 'The window must end after it starts', path: ['availableUntil'] },
  );
export type FormRestrictions = z.infer<typeof formRestrictionsSchema>;

/** `texts[language][textId]` — the text ids of data-model §3.6. */
export const formTextsSchema = z.record(
  formLanguageSchema,
  z.record(textIdSchema, z.string().max(FORMS_LIMITS.richTextChars)),
);
export type FormTexts = z.infer<typeof formTextsSchema>;

/** Every element id of a definition: sections and fields, once each. */
function elementIdsAreUnique(sections: readonly { id: string; fields: readonly { id: string }[] }[]): boolean {
  const ids = sections.flatMap((section) => [section.id, ...section.fields.map((field) => field.id)]);
  return new Set(ids).size === ids.length;
}

/**
 * The working copy and every published version. **Shape only**: a half-built form can be saved;
 * the publish rules are `definitionIssues` (FR-011). The shape holds the limits and the element-id
 * uniqueness the builder guarantees, which no shopper input can break.
 */
export const formDefinitionSchema = z
  .object({
    schemaVersion: z.literal(1),
    sections: z.array(formSectionSchema).min(1).max(FORMS_LIMITS.sectionsPerForm),
    behaviour: formBehaviourSchema,
    restrictions: formRestrictionsSchema,
    texts: formTextsSchema,
  })
  .strict()
  .refine((d) => d.sections.reduce((n, s) => n + s.fields.length, 0) <= FORMS_LIMITS.fieldsPerForm, {
    message: `At most ${FORMS_LIMITS.fieldsPerForm} fields`,
    path: ['sections'],
  })
  .refine((d) => elementIdsAreUnique(d.sections), { message: 'Element ids must be unique', path: ['sections'] });
export type FormDefinition = z.infer<typeof formDefinitionSchema>;
export type FormDefinitionInput = z.input<typeof formDefinitionSchema>;

export const formDefinitionIssueSchema = z
  .object({
    code: z.enum(FORM_DEFINITION_ISSUE_CODES),
    /** The element the issue is about; `null` for a form-level rule (the window, the redirect). */
    elementId: z.string().nullable(),
    /** Where in the definition, e.g. `sections[0].fields[2].key`. */
    path: z.string(),
  })
  .strict();
export type FormDefinitionIssue = z.infer<typeof formDefinitionIssueSchema>;

// --- Answers -----------------------------------------------------------------------------------

export const formAddressAnswerSchema = z
  .object({
    street: z.string().optional(),
    line2: z.string().optional(),
    postalCode: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  })
  .strict();

export const answerValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  formAddressAnswerSchema,
]);

export const FORM_CONSENT_KINDS = ['privacy', 'marketing', 'terms'] as const;

/** A consent as stored: what the shopper saw (sanitised HTML, submission language) and said. */
export const formConsentRecordSchema = z
  .object({
    fieldKey: formKeySchema,
    kind: z.enum(FORM_CONSENT_KINDS),
    given: z.boolean(),
    text: z.string().max(FORMS_LIMITS.richTextChars),
  })
  .strict();
export type FormConsentRecord = z.infer<typeof formConsentRecordSchema>;

// --- Admin API: forms (admin-api.md §1) ----------------------------------------------------------

const recipientSchema = z.string().email().max(254);
const recipientListSchema = z.array(recipientSchema).max(FORMS_LIMITS.recipients);

export const formWarningSchema = z.discriminatedUnion('code', [
  z.object({ code: z.literal('no_recipients') }).strict(),
  z.object({ code: z.literal('captcha_not_configured') }).strict(),
  z.object({ code: z.literal('untranslated'), language: formLanguageSchema, missing: z.number().int().min(1) }).strict(),
]);
export type FormWarning = z.infer<typeof formWarningSchema>;

export const formSummarySchema = z
  .object({
    id: z.string().uuid(),
    key: formKeySchema,
    name: z.string().min(1).max(FORMS_LIMITS.nameChars),
    status: z.enum(FORM_STATUSES),
    defaultLanguage: formLanguageSchema,
    publishedVersionNumber: z.number().int().min(0),
    entryCount: z.number().int().min(0),
    updatedAt: isoDateTimeSchema,
    warnings: z.array(formWarningSchema),
  })
  .strict();
export type FormSummary = z.infer<typeof formSummarySchema>;

export const formListQuerySchema = z
  .object({
    status: z.enum(FORM_STATUSES).optional(),
    q: z.string().trim().max(FORMS_LIMITS.nameChars).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const formListResponseSchema = z
  .object({ items: z.array(formSummarySchema), total: z.number().int().min(0) })
  .strict();

export const formCreateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(FORMS_LIMITS.nameChars),
    key: formKeySchema.optional(),
    defaultLanguage: formLanguageSchema,
  })
  .strict();
export type FormCreateBody = z.infer<typeof formCreateBodySchema>;

export const formDetailSchema = formSummarySchema
  .extend({
    definition: formDefinitionSchema,
    recipients: recipientListSchema,
    channelRecipients: z.record(z.string().uuid(), recipientListSchema),
    retentionDays: z.number().int().min(1).max(FORMS_LIMITS.retentionDaysMax).nullable(),
    revision: z.number().int().min(1),
    publishedDefinition: formDefinitionSchema.nullable(),
  })
  .strict();
export type FormDetail = z.infer<typeof formDetailSchema>;

export const formUpdateBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    name: z.string().trim().min(1).max(FORMS_LIMITS.nameChars).optional(),
    key: formKeySchema.optional(),
    defaultLanguage: formLanguageSchema.optional(),
    definition: formDefinitionSchema.optional(),
  })
  .strict();
export type FormUpdateBody = z.infer<typeof formUpdateBodySchema>;

export const formNotificationsBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    recipients: recipientListSchema,
    channelRecipients: z
      .record(z.string().uuid(), recipientListSchema)
      .refine((r) => Object.keys(r).length <= FORMS_LIMITS.channelOverrides, {
        message: `At most ${FORMS_LIMITS.channelOverrides} channel overrides`,
      }),
  })
  .strict();
export type FormNotificationsBody = z.infer<typeof formNotificationsBodySchema>;

export const formRetentionBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1),
    retentionDays: z.number().int().min(1).max(FORMS_LIMITS.retentionDaysMax).nullable(),
  })
  .strict();

export const formRetentionImpactQuerySchema = z
  .object({ days: z.coerce.number().int().min(1).max(FORMS_LIMITS.retentionDaysMax) })
  .strict();
export const formRetentionImpactResponseSchema = z.object({ entriesToDelete: z.number().int().min(0) }).strict();

/** Publish, close and reopen name the revision they act on (R-26). */
export const formRevisionBodySchema = z.object({ expectedRevision: z.number().int().min(1) }).strict();

export const formDuplicateBodySchema = z
  .object({ name: z.string().trim().min(1).max(FORMS_LIMITS.nameChars).optional() })
  .strict();

export const formDeleteQuerySchema = z
  .object({
    expectedRevision: z.coerce.number().int().min(1),
    confirmEntriesDeletion: z.enum(['true', 'false']).optional(),
  })
  .strict();

export const formVersionsResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          number: z.number().int().min(1),
          publishedAt: isoDateTimeSchema,
          publishedByAdminUserId: z.string().uuid().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const formVersionResponseSchema = z
  .object({
    number: z.number().int().min(1),
    definition: formDefinitionSchema,
    defaultLanguage: formLanguageSchema,
    publishedAt: isoDateTimeSchema,
  })
  .strict();

export const formPreviewQuerySchema = z
  .object({
    language: formLanguageSchema.optional(),
    source: z.enum(['working', 'published']).default('working'),
  })
  .strict();

/**
 * `GET …/admin/forms/languages` — the storefront languages of the active channels, which a form's
 * default language must be one of at create, and the builder's translation tabs; `defaultLanguage`
 * is the system-default channel's. Read with `forms:read`, so the builder needs no sales-channel
 * permission of its own.
 */
export const formLanguagesResponseSchema = z
  .object({ languages: z.array(formLanguageSchema).min(1), defaultLanguage: formLanguageSchema })
  .strict()
  .refine((value) => value.languages.includes(value.defaultLanguage), {
    message: 'The default language must be one of the languages',
    path: ['defaultLanguage'],
  });
export type FormLanguagesResponse = z.infer<typeof formLanguagesResponseSchema>;

// --- Public read (public-api.md §1) ------------------------------------------------------------

const publicErrorsSchema = z.partialRecord(z.enum(FORM_FIELD_ERROR_CODES), z.string());

/** Every input field in the public read: the definition minus the share flag, texts resolved. */
const publicInputBase = {
  id: formElementIdSchema,
  key: formKeySchema,
  width: widthSchema,
  required: z.boolean(),
  visibility: visibilityRuleSchema.optional(),
  label: z.string(),
  placeholder: z.string().optional(),
  help: z.string().optional(),
  /** Operator overrides of the built-in messages, resolved for the language (R-24). */
  errors: publicErrorsSchema.optional(),
};

const publicLayoutBase = {
  id: formElementIdSchema,
  width: widthSchema,
  visibility: visibilityRuleSchema.optional(),
};

const publicOptionSchema = z.object({ id: formElementIdSchema, value: z.string(), label: z.string() }).strict();
const publicOptionsSchema = z.array(publicOptionSchema);
const publicAddressPartSchema = z.object({ enabled: z.boolean(), required: z.boolean(), label: z.string() }).strict();

export const publicFormFieldSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), ...publicInputBase, ...typeSettings.text }).strict(),
  z
    .object({ type: z.literal('email'), ...publicInputBase, defaultValue: typeSettings.email.defaultValue })
    .strict(),
  z.object({ type: z.literal('phone'), ...publicInputBase, ...typeSettings.phone }).strict(),
  z.object({ type: z.literal('number'), ...publicInputBase, ...typeSettings.number }).strict(),
  z.object({ type: z.literal('textarea'), ...publicInputBase, ...typeSettings.textarea }).strict(),
  z.object({ type: z.literal('select'), ...publicInputBase, options: publicOptionsSchema, ...typeSettings.choice }).strict(),
  z.object({ type: z.literal('radio'), ...publicInputBase, options: publicOptionsSchema, ...typeSettings.choice }).strict(),
  z
    .object({ type: z.literal('checkboxes'), ...publicInputBase, options: publicOptionsSchema, ...typeSettings.checkboxes })
    .strict(),
  z.object({ type: z.literal('checkbox'), ...publicInputBase, ...typeSettings.checkbox }).strict(),
  z.object({ type: z.literal('datetime'), ...publicInputBase, ...typeSettings.datetime }).strict(),
  z.object({ type: z.literal('country'), ...publicInputBase, ...typeSettings.country }).strict(),
  z
    .object({
      type: z.literal('address'),
      ...publicInputBase,
      parts: z
        .object({
          street: publicAddressPartSchema,
          line2: publicAddressPartSchema,
          postalCode: publicAddressPartSchema,
          city: publicAddressPartSchema,
          country: publicAddressPartSchema,
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('hidden'), ...publicInputBase, ...typeSettings.hidden }).strict(),
  /** Rich text, sanitised by the renderer. */
  z.object({ type: z.literal('content'), ...publicLayoutBase, content: z.string() }).strict(),
  z.object({ type: z.literal('section_break'), ...publicLayoutBase, title: z.string() }).strict(),
  /** `content` is the consent's rich text — what the shopper agrees to. */
  z.object({ type: z.literal('privacy_consent'), ...publicInputBase, content: z.string() }).strict(),
  z.object({ type: z.literal('marketing_consent'), ...publicInputBase, content: z.string() }).strict(),
  z.object({ type: z.literal('terms'), ...publicInputBase, content: z.string() }).strict(),
]);
export type PublicFormField = z.infer<typeof publicFormFieldSchema>;

export const publicFormSectionSchema = z
  .object({
    id: formElementIdSchema,
    columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    visibility: visibilityRuleSchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(publicFormFieldSchema),
  })
  .strict();
export type PublicFormSection = z.infer<typeof publicFormSectionSchema>;

export const publicFormConfirmationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message') }).strict(),
  z.object({ type: z.literal('redirect'), url: z.string().max(FORMS_LIMITS.pageUrlChars) }).strict(),
  z.object({ type: z.literal('page'), path: z.string().max(FORMS_LIMITS.pageUrlChars) }).strict(),
]);

const publicFormUnavailableSchema = z
  .object({ formId: z.string().uuid(), availability: z.literal('unavailable') })
  .strict();

const publicFormAvailableSchema = z
  .object({
    formId: z.string().uuid(),
    key: formKeySchema,
    version: z.number().int().min(1),
    language: formLanguageSchema,
    availability: z.enum(['open', 'closed', 'not_yet_open', 'full']),
    signedInOnly: z.boolean(),
    /** Only when the version requires CAPTCHA **and** a provider is configured (R-14). */
    captcha: z
      .object({ provider: z.enum(['turnstile', 'hcaptcha']), siteKey: z.string().min(1) })
      .strict()
      .nullable(),
    texts: z
      .object({
        title: z.string().optional(),
        description: z.string().optional(),
        submitLabel: z.string().optional(),
        closed: z.string().optional(),
        notYetOpen: z.string().optional(),
        full: z.string().optional(),
        signIn: z.string().optional(),
        success: z.string().optional(),
      })
      .strict(),
    sections: z.array(publicFormSectionSchema),
    confirmation: publicFormConfirmationSchema,
  })
  .strict();

/** Always a `200` for a valid id: draft, deleted and never-existing forms are all `unavailable` (R-11). */
export const publicFormDefinitionSchema = z.union([publicFormUnavailableSchema, publicFormAvailableSchema]);
export type PublicFormDefinition = z.infer<typeof publicFormDefinitionSchema>;
export type AvailablePublicFormDefinition = z.infer<typeof publicFormAvailableSchema>;

/** `GET …/admin/forms/:id/preview` — the public read of the chosen copy, plus the form's status. */
export const formPreviewResponseSchema = z.union([
  publicFormUnavailableSchema.extend({ status: z.enum(FORM_STATUSES) }).strict(),
  publicFormAvailableSchema.extend({ status: z.enum(FORM_STATUSES) }).strict(),
]);

export const publicFormQuerySchema = z.object({ language: formLanguageSchema.optional() }).strict();

// --- Public submit (public-api.md §2) ----------------------------------------------------------

/**
 * The raw posted values, by field key and `<key>.<part>` for address parts. **No attribution
 * field**: the server stamps account and organisation from the session (FR-045).
 */
export const formSubmitBodySchema = z
  .object({
    values: z.record(z.string().max(200), z.union([z.string(), z.array(z.string()).max(FORMS_LIMITS.optionsPerChoice)])),
    pageUrl: z
      .string()
      .max(FORMS_LIMITS.pageUrlChars)
      .regex(/^\/(?!\/)/, 'A same-origin path')
      .optional(),
    hp: z.string().max(FORMS_LIMITS.singleLineChars).optional(),
    captchaToken: z.string().max(4096).optional(),
  })
  .strict();
export type FormSubmitBody = z.infer<typeof formSubmitBodySchema>;

export const formSubmitConfirmationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: z.string() }).strict(),
  z.object({ type: z.literal('redirect'), url: z.string() }).strict(),
  z.object({ type: z.literal('page'), path: z.string() }).strict(),
]);

export const formSubmitResponseSchema = z
  .object({ status: z.literal('accepted'), confirmation: formSubmitConfirmationSchema })
  .strict();
export type FormSubmitResponse = z.infer<typeof formSubmitResponseSchema>;

/** `details` of `400 FORM_SUBMISSION_INVALID`: one message per field, in the submission language. */
export const formSubmissionInvalidDetailsSchema = z
  .object({
    fields: z.array(
      z.object({ fieldKey: z.string(), code: z.enum(FORM_FIELD_ERROR_CODES), message: z.string() }).strict(),
    ),
  })
  .strict();

// --- Admin API: entries (admin-api.md §2) --------------------------------------------------------

const statusListSchema = z.preprocess(
  (value) => (typeof value === 'string' ? [value] : value),
  z.array(z.enum(FORM_ENTRY_STATUSES)).max(FORM_ENTRY_STATUSES.length),
);

const entryFilterShape = {
  formId: z.string().uuid().optional(),
  status: statusListSchema.optional(),
  submittedFrom: isoDateTimeSchema.optional(),
  submittedTo: isoDateTimeSchema.optional(),
  salesChannelId: z.string().uuid().optional(),
  q: z.string().trim().max(FORMS_LIMITS.nameChars).optional(),
};

export const formEntryListQuerySchema = z
  .object({
    ...entryFilterShape,
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();
export type FormEntryListQuery = z.infer<typeof formEntryListQuerySchema>;

/** The export's columns are per form, so the form is required (R-18). */
export const formEntryExportQuerySchema = z
  .object({ ...entryFilterShape, formId: z.string().uuid() })
  .strict();

export const formEntrySummarySchema = z
  .object({
    id: z.string().uuid(),
    formId: z.string().uuid(),
    formName: z.string(),
    formVersion: z.number().int().min(1),
    status: z.enum(FORM_ENTRY_STATUSES),
    salesChannelId: z.string().uuid(),
    language: formLanguageSchema,
    submittedAt: isoDateTimeSchema,
    submitterEmail: z.string().nullable(),
    attributed: z.boolean(),
  })
  .strict();
export type FormEntrySummary = z.infer<typeof formEntrySummarySchema>;

export const formEntryListResponseSchema = z
  .object({ items: z.array(formEntrySummarySchema), nextCursor: z.string().nullable() })
  .strict();

export const formEntryNoteSchema = z
  .object({
    id: z.string().uuid(),
    body: z.string(),
    authorAdminUserId: z.string().uuid().nullable(),
    createdAt: isoDateTimeSchema,
  })
  .strict();

export const formEntryDetailSchema = formEntrySummarySchema
  .extend({
    pageUrl: z.string().nullable(),
    /** In the version's order with the version's labels; a field removed later is still listed. */
    answers: z.array(
      z
        .object({ fieldKey: z.string(), label: z.string(), type: z.enum(FORM_FIELD_TYPES), value: answerValueSchema })
        .strict(),
    ),
    consents: z.array(formConsentRecordSchema),
    customerAccountId: z.string().uuid().nullable(),
    organizationId: z.string().uuid().nullable(),
    notes: z.array(formEntryNoteSchema),
  })
  .strict();
export type FormEntryDetail = z.infer<typeof formEntryDetailSchema>;

export const formEntryStatusBodySchema = z
  .object({ status: z.enum(FORM_ENTRY_STATUSES), expectedStatus: z.enum(FORM_ENTRY_STATUSES) })
  .strict();

export const formEntryNoteBodySchema = z
  .object({ body: z.string().trim().min(1).max(FORMS_LIMITS.noteChars) })
  .strict();

export const formEntriesDeleteBodySchema = z
  .object({ ids: z.array(z.string().uuid()).min(1).max(FORMS_LIMITS.bulkDeleteMax) })
  .strict();
export const formEntriesDeleteResponseSchema = z.object({ deleted: z.number().int().min(0) }).strict();

// --- Events (events-and-webhook.md §1–§2) --------------------------------------------------------

/** The domain event and webhook payload of an accepted entry. Never notes, recipients or consent texts. */
export const FormEntrySubmittedEventV1Schema = z
  .object({
    eventId: z.string().min(1),
    occurredAt: isoDateTimeSchema,
    eventType: z.literal(FORMS_EVENTS.ENTRY_SUBMITTED),
    entryId: z.string().uuid(),
    formId: z.string().uuid(),
    formKey: formKeySchema,
    formVersion: z.number().int().min(1),
    salesChannelId: z.string().uuid(),
    organizationId: z.string().uuid().nullable(),
    language: z.string().min(2).max(16),
    pageUrl: z.string().max(FORMS_LIMITS.pageUrlChars).nullable(),
    submittedAt: isoDateTimeSchema,
    /** Visible answers of fields this version marks "Share with integrations"; `{}` when none. */
    answers: z.record(formKeySchema, answerValueSchema),
  })
  .strict();
export type FormEntrySubmittedEventV1 = z.infer<typeof FormEntrySubmittedEventV1Schema>;

/** Internal: what the public read answers changed (publish, close, reopen, delete). */
export const FormChangedEventSchema = z
  .object({ eventId: z.string().min(1), occurredAt: isoDateTimeSchema, formId: z.string().uuid() })
  .strict();
export type FormChangedEvent = z.infer<typeof FormChangedEventSchema>;

export const FORMS_WEBHOOK_EVENT_SCHEMAS = {
  [FORMS_EVENTS.ENTRY_SUBMITTED]: FormEntrySubmittedEventV1Schema,
} as const;
