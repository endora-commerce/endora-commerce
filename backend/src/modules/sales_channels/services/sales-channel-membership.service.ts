import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  type ChannelMemberEntityType,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import type { EventBus } from '../../../events/bus.js';
import { SalesChannel } from '../entities/sales-channel.entity.js';

/**
 * SalesChannelMembershipService — feature 005 / T016.
 *
 * Single mutator for every M:N bridge between Sales Channels and the
 * channel-scoped entity types (FR-009). Going through this service is
 * mandatory; the lint rule `no-unscoped-channel-query` ensures owning
 * modules cannot reach for the bridge tables directly.
 *
 * Responsibilities:
 *
 *   - {@link addToChannel} / {@link removeFromChannel} — idempotent
 *     mutations against the right bridge table.
 *   - The "at-least-one-channel" invariant (FR-008) — `removeFromChannel`
 *     refuses when it would leave an entity with zero channels, unless
 *     the caller passes `fallbackToDefault: true`, in which case the
 *     entity is re-bound to the system-default channel inside the
 *     same transaction.
 *   - {@link bindToDefaultIfEmpty} — wired into every owning module's
 *     create-path so entities created without explicit channels land
 *     in Default automatically (FR-011).
 *   - {@link listChannelsForEntity} / {@link listEntityIdsForChannel}
 *     — symmetric reads from either side of the relationship.
 *
 * Bridges are tracked through a single map ({@link BRIDGE_TABLES}) so
 * adding a new channel-scoped entity type is a one-line edit. The
 * service uses `em.getConnection().execute()` (which honours the EM's
 * active transaction — knex's `getKnex()` would bypass it via its own
 * connection pool, breaking transactional integration tests).
 *
 * Every successful add / remove writes one audit row through
 * {@link AuditLogService} and emits one EventBus event. Idempotent
 * no-ops (adding an existing membership / removing a missing one) are
 * NOT audited because they did not change state.
 */

interface BridgeShape {
  table: string;
  entityIdColumn: string;
}

const BRIDGE_TABLES: Record<ChannelMemberEntityType, BridgeShape> = {
  product: { table: 'sales_channel_products', entityIdColumn: 'product_id' },
  category: { table: 'sales_channel_categories', entityIdColumn: 'category_id' },
  'payment-method': {
    table: 'sales_channel_payment_methods',
    entityIdColumn: 'payment_method_id',
  },
  'delivery-method': {
    table: 'sales_channel_delivery_methods',
    entityIdColumn: 'delivery_method_id',
  },
  organization: {
    table: 'sales_channel_organizations',
    entityIdColumn: 'organization_id',
  },
  tax: { table: 'sales_channel_taxes', entityIdColumn: 'tax_id' },
  customer: {
    table: 'sales_channel_customer_accounts',
    entityIdColumn: 'customer_account_id',
  },
  promotion: {
    table: 'sales_channel_promotions',
    entityIdColumn: 'promotion_id',
  },
  'cms-page': {
    table: 'sales_channel_cms_pages',
    entityIdColumn: 'cms_page_id',
  },
};

export interface MembershipMutationOptions {
  /** When true, falling to zero channels triggers automatic rebind to Default instead of refusal. */
  fallbackToDefault?: boolean;
  /** Optional admin actor for the audit row. */
  actorAdminUserId?: string | null;
}

export interface MembershipMutationResult {
  /** True if the mutation actually changed state (false for idempotent no-ops). */
  changed: boolean;
  /** Set when the FR-008 fallback was applied. */
  fallbackAppliedToDefault?: boolean;
}

