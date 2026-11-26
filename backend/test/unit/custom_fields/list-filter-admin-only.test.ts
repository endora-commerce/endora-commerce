import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * Custom-field list filters are an administrator's tool
 * (`specs/157-custom-fields-list-filters/` FR-017).
 *
 * A list filter can be set on an `internal` field, so whoever filters on one
 * learns something about its values. The port and the query parameter are
 * therefore named only by the admin lists that use them; a storefront or
 * external (API-key) route that named either would hand that to a buyer or an
 * integration. Read as text, by path: this file imports no module.
 *
 * **What a path cannot tell.** The scan judges files, not handlers: a file
 * that serves both audiences — `orders`' `src/backend/routes.ts` registers the
 * customer routes beside the admin list — is allowed whole, so a customer
 * handler in it naming either would pass here. The contract tests are what
 * hold the handlers (the storefront Orders list ignores the parameter).
 */
const layout = await requireModuleLayout('[list-filter-admin-only]');

const NAMES = ['customFieldListFilterPort', 'customFieldFiltersQueryParamSchema'];

/** Module-relative paths allowed to name either, per module; `*` for the whole module. */
const ALLOWED: Record<string, readonly string[]> = {
  custom_fields: ['*'],
  orders: ['src/backend/index.ts', 'src/backend/routes.ts', 'src/backend/services/order-list-service.ts'],
  quote_requests: [
    'src/backend/index.ts',
    'src/backend/routes.admin.ts',
    'src/backend/services/rfq-admin-service.ts',
  ],
  crm: ['src/backend/index.ts', 'src/backend/services/opportunity-service.ts'],
  // `specs/163-projects-and-tasks/` User Story 9 — the admin Projects list.
  projects: ['src/backend/index.ts'],
  // `specs/165-task-management/` R-8 — the admin Tasks list.
  tasks: ['src/backend/index.ts'],
  // Issue #1903 — the admin Organizations and Customers lists.
  organizations: ['src/backend/index.ts', 'src/backend/routes.admin.ts'],
  customers: ['src/backend/index.ts', 'src/backend/routes.admin.ts'],
};

/** A file serving a buyer or an integration, by its path. */
const NON_ADMIN = /(^|\/)(storefront|routes\.external|routes\.customer|routes\.storefront|routes\.api-key)/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'dist' || name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const naming = layout.moduleWalkRoots.flatMap(walk).flatMap((file) => {
  const moduleId = layout.moduleIdOfPath(file);
  if (moduleId === null) return [];
  const source = readFileSync(file, 'utf8');
  if (!NAMES.some((name) => source.includes(name))) return [];
  const directory = layout.moduleDirectoryOf(moduleId);
  return [{ moduleId, path: directory === null ? file : relative(directory, file) }];
});

describe('custom-field list filters are admin-only (FR-017)', () => {
  it('are named only by the admin lists that use them', () => {
    const outside = naming.filter(({ moduleId, path }) => {
      const allowed = ALLOWED[moduleId];
      return !allowed || !(allowed.includes('*') || allowed.includes(path));
    });
    expect(outside.map(({ moduleId, path }) => `${moduleId}: ${path}`)).toEqual([]);
  });

  it('are named by no storefront or external route', () => {
    expect(naming.filter(({ path }) => NON_ADMIN.test(path)).map(({ path }) => path)).toEqual([]);
  });

  it('reach the Orders list service', () => {
    expect(naming).toContainEqual({ moduleId: 'orders', path: 'src/backend/services/order-list-service.ts' });
  });
});
