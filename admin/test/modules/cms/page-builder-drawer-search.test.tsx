import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { PageBuilderDrawer } from '../../../src/modules/cms/components/PageBuilderDrawer';

/**
 * Issue #236 — the page-builder drawer shipped its own copy of the folding
 * rule, and the copy is the one that looked right.
 *
 * The drawer's search filters Puck's component list. It folded with a bare
 * `normalize('NFD').replace(/\p{Diacritic}/gu, '')`, which cannot touch `ł`:
 * U+0142 is a single codepoint with no decomposition, so NFD leaves it exactly
 * where it was. Every shipped Polish block label carrying one was therefore
 * unreachable by the spelling a Polish operator actually types — `naglowek`
 * found nothing while `Nagłówek` sat two rows down (Postel's Law: the surface
 * whose whole job is to shorten the path to a block refused the input it was
 * most likely to be given).
 *
 * The labels below are verbatim from `backend/src/modules/cms/i18n/pl.json`,
 * which is what `applyPageBuilderTranslations` puts on the drawer rows in a
 * Polish admin — a made-up fixture would prove the fold and not the defect.
 */

/** One drawer row in the shape Puck renders it: the ASCII component name in
 *  `data-testid`, the translated label as the text the operator reads. */
function drawerItem(name: string, label: string): ReactElement {
  return (
    <div key={name} data-puck-drawer-item data-testid={`drawer-item:${name}`}>
      {label}
    </div>
  );
}

function renderDrawer(): {
  type: (query: string) => void;
  visibleLabels: () => string[];
} {
  const { container } = render(
    <PageBuilderDrawer searchPlaceholder="Search blocks" emptyLabel="No blocks match">
      {[
        // `Nagłówek` and `Pasek ogłoszeń` are the two shipped labels with a
        // stroked `ł`; `Odstęp / Separator` carries an ordinary combining
        // diacritic, so it guards against a fix that folds only `ł`.
        drawerItem('Heading', 'Nagłówek'),
        drawerItem('AnnouncementBar', 'Pasek ogłoszeń'),
        drawerItem('Spacer', 'Odstęp / Separator'),
        drawerItem('Image', 'Obraz'),
      ]}
    </PageBuilderDrawer>,
  );

  const input = container.querySelector('input[type="search"]') as HTMLInputElement;
  return {
    type: (query: string): void => {
      fireEvent.change(input, { target: { value: query } });
    },
    visibleLabels: (): string[] =>
      [...container.querySelectorAll<HTMLElement>('[data-puck-drawer-item]')]
        .filter((el) => el.style.display !== 'none')
        .map((el) => (el.textContent ?? '').trim()),
  };
}

describe('PageBuilderDrawer search (issue #236)', () => {
  it('finds a block whose label carries a stroked ł, typed without it', () => {
    const drawer = renderDrawer();
    drawer.type('naglowek');
    expect(drawer.visibleLabels()).toEqual(['Nagłówek']);
  });

  it('finds the same block typed with the diacritic', () => {
    // The other half of "fold both sides": folding only the haystack would
    // drop this one.
    const drawer = renderDrawer();
    drawer.type('Nagłówek');
    expect(drawer.visibleLabels()).toEqual(['Nagłówek']);
  });

  it('still folds ordinary combining diacritics', () => {
    const drawer = renderDrawer();
    drawer.type('odstep');
    expect(drawer.visibleLabels()).toEqual(['Odstęp / Separator']);
  });

  it('matches the ASCII component name as well as the translated label', () => {
    const drawer = renderDrawer();
    drawer.type('announcement');
    expect(drawer.visibleLabels()).toEqual(['Pasek ogłoszeń']);
  });

  it('ignores whitespace around the query', () => {
    // Postel's Law. A leading space is one keystroke of noise; before the
    // shared helper absorbed it, it emptied the list with no explanation.
    const drawer = renderDrawer();
    drawer.type('  naglowek ');
    expect(drawer.visibleLabels()).toEqual(['Nagłówek']);
  });

  it('shows every block for an empty query', () => {
    const drawer = renderDrawer();
    drawer.type('obraz');
    drawer.type('');
    expect(drawer.visibleLabels()).toHaveLength(4);
  });

  it('shows every block for a whitespace-only query', () => {
    const drawer = renderDrawer();
    drawer.type('   ');
    expect(drawer.visibleLabels()).toHaveLength(4);
  });

  it('still filters — an unrelated query matches no block', () => {
    const drawer = renderDrawer();
    drawer.type('xyzzy');
    expect(drawer.visibleLabels()).toEqual([]);
  });
});
