import { createHash } from 'node:crypto';
import {
  GUEST_VERIFICATION_LINK_VALID_MINUTES,
  type CustomerAccountReadPort,
  type OrganizationDetailsPort,
  type TransactionalEmailSender,
} from '@endora-commerce/contracts';
import { ModuleDisabledError, rethrowIfModuleDisabled } from '@endora-commerce/platform/kernel';
import { caseReference } from '../../domain/case-reference.js';
import type { GuestLinks } from '../guest/guest-tracking-link.js';
import type { AdminBell, BellOutcome } from './admin-bell.js';
import { customerMessageFor, trackingUrlOf, type AccountMessageCode, type GuestMessageCode } from './customer-message.js';
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
  | { readonly kind: 'status_entered'; readonly returnCaseId: string; readonly statusCode: string; readonly eventId: string }
  /** `specs/181-guest-complaints/` research R-3 — the verification link, after the row committed. */
  | { readonly kind: 'guest_verification'; readonly verificationId: string }
  /** 181 FR-046 — a replaced tracking link, after Command `return_case.tracking_link.reissue` committed. */
  | { readonly kind: 'guest_link_reissued'; readonly caseId: string; readonly trackingVersion: number };

export interface NotificationCase {
  readonly id: string;
  readonly rmaNumber: string | null;
  readonly kind: 'return' | 'complaint';
  /** `null` = a case without a platform order (phase B). */
  readonly orderId: string | null;
  readonly salesChannelId: string;
  /** `null` = a guest case (`specs/181-guest-complaints/`): no account to look up. */
  readonly customerAccountId: string | null;
  readonly organizationId: string | null;
  readonly submittedAt: Date;
  readonly lines: ReadonlyArray<{ productName: string; quantity: number }>;
  /** 181 — a guest case's contact, its erasure and its tracking version; absent on older stores. */
  readonly contact?: { readonly name: string; readonly email: string } | null;
  readonly personalDataErasedAt?: Date | null;
  readonly trackingVersion?: number | null;
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

/** A guest's verification request, as its e-mail needs it (`specs/181-guest-complaints/`). */
export interface NotificationGuestVerification {
  readonly id: string;
  readonly salesChannelId: string;
  readonly email: string;
  readonly linkExpiresAt: Date;
  readonly redeemedAt: Date | null;
}

/** Where a job reads its rows — called inside the system scope the worker enters. */
export interface NotificationStore {
  loadCase(returnCaseId: string): Promise<NotificationCase | null>;
  loadGuestVerification(verificationId: string): Promise<NotificationGuestVerification | null>;
  loadComment(returnCaseCommentId: string): Promise<NotificationComment | null>;
  loadStatus(code: string): Promise<NotificationStatus | null>;
}

export interface DispatchDeps {
  readonly isPresent: () => boolean;
  readonly store: NotificationStore;
  /** `transactional_emails`' late-bound sender; `undefined` reads as `no_transport`. */
  readonly sender: () => Pick<TransactionalEmailSender, 'send'> | undefined;
  /** `findByEmail`: whether a guest's address belongs to an account, for one sentence (181 FR-025). */
  readonly customers: Pick<CustomerAccountReadPort, 'findById' | 'findByEmail'>;
  readonly organizations: Pick<OrganizationDetailsPort, 'findById'>;
  /** The channel's default language — the e-mails' language (R-5). */
  readonly language: (salesChannelId: string) => Promise<string>;
  /** `returns.time_zone` for the channel, for the filing date. */
  readonly timeZone: (salesChannelId: string) => Promise<string>;
  readonly newCaseRecipients: (salesChannelId: string) => Promise<RecipientList>;
  readonly bell: AdminBell;
  /** The guest's sealed links (`specs/181-guest-complaints/` research R-5). */
  readonly guestLinks: Pick<GuestLinks, 'verificationToken' | 'trackingToken'>;
  /**
   * A sentence of this module's bundle in a language, with parameters — the shop e-mail's
   * "{name} (guest)" (181 FR-050). Absent or failing: the English sentence.
   */
  readonly translate?: (key: string, language: string, params: Record<string, string>) => Promise<string>;
  readonly now?: () => Date;
  readonly storefrontBaseUrl: string | undefined;
  readonly adminBaseUrl: string | null;
  readonly log: (message: string, context: Record<string, unknown>) => void;
}

/** What an earlier attempt of the same job already did, and how to record more of it. */
export interface DispatchAttempt {
  readonly done: readonly string[];
  record(done: readonly string[]): Promise<void>;
}

export type NotificationCode =
  | 'return_new_case'
  | AccountMessageCode
  | GuestMessageCode
  | 'return_guest_verification'
  | 'return_guest_link_reissued';

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
  readonly recipient: 'shop' | 'customer' | 'guest';
  readonly status: MessageStatus;
}

