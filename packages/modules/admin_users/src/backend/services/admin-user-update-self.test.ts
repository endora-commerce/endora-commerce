/**
 * An administrator changing their own password proves they know the current
 * one, and a refused change leaves the account exactly as it was.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminRolePort, AuthSessionPort } from '@endora-commerce/contracts';
import { hashPassword, verifyPassword } from '@endora-commerce/platform/kernel';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdminUser } from '../entities/admin-user.entity.js';
import { AdminUserService } from './admin-user-service.js';

const CURRENT = 'the-current-pass-123!';
const NEXT = 'a-new-strong-pass-456!';

let currentHash: string;

function serviceOver(existing: AdminUser): { service: AdminUserService; flushes: () => number } {
  let flushes = 0;
  const em = {
    findOne: async () => existing,
    flush: async () => {
      flushes += 1;
    },
  } as unknown as EntityManager;
  return {
    service: new AdminUserService(() => em, {} as AdminRolePort, {} as AuthSessionPort),
    flushes: () => flushes,
  };
}

function account(): AdminUser {
  return Object.assign(new AdminUser(), {
    id: 'a1',
    email: 'ada@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    passwordHash: currentHash,
  });
}

describe('AdminUserService.updateSelf', () => {
  beforeAll(async () => {
    currentHash = await hashPassword(CURRENT);
  });

  it('edits the name without any password', async () => {
    const existing = account();
    const { service, flushes } = serviceOver(existing);
    await service.updateSelf('a1', { firstName: 'Augusta' });
    expect(existing.firstName).toBe('Augusta');
    expect(existing.passwordHash).toBe(currentHash);
    expect(flushes()).toBe(1);
  });

  it.each([
    ['no current password', undefined],
    ['a wrong current password', 'not-the-current-password'],
    ['an empty current password', ''],
  ])('refuses a new password with %s and writes nothing', async (_label, currentPassword) => {
    const existing = account();
    const { service, flushes } = serviceOver(existing);
    await expect(
      service.updateSelf('a1', {
        firstName: 'Augusta',
        lastName: 'King',
        password: NEXT,
        currentPassword,
      }),
    ).rejects.toMatchObject({ statusCode: 403, code: 'CURRENT_PASSWORD_INVALID' });
    expect(existing).toMatchObject({
      firstName: 'Ada',
      lastName: 'Lovelace',
      passwordHash: currentHash,
    });
    expect(flushes()).toBe(0);
  });

  it('stores the new password, and the rest of the request, when the current one is right', async () => {
    const existing = account();
    const { service, flushes } = serviceOver(existing);
    await service.updateSelf('a1', { lastName: 'King', password: NEXT, currentPassword: CURRENT });
    expect(existing.lastName).toBe('King');
    expect(await verifyPassword(existing.passwordHash, NEXT)).toBe(true);
    expect(await verifyPassword(existing.passwordHash, CURRENT)).toBe(false);
    expect(flushes()).toBe(1);
  });

  it('ignores a current password sent without a new one', async () => {
    const existing = account();
    const { service } = serviceOver(existing);
    await service.updateSelf('a1', { firstName: 'Augusta', currentPassword: 'anything' });
    expect(existing.firstName).toBe('Augusta');
    expect(existing.passwordHash).toBe(currentHash);
  });
});
