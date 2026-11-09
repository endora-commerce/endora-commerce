import { describe, expect, it, vi } from 'vitest';
import type { SupportedEntityType } from '@endora-commerce/contracts';
import {
  coerce,
  CustomFieldValidationError,
  CustomFieldValueService,
  type DefinitionSource,
} from './custom-field-value.service.js';
import type { CachedDefinition } from './custom-field-definitions-cache.js';

/**
 * `specs/175-buyer-input-custom-fields/` research R-3, FR-010 – FR-014 —
 * `validateForCustomerInput`, the validator of values a BUYER supplies on an
 * input surface. It refuses rather than drops, enforces `required` only among
 * the definitions open on the surface, applies the administrator's type rules
 * plus the buyer limits, and returns a fresh bag. No database: the definition
 * source is stubbed.
 */

const SURFACE = 'organization.register' as const;

type DefLite = {
  key: string;
  valueType: string;
  required?: boolean;
  open?: boolean;
  audience?: 'customer' | 'internal';
  options?: string[];
};

function cached(defs: DefLite[]): CachedDefinition[] {
  return defs.map((d) => ({
    definition: {
      key: d.key,
      valueType: d.valueType,
      required: d.required ?? false,
      audience: d.audience ?? 'customer',
      customerInput: d.open === false ? [] : [SURFACE],
      adminAccess: 'edit',
    } as unknown as CachedDefinition['definition'],
    options: (d.options ?? []).map((v) => ({ value: v }) as CachedDefinition['options'][number]),
  }));
}

function source(byType: Partial<Record<SupportedEntityType, DefLite[]>>): DefinitionSource & {
  listForEntity: ReturnType<typeof vi.fn>;
} {
  return {
    listForEntity: vi.fn(async (entityType: SupportedEntityType) => cached(byType[entityType] ?? [])),
  };
}

async function refused(promise: Promise<unknown>): Promise<CustomFieldValidationError['errors']> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(CustomFieldValidationError);
  return (error as CustomFieldValidationError).errors;
}

describe('validateForCustomerInput — keys that are not open', () => {
  it('refuses a closed key with not_open_for_input, naming it', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'credit_limit', valueType: 'number', open: false }] }),
    );
    const errors = await refused(s.validateForCustomerInput('organization', { credit_limit: 1000 }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'credit_limit', code: 'not_open_for_input' })]);
  });

  it('refuses an unknown key with not_open_for_input', async () => {
    const s = new CustomFieldValueService(source({ organization: [] }));
    const errors = await refused(s.validateForCustomerInput('organization', { nonsense: 'x' }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'nonsense', code: 'not_open_for_input' })]);
  });

  it('refuses the key of another entity type with not_open_for_input', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'phone', valueType: 'text' }], customer: [] }),
    );
    const errors = await refused(s.validateForCustomerInput('customer', { phone: '+48 600' }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'phone', code: 'not_open_for_input' })]);
  });

  it('never treats a page_builder definition as open, whatever it stores', async () => {
    const s = new CustomFieldValueService(source({ customer: [{ key: 'guide', valueType: 'page_builder' }] }));
    const errors = await refused(s.validateForCustomerInput('customer', { guide: 'x' }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'guide', code: 'not_open_for_input' })]);
  });

  it('never treats an internal definition as open, whatever it stores', async () => {
    const s = new CustomFieldValueService(
      source({ customer: [{ key: 'score', valueType: 'number', audience: 'internal' }] }),
    );
    const errors = await refused(s.validateForCustomerInput('customer', { score: 5 }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'score', code: 'not_open_for_input' })]);
  });

  it('collects every refusal in one throw', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'source', valueType: 'text', required: true }] }),
    );
    const errors = await refused(s.validateForCustomerInput('organization', { a: 1, b: 2 }, SURFACE));
    expect(errors.map((e) => `${e.field}:${e.code}`).sort()).toEqual([
      'a:not_open_for_input',
      'b:not_open_for_input',
      'source:missing_required',
    ]);
  });
});

describe('validateForCustomerInput — the key limit', () => {
  it('refuses 51 keys with too_many_keys before reading any definition', async () => {
    const src = source({ organization: [] });
    const s = new CustomFieldValueService(src);
    const values = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'x']));
    const errors = await refused(s.validateForCustomerInput('organization', values, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ code: 'too_many_keys' })]);
    expect(src.listForEntity).not.toHaveBeenCalled();
  });

  it('reads 50 keys', async () => {
    const defs = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, valueType: 'text' }));
    const s = new CustomFieldValueService(source({ organization: defs }));
    const values = Object.fromEntries(defs.map((d) => [d.key, 'x']));
    expect(Object.keys(await s.validateForCustomerInput('organization', values, SURFACE))).toHaveLength(50);
  });
});

