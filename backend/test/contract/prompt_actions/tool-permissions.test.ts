import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import { resolvedManifestEntries } from '../../../src/modules/_lifecycle/registered-manifests.js';

/**
 * Deployment-resolved at module scope, with a top-level `await` — since D-104
 * the deployment half of the manifest set is a runtime discovery (see
 * `permission-inventory.test.ts` for the same note).
 */
const RESOLVED_MANIFESTS = await resolvedManifestEntries();
import { listAssignablePermissionCodes } from '../../../src/modules/admin_roles/services/permission-catalogue.service.js';
import type { PromptActionTool } from '@endora-commerce/contracts';
import {
  catalogPromptMutationTools,
  catalogPromptResolverTools,
  type CatalogPromptToolsDeps,
} from '../../../src/modules/catalog/prompt-tools.js';
import {
  inventoryPromptTools,
  type InventoryPromptToolsDeps,
} from '../../../src/modules/inventory/prompt-tools.js';
import {
  ordersPromptTools,
  type OrdersPromptToolsDeps,
} from '../../../src/modules/orders/prompt-tools.js';

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

const MODULES_ROOT = fileURLToPath(new URL('../../../src/modules/', import.meta.url));

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

/** Module ids shipping a `prompt-tools.ts`, read off the tree. */
function contributingModulesOnDisk(): string[] {
  return readdirSync(MODULES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => existsSync(join(MODULES_ROOT, id, 'prompt-tools.ts')))
    .sort();
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
