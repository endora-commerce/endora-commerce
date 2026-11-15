import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  CustomerSessionRequiredError,
  quickOrderBuildRequestSchema,
  quickOrderImportRequestSchema,
  quickOrderSearchQuerySchema,
  requestScopeLanguage,
  type CatalogQuickSearchPort,
  type OrganizationPermissionPort,
  type OrganizationPermissionSubject,
} from '@endora-commerce/contracts';
import { getResolvedChannel } from '@endora-commerce/platform/kernel';
import { productAudienceOf } from '@endora-commerce/platform/http';
import type { QuickOrderImportPipeline } from './services/import-pipeline.js';
import type { QuickOrderBuildService } from './services/quick-order-build-service.js';
import { parseImportRequest } from './services/import-from-request.js';

/**
 * Quick-order routes (feature 039).
 *   - POST /quick-order/import  parses CSV / .xlsx → recognised + rejected rows
 *   - POST /quick-order/build   recognised rows → Cart or Quote Request
 *   - GET  /quick-order/search  type-ahead over the catalogue, in the channel
 *     the request resolved
 *
 * Requires an authenticated customer session: SKU-to-product disclosure and
 * cart / RFQ mutation are gated to logged-in buyers.
 *
 * **By organization permission (`specs/170-organization-roles/`, FR-030,
 * FR-030b, FR-040; `contracts/storefront-api.md` §5).** The import previews a
 * file that may become either a basket or a quote request, so it admits
 * `carts.create` **or** `quote_requests.create` (owner ruling OR-10, R-40) — a
 * module-local guard after `requireCustomer`, answered before the file is
 * parsed; a member holding neither is refused naming `carts.create`. The
 * build's target is in its body, so the build judges `carts.create` or
 * `quote_requests.create` itself, first thing (`QuickOrderBuildService.build`).
 * The type-ahead is a read and stays open.
 */

const CARTS_CREATE = 'carts.create';
const QUOTE_REQUESTS_CREATE = 'quote_requests.create';

/**
 * The import's guard (OR-10, FR-030b, R-40): either target's create permission
 * admits it, judged in that order. The subject is built from the actor exactly
 * as `organizationPermissionPreHandler` builds it. When neither holds, the
 * port's `assert` raises the standard `403 ORGANIZATION_PERMISSION_REQUIRED`
 * naming `carts.create` — the import's primary target — so the refusal keeps
 * its one shape. A code whose module is off grants nothing (FR-007), so with
 * `quote_requests` off only `carts.create` admits. Writing the buyer's preview
 * (`routes.preview.ts`, issue #809) is part of the same import and takes the
 * same guard.
 */
export function importPermissionPreHandler(
  getPort: () => OrganizationPermissionPort,
): (request: FastifyRequest) => Promise<void> {
  return async (request) => {
    const actor = request.actor;
    if (actor.kind !== 'customer') throw new CustomerSessionRequiredError();
    const subject: OrganizationPermissionSubject = {
      customerAccountId: actor.customerAccountId,
      organizationId: actor.organizationId ?? '',
      organizationRoleId: actor.organizationRoleId ?? null,
    };
    const port = getPort();
    if (await port.can(subject, CARTS_CREATE)) return;
    if (await port.can(subject, QUOTE_REQUESTS_CREATE)) return;
    await port.assert(subject, CARTS_CREATE, { language: await request.responseLanguage() });
  };
}

export interface QuickOrderRoutesDeps {
  pipeline: QuickOrderImportPipeline;
  buildService: QuickOrderBuildService;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** Reads the `quick_order.import_max_rows` setting (falls back internally). */
  resolveImportMaxRows: () => Promise<number>;
  /**
   * `catalog`'s channel-scoped type-ahead (issue #174). It replaces three
   * things at once: the `emFactory` this file used to open a knex query with,
   * the attribute read it used to source `quickSearchable` keys from, and the
   * product read it used to hydrate the ids that query returned. The predicate
   * and the `matchedOn` labels belong to the module that owns the tables.
   */
  catalogQuickSearch: CatalogQuickSearchPort;
  /** `organizations`' port, resolved per request (`module-composition.md` item 4a). */
  organizationPermissions: () => OrganizationPermissionPort;
}

