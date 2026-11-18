import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState, type ReactNode } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import axe from 'axe-core';
import { UnsavedChangesHint, useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import { renderWithI18n } from '../helpers/render-with-i18n';
import en from '../../../packages/modules/_i18n/i18n/en.json';
import pl from '../../../packages/modules/_i18n/i18n/pl.json';

/**
 * Issue #1446 (UX audit DS-13) — the kit's one unsaved-changes guard. A blocked
 * link or tab is asked about in the admin's own Save / Discard / Stay dialog and
 * replayed after the answer, so the navigation the operator chose is the one that
 * happens.
 */
const BUNDLE = { core: en as Record<string, string> };

const onSave = vi.fn<() => Promise<boolean>>();
const onDiscard = vi.fn<() => void>();

function Editor({ withSave = true }: { withSave?: boolean }): ReactNode {
  const [value, setValue] = useState('');
  const navigate = useNavigate();
  const panel = useRef<HTMLDivElement>(null);
  const guard = useUnsavedChangesGuard({
    dirty: value !== '',
    onSave: withSave ? onSave : undefined,
    onDiscard: () => {
      onDiscard();
      setValue('');
    },
    guardTabsOutside: panel,
  });
  return (
    <div>
      <Link to="/elsewhere">Leave</Link>
      <button type="button" role="tab" aria-selected="false" onClick={onHostTab}>
        Host tab
      </button>
      <div ref={panel}>
        <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="button" onClick={() => guard.confirm(() => navigate('/elsewhere'))}>
          Back
        </button>
        <UnsavedChangesHint dirty={value !== ''} />
      </div>
      {guard.dialog}
    </div>
  );
}
const onHostTab = vi.fn();

function renderEditor(props: { withSave?: boolean } = {}, bundle = BUNDLE, language: 'en' | 'pl' = 'en') {
  return renderWithI18n(
    <MemoryRouter initialEntries={['/editor']}>
      <Routes>
        <Route path="/editor" element={<Editor {...props} />} />
        <Route path="/elsewhere" element={<p>Elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
    bundle,
    { language },
  );
}

function edit(): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } });
}

describe('useUnsavedChangesGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    onSave.mockReset();
    onDiscard.mockReset();
    onHostTab.mockReset();
  });

  it('lets a link through while nothing is unsaved', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    expect(screen.getByText('Elsewhere')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks in its own dialog — never window.confirm — and Stay keeps the screen and the edits', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    const dialog = screen.getByRole('dialog', { name: en['form.unsavedChanges.title'] });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    // The safe answer has the initial focus (WCAG 3.3.4).
    expect(document.activeElement?.textContent).toBe(en['form.unsavedChanges.stay']);
    fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.stay'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');
    expect(screen.queryByText('Elsewhere')).toBeNull();
  });

  it('Discard runs onDiscard and replays the blocked link', () => {
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.discard'] }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Elsewhere')).toBeTruthy();
  });

  it('Save and continue navigates only after a successful save', async () => {
    onSave.mockResolvedValue(true);
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.save'] }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('Elsewhere')).toBeTruthy());
  });

  it('a refused save closes the dialog and stays, edits intact', async () => {
    onSave.mockResolvedValue(false);
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.save'] }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Elsewhere')).toBeNull();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');
  });

  it('without onSave offers Discard or Stay only', () => {
    renderEditor({ withSave: false });
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    expect(screen.queryByRole('button', { name: en['form.unsavedChanges.save'] })).toBeNull();
    expect(screen.getByRole('button', { name: en['form.unsavedChanges.discard'] })).toBeTruthy();
  });

  it('confirm(action) gates a screen’s own navigate()', () => {
    renderEditor();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Elsewhere')).toBeTruthy();
  });

  it('confirm(action) asks first while dirty and runs the action after Discard', () => {
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByText('Elsewhere')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.discard'] }));
    expect(screen.getByText('Elsewhere')).toBeTruthy();
  });

  it('guards a host tab outside the panel and replays it after Discard', () => {
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('tab', { name: 'Host tab' }));
    expect(onHostTab).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.discard'] }));
    expect(onHostTab).toHaveBeenCalledTimes(1);
  });

  it('arms beforeunload only while dirty', () => {
    renderEditor();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true);
    edit();
    expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false);
  });

  it('the dialog passes axe', async () => {
    renderEditor();
    edit();
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    const results = await axe.run(screen.getByRole('dialog'));
    expect(results.violations).toEqual([]);
  });

  it('ships its copy in Polish', () => {
    renderEditor({}, { core: pl as Record<string, string> }, 'pl');
    edit();
    expect(screen.getByTestId('unsaved-changes-hint').textContent).toBe(pl['form.unsavedChanges.hint']);
    fireEvent.click(screen.getByRole('link', { name: 'Leave' }));
    expect(screen.getByRole('dialog', { name: pl['form.unsavedChanges.title'] })).toBeTruthy();
    expect(screen.getByRole('button', { name: pl['form.unsavedChanges.save'] })).toBeTruthy();
  });
});

describe('UnsavedChangesHint', () => {
  it('is a live region mounted empty, and names the state in text when dirty', () => {
    const { rerender } = renderWithI18n(<UnsavedChangesHint dirty={false} />, BUNDLE);
    const hint = screen.getByTestId('unsaved-changes-hint');
    expect(hint.getAttribute('aria-live')).toBe('polite');
    expect(hint.textContent).toBe('');
    rerender(<UnsavedChangesHint dirty />);
    expect(screen.getByTestId('unsaved-changes-hint')).toBe(hint);
    expect(hint.textContent).toBe(en['form.unsavedChanges.hint']);
    // Not a `role="status"`: a screen's own save-result region stays the one status.
    expect(screen.queryByRole('status')).toBeNull();
  });
});
