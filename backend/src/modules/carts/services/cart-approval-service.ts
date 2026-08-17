import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import type { CartApprovalStatus } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import type {
  CustomerAccountReadPort,
  OrganizationCartApprovalWritePort,
  OrganizationDetailsPort,
  OrganizationRecord,
} from '@b2b/contracts';
import type { CartAuditService } from './cart-audit-service.js';

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
   * Buyer submits the cart for Org-Admin approval. Refuses if:
   *   - the cart is empty
   *   - the policy is off (approval not required)
   *   - the buyer is themself an Org Admin (self-approval exemption)
   *   - approval_status is already non-`not_required`
   */
  async submitForApproval(cart: Cart, actor: ApproveActor): Promise<Cart> {
    const em = this.emFactory();
    if (!cart.organizationId || cart.organizationId !== actor.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }

    const items = await em.find(CartItem, { cartId: cart.id });
    if (items.length === 0) {
      throw new HttpError(422, ERROR_CODES.CART_EMPTY, 'cart_empty');
    }
    if (cart.approvalStatus !== 'not_required') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'approval_already_initiated');
    }

    const org = await this.organizations.findById(actor.organizationId);
    if (!org || !org.requiresCartApproval) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'approval_not_required');
    }

    const buyer = await this.customerAccounts.findById(actor.customerAccountId);
    if (buyer?.role === 'organization_admin') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'org_admin_self_submit');
    }

    cart.approvalStatus = 'pending';
    cart.submittedForApprovalAt = new Date();
    cart.lastActivityAt = new Date();
    await em.flush();

    await this.cartAuditService.record({
      cartId: cart.id,
      actorType: 'customer',
      actorId: actor.customerAccountId,
      action: 'approval_submitted',
      fromState: 'not_required',
      toState: 'pending',
    });
    await this.dispatch(() =>
      this.emailDispatch!.onSubmittedForApproval({ cart, submitter: actor }),
    );
    return cart;
  }

  /** Org Admin approves a pending cart. */
  async approve(cartId: string, actor: ApproveActor): Promise<Cart> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart || cart.organizationId !== actor.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    if (cart.approvalStatus !== 'pending') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'approval_not_pending');
    }
    cart.approvalStatus = 'approved';
    cart.approvedAt = new Date();
    cart.approvedByCustomerAccountId = actor.customerAccountId;
    await em.flush();

    await this.cartAuditService.record({
      cartId: cart.id,
      actorType: 'org_admin',
      actorId: actor.customerAccountId,
      action: 'approval_approved',
      fromState: 'pending',
      toState: 'approved',
    });
    await this.dispatch(() =>
      this.emailDispatch!.onApproved({ cart, approver: actor }),
    );
    return cart;
  }

  /** Org Admin rejects a pending cart with a reason. */
  async reject(cartId: string, actor: ApproveActor, reason: string): Promise<Cart> {
    const em = this.emFactory();
    const cart = await em.findOne(Cart, { id: cartId });
    if (!cart || cart.organizationId !== actor.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'cart_not_found');
    }
    if (cart.approvalStatus !== 'pending') {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'approval_not_pending');
    }
    cart.approvalStatus = 'rejected_by_org_admin';
    cart.status = 'rejected';
    cart.rejectedAt = new Date();
    cart.rejectedByActor = `org_admin:${actor.customerAccountId}`;
    cart.rejectedReason = reason;
    await em.flush();

    await this.cartAuditService.record({
      cartId: cart.id,
      actorType: 'org_admin',
      actorId: actor.customerAccountId,
      action: 'approval_rejected',
      fromState: 'pending',
      toState: 'rejected_by_org_admin',
      reason,
    });
    await this.dispatch(() =>
      this.emailDispatch!.onRejected({ cart, rejector: actor, reason }),
    );
    return cart;
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
    const affected = await em.find(Cart, {
      organizationId,
      approvalStatus: { $in: ['pending', 'approved'] satisfies CartApprovalStatus[] },
    });
    for (const cart of affected) {
      const prev = cart.approvalStatus;
      cart.approvalStatus = 'not_required';
      await em.flush();
      await this.cartAuditService.record({
        cartId: cart.id,
        actorType,
        actorId,
        action: 'approval_policy_reset',
        fromState: prev,
        toState: 'not_required',
      });
    }
  }

  /**
   * Re-arm hook: any buyer-driven mutation on an `approved` cart drops
   * it back to `pending`. Called by CartService.{addItem,updateItem,
   * removeItem} and by CartCouponService.{apply,clear}.
   */
  async maybeReArm(cart: Cart, actor: { customerAccountId?: string }): Promise<void> {
    if (cart.approvalStatus !== 'approved') return;
    const em = this.emFactory();
    cart.approvalStatus = 'pending';
    cart.submittedForApprovalAt = new Date();
    await em.flush();
    await this.cartAuditService.record({
      cartId: cart.id,
      actorType: 'customer',
      ...(actor.customerAccountId ? { actorId: actor.customerAccountId } : {}),
      action: 'approval_resubmission_required',
      fromState: 'approved',
      toState: 'pending',
    });
  }
}
