import { defineModuleManifest } from '@endora-commerce/contracts';

/**
 * Email module — manifest backfill (Module Lifecycle, feature 018).
 *
 * Predates the lifecycle system; this manifest is the static record
 * required so the module participates in the registry. No install /
 * uninstall hook today — the module's schema is owned by earlier
 * platform-wide migrations.
 */
export const manifest = defineModuleManifest({
  id: 'email',
  name: 'Email',
  description:
    'Mailer abstraction with Console / SMTP drivers for transactional email.',
  version: '1.0.0',
  dependencies: [],
  // Feature 074 (Constitution XVII), test C3 — platform primitive. This module
  // had no activation declaration at all, which resolved as "always activated"
  // and read as an omission. It is the outbound transport every message leaves
  // through: a business configures a driver — Console, SMTP — it does not
  // switch the transport off, and the per-message choice belongs to
  // `transactional_emails`, which offers it per email.
  activation: {
    nonDeactivatable: true,
    reason:
      'The outbound transport every message leaves through. A business configures a driver; ' +
      'it does not switch the transport off.',
  },
});
