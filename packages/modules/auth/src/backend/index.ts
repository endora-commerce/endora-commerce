import type { EntityManager } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import type { AuthSessionPort, AuthSessionReadPort } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { effectiveState } from '@endora-commerce/platform/kernel';
import type { AdminPermissionChecker } from '@endora-commerce/platform/kernel';
import { authPlugin, promoteAdminActor } from './plugin.js';
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

  // The promotion the two admin guards above already perform, published under
  // its own name (`specs/117-instance-bring-up/` FR-030). It is not a third
  // guard: it decides nothing and refuses nobody, it moves `request.adminActor`
  // into `request.actor` so that an admin route works on a request that also
  // carries a customer session.
  //
  // It is a port for one consumer — the production composition root, which
  // calls it inside the actor bridge it contributes to `mfa`. That root is
  // moving into `@endora-commerce/platform` (`specs/110-instance-repository/`
  // T118), and a platform file may not import a module (D-52, D-53), so the
  // function's *exported* spelling stops being available to it while the
  // container name survives the move. This is the drain condition the barrel
  // below and `test/contract/kernel/harness-parity.test.ts` both named.
  //
  // `providePort` like its four neighbours, on the same reasoning: the gate can
  // never close, because `auth` is non-deactivatable, and a second answer
  // inside one module would be worse than either answer. No type argument, for
  // symmetry with the two guards above — the shape is
  // `AdminActorPromotion` in the platform's `kernel/ports/require-admin.ts`,
  // deliberately off the `./kernel` barrel because no module resolves it.
  ctx.di.providePort(
    'promoteAdminActor',
    ctx.asFunction(() => promoteAdminActor).singleton(),
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

/*
 * **Actor promotion is no longer on this subpath**, and the deletion is the
 * point rather than a tidy-up (`specs/117-instance-bring-up/` FR-030).
 *
 * `promoteAdminActor` was exported here for exactly one consumer, the
 * production composition root, which calls it inside the actor bridge it
 * contributes to `mfa`. The export said in its own words that it was published
 * *"rather than relocated"* — correctly, because `auth` reads the function
 * itself from `require-admin.ts` and promotion is about `request.actor` and
 * `request.adminActor`, two decorations this module owns; `absolutizePublicUrl`
 * could move to the platform (T040b, criterion 8) precisely because it had no
 * consumer inside `email` and this one does. That reasoning is unchanged.
 *
 * What changed is the consumer. `specs/110-instance-repository/` T118 moves
 * that root into `@endora-commerce/platform`, where importing a module is
 * D-52/D-53's refusal — so the root's spelling had to stop being an import, and
 * a value import does not retire by moving a type. It resolves the container
 * name `promoteAdminActor` instead, which is the **further step** the old block
 * here recorded as open and which `test/contract/kernel/harness-parity.test.ts`
 * named as its drain condition: *"actor promotion published as a port, resolved
 * from the container"*.
 *
 * The export is removed rather than left beside the registration, because two
 * spellings of one seam is how a root comes to take the one that does not
 * survive the move — and this file is where a future author would look for
 * permission. The registration is above, in `registerModule`; the shape is
 * `AdminActorPromotion` in the platform's `kernel/ports/require-admin.ts`.
 */

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
/**
 * What `request.actor` **is** — and it is no longer this package's to say
 * (`specs/110-instance-repository/` T118b).
 *
 * `plugin.ts` used to declare the four actor kinds and a
 * `declare module 'fastify'` block adding `actor` and `adminActor` to
 * `FastifyRequest`, and this barrel re-exported the five type names.
 * `specs/117-instance-bring-up/` FR-030 published them for a real reason: an
 * ambient augmentation reaches a consumer's program only if the file declaring
 * it is *in* that program, and the production composition root was getting it
 * incidentally through a **value** import of `promoteAdminActor`. Retiring that
 * import took the augmentation with it and thirty reads of `request.actor`
 * stopped compiling.
 *
 * The block said relocating the augmentation *"would take `Session` with it"*.
 * That premise was false and is what T118b measured: across `packages/`,
 * `backend/`, `admin/` and `storefront/`, `actor.session` was read in **zero**
 * files outside this package. So the vocabulary is
 * `@endora-commerce/contracts`' {@link Actor} — session-free, importing neither
 * Fastify nor the ORM — and the augmentation is the platform's, on
 * `@endora-commerce/platform/http`. A consumer names one of those two; neither
 * is a boundary reach, and no consumer needs a type-only import of a module any
 * more.
 *
 * The five names are **not** re-exported from here. A re-export of a
 * `@endora-commerce/contracts` type on this package's `./backend` barrel is
 * what `module-package-entity-surface.test.ts` refuses under D-168: it cannot
 * follow the specifier, so whether a named entity class comes through it is
 * unknown rather than false. That is the same rule that stopped this file
 * re-exporting the two cookie names when the package landed.
 */

export { SessionService } from './services/session-service.js';
export { AuthSessionReadService, createAuthSessionPort } from './services/session-port.js';
export { createRequireAdmin, createRequireAdminAny } from './require-admin.js';
export { createRequireCustomer } from './require-customer.js';
