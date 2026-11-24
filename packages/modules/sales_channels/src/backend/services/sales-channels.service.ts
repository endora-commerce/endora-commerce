import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  dispatchValidatorMode,
  unlinkableAssetIds,
  type AssetReadPort,
  type DictionaryValidator,
  type SalesChannelAttributionRegistryPort,
  type SalesChannelCreateRequest,
  type SalesChannelUpdateBody,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type {
  SalesChannelAccessCacheInvalidation,
  SalesChannelsCacheInvalidation,
} from '@endora-commerce/platform/kernel';
import {
  makeSetSystemDefaultChannelCommand,
  type SetSystemDefaultChannelResult,
} from '../commands/set-default.command.js';
import {
  makeCreateSalesChannelCommand,
  makeUpdateSalesChannelCommand,
} from '../commands/identity.command.js';

/**
 * SalesChannelsService — feature 005 / T017 (skeleton) + T035-T037 (US2).
 *
 * Admin-side CRUD + lifecycle for the Sales Channel registry. Membership
 * mutations live in {@link SalesChannelMembershipService}; this service
 * deals exclusively with the channel row's identity, lifecycle, and
 * the FR-002 / FR-006 / FR-007 guards.
 *
 * Optimistic concurrency uses the `version` column. Update calls take
 * an `expectedVersion` argument; mismatch raises HTTP 412
 * `STALE_SALES_CHANNEL_WRITE` with the current version in the body so
 * the client can refresh and retry. This matches feature 003 / 004's
 * pattern.
 *
 * Every successful identity / lifecycle change writes one audit row
 * (`sales_channel.identity.changed` / `sales_channel.lifecycle.changed`),
 * **drops the channel cache**, and then emits one EventBus event. Identity
 * writes (create, update) are Commands — `commands/identity.command.ts` — so
 * their row is the Command Bus's, written in the write's own transaction with
 * the actor from the ambient TenantContext; lifecycle writes are still audited
 * by hand here.
 *
 * That order is the whole of D-93 (issue #160). The drop used to be a
 * subscriber — `attachSalesChannelsCacheInvalidator` listened for those two
 * events — which made cache freshness a property of the dispatch order rather
 * than of the write: `dictionaries` subscribes to the same two names and its
 * Redis SCAN has already been measured pushing the invalidator past a tick
 * (#101), and an emission inside an `EventBus.run` scope is buffered until the
 * scope ends, so a write and a read-back in one Command could not be helped by
 * any registration order at all. The events stay — other modules want them —
 * and they stop being how this cache learns about this service's own write.
 *
 * `setDefault` is a Command too (feature 072 / D-51): the Command Bus writes its
 * audit row and buffers its event co-transactionally. The identity Commands
 * declare no event, so the drop-then-announce order above holds for them: the
 * service drops the cache once `CommandBus.run` has committed, then emits.
 */

export interface AdminAuditContext {
  actorAdminUserId: string | null;
  requestId?: string | null;
}

export interface SalesChannelsServiceListOptions {
  page?: number;
  pageSize?: number;
  activeOnly?: boolean;
}

export interface DeleteOptions {
  fallbackToDefault?: boolean;
}

/**
 * The channel-bridge registry, narrowed to the half this service reads
 * (feature 120, FR-015).
 *
 * Declared structurally rather than imported from the platform: the registry
 * class is published on no barrel — it is reached by container name — and the
 * shape a consumer needs is the consumer's own declaration, which is what
 * `ctx.cradle<C>()` asks an author for.
 */
export interface ChannelBridgeRead {
  list(): ReadonlyArray<{
    readonly entityType: string;
    readonly table: string;
    readonly entityIdColumn: string;
  }>;
}

