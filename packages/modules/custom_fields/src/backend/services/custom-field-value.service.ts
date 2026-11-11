import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomFieldInputSurface,
  CustomFieldValidationError as CustomFieldValidationErrorDto,
  SupportedEntityType,
  SupportedLanguage,
} from '@endora-commerce/contracts';
import type { CachedDefinition } from './custom-field-definitions-cache.js';
import { hostStorageBinding } from './host-storage-binding.js';

/**
 * Provides the live definitions (with options) for an entity type. Implemented
 * by `CustomFieldDefinitionService`; taken as an interface here so the value
 * service has no concrete dependency on the definition service (and is trivially
 * unit-testable with a stub).
 */
export interface DefinitionSource {
  listForEntity(entityType: SupportedEntityType): Promise<CachedDefinition[]>;
}

/** Thrown by {@link CustomFieldValueService.validateAndMerge}; serialized as HTTP 422 (FR-004). */
export class CustomFieldValidationError extends Error {
  constructor(readonly errors: CustomFieldValidationErrorDto[]) {
    super(`Custom field validation failed (${errors.length} error(s)).`);
    this.name = 'CustomFieldValidationError';
  }
}

const DEFAULT_TEXT_MAX = 10_000;

/**
 * Feature 175 (FR-013) — the longest text a BUYER may supply, after trimming.
 * Tighter than {@link DEFAULT_TEXT_MAX}: the writer is anonymous.
 */
const CUSTOMER_INPUT_TEXT_MAX = 1_000;

/** Feature 175 (FR-013) — the most keys one buyer-supplied group may carry. */
const CUSTOMER_INPUT_MAX_KEYS = 50;

/**
 * Feature 175 — a sentence from this module's bundle, in `language`, or `null`
 * when the bundle has none. Injected by the composition (`_i18n`'s
 * `adminI18nService`), so the service stays testable with a stub.
 */
export type ValueMessageTranslate = (key: string, language: SupportedLanguage) => Promise<string | null>;

/**
 * Feature 175 — what a BUYER reads beside a refused field, per code, when no
 * bundle sentence answers. The same sentences as `customFields.valueError.*`
 * in `i18n/en.json`. None names the definition key or echoes the typed value:
 * the storefront places each refusal under its field, and a key is not words
 * a buyer knows (`specs/conventions/module-i18n.md`, case 1).
 */
const BUYER_MESSAGES: Readonly<Record<CustomFieldValidationErrorDto['code'], string>> = {
  missing_required: 'This field is required.',
  wrong_type: 'Enter a valid value.',
  out_of_range: 'This value is too long.',
  unknown_option: 'Choose one of the options.',
  duplicate_option: 'Choose each option only once.',
  not_open_for_input: 'This field cannot be filled in here.',
  too_many_keys: 'Too many additional fields were sent at once.',
};

/**
 * CustomFieldValueService (feature 055) — validates a host record's custom-field
 * bag against its definitions and strips dormant keys on read.
 *
 * It performs NO database write and NO audit: the host persists its own record
 * and (per Principle XIII) audits its own write. This service only validates the
 * incoming values and returns the merged bag — keeping module boundaries intact
 * (Principle I) and avoiding double-audit (Principle XIII / XIV).
 */
export class CustomFieldValueService {
  constructor(
    private readonly definitions: DefinitionSource,
    /** Feature 175 — words a buyer's refusals; absent, the English sentences stand. */
    private readonly translate?: ValueMessageTranslate,
  ) {}

  /**
   * Validate an incoming patch against the entity's definitions and return the
   * merged bag to persist. Throws {@link CustomFieldValidationError} with
   * per-field errors on any violation (FR-004). Unknown patch keys (no matching
   * definition) are ignored. Dormant keys already in the bag are retained (FR-010).
   */
  async validateAndMerge(
    entityType: SupportedEntityType,
    currentBag: Record<string, unknown>,
    patch: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions.listForEntity(entityType);
    const merged: Record<string, unknown> = { ...currentBag };
    const errors: CustomFieldValidationErrorDto[] = [];

    for (const { definition, options } of defs) {
      const key = definition.key;
      const inPatch = Object.prototype.hasOwnProperty.call(patch, key);
      const raw = inPatch ? patch[key] : currentBag[key];

      if (isEmpty(raw)) {
        if (definition.required) {
          errors.push({ field: key, code: 'missing_required', message: `Field "${key}" is required.` });
        } else {
          delete merged[key];
        }
        continue;
      }

      const result = coerce(definition.valueType, raw, options);
      if ('code' in result) {
        errors.push({ field: key, code: result.code, message: result.message });
      } else {
        merged[key] = result.value;
      }
    }

    if (errors.length > 0) throw new CustomFieldValidationError(errors);
    return merged;
  }

