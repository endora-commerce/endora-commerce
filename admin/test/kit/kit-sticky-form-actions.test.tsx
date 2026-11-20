import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { StickyFormActions } from '@endora-commerce/admin-kit/components';
import { Button } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1449 (UX audit 2026-11-17, DS-19) — `StickyFormActions` is the one fixed place of an
 * editor's single Save (spec 180). Long editors had put Save mid-page, at the end of a long
 * list, or inside a panel that also saved what was below it.
 *
 * The bar lays out the hierarchy once: the secondary actions, then the one primary last in
 * reading order (Von Restorff, Jakob), with the bar's messages — the last save's refusal, its
 * outcome, "Unsaved changes" and a one-line note on what Save does — beside the button that
 * caused them (Proximity), not at the top of the page.
 */

const EN = shippedCoreBundle('en');
const UNSAVED_EN = EN.core!['form.unsavedChanges.hint']!;

function bar(): HTMLElement {
  const node = document.querySelector<HTMLElement>('[data-slot="sticky-form-actions"]');
  if (node === null) throw new Error('no StickyFormActions on the page');
  return node;
}

describe('StickyFormActions — layout', () => {
  it('draws the secondary actions first and the one primary last in reading order', () => {
    renderWithI18n(
      <StickyFormActions
        primary={<Button type="submit">Save</Button>}
        secondary={
          <Button type="button" variant="outline">
            Cancel
          </Button>
        }
      />,
      EN,
    );
    const names = within(bar())
      .getAllByRole('button')
      .map((button) => button.textContent?.trim());
    expect(names).toEqual(['Cancel', 'Save']);
  });

  it('keeps the free-form children of the callers that lay the bar out themselves', () => {
    renderWithI18n(
      <StickyFormActions>
        <button type="button">Publish</button>
      </StickyFormActions>,
      EN,
    );
    expect(within(bar()).getByRole('button', { name: 'Publish' })).toBeInTheDocument();
    expect(bar()).toHaveClass('b2b-sticky-form-actions');
  });

  it('is fixed to the bottom on a phone and inline on a desktop unless the editor asks for a sticky bar', () => {
    const { rerender } = renderWithI18n(<StickyFormActions primary={<Button>Save</Button>} />, EN);
    expect(bar()).toHaveAttribute('data-desktop', 'inline');
    expect(bar()).not.toHaveClass('b2b-sticky-form-actions--sticky');
    rerender(<StickyFormActions desktop="sticky" primary={<Button>Save</Button>} />);
    expect(bar()).toHaveAttribute('data-desktop', 'sticky');
    expect(bar()).toHaveClass('b2b-sticky-form-actions--sticky');
  });

  it('the theme makes the sticky variant stick to the bottom of the scroll area at ≥ 1024 px', () => {
    const theme = readFileSync(resolve(process.cwd(), '../packages/admin-kit/theme.css'), 'utf8');
    const desktop = theme.slice(theme.indexOf('.b2b-sticky-form-actions--sticky'));
    expect(desktop).toMatch(/\.b2b-sticky-form-actions--sticky\s*\{[^}]*position:\s*sticky/);
    expect(desktop).toMatch(/\.b2b-sticky-form-actions--sticky\s*\{[^}]*bottom:\s*0/);
  });
});

describe('StickyFormActions — messages beside the Save', () => {
  it('describes the primary by the note, so a screen reader hears what Save does with it', () => {
    renderWithI18n(
      <StickyFormActions primary={<Button>Save revision</Button>} note="The customer is notified." />,
      EN,
    );
    const save = screen.getByRole('button', { name: 'Save revision' });
    expect(save).toHaveAccessibleDescription('The customer is notified.');
  });

  it('keeps a description the primary already had and adds the note to it', () => {
    renderWithI18n(
      <>
        <p id="own-hint">Two parts are saved.</p>
        <StickyFormActions primary={<Button aria-describedby="own-hint">Save</Button>} note="Note." />
      </>,
      EN,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAccessibleDescription('Two parts are saved. Note.');
  });

  it('shows "Unsaved changes" from `dirty` in a live region mounted before it has text', () => {
    const { rerender } = renderWithI18n(<StickyFormActions dirty={false} primary={<Button>Save</Button>} />, EN);
    const hint = within(bar()).getByTestId('unsaved-changes-hint');
    expect(hint).toHaveAttribute('aria-live', 'polite');
    expect(hint).toHaveTextContent('');
    rerender(<StickyFormActions dirty primary={<Button>Save</Button>} />);
    expect(within(bar()).getByTestId('unsaved-changes-hint')).toBe(hint);
    expect(hint).toHaveTextContent(UNSAVED_EN);
  });

  it('renders no unsaved hint when the editor does not pass `dirty`', () => {
    renderWithI18n(<StickyFormActions primary={<Button>Save</Button>} />, EN);
    expect(within(bar()).queryByTestId('unsaved-changes-hint')).toBeNull();
  });

  it('mounts no alert or status region for an editor that says its outcome elsewhere', () => {
    renderWithI18n(<StickyFormActions primary={<Button>Save</Button>} />, EN);
    expect(within(bar()).queryByRole('alert')).toBeNull();
    expect(within(bar()).queryByRole('status')).toBeNull();
  });

  it('puts the save refusal in an alert and the outcome in a status region, both in the bar', () => {
    const { rerender } = renderWithI18n(
      <StickyFormActions primary={<Button>Save</Button>} error={null} status={null} />,
      EN,
    );
    const alert = within(bar()).getByRole('alert');
    const status = within(bar()).getByRole('status');
    // Mounted empty from the first render, so the text that arrives is announced (WCAG 4.1.3).
    expect(alert).toHaveTextContent('');
    expect(status).toHaveTextContent('');
    rerender(<StickyFormActions primary={<Button>Save</Button>} error="The name is taken." status={null} />);
    expect(within(bar()).getByRole('alert')).toBe(alert);
    expect(alert).toHaveTextContent('The name is taken.');
    rerender(<StickyFormActions primary={<Button>Save</Button>} error={null} status="Saved." />);
    expect(status).toHaveTextContent('Saved.');
    expect(alert).toHaveTextContent('');
  });

  it('has no axe violations with every slot filled', async () => {
    const { container } = renderWithI18n(
      <form aria-label="Editor">
        <StickyFormActions
          desktop="sticky"
          dirty
          note="The customer is notified."
          error="The name is taken."
          secondary={
            <Button type="button" variant="outline">
              Cancel
            </Button>
          }
          primary={<Button type="submit">Save</Button>}
        />
      </form>,
      EN,
    );
    await expectNoAxeViolations(container);
  });
});
