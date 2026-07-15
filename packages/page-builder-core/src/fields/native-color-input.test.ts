import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebouncedColorCommit } from './color-input-debounce.js';

describe('createDebouncedColorCommit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces commits and flushes immediately on commitNow', () => {
    const onCommit = vi.fn();
    const scheduler = createDebouncedColorCommit(onCommit, 200);

    scheduler.schedule('#111111');
    expect(onCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(onCommit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onCommit).toHaveBeenCalledWith('#111111');

    onCommit.mockClear();
    scheduler.schedule('#222222');
    scheduler.commitNow('#333333');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith('#333333');
  });
});
