import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Command } from '@endora-commerce/platform/commands';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * `specs/177-tax-id-scope/` T054 (FR-031, SC-005; `contracts/convert-to-company.md`
 * §5) — no storefront, customer or public route reaches
 * `organization.convert_to_company`. A property of where the Command is run,
 * which no type can express, so it is asked twice: of the running server
 * (every non-admin route, with a customer session and without one, under a
 * recording bus) and of the source (no customer-facing file names it).
 */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const CUSTOMER_COOKIE = 'stub-customer-session';

describe('the personal → company conversion is not customer-reachable', () => {
  let h: BackendServerHandle;
  const actions: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    const bus = (h.container.cradle as unknown as { commandBus: { run<T>(command: Command<T>): Promise<T> } }).commandBus;
    const run = bus.run.bind(bus);
    vi.spyOn(bus, 'run').mockImplementation(async <T,>(command: Command<T>) => {
      actions.push(command.action);
      return run(command);
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await teardownBackendServer(h);
  });

  it('runs no conversion from any non-admin route, with or without a customer session', async () => {
    const document = (
      await h.app.inject({ method: 'GET', url: '/api/v1/_openapi.json', cookies: { b2b_session: 'stub-admin-session' } })
    ).json() as { paths: Record<string, Record<string, unknown>> };
    const routes = Object.entries(document.paths)
      .filter(([path]) => !path.startsWith('/api/v1/admin/'))
      .flatMap(([path, methods]) =>
        Object.keys(methods).map((method) => ({
          method: method.toUpperCase() as 'GET',
          url: path.replace(/\{[^}]+\}/g, TEST_ORGANIZATION_ID),
          path,
        })),
      );
    expect(routes.length).toBeGreaterThan(50);
    // Other modules convert carts and lists (`convert-to-order`, `convert-to-cart`);
    // no non-admin route converts an organization.
    expect(
      routes.filter((route) => /convert[^/]*(company|organi[sz]ation)|organizations?\/[^/]+\/convert/i.test(route.path)).map((route) => route.path),
    ).toEqual([]);

    for (const route of routes) {
      for (const cookies of [{ b2b_session: CUSTOMER_COOKIE }, undefined]) {
        await h.app.inject({
          method: route.method,
          url: route.url,
          ...(cookies ? { cookies } : {}),
          ...(route.method === 'GET' || route.method === ('DELETE' as 'GET') ? {} : { payload: {} }),
        });
      }
    }
    expect(actions.filter((action) => action === 'organization.convert_to_company')).toEqual([]);
  }, 600_000);

  it('is named by no customer-facing source', () => {
    const organizations = join(REPO, 'packages/modules/organizations/src/backend');
    const customerFacing = [
      'routes.customer.ts',
      'routes.public.ts',
      'routes.storefront.ts',
      'routes.members.ts',
      'routes.roles.ts',
    ].map((file) => join(organizations, file));
    const storefront = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        if (entry === 'node_modules' || entry === '.next') return [];
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) return storefront(path);
        return /\.(ts|tsx)$/.test(entry) ? [path] : [];
      });
    for (const file of [...customerFacing, ...storefront(join(REPO, 'storefront'))]) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/convertToCompany|makeConvertToCompanyCommand|convert-to-company/);
    }
  });
});
