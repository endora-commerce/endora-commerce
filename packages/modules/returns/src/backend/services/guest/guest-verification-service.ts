import { createHash, randomBytes } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, GUEST_VERIFICATION_LINK_VALID_MINUTES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { ReturnGuestVerification } from '../../entities/return-guest-verification.entity.js';
import type { ReturnsNotificationJob } from '../notifications/dispatch.js';
import type { GuestLinks } from './guest-tracking-link.js';
import { isHoneypotHit } from './honeypot.js';

/**
 * The e-mail verification that starts a guest session, and the session it becomes
 * (`specs/181-guest-complaints/` FR-020 – FR-026; research R-3, R-4, R-8).
 *
 * - **Request.** One answer whatever happens (FR-021): the honeypot and the per-address
 *   throttle (3 an hour, 10 a day, per channel) store and send nothing, silently. An
 *   accepted request supersedes the address's earlier unredeemed links on the channel
 *   (FR-022), writes one row and hands a `guest_verification` job to the queue after the
 *   commit. No account is looked up here: the worker does that for the e-mail's extra
 *   sentence, so neither the answer nor its timing tells whether an address has one.
 * - **Redeem.** The link seals the row's id (research R-5). One atomic update takes it:
 *   unredeemed, unexpired, on the request's channel — anything else is one `410`. Only
 *   the SHA-256 of the session token is stored.
 * - **Session.** Looked up by the token's hash on the request's channel, live for 24
 *   hours from the redeem unless the visitor leaves (FR-023).
 *
 * The rows are `@GlobalEntity` (research R-1): addressed only by a sealed id or a hash.
 * None of these writes is a case write, so none is a Command (research R-6).
 */

export const GUEST_LINK_TTL_MS = GUEST_VERIFICATION_LINK_VALID_MINUTES * 60_000;
export const GUEST_SESSION_TTL_MS = 24 * 3_600_000;
/** Per address and channel (research R-8): beyond these, the request is answered and nothing happens. */
export const GUEST_VERIFICATIONS_PER_HOUR = 3;
export const GUEST_VERIFICATIONS_PER_DAY = 10;

export interface GuestVerificationServiceDeps {
  readonly emFactory: () => EntityManager;
  readonly links: Pick<GuestLinks, 'openVerification'>;
  /** Hand a job to `returns-notifications` after the write; never throws. */
  readonly enqueue: (job: ReturnsNotificationJob) => Promise<void>;
  readonly now?: () => Date;
}

export interface GuestVerificationRequest {
  readonly email: string;
  readonly hp?: string | undefined;
  readonly language: string;
  readonly salesChannelId: string;
}

/** A live guest session, as a guest route sees it. */
export interface GuestSessionContext {
  /** The verification row's id: the session's id (`guest_session_id`). */
  readonly id: string;
  readonly salesChannelId: string;
  /** The verified address. */
  readonly email: string;
  readonly verifiedAt: Date;
  readonly expiresAt: Date;
}

export interface RedeemedGuestSession {
  readonly sessionToken: string;
  readonly email: string;
  readonly expiresAt: Date;
}

/** SHA-256 hex of the lower-cased, trimmed address (research R-3). */
export function guestEmailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}

function sessionTokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const linkInvalid = (): HttpError =>
  new HttpError(410, ERROR_CODES.RETURN_GUEST_LINK_INVALID, 'This link no longer works. Request a new one.');

export class GuestVerificationService {
  constructor(private readonly deps: GuestVerificationServiceDeps) {}

  /** Never refuses: the caller answers the same 202 whatever happened here (FR-021). */
  async request(input: GuestVerificationRequest): Promise<void> {
    if (isHoneypotHit(input)) return;
    const now = this.now();
    const emailHash = guestEmailHash(input.email);
    const em = this.deps.emFactory().fork();
    const recent = { emailHash, salesChannelId: input.salesChannelId };
    const [lastHour, lastDay] = await Promise.all([
      em.count(ReturnGuestVerification, { ...recent, createdAt: { $gt: new Date(now.getTime() - 3_600_000) } }),
      em.count(ReturnGuestVerification, { ...recent, createdAt: { $gt: new Date(now.getTime() - 24 * 3_600_000) } }),
    ]);
    if (lastHour >= GUEST_VERIFICATIONS_PER_HOUR || lastDay >= GUEST_VERIFICATIONS_PER_DAY) return;

    const row = await em.transactional(async (tx) => {
      // command-coverage-ignore: a verification request writes no case. The row holds the
      // address for at most 7 days and is not an audited business record (research R-6);
      // the filing it may lead to is the audited Command `return_case.create`.
      await tx.nativeUpdate(
        ReturnGuestVerification,
        { ...recent, redeemedAt: null, linkExpiresAt: { $gt: now } },
        { linkExpiresAt: now },
      );
      const created = tx.create(ReturnGuestVerification, {
        salesChannelId: input.salesChannelId,
        email: input.email.trim(),
        emailHash,
        language: input.language,
        linkExpiresAt: new Date(now.getTime() + GUEST_LINK_TTL_MS),
        createdAt: now,
      });
      tx.persist(created);
      return created;
    });
    await this.deps.enqueue({ kind: 'guest_verification', verificationId: row.id });
  }

  /** Redeem a link once; every invalid shape is one `410 RETURN_GUEST_LINK_INVALID`. */
  async redeem(token: string, salesChannelId: string): Promise<RedeemedGuestSession> {
    const verificationId = this.deps.links.openVerification(token);
    if (verificationId === null) throw linkInvalid();
    const now = this.now();
    const sessionToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + GUEST_SESSION_TTL_MS);
    const em = this.deps.emFactory().fork();
    // command-coverage-ignore: redeeming a link opens a guest session and writes no case
    // (research R-6). One conditional update, so two clicks cannot both take the link.
    const taken = await em.nativeUpdate(
      ReturnGuestVerification,
      { id: verificationId, salesChannelId, redeemedAt: null, linkExpiresAt: { $gt: now } },
      { redeemedAt: now, sessionTokenHash: sessionTokenHash(sessionToken), sessionExpiresAt: expiresAt },
    );
    if (taken !== 1) throw linkInvalid();
    const row = await em.findOneOrFail(ReturnGuestVerification, { id: verificationId });
    return { sessionToken, email: row.email, expiresAt };
  }

  /** The live session a token names on this channel, or `null`. */
  async session(token: string | undefined, salesChannelId: string): Promise<GuestSessionContext | null> {
    if (!token || token.length > 128) return null;
    const row = await this.deps
      .emFactory()
      .fork()
      .findOne(ReturnGuestVerification, {
        sessionTokenHash: sessionTokenHash(token),
        salesChannelId,
        endedAt: null,
        sessionExpiresAt: { $gt: this.now() },
      });
    if (!row || !row.redeemedAt || !row.sessionExpiresAt) return null;
    return {
      id: row.id,
      salesChannelId: row.salesChannelId,
      email: row.email,
      verifiedAt: row.redeemedAt,
      expiresAt: row.sessionExpiresAt,
    };
  }

  /** End a session (FR-023). */
  async leave(session: GuestSessionContext): Promise<void> {
    // command-coverage-ignore: ending a guest session writes no case (research R-6).
    await this.deps
      .emFactory()
      .fork()
      .nativeUpdate(ReturnGuestVerification, { id: session.id, endedAt: null }, { endedAt: this.now() });
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}
