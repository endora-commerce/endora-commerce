import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type GaCustomEventCreate,
  type GaCustomEventUpdate,
  type GaCustomEventResponse,
  type GaCustomEventListQuery,
  type GaStorefrontCustomEvent,
  type GaTriggerAction,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { GaCustomEvent } from '../entities/ga-custom-event.entity.js';

/**
 * Sales-channel code ⇄ id port. Injected so the module stays isolated from the
 * sales_channels internals (Principle I).
 */
export interface GaChannelPort {
  idByCode(code: string): Promise<string | null>;
  codeById(id: string): Promise<string | null>;
}

/** Audit context resolved from the request at the route layer. */
export interface GaAuditContext {
  actorAdminUserId: string | null;
}

export interface GaAuditSink {
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
 * CRUD + storefront resolution for GA custom events (feature 049, US3).
 * Boundary validation (buttonId⇄action, static-field-set) is enforced by the
 * Zod schemas at the route; this service owns channel-code resolution, the
 * optimistic-version guard, persistence, and audit.
 */
export class GaCustomEventsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly channels: GaChannelPort,
    private readonly audit?: GaAuditSink,
    /** Fired after a create/update/delete so callers can invalidate caches. */
    private readonly onChange?: () => void,
  ) {}

  async list(query: GaCustomEventListQuery): Promise<GaCustomEventResponse[]> {
    const em = this.emFactory();
    const where: Record<string, unknown> = {};
    if (query.salesChannelCode !== undefined) {
      const id = await this.channels.idByCode(query.salesChannelCode);
      where['salesChannelId'] = id;
    }
    if (query.triggerAction !== undefined) {
      where['triggerAction'] = query.triggerAction;
    }
    const rows = await em.find(GaCustomEvent, where, { orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async get(id: string): Promise<GaCustomEventResponse> {
    const em = this.emFactory();
    const row = await em.findOne(GaCustomEvent, { id });
    if (!row) throw this.notFound(id);
    return this.toDto(row);
  }

  async create(input: GaCustomEventCreate, ctx: GaAuditContext): Promise<GaCustomEventResponse> {
    const em = this.emFactory();
    const salesChannelId = await this.resolveChannelId(input.salesChannelCode);
    const row = em.create(GaCustomEvent, {
      salesChannelId,
      eventName: input.eventName,
      triggerAction: input.triggerAction,
      buttonId: input.buttonId ?? null,
      enabled: input.enabled,
      fields: input.fields,
    });
    await em.persistAndFlush(row);
    await this.audit?.record({
      action: 'google_analytics.custom_event.created',
      objectType: 'ga_custom_event',
      objectId: row.id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateAfter: { eventName: row.eventName, triggerAction: row.triggerAction },
    });
    this.onChange?.();
    return this.toDto(row);
  }

  async update(
    id: string,
    input: GaCustomEventUpdate,
    ctx: GaAuditContext,
  ): Promise<GaCustomEventResponse> {
    const em = this.emFactory();
    const row = await em.findOne(GaCustomEvent, { id });
    if (!row) throw this.notFound(id);
    if (row.version !== input.version) {
      throw new HttpError(409, ERROR_CODES.VERSION_CONFLICT, 'Custom event was modified concurrently.');
    }
    const before = { eventName: row.eventName, triggerAction: row.triggerAction, enabled: row.enabled };

    if (input.salesChannelCode !== undefined) {
      row.salesChannelId =
        input.salesChannelCode === null ? null : await this.resolveChannelId(input.salesChannelCode);
    }
    if (input.eventName !== undefined) row.eventName = input.eventName;
    if (input.triggerAction !== undefined) row.triggerAction = input.triggerAction;
    if (input.buttonId !== undefined) row.buttonId = input.buttonId;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    if (input.fields !== undefined) row.fields = input.fields;
    row.version += 1;
    await em.persistAndFlush(row);

    await this.audit?.record({
      action: 'google_analytics.custom_event.updated',
      objectType: 'ga_custom_event',
      objectId: row.id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateBefore: before,
      stateAfter: { eventName: row.eventName, triggerAction: row.triggerAction, enabled: row.enabled },
    });
    this.onChange?.();
    return this.toDto(row);
  }

  async remove(id: string, ctx: GaAuditContext): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(GaCustomEvent, { id });
    if (!row) throw this.notFound(id);
    await em.removeAndFlush(row);
    await this.audit?.record({
      action: 'google_analytics.custom_event.deleted',
      objectType: 'ga_custom_event',
      objectId: id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateBefore: { eventName: row.eventName, triggerAction: row.triggerAction },
    });
    this.onChange?.();
  }

  /**
   * Enabled events applicable to a channel (channel-scoped OR all-channels),
   * mapped to the storefront shape. Used by GaConfigService.
   */
  async loadForChannel(salesChannelId: string): Promise<GaStorefrontCustomEvent[]> {
    const em = this.emFactory();
    const rows = await em.find(
      GaCustomEvent,
      { enabled: true, $or: [{ salesChannelId: null }, { salesChannelId }] },
      { orderBy: { createdAt: 'asc' } },
    );
    return rows.map((r) => ({
      eventName: r.eventName,
      triggerAction: r.triggerAction as GaTriggerAction,
      buttonId: r.buttonId,
      fields: r.fields.map((f) => ({ fieldKey: f.fieldKey, payloadKey: f.payloadKey ?? f.fieldKey })),
    }));
  }

  private async resolveChannelId(code: string | undefined): Promise<string | null> {
    if (code === undefined) return null;
    const id = await this.channels.idByCode(code);
    if (id === null) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, `Unknown sales channel: ${code}`);
    }
    return id;
  }

  private notFound(id: string): HttpError {
    return new HttpError(404, ERROR_CODES.NOT_FOUND, `Custom event not found: ${id}`);
  }

  private async toDto(row: GaCustomEvent): Promise<GaCustomEventResponse> {
    const salesChannelCode =
      row.salesChannelId === null ? null : await this.channels.codeById(row.salesChannelId);
    return {
      id: row.id,
      salesChannelCode,
      eventName: row.eventName,
      triggerAction: row.triggerAction as GaTriggerAction,
      buttonId: row.buttonId ?? null,
      enabled: row.enabled,
      fields: row.fields ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  }
}
