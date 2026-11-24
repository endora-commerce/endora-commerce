import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  adminApproveQuoteRequestSchema,
  adminAssignQuoteRequestSchema,
  adminCancelQuoteRequestSchema,
  adminCreateQuoteRequestSchema,
  adminPatchQuoteRequestSchema,
  adminPrepareCustomerBasketResponseSchema,
  adminQuoteRequestListQuerySchema,
  adminShareQuoteRequestSchema,
  createQuoteRequestSavedViewRequestSchema,
  customFieldFiltersQueryParamSchema,
  ERROR_CODES,
  isCustomFieldFilterUnavailableFailure,
  updateQuoteRequestSavedViewRequestSchema,
  type AdminQuoteRequestListPagination,
  type SupportedLanguage,
} from '@endora-commerce/contracts';
import { savedViewActor } from './saved-view-actor.js';
import type { RfqAdminService, AdminContext } from './services/rfq-admin-service.js';
import type { QuoteRequestListViewService } from './services/quote-request-list-view-service.js';
import { getResolvedChannel, type RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { HttpError } from '@endora-commerce/platform/http';

export interface AdminContextResolver {
  (request: FastifyRequest): Promise<AdminContext>;
}

export interface QuoteRequestsAdminDeps {
  adminService: RfqAdminService;
  requireAdmin: RequireAdminFactory;
  resolveAdminContext: AdminContextResolver;
  /** `specs/147-saved-views/` (US3) — the Quote Request list's saved views. */
  listViewService: QuoteRequestListViewService;
  /** A status's name in a language, in this module's wording (issue #455). */
  statusName: (status: string, language: SupportedLanguage) => Promise<string>;
}

/** The list's one query member with a schema: the custom-field filters (feature 157). */
const customFieldFiltersQuerySchema = z.object({ customFieldFilters: customFieldFiltersQueryParamSchema });

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

export async function registerQuoteRequestsAdminRoutes(
  app: FastifyInstance,
  deps: QuoteRequestsAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin, resolveAdminContext, listViewService, statusName } = deps;
  const guard = requireAdmin('rfqs:handle');

  // `specs/157-custom-fields-list-filters/` — the custom fields the list offers as filters.
  app.get('/api/v1/admin/quote-requests/custom-field-filters', { preHandler: guard }, async () => ({
    data: await adminService.customFieldFilterFields(),
  }));

  app.get('/api/v1/admin/quote-requests', { preHandler: guard }, async (request) => {
    const ctx = await resolveAdminContext(request);
    const rawQuery = (request.query ?? {}) as Record<string, unknown>;
    // The list has no route-level query schema, so the custom-field filters are
    // read here: a repeated parameter arrives as an array and is refused rather
    // than one of its copies silently applied.
    const rawFilters = rawQuery['customFieldFilters'];
    if (rawFilters !== undefined && typeof rawFilters !== 'string') {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'customFieldFilters must be given once.');
    }
    // Parsed under its own name, so a refusal is located at
    // `customFieldFilters.<key>.<operator>` as on the Orders list.
    const { customFieldFilters } = customFieldFiltersQuerySchema.parse({ customFieldFilters: rawFilters });
    // Issue #317 — the page, the sort and every other filter, applied by the server.
    const query = adminQuoteRequestListQuerySchema.parse(rawQuery);

    const { rows, total } = await adminService.listAll(ctx, {
      ...(query.organizationId ? { organizationId: query.organizationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.assignmentScope ? { scope: query.assignmentScope } : {}),
      ...(customFieldFilters ? { customFieldFilters } : {}),
      ...(query.q ? { q: query.q } : {}),
      ...(query.sharing ? { sharing: query.sharing } : {}),
      sort: query.sort,
      page: query.page,
      pageSize: query.pageSize,
    }).catch((error: unknown) => {
      if (isCustomFieldFilterUnavailableFailure(error)) {
        throw new HttpError(400, ERROR_CODES.CUSTOM_FIELD_FILTER_UNAVAILABLE, error.message, {
          key: error.keys[0] ?? '',
          keys: [...error.keys],
        });
      }
      throw error;
    });
    // Each row's status by its name in the response language, beside the code
    // (issue #455) — what another module's link picker shows. Six statuses at
    // most, so each is named once.
    const language = await request.responseLanguage();
    const names = new Map<string, Promise<string>>();
    const nameOf = (status: string): Promise<string> => {
      let name = names.get(status);
      if (!name) names.set(status, (name = statusName(status, language)));
      return name;
    };
    return {
      data: await Promise.all(rows.map(async (row) => ({ ...row, statusName: await nameOf(row.status) }))),
      // True for this response (issue #317): the page read, its size and the
      // matches. `limit` and `hasMore` keep the envelope's earlier members; the
      // list has no cursor, so the next page is asked for by `page`.
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        limit: query.pageSize,
        hasMore: query.page * query.pageSize < total,
        nextCursor: null,
      } satisfies AdminQuoteRequestListPagination,
    };
  });

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id',
    { preHandler: guard },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const rfq = await adminService.getById(ctx, request.params.id);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // Feature 146 (FR-010 – FR-019) — the readable History, loaded when the tab
  // opens. Same gate and visibility rule as the detail; a request outside the
  // caller's organizations answers as an unknown id (threat model C1).
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/history',
    { preHandler: guard },
    async (request) => {
      const ctx = await resolveAdminContext(request);
      return { data: await adminService.history(ctx, request.params.id) };
    },
  );

  app.post(
    '/api/v1/admin/quote-requests',
    { preHandler: guard, schema: { body: adminCreateQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminCreateQuoteRequestSchema.parse(request.body);
      const rfq = await adminService.createOnBehalf(ctx, body);
      // Feature 163 (FR-018) — accepted, and each line not available to the
      // Organization here is named for the operator.
      const warnings = await adminService.onBehalfWarnings(body);
      setEtag(reply, rfq.version);
      reply.code(201);
      return { data: rfq, ...(warnings.length > 0 ? { warnings } : {}) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id',
    { preHandler: guard, schema: { body: adminPatchQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminPatchQuoteRequestSchema.parse(request.body);
      const expectedVersion = parseIfMatch(request);
      const rfq = await adminService.modify(ctx, request.params.id, expectedVersion, body);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // `specs/192-quote-request-draft-share/` (contracts/admin-api.md §1) — share
  // an unshared operator quote with its customer. No body; `If-Match` as on
  // `PATCH /:id`.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/share',
    { preHandler: guard },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      // No body, or an empty object; parsed here because an absent body
      // reaches the handler as `null`.
      adminShareQuoteRequestSchema.parse(request.body ?? {});
      const rfq = await adminService.share(ctx, request.params.id, parseIfMatch(request));
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/approve',
    { preHandler: guard, schema: { body: adminApproveQuoteRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminApproveQuoteRequestSchema.parse(request.body ?? {});
      const expectedVersion = parseIfMatch(request);
      const rfq = await adminService.approve(ctx, request.params.id, expectedVersion, body.note);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // Issue #170 — the operator's conversion: the approved request's lines into
  // the basket of the customer who owns it. The admin screen used to post to the
  // storefront's `convert-to-order`, which refuses an administrator with 401.
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/prepare-customer-basket',
    { preHandler: guard },
    async (request) => {
      const ctx = await resolveAdminContext(request);
      // The quote's own channel decides the basket; the resolved one (the
      // system default on an admin route) only stands in where the request
      // records none.
      const result = await adminService.prepareCustomerBasket(
        ctx,
        request.params.id,
        getResolvedChannel(request).id,
      );
      return { data: adminPrepareCustomerBasketResponseSchema.parse(result) };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/cancel',
    { preHandler: guard, schema: { body: adminCancelQuoteRequestSchema.optional() } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminCancelQuoteRequestSchema.parse(request.body ?? {});
      const expectedVersion = parseIfMatch(request);
      const rfq = await adminService.cancel(ctx, request.params.id, expectedVersion, body.reason);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/quote-requests/:id/assign',
    { preHandler: guard, schema: { body: adminAssignQuoteRequestSchema } },
    async (request, reply) => {
      const ctx = await resolveAdminContext(request);
      const body = adminAssignQuoteRequestSchema.parse(request.body);
      const rfq = await adminService.assign(ctx, request.params.id, body.adminUserId);
      setEtag(reply, rfq.version);
      return { data: rfq };
    },
  );

  // -------------------------------------------------------------------------
  // `specs/147-saved-views/` (US3) — saved views on the Quote Request list.
  // Registered here, behind the same `guard`, so they share the list's gate
  // and the module's presence gate (FR-015, FR-018). The static `list-views`
  // segment outranks `quote-requests/:id` in Fastify's router (contract §2,
  // route precedence). The actor comes from the tenant context and not from
  // `resolveAdminContext`, whose `isPlatformAdmin` is a different predicate
  // (research R-7).
  // -------------------------------------------------------------------------

  const VIEWS = '/api/v1/admin/quote-requests/list-views';

  app.get(VIEWS, { preHandler: guard }, async () => {
    return { data: await listViewService.listFor(savedViewActor()) };
  });

  app.post(
    VIEWS,
    { preHandler: guard, schema: { body: createQuoteRequestSavedViewRequestSchema } },
    async (request, reply) => {
      const actor = savedViewActor();
      const body = createQuoteRequestSavedViewRequestSchema.parse(request.body);
      const view = await listViewService.create(actor, body);
      reply.code(201);
      return { data: view };
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${VIEWS}/:id`,
    { preHandler: guard, schema: { body: updateQuoteRequestSavedViewRequestSchema } },
    async (request) => {
      const actor = savedViewActor();
      const body = updateQuoteRequestSavedViewRequestSchema.parse(request.body);
      return { data: await listViewService.update(request.params.id, actor, body) };
    },
  );

  app.delete<{ Params: { id: string } }>(`${VIEWS}/:id`, { preHandler: guard }, async (request) => {
    await listViewService.remove(request.params.id, savedViewActor());
    return { data: { deleted: request.params.id } };
  });
}
