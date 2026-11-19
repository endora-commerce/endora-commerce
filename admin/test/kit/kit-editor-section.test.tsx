import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { AdminZoneContribution } from '@endora-commerce/contracts';
import { EditorSection, EditorSectionChromeProvider, Section } from '@endora-commerce/admin-kit/ui';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { adminSession, modulePresence, withSession } from '../helpers/render-with-session';

/**
 * Issue #1437 (UX audit 2026-11-17, DS-03): a section of an editor is a heading,
 * an optional one-line description and a divider — not a card. A frame inside a
 * card is a defect unless it is a field (Common Region), so the card is opt-in
 * (`chrome="card"`) for a section that stands alone on a page.
 */

function classesOf(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

describe('EditorSection', () => {
  it('is a labelled region with an h2 on the section-title token, and draws no frame', () => {
    render(
      <EditorSection title="Shipping" data-testid="section">
        <p>Body</p>
      </EditorSection>,
    );
    const region = screen.getByRole('region', { name: 'Shipping' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Shipping' });
    expect(region.tagName).toBe('SECTION');
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(classesOf(heading)).toContain('text-(length:--fs-section-title)');
    expect(region.closest('[data-slot=card]')).toBeNull();
    for (const frame of ['border', 'rounded-lg', 'rounded-md', 'shadow-sm']) {
      expect(classesOf(region)).not.toContain(frame);
    }
  });

  it('takes the heading level through `as`, like CardTitle', () => {
    render(<EditorSection title="Lines" as="h3">x</EditorSection>);
    expect(screen.getByRole('heading', { level: 3, name: 'Lines' })).toBeTruthy();
  });

  it('describes the region with its one-line description', () => {
    render(
      <EditorSection title="Prices" description="Net prices, per channel.">
        x
      </EditorSection>,
    );
    const region = screen.getByRole('region', { name: 'Prices' });
    const describedBy = region.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy ?? '')?.textContent).toBe('Net prices, per channel.');
  });

  it('renders the action beside the heading', () => {
    render(
      <EditorSection title="Members" action={<button type="button">Add</button>}>
        x
      </EditorSection>,
    );
    const region = screen.getByRole('region', { name: 'Members' });
    expect(within(region).getByRole('button', { name: 'Add' })).toBeTruthy();
  });

  it('divides consecutive sections with a rule on the section-gap token, and the first one draws none', () => {
    render(
      <div>
        <EditorSection title="One">a</EditorSection>
        <EditorSection title="Two">b</EditorSection>
        <EditorSection title="Three" divider={false}>
          c
        </EditorSection>
      </div>,
    );
    const two = screen.getByRole('region', { name: 'Two' });
    // A sibling selector: the rule exists only after another dividing section.
    expect(classesOf(two)).toContain('[[data-slot=editor-section][data-divider]+&]:border-t');
    expect(classesOf(two)).toContain('[[data-slot=editor-section][data-divider]+&]:pt-(--section-gap)');
    expect(two.hasAttribute('data-divider')).toBe(true);
    const three = screen.getByRole('region', { name: 'Three' });
    expect(three.hasAttribute('data-divider')).toBe(false);
    expect(classesOf(three).some((c) => c.includes('border-t'))).toBe(false);
  });

  it('draws a card only on request — `chrome="card"` — for a section standing alone on a page', () => {
    render(
      <EditorSection title="Custom fields" chrome="card" description="One line.">
        <p>Body</p>
      </EditorSection>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'Custom fields' });
    const card = heading.closest('[data-slot=card]');
    expect(card).not.toBeNull();
    expect(heading.getAttribute('data-slot')).toBe('card-title');
    expect(within(card as HTMLElement).getByText('Body').closest('[data-slot=card-content]')).not.toBeNull();
    expect(screen.getByRole('region', { name: 'Custom fields' })).toBe(card);
  });

  it('takes its default chrome from the mount, and gives only the outermost section a card', () => {
    render(
      <EditorSectionChromeProvider chrome="card">
        <EditorSection title="Outer">
          <EditorSection title="Inner">x</EditorSection>
        </EditorSection>
      </EditorSectionChromeProvider>,
    );
    const outer = screen.getByRole('heading', { name: 'Outer' });
    const inner = screen.getByRole('heading', { name: 'Inner' });
    expect(outer.closest('[data-slot=card]')).not.toBeNull();
    // The inner section is inside the card, and draws none of its own: no card in a card.
    expect(inner.closest('[data-slot=card]')).toBe(outer.closest('[data-slot=card]'));
    expect(inner.getAttribute('data-slot')).toBeNull();
  });

  it('an explicit chrome wins over the mount', () => {
    render(
      <EditorSectionChromeProvider chrome="card">
        <EditorSection title="Flat" chrome="section">
          x
        </EditorSection>
      </EditorSectionChromeProvider>,
    );
    expect(screen.getByRole('heading', { name: 'Flat' }).closest('[data-slot=card]')).toBeNull();
  });
});

describe('Section', () => {
  it('stays the dividerless section: an h2, no frame, no rule, no landmark', () => {
    render(
      <div>
        <Section title="A">a</Section>
        <Section title="B">b</Section>
      </div>,
    );
    const heading = screen.getByRole('heading', { level: 2, name: 'B' });
    const b = heading.closest('section') as HTMLElement;
    expect(b.hasAttribute('data-divider')).toBe(false);
    // Not a named region, as before: its callers often sit inside a region they name.
    expect(b.hasAttribute('aria-labelledby')).toBe(false);
    expect(b.closest('[data-slot=card]')).toBeNull();
  });
});

describe('AdminZone — the zone panel frame', () => {
  function Panel(): ReactElement {
    return <EditorSection title="Linked tasks">x</EditorSection>;
  }
  const CONTRIBUTION: AdminZoneContribution = {
    zone: 'order.detail.after',
    weight: 0,
    component: () => Promise.resolve({ default: Panel }),
  };
  function mount(ui: ReactElement): void {
    render(
      withSession(ui, {
        session: adminSession({ permissions: ['*'] }),
        presence: modulePresence({ present: ['test_tasks', 'orders'] }),
        contributions: [{ moduleId: 'test_tasks', contributions: { zones: [CONTRIBUTION] } }],
      }),
    );
  }

  it('renders a contributed panel as a section by default — inside the host card it is mounted in', async () => {
    mount(<AdminZone name="order.detail.after" props={{ orderId: 'o1' }} />);
    const heading = await screen.findByRole('heading', { name: 'Linked tasks' });
    expect(heading.closest('[data-slot=card]')).toBeNull();
  });

  it('frames each contributed panel as a card under `chrome="card"`, for a mount at page level', async () => {
    mount(<AdminZone name="order.detail.after" props={{ orderId: 'o1' }} chrome="card" />);
    const heading = await screen.findByRole('heading', { name: 'Linked tasks' });
    expect(heading.closest('[data-slot=card]')).not.toBeNull();
  });
});
