import { describe, expect, it, vi } from 'vitest';
import type { EffectiveProductTexts } from '@endora-commerce/contracts';
import { backInStockNames } from './back-in-stock-names.js';

/**
 * Issue #696 — which name each back-in-stock subscriber is told: the effective name at the
 * subscription's (channel, language), or the Global name for a subscription that has no scope.
 */

const PRODUCT = { id: 'p-1', name: 'Drill X', sku: 'DRILL-X' };
const VIP = 'c-vip';
const RETAIL = 'c-retail';

function textsPort(answers: Record<string, string | undefined>) {
  const effectiveTexts = vi.fn(
    async (ids: readonly string[], scope: { channelId: string; languageCode: string | null }) => {
      const name = answers[`${scope.channelId}|${scope.languageCode ?? ''}`];
      const out = new Map<string, EffectiveProductTexts>();
      if (name !== undefined) for (const id of ids) out.set(id, { name, description: null });
      return out;
    },
  );
  return { effectiveTexts };
}

describe('backInStockNames', () => {
  it('names an unscoped (pre-#696) subscription by the Global name without asking catalog', async () => {
    const port = textsPort({});
    const names = await backInStockNames([{ id: 'n-1', salesChannelId: null, languageCode: null }], PRODUCT, port);
    expect(names.get('n-1')).toBe('Drill X');
    expect(port.effectiveTexts).not.toHaveBeenCalled();
  });

  it('falls back to the SKU when the Global name is empty', async () => {
    const names = await backInStockNames(
      [{ id: 'n-1', salesChannelId: null, languageCode: null }],
      { ...PRODUCT, name: '' },
      textsPort({}),
    );
    expect(names.get('n-1')).toBe('DRILL-X');
  });

  it('names each subscription at its own scope, asking once per distinct scope', async () => {
    const port = textsPort({ [`${VIP}|pl-PL`]: 'Wiertarka X Pro', [`${RETAIL}|`]: 'Drill X Retail' });
    const names = await backInStockNames(
      [
        { id: 'n-1', salesChannelId: VIP, languageCode: 'pl-PL' },
        { id: 'n-2', salesChannelId: VIP, languageCode: 'pl-PL' },
        { id: 'n-3', salesChannelId: RETAIL, languageCode: null },
        { id: 'n-4', salesChannelId: null, languageCode: null },
      ],
      PRODUCT,
      port,
    );
    expect(Object.fromEntries(names)).toEqual({
      'n-1': 'Wiertarka X Pro',
      'n-2': 'Wiertarka X Pro',
      'n-3': 'Drill X Retail',
      'n-4': 'Drill X',
    });
    expect(port.effectiveTexts).toHaveBeenCalledTimes(2);
    expect(port.effectiveTexts).toHaveBeenCalledWith(['p-1'], { channelId: VIP, languageCode: 'pl-PL' });
    expect(port.effectiveTexts).toHaveBeenCalledWith(['p-1'], { channelId: RETAIL, languageCode: null });
  });

  it('keeps the Global name where catalog answers nothing or an empty name', async () => {
    const port = textsPort({ [`${VIP}|pl-PL`]: '' });
    const names = await backInStockNames(
      [
        { id: 'n-1', salesChannelId: VIP, languageCode: 'pl-PL' },
        { id: 'n-2', salesChannelId: RETAIL, languageCode: 'pl-PL' },
      ],
      PRODUCT,
      port,
    );
    expect(names.get('n-1')).toBe('Drill X');
    expect(names.get('n-2')).toBe('Drill X');
  });
});
