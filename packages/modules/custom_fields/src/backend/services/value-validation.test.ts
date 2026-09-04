import { describe, expect, it } from 'vitest';
import type { SupportedEntityType } from '@endora-commerce/contracts';
import {
  CustomFieldValidationError,
  CustomFieldValueService,
  type DefinitionSource,
} from './custom-field-value.service.js';
import type { CachedDefinition } from './custom-field-definitions-cache.js';

/**
 * Unit tests for the pure value-validation logic (feature 055, SC-002/SC-003/FR-010).
 * No DB — the definition source is stubbed.
 */

type DefLite = {
  key: string;
  valueType: string;
  required?: boolean;
  options?: string[];
};

function stubSource(entity: SupportedEntityType, defs: DefLite[]): DefinitionSource {
  const cached: CachedDefinition[] = defs.map((d) => ({
    definition: {
      key: d.key,
      valueType: d.valueType,
      required: d.required ?? false,
    } as CachedDefinition['definition'],
    options: (d.options ?? []).map((v) => ({ value: v } as CachedDefinition['options'][number])),
  }));
  return {
    listForEntity: async (e) => (e === entity ? cached : []),
  };
}

function svc(defs: DefLite[]): CustomFieldValueService {
  return new CustomFieldValueService(stubSource('organization', defs));
}

describe('CustomFieldValueService.validateAndMerge — per value type (SC-002)', () => {
  it('round-trips text/number/boolean/date and coerces numeric/boolean strings', async () => {
    const s = svc([
      { key: 't', valueType: 'text' },
      { key: 'n', valueType: 'number' },
      { key: 'b', valueType: 'boolean' },
      { key: 'd', valueType: 'date' },
    ]);
    const out = await s.validateAndMerge('organization', {}, {
      t: 'hello',
      n: '42',
      b: 'true',
      d: '2026-07-18',
    });
    expect(out).toEqual({ t: 'hello', n: 42, b: true, d: '2026-07-18' });
  });

  it('round-trips select + multiselect against defined options', async () => {
    const s = svc([
      { key: 'sel', valueType: 'select', options: ['a', 'b'] },
      { key: 'multi', valueType: 'multiselect', options: ['x', 'y', 'z'] },
    ]);
    const out = await s.validateAndMerge('organization', {}, { sel: 'a', multi: ['x', 'z'] });
    expect(out).toEqual({ sel: 'a', multi: ['x', 'z'] });
  });
});

describe('CustomFieldValueService.validateAndMerge — rejection (SC-003 / FR-004)', () => {
  const cases: Array<[string, DefLite[], Record<string, unknown>, string]> = [
    ['wrong type (number)', [{ key: 'n', valueType: 'number' }], { n: 'abc' }, 'wrong_type'],
    ['wrong type (boolean)', [{ key: 'b', valueType: 'boolean' }], { b: 'nope' }, 'wrong_type'],
    ['wrong type (date)', [{ key: 'd', valueType: 'date' }], { d: '18-07-2026' }, 'wrong_type'],
    ['missing required', [{ key: 't', valueType: 'text', required: true }], {}, 'missing_required'],
    ['unknown option (select)', [{ key: 's', valueType: 'select', options: ['a'] }], { s: 'zzz' }, 'unknown_option'],
    ['unknown option (multiselect)', [{ key: 'm', valueType: 'multiselect', options: ['a'] }], { m: ['a', 'b'] }, 'unknown_option'],
    ['duplicate option', [{ key: 'm', valueType: 'multiselect', options: ['a'] }], { m: ['a', 'a'] }, 'duplicate_option'],
  ];
  for (const [name, defs, patch, code] of cases) {
    it(`rejects: ${name} → ${code}`, async () => {
      try {
        await svc(defs).validateAndMerge('organization', {}, patch);
        throw new Error('expected validation to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(CustomFieldValidationError);
        expect((err as CustomFieldValidationError).errors[0]?.code).toBe(code);
      }
    });
  }

  it('reports every field error, not just the first', async () => {
    const s = svc([
      { key: 'n', valueType: 'number' },
      { key: 't', valueType: 'text', required: true },
    ]);
    try {
      await s.validateAndMerge('organization', {}, { n: 'x' });
      throw new Error('expected throw');
    } catch (err) {
      const codes = (err as CustomFieldValidationError).errors.map((e) => e.code).sort();
      expect(codes).toEqual(['missing_required', 'wrong_type']);
    }
  });
});

describe('merge + retention semantics (FR-010)', () => {
  it('ignores unknown patch keys (no matching definition)', async () => {
    const out = await svc([{ key: 't', valueType: 'text' }]).validateAndMerge(
      'organization',
      {},
      { t: 'ok', bogus: 'ignored' },
    );
    expect(out).toEqual({ t: 'ok' });
  });

  it('retains dormant keys already in the bag', async () => {
    const out = await svc([{ key: 't', valueType: 'text' }]).validateAndMerge(
      'organization',
      { removed_field: 'still here' },
      { t: 'ok' },
    );
    expect(out).toEqual({ t: 'ok', removed_field: 'still here' });
  });

  it('grandfathers existing records: required only blocks a value-less edit', async () => {
    const s = svc([{ key: 't', valueType: 'text', required: true }]);
    // existing value present ⇒ passes
    const ok = await s.validateAndMerge('organization', { t: 'existing' }, {});
    expect(ok).toEqual({ t: 'existing' });
    // clearing it ⇒ rejected
    await expect(s.validateAndMerge('organization', { t: 'existing' }, { t: '' })).rejects.toBeInstanceOf(
      CustomFieldValidationError,
    );
  });
});

describe('CustomFieldValueService.project — dormant stripping (US2 scenario 4)', () => {
  it('drops keys with no live definition', async () => {
    const s = svc([{ key: 'live', valueType: 'text' }]);
    const out = await s.project('organization', { live: 'a', dead: 'b' });
    expect(out).toEqual({ live: 'a' });
  });
});
