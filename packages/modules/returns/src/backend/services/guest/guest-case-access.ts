import type { EntityManager } from '@mikro-orm/postgresql';
import { isUuidShape, type GuestCaseView } from '@endora-commerce/contracts';
import { ReturnCase } from '../../entities/return-case.entity.js';
import { ReturnCaseAttachment } from '../../entities/return-case-attachment.entity.js';
import { ReturnCaseComment } from '../../entities/return-case-comment.entity.js';
import { ReturnCaseItem } from '../../entities/return-case-item.entity.js';
import { ReturnReason } from '../../entities/return-reason.entity.js';
import { caseReference } from '../../domain/case-reference.js';
import { resolveReturnStatusName } from '../../domain/return-status-graph.js';
import type { ReturnStatusGraphService } from '../return-status-graph-service.js';
import type { GuestLinks } from './guest-tracking-link.js';

/**
 * The one home that turns a guest credential into case rows
 * (`specs/181-guest-complaints/` research R-1, Principle XI).
 *
 * The guest and tracking routes run anonymous, and anonymous traffic is the platform's
 * **system** mode, which reads unfiltered (F4). So nothing on those routes may query a
 * case row on its own: every read is keyed here, by the opened tracking token or by the
 * guest session, and `guest-case-access.test.ts` pins that `routes.guest.ts` names no
 * entity. This is the token-scoping counterpart of `ReturnCaseScope` for customers.
 *
 * - {@link GuestCaseAccess.load} opens the seal and reads exactly one case: a guest's
 *   (`customer_account_id is null`), at the token's version, valid per research R-5.
 *   Anything else is `null`, one answer for all.
 * - {@link GuestCaseAccess.pendingUploadsOf} reads the session's own unclaimed uploads.
 * - {@link GuestCaseAccess.attachmentOf} reads a file of a case `load` already answered.
 */

/** How long a closed case's tracking link keeps working (FR-043). */
export const TRACKING_LINK_VALID_DAYS_AFTER_CLOSING = 90;
const DAY_MS = 86_400_000;

/** The facts a tracking link's validity reads — computed, never stored (research R-5). */
export interface TrackingLinkFacts {
  readonly customerAccountId: string | null;
  readonly trackingVersion?: number | null;
  readonly personalDataErasedAt?: Date | null;
  readonly closedAt?: Date | null;
}

/** When the link stops working: `null` while the case is open, or once its data is erased. */
export function trackingLinkValidUntil(rc: TrackingLinkFacts): Date | null {
  if (rc.personalDataErasedAt || !rc.closedAt) return null;
  return new Date(rc.closedAt.getTime() + TRACKING_LINK_VALID_DAYS_AFTER_CLOSING * DAY_MS);
}

/** A guest case, at this version, not erased, open or closed for under 90 days. */
export function isTrackingLinkOpen(rc: TrackingLinkFacts, version: number, now: Date): boolean {
  if (rc.customerAccountId != null) return false;
  if (rc.trackingVersion == null || rc.trackingVersion !== version) return false;
  if (rc.personalDataErasedAt) return false;
  const until = trackingLinkValidUntil(rc);
  return until === null || until.getTime() > now.getTime();
}

/** A label of a language map: the exact tag, its primary subtag, English, then any. */
function labelIn(label: Record<string, string>, language: string): string {
  const english = label['en'] ?? Object.values(label)[0] ?? '';
  return resolveReturnStatusName({ name: label, defaultName: english, code: '' }, language);
}

export interface GuestCaseAccessDeps {
  readonly emFactory: () => EntityManager;
  readonly links: Pick<GuestLinks, 'openTracking'>;
  readonly graphService: Pick<ReturnStatusGraphService, 'loadGraph'>;
  readonly now?: () => Date;
}

export class GuestCaseAccess {
  constructor(private readonly deps: GuestCaseAccessDeps) {}

  /** The case a tracking token opens, or `null` for any token that opens none (FR-043). */
  async load(token: string | undefined, em: EntityManager = this.deps.emFactory()): Promise<ReturnCase | null> {
    if (typeof token !== 'string') return null;
    const opened = this.deps.links.openTracking(token);
    if (opened === null) return null;
    const rc = await em.findOne(ReturnCase, { id: opened.caseId, customerAccountId: null, trackingVersion: opened.version });
    if (!rc || !isTrackingLinkOpen(rc, opened.version, this.now())) return null;
    return rc;
  }

