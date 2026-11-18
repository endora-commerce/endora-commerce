import { describe, expect, it } from 'vitest';
import { clauseIn, selectClauses, type ClauseRow } from './return-clause-service.js';

/**
 * `specs/180-off-platform-complaints/` T108 (D-1, FR-B30, research R-14): which clauses
 * a submission shows — the channel's and the channel-less active ones whose `appliesTo`
 * matches the kind, by weight — and never a `must_accept` clause on a consumer's
 * withdrawal.
 */
const CHANNEL = 'ch-1';
const row = (id: string, over: Partial<ClauseRow> = {}): ClauseRow => ({
  id,
  label: { en: `Label ${id}`, pl: `Etykieta ${id}` },
  text: { en: `Text ${id}` },
  linkUrl: null,
  appliesTo: 'both',
  mode: 'must_accept',
  salesChannelId: null,
  weight: 100,
  isActive: true,
  revision: 1,
  ...over,
});

const ROWS: ClauseRow[] = [
  row('global-late', { weight: 50 }),
  row('channel', { salesChannelId: CHANNEL, weight: 10 }),
  row('other-channel', { salesChannelId: 'ch-2' }),
  row('complaints-only', { appliesTo: 'complaint', weight: 20 }),
  row('returns-only', { appliesTo: 'return', weight: 30 }),
  row('informing', { mode: 'inform_only', weight: 40 }),
  row('inactive', { isActive: false }),
];

describe('selectClauses', () => {
  it('answers the active clauses of the channel and the channel-less ones for the kind, by weight', () => {
    const ids = (kind: 'return' | 'complaint') =>
      selectClauses(ROWS, { salesChannelId: CHANNEL, kind, consumerWithdrawal: false }).map((c) => c.id);
    expect(ids('complaint')).toEqual(['channel', 'complaints-only', 'informing', 'global-late']);
    expect(ids('return')).toEqual(['channel', 'returns-only', 'informing', 'global-late']);
  });

  it('shows no must_accept clause on a consumer’s withdrawal, and keeps the inform_only ones (D-1)', () => {
    const shown = selectClauses(ROWS, { salesChannelId: CHANNEL, kind: 'return', consumerWithdrawal: true });
    expect(shown.map((c) => c.id)).toEqual(['informing']);
  });

  it('answers nothing for a kind no clause applies to', () => {
    const only = [row('r', { appliesTo: 'return' })];
    expect(selectClauses(only, { salesChannelId: CHANNEL, kind: 'complaint', consumerWithdrawal: false })).toEqual([]);
  });
});

describe('clauseIn', () => {
  it('answers the request language, falling back to the default language', () => {
    expect(clauseIn(row('x'), 'pl')).toMatchObject({ language: 'pl', label: 'Etykieta x', text: 'Text x' });
    expect(clauseIn(row('x', { linkUrl: { en: 'https://shop.example/terms' } }), 'pl').linkUrl).toBe('https://shop.example/terms');
  });
});