  /**
   * Feature 175 — values a BUYER supplies on an input surface, for a record
   * being created (`specs/175-buyer-input-custom-fields/` research R-3). Not
   * {@link validateAndMerge}: that one drops unknown keys and enforces
   * `required` across every definition, which is the administrator's rule set.
   *
   * In order: more than 50 keys is refused with `too_many_keys` before any
   * definition is read (its `field` is the entity type; a caller naming its
   * groups otherwise replaces it); every key must be a live definition open
   * on `surface` — `customer` audience, not `page_builder`, `customerInput`
   * naming the surface — or it is refused with `not_open_for_input`; each open
   * definition is then judged: a string is trimmed and a whitespace-only one is
   * empty, an empty required field is `missing_required`, a text over 1 000
   * characters is `out_of_range`, and anything else goes through {@link coerce}
   * exactly as the administrator's values do. Every refusal is collected into
   * one {@link CustomFieldValidationError}. Answers a fresh bag holding only
   * the supplied open keys — there is no stored bag on a record being created.
   *
   * Every refusal's `message` is a sentence a buyer can read beside the field
   * — never the key, never the typed value — and, given `language`, it is this
   * module's bundle sentence for the code in that language
   * (`customFields.valueError.<code>`). The code stays the machine token.
   */
  async validateForCustomerInput(
    entityType: SupportedEntityType,
    values: Record<string, unknown> | undefined,
    surface: CustomFieldInputSurface,
    language?: SupportedLanguage,
  ): Promise<Record<string, unknown>> {
    const supplied = values ?? {};
    const keys = Object.keys(supplied);
    if (keys.length > CUSTOMER_INPUT_MAX_KEYS) {
      throw new CustomFieldValidationError(
        await this.worded([{ field: entityType, code: 'too_many_keys', message: BUYER_MESSAGES.too_many_keys }], language),
      );
    }

    const defs = await this.definitions.listForEntity(entityType);
    const open = defs.filter(
      ({ definition }) =>
        definition.audience === 'customer' &&
        definition.valueType !== 'page_builder' &&
        (definition.customerInput ?? []).includes(surface),
    );
    const openKeys = new Set(open.map(({ definition }) => definition.key));
    const errors: CustomFieldValidationErrorDto[] = [];
    for (const key of keys) {
      if (!openKeys.has(key)) {
        errors.push({ field: key, code: 'not_open_for_input', message: BUYER_MESSAGES.not_open_for_input });
      }
    }

    const bag: Record<string, unknown> = {};
    for (const { definition, options } of open) {
      const key = definition.key;
      const given = Object.prototype.hasOwnProperty.call(supplied, key) ? supplied[key] : undefined;
      const raw = typeof given === 'string' ? given.trim() : given;
      if (isEmpty(raw)) {
        if (definition.required) {
          errors.push({ field: key, code: 'missing_required', message: BUYER_MESSAGES.missing_required });
        }
        continue;
      }
      if (definition.valueType === 'text' && typeof raw === 'string' && raw.length > CUSTOMER_INPUT_TEXT_MAX) {
        errors.push({ field: key, code: 'out_of_range', message: BUYER_MESSAGES.out_of_range });
        continue;
      }
      const result = coerce(definition.valueType, raw, options);
      // `coerce`'s own sentence echoes the value; the buyer reads the code's.
      if ('code' in result) errors.push({ field: key, code: result.code, message: BUYER_MESSAGES[result.code] });
      else bag[key] = result.value;
    }

    if (errors.length > 0) throw new CustomFieldValidationError(await this.worded(errors, language));
    return bag;
  }

  /**
   * The refusals with each message in `language`, where this module's bundle
   * has the sentence. A miss, or a translator that fails, keeps the English
   * sentence: wording a refusal may never replace it.
   */
  private async worded(
    errors: CustomFieldValidationErrorDto[],
    language: SupportedLanguage | undefined,
  ): Promise<CustomFieldValidationErrorDto[]> {
    const translate = this.translate;
    if (language === undefined || translate === undefined) return errors;
    return Promise.all(
      errors.map(async (error) => {
        try {
          const sentence = await translate(`customFields.valueError.${error.code}`, language);
          return sentence ? { ...error, message: sentence } : error;
        } catch {
          return error;
        }
      }),
    );
  }

