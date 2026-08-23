import { getTenantContext, MissingTenantContextError, type TenantContext } from '../tenancy/index.js';
import type { CommandActor } from './command.js';

/**
 * Derive a {@link CommandActor} from the ambient TenantContext (feature 050).
 *
 * The actor is ALWAYS server-derived — a Command never accepts an actor from a
 * request body (Constitution Principle XI/XIII). Mapping:
 *  - impersonation present → real admin id + impersonated customer id;
 *  - admin actor           → admin id;
 *  - system actor          → null admin id (worker/escape-hatch);
 *  - customer (no impersonation) → null admin id (a customer acting on their own).
 *
 * Fail-closed: with no ambient context this throws {@link MissingTenantContextError},
 * so a Command can never run unscoped.
 */
export function resolveCommandActor(): CommandActor {
  const ctx = getTenantContext();
  if (!ctx) {
    throw new MissingTenantContextError('CommandBus.run requires an ambient TenantContext');
  }
  return actorFromContext(ctx);
}

/** Pure mapping, split out so it is trivially unit-testable without ALS. */
export function actorFromContext(ctx: TenantContext): CommandActor {
  if (ctx.impersonation) {
    return {
      actorAdminUserId: ctx.impersonation.realAdminUserId,
      impersonatedCustomerAccountId: ctx.impersonation.impersonatedCustomerAccountId,
      kind: ctx.actor.kind,
    };
  }
  if (ctx.actor.kind === 'admin') {
    return {
      actorAdminUserId: ctx.actor.id ?? null,
      impersonatedCustomerAccountId: null,
      kind: 'admin',
    };
  }
  // system or plain customer — no acting admin id.
  return {
    actorAdminUserId: null,
    impersonatedCustomerAccountId: null,
    kind: ctx.actor.kind,
  };
}
