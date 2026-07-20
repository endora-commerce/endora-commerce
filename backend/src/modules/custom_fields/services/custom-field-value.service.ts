import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomFieldValidationError as CustomFieldValidationErrorDto, SupportedEntityType } from '@b2b/contracts';
import type { CachedDefinition } from './custom-field-definitions-cache.js';

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

/** Host-table binding for the change-guard existence probe (read-only introspection, feature 055). */
const HOST_TABLE_BY_ENTITY: Record<SupportedEntityType, string> = {
  category: 'categories',
  order: 'orders',
  organization: 'organizations',
  customer: 'customer_accounts',
  quote_request: 'quote_requests',
};

const DEFAULT_TEXT_MAX = 10_000;

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
  constructor(private readonly definitions: DefinitionSource) {}

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
   * Existence probe for definition-change guards (FR-010): is there any host row
   * with a stored value at `key`? Read-only JSONB introspection on the host table.
   */
  async hasStoredValues(
    em: EntityManager,
    entityType: SupportedEntityType,
    key: string,
  ): Promise<boolean> {
    const table = HOST_TABLE_BY_ENTITY[entityType];
    const rows = await em.getConnection().execute<{ one: number }[]>(
      `select 1 as one from "${table}" where jsonb_exists("custom_field_values", ?) limit 1`,
      [key],
    );
    return rows.length > 0;
  }

  /** Is a specific option value in use for a `select`/`multiselect` field? (option-removal guard). */
  async isOptionInUse(
    em: EntityManager,
    entityType: SupportedEntityType,
    key: string,
    optionValue: string,
  ): Promise<boolean> {
    const table = HOST_TABLE_BY_ENTITY[entityType];
    const rows = await em.getConnection().execute<{ one: number }[]>(
      `select 1 as one from "${table}" ` +
        `where "custom_field_values"->>? = ? ` +
        `or (jsonb_typeof("custom_field_values"->?) = 'array' and "custom_field_values"->? @> to_jsonb(?::text)) ` +
        `limit 1`,
      [key, optionValue, key, key, optionValue],
    );
    return rows.length > 0;
  }
}

/** A value is "empty" (⇒ absent) when undefined, null, '', or an empty array. */
function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

type CoerceOk = { value: unknown };
type CoerceErr = { code: CustomFieldValidationErrorDto['code']; message: string };

/** Validate + coerce one value by its declared type. Returns the stored value or a typed error. */
function coerce(
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
    default:
      return { code: 'wrong_type', message: `Unsupported value type "${valueType}".` };
  }
}
