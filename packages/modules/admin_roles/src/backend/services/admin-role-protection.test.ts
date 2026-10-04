/**
 * The platform-administrator role cannot be deleted.
 *
 * It is the role installation guarantees and the one an operator is given back
 * access through, so it is protected whether or not anybody holds it and
 * whatever the in-memory registry of module-seeded codes happens to contain.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminUserReadPort } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { AdminRoleService, _resetSystemRoleCodesForTests } from './admin-role-service.js';
import type { PermissionCatalogueService } from './permission-catalogue.service.js';

function serviceOver(role: { id: string; code: string }): { service: AdminRoleService; removed: string[] } {
  const removed: string[] = [];
  const em = {
    findOne: async () => role,
    removeAndFlush: async (row: { id: string }) => {
      removed.push(row.id);
    },
  } as unknown as EntityManager;
  const adminUsers = { listByRoleId: async () => [] } as unknown as AdminUserReadPort;
  const service = new AdminRoleService(
    () => em,
    { listKnownCodes: () => [] } as unknown as PermissionCatalogueService,
    adminUsers,
  );
  return { service, removed };
}

describe('AdminRoleService.remove', () => {
  it('refuses the platform-administrator role even when nobody holds it', async () => {
    _resetSystemRoleCodesForTests();
    const { service, removed } = serviceOver({ id: 'r1', code: 'platform_admin' });

    await expect(service.remove('r1')).rejects.toMatchObject({
      statusCode: 409,
      code: 'ADMIN_ROLE_PROTECTED',
      details: { role: 'platform_admin' },
    });
    expect(removed).toEqual([]);
  });

  it('still deletes an unassigned role of the operator\'s own', async () => {
    _resetSystemRoleCodesForTests();
    const { service, removed } = serviceOver({ id: 'r2', code: 'order_desk' });

    await service.remove('r2');
    expect(removed).toEqual(['r2']);
  });
});
