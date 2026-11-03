import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { Cart } from '../entities/cart.entity.js';
import type { CartApprovalStatus } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type {
  CatalogProductAvailabilityPort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  OrganizationCartApprovalWritePort,
  OrganizationDetailsPort,
  OrderQuoteSourcePort,
  OrganizationRecord,
} from '@endora-commerce/contracts';
import type { CartAuditService } from './cart-audit-service.js';
import { assertCartMeetsMinimums, toCartMinimumItem } from './cart-minimums.js';
import { availableRecords, basketScopeLanguage, withBasketOrderRules } from './cart-availability.js';
import { cartAudience } from './cart-service.js';
import { readOrganizationCarts } from './organization-cart-reach.js';
import { approvalSubmissionRequired } from './cart-approval-policy.js';

/**
 * Approval-workflow state machine (feature 027 US4).
 *
 * Lives orthogonal to the main `status` enum: any cart may carry an
 * `approval_status` of `not_required` / `pending` / `approved` /
 * `rejected_by_org_admin`. Transitions:
 *
 *   not_required  → pending (buyer submits, when org policy is on)
 *   pending       → approved (org-admin approves)
 *   pending       → rejected_by_org_admin (org-admin rejects; main
 *                                          status also flips to `rejected`)
 *   approved      → pending (buyer mutates cart post-approval; re-arm)
 *   pending       → not_required (buyer mutates cart while it awaits
 *                                 approval; must submit again, issue #649)
 *   pending|approved → not_required (org turns the policy off)
 *
 * Self-approval exemption: a cart whose owner is themself an Org Admin
 * is born `not_required` regardless of policy.
 */

export interface ApproveActor {
  customerAccountId: string;
  organizationId: string;
}

/**
 * Email-dispatch port (feature 027 T090). The carts module hands the
 * transition event + actor + cart payload to the composition root,
 * which is responsible for: (a) resolving recipients (org admins for
 * submit, the buyer for approve / reject), (b) rendering the i18n
 * template from the buyer / admin's preferred language, and (c)
 * calling the platform Mailer. Implementations are expected to be
 * fire-and-forget: a thrown error MUST NOT roll back the approval
 * transition (it would be a UX regression to fail an approve because
 * mail delivery hiccupped). Production composition wraps each method
 * in a try / catch + structured log.
 */
export interface CartEmailDispatch {
  onSubmittedForApproval(input: {
    cart: Cart;
    submitter: ApproveActor;
  }): Promise<void>;
  onApproved(input: {
    cart: Cart;
    approver: ApproveActor;
  }): Promise<void>;
  onRejected(input: {
    cart: Cart;
    rejector: ApproveActor;
    reason: string;
  }): Promise<void>;
}

