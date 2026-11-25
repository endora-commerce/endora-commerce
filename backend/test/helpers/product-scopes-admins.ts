import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { BackendServerHandle } from './test-server.js';
import { AdminRole, AdminUser } from './package-entities.js';

/**
 * Feature 163 — the admins behind the `stub-product-scopes-reader-session` and
 * `stub-product-scopes-no-catalog-session` stub sessions (`test-actors.ts`). The stub
 * maps a session to an admin id; the admin row and its role must exist for the gate
 * to answer 403 rather than 401, so every file using those sessions seeds them here.
 *
 * Contract files may run in parallel and set up the same rows (same codes, same
 * permissions): a lost insert race is retried once against the row the other file
 * wrote.
 */
export const PRODUCT_SCOPES_READER_ID = '00000000-0000-4000-8000-0000000162a1';
export const PRODUCT_SCOPES_NO_CATALOG_ID = '00000000-0000-4000-8000-0000000162a2';

async function once<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (!(err instanceof UniqueConstraintViolationException)) throw err;
    return write();
  }
}

async function ensureRole(h: BackendServerHandle, code: string, permissions: string[]): Promise<string> {
  return once(async () => {
    const em = h.em().fork();
    let role = await em.findOne(AdminRole, { code });
    if (!role) role = em.create(AdminRole, { code, name: code, permissions });
    else role.permissions = permissions;
    await em.persist(role).flush();
    return role.id;
  });
}

async function ensureAdmin(h: BackendServerHandle, id: string, email: string, roleId: string): Promise<void> {
  await once(async () => {
    const em = h.em().fork();
    const existing = await em.findOne(AdminUser, { id });
    if (existing) {
      existing.adminRoleId = roleId;
      existing.status = 'active';
    } else {
      em.create(AdminUser, {
        id,
        email,
        passwordHash: 'x'.repeat(60),
        firstName: 'Product',
        lastName: 'Scopes',
        adminRoleId: roleId,
        status: 'active',
      });
    }
    await em.flush();
  });
}

/** A `catalog:read`-only admin and an admin without any catalog permission. */
export async function seedProductScopesAdmins(h: BackendServerHandle): Promise<void> {
  const readerRole = await ensureRole(h, 'product_scopes_catalog_reader', ['catalog:read']);
  const noCatalogRole = await ensureRole(h, 'product_scopes_no_catalog', ['orders:read']);
  await ensureAdmin(h, PRODUCT_SCOPES_READER_ID, 'product-scopes-reader@example.com', readerRole);
  await ensureAdmin(h, PRODUCT_SCOPES_NO_CATALOG_ID, 'product-scopes-no-catalog@example.com', noCatalogRole);
}
