import { useState, type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { ScopedField, type ScopedFieldProps } from '@endora-commerce/admin-kit/components';
import type { ScopeRef, ScopedFieldView, ScopedWriteOp } from '@endora-commerce/contracts';
import { shippedCoreBundle } from '../helpers/core-bundle';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Feature 170 (T097, `contracts/editor-ui.md` §4 and §11) — every state of `ScopedField`:
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

describe('ScopedField (feature 170, FR-060…FR-065)', () => {
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
    expect(control).toHaveAccessibleDescription(expect.stringContaining('Inherited from Global'));
    // A text field at C×L that inherits is "Not translated" (§11).
    expect(screen.getByText('Not translated')).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('inheriting at Channel says "Inherited"; nothing in the chain says "No value"', () => {
    renderEn(<Harness scope={AT_C} parentScopeLabel="Global" />);
    expect(screen.getByText('Inherited')).toBeInTheDocument();
    cleanup();
    renderEn(<Harness view={view({ value: null, source: 'absent' })} />);
    expect(screen.getByText('No value')).toBeInTheDocument();
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

  it('own value: unchecked box, "Set at this scope", "Overridden"; tick stages inherit and untick restores (FR-062)', () => {
    const spy = vi.fn();
    renderEn(<Harness onStageSpy={spy} view={view({ value: 'Wiertarka', ownValue: 'Wiertarka', source: 'set' })} />);
    const box = screen.getByRole('checkbox');
    expect(box).not.toBeChecked();
    expect(screen.getByText('Overridden')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAccessibleDescription(expect.stringContaining('Set at this scope'));
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

  it('renders its Polish copy from the core bundle', () => {
    render(
      <TranslationProvider language="pl" initialBundle={shippedCoreBundle('pl')}>
        <Harness />
      </TranslationProvider>,
    );
    expect(screen.getByRole('checkbox').closest('label')?.textContent).not.toContain('scopedField.');
  });
});
