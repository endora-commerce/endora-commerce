import { describe, expect, it } from 'vitest';
import { Organization } from '../../helpers/package-entities.js';
// `ORGANIZATION_STATUSES` is a plain string tuple this module declares beside
// its entity, not an entity class and not a composed singleton, so naming the
// package's source for it is not a `check:singleton-identity` reach — the class
// beside it is taken from the published `entities` array above, which is the
// copy the ORM registered (D-160.6.1).
import { ORGANIZATION_STATUSES } from '../../../../packages/modules/organizations/src/backend/entities/organization.entity.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrganizationReadPort,
  OrganizationSnapshot,
} from '@endora-commerce/platform/kernel';
import { OrganizationContextService } from '../../../../packages/modules/organizations/src/backend/services/organization-context-service.js';
import { organizationStatusSchema } from '@endora-commerce/contracts';

/**
 * The kernel owns the *shape* of the organisation read, not the entity (D-55).
 *
 * `kernel/ports/organizations.ts` used to type all three of its methods with the
 * module-owned `Organization` class, which is what put
 * `@endora-commerce/mod-organizations` in the kernel's package graph. The
 * snapshot replaces it — and the whole claim rests on TypeScript being
 * structural, so the assertion that matters here is a compile-time one:
 * `tsc --noEmit` covers `test/**`, so a service that stops satisfying the port
 * fails the typecheck rather than waiting for a runtime surprise.
 */
describe('OrganizationReadPort as a structural snapshot', () => {
  it('is satisfied by the owning service with no mapping layer', () => {
    const service = new OrganizationContextService(() => ({}) as EntityManager);
    // The load-bearing line: assignability, asserted by the annotation.
    const port: OrganizationReadPort = service;
    expect(port).toBe(service);
  });

  it('is satisfied by the entity the service returns', () => {
    // `classNamed` returns `EntityClass<T>` — `Function & { prototype: T }` —
    // which is not `new`-able through that type. The claim this case makes is a
    // compile-time one, and an object carrying the entity's own prototype is
    // the same shape as one the constructor would have produced.
    const organization = Object.create(Organization.prototype) as Organization;
    organization.id = '00000000-0000-0000-0000-000000000001';
    organization.status = 'active';
    const snapshot: OrganizationSnapshot = organization;
    expect(snapshot.status).toBe('active');
  });

  it('takes its status union from @endora-commerce/contracts, which the entity re-declares identically', () => {
    // D-55 makes the contracts declaration the kernel's. If the entity ever
    // gains a status the contract does not have, the snapshot silently narrows
    // what the port can report — so the two lists are pinned together here.
    expect([...ORGANIZATION_STATUSES].sort()).toEqual([...organizationStatusSchema.options].sort());
  });
});
