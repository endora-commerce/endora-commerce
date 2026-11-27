import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineFieldSet } from '@endora-commerce/contracts';
import { expectFieldSetMatchesSchemas } from './index.js';

/**
 * `specs/193-admin-form-extensions/` T017 (FR-003, `contracts/field-rules.md`
 * §2): a field set's value types, required-ness and core bounds agree with the
 * host's create and update body schemas, and the helper says which field
 * disagrees and how.
 */

const SET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [
    { key: 'name', type: 'string', required: true, bounds: { minLength: 1, maxLength: 255 }, accepts: ['label'] },
    { key: 'size', type: 'integer', required: false, bounds: { min: 0, max: 99 }, accepts: [] },
    { key: 'price', type: 'decimal', required: false, accepts: [] },
    { key: 'active', type: 'boolean', required: false, accepts: [] },
    { key: 'since', type: 'date', required: false, accepts: [] },
    { key: 'kind', type: 'enum', options: ['a', 'b'], required: false, accepts: [] },
    { key: 'emails', type: 'string[]', required: false, bounds: { maxLength: 320 }, accepts: [] },
    { key: 'channels', type: 'enum[]', options: ['web', 'b2b'], required: false, accepts: [] },
    { key: 'parentId', type: 'reference', references: 'widget', required: false, accepts: [] },
    { key: 'address', type: 'composite', required: true, accepts: [] },
    { key: 'attributeValues.*', type: 'string', required: false, accepts: [] },
  ],
});

const fields = {
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(99).optional(),
  price: z.number().optional(),
  active: z.boolean().optional(),
  since: z.iso.date().optional(),
  kind: z.enum(['b', 'a']).nullable().optional(),
  emails: z.array(z.email().max(320)).optional(),
  channels: z.array(z.enum(['web', 'b2b'])).optional(),
  parentId: z.uuid().nullable().optional(),
  address: z.object({ street: z.string() }),
  attributeValues: z.record(z.string(), z.string()).optional(),
  unrelated: z.string().optional(),
};
const create = z.object(fields);
const update = create.partial();

function failure(run: () => void): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected expectFieldSetMatchesSchemas to fail');
}

describe('expectFieldSetMatchesSchemas (193 T017, FR-003)', () => {
  it('passes when every field agrees with both schemas', () => {
    expect(() => expectFieldSetMatchesSchemas(SET, { create, update })).not.toThrow();
    expect(() => expectFieldSetMatchesSchemas(SET, { update })).not.toThrow();
  });

  it('accepts a field written by only one of the two schemas', () => {
    expect(() =>
      expectFieldSetMatchesSchemas(SET, { create, update: update.omit({ name: true }) }),
    ).not.toThrow();
  });

  it('refuses a call with no schema at all', () => {
    expect(failure(() => expectFieldSetMatchesSchemas(SET, {}))).toMatch(/create.*update/);
  });

  it('names a field no write schema carries', () => {
    const message = failure(() =>
      expectFieldSetMatchesSchemas(SET, { create: create.omit({ price: true }), update: update.omit({ price: true }) }),
    );
    expect(message).toMatch(/widget/);
    expect(message).toMatch(/'price'.*no write schema/);
  });

  it.each([
    ['a string declared over a number', { name: z.number() }, /'name'.*string/],
    ['an integer declared over a non-integer number', { size: z.number().optional() }, /'size'.*integer/],
    ['a boolean declared over a string', { active: z.string().optional() }, /'active'.*boolean/],
    ['an enum declared over a plain string', { kind: z.string().optional() }, /'kind'.*enum/],
    ['a string[] declared over a string', { emails: z.string().optional() }, /'emails'.*string\[\]/],
    ['a composite declared over a string', { address: z.string() }, /'address'.*composite/],
    ['a family declared over a non-record', { attributeValues: z.string().optional() }, /'attributeValues\.\*'/],
  ])('names a type mismatch: %s', (_name, replace, pattern) => {
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { create: create.extend(replace) }))).toMatch(pattern);
  });

  it('names a field required on create that the create schema makes optional, and the reverse', () => {
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { create: create.extend({ name: fields.name.optional() }) }))).toMatch(
      /'name'.*required/,
    );
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { create: create.extend({ size: z.number().int().min(0).max(99) }) }))).toMatch(
      /'size'.*required/,
    );
  });

  it('does not hold the update schema to required-ness', () => {
    expect(() => expectFieldSetMatchesSchemas(SET, { update: create })).not.toThrow();
  });

  it('names a bound that differs, is missing, or is extra', () => {
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { create: create.extend({ name: z.string().min(1).max(100) }) }))).toMatch(
      /'name'.*maxLength.*255.*100/,
    );
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { create: create.extend({ name: z.string().max(255) }) }))).toMatch(
      /'name'.*minLength/,
    );
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { update: update.extend({ price: z.number().max(10).optional() }) }))).toMatch(
      /'price'.*max/,
    );
    expect(
      failure(() => expectFieldSetMatchesSchemas(SET, { update: update.extend({ emails: z.array(z.email()).optional() }) })),
    ).toMatch(/'emails'.*maxLength/);
  });

  it('names enum options that differ', () => {
    expect(failure(() => expectFieldSetMatchesSchemas(SET, { update: update.extend({ kind: z.enum(['a', 'c']).optional() }) }))).toMatch(
      /'kind'.*options/,
    );
    expect(
      failure(() => expectFieldSetMatchesSchemas(SET, { update: update.extend({ channels: z.array(z.enum(['web'])).optional() }) })),
    ).toMatch(/'channels'.*options/);
  });

  it('reports every disagreement at once', () => {
    const message = failure(() =>
      expectFieldSetMatchesSchemas(SET, { create: create.extend({ name: z.number(), active: z.string().optional() }) }),
    );
    expect(message).toMatch(/'name'/);
    expect(message).toMatch(/'active'/);
  });
});
