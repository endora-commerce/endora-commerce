import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  OrganizationReadPort,
  OrganizationSnapshot,
} from '../../../src/kernel/ports/organizations.js';
import { OrganizationContextService } from '../../../src/modules/organizations/services/organization-context-service.js';
import { Organization } from '../../../src/modules/organizations/entities/organization.entity.js';
import { organizationStatusSchema } from '@endora-commerce/contracts';
import { ORGANIZATION_STATUSES } from '../../../src/modules/organizations/entities/organization.entity.js';

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
    const organization = new Organization();
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
