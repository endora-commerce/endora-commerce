/**
 * The routes reachable whatever the sales-channel access rule decides
 * (`specs/154-sales-channel-access/` research R-4, `contracts/channel-access-rule.md`
 * §4; FR-006).
 *
 * A route joins by declaring `config: { salesChannelAccess: 'open' }` in its
 * owning module **and** by an entry here with the reason, so every addition is
 * a reviewed decision. `backend/test/contract/sales_channels/channel-access-open-routes.test.ts`
 * holds the two against the composed server in both directions: a route that
 * answers on a closed channel without an entry fails, and so does an entry for
 * a route that no longer does.
 *
 * Only `/api/v1/*` routes outside `/api/v1/admin/` are in question — the access
 * step skips the admin prefix, and `/api/v1/_health` is not resolved at all.
 * The keys are the route patterns as Fastify registered them.
 */
export interface OpenRouteEntry {
  /** The module (or `platform`) that owns the route and declares the option. */
  readonly owner: string;
  readonly reason: string;
  /**
   * What the route answers an anonymous caller once the channel step has let
   * it through, when that is not 200 — a route open to every channel can still
   * be gated on who asks.
   */
  readonly anonymousStatus?: number;
}

const SIGN_IN = 'Signing in is how a visitor of a store closed to anonymous visitors gets in.';
const ADMIN_SIGN_IN =
  'An operator signs in to the Admin UI anonymously; a closed default channel must not stop it.';
const MFA = 'The second factor and its set-up ticket complete a sign-in before any session exists.';
const OAUTH_START = 'Federated sign-in starts before any session exists.';
const OAUTH_CALLBACK =
  "The identity provider's redirect carries no storefront channel signal and completes a sign-in.";
const OAUTH_PROVIDERS =
  'The sign-in page lists the federated providers before anybody is signed in.';
const ACCOUNT = 'Account recovery and verification happen before the buyer can sign in.';
const EMAIL_LINK =
  'Opened from an e-mail with no storefront channel signal; the token is the authorisation.';

