// `config: { rateLimit }` is a declaration-merging augmentation of
// `@fastify/rate-limit`, which the host registers globally; the type-only
// import loads the declarations for this package's own compile and emits
// nothing (the `product_feeds` precedent, `routes.public.ts`).
import type {} from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  createQuoteRequestSchema,
  patchQuoteRequestSchema,
  acceptRevisionSchema,
  rejectRevisionSchema,
  resubmitQuoteRequestSchema,
  ERROR_CODES,
  firstLanguageTag,
  OrganizationCannotTransactError,
  organizationPermissionPreHandler,
  type Actor,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import type { RfqService, CustomerContext } from './services/rfq-service.js';
import { HttpError } from '@endora-commerce/platform/http';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';

/**
 * Draft edits per quote request per minute (research R16).
 *
 * Counted **after** the customer guard and keyed on the caller as well as the
 * request. The limiter's default hook is `onRequest`, ahead of every guard, and
 * the key used to be the request id alone — so 31 unauthenticated PATCHes
 * naming a request's id, each answered 401, emptied its owner's bucket for the
 * rest of the minute (feature 146 QA finding). `preHandler` lands the counter
 * behind `requireCustomer` — the limiter appends its hook after the route's own
 * guard, and the platform's guards-before-validation listener moves that chain
 * to `preValidation` in order — so a refused caller consumes nothing; the
 * actor in the key keeps one customer's edits from spending another's budget
 * for the same request.
 */
const DRAFT_EDIT_RATE_LIMIT = {
  max: 30,
  timeWindow: '1 minute',
  hook: 'preHandler' as const,
  keyGenerator: (request: FastifyRequest): string => draftEditRateLimitKey(request),
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The draft-edit bucket a request counts against (security review W3).
 *
 * Only a well-formed uuid enters the key; any other `:id` — which the route
 * refuses anyway — shares one bucket per caller. The raw segment used to be
 * embedded, so one caller could mint a fresh bucket per request just by
 * varying the path. The schema cannot do this check first: the limiter runs in
 * the guard chain, which `guards-before-validation` moves ahead of validation.
 *
 * The store is the one the host registers `@fastify/rate-limit` with —
 * `packages/platform/src/http/server.ts` passes no `redis`, so it is the
 * plugin's in-process `LocalStore`, a route-level child of which is an LRU
 * bounded at its default 5000 entries per process (`cache` is not set). The
 * map cannot grow without bound; what a caller minting keys can do is evict
 * other buckets early, which is why the key space is narrowed here. A random
 * well-formed uuid still names a bucket of its own — bounded by that LRU and by
 * the caller having to be an authenticated customer.
 */
export function draftEditRateLimitKey(request: FastifyRequest): string {
  const actor = request.actor as Actor | undefined;
  const caller = actor?.kind === 'customer' ? actor.customerAccountId : request.ip;
  const id = (request.params as { id?: unknown } | undefined)?.id;
  return typeof id === 'string' && UUID.test(id)
    ? `quote-request-draft-edit:${caller}:${id}`
    : `quote-request-draft-edit:${caller}`;
}

export type RequireCustomerGuard = (
  req: FastifyRequest,
  reply: FastifyReply,
) => Promise<void>;

export interface CustomerContextResolver {
  (request: FastifyRequest): Promise<CustomerContext>;
}

export interface QuoteRequestsCustomerDeps {
  rfqService: RfqService;
  requireCustomer: RequireCustomerGuard;
  resolveCustomerContext: CustomerContextResolver;
  /**
   * Optional gate — refuses submission when the Customer's Organization
   * is not `active` (feature 026 US1 / US3).
   */
  assertOrganizationCanTransact?: (organizationId: string) => Promise<void>;
  /**
   * `organizations`' permission port, resolved on every request
   * (`specs/170-organization-roles/`, FR-040): the route guards below judge
   * the member's role through it.
   */
  organizationPermissions: () => OrganizationPermissionPort;
}

function parseIfMatch(request: FastifyRequest): number | null {
  const header = request.headers['if-match'];
  if (!header || typeof header !== 'string') return null;
  const trimmed = header.replace(/^"|"$/g, '');
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) ? n : null;
}

function setEtag(reply: FastifyReply, version: number): void {
  reply.header('etag', `"${version}"`);
}

