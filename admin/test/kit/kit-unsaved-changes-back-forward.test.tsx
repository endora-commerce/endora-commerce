import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState, type ReactNode } from 'react';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom';
import { useUnsavedChangesGuard } from '@endora-commerce/admin-kit/components';
import { useUnsavedChangesPrompt } from '@endora-commerce/admin-kit/lib';
import { renderWithI18n } from '../helpers/render-with-i18n';
import en from '../../../packages/modules/_i18n/i18n/en.json';

/**
 * Issue #1605 — the browser's Back / Forward is a navigation the unsaved-changes
 * primitives ask about too, once the admin mounts a data router (`AdminRoot`'s
 * `createBrowserRouter`). Under a component router there is no blocker to use:
 * the primitives keep working and Back / Forward keeps the browser's behaviour.
 */
const BUNDLE = { core: en as Record<string, string> };

const onSave = vi.fn<() => Promise<boolean>>();
const onDiscard = vi.fn<() => void>();

function Where(): ReactNode {
  const location = useLocation();
  return <p data-testid="where">{location.pathname + location.search}</p>;
}

function Editor(): ReactNode {
  const [value, setValue] = useState('');
  const guard = useUnsavedChangesGuard({
    dirty: value !== '',
    onSave,
    onDiscard: () => {
      onDiscard();
      setValue('');
    },
  });
  return (
    <div>
      <Where />
      <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
      {guard.dialog}
    </div>
  );
}

function PromptEditor(): ReactNode {
  const [value, setValue] = useState('');
  useUnsavedChangesPrompt(value !== '');
  return (
    <div>
      <Where />
      <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />
    </div>
  );
}

function renderDataRouter(element: ReactNode, initialEntries = ['/list', '/editor']) {
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <Routes>
            <Route path="/list" element={<Where />} />
            <Route path="/editor" element={element} />
            <Route path="/other" element={<Where />} />
          </Routes>
        ),
      },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  renderWithI18n(<RouterProvider router={router} />, BUNDLE);
  return router;
}

function edit(): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Draft' } });
}

async function back(router: ReturnType<typeof createMemoryRouter>): Promise<void> {
  await act(async () => {
    await router.navigate(-1);
  });
}

function where(): string {
  return screen.getByTestId('where').textContent ?? '';
}

afterEach(() => {
  vi.restoreAllMocks();
  onSave.mockReset();
  onDiscard.mockReset();
});

describe('useUnsavedChangesGuard — browser Back / Forward (#1605)', () => {
  it('lets Back through while nothing is unsaved', async () => {
    const router = renderDataRouter(<Editor />);
    await back(router);
    expect(where()).toBe('/list');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before Back leaves a dirty screen, and Stay keeps the screen and the draft', async () => {
    const router = renderDataRouter(<Editor />);
    edit();
    await back(router);
    expect(screen.getByRole('dialog', { name: en['form.unsavedChanges.title'] })).toBeTruthy();
    expect(where()).toBe('/editor');

    fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.stay'] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/editor');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');

    // Stay reset the blocker: the next Back is asked about again, not swallowed.
    await back(router);
    expect(screen.getByRole('dialog', { name: en['form.unsavedChanges.title'] })).toBeTruthy();
  });

  it('Discard runs onDiscard and lets the Back through', async () => {
    const router = renderDataRouter(<Editor />);
    edit();
    await back(router);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.discard'] }));
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(where()).toBe('/list'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Save and continue goes Back only after a successful save', async () => {
    onSave.mockResolvedValue(true);
    const router = renderDataRouter(<Editor />);
    edit();
    await back(router);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.save'] }));
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(where()).toBe('/list'));
  });

  it('a refused save stays on the screen, draft intact', async () => {
    onSave.mockResolvedValue(false);
    const router = renderDataRouter(<Editor />);
    edit();
    await back(router);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: en['form.unsavedChanges.save'] }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/editor');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Draft');
  });

  it('asks about Forward the same way', async () => {
    const router = renderDataRouter(<Editor />, ['/editor', '/other']);
    await back(router);
    expect(where()).toBe('/editor');
    edit();
    await act(async () => {
      await router.navigate(1);
    });
    expect(screen.getByRole('dialog', { name: en['form.unsavedChanges.title'] })).toBeTruthy();
    expect(where()).toBe('/editor');
  });

  it('leaves a Back that changes only the query to the screen, which owns that state', async () => {
    const router = renderDataRouter(<Editor />, ['/editor?scope=a', '/editor?scope=b']);
    edit();
    await back(router);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(where()).toBe('/editor?scope=a');
  });

  it('under a component router it neither throws nor blocks', () => {
    renderWithI18n(
      <MemoryRouter initialEntries={['/editor']}>
        <Editor />
      </MemoryRouter>,
      BUNDLE,
    );
    edit();
    expect(where()).toBe('/editor');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useUnsavedChangesPrompt — browser Back / Forward (#1605)', () => {
  it('asks with window.confirm: cancel stays, OK goes back', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const router = renderDataRouter(<PromptEditor />);
    edit();
    await back(router);
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(where()).toBe('/editor');

    confirmSpy.mockReturnValue(true);
    await back(router);
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(where()).toBe('/list'));
  });
});
