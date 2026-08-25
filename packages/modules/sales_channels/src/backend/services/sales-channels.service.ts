import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  dispatchValidatorMode,
  type DictionaryValidator,
  type SalesChannelAttributionRegistryPort,
  type SalesChannelCreateBody,
  type SalesChannelUpdateBody,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { EventBus } from '@endora-commerce/platform/events';
import { SalesChannel } from '@endora-commerce/platform/kernel';
import type { SalesChannelsCacheInvalidation } from '@endora-commerce/platform/kernel';
import {
  makeSetSystemDefaultChannelCommand,
  type SetSystemDefaultChannelResult,
} from '../commands/set-default.command.js';

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
 * (`sales_channel.identity.changed` / `sales_channel.lifecycle.changed`)
 * synchronously, **drops the channel cache**, and then emits one EventBus
 * event.
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
 * `setDefault` is the exception and the newer pattern: it is a Command
 * (feature 072 / D-51), so the Command Bus writes its audit row and buffers its
 * event co-transactionally, and this class writes neither by hand.
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
    private readonly auditLogService?: AuditPort,
    /**
     * The invalidating half of the channel cache, narrowed to what a writer
     * needs (D-93). A service that can only invalidate cannot seed the cache
     * from the write path, which is the reader's job.
     */
    private readonly cache?: SalesChannelsCacheInvalidation,
    /**
     * Used by `setDefault` only, which is a Command (Principle XIII) rather than
     * a hand-audited write like the rest of this class. Still optional — and
     * `setDefault` refuses outright when it is missing, so the absence can never
     * become an unaudited flag move.
     */
    private readonly commandBus?: CommandBus,
  ) {}

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
      orderBy: { createdAt: 'asc' },
      offset: page * pageSize,
      limit: pageSize,
    });
    return { items, page, pageSize, total };
  }

  // -------------------------------------------------------------------------
  // Create
  // -------------------------------------------------------------------------

  async create(
    body: SalesChannelCreateBody,
    context?: AdminAuditContext,
  ): Promise<SalesChannel> {
    const em = this.emFactory();

    await this.assertLanguagesValid(body.languages);
    await this.validateLanguage(body.defaultLanguage, 'create-or-change', 'defaultLanguage');
    await this.assertCurrenciesValid(body.currencies);
    await this.validateCurrency(body.defaultCurrency, 'create-or-change', 'defaultCurrency');

    const channel = em.create(SalesChannel, {
      code: body.code,
      name: body.name,
      logoAssetId: body.logoAssetId ?? null,
      themeCode: body.themeCode ?? null,
      languages: body.languages,
      defaultLanguage: body.defaultLanguage,
      currencies: body.currencies,
      defaultCurrency: body.defaultCurrency,
      active: body.active ?? true,
      systemDefault: false,
      version: 1,
      // Legacy columns preserved for one release (research R-12).
      isPublic: false,
      status: (body.active ?? true) ? 'active' : 'inactive',
    });

    try {
      await em.persistAndFlush(channel);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.DUPLICATE_SALES_CHANNEL_CODE,
          `Sales channel code "${body.code}" is already in use.`,
        );
      }
      throw err;
    }

    await this.audit('identity', context, channel.id, {
      action: 'created',
      after: this.snapshot(channel),
    });
    await this.emitIdentityChanged(channel.code);
    return channel;
  }

  // -------------------------------------------------------------------------
  // Update (FR-005 optimistic concurrency)
  // -------------------------------------------------------------------------

  async update(
    code: string,
    body: SalesChannelUpdateBody,
    expectedVersion: number,
    context?: AdminAuditContext,
  ): Promise<SalesChannel> {
    const em = this.emFactory();
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

    const before = this.snapshot(channel);

    if (body.name !== undefined) channel.name = body.name;
    if (body.logoAssetId !== undefined) channel.logoAssetId = body.logoAssetId;
    if (body.themeCode !== undefined) channel.themeCode = body.themeCode;
    if (body.languages !== undefined) channel.languages = body.languages;
    if (body.defaultLanguage !== undefined) channel.defaultLanguage = body.defaultLanguage;
    if (body.currencies !== undefined) channel.currencies = body.currencies;
    if (body.defaultCurrency !== undefined) channel.defaultCurrency = body.defaultCurrency;
    if (body.active !== undefined) {
      if (channel.systemDefault && body.active === false) {
        throw new HttpError(
          422,
          ERROR_CODES.CANNOT_MODIFY_SYSTEM_DEFAULT,
          `Sales channel "${channel.code}" is the system default and cannot be deactivated.`,
        );
      }
      channel.active = body.active;
      channel.status = body.active ? 'active' : 'inactive';
    }
    channel.version += 1;

    try {
      await em.persistAndFlush(channel);
    } catch (err) {
      if (err instanceof UniqueConstraintViolationException) {
        throw new HttpError(
          409,
          ERROR_CODES.DUPLICATE_SALES_CHANNEL_CODE,
          `Sales channel code "${body.code ?? channel.code}" is already in use.`,
        );
      }
      throw err;
    }

    await this.audit('identity', context, channel.id, {
      action: 'updated',
      before,
      after: this.snapshot(channel),
    });
    await this.emitIdentityChanged(channel.code);
    return channel;
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
    await em.persistAndFlush(channel);

    await this.audit('lifecycle', context, channel.id, {
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
    await em.persistAndFlush(channel);

    await this.audit('lifecycle', context, channel.id, {
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
    if (!this.commandBus) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Sales channels are composed without a Command Bus; the system default cannot be moved.',
      );
    }

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

    await em.removeAndFlush(channel);

    await this.audit('lifecycle', context, channel.id, {
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
    for (const bridge of BRIDGE_TABLES) {
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

  private snapshot(c: SalesChannel): Record<string, unknown> {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      logoAssetId: c.logoAssetId ?? null,
      themeCode: c.themeCode ?? null,
      languages: c.languages,
      defaultLanguage: c.defaultLanguage,
      currencies: c.currencies,
      defaultCurrency: c.defaultCurrency,
      active: c.active,
      systemDefault: c.systemDefault,
      version: c.version,
    };
  }

  private async audit(
    kind: 'identity' | 'lifecycle',
    context: AdminAuditContext | undefined,
    channelId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.auditLogService) return;
    await this.auditLogService.record({
      actorAdminUserId: context?.actorAdminUserId ?? null,
      action:
        kind === 'identity'
          ? SALES_CHANNEL_AUDIT_ACTIONS.IDENTITY_CHANGED
          : SALES_CHANNEL_AUDIT_ACTIONS.LIFECYCLE_CHANGED,
      objectType: 'sales_channel',
      objectId: channelId,
      stateAfter: payload,
      ...(context?.requestId ? { requestId: context.requestId } : {}),
    });
  }

  /**
   * Drop the cache, then announce (D-93).
   *
   * The drop runs **after the flush**, so a concurrent read cannot re-pin the
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

/**
 * The set of M:N bridge tables this service can hard-delete-cascade through.
 * Mirrors the entity-type vocabulary used by `SalesChannelMembershipService`
 * but kept locally to avoid a circular import between the two services.
 */
const BRIDGE_TABLES: ReadonlyArray<{
  entityType: string;
  table: string;
  entityIdColumn: string;
}> = [
  { entityType: 'product', table: 'sales_channel_products', entityIdColumn: 'product_id' },
  { entityType: 'category', table: 'sales_channel_categories', entityIdColumn: 'category_id' },
  {
    entityType: 'payment-method',
    table: 'sales_channel_payment_methods',
    entityIdColumn: 'payment_method_id',
  },
  {
    entityType: 'delivery-method',
    table: 'sales_channel_delivery_methods',
    entityIdColumn: 'delivery_method_id',
  },
  {
    entityType: 'organization',
    table: 'sales_channel_organizations',
    entityIdColumn: 'organization_id',
  },
  { entityType: 'tax', table: 'sales_channel_taxes', entityIdColumn: 'tax_id' },
  {
    entityType: 'customer',
    table: 'sales_channel_customer_accounts',
    entityIdColumn: 'customer_account_id',
  },
  { entityType: 'promotion', table: 'sales_channel_promotions', entityIdColumn: 'promotion_id' },
  { entityType: 'cms-page', table: 'sales_channel_cms_pages', entityIdColumn: 'cms_page_id' },
];

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
