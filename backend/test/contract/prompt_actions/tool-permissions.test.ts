import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { resolvedManifestEntries } from '../../../src/modules/_lifecycle/registered-manifests.js';
import { requireModuleLayout } from '../../../scripts/lib/module-roots.js';

/**
 * Deployment-resolved at module scope, with a top-level `await` — since D-104
 * the deployment half of the manifest set is a runtime discovery (see
 * `permission-inventory.test.ts` for the same note).
 */
const RESOLVED_MANIFESTS = await resolvedManifestEntries();
import { listAssignablePermissionCodes } from '../../../../packages/modules/admin_roles/src/backend/services/permission-catalogue.service.js';
import type { PromptActionTool } from '@endora-commerce/contracts';
import {
  catalogPromptMutationTools,
  catalogPromptResolverTools,
  type CatalogPromptToolsDeps,
} from '../../../../packages/modules/catalog/src/backend/prompt-tools.js';
import {
  inventoryPromptTools,
  type InventoryPromptToolsDeps,
} from '../../../../packages/modules/inventory/src/backend/prompt-tools.js';
import {
  ordersPromptTools,
  type OrdersPromptToolsDeps,
} from '../../../../packages/modules/orders/dist/backend/prompt-tools.js';

/**
 * Issue #112, follow-up — a contributed prompt-action tool names a permission
 * the role matrix can actually grant.
 *
 * The widened `requireAdmin` scanner closed every gate it could read and left
 * one shape open, saying so in its own commit: a tool's `requiredPermission`
 * arrives at the enforcement seam as a runtime value. `tool-registry.ts` asks
 * `hasPermission(tool.requiredPermission)` inside a `for … of` over the
 * registry, so the static scan classifies it `runtime-value` and moves on —
 * correctly, because the literal is written at the *contributor*, three modules
 * away.
 *
 * That literal is unchecked anywhere else, and getting it wrong is silent in
 * the worst way: `hasPermission` answers false for a code no role can hold, so
 * the tool is filtered out of the catalogue for every operator, in the same
 * code path that filters a tool the operator merely lacks. A typo does not
 * throw, log or 403 — the assistant simply never offers the operation, forever.
 *
 * So the check is here, over the real tool objects rather than their source
 * text: the registration-time contract of `tool-registry.ts`
 * (`requiredPermission` mirrors the permission guarding the equivalent manual
 * admin route) measured against the same assignable set
 * `permission-inventory.test.ts` sweeps. Deployment-resolved on the manifest
 * side, so `DEPLOYMENT=<name>` checks that deployment's catalogue.
 */

/**
 * The module tree, **resolved rather than spelled** (feature 080, T040a).
 *
 * This was `fileURLToPath(new URL('../../../src/modules/'))` joined to
 * `<id>/prompt-tools.ts`, and both halves broke on the first contributor that
 * became a package: the directory no longer holds it, and its file sits at
 * `src/backend/prompt-tools.ts` rather than at the module root. Neither failure
 * is loud in the direction that matters — the map below would have gone on
 * naming a module the walk stopped seeing until every contributor had moved,
 * at which point the walk returns nothing and the non-vacuity assertion this
 * function exists for passes over an empty map.
 */
const MODULE_LAYOUT = await requireModuleLayout('[prompt-tool-permissions]');

/** Enough of each contributor's dependency bag to build its tool descriptors. */
const emFactory = (): EntityManager => ({}) as EntityManager;
const catalogDeps = { emFactory, events: { publish: () => undefined } } as unknown as CatalogPromptToolsDeps;
const inventoryDeps = { emFactory } as InventoryPromptToolsDeps;
const ordersDeps = { emFactory } as OrdersPromptToolsDeps;

/**
 * Every module that contributes into `promptActionToolRegistry`, and the tools
 * it contributes. Keyed by module id so the sweep below can prove the map still
 * describes the tree — a new contributor added while this map stands still is
 * exactly the "green because it stopped looking" failure.
 */
const CONTRIBUTED: Readonly<Record<string, () => PromptActionTool[]>> = {
  catalog: () => [...catalogPromptResolverTools(catalogDeps), ...catalogPromptMutationTools(catalogDeps)],
  inventory: () => inventoryPromptTools(inventoryDeps),
  orders: () => ordersPromptTools(ordersDeps),
};

/** Whether `prompt-tools.ts` exists anywhere under a module's own directory. */
function shipsPromptTools(directory: string): boolean {
  for (const name of readdirSync(directory)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(directory, name);
    if (statSync(full).isDirectory()) {
      if (shipsPromptTools(full)) return true;
    } else if (name === 'prompt-tools.ts') return true;
  }
  return false;
}

/** Module ids shipping a `prompt-tools.ts`, read off the tree, either layout. */
function contributingModulesOnDisk(): string[] {
  const ids = MODULE_LAYOUT.registeredIds
    .map((id) => [id, MODULE_LAYOUT.moduleDirectoryOf(id)] as const)
    .filter((pair): pair is readonly [string, string] => pair[1] !== null)
    .filter(([, directory]) => shipsPromptTools(directory))
    .map(([id]) => id)
    .sort();
  if (ids.length === 0) {
    throw new Error(
      '[prompt-tool-permissions] no registered module ships a `prompt-tools.ts` — ' +
        'the walk came back empty, which would make the non-vacuity assertion below ' +
        'vacuous. Fix the walk, never the expectation.',
    );
  }
  return ids;
}

/** Tools naming a permission the role matrix cannot grant. */
export function toolsWithUngrantablePermission(
  tools: readonly PromptActionTool[],
  assignable: ReadonlySet<string>,
): string[] {
  return tools
    .filter((tool) => !assignable.has(tool.requiredPermission))
    .map((tool) => `${tool.id} → '${tool.requiredPermission}'`)
    .sort();
}

describe('prompt-action tool permissions (#112)', () => {
  const assignable = new Set(listAssignablePermissionCodes(RESOLVED_MANIFESTS));
  const tools = Object.values(CONTRIBUTED).flatMap((build) => build());

  it('names every module that contributes tools', () => {
    // The non-vacuity half. Without it the sweep below passes by describing
    // fewer and fewer contributors as the tree grows.
    expect(Object.keys(CONTRIBUTED).sort()).toEqual(contributingModulesOnDisk());
  });

  it('reads a non-empty catalogue on both sides', () => {
    expect(tools.length, 'no tools were built — the sweep would be vacuous').toBeGreaterThan(0);
    expect(assignable.size, 'no assignable codes were read').toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.requiredPermission, `${tool.id} declares no requiredPermission`).not.toBe('');
    }
  });

  it('grants every contributed tool a permission that is assignable on /admin-roles', () => {
    expect(
      toolsWithUngrantablePermission(tools, assignable),
      "a tool whose permission no role can hold is invisible to every operator, in the " +
        'same filter that hides one the operator merely lacks — declare the code in the ' +
        "contributing module's manifest, or point the tool at the code its manual route uses",
    ).toEqual([]);
  });

  it('detects an ungrantable permission — the red proof for the sweep above', () => {
    const fixture = [
      { id: 'catalog.search_products', requiredPermission: 'catalog:read' },
      { id: 'catalog.retire_product', requiredPermission: 'catalog:retire' },
    ] as unknown as PromptActionTool[];
    expect(toolsWithUngrantablePermission(fixture, new Set(['catalog:read']))).toEqual([
      "catalog.retire_product → 'catalog:retire'",
    ]);
  });
});