describe('validateForCustomerInput — required', () => {
  it('enforces required among open definitions', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'source', valueType: 'text', required: true }] }),
    );
    const errors = await refused(s.validateForCustomerInput('organization', {}, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'source', code: 'missing_required' })]);
  });

  it('does not enforce a required definition that is not open (FR-012)', async () => {
    const s = new CustomFieldValueService(
      source({
        organization: [
          { key: 'credit_limit', valueType: 'number', required: true, open: false },
          { key: 'source', valueType: 'text' },
        ],
      }),
    );
    expect(await s.validateForCustomerInput('organization', { source: 'web' }, SURFACE)).toEqual({ source: 'web' });
  });

  it('treats whitespace-only text as empty', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'source', valueType: 'text', required: true }, { key: 'note', valueType: 'text' }] }),
    );
    const errors = await refused(s.validateForCustomerInput('organization', { source: '   ', note: '\t' }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'source', code: 'missing_required' })]);
    expect(await s.validateForCustomerInput('organization', { source: 'web', note: '  ' }, SURFACE)).toEqual({
      source: 'web',
    });
  });

  it('treats a whitespace-only string as empty for a number, not as zero', async () => {
    const s = new CustomFieldValueService(source({ organization: [{ key: 'employees', valueType: 'number' }] }));
    expect(await s.validateForCustomerInput('organization', { employees: '  ' }, SURFACE)).toEqual({});
  });
});

describe('validateForCustomerInput — text limits', () => {
  it('trims surrounding whitespace from text', async () => {
    const s = new CustomFieldValueService(source({ customer: [{ key: 'phone', valueType: 'text' }] }));
    expect(await s.validateForCustomerInput('customer', { phone: '  +48 600  ' }, SURFACE)).toEqual({
      phone: '+48 600',
    });
  });

  it('accepts 1 000 characters and refuses 1 001 with out_of_range', async () => {
    const s = new CustomFieldValueService(source({ customer: [{ key: 'note', valueType: 'text' }] }));
    expect(await s.validateForCustomerInput('customer', { note: `  ${'a'.repeat(1000)}  ` }, SURFACE)).toEqual({
      note: 'a'.repeat(1000),
    });
    const errors = await refused(s.validateForCustomerInput('customer', { note: 'a'.repeat(1001) }, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'note', code: 'out_of_range' })]);
  });
});

describe('validateForCustomerInput — type rules exactly as coerce applies them (FR-013)', () => {
  const cases: Array<{ valueType: string; options?: string[]; ok: unknown; bad: unknown }> = [
    { valueType: 'text', ok: 'hello', bad: 42 },
    { valueType: 'number', ok: '42.5', bad: 'forty' },
    { valueType: 'boolean', ok: 'false', bad: 'maybe' },
    { valueType: 'date', ok: '2026-11-06', bad: '06.11.2026' },
    { valueType: 'select', options: ['a', 'b'], ok: 'b', bad: 'c' },
    { valueType: 'multiselect', options: ['x', 'y'], ok: ['y', 'x'], bad: ['x', 'x'] },
  ];
  for (const { valueType, options, ok, bad } of cases) {
    it(`${valueType}: stores what coerce stores and refuses what coerce refuses`, async () => {
      const s = new CustomFieldValueService(
        source({ organization: [{ key: 'f', valueType, ...(options ? { options } : {}) }] }),
      );
      const opts = (options ?? []).map((value) => ({ value }));
      const expected = coerce(valueType, ok, opts);
      expect(expected).toHaveProperty('value');
      expect(await s.validateForCustomerInput('organization', { f: ok }, SURFACE)).toEqual({
        f: (expected as { value: unknown }).value,
      });
      const refusal = coerce(valueType, bad, opts) as { code: string };
      const errors = await refused(s.validateForCustomerInput('organization', { f: bad }, SURFACE));
      expect(errors).toEqual([expect.objectContaining({ field: 'f', code: refusal.code })]);
    });
  }
});