export interface DispatchReport {
  readonly skipped?: 'gone' | 'not_requested';
  readonly messages: MessageOutcome[];
  readonly bell?: BellOutcome;
}

const NOT_SENT = '[returns] the return e-mail was not sent';
const CUSTOMER_KEY = 'customer';
const GUEST_KEY = 'guest';

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
    /** What the log names the job by: `{ returnCaseId }`, or `{ verificationId }` for a guest's link. */
    readonly subject: Readonly<Record<string, string>>,
    done: readonly string[],
  ) {
    this.done = new Set(done);
  }

  outcome(code: NotificationCode, recipient: MessageOutcome['recipient'], status: MessageStatus, error?: unknown): void {
    this.messages.push({ code, recipient, status });
    if (status === 'sent') return;
    this.log(NOT_SENT, {
      ...this.subject,
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
      case 'guest_verification':
        return this.guestVerification(job.verificationId, attempt);
      case 'guest_link_reissued':
        return this.guestLinkReissued(job, attempt);
    }
  }

  // --- the three jobs --------------------------------------------------------------

  private async caseSubmitted(returnCaseId: string, attempt?: DispatchAttempt): Promise<DispatchReport> {
    const rc = await this.deps.store.loadCase(returnCaseId);
    if (!rc) return { skipped: 'gone', messages: [] };
    const run = new Run(this.deps.log, { returnCaseId: rc.id }, attempt?.done ?? []);
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
        rc.customerAccountId ? this.deps.customers.findById(rc.customerAccountId) : Promise.resolve(null),
        rc.organizationId ? this.deps.organizations.findById(rc.organizationId) : Promise.resolve(null),
      ]);
      const variables = {
        caseReference: common.caseReference,
        kindLabel: common.kindLabel,
        customerName: customer
          ? `${customer.firstName} ${customer.lastName}`.trim()
          : await this.guestName(rc, language),
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

    // The filer (FR-A10): the account that filed the case, not the order's placer — or
    // the guest, at the verified address, with the tracking link (181 FR-036).
    await this.toCustomer(
      run,
      rc,
      language,
      {
        code: 'return_submitted',
        messageId: `return_submitted:${rc.id}`,
        variables: { ...common, caseUrl: caseLink(this.deps.storefrontBaseUrl, rc.id) },
      },
      {
        messageId: `return_guest_submitted:${rc.id}`,
        variables: { caseReference: common.caseReference, productList: common.productList, submittedAt: common.submittedAt },
      },
    );

    // The bell (FR-A03): after the e-mails, so its failure holds none of them back.
    let bell: BellOutcome | undefined;
    try {
      bell = await this.deps.bell.announceNewCase(
        {
          id: rc.id,
          kind: rc.kind,
          reference: common.caseReference,
          submittedAt: rc.submittedAt,
          // 181 FR-051 — a guest's case reaches only the unrestricted administrators.
          guest: rc.customerAccountId == null,
        },
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
    const run = new Run(this.deps.log, { returnCaseId: rc.id }, attempt?.done ?? []);
    const language = await this.deps.language(rc.salesChannelId);
    await this.toCustomer(
      run,
      rc,
      language,
      {
        code: 'return_comment_added',
        messageId: `return_comment:${comment.id}`,
        variables: {
          caseReference: caseReference(rc),
          commentBody: comment.body,
          caseUrl: caseLink(this.deps.storefrontBaseUrl, rc.id),
        },
      },
      {
        messageId: `return_guest_comment:${comment.id}`,
        variables: { caseReference: caseReference(rc), commentBody: comment.body },
      },
    );
    return this.finish(run, attempt);
  }

  private async statusEntered(
    job: Extract<ReturnsNotificationJob, { kind: 'status_entered' }>,
    attempt?: DispatchAttempt,
  ): Promise<DispatchReport> {
    const [rc, status] = await Promise.all([this.deps.store.loadCase(job.returnCaseId), this.deps.store.loadStatus(job.statusCode)]);
    // A status deleted since sends nothing; a renamed one sends its new name.
    if (!rc || !status) return { skipped: 'gone', messages: [] };
    const run = new Run(this.deps.log, { returnCaseId: rc.id }, attempt?.done ?? []);
    const language = await this.deps.language(rc.salesChannelId);
    await this.toCustomer(
      run,
      rc,
      language,
      {
        code: 'return_status_entered',
        messageId: `return_status:${job.eventId}`,
        variables: {
          caseReference: caseReference(rc),
          statusName: statusNameIn(status, language),
          caseUrl: caseLink(this.deps.storefrontBaseUrl, rc.id),
        },
      },
      {
        messageId: `return_guest_status:${job.eventId}`,
        variables: { caseReference: caseReference(rc), statusName: statusNameIn(status, language) },
      },
    );
    return this.finish(run, attempt);
  }

  /**
   * The guest's verification link (`specs/181-guest-complaints/` FR-020, FR-025; research
   * R-3). The link is re-derived here from the row's id — no secret travelled in the job.
   * A row gone, already redeemed or no longer valid (superseded, expired) sends nothing:
   * its link would not work. Whether the address belongs to an account is decided here,
   * never in the request, and exists only inside the e-mail; a failing lookup leaves the
   * sentence out.
   */
  private async guestVerification(verificationId: string, attempt?: DispatchAttempt): Promise<DispatchReport> {
    const row = await this.deps.store.loadGuestVerification(verificationId);
    const now = this.deps.now ? this.deps.now() : new Date();
    if (!row || row.redeemedAt !== null || row.linkExpiresAt.getTime() <= now.getTime()) {
      return { skipped: 'gone', messages: [] };
    }
    const run = new Run(this.deps.log, { verificationId: row.id }, attempt?.done ?? []);
    if (run.done.has(GUEST_KEY)) return this.finish(run, attempt);
    const base = (this.deps.storefrontBaseUrl ?? '').trim().replace(/\/+$/, '');
    if (base === '') {
      run.outcome('return_guest_verification', 'guest', 'no_recipient');
      return this.finish(run, attempt);
    }
    const [language, hasAccount] = await Promise.all([this.deps.language(row.salesChannelId), this.hasAccount(row.email)]);
    const token = this.deps.guestLinks.verificationToken(row.id);
    await this.send(run, GUEST_KEY, 'guest', {
      code: 'return_guest_verification',
      salesChannelId: row.salesChannelId,
      language,
      to: row.email,
      messageId: `return_guest_verification:${row.id}`,
      variables: {
        verifyUrl: `${base}/returns/guest/verify?token=${encodeURIComponent(token)}`,
        linkValidMinutes: String(GUEST_VERIFICATION_LINK_VALID_MINUTES),
        hasAccount: hasAccount ? 'yes' : '',
        signInUrl: `${base}/login`,
      },
      meta: { verificationId: row.id, kind: 'return_guest_verification' },
    });
    return this.finish(run, attempt);
  }

  /**
   * A replaced tracking link (181 FR-046), to the verified address. Sent only while the
   * job's version is still the case's: a link replaced again since would not work, and
   * the newer job carries the one that does. An erased case is sent nothing (FR-072).
   */
  private async guestLinkReissued(
    job: Extract<ReturnsNotificationJob, { kind: 'guest_link_reissued' }>,
    attempt?: DispatchAttempt,
  ): Promise<DispatchReport> {
    const rc = await this.deps.store.loadCase(job.caseId);
    if (!rc || rc.customerAccountId != null || rc.trackingVersion !== job.trackingVersion) return { skipped: 'gone', messages: [] };
    const run = new Run(this.deps.log, { returnCaseId: rc.id }, attempt?.done ?? []);
    if (run.done.has(GUEST_KEY)) return this.finish(run, attempt);
    const to = rc.personalDataErasedAt ? '' : (rc.contact?.email ?? '').trim();
    const trackingUrl = this.trackingUrl(rc);
    if (to === '' || trackingUrl === '') {
      run.outcome('return_guest_link_reissued', 'guest', 'no_recipient');
      return this.finish(run, attempt);
    }
    await this.send(run, GUEST_KEY, 'guest', {
      code: 'return_guest_link_reissued',
      salesChannelId: rc.salesChannelId,
      language: await this.deps.language(rc.salesChannelId),
      to,
      messageId: `return_guest_link:${rc.id}:${job.trackingVersion}`,
      variables: { caseReference: caseReference(rc), trackingUrl },
      meta: { returnCaseId: rc.id, kind: 'return_guest_link_reissued' },
    });
    return this.finish(run, attempt);
  }

  /** The case's current tracking link, re-derived at send time (181 FR-044); `''` without one. */
  private trackingUrl(rc: NotificationCase): string {
    if (rc.customerAccountId != null || rc.trackingVersion == null) return '';
    return trackingUrlOf(this.deps.storefrontBaseUrl, this.deps.guestLinks.trackingToken(rc.id, rc.trackingVersion));
  }

  /** "{name} (guest)" in the e-mail's language, for the shop (181 FR-050); `''` once erased. */
  private async guestName(rc: NotificationCase, language: string): Promise<string> {
    const name = rc.personalDataErasedAt ? '' : (rc.contact?.name ?? '').trim();
    if (rc.customerAccountId != null || name === '') return '';
    try {
      if (this.deps.translate) return await this.deps.translate('notifications.newCase.guestName', language, { name });
    } catch {
      // The English sentence below.
    }
    return `${name} (guest)`;
  }

  private async hasAccount(email: string): Promise<boolean> {
    try {
      const account = await this.deps.customers.findByEmail(email);
      return account !== null && account.deletedAt === null && account.anonymizedAt === null;
    } catch {
      return false;
    }
  }

  // --- internals ----------------------------------------------------------------------

  /**
   * The filer's message, once per job. Which message and where is
   * `customerMessageFor`'s (181 research R-7): an account that is gone, deleted or
   * anonymised has no address; a guest's case gets the guest twin at the verified
   * address, with the case's current tracking link; an erased guest case gets nothing.
   */
  private async toCustomer(
    run: Run,
    rc: NotificationCase,
    language: string,
    account: { code: AccountMessageCode; messageId: string; variables: Record<string, string> },
    guest: { messageId: string; variables: Record<string, string> },
  ): Promise<void> {
    if (run.done.has(CUSTOMER_KEY)) return;
    const message = customerMessageFor(rc, account.code);
    if (message === null) {
      run.outcome(account.code, 'guest', 'no_recipient');
      return;
    }
    if (message.audience === 'guest') {
      const trackingUrl = this.trackingUrl(rc);
      if (trackingUrl === '') {
        run.outcome(message.code, 'guest', 'no_recipient');
        return;
      }
      await this.send(run, CUSTOMER_KEY, 'guest', {
        code: message.code,
        salesChannelId: rc.salesChannelId,
        language,
        to: message.to,
        messageId: guest.messageId,
        variables: { ...guest.variables, trackingUrl },
        meta: { returnCaseId: rc.id, kind: message.code },
      });
      return;
    }
    const found = await this.deps.customers.findById(message.customerAccountId);
    const to = found && found.deletedAt === null && found.anonymizedAt === null ? found.email : null;
    if (!to) {
      run.outcome(account.code, 'customer', 'no_recipient');
      return;
    }
    await this.send(run, CUSTOMER_KEY, 'customer', {
      code: account.code,
      salesChannelId: rc.salesChannelId,
      language,
      to,
      messageId: account.messageId,
      variables: account.variables,
      meta: { returnCaseId: rc.id, kind: account.code },
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
