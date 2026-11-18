import multipart from '@fastify/multipart';
import type { FastifyInstance, FastifyRequest, RouteShorthandOptions } from 'fastify';
import {
  ERROR_CODES,
  GUEST_VERIFICATION_LINK_VALID_MINUTES,
  RETURNS_GUEST_SESSION_COOKIE,
  RETURNS_TRACKING_TOKEN_HEADER,
  createGuestComplaintRequestSchema,
  guestCommentRequestSchema,
  guestSessionRedeemRequestSchema,
  guestTrackingAttachmentFieldsSchema,
  guestVerificationRequestSchema,
  returnAttachmentUploadFieldsSchema,
  type GuestAvailability as GuestAvailabilityDto,
  type GuestCaseFiled,
  type GuestCaseView,
  type GuestFormConfig,
  type GuestSession,
  type GuestVerificationAccepted,
  type ReturnAttachmentDto,
  type ReturnCaseCommentDto,
  type ReturnFormConfig,
  type ReturnReasonDto,
  type ReturnUploadDto,
} from '@endora-commerce/contracts';
import { HttpError, productAudienceOf } from '@endora-commerce/platform/http';
import { getResolvedChannel, scopeRequestToActor } from '@endora-commerce/platform/kernel';
import { sendAttachment } from './attachment-response.js';
import { RETURN_UPLOAD_MULTIPART_OPTIONS, readMultipartFile } from './routes.uploads.js';
import type { GuestAvailability } from './services/guest/guest-availability.js';
import type { GuestCaseAccess } from './services/guest/guest-case-access.js';
import type { GuestSessionContext, GuestVerificationService } from './services/guest/guest-verification-service.js';
import type { ReturnAttachmentService } from './services/return-attachment-service.js';
import type { ReturnCaseService } from './services/return-case-service.js';
import type { ReturnCommentService } from './services/return-comment-service.js';

/**
 * The guest API of `returns` (`specs/181-guest-complaints/` contracts/guest-api.md G1 –
 * G10): anonymous routes, registered through `ctx.routes`, so absent while the module
 * is off (FR-080).
 *
 * - The channel is always the request's resolved channel (Principle XII).
 * - Every route checks in one order: the module (the platform, by the route's absence),
 *   then the setting (not on G4 and G8 – G10), then the session or the tracking token,
 *   then the body (research R-12) — so a request the module or the setting refuses
 *   never learns whether its token or body was good.
 * - The guest session is the `b2b_returns_guest` cookie the storefront forwards in an
 *   allow-listed `Cookie` header (research R-4); the tracking token is the
 *   `X-Returns-Tracking-Token` header, never the URL (research R-5).
 *
 * **Anonymous, whatever else the request carries** (research R-1, R-4; lead ruling on
 * batch 2). The platform's `onRequest` scope hook derives the request's tenant context
 * from the session cookies before any route runs, so a browser signed in as a customer
 * would reach these routes scoped to that customer's organization — where a guest case,
 * which has none, reads as absent. One `preHandler` for the whole group puts the request
 * back to anonymous: it drops the actor the cookies resolved to and asks the platform's
 * `scopeRequestToActor` to derive the context again — the seam `auth`'s own guards use
 * when a route accepts a different actor from the ambient one. The anonymous context is
 * the platform's system mode, so nothing here relies on a filter: every case row is
 * reached through `GuestCaseAccess` (research R-1), keyed by the session or the opened
 * token, and `guest-case-access.test.ts` pins that this file names no entity.
 * `withSystemScope` is not used (R-1 rejected it): anonymous traffic is already there.
 */
const API = '/api/v1/returns/guest';
const TRACK = '/api/v1/returns/track';

/**
 * Per client address (research R-8). `request.ip` is the shopper's only where the
 * deployment trusts the storefront as a proxy and the storefront forwards
 * `x-forwarded-for` — as for `forms`. A 429 names no e-mail address, so it does not break
 * the one answer per address (FR-021, plan clarification 5).
 */

