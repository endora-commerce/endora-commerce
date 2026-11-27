import { defineColumnExtension } from '@endora-commerce/platform/kernel';

/**
 * One column this overlay module adds to `organizations`
 * (`specs/190-overlay-full-modules/` FR-065 – FR-066, #1853): when the
 * organization's last note was written.
 *
 * It is here so an overlay declarer has a real subject in this repository — the
 * generated step at the head of this module's migration block, ledger rows under
 * its id, the column kept `orphaned` by its hard uninstall
 * (`test/integration/_lifecycle/overlay-tables.integration.test.ts`) and the
 * `column-extension` divergence entry — not because anything reads it. Nullable,
 * with no default and no admin exposure, so it changes nothing an organization
 * read or write sees.
 */
export const overlayNotesFixtureOrganizationColumns = defineColumnExtension({
  host: 'organizations',
  module: 'overlay_notes_fixture',
  columns: {
    lastNoteAt: { type: 'timestamptz', nullable: true },
  },
});
