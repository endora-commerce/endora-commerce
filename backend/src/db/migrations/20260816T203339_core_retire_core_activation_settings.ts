import { Migration } from '@mikro-orm/migrations';

/**
 * Feature 074, FR-010a — delete the six activation Setting rows whose modules
 * became core.
 *
 * `settings`, `sales_channels`, `carts`, `taxes`, `price_lists` and
 * `audit_logs` each declared `<module>.enabled` and pointed
 * `activation.settingCode` at it. Phase 1 replaces those controls with
 * `nonDeactivatable`, which resolves `settingCode` to `null` — and that is
 * exactly what makes the leftover rows harmful rather than merely stale:
 * `SettingsAdminService.classify()` marks a row activation-protected only while
 * `activationControlOwner(code)` still matches its owner, so the moment the
 * declaration goes the row falls through to `{ editable: true,
 * activationControl: false }`. A core module is always present, so `editable`
 * is `true`. The result would be a live boolean on the Settings screen,
 * labelled as the module's enablement, that changes nothing — the
 * present-but-ignored shape Principle XVII prohibits, and strictly worse than
 * the locked control it replaced.
 *
 * Dropping the manifest declaration does not remove the row.
 * `kernel/settings/manifest-reconciler.ts` detects rows a module no longer
 * declares and reports them as `orphanSettings` **for warning purposes only**,
 * deliberately, so a boot process never destroys an operator's stored values.
 * Every existing database therefore keeps all six rows forever unless a
 * migration removes them, which is what this one does.
 *
 * It is filed under `core` rather than as six per-module migrations because the
 * `settings` table is kernel-owned (see `*_core_settings_*.ts` in this
 * directory) and a module migration must not write another owner's table.
 *
 * No schema change. `setting_values` and `setting_sales_channels` both
 * reference `settings (id)` with `on delete cascade`, so the per-channel
 * overrides and channel scopes of these rows go with them.
 */
export class Migration20260816T203339CoreRetireCoreActivationSettings extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      delete from "settings"
      where "code" in (
        'settings.enabled',
        'sales_channels.enabled',
        'carts.enabled',
        'taxes.enabled',
        'price_lists.enabled',
        'audit_logs.enabled'
      );
    `);
  }

  override async down(): Promise<void> {
    // Deliberately empty, and it is not an oversight. The rows are not schema:
    // the boot reconciler creates a declared Setting from its manifest, so the
    // way back is to restore the six `activation: { settingCode, default }`
    // declarations and let the reconciler re-create the rows on the next start.
    // Re-inserting them here would need a group id, an owner and a default that
    // this migration would have to invent, and would produce rows no manifest
    // declares — the orphan state the `up` exists to clear.
  }
}
