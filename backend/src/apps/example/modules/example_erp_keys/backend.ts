import type { EntityManager } from '@mikro-orm/postgresql';
import { ORGANIZATION_HOOKABLE_ACTIONS, type OrganizationDetailsPort } from '@endora-commerce/contracts';
import { lazyPort, type ModuleContext, type RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { z } from 'zod';

import { ExampleErpOrganizationKey } from './entities/example-erp-organization-key.entity.js';
import { fillErpKeyOnCreate } from './hooks/fill-erp-key.js';
import { EXAMPLE_ERP_KEYS_HOST, EXAMPLE_ERP_KEYS_PERMISSION } from './manifest.js';
import { ExampleErpKeyExtensionSchema, type ExampleErpKeysPort } from './ports.js';
import {
  ERP_KEY_LIST_DEFAULT_LIMIT,
  ERP_KEY_LIST_LIMIT,
  ExampleErpKeysService,
  listErpKeys,
  loadErpKeys,
} from './services/erp-keys.js';

/**
 * Every entity this module owns — what the platform's ORM configuration
 * registers for it (`specs/190-overlay-full-modules/contracts/overlay-schema-discovery.md` §1).
 */
export const entities = [ExampleErpOrganizationKey];

/** The admin list, and the API the palette action and the screen open. */
export const EXAMPLE_ERP_KEYS_ROUTE = '/api/v1/admin/example-erp-keys/keys';

const ListQuerySchema = z.object({
  erpKey: z.string().max(80).optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().positive().max(ERP_KEY_LIST_LIMIT).default(ERP_KEY_LIST_DEFAULT_LIMIT),
});

interface ExampleErpKeysCradle {
  readonly requireAdmin: RequireAdminFactory;
  readonly emFactory: () => EntityManager;
}

/**
 * The module's composition — one call per seam, each the documented one
 * (`specs/conventions/module-composition.md`):
 *
 *  1. `ctx.di.providePort` — `exampleErpKeysPort`, gated on this module's
 *     presence, its types in `ports.ts`;
 *  2. `ctx.commandHooks` — the `beforeCommit` hook on `organization.create`,
 *     against the ref `organizations` publishes, so nothing of `organizations`
 *     is imported;
 *  3. `ctx.entityExtensionLoaders` — the loader behind
 *     `include: ['extensions.example_erp_keys']` on `organizations.Organization`,
 *     the host the manifest `extends`;
 *  4. `ctx.routes` — the one gated admin read, under the lifecycle gate.
 */
export function registerModule(ctx: ModuleContext): void {
  const cradle = (): ExampleErpKeysCradle => ctx.cradle<ExampleErpKeysCradle>();
  // Consumed from `organizations` through its published port, resolved per call.
  const organizations = lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort');

  ctx.di.providePort<ExampleErpKeysPort>(
    'exampleErpKeysPort',
    ctx.asFunction(({ emFactory }: ExampleErpKeysCradle) => new ExampleErpKeysService(emFactory)).singleton(),
  );

  ctx.commandHooks([
    {
      id: 'fill-erp-key',
      on: ORGANIZATION_HOOKABLE_ACTIONS.create,
      phase: 'beforeCommit',
      handler: fillErpKeyOnCreate,
    },
  ]);

  ctx.entityExtensionLoaders([{ host: EXAMPLE_ERP_KEYS_HOST, schema: ExampleErpKeyExtensionSchema, load: loadErpKeys }]);

  ctx.routes(async (app) => {
    app.get(
      EXAMPLE_ERP_KEYS_ROUTE,
      { preHandler: cradle().requireAdmin(EXAMPLE_ERP_KEYS_PERMISSION) },
      async (request) => {
        const query = ListQuerySchema.parse(request.query);
        return listErpKeys(cradle().emFactory(), organizations, query);
      },
    );
  });
}
