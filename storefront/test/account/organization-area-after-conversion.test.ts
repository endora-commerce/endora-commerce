import { describe, expect, it } from 'vitest';
import { organizationAreaAccess, type OrganizationAreaSession } from '../../lib/account/organization-area';

/**
 * `specs/177-tax-id-scope/` T058 — after an operator turns a personal
 * Organization into a company, `/me` answers it with `isPersonal: false` and
 * the same id, and its member — its Administrator — is offered the company
 * screens the personal Organization hid (feature 170, FR-070a: the gate is the
 * Organization's kind, never the role).
 */
const administrator = {
  organizationRole: { id: '00000000-0000-4000-8000-0000000000a1', kind: 'administrator', name: 'Administrator' },
  permissions: [],
} as unknown as OrganizationAreaSession['customerAccount'];

const before: OrganizationAreaSession = { customerAccount: administrator, organization: { isPersonal: true } };
const after: OrganizationAreaSession = { customerAccount: administrator, organization: { isPersonal: false } };

describe('the account area of an Organization converted to a company', () => {
  it.each(['members', 'roles', 'summary', 'addresses'] as const)('opens %s once the Organization is a company', (area) => {
    expect(organizationAreaAccess(before, area)).toBe('absent');
    expect(organizationAreaAccess(after, area)).toBe('allowed');
  });
});