/**
 * A route's own ceiling, read by `@fastify/rate-limit` from `config.rateLimit`; the host
 * registers that plugin globally. Typed here rather than through the plugin's
 * declaration merging, which would make `@fastify/rate-limit` a peer of this package
 * for a type (plan: nothing enters this package's dependencies; Principle IV).
 */
interface RouteRateLimit {
  readonly max: number;
  readonly timeWindow: string;
  readonly keyGenerator: (request: FastifyRequest) => string;
}

/**
 * Route options carrying a rate limit. Fastify types `config` as an empty interface the
 * plugin augments, so without that augmentation the one cast here is what states it.
 */
function rateLimited(rateLimit: RouteRateLimit): RouteShorthandOptions {
  return { config: { rateLimit } } as unknown as RouteShorthandOptions;
}

const perAddress = (name: string, max: number): RouteRateLimit => ({
  max,
  timeWindow: '10 minutes',
  keyGenerator: (request: FastifyRequest): string => `returns-guest-${name}:${request.ip}`,
});

export const RETURNS_GUEST_RATE_LIMITS = {
  verificationRequest: perAddress('verify', 5),
  redeem: perAddress('redeem', 20),
  upload: perAddress('upload', 60),
  submission: perAddress('submit', 10),
  trackingRead: perAddress('track-read', 60),
  trackingWrite: perAddress('track-write', 10),
} as const satisfies Readonly<Record<string, RouteRateLimit>>;

export interface ReturnsGuestRoutesDeps {
  readonly availability: GuestAvailability;
  readonly verifications: GuestVerificationService;
  readonly access: GuestCaseAccess;
  readonly caseService: ReturnCaseService;
  readonly commentService: ReturnCommentService;
  readonly attachmentService: ReturnAttachmentService;
  /** 180's form configuration for a complaint without an order, on a channel, in a language. */
  readonly complaintFormConfig: (salesChannelId: string, language: string) => Promise<ReturnFormConfig>;
  /** The active reasons a complaint may give — the customer's reasons route needs a session. */
  readonly complaintReasons: () => Promise<ReturnReasonDto[]>;
}

/** The guest session cookie, read structurally: the host registers `@fastify/cookie`. */
function sessionCookieOf(request: FastifyRequest): string | undefined {
  return (request as { cookies?: Record<string, string | undefined> }).cookies?.[RETURNS_GUEST_SESSION_COOKIE];
}

/** The tracking token, from its header only — a token in the URL is never read (R-5). */
function trackingTokenOf(request: FastifyRequest): string | undefined {
  const value = request.headers[RETURNS_TRACKING_TOKEN_HEADER];
  return typeof value === 'string' ? value : undefined;
}

/**
 * The group's gate: the request runs anonymous, in the context the platform derives for
 * no actor. An actor the cookies resolved to — a customer, an admin, an API key — is
 * dropped first; a request that was anonymous already is left as it is.
 */
async function asAnonymous(request: FastifyRequest): Promise<void> {
  const carrier = request as unknown as { actor?: { kind?: string } | undefined };
  if (carrier.actor !== undefined && carrier.actor.kind !== 'anonymous') carrier.actor = undefined;
  await scopeRequestToActor(request);
}

const linkInvalid = (): HttpError =>
  new HttpError(404, ERROR_CODES.RETURN_TRACKING_LINK_INVALID, 'This link does not open a case. It may have expired or been replaced.');

