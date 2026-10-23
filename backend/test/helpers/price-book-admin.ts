import { randomUUID } from 'node:crypto';
import { AdminRole, AdminUser, OrganizationSalesRepAssignment } from './package-entities.js';
import { ADMIN_COOKIES } from './test-actors.js';
import type { BackendServerHandle } from './test-server.js';

/**
 * Feature 160 (US7) — the admin price-book API as a test drives it: one
 * `inject` wrapper answering status and parsed body, and a sales
 * representative with the pricing codes and a set of assigned organizations.
 */

export const PLATFORM_ADMIN = { b2b_session: 'stub-admin-session' };

export interface ApiAnswer<T = unknown> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  raw: string;
}

export type ApiClient = {
  [M in 'get' | 'delete']: <T = unknown>(url: string, cookies?: Record<string, string>) => Promise<ApiAnswer<T>>;
} & {
  [M in 'post' | 'put' | 'patch']: <T = unknown>(
    url: string,
    payload?: unknown,
    cookies?: Record<string, string>,
    headers?: Record<string, string>,
  ) => Promise<ApiAnswer<T>>;
};

export function priceBookApi(h: BackendServerHandle): ApiClient {
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    payload: unknown,
    cookies: Record<string, string> = PLATFORM_ADMIN,
    headers: Record<string, string> = {},
  ): Promise<ApiAnswer> => {
    const res = await h.app.inject({
      method,
      url,
      cookies,
      headers,
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
    let body: unknown = null;
    try {
      body = res.body.length > 0 ? res.json() : null;
    } catch {
      body = res.body;
    }
    return { status: res.statusCode, body, headers: res.headers as Record<string, unknown>, raw: res.body };
  };
  return {
    get: (url, cookies) => call('GET', url, undefined, cookies) as never,
    delete: (url, cookies) => call('DELETE', url, undefined, cookies) as never,
    post: (url, payload, cookies, headers) => call('POST', url, payload ?? {}, cookies, headers) as never,
    put: (url, payload, cookies, headers) => call('PUT', url, payload ?? {}, cookies, headers) as never,
    patch: (url, payload, cookies, headers) => call('PATCH', url, payload ?? {}, cookies, headers) as never,
  };
}

/**
 * A sales representative assigned to `assignedOrganizationIds`, holding
 * `price_lists:read` and `price_lists:write`. Organizations nobody is assigned
 * to are visible to every representative (feature 050's fallback), so a test
 * that needs an out-of-scope organization assigns it to `otherOrganizationIds`,
 * which go to a second representative.
 */
export async function createSalesRep(
  h: BackendServerHandle,
  input: { assignedOrganizationIds: readonly string[]; otherOrganizationIds?: readonly string[] },
): Promise<{ cookies: Record<string, string>; adminUserId: string; release(): void }> {
  const em = h.em();
  const stamp = randomUUID().slice(0, 8);
  let role = await em.findOne(AdminRole, { code: 'sales_representative' });
  if (!role) {
    role = em.create(AdminRole, {
      code: 'sales_representative',
      name: 'Sales Representative',
      permissions: ['price_lists:read', 'price_lists:write'],
    });
  } else {
    role.permissions = Array.from(new Set([...role.permissions, 'price_lists:read', 'price_lists:write']));
  }
  await em.persistAndFlush(role);
  const admin = (label: string) =>
    em.create(AdminUser, {
      email: `pb-${label}-${stamp}@audit.local`,
      passwordHash: 'x'.repeat(60),
      adminRoleId: role!.id,
      firstName: 'Price book',
      lastName: label,
    });
  const rep = admin('rep');
  const other = admin('other');
  await em.persistAndFlush([rep, other]);
  await em.persistAndFlush([
    ...input.assignedOrganizationIds.map((organizationId) =>
      em.create(OrganizationSalesRepAssignment, { organizationId, adminUserId: rep.id }),
    ),
    ...(input.otherOrganizationIds ?? []).map((organizationId) =>
      em.create(OrganizationSalesRepAssignment, { organizationId, adminUserId: other.id }),
    ),
  ]);
  const session = `stub-pb-rep-${stamp}`;
  ADMIN_COOKIES[session] = { adminUserId: rep.id };
  return {
    cookies: { b2b_session: session },
    adminUserId: rep.id,
    release: () => {
      delete ADMIN_COOKIES[session];
    },
  };
}