export async function registerQuickOrderRoutes(
  app: FastifyInstance,
  deps: QuickOrderRoutesDeps,
): Promise<void> {
  const { pipeline, buildService, requireCustomer, resolveCustomerContext, organizationPermissions } = deps;

  app.post(
    '/api/v1/quick-order/import',
    {
      preHandler: [requireCustomer, importPermissionPreHandler(organizationPermissions)],
      schema: { body: quickOrderImportRequestSchema },
    },
    async (request) => {
      const body = quickOrderImportRequestSchema.parse(request.body);
      const maxRows = await deps.resolveImportMaxRows();
      const parse = await parseImportRequest(body);
      // Issue #227 — the audience is the buyer's own, off the session this
      // route already requires. The type-ahead below has had it since issue
      // #174; the pasted-SKU path next to it had not, and a SKU list is the
      // easier of the two to enumerate.
      const result = await pipeline.run(parse, {
        maxRows,
        audience: productAudienceOf(request),
        // Feature 163 — the channel this request resolved, named explicitly:
        // a buyer paste is never answered by audience alone.
        salesChannelId: getResolvedChannel(request).id,
      });
      return { data: result };
    },
  );

  app.post(
    '/api/v1/quick-order/build',
    { preHandler: requireCustomer, schema: { body: quickOrderBuildRequestSchema } },
    async (request) => {
      const body = quickOrderBuildRequestSchema.parse(request.body);
      const ctx = resolveCustomerContext(request);
      const actor = request.actor;
      const result = await buildService.build(
        {
          customerAccountId: ctx.customerAccountId,
          organizationId: ctx.organizationId,
          organizationRoleId: actor.kind === 'customer' ? (actor.organizationRoleId ?? null) : null,
          salesChannelId: getResolvedChannel(request).id,
        },
        {
          target: body.target,
          items: body.items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            quantity: item.quantity,
          })),
        },
        // Feature 155 — the buyer's build: no actor, so a quote request is
        // judged by the buyer's rules (FR-012). Feature 163 — its quote lines'
        // scope language is the request's channel language (issue #1011), not
        // the message language.
        { language: await request.responseLanguage(), languageTag: channelLanguageOf(request) },
      );
      return { data: result };
    },
  );

  app.get('/api/v1/quick-order/search', { preHandler: requireCustomer }, async (request) => {
    const query = quickOrderSearchQuerySchema.parse(request.query ?? {});

    /**
     * Issue #174 — the type-ahead asks `catalog`, and asks it *in a channel*.
     *
     * This used to be a hand-written knex `select` against `catalog`'s
     * `products` table, reaching into its `attribute_values` JSONB and
     * filtering on `status = 'active'` and nothing else. Two costs. The edge
     * had no import specifier, so `check:module-boundary` could not see it and
     * no ledger shard could key it — trap 6's "strictly worse than an import".
     * And with no channel predicate, a signed-in buyer's type-ahead returned
     * every active product on the platform, whichever channel they were
     * shopping: Constitution XII, in the one place no static check was looking.
     *
     * `catalogQuickSearchPort` owns the predicate now, including which
     * attributes are `quickSearchable` and which `matchedOn` labels a hit
     * carries — both are facts about `catalog`'s own tables. What is left here
     * is the buyer's language pick, which is this surface's business.
     *
     * The channel is the one the canonical resolver already put on the request
     * scope (feature 053 / Constitution XII), never re-resolved from a header
     * here. The organisation comes off the buyer's session for the same reason
     * — it decides which restricted products `catalog` will disclose, and this
     * surface is the one that knows who is asking.
     */
    const hits = await deps.catalogQuickSearch.quickSearch({
      q: query.q,
      limit: query.limit,
      salesChannelId: getResolvedChannel(request).id,
      organizationId: resolveCustomerContext(request).organizationId,
      // Feature 163 — the request's language; a product off in it is not a
      // hit. Issue #1011 — already one of the channel's languages, which
      // `catalog`'s own resolution against the channel leaves as it is.
      languageCode: channelLanguageOf(request),
    });

    return {
      data: hits.map((hit) => ({
        productId: hit.productId,
        sku: hit.sku,
        // Feature 163 (FR-017 a) — the Name the storefront shows here.
        // Feature 174 — `hit.name` is the effective string at the search's (C, L).
        name: hit.name || hit.sku,
        slug: hit.slug,
        status: hit.status,
        matchedOn: hit.matchedOn,
      })),
    };
  });
}

/**
 * The channel language the request's `Accept-Language` asks for, or `undefined` without the
 * header (the channel's default language is then asked about, as before). Issue #1011 —
 * `requestScopeLanguage` over the whole header, as the catalogue resolves it since #397: the
 * tags in descending `q`, each matched against the resolved channel's languages (exactly, then
 * by base language), the first one the channel offers winning, else the channel's default. This
 * used to be the header's first tag alone, so `en;q=0.2, pl-PL;q=0.9` asked about English.
 *
 * A content language — which (channel, language) a product is available and named at — so not
 * `request.responseLanguage()`, the language messages are worded in.
 */
function channelLanguageOf(request: FastifyRequest): string | undefined {
  const header = request.headers['accept-language'];
  if (header === undefined || header.length === 0) return undefined;
  return requestScopeLanguage(getResolvedChannel(request), header);
}
