import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DetailHeaderActions,
  RowActionMenuItem,
  RowActionMenuSeparator,
} from '@endora-commerce/admin-kit/components';
import { Button } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1441 (UX audit 2026-11-17, DS-07) — one primary action per view.
 *
 * A record's detail header used to carry four or five outline buttons and no
 * primary (order, RFQ). `DetailHeaderActions` lays out the one primary action,
 * at most a couple of visible secondary ones, and a labelled "More" menu for the
 * rest, destructive entries included (Von Restorff, Hick, Fitts).
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');
const MORE_EN = EN.core!['common.action.more']!;
const MORE_PL = PL.core!['common.action.more']!;

function actionsGroup(): HTMLElement {
  const group = document.querySelector<HTMLElement>('[data-slot="detail-header-actions"]');
  if (group === null) throw new Error('no DetailHeaderActions on the page');
  return group;
}

function Header(props: { onDuplicate?: () => void; onDelete?: () => void; withMenu?: boolean }): React.ReactNode {
  const { withMenu = true } = props;
  return (
    <DetailHeaderActions
      primary={<Button type="button">Approve</Button>}
      secondary={
        <Button type="button" variant="outline">
          Print
        </Button>
      }
    >
      {withMenu ? (
        <>
          <RowActionMenuItem onSelect={props.onDuplicate}>Duplicate</RowActionMenuItem>
          <RowActionMenuSeparator />
          <RowActionMenuItem destructive onSelect={props.onDelete}>
            Delete
          </RowActionMenuItem>
        </>
      ) : null}
    </DetailHeaderActions>
  );
}

describe('DetailHeaderActions — layout', () => {
  it('puts the menu first, the secondary next and the one primary last in reading order', () => {
    renderWithI18n(<Header />, EN);
    const group = actionsGroup();
    const names = within(group)
      .getAllByRole('button')
      .map((button) => button.textContent?.trim());
    expect(names).toEqual([MORE_EN, 'Print', 'Approve']);
  });

  it('the "More" trigger is an outline button with a visible label, not a bare icon', () => {
    renderWithI18n(<Header />, EN);
    const trigger = screen.getByRole('button', { name: MORE_EN });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    // Visible words, not only an icon: the label is the accessible name (SC 2.5.3).
    expect(trigger).toHaveTextContent(MORE_EN);
  });

  it('renders no "More" trigger when there is nothing to put in it', () => {
    renderWithI18n(<Header withMenu={false} />, EN);
    expect(screen.queryByRole('button', { name: MORE_EN })).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('renders nothing at all when it has no action', () => {
    const { container } = renderWithI18n(<DetailHeaderActions>{null}</DetailHeaderActions>, EN);
    expect(container.querySelector('[data-slot="detail-header-actions"]')).toBeNull();
  });

  it('labels the menu in the operator\'s language', () => {
    renderWithI18n(<Header />, PL, { language: 'pl' });
    expect(MORE_PL).not.toBe(MORE_EN);
    expect(screen.getByRole('button', { name: MORE_PL })).toBeInTheDocument();
  });

  it('takes a caller\'s own menu label', () => {
    renderWithI18n(
      <DetailHeaderActions moreLabel="Order actions">
        <RowActionMenuItem>Duplicate</RowActionMenuItem>
      </DetailHeaderActions>,
      EN,
    );
    expect(screen.getByRole('button', { name: 'Order actions' })).toBeInTheDocument();
  });
});

describe('DetailHeaderActions — the menu', () => {
  it('opens from the keyboard, runs the chosen entry and returns focus on Escape', async () => {
    const user = userEvent.setup();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();
    renderWithI18n(<Header onDuplicate={onDuplicate} onDelete={onDelete} />, EN);

    const trigger = screen.getByRole('button', { name: MORE_EN });
    trigger.focus();
    await user.keyboard('{Enter}');
    const menu = await screen.findByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // The panel is portalled out of the header, so a clipping container cannot cut it off.
    expect(actionsGroup().contains(menu)).toBe(false);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDuplicate).not.toHaveBeenCalled();
  });

  it('can be disabled with a reason', () => {
    renderWithI18n(
      <DetailHeaderActions moreDisabled moreTitle="Read-only">
        <RowActionMenuItem>Duplicate</RowActionMenuItem>
      </DetailHeaderActions>,
      EN,
    );
    const trigger = screen.getByRole('button', { name: MORE_EN });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAttribute('title', 'Read-only');
  });
});

describe('DetailHeaderActions — accessibility', () => {
  it('has no axe violations, closed and open', async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(<Header />, EN);
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: MORE_EN }));
    // The open panel itself. Not `document.body`: while a Radix menu is open it
    // marks the rest of the page `aria-hidden` and adds focus-guard spans, which
    // axe reports against the page around the menu rather than the menu.
    const menu = await screen.findByRole('menu');
    await expectNoAxeViolations(menu);
  });
});