  /**
   * Strip keys whose definition no longer exists (dormant values, FR-010 / US2
   * scenario 4). Hosts call this before returning `customFieldValues` on read.
   */
  async project(
    entityType: SupportedEntityType,
    bag: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const defs = await this.definitions.listForEntity(entityType);
    const live = new Set(defs.map((d) => d.definition.key));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(bag)) {
      if (live.has(k)) out[k] = v;
    }
    return out;
  }

  /**
   * The bag as a non-administrator may read it: the keys whose definition is
   * live **and** has the `customer` audience. An `internal` field's value, and
   * a value whose definition no longer exists, are both left out — the second
   * because nothing says any longer who that value was meant for.
   *
   * The one filter every host's buyer-facing and external serialiser goes
   * through. Definitions come from the per-entity cache, so a list reply that
   * calls this once per row reads the table at most once.
   */
  async projectForCustomer(
    entityType: SupportedEntityType,
    bag: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (Object.keys(bag).length === 0) return out;
    const defs = await this.definitions.listForEntity(entityType);
    for (const { definition } of defs) {
      if (definition.audience !== 'customer') continue;
      if (Object.prototype.hasOwnProperty.call(bag, definition.key)) {
        out[definition.key] = bag[definition.key];
      }
    }
    return out;
  }

  /**
   * Existence probe for definition-change guards (FR-010): is there any host row
   * with a stored value at `key`? Read-only JSONB introspection on the host table.
   */
  async hasStoredValues(
    em: EntityManager,
    entityType: SupportedEntityType,
    key: string,
  ): Promise<boolean> {
    const { table, column } = hostStorageBinding(entityType);
    const rows = await em.getConnection().execute<{ one: number }[]>(
      `select 1 as one from "${table}" where jsonb_exists("${column}", ?) limit 1`,
      [key],
    );
    return rows.length > 0;
  }

  /**
   * Is a specific option value in use for a `select`/`multiselect` field?
   * (option-removal guard). Known limitation: the flat `->>key` probe does not
   * see through nested per-language value shapes — a host whose storage nests
   * values under the key runs its own authoritative in-use checks first; this
   * probe is defense-in-depth for the flat shapes (feature 061, research §R9).
   */
  async isOptionInUse(
    em: EntityManager,
    entityType: SupportedEntityType,
    key: string,
    optionValue: string,
  ): Promise<boolean> {
    const { table, column } = hostStorageBinding(entityType);
    const rows = await em.getConnection().execute<{ one: number }[]>(
      `select 1 as one from "${table}" ` +
        `where "${column}"->>? = ? ` +
        `or (jsonb_typeof("${column}"->?) = 'array' and "${column}"->? @> to_jsonb(?::text)) ` +
        `limit 1`,
      [key, optionValue, key, key, optionValue],
    );
    return rows.length > 0;
  }
}

/** A value is "empty" (⇒ absent) when undefined, null, '', or an empty array. */
export function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

type CoerceOk = { value: unknown };
type CoerceErr = { code: CustomFieldValidationErrorDto['code']; message: string };

/**
 * Validate + coerce one value by its declared type. Returns the stored value or a typed error.
 * Exported for the carry port (feature 162), which judges a carried value by the same rule.
 */
export function coerce(
  valueType: string,
  raw: unknown,
  options: { value: string }[],
): CoerceOk | CoerceErr {
  switch (valueType) {
    case 'text': {
      if (typeof raw !== 'string') return { code: 'wrong_type', message: 'Expected a text value.' };
      if (raw.length > DEFAULT_TEXT_MAX) return { code: 'out_of_range', message: 'Text value is too long.' };
      return { value: raw };
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) return { code: 'wrong_type', message: 'Expected a number.' };
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      if (raw === 'true') return { value: true };
      if (raw === 'false') return { value: false };
      return { code: 'wrong_type', message: 'Expected a boolean.' };
    }
    case 'date': {
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
        return { code: 'wrong_type', message: 'Expected an ISO date (YYYY-MM-DD).' };
      }
      return { value: raw };
    }
    case 'select': {
      if (typeof raw !== 'string') return { code: 'wrong_type', message: 'Expected a single option value.' };
      if (!options.some((o) => o.value === raw)) {
        return { code: 'unknown_option', message: `Unknown option "${raw}".` };
      }
      return { value: raw };
    }
    case 'multiselect': {
      if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string')) {
        return { code: 'wrong_type', message: 'Expected an array of option values.' };
      }
      const seen = new Set<string>();
      for (const v of raw as string[]) {
        if (seen.has(v)) return { code: 'duplicate_option', message: `Duplicate option "${v}".` };
        seen.add(v);
        if (!options.some((o) => o.value === v)) {
          return { code: 'unknown_option', message: `Unknown option "${v}".` };
        }
      }
      return { value: [...(raw as string[])] };
    }
    case 'page_builder':
      // Feature 172 — a Page Builder document lives in its host's own storage
      // and is never a value of the bag.
      return { code: 'wrong_type', message: 'Page Builder content is not a field value.' };
    default:
      return { code: 'wrong_type', message: `Unsupported value type "${valueType}".` };
  }
}
