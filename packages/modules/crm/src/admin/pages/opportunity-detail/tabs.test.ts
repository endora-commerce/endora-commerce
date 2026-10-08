import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB_ID,
  LINKS_TAB_ID,
  OPPORTUNITY_TABS,
  searchForTab,
  tabFromSearch,
} from './tabs.js';

/**
 * The tabs of the Opportunity screen and how an address selects one
 * (`specs/143-crm-sales-opportunities/`, User Story 20, FR-116 – FR-118).
 */

const search = (query: string): URLSearchParams => new URLSearchParams(query);

describe('the tabs of the Opportunity screen', () => {
  it('are in the order the story decided: the deal, its documents, the conversation, the audit trail', () => {
    expect(OPPORTUNITY_TABS.map((tab) => tab.id)).toEqual([
      'overview',
      'links',
      'notes',
      'messages',
      'attachments',
      'history',
    ]);
    expect(OPPORTUNITY_TABS[0]?.id).toBe(DEFAULT_TAB_ID);
  });

  it('keeps every id unique — an id is part of an address', () => {
    const ids = OPPORTUNITY_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts the linked documents on the Links tab, and nothing on any other', () => {
    const counted = OPPORTUNITY_TABS.filter((tab) => tab.count !== undefined);
    expect(counted.map((tab) => tab.id)).toEqual([LINKS_TAB_ID]);
    const links = [{ documentKind: 'order' }, { documentKind: 'quote_request' }];
    expect(counted[0]?.count?.({ links } as never)).toBe(2);
  });
});

describe('tabFromSearch', () => {
  it('opens the default tab for a bare address', () => {
    expect(tabFromSearch(search(''))).toBe(DEFAULT_TAB_ID);
  });

  it('opens the tab the address names', () => {
    for (const tab of OPPORTUNITY_TABS) expect(tabFromSearch(search(`tab=${tab.id}`))).toBe(tab.id);
  });

  it('opens the default tab for an id nobody declares', () => {
    expect(tabFromSearch(search('tab=calendar'))).toBe(DEFAULT_TAB_ID);
  });

  it('lands a return from creating a document on the Links tab — the address every create screen was handed', () => {
    expect(tabFromSearch(search('created=order'))).toBe(LINKS_TAB_ID);
    expect(tabFromSearch(search('created=quote_request'))).toBe(LINKS_TAB_ID);
  });

  it('lets an explicit tab win over the return marker', () => {
    expect(tabFromSearch(search('created=order&tab=notes'))).toBe('notes');
  });
});

describe('searchForTab', () => {
  it('names the tab in the address and keeps every other parameter', () => {
    expect(searchForTab(search('created=order'), 'notes').toString()).toBe('created=order&tab=notes');
  });

  it('leaves the default tab as the bare address', () => {
    expect(searchForTab(search('tab=links'), DEFAULT_TAB_ID).toString()).toBe('');
  });

  it('names the default tab explicitly while the return marker would otherwise select Links', () => {
    const next = searchForTab(search('created=order'), DEFAULT_TAB_ID);
    expect(tabFromSearch(next)).toBe(DEFAULT_TAB_ID);
  });

  it('round-trips: the address it writes selects the tab it was asked for', () => {
    for (const tab of OPPORTUNITY_TABS) {
      expect(tabFromSearch(searchForTab(search(''), tab.id))).toBe(tab.id);
    }
  });

  it('does not change the parameters it was given', () => {
    const given = search('tab=links');
    searchForTab(given, 'notes');
    expect(given.toString()).toBe('tab=links');
  });
});
