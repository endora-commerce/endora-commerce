import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import type { RenderResult } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  OpportunityDetail,
  OpportunitySummary,
  OpportunityWorkflow,
  PropagationOutcome,
} from '@endora-commerce/contracts';
import { AppLanguageContext } from '@endora-commerce/admin-kit/i18n';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { adminSession, modulePresence, withSession } from '../../helpers/render-with-session';

/**
 * Shared fixtures of the CRM screen tests
 * (`specs/143-crm-sales-opportunities/`, User Story 1).
 *
 * **The screens are rendered over the shipped English bundles**, read from the
 * module's own `i18n/en.json` and from `_i18n`'s. A test therefore names a
 * control by the sentence an operator reads, through {@link en} — which throws
 * for a key the bundle does not carry, so a screen asking for a key nobody
 * wrote fails here rather than rendering `crm.some.key` in production.
 */

function shippedBundle(relativePath: string): Record<string, string> {
  return JSON.parse(readFileSync(resolve(process.cwd(), relativePath), 'utf8')) as Record<
    string,
    string
  >;
}

const CRM_BUNDLE = shippedBundle('../packages/modules/crm/i18n/en.json');
const CORE_BUNDLE = shippedBundle('../packages/modules/_i18n/i18n/en.json');

function sentence(
  bundle: Record<string, string>,
  scope: string,
  key: string,
  params: Record<string, string | number> = {},
): string {
  const template = bundle[key];
  if (template === undefined) {
    throw new Error(`[crm fixtures] the shipped English ${scope} bundle has no key "${key}".`);
  }
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** The English sentence of one of the module's own keys. */
export function en(key: string, params?: Record<string, string | number>): string {
  return sentence(CRM_BUNDLE, 'crm', key, params);
}

/** The English sentence of a key the host's shared bundle owns. */
export function core(key: string, params?: Record<string, string | number>): string {
  return sentence(CORE_BUNDLE, 'core', key, params);
}

export const EVERY_CRM_PERMISSION = ['crm:read', 'crm:write', 'crm:configure', 'orders:read'];

/**
 * Mount a screen at `path` (matched against `pattern`) under the real session
 * and presence providers, in English.
 */
export function renderCrm(
  ui: ReactElement,
  options: {
    readonly permissions?: readonly string[];
    readonly path?: string;
    readonly pattern?: string;
  } = {},
): RenderResult {
  const path = options.path ?? '/';
  return renderWithI18n(
    withSession(
      <AppLanguageContext.Provider value={{ language: 'en', setLanguage: (): void => {} }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={options.pattern ?? '*'} element={ui} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: options.permissions ?? EVERY_CRM_PERMISSION }),
        presence: modulePresence({ present: ['crm', 'orders', 'organizations', 'sales_channels'] }),
        registry: [],
      },
    ),
    { core: CORE_BUNDLE, crm: CRM_BUNDLE },
  );
}

export const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
export const OPPORTUNITY_ID = '00000000-0000-4000-8000-0000000000b1';
export const ORDER_ID = '00000000-0000-4000-8000-0000000000c1';
export const LINK_ID = '00000000-0000-4000-8000-0000000000d1';
export const PROPAGATION_ID = '00000000-0000-4000-8000-0000000000e1';

/** The seeded workflow, as `GET /api/v1/admin/crm/workflow` answers it. */
export const WORKFLOW: OpportunityWorkflow = {
  statuses: [
    { code: 'new', name: { en: 'New', pl: 'Nowa' }, defaultName: 'New', kind: 'open', isInitial: true, weight: 10, color: '#64748b', inUseCount: 3 },
    { code: 'qualified', name: { en: 'Qualified', pl: 'Zakwalifikowana' }, defaultName: 'Qualified', kind: 'open', isInitial: false, weight: 20, color: '#3b82f6', inUseCount: 0 },
    { code: 'negotiation', name: { en: 'Negotiation', pl: 'Negocjacje' }, defaultName: 'Negotiation', kind: 'open', isInitial: false, weight: 40, color: '#f59e0b', inUseCount: 0 },
    { code: 'won', name: { en: 'Won', pl: 'Wygrana' }, defaultName: 'Won', kind: 'won', isInitial: false, weight: 90, color: '#10b981', inUseCount: 0 },
    { code: 'lost', name: { en: 'Lost', pl: 'Przegrana' }, defaultName: 'Lost', kind: 'lost', isInitial: false, weight: 100, color: '#ef4444', inUseCount: 0 },
  ],
  transitions: [
    { fromStatusCode: 'new', toStatusCode: 'qualified' },
    { fromStatusCode: 'new', toStatusCode: 'lost' },
    { fromStatusCode: 'qualified', toStatusCode: 'negotiation' },
    { fromStatusCode: 'negotiation', toStatusCode: 'won' },
  ],
  orderStatusMappings: [],
  valueCountingStatuses: { order: [], quoteRequest: [] },
};

