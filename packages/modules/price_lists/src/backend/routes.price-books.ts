import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import {
  ERROR_CODES,
  PRICE_BOOK_MAX_EXPLANATION_CANDIDATES,
  PRICE_BOOK_MAX_MEMBERS,
  basePricesWriteSchema,
  priceBookCreateSchema,
  priceBookDuplicateSchema,
  priceBookLinesQuerySchema,
  priceBookProductLinesQuerySchema,
  priceBookListQuerySchema,
  priceBookPatchRequestSchema,
  priceBookResolveRequestSchema,
  priceBookRowsQuerySchema,
  showListPriceWriteSchema,
  SHOW_LIST_PRICE_SETTING_CODE,
  type Actor,
  type CatalogAttributeReadPort,
  type CatalogCategoryReadPort,
  type CustomerAccountReadPort,
  type CustomerGroupReadPort,
  type OrganizationDetailsPort,
  type PriceBookResolvedLine,
  type PriceBookRowLabels,
  type SalesRepAssignmentPort,
  type SettingsAdminPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { orgConstraintFor } from '@endora-commerce/platform/tenancy';
import type { CommandBus } from '@endora-commerce/platform/commands';
import { SalesChannel, type RequireAdminFactory, type SettingsReadPort } from '@endora-commerce/platform/kernel';
import { PRICE_LIST_PERMISSIONS } from '../manifest.js';
import type { BuyerLinePriceService } from './services/buyer-line-price-service.js';
import type { PriceBookService } from './services/price-book-service.js';
import type { PriceBookReads } from './services/price-book-reads.js';
import { pickLabel } from './services/price-book-reads.js';
import { attributeInactiveReason } from './services/attribute-eligibility.js';
import { currentPriceBookScope, organizationInScope } from './services/price-book-scope.js';
import type { PriceListStatusWorker } from './services/price-list-status-worker.js';
import { presetName, type PrecedenceConfig } from './services/precedence.js';

/**
 * The admin price-book API — feature 160 (US7,
 * `specs/160-pricing-model-v2/contracts/admin-price-books-api.md`), which
 * replaces `/api/v1/admin/price-lists-engine/…`, `/api/v1/admin/pricing/rule-targets/…`,
 * the product's linked-lists panel and `/api/v1/admin/products/:id/resolved-price`
 * in the same release (FR-037).
 *
 * Reads are behind `price_lists:read`, writes behind `price_lists:write`. The
 * caller's scope (FR-034) is the ambient tenant context the admin pipeline
 * derived from the administrator's role, read once per request
 * (`currentPriceBookScope`); every service call is handed it.
 */

export interface PriceBookRoutesDeps {
  priceBookService: PriceBookService;
  reads: PriceBookReads;
  buyerLinePriceService: BuyerLinePriceService;
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
  organizationDetails: OrganizationDetailsPort;
  customerGroupRead: CustomerGroupReadPort;
  customerAccountRead: CustomerAccountReadPort;
  catalogCategoryRead: CatalogCategoryReadPort;
  catalogAttributeRead: CatalogAttributeReadPort;
  salesRepScope: SalesRepAssignmentPort;
  statusWorker: Pick<PriceListStatusWorker, 'sweep'>;
  /** The active precedence (version and configuration). */
  activePrecedence: () => Promise<{ version: number; config: PrecedenceConfig }>;
  /** `pricing.show_list_price` (G8): read through settings, written inside one command. */
  settingsRead?: SettingsReadPort;
  settingsAdmin?: SettingsAdminPort;
  commandBus?: CommandBus;
  resolveAdminAuditContext?: (req: FastifyRequest) => { actorAdminUserId: string } | undefined;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The labels of a row that is gone (a runner-up deleted since it was resolved). */
const NO_LABELS: PriceBookRowLabels = {
  productName: null,
  productSku: null,
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};

/** A short language tag for display labels: `?lang=`, else the first `Accept-Language` tag. */
function labelLanguage(request: FastifyRequest): string | null {
  const query = (request.query as { lang?: unknown } | undefined)?.lang;
  const candidate =
    typeof query === 'string'
      ? query
      : typeof request.headers['accept-language'] === 'string'
        ? request.headers['accept-language'].split(',')[0]!.split(';')[0]!.trim()
        : '';
  return /^[a-z]{2}(-[A-Za-z]{2})?$/.test(candidate) ? candidate : null;
}

/** The version a write is made against: the body's `expectedVersion`, else `If-Match` (G5). */
function expectedVersionOf(request: FastifyRequest, fromBody: number | undefined): number {
  if (fromBody !== undefined) return fromBody;
  const header = request.headers['if-match'];
  const raw = typeof header === 'string' ? header.replace(/^W\//, '').replace(/"/g, '').trim() : '';
  const value = Number(raw);
  if (raw.length > 0 && Number.isInteger(value) && value > 0) return value;
  throw new HttpError(
    400,
    ERROR_CODES.VALIDATION_FAILED,
    'This write names the version of the price book it was made against: send expectedVersion or an If-Match header.',
  );
}

function parseOr400<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(' '),
      parsed.error.issues.map((i) => ({ path: i.path.join('.'), issue: i.message })),
    );
  }
  return parsed.data;
}

