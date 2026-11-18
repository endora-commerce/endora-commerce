import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useDetailResource } from '@endora-commerce/admin-kit/lib';
import { DetailSkeleton, Skeleton } from '@endora-commerce/admin-kit/ui';
import { renderWithI18n } from '../helpers/render-with-i18n';
import { expectNoAxeViolations } from '../helpers/axe';

/**
 * Issue #1447 (UX audit DS-14) — a detail screen separates its first load from
 * a refresh. The first load is the only time the page has nothing to show, so it
 * is the only time a skeleton stands in for it; a refresh after an action keeps
 * the record on screen, marked `aria-busy`, so the tab, the scroll position and
 * the focus survive the re-read (SALES-06, Doherty threshold).
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useDetailResource', () => {
  it('starts in the first load, then holds the record', async () => {
    const first = deferred<{ name: string }>();
    const { result } = renderHook(() => useDetailResource('a', () => first.promise));

    expect(result.current.initialLoading).toBe(true);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.data).toBeNull();

    await act(async () => first.resolve({ name: 'A' }));

    expect(result.current.initialLoading).toBe(false);
    expect(result.current.data).toEqual({ name: 'A' });
    expect(result.current.error).toBeNull();
  });

  it('keeps the record on screen while it refreshes', async () => {
    const reads = [deferred<{ name: string }>(), deferred<{ name: string }>()];
    let call = 0;
    const { result } = renderHook(() => useDetailResource('a', () => reads[call++]!.promise));
    await act(async () => reads[0]!.resolve({ name: 'A' }));

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.refresh();
    });

    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.data).toEqual({ name: 'A' });

    await act(async () => {
      reads[1]!.resolve({ name: 'A2' });
      await pending;
    });

    expect(result.current.refreshing).toBe(false);
    expect(result.current.data).toEqual({ name: 'A2' });
  });

  it('a refresh that fails keeps the record and reports the error', async () => {
    const reads = [deferred<{ name: string }>(), deferred<{ name: string }>()];
    let call = 0;
    const { result } = renderHook(() => useDetailResource('a', () => reads[call++]!.promise));
    await act(async () => reads[0]!.resolve({ name: 'A' }));

    const failure = new Error('down');
    await act(async () => {
      const pending = result.current.refresh();
      reads[1]!.reject(failure);
      await pending;
    });

    expect(result.current.data).toEqual({ name: 'A' });
    expect(result.current.error).toBe(failure);
    expect(result.current.refreshing).toBe(false);
  });

  it('a first load that fails is an error, not a missing record', async () => {
    const failure = new Error('down');
    const { result } = renderHook(() => useDetailResource('a', () => Promise.reject(failure)));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe(failure);
  });

  it('a loader answering null is a missing record', async () => {
    const { result } = renderHook(() => useDetailResource('a', () => Promise.resolve(null)));
    await waitFor(() => expect(result.current.initialLoading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('a slower, earlier read never overwrites a later one', async () => {
    const reads = [deferred<string>(), deferred<string>(), deferred<string>()];
    let call = 0;
    const { result } = renderHook(() => useDetailResource('a', () => reads[call++]!.promise));
    await act(async () => reads[0]!.resolve('first'));

    let older!: Promise<void>;
    let newer!: Promise<void>;
    act(() => {
      older = result.current.refresh();
      newer = result.current.refresh();
    });
    await act(async () => {
      reads[2]!.resolve('newest');
      await newer;
    });
    await act(async () => {
      reads[1]!.resolve('stale');
      await older;
    });

    expect(result.current.data).toBe('newest');
    expect(result.current.refreshing).toBe(false);
  });

  it('a new key is a new first load and never shows the previous record', async () => {
    const reads: Record<string, Deferred<string>> = { a: deferred(), b: deferred() };
    const { result, rerender } = renderHook(({ id }: { id: string }) => useDetailResource(id, () => reads[id]!.promise), {
      initialProps: { id: 'a' },
    });
    await act(async () => reads.a!.resolve('record a'));
    expect(result.current.data).toBe('record a');

    rerender({ id: 'b' });

    expect(result.current.initialLoading).toBe(true);
    expect(result.current.data).toBeNull();

    await act(async () => reads.b!.resolve('record b'));
    expect(result.current.data).toBe('record b');
  });

  it('setData writes an answer the screen already has without a re-read', async () => {
    let calls = 0;
    const { result } = renderHook(() =>
      useDetailResource('a', () => {
        calls += 1;
        return Promise.resolve({ n: 1 });
      }),
    );
    await waitFor(() => expect(result.current.data).toEqual({ n: 1 }));

    act(() => result.current.setData({ n: 2 }));

    expect(result.current.data).toEqual({ n: 2 });
    expect(calls).toBe(1);
  });

  it('marks the content busy only while a refresh is in flight', async () => {
    const reads = [deferred<string>(), deferred<string>()];
    let call = 0;
    function Screen(): ReactNode {
      const resource = useDetailResource('a', () => reads[call++]!.promise);
      if (resource.initialLoading) return <p>first load</p>;
      return (
        <div data-testid="content" {...resource.busyProps}>
          <button type="button" onClick={(): void => void resource.refresh()}>
            {resource.data}
          </button>
        </div>
      );
    }
    render(<Screen />);
    await act(async () => reads[0]!.resolve('loaded'));
    expect(screen.getByTestId('content').hasAttribute('aria-busy')).toBe(false);

    act(() => screen.getByRole('button').click());
    expect(screen.getByTestId('content').getAttribute('aria-busy')).toBe('true');
    // The content never left the page.
    expect(screen.getByRole('button').textContent).toBe('loaded');

    await act(async () => reads[1]!.resolve('reloaded'));
    expect(screen.getByTestId('content').hasAttribute('aria-busy')).toBe(false);
  });
});

describe('Skeleton', () => {
  it('is decoration: hidden from assistive technology, and still under reduced motion', () => {
    render(<Skeleton data-testid="s" className="h-4 w-24" />);
    const el = screen.getByTestId('s');
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('data-slot')).toBe('skeleton');
    // The pulse runs only when the operator has not asked for less motion.
    expect(el.className).toContain('motion-safe:animate-pulse');
    expect(el.className).not.toMatch(/(^|\s)animate-pulse/);
    expect(el.className).toContain('h-4');
  });
});

describe('DetailSkeleton', () => {
  it('stands in for the page during the first load and says so to a screen reader', async () => {
    renderWithI18n(<DetailSkeleton />, { core: { 'common.state.loading': 'Loading…' } });
    const region = screen.getByRole('status');
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(region.textContent).toBe('Loading…');
    expect(region.getAttribute('data-slot')).toBe('detail-skeleton');
    await expectNoAxeViolations(region);
  });

  it('can name what is loading', () => {
    renderWithI18n(<DetailSkeleton label="Loading order" />, { core: {} });
    expect(screen.getByRole('status').textContent).toBe('Loading order');
  });
});
