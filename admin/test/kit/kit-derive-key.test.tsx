import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { deriveKey, useDerivedKey, type DeriveKeyOptions } from '@endora-commerce/admin-kit/lib';

/**
 * Issue #1450 (DS-22) — a slug, key or code proposed from the name, and the
 * field behaviour every screen deriving one shares: it follows the name until
 * the operator edits it, it is normalised on blur, and only what is still
 * invalid is left for the screen to refuse.
 */
describe('deriveKey', () => {
  it('folds diacritics, Polish ł included, and collapses the rest to the separator', () => {
    expect(deriveKey('Żółta łódź')).toBe('zolta-lodz');
    expect(deriveKey('W trakcie — przegląd', { separator: '_' })).toBe('w_trakcie_przeglad');
    expect(deriveKey('  In Review!  ', { separator: '_' })).toBe('in_review');
  });

  it('keeps an already valid key as it is, so normalising twice changes nothing', () => {
    expect(deriveKey('in_review', { separator: '_' })).toBe('in_review');
    expect(deriveKey(deriveKey('Ready for QA', { separator: '_' }), { separator: '_' })).toBe('ready_for_qa');
  });

  it('cuts to maxLength without leaving a trailing separator', () => {
    expect(deriveKey('alpha beta gamma', { separator: '_', maxLength: 11 })).toBe('alpha_beta');
  });

  it('answers an empty string when nothing usable is left, and leaves a leading digit for the field to refuse', () => {
    expect(deriveKey('!!!', { separator: '_' })).toBe('');
    expect(deriveKey('2nd line', { separator: '_' })).toBe('2nd_line');
  });
});

function Harness(
  props: { initialKey?: string; enabled?: boolean; onSubmit?: (key: string) => void } & DeriveKeyOptions,
): ReactNode {
  const [name, setName] = useState('');
  const [key, setKey] = useState(props.initialKey ?? '');
  const field = useDerivedKey({
    source: name,
    value: key,
    onChange: setKey,
    separator: props.separator ?? '_',
    ...(props.maxLength !== undefined ? { maxLength: props.maxLength } : {}),
    ...(props.enabled !== undefined ? { enabled: props.enabled } : {}),
  });
  return (
    <form
      onSubmit={(event): void => {
        event.preventDefault();
        props.onSubmit?.(field.commit());
      }}
    >
      <label htmlFor="name">Name</label>
      <input id="name" value={name} onChange={(event): void => setName(event.target.value)} />
      <label htmlFor="key">Key</label>
      <input id="key" value={key} onChange={field.onChange} onBlur={field.onBlur} />
      <output data-testid="following">{field.following ? 'following' : 'edited'}</output>
      <button type="submit">Send</button>
    </form>
  );
}

describe('useDerivedKey', () => {
  it('follows the name, Polish diacritics folded', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Name'), 'Gotowe do wysyłki');
    expect(screen.getByLabelText('Key')).toHaveValue('gotowe_do_wysylki');
    expect(screen.getByTestId('following')).toHaveTextContent('following');
  });

  it('stops following once the operator edits the key', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Name'), 'Review');
    await userEvent.type(screen.getByLabelText('Key'), '_x');
    await userEvent.type(screen.getByLabelText('Name'), ' later');
    expect(screen.getByLabelText('Key')).toHaveValue('review_x');
    expect(screen.getByTestId('following')).toHaveTextContent('edited');
  });

  it('resumes following when the operator clears the key, and fills it from the name on blur', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Name'), 'Review');
    await userEvent.type(screen.getByLabelText('Key'), '_x');
    await userEvent.clear(screen.getByLabelText('Key'));
    expect(screen.getByTestId('following')).toHaveTextContent('following');
    await userEvent.type(screen.getByLabelText('Name'), ' done');
    expect(screen.getByLabelText('Key')).toHaveValue('review_done');
    await userEvent.clear(screen.getByLabelText('Key'));
    await userEvent.tab();
    expect(screen.getByLabelText('Key')).toHaveValue('review_done');
  });

  it('normalises what was typed on blur instead of refusing it', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Key'), 'In Review-Now');
    expect(screen.getByLabelText('Key')).toHaveValue('In Review-Now');
    await userEvent.tab();
    expect(screen.getByLabelText('Key')).toHaveValue('in_review_now');
    // Normalising is not an edit the name may overwrite.
    await userEvent.type(screen.getByLabelText('Name'), 'Other');
    expect(screen.getByLabelText('Key')).toHaveValue('in_review_now');
  });

  it('normalises on commit, for a form sent with Enter from the key field (no blur)', async () => {
    const sent: string[] = [];
    render(<Harness onSubmit={(key): void => void sent.push(key)} />);
    await userEvent.type(screen.getByLabelText('Key'), 'Ready For QA{Enter}');
    expect(sent).toEqual(['ready_for_qa']);
    expect(screen.getByLabelText('Key')).toHaveValue('ready_for_qa');
  });

  it('honours the separator and maxLength', async () => {
    render(<Harness separator="-" maxLength={8} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Summer sale');
    expect(screen.getByLabelText('Key')).toHaveValue('summer-s');
  });

  it('does nothing where the key is fixed', async () => {
    render(<Harness initialKey="stored_code" enabled={false} />);
    await userEvent.type(screen.getByLabelText('Name'), 'Renamed');
    expect(screen.getByLabelText('Key')).toHaveValue('stored_code');
  });

  it('treats a prefilled key that the name does not produce as edited', async () => {
    render(<Harness initialKey="kept" />);
    expect(screen.getByTestId('following')).toHaveTextContent('edited');
    await userEvent.type(screen.getByLabelText('Name'), 'Anything');
    expect(screen.getByLabelText('Key')).toHaveValue('kept');
  });
});
