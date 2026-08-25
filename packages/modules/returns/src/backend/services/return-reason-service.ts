import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { ReturnReasonDto } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { ReturnReason } from '../entities/return-reason.entity.js';

/**
 * ReturnReasonService — feature 046 (US7, FR-030).
 *
 * Manages the return/complaint reason list. The storefront form reads the active
 * reasons (optionally filtered by case kind) in `weight` order.
 */
export class ReturnReasonService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
  ) {}

  #audit(
    em: EntityManager,
    action: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action,
        objectType: 'return_reason',
        objectId,
        stateBefore,
        stateAfter,
      });
    }
  }

  /** All reasons (admin view), ordered by weight. */
  async listAll(): Promise<ReturnReasonDto[]> {
    const em = this.emFactory();
    const rows = await em.find(ReturnReason, {}, { orderBy: { weight: 'asc' } });
    return rows.map(toDto);
  }

  /** Active reasons for a case kind (storefront), ordered by weight. */
  async listActive(kind?: 'return' | 'complaint'): Promise<ReturnReasonDto[]> {
    const em = this.emFactory();
    const rows = await em.find(ReturnReason, { isActive: true }, { orderBy: { weight: 'asc' } });
    const applicable = kind
      ? rows.filter((r) => r.appliesTo === kind || r.appliesTo === 'both')
      : rows;
    return applicable.map(toDto);
  }

  async create(input: {
    label: Record<string, string>;
    appliesTo: 'return' | 'complaint' | 'both';
    isActive?: boolean | undefined;
    weight?: number | undefined;
  }): Promise<ReturnReasonDto> {
    const em = this.emFactory();
    const row = em.create(ReturnReason, {
      label: input.label,
      appliesTo: input.appliesTo,
      isActive: input.isActive ?? true,
      weight: input.weight ?? 100,
    });
    em.persist(row);
    this.#audit(em, 'return_reason.create', row.id, null, { appliesTo: row.appliesTo, isActive: row.isActive });
    await em.flush();
    return toDto(row);
  }

  async update(
    id: string,
    patch: {
      label?: Record<string, string> | undefined;
      appliesTo?: 'return' | 'complaint' | 'both' | undefined;
      isActive?: boolean | undefined;
      weight?: number | undefined;
    },
  ): Promise<ReturnReasonDto> {
    const em = this.emFactory();
    const row = await em.findOne(ReturnReason, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return reason not found.');
    if (patch.label !== undefined) row.label = patch.label;
    if (patch.appliesTo !== undefined) row.appliesTo = patch.appliesTo;
    if (patch.isActive !== undefined) row.isActive = patch.isActive;
    if (patch.weight !== undefined) row.weight = patch.weight;
    this.#audit(em, 'return_reason.update', row.id, null, {
      appliesTo: row.appliesTo,
      isActive: row.isActive,
      weight: row.weight,
    });
    await em.flush();
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const em = this.emFactory();
    const row = await em.findOne(ReturnReason, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return reason not found.');
    this.#audit(em, 'return_reason.delete', row.id, { appliesTo: row.appliesTo }, null);
    await em.removeAndFlush(row);
  }
}

function toDto(r: ReturnReason): ReturnReasonDto {
  return { id: r.id, label: r.label, appliesTo: r.appliesTo, isActive: r.isActive, weight: r.weight };
}
