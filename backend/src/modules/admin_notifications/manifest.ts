import { defineModuleManifest } from '@b2b/contracts';

/**
 * Admin notifications — minimal "bell" surface.
 *
 * Introduced by feature 026 (Organizations) to deliver in-app
 * notifications to admins when a new Organization registers. The
 * module is intentionally generic so future features (low-stock
 * alerts, RFQ awaiting reply, etc.) can write into the same feed.
 *
 * The schema is owned by migration 048_admin_notifications_init.ts.
 */
export const manifest = defineModuleManifest({
  id: 'admin_notifications',
  name: 'Admin Notifications',
  description:
    'In-app notification feed surfaced in the admin top-nav bell. Generic so any module can write entries.',
  version: '1.0.0',
  // `auth` added with the conversion: the admin routes are gated by
  // `requireAdmin`, which `auth` owns.
  dependencies: ['admin_users', 'auth'],
  settings: {
    moduleCode: 'admin_notifications',
    groups: [{ code: 'admin_notifications', name: 'Admin notifications' }],
    settings: [
      {
        // Feature 073 — the operator's activation control. Platform-wide.
        code: 'admin_notifications.enabled',
        name: 'Admin notifications enabled',
        description:
          'Switches the admin notification centre on or off. While off nothing is recorded and the notification screens and their API are gone. Nothing is deleted — entries already recorded are preserved and reappear when you switch it back on.',
        groupCode: 'admin_notifications',
        valueType: 'boolean',
        defaultValue: true,
      },
    ],
  },
  activation: { settingCode: 'admin_notifications.enabled', default: true },
  // Feature 026 checklist — `routes.admin.ts` has gated the bell on this code
  // since 026 while no manifest declared it, so only a role holding `'*'` could
  // open the notification feed. The code keeps its historical spelling for the
  // same reason `audit_log:read` and `integrations:manage` keep theirs: it is
  // the string the route checks, and `module` is what puts the row under the
  // right heading on the role matrix.
  permissions: [
    { code: 'admin:read', module: 'admin_notifications', label: 'View admin notifications' },
  ],
});
