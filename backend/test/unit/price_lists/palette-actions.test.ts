import type { EntityManager } from '@mikro-orm/postgresql';
import type { AdminI18nTranslatePort, PermissionReadPort } from '@endora-commerce/contracts';
import { ModuleActionSchema } from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { manifest } from '@endora-commerce/mod-price-lists';
import { AdminActionsService } from '../../../../packages/modules/admin_actions/src/backend/services/admin-actions-service.js';

/**
 * The price-book editor's four palette actions (feature 161, T042 and T048;
 * FR-029, Principle XVI) through the palette's own filter.
 *
 * The admin test `admin/test/modules/price_lists/price-books-surfaces.test.tsx`
 * proves the declarations and that each action names a route opening on the
 * action's code. What it cannot prove is what an operator's ⌘K shows: that is
 * resolved on the server by `AdminActionsService` over the reconciled
 * `module_actions` rows, against both presence axes and the operator's codes.
 * Here the rows are this module's **declared** actions — read from the
 * manifest, never copied — handed to the real service through the same
 * knex stand-in its own unit test uses, so a code or route drifting in the
 * manifest moves this result.
 */

interface ActionRow {
  module_id: string;
  action_id: string;
  label_key: string;
  description_key: string | null;
  icon: string;
  target_route: string;
  required_permission: string | null;
  keywords: string[];
  weight: number;
  version: number;
}

/** What the boot reconciler writes for one declared action. */
function rowsOf(): ActionRow[] {
  return (manifest.actions ?? []).map((declared) => {
    const action = ModuleActionSchema.parse(declared);
    return {
      module_id: 'price_lists',
      action_id: action.id,
      label_key: action.labelKey,
      description_key: action.descriptionKey ?? null,
      icon: action.icon,
      target_route: action.targetRoute,
      required_permission: action.requiredPermission ?? null,
      keywords: [...(action.keywords ?? [])],
      weight: action.weight ?? 100,
      version: 1,
    };
  });
}

function emReturning(rows: ActionRow[]): () => EntityManager {
  const knex = (): unknown => {
    const chain = {
      where: (): unknown => chain,
      select: async (): Promise<ActionRow[]> => rows,
    };
    return chain;
  };
  return () => ({ getKnex: () => knex }) as unknown as EntityManager;
}

const i18n: AdminI18nTranslatePort = { translate: async (moduleId, key) => `${moduleId}/${key}` };

async function visible(options: {
  readonly permissions: readonly string[];
  readonly platformAvailable?: boolean;
}): Promise<string[]> {
  const permissions: Pick<PermissionReadPort, 'listPermissions'> = { listPermissions: async () => [...options.permissions] };
  const service = new AdminActionsService({
    em: emReturning(rowsOf()),
    i18nService: i18n,
    permissionService: permissions,
    presence: {
      isPlatformAvailable: () => options.platformAvailable ?? true,
      isActivated: () => true,
      version: () => 1,
    },
  });
  try {
    const result = await service.listVisibleForOperator({ language: 'en', adminUserId: 'admin-1' });
    return result.actions.map((a) => a.actionId).sort();
  } finally {
    service.dispose();
  }
}

describe('price_lists palette actions (161 FR-029)', () => {
  it('declares the four actions', () => {
    expect(rowsOf().map((r) => [r.action_id, r.target_route, r.required_permission])).toEqual([
      ['open-price-lists', '/price-lists', 'price_lists:read'],
      ['new-price-book', '/price-lists/new', 'price_lists:write'],
      ['open-price-explainer', '/price-lists/explain', 'price_lists:read'],
      ['open-pricing-settings', '/price-lists/display-modes', 'price_lists:read'],
    ]);
  });

  it('offers all four to an operator holding both codes', async () => {
    expect(await visible({ permissions: ['price_lists:read', 'price_lists:write'] })).toEqual([
      'new-price-book',
      'open-price-explainer',
      'open-price-lists',
      'open-pricing-settings',
    ]);
  });

  it('offers a reader the list, the explainer and Pricing settings, never the create screen', async () => {
    expect(await visible({ permissions: ['price_lists:read'] })).toEqual([
      'open-price-explainer',
      'open-price-lists',
      'open-pricing-settings',
    ]);
  });

  it('offers nothing to an operator without the pricing codes', async () => {
    expect(await visible({ permissions: ['catalog:read'] })).toEqual([]);
  });

  it('offers nothing where the platform does not offer the module', async () => {
    expect(await visible({ permissions: ['*'], platformAvailable: false })).toEqual([]);
  });
});
