import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TAB_ID,
  EVENTS_TAB_ID,
  ITEM_COUNT_LABEL_KEY,
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
  // User Story 21 put Events third (FR-133; research N-CAL12): the assertion
  // below gained one id and its name one clause — the order of the six that
  // were there is unchanged.
  it('are in the order the stories decided: the deal, its documents, what is planned, the conversation, the audit trail', () => {
    expect(OPPORTUNITY_TABS.map((tab) => tab.id)).toEqual([
      'overview',
      'links',
      'events',
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

  // This read "on the Links tab, and nothing on any other" until User Story 21:
  // Events carries a count too. What it held — that a count is deliberate, and
  // that no other tab has one — it still holds, for two tabs instead of one.
  //
  // Five since the owner asked for a number on every tab that lists something.
  // Overview and Change history hold no list of items to count.
  it('counts the items on Links, Notes and Attachments, the Events ahead and the unread Messages, and nothing on any other', () => {
    const counted = OPPORTUNITY_TABS.filter((tab) => tab.count !== undefined);
    expect(counted.map((tab) => tab.id)).toEqual([LINKS_TAB_ID, EVENTS_TAB_ID, 'notes', 'messages', 'attachments']);
    const links = [{ documentKind: 'order' }, { documentKind: 'quote_request' }];
    const opportunity = { links, upcomingEventCount: 1, noteCount: 3, unreadMessageCount: 6, attachmentCount: 4 } as never;
    expect(counted.map((tab) => tab.count?.(opportunity))).toEqual([2, 1, 3, 6, 4]);
  });

  it('says what a number is of wherever it is not a count of items', () => {
    const named = Object.fromEntries(OPPORTUNITY_TABS.map((tab) => [tab.id, tab.countLabelKey]));
    expect(named).toEqual({
      overview: undefined,
      links: undefined,
      events: 'opportunity.tabs.upcoming',
      notes: undefined,
      messages: 'opportunity.tabs.unread',
      attachments: undefined,
      history: undefined,
    });
    expect(ITEM_COUNT_LABEL_KEY).toBe('opportunity.tabs.counted');
  });

  it('puts Events third, under an id that is in the addresses a reminder writes', () => {
    expect(OPPORTUNITY_TABS[2]?.id).toBe('events');
    expect(EVENTS_TAB_ID).toBe('events');
    expect(OPPORTUNITY_TABS[2]?.labelKey).toBe('opportunity.tabs.events');
  });

  it('counts the Events that have not ended yet — `upcomingEventCount` — and zero is zero', () => {
    const events = OPPORTUNITY_TABS.find((tab) => tab.id === EVENTS_TAB_ID);
    expect(events?.count?.({ upcomingEventCount: 3, links: [] } as never)).toBe(3);
    // The strip draws no number for zero; the tab says zero and not `undefined`.
    expect(events?.count?.({ upcomingEventCount: 0, links: [] } as never)).toBe(0);
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

  it('opens Events for the address a reminder and a calendar entry lead to, keeping the Event it names', () => {
    const address = search('tab=events&event=00000000-0000-4000-8000-0000000000e9');
    expect(tabFromSearch(address)).toBe(EVENTS_TAB_ID);
    expect(searchForTab(address, EVENTS_TAB_ID).get('event')).toBe('00000000-0000-4000-8000-0000000000e9');
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
