import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, NOTIFY_REQUIRES_CUSTOMER_VISIBLE, isUuidShape } from '@endora-commerce/contracts';
import type { ReturnCaseCommentDto } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseComment } from '../entities/return-case-comment.entity.js';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { ReturnsNotificationJob } from './notifications/dispatch.js';

export interface ReturnCommentServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  /**
   * `specs/180-off-platform-complaints/` FR-A20 — hand `comment_notify` to the
   * notification queue after the comment is stored. Never throws.
   */
  enqueueNotification?: (job: ReturnsNotificationJob) => Promise<void>;
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
    if (input.notifyCustomer && !input.isCustomerVisible) {
      // FR-A21: the operator would believe a customer was told about a comment
      // the customer cannot see.
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'Only a comment visible to the customer can be e-mailed to them.',
        { code: NOTIFY_REQUIRES_CUSTOMER_VISIBLE },
      );
    }
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
    // `specs/180-off-platform-complaints/` FR-A20, research R-6 — the product
    // decision this flag waited for: a customer-visible comment with *notify
    // customer* e-mails the filer, from the `returns-notifications` queue, after the
    // row is stored. Only this path enqueues, so a comment stored before the
    // feature is never sent (FR-A22). The queue is `ctx.worker`'s, so it answers
    // the module's off state of its own.
    if (comment.notifyCustomer && comment.isCustomerVisible) {
      await this.deps.enqueueNotification?.({ kind: 'comment_notify', returnCaseCommentId: comment.id });
    }
    return toDto(comment, { adminView: true });
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

  /**
   * The whole thread, internal comments included, for the admin panel.
   *
   * The case read is the tenant boundary and not a formality: `ReturnCaseComment`
   * is `@GlobalEntity`, so `em.find(ReturnCaseComment, { returnCaseId })` carries
   * no filter and answers for every case on the platform, while `ReturnCase` is
   * `@OrgScoped`. `listForCustomer` below has always keyed on the case *and* its
   * customer; this one keyed on nothing, and every comment on this thread is one
   * an operator wrote believing only their own colleagues would read it.
   *
   * `loadOpenCase` is the wrong helper here — it also refuses a closed case,
   * which a reader is entitled to see. Same read, no lifecycle term.
   */
  async listForAdmin(id: string): Promise<ReturnCaseCommentDto[]> {
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const comments = await em.find(
      ReturnCaseComment,
      { returnCaseId: id },
      { orderBy: { createdAt: 'asc' } },
    );
    return comments.map((c) => toDto(c, { adminView: true }));
  }

  async listForCustomer(id: string, customerAccountId: string): Promise<ReturnCaseCommentDto[]> {
    const em = this.deps.emFactory();
    if (!isUuidShape(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, { id, customerAccountId });
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const comments = await em.find(
      ReturnCaseComment,
      { returnCaseId: id, isCustomerVisible: true },
      { orderBy: { createdAt: 'asc' } },
    );
    return comments.map((c) => toDto(c));
  }

  private async loadOpenCase(
    em: EntityManager,
    where: { id: string; customerAccountId?: string },
  ): Promise<ReturnCase> {
    if (!isUuidShape(where.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const rc = await em.findOne(ReturnCase, where);
    if (!rc) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const graph = await this.deps.graphService.loadGraph();
    if (graph.isTerminal(rc.statusCode)) {
      throw new HttpError(409, ERROR_CODES.RETURN_COMMENTS_CLOSED, 'Commenting is closed for finished cases.', {
        returnCaseId: rc.id,
        statusCode: rc.statusCode,
      });
    }
    return rc;
  }
}

/**
 * The comment as a reader sees it. `notifyCustomer` is the operator's ("E-mail
 * requested", FR-A20): the admin view carries it, the buyer's view leaves it out.
 */
export function toDto(c: ReturnCaseComment, opts: { adminView?: boolean } = {}): ReturnCaseCommentDto {
  return {
    id: c.id,
    authorKind: c.authorAdminUserId ? 'admin' : 'customer',
    body: c.body,
    isCustomerVisible: c.isCustomerVisible,
    ...(opts.adminView ? { notifyCustomer: c.notifyCustomer } : {}),
    createdAt: c.createdAt.toISOString(),
  };
}
