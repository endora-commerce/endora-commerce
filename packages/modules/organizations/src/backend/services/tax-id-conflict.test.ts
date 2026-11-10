import { describe, expect, it } from 'vitest';
import { taxIdConflictOf } from './tax-id-conflict.js';

/**
 * `specs/177-tax-id-scope/` `contracts/tax-id-scope.md` §5 — which database
 * refusals are a tax-ID conflict.
 *
 * MikroORM 6 turns `23505` into a `UniqueConstraintViolationException` and has
 * no case for `23P01`, which arrives as a plain `DriverException`; both keep the
 * pg error's `code` and `constraint`, on the error itself or on what it wraps.
 * So the helper reads the error, its `cause` and its `previous`, and recognises
 * the two codes only on this feature's two constraint names.
 */
function pgError(code: string, constraint: string | undefined): Error {
  return Object.assign(new Error(`pg ${code}`), { code, constraint });
}

describe('taxIdConflictOf [unit]', () => {
  it.each([
    ['23505', 'organizations_tax_id_unique', 'tax_id_exists'],
    ['23P01', 'organizations_tax_id_one_tree', 'tax_id_shared_across_trees'],
  ] as const)('recognises %s on %s on the error itself', (code, constraint, expected) => {
    expect(taxIdConflictOf(pgError(code, constraint))).toBe(expected);
  });

  it.each(['cause', 'previous'] as const)('recognises a refusal wrapped as `%s`', (key) => {
    const unique = Object.assign(new Error('wrapped'), { [key]: pgError('23505', 'organizations_tax_id_unique') });
    const exclusion = Object.assign(new Error('wrapped'), {
      [key]: pgError('23P01', 'organizations_tax_id_one_tree'),
    });
    expect(taxIdConflictOf(unique)).toBe('tax_id_exists');
    expect(taxIdConflictOf(exclusion)).toBe('tax_id_shared_across_trees');
  });

  it('answers null for the same codes on another constraint', () => {
    expect(taxIdConflictOf(pgError('23505', 'customer_accounts_email_unique'))).toBeNull();
    expect(taxIdConflictOf(pgError('23P01', 'catalog_url_keys_scope_excl'))).toBeNull();
    expect(taxIdConflictOf(pgError('23505', undefined))).toBeNull();
  });

  it('answers null for a code on the wrong constraint of this feature', () => {
    // An exclusion code on the unique constraint is not something Postgres
    // raises; reading it as a conflict would mask a different fault.
    expect(taxIdConflictOf(pgError('23P01', 'organizations_tax_id_unique'))).toBeNull();
    expect(taxIdConflictOf(pgError('23505', 'organizations_tax_id_one_tree'))).toBeNull();
  });

  it('answers null for other codes and for anything that is not an error', () => {
    expect(taxIdConflictOf(pgError('23514', 'organizations_tax_id_presence'))).toBeNull();
    expect(taxIdConflictOf(new Error('boom'))).toBeNull();
    expect(taxIdConflictOf(null)).toBeNull();
    expect(taxIdConflictOf(undefined)).toBeNull();
    expect(taxIdConflictOf('23505')).toBeNull();
  });

  it('does not loop on an error whose cause is itself', () => {
    const err = new Error('self') as Error & { cause?: unknown };
    err.cause = err;
    expect(taxIdConflictOf(err)).toBeNull();
  });
});
