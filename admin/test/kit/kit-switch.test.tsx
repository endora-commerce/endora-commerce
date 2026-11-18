import { describe, expect, it, vi } from 'vitest';
import { useState, type ReactElement } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField, SettingRow, Switch } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1442 (UX audit 2026-11-17, DS-09) — the kit's `Switch` and the
 * `SettingRow` layout. An on/off setting is a switch everywhere else (Jakob's
 * Law); it used to be a `true`/`false` select or a filled "Enable" button.
 */

const EN = shippedCoreBundle('en');

function Controlled(props: {
  initial?: boolean;
  onCheckedChange?: (next: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  busy?: boolean;
}): ReactElement {
  const [checked, setChecked] = useState(props.initial ?? false);
  return (
    <FormField label="Show list price">
      <Switch
        checked={checked}
        onCheckedChange={(next) => {
          setChecked(next);
          props.onCheckedChange?.(next);
        }}
        {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
        {...(props.disabledReason !== undefined ? { disabledReason: props.disabledReason } : {})}
        {...(props.busy !== undefined ? { busy: props.busy } : {})}
      />
    </FormField>
  );
}

function describedText(el: Element): string {
  return (el.getAttribute('aria-describedby') ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' | ');
}

describe('Switch — role and state', () => {
  it('is a button with role="switch" whose aria-checked follows `checked`', () => {
    renderWithI18n(<Controlled initial />, EN);
    const toggle = screen.getByRole('switch', { name: 'Show list price' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(toggle.getAttribute('data-state')).toBe('checked');
  });

  it('toggles on click and reports the next value', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Controlled onCheckedChange={onChange} />, EN);
    const toggle = screen.getByRole('switch', { name: 'Show list price' });
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('toggles from the keyboard — Space and Enter', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Controlled onCheckedChange={onChange} />, EN);
    await userEvent.tab();
    const toggle = screen.getByRole('switch', { name: 'Show list price' });
    expect(document.activeElement).toBe(toggle);
    await userEvent.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(true);
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('a click on the label toggles it (Fitts — the label is part of the target)', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Controlled onCheckedChange={onChange} />, EN);
    await userEvent.click(screen.getByText('Show list price'));
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it('never submits the form it sits in', async () => {
    const onSubmit = vi.fn((e: { preventDefault: () => void }) => e.preventDefault());
    renderWithI18n(
      <form onSubmit={onSubmit}>
        <Controlled />
      </form>,
      EN,
    );
    await userEvent.click(screen.getByRole('switch'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('carries a visible focus ring and a 44 px hit area on a coarse pointer', () => {
    renderWithI18n(<Controlled />, EN);
    const cls = screen.getByRole('switch').className;
    expect(cls).toContain('focus-visible:ring-2');
    expect(cls).toContain('pointer-coarse:before:-inset-y-3');
  });
});

describe('Switch — disabled, with and without a reason', () => {
  it('disabled: native disabled, a click changes nothing', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Controlled disabled onCheckedChange={onChange} />, EN);
    const toggle = screen.getByRole('switch') as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    await userEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('a disabled reason keeps it focusable, marks it aria-disabled and describes it with the reason', async () => {
    const onChange = vi.fn();
    renderWithI18n(
      <Controlled disabledReason="Only an administrator can change this." onCheckedChange={onChange} />,
      EN,
    );
    const toggle = screen.getByRole('switch') as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    expect(toggle.getAttribute('aria-disabled')).toBe('true');
    expect(describedText(toggle)).toContain('Only an administrator can change this.');
    await userEvent.tab();
    expect(document.activeElement).toBe(toggle);
    await userEvent.click(toggle);
    await userEvent.keyboard(' ');
    expect(onChange).not.toHaveBeenCalled();
    expect(toggle.getAttribute('aria-checked')).toBe('false');
  });

  it('busy: aria-busy, and a click while the write is in flight is ignored', async () => {
    const onChange = vi.fn();
    renderWithI18n(<Controlled busy onCheckedChange={onChange} />, EN);
    const toggle = screen.getByRole('switch');
    expect(toggle.getAttribute('aria-busy')).toBe('true');
    await userEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SettingRow — label and description left, control right', () => {
  it('names the switch by the label and describes it with the description', () => {
    renderWithI18n(
      <SettingRow label="Show list price" description="Beside a lower buyer price.">
        <Switch checked={false} onCheckedChange={vi.fn()} />
      </SettingRow>,
      EN,
    );
    const toggle = screen.getByRole('switch', { name: 'Show list price' });
    expect(describedText(toggle)).toBe('Beside a lower buyer price.');
    const row = toggle.closest('[data-layout="row"]');
    expect(row).not.toBeNull();
    // The control comes after the label text in reading order.
    const label = screen.getByText('Show list price');
    expect(label.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('links an error and marks the control invalid', () => {
    renderWithI18n(
      <SettingRow label="Enabled" error="Could not save.">
        <Switch checked onCheckedChange={vi.fn()} />
      </SettingRow>,
      EN,
    );
    const toggle = screen.getByRole('switch', { name: 'Enabled' });
    expect(toggle.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(toggle)).toContain('Could not save.');
  });
});

describe('Switch — axe', () => {
  it.each([
    ['off', <Controlled key="off" />],
    ['on', <Controlled key="on" initial />],
    ['disabled', <Controlled key="disabled" disabled />],
    ['disabled with a reason', <Controlled key="reason" disabledReason="Read only." />],
    ['busy', <Controlled key="busy" busy />],
    [
      'in a SettingRow',
      <SettingRow key="row" label="Enabled" description="Turns it on." hint="Takes effect at once.">
        <Switch checked onCheckedChange={(): void => undefined} />
      </SettingRow>,
    ],
  ] as const)('%s has no WCAG 2.2 AA violation axe can see', async (_kind, ui) => {
    const { container } = renderWithI18n(ui, EN);
    await expectNoAxeViolations(container);
  });
});