export class SalesChannelMembershipService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly eventBus: EventBus,
    private readonly auditLogService?: AuditLogService,
  ) {}

  /**
   * Add `entityId` to `channelId`'s member set for `entityType`. Idempotent —
   * adding an existing membership returns `{ changed: false }` without
   * touching the database.
   */
  async addToChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    options: MembershipMutationOptions = {},
  ): Promise<MembershipMutationResult> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();

    const inserted = await em
      .getConnection()
      .execute<Array<Record<string, unknown>>>(
        `insert into "${bridge.table}" ("sales_channel_id", "${bridge.entityIdColumn}") ` +
          `values (?, ?) ` +
          `on conflict ("sales_channel_id", "${bridge.entityIdColumn}") do nothing ` +
          `returning "${bridge.entityIdColumn}"`,
        [channelId, entityId],
        'all',
        em.getTransactionContext(),
      );

    if (inserted.length === 0) {
      return { changed: false };
    }

    await this.auditMembership(channelId, entityType, entityId, 'add', options);
    this.emitMembershipChanged(channelId, entityType, entityId, 'add');
    return { changed: true };
  }

  /**
   * Remove `entityId` from `channelId`'s member set for `entityType`. If the
   * removal would leave the entity with zero channel bindings:
   *   - when `fallbackToDefault = true`: re-bind to the system-default
   *     channel inside the same transaction; mark the result with
   *     `fallbackAppliedToDefault: true`.
   *   - otherwise: throw `ENTITY_WOULD_HAVE_ZERO_CHANNELS` (HTTP 422).
   *
   * Idempotent on the row itself: removing a missing membership returns
   * `{ changed: false }`.
   */
  async removeFromChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    options: MembershipMutationOptions = {},
  ): Promise<MembershipMutationResult> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();

    // Step 1: check existence so the no-op path is idempotent and so FR-008
    // can be evaluated BEFORE we delete anything.
    const existing = await em
      .getConnection()
      .execute<Array<Record<string, unknown>>>(
        `select 1 as present from "${bridge.table}" ` +
          `where "sales_channel_id" = ? and "${bridge.entityIdColumn}" = ? limit 1`,
        [channelId, entityId],
        'all',
        em.getTransactionContext(),
      );
    if (existing.length === 0) {
      return { changed: false };
    }

    // Step 2: count total memberships for the entity. If this is the last
    // one, FR-008 either refuses (default) or rebinds to Default (when the
    // caller opted in).
    const totalChannels = await this.countMembershipsForEntity(em, bridge, entityId);
    const wouldOrphan = totalChannels === 1;

    if (wouldOrphan && !options.fallbackToDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS,
        `Removing this membership would leave the ${entityType} with zero sales channels. ` +
          `Pass fallbackToDefault=true to rebind it to the system default instead.`,
        [{ path: 'entityId', issue: entityId }],
      );
    }

    // Step 3: when we get here either the entity has another channel left or
    // the caller asked for the rebind. The actual DELETE is now safe.
    await em
      .getConnection()
      .execute(
        `delete from "${bridge.table}" ` +
          `where "sales_channel_id" = ? and "${bridge.entityIdColumn}" = ?`,
        [channelId, entityId],
        'run',
        em.getTransactionContext(),
      );

    if (!wouldOrphan) {
      await this.auditMembership(channelId, entityType, entityId, 'remove', options);
      this.emitMembershipChanged(channelId, entityType, entityId, 'remove');
      return { changed: true };
    }

    // wouldOrphan && fallbackToDefault — rebind in the same transaction.
    const defaultId = await this.requireSystemDefaultId(em);
    await em
      .getConnection()
      .execute(
        `insert into "${bridge.table}" ("sales_channel_id", "${bridge.entityIdColumn}") ` +
          `values (?, ?) ` +
          `on conflict ("sales_channel_id", "${bridge.entityIdColumn}") do nothing`,
        [defaultId, entityId],
        'run',
        em.getTransactionContext(),
      );

    await this.auditMembership(channelId, entityType, entityId, 'remove', options, true);
    this.emitMembershipChanged(channelId, entityType, entityId, 'remove');
    return { changed: true, fallbackAppliedToDefault: true };
  }

  /**
   * If the entity has no memberships in any channel, bind it to the
   * system-default channel. Wired into every owning module's create
   * transaction (FR-011 / T027).
   */
  async bindToDefaultIfEmpty(
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<MembershipMutationResult> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();

    const remaining = await this.countMembershipsForEntity(em, bridge, entityId);
    if (remaining > 0) return { changed: false };

    const defaultId = await this.requireSystemDefaultId(em);

    await em
      .getConnection()
      .execute(
        `insert into "${bridge.table}" ("sales_channel_id", "${bridge.entityIdColumn}") ` +
          `values (?, ?) ` +
          `on conflict ("sales_channel_id", "${bridge.entityIdColumn}") do nothing`,
        [defaultId, entityId],
        'run',
        em.getTransactionContext(),
      );

    await this.auditMembership(defaultId, entityType, entityId, 'add', {});
    this.emitMembershipChanged(defaultId, entityType, entityId, 'add');
    return { changed: true };
  }

  /** Channels an entity currently belongs to. */
  async listChannelsForEntity(
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<SalesChannel[]> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();
    const rows = await em
      .getConnection()
      .execute<Array<{ sales_channel_id: string }>>(
        `select "sales_channel_id" from "${bridge.table}" where "${bridge.entityIdColumn}" = ?`,
        [entityId],
        'all',
        em.getTransactionContext(),
      );
    const ids = rows.map((r) => r.sales_channel_id);
    if (ids.length === 0) return [];
    return em.find(SalesChannel, { id: { $in: ids } });
  }

  /** Entity ids of `entityType` that currently belong to `channelId`. */
  async listEntityIdsForChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    page = 0,
    pageSize = 100,
  ): Promise<{ entityIds: string[]; total: number }> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();

    const totalRows = await em
      .getConnection()
      .execute<Array<{ count: string }>>(
        `select count(*)::text as count from "${bridge.table}" where "sales_channel_id" = ?`,
        [channelId],
        'all',
        em.getTransactionContext(),
      );
    const total = Number(totalRows[0]?.count ?? '0');

    const rows = await em
      .getConnection()
      .execute<Array<Record<string, string>>>(
        `select "${bridge.entityIdColumn}" from "${bridge.table}" ` +
          `where "sales_channel_id" = ? order by "${bridge.entityIdColumn}" asc ` +
          `offset ? limit ?`,
        [channelId, page * pageSize, pageSize],
        'all',
        em.getTransactionContext(),
      );
    const entityIds = rows.map((r) => r[bridge.entityIdColumn]!);
    return { entityIds, total };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async countMembershipsForEntity(
    em: EntityManager,
    bridge: BridgeShape,
    entityId: string,
  ): Promise<number> {
    const rows = await em
      .getConnection()
      .execute<Array<{ count: string }>>(
        `select count(*)::text as count from "${bridge.table}" where "${bridge.entityIdColumn}" = ?`,
        [entityId],
        'all',
        em.getTransactionContext(),
      );
    return Number(rows[0]?.count ?? '0');
  }

  private async requireSystemDefaultId(em: EntityManager): Promise<string> {
    const rows = await em
      .getConnection()
      .execute<Array<{ id: string }>>(
        `select "id" from "sales_channels" where "system_default" = true limit 1`,
        [],
        'all',
        em.getTransactionContext(),
      );
    const id = rows[0]?.id;
    if (!id) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'No system-default sales channel found; cannot apply fallback.',
      );
    }
    return id;
  }

  private async auditMembership(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    op: 'add' | 'remove',
    options: MembershipMutationOptions,
    fallbackAppliedToDefault?: boolean,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.record({
      actorAdminUserId: options.actorAdminUserId ?? null,
      action: SALES_CHANNEL_AUDIT_ACTIONS.MEMBERSHIP_CHANGED,
      objectType: 'sales_channel_membership',
      objectId: `${channelId}:${entityType}:${entityId}`,
      stateAfter: {
        channelId,
        entityType,
        entityId,
        op,
        ...(fallbackAppliedToDefault ? { fallbackAppliedToDefault: true } : {}),
      },
    });
  }

  private emitMembershipChanged(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    op: 'add' | 'remove',
  ): void {
    this.eventBus.emit('sales_channels.membership_changed', {
      eventId: `sales_channels.membership_changed:${channelId}:${entityType}:${entityId}:${op}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      channelId,
      entityType,
      entityId,
      op,
    } as never);
  }
}
