import type { EntityManager } from '@mikro-orm/postgresql';
import type { RegisteredManifestEntry } from '../_lifecycle/registered-manifests.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import { AdminRole } from './entities/admin-role.entity.js';
import { AdminRoleService } from './services/admin-role-service.js';
import { PermissionCatalogueService } from './services/permission-catalogue.service.js';
import { PermissionService } from './services/permission-service.js';

/**
 * `admin_roles` — the permission model behind every admin guard (feature 072,
 * wave 1).
 *
 * It owns no routes. Its admin surface is registered by `admin_users`, which is
 * shape D's usual shape seen from the other side: the module that owns the
 * behaviour and the module that owns the URL are different, and only the second
 * one has a `plugin.ts`. Converting it needs no route seam, because there is
 * nothing to gate here — what moves is which composition root constructs the
 * three services, and the answer is now "neither".
 *
 * `permissionService` is the reason this module goes first in wave 1. `auth`
 * resolves it to build `requireAdmin`, and until now both composition roots
 * registered it as a **host value** on `admin_roles`' behalf — a declared edge
 * (D-32) standing in for a registration. That entry leaves
 * `HOST_REGISTERED_PORTS` with this commit.
 *
 * The catalogue takes the **resolved** registry — core manifests plus the
 * active deployment's overlay modules — which is a composition-root input, not
 * something this module can see. It stays a host value for that reason, and the
 * reason is durable rather than temporary: which modules a deployment ships is
 * exactly the kind of thing a module must not decide for itself.
 */

export const entities = [AdminRole];

export interface AdminRolesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  /** Core manifests + this deployment's overlay modules (feature 057). */
  readonly resolvedModuleRegistry: readonly RegisteredManifestEntry[];
  readonly permissionCatalogueService: PermissionCatalogueService;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    permissionCatalogueService: ctx
      .asFunction(
        ({ resolvedModuleRegistry }: AdminRolesCradle) =>
          new PermissionCatalogueService({ registryEntries: [...resolvedModuleRegistry] }),
      )
      .singleton(),

    adminRoleService: ctx
      .asFunction(
        ({ emFactory, permissionCatalogueService, auditLogService }: AdminRolesCradle) =>
          new AdminRoleService(emFactory, permissionCatalogueService, auditLogService),
      )
      .singleton(),
  });

  // A port: `auth` resolves it from another module, so its availability is a
  // cross-module question and answers on the effective state.
  ctx.di.providePort(
    'permissionService',
    ctx.asFunction(({ emFactory }: AdminRolesCradle) => new PermissionService(emFactory)).singleton(),
  );
}
