import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Checkbox,
  FormField,
  HelpTip,
  Input,
  Select,
  Textarea,
} from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1432 (UX audit DS-08) — `FormField` is the one place a label, its
 * control, a one-line hint and an error are wired together, so no admin screen
 * has to remember `htmlFor`, `aria-describedby` and `aria-invalid` by hand
 * (WCAG 2.2 SC 1.3.1, 3.3.1, 3.3.2, 4.1.2).
 */

const EN = shippedCoreBundle('en');
const PL = shippedCoreBundle('pl');

function describedBy(el: Element): string[] {
  return (el.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
}

function textOf(ids: string[]): string[] {
  return ids.map((id) => document.getElementById(id)?.textContent ?? `<missing ${id}>`);
}

describe('FormField — label ↔ control', () => {
  it('names an Input by its label through a generated id', () => {
    renderWithI18n(
      <FormField label="Legal name">
        <Input />
      </FormField>,
      EN,
    );
    const input = screen.getByRole('textbox', { name: 'Legal name' });
    const label = screen.getByText('Legal name');
    expect(input.id).not.toBe('');
    expect(label.tagName).toBe('LABEL');
    expect(label.getAttribute('for')).toBe(input.id);
  });

  it('keeps an id the control already carries, and the explicit `id` prop wins over a generated one', () => {
    renderWithI18n(
      <>
        <FormField label="Own id">
          <Input id="own-id" />
        </FormField>
        <FormField label="Given id" id="given-id">
          <Input />
        </FormField>
      </>,
      EN,
    );
    expect(screen.getByRole('textbox', { name: 'Own id' }).id).toBe('own-id');
    expect(screen.getByRole('textbox', { name: 'Given id' }).id).toBe('given-id');
  });

  it('wires every kit control the same way: Select, Textarea, Checkbox', () => {
    renderWithI18n(
      <>
        <FormField label="Status">
          <Select>
            <option value="a">A</option>
          </Select>
        </FormField>
        <FormField label="Notes">
          <Textarea />
        </FormField>
        <FormField label="Active">
          <Checkbox />
        </FormField>
      </>,
      EN,
    );
    expect(screen.getByRole('combobox', { name: 'Status' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Active' })).toBeTruthy();
  });

  it('hands the wiring to a render-prop child, for a custom control', () => {
    renderWithI18n(
      <FormField label="Quantity" hint="Whole units only" error="Must be positive">
        {(control) => <input type="number" {...control} />}
      </FormField>,
      EN,
    );
    const input = screen.getByRole('spinbutton', { name: 'Quantity' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(textOf(describedBy(input))).toEqual(['Must be positive', 'Whole units only']);
  });
});

describe('FormField — hint, description and error', () => {
  it('links the hint with aria-describedby and keeps it to one line', () => {
    renderWithI18n(
      <FormField label="Slug" hint="Lower-case letters and dashes">
        <Input />
      </FormField>,
      EN,
    );
    const input = screen.getByRole('textbox', { name: 'Slug' });
    expect(textOf(describedBy(input))).toEqual(['Lower-case letters and dashes']);
    const hint = document.getElementById(describedBy(input)[0]!)!;
    expect(hint.className).toContain('line-clamp-1');
    // The clamped text stays readable in full on hover.
    expect(hint.getAttribute('title')).toBe('Lower-case letters and dashes');
  });

  it('links a description, unclamped, above the control', () => {
    renderWithI18n(
      <FormField label="Robots" description="A long explanation that must stay on screen.">
        <Textarea />
      </FormField>,
      EN,
    );
    const textarea = screen.getByRole('textbox', { name: 'Robots' });
    const [descriptionId] = describedBy(textarea);
    const description = document.getElementById(descriptionId!)!;
    expect(description.textContent).toBe('A long explanation that must stay on screen.');
    expect(description.className).not.toContain('line-clamp');
    // Above the control in reading order.
    expect(
      description.compareDocumentPosition(textarea) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('marks the control invalid and puts the error first in its description', () => {
    renderWithI18n(
      <FormField label="E-mail" hint="We send the invoice here" error="Enter an e-mail address">
        <Input type="email" />
      </FormField>,
      EN,
    );
    const input = screen.getByRole('textbox', { name: 'E-mail' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(textOf(describedBy(input))).toEqual([
      'Enter an e-mail address',
      'We send the invoice here',
    ]);
  });

  it('says nothing about validity without an error, and keeps the error region mounted and empty', () => {
    const { rerender } = renderWithI18n(
      <FormField label="E-mail">
        <Input />
      </FormField>,
      EN,
    );
    const input = screen.getByRole('textbox', { name: 'E-mail' });
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    // A live region that arrives already carrying its message is not reliably
    // announced, so it is there, empty, before there is an error to read.
    const region = document.querySelector('[aria-live="polite"]')!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');

    rerender(
      <FormField label="E-mail" error="Enter an e-mail address">
        <Input />
      </FormField>,
    );
    expect(document.querySelector('[aria-live="polite"]')).toBe(region);
    expect(region.textContent).toBe('Enter an e-mail address');
    expect(describedBy(input)).toEqual([region.id]);
  });

  it('merges the descriptions a control already carries instead of replacing them', () => {
    renderWithI18n(
      <>
        <p id="outside">Applies to every channel</p>
        <FormField label="Currency" hint="ISO code">
          <Input aria-describedby="outside" />
        </FormField>
      </>,
      EN,
    );
    const input = screen.getByRole('textbox', { name: 'Currency' });
    expect(textOf(describedBy(input))).toEqual(['ISO code', 'Applies to every channel']);
  });

  it('links extra descriptions the caller renders elsewhere through `describedBy`', () => {
    renderWithI18n(
      <>
        <p id="row-notice">Not in force</p>
        <FormField label="Limit" describedBy="row-notice">
          <Input />
        </FormField>
      </>,
      EN,
    );
    expect(textOf(describedBy(screen.getByRole('textbox', { name: 'Limit' })))).toEqual([
      'Not in force',
    ]);
  });
});

describe('FormField — required', () => {
  it('marks the control aria-required and shows an asterisk hidden from assistive technology', () => {
    renderWithI18n(
      <FormField label="Name" required>
        <Input />
      </FormField>,
      EN,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.getAttribute('aria-required')).toBe('true');
    const marker = screen.getByText('*');
    expect(marker.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('FormField — a composite control (group)', () => {
  it('labels a group by the label text, and links its descriptions to the group', () => {
    renderWithI18n(
      <FormField label="Seller address" group hint="Printed on invoices" required>
        <div>
          <Input aria-label="Street" />
          <Input aria-label="City" />
        </div>
      </FormField>,
      EN,
    );
    const group = screen.getByRole('group', { name: 'Seller address (required)' });
    expect(textOf(describedBy(group))).toEqual(['Printed on invoices']);
    // There is no one control for a <label> to point at.
    expect(document.querySelector('label')).toBeNull();
  });

  it('says "required" in Polish when the admin is in Polish', () => {
    renderWithI18n(
      <FormField label="Adres sprzedawcy" group required>
        <div />
      </FormField>,
      PL,
      { language: 'pl' },
    );
    expect(screen.getByRole('group', { name: 'Adres sprzedawcy (wymagane)' })).toBeTruthy();
  });
});

describe('HelpTip', () => {
  it('is a disclosure named after the field it explains, closed until asked', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <FormField label="Payment terms" help="Days the buyer has to pay after the invoice date.">
        <Input />
      </FormField>,
      EN,
    );
    const button = screen.getByRole('button', { name: 'More information Payment terms' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Days the buyer has to pay after the invoice date.')).toBeNull();

    await user.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(panel.textContent).toBe('Days the buyer has to pay after the invoice date.');
    // The help is not read on every focus of the control — that is what the
    // one-line hint is for.
    expect(screen.getByRole('textbox', { name: 'Payment terms' }).hasAttribute('aria-describedby')).toBe(false);
  });

  it('closes on Escape and gives focus back to its button', async () => {
    const user = userEvent.setup();
    renderWithI18n(<HelpTip>Longer text</HelpTip>, EN);
    const button = screen.getByRole('button', { name: 'More information' });
    await user.click(button);
    expect(screen.getByText('Longer text')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('closes on a click outside', async () => {
    const user = userEvent.setup();
    renderWithI18n(
      <>
        <HelpTip>Longer text</HelpTip>
        <button type="button">Elsewhere</button>
      </>,
      EN,
    );
    await user.click(screen.getByRole('button', { name: 'More information' }));
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByText('Longer text')).toBeNull();
  });

  it('is named in Polish when the admin is in Polish', () => {
    renderWithI18n(<HelpTip>Tekst</HelpTip>, PL, { language: 'pl' });
    expect(screen.getByRole('button', { name: 'Więcej informacji' })).toBeTruthy();
  });
});

describe('FormField — axe', () => {
  it('a form of fields in every state has no WCAG 2.2 AA violation axe can see', async () => {
    const user = userEvent.setup();
    const { container } = renderWithI18n(
      <form>
        <FormField label="Name" required hint="As on the registration document">
          <Input />
        </FormField>
        <FormField label="E-mail" error="Enter an e-mail address" help="Invoices go here.">
          <Input type="email" />
        </FormField>
        <FormField label="Kind" description="Decides which documents are issued.">
          <Select>
            <option value="b2b">B2B</option>
          </Select>
        </FormField>
        <FormField label="Address" group required error="Fill in the city">
          <div>
            <Input aria-label="City" />
          </div>
        </FormField>
      </form>,
      EN,
    );
    await expectNoAxeViolations(container);
    await user.click(screen.getByRole('button', { name: 'More information E-mail' }));
    await expectNoAxeViolations(container);
  });
});