export const CHANNEL_ACCESS_OPEN_ROUTES: Readonly<Record<string, OpenRouteEntry>> = {
  // auth surfaces — `admin_users`
  'POST /api/v1/auth/admin/login': { owner: 'admin_users', reason: ADMIN_SIGN_IN },
  'POST /api/v1/auth/admin/logout': {
    owner: 'admin_users',
    reason: 'Signing out is always possible.',
  },

  // second factor and federated sign-in — `mfa`, both surfaces
  'POST /api/v1/auth/admin/mfa/verify': { owner: 'mfa', reason: MFA },
  'POST /api/v1/auth/admin/mfa/setup-ticket/begin': { owner: 'mfa', reason: MFA },
  'POST /api/v1/auth/admin/mfa/setup-ticket/complete': { owner: 'mfa', reason: MFA },
  'POST /api/v1/auth/customer/mfa/verify': { owner: 'mfa', reason: MFA },
  'POST /api/v1/auth/customer/mfa/setup-ticket/begin': { owner: 'mfa', reason: MFA },
  'POST /api/v1/auth/customer/mfa/setup-ticket/complete': { owner: 'mfa', reason: MFA },
  'GET /api/v1/auth/admin/oauth/providers': { owner: 'mfa', reason: OAUTH_PROVIDERS },
  'GET /api/v1/auth/admin/oauth/:provider/start': { owner: 'mfa', reason: OAUTH_START },
  'GET /api/v1/auth/admin/oauth/:provider/callback': { owner: 'mfa', reason: OAUTH_CALLBACK },
  'GET /api/v1/auth/customer/oauth/providers': { owner: 'mfa', reason: OAUTH_PROVIDERS },
  'GET /api/v1/auth/customer/oauth/:provider/start': { owner: 'mfa', reason: OAUTH_START },
  'GET /api/v1/auth/customer/oauth/:provider/callback': { owner: 'mfa', reason: OAUTH_CALLBACK },

  // customer sign-in, recovery, registration, invitations — `organizations`
  'POST /api/v1/auth/customer/login': { owner: 'organizations', reason: SIGN_IN },
  'POST /api/v1/auth/customer/logout': {
    owner: 'organizations',
    reason: 'A customer may always sign out, on any store (FR-011).',
  },
  'POST /api/v1/auth/password-reset/request': { owner: 'organizations', reason: ACCOUNT },
  'POST /api/v1/auth/password-reset/confirm': { owner: 'organizations', reason: ACCOUNT },
  'POST /api/v1/auth/email-verification/verify': { owner: 'organizations', reason: ACCOUNT },
  'POST /api/v1/organizations/register': {
    owner: 'organizations',
    reason:
      'A business may apply on a store closed to anonymous visitors; moderation decides (FR-016, Q2).',
  },
  // Feature 173 (`specs/173-registration-registry-lookup/contracts/public-api.md`):
  // the business registration form's two reads, open for the reason registration is.
  'GET /api/v1/organizations/registration-options': {
    owner: 'organizations',
    reason:
      'The business registration form reads whether the registry lookup is offered, also on a closed store (feature 173).',
  },
  'POST /api/v1/organizations/registry-lookup': {
    owner: 'organizations',
    reason:
      'The business registration form prefills from public registries before anybody can sign in; per-IP rate-limited, no channel-scoped data (feature 173, OD-2).',
  },
  // the fields a buyer fills in on registration — `custom_fields` (feature 175)
  'GET /api/v1/custom-fields/input-surfaces/:surface': {
    owner: 'custom_fields',
    reason:
      'The registration form reads which extra fields it shows, and registration is open on a closed store.',
  },
  'POST /api/v1/organizations/invitations/:token/accept': {
    owner: 'organizations',
    reason: 'An invited person joins an Organization before they can sign in.',
  },

  // what a storefront and the sign-in pages read before anybody is signed in
  'GET /api/v1/storefront/sales-channel': {
    owner: 'sales_channels',
    reason: "The channel's identity says whether a visitor has to sign in (FR-001).",
  },
  'GET /api/v1/storefront/sales-channel/access': {
    owner: 'sales_channels',
    reason: 'Reports the access decision to the viewer instead of enforcing it (FR-012).',
  },
  'GET /api/v1/i18n/config': {
    owner: 'languages',
    reason: 'Both sign-in pages read the active languages before anybody is signed in.',
  },
  'GET /api/v1/storefront/module-presence': {
    owner: 'platform',
    reason: 'Both sign-in pages read which capabilities to offer before anybody is signed in.',
  },
  'GET /api/v1/dictionary': {
    owner: 'dictionaries',
    reason: 'The business registration form reads its lists anonymously, also on a closed store.',
  },
  'GET /api/v1/dictionary/by-code': {
    owner: 'dictionaries',
    reason: 'The business registration form reads its lists anonymously, also on a closed store.',
  },
  'GET /api/v1/storefront/cms/brand-tokens': {
    owner: 'cms',
    reason:
      "A closed store's sign-in pages are styled with its brand; brand tokens are presentation, not data (feature 163).",
  },
  'GET /api/v1/storefront/seo/robots-policy': {
    owner: 'seo',
    reason: "A closed store's crawler policy is still served.",
  },
  'GET /api/v1/storefront/seo/crawler-files': {
    owner: 'seo',
    reason:
      "A closed store still serves robots.txt and llms.txt, built for a store with nothing public.",
  },

  // links and downloads that name no storefront
  'GET /api/v1/public/product-feeds/:token': {
    owner: 'product_feeds',
    reason: 'A feed consumer downloads by token and names no storefront channel.',
  },
  'GET /api/v1/newsletter/confirm': { owner: 'newsletter', reason: EMAIL_LINK },
  'GET /api/v1/newsletter/unsubscribe': { owner: 'newsletter', reason: EMAIL_LINK },
  'POST /api/v1/newsletter/unsubscribe': { owner: 'newsletter', reason: EMAIL_LINK },
  'GET /api/v1/newsletter/open.gif': { owner: 'newsletter', reason: EMAIL_LINK },
  'GET /api/v1/newsletter/click': { owner: 'newsletter', reason: EMAIL_LINK },
};

/**
 * Declared open and absent from the OpenAPI document, which does not describe
 * itself — asked of the server separately.
 *
 * Open here means the **channel** rule does not apply: the API description
 * names no store, and a closed default channel must not take it from an
 * integration. Who may read it is a separate gate — an administrator holding
 * `platform.api_description.read` or an API key with that scope
 * (`packages/platform/src/http/api-description.ts`) — so an anonymous caller is
 * answered 401 by that gate, never by the channel step.
 */
const API_DESCRIPTION =
  'The API description names no store; reading it is gated on platform.api_description.read.';

export const CHANNEL_ACCESS_OPEN_UNDOCUMENTED_ROUTES: Readonly<Record<string, OpenRouteEntry>> = {
  'GET /api/v1/_openapi.json': { owner: 'platform', reason: API_DESCRIPTION, anonymousStatus: 401 },
  'GET /api/v1/_docs': { owner: 'platform', reason: API_DESCRIPTION, anonymousStatus: 401 },
};
