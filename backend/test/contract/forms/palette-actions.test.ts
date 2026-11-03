import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contributions as formsAdmin } from '@endora-commerce/mod-forms/admin';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import {
  actionRouteFindings,
  expectDeclared,
  expectLabels,
  expectTargetsOwnRoutes,
  type ExpectedAction,
} from '../projects/palette-actions-shared.js';

/**
 * Forms under ⌘K (`specs/170-forms-module/` US1-8, T031; `contracts/admin-surfaces.md` §2): the three
 * actions, each on a screen of the module's own, gated by the code that screen and its API enforce,
 * and labelled in both shipped languages.
 */
const EXPECTED: readonly ExpectedAction[] = [
  {
    id: 'open-forms',
    route: '/forms',
    permission: 'forms:read',
    icon: 'ClipboardList',
    label: { en: 'Forms', pl: 'Formularze' },
  },
  {
    id: 'new-form',
    route: '/forms/new',
    permission: 'forms:write',
    icon: 'FilePlus',
    label: { en: 'New form', pl: 'Nowy formularz' },
  },
  {
    id: 'open-form-entries',
    route: '/forms/entries',
    permission: 'forms:entries_read',
    icon: 'Inbox',
    label: { en: 'Form entries', pl: 'Zgłoszenia z formularzy' },
  },
];

describe('forms palette actions (170 US1-8, T031)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  }, 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('declares the actions of §2', () => {
    expectDeclared('forms', EXPECTED);
  });

  it('each opens a screen of the module’s own admin layer, on the action’s code', () => {
    expectTargetsOwnRoutes('forms', formsAdmin);
  });

  it('each resolves to a real API route with that route’s permission (check:action-route-permissions)', () => {
    const result = actionRouteFindings('forms');
    expect(result.violations).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.ledgered).toEqual([]);
  });

  it('serves them, labelled in English and Polish', async () => {
    await expectLabels(h, 'forms', EXPECTED);
  });
});
