import {
  ERROR_CODES,
  QUICK_ORDER_BUILD_MAX_ITEMS,
  type CartBatchLineOutcome,
  type CartWritePort,
  type OrganizationPermissionPort,
  type QuickOrderBuildResponse,
  type QuickOrderTarget,
  type RfqCustomerPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';

/**
 * Context for a quick-order build. `organizationId` may be null for a no-org
 * customer (carts tolerate this; quote requests require an organization).
 */
export interface QuickOrderBuildContext {
  customerAccountId: string;
  organizationId: string | null;
  /** The buyer's role id when the request's actor carries it (research R-15); the port reads the account's otherwise. */
  organizationRoleId?: string | null;
  /**
   * The channel whose basket a `cart` build fills — the request's
   * (`specs/154-sales-channel-access/`): a customer holds one basket per channel.
   */
  salesChannelId: string;
}

export interface QuickOrderBuildLineInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
}

/**
 * Feature 155 — in-process options of a build, never read from a request body.
 *
 * `actor: 'operator'` is set only by the admin route, as a literal (threat
 * F10): a sales representative's build to `quote_request` creates the request
 * with the minimums flagged rather than refused (FR-030, US4 #15). It changes
 * nothing for target `cart` — a basket is judged the same whoever fills it
 * (US4 #1d). `language` names a refused product (the request's
 * `Accept-Language`). `languageTag` (feature 163) is the request's first
 * `Accept-Language` tag, which a buyer's quote lines' scope language is
 * resolved from (`CreateForCustomerOptions.languageTag`).
 */
export interface QuickOrderBuildOptions {
  actor?: 'operator';
  language?: string | undefined;
  languageTag?: string | undefined;
}

type QuickOrderBuildRejection = NonNullable<QuickOrderBuildResponse['rejected']>[number];

/**
 * QuickOrderBuildService (feature 039, US1). Turns a confirmed set of
 * recognized lines into either a Cart (via {@link CartWritePort}) or a Quote
 * Request (via {@link RfqCustomerPort}) — reusing the owning modules' surfaces
 * rather than a parallel ordering path (FR-031). Pricing is owned by those
 * modules (the buyer's / organization's current price list), never the import
 * file (FR-007).
 */
export class QuickOrderBuildService {
  constructor(
    private readonly cartWrite: CartWritePort,
    private readonly rfq: RfqCustomerPort,
    /**
     * `specs/170-organization-roles/` (FR-030, FR-040) — `organizations`'
     * port, resolved lazily by the composition and never captured.
     */
    private readonly permissions: OrganizationPermissionPort,
  ) {}

