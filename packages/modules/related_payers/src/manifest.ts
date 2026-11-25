import {
  RELATED_PAYERS_HOOKABLE_ACTIONS,
  RELATED_PAYERS_ORGANIZATION_PERMISSIONS,
  RELATED_PAYERS_OPERATOR_PERMISSIONS,
  RELATED_PAYERS_SETTING_CODES,
  RELATED_PAYERS_SETTING_DEFAULTS,
  RELATED_PAYERS_DEFAULT_TIME_ZONE,
  defineModuleManifest,
  defineModuleSettingsManifest,
  toHookableActionDeclaration,
} from '@endora-commerce/contracts';

/**
 * Related payers (`specs/182-related-payers/`).
 *
 * A buyer Organization names another Organization of the store as the payer
 * of an order. This module owns the buyer → payer link, its consent workflow,
 * its settings, permissions and notifications, and the ports `orders` and
 * `carts` read it through (research R-1, R-6).
 *
 * Shipped **off** (RP-1): an installation that never switches it on behaves
 * exactly as before. Switching it off is non-destructive — links, requests and
 * settings stay and reappear when it is switched back on (FR-004).
 */
const C = RELATED_PAYERS_SETTING_CODES;
const D = RELATED_PAYERS_SETTING_DEFAULTS;

