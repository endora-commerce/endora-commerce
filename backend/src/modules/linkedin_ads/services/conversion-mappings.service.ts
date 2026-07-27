import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  conversionRuleUrnFor,
  type CreateLinkedInConversionMapping,
  type LinkedInConversionMapping as LinkedInConversionMappingDto,
  type LinkedInStorefrontMapping,
  type LinkedInTriggerAction,
  type UpdateLinkedInConversionMapping,
} from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { LinkedInConversionMapping } from '../entities/linkedin-conversion-mapping.entity.js';

/** Audit context resolved from the request at the route layer. */
export interface LinkedInAuditContext {
  actorAdminUserId: string | null;
}

export interface LinkedInAuditSink {
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
 * CRUD + storefront resolution for LinkedIn conversion mappings (feature 063,
 * US3). Boundary validation lives in the Zod schemas at the route; this service
 * owns the optimistic-version guard, persistence, and audit.
 */
export class LinkedInConversionMappingsService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly audit?: LinkedInAuditSink,
    /** Fired after a create/update/delete so callers can invalidate caches. */
    private readonly onChange?: () => void,
  ) {}

  async list(): Promise<LinkedInConversionMappingDto[]> {
    const em = this.emFactory();
    const rows = await em.find(LinkedInConversionMapping, {}, { orderBy: { createdAt: 'asc' } });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<LinkedInConversionMappingDto> {
    const em = this.emFactory();
    const row = await em.findOne(LinkedInConversionMapping, { id });
    if (!row) throw this.notFound(id);
    return this.toDto(row);
  }

  async create(
    input: CreateLinkedInConversionMapping,
    ctx: LinkedInAuditContext,
  ): Promise<LinkedInConversionMappingDto> {
    const em = this.emFactory();
    const row = em.create(LinkedInConversionMapping, {
      salesChannelId: input.salesChannelId ?? null,
      triggerAction: input.triggerAction,
      conversionId: input.conversionId,
      conversionRuleUrn: input.conversionRuleUrn ?? null,
      enabled: input.enabled ?? true,
    });
    await em.persistAndFlush(row);
    await this.audit?.record({
      action: 'linkedin_ads.conversion_mapping.created',
      objectType: 'linkedin_conversion_mapping',
      objectId: row.id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateAfter: { triggerAction: row.triggerAction, conversionId: row.conversionId },
    });
    this.onChange?.();
    return this.toDto(row);
  }

  async update(
    id: string,
    input: UpdateLinkedInConversionMapping,
    ctx: LinkedInAuditContext,
  ): Promise<LinkedInConversionMappingDto> {
    const em = this.emFactory();
    const row = await em.findOne(LinkedInConversionMapping, { id });
    if (!row) throw this.notFound(id);
    if (row.version !== input.version) {
      throw new HttpError(
        409,
        ERROR_CODES.VERSION_CONFLICT,
        'Conversion mapping was modified concurrently.',
      );
    }
    const before = {
      triggerAction: row.triggerAction,
      conversionId: row.conversionId,
      enabled: row.enabled,
    };

    if (input.salesChannelId !== undefined) row.salesChannelId = input.salesChannelId;
    if (input.triggerAction !== undefined) row.triggerAction = input.triggerAction;
    if (input.conversionId !== undefined) row.conversionId = input.conversionId;
    if (input.conversionRuleUrn !== undefined) row.conversionRuleUrn = input.conversionRuleUrn;
    if (input.enabled !== undefined) row.enabled = input.enabled;
    row.version += 1;
    await em.persistAndFlush(row);

    await this.audit?.record({
      action: 'linkedin_ads.conversion_mapping.updated',
      objectType: 'linkedin_conversion_mapping',
      objectId: row.id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateBefore: before,
      stateAfter: {
        triggerAction: row.triggerAction,
        conversionId: row.conversionId,
        enabled: row.enabled,
      },
    });
    this.onChange?.();
    return this.toDto(row);
  }

  async remove(id: string, ctx: LinkedInAuditContext): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(LinkedInConversionMapping, { id });
    if (!row) throw this.notFound(id);
    const before = { triggerAction: row.triggerAction, conversionId: row.conversionId };
    await em.removeAndFlush(row);
    await this.audit?.record({
      action: 'linkedin_ads.conversion_mapping.deleted',
      objectType: 'linkedin_conversion_mapping',
      objectId: id,
      actorAdminUserId: ctx.actorAdminUserId,
      stateBefore: before,
    });
    this.onChange?.();
  }

  /**
   * Enabled mappings applicable to a channel (channel-scoped OR all-channels),
   * in the storefront shape. A NULL `salesChannelId` means "every channel" by
   * explicit design, not by fail-open (Principle XII).
   */
  async loadForChannel(salesChannelId: string): Promise<LinkedInStorefrontMapping[]> {
    const rows = await this.findEnabledForChannel(salesChannelId);
    return rows.map((r) => ({
      triggerAction: r.triggerAction as LinkedInTriggerAction,
      conversionId: r.conversionId,
    }));
  }

  /**
   * Enabled mappings for one action on one channel, with the conversion rule
   * URN resolved — server-side delivery addresses a rule by URN, not by the
   * numeric id shown in Campaign Manager.
   */
  async loadRuleUrnsFor(
    salesChannelId: string,
    triggerAction: LinkedInTriggerAction,
  ): Promise<string[]> {
    const rows = await this.findEnabledForChannel(salesChannelId);
    return rows
      .filter((r) => r.triggerAction === triggerAction)
      .map((r) => r.conversionRuleUrn ?? conversionRuleUrnFor(r.conversionId));
  }

  private async findEnabledForChannel(
    salesChannelId: string,
  ): Promise<LinkedInConversionMapping[]> {
    const em = this.emFactory();
    return em.find(
      LinkedInConversionMapping,
      { enabled: true, $or: [{ salesChannelId: null }, { salesChannelId }] },
      { orderBy: { createdAt: 'asc' } },
    );
  }

  private notFound(id: string): HttpError {
    return new HttpError(404, ERROR_CODES.NOT_FOUND, `Conversion mapping not found: ${id}`);
  }

  private toDto(row: LinkedInConversionMapping): LinkedInConversionMappingDto {
    return {
      id: row.id,
      // `?? null` rather than a bare read: a freshly-created entity leaves an
      // omitted optional property undefined, and JSON.stringify would drop the
      // key entirely instead of sending the null the contract promises.
      salesChannelId: row.salesChannelId ?? null,
      triggerAction: row.triggerAction as LinkedInTriggerAction,
      conversionId: row.conversionId,
      conversionRuleUrn: row.conversionRuleUrn ?? null,
      enabled: row.enabled,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
