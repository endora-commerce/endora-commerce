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
 * mandatory; the lint rule {@link
 * eslint-rules/no-unscoped-channel-query.js} ensures owning modules
 * cannot reach for the bridge tables directly.
 *
 * Responsibilities:
 *
 *   - {@link addToChannel} / {@link removeFromChannel} — idempotent
 *     mutations against the right bridge table for each entity type.
 *   - The "at-least-one-channel" invariant (FR-008) — `removeFromChannel`
 *     refuses when it would leave an entity with zero channels, unless
 *     the caller passes `fallbackToDefault: true`, in which case the
 *     entity is re-bound to the system-default channel inside the
 *     same transaction.
 *   - {@link bindToDefaultIfEmpty} — wired into every owning module's
 *     create-path (T027) so entities created without explicit channels
 *     land in Default automatically (FR-011).
 *   - {@link listChannelsForEntity} / {@link listEntitiesForChannel} —
 *     symmetric reads from either side of the relationship.
 *
 * Bridges are tracked through a single map ({@link BRIDGE_TABLES}) so
 * adding a new channel-scoped entity type is a one-line edit. The
 * service uses raw knex queries through the EntityManager's connection
 * because the bridge tables are owned by the owning modules' entity
 * classes (which arrive in Phase 5 / T049-T058); the service stays
 * decoupled from those classes by never importing them.
 *
 * Every successful add / remove writes one audit row through
 * {@link AuditLogService} and emits one EventBus event. Idempotent
 * no-ops (adding an existing membership / removing a missing one) are
 * NOT audited because they did not change state.
 */

/** Maps the public entity-type vocabulary to the underlying bridge table. */
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
    const knex = em.getConnection().getKnex();

    const inserted = await knex(bridge.table)
      .insert({
        sales_channel_id: channelId,
        [bridge.entityIdColumn]: entityId,
      })
      .onConflict(['sales_channel_id', bridge.entityIdColumn])
      .ignore()
      .returning(bridge.entityIdColumn);

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
   *   - otherwise: throw `EntityWouldHaveZeroChannels`.
   *
   * Idempotent on the row itself: removing a missing membership returns
   * `{ changed: false }` without touching anything else.
   */
  async removeFromChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityId: string,
    options: MembershipMutationOptions = {},
  ): Promise<MembershipMutationResult> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();
    const knex = em.getConnection().getKnex();

    return await knex.transaction(async (trx) => {
      const deleted = await trx(bridge.table)
        .where({
          sales_channel_id: channelId,
          [bridge.entityIdColumn]: entityId,
        })
        .delete();

      if (deleted === 0) {
        // Idempotent — nothing was there to remove.
        return { changed: false };
      }

      // Count remaining channels for this entity.
      const [{ count }] = (await trx(bridge.table)
        .where({ [bridge.entityIdColumn]: entityId })
        .count<[{ count: string }]>('* as count')) as [{ count: string }];
      const remaining = Number(count);

      if (remaining > 0) {
        await this.auditMembership(channelId, entityType, entityId, 'remove', options);
        this.emitMembershipChanged(channelId, entityType, entityId, 'remove');
        return { changed: true };
      }

      // remaining === 0 → FR-008 enforcement.
      if (!options.fallbackToDefault) {
        throw new HttpError(
          422,
          ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS,
          `Removing this membership would leave the ${entityType} with zero sales channels. ` +
            `Pass fallbackToDefault=true to rebind it to the system default instead.`,
          [{ path: 'entityId', issue: entityId }],
        );
      }

      // Rebind to Default in the same transaction.
      const defaultChannelRow = await trx('sales_channels')
        .select('id')
        .where({ system_default: true })
        .first();
      if (!defaultChannelRow) {
        throw new HttpError(
          500,
          ERROR_CODES.INTERNAL,
          'No system-default sales channel found; cannot apply fallback.',
        );
      }
      const defaultId = defaultChannelRow.id as string;

      await trx(bridge.table)
        .insert({
          sales_channel_id: defaultId,
          [bridge.entityIdColumn]: entityId,
        })
        .onConflict(['sales_channel_id', bridge.entityIdColumn])
        .ignore();

      await this.auditMembership(channelId, entityType, entityId, 'remove', options, true);
      this.emitMembershipChanged(channelId, entityType, entityId, 'remove');
      return { changed: true, fallbackAppliedToDefault: true };
    });
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
    const knex = em.getConnection().getKnex();

    const [{ count }] = (await knex(bridge.table)
      .where({ [bridge.entityIdColumn]: entityId })
      .count<[{ count: string }]>('* as count')) as [{ count: string }];
    if (Number(count) > 0) return { changed: false };

    const defaultChannel = await em.findOne(SalesChannel, { systemDefault: true });
    if (defaultChannel === null) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'No system-default sales channel found; cannot bind new entity to Default.',
      );
    }

    await knex(bridge.table)
      .insert({
        sales_channel_id: defaultChannel.id,
        [bridge.entityIdColumn]: entityId,
      })
      .onConflict(['sales_channel_id', bridge.entityIdColumn])
      .ignore();

    await this.auditMembership(
      defaultChannel.id,
      entityType,
      entityId,
      'add',
      {},
    );
    this.emitMembershipChanged(defaultChannel.id, entityType, entityId, 'add');
    return { changed: true };
  }

  /** Channels an entity currently belongs to. */
  async listChannelsForEntity(
    entityType: ChannelMemberEntityType,
    entityId: string,
  ): Promise<SalesChannel[]> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();
    const knex = em.getConnection().getKnex();
    const rows = await knex(bridge.table)
      .select('sales_channel_id')
      .where({ [bridge.entityIdColumn]: entityId });
    const ids = rows.map((r) => r.sales_channel_id as string);
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
    const knex = em.getConnection().getKnex();

    const [{ count }] = (await knex(bridge.table)
      .where({ sales_channel_id: channelId })
      .count<[{ count: string }]>('* as count')) as [{ count: string }];
    const total = Number(count);

    const rows = await knex(bridge.table)
      .select(bridge.entityIdColumn)
      .where({ sales_channel_id: channelId })
      .orderBy(bridge.entityIdColumn, 'asc')
      .offset(page * pageSize)
      .limit(pageSize);
    const entityIds = rows.map((r) => r[bridge.entityIdColumn] as string);
    return { entityIds, total };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

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
