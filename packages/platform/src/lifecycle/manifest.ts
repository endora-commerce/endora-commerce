import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Bootstrap manifest for the lifecycle subsystem itself. Carries no
 * dependencies and no settings — every other module's manifest is
 * discovered relative to this sentinel entry.
 */
export const manifest = defineModuleManifest({
  id: '_lifecycle',
  name: 'Module Lifecycle',
  description:
    'Platform-internal subsystem that orchestrates install / uninstall / ' +
    'enable / disable / status across every domain module.',
  version: '1.0.0',
  dependencies: [],
  /**
   * The one edge this subsystem resolves and cannot declare (issue #90).
   *
   * Its two admin surfaces — the API-interceptor screen and the module presence
   * projection — are guarded by `auth`'s `requireAdmin` port, exactly as every
   * other admin surface is. `dependencies` is the wrong home for it: that array
   * drives the **install order**, and this is the sentinel manifest every other
   * module's installation is recorded against, so ordering it after `auth` (and
   * transitively `admin_roles`) would have those modules install before the
   * registry that records an installation exists. With `auth` absent the gate
   * refuses and these surfaces answer 503 exactly as every other admin route
   * does — which is what the edge costs, said as a behaviour rather than as a
   * claim about a lock the build re-derives on every run (D-100). It stayed
   * invisible until `check-port-dependencies` learned to follow a module-local
   * cradle alias.
   */
  acknowledgedDependencies: [
    {
      moduleId: 'auth',
      port: 'requireAdmin',
      reason:
        'The lifecycle admin surfaces are guarded by requireAdmin like every other admin ' +
        'surface, but this is the sentinel manifest the install order starts from: declaring ' +
        'auth would install it, and admin_roles, before the registry that records an ' +
        'installation. With auth absent the gate refuses and these surfaces answer 503, ' +
        'exactly as every other admin route does.',
    },
  ],
  /**
   * The live datum on the deactivation-confirmation screen (owner ruling on
   * D-96.5): how many people hold a second factor, read from `mfa` before an
   * operator switches it off.
   *
   * Non-binding, and it has to be: this is the sentinel manifest the install
   * order starts from, and a module that reports on every module's presence may
   * not be made to depend on one of them. `mfa` is the most switchable module
   * in the tree — a client security policy — and the whole point of this read
   * is to inform the flip, not to refuse it.
   *
   * The second edge does refuse, narrowly: `mfaDeactivationGuardPort` answers
   * whether administrators are currently *required* to use a second factor,
   * and while they are the switch-off is refused so that requirement is turned
   * off as its own change. Non-binding for the same reason as the count.
   */
  nonBindingDependencies: [
    {
      moduleId: 'mfa',
      name: 'mfaDeactivationGuardPort',
      kind: 'degrades-without',
      whenAbsent:
        'Nothing is asked: a module that is already off has no administrator requirement left ' +
        'to protect, and switching it back on is never refused.',
      reason:
        'POST /api/v1/admin/modules/:id/activation refuses to switch `mfa` off while ' +
        '`mfa.admin.totp_enforced` is on, so the administrator requirement is withdrawn as its ' +
        'own change rather than as a side effect of the module toggle. The setting is `mfa`\'s, ' +
        'so `mfa` answers through a port; the route asks only while `mfa` is present.',
    },
    {
      moduleId: 'mfa',
      name: 'mfaEnrolmentCountPort',
      kind: 'degrades-without',
      whenAbsent:
        'The deactivation dialog renders every consequence except the number of users who ' +
        'currently hold a second factor, which is shown as unavailable.',
      reason:
        'GET /api/v1/admin/modules/:id/deactivation-impact answers the one question the ' +
        'consequence rows cannot: how many people this flip affects. The count is a read of ' +
        '`mfa_enrolments`, which `mfa` owns, so it arrives through a port and never as a ' +
        'query this module writes. The route decides `mfa`\'s presence before it resolves ' +
        'anything — an already-off module has no dialog to render — and a read that fails ' +
        'answers `null` rather than blocking the operator, because a number that could not ' +
        'be fetched is not a reason to refuse a deactivation.',
    },
  ],
  // Feature 074 (Constitution XVII), test C1 — reachability. The ground is the
  // presence machinery itself: this module resolves every other module's two
  // axes, owns the orchestrator that flips them and the Command the activation
  // endpoint runs, so switched off there is no way back on for anything,
  // including itself. That is a statement about what this module *is*, not
  // about the screen it once hosted — D-36 moved the activation surface to
  // `/platform/modules`, which belongs to no module, and the old circular
  // argument went with it. The `_`-prefix rule is the structural second
  // ground: `assertActivationRules` (`packages/contracts/src/modules.ts`)
  // refuses any other activation form for a platform-internal id. The route
  // exemption (`ctx.ungatedRoutes`, T125) is a separate mechanism and is not
  // what this declaration rests on.
  activation: {
    nonDeactivatable: true,
    reason:
      'Owns the presence machinery and the activation switches themselves; switched off, ' +
      'there is no way back on.',
  },
  i18n: { bundlesDir: 'i18n' },
  /**
   * Principle XVI. The screen that says what this deployment offers and what
   * the business has switched on is reachable from ⌘K, not only from a nav
   * entry buried under System — it is the surface an operator goes looking for
   * precisely when something is missing and they cannot find the sidebar item
   * for it, because the module owning it is off.
   *
   * One action, deliberately: the write is a per-module flip with no route of
   * its own, so a palette entry per module would be a route dump.
   */
  actions: [
    {
      id: 'open-platform-modules',
      labelKey: 'actions.openPlatformModules.label',
      descriptionKey: 'actions.openPlatformModules.description',
      icon: 'Boxes',
      targetRoute: '/platform/modules',
      requiredPermission: 'platform.modules.read',
      keywords: ['modules', 'enable', 'disable', 'platform'],
      keywordsKey: 'actions.openPlatformModules.keywords',
      weight: 300,
    },
    /**
     * The API description screen. Kernel-served like `/platform/modules`: the
     * document describes every module's routes, so no module owns it. Gated on
     * the code its backing route `GET /api/v1/admin/api-description` enforces.
     */
    {
      id: 'open-api-description',
      labelKey: 'actions.openApiDescription.label',
      descriptionKey: 'actions.openApiDescription.description',
      icon: 'BookOpen',
      targetRoute: '/api-description',
      requiredPermission: 'platform.api_description.read',
      keywords: ['api', 'openapi', 'swagger', 'docs', 'integration'],
      keywordsKey: 'actions.openApiDescription.keywords',
      weight: 310,
    },
  ],
  permissions: [
    {
      code: 'platform.modules.read',
      module: 'module_lifecycle',
      label: 'View module lifecycle status',
    },
    {
      code: 'platform.modules.activate',
      module: 'module_lifecycle',
      label: 'Switch modules on and off',
    },
    /**
     * Read the API description — the OpenAPI document and its interactive
     * reference (`http/api-description.ts`). Declared here because this is
     * the manifest of the platform's own surfaces; the routes are kernel
     * resident and mounted from this module. An API key carries it as a scope,
     * held like every scope to the issuing administrator's own role.
     */
    {
      code: 'platform.api_description.read',
      module: 'platform',
      label: 'Read the API description',
    },
  ],
});
