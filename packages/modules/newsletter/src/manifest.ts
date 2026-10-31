import { defineModuleManifest, defineModuleSettingsManifest } from '@endora-commerce/contracts';
import { NEWSLETTER_SETTING_CODES } from '@endora-commerce/contracts';

/**
 * Newsletter module (feature 048). Owns the subscriber list, tags, custom
 * fields, campaigns, linear automations, reusable email-safe blocks, the
 * bulk-sending provider (SMTP / Amazon SES via nodemailer), and engagement
 * tracking. Bulk delivery is independent of the transactional-email transport.
 * The SMTP connection + credentials come from a reusable `email_adapter`
 * credential configuration referenced by `newsletter.email_credentials`
 * (feature 058); when unset, dispatch uses the console (dev) sink.
 */
export const newsletterSettingsManifest = defineModuleSettingsManifest({
  moduleCode: 'newsletter',
  groups: [{ code: 'newsletter', name: 'Newsletter' }],
  settings: [
    {
      // Feature 073 — the operator's activation control. Platform-wide.
      code: 'newsletter.enabled',
      name: 'Newsletter enabled',
      description:
        'Switches the newsletter on or off: the storefront signup and confirmation links, the admin subscriber, campaign and automation screens, and bulk dispatch. Nothing is dropped — subscribers, their consent history, campaigns and stats stay in the database, and a campaign left mid-send resumes where it stopped.',
      groupCode: 'newsletter',
      valueType: 'boolean',
      defaultValue: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.OPT_IN_MODE,
      name: 'Opt-in mode',
      description: 'Single (immediate) or double (confirmation email) opt-in. Scopable per sales channel.',
      groupCode: 'newsletter',
      valueType: 'string',
      enumOptions: ['single', 'double'],
      defaultValue: 'double',
    },
    {
      code: NEWSLETTER_SETTING_CODES.CONFIRM_TTL_HOURS,
      name: 'Confirmation link TTL (hours)',
      description: 'How long a double opt-in confirmation link stays valid before the pending subscriber expires.',
      groupCode: 'newsletter',
      valueType: 'number',
      defaultValue: 168,
    },
    {
      code: NEWSLETTER_SETTING_CODES.EMAIL_CREDENTIALS,
      name: 'Email credentials',
      description:
        'Reference a reusable Email adapter credential configuration (Credentials screen) providing the SMTP host/port/security/username/password. Required to send real mail; when empty, newsletter dispatch uses the console (dev) sink.',
      groupCode: 'newsletter',
      valueType: 'credential_ref',
      configurationType: 'email_adapter',
      defaultValue: '',
    },
    {
      code: NEWSLETTER_SETTING_CODES.TRACKING_OPENS_ENABLED,
      name: 'Track campaign opens',
      description:
        'Adds an invisible 1×1 image to every campaign e-mail, so the campaign statistics can count who opened it. Opens are recorded per recipient. When off, campaign e-mails carry no image and no opens are counted. Off by default. Automation e-mails are never tracked.',
      groupCode: 'newsletter',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: NEWSLETTER_SETTING_CODES.TRACKING_CLICKS_ENABLED,
      name: 'Track campaign link clicks',
      description:
        'Sends the links in every campaign e-mail through a redirect on this platform, so the campaign statistics can count clicks per recipient and per link. When off, links lead straight to their destination and no clicks are counted. Off by default. Automation e-mails are never tracked.',
      groupCode: 'newsletter',
      valueType: 'boolean',
      defaultValue: false,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SENDER_FROM_EMAIL,
      name: 'Sender email',
      description: 'Verified From address for newsletter mail.',
      groupCode: 'newsletter',
      valueType: 'string',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.SENDER_FROM_NAME,
      name: 'Sender name',
      description: 'Display name shown in the From header.',
      groupCode: 'newsletter',
      valueType: 'string',
      defaultValue: '',
      hidden: true,
    },
    {
      code: NEWSLETTER_SETTING_CODES.RATE_LIMIT_PER_SECOND,
      name: 'Send rate limit (per second)',
      description: 'Maximum messages dispatched per second (provider throttle).',
      groupCode: 'newsletter',
      valueType: 'number',
      defaultValue: 14,
      hidden: true,
    },
  ],
});

