import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { CommandBus } from '../../commands/index.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { CredentialConfiguration } from './entities/credential-configuration.entity.js';
import { registerCredentialsAdminRoutes } from './routes.admin.js';
import type { ConfigurationTypeRegistry } from './services/configuration-type-registry.js';
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
 * Two inputs stay with the composition root, and both for the same reason —
 * they are properties of the deployment rather than of this module:
 *
 *  - **`configurationTypeRegistry`** is the process-wide cross-module seam.
 *    Which configuration types exist is decided by which modules a deployment
 *    ships, so the registry is created and populated by the root; this module
 *    reads it.
 *  - **`adminContextResolver`** answers "who is this admin", which production
 *    and the harness resolve differently. That difference is exactly what the
 *    root exists to hold.
 *
 * The secret key is read from the environment here rather than threaded
 * through two roots: it is configuration, and both roots were passing the same
 * `process.env` lookup through identical spread expressions.
 */

export const entities = [CredentialConfiguration];

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
  ctx.di.providePort(
    'credentialsService',
    ctx
      .asFunction(
        ({ emFactory, commandBus }: CredentialsCradle) => {
          const key = process.env['SETTINGS_SECRET_ENCRYPTION_KEY'];
          // Read from the cradle rather than destructured, so a root that
          // registers the settings port after this module composed is still
          // seen — `settings` is not converted yet.
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

  ctx.routes(async (app) => {
    const { credentialsService, requireAdmin, adminContextResolver } =
      ctx.cradle<CredentialsCradle>();
    await registerCredentialsAdminRoutes(app, {
      service: credentialsService,
      requireAdmin,
      resolveAdminContext: adminContextResolver,
    });
  });
}
