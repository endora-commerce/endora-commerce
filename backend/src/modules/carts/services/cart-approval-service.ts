import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { Cart } from '../entities/cart.entity.js';
import type { CartApprovalStatus } from '../entities/cart.entity.js';
import { CartItem } from '../entities/cart-item.entity.js';
import { Organization } from '../../organizations/entities/organization.entity.js';
import { CustomerAccount } from '../../customer_accounts/entities/customer-account.entity.js';
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

export class CartApprovalService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly cartAuditService: CartAuditService,
  ) {}

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

    const org = await em.findOne(Organization, { id: actor.organizationId });
    if (!org || !org.requiresCartApproval) {
      throw new HttpError(422, ERROR_CODES.VALIDATION_FAILED, 'approval_not_required');
    }

    const buyer = await em.findOne(CustomerAccount, { id: actor.customerAccountId });
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
    return cart;
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
  ): Promise<Organization> {
    if (organizationId !== actor.organizationId) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'organization_not_found');
    }
    const em = this.emFactory();
    const org = await em.findOne(Organization, { id: organizationId });
    if (!org) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'organization_not_found');
    }
    if (org.requiresCartApproval === requires) {
      return org;
    }
    org.requiresCartApproval = requires;
    await em.flush();

    if (!requires) {
      // Reset every non-terminal cart's approval_status to not_required.
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
          actorType: 'org_admin',
          actorId: actor.customerAccountId,
          action: 'approval_policy_reset',
          fromState: prev,
          toState: 'not_required',
        });
      }
    }
    return org;
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
