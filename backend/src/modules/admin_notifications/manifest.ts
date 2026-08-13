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
});
