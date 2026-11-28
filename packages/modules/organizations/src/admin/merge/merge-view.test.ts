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
  participantCounts,
  shownInPreview,
  totalMoving,
  type Translate, mergeFieldRefusals } from './merge-view.js';

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
  crm: { 'module.name': 'CRM', 'merge.participation.organization-opportunities': 'opportunities' },
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

  it('names a participant by its module, with the module’s own words for the part when it has them, never by its key', () => {
    expect(participantLabel(t, 'orders', 'orders')).toBe('Orders');
    expect(participantLabel(t, 'price_lists', 'price-lists')).toBe('price_lists');
    expect(participantLabel(t, 'orders', 'order-notes')).toBe('Orders');
    expect(participantLabel(t, 'crm', 'organization-opportunities')).toBe('CRM — opportunities');
  });
});

describe('deleted records in the preview', () => {
  const participant = {
    moduleId: 'addresses',
    key: 'addresses',
    phase: 'addresses',
    counts: { 'Address.organizationId': 24 },
    deletedCounts: { 'Address.organizationId': 22 },
    conflicts: [],
    warnings: [],
  };

  it('counts what the operator still sees, and the deleted rows apart', () => {
    expect(participantCounts(participant)).toEqual({ visible: 2, deleted: 22 });
    expect(participantCounts({ ...participant, deletedCounts: undefined })).toEqual({ visible: 24, deleted: 0 });
  });

  it('leaves the deleted rows out of what the confirmation says moves', () => {
    expect(totalMoving(preview({ participants: [participant] }))).toBe(2);
  });
});

describe('which participants the preview lists', () => {
  const row = { moduleId: 'orders', key: 'orders', phase: 'records', counts: { 'Order.organizationId': 0 }, conflicts: [], warnings: [] };

  it('lists one that moves something, has deleted rows, a conflict or a warning, and leaves out the rest', () => {
    expect(shownInPreview(row)).toBe(false);
    expect(shownInPreview({ ...row, counts: { 'Order.organizationId': 1 } })).toBe(true);
    expect(shownInPreview({ ...row, counts: { 'Order.organizationId': 2 }, deletedCounts: { 'Order.organizationId': 2 } })).toBe(true);
    expect(shownInPreview({ ...row, warnings: [{ code: 'W' }] })).toBe(true);
    expect(shownInPreview({ ...row, conflicts: [{ code: 'C', resolution: 'survivor' }] })).toBe(true);
  });
});

describe('mergeFieldRefusals (193 D-300.28)', () => {
  it('maps a rule refusal onto its row, the warehouse order onto the fulfilment row, and the union apart', () => {
    expect(
      mergeFieldRefusals(
        {
          code: 'FIELD_RULE_VIOLATION',
          details: [
            { path: 'name', code: 'too_long', message: 'Too long.' },
            { path: 'fulfilmentStrategyWarehouseOrder', code: 'required', message: 'Pick one.' },
            { path: 'orderConfirmationEmails', code: 'pattern', message: 'Use the company domain.' },
          ],
        },
        'Forbidden.',
      ),
    ).toEqual({
      fields: { name: 'Too long.', fulfilmentStrategy: 'Pick one.' },
      union: { message: 'Use the company domain.', permission: null },
    });
  });

  it('says a forbidden field in the screen’s own words, and names the permission a union needs', () => {
    expect(
      mergeFieldRefusals(
        {
          code: 'FIELD_WRITE_FORBIDDEN',
          details: [
            { path: 'vatStatus', permission: 'a:b', message: 'raw' },
            { path: 'orderConfirmationEmails', permission: 'acme:recipients', message: 'raw' },
          ],
        },
        'You may not change this.',
      ),
    ).toEqual({ fields: { vatStatus: 'You may not change this.' }, union: { message: 'You may not change this.', permission: 'acme:recipients' } });
  });

  it('is not a field refusal for any other error', () => {
    expect(mergeFieldRefusals({ code: 'ORGANIZATION_MERGED', details: [] }, 'x')).toBeNull();
    expect(mergeFieldRefusals({ code: 'FIELD_RULE_VIOLATION' }, 'x')).toBeNull();
  });
});
