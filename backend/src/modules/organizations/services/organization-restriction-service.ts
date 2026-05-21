import type { EntityManager } from '@mikro-orm/postgresql';
import { OptimisticLockError } from '@mikro-orm/core';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationPaymentMethodLink } from '../entities/organization-payment-method-link.entity.js';
import { OrganizationDeliveryMethodLink } from '../entities/organization-delivery-method-link.entity.js';
import { OrganizationWarehouseLink } from '../entities/organization-warehouse-link.entity.js';

export interface AllowLists {
  paymentMethodIds: string[];
  deliveryMethodIds: string[];
  warehouseIds: string[];
}

export interface AllowListsRead extends AllowLists {
  organizationId: string;
  /** Organization's optimistic-lock version after the read. Pass this on the next write. */
  version: number;
}

export interface ReplaceAllowListsInput extends AllowLists {
  expectedVersion: number;
}

export type RestrictionKind = 'payment_method' | 'delivery_method' | 'warehouse';

export interface PatchAllowListInput {
  expectedVersion: number;
  add?: string[];
  remove?: string[];
}

/**
 * Owns the three per-Organization allow-list bridges:
 *  - `organization_payment_methods`
 *  - `organization_delivery_methods`
 *  - `organization_warehouses`
 *
 * Empty allow-list ⇒ "platform defaults apply" (FR-014 / FR-015 / FR-016).
 *
 * Every write is gated by the Organization's `version` column (optimistic
 * lock per research R7). Mismatch raises `OrganizationVersionMismatchError`
 * which the route handler maps to HTTP 409.
 *
 * Storefront-side cache invalidation is layered on top by US4 — this
 * foundational service only owns the persisted state.
 */
export class OrganizationRestrictionService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async readAllowLists(organizationId: string): Promise<AllowListsRead> {
    const em = this.emFactory();
    const org = await em.findOneOrFail(Organization, { id: organizationId, deletedAt: null });

    const [payment, delivery, warehouses] = await Promise.all([
      em.find(OrganizationPaymentMethodLink, { organizationId }),
      em.find(OrganizationDeliveryMethodLink, { organizationId }),
      em.find(OrganizationWarehouseLink, { organizationId }),
    ]);

    return {
      organizationId,
      paymentMethodIds: payment.map((r) => r.paymentMethodId).sort(),
      deliveryMethodIds: delivery.map((r) => r.deliveryMethodId).sort(),
      warehouseIds: warehouses.map((r) => r.warehouseId).sort(),
      version: org.version,
    };
  }

  async replaceAllowLists(
    organizationId: string,
    input: ReplaceAllowListsInput,
  ): Promise<AllowListsRead> {
    const em = this.emFactory();
    await em.begin();
    try {
      const org = await em.findOneOrFail(Organization, { id: organizationId, deletedAt: null });
      this.guardVersion(org, input.expectedVersion);

      await em.nativeDelete(OrganizationPaymentMethodLink, { organizationId });
      await em.nativeDelete(OrganizationDeliveryMethodLink, { organizationId });
      await em.nativeDelete(OrganizationWarehouseLink, { organizationId });

      for (const paymentMethodId of dedupe(input.paymentMethodIds)) {
        em.persist(em.create(OrganizationPaymentMethodLink, { organizationId, paymentMethodId }));
      }
      for (const deliveryMethodId of dedupe(input.deliveryMethodIds)) {
        em.persist(em.create(OrganizationDeliveryMethodLink, { organizationId, deliveryMethodId }));
      }
      for (const warehouseId of dedupe(input.warehouseIds)) {
        em.persist(em.create(OrganizationWarehouseLink, { organizationId, warehouseId }));
      }

      // Touch the Organization so the version column advances. MikroORM's
      // optimistic-lock semantics bump `version` automatically on flush.
      org.updatedAt = new Date();

      await em.flush();
      await em.commit();
    } catch (err) {
      await em.rollback();
      throw this.translateOptimisticLockError(err, organizationId);
    }

    return this.readAllowLists(organizationId);
  }

  async patchAllowList(
    organizationId: string,
    kind: RestrictionKind,
    input: PatchAllowListInput,
  ): Promise<AllowListsRead> {
    const em = this.emFactory();
    await em.begin();
    try {
      const org = await em.findOneOrFail(Organization, { id: organizationId, deletedAt: null });
      this.guardVersion(org, input.expectedVersion);

      const add = dedupe(input.add ?? []);
      const remove = dedupe(input.remove ?? []);

      if (kind === 'payment_method') {
        if (remove.length) {
          await em.nativeDelete(OrganizationPaymentMethodLink, {
            organizationId,
            paymentMethodId: { $in: remove },
          });
        }
        for (const id of add) {
          em.persist(em.create(OrganizationPaymentMethodLink, { organizationId, paymentMethodId: id }));
        }
      } else if (kind === 'delivery_method') {
        if (remove.length) {
          await em.nativeDelete(OrganizationDeliveryMethodLink, {
            organizationId,
            deliveryMethodId: { $in: remove },
          });
        }
        for (const id of add) {
          em.persist(em.create(OrganizationDeliveryMethodLink, { organizationId, deliveryMethodId: id }));
        }
      } else {
        if (remove.length) {
          await em.nativeDelete(OrganizationWarehouseLink, {
            organizationId,
            warehouseId: { $in: remove },
          });
        }
        for (const id of add) {
          em.persist(em.create(OrganizationWarehouseLink, { organizationId, warehouseId: id }));
        }
      }

      org.updatedAt = new Date();
      await em.flush();
      await em.commit();
    } catch (err) {
      await em.rollback();
      throw this.translateOptimisticLockError(err, organizationId);
    }

    return this.readAllowLists(organizationId);
  }

  private guardVersion(org: Organization, expected: number): void {
    if (org.version !== expected) {
      throw new OrganizationVersionMismatchError(org.id, expected, org.version);
    }
  }

  private translateOptimisticLockError(err: unknown, organizationId: string): unknown {
    if (err instanceof OptimisticLockError) {
      return new OrganizationVersionMismatchError(organizationId, -1, -1);
    }
    return err;
  }
}

export class OrganizationVersionMismatchError extends Error {
  constructor(
    public readonly organizationId: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number,
  ) {
    super(
      `Organization ${organizationId} version mismatch (expected ${expectedVersion}, currently ${currentVersion}).`,
    );
    this.name = 'OrganizationVersionMismatchError';
  }
}

function dedupe<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
