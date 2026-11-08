import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  CustomerSessionRequiredError,
  ERROR_CODES,
  QUICK_ORDER_PREVIEW_MAX_BYTES,
  SESSION_COOKIE_NAME,
  quickOrderPreviewSchema,
  type OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { importPermissionPreHandler } from './routes.js';
import type { QuickOrderPreviewOwner, QuickOrderPreviewStore } from './services/preview-store.js';
import { collapseOverflow, previewLineCount, refusesGrowth } from './services/preview-limits.js';

/**
 * The buyer's quick-order preview (issue #809) — the import's result as the buyer reviews and
 * edits it, kept here between the import and the build instead of in a storefront cookie.
 *
 *   - GET    /quick-order/preview  `{ data: preview | null }` — `null` for none or expired
 *   - PUT    /quick-order/preview  replaces it, within the import row cap and 2 MiB, and starts its TTL
 *   - DELETE /quick-order/preview  drops it (204)
 *
 * **Who.** All three need a signed-in buyer (`requireCustomer`), and the preview addressed is
 * always the one of the session the request presents — there is no id to send and none in the
 * URL, so nothing can name another buyer's preview. The Organization comes from the buyer's
 * context, which refuses a buyer without one (Principle XI). Writing is part of the import, so
 * the PUT takes the import's own guard (`carts.create` or `quote_requests.create`); reading and
 * dropping one's own preview need nothing more than the session, so sign-out can always drop it.
 *
 * **The line cap** is the effective `quick_order.import_max_rows`, read on every write (PO ruling
 * of 2026-11-08 on PR #942). The rows past the import's limit are kept as one `overflowCount`
 * (`services/preview-limits.ts`) and never count, so an import always fits; the cap bounds what
 * adding from search grows, and a write that adds no line is accepted above a cap lowered since.
 *
 * **Presence.** Registered through `ctx.routes` like every other route of the module, so while the
 * module is off they answer 503 `MODULE_DISABLED` and the stored previews are left as they are.
 */

const NO_STORE = 'private, no-store';

export interface QuickOrderPreviewRoutesDeps {
  store: QuickOrderPreviewStore;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
  };
  /** `organizations`' port, resolved per request (`module-composition.md` item 4a). */
  organizationPermissions: () => OrganizationPermissionPort;
  /** The effective, clamped `quick_order.import_max_rows` — the preview's line cap. */
  resolveImportMaxRows: () => Promise<number>;
}

export async function registerQuickOrderPreviewRoutes(
  app: FastifyInstance,
  deps: QuickOrderPreviewRoutesDeps,
): Promise<void> {
  const { store, requireCustomer, resolveCustomerContext, organizationPermissions } = deps;

  /** The preview's owner: the guarded buyer, their Organization, and the session they presented. */
  const ownerOf = (request: FastifyRequest): QuickOrderPreviewOwner => {
    const sessionToken = (request as { cookies?: Record<string, string | undefined> }).cookies?.[SESSION_COOKIE_NAME];
    // `requireCustomer` admits only a session-borne buyer, so this holds whenever it passed.
    if (!sessionToken) throw new CustomerSessionRequiredError();
    const { organizationId, customerAccountId } = resolveCustomerContext(request);
    return { organizationId, customerAccountId, sessionToken };
  };

  app.get('/api/v1/quick-order/preview', { preHandler: requireCustomer }, async (request, reply: FastifyReply) => {
    const preview = await store.get(ownerOf(request));
    reply.header('Cache-Control', NO_STORE);
    return { data: preview };
  });

  app.put(
    '/api/v1/quick-order/preview',
    {
      preHandler: [requireCustomer, importPermissionPreHandler(organizationPermissions)],
      bodyLimit: QUICK_ORDER_PREVIEW_MAX_BYTES,
      schema: { body: quickOrderPreviewSchema },
    },
    async (request, reply: FastifyReply) => {
      const owner = ownerOf(request);
      const cap = await deps.resolveImportMaxRows();
      const preview = collapseOverflow(quickOrderPreviewSchema.parse(request.body), cap);
      const lines = previewLineCount(preview);
      if (lines > cap) {
        const previous = await store.get(owner);
        if (refusesGrowth({ lines, previousLines: previous ? previewLineCount(previous) : 0, cap })) {
          throw new HttpError(
            422,
            ERROR_CODES.VALIDATION_FAILED,
            `A preview holds at most ${cap} lines.`,
            { code: 'too_many_lines', maximum: cap },
          );
        }
      }
      await store.put(owner, preview);
      reply.header('Cache-Control', NO_STORE);
      return { data: preview };
    },
  );

  app.delete('/api/v1/quick-order/preview', { preHandler: requireCustomer }, async (request, reply: FastifyReply) => {
    await store.delete(ownerOf(request));
    return reply.status(204).send();
  });
}
