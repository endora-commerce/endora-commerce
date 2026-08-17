import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '../../commands/index.js';
import type { CredentialsPort } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { registerCredentialsAdminRoutes } from './routes.admin.js';
import type { ConfigurationTypeRegistry } from './services/configuration-type-registry.js';
import { configurationTypeRegistry } from './services/registry-singleton.js';
import { llmConfigurationType } from './types/llm.type.js';
import { emailAdapterConfigurationType } from './types/email-adapter.type.js';
import {
  CredentialsService,
  type CredentialsSettingsPort,
} from './services/credentials.service.js';

/**
 * `credentials` — the module three others read secrets through (feature 072,
 * wave 1).
 *
 * `search`, `newsletter` and `prompt_actions` resolve `credentialsService` for
 * the `credential_ref` path, so it is a **port**: a module reaching for a
 * decrypted secret while `credentials` is absent gets an explicit 503 rather
 * than a service that half-answers.
 *
 * One input stays with the composition root: **`adminContextResolver`** answers
 * "who is this admin", which production and the harness resolve differently.
 * That difference is exactly what the root exists to hold.
 *
 * The secret key is read from the environment here rather than threaded
 * through two roots: it is configuration, and both roots were passing the same
 * `process.env` lookup through identical spread expressions.
 *
 * **`configurationTypeRegistry` came home in T143a.** Both roots registered the
 * name — importing this module's singleton to do it — and then pushed four
 * descriptors into it, two of which are this module's own. Which configuration
 * types exist is decided by which modules a deployment ships, but that is a
 * statement about the *contributors*, not about the registry: each of them
 * declares its own type from its own boot hook now, and the registry is
 * declared here, by the module that owns the class.
 *
 * It is `ctx.di.register` rather than `ctx.di.providePort`, deliberately. A
 * gated port throws `MODULE_DISABLED` on resolution, and the two other
 * contributors resolve this name from `ctx.onBoot` — so gating it would turn
 * "an operator switched `credentials` off" into "the platform does not boot".
 * Nothing leaks by leaving it ungated: a descriptor is inert data, and the
 * service that reads secrets out of it (`credentialsService`) is a port and
 * does fail closed.
 *
 * The instance stays the process-wide singleton rather than becoming one per
 * composition, because it is the documented extension seam an external or
 * overlay module reaches through from an install hook, where no container is
 * available (see `services/registry-singleton.ts`, and
 * `test/integration/credentials/registry-extensibility.test.ts`, which is that
 * path under test).
 */

export interface CredentialsCradle {
  readonly emFactory: () => EntityManager;
  readonly commandBus: CommandBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly configurationTypeRegistry: ConfigurationTypeRegistry;
  readonly credentialsSettingsPort: CredentialsSettingsPort | undefined;
  readonly adminContextResolver: (req: FastifyRequest) => { adminUserId: string };
  readonly credentialsService: CredentialsService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    configurationTypeRegistry: ctx
      .asFunction((): ConfigurationTypeRegistry => configurationTypeRegistry)
      .singleton(),
  });

  ctx.di.providePort<CredentialsPort>(
    'credentialsService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CredentialsCradle) => {
          const key = process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
          // Read at construction, and that is a real constraint rather than an
          // oversight — see `ALLOWED_CAPTURES` in check-port-dependencies.ts.
          // A presence test cannot be deferred: `lazyPort` would hand back a
          // proxy that is always defined, so the "omit the property" branch
          // below could never be taken. Both roots register this port two lines
          // before they resolve `credentialsService`, and that ordering is what
          // makes the read work. It stops being load-bearing when `settings`
          // converts and provides the port itself.
          const settings = ctx.cradle<CredentialsCradle>().credentialsSettingsPort;
          // Spread-built so an absent key or port is an **omitted** property
          // rather than an explicit `undefined`, which `exactOptionalPropertyTypes`
          // treats as a different thing.
          return new CredentialsService({
            emFactory,
            commandBus,
            registry: lazyPort<ConfigurationTypeRegistry>(ctx, 'configurationTypeRegistry'),
            ...(key === undefined ? {} : { secretEncryptionKey: key }),
            ...(settings === undefined ? {} : { settings }),
          } as ConstructorParameters<typeof CredentialsService>[0]);
        },
      )
      .singleton(),
  );

  /**
   * This module's own two configuration types (T143a).
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* — by the
   * type catalogue endpoint and by every credential write — and a registration
   * declares without resolving. Boot hooks run once every module has
   * registered and before any request is served, so a type is in the catalogue
   * from the first one.
   */
  ctx.onBoot(() => {
    const registry = lazyPort<ConfigurationTypeRegistry>(ctx, 'configurationTypeRegistry');
    registry.register(llmConfigurationType);
    registry.register(emailAdapterConfigurationType);
  });

  ctx.routes(async (app) => {
    const { requireAdmin, adminContextResolver } = ctx.cradle<CredentialsCradle>();
    await registerCredentialsAdminRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40). The construction-time read of
      // `credentialsSettingsPort` above is a different thing and stays.
      service: lazyPort<CredentialsService>(ctx, 'credentialsService'),
      requireAdmin,
      resolveAdminContext: adminContextResolver,
    });
  });
}
