import { defineModuleManifest, type ModuleCliCommand } from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';

/**
 * Audit Logs module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 *
 * Feature 072 (T084) — the module owns its routes now, so it needs the two
 * things a converted module needs: the dependency it actually resolves, and an
 * activation control.
 *
 * `admin_users` is deliberately **not** a dependency. This module used to be
 * mounted from inside that one, but the only thing it still wants from there is
 * turning an actor id into a name, and that is an optional enrichment: the
 * audit log degrades to raw ids rather than refusing. A `dependencies` entry
 * would make the lifecycle refuse to disable `admin_users` while the audit log
 * is on, which is backwards — the record has to outlive the directory.
 */
export const manifest = defineModuleManifest({
  id: 'audit_logs',
  name: 'Audit Logs',
  description:
    'Append-only audit log for sensitive admin and customer actions.',
  version: '1.0.0',
  // `auth` owns the `requireAdmin` port both route files are gated by.
  dependencies: ['auth'],
  settings: {
    moduleCode: 'audit_logs',
    groups: [{ code: 'audit_logs', name: 'Audit log' }],
    // The group is kept as a reservation while the module ships no settings of
    // its own: `audit_logs.enabled` was the only one, and it went with the
    // control it backed (feature 074). Dropping the group as well would only
    // turn it into an orphan the boot reconciler warns about at every start.
    settings: [],
  },
  /**
   * This module's first i18n bundle and its first command-palette action —
   * feature 091, Phase 4, batch four.
   *
   * The bundle exists because the sidebar entry moved into this package with
   * the screen and a nav declaration's `labelKey` is **module-relative** (R8):
   * `appShell.nav.auditLog` was one of `_i18n`'s and is `nav.auditLog.label`
   * here. It is a **flat** `{"a.b.c": "text"}` map at the **package root**, for
   * the reason `admin_roles`' bundle records: `manifest-locations.ts` resolves
   * a packaged module's `manifestPath` to its `package.json`, so `dirname` is
   * the package directory, and a nested object fails
   * `TranslationBundleEntriesSchema` while the boot reconciler only logs and
   * skips it.
   *
   * The action pays one of the fifteen entries `specs/deferred-defects.md`
   * still holds under *"Sixteen modules with an admin screen declare no
   * command-palette action"*. Principle XVI is explicit that a sidebar entry is
   * not enough, and the drain is what makes the debt payable: Phase 2 item 6's
   * off-state test asserts the palette entry's absence while the module is off,
   * and until there was one there was nothing to assert. `audit_log:read` is
   * the code `GET /api/v1/admin/audit-log` enforces, which is what
   * `check:action-route-permissions` holds this declaration to.
   */
  i18n: { bundlesDir: 'i18n' },
  docs: { dir: 'docs' },
  actions: [
    {
      id: 'open-audit-log',
      labelKey: 'actions.openAuditLog.label',
      descriptionKey: 'actions.openAuditLog.description',
      icon: 'ListChecks',
      targetRoute: '/audit-log',
      requiredPermission: 'audit_log:read',
      keywords: ['audit', 'audyt', 'dziennik', 'log', 'history', 'historia', 'trail'],
      weight: 600,
    },
  ],
  // Feature 074 (Constitution XVII), test C3 — platform primitive, and one of
  // the escalation answers. D-32 moved the *writing* of the trail into the
  // kernel, so what this module owns is the viewer — and sight of who did what
  // is part of trusting the platform rather than a capability a business
  // declines. Switching it off is a governance regression, not a business
  // choice, so there is no independent decision underneath the control.
  //
  // `audit_logs.enabled` goes with it. The existing rows are removed by a core
  // data migration (feature 074, FR-010a).
  activation: {
    nonDeactivatable: true,
    reason:
      'Sight of the write trail. The writing is the platform\'s own, so this module owns the ' +
      'viewer, and hiding who did what is a governance regression.',
  },
});

/**
 * The operator command this module declares — feature 080, T042b / D-160.9.
 *
 * It was `scripts/read.ts`, which owned its own `initOrm()`. Only the plumbing
 * moved: the `EntityManager` comes off the composition now, and the reach is
 * still one read of the kernel's `AuditLogEntry`. The conditions D-102 attached
 * to this tool are unchanged and are restated at the top of `cli/read.ts`.
 */
export const cliCommands: ReadonlyArray<ModuleCliCommand<ModuleContext>> = [
  {
    name: 'read',
    summary: 'Read the audit trail from the host, without writing to it.',
    // The cost is in the **first paragraph**, not a footnote, and it is declared
    // here rather than printed from the body so the host can answer `--help`
    // before it composes. That is D-102's condition: the credential is host
    // access, not a working connection string, so the tool has to be able to say
    // what it does before it can do it.
    help: `usage: audit_logs read [--actor=<uuid>] [--action=<code>] [--object-type=<type>]
                       [--object-id=<id>] [--limit=<n>] [--json]

This tool reads the audit log without writing to it. A read performed here leaves
no record in the trail; the credential is access to this host and its database,
which already grants the same read through \`psql\`.

Filters — the same ones the admin HTTP route takes:
  --actor=<uuid>         the admin user who acted
  --action=<code>        e.g. product.update, module.disabled
  --object-type=<type>   e.g. product, module
  --object-id=<id>       the affected row
  --limit=<n>            1..500, default 100
  --json                 the rows as JSON instead of a table`,
    run: async (context) => (await import('./backend/cli/read.js')).read(context),
  },
];
