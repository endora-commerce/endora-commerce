import { OptimisticLockError } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, isUuidShape } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { OrganizationDeliveryMethodLink } from '../entities/organization-delivery-method-link.entity.js';
import { OrganizationPaymentMethodLink } from '../entities/organization-payment-method-link.entity.js';
import { OrganizationWarehouseLink } from '../entities/organization-warehouse-link.entity.js';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationVersionMismatchError } from '../services/organization-moderation-errors.js';

/**
 * The per-Organization allow-list writes as Commands (feature 026 US4;
 * `specs/186-aggregate-ports/` T027): `organization.allow_lists_replace` and
 * `organization.allow_list_patch`.
 *
 * `OrganizationRestrictionService` wrote both inside its own transaction and
 * recorded the entry by hand (`recordAuditFromContext`), so no command hook
 * could see them and the port had nothing to run. The action strings and the
 * audit state are unchanged — `stateBefore` null, `stateAfter` the deduplicated
 * ids (`audit-state.md` list 1). The admin routes and `organizationCommandPort`
 * run these factories through the service.
 *
 * Each write touches the Organization so its `version` advances; a stale
 * `expectedVersion`, or a concurrent write that moved the row before the flush,
 * is {@link OrganizationVersionMismatchError} (the routes answer
 * `409 VERSION_CONFLICT` with `currentVersion`). Absent, the write applies to
 * the version it reads (research R-16.6).
 */

export type RestrictionKind = 'payment_method' | 'delivery_method' | 'warehouse';

export interface ReplaceAllowListsCommandInput {
  readonly organizationId: string;
  readonly paymentMethodIds: readonly string[];
  readonly deliveryMethodIds: readonly string[];
  readonly warehouseIds: readonly string[];
  readonly expectedVersion?: number | undefined;
}

export interface PatchAllowListCommandInput {
  readonly organizationId: string;
  readonly kind: RestrictionKind;
  readonly add?: readonly string[] | undefined;
  readonly remove?: readonly string[] | undefined;
  readonly expectedVersion?: number | undefined;
}

export function makeReplaceAllowListsCommand(input: ReplaceAllowListsCommandInput): Command<Organization> {
  const { organizationId } = input;
  const lists = {
    paymentMethodIds: dedupe(input.paymentMethodIds),
    deliveryMethodIds: dedupe(input.deliveryMethodIds),
    warehouseIds: dedupe(input.warehouseIds),
  };
  return {
    action: 'organization.allow_lists_replace',
    objectType: 'organization',
    objectId: organizationId,
    run: async ({ em }) => {
      const org = await loadForWrite(em, organizationId, input.expectedVersion);

      await em.nativeDelete(OrganizationPaymentMethodLink, { organizationId });
      await em.nativeDelete(OrganizationDeliveryMethodLink, { organizationId });
      await em.nativeDelete(OrganizationWarehouseLink, { organizationId });
      for (const paymentMethodId of lists.paymentMethodIds) {
        em.persist(em.create(OrganizationPaymentMethodLink, { organizationId, paymentMethodId }));
      }
      for (const deliveryMethodId of lists.deliveryMethodIds) {
        em.persist(em.create(OrganizationDeliveryMethodLink, { organizationId, deliveryMethodId }));
      }
      for (const warehouseId of lists.warehouseIds) {
        em.persist(em.create(OrganizationWarehouseLink, { organizationId, warehouseId }));
      }

      await touchAndFlush(em, org, input.expectedVersion);
      return { result: org, before: null, after: { ...lists } };
    },
  };
}

export function makePatchAllowListCommand(input: PatchAllowListCommandInput): Command<Organization> {
  const { organizationId, kind } = input;
  const add = dedupe(input.add ?? []);
  const remove = dedupe(input.remove ?? []);
  return {
    action: 'organization.allow_list_patch',
    objectType: 'organization',
    objectId: organizationId,
    run: async ({ em }) => {
      const org = await loadForWrite(em, organizationId, input.expectedVersion);

      if (kind === 'payment_method') {
        if (remove.length) {
          await em.nativeDelete(OrganizationPaymentMethodLink, { organizationId, paymentMethodId: { $in: remove } });
        }
        for (const id of add) {
          em.persist(em.create(OrganizationPaymentMethodLink, { organizationId, paymentMethodId: id }));
        }
      } else if (kind === 'delivery_method') {
        if (remove.length) {
          await em.nativeDelete(OrganizationDeliveryMethodLink, { organizationId, deliveryMethodId: { $in: remove } });
        }
        for (const id of add) {
          em.persist(em.create(OrganizationDeliveryMethodLink, { organizationId, deliveryMethodId: id }));
        }
      } else {
        if (remove.length) {
          await em.nativeDelete(OrganizationWarehouseLink, { organizationId, warehouseId: { $in: remove } });
        }
        for (const id of add) {
          em.persist(em.create(OrganizationWarehouseLink, { organizationId, warehouseId: id }));
        }
      }

      await touchAndFlush(em, org, input.expectedVersion);
      return { result: org, before: null, after: { kind, add, remove } };
    },
  };
}

async function loadForWrite(em: EntityManager, organizationId: string, expectedVersion: number | undefined): Promise<Organization> {
  const org = isUuidShape(organizationId) ? await em.findOne(Organization, { id: organizationId, deletedAt: null }) : null;
  if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
  if (expectedVersion !== undefined && org.version !== expectedVersion) {
    throw new OrganizationVersionMismatchError(org.id, expectedVersion, org.version);
  }
  return org;
}

/** Advances the Organization's `version` with the link rows; a lost race is a version mismatch. */
async function touchAndFlush(em: EntityManager, org: Organization, expectedVersion: number | undefined): Promise<void> {
  org.updatedAt = new Date();
  try {
    await em.flush();
  } catch (err) {
    if (err instanceof OptimisticLockError) {
      throw new OrganizationVersionMismatchError(org.id, expectedVersion ?? -1, -1);
    }
    throw err;
  }
}

function dedupe<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
