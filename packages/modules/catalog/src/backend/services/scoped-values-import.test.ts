import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type ProductScopedWriteCell } from '@endora-commerce/contracts';

import { assertIntegrationCall } from './scoped-values-import.js';

/**
 * Feature 172 (C2/C3 security review warn 2) — the connector port takes `ScopedWriteOp`s from
 * untyped callers (a JS or PHP bridge), so the op's shape is checked at runtime: anything but
 * exactly `{ op: 'set', value }`, `{ op: 'empty' }` or `{ op: 'inherit' }` refuses the call,
 * and a bare value (the pre-172 shape) never becomes an inherit that deletes an override.
 */
describe('assertIntegrationCall — the op shape at runtime', () => {
  const registered = () => true;
  const cell = (op: unknown): ProductScopedWriteCell =>
    ({ scope: { level: 'global' }, field: 'name', op }) as unknown as ProductScopedWriteCell;

  it.each([
    ['a bare string', 'Drill'],
    ['null', null],
    ['an unknown op', { op: 'delete' }],
    ['set without a value', { op: 'set' }],
    ['set with an extra key', { op: 'set', value: 'x', inherit: true }],
    ['empty with a value', { op: 'empty', value: 'x' }],
    ['inherit with an extra key', { op: 'inherit', extra: 1 }],
    ['the save encoding', { inherit: true }],
    ['an array', ['set', 'x']],
  ])('refuses %s as 422 VALIDATION_FAILED naming the cell', (_label, op) => {
    const call = () => assertIntegrationCall([cell({ op: 'set', value: 'ok' }), cell(op)].map((c, i) => ({ ...c, field: i === 0 ? 'description' : 'name' })), 'pim_connector', registered);
    expect(call).toThrow(expect.objectContaining({ statusCode: 422, code: ERROR_CODES.VALIDATION_FAILED, details: { field: 'cells', index: 1 } }));
  });

  it.each([
    ['set', { op: 'set', value: 'Drill' }],
    ['set null-free value false', { op: 'set', value: false }],
    ['empty', { op: 'empty' }],
    ['inherit', { op: 'inherit' }],
  ])('accepts %s', (_label, op) => {
    expect(() => assertIntegrationCall([cell(op)], 'pim_connector', registered)).not.toThrow();
  });
});