export async function registerQuoteRequestsCustomerRoutes(
  app: FastifyInstance,
  deps: QuoteRequestsCustomerDeps,
): Promise<void> {
  const { rfqService, requireCustomer, resolveCustomerContext } = deps;
  const { assertOrganizationCanTransact, organizationPermissions } = deps;

  // `specs/170-organization-roles/` FR-040 (`contracts/storefront-api.md` §5).
  // Declared after `requireCustomer`, so an anonymous visitor is still 401;
  // a member lacking the code is `403 ORGANIZATION_PERMISSION_REQUIRED`
  // before the body is validated or the quote request is looked up.
  const mayCreateQuoteRequest = organizationPermissionPreHandler(
    organizationPermissions,
    'quote_requests.create',
  );
  // Converting fills the buyer's basket, so it is the basket's code.
  const mayFillCart = organizationPermissionPreHandler(organizationPermissions, 'carts.create');

  const guardCanTransact = async (organizationId: string): Promise<void> => {
    if (!assertOrganizationCanTransact) return;
    try {
      await assertOrganizationCanTransact(organizationId);
    } catch (err) {
      if (err instanceof OrganizationCannotTransactError) {
        throw new HttpError(
          423,
          ERROR_CODES.FORBIDDEN,
          'Your Organization cannot submit Quote Requests in its current status.',
          { code: 'organization_cannot_transact', status: err.status },
        );
      }
      throw err;
    }
  };

  // GET /api/v1/quote-requests — list visible Quote Requests for the caller
  app.get('/api/v1/quote-requests', { preHandler: requireCustomer }, async (request) => {
    const ctx = await resolveCustomerContext(request);
    const data = await rfqService.listVisibleForCustomer(ctx);
    return {
      data,
      pagination: { limit: 50, nextCursor: null, hasMore: false },
    };
  });

  // GET /api/v1/quote-requests/:id — detail
  app.get<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id',
    { preHandler: requireCustomer },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const rfq = await rfqService.getForCustomer(request.params.id, ctx);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests — create + submit a new Quote Request
  app.post(
    '/api/v1/quote-requests',
    { preHandler: [requireCustomer, mayCreateQuoteRequest], schema: { body: createQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      await guardCanTransact(ctx.organizationId);
      const body = createQuoteRequestSchema.parse(request.body);
      // Feature 163 — the channel this request resolved, named explicitly.
      const rfq = await rfqService.createForCustomer(ctx, body, {
        language: await request.responseLanguage(),
        ...scopeLanguageTagOf(request),
        salesChannelId: getResolvedChannel(request).id,
      });
      setEtag(reply, rfq.version);
      reply.code(201);
      return { data: rfq };
    },
  );

  // PATCH /api/v1/quote-requests/:id — customer-side draft edit
  //
  // Feature 146 (research R16, threat model T11): FR-038 lifted the one-edit
  // limit, and every edit appends a revision and a history event, so the edit
  // loop is bounded per request — generously for a person, tightly for a
  // script. The host's global per-client limit still applies on top.
  app.patch<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id',
    {
      preHandler: requireCustomer,
      schema: { body: patchQuoteRequestSchema },
      config: { rateLimit: DRAFT_EDIT_RATE_LIMIT },
    },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = patchQuoteRequestSchema.parse(request.body);
      const expectedVersion = parseIfMatch(request);
      const rfq = await rfqService.patchDraft(request.params.id, ctx, body, expectedVersion, {
        language: await request.responseLanguage(),
        ...scopeLanguageTagOf(request),
        salesChannelId: getResolvedChannel(request).id,
      });
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests/:id/accept-revision
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/accept-revision',
    { preHandler: requireCustomer, schema: { body: acceptRevisionSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = acceptRevisionSchema.parse(request.body);
      const rfq = await rfqService.acceptRevision(
        request.params.id,
        ctx,
        body.expectedRevisionNumber,
      );
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests/:id/reject-revision
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/reject-revision',
    { preHandler: requireCustomer, schema: { body: rejectRevisionSchema } },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = rejectRevisionSchema.parse(request.body);
      const rfq = await rfqService.rejectRevision(
        request.params.id,
        ctx,
        body.expectedRevisionNumber,
        body.reason,
      );
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // POST /api/v1/quote-requests/:id/convert-to-order — start checkout
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/convert-to-order',
    { preHandler: [requireCustomer, mayFillCart] },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      // Into the basket of the storefront the buyer converts on
      // (`specs/154-sales-channel-access/`): a customer holds one per channel.
      const result = await rfqService.convertToOrder(
        request.params.id,
        ctx,
        getResolvedChannel(request).id,
      );
      reply.code(200);
      return { data: result };
    },
  );

  // POST /api/v1/quote-requests/:id/resubmit — clone into a new Pending RFQ
  app.post<{ Params: { id: string } }>(
    '/api/v1/quote-requests/:id/resubmit',
    {
      preHandler: [requireCustomer, mayCreateQuoteRequest],
      schema: { body: resubmitQuoteRequestSchema.optional() },
    },
    async (request, reply) => {
      const ctx = await resolveCustomerContext(request);
      const body = resubmitQuoteRequestSchema.parse(request.body ?? {});
      const rfq = await rfqService.resubmit(request.params.id, ctx, body, {
        language: await request.responseLanguage(),
        ...scopeLanguageTagOf(request),
        salesChannelId: getResolvedChannel(request).id,
      });
      setEtag(reply, rfq.version);
      reply.code(201);
      return { data: rfq };
    },
  );
}

/**
 * Feature 163 — the request's first `Accept-Language` tag, as `{ languageTag }`
 * when present: the lines' scope language is it resolved against the channel,
 * as the basket's is. Never `responseLanguage()`, which falls back to a bundle
 * language (T155 finding §1.5b).
 */
function scopeLanguageTagOf(request: FastifyRequest): { languageTag?: string } {
  const tag = firstLanguageTag(request.headers['accept-language']);
  return tag ? { languageTag: tag } : {};
}