  async build(
    ctx: QuickOrderBuildContext,
    input: { target: QuickOrderTarget; items: QuickOrderBuildLineInput[] },
    options: QuickOrderBuildOptions = {},
  ): Promise<QuickOrderBuildResponse> {
    // `specs/170-organization-roles/` (FR-030, FR-040; `contracts/storefront-api.md`
    // §5) — a buyer's build needs the target's create permission. The target
    // is in the body, so no route guard can name the code; it is judged here,
    // first, before the request is looked at any further. The operator's
    // on-behalf build is gated by operator permissions only (research R-26):
    // what it produces is judged when the member acts on it.
    if (options.actor !== 'operator') {
      const subject = {
        customerAccountId: ctx.customerAccountId,
        // `''` finds no role, and the port fails closed.
        organizationId: ctx.organizationId ?? '',
        ...(ctx.organizationRoleId !== undefined ? { organizationRoleId: ctx.organizationRoleId } : {}),
      };
      const language = options.language ? { language: options.language } : {};
      if (input.target === 'cart') {
        await this.permissions.assert(subject, 'carts.create', language);
      } else {
        await this.permissions.assert(subject, 'quote_requests.create', language);
      }
    }

    // Feature 155 (FR-038, R20, threat F4) — first, before any line is
    // resolved, evaluated or added, for either target. Not a schema `.max()`,
    // which would answer 400.
    if (input.items.length > QUICK_ORDER_BUILD_MAX_ITEMS) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        `At most ${QUICK_ORDER_BUILD_MAX_ITEMS} items can be built at once.`,
        { code: 'too_many_items', maximum: QUICK_ORDER_BUILD_MAX_ITEMS },
      );
    }
    if (input.items.length === 0) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'No items to build.');
    }

    if (input.target === 'cart') {
      return this.buildCart(ctx, input.items, options);
    }
    return this.buildQuoteRequest(ctx, input.items, options);
  }

  /**
   * Feature 155 (FR-011 (b), R8, R12.2) — one batch: every line is resolved
   * first (a line the buyer may not have answers the unknown id's 404 and
   * nothing is added — threat F1), the batch is judged with the cart, and the
   * lines that would leave their product below a minimum are not added and
   * come back in `rejected[]`.
   */
  private async buildCart(
    ctx: QuickOrderBuildContext,
    items: QuickOrderBuildLineInput[],
    options: QuickOrderBuildOptions,
  ): Promise<QuickOrderBuildResponse> {
    const customer = {
      customerAccountId: ctx.customerAccountId,
      organizationId: ctx.organizationId,
      salesChannelId: ctx.salesChannelId,
    };
    const result = await this.cartWrite.addItems(
      { customer },
      items.map((item) => ({
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        quantity: item.quantity,
      })),
      { onLineError: 'throw', ...(options.language ? { language: options.language } : {}) },
    );
    const cartId = result.cart.id;
    return {
      target: 'cart',
      cartId,
      checkoutUrl: `/checkout?cartId=${cartId}`,
      rejected: rejectionsOf(items, result.outcomes),
    };
  }

  private async buildQuoteRequest(
    ctx: QuickOrderBuildContext,
    items: QuickOrderBuildLineInput[],
    options: QuickOrderBuildOptions,
  ): Promise<QuickOrderBuildResponse> {
    if (!ctx.organizationId) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'A quote request requires an organization.',
      );
    }
    const rfqCtx = {
      customerAccountId: ctx.customerAccountId,
      organizationId: ctx.organizationId,
    };
    const request = {
      items: items.map((item) => ({
        productId: item.productId,
        ...(item.variantId ? { variantId: item.variantId } : {}),
        quantity: item.quantity,
      })),
    };
    // Feature 155 (FR-030, R12.2, threat F10) — only the operator's build
    // warns; a buyer's is judged by the request's own rules (FR-012).
    // Feature 163 — the buyer's lines are asked about at the build's channel.
    const rfq =
      options.actor === 'operator'
        ? await this.rfq.createForCustomer(rfqCtx, request, { minimums: 'warn' })
        : await this.rfq.createForCustomer(rfqCtx, request, {
            salesChannelId: ctx.salesChannelId,
            ...(options.language ? { language: options.language } : {}),
            ...(options.languageTag ? { languageTag: options.languageTag } : {}),
          });
    return {
      target: 'quote_request',
      quoteRequestId: rfq.id,
      quoteRequestBusinessId: rfq.businessId,
    };
  }
}

/** The `below_minimum` outcomes, mapped back to the request lines they came from. */
function rejectionsOf(
  items: readonly QuickOrderBuildLineInput[],
  outcomes: readonly CartBatchLineOutcome[],
): QuickOrderBuildRejection[] {
  const rejected: QuickOrderBuildRejection[] = [];
  for (const outcome of outcomes) {
    if (outcome.status !== 'below_minimum') continue;
    const item = items[outcome.index];
    if (item === undefined) continue;
    rejected.push({
      productId: item.productId,
      variantId: item.variantId ?? null,
      quantity: item.quantity,
      productName: outcome.productName,
      reason: 'below_minimum',
      kind: outcome.kind,
      minimum: outcome.minimum,
      ...(outcome.packagingUnitName !== undefined ? { packagingUnitName: outcome.packagingUnitName } : {}),
    });
  }
  return rejected;
}
