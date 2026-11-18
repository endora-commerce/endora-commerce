import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, NOTIFY_REQUIRES_CUSTOMER_VISIBLE, isUuidShape } from '@endora-commerce/contracts';
import type { ReturnCaseCommentDto } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnCase } from '../entities/return-case.entity.js';
import { ReturnCaseComment } from '../entities/return-case-comment.entity.js';
import type { CommandBus } from '@endora-commerce/platform/commands';
import type { ReturnStatusGraphService } from './return-status-graph-service.js';
import type { ReturnsNotificationJob } from './notifications/dispatch.js';

/** A guest may post this many comments on one case in 24 hours (`specs/181-guest-complaints/` research R-8). */
export const GUEST_COMMENTS_PER_CASE_PER_DAY = 20;

export interface ReturnCommentServiceDeps {
  emFactory: () => EntityManager;
  graphService: ReturnStatusGraphService;
  /** The Command Bus a guest's comment runs through (181 research R-6, FR-091). */
  commandBus?: Pick<CommandBus, 'run'>;
  now?: () => Date;
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
   * A comment a guest posts through the tracking link (`specs/181-guest-complaints/` G9;
   * FR-042, FR-091) on the case `GuestCaseAccess.load` answered. It is always visible to
   * the customer, marked as the guest's, never e-mailed back to them, and — written by an
   * unauthenticated party — a Command: `return_case.comment.add_by_guest`, whose entry
   * holds the comment's id and length, never its text (D-288). A finished case refuses it
   * as for a customer; 20 a day per case is the limit (research R-8).
   */
  async addByGuest(rc: Pick<ReturnCase, 'id'>, input: { body: string }): Promise<ReturnCaseCommentDto> {
    if (!this.deps.commandBus) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Return case not found.');
    const since = new Date(this.now().getTime() - 24 * 3_600_000);
    return this.deps.commandBus.run<ReturnCaseCommentDto>({
      action: 'return_case.comment.add_by_guest',
      objectType: 'return_case',
      objectId: rc.id,
      run: async ({ em }) => {
        const current = await this.loadOpenCase(em, { id: rc.id, customerAccountId: null });
        const posted = await em.count(ReturnCaseComment, { returnCaseId: current.id, authorGuest: true, createdAt: { $gt: since } });
        if (posted >= GUEST_COMMENTS_PER_CASE_PER_DAY) {
          throw new HttpError(429, ERROR_CODES.RETURN_GUEST_LIMIT_REACHED, 'You have reached the limit for now. Try again later.', {
            limit: 'comments_per_case',
          });
        }
        const comment = em.create(ReturnCaseComment, {
          returnCaseId: current.id,
          authorGuest: true,
          body: input.body,
          isCustomerVisible: true,
          notifyCustomer: false,
        });
        em.persist(comment);
        await em.flush();
        return {
          result: toDto(comment),
          before: null,
          after: { commentId: comment.id, length: input.body.length, by: 'guest' },
        };
      },
    });
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

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }

  private async loadOpenCase(
    em: EntityManager,
    where: { id: string; customerAccountId?: string | null },
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
    authorKind: c.authorGuest ? 'guest' : c.authorAdminUserId ? 'admin' : 'customer',
    body: c.body,
    isCustomerVisible: c.isCustomerVisible,
    ...(opts.adminView ? { notifyCustomer: c.notifyCustomer } : {}),
    createdAt: c.createdAt.toISOString(),
  };
}
