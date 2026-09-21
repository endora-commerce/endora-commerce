import { describe, expect, it } from 'vitest';
import type { EventArgs } from '@mikro-orm/core';
import { GlobalEntity, OrgScoped, tenantClassifications } from './org-scoped.decorator.js';
import { OrgWriteGuardSubscriber } from './org-write-guard.js';
import {
  MissingTenantContextError,
  OrgWriteOutOfScopeError,
  runWithTenantContext,
  runWithoutTenantContext,
  type TenantContext,
} from './tenant-context.js';

/**
 * D-260/A — the arms of the write guard, one at a time.
 *
 * `backend/test/integration/tenancy/org-scoped-write-refusal.test.ts` is the
 * proof: a real route, a real scoped session, a real flush, and it was red
 * before this subscriber existed. This file is not that and does not pretend to
 * be — it characterises the arms that proof cannot reach without a fixture per
 * arm: the permissive `null` arm, the class filter, and the four context modes.
 * Each of those is a decision written down in `org-write-guard.ts`, and a
 * decision with no test is a decision the next author re-takes by accident.
 *
 * **Every case establishes its own context.** `vitest.setup.ts` enters
 * `mode: 'system'` in a global `beforeAll` *and* `beforeEach`, under which
 * `isOrgInScope` answers `true` for everything — so a case that did not open its
 * own context would pass whatever the subscriber did.
 *
 * It enters fixtures **at the decorator**, like `transitive-parent-resolution.test.ts`:
 * the subscribed set is the registry the decorators wrote, so a fixture built as
 * a `ClassificationMeta` literal would prove nothing about what subscribes.
 */

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';

@OrgScoped()
class GuardedRow {
  organizationId!: string | null;
}

/**
 * Correctly `@GlobalEntity` and carrying an organization column anyway — the
 * real shape of `Webhook`, `Promotion`, `MfaOrganizationPolicy` and
 * `OrganizationSalesRepAssignment`, every one of them D-260/**B**'s territory.
 * The guard must leave all four alone whatever its subscription happens to be.
 */
@GlobalEntity()
class GlobalRowWithAnOrganizationColumn {
  organizationId!: string;
}

const scopedTo = (...organizationIds: string[]): TenantContext => ({
  mode: 'allowed-set',
  allowedOrganizationIds: organizationIds,
  actor: { kind: 'admin', id: 'd260a-unit' },
});

const pinnedTo = (organizationId: string): TenantContext => ({
  mode: 'single-org',
  organizationId,
  actor: { kind: 'customer', id: 'd260a-unit' },
});

/**
 * What MikroORM hands a subscriber, cut down to the two fields the guard reads.
 *
 * `meta.className` is what the dispatcher matched on, so it is supplied here
 * rather than left to `entity.constructor.name`; the guard falls back to the
 * constructor and the fallback has its own case below.
 */
const eventFor = (entity: object, className?: string): EventArgs<object> =>
  ({
    entity,
    ...(className === undefined ? {} : { meta: { className } }),
  }) as unknown as EventArgs<object>;

describe('OrgWriteGuardSubscriber — what it subscribes to', () => {
  it('subscribes to exactly the `scope === \'org\'` classifications', () => {
    const expected = tenantClassifications()
      .filter((meta) => meta.scope === 'org')
      .map((meta) => meta.target);
    expect(new OrgWriteGuardSubscriber().getSubscribedEntities()).toEqual(expected);
  });

  it('subscribes to a non-empty set, so MikroORM never reads it as “every entity”', () => {
    // `EventManager.dispatchEvent` treats an empty subscribed set as *all*
    // entities, which would put the guard on `@GlobalEntity` classes carrying an
    // organization column. The `GuardedRow` fixture above guarantees one member;
    // in a real composition the payment gateways and `Order` guarantee more.
    expect(new OrgWriteGuardSubscriber().getSubscribedEntities().length).toBeGreaterThan(0);
  });
});

