import { describe, expect, it } from 'vitest';
import type { TransactionalEmailSummary } from '@endora-commerce/contracts';

import {
  channelDisplayName,
  customizationOf,
  filterEmails,
  moduleOptions,
  ownerModuleLabel,
} from './labels.js';

/**
 * Issue #1536 (UX audit CONTENT-19) — the list and the editor name what the
 * API sends as codes: the sending module, the customisation, the channel.
 */

function email(patch: Partial<TransactionalEmailSummary> & { code: string }): TransactionalEmailSummary {
  return {
    name: patch.code,
    ownerModule: 'orders',
    group: null,
    active: true,
    languages: ['en-US'],
    hasGlobalOverride: false,
    hasChannelOverride: false,
    deactivatable: true,
    nonDeactivatableReason: null,
    ...patch,
  };
}

describe('ownerModuleLabel', () => {
  it("reads the module's own name in the reader's language", () => {
    expect(ownerModuleLabel('quote_requests', { quote_requests: { 'module.name': 'Zapytania ofertowe' } })).toBe(
      'Zapytania ofertowe',
    );
  });

  it('falls back to English, then to the id of a module that ships no name', () => {
    expect(ownerModuleLabel('orders', { orders: {} }, { orders: { 'module.name': 'Orders' } })).toBe('Orders');
    expect(ownerModuleLabel('acme_overlay', {}, {})).toBe('acme_overlay');
  });
});

describe('customizationOf', () => {
  it('tells default content from content customised for all channels, per channel, or both', () => {
    expect(customizationOf({ hasGlobalOverride: false, hasChannelOverride: false })).toBe('default');
    expect(customizationOf({ hasGlobalOverride: true, hasChannelOverride: false })).toBe('all');
    expect(customizationOf({ hasGlobalOverride: false, hasChannelOverride: true })).toBe('channels');
    expect(customizationOf({ hasGlobalOverride: true, hasChannelOverride: true })).toBe('both');
  });
});

describe('filterEmails and moduleOptions', () => {
  const label = (id: string): string => ({ orders: 'Zamówienia', quote_requests: 'Zapytania ofertowe' })[id] ?? id;
  const emails = [
    email({ code: 'order_confirmation', name: 'Order confirmation' }),
    email({ code: 'rfq_offer', name: 'Offer ready', ownerModule: 'quote_requests' }),
  ];

  it("matches the search against the name, the code and the module's name", () => {
    expect(filterEmails(emails, { q: 'confirm', module: '' }, label).map((e) => e.code)).toEqual(['order_confirmation']);
    expect(filterEmails(emails, { q: 'rfq_', module: '' }, label).map((e) => e.code)).toEqual(['rfq_offer']);
    expect(filterEmails(emails, { q: 'zapytania', module: '' }, label).map((e) => e.code)).toEqual(['rfq_offer']);
  });

  it('narrows to one module, and combines with the search', () => {
    expect(filterEmails(emails, { q: '', module: 'orders' }, label).map((e) => e.code)).toEqual(['order_confirmation']);
    expect(filterEmails(emails, { q: 'offer', module: 'orders' }, label)).toEqual([]);
  });

  it('offers each sending module once, by name, in alphabetical order', () => {
    expect(moduleOptions([...emails, email({ code: 'order_shipped' })], label)).toEqual([
      { value: 'orders', label: 'Zamówienia' },
      { value: 'quote_requests', label: 'Zapytania ofertowe' },
    ]);
  });
});

describe('channelDisplayName', () => {
  it("names a channel in the admin's language, by locale prefix, then English, then its code", () => {
    const channel = { code: 'b2b', name: { 'en-US': 'Wholesale', 'pl-PL': 'Hurt' } };
    expect(channelDisplayName(channel, 'pl')).toBe('Hurt');
    expect(channelDisplayName(channel, 'de')).toBe('Wholesale');
    expect(channelDisplayName({ code: 'b2b', name: {} }, 'en')).toBe('b2b');
  });
});
