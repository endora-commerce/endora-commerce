import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { useServerReorder, type UseServerReorderOptions } from '@endora-commerce/admin-kit/components';

/**
 * Issue #1633 — the server-backed batch reorder, extracted into the kit from
 * the copies `crm` and `tasks` carried since #1560. The row moves at once, one
 * save carries the whole list, a refusal rolls back and says so, and a 409
 * `ORDER_STALE` reloads the list and says that instead.
 */

interface Row {
  code: string;
  weight: number;
  name: string;
}

const ROWS: Row[] = [
  { code: 'a', weight: 10, name: 'A' },
  { code: 'b', weight: 20, name: 'B' },
  { code: 'c', weight: 30, name: 'C' },
];

function setup(overrides: Partial<UseServerReorderOptions<Row>> = {}) {
  const show = vi.fn();
  const save = vi.fn<(codes: string[]) => Promise<void>>().mockResolvedValue(undefined);
  const reload = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const options: UseServerReorderOptions<Row> = {
    rows: ROWS,
    show,
    save,
    reload,
    staleMessage: 'stale',
    failedMessage: () => 'failed',
    ...overrides,
  };
  const hook = renderHook(() => useServerReorder(options));
  return { hook, show, save, reload };
}

describe('useServerReorder', () => {
  it('moves the row at once, rewrites the weights and saves the whole list once', async () => {
    const { hook, show, save } = setup();
    act(() => hook.result.current.move('c', -1));
    expect(show).toHaveBeenCalledWith([
      { code: 'a', weight: 10, name: 'A' },
      { code: 'c', weight: 20, name: 'C' },
      { code: 'b', weight: 30, name: 'B' },
    ]);
    expect(hook.result.current.busy).toBe(true);
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(['a', 'c', 'b']);
    expect(hook.result.current.notice).toBeNull();
  });

  it('ignores a move past either end, of an unknown code, or while one is in flight', async () => {
    let resolveSave: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => { resolveSave = resolve; }));
    const { hook, show } = setup({ save });
    act(() => hook.result.current.move('a', -1));
    act(() => hook.result.current.move('c', 1));
    act(() => hook.result.current.move('zzz', 1));
    expect(show).not.toHaveBeenCalled();
    act(() => hook.result.current.move('a', 1));
    act(() => hook.result.current.move('b', 1));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave());
    expect(hook.result.current.busy).toBe(false);
  });

  it('rolls the list back and reports a refusal', async () => {
    const error = new ApiError(500, { error: { code: 'INTERNAL', message: 'Boom.' } });
    const failedMessage = vi.fn(() => 'failed');
    const { hook, show, reload } = setup({ save: vi.fn().mockRejectedValue(error), failedMessage });
    act(() => hook.result.current.move('b', 1));
    await waitFor(() => expect(hook.result.current.notice).toEqual({ kind: 'failed', message: 'failed' }));
    expect(failedMessage).toHaveBeenCalledWith(error);
    expect(show).toHaveBeenLastCalledWith(ROWS);
    expect(reload).not.toHaveBeenCalled();
    expect(hook.result.current.busy).toBe(false);
  });

  it('reloads the list on a 409 ORDER_STALE and says so', async () => {
    const error = new ApiError(409, { error: { code: 'ORDER_STALE', message: 'Stale.' } });
    const { hook, show, reload } = setup({ save: vi.fn().mockRejectedValue(error) });
    act(() => hook.result.current.move('b', 1));
    await waitFor(() => expect(hook.result.current.notice).toEqual({ kind: 'stale', message: 'stale' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('rolls back when the reload after ORDER_STALE fails too', async () => {
    const error = new ApiError(409, { error: { code: 'ORDER_STALE', message: 'Stale.' } });
    const { hook, show } = setup({
      save: vi.fn().mockRejectedValue(error),
      reload: vi.fn().mockRejectedValue(new Error('offline')),
    });
    act(() => hook.result.current.move('b', 1));
    await waitFor(() => expect(hook.result.current.busy).toBe(false));
    expect(hook.result.current.notice).toEqual({ kind: 'stale', message: 'stale' });
    expect(show).toHaveBeenLastCalledWith(ROWS);
  });
});
