import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type {
  AdminRolePort,
  AdminUserReadPort,
  ModuleManifest,
  PermissionCataloguePort,
  PermissionReadPort,
  SystemRoleCodePort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import { effectiveState } from '../../kernel/lifecycle/effective-state.js';
import { AdminRoleService } from './services/admin-role-service.js';
import { createAdminRolePort, createSystemRoleCodePort } from './services/admin-role-ports.js';
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

export interface AdminRolesCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditPort;
  /**
   * Core manifests + this deployment's overlay modules (feature 057).
   *
   * Typed by what this module reads rather than by `_lifecycle`'s
   * `RegisteredManifestEntry` (feature 075, Phase C). The entries the root
   * contributes carry a `filePath` and the install hooks as well, and none of
   * that is any of this module's business: the catalogue walks
   * `manifest.permissions` and nothing else, and it already declared that
   * shape for itself.
   */
  readonly resolvedModuleRegistry: ReadonlyArray<{ manifest: ModuleManifest }>;
  readonly permissionCatalogueService: PermissionCatalogueService;
  readonly adminRoleService: AdminRoleService;
  /** Feature 075, Phase P — the deletion-protection contribution seam. */
  readonly systemRoleCodePort: SystemRoleCodePort;
}

export function registerModule(ctx: ModuleContext): void {
  /**
   * Who holds a role, and who an admin id belongs to (feature 075, Phase C).
   *
   * Both services used to run `em.findOne(AdminUser, …)` against a table
   * `admin_users` owns. Held as a lazy proxy rather than resolved here: the
   * resolution happens per call, so a singleton service never captures the
   * registration.
   */
  const adminUsers = lazyPort<AdminUserReadPort>(ctx, 'adminUserReadPort');

  ctx.di.register({
    permissionCatalogueService: ctx
      .asFunction(
        ({ resolvedModuleRegistry }: AdminRolesCradle) =>
          new PermissionCatalogueService({
            registryEntries: [...resolvedModuleRegistry],
            // Issue #213 — the presence predicate is the module's own to read,
            // not a knob a root turns on its behalf. Both roots used to wire
            // `registryCache.enabledIds()` here through a setter, which is
            // composition-checklist item 6's "a knob a root resolves on the
            // module's behalf is a knob that drifts between the two roots" —
            // and it had drifted onto the wrong axis in both copies at once.
            // `effectiveState` is the kernel's one place where the two axes are
            // combined, and reading it directly is what the other twenty
            // modules that need presence already do.
            isModulePresent: (moduleId) => effectiveState.isPresent(moduleId),
          }),
      )
      .singleton(),

    adminRoleService: ctx
      .asFunction(
        ({ emFactory, permissionCatalogueService, auditLogService }: AdminRolesCradle) =>
          new AdminRoleService(
            emFactory,
            permissionCatalogueService,
            adminUsers,
            auditLogService,
          ),
      )
      .singleton(),
  });

  // A port: `auth` resolves it from another module, so its availability is a
  // cross-module question and answers on the effective state.
  ctx.di.providePort<PermissionReadPort>(
    'permissionService',
    ctx
      .asFunction(({ emFactory }: AdminRolesCradle) => new PermissionService(emFactory, adminUsers))
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `adminRoleService` and `permissionCatalogueService` above are plain
  // registrations that three other modules resolve; these three ports are what
  // they rewire to, and `adminRolePort` is the one that stops handing the
  // `AdminRole` entity across.
  //
  // `systemRoleCodePort` is a **contribution seam** and stays one: `blog`
  // registers its seeded code from a boot hook, so a gate would throw during
  // composition — and, worse, would let an operator delete a protected role by
  // switching its owner off for a moment. It is `providePort` all the same
  // because reading the list back is a call rather than a contribution, and
  // the gate is unreachable in the direction that matters: nothing in the tree
  // registers a code after boot.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<AdminRolePort>(
    'adminRolePort',
    ctx
      .asFunction(({ emFactory }: AdminRolesCradle) =>
        createAdminRolePort(emFactory, () => ctx.cradle<AdminRolesCradle>().adminRoleService),
      )
      .singleton(),
  );

  ctx.di.providePort<PermissionCataloguePort>(
    'permissionCataloguePort',
    ctx
      .asFunction(
        ({ permissionCatalogueService }: AdminRolesCradle) => permissionCatalogueService,
      )
      .singleton(),
  );

  ctx.di.register({
    systemRoleCodePort: ctx.asFunction(() => createSystemRoleCodePort()).singleton(),
  });
}
