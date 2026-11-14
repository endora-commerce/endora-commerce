import { describe, expect, it } from 'vitest';
import { DEFAULT_SORT, NO_FILTERS, readListAddress, writeListAddress } from './list-filters.js';

/**
 * The Projects list's filters as the address carries them (issue #454).
 *
 * The address is the state, so Back, a reload and a shared link keep the
 * filters; each parameter is named as `GET /projects` names it. What the
 * address carries that the list does not take — an unknown state, an id that
 * is not one, a sort the server does not serve — is ignored, never sent.
 */

const ORGANIZATION = '00000000-0000-4000-8000-0000000000a1';
const MEMBER = '00000000-0000-4000-8000-000000000c01';
const ROLE = '00000000-0000-4000-8000-000000000e02';
const TEMPLATE = '00000000-0000-4000-8000-0000000007a1';

const read = (query: string): ReturnType<typeof readListAddress> => readListAddress(new URLSearchParams(query));

describe('readListAddress', () => {
  it('reads nothing from an empty address', () => {
    expect(read('')).toEqual({ filters: NO_FILTERS, sort: DEFAULT_SORT });
  });

  it('reads every filter and the sort under the names the API takes', () => {
    const { filters, sort } = read(
      `q=PRJ-7&state=lost&organizationId=${ORGANIZATION}&memberId=${MEMBER}&roleId=${ROLE}` +
        `&templateId=${TEMPLATE}&stageName=Build&sort=value&order=asc`,
    );
    expect(filters).toEqual({
      ...NO_FILTERS,
      q: 'PRJ-7',
      state: 'lost',
      organizationId: ORGANIZATION,
      memberId: MEMBER,
      roleId: ROLE,
      templateId: TEMPLATE,
      stageName: 'Build',
    });
    expect(sort).toBe('value:asc');
  });

  it('reads memberId=me as "only mine"', () => {
    const { filters } = read('memberId=me');
    expect(filters.mine).toBe(true);
    expect(filters.memberId).toBeNull();
  });

  it('reads the custom-field filters through the kit’s cf.<key>.<op> parameters', () => {
    const { filters } = read('cf.region.contains=north');
    expect(Object.keys(filters.customFields)).toEqual(['region']);
  });

  it('ignores what the list does not take', () => {
    const { filters, sort } = read(
      'state=archived&organizationId=acme&memberId=someone&roleId=1&templateId=%27%3B&sort=title&order=desc' +
        `&stageName=${'x'.repeat(200)}&q=${'y'.repeat(201)}&unknown=1&cf.region=north`,
    );
    expect(filters).toEqual(NO_FILTERS);
    expect(sort).toBe(DEFAULT_SORT);
  });

  it('falls back to the sort’s own default direction for an order it does not know', () => {
    expect(read('sort=deadline&order=sideways').sort).toBe('deadline:asc');
    expect(read('sort=value').sort).toBe('value:desc');
  });

  it('keeps the first state it knows when the address repeats it', () => {
    expect(read('state=nope&state=completed&state=open').filters.state).toBe('completed');
  });
});

describe('writeListAddress', () => {
  it('writes nothing for no filters and the default sort', () => {
    expect(writeListAddress({ filters: NO_FILTERS, sort: DEFAULT_SORT }).toString()).toBe('');
  });

  it('round-trips through readListAddress', () => {
    const address = {
      filters: {
        ...NO_FILTERS,
        q: 'PRJ-7',
        state: 'open' as const,
        organizationId: ORGANIZATION,
        memberId: MEMBER,
        roleId: ROLE,
        templateId: TEMPLATE,
        stageName: 'Build',
        customFields: read('cf.region.contains=north').filters.customFields,
      },
      sort: 'deadline:desc' as const,
    };
    const written = writeListAddress(address);
    expect(written.get('organizationId')).toBe(ORGANIZATION);
    expect(written.get('cf.region.contains')).toBe('north');
    expect(readListAddress(written)).toEqual(address);
  });

  it('writes "only mine" as memberId=me, which wins over a member', () => {
    const written = writeListAddress({ filters: { ...NO_FILTERS, mine: true, memberId: MEMBER }, sort: DEFAULT_SORT });
    expect(written.getAll('memberId')).toEqual(['me']);
  });

  it('leaves out blank search text', () => {
    const written = writeListAddress({ filters: { ...NO_FILTERS, q: '   ', stageName: ' ' }, sort: DEFAULT_SORT });
    expect(written.toString()).toBe('');
  });
});