describe('validateForCustomerInput — nothing supplied', () => {
  it('answers {} for undefined values', async () => {
    const s = new CustomFieldValueService(source({ organization: [{ key: 'source', valueType: 'text' }] }));
    expect(await s.validateForCustomerInput('organization', undefined, SURFACE)).toEqual({});
  });

  it('still enforces a required open field when nothing is supplied', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'source', valueType: 'text', required: true }] }),
    );
    const errors = await refused(s.validateForCustomerInput('organization', undefined, SURFACE));
    expect(errors).toEqual([expect.objectContaining({ field: 'source', code: 'missing_required' })]);
  });

  it('answers a fresh bag holding only the supplied open keys', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'source', valueType: 'text' }, { key: 'size', valueType: 'number' }] }),
    );
    expect(await s.validateForCustomerInput('organization', { source: 'web' }, SURFACE)).toEqual({ source: 'web' });
  });
});

/**
 * `specs/conventions/module-i18n.md` — a refusal answered over HTTP is case 1:
 * the backend can resolve the reader's language, so it words the sentence and
 * ships the code beside it. A buyer reads these messages beside the field, so
 * none may name a definition key or echo what was typed.
 */
describe('validateForCustomerInput — messages in the reader\'s language', () => {
  const translated = (key: string, language: string): string => `[${language}] ${key}`;

  function translating(byType: Partial<Record<SupportedEntityType, DefLite[]>>) {
    const translate = vi.fn(async (key: string, language: string) => translated(key, language));
    return { service: new CustomFieldValueService(source(byType), translate), translate };
  }

  it('words every refusal from this module\'s bundle when a language is given', async () => {
    const { service } = translating({
      organization: [
        { key: 'source', valueType: 'select', options: ['web'] },
        { key: 'size', valueType: 'number' },
        { key: 'vat', valueType: 'text', required: true },
        { key: 'note', valueType: 'text' },
        { key: 'tags', valueType: 'multiselect', options: ['a'] },
      ],
    });
    const errors = await refused(
      service.validateForCustomerInput(
        'organization',
        { source: 'radio', size: 'many', note: 'x'.repeat(1001), tags: ['a', 'a'], closed: 'x' },
        SURFACE,
        'pl',
      ),
    );
    const byField = Object.fromEntries(errors.map((e) => [e.field, e]));
    for (const [field, code] of [
      ['source', 'unknown_option'],
      ['size', 'wrong_type'],
      ['vat', 'missing_required'],
      ['note', 'out_of_range'],
      ['tags', 'duplicate_option'],
      ['closed', 'not_open_for_input'],
    ] as const) {
      expect(byField[field]).toEqual({ field, code, message: translated(`customFields.valueError.${code}`, 'pl') });
    }
  });

  it('words too_many_keys from the bundle too', async () => {
    const { service } = translating({});
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, 'x']));
    const errors = await refused(service.validateForCustomerInput('customer', many, SURFACE, 'en'));
    expect(errors).toEqual([
      { field: 'customer', code: 'too_many_keys', message: translated('customFields.valueError.too_many_keys', 'en') },
    ]);
  });

  it('keeps the written sentence where the bundle has none, and where translating fails', async () => {
    const missing = new CustomFieldValueService(source({}), vi.fn(async () => null));
    const failing = new CustomFieldValueService(
      source({}),
      vi.fn(async () => {
        throw new Error('bundle store unreachable');
      }),
    );
    for (const service of [missing, failing]) {
      const errors = await refused(service.validateForCustomerInput('organization', { closed: 'x' }, SURFACE, 'pl'));
      expect(errors).toEqual([{ field: 'closed', code: 'not_open_for_input', message: 'This field cannot be filled in here.' }]);
    }
  });

  it('never names the key or echoes the typed value in the sentence it writes itself', async () => {
    const s = new CustomFieldValueService(
      source({ organization: [{ key: 'vat_contact', valueType: 'text', required: true }, { key: 'source', valueType: 'select', options: ['web'] }] }),
    );
    const errors = await refused(
      s.validateForCustomerInput('organization', { source: 'radio-secret', closed_key: 'x' }, SURFACE),
    );
    expect(errors).toHaveLength(3);
    for (const e of errors) {
      expect(e.message).not.toContain('vat_contact');
      expect(e.message).not.toContain('closed_key');
      expect(e.message).not.toContain('radio-secret');
    }
  });

  it('asks for no translation when no language is given', async () => {
    const { service, translate } = translating({ organization: [{ key: 'vat', valueType: 'text', required: true }] });
    await refused(service.validateForCustomerInput('organization', {}, SURFACE));
    expect(translate).not.toHaveBeenCalled();
  });
});
