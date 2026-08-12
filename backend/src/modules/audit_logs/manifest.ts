import { defineModuleManifest } from '@b2b/contracts';

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
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'audit_logs.enabled',
        name: 'Audit log screens enabled',
        description:
          'Switches the audit log and recent-activity screens, and their API, on or off. Recording is unaffected: entries are written by the platform itself, not by this module, so the trail keeps accumulating while the screens are hidden and is all there when you switch them back on.',
        groupCode: 'audit_logs',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  activation: { settingCode: 'audit_logs.enabled', default: true },
});
