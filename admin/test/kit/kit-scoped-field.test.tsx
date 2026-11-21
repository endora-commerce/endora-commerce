import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { ScopedField, type ScopedFieldProps } from '@endora-commerce/admin-kit/components';
import type { ScopeRef, ScopedFieldView, ScopedWriteOp } from '@endora-commerce/contracts';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Feature 174 (T097, `contracts/editor-ui.md` §4 and §11) — every state of `ScopedField`:
 * the "Use value from <parent scope>" checkbox, the source line as the control's description,
 * the badges, read-only never disabled, Global only and not supported at this scope.
 *
 * The test lives under `admin/test/kit/` because `@endora-commerce/admin-kit` has no test
 * runner of its own (the kit's other components are tested here too).
 */

afterEach(() => cleanup());

const CH = '00000000-0000-4000-8000-0000000000d1';
const AT_CL: ScopeRef = { level: 'channel_language', channelId: CH, languageCode: 'pl-PL' };
const AT_C: ScopeRef = { level: 'channel', channelId: CH };

function view(over: Partial<ScopedFieldView<string>> = {}): ScopedFieldView<string> {
  return { value: 'Drill', source: 'inherited_global', levels: ['G', 'C', 'CL'], supportedHere: true, required: false, ...over };
}

function Harness(
  props: Partial<ScopedFieldProps<string>> & { onStageSpy?: (op: ScopedWriteOp<string> | undefined) => void },
): ReactElement {
  const [staged, setStaged] = useState<ScopedWriteOp<string> | undefined>(props.staged);
  return (
    <ScopedField<string>
      id="f-name"
      label="Name"
      fieldPath="name"
      view={view()}
      scope={AT_CL}
      scopeLabel="B2B PL × Polish"
      parentScopeLabel="B2B PL"
      readOnly={false}
      textField
      renderControl={({ value, readOnly, onChange, inputProps }): ReactNode => (
        <input {...inputProps} readOnly={readOnly} value={value ?? ''} onChange={(e): void => onChange(e.target.value === '' ? null : e.target.value)} />
      )}
      {...props}
      staged={staged}
      onStage={(op): void => {
        props.onStageSpy?.(op);
        setStaged(op);
      }}
    />
  );
}

function renderEn(ui: ReactElement): ReturnType<typeof render> {
  return render(
    <TranslationProvider language="en" initialBundle={shippedCoreBundle('en')}>
      {ui}
    </TranslationProvider>,
  );
}

describe('ScopedField (feature 174, FR-060…FR-065)', () => {
  it('Global: no checkbox, control editable', () => {
    renderEn(<Harness scope={{ level: 'global' }} scopeLabel="Global" view={view({ source: 'set' })} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('readonly');
  });

  it('inheriting: checked box named for the field, read-only (not disabled) control, source line as its description', async () => {
    const { container } = renderEn(<Harness />);
    const box = screen.getByRole('checkbox', { name: 'Use value from B2B PL for Name' });
    expect(box).toBeChecked();
    const control = screen.getByLabelText('Name');
    expect(control).toHaveAttribute('readonly');
    expect(control).not.toBeDisabled();
    expect(control).toHaveValue('Drill');
    // The value comes from Global, not from the checkbox's B2B PL: the source line adds that fact.
    expect(control).toHaveAccessibleDescription(expect.stringContaining('Inherited from Global'));
    // Issue #1508 (UX audit CAT-08): the ticked checkbox and the dashed control already say
    // "inherited", so no "Not translated" / "Inherited" badge repeats it.
    expect(screen.queryByText('Not translated')).toBeNull();
    expect(screen.queryByText('Inherited')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('inheriting from the scope the checkbox names: no badge and no source line (issue #1508)', () => {
    renderEn(<Harness scope={AT_C} parentScopeLabel="Global" />);
    expect(screen.getByRole('checkbox', { name: 'Use value from Global for Name' })).toBeChecked();
    expect(screen.queryByText('Inherited')).toBeNull();
    expect(screen.queryByText('Inherited from Global')).toBeNull();
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('aria-describedby');
    cleanup();
    // At C×L a value the channel holds itself is named by the checkbox too.
    renderEn(<Harness view={view({ value: 'Wiertarka', source: 'inherited_channel' })} />);
    expect(screen.queryByText('Not translated')).toBeNull();
    expect(screen.queryByText(/^Inherited from/)).toBeNull();
  });

  it('nothing in the chain: "No value at any scope above" is the one line, without a "No value" badge (issue #1508)', () => {
    renderEn(<Harness view={view({ value: null, source: 'absent' })} />);
    expect(screen.queryByText('No value')).toBeNull();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('No value at any scope above'));
  });

  it('after an untick nothing is staged yet, so the source line still says where the value comes from', () => {
    renderEn(<Harness scope={AT_C} parentScopeLabel="Global" />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('Inherited from Global'));
  });

  it('untick stages nothing, makes the control editable and focuses it; typing stages set (FR-061)', () => {
    const spy = vi.fn();
    renderEn(<Harness onStageSpy={spy} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(spy).not.toHaveBeenCalled();
    const control = screen.getByLabelText('Name');
    expect(control).not.toHaveAttribute('readonly');
    expect(control).toHaveValue('Drill');
    expect(control).toHaveFocus();
    fireEvent.change(control, { target: { value: 'Wiertarka' } });
    expect(spy).toHaveBeenLastCalledWith({ op: 'set', value: 'Wiertarka' });
  });

  it('a new read starts the field over: an untick does not outlive the view it was made on (FR-061)', () => {
    const { rerender } = renderEn(<Harness />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('readonly');
    rerender(
      <TranslationProvider language="en" initialBundle={shippedCoreBundle('en')}>
        <Harness view={view({ value: 'Drill 2' })} />
      </TranslationProvider>,
    );
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Name')).toHaveValue('Drill 2');
  });

  it('an untick made as soon as the field is on screen is kept (issue #841)', async () => {
    // The field mounts from a late answer, as in the editor, and the box is clicked in the first
    // microtask after that commit — before React has run the commit's effects.
    function Late(): ReactElement | null {
      const [shown, setShown] = useState(false);
      useEffect(() => {
        void Promise.resolve().then(() => setShown(true));
      }, []);
      return shown ? <Harness /> : null;
    }
    const clicked = new Promise<void>((resolve) => {
      const observer = new MutationObserver(() => {
        const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]');
        if (!box) return;
        observer.disconnect();
        fireEvent.click(box);
        resolve();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    renderEn(<Late />);
    await clicked;
    // Let every effect and update still pending land before reading the end state.
    await act(async () => undefined);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByLabelText('Name')).not.toHaveAttribute('readonly');
  });

  it('own value: unchecked box and "Overridden", no repeating source line; tick stages inherit and untick restores (FR-062)', () => {
    const spy = vi.fn();
    renderEn(<Harness onStageSpy={spy} view={view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' })} />);
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(screen.getByText('Overridden')).toBeInTheDocument();
    // Issue #1508: "Set at this scope" says what "Overridden" already says.
    expect(screen.queryByText('Set at this scope')).toBeNull();
    fireEvent.click(box);
    expect(spy).toHaveBeenLastCalledWith({ op: 'inherit' });
    fireEvent.click(screen.getByRole('checkbox'));
    expect(spy).toHaveBeenLastCalledWith(undefined);
    expect(screen.getByLabelText('Name')).toHaveValue('Wiertarka');
  });

  it('own empty: "Empty here" and the empty meaning in the source line', () => {
    renderEn(<Harness view={view({ value: null, ownValue: null, source: 'set_empty' })} emptyMeaning="the storefront shows nothing here" />);
    expect(screen.getByText('Empty here')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(
      expect.stringContaining('Set at this scope, empty — the storefront shows nothing here'),
    );
  });

  it('own empty without an empty meaning: "Empty here" alone (issue #1508)', () => {
    renderEn(<Harness view={view({ value: null, ownValue: null, source: 'set_empty' })} />);
    expect(screen.getByText('Empty here')).toBeInTheDocument();
    expect(screen.queryByText(/^Set at this scope/)).toBeNull();
  });

  it('clearing an own value stages empty', () => {
    const spy = vi.fn();
    renderEn(<Harness onStageSpy={spy} view={view({ value: 'W', ownValue: 'W', source: 'set' })} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    expect(spy).toHaveBeenLastCalledWith({ op: 'empty' });
  });

  it('without catalog:write: no checkbox, the source text only, the control read-only', () => {
    renderEn(<Harness readOnly />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByText('Inherited from Global')).toBeInTheDocument();
    // No checkbox carries the state, so the badge still does.
    expect(screen.getByText('Not translated')).toBeInTheDocument();
    cleanup();
    renderEn(<Harness readOnly scope={AT_C} parentScopeLabel="Global" view={view({ value: 'W', ownValue: 'W', source: 'set' })} />);
    expect(screen.getByText('Overridden')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('Set at this scope'));
  });

  it('Global only outside Global: read-only, "Global only" and "Edit at Global" (FR-081)', () => {
    const jump = vi.fn();
    renderEn(<Harness globalOnly onJumpToScope={jump} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText('Global only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit at Global' }));
    expect(jump).toHaveBeenCalledWith({ level: 'global' });
  });

  it('not supported at this scope: the effective value read-only, "Set per channel", a jump to the channel (FR-082)', () => {
    const jump = vi.fn();
    renderEn(<Harness view={view({ levels: ['G', 'C'], supportedHere: false, value: '10' })} onJumpToScope={jump} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Name')).toHaveValue('10');
    expect(screen.getByText('Set per channel')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit at B2B PL' }));
    expect(jump).toHaveBeenCalledWith(AT_C);
  });

  it('an error is announced as part of the control description and marks it invalid', () => {
    renderEn(<Harness view={view({ value: 'W', ownValue: 'W', source: 'set' })} error="Name is required." />);
    const control = screen.getByLabelText('Name');
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control).toHaveAccessibleDescription(expect.stringContaining('Name is required.'));
  });

  it('ticking "Use value from" on an own value shows the parent value read-only and names the channel (round 8)', () => {
    renderEn(
      <Harness
        view={{ ...view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' }), inheritedValue: { value: 'Drill PL', level: 'C' } }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    const control = screen.getByLabelText('Name');
    expect(control).toHaveAttribute('readonly');
    expect(control).toHaveValue('Drill PL');
    expect(control).toHaveAccessibleDescription(expect.stringContaining('Will use the value from B2B PL when you save'));
  });

  it('a parent value that comes from Global names Global (round 8)', () => {
    renderEn(
      <Harness
        view={{ ...view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' }), inheritedValue: { value: 'Drill', level: 'G' } }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Name')).toHaveValue('Drill');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('Will use the value from Global when you save'));
  });

  it('an empty parent stays empty and is not skipped to Global (round 8)', () => {
    renderEn(
      <Harness
        view={{ ...view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' }), inheritedValue: { value: null, level: 'C' } }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('B2B PL'));
  });

  it('no value at Global either: the field says so after the tick (round 8)', () => {
    renderEn(
      <Harness
        view={{ ...view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' }), inheritedValue: { value: null, level: 'G' } }}
      />,
    );
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('No value at any scope above'));
  });

  it('ticking on an own value of a read without inheritedValue keeps the empty control and the save note', () => {
    renderEn(<Harness view={view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' })} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(screen.getByLabelText('Name')).toHaveValue('');
  });

  it('the checkbox is described by the source line', () => {
    renderEn(<Harness />);
    expect(screen.getByRole('checkbox')).toHaveAccessibleDescription(expect.stringContaining('Inherited from Global'));
  });

  it('an inherited control sits in a wrapper that styles read-only controls (dashed, sunken)', () => {
    renderEn(<Harness />);
    const wrapper = screen.getByLabelText('Name').parentElement!;
    expect(wrapper.className).toContain('[&_[readonly]]:border-dashed');
  });

  it('own empty: the hatching uses a colour, not raw HSL channels', () => {
    renderEn(<Harness view={view({ value: null, ownValue: null, source: 'set_empty' })} />);
    const wrapper = screen.getByLabelText('Name').parentElement!;
    expect(wrapper.className).toContain('hsl(var(--muted-foreground)');
    expect(wrapper.className).not.toContain('var(--muted)_');
  });

  // Issue #1459 (UX audit CAT-14): the note stays one clause; the rest is behind a ⓘ.
  it('help: a ⓘ named after the label, outside the control\'s description, opened on click', async () => {
    const { container } = renderEn(<Harness scope={{ level: 'global' }} note="Short note." help="The long explanation." />);
    const tip = screen.getByRole('button', { name: 'More information Name' });
    expect(tip).toHaveAttribute('aria-expanded', 'false');
    const control = screen.getByRole('textbox', { name: 'Name' });
    expect(control).toHaveAccessibleDescription('Short note.');
    fireEvent.click(tip);
    expect(tip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('The long explanation.')).toBeVisible();
    expect(control).toHaveAccessibleDescription('Short note.');
    await expectNoAxeViolations(container);
  });

  it('no help: no ⓘ', () => {
    renderEn(<Harness scope={{ level: 'global' }} />);
    expect(screen.queryByRole('button', { name: /More information/ })).toBeNull();
  });

  it('renders its Polish copy from the core bundle', () => {
    render(
      <TranslationProvider language="pl" initialBundle={shippedCoreBundle('pl')}>
        <Harness />
      </TranslationProvider>,
    );
    expect(screen.getByRole('checkbox').closest('label')?.textContent).not.toContain('scopedField.');
  });
});