describe('OrgWriteGuardSubscriber — which writes it refuses', () => {
  const guard = new OrgWriteGuardSubscriber();
  const row = (organizationId: string | null): GuardedRow =>
    Object.assign(new GuardedRow(), { organizationId });

  it('refuses a create whose organization is outside an `allowed-set` scope', async () => {
    await runWithTenantContext(scopedTo(ORG_A), async () => {
      expect(() => guard.beforeCreate(eventFor(row(ORG_B), 'GuardedRow'))).toThrow(
        OrgWriteOutOfScopeError,
      );
    });
  });

  it('refuses an update whose organization is outside it — the cross-organization move', async () => {
    await runWithTenantContext(scopedTo(ORG_A), async () => {
      expect(() => guard.beforeUpdate(eventFor(row(ORG_B), 'GuardedRow'))).toThrow(
        OrgWriteOutOfScopeError,
      );
    });
  });

  it('names the entity and never the organization, in the message or on the error', async () => {
    await runWithTenantContext(scopedTo(ORG_A), async () => {
      try {
        guard.beforeCreate(eventFor(row(ORG_B), 'GuardedRow'));
        expect.unreachable('the guard must refuse');
      } catch (error) {
        expect(error).toBeInstanceOf(OrgWriteOutOfScopeError);
        const refusal = error as OrgWriteOutOfScopeError;
        expect(refusal.entityName).toBe('GuardedRow');
        expect(refusal.message).toContain('GuardedRow');
        expect(refusal.message).not.toContain(ORG_A);
        expect(refusal.message).not.toContain(ORG_B);
      }
    });
  });

  it('refuses a create outside a `single-org` scope and permits the one inside it', async () => {
    await runWithTenantContext(pinnedTo(ORG_A), async () => {
      expect(() => guard.beforeCreate(eventFor(row(ORG_B), 'GuardedRow'))).toThrow(
        OrgWriteOutOfScopeError,
      );
      expect(() => guard.beforeCreate(eventFor(row(ORG_A), 'GuardedRow'))).not.toThrow();
    });
  });

  it('permits any organization under `all` and under `system` [the widening must not be lost]', async () => {
    for (const ctx of [
      { mode: 'all', actor: { kind: 'admin' as const, id: 'd260a-unit' } } as TenantContext,
      { mode: 'system', actor: { kind: 'system' as const }, reason: 'd260a-unit' } as TenantContext,
    ]) {
      await runWithTenantContext(ctx, async () => {
        expect(() => guard.beforeCreate(eventFor(row(ORG_B), 'GuardedRow'))).not.toThrow();
      });
    }
  });

  it('fails closed with `MissingTenantContextError` when no context is established', () => {
    // The same answer a *read* of the same class gets (`filters.ts`), and
    // deliberately not a second arm here that would decide how much of the
    // fail-closed guarantee to keep.
    runWithoutTenantContext(() => {
      expect(() => guard.beforeCreate(eventFor(row(ORG_B), 'GuardedRow'))).toThrow(
        MissingTenantContextError,
      );
    });
  });
});

describe('OrgWriteGuardSubscriber — what it deliberately leaves alone', () => {
  const guard = new OrgWriteGuardSubscriber();

  it('does not refuse a null or absent organization [D-259’s open question, not this guard’s]', async () => {
    await runWithTenantContext(scopedTo(ORG_A), async () => {
      const nulled = Object.assign(new GuardedRow(), { organizationId: null });
      expect(() => guard.beforeCreate(eventFor(nulled, 'GuardedRow'))).not.toThrow();
      expect(() => guard.beforeCreate(eventFor(new GuardedRow(), 'GuardedRow'))).not.toThrow();
    });
  });

  it('does not refuse a `@GlobalEntity` that carries an organization column', async () => {
    // The class check is the boundary and the subscription is only a narrowing
    // for cost, so this holds even when the event arrives for a class the
    // subscribed set never named.
    await runWithTenantContext(scopedTo(ORG_A), async () => {
      const global = Object.assign(new GlobalRowWithAnOrganizationColumn(), {
        organizationId: ORG_B,
      });
      expect(() =>
        guard.beforeCreate(eventFor(global, 'GlobalRowWithAnOrganizationColumn')),
      ).not.toThrow();
    });
  });

  it('falls back to the constructor name when the event carries no metadata', async () => {
    await runWithTenantContext(scopedTo(ORG_A), async () => {
      const guarded = Object.assign(new GuardedRow(), { organizationId: ORG_B });
      expect(() => guard.beforeCreate(eventFor(guarded))).toThrow(OrgWriteOutOfScopeError);
    });
  });
});
