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
  dependencies: [],
});
