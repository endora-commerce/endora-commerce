import { describe, expect, it } from 'vitest';
import type { OrganizationAllowListKind, OrganizationRestrictionPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ModuleDisabledError } from '@endora-commerce/platform/kernel';
import {
  DELIVERY_METHOD_NOT_ALLOWED_FOR_ORGANIZATION,
  PAYMENT_METHOD_NOT_ALLOWED_FOR_ORGANIZATION,
  assertMethodsAllowedForOrganization,
} from './organization-method-allow-list-gate.js';

const ORG_A = 'org-a';
const ORG_B = 'org-b';

type Lists = Partial<Record<OrganizationAllowListKind, string[] | null>>;

/** A restriction port over a fixed table, recording what it was asked. */
function restrictionOver(table: Record<string, Lists>): {
  port: OrganizationRestrictionPort;
  asked: Array<[string, OrganizationAllowListKind]>;
} {
  const asked: Array<[string, OrganizationAllowListKind]> = [];
  return {
    asked,
    port: {
      allowedIdsFor: async (organizationId, kind) => {
        asked.push([organizationId, kind]);
        return table[organizationId]?.[kind] ?? null;
      },
    },
  };
}

async function refusalOf(run: Promise<void>): Promise<HttpError> {
  try {
    await run;
  } catch (error) {
    if (error instanceof HttpError) return error;
    throw error;
  }
  throw new Error('expected a refusal, and the choice was allowed');
}

describe('assertMethodsAllowedForOrganization', () => {
  const restricted = {
    [ORG_A]: { deliveryMethodIds: ['d-allowed'], paymentMethodIds: ['p-allowed'] },
  };

  it('allows a choice both lists name', async () => {
    const { port } = restrictionOver(restricted);
    await expect(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-allowed',
        paymentMethodId: 'p-allowed',
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses a delivery method the list does not name', async () => {
    const { port } = restrictionOver(restricted);
    const refusal = await refusalOf(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-other',
        paymentMethodId: 'p-allowed',
      }),
    );
    expect(refusal.statusCode).toBe(400);
    expect(refusal.code).toBe('VALIDATION_FAILED');
    expect(refusal.details).toEqual({
      code: DELIVERY_METHOD_NOT_ALLOWED_FOR_ORGANIZATION,
      deliveryMethodId: 'd-other',
    });
  });

  it('refuses a payment method the list does not name', async () => {
    const { port } = restrictionOver(restricted);
    const refusal = await refusalOf(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-allowed',
        paymentMethodId: 'p-other',
      }),
    );
    expect(refusal.statusCode).toBe(400);
    expect(refusal.code).toBe('VALIDATION_FAILED');
    expect(refusal.details).toEqual({
      code: PAYMENT_METHOD_NOT_ALLOWED_FOR_ORGANIZATION,
      paymentMethodId: 'p-other',
    });
  });

  it.each([
    ['null (the Organization is unknown to the owner)', null],
    ['an empty list (no link rows)', [] as string[]],
  ])('reads %s as no restriction', async (_label, list) => {
    const { port } = restrictionOver({
      [ORG_A]: { deliveryMethodIds: list, paymentMethodIds: list },
    });
    await expect(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-any',
        paymentMethodId: 'p-any',
      }),
    ).resolves.toBeUndefined();
  });

  it('judges each kind on its own list', async () => {
    const { port } = restrictionOver({
      [ORG_A]: { deliveryMethodIds: [], paymentMethodIds: ['p-allowed'] },
    });
    await expect(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-any',
        paymentMethodId: 'p-allowed',
      }),
    ).resolves.toBeUndefined();
    const refusal = await refusalOf(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-any',
        paymentMethodId: 'p-other',
      }),
    );
    expect(refusal.details).toMatchObject({ code: PAYMENT_METHOD_NOT_ALLOWED_FOR_ORGANIZATION });
  });

  it('reads the lists of the Organization it is given and of no other', async () => {
    const { port, asked } = restrictionOver(restricted);
    // Organization B has no lists; Organization A's do not reach it.
    await expect(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_B,
        deliveryMethodId: 'd-other',
        paymentMethodId: 'p-other',
      }),
    ).resolves.toBeUndefined();
    expect(asked).toEqual([
      [ORG_B, 'deliveryMethodIds'],
      [ORG_B, 'paymentMethodIds'],
    ]);
  });

  it('checks only the methods it is handed', async () => {
    const { port, asked } = restrictionOver(restricted);
    await assertMethodsAllowedForOrganization(port, { organizationId: ORG_A });
    expect(asked).toEqual([]);
    await expect(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        paymentMethodId: 'p-other',
      }),
    ).rejects.toBeInstanceOf(HttpError);
  });

  it('lets a failing read refuse the placement instead of reading as unrestricted', async () => {
    const port: OrganizationRestrictionPort = {
      allowedIdsFor: async () => {
        throw new ModuleDisabledError('organizations');
      },
    };
    await expect(
      assertMethodsAllowedForOrganization(port, {
        organizationId: ORG_A,
        deliveryMethodId: 'd-other',
        paymentMethodId: 'p-other',
      }),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it.each(['deliveryMethodIds', 'paymentMethodIds'] as const)(
    'refuses when the read of %s alone fails',
    async (failingKind) => {
      const port: OrganizationRestrictionPort = {
        allowedIdsFor: async (_organizationId, kind) => {
          if (kind === failingKind) throw new Error(`the ${failingKind} read failed`);
          return ['d-allowed', 'p-allowed'];
        },
      };
      await expect(
        assertMethodsAllowedForOrganization(port, {
          organizationId: ORG_A,
          deliveryMethodId: 'd-allowed',
          paymentMethodId: 'p-allowed',
        }),
      ).rejects.toThrow(`the ${failingKind} read failed`);
    },
  );
});
