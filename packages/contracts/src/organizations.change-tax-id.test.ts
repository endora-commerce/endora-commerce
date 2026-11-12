import { describe, expect, expectTypeOf, it } from 'vitest';
import { ERROR_CODES } from './errors.js';
import {
  adminOrganizationChangeTaxIdBodySchema,
  type OrganizationChangeTaxIdInput,
  type OrganizationCommandPort,
  type OrganizationCommandPortOptions,
  type OrganizationRecord,
  type OrganizationTaxIdChangedEvent,
} from './organizations.js';

/**
 * Issue #1040 (follow-up to `specs/177-tax-id-scope/`) — the published shapes of
 * `organization.tax_id.change`: the admin body, the port method, the event and
 * the refusal code.
 */
describe('adminOrganizationChangeTaxIdBodySchema', () => {
  it('normalises the tax ID exactly as creation does', () => {
    expect(adminOrganizationChangeTaxIdBodySchema.parse({ taxId: ' pl 526-025-09-95 ' })).toEqual({
      taxId: 'PL5260250995',
      validateTaxId: false,
    });
  });

  it('refuses a tax ID outside 8 to 32 characters after normalisation', () => {
    expect(adminOrganizationChangeTaxIdBodySchema.safeParse({ taxId: '1234-567' }).success).toBe(false);
    expect(adminOrganizationChangeTaxIdBodySchema.safeParse({ taxId: '--------' }).success).toBe(false);
    expect(adminOrganizationChangeTaxIdBodySchema.safeParse({ taxId: 'X'.repeat(33) }).success).toBe(false);
    expect(adminOrganizationChangeTaxIdBodySchema.safeParse({}).success).toBe(false);
  });

  it('keeps validateTaxId as the route switch, outside the Command input', () => {
    expect(adminOrganizationChangeTaxIdBodySchema.parse({ taxId: '5260250995', validateTaxId: true }).validateTaxId).toBe(true);
    expectTypeOf<OrganizationChangeTaxIdInput>().toEqualTypeOf<{ taxId: string }>();
  });
});

describe('the port, the event and the refusal', () => {
  it('publishes changeTaxId on organizationCommandPort', () => {
    expectTypeOf<OrganizationCommandPort['changeTaxId']>().toEqualTypeOf<
      (
        organizationId: string,
        input: OrganizationChangeTaxIdInput,
        options?: OrganizationCommandPortOptions,
      ) => Promise<OrganizationRecord>
    >();
  });

  it('forwards extension input to the hook modules on both of its Commands (issue #1057)', () => {
    expectTypeOf<OrganizationCommandPortOptions>().toEqualTypeOf<{
      readonly extensions?: Readonly<Record<string, unknown>>;
    }>();
    expectTypeOf<Parameters<OrganizationCommandPort['convertToCompany']>[2]>().toEqualTypeOf<
      OrganizationCommandPortOptions | undefined
    >();
  });

  it('carries no tax ID in the event', () => {
    expectTypeOf<keyof OrganizationTaxIdChangedEvent>().toEqualTypeOf<
      'eventId' | 'occurredAt' | 'organizationId' | 'changedAt'
    >();
  });

  it('declares ORGANIZATION_TAX_ID_CHANGE_REFUSED', () => {
    expect(ERROR_CODES.ORGANIZATION_TAX_ID_CHANGE_REFUSED).toBe('ORGANIZATION_TAX_ID_CHANGE_REFUSED');
  });
});
