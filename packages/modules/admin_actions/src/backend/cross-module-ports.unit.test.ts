import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyInstance } from 'fastify';
import type {
  AdminI18nTranslatePort,
  ModuleAction,
  PermissionReadPort,
} from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import {
  adminActionsModule,
  type AdminActionsManifestRegistryView,
} from './plugin.js';
import { AdminActionsService } from './services/admin-actions-service.js';

/**
 * Feature 075, Phase C — `admin_actions` states its cross-module demand.
 *
 * Eight import sites reached into three other modules for three things the
 * palette actually needs: resolve a string (`_i18n`), list an operator's
 * permissions (`admin_roles`), and walk the manifests a deployment ships
 * (`_lifecycle`). What crossed the boundary was three whole classes — bundle
 * installation, coverage snapshots, role administration, a dependency graph and
 * every module's install hooks — none of which the palette has any business
 * seeing.
 *
 * Every stub below is annotated with the **published** type and nothing wider,
 * so a service that reaches for a method the port does not carry stops
 * compiling. The `EntityManager` stub refuses any table this module does not
 * own, so a read that starts going around a port reads as "`admin_actions`
 * queried someone else's table directly" rather than as a silent pass.
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

/** The two tables the palette read may name: its own, and the kernel registry. */
const OWN_TABLES = ['module_actions as a', 'module_registrations as r'];

function emReturning(rows: ActionRow[]): () => EntityManager {
  const knex = (table: string): unknown => {
    if (!OWN_TABLES.includes(table)) {
      throw new Error(`admin_actions queried a table it does not own: ${table}`);
    }
    const chain = {
      join: (joined: string) => {
        if (!OWN_TABLES.includes(joined)) {
          throw new Error(`admin_actions joined a table it does not own: ${joined}`);
        }
        return chain;
      },
      where: () => chain,
      select: async (): Promise<ActionRow[]> => rows,
    };
    return chain;
  };
  return () => ({ getKnex: () => knex }) as unknown as EntityManager;
}

function actionRow(over: Partial<ActionRow> = {}): ActionRow {
  return {
    module_id: 'catalog',
    action_id: 'open',
    label_key: 'actions.open.label',
    description_key: null,
    icon: 'Package',
    target_route: '/products',
    required_permission: 'catalog:read',
    keywords: [],
    weight: 100,
    version: 7,
    ...over,
  };
}

describe('admin_actions — the cross-module demand is two ports and a registry view', () => {
  it('renders the palette from AdminI18nTranslatePort and PermissionReadPort alone', async () => {
    // `_i18n`'s published resolver. Two arguments and a language — not the
    // service class, which also installs bundles and computes coverage.
    const i18n: AdminI18nTranslatePort = {
      translate: async (moduleId, key, language) => {
        if (key === 'actions.open.description') return `${moduleId}.${key}`;
        return `${language}:${moduleId}/${key}`;
      },
    };
    // `admin_roles`' published permission read. One method — not the service
    // class, which also assigns and revokes roles.
    const permissions: PermissionReadPort = {
      listPermissions: async () => ['catalog:read'],
    };

    const service = new AdminActionsService({
      em: emReturning([
        actionRow({ weight: 20 }),
        actionRow({
          module_id: 'blog',
          action_id: 'write',
          label_key: 'actions.write.label',
          description_key: 'actions.open.description',
          required_permission: null,
          weight: 10,
          version: 9,
        }),
        actionRow({
          module_id: 'invoices',
          action_id: 'issue',
          required_permission: 'invoices:write',
          version: 12,
        }),
      ]),
      i18nService: i18n,
      permissionService: permissions,
    });

    const result = await service.listVisibleForOperator({
      language: 'pl',
      adminUserId: 'admin-1',
    });

    // The invoices action is filtered out: the operator does not hold its code,
    // and the palette never advertises a 403.
    expect(result.actions.map((a) => a.actionId)).toEqual(['write', 'open']);
    expect(result.actions[1]?.label).toBe('pl:catalog/actions.open.label');
    // The resolver's `moduleId.key` placeholder is surfaced as an absent
    // description rather than as a raw key.
    expect(result.actions[0]?.description).toBeNull();
    // Only the versions of the visible rows count towards the registry version.
    expect(result.registryVersion).toBe(9);
  });

  it('hides a deactivated module without asking either port about it', async () => {
    const i18n: AdminI18nTranslatePort = {
      translate: async (moduleId, key) => `${moduleId}/${key}`,
    };
    const permissions: PermissionReadPort = {
      listPermissions: async () => ['*'],
    };

    const service = new AdminActionsService({
      em: emReturning([actionRow(), actionRow({ module_id: 'blog', action_id: 'write' })]),
      i18nService: i18n,
      permissionService: permissions,
      presence: {
        isPlatformAvailable: () => true,
        isActivated: (moduleId) => moduleId !== 'blog',
        version: () => 0,
      },
    });

    const result = await service.listVisibleForOperator({
      language: 'en',
      adminUserId: 'admin-1',
    });
    expect(result.actions.map((a) => a.moduleId)).toEqual(['catalog']);
  });

  it('reconciles from a registry view carrying only manifest id and actions', async () => {
    const upserts: Array<{ moduleId: string; actions: readonly ModuleAction[] }> = [];
    // `execute`, not `getKnex().raw`: issue #200 moved the UPSERT onto the
    // EntityManager so it joins the caller's transaction. A mock that still
    // offers only `getKnex` records nothing and the assertion below reads as a
    // reconcile that skipped the module — which is what it did here for a day.
    const em = (): EntityManager =>
      ({
        execute: async (_sql: string, bindings: unknown[]) => {
          upserts.push({
            moduleId: String(bindings[0]),
            actions: [],
          });
          return [];
        },
        nativeDelete: async () => 0,
      }) as unknown as EntityManager;

    // No dependency graph, no manifest file paths, no install hooks — the whole
    // of what the palette reconcile reads out of the lifecycle registry.
    const registry: AdminActionsManifestRegistryView = {
      modules: {
        values: () => [
          {
            manifest: {
              id: 'catalog',
              actions: [
                {
                  id: 'open',
                  labelKey: 'actions.open.label',
                  icon: 'Package',
                  targetRoute: '/products',
                } as ModuleAction,
              ],
            },
          },
          // A module declaring nothing still gets a prune pass, so a row left
          // by a previous version does not outlive the manifest that declared it.
          { manifest: { id: 'admin_actions' } },
        ],
      },
    };

    const handle = adminActionsModule({
      orm: undefined as never,
      emFactory: em,
      registry,
      i18nService: { translate: async (m, k) => `${m}/${k}` },
      permissionService: { listPermissions: async () => [] },
      requireAdmin: () => async () => undefined,
      resolveAdminContext: () => ({ adminUserId: 'admin-1' }),
      presence: { isPlatformAvailable: () => true, isActivated: () => true, version: () => 0 },
      log: { info: () => {}, warn: () => {} },
    });

    const routes: string[] = [];
    await handle.plugin({
      get: (url: string) => {
        routes.push(url);
      },
    } as unknown as FastifyInstance);

    expect(upserts.map((u) => u.moduleId)).toEqual(['catalog']);
    expect(routes).toEqual(['/api/v1/admin/admin-actions']);
  });
});
