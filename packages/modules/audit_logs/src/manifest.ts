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
    summary: 'Read the audit trail from the host, without writing to it (D-102).',
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