  /** The session's own unclaimed, unexpired uploads — `ids` narrows them (research R-4). */
  async pendingUploadsOf(
    sessionId: string,
    opts: { em?: EntityManager; ids?: readonly string[] } = {},
  ): Promise<ReturnCaseAttachment[]> {
    const em = opts.em ?? this.deps.emFactory();
    return em.find(ReturnCaseAttachment, {
      guestSessionId: sessionId,
      customerAccountId: null,
      organizationId: null,
      returnCaseId: null,
      expiresAt: { $gt: this.now() },
      ...(opts.ids ? { id: { $in: opts.ids.filter(isUuidShape) } } : {}),
    });
  }

  /** A served file of a case {@link load} answered; `null` for one of any other case. */
  async attachmentOf(rc: ReturnCase, attachmentId: string): Promise<ReturnCaseAttachment | null> {
    if (!isUuidShape(attachmentId)) return null;
    return this.deps.emFactory().findOne(ReturnCaseAttachment, {
      id: attachmentId,
      returnCaseId: rc.id,
      storageLocator: { $ne: null },
    });
  }

  /** The tracking page (G8): customer-visible content only, never a staff field (FR-041). */
  async view(rc: ReturnCase, language: string): Promise<GuestCaseView> {
    const em = this.deps.emFactory();
    const [items, comments, attachments, graph] = await Promise.all([
      em.find(ReturnCaseItem, { returnCaseId: rc.id }, { orderBy: { id: 'asc' } }),
      em.find(ReturnCaseComment, { returnCaseId: rc.id, isCustomerVisible: true }, { orderBy: { createdAt: 'asc' } }),
      em.find(ReturnCaseAttachment, { returnCaseId: rc.id, storageLocator: { $ne: null } }, { orderBy: { createdAt: 'asc' } }),
      this.deps.graphService.loadGraph(),
    ]);
    const reasonIds = [...new Set(items.map((it) => it.reasonId).filter((id): id is string => Boolean(id)))];
    const reasons = new Map(
      (reasonIds.length > 0 ? await em.find(ReturnReason, { id: { $in: reasonIds } }) : []).map((r) => [r.id, r]),
    );
    const lineIndex = new Map(items.map((it, index) => [it.id, index] as const));
    const status = graph.get(rc.statusCode);
    const until = trackingLinkValidUntil(rc);
    return {
      reference: caseReference(rc),
      kind: 'complaint',
      status: { code: rc.statusCode, label: status ? resolveReturnStatusName(status, language) : rc.statusCode },
      isClosed: graph.isTerminal(rc.statusCode),
      submittedAt: rc.submittedAt.toISOString(),
      lines: items.map((it) => {
        const reason = it.reasonId ? reasons.get(it.reasonId) : undefined;
        return {
          productName: it.productName,
          quantity: it.quantity,
          reasonLabel: reason ? labelIn(reason.label, language) : '',
          description: it.description ?? '',
          serialNumber: it.serialNumber ?? null,
        };
      }),
      purchase: { proofNumber: rc.purchaseProofNumber ?? null, date: rc.purchaseDate ?? '' },
      contact: { name: rc.contact?.name ?? '', email: rc.contact?.email ?? '', phone: rc.contact?.phone ?? null },
      returnAddress: rc.returnAddress!,
      rmaNumber: rc.rmaNumber ?? null,
      comments: comments.map((c) => ({
        id: c.id,
        authorKind: c.authorAdminUserId ? ('shop' as const) : ('you' as const),
        body: c.body,
        createdAt: c.createdAt.toISOString(),
      })),
      attachments: attachments.map((a) => ({
        id: a.id,
        type: a.type,
        filename: a.filename ?? 'attachment',
        sizeBytes: a.sizeBytes ?? 0,
        lineIndex: a.returnCaseItemId ? (lineIndex.get(a.returnCaseItemId) ?? null) : null,
      })),
      linkValidUntil: until ? until.toISOString() : null,
      // Customer-visible, as on the account case page (owner ruling O-1, FR-041).
      rejectionReason: rc.rejectionReason ?? null,
    };
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
