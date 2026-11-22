import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';

import { TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { AdminRoot } from '../../../packages/admin-shell/src/AdminRoot';

/**
 * Issue #1605 — `AdminRoot` mounts a data router, so the browser's Back / Forward
 * reaches the unsaved-changes primitives: a dirty screen asks before the history
 * step leaves it. Under the component `<BrowserRouter>` it used to mount, React
 * Router had no blocker to offer and Back dropped the draft silently.
 */

vi.mock('@endora-commerce/admin-kit/lib', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@endora-commerce/admin-kit/lib')>()),
  AuthProvider: ({ children }: { children: ReactNode }): ReactNode => children,
}));

function LocationProbe(): ReactNode {
  return <p data-testid="location">{useLocation().pathname}</p>;
}

function Editor(): ReactNode {
  const [value, setValue] = useState('');
  useUnsavedChangesPrompt(value !== '');
  return <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />;
}

vi.mock('../../../packages/admin-shell/src/App', () => ({
  App: (): ReactNode => (
    <TranslationProvider language="en" initialBundle={{}}>
      <LocationProbe />
      <Link to="/editor">open editor</Link>
      <Routes>
        <Route path="/" element={<p>home</p>} />
        <Route path="/editor" element={<Editor />} />
      </Routes>
    </TranslationProvider>
  ),
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('AdminRoot — browser Back / Forward over unsaved changes', () => {
  it('asks before Back leaves a dirty screen, and goes back once the operator agrees', async () => {
    window.history.replaceState(null, '', '/');
    render(<AdminRoot contributions={[]} />);
    await act(async () => {
      fireEvent.click(screen.getByText('open editor'));
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/editor'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } });

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(confirmSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(window.location.pathname).toBe('/editor'));
    expect(screen.getByTestId('location').textContent).toBe('/editor');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');

    confirmSpy.mockReturnValue(true);
    await act(async () => {
      window.history.back();
    });
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    expect(window.location.pathname).toBe('/');
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });
});
