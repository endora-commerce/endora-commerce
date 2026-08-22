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

  async listForCase(caseId: string): Promise<ReturnShipmentDto[]> {
    const em = this.deps.emFactory();
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
    const rc = await em.findOne(ReturnCase, { id: caseId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
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

  /** Mark an inbound shipment received and advance the case to `received`. */
  async receive(caseId: string, shipmentId: string, adminUserId: string): Promise<ReturnShipmentDto> {
    const em = this.deps.emFactory();
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
