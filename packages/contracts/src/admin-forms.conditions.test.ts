import { describe, expect, it } from 'vitest';
import {
  FIELD_CONDITION_MAX_DEPTH,
  FIELD_CONDITION_MAX_IN_VALUES,
  FIELD_CONDITION_MAX_LEAVES,
  FIELD_FORMATS,
  FieldConditionSchema,
  FieldOverrideSchema,
  evaluateFieldCondition,
  type FieldCondition,
} from './admin-forms.js';
import {
  FIELD_CONDITION_HOSTILE_REFUSALS,
  FIELD_CONDITION_SCHEMA_ACCEPTS,
  FIELD_CONDITION_SCHEMA_REFUSALS,
  FIELD_CONDITION_VECTORS,
  FIELD_FORMAT_VECTORS,
  deepNotCondition,
} from './admin-forms.vectors.js';

/**
 * `specs/193-admin-form-extensions/` T012 — the field-condition vocabulary and
 * its one evaluator (FR-040, `contracts/field-rules.md` §3, research R-11). The
 * vectors are shared with the platform's field-rule check and the admin-kit's
 * form, so the cases live in `admin-forms.vectors.ts` and this file runs them.
 */
describe('evaluateFieldCondition (193 T012, FR-040)', () => {
  it.each(FIELD_CONDITION_VECTORS.map((v) => [v.name, v] as const))('%s', (_name, vector) => {
    expect(evaluateFieldCondition(vector.condition, vector.values)).toBe(vector.expected);
  });

  it('covers every operator and combinator', () => {
    const seen = new Set<string>();
    const walk = (c: FieldCondition): void => {
      if ('all' in c) {
        seen.add('all');
        c.all.forEach(walk);
      } else if ('any' in c) {
        seen.add('any');
        c.any.forEach(walk);
      } else if ('not' in c) {
        seen.add('not');
        walk(c.not);
      } else {
        seen.add(c.op);
      }
    };
    FIELD_CONDITION_VECTORS.forEach((v) => walk(v.condition));
    expect([...seen].sort()).toEqual(
      ['all', 'any', 'equals', 'in', 'isEmpty', 'isNotEmpty', 'not', 'notEquals'].sort(),
    );
  });

  it('is pure: it neither mutates the values nor depends on a previous call', () => {
    const values = Object.freeze({ kind: 'company', tags: Object.freeze(['b2b']) });
    const condition: FieldCondition = { all: [{ field: 'kind', op: 'equals', value: 'company' }, { field: 'tags', op: 'in', value: ['b2b'] }] };
    expect(evaluateFieldCondition(condition, values)).toBe(true);
    expect(evaluateFieldCondition(condition, values)).toBe(true);
    expect(values).toEqual({ kind: 'company', tags: ['b2b'] });
  });
});

describe('FieldConditionSchema (193 T012, depth and leaf caps)', () => {
  it('caps depth at 4 and leaves at 16', () => {
    expect(FIELD_CONDITION_MAX_DEPTH).toBe(4);
    expect(FIELD_CONDITION_MAX_LEAVES).toBe(16);
  });

  it.each(FIELD_CONDITION_SCHEMA_ACCEPTS.map((v) => [v.name, v.condition] as const))('accepts %s', (_name, condition) => {
    expect(FieldConditionSchema.safeParse(condition).success).toBe(true);
  });

  it.each(FIELD_CONDITION_SCHEMA_REFUSALS.map((v) => [v.name, v.condition] as const))('refuses %s', (_name, condition) => {
    expect(FieldConditionSchema.safeParse(condition).success).toBe(false);
  });

  it('accepts every evaluation vector, so the evaluator is never run on a condition the schema refuses', () => {
    for (const vector of FIELD_CONDITION_VECTORS) {
      expect(FieldConditionSchema.safeParse(vector.condition).success, vector.name).toBe(true);
    }
  });

  it('names the cap it broke', () => {
    const deep = FIELD_CONDITION_SCHEMA_REFUSALS.find((v) => v.name === 'depth 5')!.condition;
    const wide = FIELD_CONDITION_SCHEMA_REFUSALS.find((v) => v.name === '17 leaves')!.condition;
    expect(JSON.stringify(FieldConditionSchema.safeParse(deep).error?.issues)).toMatch(/depth/);
    expect(JSON.stringify(FieldConditionSchema.safeParse(wide).error?.issues)).toMatch(/leaves/);
  });
});

describe('FieldConditionSchema — hostile sizes (issue #2018)', () => {
  it.each(FIELD_CONDITION_HOSTILE_REFUSALS.map((v) => [v.name, v.condition] as const))(
    'refuses %s with an ordinary failure, quickly',
    (_name, build) => {
      const condition = build();
      const started = Date.now();
      let result: ReturnType<typeof FieldConditionSchema.safeParse> | undefined;
      expect(() => {
        result = FieldConditionSchema.safeParse(condition);
      }).not.toThrow();
      expect(result?.success).toBe(false);
      // Generous for a loaded CI box; a full parse of the payload takes about a second.
      expect(Date.now() - started).toBeLessThan(250);
    },
  );

  it('holds each cap at its boundary', () => {
    const leaf = { field: 'kind', op: 'isEmpty' } as const;
    expect(FieldConditionSchema.safeParse(deepNotCondition(FIELD_CONDITION_MAX_DEPTH - 1)).success).toBe(true);
    expect(FieldConditionSchema.safeParse(deepNotCondition(FIELD_CONDITION_MAX_DEPTH)).success).toBe(false);
    const list = (n: number) => Array.from({ length: n }, () => leaf);
    expect(FieldConditionSchema.safeParse({ all: list(FIELD_CONDITION_MAX_LEAVES) }).success).toBe(true);
    expect(FieldConditionSchema.safeParse({ all: list(FIELD_CONDITION_MAX_LEAVES + 1) }).success).toBe(false);
    expect(FieldConditionSchema.safeParse({ any: list(FIELD_CONDITION_MAX_LEAVES) }).success).toBe(true);
    expect(FieldConditionSchema.safeParse({ any: list(FIELD_CONDITION_MAX_LEAVES + 1) }).success).toBe(false);
    const values = (n: number) => Array.from({ length: n }, (_, i) => i);
    expect(FieldConditionSchema.safeParse({ field: 'size', op: 'in', value: values(FIELD_CONDITION_MAX_IN_VALUES) }).success).toBe(true);
    expect(FieldConditionSchema.safeParse({ field: 'size', op: 'in', value: values(FIELD_CONDITION_MAX_IN_VALUES + 1) }).success).toBe(false);
  });

  it('holds the caps where a condition is embedded, too', () => {
    const override = { target: 'organization.emails', reason: 'r', visibleWhen: deepNotCondition(20_000) };
    expect(() => FieldOverrideSchema.safeParse(override)).not.toThrow();
    expect(FieldOverrideSchema.safeParse(override).success).toBe(false);
  });
});

describe('FIELD_FORMAT_VECTORS (193 T012, input-controls.md §1)', () => {
  it('has an accept and a refuse case for every platform format, and nothing else', () => {
    expect(Object.keys(FIELD_FORMAT_VECTORS).sort()).toEqual([...FIELD_FORMATS].sort());
    for (const format of FIELD_FORMATS) {
      expect(FIELD_FORMAT_VECTORS[format].accept.length, format).toBeGreaterThan(0);
      expect(FIELD_FORMAT_VECTORS[format].refuse.length, format).toBeGreaterThan(0);
    }
  });
});