/** `GET /api/v1/admin/orders/statuses`, reduced to what the CRM screens read. */
export const ORDER_STATUS_GRAPH = {
  statuses: [
    { code: 'new', name: { en: 'New' }, defaultName: 'New', color: '#64748b' },
    { code: 'paid', name: { en: 'Paid' }, defaultName: 'Paid', color: '#10b981' },
    { code: 'completed', name: { en: 'Completed' }, defaultName: 'Completed', color: '#0d9488' },
  ],
  transitions: [],
};

export function summary(overrides: Partial<OpportunitySummary> = {}): OpportunitySummary {
  return {
    id: OPPORTUNITY_ID,
    number: 'OPP-000001',
    title: 'Fleet renewal',
    organization: { id: ORGANIZATION_ID, name: 'Acme' },
    status: { code: 'new', name: 'New', color: '#64748b', kind: 'open' },
    assignee: null,
    value: '12500.00',
    valueMode: 'manual',
    currency: 'PLN',
    salesChannelId: null,
    expectedCloseDate: '2026-12-01',
    tags: [],
    closedAt: null,
    closedKind: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

export function detail(overrides: Partial<OpportunityDetail> = {}): OpportunityDetail {
  return {
    ...summary(),
    description: 'Forty vans over two years.',
    references: [],
    customerAccount: null,
    manualValue: '12500.00',
    computedValue: '0.00',
    excludedDocuments: [],
    source: 'manual',
    version: 1,
    allowedTransitions: [
      { code: 'qualified', name: 'Qualified', color: '#3b82f6', kind: 'open' },
      { code: 'lost', name: 'Lost', color: '#ef4444', kind: 'lost' },
    ],
    links: [
      {
        id: LINK_ID,
        documentKind: 'order',
        documentId: ORDER_ID,
        available: true,
        number: 'ORD-1001',
        status: 'new',
        total: '990.00',
        currency: 'PLN',
        syncStatus: true,
        linkSource: 'manual',
        createdAt: '2026-10-05T10:05:00.000Z',
      },
    ],
    unresolvedPropagations: [],
    ...overrides,
  };
}

export function propagation(overrides: Partial<PropagationOutcome> = {}): PropagationOutcome {
  return {
    id: PROPAGATION_ID,
    orderId: ORDER_ID,
    orderNumber: 'ORD-1001',
    direction: 'opportunity_to_order',
    orderStatusCode: 'completed',
    outcome: 'not_permitted',
    detail: 'The order workflow has no transition from "new" to "completed".',
    createdAt: '2026-10-05T10:10:00.000Z',
    ...overrides,
  };
}

export const CHANNEL_ID = '00000000-0000-4000-8000-0000000000f2';
export const CONTACT_ID = '00000000-0000-4000-8000-0000000000f1';
export const ADMIN_ID = '00000000-0000-4000-8000-0000000000aa';
export const OTHER_ADMIN_ID = '00000000-0000-4000-8000-0000000000ab';

/**
 * CRM's own lookup endpoints (`contracts/admin-api.md` §10a), as a test's GET
 * stub answers them — or `undefined` for any other path, so a stub falls
 * through to its own cases. The pickers of every CRM screen read these and
 * nothing of another module's.
 */
export function crmLookupResponse(path: string): Promise<unknown> | undefined {
  const [route, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  const q = (params.get('q') ?? '').toLowerCase();
  const matching = <T extends { name: string }>(rows: T[]): T[] =>
    rows.filter((row) => row.name.toLowerCase().includes(q));
  switch (route) {
    case '/api/v1/admin/crm/lookups/organizations':
      return Promise.resolve({ data: matching([{ id: ORGANIZATION_ID, name: 'Acme' }]) });
    case '/api/v1/admin/crm/lookups/sales-channels':
      return Promise.resolve({
        data: [
          {
            id: CHANNEL_ID,
            code: 'B2B',
            name: { 'en-US': 'Wholesale' },
            active: true,
            systemDefault: true,
            defaultCurrency: 'PLN',
            currencies: ['PLN', 'EUR'],
          },
        ],
      });
    case '/api/v1/admin/crm/lookups/assignees':
      return Promise.resolve({
        data: matching([
          { id: ADMIN_ID, name: 'Anna Nowak' },
          { id: OTHER_ADMIN_ID, name: 'Piotr Zielony' },
        ]),
      });
    case '/api/v1/admin/crm/lookups/contacts':
      return Promise.resolve({
        data:
          params.get('organizationId') === ORGANIZATION_ID
            ? matching([{ id: CONTACT_ID, name: 'Jan Kowalski', email: 'jan@acme.example' }])
            : [],
      });
    default:
      return undefined;
  }
}

/** Admin lists of other modules a CRM screen must never read (research N-D4). */
export const FOREIGN_PICKER_ENDPOINTS = [
  '/api/v1/admin/organizations',
  '/api/v1/admin/sales-channels',
  '/api/v1/admin/customers',
  '/api/v1/admin/admin-users',
  '/api/v1/admin/dictionary',
] as const;
