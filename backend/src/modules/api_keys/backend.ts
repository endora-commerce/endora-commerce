import type { EntityManager } from '@mikro-orm/postgresql';
import type { CustomerAccountReadPort, OrganizationDetailsPort } from '@endora-commerce/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { ApiKeyService } from './services/api-key-service.js';
import { integrationsModule } from './plugin.js';

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
