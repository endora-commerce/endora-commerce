import { describe, expect, it, vi } from 'vitest';
import { OrganizationCommandService } from './organization-command-port.js';

/**
 * `specs/177-tax-id-scope/` review finding 7 — the conversion has committed
 * when the role cache is dropped; a cache that cannot be dropped is logged and
 * the port still answers the converted organization.
 */
describe('OrganizationCommandService.convertToCompany', () => {
  it('answers the record when the role cache cannot be dropped', async () => {
    const organization = {
      id: 'org-1', name: 'Co', legalName: null, taxId: 'PL1234567890', status: 'active', vatStatus: 'vat_payer',
      isPersonal: false, customerGroupId: null, registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      convertedToCompanyAt: new Date(), parentId: null, path: '/org-1/', createdAt: new Date(), updatedAt: new Date(),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new OrganizationCommandService({
      commandBus: { run: async () => organization as never },
      accounts: { listByOrganization: async () => [] },
      roleCache: { dropAndAnnounce: async () => { throw new Error('redis down'); } },
    });
    await expect(
      service.convertToCompany('org-1', {
        name: 'Co',
        taxId: 'PL1234567890',
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
        vatStatus: 'vat_payer',
      }),
    ).resolves.toMatchObject({ id: 'org-1', isPersonal: false });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
