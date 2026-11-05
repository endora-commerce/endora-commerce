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
  OrderQuoteSourcePort,
  OrganizationPermissionPort,
} from '@endora-commerce/contracts';
import type { CartAuditService } from './cart-audit-service.js';
import { assertCartMeetsMinimums, toCartMinimumItem } from './cart-minimums.js';
import { availableRecords, basketNamesAt, basketScopeLanguage, withBasketOrderRules } from './cart-availability.js';
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
 *   not_required  → pending (buyer submits; their role lacks
 *                            `carts.order_without_approval`)
 *   pending       → approved (a holder of `carts.approve` approves)
 *   pending       → rejected_by_org_admin (a holder of `carts.approve`
 *                                          rejects; main status also flips
 *                                          to `rejected`)
 *   approved      → pending (buyer mutates cart post-approval; re-arm)
 *   pending       → not_required (buyer mutates cart while it awaits
 *                                 approval; must submit again, issue #649)
 *   pending       → not_required (the owner's role gains
 *                                 `carts.order_without_approval`, or the
 *                                 owner moves to a role holding it — FR-034)
 *
 * `specs/170-organization-roles/` (OR-3) replaced the Organization's
 * `requires_cart_approval` switch and the administrator exemption with the
 * buyer's own `carts.order_without_approval` (`cart-approval-policy.ts`), and
 * "an administrator decides" with `carts.approve`. No approver decides on their
 * own pending cart (`CART_APPROVAL_SELF_APPROVE`).
 *
 * The `org_admin` actor type on the cart's own audit rows names the deciding
 * member's side of the transition, as it always has; it is a value of this
 * module's audit vocabulary, not a role check.
 */

export interface ApproveActor {
  customerAccountId: string;
  organizationId: string;
  /**
   * The actor's role, when the request carries it (research R-15): the
   * approval rule then needs no read of the account (FR-080).
   */
  organizationRoleId?: string | null;
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
    /**
     * `organizations`' permission port (`specs/170-organization-roles/`) — the
     * buyer's `carts.order_without_approval`, and which roles hold it when the
     * cascade (FR-034) asks. Reached lazily; never captured by the caller.
     */
    private readonly permissions: Pick<OrganizationPermissionPort, 'can' | 'rolesHolding'>,
    /** `customer_accounts`' read model — who holds a role, for the cascade. */
    private readonly customerAccounts: Pick<CustomerAccountReadPort, 'listByOrganization'>,
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
    private readonly availability: Pick<
      CatalogProductAvailabilityPort,
      'filterAvailable' | 'effectiveOrderRules' | 'effectiveTexts'
    >,
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
   * (issue #619): their role lacks `carts.order_without_approval` — the
   * condition {@link submitForApproval} refuses on, read as a yes/no for the
   * cart's primary call to action.
   */
  async submissionRequired(buyer: ApproveActor): Promise<boolean> {
    return approvalSubmissionRequired({ permissions: this.permissions }, buyer);
  }

  /**
   * Buyer submits the cart for approval. Refuses if:
   *   - the cart is empty
   *   - approval_status is already non-`not_required`
   *   - the buyer's role holds `carts.order_without_approval`, so approval is
   *     not required (`CART_APPROVAL_NOT_REQUIRED` — an administrator
   *     included, who was refused `CART_APPROVAL_SELF_SUBMIT` before
   *     `specs/170-organization-roles/`)
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

    if (!(await this.submissionRequired(actor))) {
      throw new HttpError(
        422,
        ERROR_CODES.CART_APPROVAL_NOT_REQUIRED,
        'Your role lets you place orders without approval; this cart is not sent for approval.',
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
      // Feature 174 (FR-030) — a refusal names the product as the basket shows it.
      namesAt: (productIds) =>
        basketNamesAt(
          this.availability,
          productIds,
          cart.salesChannelId,
          cart.salesChannelId ? basketScopeLanguage(cart.salesChannelId, options.language) : null,
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

  /**
   * A holder of `carts.approve` approves a pending cart — the route has judged
   * the permission. The cart's state is checked before its owner (owner ruling
   * PR-9, R-36): a cart that is not pending is `CART_APPROVAL_NOT_PENDING`
   * whoever owns it, and only one's own **pending** cart is
   * `CART_APPROVAL_SELF_APPROVE`.
   */
  async approve(cartId: string, actor: ApproveActor): Promise<Cart> {
    const em = this.emFactory();
    const cart = await this.#organizationCart(em, cartId, actor);
    if (cart.approvalStatus !== 'pending') {
      throw notPending(cart);
    }
    refuseOwnCart(cart, actor);
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

  /** A holder of `carts.approve` rejects a pending cart with a reason; checked as {@link approve}. */
  async reject(cartId: string, actor: ApproveActor, reason: string): Promise<Cart> {
    const em = this.emFactory();
    const cart = await this.#organizationCart(em, cartId, actor);
    if (cart.approvalStatus !== 'pending') {
      throw notPending(cart);
    }
    refuseOwnCart(cart, actor);
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
   * A cart of the approver's own Organization, loaded into `em` (issue #619). A
   * member's cart is outside the approver's customer filter, so it is read
   * through {@link readOrganizationCarts}; a cart of another Organization, a
   * working basket and an unknown id are all the same 404.
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
   * FR-034 — `roleId` of `organizationId` gained `carts.order_without_approval`
   * (`organization_role.permissions_changed.v1`): every `pending` cart of an
   * account holding the role returns to `not_required`.
   */
  async onRoleGainedOrderWithoutApproval(organizationId: string, roleId: string): Promise<void> {
    const members = await this.customerAccounts.listByOrganization(organizationId, { activeOnly: true });
    await this.releasePendingApprovals(
      organizationId,
      members.filter((member) => member.organizationRoleId === roleId).map((member) => member.id),
      { reason: 'organization_role_permissions_changed', roleId },
    );
  }

  /**
   * FR-034 — `customerAccountId` moved from `fromRoleId` to `toRoleId`
   * (`customer_account.organization_role_changed.v1`): when the new role holds
   * `carts.order_without_approval` and the old one did not, the account's
   * `pending` carts return to `not_required`. A role that no longer exists — a
   * deleted role's holders are moved as its children — reads as not holding it.
   */
  async onMemberRoleChanged(input: {
    organizationId: string;
    customerAccountId: string;
    fromRoleId: string;
    toRoleId: string;
  }): Promise<void> {
    if (input.fromRoleId === input.toRoleId) return;
    const holding = await this.permissions.rolesHolding(input.organizationId, 'carts.order_without_approval');
    if (!holding.includes(input.toRoleId) || holding.includes(input.fromRoleId)) return;
    await this.releasePendingApprovals(input.organizationId, [input.customerAccountId], {
      reason: 'organization_role_changed',
      roleId: input.toRoleId,
    });
  }

  /**
   * The cascade's one write: every `pending` cart of `customerAccountIds` in
   * `organizationId` returns to `not_required`, audited in this module's own
   * per-cart trail as `approval_policy_reset` — the transition switching the
   * old policy off made (`carts.md` § *Lifecycle*) — by the system, with what
   * caused it in the metadata. An `approved` cart stays approved (FR-034).
   *
   * The read crosses the customer filter through {@link readOrganizationCarts}
   * and names the Organization in its own `where`; it is reached from a
   * subscriber, so the ambient scope is the system's.
   */
  private async releasePendingApprovals(
    organizationId: string,
    customerAccountIds: readonly string[],
    cause: { reason: string; roleId: string },
  ): Promise<void> {
    if (customerAccountIds.length === 0) return;
    const em = this.emFactory();
    const affected = await readOrganizationCarts(organizationId, () =>
      em.find(Cart, {
        organizationId,
        customerAccountId: { $in: [...customerAccountIds] },
        approvalStatus: 'pending',
      }),
    );
    if (affected.length === 0) return;
    const audits = affected.map((cart) => {
      cart.approvalStatus = 'not_required';
      cart.submittedForApprovalAt = null;
      return {
        cartId: cart.id,
        actorType: 'system' as const,
        action: 'approval_policy_reset' as const,
        fromState: 'pending',
        toState: 'not_required',
        metadata: { ...cause },
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
 * `specs/170-organization-roles/` FR-032 (R-36) — nobody decides on their own
 * pending cart, whatever their role holds. Checked after {@link notPending}.
 */
function refuseOwnCart(cart: Cart, actor: ApproveActor): void {
  if (cart.customerAccountId !== null && cart.customerAccountId === actor.customerAccountId) {
    throw new HttpError(
      422,
      ERROR_CODES.CART_APPROVAL_SELF_APPROVE,
      'You cannot approve or reject your own cart.',
      { cartId: cart.id },
    );
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
