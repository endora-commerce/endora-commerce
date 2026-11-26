import type { EntityManager } from '@mikro-orm/postgresql';
import { NotFoundError } from '@mikro-orm/core';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { Organization } from '../entities/organization.entity.js';
import { OrganizationPaymentMethodLink } from '../entities/organization-payment-method-link.entity.js';
import { OrganizationDeliveryMethodLink } from '../entities/organization-delivery-method-link.entity.js';
import { OrganizationWarehouseLink } from '../entities/organization-warehouse-link.entity.js';
import {
  makePatchAllowListCommand,
  makeReplaceAllowListsCommand,
  type RestrictionKind,
} from '../commands/allow-list.commands.js';
import { withCallerOptions } from '../commands/caller-options.js';

export { OrganizationVersionMismatchError } from './organization-moderation-errors.js';
export type { RestrictionKind };

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
  /** The admin route always sends it; absent, the write applies to the version it reads. */
  expectedVersion?: number | undefined;
}

export interface PatchAllowListInput {
  /** As {@link ReplaceAllowListsInput.expectedVersion}. */
  expectedVersion?: number | undefined;
  add?: string[] | undefined;
  remove?: string[] | undefined;
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
 * The two writes are Commands (`commands/allow-list.commands.ts`,
 * `specs/186-aggregate-ports/` T027), run on the bus so the link rows and the
 * one audit entry commit together; the admin routes and `organizationCommandPort`
 * both come through here.
 *
 * Storefront-side cache invalidation is layered on top by US4 — this
 * foundational service only owns the persisted state.
 */
export class OrganizationRestrictionService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** Runs the two allow-list Commands. Absent, the service reads only. */
    private readonly commandBus?: Pick<CommandBus, 'run'>,
  ) {}

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

  /**
   * The allow-list for one restriction kind, or `null` for "no restriction".
   *
   * Feature 072 (T138). Three composition roots' worth of callers —
   * `payment_methods`, `delivery_methods` and `inventory` — used to reach this
   * service through a root closure that wrapped {@link readAllowLists} in a
   * bare `catch` and read "organization not found" as "unrestricted". That is
   * the right policy and the wrong place for it: a `catch` around a *port* call
   * also swallows `ModuleDisabledError`, turning a fail-closed gate into a
   * fail-open restriction check — on the one code path whose entire job is to
   * restrict.
   *
   * So the degrade is expressed here, in the return type, by the module that
   * owns the policy. A caller needs no `catch`, and a genuine module-disabled
   * error propagates as the 503 it is.
   */
  async allowedIdsFor(
    organizationId: string,
    kind: 'paymentMethodIds' | 'deliveryMethodIds' | 'warehouseIds',
  ): Promise<string[] | null> {
    let lists: AllowListsRead;
    try {
      lists = await this.readAllowLists(organizationId);
    } catch (err) {
      // The one condition this may absorb: the Organization is unknown or
      // soft-deleted, which `readAllowLists` reports as a `findOneOrFail`
      // rejection. Anything else is a real failure and must surface.
      if (err instanceof NotFoundError) return null;
      throw err;
    }
    return lists[kind];
  }

  async replaceAllowLists(
    organizationId: string,
    input: ReplaceAllowListsInput,
    options: { source?: string | undefined; extensions?: Readonly<Record<string, unknown>> | undefined } = {},
  ): Promise<AllowListsRead> {
    await this.bus().run(
      withCallerOptions(
        makeReplaceAllowListsCommand({
          organizationId,
          paymentMethodIds: input.paymentMethodIds,
          deliveryMethodIds: input.deliveryMethodIds,
          warehouseIds: input.warehouseIds,
          expectedVersion: input.expectedVersion,
        }),
        options,
      ),
    );
    return this.readAllowLists(organizationId);
  }

  async patchAllowList(
    organizationId: string,
    kind: RestrictionKind,
    input: PatchAllowListInput,
    options: { source?: string | undefined; extensions?: Readonly<Record<string, unknown>> | undefined } = {},
  ): Promise<AllowListsRead> {
    await this.bus().run(
      withCallerOptions(
        makePatchAllowListCommand({
          organizationId,
          kind,
          add: input.add,
          remove: input.remove,
          expectedVersion: input.expectedVersion,
        }),
        options,
      ),
    );
    return this.readAllowLists(organizationId);
  }

  private bus(): Pick<CommandBus, 'run'> {
    if (!this.commandBus) {
      throw new Error('OrganizationRestrictionService: the allow-list writes need the Command Bus.');
    }
    return this.commandBus;
  }
}
