import {
  defineModuleManifest,
  defineModuleSettingsManifest,
} from '@b2b/contracts';

/**
 * Organization-owned setting codes (feature 026 consolidation).
 *
 * Both keys are platform-wide policies (no per-channel override).
 */
export const ORGANIZATIONS_SETTING_CODES = {
  MODERATION_MODE: 'organizations.moderation.mode',
  NEW_REGISTRATION_RECIPIENTS: 'organizations.notifications.new_registration_recipients',
  // Feature 056 — platform-wide factory default for credit inheritance across the
  // organization tree; a per-org `credit_inheritance_mode` column overrides it.
  CREDIT_INHERITANCE_MODE: 'organizations.hierarchy.credit_inheritance_mode',
} as const;

const settings = defineModuleSettingsManifest({
  moduleCode: 'organizations',
  groups: [{ code: 'organizations', name: 'Organizations' }],
  settings: [
    {
      code: ORGANIZATIONS_SETTING_CODES.MODERATION_MODE,
      name: 'Moderation mode for new Organizations',
      description:
        'Whether newly registered Organizations enter pending_verification (manual moderation) or active (auto-activation). One of: manual | auto.',
      groupCode: 'organizations',
      valueType: 'string',
      defaultValue: 'manual',
    },
    {
      code: ORGANIZATIONS_SETTING_CODES.NEW_REGISTRATION_RECIPIENTS,
      name: 'New Organization registration — email recipients',
      description:
        'List of email addresses receiving a notification on every new Organization registration. Validated syntactically; max 50 entries; case-insensitive dedup. Empty list ⇒ no emails sent (in-app admin notification still fires).',
      groupCode: 'organizations',
      valueType: 'json',
      defaultValue: [],
    },
    {
      code: ORGANIZATIONS_SETTING_CODES.CREDIT_INHERITANCE_MODE,
      name: 'Credit inheritance mode (organization hierarchy)',
      description:
        'Factory default for how a parent organization\'s credit limit is consumed by sub-organizations that have no own limit. One of: shared_pool (branches draw against one shared pool; concurrent draws never exceed it) | independent_default (each branch draws its own full copy of the inherited amount). A per-organization override may be set by a platform administrator.',
      groupCode: 'organizations',
      valueType: 'string',
      defaultValue: 'shared_pool',
    },
  ],
});

/**
 * Organizations module — manifest backfill (Module Lifecycle, feature 018)
 * extended by feature 026 with two settings keys (moderation mode + new
 * registration email recipients).
 */
export const manifest = defineModuleManifest({
  id: 'organizations',
  name: 'Organizations',
  description:
    'B2B organization records, members, addresses, sales-rep assignment, moderation lifecycle, and per-org commercial scoping.',
  version: '1.1.0',
  // Rule 3 (tenancy root) — specs/065-manifest-aware-migrations/research.md §R9.
  // `organizations` is the single unit of tenancy (Principle XI) and must stay
  // installable first, so it declares no tenant-owned domain module. Five
  // cross-module foreign keys are therefore deliberately NOT declared here —
  // each is a late additive column, not an install-time necessity:
  //   → customer_accounts  (email_verification_tokens.customer_account_id)
  //                        would cycle: organizations → customer_accounts →
  //                        organizations
  //   → inventory          (organization_warehouses.warehouse_id)
  //                        cycles as soon as the sales_channels bridge edge is
  //                        also declared: organizations → inventory →
  //                        sales_channels → organizations
  //   → delivery_methods   (organization_delivery_methods.delivery_method_id)
  //   → payment_methods    (organization_payment_methods.payment_method_id)
  // The last two close no cycle on their own; they are dropped because a
  // tenancy root that cannot install before an optional commercial module is
  // not a root. (A third, `admin_users`, was here until T138 declared
  // `admin_notifications` — which depends on it — and made the edge
  // transitively satisfied.) All four are recorded in
  // test/unit/db/acknowledged-fk-edges.ts, which asserts each is still real and
  // still an exception.
  // `dictionaries` since feature 072 (T138): registration validates the
  // Organization's country code against the dictionary. `RegistrationService`
  // has always taken the validator and neither root ever passed one, so the
  // check was dead and the edge undeclared.
  // `email` and `admin_notifications` since feature 072 (T138): the invitation,
  // verification and new-registration mails, and the in-app admin notification
  // that accompanies the last of them. `addresses` is deliberately absent for
  // the same reason the five FK edges above are — it declares this module, so
  // the edge is mutual and declaring it back closes the cycle; it is recorded
  // in `ACKNOWLEDGED_PORT_EDGES` instead.
  dependencies: ['admin_notifications', 'dictionaries', 'email', 'settings'],
  // Feature 072/073 (Constitution XVII). The Organization is the single unit of
  // tenancy (Principle XI): every transacting customer has one, every
  // tenant-scoped entity carries its id, and the global-filter guard in
  // `src/tenancy/` resolves against this module's table. Principle XI states
  // outright that a design with a "no-organization" path is invalid, so there is
  // no coherent deployment with this switched off — it is not a smaller platform
  // but one with no tenant.
  //
  // The declaration is also forced from above: `customer_accounts` is itself
  // non-deactivatable and depends on this module, and dependencies fail closed.
  // Without it, switching `organizations` off would break a module the operator
  // was promised could not be broken.
  activation: {
    nonDeactivatable: true,
    reason:
      'The single unit of tenancy — every organization-scoped entity, membership and ' +
      'transacting customer resolves through it; switched off, the platform has no tenant.',
  },
  settings,
  // Feature 047 — admin-editable transactional emails owned by this module.
  transactionalEmails: [
    {
      code: 'email_verification',
      name: 'Email verification',
      group: 'organizations',
      variables: [
        { key: 'organizationName', label: 'Organization name', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'verifyUrl', label: 'Verification link', sampleValue: 'https://shop.example/verify?token=…' },
      ],
    },
    {
      code: 'organization_invitation',
      name: 'Organization invitation',
      group: 'organizations',
      variables: [
        { key: 'organizationName', label: 'Organization name', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'inviterName', label: 'Inviter name', sampleValue: 'Anna Nowak' },
        { key: 'roleLabel', label: 'Role', sampleValue: 'Member' },
        { key: 'acceptUrl', label: 'Accept link', sampleValue: 'https://shop.example/invitations/…/accept' },
        { key: 'expiresOn', label: 'Expiry date', sampleValue: '2026-07-15' },
      ],
    },
    {
      code: 'new_org_registration',
      name: 'New organization registration (admin)',
      group: 'organizations',
      variables: [
        { key: 'organizationName', label: 'Organization name', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'taxId', label: 'Tax ID', sampleValue: 'PL1234567890' },
        { key: 'statusLabel', label: 'Status', sampleValue: 'Oczekuje na weryfikację' },
        { key: 'linkPath', label: 'Admin link', sampleValue: '/organizations/…' },
      ],
    },
  ],
});
