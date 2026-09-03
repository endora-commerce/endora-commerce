import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Admin Roles module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'admin_roles',
  name: 'Admin Roles',
  description:
    'Admin RBAC — roles, permissions, and policy enforcement for admin sessions.',
  version: '1.0.0',
  dependencies: [],
  /**
   * Feature 075, Phase C — the two reads of the `AdminUser` row became
   * `adminUserReadPort`, and `admin_users` declares this module, so declaring
   * it back in `dependencies` closes a cycle that `module-graph.test.ts` and the
   * composer generator both refuse. The mutual shape
   * `acknowledgedDependencies` exists for, and the same one `auth` records
   * against `customer_accounts`.
   *
   * With `admin_users` absent the seam fails closed: the port is gated, so the
   * permission check refuses rather than answering from an admin row nobody
   * read. That is the same answer every `requireAdmin` route on such a
   * deployment gives, and it is why the edge is safe to withhold from
   * `dependencies` — not a claim about which flips the orchestrator refuses,
   * which is derived from the manifests on every run and copied here by nobody
   * (D-100).
   */
  acknowledgedDependencies: [
    {
      moduleId: 'admin_users',
      port: 'adminUserReadPort',
      reason:
        'Answering "may this admin do this?" starts from the admin row — its role assignment ' +
        'and whether it is still live — and that row belongs to admin_users, which declares ' +
        'this module for the catalogue it reads back. Declaring it here closes a cycle. With ' +
        'admin_users absent the seam fails closed: the port is gated, so the permission check ' +
        'refuses rather than answering from an admin row nobody read.',
    },
  ],
  // Feature 072/073 (Constitution XVII) — `admin_roles` answers "may this admin
  // do this?" for every guarded route in the platform. Switched off, the
  // question has no answer and `requireAdmin` has nothing to check against, so
  // the correct behaviour would be to refuse every admin request — which is not
  // a deployment anyone wants and not a state the orchestrator will produce.
  activation: {
    nonDeactivatable: true,
    reason:
      'Answers the permission check behind every guarded admin route; switched off, no admin ' +
      'request could be authorised at all.',
  },
  /**
   * This module's first i18n bundle — D-129's remaining sweep, MR 6.
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
   * This module's first command-palette action — feature 091, Phase 4, batch
   * four — and it points at a route **`admin_users` declares**.
   *
   * That is the same split `src/admin/index.ts` makes for the sidebar entry and
   * it is made for the same reason: the roles editor is served by
   * `GET /api/v1/admin/admin-roles` in `admin_users`, so that module owns the
   * route, while the advertisement of the roles capability is this module's.
   * `check:action-route-permissions` resolves a `targetRoute` by path and not
   * by owner, so it holds this declaration to the gate `/admin-roles` really
   * enforces — `admin_users:manage`, which is why the code below is not an
   * `admin_roles:*` one. This module registers no admin route and declares no
   * permission of its own.
   *
   * It pays one of the fifteen entries `specs/deferred-defects.md` still holds
   * under *"Sixteen modules with an admin screen declare no command-palette
   * action"*, and the two labels live in this module's own bundle above.
   */
  actions: [
    {
      id: 'open-admin-roles',
      labelKey: 'actions.openAdminRoles.label',
      descriptionKey: 'actions.openAdminRoles.description',
      icon: 'ShieldCheck',
      targetRoute: '/admin-roles',
      requiredPermission: 'admin_users:manage',
      keywords: ['roles', 'role', 'rbac', 'permissions', 'uprawnienia', 'access'],
      weight: 300,
    },
  ],
  /**
   * The three `ADMIN_ROLE_*` codes — D-129's remaining sweep, **Tier C**
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A; MR 6).
   *
   * They were declared by `_i18n` until this merge request, not because anybody
   * judged them the platform's but because the deleted prefix chain had no rule
   * for them and its last line was `return 'core'`. **D-121 T1 puts all three
   * here**: the noun is an admin role, this module's own `admin_roles` row, and
   * every one of the four raise sites is in this module's
   * `services/admin-role-service.ts`. Noun and thrower agree, which is why the
   * sweep classes this batch by its *content* rather than by its judgement —
   * Tier C is the two modules where prose moves.
   *
   * **`ADMIN_ROLE_IN_USE` is the sweep's only multi-token sentence**, and the
   * one code in it where a wrong key is a wrong sentence rather than a missing
   * one. `tokens` is derived from the raise sites and not from the bundle
   * (runbook §5): both raises pass a `details.code` — `assigned` when live
   * admin accounts still hold the role, `assigned_to_deleted` when only
   * soft-deleted ones do — measured by balanced-paren extraction of each call's
   * own argument list, resolving `ERROR_CODES.<CODE>` and the bare literal
   * alike. The two populations are counted apart because the remedy differs,
   * which is issue #168; `test/unit/admin_roles/role-in-use-sentence.test.ts`
   * renders a real refusal against these keys.
   *
   * **The base key `errors.ADMIN_ROLE_IN_USE` is unreachable, and it is carried
   * anyway.** `localizeErrorEnvelope` composes `` `${target.key}.${token}` ``
   * whenever `details.code` is present and has **no** fall-back to the base key
   * (`packages/platform/src/http/error-envelope.ts`), so with both raise sites
   * tokened nothing in the tree renders that sentence. Deleting it is not free,
   * and the measurement is the reason it is still here: P1 asks its question at
   * `errors.<CODE>` and at no other key, so the bundle without the base pair
   * reports `ADMIN_ROLE_IN_USE → admin_roles (missing in: en, pl)` and exits 1
   * — for the best-translated code in the sweep. The two ways out are both
   * worse than one unreachable string. `UNTRANSLATED_ERROR_CODES` would be a
   * false entry: its own header defines an entry as a code with **no sentence
   * anywhere**, this code has four, and nothing could ever drain it. Widening
   * P1 to accept "every declared token answered" is the real repair, and it is
   * a change to a tree-wide instrument made by the merge request that benefits
   * from it — reported for the defect register instead, with the second half of
   * the same finding: three places in this repository document a fall-back to
   * `errors.<CODE>` that the envelope does not implement
   * (`packages/contracts/src/modules.ts`'s `errorCodeTokenRe` note,
   * `check-error-translations.ts`' `ERROR_KEY` note, and the test above).
   *
   * **The other two arrive with prose.** Both carried a placeholder in `_i18n`'s
   * bundle — `"Admin Role Code Taken."` / `"Błąd: admin role code taken."` and
   * the same for `ADMIN_ROLE_PROTECTED` — which D-186 §2 deletes rather than
   * carries, because in this module's own bundle it would read as this module's
   * answer. §5.4 keeps writing the prose available and is not a re-opening of
   * that ruling, and both are the case for taking it: the reader is an operator
   * on `/admin-roles`, saving a role or pressing Delete on a row, and each
   * refusal has one remedy to offer.
   *
   * `ADMIN_ROLE_PROTECTED` needed one more thing first. Its raise interpolates
   * the role's own code into the English message and passed no `details`, so a
   * translated sentence with no placeholder would have rendered cleanly and
   * lost the value — the shape !1181 measured at 85 codes tree-wide. The raise
   * now carries `details: { role: role.code }` and both sentences name it as
   * `{role}`. The member is `role` and not `code` deliberately: `details.code`
   * is the refusal **token**, so the obvious spelling would have sent the
   * envelope looking for `errors.ADMIN_ROLE_PROTECTED.<role code>` and rendered
   * nothing at all.
   */
  errorCodes: [
    { code: 'ADMIN_ROLE_CODE_TAKEN' },
    { code: 'ADMIN_ROLE_IN_USE', tokens: ['assigned', 'assigned_to_deleted'] },
    { code: 'ADMIN_ROLE_PROTECTED' },
  ],
});
