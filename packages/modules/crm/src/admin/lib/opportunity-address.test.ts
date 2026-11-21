import { describe, expect, it } from 'vitest';
import {
  boardAddressRedirect,
  readListFilters,
  readListSort,
  readOpportunityView,
  withBoardFilters,
  withListFilters,
  withListSort,
  withOpportunityView,
  withoutOpportunityFilters,
} from './opportunity-address.js';
import { NO_SHARED_FILTERS } from '../components/OpportunityFilterFields.js';

/**
 * Issue #1558 (UX audit WORK-07, DEC-13) — the Opportunities list and the board
 * are one page, `/crm/opportunities`, the board at `?view=board`. **One address
 * holds the filters of both views**: switching view keeps every parameter, so
 * the filters the two views share carry over, and each view's own ones wait in
 * the address for it. Each view writes only the parameters it owns.
 */

const ORG = '00000000-0000-4000-8000-000000000001';
const params = (text: string): URLSearchParams => new URLSearchParams(text);

describe('the view in the address', () => {
  it('is the list without `view`, the board with `view=board`, and the list for anything else', () => {
    expect(readOpportunityView(params(''))).toBe('list');
    expect(readOpportunityView(params('view=board'))).toBe('board');
    expect(readOpportunityView(params('view=kanban'))).toBe('list');
  });

  it('switches view keeping every filter, the list being the bare address', () => {
    const address = params('q=fleet&state=open&f.custom:vip.is=true&cf.segment.in=smb');
    const board = withOpportunityView(address, 'board');
    expect(board.get('view')).toBe('board');
    expect(board.get('q')).toBe('fleet');
    expect(board.get('state')).toBe('open');
    expect(board.get('f.custom:vip.is')).toBe('true');
    expect(board.get('cf.segment.in')).toBe('smb');
    const list = withOpportunityView(board, 'list');
    expect(list.has('view')).toBe(false);
    expect(list.toString()).toBe(address.toString());
  });
});

describe('the list\'s filters in the address', () => {
  it('reads the shared filters the board writes, and the list\'s own state and status', () => {
    const read = readListFilters(params(`q=fleet&organizationId=${ORG}&assignee=me&state=won&status=negotiation`));
    expect(read.shared).toMatchObject({ q: 'fleet', organizationId: ORG, assignee: 'me' });
    expect(read.state).toBe('won');
    expect(read.statusCode).toBe('negotiation');
  });

  it('leaves out a state or a status that is not of its shape', () => {
    const read = readListFilters(params(`state=maybe&status=${'x'.repeat(200)}`));
    expect(read.state).toBe('');
    expect(read.statusCode).toBe('');
  });

  it('writes its filters without touching the board\'s card-field filters, the custom fields, the view or the sort', () => {
    const before = params('view=board&sort=value:desc&f.custom:vip.is=true&cf.segment.in=smb&q=old&state=open');
    const after = withListFilters(before, {
      shared: { ...NO_SHARED_FILTERS, q: 'new', organizationId: ORG },
      state: '',
      statusCode: 'won',
    });
    expect(after.get('view')).toBe('board');
    expect(after.get('sort')).toBe('value:desc');
    expect(after.get('f.custom:vip.is')).toBe('true');
    expect(after.get('cf.segment.in')).toBe('smb');
    expect(after.get('q')).toBe('new');
    expect(after.get('organizationId')).toBe(ORG);
    expect(after.has('state')).toBe(false);
    expect(after.get('status')).toBe('won');
  });

  it('drops the board\'s contact-person filter with the Organization it was chosen in', () => {
    const before = params(`organizationId=${ORG}&f.builtin:contact.in=${ORG}&f.custom:vip.is=true`);
    const same = withListFilters(before, { shared: { ...NO_SHARED_FILTERS, organizationId: ORG }, state: '', statusCode: '' });
    expect(same.get('f.builtin:contact.in')).toBe(ORG);
    const other = withListFilters(before, { shared: NO_SHARED_FILTERS, state: '', statusCode: '' });
    expect(other.has('f.builtin:contact.in')).toBe(false);
    expect(other.get('f.custom:vip.is')).toBe('true');
  });

  it('keeps the sort in the address, the default one out of it', () => {
    expect(readListSort(params(''))).toBe('createdAt:desc');
    expect(readListSort(params('sort=value:desc'))).toBe('value:desc');
    expect(readListSort(params('sort=title:asc'))).toBe('createdAt:desc');
    expect(withListSort(params('q=a'), 'value:desc').toString()).toBe('q=a&sort=value%3Adesc');
    expect(withListSort(params('q=a&sort=value:desc'), 'createdAt:desc').toString()).toBe('q=a');
  });
});

describe('the board\'s filters in the address', () => {
  it('writes the shared and card-field filters without touching the list\'s own, the view or the sort', () => {
    const before = params('view=board&sort=value:desc&state=open&status=won&cf.segment.in=smb&q=old&f.custom:vip.is=true');
    const after = withBoardFilters(before, {
      shared: { ...NO_SHARED_FILTERS, assignee: 'unassigned' },
      fields: { 'custom:seats': { min: '5' } },
    });
    expect(after.get('view')).toBe('board');
    expect(after.get('sort')).toBe('value:desc');
    expect(after.get('state')).toBe('open');
    expect(after.get('status')).toBe('won');
    expect(after.get('cf.segment.in')).toBe('smb');
    expect(after.has('q')).toBe(false);
    expect(after.has('f.custom:vip.is')).toBe(false);
    expect(after.get('assignee')).toBe('unassigned');
    expect(after.get('f.custom:seats.min')).toBe('5');
  });
});

describe('clearing the filters', () => {
  it('clears every filter of both views and keeps the view and the sort', () => {
    const cleared = withoutOpportunityFilters(
      params(`view=board&sort=value:desc&q=a&organizationId=${ORG}&state=open&status=won&cf.segment.in=smb&f.custom:vip.is=true`),
    );
    expect(cleared.toString()).toBe('view=board&sort=value%3Adesc');
  });
});

describe('the board\'s former address', () => {
  it('lands a bookmark on the board view of the one page, its filters kept', () => {
    expect(boardAddressRedirect('')).toBe('/crm/opportunities?view=board');
    expect(boardAddressRedirect('?assignee=me&f.custom:lead_source.in=referral')).toBe(
      '/crm/opportunities?assignee=me&f.custom%3Alead_source.in=referral&view=board',
    );
  });
});