export const relatedPayersSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'related_payers',
  groups: [{ code: 'related_payers', name: 'Related payers' }],
  settings: [
    {
      // Constitution XVII — the operator's activation control. Platform-wide,
      // and deliberately not `related_payers.enabled`: that code is the
      // per-sales-channel capability switch (FR-002), this one answers "does
      // this store have related payers at all".
      code: C.MODULE_ENABLED,
      name: 'Related payers module enabled',
      description:
        'Switches related payers on or off for the whole platform: payer links, payer requests, the payer choice at checkout and the Admin UI sections. Nothing is dropped: links, requests and settings stay in the database and reappear when the module is switched back on.',
      groupCode: 'related_payers',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: C.ENABLED,
      name: 'Related payers enabled',
      description:
        'Offers related payers to buyers on this sales channel: the payer choice at checkout and on the cart, and the payer screens in the account. Sales-channel value overrides the global value.',
      groupCode: 'related_payers',
      valueType: 'boolean',
      defaultValue: D[C.ENABLED],
    },
    {
      code: C.APPROVAL_MODE,
      name: 'Approval of payer requests',
      description:
        'Who approves a request naming an organization that has an account: payer (its users decide), admin (an operator decides) or payer_then_admin (its users, then an operator). Sales-channel value overrides the global value.',
      groupCode: 'related_payers',
      valueType: 'string',
      enumOptions: ['payer', 'admin', 'payer_then_admin'],
      defaultValue: D[C.APPROVAL_MODE],
    },
    {
      code: C.UNREGISTERED_PAYER_MODE,
      name: 'Payer without an account',
      description:
        'What happens to a request naming a tax ID no organization has: invite (an invitation to register is sent to the contact e-mail) or admin (an operator decides). Sales-channel value overrides the global value.',
      groupCode: 'related_payers',
      valueType: 'string',
      enumOptions: ['invite', 'admin'],
      defaultValue: D[C.UNREGISTERED_PAYER_MODE],
    },
    {
      code: C.PAYER_MAY_INVITE_BUYERS,
      name: 'Payers may invite buyers',
      description:
        'Lets a payer organization invite a buyer it agrees to pay for. Sales-channel value overrides the global value.',
      groupCode: 'related_payers',
      valueType: 'boolean',
      defaultValue: D[C.PAYER_MAY_INVITE_BUYERS],
    },
    {
      code: C.REQUEST_TTL_DAYS,
      name: 'Request lifetime (days)',
      description:
        'How many days a payer request or invitation waits for a decision before it expires, from 1 to 365. Sales-channel value overrides the global value.',
      groupCode: 'related_payers',
      valueType: 'number',
      defaultValue: D[C.REQUEST_TTL_DAYS],
    },
    {
      code: C.DAILY_REQUEST_LIMIT,
      name: 'Requests per organization per day',
      description:
        'The most payer requests plus invitations one organization may send in a day, from 1 to 1000. Sales-channel value overrides the global value.',
      groupCode: 'related_payers',
      valueType: 'number',
      defaultValue: D[C.DAILY_REQUEST_LIMIT],
    },
    {
      // RP-20 (a). A module setting of its own, as `tasks.time_zone` and `returns.time_zone`
      // are: there is no platform-wide store time zone. Read for the system-default channel.
      code: C.TIME_ZONE,
      name: 'Time zone of the daily request limit',
      description:
        'The time zone, as an IANA name such as Europe/Warsaw, in which the daily limit of payer requests and invitations counts a day: it starts again at midnight there. The default store\'s value applies to every sales channel.',
      groupCode: 'related_payers',
      valueType: 'string',
      defaultValue: RELATED_PAYERS_DEFAULT_TIME_ZONE,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'related_payers',
  name: 'Related payers',
  description:
    'Lets a buyer organization place orders paid and invoiced by another organization of the store: payer links, their approval workflow and the payer choice at checkout.',
  version: '1.0.0',
  // The ports this module resolves: the Organizations it links (`organizations`),
  // the payer's billing addresses (`addresses`) and its own settings (`settings`).
  // `orders` is read for the payer's view of its orders; `customer_accounts` and
  // `transactional_emails` carry the payer e-mail (FR-074) — its recipients and its sender.
  // Both are `nonDeactivatable` and reach back to nothing here, so neither edge closes a
  // cycle nor makes an activation control a dead switch (the `carts` precedent, issue #651).
  dependencies: ['organizations', 'addresses', 'settings', 'orders', 'customer_accounts', 'transactional_emails'],
  nonBindingDependencies: [
    {
      moduleId: 'invoices',
      name: 'invoicePdfPort',
      kind: 'degrades-without',
      whenAbsent: 'a payer sees the orders it pays for but cannot download their invoices',
      reason:
        '`specs/182-related-payers/` RP-13 — the payer downloads a paid order`s invoice through the ' +
        'paid-order route. The route asks `effectiveState.isPresent` before resolving the port and ' +
        'answers the paid order`s 404 without it, as for an order not yet invoiced.',
    },
    {
      moduleId: 'credit_limits',
      name: 'creditAvailabilityReadPort',
      kind: 'degrades-without',
      whenAbsent: 'the checkout offers no credit-limit payment method for a related payer',
      reason:
        '`specs/182-related-payers/` RP-16 (c) — the checkout payer list carries the payer`s available ' +
        'credit so the credit-limit method is offered for a payer by the rule the buyer`s own credit ' +
        'follows. The route asks `effectiveState.isPresent` before resolving the port and answers ' +
        '`null` (no credit) without it, which hides the method exactly as for a buyer with no grant.',
    },
    {
      moduleId: 'customer_notifications',
      name: 'customerNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent: 'buyers and payers get no entry about payer requests and revoked links in the storefront notification centre; the e-mails still go out',
      reason:
        '`specs/182-related-payers/` FR-042, FR-045, FR-050 — the outbox handlers of the request and revoke ' +
        'Commands write one centre entry per recipient. They ask `effectiveState.isPresent` in front of the ' +
        'port and skip the entry without it; nothing in this module fails closed on it.',
    },
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'degrades-without',
      whenAbsent: 'operators get no bell entry when a payer request enters the queue; the queue screen still lists it',
      reason:
        '`specs/182-related-payers/` FR-025 — a request routed to the operator raises one bell entry from ' +
        'the outbox handler, which asks `effectiveState.isPresent` in front of the port and skips the entry ' +
        'without it. The queue itself is this module`s own table.',
    },
  ],
  // Research R-8 — the request and revoke Commands write their after-commit work to the outbox;
  // this module's own handlers deliver the e-mails and notifications (`backend/index.ts`).
  hookableActions: [
    toHookableActionDeclaration(RELATED_PAYERS_HOOKABLE_ACTIONS.requestCreate),
    toHookableActionDeclaration(RELATED_PAYERS_HOOKABLE_ACTIONS.requestAccept),
    toHookableActionDeclaration(RELATED_PAYERS_HOOKABLE_ACTIONS.requestReject),
    toHookableActionDeclaration(RELATED_PAYERS_HOOKABLE_ACTIONS.linkRevoke),
    // RP-20 (c) — an expiry tells its requester.
    toHookableActionDeclaration(RELATED_PAYERS_HOOKABLE_ACTIONS.requestExpire),
    // US5 — a request routed to an Organization after its creation is told like a new one.
    toHookableActionDeclaration(RELATED_PAYERS_HOOKABLE_ACTIONS.requestRoute),
  ],
  // FR-024, Principle XVI — the operator queue is reachable under ⌘K.
  actions: [
    {
      id: 'open-payer-requests',
      labelKey: 'actions.openPayerRequests.label',
      descriptionKey: 'actions.openPayerRequests.description',
      icon: 'Inbox',
      targetRoute: '/related-payers/requests',
      requiredPermission: RELATED_PAYERS_OPERATOR_PERMISSIONS.READ,
      keywords: ['payer', 'payers', 'requests', 'related'],
      keywordsKey: 'actions.openPayerRequests.keywords',
      weight: 260,
    },
  ],
  settings: relatedPayersSettingsManifest,
  // RP-1 — operator-toggleable, shipped off.
  activation: { settingCode: C.MODULE_ENABLED, default: false },
  permissions: [
    { code: RELATED_PAYERS_OPERATOR_PERMISSIONS.READ, label: 'View related payers' },
    {
      code: RELATED_PAYERS_OPERATOR_PERMISSIONS.MANAGE,
      label: 'Manage related payers',
      // The section reads through `:read`; creating a payer organization from the
      // card is also the organization create, gated by `customers:manage`.
      requires: [RELATED_PAYERS_OPERATOR_PERMISSIONS.READ, 'customers:manage'],
    },
  ],
  // The organization permissions of data-model §7, each enforced by a customer route guard.
  organizationPermissions: [
    {
      code: RELATED_PAYERS_ORGANIZATION_PERMISSIONS.ORDER_WITH_PAYER,
      label: 'Place orders with a related payer',
      description: 'Choose a related payer for an order at checkout.',
      memberDefault: false,
    },
    {
      code: RELATED_PAYERS_ORGANIZATION_PERMISSIONS.VIEW_PAID_ORDERS,
      label: 'View orders we pay for',
      description: 'See, read-only, the orders other organizations placed with this organization as the payer, and download their invoices.',
      memberDefault: false,
    },
    {
      code: RELATED_PAYERS_ORGANIZATION_PERMISSIONS.MANAGE,
      label: 'Manage payers',
      description: 'Request payers for this organization, withdraw requests, revoke payer links and accept invitations from payers.',
      memberDefault: false,
    },
    {
      code: RELATED_PAYERS_ORGANIZATION_PERMISSIONS.APPROVE,
      label: 'Approve payer requests',
      description: 'Accept or reject requests from other organizations to have this organization pay for their orders, and revoke those links.',
      memberDefault: false,
    },
  ],
  // Routes the codes' sentences to this package's own bundle; every code is in
  // the platform's `ERROR_CODES` too. Each lands with its first raise site.
  errorCodes: [
    { code: 'RELATED_PAYER_LINK_EXISTS' },
    { code: 'RELATED_PAYER_INVALID_PAIR' },
    { code: 'RELATED_PAYER_NOT_USABLE' },
    { code: 'RELATED_PAYER_REQUEST_LIMIT' },
    { code: 'RELATED_PAYER_REQUEST_DECIDED' },
  ],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  // FR-074, RP-17 (b) — admin-editable on the templates screen. Sent by
  // `services/payer-order-emails.ts` on `order.created.v1` and `order.cancelled.v1`, only when
  // the link asks for it.
  transactionalEmails: [
    {
      code: 'related_payer_order_placed',
      name: 'Order billed to a related payer',
      group: 'related_payers',
      description:
        'Sent to each member of the paying Organization who may view the orders it pays for, when an ' +
        'order billed to it is placed and the payer link asks for the payer to be told.',
      variables: [
        { key: 'buyer.name', label: 'Buyer organization', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'payer.name', label: 'Paying organization', sampleValue: 'Acme Holding S.A.' },
        { key: 'order.number', label: 'Order number', sampleValue: 'ORD-2026-000182' },
        { key: 'order.total', label: 'Order total', sampleValue: '1230.00 PLN' },
      ],
    },
    {
      code: 'related_payer_order_cancelled',
      name: 'Order billed to a related payer cancelled',
      group: 'related_payers',
      description:
        'Sent to the same people as the placement e-mail when an order billed to their Organization is ' +
        'cancelled, and only when the payer link asks for the payer to be told (RP-17).',
      variables: [
        { key: 'buyer.name', label: 'Buyer organization', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'payer.name', label: 'Paying organization', sampleValue: 'Acme Holding S.A.' },
        { key: 'order.number', label: 'Order number', sampleValue: 'ORD-2026-000182' },
        { key: 'order.total', label: 'Order total', sampleValue: '1230.00 PLN' },
      ],
    },
    {
      code: 'related_payer_request_received',
      name: 'Payer request received',
      group: 'related_payers',
      description:
        'Sent to each member of the requested payer Organization who may approve payer requests, when a ' +
        'buyer asks it to pay for its orders. Never sent to the contact e-mail the buyer typed (FR-042).',
      variables: [
        { key: 'sender.name', label: 'Requesting organization', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'sender.taxId', label: 'Requesting organization tax ID', sampleValue: 'PL5260001246' },
        { key: 'payer.name', label: 'Requested payer', sampleValue: 'Acme Holding S.A.' },
      ],
    },
    {
      code: 'related_payer_request_decided',
      name: 'Payer request decided',
      group: 'related_payers',
      description:
        'Sent to the buyer who sent a payer request and to the members who manage payers, when the ' +
        'request is accepted or rejected. The outcome and any reason are on the account Payers screen.',
      variables: [
        { key: 'buyer.name', label: 'Requesting organization', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'request.taxId', label: 'Tax ID the request named', sampleValue: 'PL5260001246' },
      ],
    },
    {
      code: 'related_payer_invitation_received',
      name: 'Invitation from a payer received',
      group: 'related_payers',
      description:
        'Sent to each member of the invited buyer Organization who manages payers, when a payer offers to ' +
        'pay for its orders (US6). Never sent to the contact e-mail the payer typed.',
      variables: [
        { key: 'sender.name', label: 'Inviting payer', sampleValue: 'Acme Holding S.A.' },
        { key: 'sender.taxId', label: 'Inviting payer tax ID', sampleValue: 'PL5260001246' },
        { key: 'buyer.name', label: 'Invited buyer', sampleValue: 'Acme Sp. z o.o.' },
      ],
    },
    {
      code: 'related_payer_invitation_to_register',
      name: 'Invitation to register (related payers)',
      group: 'related_payers',
      description:
        'Sent to the contact e-mail of a payer request or invitation whose tax ID has no account, when the ' +
        'store invites it to register (FR-044). Its link pre-fills the tax ID on the registration form; ' +
        'nothing is created until the registration is approved.',
      variables: [
        { key: 'sender.name', label: 'Organization that sent the request', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'request.taxId', label: 'Tax ID the request named', sampleValue: 'PL5260001246' },
        { key: 'registration.url', label: 'Registration link', sampleValue: 'https://shop.example.com/register?payerInvitation=…' },
      ],
    },
    {
      code: 'related_payer_request_expired',
      name: 'Payer request expired',
      group: 'related_payers',
      description:
        'Sent to the member who sent a payer request or invitation when it expires without a decision ' +
        '(RP-20). A withdrawn request sends nothing.',
      variables: [
        { key: 'buyer.name', label: 'Organization that sent the request', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'request.taxId', label: 'Tax ID the request named', sampleValue: 'PL5260001246' },
      ],
    },
    {
      code: 'related_payer_link_revoked',
      name: 'Payer link revoked',
      group: 'related_payers',
      description:
        'Sent to the other side when a payer link is revoked: to the buyer`s payer managers when the payer ' +
        'revoked it, to the payer`s approvers when the buyer did, and to both when an operator or an ' +
        'integration did (FR-050).',
      variables: [
        { key: 'buyer.name', label: 'Buyer organization', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'payer.name', label: 'Paying organization', sampleValue: 'Acme Holding S.A.' },
      ],
    },
  ],
  /**
   * `specs/192-organization-merge/` T047 — an Organization merge re-points the
   * loser's payer links and requests on either side to the survivor in the
   * `records` phase; a link between the two, or one duplicating the survivor's,
   * is revoked, and a pending request between them is closed with a merge
   * reason (`contracts/participant-dispositions.md` §A).
   */
  merge: {
    participates: [
      {
        host: 'organization',
        key: 'payer-links',
        phase: 'records',
        references: [
          { entity: 'RelatedPayerLink', property: 'organizationId', disposition: 're_point' },
          { entity: 'RelatedPayerLink', property: 'payerOrganizationId', disposition: 're_point' },
          { entity: 'RelatedPayerRequest', property: 'organizationId', disposition: 're_point' },
          { entity: 'RelatedPayerRequest', property: 'counterpartyOrganizationId', disposition: 're_point' },
        ],
      },
    ],
  },
});