export async function registerPriceBookRoutes(app: FastifyInstance, deps: PriceBookRoutesDeps): Promise<void> {
  const readGate = deps.requireAdmin(PRICE_LIST_PERMISSIONS.READ);
  const writeGate = deps.requireAdmin(PRICE_LIST_PERMISSIONS.WRITE);
  const books = deps.priceBookService;
  const base = '/api/v1/admin/price-books';

  // ---- Books -------------------------------------------------------------------

  app.get(base, { preHandler: readGate }, async (request) => {
    const query = parseOr400(priceBookListQuerySchema, request.query);
    return deps.reads.list(query, currentPriceBookScope());
  });

  app.post(base, { preHandler: writeGate }, async (request, reply) => {
    const body = parseOr400(priceBookCreateSchema, request.body);
    const created = await books.createBook(body, currentPriceBookScope());
    reply.status(201);
    return { data: await deps.reads.get(created.id, currentPriceBookScope()) };
  });

  // ---- Settings (G8) and precedence: fixed paths before `/:id` --------------------

  app.get(`${base}/settings/show-list-price`, { preHandler: readGate }, async () => ({
    data: { value: await readShowListPrice(deps.settingsRead) },
  }));

  app.put(`${base}/settings/show-list-price`, { preHandler: writeGate }, async (request) => {
    const body = parseOr400(showListPriceWriteSchema, request.body);
    if (!deps.commandBus || !deps.settingsAdmin) {
      throw new Error('price_lists: the show-list-price write needs the Command Bus and the settings admin port.');
    }
    const actor = deps.resolveAdminAuditContext?.(request);
    const before = await readShowListPrice(deps.settingsRead);
    const settingsAdmin = deps.settingsAdmin;
    // One audited command (Principle XIII); the settings module stores the value
    // and drops its own cache as part of the write.
    await deps.commandBus.run({
      action: 'price_list.show_list_price_set',
      objectType: 'setting',
      objectId: SHOW_LIST_PRICE_SETTING_CODE,
      run: async () => {
        await settingsAdmin.setValueForAllChannels(SHOW_LIST_PRICE_SETTING_CODE, body.value, null, {
          actorAdminUserId: actor?.actorAdminUserId ?? null,
          requestId: request.id,
        });
        return { result: undefined, before: { value: before }, after: { value: body.value } };
      },
    });
    return { data: { value: body.value } };
  });

  app.get(`${base}/precedence`, { preHandler: readGate }, async () => {
    const active = await deps.activePrecedence();
    return {
      data: {
        version: active.version,
        cells: [...active.config.cells],
        categoryBeforeAttribute: active.config.categoryBeforeAttribute,
        depthMode: active.config.depthMode,
        preset: presetName(active.config),
      },
    };
  });

  const precedenceUnavailable = async (): Promise<never> => {
    throw new HttpError(
      409,
      ERROR_CODES.PRECEDENCE_CHANGE_UNAVAILABLE,
      'Changing the price precedence is not available yet.',
    );
  };
  // Spelled out, one registration per method and path, so the static admin-route
  // reader sees every one of them (issue #141).
  app.post(`${base}/precedence`, { preHandler: writeGate }, precedenceUnavailable);
  app.put(`${base}/precedence`, { preHandler: writeGate }, precedenceUnavailable);
  app.patch(`${base}/precedence`, { preHandler: writeGate }, precedenceUnavailable);
  app.delete(`${base}/precedence`, { preHandler: writeGate }, precedenceUnavailable);
  app.post(`${base}/precedence/*`, { preHandler: writeGate }, precedenceUnavailable);
  app.put(`${base}/precedence/*`, { preHandler: writeGate }, precedenceUnavailable);
  app.patch(`${base}/precedence/*`, { preHandler: writeGate }, precedenceUnavailable);
  app.delete(`${base}/precedence/*`, { preHandler: writeGate }, precedenceUnavailable);

  // ---- Base prices (FR-009) ------------------------------------------------------

  app.get(`${base}/base-prices`, { preHandler: readGate }, async (request) => {
    const { productId } = parseOr400(z.object({ productId: z.string().regex(UUID, 'productId must be a uuid') }), request.query);
    return { data: await books.basePrices(productId, currentPriceBookScope()) };
  });

  app.put<{ Params: { productId: string } }>(`${base}/base-prices/:productId`, { preHandler: writeGate }, async (request) => {
    if (!UUID.test(request.params.productId)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Product not found.');
    // Base books are everyone's prices: a representative reads them and does not write them.
    if (!currentPriceBookScope().all) throw new HttpError(403, ERROR_CODES.FORBIDDEN, 'Base prices are read-only for you.');
    const body = parseOr400(basePricesWriteSchema, request.body);
    await books.setBasePrices(request.params.productId, body);
    return { data: await books.basePrices(request.params.productId, currentPriceBookScope()) };
  });

  // ---- Targets (pickers) ----------------------------------------------------------

  app.get(`${base}/targets/organizations`, { preHandler: readGate }, async (request) => {
    const query = parseOr400(
      z
        .object({
          search: z.string().max(200).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(50),
          // 161 G12 — label stored members: a comma-separated list, at most an audience's worth.
          ids: z
            .string()
            .transform((raw) => [...new Set(raw.split(',').map((id) => id.trim()).filter((id) => id.length > 0))])
            .pipe(z.array(z.string().regex(UUID, 'ids must be uuids')).min(1).max(PRICE_BOOK_MAX_MEMBERS))
            .optional(),
        })
        .refine((q) => q.ids === undefined || q.search === undefined, { message: 'Name organizations by ids or search them, not both.', path: ['ids'] }),
      request.query,
    );
    const scope = currentPriceBookScope();
    if (query.ids) {
      // Scope-filtered exactly as the search: an organization out of the
      // caller's reach is absent, like an unknown id — never an error that
      // would tell the two apart (FR-034).
      const found = new Map((await deps.organizationDetails.findByIds(query.ids)).map((r) => [r.id, r]));
      return {
        data: {
          items: query.ids
            .filter((id) => found.has(id) && organizationInScope(scope, id))
            .map((id) => {
              const r = found.get(id)!;
              return { id: r.id, name: r.name, taxId: r.taxId };
            }),
        },
      };
    }
    // Over-fetch for a representative, whose scope narrows the page afterwards.
    const rows = await deps.organizationDetails.searchByName((query.search ?? '').trim(), scope.all ? query.limit : 200);
    return {
      data: {
        items: rows
          .filter((r) => organizationInScope(scope, r.id))
          .slice(0, query.limit)
          .map((r) => ({ id: r.id, name: r.name, taxId: r.taxId })),
      },
    };
  });

  app.get(`${base}/targets/customer-groups`, { preHandler: readGate }, async () => ({
    data: { items: (await deps.customerGroupRead.listAll()).map((r) => ({ id: r.id, code: r.code, name: r.name })) },
  }));

  app.get(`${base}/targets/categories`, { preHandler: readGate }, async () => ({
    data: {
      items: (await deps.catalogCategoryRead.listAll({ liveOnly: true })).map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        parentCategoryId: r.parentCategoryId ?? null,
        sortOrder: r.sortOrder,
      })),
    },
  }));

  app.get(`${base}/targets/attributes`, { preHandler: readGate }, async (request) => {
    const language = labelLanguage(request);
    const views = await deps.catalogAttributeRead.listByFlag('isPriceRule');
    return {
      data: {
        items: views
          .filter((view) => attributeInactiveReason(view) === null)
          .map((view) => ({
            key: view.key,
            label: pickLabel(view.label, view.labelDefault, language),
            valueType: view.valueType,
            options:
              view.valueType === 'boolean'
                ? [
                    { value: 'true', label: 'true' },
                    { value: 'false', label: 'false' },
                  ]
                : [...view.options]
                    .sort((a, b) => a.sortOrder - b.sortOrder || a.value.localeCompare(b.value))
                    .map((o) => ({ value: o.value, label: pickLabel(o.label, o.labelDefault, language) })),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      },
    };
  });

  app.get(`${base}/targets/sales-channels`, { preHandler: readGate }, async (request) => {
    const { currency } = parseOr400(z.object({ currency: z.string().regex(/^[A-Za-z]{3}$/).optional() }), request.query);
    const rows = await deps.emFactory().find(SalesChannel, {}, { orderBy: { code: 'asc' } });
    const offers = (c: SalesChannel, code: string) =>
      [...(c.currencies ?? []), c.defaultCurrency].map((x) => x.toUpperCase()).includes(code.toUpperCase());
    return {
      data: {
        items: rows
          .filter((r) => !currency || offers(r, currency))
          .map((r) => ({
            id: r.id,
            code: r.code,
            name: r.name,
            currencies: [...new Set([...(r.currencies ?? []), r.defaultCurrency].map((x) => x.toUpperCase()))],
            defaultCurrency: r.defaultCurrency,
          })),
      },
    };
  });

  app.get(`${base}/targets/currencies`, { preHandler: readGate }, async () => {
    const channels = await deps.emFactory().find(SalesChannel, {});
    const exposed = new Map<string, string[]>();
    for (const ch of channels) {
      for (const cur of new Set([...(ch.currencies ?? []), ch.defaultCurrency])) {
        if (typeof cur !== 'string' || cur.length !== 3) continue;
        const key = cur.toUpperCase();
        exposed.set(key, [...(exposed.get(key) ?? []), ch.code]);
      }
    }
    return {
      data: {
        items: [...exposed.entries()]
          .map(([code, exposedByChannels]) => ({ code, exposedByChannels }))
          .sort((a, b) => a.code.localeCompare(b.code)),
      },
    };
  });

  // ---- Explanation (FR-020, FR-038) ----------------------------------------------

  app.post(`${base}/resolve`, { preHandler: readGate }, async (request) => {
    const body = parseOr400(priceBookResolveRequestSchema, request.body);
    const buyer = await authorizeBuyer(request, {
      organizationId: body.buyer.organizationId ?? null,
      customerAccountId: body.buyer.customerAccountId ?? null,
    });
    const answers = await deps.buyerLinePriceService.resolveDetailed({
      buyer,
      salesChannelId: body.salesChannelId ?? null,
      ...(body.currencyCode ? { currencyCode: body.currencyCode } : {}),
      lines: body.lines.map((line) => ({
        key: line.key,
        productId: line.productId,
        variantId: line.variantId ?? null,
        quantity: line.quantity,
      })),
    });
    const version = (await deps.activePrecedence()).version;
    // G16 of 161 — every runner-up named: its book (from the resolution) and
    // its selection (one batched label read across every line's candidates).
    const shown = answers.map((answer) => answer.explanation?.candidates.slice(0, PRICE_BOOK_MAX_EXPLANATION_CANDIDATES) ?? []);
    const labelsOf = await deps.reads.rowLabels(
      shown.flatMap((candidates) => candidates.map((c) => c.rowId)),
      labelLanguage(request),
    );
    const data: PriceBookResolvedLine[] = answers.map((answer, index) => ({
      key: answer.key,
      price:
        answer.price && answer.source
          ? {
              amount: answer.price.amount,
              currency: answer.price.currency,
              source: answer.source,
              ...(answer.compareAt ? { compareAt: answer.compareAt } : {}),
            }
          : null,
      explanation: answer.explanation
        ? {
            tier: answer.explanation.tier,
            cell: answer.explanation.cell,
            bookId: answer.explanation.bookId,
            bookName: answer.explanation.bookName,
            rowId: answer.explanation.rowId,
            reference: answer.explanation.reference,
            precedenceVersion: answer.explanation.precedenceVersion,
            candidates: shown[index]!.map((c) => ({ ...c, labels: labelsOf.get(c.rowId) ?? NO_LABELS })),
          }
        : { tier: null, precedenceVersion: version },
    }));
    return { data };
  });

  // ---- Test-only: the status sweep (moved from the removed engine routes) --------

  app.post(`${base}/internal/sweep`, { preHandler: writeGate }, async () => ({ data: await deps.statusWorker.sweep() }));

  // ---- One book --------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(`${base}/:id`, { preHandler: readGate }, async (request) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    return { data: await deps.reads.get(request.params.id, currentPriceBookScope()) };
  });

  app.patch<{ Params: { id: string } }>(`${base}/:id`, { preHandler: writeGate }, async (request) => {
    const id = request.params.id;
    if (!UUID.test(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const scope = currentPriceBookScope();
    const raw = (request.body ?? {}) as Record<string, unknown>;
    // The book is resolved (and its scope checked) before the body is judged, so
    // an out-of-scope book answers 404 whatever was sent.
    await deps.reads.header(id, scope);
    if ('currencyCode' in raw || 'type' in raw) {
      throw new HttpError(
        409,
        ERROR_CODES.PRICE_BOOK_IMMUTABLE_FIELD,
        'The currency and the type of a price book cannot change; duplicate it instead.',
      );
    }
    const body = parseOr400(priceBookPatchRequestSchema, raw);
    await books.patchBook(id, body, { expectedVersion: expectedVersionOf(request, body.expectedVersion), scope });
    return { data: await deps.reads.get(id, scope) };
  });

  app.post<{ Params: { id: string } }>(`${base}/:id/activate`, { preHandler: writeGate }, async (request) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const scope = currentPriceBookScope();
    await books.activate(request.params.id, scope);
    return { data: await deps.reads.get(request.params.id, scope) };
  });

  app.post<{ Params: { id: string } }>(`${base}/:id/draftify`, { preHandler: writeGate }, async (request) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const scope = currentPriceBookScope();
    await books.draftify(request.params.id, scope);
    return { data: await deps.reads.get(request.params.id, scope) };
  });

  app.post<{ Params: { id: string } }>(`${base}/:id/duplicate`, { preHandler: writeGate }, async (request, reply) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const scope = currentPriceBookScope();
    await deps.reads.header(request.params.id, scope);
    const body = parseOr400(priceBookDuplicateSchema, request.body);
    const copy = await books.duplicate(request.params.id, body, scope);
    reply.status(201);
    return { data: await deps.reads.get(copy.id, scope) };
  });

  app.delete<{ Params: { id: string } }>(`${base}/:id`, { preHandler: writeGate }, async (request, reply) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    await books.deleteBook(request.params.id, currentPriceBookScope());
    return reply.status(204).send();
  });

  // ---- Rows ------------------------------------------------------------------------

  app.get<{ Params: { id: string } }>(`${base}/:id/rows`, { preHandler: readGate }, async (request) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const query = parseOr400(priceBookRowsQuerySchema, request.query);
    return deps.reads.rows(request.params.id, query, currentPriceBookScope(), labelLanguage(request));
  });

  // 161 G15 — the grid's pages: whole lines, at a cost that does not grow with the book.
  app.get<{ Params: { id: string } }>(`${base}/:id/lines`, { preHandler: readGate }, async (request) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const query = parseOr400(priceBookLinesQuerySchema, request.query);
    return deps.reads.lines(request.params.id, query, currentPriceBookScope(), labelLanguage(request));
  });

  // 161 (Checkpoint 5 review) — which picked products already have a line, in one read.
  app.get<{ Params: { id: string } }>(`${base}/:id/product-lines`, { preHandler: readGate }, async (request) => {
    if (!UUID.test(request.params.id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
    const { productIds } = parseOr400(priceBookProductLinesQuerySchema, request.query);
    return { data: { productIds: await deps.reads.productLines(request.params.id, productIds, currentPriceBookScope()) } };
  });

  app.put<{ Params: { id: string }; Querystring: { dryRun?: string } }>(
    `${base}/:id/rows`,
    { preHandler: writeGate },
    async (request) => {
      const id = request.params.id;
      if (!UUID.test(id)) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Price book not found.');
      const scope = currentPriceBookScope();
      await deps.reads.header(id, scope);
      const dryRun = request.query.dryRun === 'true' || request.query.dryRun === '1';
      const raw = (request.body ?? {}) as { expectedVersion?: unknown };
      const bodyVersion = typeof raw.expectedVersion === 'number' ? raw.expectedVersion : undefined;
      // A preview may be asked without a version; a write may not (G5).
      const expectedVersion = dryRun && bodyVersion === undefined && !request.headers['if-match'] ? null : expectedVersionOf(request, bodyVersion);
      const result = await books.writeRows(id, request.body, { dryRun, expectedVersion, scope, language: labelLanguage(request) });
      if (dryRun) return { data: result };
      const { stored: _stored, ...answer } = result as typeof result & { stored?: unknown };
      return { data: answer };
    },
  );

  /**
   * The probe's authority step (feature 146, threat model T8, decision D-3M),
   * moved with the explanation that replaces the probe: every way of naming an
   * organization the caller may not see answers the same 404 and body; only
   * once both sides are visible is a membership mismatch a 400.
   */
  async function authorizeBuyer(
    request: FastifyRequest,
    asked: { organizationId: string | null; customerAccountId: string | null },
  ): Promise<{ organizationId: string | null; customerAccountId: string | null }> {
    if (!asked.organizationId && !asked.customerAccountId) {
      return { organizationId: null, customerAccountId: null };
    }
    const notFound = (): HttpError => new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
    const isPlatformAdmin = orgConstraintFor().kind === 'all';
    const actor = request.actor as Actor | undefined;
    const canSee = async (organizationId: string): Promise<boolean> => {
      if (isPlatformAdmin) return true;
      if (actor?.kind !== 'admin') return false;
      return deps.salesRepScope.canSeeOrganization(actor.adminUserId, organizationId);
    };
    let accountOrganizationId: string | null = null;
    if (asked.customerAccountId) {
      const account = UUID.test(asked.customerAccountId)
        ? await deps.customerAccountRead.findById(asked.customerAccountId)
        : null;
      if (!account || !(await canSee(account.organizationId))) throw notFound();
      accountOrganizationId = account.organizationId;
    }
    const organizationId = asked.organizationId ?? accountOrganizationId;
    if (!organizationId || !UUID.test(organizationId)) throw notFound();
    if (asked.organizationId) {
      if (!(await canSee(organizationId))) throw notFound();
      if (!(await deps.organizationDetails.findById(organizationId))) throw notFound();
    }
    if (accountOrganizationId !== null && accountOrganizationId !== organizationId) {
      throw new HttpError(400, ERROR_CODES.VALIDATION_FAILED, 'The customer account is not a member of the organization.');
    }
    return { organizationId, customerAccountId: asked.customerAccountId };
  }
}

/** `pricing.show_list_price`, `false` when it cannot be read. */
export async function readShowListPrice(settings: SettingsReadPort | undefined): Promise<boolean> {
  if (!settings) return false;
  try {
    return await settings.get(SHOW_LIST_PRICE_SETTING_CODE, null, z.boolean());
  } catch {
    return false;
  }
}
