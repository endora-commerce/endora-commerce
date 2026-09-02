import { defineModuleManifest, type ModuleUninstallHook } from '@endora-commerce/contracts';
import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Custom Fields module — manifest (feature 055).
 *
 * Owns the entity-agnostic custom-field definition/option registry and the
 * value-validation service consumed by host modules. Platform-global; values
 * live on host rows and inherit the host's tenant scope (Principle XI).
 * Definition/option mutations run through the Command Bus (Principle XIII).
 */
export const manifest = defineModuleManifest({
  id: 'custom_fields',
  name: 'Custom Fields',
  description: 'Entity-agnostic runtime custom fields for core entities.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port the admin routes are gated by.
  dependencies: ['auth'],
  i18n: { bundlesDir: 'i18n' },
  /**
   * The `CUSTOM_FIELD_*` family — D-129's remaining sweep, Tier A
   * (`specs/090-module-owned-error-codes/d129-sweep.md` §5.2, Appendix A;
   * MR 3).
   *
   * All five were declared by `_i18n` until this merge request, not because
   * anybody judged them the platform's but because the deleted prefix chain
   * had no rule for them and its last line was `return 'core'`. **D-121 T1
   * puts them here**: the noun in every one of them is a custom field — its
   * definition, its key, its option set or a value being written against it —
   * and this module owns the definition registry, the option rows and the
   * validation service that decides all five refusals.
   *
   * **`CUSTOM_FIELD_VALUE_INVALID` is the one a raise-site count gets wrong,
   * and it is the reason the family is declared as a family.** Five modules
   * raise it — `catalog`, `customers`, `orders`, `organizations` and
   * `quote_requests` — and not one of them decides it: each calls this
   * module's validation seam over its own host rows and re-answers the
   * failures it gets back. The judgement, the rules it is made against and the
   * definitions those rules come from are all here, so T1 puts the code here
   * and T2's "sole thrower" question never arises. `d129-sweep.md` §2.3 flags
   * it by name for exactly that reason. `CUSTOM_FIELD_HOST_MANAGED` is the
   * mirror image: it is raised only here, and it refuses a definition whose
   * entity type another module manages — the marker is read
   * entity-agnostically, so the refusal is about this registry rather than
   * about whichever module happens to be named in it.
   *
   * **No sentence moves with them.** None of the five has a sentence in either
   * language anywhere in the tree; all five were already on
   * `UNTRANSLATED_ERROR_CODES` under `_i18n` and move to this module's group
   * there, so the bundle this module already ships gains no key.
   *
   * **`tokens` is derived from the raise sites, not from the bundle**
   * (runbook §5), and there are none to declare. `CUSTOM_FIELD_VALUE_INVALID`
   * is the one that carries `details`, and it is the Zod-shaped
   * `{ path, issue }[]` array, which `refusalToken` reads as no token at all
   * (`packages/platform/src/http/error-envelope.ts`); the other four are bare
   * `HttpError(status, code, message)`.
   */
  errorCodes: [
    { code: 'CUSTOM_FIELD_DEFINITION_INVALID' },
    { code: 'CUSTOM_FIELD_HOST_MANAGED' },
    { code: 'CUSTOM_FIELD_KEY_CONFLICT' },
    { code: 'CUSTOM_FIELD_NOT_FOUND' },
    { code: 'CUSTOM_FIELD_VALUE_INVALID' },
  ],
  permissions: [
    { code: 'custom_fields:read', label: 'View custom fields' },
    { code: 'custom_fields:write', label: 'Manage custom fields (definitions and options)' },
  ],
  actions: [
    {
      id: 'open-custom-fields',
      labelKey: 'actions.openCustomFields.label',
      descriptionKey: 'actions.openCustomFields.description',
      icon: 'Layers',
      targetRoute: '/custom-fields',
      requiredPermission: 'custom_fields:read',
      keywords: ['custom fields', 'attributes', 'pola', 'niestandardowe'],
      weight: 240,
    },
  ],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. The flag
  // used to rest on `organizations` declaring this module; ruling 2 withdraws
  // a dependent's authority to impose the lock, so the ground is now this
  // module's own. It is Principle XIV's extensibility mechanism: the answer
  // the platform gives to "add a field" instead of a bespoke column. Switching
  // it off does not remove a capability a client chose, it makes the values
  // already stored against every host entity unreachable.
  activation: {
    nonDeactivatable: true,
    reason:
      'The platform\'s extensibility mechanism; the custom values already stored against ' +
      'every host entity become unreachable without it.',
  },
});

/**
 * Hard-uninstall cleanup (feature 055). A soft uninstall keeps definitions so a
 * re-install restores them; a hard uninstall drops all definitions (options
 * cascade via FK). Host `custom_field_values` columns are owned by their host
 * modules and removed with them, so nothing dangles either way.
 */
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;
  const em = ctx.em as EntityManager;
  await em
    .getConnection()
    .execute('truncate table "custom_field_options", "custom_field_definitions" cascade');
  ctx.log.info('custom_fields: removed all custom-field definitions on hard uninstall');
};