export class SalesChannelsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly eventBus: EventBus,
    /**
     * Required, and it was not (issue #251's shape, feature 075's occasion).
     * Both roots have supplied it since feature 072 wave 2, so the absent
     * branch was only ever run by tests — and what ran there was a hand-written
     * `select "code" from "languages" / "currencies"`, two other modules' tables
     * named in raw SQL, checking existence and not the active flag, and raising
     * the 422 codes feature 017 superseded with the validator's uniform 409.
     * Deleting that branch is the D-87 drain; making the argument required is
     * what stops it coming back as an omission.
     */
    private readonly dictionaryValidator: DictionaryValidator,
    /**
     * "Who is still attributed to this channel?", asked of the modules that
     * record it (feature 075, D-87). Required for the same reason: the absent
     * form of a delete guard is an open one.
     */
    private readonly attributionRegistry: SalesChannelAttributionRegistryPort,
    /**
     * Which table holds each channel-scoped entity type's memberships, said by
     * the module that owns that entity type (feature 120, FR-015).
     *
     * This class held its own copy of the platform's nine-entry map until
     * D-226, justified in a comment as *"kept locally to avoid a circular
     * import between the two services"*. That reason had been stale since
     * feature 072's T019 moved `SalesChannelMembershipService` into the kernel:
     * the platform names `packages/modules/sales_channels` in zero import
     * specifiers and D-52/D-53 forbid it ever doing so. The copy was the worse
     * of the two, because {@link findOrphansForChannel} runs a `select` against
     * **all nine** tables on the channel-**delete** path, inside a module the
     * platform refuses to switch off — so on an instance without `cms` deleting
     * a channel failed on a relation that is not there.
     *
     * Resolved **through the container** rather than imported, by the name a
     * composition root contributes off `composeSalesChannelsKernel`. A
     * container resolution is not a module-graph edge, so there is nothing for
     * a cycle to close; and the registry is a **kernel** registration rather
     * than another module's port, so it puts nothing in this module's
     * `dependencies` and makes no activation control a dead switch.
     */
    private readonly bridgeRegistry: ChannelBridgeRead,
    /**
     * Required: identity writes (create, update) and `setDefault` are Commands
     * (Principle XIII). It was optional while only `setDefault` used it, which
     * then refused at call time without one; an identity write must not have
     * an absent form that skips the bus.
     */
    private readonly commandBus: CommandBus,
    /** The lifecycle writes (deactivate, activate, delete) still audit by hand. */
    private readonly auditLogService?: AuditPort,
    /**
     * The invalidating half of the channel cache, narrowed to what a writer
     * needs (D-93). A service that can only invalidate cannot seed the cache
     * from the write path, which is the reader's job.
     */
    private readonly cache?: SalesChannelsCacheInvalidation,
    /**
     * Feature 154 — the per-Organization permitted-channel cache the access
     * rule reads. A delete removes the deleted channel's Organization rows by
     * cascade and may rebind orphans to the default, so every cached set can
     * move; it is dropped as part of the write, like the channel cache.
     */
    private readonly accessCache?: SalesChannelAccessCacheInvalidation,
    /**
     * Issue #544 — `assets_library`'s visibility question, asked before a
     * write sets a logo the channel does not already have. A write that sets
     * one without it fails closed.
     */
    private readonly assets?: Pick<AssetReadPort, 'visibleToCaller'>,
  ) {}

  /**
   * Issue #544 (owner ruling 2026-10-30, option a) — refuse a newly set logo
   * the caller may not see in the asset library, a missing one included, with
   * `assets_library`'s own answer for a hidden file. The logo already set is
   * the channel's own and is accepted as it stands.
   */
  private async assertLogoLinkable(logoAssetId: string | null | undefined, current: string | null): Promise<void> {
    if (!logoAssetId) return;
    const [refused] = await unlinkableAssetIds(
      this.assets ?? { visibleToCaller: async () => new Set() },
      [logoAssetId],
      current ? [current] : [],
    );
    if (refused === undefined) return;
    if (!this.assets) throw new Error('sales_channels: the asset read port is not wired — a logo cannot be set.');
    throw new HttpError(404, ERROR_CODES.ASSET_NOT_FOUND, `Asset ${refused} not found.`, { assetId: refused });
  }

  // -------------------------------------------------------------------------
  // Read paths
  // -------------------------------------------------------------------------

  async getByCode(code: string): Promise<SalesChannel | null> {
    const em = this.emFactory();
    return em.findOne(SalesChannel, { code });
  }

  async getById(id: string): Promise<SalesChannel | null> {
    const em = this.emFactory();
    return em.findOne(SalesChannel, { id });
  }

  async list(options: SalesChannelsServiceListOptions = {}): Promise<{
    items: SalesChannel[];
    page: number;
    pageSize: number;
    total: number;
  }> {
    const em = this.emFactory();
    const page = Math.max(0, options.page ?? 0);
    const pageSize = Math.min(Math.max(1, options.pageSize ?? 20), 100);
    const where: Record<string, unknown> = {};
    if (options.activeOnly) where['active'] = true;

    const [items, total] = await em.findAndCount(SalesChannel, where, {
      orderBy: { createdAt: 'asc', id: 'asc' },
      offset: page * pageSize,
      limit: pageSize,
    });
    return { items, page, pageSize, total };
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  /**
   * Create a channel, as a Command (Principle XIII). Needs an ambient
   * TenantContext — the bus refuses without one — and writes exactly one
   * `sales_channel.identity.changed` row, `stateBefore` null.
   */
  async create(body: SalesChannelCreateRequest): Promise<SalesChannel> {
    await this.assertLanguagesValid(body.languages);
    await this.validateLanguage(body.defaultLanguage, 'create-or-change', 'defaultLanguage');
    await this.assertCurrenciesValid(body.currencies);
    await this.validateCurrency(body.defaultCurrency, 'create-or-change', 'defaultCurrency');
    await this.assertLogoLinkable(body.logoAssetId, null);

    const channel = await this.commandBus.run(makeCreateSalesChannelCommand(randomUUID(), body));
    // D-93 — committed by now, so drop, then announce.
    await this.emitIdentityChanged(channel.code);
    return channel;
  }

  // -------------------------------------------------------------------------
  // Update (FR-005 optimistic concurrency)
  // -------------------------------------------------------------------------

  /**
   * Patch a channel's identity, as a Command (Principle XIII). The refusals an
   * operator can act on are answered here, before a transaction opens; the
   * Command re-checks the version inside it and writes exactly one
   * `sales_channel.identity.changed` row with the before/after snapshots.
   */
  async update(
    code: string,
    body: SalesChannelUpdateBody,
    expectedVersion: number,
  ): Promise<SalesChannel> {
    const channel = await this.requireByCode(code);

    if (channel.version !== expectedVersion) {
      throw new HttpError(
        412,
        ERROR_CODES.STALE_SALES_CHANNEL_WRITE,
        `Sales channel "${channel.code}" was modified by another writer; ` +
          `current version is ${channel.version}, your If-Match was ${expectedVersion}.`,
        [{ path: 'version', issue: String(channel.version) }],
      );
    }

    // D-50 — a channel's code is written once, at creation, and is immutable
    // afterwards; on every channel, not only the system default. The code is an
    // identity other systems hold: `SALES_CHANNEL_HOST_MAP` names it in
    // deployment configuration, integrations pin it, and the channel cache is
    // keyed by it — `emitIdentityChanged` carries only the new code, so a rename
    // would leave the old key resolving until its TTL expired. The refusal here
    // is what makes that leak unreachable rather than merely unused: the admin
    // form has always locked the field, but this is the only writer of
    // `channel.code` in the tree, so the API is where the guarantee has to hold.
    // A mistyped code is fixed by creating the channel again under the right one
    // and deleting the old — for the default channel, after `setDefault` has
    // moved the flag off it.
    //
    // Checked before the dictionary validation below, so an attempted rename is
    // refused for the reason that matters rather than for whatever the rest of
    // the body happens to trip on.
    if (body.code !== undefined && body.code !== channel.code) {
      throw new HttpError(
        422,
        ERROR_CODES.SALES_CHANNEL_CODE_IMMUTABLE,
        `Sales channel "${channel.code}" cannot be renamed to "${body.code}": a channel code is ` +
          `set when the channel is created and is immutable afterwards. Create a channel with ` +
          `the right code and delete this one instead. The display name stays editable.`,
        [{ path: 'code', issue: body.code }],
      );
    }

    if (body.languages !== undefined) {
      await this.assertLanguagesValid(body.languages, channel.languages);
    }
    if (body.defaultLanguage !== undefined) {
      await this.validateLanguage(
        body.defaultLanguage,
        dispatchValidatorMode(channel.defaultLanguage, body.defaultLanguage),
        'defaultLanguage',
      );
    }
    if (body.currencies !== undefined) {
      await this.assertCurrenciesValid(body.currencies, channel.currencies);
    }
    if (body.defaultCurrency !== undefined) {
      await this.validateCurrency(
        body.defaultCurrency,
        dispatchValidatorMode(channel.defaultCurrency, body.defaultCurrency),
        'defaultCurrency',
      );
    }

    // Cross-field check: defaultLanguage ∈ effective languages,
    // defaultCurrency ∈ effective currencies. The Zod schema already
    // checks this when both fields are present in the body; this is the
    // fallback when only one of the pair is patched.
    const effectiveLanguages = body.languages ?? channel.languages;
    const effectiveDefaultLang = body.defaultLanguage ?? channel.defaultLanguage;
    if (!effectiveLanguages.includes(effectiveDefaultLang)) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'defaultLanguage must be one of languages.',
        [{ path: 'defaultLanguage', issue: effectiveDefaultLang }],
      );
    }
    const effectiveCurrencies = body.currencies ?? channel.currencies;
    const effectiveDefaultCurrency = body.defaultCurrency ?? channel.defaultCurrency;
    if (!effectiveCurrencies.includes(effectiveDefaultCurrency)) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'defaultCurrency must be one of currencies.',
        [{ path: 'defaultCurrency', issue: effectiveDefaultCurrency }],
      );
    }

    // The system default cannot be deactivated. The Command refuses it too;
    // refusing here as well keeps the answer independent of the transaction.
    if (body.active === false && channel.systemDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
        `Sales channel "${channel.code}" is the system default and cannot be deactivated.`,
      );
    }

    await this.assertLogoLinkable(body.logoAssetId, channel.logoAssetId ?? null);

    const updated = await this.commandBus.run(
      makeUpdateSalesChannelCommand(channel.id, body, expectedVersion),
    );
    // D-93 — committed by now, so drop, then announce. The access step reads
    // `anonymousAccess` off the cached channel this drops.
    await this.emitIdentityChanged(updated.code);
    return updated;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async deactivate(code: string, context?: AdminAuditContext): Promise<SalesChannel> {
    const em = this.emFactory();
    const channel = await this.requireByCode(code);
    if (channel.systemDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
        `Sales channel "${channel.code}" is the system default and cannot be deactivated.`,
      );
    }
    if (!channel.active) return channel; // idempotent
    channel.active = false;
    channel.status = 'inactive';
    channel.version += 1;
    await em.persist(channel).flush();

    await this.auditLifecycle(context, channel.id, {
      action: 'deactivated',
      channelCode: channel.code,
    });
    await this.emitLifecycleChanged(channel.code);
    return channel;
  }

  async activate(code: string, context?: AdminAuditContext): Promise<SalesChannel> {
    const em = this.emFactory();
    const channel = await this.requireByCode(code);
    if (channel.active) return channel; // idempotent
    channel.active = true;
    channel.status = 'active';
    channel.version += 1;
    await em.persist(channel).flush();

    await this.auditLifecycle(context, channel.id, {
      action: 'activated',
      channelCode: channel.code,
    });
    await this.emitLifecycleChanged(channel.code);
    return channel;
  }

  /**
   * Move the `system_default` flag to `code` — feature 072 / D-51.
   *
   * The write itself is a Command, so the audit row, the demote-then-promote
   * ordering and the transaction all live in `commands/set-default.command.ts`.
   * What belongs here is the 404 for a code nobody has, produced before the
   * transaction so an operator's typo is not an aborted transaction, and the
   * cache drop below.
   *
   * Unlike the rest of this class it writes no audit row of its own: the
   * Command Bus writes exactly one, and a second would be the double-audit the
   * coverage check exists to catch.
   */
  async setDefault(code: string): Promise<SetSystemDefaultChannelResult> {
    const channel = await this.requireByCode(code);
    const result = await this.commandBus.run(makeSetSystemDefaultChannelCommand(channel.id));

    // D-93 — this is the flag move's drop, not a second one: the Command's
    // `lifecycle_changed{invalidateAll}` event is now an announcement to other
    // modules and invalidates nothing. Two rows changed and the cached value
    // carries `systemDefault` inside it, so the demoted channel's entry is
    // stale too; `invalidateAll` is the cheapest correct answer.
    //
    // It sits **here**, after `CommandBus.run` has returned, rather than inside
    // the Command's `run` where it would precede the buffered event. The
    // ordering the other writers get — drop, then announce — is worth less than
    // the one this position buys: the drop happens after the transaction has
    // committed, so a concurrent read cannot resolve the pre-commit row from
    // Postgres and re-pin it into a cache that has just been emptied. That is
    // the same "after the flush" rule `SettingsAdminService` states at its own
    // write seam, and nothing reads this cache inside the Command.
    if (result.changed) await this.cache?.invalidateAllAfterWrite();
    return result;
  }

  async delete(
    code: string,
    options: DeleteOptions = {},
    context?: AdminAuditContext,
  ): Promise<void> {
    const em = this.emFactory();
    const channel = await this.requireByCode(code);
    if (channel.systemDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
        `Sales channel "${channel.code}" is the system default and cannot be deleted.`,
      );
    }

    // FR-006: refuse hard-delete when historical attributions exist.
    //
    // Asked of the modules that record them rather than answered here (feature
    // 075, D-87). This used to be one statement naming `orders` and
    // `quote_requests` — two other modules' tables and two other modules'
    // column names, invisible to the import-level boundary check because raw
    // SQL names no specifier, and wrong the moment either owner changed how it
    // stores the attribution. Each owner counts its own rows now and says what
    // to call them; an owner that is switched off is still counted, which is
    // this registry's stated policy and the only one the `on delete restrict`
    // foreign key underneath agrees with.
    const attributions = await this.attributionRegistry.countForChannel(channel.id);
    if (attributions.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.SALES_CHANNEL_HAS_ATTRIBUTIONS,
        `Sales channel "${channel.code}" cannot be deleted while ` +
          `${attributions.map((a) => `${a.count} ${a.consumer}`).join(' and ')} reference it. ` +
          `Deactivate the channel instead.`,
        attributions.map((a) => ({ path: a.consumer, issue: String(a.count) })),
      );
    }

    // FR-007: orphan check across every bridge. Returns the (entityType,entityId)
    // pairs that would have zero memberships if this channel were removed.
    const orphans = await this.findOrphansForChannel(em, channel.id);
    if (orphans.length > 0 && !options.fallbackToDefault) {
      throw new HttpError(
        422,
        ERROR_CODES.ENTITY_WOULD_HAVE_ZERO_CHANNELS,
        `Deleting sales channel "${channel.code}" would orphan ${orphans.length} channel-scoped ` +
          `entity(ies). Pass fallbackToDefault=true to rebind them to the system default.`,
        orphans.slice(0, 10).map((o) => ({ path: o.entityType, issue: o.entityId })),
      );
    }

    if (orphans.length > 0) {
      const defaultId = await this.requireSystemDefaultId(em);
      await this.rebindOrphansToDefault(em, defaultId, orphans);
    }

    await em.remove(channel).flush();
    await this.accessCache?.invalidateAllAfterWrite();

    await this.auditLifecycle(context, channel.id, {
      action: 'deleted',
      channelCode: channel.code,
      rebindCount: orphans.length,
    });
    await this.emitLifecycleChanged(channel.code, /*invalidateAll=*/ true);
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async requireByCode(code: string): Promise<SalesChannel> {
    const channel = await this.getByCode(code);
    if (channel === null) {
      throw new HttpError(
        404,
        ERROR_CODES.NOT_FOUND,
        `Sales channel "${code}" was not found.`,
      );
    }
    return channel;
  }

  private async assertLanguagesValid(
    codes: string[],
    currentCodes: string[] = [],
  ): Promise<void> {
    if (codes.length === 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'languages must not be empty.',
        [{ path: 'languages', issue: 'empty' }],
      );
    }
    const current = new Set(currentCodes);
    for (const code of codes) {
      await this.validateLanguage(
        code,
        current.has(code) ? 'unchanged' : 'create-or-change',
        'languages',
      );
    }
  }

  private async assertCurrenciesValid(
    codes: string[],
    currentCodes: string[] = [],
  ): Promise<void> {
    if (codes.length === 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'currencies must not be empty.',
        [{ path: 'currencies', issue: 'empty' }],
      );
    }
    const current = new Set(currentCodes);
    for (const code of codes) {
      await this.validateCurrency(
        code,
        current.has(code) ? 'unchanged' : 'create-or-change',
        'currencies',
      );
    }
  }

  private async validateLanguage(
    code: string,
    mode: 'create-or-change' | 'unchanged',
    field: string,
  ): Promise<void> {
    try {
      await this.dictionaryValidator.validateLanguageCode(code, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw dictionaryReferenceHttpError(err, field);
      }
      throw err;
    }
  }

  private async validateCurrency(
    code: string,
    mode: 'create-or-change' | 'unchanged',
    field: string,
  ): Promise<void> {
    try {
      await this.dictionaryValidator.validateCurrencyCode(code, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw dictionaryReferenceHttpError(err, field);
      }
      throw err;
    }
  }

  /**
   * Read through the kernel's own entity rather than the raw statement this
   * replaces (feature 075, D-87). `sales_channels` is the kernel's table since
   * feature 072 moved the resolution machinery there, and a module relating
   * into the kernel by ORM is the sanctioned access — it was the SQL, not the
   * read, that crossed a boundary nothing could see. It reads through the
   * caller's `em` on purpose: this runs inside the delete path, so the
   * resolver's own fork would not see that path's uncommitted state.
   */
  private async requireSystemDefaultId(em: EntityManager): Promise<string> {
    const channel = await em.findOne(SalesChannel, { systemDefault: true });
    if (channel === null) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'No system-default sales channel found; cannot apply fallback.',
      );
    }
    return channel.id;
  }

  /**
   * For every M:N bridge, find the entities whose ONLY channel membership is
   * `channelId`. Returned shape is the (entityType, entityId) pair so the
   * delete path can either refuse with a sample list or rebind to Default.
   */
  private async findOrphansForChannel(
    em: EntityManager,
    channelId: string,
  ): Promise<Array<{ entityType: string; entityId: string; bridgeTable: string; entityIdColumn: string }>> {
    const orphans: Array<{
      entityType: string;
      entityId: string;
      bridgeTable: string;
      entityIdColumn: string;
    }> = [];
    for (const bridge of this.bridgeRegistry.list()) {
      const rows = await em
        .getConnection()
        .execute<Array<{ entity_id: string }>>(
          `select b."${bridge.entityIdColumn}" as entity_id ` +
            `from "${bridge.table}" b ` +
            `where b."sales_channel_id" = ? ` +
            `and not exists ( ` +
            `  select 1 from "${bridge.table}" b2 ` +
            `  where b2."${bridge.entityIdColumn}" = b."${bridge.entityIdColumn}" ` +
            `    and b2."sales_channel_id" <> b."sales_channel_id" ` +
            `)`,
          [channelId],
          'all',
          em.getTransactionContext(),
        );
      for (const r of rows) {
        orphans.push({
          entityType: bridge.entityType,
          entityId: r.entity_id,
          bridgeTable: bridge.table,
          entityIdColumn: bridge.entityIdColumn,
        });
      }
    }
    return orphans;
  }

  private async rebindOrphansToDefault(
    em: EntityManager,
    defaultId: string,
    orphans: Array<{ entityId: string; bridgeTable: string; entityIdColumn: string }>,
  ): Promise<void> {
    for (const o of orphans) {
      await em
        .getConnection()
        .execute(
          `insert into "${o.bridgeTable}" ("sales_channel_id", "${o.entityIdColumn}") ` +
            `values (?, ?) ` +
            `on conflict ("sales_channel_id", "${o.entityIdColumn}") do nothing`,
          [defaultId, o.entityId],
          'run',
          em.getTransactionContext(),
        );
    }
  }

  /** The lifecycle writes' hand-written row; identity writes are audited by the Command Bus. */
  private async auditLifecycle(
    context: AdminAuditContext | undefined,
    channelId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.record({
      actorAdminUserId: context?.actorAdminUserId ?? null,
      action: SALES_CHANNEL_AUDIT_ACTIONS.LIFECYCLE_CHANGED,
      objectType: 'sales_channel',
      objectId: channelId,
      stateAfter: payload,
      ...(context?.requestId ? { requestId: context.requestId } : {}),
    });
  }

  /**
   * Drop the cache, then announce (D-93).
   *
   * The drop runs **after the flush** — for an identity write, after
   * `CommandBus.run` has committed — so a concurrent read cannot re-pin the
   * pre-commit row, and **before the emit**, so every subscriber re-reads
   * post-invalidation state. The count is deliberately unread:
   * `invalidateAfterWrite` answers `null` for an unreachable shared layer, and
   * the row is written and audited by the time we are here, so there is nothing
   * this method could truthfully do with it. Reads stay correct meanwhile — the
   * cache bypasses the marked prefix until a later drop succeeds.
   */
  private async emitIdentityChanged(channelCode: string): Promise<void> {
    await this.cache?.invalidateAfterWrite(channelCode);
    this.eventBus.emit('sales_channels.identity_changed', {
      eventId: `sales_channels.identity_changed:${channelCode}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      channelCode,
    } as never);
  }

  /** Same seam as {@link emitIdentityChanged}; see its comment for the ordering. */
  private async emitLifecycleChanged(channelCode: string, invalidateAll = false): Promise<void> {
    // `invalidateAll` is the caller saying more than one channel's cached state
    // moved — a delete that rebinds orphans, or a flag move — and the cached
    // value carries `systemDefault` inside it, so the other channel's entry is
    // stale too.
    if (invalidateAll) await this.cache?.invalidateAllAfterWrite();
    else await this.cache?.invalidateAfterWrite(channelCode);
    this.eventBus.emit('sales_channels.lifecycle_changed', {
      eventId: `sales_channels.lifecycle_changed:${channelCode}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      channelCode,
      invalidateAll,
    } as never);
  }
}

function dictionaryReferenceHttpError(err: DictionaryReferenceError, field: string): HttpError {
  const noun = err.entryType === 'currency' ? 'Currency' : 'Language';
  return new HttpError(
    409,
    err.code,
    err.code === 'DICTIONARY_ENTRY_INACTIVE'
      ? `${noun} code ${err.entryCode} is no longer available for sales channels.`
      : `${noun} code ${err.entryCode} is not recognised.`,
    [{ path: field, issue: err.code }],
  );
}
