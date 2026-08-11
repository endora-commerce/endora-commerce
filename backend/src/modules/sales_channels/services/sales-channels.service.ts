import type { EntityManager } from '@mikro-orm/postgresql';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import {
  DictionaryReferenceError,
  ERROR_CODES,
  SALES_CHANNEL_AUDIT_ACTIONS,
  type DictionaryValidator,
  type SalesChannelCreateBody,
  type SalesChannelUpdateBody,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { dispatchValidatorMode } from '../../dictionaries/services/dispatch-validator-mode.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import type { EventBus } from '../../../events/bus.js';
import { SalesChannel } from '../../../kernel/sales-channels/sales-channel.entity.js';
import type { SalesChannelsCache } from '../../../kernel/sales-channels/sales-channels-cache.js';

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
 * synchronously and emits one EventBus event so the cache invalidator
 * (T012) drops stale entries.
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
    private readonly auditLogService?: AuditLogService,
    private readonly cache?: SalesChannelsCache,
    private readonly dictionaryValidator?: DictionaryValidator,
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

    await this.assertLanguagesValid(em, body.languages);
    await this.validateLanguage(body.defaultLanguage, 'create-or-change', 'defaultLanguage');
    await this.assertCurrenciesValid(em, body.currencies);
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
    this.emitIdentityChanged(channel.code);
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

    if (body.languages !== undefined) {
      await this.assertLanguagesValid(em, body.languages, channel.languages);
    }
    if (body.defaultLanguage !== undefined) {
      await this.validateLanguage(
        body.defaultLanguage,
        dispatchValidatorMode(channel.defaultLanguage, body.defaultLanguage),
        'defaultLanguage',
      );
    }
    if (body.currencies !== undefined) {
      await this.assertCurrenciesValid(em, body.currencies, channel.currencies);
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

    if (body.code !== undefined && body.code !== channel.code) {
      channel.code = body.code;
    }
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
    this.emitIdentityChanged(channel.code);
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
    this.emitLifecycleChanged(channel.code);
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
    this.emitLifecycleChanged(channel.code);
    return channel;
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

    // FR-006: refuse hard-delete when historical Order or Quote attributions exist.
    const attributions = await em
      .getConnection()
      .execute<Array<{ source: string; n: string }>>(
        `select 'orders' as source, count(*)::text as n from "orders" where "sales_channel_id" = ? ` +
          `union all ` +
          `select 'quote_requests' as source, count(*)::text as n from "quote_requests" where "sales_channel_id" = ?`,
        [channel.id, channel.id],
        'all',
        em.getTransactionContext(),
      );
    const orderCount = Number(attributions.find((r) => r.source === 'orders')?.n ?? '0');
    const quoteCount = Number(attributions.find((r) => r.source === 'quote_requests')?.n ?? '0');
    if (orderCount > 0 || quoteCount > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.SALES_CHANNEL_HAS_ATTRIBUTIONS,
        `Sales channel "${channel.code}" cannot be deleted while ${orderCount} order(s) and ` +
          `${quoteCount} quote(s) reference it. Deactivate the channel instead.`,
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
    this.emitLifecycleChanged(channel.code, /*invalidateAll=*/ true);
    if (this.cache) await this.cache.invalidateAll();
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
    em: EntityManager,
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
    if (this.dictionaryValidator) {
      const current = new Set(currentCodes);
      for (const code of codes) {
        await this.validateLanguage(
          code,
          current.has(code) ? 'unchanged' : 'create-or-change',
          'languages',
        );
      }
      return;
    }
    const placeholders = codes.map(() => '?').join(', ');
    const rows = await em
      .getConnection()
      .execute<Array<{ code: string }>>(
        `select "code" from "languages" where "code" in (${placeholders})`,
        codes,
        'all',
        em.getTransactionContext(),
      );
    const known = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.UNKNOWN_LANGUAGE_CODE,
        `Unknown language code(s): ${missing.join(', ')}.`,
        missing.map((m) => ({ path: 'languages', issue: m })),
      );
    }
  }

  private async assertCurrenciesValid(
    em: EntityManager,
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
    if (this.dictionaryValidator) {
      const current = new Set(currentCodes);
      for (const code of codes) {
        await this.validateCurrency(
          code,
          current.has(code) ? 'unchanged' : 'create-or-change',
          'currencies',
        );
      }
      return;
    }
    const placeholders = codes.map(() => '?').join(', ');
    const rows = await em
      .getConnection()
      .execute<Array<{ code: string }>>(
        `select "code" from "currencies" where "code" in (${placeholders})`,
        codes,
        'all',
        em.getTransactionContext(),
      );
    const known = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !known.has(c));
    if (missing.length > 0) {
      throw new HttpError(
        422,
        ERROR_CODES.UNKNOWN_CURRENCY_CODE,
        `Unknown currency code(s): ${missing.join(', ')}.`,
        missing.map((m) => ({ path: 'currencies', issue: m })),
      );
    }
  }

  private async validateLanguage(
    code: string,
    mode: 'create-or-change' | 'unchanged',
    field: string,
  ): Promise<void> {
    if (!this.dictionaryValidator) return;
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
    if (!this.dictionaryValidator) return;
    try {
      await this.dictionaryValidator.validateCurrencyCode(code, mode);
    } catch (err) {
      if (err instanceof DictionaryReferenceError) {
        throw dictionaryReferenceHttpError(err, field);
      }
      throw err;
    }
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

  private emitIdentityChanged(channelCode: string): void {
    this.eventBus.emit('sales_channels.identity_changed', {
      eventId: `sales_channels.identity_changed:${channelCode}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      channelCode,
    } as never);
  }

  private emitLifecycleChanged(channelCode: string, invalidateAll = false): void {
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
