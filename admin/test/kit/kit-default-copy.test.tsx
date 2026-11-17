import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { AssetFieldPicker, FileDropzone } from '@endora-commerce/admin-kit/components';
import { MultiSelect } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';

/**
 * Issue #1433 (DS-16): the kit's primitives drew their own words as English
 * literals — `'Search…'`, `'No matches'`, `'Choose'`, the drop-zone prompt — so
 * a Polish operator read English wherever a caller passed nothing. Each now
 * takes its default out of the `core` bundle, and a caller's prop still wins.
 */
describe('kit primitives render their own copy in the operator\'s language', () => {
  const pl = shippedCoreBundle('pl');
  const core = pl.core!;
  const renderPl = (ui: Parameters<typeof renderWithI18n>[0]): ReturnType<typeof renderWithI18n> =>
    renderWithI18n(ui, pl, { language: 'pl' });

  it('MultiSelect: the search box and the no-match line', () => {
    renderPl(
      <MultiSelect
        options={[{ value: 'a', label: 'Śruby' }]}
        selected={[]}
        onChange={vi.fn()}
        placeholder="Kategorie"
        searchable
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Kategorie' }));
    const search = screen.getByRole('textbox', { name: core['common.multiSelect.searchLabel']! });
    expect(search.getAttribute('placeholder')).toBe(core['common.multiSelect.search']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText(core['common.multiSelect.noMatches']!)).toBeTruthy();
  });

  it('FileDropzone: the prompt', () => {
    renderPl(<FileDropzone onFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: core['fileDropzone.prompt']! })).toBeTruthy();
  });

  it('AssetFieldPicker: the empty field and its button', () => {
    renderPl(<AssetFieldPicker value="" onChange={vi.fn()} />);
    const field = screen.getByRole('textbox', { name: core['assetField.label']! });
    expect(field.getAttribute('placeholder')).toBe(core['assetField.empty']);
    expect(screen.getByRole('button', { name: core['assetField.choose']! })).toBeTruthy();
  });

  it('a caller\'s own wording still wins', () => {
    renderPl(<AssetFieldPicker value="" onChange={vi.fn()} chooseLabel="Wybierz logo" />);
    expect(screen.getByRole('button', { name: 'Wybierz logo' })).toBeTruthy();
  });

  it('ships every key it uses in both languages, and translates them', () => {
    const en = shippedCoreBundle('en').core!;
    const keys = Object.keys(en).filter((key) =>
      /^(ruleBuilder|common\.multiSelect|fileDropzone|assetField|cmsPicker|organizationPicker)\./.test(key),
    );
    expect(keys.length).toBeGreaterThan(30);
    for (const key of keys) {
      expect(core[key], key).toBeTruthy();
    }
    // Every Polish sentence differs from its English one, except a word the two
    // languages share.
    const shared = new Set(['ruleBuilder.operator.label']);
    for (const key of keys.filter((k) => !shared.has(k))) {
      expect(core[key], key).not.toBe(en[key]);
    }
  });
});
