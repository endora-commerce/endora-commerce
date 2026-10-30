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
import { AppLanguageContext, TranslationProvider } from '@endora-commerce/admin-kit/i18n';
import { render } from '@testing-library/react';
import { expect } from 'vitest';
import { renderWithI18n } from '../../helpers/render-with-i18n';
import { textOfEditorDoc, type EditorDoc } from '@endora-commerce/admin-kit/components';
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
/** The shipped English bundle, for a test that mounts a zone rather than a screen. */
export const CRM_BUNDLE_EN = CRM_BUNDLE;
const CORE_BUNDLE = shippedBundle('../packages/modules/_i18n/i18n/en.json');
const CRM_BUNDLE_PL = shippedBundle('../packages/modules/crm/i18n/pl.json');
const CORE_BUNDLE_PL = shippedBundle('../packages/modules/_i18n/i18n/pl.json');

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

/**
 * The Opportunity screen's tabs are `React.lazy`, and the ones that write text
 * hold the formatted field — TipTap and ProseMirror, a large module graph that
 * vitest transforms on first use. Left to the first test that opens such a
 * tab, that cost landed inside its five-second assertion budget, and on a
 * loaded CI runner the first test of `mentions` and of `comments` ran out of
 * it (#387's follow-up). Loaded here, it is paid while the test file is
 * imported, which no assertion is timing.
 */
await Promise.all([
  import('../../../../packages/modules/crm/src/admin/components/ReferenceField'),
  import('../../../../packages/modules/crm/src/admin/pages/opportunity-detail/tabs/OverviewTab'),
  import('../../../../packages/modules/crm/src/admin/pages/opportunity-detail/tabs/NotesTab'),
  import('../../../../packages/modules/crm/src/admin/pages/opportunity-detail/tabs/MessagesTab'),
  import('../../../../packages/modules/crm/src/admin/pages/opportunity-detail/tabs/EventsTab'),
]);

/** The English sentence of one of the module's own keys. */
export function en(key: string, params?: Record<string, string | number>): string {
  return sentence(CRM_BUNDLE, 'crm', key, params);
}

/** The English sentence of a key the host's shared bundle owns. */
export function core(key: string, params?: Record<string, string | number>): string {
  return sentence(CORE_BUNDLE, 'core', key, params);
}

