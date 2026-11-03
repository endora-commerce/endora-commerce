import { describe, expect, it } from 'vitest';
import { can, isAdministrator, type OrganizationPermissionSession } from '../../lib/organization-permissions';

/**
 * `specs/170-organization-roles/` WP-01 (T011) — the storefront's one reading of
 * the session's role (research R-12, R-35). Every page and component that hides
 * or shows a buyer action asks these two, never the session fields directly.
 *
 * The helper takes a **structural** session: the account and organisation pages
 * (WP-09) and the commerce surfaces (WP-10) read different session fetchers,
 * and neither has to wait for the other's type to exist.
 */
describe('storefront organization permission helpers', () => {
  const member = {
    organizationRole: { id: 'r-member', name: 'Member', kind: 'member' as const },
    permissions: ['carts.create', 'quote_requests.create'],
  };
  const administrator = {
    organizationRole: { id: 'r-admin', name: 'Administrator', kind: 'administrator' as const },
    permissions: ['carts.approve', 'carts.create'],
  };

  it('can is true only for a code the session carries', () => {
    expect(can(member, 'carts.create')).toBe(true);
    expect(can(member, 'quote_requests.create')).toBe(true);
    expect(can(member, 'carts.approve')).toBe(false);
  });

  it('can matches the code exactly, never by prefix', () => {
    expect(can(member, 'carts')).toBe(false);
    expect(can(member, 'carts.create_extra')).toBe(false);
  });

  it('isAdministrator reads the role kind, not the permission list', () => {
    expect(isAdministrator(administrator)).toBe(true);
    expect(isAdministrator(member)).toBe(false);
    // A custom role holding every code is still not the administrator (FR-010, US 5.3).
    const everything = {
      organizationRole: { id: 'r-custom', name: 'Everything', kind: 'custom' as const },
      permissions: ['carts.approve', 'carts.create', 'orders.view_organization'],
    };
    expect(isAdministrator(everything)).toBe(false);
  });

  it.each([
    ['a signed-out visitor', null],
    ['an absent session', undefined],
  ])('both answer false for %s', (_label, session) => {
    expect(can(session, 'carts.create')).toBe(false);
    expect(isAdministrator(session)).toBe(false);
  });

  it('both answer false for a session that carries no role (a backend older than the field)', () => {
    const roleless: OrganizationPermissionSession = {};
    expect(can(roleless, 'carts.create')).toBe(false);
    expect(isAdministrator(roleless)).toBe(false);
    expect(can({ organizationRole: null, permissions: null }, 'carts.create')).toBe(false);
    expect(isAdministrator({ organizationRole: null })).toBe(false);
  });
});
