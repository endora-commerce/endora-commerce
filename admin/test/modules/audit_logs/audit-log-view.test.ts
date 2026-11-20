import { describe, expect, it } from 'vitest';
import {
  actionFilterOptions,
  auditStateOutcome,
  hiddenAuditFilterCount,
  isIsoTimestamp,
  objectTypeFilterOptions,
} from '../../../../packages/modules/audit_logs/src/admin/lib/audit-log-view';

/**
 * Issue #1555 (UX audit SHELL-20) — the audit log's pure logic: an entry's
 * snapshots as field rows instead of two JSON blocks, and filter options built
 * from what the log holds instead of typed codes.
 */

describe('auditStateOutcome', () => {
  it('lists the fields an edit changed, before → after, and leaves the unchanged ones out', () => {
    expect(auditStateOutcome({ status: 'draft', version: 1, sku: 'A' }, { status: 'active', version: 2, sku: 'A' })).toEqual({
      kind: 'changes',
      changes: [
        { field: 'status', before: 'draft', after: 'active' },
        { field: 'version', before: 1, after: 2 },
      ],
    });
  });

  it('lists what a creation arrived with, as values without a before', () => {
    expect(auditStateOutcome(null, { changedFields: ['title', 'status'], number: 'Q-1', note: null })).toEqual({
      kind: 'changes',
      changes: [
        { field: 'changedFields', after: ['title', 'status'] },
        { field: 'number', after: 'Q-1' },
      ],
    });
  });

  it('strikes what a removal had through to nothing, rather than reading it as arrived', () => {
    expect(auditStateOutcome({ code: 'PL' }, null)).toEqual({
      kind: 'changes',
      changes: [{ field: 'code', before: 'PL', after: null }],
    });
  });

  it('says when nothing was recorded, and when both snapshots are equal', () => {
    expect(auditStateOutcome(null, null)).toEqual({ kind: 'none' });
    expect(auditStateOutcome({ a: 1 }, { a: 1 })).toEqual({ kind: 'unchanged' });
    expect(auditStateOutcome(null, { a: null })).toEqual({ kind: 'none' });
  });
});

describe('actionFilterOptions', () => {
  const label = (action: string): string => ({ 'product.update': 'Product updated', 'order.create': 'Order created' })[action] ?? action;

  it('labels each action as the table does, keeps its code beside it, and sorts by label', () => {
    expect(
      actionFilterOptions(
        [
          { action: 'product.update', moduleId: 'catalog' },
          { action: 'order.create', moduleId: 'core' },
          { action: 'zz.unlabelled', moduleId: 'core' },
        ],
        '',
        label,
      ),
    ).toEqual([
      { value: 'order.create', label: 'Order created', description: 'order.create' },
      { value: 'product.update', label: 'Product updated', description: 'product.update' },
      { value: 'zz.unlabelled', label: 'zz.unlabelled' },
    ]);
  });

  it('keeps a value from the URL that the log does not list, so the filter still shows it', () => {
    expect(actionFilterOptions([], 'price_list.rows_replace', label)).toEqual([
      { value: 'price_list.rows_replace', label: 'price_list.rows_replace' },
    ]);
  });
});

describe('objectTypeFilterOptions', () => {
  it('sorts the types and keeps the URL`s one', () => {
    expect(objectTypeFilterOptions(['product', 'order'], 'price_list').map((o) => o.value)).toEqual([
      'order',
      'price_list',
      'product',
    ]);
    expect(objectTypeFilterOptions(['product'], 'product')).toHaveLength(1);
  });
});

describe('hiddenAuditFilterCount', () => {
  it('counts the folded filters in use', () => {
    expect(hiddenAuditFilterCount({ objectId: '', customer: '' })).toBe(0);
    expect(hiddenAuditFilterCount({ objectId: 'x', customer: 'y' })).toBe(2);
  });
});

describe('isIsoTimestamp', () => {
  it('recognises a stored timestamp and nothing else', () => {
    expect(isIsoTimestamp('2026-11-20T10:00:00.000Z')).toBe(true);
    expect(isIsoTimestamp('2026-11-20')).toBe(false);
    expect(isIsoTimestamp('Q-2026-11')).toBe(false);
    expect(isIsoTimestamp(5)).toBe(false);
  });
});
