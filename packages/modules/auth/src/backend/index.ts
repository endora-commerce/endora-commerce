import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { AuthSessionPort, AuthSessionReadPort } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { AdminPermissionChecker } from '@endora-commerce/platform/kernel';
import { authPlugin } from './plugin.js';
import { createRequireAdmin, createRequireAdminAny } from './require-admin.js';
import { createRequireCustomer } from './require-customer.js';
import { AuthSessionReadService, createAuthSessionPort } from './services/session-port.js';
import { Session } from './entities/session.entity.js';
import { SessionService } from './services/session-service.js';

/**
 * `auth` — the module every other module's guards read (feature 072, T078).
 *
 * Three things about this conversion are not shared with the modules that
 * follow it, and each is a property of what `auth` is rather than of how it was
 * written.
 *
 *  1. **Its plugin goes through `ctx.rootPlugin`, not `ctx.routes`.** It
 *     contributes no routes; it decorates `request.actor`, which every module's
 *     guards read. Both routes seams encapsulate, and a decoration applied
 *     inside a Fastify child context is invisible to that context's siblings —
 *     so registering it through either would leave every module but this one
 *     with no actor.
 *  2. **Its ports are the only ones a disabled `auth` could withdraw, and it
 *     cannot be disabled.** `requireAdmin` gates 205 call sites across 60
 *     modules; a platform whose admin guard is absent has no admin surface to
 *     speak of, so the manifest declares the module non-deactivatable and the
 *     orchestrator refuses to switch it off. The port gate is still registered
 *     rather than skipped: the check that can never fire costs one predicate,
 *     and an exception carved into the port machinery would cost a reader's
 *     confidence in every other gate.
 *  3. **It consumes `permissionService`, which `admin_roles` owns.** The
 *     manifest declares that dependency (D-32); it is the edge that made `auth`
 *     the first module to need `check:port-dependencies` to pass.
 */

/** What `auth` resolves: its own registrations, plus what it needs from elsewhere. */
export interface AuthCradle {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis;
  /** `admin_roles`' permission checker, narrowed to what the guard uses. */
  readonly permissionService: AdminPermissionChecker;
  readonly sessionService: SessionService;
  /**
   * `api_keys`' bearer-token resolver. Registered by the composition root
   * **after** this module composes: `api_keys` provides the port, and the
   * single-pass composition orders it by the manifest graph rather than by
   * this file. It is read per request, so the ordering is invisible here.
   */
  readonly apiKeyResolver:
    | ((token: string) => Promise<{
        apiKeyId: string;
        scopes: string[];
        organizationId?: string | null;
        salesChannelId?: string | null;
        customerAccountId?: string | null;
      } | null>)
    | undefined;
  /** Resolves a customer account to its organisation. Same late-binding story. */
  readonly customerOrgResolver: ((customerAccountId: string) => Promise<string | null>) | undefined;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    sessionService: ctx
      .asFunction(({ emFactory, redis }: AuthCradle) => new SessionService(emFactory, redis))
      .singleton(),
  });

  // `requireAdmin` is the platform's single admin guard and the most-resolved
  // name in the tree. It is a port because it is resolved by 60 other modules;
  // `requireAdminAny` is the same guard with an any-of-these-codes predicate,
  // and lives here for the same reason (`promoteAdminActor` plus a permission
  // check are both this module's business).
  //
  // Both guards read `permissionService` **per check**, not at construction,
  // and that is a correctness requirement rather than a style choice.
  // `permissionService` is a port owned by `admin_roles`, so its resolution is
  // gated on that module's effective state; a guard that captured the instance
  // once would keep answering from it after the module went away, which is the
  // permissive failure the gate exists to prevent. Awilix enforces the same
  // thing from the other side — a singleton may not depend on the transient
  // gate wrapper — so the two agree.
  const permissionChecker = (): AdminPermissionChecker => ({
    hasPermission: (adminUserId, permission) =>
      ctx.cradle<AuthCradle>().permissionService.hasPermission(adminUserId, permission),
  });

  // Feature 075 Phase P — the published session surface. `sessionService` keeps
  // its registration for the four modules Phase C has not rewired yet; these two
  // are what they rewire *to*, and the difference is that neither hands a
  // `Session` entity across the boundary.
  //
  // `providePort` rather than `register`, even though `auth` is
  // non-deactivatable and the gate can therefore never close: this module made
  // that call already for `requireAdmin` (see the note above), and a second
  // answer inside one module would be worse than either answer.
  ctx.di.providePort<AuthSessionPort>(
    'authSessionPort',
    ctx
      .asFunction(({ sessionService }: AuthCradle) => createAuthSessionPort(sessionService))
      .singleton(),
  );

  ctx.di.providePort<AuthSessionReadPort>(
    'authSessionReadPort',
    ctx.asFunction(({ emFactory }: AuthCradle) => new AuthSessionReadService(emFactory)).singleton(),
  );

  ctx.di.providePort(
    'requireAdmin',
    ctx.asFunction(() => createRequireAdmin({ permissionService: permissionChecker() })).singleton(),
  );
  ctx.di.providePort(
    'requireAdminAny',
    ctx
      .asFunction(() => createRequireAdminAny({ permissionService: permissionChecker() }))
      .singleton(),
  );

  // The customer-side twin, and the last guard either composition root still
  // declared for itself (issue #43). Both roots had one — reading different
  // request properties and disagreeing on every request shape — while 16 route
  // surfaces took production's and 11 the harness's. It reads nothing but the
  // actor, so unlike the two above it closes over no collaborator.
  ctx.di.providePort(
    'requireCustomer',
    ctx.asFunction(() => createRequireCustomer()).singleton(),
  );

  ctx.rootPlugin(
    'decorates request.actor and request.adminActor, which every module’s route ' +
      'guards read — a decoration applied inside an encapsulated context would ' +
      'reach none of them',
    async (app) => {
      const cradle = ctx.cradle<AuthCradle>();
      await app.register(authPlugin, {
        sessionService: cradle.sessionService,
        // Read per request, so a resolver the root registers after this module
        // composed is still found. Passing the cradle read rather than the
        // value is what makes the late binding work without a mutable holder.
        //
        // The presence probe is D-44's `degrades-without` guard, and the `?.`
        // beside it does **not** replace it: optional chaining defends against
        // "nobody registered this name", while `apiKeyResolver` is a gated port
        // and a closed gate throws. Without the probe an operator switching
        // `api_keys` off would turn every API-key request into a 503 from the
        // request hook instead of the declared degradation, which is that such
        // a request is simply not authenticated — the same answer a request
        // presenting no key at all gets.
        apiKeyResolver: async (token) => {
          if (!effectiveState.isPresent('api_keys')) return null;
          return (await cradle.apiKeyResolver?.(token)) ?? null;
        },
        customerOrgResolver: async (customerAccountId) =>
          (await cradle.customerOrgResolver?.(customerAccountId)) ?? null,
      });
    },
  );
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
export const entities = [Session];

