import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  aggregateCommandSourceSchema,
  type AggregateCommandOptions,
  type CustomFieldMerge,
} from './aggregate-ports.js';

/**
 * `specs/186-aggregate-ports/` T011 (`data-model.md` § *AggregateCommandOptions*)
 * — the options every aggregate write port takes last, and the merge its
 * `setCustomFieldValues` takes.
 */
describe('AggregateCommandOptions', () => {
  it('carries extensions, an expected version and a source code — every member optional', () => {
    expectTypeOf<AggregateCommandOptions>().toEqualTypeOf<{
      readonly extensions?: Readonly<Record<string, unknown>>;
      readonly expectedVersion?: number;
      readonly source?: string;
    }>();
    expectTypeOf<{}>().toMatchTypeOf<AggregateCommandOptions>();
  });

  it('types the custom-field merge as a read-modify-write over the current bag', () => {
    expectTypeOf<CustomFieldMerge>().toEqualTypeOf<
      (current: Record<string, unknown>) => Promise<Record<string, unknown>>
    >();
  });
});

describe('aggregateCommandSourceSchema', () => {
  it.each(['erp', 'pim.sync', 'm3-connector', 'a', `a${'b'.repeat(63)}`])('accepts the code %s', (code) => {
    expect(aggregateCommandSourceSchema.safeParse(code).success).toBe(true);
  });

  it.each(['', 'ERP', '1erp', 'erp sync', 'erp/sync', `a${'b'.repeat(64)}`])('refuses %j', (code) => {
    expect(aggregateCommandSourceSchema.safeParse(code).success).toBe(false);
  });
});
