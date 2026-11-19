import { describe, expect, it } from 'vitest';
import type { OpportunityBoardCardField } from '@endora-commerce/contracts';
import {
  BOARD_PRIMARY_FILTERS,
  LIST_PRIMARY_FILTERS,
  NO_SHARED_FILTERS,
  hiddenSharedFilterCount,
  type SharedOpportunityFilters,
} from '../components/OpportunityFilterFields.js';
import { DEFAULT_BOARD_CARD_FIELDS, hiddenBoardFilterCount } from './board-fields.js';

/** The counts on the CRM toolbars' *More filters* disclosure (issue #1505, WORK-05). */
const ORG = '00000000-0000-4000-8000-000000000001';
const shared = (patch: Partial<SharedOpportunityFilters>): SharedOpportunityFilters => ({
  ...NO_SHARED_FILTERS,
  ...patch,
});

describe('hiddenSharedFilterCount', () => {
  it('counts nothing on the board for its search, assignee and Organization', () => {
    expect(hiddenSharedFilterCount(shared({ q: 'rack', assignee: 'me', organizationId: ORG }), BOARD_PRIMARY_FILTERS)).toBe(0);
  });

  it('counts the Organization on the list, where it is folded away', () => {
    expect(hiddenSharedFilterCount(shared({ organizationId: ORG, assignee: 'me' }), LIST_PRIMARY_FILTERS)).toBe(1);
  });

  it('counts tags, the Sales Channel and the creation range once each, however many values they hold', () => {
    const folded = shared({ tagIds: ['a', 'b'], salesChannelId: 'c', createdFrom: '2026-01-01', createdTo: '2026-02-01' });
    expect(hiddenSharedFilterCount(folded, BOARD_PRIMARY_FILTERS)).toBe(3);
  });

  it('does not count "a person" before anybody is chosen, which narrows nothing', () => {
    expect(hiddenSharedFilterCount(shared({ assignee: 'person', assigneeId: null }), [])).toBe(0);
    expect(hiddenSharedFilterCount(shared({ assignee: 'person', assigneeId: 'u' }), [])).toBe(1);
  });
});

describe('hiddenBoardFilterCount', () => {
  const fields = DEFAULT_BOARD_CARD_FIELDS as readonly OpportunityBoardCardField[];
  const shownRef = fields.find((field) => field.kind === 'money' || field.kind === 'number')?.ref;

  it('adds each card-field filter of a field the cards show', () => {
    expect(shownRef).toBeDefined();
    expect(hiddenBoardFilterCount(shared({ tagIds: ['a'] }), { [shownRef!]: { min: '10' } }, fields)).toBe(2);
  });

  it('leaves out a filter of a field the cards no longer show, as it is not sent', () => {
    expect(hiddenBoardFilterCount(NO_SHARED_FILTERS, { 'custom:gone': { contains: 'x' } }, fields)).toBe(0);
  });
});
