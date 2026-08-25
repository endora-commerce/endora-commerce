import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { ReturnAttachmentDto } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseAttachment } from '../entities/return-case-attachment.entity.js';

/**
 * ReturnAttachmentService — feature 046 (US1, T027).
 *
 * Links uploaded assets (e.g. defect photos) to a case or a specific case line.
 * The binary upload itself goes through the assets library, which returns an
 * `assetId`; this service persists the `return_case_attachments` link and
 * enforces case ownership.
 */
export class ReturnAttachmentService {
  constructor(private readonly emFactory: () => EntityManager) {}

  async addToCase(
    caseId: string,
    customerAccountId: string,
    input: { assetId: string; returnCaseItemId?: string | undefined },
  ): Promise<ReturnAttachmentDto> {
    // command-coverage-ignore: append-only evidence attachment on a case, not an
    // audited domain-state mutation (no before-state, no undo value).
    const em = this.emFactory();
    const rc = await em.findOne(ReturnCase, { id: caseId, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const attachment = em.create(ReturnCaseAttachment, {
      returnCaseId: caseId,
      returnCaseItemId: input.returnCaseItemId ?? null,
      assetId: input.assetId,
    });
    await em.persistAndFlush(attachment);
    return toDto(attachment);
  }

  async listForCase(caseId: string): Promise<ReturnAttachmentDto[]> {
    const em = this.emFactory();
    const rows = await em.find(
      ReturnCaseAttachment,
      { returnCaseId: caseId },
      { orderBy: { createdAt: 'asc' } },
    );
    return rows.map(toDto);
  }
}

function toDto(a: ReturnCaseAttachment): ReturnAttachmentDto {
  return {
    id: a.id,
    returnCaseId: a.returnCaseId,
    returnCaseItemId: a.returnCaseItemId ?? null,
    assetId: a.assetId,
    createdAt: a.createdAt.toISOString(),
  };
}
