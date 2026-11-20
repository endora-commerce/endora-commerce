import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RecordTabs,
  TabPanel,
  Tabs,
  nextTabValue,
  tabId,
  tabPanelId,
  type TabItem,
} from '@endora-commerce/admin-kit/ui';
import { ModalDialog } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1445 (UX audit 2026-11-17, DS-12) — the kit's in-page `Tabs`, its
 * `TabPanel` and the record-section frame `RecordTabs`: the WAI-ARIA tabs
 * pattern (roving tabindex, ←/→/Home/End, `aria-controls` ↔ `aria-labelledby`),
 * counts with a spoken name, and the "no tabs inside tabs" rule.
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

type Section = 'details' | 'notes' | 'links' | 'archive';

const ITEMS: TabItem<Section>[] = [
  { value: 'details', label: 'Details' },
  { value: 'notes', label: 'Notes', count: 3 },
  { value: 'links', label: 'Links', count: 0 },
  { value: 'archive', label: 'Archive', disabled: true },
];

function Strip({
  initial = 'details',
  onChange,
  items = ITEMS,
}: {
  initial?: Section;
  onChange?: (value: Section) => void;
  items?: TabItem<Section>[];
}): ReactElement {
  const [value, setValue] = useState<Section>(initial);
  return (
    <>
      <Tabs
        items={items}
        value={value}
        onValueChange={(next): void => {
          onChange?.(next);
          setValue(next);
        }}
        idBase="rec"
        aria-label="Record sections"
      />
      <TabPanel idBase="rec" value={value}>
        <p>Panel of {value}</p>
      </TabPanel>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

describe('nextTabValue — the keyboard model as a pure function', () => {
  const items: TabItem[] = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B', disabled: true },
    { value: 'c', label: 'C' },
  ];

  it('moves right and left, skipping a disabled tab and wrapping round', () => {
    expect(nextTabValue(items, 'a', 'ArrowRight')).toBe('c');
    expect(nextTabValue(items, 'c', 'ArrowRight')).toBe('a');
    expect(nextTabValue(items, 'a', 'ArrowLeft')).toBe('c');
    expect(nextTabValue(items, 'c', 'ArrowLeft')).toBe('a');
  });

  it('jumps to the ends with Home and End', () => {
    expect(nextTabValue(items, 'c', 'Home')).toBe('a');
    expect(nextTabValue(items, 'a', 'End')).toBe('c');
  });

  it('ignores every other key, and a strip with nothing enabled', () => {
    expect(nextTabValue(items, 'a', 'Enter')).toBeNull();
    expect(nextTabValue(items, 'a', 'ArrowDown')).toBeNull();
    expect(nextTabValue([{ value: 'x', label: 'X', disabled: true }], 'x', 'ArrowRight')).toBeNull();
  });

  it('derives the ids from one base', () => {
    expect(tabId('product', 'media')).toBe('product-tab-media');
    expect(tabPanelId('product')).toBe('product-tabpanel');
  });
});

describe('Tabs and TabPanel — the WAI-ARIA tabs pattern', () => {
  it('links every tab to the one panel, and the panel back to the selected tab', () => {
    renderWithI18n(<Strip />, EN);
    const list = screen.getByRole('tablist', { name: 'Record sections' });
    expect(list).toHaveClass('b2b-tabs');
    const details = screen.getByRole('tab', { name: 'Details' });
    expect(details).toHaveAttribute('aria-selected', 'true');
    expect(details).toHaveClass('b2b-tab', 'is-active');
    expect(details.id).toBe('rec-tab-details');
    for (const tab of screen.getAllByRole('tab')) {
      expect(tab).toHaveAttribute('aria-controls', 'rec-tabpanel');
      expect(tab).toHaveAttribute('type', 'button');
    }
    const panel = screen.getByRole('tabpanel');
    expect(panel.id).toBe('rec-tabpanel');
    expect(panel).toHaveAttribute('aria-labelledby', 'rec-tab-details');
    expect(panel).toHaveAttribute('tabindex', '0');
  });

  it('keeps exactly one tab in the tab order — the selected one', async () => {
    renderWithI18n(
      <>
        <button type="button">before</button>
        <Strip />
      </>,
      EN,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs.filter((tab) => tab.tabIndex === 0).map((tab) => tab.id)).toEqual(['rec-tab-details']);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'before' }));
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    // The next Tab leaves the strip for the panel, not for the next tab.
    await user.tab();
    expect(screen.getByRole('tabpanel')).toHaveFocus();
  });

  it('moves focus and selection with the arrow keys, Home and End, skipping a disabled tab', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Strip onChange={onChange} />, EN);
    const user = userEvent.setup();
    screen.getByRole('tab', { name: 'Details' }).focus();

    await user.keyboard('{ArrowRight}');
    const notes = screen.getByRole('tab', { name: /^Notes/ });
    expect(notes).toHaveFocus();
    expect(notes).toHaveAttribute('aria-selected', 'true');
    expect(notes).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'rec-tab-notes');
    expect(screen.getByText('Panel of notes')).toBeInTheDocument();

    await user.keyboard('{End}');
    // Archive is disabled, so End lands on Links.
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();

    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['notes', 'links', 'details', 'links', 'details']);
  });

  it('selects on click, and a disabled tab cannot be selected', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Strip onChange={onChange} />, EN);
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Links' }));
    expect(screen.getByRole('tab', { name: 'Links' })).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('tab', { name: 'Archive' }));
    expect(screen.getByRole('tab', { name: 'Archive' })).toBeDisabled();
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['links']);
  });

  it('keeps a tab in the tab order when the value matches none', () => {
    renderWithI18n(
      <Tabs items={ITEMS} value={'gone' as Section} onValueChange={(): void => {}} idBase="rec" aria-label="Sections" />,
      EN,
    );
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it('draws a count as a badge and speaks what is counted; zero draws nothing', () => {
    renderWithI18n(<Strip />, EN);
    const notes = screen.getByRole('tab', { name: 'Notes, items: 3' });
    expect(notes.textContent).toBe('Notes 3');
    expect(notes.querySelector('.b2b-badge')).not.toBeNull();
    const links = screen.getByRole('tab', { name: 'Links' });
    expect(links.querySelector('.b2b-badge')).toBeNull();
    expect(links).not.toHaveAttribute('aria-label');
  });

  it('speaks the count in Polish for a Polish operator, and a caller countLabel wins', () => {
    renderWithI18n(
      <Strip
        items={[
          { value: 'details', label: 'Szczegóły' },
          { value: 'notes', label: 'Notatki', count: 2 },
          { value: 'links', label: 'Wiadomości', count: 5, countLabel: 'Wiadomości, nieprzeczytane: 5' },
        ]}
      />,
      PL,
      { language: 'pl' },
    );
    expect(screen.getByRole('tab', { name: 'Notatki, liczba pozycji: 2' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Wiadomości, nieprzeczytane: 5' })).toBeInTheDocument();
  });

  it('marks a tab holding unsaved changes with a dot, and says so in words (issue #1445)', () => {
    renderWithI18n(
      <Strip
        items={[
          { value: 'details', label: 'Details', unsaved: 'unsaved changes' },
          { value: 'notes', label: 'Notes', count: 3, unsaved: 'unsaved changes' },
          { value: 'links', label: 'Links' },
        ]}
      />,
      EN,
    );
    // The dot is decoration; the words carry the meaning, never the colour alone (SC 1.4.1).
    const details = screen.getByRole('tab', { name: 'Details (unsaved changes)' });
    const dot = details.querySelector('[data-testid="tab-unsaved-dot"]');
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // A counted tab keeps its count in the name and adds the same words.
    const notes = screen.getByRole('tab', { name: 'Notes, items: 3 (unsaved changes)' });
    expect(notes.querySelector('[data-testid="tab-unsaved-dot"]')).not.toBeNull();
    const links = screen.getByRole('tab', { name: 'Links' });
    expect(links.querySelector('[data-testid="tab-unsaved-dot"]')).toBeNull();
  });

  it('renders an icon as decoration, outside the accessible name', () => {
    renderWithI18n(
      <Tabs
        items={[{ value: 'a', label: 'Countries', icon: <svg data-testid="icon" /> }]}
        value="a"
        onValueChange={(): void => {}}
        idBase="dict"
        aria-label="Dictionary"
      />,
      EN,
    );
    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByRole('tab', { name: 'Countries' })).toBeInTheDocument();
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(<Strip />, EN);
    await expectNoAxeViolations(container);
  });
});

describe('RecordTabs — a record’s sections in one card', () => {
  function Record(): ReactElement {
    const [value, setValue] = useState<Section>('details');
    return (
      <RecordTabs
        items={ITEMS}
        value={value}
        onValueChange={setValue}
        idBase="opportunity"
        aria-label="Opportunity sections"
        panelProps={{ 'aria-busy': false, tabIndex: -1 }}
      >
        <p>Body of {value}</p>
      </RecordTabs>
    );
  }

  it('frames the strip and the selected section as one card body', async () => {
    const { container } = renderWithI18n(<Record />, EN);
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveClass('b2b-card__body');
    expect(panel).toHaveAttribute('tabindex', '-1');
    expect(panel.closest('.b2b-card')).toBe(container.querySelector('.b2b-card'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: 'Notes, items: 3' }));
    expect(screen.getByText('Body of notes')).toBeInTheDocument();
    expect(panel).toHaveAttribute('aria-labelledby', 'opportunity-tab-notes');
    await expectNoAxeViolations(container);
  });
});

describe('no tabs inside tabs', () => {
  it('warns in development when a Tabs is rendered inside a TabPanel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWithI18n(
      <TabPanel idBase="outer" value="a">
        <Tabs items={[{ value: 'x', label: 'X' }]} value="x" onValueChange={(): void => {}} idBase="inner-nested" aria-label="Inner" />
      </TabPanel>,
      EN,
    );
    expect(warn.mock.calls.some(([message]) => String(message).includes('Tabs inside tabs are not allowed'))).toBe(true);
  });

  it('does not warn for a strip in a dialog opened from a panel', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderWithI18n(
      <TabPanel idBase="outer" value="a">
        <ModalDialog title="Pick" onClose={(): void => {}}>
          <Tabs items={[{ value: 'x', label: 'X' }]} value="x" onValueChange={(): void => {}} idBase="inner-dialog" aria-label="Inner" />
        </ModalDialog>
      </TabPanel>,
      EN,
    );
    expect(warn.mock.calls.some(([message]) => String(message).includes('Tabs inside tabs'))).toBe(false);
  });
});
