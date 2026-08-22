import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import type { ReturnCaseCommentDto } from '@endora-commerce/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseComment } from '../entities/return-case-comment.entity.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';

/** Best-effort notification when a customer-visible admin comment is posted. */
export type ReturnCommentNotifier = (rc: ReturnCase, comment: ReturnCaseComment) => Promise<void>;

export interface ReturnCommentServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  notifier?: ReturnCommentNotifier;
}

/**
 * ReturnCommentService — feature 046 (US4).
 *
 * Threaded comments on a case. Admin comments carry a visibility choice and a
 * notify flag; customer comments are always visible. Commenting is blocked once
 * the case reaches a terminal status. Mirrors `OrderCommentService`.
 */
export class ReturnCommentService {
  constructor(private readonly deps: ReturnCommentServiceDeps) {}

  async addByAdmin(
    id: string,
    adminUserId: string,
    input: { body: string; isCustomerVisible: boolean; notifyCustomer: boolean },
  ): Promise<ReturnCaseCommentDto> {
    // command-coverage-ignore: return-case comments are an append-only
    // communication thread, not audited domain-state (no before-state, no undo).
    const em = this.deps.emFactory();
    const rc = await this.loadOpenCase(em, { id });
    const comment = em.create(ReturnCaseComment, {
      returnCaseId: rc.id,
      authorAdminUserId: adminUserId,
      body: input.body,
      isCustomerVisible: input.isCustomerVisible,
      notifyCustomer: input.notifyCustomer,
    });
    em.persist(comment);
    await em.flush();
    if (input.isCustomerVisible && input.notifyCustomer && this.deps.notifier) {
      await this.notifySafely(rc, comment);
    }
    return toDto(comment);
  }

  async addByCustomer(
    id: string,
    customerAccountId: string,
    input: { body: string },
  ): Promise<ReturnCaseCommentDto> {
    // command-coverage-ignore: return-case comments are an append-only
    // communication thread, not audited domain-state (no before-state, no undo).
    const em = this.deps.emFactory();
    const rc = await this.loadOpenCase(em, { id, customerAccountId });
    const comment = em.create(ReturnCaseComment, {
      returnCaseId: rc.id,
      authorCustomerAccountId: customerAccountId,
      body: input.body,
      isCustomerVisible: true,
      notifyCustomer: false,
    });
    em.persist(comment);
    await em.flush();
    return toDto(comment);
  }

  async listForAdmin(id: string): Promise<ReturnCaseCommentDto[]> {
    const em = this.deps.emFactory();
    const comments = await em.find(
      ReturnCaseComment,
      { returnCaseId: id },
      { orderBy: { createdAt: 'asc' } },
    );
    return comments.map(toDto);
  }

  async listForCustomer(id: string, customerAccountId: string): Promise<ReturnCaseCommentDto[]> {
    const em = this.deps.emFactory();
    const rc = await em.findOne(ReturnCase, { id, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const comments = await em.find(
      ReturnCaseComment,
      { returnCaseId: id, isCustomerVisible: true },
      { orderBy: { createdAt: 'asc' } },
    );
    return comments.map(toDto);
  }

  private async loadOpenCase(
    em: EntityManager,
    where: { id: string; customerAccountId?: string },
  ): Promise<ReturnCase> {
    const rc = await em.findOne(ReturnCase, where);
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const graph = await this.deps.graphService.loadGraph();
    if (graph.isTerminal(rc.statusCode)) {
      throw new HttpError(409, ERROR_CODES.VALIDATION_FAILED, 'Commenting is closed for finished cases.', {
        code: 'case_terminal',
      });
    }
    return rc;
  }

  private async notifySafely(rc: ReturnCase, comment: ReturnCaseComment): Promise<void> {
    try {
      await this.deps.notifier?.(rc, comment);
    } catch {
      // Best-effort; never block the comment write.
    }
  }
}

function toDto(c: ReturnCaseComment): ReturnCaseCommentDto {
  return {
    id: c.id,
    authorKind: c.authorAdminUserId ? 'admin' : 'customer',
    body: c.body,
    isCustomerVisible: c.isCustomerVisible,
    createdAt: c.createdAt.toISOString(),
  };
}