export const manifest = defineModuleManifest({
  id: 'newsletter',
  name: 'Newsletter',
  description:
    'Own-infrastructure newsletter: subscribers with tags + custom fields, campaigns, linear automations, email-safe templates and variables, engagement stats, and a configurable bulk-sending provider.',
  version: '1.0.0',
  // `cms` owns `cmsBlockSeedPort`, the seam this module's registration-consent
  // block is kept in place through (feature 075 / D-87). Declared here rather
  // than withheld as non-binding because the edge is binding in the direction
  // that matters to an operator: the consent label the storefront renders on
  // the registration form *is* that block, and a `newsletter` with no consent
  // text to show is not a reduced newsletter but a form that cannot lawfully
  // collect the consent.
  dependencies: [
    'audit_logs',
    'auth',
    'cms',
    'credentials',
    'customers',
    'email',
    'sales_channels',
    'settings',
  ],
  settings: newsletterSettingsManifest,
  activation: { settingCode: 'newsletter.enabled', default: true },
  /**
   * `ALREADY_SUBSCRIBED` — D-129's remaining sweep, MR 4
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * D-186 in `specs/080-f4-real-scope/rulings.md`). The first error code this
   * module declares.
   *
   * It was `_i18n`'s until now, not because anybody judged it the platform's
   * but because the deleted prefix chain had no rule for it and its last line
   * was `return 'core'`. **D-121 T1 puts it here**: the noun is a subscription,
   * and `NewsletterSubscriber` — with the double opt-in that decides when a
   * second sign-up is a duplicate rather than a re-confirmation — is this
   * module's own entity.
   *
   * **The attribution is the sweep's own word "weakly", and the reason to
   * record it here is that the tree holds one counter-signal.** Nothing raises
   * this code anywhere (class D). The only place it is named outside a
   * declaration is a doc comment in `inventory`'s
   * `availability-notification-service.ts`, which says the restock subscribe
   * refuses `409 ALREADY_SUBSCRIBED` for an idempotent re-subscribe — and that
   * method does not refuse at all: it returns the existing row
   * (`if (existing) return existing;`). So the comment describes a refusal that
   * does not exist, and the one competing claim on the noun is a claim nothing
   * implements. If a back-in-stock subscription ever does start refusing, the
   * question is open again and `REHOMED_ERROR_CODES` is where this decision is
   * written down.
   *
   * **It arrives without a sentence, deliberately.** It carried a placeholder
   * in `_i18n`'s bundle, the code rewritten twice —
   * `"Already Subscribed."` and `"Błąd: already subscribed."` — which D-186 §2
   * deletes rather than moves: in this module's own bundle it would read as
   * this module's
   * answer and every instrument would count the code as translated for good.
   * `d129-sweep.md` §5.4 keeps writing real prose available and calls it the
   * better outcome, and it is available whenever a raise site says what the
   * refusal means. There is no raise site here, so a sentence could only be
   * invented from the code's own name — the placeholder again in longer words,
   * rendered for nobody. It is a `check-error-translations.ts`
   * `UNTRANSLATED_ERROR_CODES` entry under `newsletter` instead, where the debt
   * is findable and attached to whoever implements the refusal.
   *
   * No `tokens`, for the same reason and from the same direction: there is no
   * raise site to put a `details.code` on the wire.
   */
  errorCodes: [{ code: 'ALREADY_SUBSCRIBED' }],
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /**
   * Feature 163 (US7, FR-029, research R-17) — the sign-up block that
   * subscribes through this module. Declared here, by the module whose data it
   * writes, as `blog` declares `blog.LatestPosts`; its React code is
   * `@endora-commerce/cms-components`' `NewsletterSignupForm.tsx`, and it posts
   * to the storefront's `/newsletter/subscribe`, which calls this module's
   * public subscribe with `source: 'cms-block'`. While `newsletter` is off the
   * block is filtered from every palette and render, and the handler answers
   * 404. `cms.NewsletterSignup`, a form posting to any external endpoint,
   * stays `cms`' (owner decision (a), 2026-10-23).
   */
  blocks: [
    {
      name: 'newsletter.Signup',
      translatable: [
        { path: 'heading', format: 'tiptap' },
        { path: 'text', format: 'tiptap' },
        { path: 'emailLabel' },
        { path: 'placeholder' },
        { path: 'buttonLabel' },
        { path: 'topicsLegend' },
        { path: 'topics[].label' },
        { path: 'consentLabel', format: 'tiptap' },
        { path: 'messages.pending' },
        { path: 'messages.active' },
        { path: 'messages.consent' },
        { path: 'messages.email' },
        { path: 'messages.topics' },
        { path: 'messages.unavailable' },
        // Feature 169 (US7): the subscriber attributes' prose and the message for a required one left empty.
        { path: 'attributes[].label' },
        { path: 'attributes[].placeholder' },
        { path: 'messages.fields' },
      ],
      labelKey: 'blocks.signup.label',
      descriptionKey: 'blocks.signup.description',
      category: 'forms',
      contexts: ['cms'],
      fields: {},
      responsiveFields: [],
      weight: 5,
    },
  ],
  // The palette section the block sits in, declared beside it (the manifest
  // validator refuses a block whose section its manifest does not declare);
  // merged by key with `cms`'s.
  blockCategories: [{ key: 'forms', titleKey: 'blocks.category.forms', contexts: ['cms'], weight: 70 }],
  permissions: [
    { code: 'newsletter:read', label: 'View newsletter' },
    {
      code: 'newsletter:write',
      label: 'Manage newsletter subscribers, campaigns, automations, and provider',
    },
  ],
  actions: [
    {
      id: 'open-newsletter',
      labelKey: 'actions.openNewsletter.label',
      descriptionKey: 'actions.openNewsletter.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/subscribers',
      requiredPermission: 'newsletter:read',
      keywords: ['newsletter', 'campaign', 'subscribers', 'marketing', 'automation'],
      weight: 230,
    },
    {
      id: 'new-newsletter-campaign',
      labelKey: 'actions.newCampaign.label',
      descriptionKey: 'actions.newCampaign.description',
      icon: 'Plus',
      targetRoute: '/newsletter/campaigns/new',
      requiredPermission: 'newsletter:write',
      keywords: ['newsletter', 'campaign', 'new', 'create', 'send'],
      weight: 231,
    },
    /**
     * The two `AppShell.tsx` `PALETTE_ITEMS` rows feature 091's batch 11
     * deletes, arriving as declarations (Principle XVI).
     *
     * Same destinations, same codes and the same keywords the hand-written
     * rows carried — the English in `keywords`, the Polish under `keywordsKey`
     * since issue #573 — so the palette an operator sees is unchanged. What changes is who answers for it: a hand-written row is a
     * copy the server was never asked about, so it went on advertising these
     * two screens after an operator switched `newsletter` off, and this module
     * is one that really can be switched off.
     */
    {
      id: 'open-newsletter-campaigns',
      labelKey: 'actions.openCampaigns.label',
      descriptionKey: 'actions.openCampaigns.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/campaigns',
      requiredPermission: 'newsletter:read',
      keywords: ['newsletter', 'campaigns', 'email', 'marketing'],
      keywordsKey: 'actions.openCampaigns.keywords',
      weight: 232,
    },
    {
      id: 'open-newsletter-automations',
      labelKey: 'actions.openAutomations.label',
      descriptionKey: 'actions.openAutomations.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/automations',
      requiredPermission: 'newsletter:read',
      keywords: ['newsletter', 'automations', 'workflow'],
      keywordsKey: 'actions.openAutomations.keywords',
      weight: 233,
    },
    // Issue #516 (Principle XVI): the last three sidebar screens. Tags and
    // blocks open on `newsletter:read`; the provider screen opens on
    // `newsletter:write`, its route's code and the code of its save and its
    // test send (`check:action-route-permissions` ledgers the read-gated GET).
    {
      id: 'open-newsletter-tags',
      labelKey: 'actions.openTags.label',
      descriptionKey: 'actions.openTags.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/tags',
      requiredPermission: 'newsletter:read',
      keywords: ['newsletter', 'tags', 'fields', 'subscribers'],
      keywordsKey: 'actions.openTags.keywords',
      weight: 234,
    },
    {
      id: 'open-newsletter-blocks',
      labelKey: 'actions.openBlocks.label',
      descriptionKey: 'actions.openBlocks.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/blocks',
      requiredPermission: 'newsletter:read',
      keywords: ['newsletter', 'blocks', 'email', 'header', 'footer'],
      keywordsKey: 'actions.openBlocks.keywords',
      weight: 235,
    },
    {
      id: 'open-newsletter-provider',
      labelKey: 'actions.openProvider.label',
      descriptionKey: 'actions.openProvider.description',
      icon: 'Inbox',
      targetRoute: '/newsletter/provider',
      requiredPermission: 'newsletter:write',
      keywords: ['newsletter', 'provider', 'sender', 'smtp', 'throttle'],
      keywordsKey: 'actions.openProvider.keywords',
      weight: 236,
    },
  ],
});