export class CartApprovalService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartAuditService: CartAuditService,
    /** `organizations`' read model — the approval policy and its owner row. */
    private readonly organizations: OrganizationDetailsPort,
    /**
     * `organizations`' write surface for the policy column (issue #175). The
     * two `setPolicy*` methods below used to assign
     * `organizations.requires_cart_approval` on that module's entity; the write
     * belongs to its owner, which audits it through the Command Bus. What stays
     * here is the cascade over this module's own carts.
     */
    private readonly organizationCartApproval: OrganizationCartApprovalWritePort,
    /** `customer_accounts`' read model — the submitting buyer's role. */
    private readonly customerAccounts: CustomerAccountReadPort,
    /**
     * Feature 155 (owner ruling 2026-10-18) — the basket's products and units, so a
     * basket below a minimum is refused before it is sent for approval.
     */
    private readonly catalogProducts: Pick<CatalogProductReadPort, 'findByIds' | 'listPackagingUnitsByProductIds'>,
    /**
     * Feature 155 (FR-039) — `orders`' checkout-preview confirmation of the
     * basket's quote source, so a quote-seeded line is exempt at submit only
     * while its quote is still valid, as at placement.
     */
    private readonly quoteSource: OrderQuoteSourcePort,
    /**
     * Feature 163 (FR-006) — `catalog`'s availability answer: a basket holding
     * a product no longer available at its (channel, language) is refused at
     * submit as placement refuses it.
     */
    private readonly availability: Pick<CatalogProductAvailabilityPort, 'filterAvailable' | 'effectiveOrderRules'>,
    private readonly emailDispatch?: CartEmailDispatch,
  ) {}

  /**
   * Fire-and-forget e-mail dispatch. Wraps each call so any throw is
   * swallowed — approval transitions must complete even if mail
   * delivery hiccups. Production composition is responsible for
   * surfacing the failure through the platform's log + alerting paths.
   */
  private async dispatch<T>(fn: () => Promise<T>): Promise<void> {
    if (!this.emailDispatch) return;
    try {
      await fn();
    } catch {
      // Swallow — see contract on CartEmailDispatch.
    }
  }

  /**
   * Whether `buyer`'s basket must be sent for approval before it is ordered
   * (issue #619): their Organization requires cart approval and they are not
   * its administrator — the two conditions {@link submitForApproval} refuses
   * on, read as a yes/no for the cart's primary call to action.
   */
  async submissionRequired(buyer: ApproveActor): Promise<boolean> {
    return approvalSubmissionRequired(
      { organizations: this.organizations, customerAccounts: this.customerAccounts },
      buyer,
    );
  }

  /**
   * Buyer submits the cart for Org-Admin approval. Refuses if:
   *   - the cart is empty
   *   - the policy is off (approval not required)
   *   - the buyer is themself an Org Admin (self-approval exemption)
   *   - approval_status is already non-`not_required`
   *   - a line is below a minimum or its product is gone (feature 155, owner
   *     ruling 2026-10-18, FR-039) — the refusal placement would give, with the
   *     quote-line exemption honoured only once `orders` confirms the quote
   *     source, so a basket that cannot be ordered is never sent for approval
   */
  async submitForApproval(
    basket: Cart,
    actor: ApproveActor,
    options: { language?: string | undefined } = {},
  ): Promise<Cart> {
    const em = this.emFactory();
    if (!basket.organizationId || basket.organizationId !== actor.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    // Issue #619 — `basket` was loaded by the caller's entity manager, and
    // `emFactory` forks per call, so flushing this one wrote nothing for it:
    // the route answered `pending` while the row stayed `not_required`. Every
    // check and the write below are made on this manager's own copy.
    const cart = await em.findOne(Cart, { id: basket.id });
    if (!cart) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }

    const items = await em.find(CartItem, { cartId: cart.id });
    if (items.length === 0) {
      throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
    }
    // Issue #86 — each refusal below has a code of its own: raised as
    // `VALIDATION_FAILED` its token was the message, which the envelope never
    // replaces, so the buyer read `approval_already_initiated` in every
    // language and a client could not tell it from a malformed request.
    if (cart.approvalStatus !== 'not_required') {
      throw new HttpError(
        422,
        ERROR_CODES.CART_APPROVAL_ALREADY_SUBMITTED,
        'This cart has already been sent for approval.',
        { cartId: cart.id, approvalStatus: cart.approvalStatus },
      );
    }

    const org = await this.organizations.findById(actor.organizationId);
    if (!org || !org.requiresCartApproval) {
      throw new HttpError(
        422,
        ERROR_CODES.CART_APPROVAL_NOT_REQUIRED,
        'The organization does not require cart approval.',
      );
    }

    const buyer = await this.customerAccounts.findById(actor.customerAccountId);
    if (buyer?.role === 'organization_admin') {
      throw new HttpError(
        422,
        ERROR_CODES.CART_APPROVAL_SELF_SUBMIT,
        'An organization administrator places orders directly; their own cart is not sent for approval.',
      );
    }

    await assertCartMeetsMinimums(this.catalogProducts, {
      cart: { sourceQuoteRequestId: cart.sourceQuoteRequestId ?? null },
      items: items.map(toCartMinimumItem),
      language: options.language,
      // Feature 163 — available at the basket's (channel, L), judged on that
      // channel's minimums (FR-006, FR-100).
      availableOnly: async (products) =>
        withBasketOrderRules(
          this.availability,
          await availableRecords(this.availability, products, {
            channelId: cart.salesChannelId,
            languageCode: cart.salesChannelId ? basketScopeLanguage(cart.salesChannelId, options.language) : null,
            audience: cartAudience({
              customer: { ...actor, salesChannelId: cart.salesChannelId ?? '' },
            }),
          }),
          cart.salesChannelId,
        ),
      confirmQuoteSource: (quoteRequestId) =>
        this.quoteSource.quoteSourceHonoursExemptions({
          organizationId: actor.organizationId,
          quoteRequestId,
          basketLines: items.map((item) => ({
            productId: item.productId,
            variantId: item.variantId ?? null,
            unitPrice: item.unitPrice,
          })),
        }),
    });

    cart.approvalStatus = 'pending';
    cart.submittedForApprovalAt = new Date();
    cart.lastActivityAt = new Date();
    // The transition and its audit rows land in one flush (issue #152's rule).
    this.cartAuditService.recordWithin(em, [
      {
        cartId: cart.id,
        actorType: 'customer',
        actorId: actor.customerAccountId,
        action: 'approval_submitted',
        fromState: 'not_required',
        toState: 'pending',
      },
    ]);
    await em.flush();
    await this.dispatch(() =>
      this.emailDispatch!.onSubmittedForApproval({ cart, submitter: actor }),
    );
    return cart;
  }

  /** Org Admin approves a pending cart. */
  async approve(cartId: string, actor: ApproveActor): Promise<Cart> {
    const em = this.emFactory();
    const cart = await this.#organizationCart(em, cartId, actor);
    if (cart.approvalStatus !== 'pending') {
      throw notPending(cart);
    }
    cart.approvalStatus = 'approved';
    cart.approvedAt = new Date();
    cart.approvedByCustomerAccountId = actor.customerAccountId;
    this.cartAuditService.recordWithin(em, [
      {
        cartId: cart.id,
        actorType: 'org_admin',
        actorId: actor.customerAccountId,
        action: 'approval_approved',
        fromState: 'pending',
        toState: 'approved',
      },
    ]);
    await em.flush();
    await this.dispatch(() =>
      this.emailDispatch!.onApproved({ cart, approver: actor }),
    );
    return cart;
  }

  /** Org Admin rejects a pending cart with a reason. */
  async reject(cartId: string, actor: ApproveActor, reason: string): Promise<Cart> {
    const em = this.emFactory();
    const cart = await this.#organizationCart(em, cartId, actor);
    if (cart.approvalStatus !== 'pending') {
      throw notPending(cart);
    }
    cart.approvalStatus = 'rejected_by_org_admin';
    cart.status = 'rejected';
    cart.rejectedAt = new Date();
    cart.rejectedByActor = `org_admin:${actor.customerAccountId}`;
    cart.rejectedReason = reason;
    this.cartAuditService.recordWithin(em, [
      {
        cartId: cart.id,
        actorType: 'org_admin',
        actorId: actor.customerAccountId,
        action: 'approval_rejected',
        fromState: 'pending',
        toState: 'rejected_by_org_admin',
        reason,
      },
    ]);
    await em.flush();
    await this.dispatch(() =>
      this.emailDispatch!.onRejected({ cart, rejector: actor, reason }),
    );
    return cart;
  }

  /**
   * A cart of the administrator's own Organization, loaded into `em` (issue
   * #619). A member's cart is outside the administrator's customer filter, so
   * it is read through {@link readOrganizationCarts}; a cart of another
   * Organization, a working basket and an unknown id are all the same 404.
   */
  async #organizationCart(em: EntityManager, cartId: string, actor: ApproveActor): Promise<Cart> {
    const cart = await readOrganizationCarts(actor.organizationId, () =>
      em.findOne(Cart, { id: cartId, organizationId: actor.organizationId, status: { $ne: 'working' } }),
    );
    if (!cart) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    return cart;
  }

  /**
   * The current policy, for a platform admin (feature 091, P7b;
   * `contracts/admin-component-contribution.md` §10.5).
   *
   * The read half of {@link setPolicyByAdmin}, added because the admin
   * contribution that renders the toggle has to know what to render it in.
   * Until P7b that value crossed as a prop — `initialRequiresCartApproval`, out
   * of `organizations`' detail payload — and a zone's props may not carry it:
   * the other three contributors to `organization.detail.after` want neither
   * the prop nor the request behind it.
   *
   * It reads through `organizations`' own port rather than this module's
   * tables, which is the direction the write has taken since issue #175: the
   * column belongs to that module.
   */
  async getPolicyByAdmin(organizationId: string): Promise<OrganizationRecord> {
    const organization = await this.organizations.findById(organizationId);
    if (!organization) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'organization_not_found');
    }
    return organization;
  }

  /**
   * Platform-admin variant of {@link setPolicyForOrganization}. Same
   * semantics (policy-off cascades a reset of every pending/approved
   * cart in the Org) but the actor is a platform admin rather than an
   * Org Admin — recorded as `actorType: 'platform_admin'` in the
   * audit row.
   */
  async setPolicyByAdmin(
    organizationId: string,
    adminUserId: string,
    requires: boolean,
  ): Promise<OrganizationRecord> {
    const { organization, changed } =
      await this.organizationCartApproval.setCartApprovalPolicy(organizationId, requires);
    if (changed && !requires) {
      await this.resetPendingApprovals(organizationId, 'platform_admin', adminUserId);
    }
    return organization;
  }

  /**
   * Org Admin toggles the per-Organization `requires_cart_approval` policy.
   * On `false`: every `pending` or `approved` cart in the Org returns to
   * `not_required` and is audited as `approval_policy_reset`.
   */
  async setPolicyForOrganization(
    organizationId: string,
    actor: ApproveActor,
    requires: boolean,
  ): Promise<OrganizationRecord> {
    if (organizationId !== actor.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'organization_not_found');
    }
    const { organization, changed } =
      await this.organizationCartApproval.setCartApprovalPolicy(organizationId, requires);
    if (changed && !requires) {
      await this.resetPendingApprovals(organizationId, 'org_admin', actor.customerAccountId);
    }
    return organization;
  }

  /**
   * The half of a policy switch-off that belongs to this module: every
   * `pending` or `approved` cart in the Organization returns to
   * `not_required`, audited as `approval_policy_reset` in this module's own
   * per-cart trail with the actor that switched the policy off.
   */
  private async resetPendingApprovals(
    organizationId: string,
    actorType: 'platform_admin' | 'org_admin',
    actorId: string,
  ): Promise<void> {
    const em = this.emFactory();
    // Issue #619 — an Organization administrator's own customer filter hides
    // every member's cart, so the reset used to reach only the administrator's.
    const affected = await readOrganizationCarts(organizationId, () =>
      em.find(Cart, {
        organizationId,
        approvalStatus: { $in: ['pending', 'approved'] satisfies CartApprovalStatus[] },
      }),
    );
    if (affected.length === 0) return;
    const audits = affected.map((cart) => {
      const prev = cart.approvalStatus;
      cart.approvalStatus = 'not_required';
      return {
        cartId: cart.id,
        actorType,
        actorId,
        action: 'approval_policy_reset' as const,
        fromState: prev,
        toState: 'not_required',
      };
    });
    this.cartAuditService.recordWithin(em, audits);
    await em.flush();
  }

  /**
   * Re-arm hook: a buyer's content change — a line added, a quantity changed, a
   * line removed, a coupon applied or removed — on a cart that is in, or past,
   * approval. Called by CartService.{addItem,addItems,updateItem,removeItem}
   * and by CartCouponService.{apply,clear}, on the caller's own entity manager
   * and its managed `cart`, **before** the flush that writes the change, so the
   * change, the transition and its audit row land in one transaction (the
   * `Within` convention: nothing here flushes).
   *
   *   approved → pending       the change needs approving again (feature 027)
   *   pending  → not_required  issue #649 (owner ruling 2026-11-03, option b):
   *                            the administrator would otherwise approve
   *                            contents other than those submitted, so the
   *                            submission is withdrawn and the buyer submits
   *                            again. `not_required` is the pre-submission
   *                            state because it is the only one
   *                            {@link submitForApproval} starts from.
   *
   * Idempotent within one unit of work: once moved, the cart no longer matches,
   * so a batch that writes several lines records one transition.
   */
  reArmWithin(em: EntityManager, cart: Cart, actor: { customerAccountId?: string }): void {
    const from = cart.approvalStatus;
    let to: CartApprovalStatus;
    if (from === 'approved') {
      to = 'pending';
      cart.submittedForApprovalAt = new Date();
    } else if (from === 'pending') {
      to = 'not_required';
      cart.submittedForApprovalAt = null;
    } else {
      return;
    }
    cart.approvalStatus = to;
    this.cartAuditService.recordWithin(em, [
      {
        cartId: cart.id,
        actorType: 'customer',
        ...(actor.customerAccountId ? { actorId: actor.customerAccountId } : {}),
        action: 'approval_resubmission_required',
        fromState: from,
        toState: to,
      },
    ]);
  }
}

/**
 * Issue #86 — approve and reject refuse a cart that is not awaiting approval
 * with a code of their own, the cart's approval state in `details`.
 */
function notPending(cart: Cart): HttpError {
  return new HttpError(
    422,
    ERROR_CODES.CART_APPROVAL_NOT_PENDING,
    'This cart is not awaiting approval.',
    { cartId: cart.id, approvalStatus: cart.approvalStatus },
  );
}
