import { createHash } from 'node:crypto';
import type {
  CustomerAccountReadPort,
  OrganizationDetailsPort,
  TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { ModuleDisabledError, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { caseReference } from '../../domain/case-reference.js';
import type { AdminBell, BellOutcome } from './admin-bell.js';
import { caseLink, formatSubmittedAt, kindLabel, productList, statusNameIn } from './messages.js';
import type { RecipientList } from './recipients.js';

/**
 * What one `returns-notifications` job does (`specs/180-off-platform-complaints/`
 * research R-2 – R-5; FR-A02, FR-A03, FR-A10, FR-A20, FR-A31, FR-A50, FR-A51) — the
 * worker's body, written without BullMQ so it can be driven directly. Modelled on
 * `forms`' `NotificationDispatch`.
 *
 * 1. **Presence first.** A module that is off does no work and loses none: the job
 *    fails with `ModuleDisabledError` before anything is read, so it is tried again.
 * 2. **The rows as they are now.** A job carries ids only; a case, comment or status
 *    gone since is simply not mailed.
 * 3. **Every message is the template's**, sent through `transactional_emails`'
 *    sender in the channel's language with a deterministic `messageId`, so a retried
 *    job is suppressed by the sender rather than sent twice (FR-A51).
 * 4. **Every outcome is reported** — `invalid_recipient`, `no_recipient`, and each
 *    status the sender answers other than `sent` — in the report and in the log
 *    operators read, and none of them throws (FR-A50).
 * 5. **A transport failure is rethrown** for BullMQ's retry, after every other
 *    message was tried. What already went out — each shop recipient by key (never
 *    an address), the customer's message, each administrator's bell entry — is
 *    kept on the job's own progress, so the retry repeats none of it.
 */

export type ReturnsNotificationJob =
  | { readonly kind: 'case_submitted'; readonly returnCaseId: string }
  | { readonly kind: 'comment_notify'; readonly returnCaseCommentId: string }
  | { readonly kind: 'status_entered'; readonly returnCaseId: string; readonly statusCode: string; readonly eventId: string };

export interface NotificationCase {
  readonly id: string;
  readonly rmaNumber: string | null;
  readonly kind: 'return' | 'complaint';
  /** `null` = a case without a platform order (phase B). */
  readonly orderId: string | null;
  readonly salesChannelId: string;
  readonly customerAccountId: string;
  readonly organizationId: string | null;
  readonly submittedAt: Date;
  readonly lines: ReadonlyArray<{ productName: string; quantity: number }>;
}

export interface NotificationComment {
  readonly id: string;
  readonly returnCaseId: string;
  readonly body: string;
  readonly isCustomerVisible: boolean;
  readonly notifyCustomer: boolean;
}

export interface NotificationStatus {
  readonly code: string;
  readonly name: Record<string, string>;
  readonly defaultName: string;
}

/** Where a job reads its rows — called inside the system scope the worker enters. */
export interface NotificationStore {
  loadCase(returnCaseId: string): Promise<NotificationCase | null>;
  loadComment(returnCaseCommentId: string): Promise<NotificationComment | null>;
  loadStatus(code: string): Promise<NotificationStatus | null>;
}

export interface DispatchDeps {
  readonly isPresent: () => boolean;
  readonly store: NotificationStore;
  /** `transactional_emails`' late-bound sender; `undefined` reads as `no_transport`. */
  readonly sender: () => Pick<TransactionalEmailSender, 'send'> | undefined;
  readonly customers: Pick<CustomerAccountReadPort, 'findById'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  /** The channel's default language — the e-mails' language (R-5). */
  readonly language: (salesChannelId: string) => Promise<string>;
  /** `returns.time_zone` for the channel, for the filing date. */
  readonly timeZone: (salesChannelId: string) => Promise<string>;
  readonly newCaseRecipients: (salesChannelId: string) => Promise<RecipientList>;
  readonly bell: AdminBell;
  readonly storefrontBaseUrl: string | undefined;
  readonly adminBaseUrl: string | null;
  readonly log: (message: string, context: Record<string, unknown>) => void;
}

/** What an earlier attempt of the same job already did, and how to record more of it. */
export interface DispatchAttempt {
  readonly done: readonly string[];
  record(done: readonly string[]): Promise<void>;
}

export type NotificationCode = 'return_new_case' | 'return_submitted' | 'return_comment_added' | 'return_status_entered';

export type MessageStatus =
  | 'sent'
  | 'invalid_recipient'
  | 'no_recipient'
  | 'logged'
  | 'deactivated'
  | 'no_transport'
  | 'no_definition'
  | 'failed';

export interface MessageOutcome {
  readonly code: NotificationCode;
  readonly recipient: 'shop' | 'customer';
  readonly status: MessageStatus;
}

export interface DispatchReport {
  readonly skipped?: 'gone' | 'not_requested';
  readonly messages: MessageOutcome[];
  readonly bell?: BellOutcome;
}

const NOT_SENT = '[returns] the return e-mail was not sent';
const CUSTOMER_KEY = 'customer';

/** A shop recipient's progress key — a digest, so neither Redis nor a log holds the address. */
export function recipientKey(returnCaseId: string, address: string): string {
  return createHash('sha256').update(`${returnCaseId}\n${address}`).digest('hex').slice(0, 16);
}

/** One job's working state: its progress and its outcomes. */
class Run {
  readonly done: Set<string>;
  readonly messages: MessageOutcome[] = [];
  readonly failures: unknown[] = [];

  constructor(
    private readonly log: DispatchDeps['log'],
    readonly returnCaseId: string,
    done: readonly string[],
  ) {
    this.done = new Set(done);
  }

  outcome(code: NotificationCode, recipient: MessageOutcome['recipient'], status: MessageStatus, error?: unknown): void {
    this.messages.push({ code, recipient, status });
    if (status === 'sent') return;
    this.log(NOT_SENT, {
      returnCaseId: this.returnCaseId,
      kind: code,
      recipient,
      reason: status,
      ...(error === undefined ? {} : { error: error instanceof Error ? error.message : String(error) }),
    });
  }
}

export class ReturnsNotificationDispatch {
  constructor(private readonly deps: DispatchDeps) {}

  async dispatch(job: ReturnsNotificationJob, attempt?: DispatchAttempt): Promise<DispatchReport> {
    if (!this.deps.isPresent()) throw new ModuleDisabledError('returns');
    switch (job.kind) {
      case 'case_submitted':
        return this.caseSubmitted(job.returnCaseId, attempt);
      case 'comment_notify':
        return this.commentNotify(job.returnCaseCommentId, attempt);
      case 'status_entered':
        return this.statusEntered(job, attempt);
    }
  }

  // --- the three jobs --------------------------------------------------------------

  private async caseSubmitted(returnCaseId: string, attempt?: DispatchAttempt): Promise<DispatchReport> {
    const rc = await this.deps.store.loadCase(returnCaseId);
    if (!rc) return { skipped: 'gone', messages: [] };
    const run = new Run(this.deps.log, rc.id, attempt?.done ?? []);
    const [language, timeZone] = await Promise.all([
      this.deps.language(rc.salesChannelId),
      this.deps.timeZone(rc.salesChannelId),
    ]);
    const common = {
      caseReference: caseReference(rc),
      kindLabel: kindLabel(rc.kind, language),
      productList: productList(rc.lines),
      submittedAt: formatSubmittedAt(rc.submittedAt, language, timeZone),
    };

    // The shop (FR-A02): every valid recipient of the case's channel.
    const { recipients, invalid } = await this.deps.newCaseRecipients(rc.salesChannelId);
    for (const _entry of invalid) run.outcome('return_new_case', 'shop', 'invalid_recipient');
    if (recipients.length > 0) {
      const [customer, organization] = await Promise.all([
        this.deps.customers.findById(rc.customerAccountId),
        rc.organizationId ? this.deps.organizations.findById(rc.organizationId) : Promise.resolve(null),
      ]);
      const variables = {
        caseReference: common.caseReference,
        kindLabel: common.kindLabel,
        customerName: customer ? `${customer.firstName} ${customer.lastName}`.trim() : '',
        organizationName: organization?.name ?? '',
        productList: common.productList,
        offPlatform: rc.orderId === null ? 'yes' : '',
        submittedAt: common.submittedAt,
        adminCaseUrl: caseLink(this.deps.adminBaseUrl, rc.id),
      };
      for (const to of recipients) {
        const key = `shop:${recipientKey(rc.id, to)}`;
        if (run.done.has(key)) continue;
        await this.send(run, key, 'shop', {
          code: 'return_new_case',
          salesChannelId: rc.salesChannelId,
          language,
          to,
          messageId: `return_new_case:${rc.id}:${recipientKey(rc.id, to)}`,
          variables,
          meta: { returnCaseId: rc.id, kind: 'return_new_case' },
        });
      }
    }

    // The filer (FR-A10): the account that filed the case, not the order's placer.
    await this.toCustomer(run, rc, language, {
      code: 'return_submitted',
      messageId: `return_submitted:${rc.id}`,
      variables: { ...common, caseUrl: caseLink(this.deps.storefrontBaseUrl, rc.id) },
    });

    // The bell (FR-A03): after the e-mails, so its failure holds none of them back.
    let bell: BellOutcome | undefined;
    try {
      bell = await this.deps.bell.announceNewCase(
        { id: rc.id, kind: rc.kind, reference: common.caseReference, submittedAt: rc.submittedAt },
        { done: run.done },
      );
    } catch (error) {
      // An `admin_notifications` switched off between the presence check and the
      // call answers as itself, after what already went out is recorded, so the
      // retry repeats none of it; any other failure is retried with the rest.
      if (attempt) await attempt.record([...run.done].sort());
      rethrowIfModuleDisabled(error);
      run.failures.push(error);
    }
    return this.finish(run, attempt, bell);
  }

  private async commentNotify(returnCaseCommentId: string, attempt?: DispatchAttempt): Promise<DispatchReport> {
    const comment = await this.deps.store.loadComment(returnCaseCommentId);
    if (!comment) return { skipped: 'gone', messages: [] };
    if (!comment.isCustomerVisible || !comment.notifyCustomer) return { skipped: 'not_requested', messages: [] };
    const rc = await this.deps.store.loadCase(comment.returnCaseId);
    if (!rc) return { skipped: 'gone', messages: [] };
    const run = new Run(this.deps.log, rc.id, attempt?.done ?? []);
    const language = await this.deps.language(rc.salesChannelId);
    await this.toCustomer(run, rc, language, {
      code: 'return_comment_added',
      messageId: `return_comment:${comment.id}`,
      variables: {
        caseReference: caseReference(rc),
        commentBody: comment.body,
        caseUrl: caseLink(this.deps.storefrontBaseUrl, rc.id),
      },
    });
    return this.finish(run, attempt);
  }

  private async statusEntered(
    job: Extract<ReturnsNotificationJob, { kind: 'status_entered' }>,
    attempt?: DispatchAttempt,
  ): Promise<DispatchReport> {
    const [rc, status] = await Promise.all([this.deps.store.loadCase(job.returnCaseId), this.deps.store.loadStatus(job.statusCode)]);
    // A status deleted since sends nothing; a renamed one sends its new name.
    if (!rc || !status) return { skipped: 'gone', messages: [] };
    const run = new Run(this.deps.log, rc.id, attempt?.done ?? []);
    const language = await this.deps.language(rc.salesChannelId);
    await this.toCustomer(run, rc, language, {
      code: 'return_status_entered',
      messageId: `return_status:${job.eventId}`,
      variables: {
        caseReference: caseReference(rc),
        statusName: statusNameIn(status, language),
        caseUrl: caseLink(this.deps.storefrontBaseUrl, rc.id),
      },
    });
    return this.finish(run, attempt);
  }

  // --- internals ----------------------------------------------------------------------

  /** The filer's message, once per job: an account that is gone, deleted or anonymised has no address. */
  private async toCustomer(
    run: Run,
    rc: NotificationCase,
    language: string,
    message: { code: NotificationCode; messageId: string; variables: Record<string, string> },
  ): Promise<void> {
    if (run.done.has(CUSTOMER_KEY)) return;
    const account = await this.deps.customers.findById(rc.customerAccountId);
    const to = account && account.deletedAt === null && account.anonymizedAt === null ? account.email : null;
    if (!to) {
      run.outcome(message.code, 'customer', 'no_recipient');
      return;
    }
    await this.send(run, CUSTOMER_KEY, 'customer', {
      code: message.code,
      salesChannelId: rc.salesChannelId,
      language,
      to,
      messageId: message.messageId,
      variables: message.variables,
      meta: { returnCaseId: rc.id, kind: message.code },
    });
  }

  private async send(
    run: Run,
    key: string,
    recipient: MessageOutcome['recipient'],
    input: Parameters<TransactionalEmailSender['send']>[0] & { code: NotificationCode },
  ): Promise<void> {
    const sender = this.deps.sender();
    if (!sender) {
      run.outcome(input.code, recipient, 'no_transport');
      return;
    }
    try {
      const outcome = await sender.send(input);
      run.outcome(input.code, recipient, outcome.status);
      // Any answer is final for this message: retrying a deactivated template or a
      // missing transport changes nothing, and `sent`/`logged` must not repeat.
      run.done.add(key);
    } catch (error) {
      run.outcome(input.code, recipient, 'failed', error);
      run.failures.push(error);
    }
  }

  private async finish(run: Run, attempt: DispatchAttempt | undefined, bell?: BellOutcome): Promise<DispatchReport> {
    if (attempt) await attempt.record([...run.done].sort());
    if (run.failures.length > 0) throw run.failures[0];
    return { messages: run.messages, ...(bell ? { bell } : {}) };
  }
}
