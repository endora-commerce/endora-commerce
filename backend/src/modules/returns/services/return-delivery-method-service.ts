import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import type { ReturnDeliveryMethodDto } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnDeliveryMethod } from '../entities/return-delivery-method.entity.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';

export interface ReturnDeliveryMethodServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  /** `'customer'` | `'shop'` default bearer once the free-return window passes. */
  resolveDefaultCostBearer: (salesChannelId: string) => Promise<'customer' | 'shop'>;
  /** Feature 054 — audits method writes co-transactionally when provided. */
  auditLog?: AuditPort;
}

/**
 * ReturnDeliveryMethodService — feature 046 (US6).
 *
 * CRUD for the allowed return delivery methods (with per-method return cost,
 * 0 = free/shop-paid) and selection of a method on a case, which resolves the
 * applied cost and the cost bearer from the free-return window (FR-021/022/023).
 */
export class ReturnDeliveryMethodService {
  constructor(private readonly deps: ReturnDeliveryMethodServiceDeps) {}

  #audit(
    em: EntityManager,
    action: string,
    objectType: string,
    objectId: string,
    stateBefore: Record<string, unknown> | null,
    stateAfter: Record<string, unknown> | null,
  ): void {
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, { action, objectType, objectId, stateBefore, stateAfter });
    }
  }

  async list(): Promise<ReturnDeliveryMethodDto[]> {
    const em = this.deps.emFactory();
    const rows = await em.find(ReturnDeliveryMethod, {}, { orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  async create(input: {
    deliveryMethodId: string;
    returnCost: number;
    currency: string;
    isActive?: boolean | undefined;
  }): Promise<ReturnDeliveryMethodDto> {
    const em = this.deps.emFactory();
    const row = em.create(ReturnDeliveryMethod, {
      deliveryMethodId: input.deliveryMethodId,
      returnCost: input.returnCost.toFixed(2),
      currency: input.currency,
      isActive: input.isActive ?? true,
    });
    em.persist(row);
    this.#audit(em, 'return_delivery_method.create', 'return_delivery_method', row.id, null, {
      deliveryMethodId: row.deliveryMethodId,
      returnCost: row.returnCost,
      currency: row.currency,
    });
    await em.flush();
    return toDto(row);
  }

  async update(
    id: string,
    patch: {
      returnCost?: number | undefined;
      currency?: string | undefined;
      isActive?: boolean | undefined;
    },
  ): Promise<ReturnDeliveryMethodDto> {
    const em = this.deps.emFactory();
    const row = await em.findOne(ReturnDeliveryMethod, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return delivery method not found.');
    if (patch.returnCost !== undefined) row.returnCost = patch.returnCost.toFixed(2);
    if (patch.currency !== undefined) row.currency = patch.currency;
    if (patch.isActive !== undefined) row.isActive = patch.isActive;
    this.#audit(em, 'return_delivery_method.update', 'return_delivery_method', row.id, null, {
      returnCost: row.returnCost,
      currency: row.currency,
      isActive: row.isActive,
    });
    await em.flush();
    return toDto(row);
  }

  async remove(id: string): Promise<void> {
    const em = this.deps.emFactory();
    const row = await em.findOne(ReturnDeliveryMethod, { id });
    if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return delivery method not found.');
    this.#audit(em, 'return_delivery_method.delete', 'return_delivery_method', row.id, {
      deliveryMethodId: row.deliveryMethodId,
    }, null);
    await em.removeAndFlush(row);
  }

  /** Apply an allowed return delivery method to a case and resolve cost + bearer. */
  async selectForCase(
    caseId: string,
    customerAccountId: string,
    returnDeliveryMethodId: string,
  ): Promise<{ appliedReturnCost: number; returnCostBearer: 'customer' | 'shop'; currency: string }> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id: caseId, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const graph = await this.deps.graphService.loadGraph();
    if (graph.isTerminal(rc.statusCode)) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'The case is closed.', { code: 'case_terminal' });
    }
    const method = await em.findOne(ReturnDeliveryMethod, { id: returnDeliveryMethodId, isActive: true });
    if (!method) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'Return delivery method is not available.', {
        code: 'method_not_allowed',
      });
    }

    const bearer: 'customer' | 'shop' = rc.freeReturnEligible
      ? 'shop'
      : await this.deps.resolveDefaultCostBearer(rc.salesChannelId);
    rc.returnDeliveryMethodId = method.id;
    rc.appliedReturnCost = method.returnCost;
    rc.returnCostBearer = bearer;
    this.#audit(em, 'return_case.select_delivery_method', 'return_case', rc.id, null, {
      returnDeliveryMethodId: method.id,
      appliedReturnCost: method.returnCost,
      returnCostBearer: bearer,
    });
    await em.flush();
    return { appliedReturnCost: Number(method.returnCost), returnCostBearer: bearer, currency: method.currency };
  }
}

function toDto(r: ReturnDeliveryMethod): ReturnDeliveryMethodDto {
  return {
    id: r.id,
    deliveryMethodId: r.deliveryMethodId,
    returnCost: Number(r.returnCost),
    currency: r.currency,
    isActive: r.isActive,
  };
}
