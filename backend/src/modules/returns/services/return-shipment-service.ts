import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { ReturnShipmentDto } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditPort } from '../../../kernel/ports/audit.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnShipment } from '../entities/return-shipment.entity.js';
import { RETURN_STATUS_RECEIVED } from '../domain/return-status-graph.js';
import type { ReturnTransitionService } from './return-transition-service.js';

export interface ReturnShipmentServiceDeps {
  emFactory: () => EntityManager;
  transitions: ReturnTransitionService;
  /** Feature 054 — audits shipment writes co-transactionally when provided. */
  auditLog?: AuditPort;
}

/**
 * ReturnShipmentService — feature 046 (US6).
 *
 * Records inbound return shipments (customer → shop) and replacement shipments
 * (shop → customer) against a case. Receiving an inbound shipment drives the
 * case `authorized → received` (FR-024).
 */
export class ReturnShipmentService {
  constructor(private readonly deps: ReturnShipmentServiceDeps) {}

  /**
   * Resolve the case every method below is keyed on.
   *
   * `ReturnShipment` is `@GlobalEntity` — no organization column, no filter —
   * so a read keyed on `returnCaseId` answers for every case on the platform.
   * `ReturnCase` is `@OrgScoped`, so this read *is* the tenant boundary: an
   * assignment-scoped administrator gets nothing back and the caller stops.
   *
   * `create` has made this read since it was written, for its own reasons;
   * `listForCase` and `receive` had no reason of their own to make it, which is
   * exactly how they came to have none.
   */
  async #loadCase(em: EntityManager, caseId: string): Promise<ReturnCase> {
    const rc = await em.findOne(ReturnCase, { id: caseId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    return rc;
  }

  async listForCase(caseId: string): Promise<ReturnShipmentDto[]> {
    const em = this.deps.emFactory();
    await this.#loadCase(em, caseId);
    const rows = await em.find(ReturnShipment, { returnCaseId: caseId }, { orderBy: { createdAt: 'asc' } });
    return rows.map(toDto);
  }

  async create(
    caseId: string,
    input: {
      direction: 'inbound' | 'replacement';
      deliveryMethodId?: string | undefined;
      externalReference?: string | undefined;
    },
  ): Promise<ReturnShipmentDto> {
    const em = this.deps.emFactory();
    await this.#loadCase(em, caseId);
    const shipment = em.create(ReturnShipment, {
      returnCaseId: caseId,
      direction: input.direction,
      deliveryMethodId: input.deliveryMethodId ?? null,
      externalReference: input.externalReference ?? null,
      status: 'pending',
    });
    em.persist(shipment);
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action: 'return_shipment.create',
        objectType: 'return_shipment',
        objectId: shipment.id,
        stateBefore: null,
        stateAfter: { returnCaseId: caseId, direction: shipment.direction },
      });
    }
    await em.flush();
    return toDto(shipment);
  }

  /**
   * Mark an inbound shipment received and advance the case to `received`.
   *
   * The case read comes first, and that ordering is the point rather than a
   * tidiness: the shipment row is flushed before the transition is attempted,
   * so a caller that reached the transition's own refusal had already written
   * `received` onto a case in an organization it cannot see, and been told 404.
   * Both ids on this route are the caller's, and neither entity carries a
   * filter.
   */
  async receive(caseId: string, shipmentId: string, adminUserId: string): Promise<ReturnShipmentDto> {
    const em = this.deps.emFactory();
    await this.#loadCase(em, caseId);
    const shipment = await em.findOne(ReturnShipment, { id: shipmentId, returnCaseId: caseId });
    if (!shipment) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return shipment not found.');
    shipment.status = 'received';
    if (this.deps.auditLog) {
      recordAuditFromContext(this.deps.auditLog, em, {
        action: 'return_shipment.receive',
        objectType: 'return_shipment',
        objectId: shipment.id,
        stateBefore: { status: 'pending' },
        stateAfter: { status: 'received' },
      });
    }
    await em.flush();
    if (shipment.direction === 'inbound') {
      await this.deps.transitions.apply(caseId, RETURN_STATUS_RECEIVED, {
        kind: 'admin',
        adminUserId,
        source: 'shipment',
      });
    }
    return toDto(shipment);
  }
}

function toDto(s: ReturnShipment): ReturnShipmentDto {
  return {
    id: s.id,
    direction: s.direction,
    deliveryMethodId: s.deliveryMethodId ?? null,
    externalReference: s.externalReference ?? null,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
  };
}
