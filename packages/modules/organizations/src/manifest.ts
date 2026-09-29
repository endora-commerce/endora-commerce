import {
  defineModuleManifest,
  defineModuleSettingsManifest,
  type ModuleDemoManifest,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

/**
 * The demo data this module owns (feature 113, T222 — contract §1.3).
 *
 * A typed `const` rather than an inline object literal: declared inline the
 * parameter infers from the schema and is `never`, so the author loses
 * `context.ctx: ModuleContext`.
 *
 * Both bodies are reached by a **relative `await import()`** (§1.4), in
 * `cliCommands.run`'s shape and for `cliCommands`' reason: a manifest is loaded
 * by every process that composes the platform and by the check scripts that
 * import the generated index, so a demo body imported at the top of this file
 * would be a service graph pulled into all of them. It needs no `exports`
 * subpath and no `files` entry (§1.5).
 *
 * **The buyer who belongs to this organisation and the credit limit granted to
 * it are not here.** Each is another module's row against this one's, so each is
 * a composition step (§5.1) and belongs to whoever owns the instance.
 */
const demo: ModuleDemoManifest<ModuleContext> = {
  summary: 'The buying organisation the demo shop trades with.',
  seed: async (context) => (await import('./backend/demo/seed.js')).seedDemo(context),
  reset: async (context) => (await import('./backend/demo/reset.js')).resetDemo(context),
};

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
  // tenancy root that cannot install before an optional module is
  // not a root. All four are recorded in
  // test/unit/db/acknowledged-fk-edges.ts, which asserts each is still real and
  // still an exception.
  // `dictionaries` since feature 072 (T138): registration validates the
  // Organization's country code against the dictionary. `RegistrationService`
  // has always taken the validator and neither root ever passed one, so the
  // check was dead and the edge undeclared.
  // `email` since feature 072 (T138): the invitation, verification and
  // new-registration mails. The in-app admin notification that accompanies the
  // last of them was declared in the same task and has moved to
  // `nonBindingDependencies` below (D-179.3). `admin_users` comes back with it:
  // the sales-rep endpoints resolve `adminUserReadPort`, and the edge was
  // satisfied transitively through `admin_notifications` until now. It closes no
  // cycle — `admin_users` depends on `admin_roles` and `auth`, neither of which
  // declares this module. `addresses` is deliberately absent for
  // the same reason the five FK edges above are — it declares this module, so
  // the edge is mutual and declaring it back closes the cycle; it is recorded
  // in `acknowledgedDependencies` below instead.
  // `transactional_emails` since T120: verification, invitation and
  // new-registration mail routes through that module's `templateEmailPort`.
  // `admin_roles` since T143a: the sales-rep visibility scope asks
  // `permissionService` whether the rep holds `organizations:rollup` before it
  // expands an assignment to its subtree. Declarable rather than acknowledged —
  // `admin_roles` depends on nothing, so the edge closes no cycle.
  dependencies: [
    'admin_roles',
    'admin_users',
    'custom_fields',
    'dictionaries',
    'email',
    'settings',
    'transactional_emails',
  ],
  // Feature 073, Amendment A1 — the five port edges this module genuinely has
  // and cannot declare above, moved here from `ACKNOWLEDGED_PORT_EDGES` in
  // `backend/scripts/check-port-dependencies.ts` so that one declaration feeds
  // both the CI check and the flip-time refusal. They are ignored by the
  // install and migration order, which is the only reason they were withheld.
  acknowledgedDependencies: [
    {
      moduleId: 'addresses',
      port: 'addressServicePort',
      reason:
        'Mutual by nature. `addresses` declares this module because every stored ' +
        'address is organization-scoped, and it must install after the tenancy root. ' +
        'This module resolves the published `AddressServicePort` because its customer ' +
        'routes expose address CRUD — it named the `addressService` class registration ' +
        'until issue #195, which is how the entity crossed the boundary behind a ' +
        'record-shaped type. Declaring the second direction closes the cycle and makes ' +
        'the tenancy root uninstallable first, which Rule 3 forbids — the same trade the ' +
        "manifest's five acknowledged FK edges record. It goes when the address routes " +
        'move to the module that owns the table.',
    },
    {
      moduleId: 'customer_accounts',
      port: 'customerAuthPort',
      reason:
        'The same mutual pair, five names over. `customer_accounts` declares this ' +
        'module — every account belongs to one, and feature 051 made that the tenancy ' +
        "direction — while this module's public registration, login and password-reset " +
        'routes are served by those services. The manifest already ' +
        'records the mirror of this as an acknowledged FK edge ' +
        '(`email_verification_tokens.customer_account_id`). Feature 075 Phase C ' +
        'renamed two of the five: `customerAuthService` and `customerRoleService` hand ' +
        "back that module's entity, and this module resolves the record-returning " +
        '`customerAuthPort` / `customerRolePort` beside them instead.',
    },
    {
      moduleId: 'customer_accounts',
      port: 'passwordResetService',
      reason: 'See the `customerAuthPort` edge above — same mutual pair.',
    },
    {
      moduleId: 'customer_accounts',
      port: 'customerRolePort',
      reason: 'See the `customerAuthPort` edge above — same mutual pair.',
    },
    {
      moduleId: 'customer_accounts',
      port: 'customerAccountReadPort',
      reason:
        'Feature 075 Phase C. Every route file and three services in this module read ' +
        "that module's `CustomerAccount` entity directly — the member panel, the " +
        'Org-Admin gate, `GET /me`, registration, invitation and the personal-organization ' +
        'provisioner. D-87 adds a fourth service: the moderation notifier resolved its ' +
        'recipient in raw SQL against that table, which named no specifier and so was ' +
        'invisible to the import predicate. Same mutual pair as `customerAuthPort` above, ' +
        'so the same trade.',
    },
    {
      moduleId: 'customer_accounts',
      port: 'customerAccountMemberWritePort',
      reason:
        'Feature 075 Phase C, the write half of the edge above: this module created and ' +
        "mutated that module's entity in seven places. The writes moved to the owner and " +
        'the audit rows stayed here. Same mutual pair, same trade.',
    },
    {
      moduleId: 'price_lists',
      port: 'priceListReadPort',
      reason:
        'Feature 075 Phase C. The applicable-price-lists panel ran ' +
        "`em.find(PriceList, { status: 'active' })` against that module's table and spelled " +
        "the status filter itself; it asks `price_lists` now. `price_lists` declares this " +
        'module (every price rule is organization-scoped), so declaring the second direction ' +
        'closes the cycle and makes the tenancy root uninstallable first, which Rule 3 ' +
        'forbids — the same trade the four FK edges above record. It goes when the panel ' +
        'moves to the module that owns the table.',
    },
  ],
  /**
   * D-44 — real to the container, binding on no operator.
   *
   * D-179.1 moves the `credit_limits` edge here. It described its own refusal
   * in prose before the spelling for it existed, and the spelling is what makes
   * the owner's control work.
   *
   * D-179.3 moves `admin_notifications` here for the same reason and with the
   * same kind. `catalog` reaches that owner too and takes `degrades-without`,
   * because its recorder decides absence in front of the gate; the kind belongs
   * to the **edge**, not to the owner, and the two consumers answer differently.
   */
  nonBindingDependencies: [
    {
      moduleId: 'admin_notifications',
      name: 'adminNotificationRecordPort',
      kind: 'refuses-without',
      whenAbsent:
        'nobody is told a new organisation has registered: the bell entry refuses, and that ' +
        'refusal stops the new-registration e-mails too — the registration itself still ' +
        'completes',
      reason:
        'D-179.3. The registration notifier writes one bell entry and then mails the ' +
        'recipient list, and its `catch` calls `rethrowIfModuleDisabled` first under D-88: a ' +
        'registration nobody was told about is not a degrade this module may choose on the ' +
        'owner’s behalf, so the refusal surfaces instead of being absorbed by the ' +
        'best-effort tolerance around it. That is what `refuses-without` spells, and ' +
        'declaring `degrades-without` here would reverse D-88 in a manifest field. It was ' +
        '`dependencies`, which bought no schema order — nothing this module owns references ' +
        'either `admin_notification` table — and only the flip-time refusal that made ' +
        '`admin_notifications.enabled` a control an operator could move with nothing ' +
        'happening.',
    },
    {
      moduleId: 'credit_limits',
      name: 'creditLimitReadPort',
      kind: 'refuses-without',
      whenAbsent:
        'the ancestor-chain lookup for who holds a credit limit refuses — no screen reaches ' +
        "it, because its only caller is that module's own service",
      reason:
        'Feature 077, D-87. `creditOwner` walks an ancestor chain and has to know which of ' +
        "those organisations hold a credit limit. It selected from that module's table — a " +
        'statement naming no import specifier, so the boundary compiled and returned rows ' +
        'whatever state the owner was in. It asks `creditLimitReadPort` now, through a ' +
        '`lazyPort` call on a `di.providePort` name, with no fallback and no `catch`: an ' +
        'empty set would read as "nobody here holds a limit", which on a credit check is the ' +
        'difference between refusing an order and quoting unlimited credit. D-179.1 spells ' +
        'that `refuses-without`. It was `acknowledgedDependencies`, which described the same ' +
        'behaviour and carried a bind as well, and the bind is what made the owner\'s ' +
        'activation control answer 409 forever.',
    },
  ],
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
  demo,
  activation: {
    nonDeactivatable: true,
    reason:
      'The single unit of tenancy — every organization-scoped entity, membership and ' +
      'transacting customer resolves through it; switched off, the platform has no tenant.',
  },
  // D-166 — the code gating the three `/organizations/:id/sales-reps`
  // endpoints, which this module registers from its own `backend.ts`.
  //
  // It is the name this module's own route file proposed in feature 008: those
  // endpoints were gated `rfqs:handle` "for now, because that's the existing
  // admin permission slot for RFQ-adjacent work", with a comment saying a
  // dedicated `organizations:assign-sales-rep` should follow. It has to, and
  // for a reason sharper than tidiness — `rfqs:handle` is declared
  // `module: 'quote_requests'`, so an operator switching quote requests off
  // removes that code from `/admin-roles` while these endpoints, owned by a
  // module that cannot be switched off, keep answering. The screen would sit
  // there behind a permission nobody could be granted.
  //
  // `organizations:rollup` stays in the core `PERMISSION_CATALOGUE`: it is read
  // by `admin_roles`' capability check on behalf of three modules, and moving it
  // is a data migration on every admin role that holds it.
  //
  // D-173 — the two `customers:*` codes are the same finding, one route file
  // over. Every admin organization endpoint here is gated on `customers:manage`
  // (or on `customers:read` OR `customers:manage`), and both codes' core
  // `PERMISSION_CATALOGUE` rows name `customers`, which an operator can switch
  // off while this module cannot be. Declaring them here makes this module a
  // second *owner*, in the shape issue #213 gave `integrations:manage`, so the
  // presence filter keeps them grantable while these screens are on. The
  // labels are why they are shared rather than replaced by codes of this
  // module's own: *"Manage customer organizations"* and *"View customers"*
  // read as sentences about this module's screens, which is what the
  // paragraph above had to invent a new code for and these do not.
  permissions: [
    {
      code: 'organizations:assign-sales-rep',
      label: 'Assign sales representatives to organizations',
    },
    { code: 'customers:read', label: 'View customers' },
    { code: 'customers:manage', label: 'Manage customer organizations' },
  ],
  settings,
  /**
   * The module's landing surface in the command palette (Principle XVI) — its
   * first action, declared by feature 091's Phase 4 batch 14.
   *
   * `AppShell.tsx` carried a hand-written *Navigate* row for `/organizations`
   * until that batch. A hand-written palette row is a copy the server was never
   * asked about, so it went on advertising the screen whatever the effective
   * enabled-set said; a manifest action is the one surface that set filters.
   * The destination and the keywords are the row's, and the label and
   * description are the two strings it rendered
   * (`appShell.nav.organizations`, `appShell.palette.sub.customerAccounts`),
   * moved into this module's own bundle.
   *
   * **`customers:read` and not the row's any-of pair.**
   * `ModuleActionSchema.requiredPermission` is a single string, and either code
   * alone opens `/organizations` — the gate is
   * `requireAdminAny(['customers:read', 'customers:manage'])`, which is the
   * sufficiency `check:action-route-permissions` reads. The narrowing is real
   * for a role holding only `customers:manage` and is recorded where the row
   * used to stand; the sidebar entry keeps the pair, because
   * `AdminNavDeclaration.requiredPermission` takes the whole
   * `PermissionRequirement`.
   */
  actions: [
    {
      id: 'open-organizations',
      labelKey: 'actions.openOrganizations.label',
      descriptionKey: 'actions.openOrganizations.description',
      icon: 'Building2',
      targetRoute: '/organizations',
      requiredPermission: 'customers:read',
      keywords: ['org', 'orgs', 'customer', 'organization', 'organizacja', 'klient'],
      weight: 220,
    },
  ],
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
    // The two moderation outcomes a buyer is told about. Both reached the
    // transport as hard-coded Polish prose with no code and no language until
    // the seam-B carve-out in `specs/093-backend-delivered-prose/`; declaring
    // them here is what gives them a language at all, and an operator a place
    // to edit them.
    {
      code: 'organization_approved',
      name: 'Organization verified (customer)',
      group: 'organizations',
      variables: [
        { key: 'organizationName', label: 'Organization name', sampleValue: 'Acme Sp. z o.o.' },
      ],
    },
    {
      code: 'organization_rejected',
      name: 'Organization registration rejected (customer)',
      group: 'organizations',
      variables: [
        { key: 'organizationName', label: 'Organization name', sampleValue: 'Acme Sp. z o.o.' },
        { key: 'reason', label: 'Rejection reason', sampleValue: 'Tax ID could not be verified.' },
      ],
    },
  ],
  /**
   * This module's first i18n bundle — D-129's remaining sweep, MR 7.
   *
   * It exists because a **declaring** module that contributes no bundle file is
   * `check:error-translations` exit 2 for the whole tree rather than a finding
   * (`specs/090-module-owned-error-codes/contracts/error-translation-population.md`
   * §2.1, §2.3; `d129-sweep.md` §3.4). The bundle lives at the **package
   * root**, not under `dist`: `manifest-locations.ts` resolves a packaged
   * module's `manifestPath` to its `package.json`, so `dirname` is the package
   * directory. The file is a **flat** `{"a.b.c": "text"}` map, because a nested
   * object fails `TranslationBundleEntriesSchema` and the boot reconciler logs
   * and skips it — silently.
   */
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  /**
   * The eight codes whose noun is an organization — D-129's remaining sweep,
   * **Tier C** (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2,
   * Appendix A; MR 7, the largest batch in the sweep).
   *
   * They were declared by `_i18n` until this merge request, not because anybody
   * judged them the platform's but because the deleted prefix chain had no rule
   * for them and its last line was `return 'core'`. **D-121 T1 puts all eight
   * here**: the noun in each is this module's `organizations` row, its
   * invitation, its administrator or its tree.
   *
   * **Two of the eight are raised by a module that does not own them**, which is
   * the shape D-95.2 already ruled for `INVOICE_NOT_READY` and D-186 §1 re-took
   * for `CUSTOMER_*`: the owner of a noun is not required to be the module that
   * throws about it. `ORG_OWNER_DEPLETION` is raised three times in `customers`
   * — deleting, blocking and unassigning the last organization administrator —
   * and the invariant it protects is this module's, not that module's: an
   * organization is the unit of tenancy and may not be left with nobody able to
   * manage it. `ORGANIZATION_SUSPENDED` is raised once in `orders`, at
   * placement, and is a statement about the organization's `status` column,
   * which this module owns and moderates. Homing either with its thrower would
   * split the sentence from the rule it describes and put it in a bundle that
   * says nothing else about organizations.
   *
   * **Two are always tokened, and their token sets were measured rather than
   * read off the bundle** (runbook §5): the arguments of every `HttpError` call
   * naming them were extracted by balancing the call's own parentheses,
   * resolving `ERROR_CODES.<CODE>` and the bare literal alike, and `details`
   * read as the **positional fourth argument** it is — the correction MR 6
   * recorded, because looking for a named `details:` property reports `(none)`
   * for a raise that plainly carries a token. `ORGANIZATION_HAS_CHILDREN` has
   * one raise and it passes `has_children`; `ORGANIZATION_TREE_INVALID` has two
   * and they pass `cycle` and `max_depth_exceeded`. The other six carry no
   * `details` at all, at any raise site, which is why they declare no tokens.
   *
   * **So all four sentences these two codes had were unreachable, and this
   * change is the first time either renders anything.**
   * `localizeErrorEnvelope` composes `` `${target.key}.${token}` `` whenever
   * `details.code` is present and has **no** fall-back to the base key
   * (`packages/platform/src/http/error-envelope.ts`), so `_i18n`'s two prose
   * pairs were read by nobody. The three sub-keys are written here for the
   * first time and are the ones an operator meets.
   *
   * **The base pairs move anyway, and D-190 is why.** They are unreachable for
   * the operator and load-bearing for the instrument at the same time:
   * `findUntranslatedErrorCodes` asks its question at
   * `read(target.moduleId, language)[target.key]` and at **no other key**, so a
   * bundle without them reports both codes as untranslated and exits 1 — MR 6
   * measured exactly that when it tried. `UNTRANSLATED_ERROR_CODES` would be a
   * false entry for a code with five written sentences, and widening P1 to
   * accept "every declared token answered" is a tree-wide instrument changed by
   * the merge request that benefits from it, which D-190 refuses in terms. So
   * the base sentence is carried, and the sub-key beside it is the one to edit
   * when the wording changes.
   *
   * **The other six arrive with prose.** Five carried a placeholder in `_i18n`'s
   * bundle — `"Organization Suspended."` / `"Błąd: organization suspended."`
   * and four like it — which D-186 §2 deletes rather than carries,
   * because in this module's own bundle it would read as this module's answer
   * and every instrument would then count the code as translated.
   * `d129-sweep.md` §5.4 keeps writing the prose available and is not a
   * re-opening of that ruling; every one of the six has a live raise site whose
   * English states the refusal and a reader who meets it — an organization
   * administrator inviting a member, a buyer whose organization was suspended,
   * a company registering with a tax ID somebody already used, an operator on
   * `/customers` removing the last administrator. The sixth,
   * `ORG_OWNER_DEPLETION`, had no sentence at all and sat on
   * `UNTRANSLATED_ERROR_CODES`; writing it is what makes that ledger **shrink**
   * for the first time in the sweep.
   *
   * `ORGANIZATION_TREE_INVALID.max_depth_exceeded` needed one repair before its
   * sentence could be written: the raise interpolates the depth bound into its
   * English message and passed only the token, so a translated sentence with no
   * placeholder would have rendered cleanly and lost the number — the shape
   * !1181 measured at 85 codes tree-wide. The raise now carries
   * `{ code: 'max_depth_exceeded', maxDepth: MAX_TREE_DEPTH_SEGMENTS }` and both
   * sentences name it as `{maxDepth}`. The member is `maxDepth` and not `code`
   * deliberately: `details.code` is the refusal **token**, and a second value
   * written there would re-key the lookup rather than fill the sentence.
   * `test/unit/organizations/error-code-sentences.test.ts` renders a real
   * refusal against these keys, which is the three-way agreement issue #168
   * found nothing was checking and which `check:error-translations` cannot see.
   */
  errorCodes: [
    { code: 'CANNOT_REVOKE_LAST_ADMIN_INVITE' },
    { code: 'EMAIL_ALREADY_IN_ORGANIZATION' },
    { code: 'EMAIL_BELONGS_TO_ANOTHER_ORGANIZATION' },
    { code: 'ORGANIZATION_HAS_CHILDREN', tokens: ['has_children'] },
    { code: 'ORGANIZATION_SUSPENDED' },
    { code: 'ORGANIZATION_TAX_ID_EXISTS' },
    { code: 'ORGANIZATION_TREE_INVALID', tokens: ['cycle', 'max_depth_exceeded'] },
    { code: 'ORG_OWNER_DEPLETION' },
  ],
});
