import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `loadCartItemCount` is what every cart badge calls from its effect. The
 * effects themselves do not run under `renderToString`, so the logic they share
 * lives here where it can be exercised.
 */

const action = vi.fn<() => Promise<number>>();
vi.mock('../../lib/actions/cart', () => ({
  getCartItemCountAction: () => action(),
}));

const { loadCartItemCount } = await import('../../lib/cartCount');

beforeEach(() => {
  action.mockReset();
});

describe('loadCartItemCount', () => {
  it('answers the count the server action reports', async () => {
    action.mockResolvedValue(4);
    await expect(loadCartItemCount()).resolves.toBe(4);
  });

  it('answers null when the read fails, so a badge keeps its last good value', async () => {
    action.mockRejectedValue(new Error('network'));
    await expect(loadCartItemCount()).resolves.toBeNull();
  });

  it('shares one in-flight read between the badges that ask at the same moment', async () => {
    let release: (n: number) => void = () => undefined;
    action.mockImplementation(() => new Promise<number>((resolve) => (release = resolve)));

    const header = loadCartItemCount();
    const mobileHeader = loadCartItemCount();
    const tabBar = loadCartItemCount();
    release(2);

    await expect(Promise.all([header, mobileHeader, tabBar])).resolves.toEqual([2, 2, 2]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('reads again once the previous read has settled', async () => {
    action.mockResolvedValueOnce(1).mockResolvedValueOnce(2);

    await expect(loadCartItemCount()).resolves.toBe(1);
    await expect(loadCartItemCount()).resolves.toBe(2);
    expect(action).toHaveBeenCalledTimes(2);
  });
});
