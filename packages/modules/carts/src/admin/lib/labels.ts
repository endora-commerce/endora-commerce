import { defineEnumLabels, type EnumTranslate } from '@endora-commerce/admin-kit/lib';

/**
 * The carts module's enum labels (issues #1434, #1476). Every key is in the
 * `carts` bundle; read with `useTranslation('carts')`.
 *
 * The audit vocabularies mirror `CartAuditActorType` and `CartAuditAction` in
 * `backend/entities/cart-audit-entry.entity.ts`; the admin layer cannot import
 * the entity, so a value recorded there first shows as its code here until it
 * is added.
 */
export const cartStatusLabels = defineEnumLabels({
  active: 'carts.status.active',
  abandoned: 'carts.status.abandoned',
  completed: 'carts.status.completed',
  rejected: 'carts.status.rejected',
});

export const cartApprovalStatusLabels = defineEnumLabels({
  not_required: 'carts.approvalStatus.not_required',
  pending: 'carts.approvalStatus.pending',
  approved: 'carts.approvalStatus.approved',
  rejected_by_org_admin: 'carts.approvalStatus.rejected_by_org_admin',
});

export const cartAuditActorLabels = defineEnumLabels({
  customer: 'carts.audit.actor.customer',
  org_admin: 'carts.audit.actor.org_admin',
  platform_admin: 'carts.audit.actor.platform_admin',
  system: 'carts.audit.actor.system',
  sweep: 'carts.audit.actor.sweep',
});

export const cartAuditActionLabels = defineEnumLabels({
  status_changed: 'carts.audit.actionLabel.status_changed',
  approval_submitted: 'carts.audit.actionLabel.approval_submitted',
  approval_approved: 'carts.audit.actionLabel.approval_approved',
  approval_rejected: 'carts.audit.actionLabel.approval_rejected',
  approval_policy_reset: 'carts.audit.actionLabel.approval_policy_reset',
  approval_resubmission_required: 'carts.audit.actionLabel.approval_resubmission_required',
  coupon_applied: 'carts.audit.actionLabel.coupon_applied',
  coupon_dropped: 'carts.audit.actionLabel.coupon_dropped',
  converted_to_qr: 'carts.audit.actionLabel.converted_to_qr',
  created_from_qr: 'carts.audit.actionLabel.created_from_qr',
  created_from_shopping_list: 'carts.audit.actionLabel.created_from_shopping_list',
  admin_rejected: 'carts.audit.actionLabel.admin_rejected',
  abandonment_swept: 'carts.audit.actionLabel.abandonment_swept',
  abandonment_reactivated: 'carts.audit.actionLabel.abandonment_reactivated',
  line_added: 'carts.audit.actionLabel.line_added',
  line_removed: 'carts.audit.actionLabel.line_removed',
  line_qty_changed: 'carts.audit.actionLabel.line_qty_changed',
  cart_merged_from_anon: 'carts.audit.actionLabel.cart_merged_from_anon',
  lines_restored_from_rejection: 'carts.audit.actionLabel.lines_restored_from_rejection',
});

/**
 * A state on an audit row's transition: a cart status or an approval status,
 * whichever the action moved. The two value sets do not overlap.
 */
export function cartStateLabel(t: EnumTranslate, state: string | null | undefined): string {
  return cartApprovalStatusLabels.has(state)
    ? cartApprovalStatusLabels.label(t, state)
    : cartStatusLabels.label(t, state);
}

/**
 * Who rejected a cart, in words (issue #1548). The cart stores the rejecting
 * actor as `<role>:<id>` (`admin:<adminUserId>` from the admin route,
 * `org_admin:<customerAccountId>` from the organization's approver); the
 * screen names the role and leaves the id out. `null` for anything else, so a
 * value of an unknown shape is never printed raw.
 */
const REJECTED_BY_ROLE: Readonly<Record<string, string>> = {
  admin: 'platform_admin',
  org_admin: 'org_admin',
};

export function cartRejectedByLabel(t: EnumTranslate, actor: string | null | undefined): string | null {
  if (!actor) return null;
  const separator = actor.indexOf(':');
  if (separator <= 0) return null;
  const actorType = REJECTED_BY_ROLE[actor.slice(0, separator)];
  return actorType === undefined ? null : cartAuditActorLabels.label(t, actorType);
}
