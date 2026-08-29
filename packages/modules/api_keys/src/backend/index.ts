import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, OrganizationDetailsPort } from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import type { ApiKeyService } from './services/api-key-service.js';
import { integrationsModule } from './plugin.js';
import { ApiKey } from './entities/api-key.entity.js';

/**
 * `api_keys` — the module `auth` reads at every request (feature 072, wave 2,
 * T100).
 *
 * The task note asks for one thing specifically: this module is composed
 * **first** in production so its authenticator reaches the auth plugin, and
 * that ordering has to survive the conversion. It does, by a different
 * mechanism than a line position. `auth` resolves `apiKeyResolver` from the
 * cradle *inside its request hook*, so what matters is that the name is
 * registered before a request arrives, not before `auth` composes — and every
 * module registers before the first route is even attached, so it is true by
 * construction rather than by a comment asking the next editor not to move a
 * `const`. (This module used to carry an `EARLY_PASS_MODULE_IDS` entry saying
 * so; D-45 deleted the list, and nothing about the guarantee moved.)
 *
 * `apiKeyResolver` becomes a port this module provides, and its
 * `HOST_REGISTERED_PORTS` entry goes — the third such entry retired, after
 * `dictionaries` took back two. What a root used to register on this module's
 * behalf was a one-line closure over `apiKeyService.authenticate`; the module
 * can say that itself.
 *
 * `requireApiKey` and `requireBoundApiKey` are ports too. `catalog`'s external
 * namespace is gated by both, across a module boundary, and an operator
 * switching API keys off should get the explicit 503 rather than a gate that
 * quietly stops asserting anything.
 *
 * `auditLogService` stops being optional. It is the sink for the audited 403s
 * these gates emit — `api_key.out_of_scope` and `api_key.not_bound` — so an
 * absent one means the denials happen and nothing records them, which is the
 * worst version of an audit trail: present enough to be trusted, incomplete
 * enough to mislead.
 */

export interface ApiKeysCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  /**
   * Who the acting admin is, from the production actor (feature 080, T051).
   * Root-supplied, like the other request resolvers; both roots answer it from
   * `request.actor` and throw 401 for a non-admin.
   */
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly apiKeys: ReturnType<typeof integrationsModule>;
  readonly apiKeyService: ApiKeyService;
  readonly requireApiKey: ReturnType<typeof integrationsModule>['handle']['requireApiKey'];
  readonly requireBoundApiKey: ReturnType<
    typeof integrationsModule
  >['handle']['requireBoundApiKey'];
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // One registration holds the whole graph: the two gates close over the
    // same `resolveScopedKey`, so building them separately would mean two
    // authenticators disagreeing about what a scope means.
    apiKeys: ctx
      .asFunction(
        ({ emFactory, auditLogService }: ApiKeysCradle) =>
          integrationsModule({
            emFactory,
            auditLogService,
            // Resolved per check rather than captured: `requireAdmin` is a
            // transient port gate, and a captured one keeps admitting requests
            // after `auth` is switched off.
            requireAdmin: (permission) => async (req, reply) =>
              ctx.cradle<ApiKeysCradle>().requireAdmin(permission)(req, reply),
            resolveAdminUserId: (request) =>
              ctx.cradle<ApiKeysCradle>().adminContextResolver(request).adminUserId,
            // Feature 075 (D-87) — the two owners the binding rules ask about.
            // Both were `em.getKnex().raw('select … from "organizations"')` and
            // `… from "customer_accounts"` inside the service: raw SQL naming
            // no specifier, so the boundary compiled and returned rows. Gated
            // ports, so a singleton may not hold one directly.
            bindingPorts: {
              organizations: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
              customerAccounts: lazyPort<CustomerAccountReadPort>(
                ctx,
                'customerAccountReadPort',
              ),
            },
          }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'apiKeyService',
    ctx.asFunction(({ apiKeys }: ApiKeysCradle) => apiKeys.handle.apiKeyService).singleton(),
  );

  ctx.di.providePort(
    'requireApiKey',
    ctx.asFunction(({ apiKeys }: ApiKeysCradle) => apiKeys.handle.requireApiKey).singleton(),
  );

  ctx.di.providePort(
    'requireBoundApiKey',
    ctx.asFunction(({ apiKeys }: ApiKeysCradle) => apiKeys.handle.requireBoundApiKey).singleton(),
  );

  ctx.di.providePort(
    'apiKeyResolver',
    ctx
      .asFunction(
        ({ apiKeys }: ApiKeysCradle) =>
          async (token: string) =>
            apiKeys.handle.apiKeyService.authenticate(token),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    // The factory's own plugin, not a re-registration: it mounts the admin
    // routes and nothing else, and duplicating that here would be a second
    // place to keep in step.
    await ctx.cradle<ApiKeysCradle>().apiKeys.plugin(app);
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  ApiKey,
];