export const EVERY_CRM_PERMISSION = ['crm:read', 'crm:write', 'crm:configure', 'orders:read', 'rfqs:handle'];

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
    /** Modules present besides the ones every CRM screen assumes — `quote_requests`, for one. */
    readonly alsoPresent?: readonly string[];
    /** The navigation state the screen is arrived at with, if any. */
    readonly state?: unknown;
    /** The operator's language; English unless a test reads the Polish copy. */
    readonly language?: 'en' | 'pl';
  } = {},
): RenderResult {
  const path = options.path ?? '/';
  const [pathname = '/', search = ''] = path.split('?');
  const language = options.language ?? 'en';
  const tree = (
    withSession(
      <AppLanguageContext.Provider value={{ language, setLanguage: (): void => {} }}>
        <MemoryRouter
          initialEntries={[
            options.state === undefined
              ? path
              : { pathname, search: search ? `?${search}` : '', state: options.state },
          ]}
        >
          <Routes>
            <Route path={options.pattern ?? '*'} element={ui} />
          </Routes>
        </MemoryRouter>
      </AppLanguageContext.Provider>,
      {
        session: adminSession({ permissions: options.permissions ?? EVERY_CRM_PERMISSION }),
        presence: modulePresence({
          present: ['crm', 'orders', 'organizations', 'sales_channels', ...(options.alsoPresent ?? [])],
        }),
        registry: [],
      },
    )
  );
  if (language === 'pl') {
    return render(
      <TranslationProvider language="pl" initialBundle={{ core: CORE_BUNDLE_PL, crm: CRM_BUNDLE_PL }}>
        {tree}
      </TranslationProvider>,
    );
  }
  return renderWithI18n(tree, { core: CORE_BUNDLE, crm: CRM_BUNDLE });
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
    customFieldValues: {},
    upcomingEventCount: 0,
    noteCount: 0,
    attachmentCount: 0,
    unreadMessageCount: 0,
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
/** A Quote Request and a Task the `@@` document list offers (`specs/163-projects-and-tasks/` FR-044). */
export const QUOTE_REQUEST_ID = '00000000-0000-4000-8000-0000000000c2';
export const TASK_ID = '00000000-0000-4000-8000-0000000000c3';
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
    // Who a text may mention (User Story 18): the same two people, by name.
    case '/api/v1/admin/crm/lookups/mentionable':
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
    // The `@@` document list (`specs/163-projects-and-tasks/` FR-044): one Order
    // and one Quote Request of the Organization, and one Task, narrowed by
    // number or title — every group, as the server answers a holder of all
    // three read codes. A test about gating answers it itself.
    case '/api/v1/admin/crm/lookups/documents': {
      const narrowed = (items: Array<{ id: string; label: string; sublabel?: string }>) =>
        items.filter((item) => `${item.label} ${item.sublabel ?? ''}`.toLowerCase().includes(q));
      const withOrganization = params.has('opportunityId') || params.has('organizationId');
      return Promise.resolve({
        groups: [
          ...(withOrganization
            ? [
                { kind: 'order', items: narrowed([{ id: ORDER_ID, label: 'ORD-1001' }]) },
                { kind: 'quote_request', items: narrowed([{ id: QUOTE_REQUEST_ID, label: 'RFQ-2001' }]) },
              ]
            : []),
          { kind: 'task', items: narrowed([{ id: TASK_ID, label: 'TSK-0007', sublabel: 'Call the fleet manager' }]) },
        ],
      });
    }
    // The tag list every screen with a tag filter reads; a test about tags
    // answers it itself, before falling through to here.
    case '/api/v1/admin/crm/tags':
      return Promise.resolve({ data: [] });
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

interface EditorHandle {
  getJSON(): unknown;
  state: { doc: { descendants(visit: (node: EditorNode, position: number) => boolean | void): void } };
  commands: {
    setTextSelection(position: number | { from: number; to: number }): boolean;
    selectAll(): boolean;
    setContent(content: string): boolean;
    clearContent(emitUpdate?: boolean): boolean;
  };
  view: { domAtPos(position: number): { node: Node; offset: number } };
}

interface EditorNode {
  isText: boolean;
  isTextblock: boolean;
  isInline: boolean;
  text?: string | null;
  nodeSize: number;
  attrs: Record<string, unknown>;
}

/** The TipTap editor behind a formatted field — TipTap hangs it on the element it edits. */
export function editorOf(field: HTMLElement): EditorHandle {
  const editor = (field as unknown as { editor?: EditorHandle }).editor;
  if (!editor) throw new Error('not a formatted field: no editor on this element');
  return editor;
}

/**
 * The text a description, note or message field would send: what its content
 * stands for — formatting written as the text grammar, a token for each chip —
 * read by the field's own writer. What a person sees in the field is its
 * `textContent`, names and all.
 */
export function storedText(field: HTMLElement): string {
  return textOfEditorDoc(editorOf(field).getJSON() as EditorDoc);
}

/**
 * Put the caret at a place in a field's stored text, as a click there would —
 * for a plain text: a chip counts as its token, a new paragraph as one `\n`.
 */
export function caretAt(field: HTMLElement, offset: number): void {
  const editor = editorOf(field);
  let remaining = offset;
  let target: number | null = null;
  let first = true;
  editor.state.doc.descendants((node, position) => {
    if (target !== null) return false;
    if (node.isTextblock) {
      if (!first) remaining -= 1;
      first = false;
      if (remaining <= 0) target = position + 1;
      return true;
    }
    if (!node.isInline) return true;
    const length = node.isText
      ? (node.text ?? '').length
      : `[[${String(node.attrs['refType'])}:${String(node.attrs['refId'])}]]`.length;
    if (remaining <= length) {
      target = node.isText ? position + remaining : position + (remaining === 0 ? 0 : node.nodeSize);
      return false;
    }
    remaining -= length;
    return false;
  });
  // The editor's own focus command waits for a frame; a click focuses at once.
  field.focus();
  editor.commands.setTextSelection(target ?? 1);
  // jsdom does not carry the editor's selection to the document's, which is
  // where a key typed next lands: put it there too, as a click would.
  const { node, offset: domOffset } = editor.view.domAtPos(target ?? 1);
  const range = document.createRange();
  range.setStart(node, domOffset);
  range.collapse(true);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

/**
 * The address of a link to an Order or a Quote Request from an Opportunity:
 * the document's own path, carrying `?returnTo=` back to the Opportunity
 * (`specs/158-crm-opportunity-inline-editing/`, FR-020).
 */
export function returningHere(path: string): unknown {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return expect.stringMatching(new RegExp(`^${escaped}\\?returnTo=%2Fcrm%2Fopportunities%2F`));
}
