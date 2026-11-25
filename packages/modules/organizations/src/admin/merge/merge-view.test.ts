import { describe, expect, it } from 'vitest';
import type { OrganizationMergePreview, RecordMergeStep } from '@endora-commerce/contracts';
import {
  canStart,
  fieldValueText,
  incompleteModules,
  isCancellable,
  noticeMessage,
  participantLabel,
  phasesOf,
  progressOf,
  refusalMessage,
  totalMoving,
  type Translate,
} from './merge-view.js';

/** `specs/192-organization-merge/` T074 — the merge screens' rules, without a DOM. */

const BUNDLES: Record<string, Record<string, string>> = {
  core: {
    'errors.RECORD_MERGE_PARTICIPATION_INCOMPLETE': 'Cannot start yet ({modules}).',
    'errors.RECORD_MERGE_PARTICIPANT_CONFLICT': '{module} reports a conflict.',
  },
  organizations: {
    'errors.ORGANIZATION_MERGE_TREE_INVALID': 'Tree.',
    'errors.ORGANIZATION_MERGE_TREE_INVALID.ancestor': 'Above in the tree.',
    'vatStatus.vat_payer': 'VAT payer',
    'merge.warning.API_KEY_BOUND_KEYS_REPOINTED': '{count} keys re-pointed.',
  },
  orders: { 'module.name': 'Orders', 'errors.RECORD_MERGE_BUSY': 'An order is being placed.', 'merge.warning.OPEN_PLACEMENT': 'Open placement.' },
  crm: { 'module.name': 'CRM' },
};

const t: Translate = (scope, key, params) => {
  const template = BUNDLES[scope]?.[key];
  if (template === undefined) return `${scope}.${key}`;
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params?.[name] ?? ''));
};

const step = (overrides: Partial<RecordMergeStep>): RecordMergeStep => ({
  moduleId: 'orders',
  key: 'orders',
  phase: 'records',
  state: 'pending',
  movedCount: 0,
  deferredReason: null,
  lastErrorCode: null,
  trailing: false,
  ...overrides,
});

const preview = (overrides: Partial<OrganizationMergePreview> = {}): OrganizationMergePreview => ({
  refusals: [],
  fields: [],
  customFields: [],
  participants: [],
  incomplete: [],
  ...overrides,
});

describe('refusalMessage', () => {
  it('names the modules a start waits for by their own names', () => {
    expect(refusalMessage(t, { code: 'RECORD_MERGE_PARTICIPATION_INCOMPLETE', details: { modules: ['orders', 'crm', 'x'] } })).toBe(
      'Cannot start yet (Orders, CRM, x).',
    );
  });

  it('prefers the token sentence of a host refusal', () => {
    expect(refusalMessage(t, { code: 'ORGANIZATION_MERGE_TREE_INVALID', details: { code: 'ancestor' } })).toBe('Above in the tree.');
    expect(refusalMessage(t, { code: 'ORGANIZATION_MERGE_TREE_INVALID', details: { code: 'other' } })).toBe('Tree.');
  });

  it('reads a participant refusal from that module’s bundle, and shows an unknown code as is', () => {
    expect(refusalMessage(t, { code: 'RECORD_MERGE_BUSY', details: { module: 'orders' } })).toBe('An order is being placed.');
    expect(refusalMessage(t, { code: 'SOMETHING_NEW' })).toBe('SOMETHING_NEW');
  });
});

describe('the preview', () => {
  it('may start only with no refusal, and lists the incomplete modules', () => {
    expect(canStart(null)).toBe(false);
    expect(canStart(preview())).toBe(true);
    const incomplete = preview({
      refusals: [{ code: 'RECORD_MERGE_PARTICIPATION_INCOMPLETE', details: { modules: ['crm'] } }],
    });
    expect(canStart(incomplete)).toBe(false);
    expect(incompleteModules(incomplete)).toEqual(['crm']);
    expect(incompleteModules(preview({ incomplete: ['orders'] }))).toEqual(['orders']);
  });

  it('sums what would follow the survivor over every participant', () => {
    expect(
      totalMoving(
        preview({
          participants: [
            { moduleId: 'orders', key: 'orders', phase: 'records', counts: { 'Order.organizationId': 3 }, conflicts: [], warnings: [] },
            { moduleId: 'carts', key: 'carts', phase: 'records', counts: { 'Cart.organizationId': 1, 'Line.x': 2 }, conflicts: [], warnings: [] },
          ],
        }),
      ),
    ).toBe(6);
  });
});

