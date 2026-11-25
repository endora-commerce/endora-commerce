import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerAccountMemberWritePort,
  CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { PersonalOrganizationService } from './personal-organization-service.js';

/**
 * Feature 154, US4 (T055 unit half) — a provisioned personal organisation gets
 * exactly the channel of the store its account registers on, and the system
 * default when the provisioning has no storefront channel (owner decision D6,
 * research R-8). Both on the caller's `EntityManager`, so the bridge row shares
 * the transaction that creates the account and its organisation.
 */

function stubEm(): EntityManager {
  return {
    findOne: vi.fn(async () => null),
    create: vi.fn((_entity: unknown, data: Record<string, unknown>) => ({
      id: 'org-1',
      ...data,
    })),
    persist: vi.fn(() => ({ flush: async () => undefined })),
  } as unknown as EntityManager;
}

function build() {
  const membership = {
    bindToDefaultIfEmpty: vi.fn(async () => ({ changed: true })),
    replaceChannelsForEntity: vi.fn(async () => ({ changed: true })),
  };
  const unreachable = (): never => {
    throw new Error('provisionFor touches no customer_accounts port');
  };
  const service = new PersonalOrganizationService(
    () => {
      throw new Error('provisionFor works on the caller’s EntityManager');
    },
    {
      read: new Proxy({} as CustomerAccountReadPort, { get: unreachable }),
      write: new Proxy({} as CustomerAccountMemberWritePort, { get: unreachable }),
    },
    undefined,
    membership,
  );
  return { service, membership };
}

describe('PersonalOrganizationService.provisionFor — the channel of a new personal organisation', () => {
  it('binds exactly the registering store’s channel, on the caller’s EntityManager', async () => {
    const { service, membership } = build();
    const em = stubEm();
    const org = await service.provisionFor(em, {
      customerAccountId: '00000000-0000-4000-8000-000000000001',
      email: 'solo@example.test',
      salesChannelId: 'channel-a',
    });
    expect(membership.replaceChannelsForEntity).toHaveBeenCalledWith(
      'organization',
      org.id,
      ['channel-a'],
      { em },
    );
    expect(membership.bindToDefaultIfEmpty).not.toHaveBeenCalled();
  });

  it.each([null, undefined])(
    'binds the system default when there is no storefront channel (%s)',
    async (salesChannelId) => {
      const { service, membership } = build();
      const em = stubEm();
      const org = await service.provisionFor(em, {
        customerAccountId: '00000000-0000-4000-8000-000000000002',
        email: 'solo@example.test',
        ...(salesChannelId === undefined ? {} : { salesChannelId }),
      });
      expect(membership.bindToDefaultIfEmpty).toHaveBeenCalledWith('organization', org.id, {
        em,
      });
      expect(membership.replaceChannelsForEntity).not.toHaveBeenCalled();
    },
  );
});
