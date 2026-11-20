import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '@endora-commerce/admin-kit/components';

/**
 * Issue #1495 (UX audit CONTENT-13) — a list's search runs as the operator
 * types, not on Enter or a separate *Search* button (Doherty), and one request
 * goes out per pause rather than per keystroke.
 */
describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers the first value at once', () => {
    const { result } = renderHook(() => useDebouncedValue('first'));
    expect(result.current).toBe('first');
  });

  it('answers a new value only once it has stood for the delay', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value), {
      initialProps: { value: '' },
    });
    rerender({ value: 'h' });
    rerender({ value: 'he' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(result.current).toBe('');
    rerender({ value: 'hel' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    // Every keystroke restarts the wait.
    expect(result.current).toBe('');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('hel');
  });

  it('takes a delay of its own', () => {
    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 50), {
      initialProps: { value: 'a' },
    });
    rerender({ value: 'b' });
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(result.current).toBe('b');
  });
});