export async function registerReturnsGuestRoutes(app: FastifyInstance, deps: ReturnsGuestRoutesDeps): Promise<void> {
  const { availability, verifications, access, caseService, commentService, attachmentService } = deps;

  /** The setting, for the request's channel: `403 RETURN_GUEST_COMPLAINTS_DISABLED` when off (FR-002). */
  const assertEnabled = async (salesChannelId: string): Promise<void> => {
    if (!(await availability.enabled(salesChannelId))) {
      throw new HttpError(403, ERROR_CODES.RETURN_GUEST_COMPLAINTS_DISABLED, 'Complaints without a customer account are not accepted here.');
    }
  };

  /** The live guest session on the request's channel: `401 RETURN_GUEST_SESSION_REQUIRED` otherwise. */
  const requireSession = async (request: FastifyRequest, salesChannelId: string): Promise<GuestSessionContext> => {
    const session = await verifications.session(sessionCookieOf(request), salesChannelId);
    if (!session) {
      throw new HttpError(401, ERROR_CODES.RETURN_GUEST_SESSION_REQUIRED, 'Confirm your e-mail address again to continue.');
    }
    return session;
  };

  /** Setting, then session: the start of G5 – G7. */
  const guestOf = async (request: FastifyRequest): Promise<GuestSessionContext> => {
    const salesChannelId = getResolvedChannel(request).id;
    await assertEnabled(salesChannelId);
    return requireSession(request, salesChannelId);
  };

  /** The case the request's tracking token opens: one `404` for any token that opens none (FR-043). */
  const trackedCase = async (request: FastifyRequest) => {
    const rc = await access.load(trackingTokenOf(request));
    if (!rc) throw linkInvalid();
    return rc;
  };

  await app.register(async (guest) => {
    // The parser for G6 and G10, in this child context only (as `routes.uploads.ts`).
    await guest.register(multipart, RETURN_UPLOAD_MULTIPART_OPTIONS);
    guest.addHook('preHandler', asAnonymous);

    // G1 — the storefront's switch for offering *Continue without an account* (FR-010).
    guest.get(`${API}/availability`, async (request): Promise<{ data: GuestAvailabilityDto }> => {
      return { data: { enabled: await availability.enabled(getResolvedChannel(request).id) } };
    });

    // G2 — always the same 202 (FR-021): the honeypot, the per-address throttle and an
    // address with or without an account are indistinguishable here.
    guest.post(
      `${API}/verifications`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.verificationRequest),
      async (request, reply): Promise<{ data: GuestVerificationAccepted }> => {
        const salesChannelId = getResolvedChannel(request).id;
        await assertEnabled(salesChannelId);
        const body = guestVerificationRequestSchema.parse(request.body);
        await verifications.request({
          email: body.email,
          hp: body.hp,
          language: body.language ?? (await request.responseLanguage()),
          salesChannelId,
        });
        reply.status(202);
        return { data: { linkValidMinutes: GUEST_VERIFICATION_LINK_VALID_MINUTES } };
      },
    );

    // G3 — redeem a link (scanner-safe: the storefront POSTs only on *Continue*, research R-3).
    guest.post(
      `${API}/sessions`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.redeem),
      async (request, reply): Promise<{ data: GuestSession }> => {
        const salesChannelId = getResolvedChannel(request).id;
        await assertEnabled(salesChannelId);
        const body = guestSessionRedeemRequestSchema.parse(request.body);
        const session = await verifications.redeem(body.token, salesChannelId);
        reply.status(201);
        return { data: { sessionToken: session.sessionToken, email: session.email, expiresAt: session.expiresAt.toISOString() } };
      },
    );

    // G4 — leave (FR-023). **Not gated by the setting** (lead ruling 3 on batch 2):
    // leaving only ends the caller's own session, and refusing it while guest complaints
    // are off would strand a cookie the visitor can no longer end.
    guest.delete(`${API}/sessions/current`, async (request, reply) => {
      const session = await requireSession(request, getResolvedChannel(request).id);
      await verifications.leave(session);
      reply.status(204);
      return reply.send();
    });

    // G5 — 180's form for a complaint without an order, for the session (FR-031).
    guest.get(`${API}/form-config`, async (request): Promise<{ data: GuestFormConfig }> => {
      const session = await guestOf(request);
      const [base, reasons] = await Promise.all([
        deps.complaintFormConfig(session.salesChannelId, await request.responseLanguage()),
        deps.complaintReasons(),
      ]);
      return {
        data: {
          ...base,
          reasons,
          offPlatformComplaintsEnabled: true,
          // The guest confirmation cannot be switched off (FR-045).
          confirmationEmailEnabled: true,
          verifiedEmail: session.email,
          sessionExpiresAt: session.expiresAt.toISOString(),
        },
      };
    });

    // G6 — a pending upload owned by the session (FR-035, research R-4).
    guest.post(
      `${API}/uploads`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.upload),
      async (request, reply): Promise<{ data: ReturnUploadDto }> => {
        const session = await guestOf(request);
        const { filename, bytes, fields } = await readMultipartFile(request, returnAttachmentUploadFieldsSchema);
        const data = await attachmentService.storeGuestUpload(access, session.id, { type: fields.type, filename, bytes });
        reply.status(201);
        return { data };
      },
    );

    // G7 — file the complaint. The case is stamped from the session alone (FR-033).
    guest.post(
      `${API}/cases`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.submission),
      async (request, reply): Promise<{ data: GuestCaseFiled }> => {
        const session = await guestOf(request);
        const body = createGuestComplaintRequestSchema.parse(request.body);
        const channel = getResolvedChannel(request);
        const { filed, created } = await caseService.createGuestCase(
          body,
          { id: session.id, email: session.email, verifiedAt: session.verifiedAt },
          {
            channel: { id: channel.id, defaultCurrency: channel.defaultCurrency },
            language: await request.responseLanguage(),
            // Anonymous by the gate above: a product is judged for the anonymous audience.
            audience: productAudienceOf(request),
          },
        );
        reply.status(created ? 201 : 200);
        return { data: filed };
      },
    );

    // G8 — the tracking page (FR-041). The setting is not consulted: an existing case
    // keeps working while guest complaints are off (FR-002).
    guest.get(TRACK, rateLimited(RETURNS_GUEST_RATE_LIMITS.trackingRead), async (request): Promise<{ data: GuestCaseView }> => {
      const rc = await trackedCase(request);
      return { data: await access.view(rc, await request.responseLanguage()) };
    });

    // G9 — a guest's comment (FR-042), Command `return_case.comment.add_by_guest`.
    guest.post(
      `${TRACK}/comments`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.trackingWrite),
      async (request, reply): Promise<{ data: ReturnCaseCommentDto }> => {
        const rc = await trackedCase(request);
        const body = guestCommentRequestSchema.parse(request.body);
        const data = await commentService.addByGuest(rc, body);
        reply.status(201);
        return { data };
      },
    );

    // G10 — a guest's file (FR-042), Command `return_case.attachment.add`.
    guest.post(
      `${TRACK}/attachments`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.trackingWrite),
      async (request, reply): Promise<{ data: ReturnAttachmentDto }> => {
        const rc = await trackedCase(request);
        const { filename, bytes, fields } = await readMultipartFile(request, guestTrackingAttachmentFieldsSchema);
        const data = await attachmentService.addToGuestCase(rc, { type: fields.type, filename, bytes, lineIndex: fields.lineIndex });
        reply.status(201);
        return { data };
      },
    );

    // G10 — a file of the token's case, with 180's download headers (C5).
    guest.get<{ Params: { attachmentId: string } }>(
      `${TRACK}/attachments/:attachmentId/file`,
      rateLimited(RETURNS_GUEST_RATE_LIMITS.trackingRead),
      async (request, reply) => {
        const rc = await trackedCase(request);
        const row = await access.attachmentOf(rc, request.params.attachmentId);
        if (!row) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'File not found.');
        return sendAttachment(reply, await attachmentService.openRow(row), { inlineImages: false });
      },
    );
  });
}