/**
 * Actor promotion, on the `./backend` subpath because the **composition root**
 * calls it — the MFA actor bridge promotes a partially-authenticated session to
 * an admin actor before asserting it is one.
 *
 * It is published rather than relocated, and the distinction is the whole
 * reason this export exists. `absolutizePublicUrl` moved out of `email` into
 * the platform under the same pressure (T040b, criterion 8) because it had **no
 * consumer inside its own module** — it was a deployment-origin helper filed
 * under the module that first needed it. This one is the opposite: `auth` reads
 * it itself, from `require-admin.ts`, and `@endora-commerce/platform`'s own
 * `kernel/ports/require-admin.ts` states in as many words why the
 * implementation lives here — *"promoting an admin actor needs the auth
 * plugin's per-request decorations"*. A platform copy would reason about
 * `request.actor` and `request.adminActor`, two decorations this module owns
 * and declares.
 *
 * **The root resolving it as a port is a further step this does not take**, and
 * it is written down rather than left implicit: the `auth:promoteAdminActor`
 * entry in `test/contract/kernel/harness-parity.test.ts` records the divergence
 * and names its own drain condition — *"it drains when `auth` provides actor
 * promotion as a port"*. That entry still stands after this change. What the
 * bare specifier buys is only what packaging requires: the root no longer names
 * a file inside this module, so there is one copy of this module in the process
 * (D-160.6.1) instead of two.
 */
export { promoteAdminActor } from './plugin.js';

/**
 * The module's own implementation classes and guard factories, on the
 * `./backend` subpath.
 *
 * They are published for the reason `pim_ergonode` publishes
 * `ErgonodeRequestError`: a consumer that needs the **class** must get the one
 * the platform composed. `SessionService` reaches `Session` and
 * `AuthSessionReadService` reaches it too, so a second copy of either is a
 * second `Session` — a class the ORM never discovered, and `em.find` answers a
 * `MetadataError` rather than rows (D-160.6.1). Publishing them is what lets a
 * consumer name one copy instead of resolving a filesystem path into this
 * package's source.
 *
 * No module reaches any of these; the consumers today are `backend/test/`,
 * which is why they are not on a `./ports` subpath — that one is contract
 * surface (D-171) and these are implementations.
 */
export { SessionService } from './services/session-service.js';
export { AuthSessionReadService, createAuthSessionPort } from './services/session-port.js';
export { createRequireAdmin, createRequireAdminAny } from './require-admin.js';
export { createRequireCustomer } from './require-customer.js';
