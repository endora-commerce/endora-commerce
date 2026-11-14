import { describe, expect, it, vi } from 'vitest';
import type { OpportunityReadPort, OrderReadPort, QuoteRequestReadPort } from '@endora-commerce/contracts';
import { createLinkedRecordStatusNames } from './linked-record-status.js';

/**
 * Issue #455 — a linked record's status is shown by the name its owner gives
 * it in the reader's language, never as the raw code, and each owner is asked
 * through its own published read port.
 */
function names(
  overrides: {
    orders?: Partial<OrderReadPort>;
    quoteRequests?: Partial<QuoteRequestReadPort>;
    opportunities?: Partial<OpportunityReadPort>;
  } = {},
) {
  const orders = {
    findStatusDefinition: vi.fn(async (code: string) =>
      code === 'new' ? { code: 'new', name: { en: 'New', pl: 'Nowe' }, defaultName: 'New order' } : null,
    ),
    ...overrides.orders,
  };
  const quoteRequests = {
    statusName: vi.fn(async (status: string, language: string) => `${language}:${status}`),
    ...overrides.quoteRequests,
  };
  const opportunities = {
    statusName: vi.fn(async (code: string, language: string) => `${language}:${code}`),
    ...overrides.opportunities,
  };
  const subject = createLinkedRecordStatusNames({
    orders: orders as unknown as OrderReadPort,
    quoteRequests: quoteRequests as unknown as QuoteRequestReadPort,
    opportunities: opportunities as unknown as OpportunityReadPort,
  });
  return { subject, orders, quoteRequests, opportunities };
}

describe('linked record status names (issue #455)', () => {
  it('names an Order status as `orders` configures it, in the reader’s language', async () => {
    const { subject, orders } = names();
    expect(await subject.nameOf('order', 'new', 'pl')).toBe('Nowe');
    expect(await subject.nameOf('order', 'new', 'en')).toBe('New');
    expect(orders.findStatusDefinition).toHaveBeenCalledWith('new');
  });

  it('falls back to a regional name, then the default name, then the code', async () => {
    const { subject } = names({
      orders: {
        findStatusDefinition: vi.fn(async (code: string) =>
          code === 'regional'
            ? { code, name: { 'pl-PL': 'Regionalna' }, defaultName: 'Regional' }
            : code === 'defaulted'
              ? { code, name: {}, defaultName: 'Defaulted' }
              : null,
        ),
      },
    });
    expect(await subject.nameOf('order', 'regional', 'pl')).toBe('Regionalna');
    expect(await subject.nameOf('order', 'defaulted', 'pl')).toBe('Defaulted');
    expect(await subject.nameOf('order', 'gone', 'pl')).toBe('gone');
  });

  it('asks `quote_requests` and `crm` for their own names of their statuses', async () => {
    const { subject, quoteRequests, opportunities } = names();
    expect(await subject.nameOf('quote_request', 'Pending', 'pl')).toBe('pl:Pending');
    expect(quoteRequests.statusName).toHaveBeenCalledWith('Pending', 'pl');
    expect(await subject.nameOf('opportunity', 'proposal', 'en')).toBe('en:proposal');
    expect(opportunities.statusName).toHaveBeenCalledWith('proposal', 'en');
  });

  it('asks an owner once per status within one naming', async () => {
    const { subject, orders } = names();
    const many = await subject.namesOf(
      [
        { kind: 'order', status: 'new' },
        { kind: 'order', status: 'new' },
        { kind: 'quote_request', status: 'Pending' },
      ],
      'pl',
    );
    expect(many.get('order:new')).toBe('Nowe');
    expect(many.get('quote_request:Pending')).toBe('pl:Pending');
    expect(orders.findStatusDefinition).toHaveBeenCalledTimes(1);
  });
});
