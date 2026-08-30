import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Customer Accounts module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'customer_accounts',
  name: 'Customer Accounts',
  description:
    'Customer (B2B) account records, including organization membership and role.',
  version: '1.0.0',
  // `auth` owns `authSessionPort`, which `CustomerAuthService` resolves to mint
  // and destroy a customer session; the edge became real with the conversion
  // (feature 072, T094) and stays binding — a platform that cannot mint a
  // session must refuse the login rather than issue one nothing can validate.
  // It is *only* that: feature 075's Phase C took password hashing and the TOTP
  // primitives out of this edge, because a pure function has no owner to be
  // switched off.
  // `customer_accounts.organization_id` is a real foreign key, and feature 072
  // is what made it visible: the module exports its entities now, so the ORM
  // registry attributes the table to it and the FK-drift check can see across
  // the boundary. The edge predates the conversion — it was simply
  // unattributable while the table belonged to nobody.
  // `customer_accounts.customer_group_id` is a real foreign key too, and since
  // feature 076 (D-79) it points at `customer_groups`, which this module now
  // owns: the constraint is intra-module and declares nothing.
  // `audit_logs` owns `auditReferenceRegistry`, the registry this module pushes
  // its own "what is this audit row called, and where does the admin app show
  // it?" resolver into (feature 075, D-87). The registry is ungated and its
  // owner is non-deactivatable, so the declaration buys install and migration
  // order rather than a flip-time refusal.
  dependencies: ['audit_logs', 'auth', 'organizations'],
  /**
   * D-96 — `mfaLoginPort`, the second factor on customer login.
   *
   * Real to the container, binding on no operator. `mfa` declares this module
   * in its own `dependencies`, so the ordinary declaration closes a cycle; and
   * an acknowledged edge would put customer login among the dependents that
   * refuse the flip, making a client security policy permanently unswitchable.
   */
  nonBindingDependencies: [
    {
      moduleId: 'mfa',
      name: 'mfaLoginPort',
      kind: 'degrades-without',
      whenAbsent:
        'Customer sign-in stops asking for a second factor and offers no Google/Microsoft ' +
        'button. An account created by social sign-in has no known password: its route in is ' +
        '"forgot password".',
      reason:
        'CustomerAuthService verifies the password first and then asks the second factor what ' +
        'to do. With `mfa` absent it asks nobody: `backend.ts` probes ' +
        '`effectiveState.isPresent("mfa")` and passes `undefined`, which selects the ' +
        'password-only branch feature 042 FR-033 requires and this service has always had. ' +
        'Nothing catches `ModuleDisabledError` — the decision is taken before the port is ' +
        'resolved. Org-level TOTP enforcement is `mfa`\'s own policy and goes with it. One ' +
        'edge is not repaired by the degrade and the operator has to know it: an account this ' +
        'module auto-created from a Google/Microsoft sign-in holds a random password nobody ' +
        'was ever told, so with the buttons gone its only route back is a password reset, ' +
        'keyed on the e-mail the provider verified.',
    },
    {
      moduleId: 'mfa',
      name: 'mfaEnrolmentStatePort',
      kind: 'degrades-without',
      whenAbsent:
        'Reads "no second factor" for every customer — admin customer detail, both ' +
        'organisation member panels, and the buyer\'s own account page. True while MFA is off; ' +
        'not a claim that nobody is enrolled.',
      reason:
        '`twoFactorEnabled` on `CustomerAccountRecord` is the live `mfa` enrolment, read in ' +
        'one batch through `mfaEnrolmentStatePort`. It was ' +
        '`Boolean(account.twoFactorConfirmedAt)` until 2026-08-28, and that column\'s only ' +
        'non-null writer was the superseded TOTP path deleted on 2026-08-25 — so GET ' +
        '/api/v1/me/customer told a buyer who had enrolled an hour earlier that their own ' +
        'account was unprotected. Non-binding for the reason the login edge beside it is: ' +
        '`mfa` declares this module in its own `dependencies`, so an ordinary declaration ' +
        'closes a cycle, and an acknowledged edge would make a client security policy ' +
        'unswitchable. The degrade is taken by **not resolving** — `backend.ts` probes ' +
        'presence first and answers an empty set — so nothing catches `ModuleDisabledError`.',
    },
  ],
  // Feature 074 (Constitution XVII), test C1 — reachability. The flag used to
  // rest on four port edges another module declares; ruling 2 withdraws that
  // authority, so the ground is now this module's own and it is the stronger
  // one anyway. This module owns the identity a buyer signs in as. Switch it
  // off and no customer-side path exists at all — no registration, no login,
  // no cart belonging to anyone, no order placed by anyone — which is the
  // reachability test rather than a reduction in capability.
  activation: {
    nonDeactivatable: true,
    reason:
      'The identity a buyer signs in as; no customer-side path — registration, login, cart, ' +
      'order or account — exists without it.',
  },
  /**
   * The seven error codes this module owns — D-129's remaining sweep, MR 4
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * D-186 in `specs/080-f4-real-scope/rulings.md`).
   *
   * This module declared none until now. All seven were `_i18n`'s, not because
   * anybody judged them the platform's but because the deleted prefix chain had
   * no rule for them and its last line was `return 'core'`.
   *
   * **Four of them are the `CUSTOMER_*` record family, and D-186 §1 is what put
   * them here rather than in `customers`.** The two modules are a data/behaviour
   * pair — this one holds the `CustomerAccount` row, `customers` holds the
   * lifecycle logic and the admin and storefront surfaces on top of it — and the
   * ruling splits the family by noun: the customer **record** is this module's,
   * `CustomerAddress` is `customers`', which is why `CUSTOMER_ADDRESS_NOT_FOUND`
   * went there in MR 3 and these four come here.
   *
   * **Two of the four are codes `customers` raises and this module owns**, and
   * that is the shape a reviewer will stop on. `CUSTOMER_NOT_FOUND` is raised
   * six times, four of them in `customers`
   * (`routes.self.ts`, `customer-deletion-service.ts`,
   * `customer-moderation-service.ts`, `customer-org-assignment-service.ts`) and
   * two here; `CUSTOMER_ALREADY_DELETED` is raised once in each. In every one of
   * those `customers` sites the module is resolving or re-checking a
   * `CustomerAccount` before doing its own work — it is the caller, and the row
   * whose absence or deleted state it is reporting is this module's. D-95.2
   * already ruled that shape for `INVOICE_NOT_READY`: the owner of a noun is not
   * required to be the module that throws about it, and D-186 §1 accepts this
   * consequence in terms.
   *
   * `CUSTOMER_NOT_DELETED` and `CUSTOMER_RESTORE_WINDOW_ELAPSED` are the same
   * noun read the other way round, and both are raised only here, from
   * `customer-account-lifecycle-ports.ts` — the soft-delete window is a property
   * of the account row and of nothing on top of it.
   *
   * **`ACCOUNT_BLOCKED`** names the account itself: `customer-auth-service.ts`
   * refuses a sign-in for a `CustomerAccount` whose status is blocked, which is
   * this module's own column and its own gate.
   *
   * **`CANNOT_DEMOTE_LAST_ADMIN` and `CANNOT_REMOVE_LAST_ADMIN`** read like
   * `organizations` and are not. The invariant they protect is counted over
   * `CustomerAccount.role` inside one organization, in this module's
   * `role-service.ts`, which is the only thing in the tree that raises either;
   * `organizations` owns the organization, this module owns its membership.
   *
   * **The two of them arrive with a sentence, and it is a new one.** Both
   * carried a placeholder in `_i18n`'s bundle — `"Cannot Demote Last Admin."` /
   * `"Błąd: cannot demote last admin."` — which D-186 §2 deletes rather than
   * moves, because a placeholder in a module's own bundle reads as that module's
   * answer and every instrument then counts the code as translated.
   * `d129-sweep.md` §5.4 keeps writing the prose available and calls it the
   * better outcome; here the reader is an organization administrator managing
   * their own company's users and the refusal is one sentence to explain, so it
   * is written. The other five had no sentence in either language before the
   * move and have none after: they were entries in
   * `check-error-translations.ts`'s `UNTRANSLATED_ERROR_CODES` under `_i18n` and
   * are entries under `customer_accounts`, which changes who owes the sentence
   * and not whether one is owed.
   *
   * **No `tokens`, derived from the raise sites rather than from the bundle**
   * (runbook §5). All eleven raise sites were read by balancing the parentheses
   * of the call itself rather than by a line-wise grep, and not one passes a
   * `details` object at all — so `refusalToken` has nothing to read and a
   * sentence written at `errors.<CODE>` is the key the envelope actually looks
   * up. That mattered enough to measure: where a code always carries a
   * `details.code`, `localizeErrorEnvelope` resolves `errors.<CODE>.<token>`
   * with no fallback to the base key, and a base sentence would be dead text
   * that P1 nevertheless counts as translated.
   */
  errorCodes: [
    { code: 'ACCOUNT_BLOCKED' },
    { code: 'CANNOT_DEMOTE_LAST_ADMIN' },
    { code: 'CANNOT_REMOVE_LAST_ADMIN' },
    { code: 'CUSTOMER_ALREADY_DELETED' },
    { code: 'CUSTOMER_NOT_DELETED' },
    { code: 'CUSTOMER_NOT_FOUND' },
    { code: 'CUSTOMER_RESTORE_WINDOW_ELAPSED' },
  ],
  i18n: { bundlesDir: 'i18n' },
  // Feature 076 (D-79) — the customer-group admin surface came here with the
  // entity, and its gate came with a correction. `price_lists` served these
  // three routes under `catalog:write`, which asks a pricing question about a
  // customer's segmentation; these two codes ask the right one. Granting them
  // is a deliberate act on each admin role — nothing inherits from
  // `catalog:write`.
  permissions: [
    { code: 'customer_groups:read', label: 'View customer groups' },
    { code: 'customer_groups:write', label: 'Manage customer groups' },
  ],
  actions: [
    {
      id: 'open-customer-groups',
      labelKey: 'actions.openCustomerGroups.label',
      descriptionKey: 'actions.openCustomerGroups.description',
      icon: 'Users',
      targetRoute: '/customer-groups',
      requiredPermission: 'customer_groups:read',
      keywords: ['customer', 'group', 'segment', 'klient', 'grupa', 'segment'],
      weight: 140,
    },
  ],
});
