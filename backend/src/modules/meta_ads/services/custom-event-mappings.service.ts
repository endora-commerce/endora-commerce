import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type CreateMetaCustomEventMapping,
  type MetaCustomEventMapping as MetaCustomEventMappingDto,
  type MetaStorefrontMapping,
  type MetaTriggerAction,
  type UpdateMetaCustomEventMapping,
} from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { MetaCustomEventMapping } from '../entities/meta-custom-event-mapping.entity.js';

export interface MetaAuditContext {
  actorAdminUserId: string | null;
}

export interface MetaAuditSink {
  record(input: {
    action: string;
    objectType: string;
    objectId: string;
    actorAdminUserId?: string | null;
    stateBefore?: Record<string, unknown>;
    stateAfter?: Record<string, unknown>;
  }): Promise<unknown>;
}

/**
 * CRUD + storefront resolution for Meta custom-event mappings (feature 064,
 * US4). Boundary validation lives in the Zod schemas at the route; this service
 * owns the optimistic-version guard, persistence, and audit.
 */
export class MetaCustomEventMappingsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly audit?: MetaAuditSink,
    private readonly onChange?: () => void,
  ) {}

  async list(): Promise<MetaCustomEventMappingDto[]> {
    const em = this.emFactory();
    const rows = await em.find(MetaCustomEventMapping, {}, { orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<MetaCustomEventMappingDto> {
    const em = this.emFactory();
    const row = await em.findOne(MetaCustomEventMapping, { id });
    if (!row) throw this.notFound(id);
    return this.toDto(row);
  }

  async create(
    input: CreateMetaCustomEventMapping,
    ctx: MetaAuditContext,
  ): Promise<MetaCustomEventMappingDto> {
    const em = this.emFactory();
    const row = em.create(MetaCustomEventMapping, {
      salesChannelId: input.salesChannelId ?? null,
      triggerAction: input.triggerAction,
      eventName: input.eventName,
      enabled: input.enabled ?? true,
    });
    await em.persistAndFlush(row);
    await this.audit?.record({
      action: 'meta_ads.custom_event.created',
      objectType: 'meta_custom_event_mapping',
      objectId: row.id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateAfter: { triggerAction: row.triggerAction, eventName: row.eventName },
    });
    this.onChange?.();
    return this.toDto(row);
  }

  async update(
    id: string,
    input: UpdateMetaCustomEventMapping,
    ctx: MetaAuditContext,
  ): Promise<MetaCustomEventMappingDto> {
    const em = this.emFactory();
    const row = await em.findOne(MetaCustomEventMapping, { id });
    if (!row) throw this.notFound(id);
    if (row.version !== input.version) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Custom event mapping was modified concurrently.',
      );
    }
    const before = {
      triggerAction: row.triggerAction,
      eventName: row.eventName,
      enabled: row.enabled,
    };

    if (input.salesChannelId !== undefined) row.salesChannelId = input.salesChannelId;
    if (input.triggerAction !== undefined) row.triggerAction = input.triggerAction;
    if (input.eventName !== undefined) row.eventName = input.eventName;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    row.version += 1;
    await em.persistAndFlush(row);

    await this.audit?.record({
      action: 'meta_ads.custom_event.updated',
      objectType: 'meta_custom_event_mapping',
      objectId: row.id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateBefore: before,
      stateAfter: {
        triggerAction: row.triggerAction,
        eventName: row.eventName,
        enabled: row.enabled,
      },
    });
    this.onChange?.();
    return this.toDto(row);
  }

  async remove(id: string, ctx: MetaAuditContext): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(MetaCustomEventMapping, { id });
    if (!row) throw this.notFound(id);
    const before = { triggerAction: row.triggerAction, eventName: row.eventName };
    await em.removeAndFlush(row);
    await this.audit?.record({
      action: 'meta_ads.custom_event.deleted',
      objectType: 'meta_custom_event_mapping',
      objectId: id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateBefore: before,
    });
    this.onChange?.();
  }

  /**
   * Enabled mappings applicable to a channel (channel-scoped OR all-channels).
   * A NULL `salesChannelId` means "every channel" by explicit design, not by
   * fail-open (Principle XII).
   */
  async loadForChannel(salesChannelId: string): Promise<MetaStorefrontMapping[]> {
    const em = this.emFactory();
    const rows = await em.find(
      MetaCustomEventMapping,
      { enabled: true, $or: [{ salesChannelId: null }, { salesChannelId }] },
      { orderBy: { createdAt: 'asc' } },
    );
    return rows.map((r) => ({
      triggerAction: r.triggerAction as MetaTriggerAction,
      eventName: r.eventName,
    }));
  }

  private notFound(id: string): HttpError {
    return new HttpError(404, ERROR_CODES.NOT_FOUND, `Custom event mapping not found: ${id}`);
  }

  private toDto(row: MetaCustomEventMapping): MetaCustomEventMappingDto {
    return {
      id: row.id,
      // `?? null` because a freshly-created entity leaves an omitted optional
      // property undefined, and JSON.stringify would drop the key entirely.
      salesChannelId: row.salesChannelId ?? null,
      triggerAction: row.triggerAction as MetaTriggerAction,
      eventName: row.eventName,
      enabled: row.enabled,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