describe('the progress', () => {
  it('is cancellable only before any step moved a record', () => {
    expect(isCancellable({ state: 'running', steps: [step({})] })).toBe(true);
    expect(isCancellable({ state: 'needs_attention', steps: [step({ state: 'deferred' })] })).toBe(true);
    expect(isCancellable({ state: 'running', steps: [step({ state: 'running' })] })).toBe(false);
    expect(isCancellable({ state: 'running', steps: [step({ movedCount: 1 })] })).toBe(false);
    expect(isCancellable({ state: 'completed', steps: [] })).toBe(false);
  });

  it('groups the steps by phase in order, with finalize last', () => {
    const phases = phasesOf({
      state: 'running',
      steps: [
        step({ moduleId: 'organizations', key: 'host-structure', phase: 'structure', state: 'done', movedCount: 2 }),
        step({ moduleId: 'orders', phase: 'records', state: 'failed', lastErrorCode: 'DB_TIMEOUT' }),
        step({ moduleId: 'addresses', key: 'addresses', phase: 'addresses', state: 'deferred', deferredReason: 'module_off' }),
      ],
    });
    expect(phases.map((p) => [p.phase, p.state])).toEqual([
      ['structure', 'done'],
      ['addresses', 'done'],
      ['records', 'failed'],
      ['finalize', 'pending'],
    ]);
    expect(progressOf({ state: 'running', steps: phases.flatMap((p) => p.steps) })).toEqual({ done: 2, total: 4 });
  });
});

describe('fieldValueText', () => {
  const own = (key: string, params?: Record<string, string | number>): string => t('organizations', key, params);
  it('says a value in a line, and an empty one as null', () => {
    expect(fieldValueText('name', 'Acme', own)).toBe('Acme');
    expect(fieldValueText('legalName', null, own)).toBeNull();
    expect(fieldValueText('vatStatus', 'vat_payer', own)).toBe('VAT payer');
    expect(fieldValueText('registeredAddress', { street: 'ul. Prosta 1', postalCode: '90-001', city: 'Łódź', country: 'PL' }, own)).toBe(
      'ul. Prosta 1, 90-001 Łódź, PL',
    );
    expect(fieldValueText('fulfilmentStrategy', { strategy: null, warehouseOrder: null }, own)).toBeNull();
  });
});

describe('participant notices and labels, for codes and modules this screen was not built with', () => {
  it('words a warning from the participant’s bundle, then this module’s, filling string and number details only', () => {
    expect(noticeMessage(t, 'warning', 'orders', { code: 'OPEN_PLACEMENT' })).toBe('Open placement.');
    expect(
      noticeMessage(t, 'warning', 'api_keys', { code: 'API_KEY_BOUND_KEYS_REPOINTED', details: { count: 3, ids: ['a', 'b', 'c'] } }),
    ).toBe('3 keys re-pointed.');
    expect(noticeMessage(t, 'conflict', 'unknown_module', { code: 'SOMETHING' })).toBe('SOMETHING');
    // Reported as a conflict, worded as a warning: the other kind's sentence.
    expect(noticeMessage(t, 'conflict', 'orders', { code: 'OPEN_PLACEMENT' })).toBe('Open placement.');
  });

  it('names a participant by its module, with its key when the key is not the module id', () => {
    expect(participantLabel(t, 'orders', 'orders')).toBe('Orders');
    expect(participantLabel(t, 'price_lists', 'price-lists')).toBe('price_lists');
    expect(participantLabel(t, 'orders', 'order-notes')).toBe('Orders (order-notes)');
  });
});
