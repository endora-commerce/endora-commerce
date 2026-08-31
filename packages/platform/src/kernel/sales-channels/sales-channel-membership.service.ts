import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  type ChannelMemberEntityType,
} from '@endora-commerce/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { AuditPort } from '../ports/audit.js';
import type { EventBus } from '../../events/bus.js';
import { SalesChannel } from './sales-channel.entity.js';

/**
 * SalesChannelMembershipService — feature 005 / T016.
 *
 * Single mutator for every M:N bridge between Sales Channels and the
 * channel-scoped entity types (FR-009). Going through this service is
 * mandatory: `check:module-boundary`'s `sql` predicate resolves every
 * `sales_channel_*` table to its owner out of the DDL, so an owning module
 * reaching for a bridge table in raw SQL is a ledgered finding (D-87). Until
 * then this clause was credited to `no-unscoped-channel-query`, an ESLint rule
 * wired into no config that never looked at a bridge table.
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
 * {@link AuditPort} and emits one EventBus event. Idempotent
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
    private readonly auditLogService?: AuditPort,
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

  /**
   * Give `targetEntityId` every channel `sourceEntityId` belongs to (issue #185).
   *
   * `catalog` duplicates a product and copies the source's whole channel
   * assortment. It did that with one `insert … select` against
   * `sales_channel_products` — Principle XII's accessor clause and Principle
   * XIII in a single statement, because the bridge was written directly and not
   * one of the memberships it created was audited.
   *
   * Implemented over {@link addToChannel} rather than as a set-based insert on
   * purpose: that is what makes each new membership carry its audit row and its
   * `sales_channel_membership_changed` event, which is the entire reason the
   * copy moved here. An assortment is tens of channels at the very most, so the
   * per-row round trip costs nothing worth the divergence.
   *
   * Memberships the target already holds are skipped by `addToChannel`'s own
   * idempotency and are not counted.
   */
  async copyMemberships(
    entityType: ChannelMemberEntityType,
    sourceEntityId: string,
    targetEntityId: string,
    options: MembershipMutationOptions = {},
  ): Promise<{ copied: number }> {
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();
    const rows = await em
      .getConnection()
      .execute<Array<{ sales_channel_id: string }>>(
        `select "sales_channel_id" from "${bridge.table}" where "${bridge.entityIdColumn}" = ?`,
        [sourceEntityId],
        'all',
        em.getTransactionContext(),
      );

    let copied = 0;
    for (const row of rows) {
      const result = await this.addToChannel(
        row.sales_channel_id,
        entityType,
        targetEntityId,
        options,
      );
      if (result.changed) copied += 1;
    }
    return { copied };
  }

  /**
   * Replace an entity's complete channel membership set atomically.
   *
   * Complete-record integrations use this instead of composing add/remove:
   * product creation initially binds the system default, while the delivered
   * record names the exact channel that must remain. A delete-then-add sequence
   * through the public methods would either trip the zero-channel invariant or
   * retain the unrelated default.
   */
  async replaceChannelsForEntity(
    entityType: ChannelMemberEntityType,
    entityId: string,
    channelIds: readonly [string, ...string[]],
    options: MembershipMutationOptions = {},
  ): Promise<MembershipMutationResult> {
    const bridge = BRIDGE_TABLES[entityType];
    const desiredIds = [...new Set(channelIds)];
    const em = this.emFactory();
    const existingRows = await em
      .getConnection()
      .execute<Array<{ sales_channel_id: string }>>(
        `select "sales_channel_id" from "${bridge.table}" ` +
          `where "${bridge.entityIdColumn}" = ? order by "sales_channel_id" asc`,
        [entityId],
        'all',
        em.getTransactionContext(),
      );
    const existingIds = existingRows.map((row) => row.sales_channel_id);
    const desiredSorted = [...desiredIds].sort();
    if (
      existingIds.length === desiredSorted.length &&
      existingIds.every((id, index) => id === desiredSorted[index])
    ) {
      return { changed: false };
    }

    await em.transactional(async (tx) => {
      await tx
        .getConnection()
        .execute(
          `delete from "${bridge.table}" where "${bridge.entityIdColumn}" = ?`,
          [entityId],
          'run',
          tx.getTransactionContext(),
        );
      for (const channelId of desiredIds) {
        await tx
          .getConnection()
          .execute(
            `insert into "${bridge.table}" ("sales_channel_id", "${bridge.entityIdColumn}") ` +
              `values (?, ?)`,
            [channelId, entityId],
            'run',
            tx.getTransactionContext(),
          );
      }
    });

    const desiredSet = new Set(desiredIds);
    const existingSet = new Set(existingIds);
    for (const channelId of existingIds) {
      if (desiredSet.has(channelId)) continue;
      await this.auditMembership(channelId, entityType, entityId, 'remove', options);
      this.emitMembershipChanged(channelId, entityType, entityId, 'remove');
    }
    for (const channelId of desiredIds) {
      if (existingSet.has(channelId)) continue;
      await this.auditMembership(channelId, entityType, entityId, 'add', options);
      this.emitMembershipChanged(channelId, entityType, entityId, 'add');
    }

    return { changed: true };
  }

  /**
   * Narrow a **known** set of entity ids to those bound to `channelId`
   * (issue #185).
   *
   * The read half of the same finding. Three `catalog` services asked
   * `select <entity>_id from sales_channel_<type> where sales_channel_id = ?
   * and <entity>_id in (…)` by hand, one per channel-scoped listing, and every
   * one of them fails closed to the empty set — which is the right behaviour
   * and the wrong place to spell it.
   *
   * Not {@link listEntityIdsForChannel}: that one enumerates a channel's whole
   * membership a page at a time, and a caller holding a page of ids wants the
   * intersection rather than the enumeration. Using it here would mean pulling
   * every product in the channel to filter twenty.
   */
  async filterEntityIdsInChannel(
    channelId: string,
    entityType: ChannelMemberEntityType,
    entityIds: readonly string[],
  ): Promise<string[]> {
    if (entityIds.length === 0) return [];
    const bridge = BRIDGE_TABLES[entityType];
    const em = this.emFactory();
    const placeholders = entityIds.map(() => '?').join(',');
    const rows = await em
      .getConnection()
      .execute<Array<Record<string, string>>>(
        `select "${bridge.entityIdColumn}" from "${bridge.table}" ` +
          `where "sales_channel_id" = ? and "${bridge.entityIdColumn}" in (${placeholders})`,
        [channelId, ...entityIds],
        'all',
        em.getTransactionContext(),
      );
    return rows.map((row) => row[bridge.entityIdColumn]!);
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
