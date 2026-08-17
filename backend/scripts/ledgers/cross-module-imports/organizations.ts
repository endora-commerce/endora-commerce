/**
 * Cross-module imports still standing in `organizations` (feature 075, FR-022…FR-026).
 *
 * Keyed `<path under src/>:<target module>/<target path>`, so moving code inside
 * a file does not invalidate an entry and re-opening a hole does not silently
 * inherit one — the same key discipline as `BARE_SUBSCRIPTIONS_TO_DRAIN`.
 *
 * Two-way: an unledgered import fails the build, and an entry that no longer
 * describes one fails it too. Delete this file when the last entry goes; an
 * empty shard is refused, because a done signal that says nothing is not one.
 *
 * "Retired by the cut merge request" is a reason only while the sweep runs.
 * After 2026-12-31 it stops being an acceptable one: an entry still carrying it
 * is a boundary the repository has decided to keep, and it needs a reason that
 * says so.
 */
export const entries: Readonly<Record<string, string>> = {
  'modules/organizations/backend.ts:transactional_emails/services/email-defaults-registry':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/backend.ts:transactional_emails/services/template-email':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/email-templates/invitation.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/email-templates/verification.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:addresses/services/address-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:customer_accounts/services/customer-auth-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:customer_accounts/services/password-reset-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:customer_accounts/services/role-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:customer_accounts/services/totp-enrolment-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/plugin.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.admin.ts:addresses/services/address-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.admin.ts:auth/services/password-hasher':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.admin.ts:custom_fields/services/custom-field-value.service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.admin.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.admin.ts:customer_accounts/services/role-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.customer.ts:addresses/services/address-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.customer.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.customer.ts:customer_accounts/services/customer-auth-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.customer.ts:customer_accounts/services/totp-enrolment-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.members.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.members.ts:customer_accounts/services/role-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.public.ts:auth/plugin':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.public.ts:customer_accounts/services/customer-auth-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.public.ts:customer_accounts/services/password-reset-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.public.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.sales-reps.ts:admin_users/entities/admin-user.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/routes.sales-reps.ts:quote_requests/entities/quote-request.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/email-verification-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/invitation-service.ts:auth/services/password-hasher':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/invitation-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/invitation-service.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/org-registration-notifier.ts:admin_notifications/services/admin-notification-service':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/org-registration-notifier.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/organization-effective-pricelists-service.ts:price_lists/entities/price-list.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/organization-effective-pricelists-service.ts:price_lists/services/application-rule-evaluator':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/organization-moderation-service.ts:email/services/mailer':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/personal-organization-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/registration-service.ts:auth/services/password-hasher':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
  'modules/organizations/services/registration-service.ts:customer_accounts/entities/customer-account.entity':
    'F3 Phase C — organizations. Retired by the organizations cut merge request.',
};
