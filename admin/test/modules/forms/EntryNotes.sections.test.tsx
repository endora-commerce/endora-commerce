import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n, passthroughBundle } from '../../helpers/render-with-i18n';
import { EntryNotes } from '../../../../packages/modules/forms/src/admin/components/EntryNotes';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03) — an entry's notes are rows divided
 * by a rule inside the notes card, not a bordered box per note: a frame inside
 * a card reads as a separate object (Common Region).
 */

const BUNDLE = passthroughBundle('forms', ['entry.notes', 'entry.noNotes', 'entry.noteAuthor', 'entry.noteLabel', 'entry.addNote']);

const NOTES = [
  { id: 'n1', body: 'Called back', createdAt: '2026-11-02T10:00:00Z', authorAdminUserId: null },
  { id: 'n2', body: 'Sent the offer', createdAt: '2026-11-03T10:00:00Z', authorAdminUserId: null },
];

describe('EntryNotes — notes as divided rows (DS-03)', () => {
  it('lists the notes in one divided list with no bordered box per note', () => {
    renderWithI18n(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: () => {} }}>
        <EntryNotes notes={NOTES} canWrite={false} onAdd={vi.fn()} />
      </AppLanguageContext.Provider>,
      BUNDLE,
    );
    const list = screen.getByText('Called back').closest('ol')!;
    expect(list.className).toMatch(/\bdivide-y\b/);
    const items = [...list.children];
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.className).not.toMatch(/(^|\s)border(\s|$)|\brounded/);
  });
});
