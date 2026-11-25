import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Check,
  EyeOff,
  ClipboardList,
  Copy,
  FileDown,
  FileText,
  History,
  Loader2,
  PencilLine,
  Plus,
  Send,
  Share2,
  Split,
  XCircle,
} from 'lucide-react';
import type { AdminPrepareCustomerBasketResponse, QuoteRequest } from '@endora-commerce/contracts';
import { apiClient, ApiError, cn, formatDateTime, isDraftEqual, readReturnTo, useDetailResource, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, DetailSkeleton, EditorSection, Input, Label, PageHeader, RecordTabs, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, useInlineStatus } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldValuesPanel,
  DetailHeaderActions,
  LineGroupsEditor,
  ModalDialog,
  ProductPicker,
  RowActionMenuItem,
  RowActionMenuSeparator,
  SplitLineDialog,
  StickyFormActions,
  canSplitLine,
  splitLineInto,
  useConfirmDialog,
  useUnsavedChangesGuard,
} from '@endora-commerce/admin-kit/components';
import {
  arrangeLineGroups,
  LINE_QUANTITY_MAX,
  QUOTE_VALIDITY_DAYS_MAX,
  lineAmountHalfUp,
  unitPriceDisplayText,
  type LineGroup,
} from '@endora-commerce/contracts';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { AdminZone, useAdminZone } from '@endora-commerce/admin-kit/zones';
import {
  deadlineForDays,
  isValidityDaysInvalid,
  parseValidityDays,
  rfqValidity,
  unsharedValidityDaysPayload,
  validityDeadlineDays,
} from '../validity.js';
import {
  shareRefusalIsAlreadyShared,
  shareRefusalNeedsReread,
  shareRefusalOf,
  shareRefusalWantsPrices,
} from '../share-refusal.js';
import { useRfqNumberFormat } from '../number-format.js';
import type { ReferenceAmount } from '../reference-difference.js';
import {
  DifferenceCell,
  ReferenceCell,
  ReferenceDifferenceCell,
  probeCustomerPrice,
  proposalOf,
  referencePriceOf,
  referenceViewOf,
  useCurrentPrices,
  type CurrentPrices,
  type ReferenceView,
} from '../reference-view.js';
import { RfqHistory } from './RfqHistory.js';
import { rfqPageNotice, shareRefusalFromArrival, type ShownShareRefusal } from './rfq-page-notice.js';
import {
  SectionSummary,
  sectionTotals,
  useQuoteLineGroupLabels,
  useQuoteSplitLineLabels,
  useSectionSummaryText,
} from '../line-groups.js';
import { quoteTotals } from '../quote-totals.js';
import { rfqStatusLabels } from '../lib/labels.js';
import { QuoteRequestPdfDialog, type QuoteRequestPdfMode } from '../components/QuoteRequestPdfDialog.js';
import { shareConfirmMessage, shareCustomerName } from '../share-confirm.js';
import { translatePlural } from '../plural.js';

/**
 * Admin Quote Request detail (feature 008 / T043). Restructured to mirror the
 * Order detail view: a PageHeader (back + title + status badge) above a single
 * tabbed Card whose body is a set of titled Sections — Overview (status +
 * actions, organization, customer, line items), Modify (negotiation), and
 * History — omitting the Order-only payment/delivery/comments tabs that do not
 * apply to a Quote Request.
 */

type RfqStatus =
  | 'Created from admin'
  | 'Pending'
  | 'Canceled'
  | 'Approved'
  | 'Completed'
  | 'Expired';

type RfqTab = 'overview' | 'modify' | 'history';

/** The note that says why Approve, Convert and the PDF wait for the Modify draft (issue #1469). */
const DRAFT_NOTE_ID = 'rfq-modify-unsaved-note';

interface AdminRfqItem {
  id: string;
  productId: string;
  productName: string;
  productSlug: string | null;
  variantId?: string | null;
  variantLabel: string | null;
  quantity: number;
  desiredUnitPrice: number | null;
  agreedUnitPrice: number | null;
  lineNote: string | null;
  lineCurrency: string;
  discountPercent: number | null;
  taxRate?: number;
  /**
   * Feature 146 — the reference unit price stored when the line was created
   * ("price at request"); `null` = none stored, so the screen asks for the
   * customer's current price instead (FR-006).
   */
  referencePrice?: { amount: number; currency: string; capturedAt: string } | null;
  /** Feature 146 — the customer's proposal, surviving admin revisions (FR-002). */
  customerProposedUnitPrice?: number | null;
  packagingUnitName?: string | null;
  packagingUnitBaseQuantity?: number | null;
  /**
   * Feature 155 (FR-030) — set by the admin read when the line is below its
   * product's current minimum; `null`/absent when it is fine. Informs only.
   */
  minimumWarning?: MinimumWarning | null;
  /** Feature 159 — the line's group (`itemGroups[].id`), `null` = ungrouped. */
  groupId?: string | null;
  /** Feature 159 — order within the line's section. */
  position?: number;
}

interface MinimumWarning {
  kind: 'pieces' | 'packaging_unit';
  minimum: number;
  packagingUnitName?: string;
}

interface AdminRfqEvent {
  id: string;
  eventType: string;
  actorAdminUserId: string | null;
  actorCustomerAccountId: string | null;
  actorRoleLabel: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface RfqOrganization {
  id: string;
  name: string;
  legalName: string | null;
  /** `null` for a personal Organization, whose tax id is a placeholder (#767). */
  taxId: string | null;
  isPersonal?: boolean;
  vatStatus: string;
}
interface RfqCustomer {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
}

interface AdminRfqDetail {
  id: string;
  /** Customer-facing business ID (feature: quote-request businessId). */
  businessId?: string;
  organizationId: string;
  customerAccountId: string;
  /** Feature 146 — the channel the request was raised on; `null` = system default. */
  salesChannelId?: string | null;
  organization?: RfqOrganization | null;
  customer?: RfqCustomer | null;
  createdByAdminUserId: string | null;
  assignedAdminUserId: string | null;
  status: RfqStatus;
  awaitingCustomerRevisionAcceptance: boolean;
  currentRevisionNumber: number;
  headerNote: string | null;
  cancellationReason: string | null;
  customFieldValues?: Record<string, unknown>;
  /** Feature 159 — every group, empty ones included, in order. */
  itemGroups?: LineGroup[];
  /** In display order. */
  items: AdminRfqItem[];
  events: AdminRfqEvent[];
  submittedAt: string | null;
  approvedAt: string | null;
  canceledAt: string | null;
  completedAt: string | null;
  expiredAt: string | null;
  expiresAt: string | null;
  convertedOrderId: string | null;
  /**
   * `specs/192-quote-request-draft-share/` — admin replies only. `false` while an
   * operator's quote is not shared with its customer yet; absent on replies that
   * predate the feature, which read as shared (FR-002).
   */
  sharedWithCustomer?: QuoteRequest['sharedWithCustomer'];
  sharedAt?: QuoteRequest['sharedAt'];
  /** The days applied when the quote is shared; `null` = no deadline. Unshared quotes only. */
  shareValidityDays?: QuoteRequest['shareValidityDays'];
  /** Flat VAT rate (fraction) applied to this quote's net prices. */
  taxRate?: number;
  createdAt: string;
  updatedAt: string;
  version: number;
}

const TERMINAL: RfqStatus[] = ['Approved', 'Completed', 'Canceled', 'Expired'];

/**
 * The statuses on which the operator's validity deadline still decides
 * something: the two the customer can still accept a revision from, and the
 * one they can still convert to an order. On a Canceled, Completed or
 * (worker-)Expired request the deadline decides nothing, so saying it lapsed
 * would be crying wolf over a record that is closed for another reason.
 */
const VALIDITY_MATTERS_ON: RfqStatus[] = ['Pending', 'Created from admin', 'Approved'];

const STATUS_VARIANT: Record<
  RfqStatus,
  'default' | 'secondary' | 'success' | 'warning' | 'destructive'
> = {
  'Created from admin': 'warning',
  Pending: 'warning',
  Approved: 'success',
  Completed: 'default',
  Canceled: 'destructive',
  Expired: 'secondary',
};

export function RfqDetail(): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('core');
  const { confirm, confirmDialog } = useConfirmDialog();
  const format = useRfqNumberFormat();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  /**
   * `specs/192-quote-request-draft-share/` — the last refused share, in the
   * `error` place above the tabs: its sentence and, for unpriced lines, which
   * ones. *Create and share* hands one over through navigation state when the
   * quote was created but its share was refused (FR-020); it is read once.
   */
  const [shareRefusal, setShareRefusal] = useState<ShownShareRefusal | null>(() => shareRefusalFromArrival(location.state));
  useEffect(() => {
    if (shareRefusalFromArrival(location.state) === null) return;
    // Said once: a reload or a way back to this entry does not repeat it.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);
  /**
   * Issue #1499 (SALES-17, DEC-12 a) — an action's result is said beside the
   * control that caused it, in a region mounted empty from the first render:
   * the header's actions for Approve, Cancel, the basket, the PDFs and the
   * copied number, and the Modify save bar for a stored revision.
   */
  const actionStatus = useInlineStatus();
  const [modifySaved, setModifySaved] = useState<string | null>(null);
  const clearModifySaved = useCallback((): void => setModifySaved(null), []);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /**
   * Fix round B — a share is asked before `busy` is set (the question is not the
   * work, so no spinner while it is open); this guard holds from the first click,
   * so a second click before the dialog renders asks nothing twice.
   */
  const shareStarted = useRef(false);
  const [tab, setTabState] = useState<RfqTab>('overview');
  /**
   * Issue #1469 — the Modify card mounts the first time its tab is opened (not
   * with the page: it asks for the customer's prices on open) and then stays
   * mounted, hidden, so its draft survives a switch to another tab.
   */
  const [modifyOpened, setModifyOpened] = useState(false);
  const setTab = useCallback((next: RfqTab): void => {
    setTabState(next);
    if (next === 'modify') setModifyOpened(true);
  }, []);
  // Feature 153 — the quote PDF dialog (download or send) and its outcome line.
  const tPdf = useTranslation('quote_requests');
  // Issue #1452 (UX audit DS-20) — the sidebar column is drawn only while something fills
  // it: with every contributor off, or refused, the screen is the single column it was.
  const sidebarShown = useAdminZone('quote_request.detail.sidebar', { quoteRequestId: id ?? '' }).length > 0 && id !== undefined;
  // Feature 159 — the Overview's section headings and summaries.
  const summaryText = useSectionSummaryText();
  const { isPresent } = useModulePresence();
  const [pdfMode, setPdfMode] = useState<QuoteRequestPdfMode | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);
  // Bumped when the operator takes the "set a new deadline" shortcut out of the
  // lapsed banner, so the Modify tab opens with the deadline field focused
  // rather than at the top of a form the operator then has to scan.
  const [validityFocusNonce, setValidityFocusNonce] = useState(0);
  /**
   * Issue #1469 (UX audit SALES-03) — the Modify tab's draft. The card stays
   * mounted (hidden) across tab switches so the draft survives them; it tells
   * this screen whether it holds unsaved changes and hands over its save, so a
   * navigation away asks Save / Discard / Stay and the header's actions that
   * act on the *stored* revision wait until the draft is saved or discarded.
   * A new epoch remounts the card from the stored request (after its own save,
   * or a Discard).
   */
  const [modifyDirty, setModifyDirty] = useState(false);
  const [modifyEpoch, setModifyEpoch] = useState(0);
  const modifySaveRef = useRef<(() => Promise<boolean>) | null>(null);

  // Issue #1447 (DS-14, SALES-06) — a skeleton on the first load only. Approve,
  // Cancel, a Modify save and a custom-field save re-read with the request still
  // on screen and its tab open, marked `aria-busy`.
  const resource = useDetailResource<AdminRfqDetail>(id ?? '', async () => {
    if (!id) return null;
    try {
      const res = await apiClient.get<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${id}`,
      );
      return res.data;
    } catch (err) {
      // An unknown id and an out-of-scope request both answer 404 (feature
      // 146, C1); either is "not found" here, in the operator's language.
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  });
  const rfq = resource.data;
  const reread = resource.refresh;
  // `specs/192-quote-request-draft-share/` — once the quote is shared, however the
  // screen learns it (its own share, a re-read), the Modify card starts again from
  // the stored quote: its days field meant "days from sharing" and must not be
  // saved as a new deadline on a quote the customer now sees.
  const unsharedNow = rfq?.sharedWithCustomer === false;
  const unsharedBefore = useRef(unsharedNow);
  useEffect(() => {
    if (unsharedBefore.current === unsharedNow) return;
    unsharedBefore.current = unsharedNow;
    setModifyDirty(false);
    setModifyEpoch((n) => n + 1);
  }, [unsharedNow]);
  // A re-read clears the previous action's error, as the old full reload did.
  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    setShareRefusal(null);
    await reread();
  }, [reread]);
  const loadError =
    resource.error === null
      ? null
      : resource.error instanceof ApiError
        ? resource.error.envelope.error.message
        : t('rfq.detail.error.load');

  // Feature 146 (FR-006) — the customer's current price for every line with no
  // stored reference, read by both Overview and Modify.
  const currentPrices = useCurrentPrices(rfq);


  // Issue #1497 (SALES-12) — confirmed first: approving locks the agreed prices
  // and notifies the customer, and it is not undone from this screen.
  const approve = async (): Promise<void> => {
    if (!rfq) return;
    const ok = await confirm({
      title: t('rfq.detail.approveConfirm.title', { id: rfq.businessId ?? rfq.id.slice(0, 8) }),
      message: t('rfq.detail.approveConfirm.message'),
      confirmLabel: t('rfq.detail.approve'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    actionStatus.clear();
    try {
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/approve`,
        {},
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      actionStatus.show(t('rfq.detail.info.approved'));
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.approve'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (!rfq) return;
    setBusy(true);
    setError(null);
    actionStatus.clear();
    try {
      const body = cancelReason.trim().length > 0 ? { reason: cancelReason.trim() } : {};
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/cancel`,
        body,
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      actionStatus.show(t('rfq.detail.info.canceled'));
      setCancelReason('');
      setCancelOpen(false);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.cancel'));
    } finally {
      setBusy(false);
    }
  };

  // Issue #170 — the operator's conversion prepares the basket of the customer
  // who owns the request, through the admin route. It used to post to the
  // storefront's `convert-to-order`, which is customer-only: an administrator's
  // session got a 401, which signs the operator out. Confirmed first, because
  // it replaces what that customer's basket holds.
  const convert = async (): Promise<void> => {
    if (!rfq) return;
    const ok = await confirm({
      title: t('rfq.detail.convert.title'),
      message: t('rfq.detail.convert.confirm'),
      confirmLabel: t('rfq.detail.convert.placeOrder'),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    actionStatus.clear();
    try {
      const res = await apiClient.post<{ data: AdminPrepareCustomerBasketResponse }>(
        `/api/v1/admin/quote-requests/${rfq.id}/prepare-customer-basket`,
        {},
      );
      actionStatus.show(t('rfq.detail.convert.success', { count: res.data.itemCount }));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.convert.error'));
    } finally {
      setBusy(false);
    }
  };

  // `specs/192-quote-request-draft-share/` (US2) — the one action that shows the
  // quote to its customer and tells them. Asked first, because it cannot be
  // undone (FR-025): the question names who is told and the validity written.
  const share = async (): Promise<void> => {
    if (!rfq || shareStarted.current) return;
    shareStarted.current = true;
    try {
      await shareAsked(rfq);
    } finally {
      shareStarted.current = false;
    }
  };
  const shareAsked = async (rfq: AdminRfqDetail): Promise<void> => {
    const ok = await confirm({
      title: tPdf('share.confirm.title', { id: rfq.businessId ?? rfq.id.slice(0, 8) }),
      message: shareConfirmMessage(tPdf, {
        customer: shareCustomerName(tPdf, rfq.customer),
        days: rfq.shareValidityDays ?? null,
        now: new Date(),
        language,
      }),
      confirmLabel: tPdf('share.action'),
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    setShareRefusal(null);
    actionStatus.clear();
    try {
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/share`,
        {},
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      actionStatus.show(tPdf('share.success'));
      setHistoryNonce((n) => n + 1);
      await refresh();
    } catch (err) {
      const refusal = shareRefusalOf(err);
      if (refusal === null) {
        // No envelope to show: the operator gets a sentence, the console the whole failure.
        console.error('[quote_requests] share failed without an API refusal', { quoteRequestId: rfq.id, error: err });
        setError(tPdf('share.error'));
        return;
      }
      if (shareRefusalNeedsReread(refusal)) {
        // The screen catches up with the server before it says anything.
        if (shareRefusalIsAlreadyShared(refusal)) setHistoryNonce((n) => n + 1);
        await refresh();
      }
      if (shareRefusalIsAlreadyShared(refusal)) {
        // Somebody else shared it meanwhile: what the operator wanted is done,
        // so it is news, not an error.
        actionStatus.show(refusal.message, 'info');
      } else {
        setShareRefusal(refusal);
      }
    } finally {
      setBusy(false);
    }
  };

  const copyId = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    const ref = rfq.businessId ?? rfq.id;
    try {
      await navigator.clipboard.writeText(ref);
      actionStatus.show(t('rfq.detail.copied', { id: ref }), 'info');
    } catch {
      actionStatus.show(t('rfq.detail.copyError'), 'error');
    }
  }, [rfq, t, actionStatus]);

  const draftOpen = modifyDirty && rfq !== null && !TERMINAL.includes(rfq.status);
  const unsavedGuard = useUnsavedChangesGuard({
    dirty: draftOpen,
    onSave: async () => (await modifySaveRef.current?.()) ?? false,
    onDiscard: () => {
      setModifyDirty(false);
      setModifyEpoch((n) => n + 1);
    },
    message: t('rfq.detail.modify.unsaved.body'),
  });

  if (resource.initialLoading) return <DetailSkeleton label={t('rfq.detail.loading')} />;

  if (!rfq)
    return (
      <Alert variant="destructive">
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          {loadError ?? t('rfq.detail.notFound')}
          {loadError !== null ? (
            <Button variant="outline" size="sm" onClick={(): void => void refresh()}>
              {t('common.action.retry')}
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    );

  const displayId = rfq.businessId ?? rfq.id.slice(0, 8);
  const isTerminal = TERMINAL.includes(rfq.status);
  const currency = rfq.items[0]?.lineCurrency ?? 'PLN';
  // Quote prices are net; surface VAT + gross so the total matches the order
  // it converts into. `rfq.taxRate` is the flat rate resolved server-side.
  // Exact decimal arithmetic (issue #417): the VAT on the net total, half-up.
  const taxRate = rfq.taxRate ?? 0;
  const totals = quoteTotals(rfq.items, taxRate);
  const total = totals?.net ?? null;
  const taxTotal = totals?.tax ?? null;
  const grossTotal = totals?.gross ?? null;

  // The operator's validity deadline, read once per render against the same
  // clock every branch below uses.
  const validity = rfqValidity(rfq.expiresAt, new Date());
  const validityLapsed = validity.kind === 'lapsed' && VALIDITY_MATTERS_ON.includes(rfq.status);
  // `modify` is the only operation that writes `expiresAt`, and it refuses any
  // status but these two — so on an Approved request the deadline can no
  // longer be moved at all, and the banner says so instead of pointing at a
  // tab that is not rendered.
  const validityReDatable = rfq.status === 'Pending' || rfq.status === 'Created from admin';
  // `specs/192-quote-request-draft-share/` — strictly `false`: a reply without the
  // key (one that predates the feature) is a quote the customer already sees.
  const unshared = rfq.sharedWithCustomer === false;
  const shareDays = validityDeadlineDays(rfq.shareValidityDays);

  const openValidityEditor = (): void => {
    setTab('modify');
    setValidityFocusNonce((n) => n + 1);
  };

  // Issue #1499 (SALES-17) — at most one banner above the tabs, by priority.
  const pageNotice = rfqPageNotice({
    error: (error ?? loadError) !== null || shareRefusal !== null,
    validityLapsed,
    draftOpen,
    onModifyTab: tab === 'modify',
  });

  // Action buttons live in the PageHeader's top-right slot — mirroring the
  // Order detail view — rather than in an in-body status row. Issue #1497
  // (SALES-12): one primary per view (`DetailHeaderActions`). The next step of
  // the status is the one filled button — Approve on a Pending request, Prepare
  // the customer's basket on an Approved one — and every other status has none
  // (Von Restorff). The PDFs and Cancel are the long tail, in "More", Cancel
  // last and set apart from the rest (Hick; Fitts: distance, not proximity).
  //
  // Approve and Prepare basket are disabled past the deadline, because both can
  // now only answer 410: convert-to-order is refused outright, and approving
  // moves a lapsed request into `Approved`, which `modify` refuses — so the
  // deadline could never be moved afterwards and the quote would be unusable by
  // either party. The banner below carries the reason and the remedy; a
  // disabled button cannot.
  //
  // While the Modify draft is unsaved, Approve, Convert and the PDF would act on
  // the stored revision, not on what the operator sees: they wait, and say why.
  const draftBlocked = draftOpen
    ? { 'aria-describedby': DRAFT_NOTE_ID, title: t('rfq.detail.modify.unsaved.blocked') }
    : {};
  const busyMarker = busy ? { 'aria-busy': true } : {};
  let primaryAction: ReactNode = null;
  if (rfq.status === 'Pending') {
    primaryAction = (
      <Button
        onClick={(): void => void approve()}
        disabled={busy || validityLapsed || draftOpen}
        {...busyMarker}
        {...draftBlocked}
      >
        {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Check aria-hidden="true" />}
        {t('rfq.detail.approve')}
      </Button>
    );
  }
  // `specs/192-quote-request-draft-share/` (US2) — the next step of a quote not
  // shared yet is sharing it. Like Approve, it waits for an unsaved Modify draft:
  // it would share the stored lines, not the ones on screen.
  if (unshared && rfq.status === 'Created from admin') {
    primaryAction = (
      <Button onClick={(): void => void share()} disabled={busy || draftOpen} {...busyMarker} {...draftBlocked}>
        {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <Share2 aria-hidden="true" />}
        {tPdf('share.action')}
      </Button>
    );
  }
  if (rfq.status === 'Approved') {
    primaryAction = (
      <Button
        onClick={(): void => void convert()}
        disabled={busy || validityLapsed || draftOpen}
        {...busyMarker}
        {...draftBlocked}
      >
        {busy ? <Loader2 aria-hidden="true" className="motion-safe:animate-spin" /> : <FileText aria-hidden="true" />}
        {t('rfq.detail.convert.placeOrder')}
      </Button>
    );
  }
  // Feature 153 — every state of the quote (owner answer Q3); only while the
  // document templates facility is present (FR-060), and the send only while
  // the transactional e-mails are too (FR-099).
  const pdfPresent = isPresent('document_templates');
  // Not while the quote is unshared (FR-007): the customer may not receive what
  // their account does not show yet. Preview and download stay.
  const pdfSendPresent = pdfPresent && isPresent('transactional_emails') && !unshared;
  const draftBlockedTitle = draftOpen ? t('rfq.detail.modify.unsaved.blocked') : undefined;
  const headerActions = (
    <DetailHeaderActions primary={primaryAction} moreDisabled={busy} status={actionStatus.props}>
      {pdfPresent ? (
        <RowActionMenuItem onSelect={(): void => setPdfMode('download')} disabled={draftOpen} title={draftBlockedTitle}>
          <FileDown aria-hidden="true" />
          {tPdf('pdf.export')}
        </RowActionMenuItem>
      ) : null}
      {pdfSendPresent ? (
        <RowActionMenuItem onSelect={(): void => setPdfMode('send')} disabled={draftOpen} title={draftBlockedTitle}>
          <Send aria-hidden="true" />
          {tPdf('pdf.send')}
        </RowActionMenuItem>
      ) : null}
      {!isTerminal && pdfPresent ? <RowActionMenuSeparator /> : null}
      {!isTerminal ? (
        <RowActionMenuItem
          destructive
          onSelect={(): void => {
            setError(null);
            setCancelOpen(true);
          }}
        >
          <XCircle aria-hidden="true" />
          {t('rfq.detail.cancelRfq')}
        </RowActionMenuItem>
      ) : null}
    </DetailHeaderActions>
  );

  return (
    <>
      <PageHeader
        back={
          // Opened from another screen that named its own address: the way back leads
          // there, and says only "Back".
          returnTo
            ? { label: t('common.action.back'), to: returnTo }
            : { label: t('rfq.list.title'), to: '/quote-requests' }
        }
        title={
          <>
            <button
              type="button"
              onClick={(): void => void copyId()}
              title={t('rfq.detail.copyHint')}
              className="inline-flex items-center gap-1.5 hover:opacity-80"
            >
              {t('rfq.detail.title', { id: displayId })}
              <Copy className="size-3.5 opacity-60" />
            </button>
            <Badge variant={STATUS_VARIANT[rfq.status]} className="text-xs font-medium">
              {rfqStatusLabels.label(t, rfq.status)}
            </Badge>
            {unshared ? (
              <Badge variant="outline" className="gap-1 text-xs font-medium">
                <EyeOff className="size-3" aria-hidden="true" />
                {tPdf('share.badge.unshared')}
              </Badge>
            ) : null}
            {/* Awaiting the customer is not true of a quote the customer cannot see yet. */}
            {rfq.awaitingCustomerRevisionAcceptance && !unshared ? (
              <Badge variant="warning" className="text-xs font-medium">
                {t('rfq.detail.badge.awaitingRevision')}
              </Badge>
            ) : null}
            {validityLapsed ? (
              <Badge variant="destructive" className="gap-1 text-xs font-medium">
                <CalendarX className="size-3" aria-hidden="true" />
                {t('rfq.detail.badge.validityEnded')}
              </Badge>
            ) : null}
          </>
        }
        description={
          <span>
            {/* Issue #1499 (SALES-17) — why the request was canceled is part of the
                record's state, so it leads the meta line rather than standing as an
                error banner above the tabs. The line is clamped to one row; the
                `title` carries a long reason in full, and a screen reader reads it all. */}
            {rfq.cancellationReason ? (
              <span className="font-medium text-destructive" title={rfq.cancellationReason}>
                <XCircle aria-hidden="true" className="mr-1 inline size-3.5 align-[-2px]" />
                {t('rfq.detail.badge.cancelReason', { reason: rfq.cancellationReason })}
                {' · '}
              </span>
            ) : null}
            {t('rfq.detail.meta.created', { date: formatDateTime(rfq.createdAt, language) })}
            {/* `specs/192-quote-request-draft-share/` — whether the customer sees it,
                and, until they do, the days its validity will count from sharing. */}
            {unshared
              ? ` · ${tPdf('share.meta.unshared')}${
                  shareDays !== null
                    ? ` · ${translatePlural(tPdf, language, 'share.meta.validityDays', shareDays, { days: shareDays })}`
                    : ''
                }`
              : rfq.sharedAt
                ? ` · ${tPdf('share.meta.shared', { date: formatDateTime(rfq.sharedAt, language) })}`
                : ''}
            {rfq.submittedAt
              ? ` · ${t('rfq.detail.meta.submitted', { date: formatDateTime(rfq.submittedAt, language) })}`
              : ''}
            {/* Three different sentences about three different dates: the
                status the expiry worker set, a deadline still ahead, and one
                already behind. The last used to render as "expires <date>",
                which reads as a promise the platform is no longer keeping. */}
            {rfq.expiredAt
              ? ` · ${t('rfq.detail.meta.expired', { date: formatDateTime(rfq.expiredAt, language) })}`
              : validity.kind === 'active'
                ? ` · ${t('rfq.detail.meta.expires', { date: formatDateTime(validity.expiresAt, language) })}`
                : validity.kind === 'lapsed'
                  ? ` · ${t('rfq.detail.meta.validityEnded', { date: formatDateTime(validity.expiresAt, language) })}`
                  : ''}
          </span>
        }
        actions={headerActions}
      />

      {pageNotice === 'error' ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {shareRefusal !== null && error === null ? (
              <ShareRefusalText
                refusal={shareRefusal}
                // The prices are set under Modify, which a closed quote does not have.
                {...(!isTerminal ? { onGoToPrices: (): void => setTab('modify') } : {})}
              />
            ) : (
              (error ?? loadError)
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {pdfMode ? (
        <QuoteRequestPdfDialog
          quoteRequestId={rfq.id}
          mode={pdfMode}
          onClose={(): void => setPdfMode(null)}
          onDone={(outcome): void => {
            actionStatus.show(outcome.message, outcome.kind);
            if (pdfMode === 'send') setHistoryNonce((n) => n + 1);
          }}
        />
      ) : null}

      {/* The lapsed deadline states its own consequence and its own remedy,
          because the two buttons it disables cannot: a disabled control is
          removed from the tab order and announces no reason. */}
      {pageNotice === 'validity' && validity.kind === 'lapsed' ? (
        <Alert variant="warning" className="mb-4">
          <CalendarX className="size-4" aria-hidden="true" />
          <AlertDescription>
            <p className="font-medium">
              {t('rfq.detail.validity.lapsed.headline', {
                date: formatDateTime(validity.expiresAt, language),
              })}
            </p>
            <p className="mt-1">
              {validityReDatable
                ? t('rfq.detail.validity.lapsed.remedyEditable')
                : t('rfq.detail.validity.lapsed.remedyLocked')}
            </p>
            {validityReDatable ? (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 bg-card"
                onClick={openValidityEditor}
              >
                <CalendarClock />
                {t('rfq.detail.validity.lapsed.setNewDeadline')}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* What the disabled Approve, basket and PDF entries are described by, whichever
          banner is on screen — the draft's own is only one candidate for the one place. */}
      {draftOpen ? (
        <span id={DRAFT_NOTE_ID} hidden>
          {t('rfq.detail.modify.unsaved.blocked')}
        </span>
      ) : null}
      {pageNotice === 'draft' ? (
        <Alert variant="warning" className="mb-4">
          <PencilLine className="size-4" aria-hidden="true" />
          <AlertDescription>
            <p>{t('rfq.detail.modify.unsaved.blocked')}</p>
            <Button variant="outline" size="sm" className="mt-3 bg-card" onClick={(): void => setTab('modify')}>
              {t('rfq.detail.modify.unsaved.open')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Issue #1445 (DS-12) — the kit's record tabs: one tab in the tab order,
          ←/→/Home/End, every tab controlling the one panel. `overflow-hidden`
          rounds the strip's corners, but it also clips the Modify tab's
          product-picker dropdown, so the clip is dropped while Modify is open. */}
      <DetailSidebarLayout
        sidebar={
          sidebarShown && id !== undefined ? (
            // Issue #1452 (UX audit DS-20) — what other modules say about the request, as
            // sections of one card at a sidebar's width; never a card in a card.
            <aside aria-label={tPdf('detail.sidebar.label')} className="mb-4 min-w-0 lg:col-start-2 lg:row-start-1">
              <Card>
                <CardContent className="space-y-(--section-gap)">
                  <AdminZone name="quote_request.detail.sidebar" props={{ quoteRequestId: id }} chrome="section" />
                </CardContent>
              </Card>
            </aside>
          ) : null
        }
      >
        <RecordTabs
          className={cn('mb-4', tab !== 'modify' && 'overflow-hidden', sidebarShown && 'min-w-0 lg:col-start-1')}
          items={[
            { value: 'overview', label: t('rfq.detail.tabs.overview'), icon: <ClipboardList /> },
            ...(!isTerminal
              ? [
                  {
                    value: 'modify' as const,
                    label: t('rfq.detail.tabs.modify'),
                    icon: <PencilLine />,
                    // Issue #1469 — the tab holds the unsaved draft: a dot, and these words.
                    unsaved: draftOpen ? t('rfq.detail.tabs.modifyUnsaved') : undefined,
                  },
                ]
              : []),
            { value: 'history', label: t('rfq.detail.tabs.history'), icon: <History /> },
          ]}
          value={tab}
          onValueChange={setTab}
          idBase="rfq-detail"
          aria-label={tPdf('detail.tabs.label')}
          panelProps={resource.busyProps}
        >
          {tab !== 'modify' ? (
          <div className="divide-y divide-border [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
            {tab === 'overview' ? (
              <>
                <div className="grid gap-6 md:grid-cols-2">
                  <Section title={t('rfq.detail.sections.organization')}>
                    {rfq.organization ? (
                      <div className="space-y-1 text-sm">
                        <p className="font-medium">{rfq.organization.name}</p>
                        {rfq.organization.legalName &&
                        rfq.organization.legalName !== rfq.organization.name ? (
                          <p className="text-muted-foreground">{rfq.organization.legalName}</p>
                        ) : null}
                        {rfq.organization.isPersonal ? (
                          <p className="text-muted-foreground">{t('rfq.detail.org.individualCustomer')}</p>
                        ) : rfq.organization.taxId ? (
                          <p className="text-muted-foreground">
                            {t('rfq.detail.org.taxId')}: <strong>{rfq.organization.taxId}</strong>
                          </p>
                        ) : null}
                        <p className="text-muted-foreground">
                          {t('rfq.detail.org.vat')}:{' '}
                          {t(`rfq.detail.vatStatus.${rfq.organization.vatStatus}`)}
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        <code className="font-mono text-xs">{rfq.organizationId}</code>
                      </p>
                    )}
                  </Section>
                  <Section title={t('rfq.detail.sections.customer')}>
                    {rfq.customer ? (
                      <div className="space-y-1 text-sm">
                        <p className="font-medium">
                          {`${rfq.customer.firstName ?? ''} ${rfq.customer.lastName ?? ''}`.trim() ||
                            rfq.customer.email}
                        </p>
                        <p className="text-muted-foreground">
                          <a className="underline underline-offset-2" href={`mailto:${rfq.customer.email}`}>
                            {rfq.customer.email}
                          </a>
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        <code className="font-mono text-xs">{rfq.customerAccountId}</code>
                      </p>
                    )}
                  </Section>
                </div>

                {rfq.headerNote ? (
                  <Section title={t('rfq.detail.sections.buyerNote')}>
                    <p className="text-sm">{rfq.headerNote}</p>
                  </Section>
                ) : null}

                <Section title={t('rfq.detail.sections.items')}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('rfq.detail.column.product')}</TableHead>
                        <TableHead>{t('rfq.detail.column.qty')}</TableHead>
                        <TableHead>{t('rfq.detail.reference.column.reference')}</TableHead>
                        <TableHead>{t('rfq.detail.reference.column.proposed')}</TableHead>
                        <TableHead>{t('rfq.detail.reference.column.difference')}</TableHead>
                        <TableHead>{t('rfq.detail.column.agreed')}</TableHead>
                        <TableHead className="text-right">{t('rfq.detail.column.lineTotal')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overviewSections(rfq).flatMap((section) => [
                        section.heading !== null ? (
                          <TableRow key={`heading-${section.key}`}>
                            <TableHead colSpan={7} scope="colgroup" className="font-semibold text-foreground">
                              {section.heading === '' ? tPdf('lineGroups.ungrouped') : section.heading}
                            </TableHead>
                          </TableRow>
                        ) : null,
                        ...section.items.map((it) => {
                        const lineTotal =
                          it.agreedUnitPrice !== null
                            ? Number(lineAmountHalfUp(it.agreedUnitPrice, it.quantity))
                            : it.desiredUnitPrice !== null
                              ? Number(lineAmountHalfUp(it.desiredUnitPrice, it.quantity))
                              : null;
                        const reference = referenceViewOf(it, currentPrices);
                        const proposal = proposalOf(it);
                        return (
                          // Top-aligned: the minimum badge under the quantity must not lift it
                          // above the other cells' first line (U4).
                          <TableRow key={it.id} className="[&>td]:align-top">
                            <TableCell>
                              <strong>{it.productName}</strong>
                              {it.variantLabel ? <small> ({it.variantLabel})</small> : null}
                              {it.lineNote ? (
                                <div className="text-xs text-muted-foreground">{it.lineNote}</div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <div className="tabular-nums">{it.quantity}</div>
                              <MinimumWarningBadge
                                warning={it.minimumWarning}
                                packagingUnitName={it.packagingUnitName}
                              />
                            </TableCell>
                            <TableCell>
                              <ReferenceCell view={reference} perBaseUnit={Boolean(it.packagingUnitName)} />
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {proposal !== null ? format.unitAmount(proposal) : '—'}
                            </TableCell>
                            <TableCell>
                              <DifferenceCell
                                price={proposal}
                                currency={it.lineCurrency}
                                reference={referencePriceOf(reference)}
                              />
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {it.agreedUnitPrice !== null ? format.unitAmount(it.agreedUnitPrice) : '—'}
                            </TableCell>
                            <TableCell className="tabular-nums text-right">
                              {lineTotal !== null
                                ? format.money(lineTotal, it.lineCurrency)
                                : '—'}
                            </TableCell>
                          </TableRow>
                        );
                        }),
                        section.heading !== null ? (
                          <TableRow key={`summary-${section.key}`}>
                            <TableCell colSpan={7}>
                              <SectionSummary
                                text={summaryText(
                                  sectionTotals(
                                    section.items.map((it) => ({
                                      net: it.agreedUnitPrice !== null ? Number(lineAmountHalfUp(it.agreedUnitPrice, it.quantity)) : null,
                                      reference: referenceTotalOf(referenceViewOf(it, currentPrices), it.quantity),
                                    })),
                                    taxRate,
                                  ),
                                  currency,
                                )}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null,
                      ])}
                    </TableBody>
                    {total !== null ? (
                      <tfoot className="border-t [&_td]:p-2 [&_th]:p-2">
                        {taxRate > 0 ? (
                          <>
                            <tr>
                              <th colSpan={6} className="text-right">
                                {t('rfq.detail.netLabel')}
                              </th>
                              <td className="tabular-nums text-right">
                                {format.money(total, currency)}
                              </td>
                            </tr>
                            <tr>
                              <th colSpan={6} className="text-right">
                                {t('rfq.detail.taxLabel', { rate: (taxRate * 100).toFixed(0) })}
                              </th>
                              <td className="tabular-nums text-right">
                                {format.money(taxTotal ?? 0, currency)}
                              </td>
                            </tr>
                          </>
                        ) : null}
                        <tr>
                          <th colSpan={6} className="text-right font-semibold">
                            {taxRate > 0 ? t('rfq.detail.grossLabel') : t('rfq.detail.totalLabel')}
                          </th>
                          <td className="tabular-nums text-right font-semibold">
                            {format.money(grossTotal ?? total, currency)}
                          </td>
                        </tr>
                      </tfoot>
                    ) : null}
                  </Table>
                </Section>
                {/* Feature 055 — operator-defined custom fields for this quote request. */}
                {!isTerminal ? (
                  <CustomFieldValuesPanel
                    entityType="quote_request"
                    values={rfq.customFieldValues ?? {}}
                    save={async (values): Promise<void> => {
                      await apiClient.patch(
                        `/api/v1/admin/quote-requests/${rfq.id}`,
                        { customFieldValues: values },
                        { headers: { 'If-Match': `"${rfq.version}"` } },
                      );
                      await refresh();
                    }}
                  />
                ) : null}
              </>
            ) : null}

            {tab === 'history' ? (
              <Section title={t('rfq.detail.history.title')}>
                <RfqHistory key={historyNonce} quoteRequestId={rfq.id} />
              </Section>
            ) : null}
          </div>
          ) : null}

          {/* Issue #1469 — mounted while the request can be modified and only
              hidden on the other tabs, so a tab switch keeps the draft. It sits
              inside the one panel; hidden, it is not exposed on another tab. */}
          {!isTerminal && modifyOpened ? (
            <div hidden={tab !== 'modify'} data-testid="rfq-modify-panel">
              <ModifyCard
                key={modifyEpoch}
                rfq={rfq}
                currentPrices={currentPrices}
                onSaved={async (): Promise<void> => {
                  // Saved on a quote not shared yet, the customer is told nothing.
                  setModifySaved(unshared ? tPdf('share.modify.saved') : t('rfq.detail.modify.info.saved'));
                  await refresh();
                  setModifyDirty(false);
                  setModifyEpoch((n) => n + 1);
                }}
                setError={setError}
                savedMessage={modifySaved}
                onEdited={clearModifySaved}
                focusValidityNonce={validityFocusNonce}
                remounted={modifyEpoch > 0}
                onDirtyChange={setModifyDirty}
                saveRef={modifySaveRef}
              />
            </div>
          ) : null}
        </RecordTabs>
      </DetailSidebarLayout>

      {/* Panels other modules add to this screen. The host knows none of them;
          with nobody contributing this renders nothing at all. At page level each
          is a card of its own (`chrome="card"`, issue #1437). */}
      {id ? <AdminZone name="quote_request.detail.after" props={{ quoteRequestId: id }} chrome="card" /> : null}

      {cancelOpen ? (
        <CancelDialog
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onConfirm={(): void => void cancel()}
          onClose={(): void => setCancelOpen(false)}
          busy={busy}
          error={error}
          unshared={unshared}
        />
      ) : null}
      {confirmDialog}
      {unsavedGuard.dialog}
    </>
  );
}

/**
 * Cancellation modal — captures the (optional) cancellation reason on an
 * overlay rather than stretching the status row, then confirms the cancel.
 *
 * The kit's `ModalDialog` since issue #1474 (SALES-09): named by its title,
 * the reason labelled and focused, Tab held inside, Escape and *Keep RFQ*
 * returning focus to *Cancel RFQ*. A click on the scrim does not close it, so
 * a typed reason is not lost to a stray click, and a refused cancellation is
 * announced here rather than on the page behind the scrim.
 */
/**
 * `specs/192-quote-request-draft-share/` — a refused share: the server's
 * sentence (already in the operator's language, a share hook's own included)
 * and, when lines have no price, which ones (FR-026), so the operator knows
 * what to price under Modify without hunting for it.
 */
function ShareRefusalText({
  refusal,
  onGoToPrices,
}: {
  refusal: ShownShareRefusal;
  onGoToPrices?: () => void;
}): ReactNode {
  const t = useTranslation('quote_requests');
  return (
    <>
      {/* Fix round B — *Create and share* did half of what was asked: say the half that happened first. */}
      {refusal.afterCreate ? <p className="mb-2 font-medium">{t('share.refusal.afterCreate')}</p> : null}
      <p>{refusal.message}</p>
      {refusal.lines.length > 0 ? (
        <>
          <p className="mt-2 font-medium">{t('share.refusal.linesTitle')}</p>
          <ul className="mt-1 list-disc pl-5">
            {refusal.lines.map((line) => {
              const label =
                line.variantLabel !== null
                  ? t('share.refusal.lineVariant', { product: line.productName, variant: line.variantLabel })
                  : line.productName;
              return (
                <li key={line.id}>
                  {line.groupName !== null ? t('share.refusal.lineInGroup', { line: label, group: line.groupName }) : label}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {/* Fix round B — the refusal names its remedy, as the unsaved-draft banner does (the
          banner stays: it lists what to price). */}
      {onGoToPrices && shareRefusalWantsPrices(refusal) ? (
        <Button variant="outline" size="sm" className="mt-3 bg-card" onClick={onGoToPrices}>
          {t('share.refusal.goToPrices')}
        </Button>
      ) : null}
    </>
  );
}

function CancelDialog(props: {
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
  error: string | null;
  /** `specs/192-quote-request-draft-share/` — not shared yet: the customer is never told (FR-005). */
  unshared: boolean;
}): ReactNode {
  const t = useTranslation('core');
  const own = useTranslation('quote_requests');
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const errorId = useId();
  return (
    <ModalDialog
      title={t('rfq.detail.cancelDialog.title')}
      onClose={props.onClose}
      busy={props.busy}
      dismissOnScrim={false}
      initialFocusRef={reasonRef}
      widthClassName="max-w-md"
      footer={
        <>
          <Button variant="outline" onClick={props.onClose} disabled={props.busy}>
            {t('rfq.detail.cancelDialog.dismiss')}
          </Button>
          <Button variant="destructive" onClick={props.onConfirm} disabled={props.busy} aria-busy={props.busy}>
            {props.busy ? (
              <Loader2 size={14} aria-hidden="true" className="mr-1 motion-safe:animate-spin" />
            ) : (
              <XCircle size={14} aria-hidden="true" className="mr-1" />
            )}{' '}
            {t('rfq.detail.cancelDialog.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="cancel-reason">{t('rfq.detail.cancelReason')}</Label>
        <Textarea
          ref={reasonRef}
          id="cancel-reason"
          value={props.reason}
          onChange={(e): void => props.onReasonChange(e.target.value)}
          placeholder={props.unshared ? own('share.cancel.placeholder') : t('rfq.detail.cancelReasonPlaceholder')}
          rows={3}
          aria-describedby={errorId}
        />
        {/* Mounted before it has text, so a refusal that arrives is announced. */}
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      </div>
    </ModalDialog>
  );
}

/**
 * Feature 155 (FR-030, US4 #15) — "Below minimum (10 pcs)" / "(2 × Pallet)" on a
 * line the admin read flags. Text plus icon, never colour alone (WCAG 1.4.1);
 * amber `warning`, not `destructive`, because it informs and blocks nothing —
 * a sales representative may set a line below the minimum on purpose (FR-012).
 * It is the server's verdict on the saved revision (product totals across the
 * request's lines), so the Modify tab shows it on a kept line only and does not
 * recompute it while the operator types.
 */
function MinimumWarningBadge(props: {
  warning: MinimumWarning | null | undefined;
  packagingUnitName?: string | null | undefined;
  id?: string;
}): ReactNode {
  const t = useTranslation('core');
  const { warning } = props;
  if (!warning) return null;
  const unitName = warning.packagingUnitName ?? props.packagingUnitName ?? null;
  const label =
    warning.kind === 'pieces'
      ? t('rfq.detail.minimum.pieces', { minimum: warning.minimum })
      : unitName
        ? t('rfq.detail.minimum.packagingUnit', { minimum: warning.minimum, packagingUnitName: unitName })
        : t('rfq.detail.minimum.packagingUnitUnnamed', { minimum: warning.minimum });
  return (
    <Badge id={props.id} variant="warning" className="mt-1 gap-1">
      <AlertTriangle className="size-3" aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}

/**
 * Feature 159 — the Overview's sections: with no non-empty group, one section
 * with no heading (the table as it was, FR-033); otherwise each non-empty group
 * by name, then the ungrouped lines under the empty-string heading the caller
 * names. Empty groups are not shown read-only (D2).
 */
function overviewSections(rfq: AdminRfqDetail): Array<{ key: string; heading: string | null; items: AdminRfqItem[] }> {
  const sections = arrangeLineGroups(rfq.itemGroups ?? [], rfq.items);
  if (!sections.some((section) => section.kind === 'group')) {
    return [{ key: 'all', heading: null, items: rfq.items }];
  }
  return sections.map((section) => ({
    key: section.group?.id ?? 'ungrouped',
    heading: section.group?.name ?? '',
    items: [...section.lines],
  }));
}

/** A line's reference total, or `null` when the screen shows no reference for it. */
function referenceTotalOf(view: ReferenceView, quantity: number): number | null {
  const price = referencePriceOf(view);
  // The line value, rounded once (§10.18).
  return price !== null ? Number(lineAmountHalfUp(price.amount, quantity)) : null;
}

interface ModifyLineDraft {
  /** Feature 159 — the line's identity in the grouping editor. */
  key: string;
  /** Feature 159 — the group (a group draft's `key`) the line is in; `null` = ungrouped. */
  groupKey: string | null;
  /**
   * The stored line this draft line is (feature 146, FR-034). Sent back so the
   * server keeps what the operator did not change — packaging unit, proposal,
   * stored reference. Absent on a line the operator added, and dropped when
   * the operator switches the line to another product.
   */
  id?: string | undefined;
  /**
   * Feature 159 (research N-33) — the stored line this new line was split off
   * (*Split line*): sent as `splitFromId`, so the server copies that line's
   * packaging unit, proposal, note and reference; the screen reads its name,
   * proposal and reference from it too. Dropped with a product switch.
   */
  splitFromId?: string | undefined;
  productId: string;
  variantId: string | null;
  lineNote: string | null;
  quantity: string;
  agreedUnitPrice: string;
  /**
   * The customer's current price for a line that is not a kept stored line
   * (added, or switched to another product), as the prefill probe answered it;
   * `undefined` until it answers, `null` = no price.
   */
  currentPrice?: ReferenceAmount | null | undefined;
}

function ModifyCard({
  rfq,
  currentPrices,
  onSaved,
  setError,
  savedMessage = null,
  onEdited,
  focusValidityNonce,
  remounted = false,
  onDirtyChange,
  saveRef,
}: {
  rfq: AdminRfqDetail;
  /** The current prices `RfqDetail` asked for the lines with no stored reference. */
  currentPrices: CurrentPrices;
  onSaved: () => Promise<void>;
  setError: (msg: string | null) => void;
  /**
   * Issue #1499 (SALES-17) — the last stored revision's result, said in the save bar beside
   * Save revision. The card is remounted after its own save, so it is held by the screen.
   */
  savedMessage?: string | null;
  /** The draft differs again: the last save's result no longer describes it. */
  onEdited?: (() => void) | undefined;
  /** Changes when the operator asked for the deadline field from elsewhere. */
  focusValidityNonce: number;
  /** Issue #1469 — a fresh copy after a save or a Discard, not the operator opening the tab. */
  remounted?: boolean;
  /** Issue #1469 — whether the draft differs from the stored request. */
  onDirtyChange?: ((dirty: boolean) => void) | undefined;
  /** Issue #1469 — this card's save, for the leave dialog's *Save and continue*. */
  saveRef?: { current: (() => Promise<boolean>) | null } | undefined;
}): ReactNode {
  const { language } = useTranslationContext();
  const t = useTranslation('core');
  const tGroups = useTranslation('quote_requests');
  const groupLabels = useQuoteLineGroupLabels();
  const splitLabels = useQuoteSplitLineLabels();
  const summaryText = useSectionSummaryText();
  const format = useRfqNumberFormat();
  const [headerNote, setHeaderNote] = useState(rfq.headerNote ?? '');
  // Issue #1449 (DS-19) — a refused save is said in the save bar, beside "Save revision",
  // not in the page-top alert the operator has scrolled away from.
  const [saveError, setSaveError] = useState<string | null>(null);
  // Feature 159 (research N-33) — the line whose *Split line* dialog is open.
  const [splitting, setSplitting] = useState<string | null>(null);
  // Feature 159 — the grouping draft. A stored group's key is its id (a valid
  // request key), so a saved group keeps its identity across a rename; a new
  // group gets a fresh key and no id. Empty groups are kept (D2).
  const [groups, setGroups] = useState<Array<{ key: string; id?: string; name: string }>>(
    (rfq.itemGroups ?? []).map((group) => ({ key: group.id, id: group.id, name: group.name })),
  );
  const nextKey = useRef(0);
  const newKey = (prefix: string): string => `${prefix}${(nextKey.current += 1)}`;
  // On a shared quote, blank means "leave the deadline where it is" — that is
  // `expiresInDays` being absent from the PATCH, which is what the contract
  // reads as "do not touch it". It is never prefilled there: `expiresInDays`
  // counts from *now*, so any number put here on the operator's behalf would be
  // this screen choosing a date the customer is then held to.
  // `specs/192-quote-request-draft-share/` — on a quote not shared yet the field
  // holds the quote's own days (`shareValidityDays`), which count from sharing,
  // so showing them commits nobody to a date; emptying it removes them.
  const unshared = rfq.sharedWithCustomer === false;
  const initialDays = unshared && rfq.shareValidityDays != null ? String(rfq.shareValidityDays) : '';
  const [expiresInDays, setExpiresInDays] = useState(initialDays);
  const validityInputRef = useRef<HTMLInputElement>(null);
  const [lines, setLines] = useState<ModifyLineDraft[]>(
    rfq.items.map((it) => {
      // Open on the request's current state: start the agreed price from the
      // price already defined in the quote request — the agreed price if the
      // operator set one, otherwise the customer's desired price — so the
      // modification is a delta on the existing offer, not a blank slate.
      const definedPrice = it.agreedUnitPrice ?? it.desiredUnitPrice;
      return {
        key: it.id,
        groupKey: it.groupId ?? null,
        id: it.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        lineNote: it.lineNote,
        quantity: String(it.quantity),
        // A unit price keeps its four places (owner ruling of 2026-10-25).
        agreedUnitPrice: definedPrice !== null ? unitPriceDisplayText(definedPrice) : '',
      };
    }),
  );
  const [busy, setBusy] = useState(false);
  /**
   * Issue #1469 — the lines as the card opened, with the customer prices the
   * card fills in by itself on open applied to them too: a price the operator
   * did not type is not an unsaved change.
   */
  const [baselineLines, setBaselineLines] = useState<ModifyLineDraft[]>(lines);

  // Prefill an empty agreed unit price with the price the request's customer
  // would pay on the request's channel (FR-007) — never the operator's own
  // storefront price — so the operator starts from that customer's price and
  // only edits the negotiated delta. Never clobbers a value already present (an
  // existing agreed price, or one the operator just typed). A failed probe
  // leaves the input empty (L2).
  const prefillAgreed = useCallback(
    (
      key: string,
      line: { productId: string; variantId: string | null; quantity: number },
      options: { onOpen?: boolean } = {},
    ): void => {
      void probeCustomerPrice(rfq, line).then((price) => {
        const fill = (prev: ModifyLineDraft[]): ModifyLineDraft[] =>
          prev.map((l) =>
            l.key === key && l.productId === line.productId
              ? {
                  ...l,
                  currentPrice: price,
                  ...(price !== null && l.agreedUnitPrice.trim() === ''
                    ? { agreedUnitPrice: unitPriceDisplayText(price.amount) }
                    : {}),
                }
              : l,
          );
        setLines(fill);
        if (options.onOpen) setBaselineLines(fill);
      });
    },
    [rfq],
  );

  // On mount, prefill only the lines where the request itself defines no price
  // (neither agreed nor proposed). Lines that already carry a request-defined
  // price keep it as the modification's starting point.
  useEffect(() => {
    rfq.items.forEach((it) => {
      if (it.productId && it.agreedUnitPrice === null && it.desiredUnitPrice === null) {
        prefillAgreed(it.id, { productId: it.productId, variantId: it.variantId ?? null, quantity: it.quantity }, { onOpen: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Land the caret on the deadline field when the operator arrived here from
  // the lapsed banner: the remedy they asked for is the one control they
  // should not have to hunt for in this form (Fitts's Law).
  // The card stays mounted across tabs and is remounted after its own save or a
  // Discard (issue #1469): a request made before such a remount is already served.
  const openedWithNonce = useRef(remounted ? focusValidityNonce : 0);
  useEffect(() => {
    if (focusValidityNonce > 0 && focusValidityNonce !== openedWithNonce.current) validityInputRef.current?.focus();
  }, [focusValidityNonce]);

  // Issue #1469 — the draft against the stored request. `currentPrice` is what
  // the screen read, not what the operator wrote, so it is not compared.
  const initialGroups = useRef(groups);
  const comparableLines = (list: ModifyLineDraft[]): unknown =>
    list.map((line) => ({ ...line, currentPrice: undefined }));
  const dirty =
    headerNote !== (rfq.headerNote ?? '') ||
    expiresInDays.trim() !== initialDays ||
    !isDraftEqual(groups, initialGroups.current) ||
    !isDraftEqual(comparableLines(lines), comparableLines(baselineLines));
  useEffect(() => {
    onDirtyChange?.(dirty);
    if (dirty) onEdited?.();
  }, [dirty, onDirtyChange, onEdited]);
  // The bar's status region is mounted empty and given the saved revision's result one
  // commit later: this card is remounted after its save, and a live region that arrives
  // already carrying its text is not reliably announced (WCAG 4.1.3).
  const [statusReady, setStatusReady] = useState(false);
  useEffect(() => setStatusReady(true), []);
  const saveStatus = statusReady && !dirty ? savedMessage : null;
  useEffect(() => (): void => onDirtyChange?.(false), [onDirtyChange]);

  const save = async (): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setSaveError(null);
    try {
      // Feature 159 — a group needs a name; the field says so too.
      if (groups.some((group) => group.name.trim() === '')) {
        setSaveError(tGroups('lineGroups.nameRequired'));
        setBusy(false);
        return false;
      }
      // The grouping is sent whenever the quote has or had a group, so deleting
      // the last one is saved too; a quote never grouped sends none (FR-033).
      const sendGroups = groups.length > 0 || (rfq.itemGroups?.length ?? 0) > 0;
      // In display order: each group's lines, then the ungrouped ones.
      const known = new Set(groups.map((group) => group.key));
      const ordered = [
        ...groups.flatMap((group) => lines.filter((l) => l.groupKey === group.key)),
        ...lines.filter((l) => l.groupKey === null || !known.has(l.groupKey)),
      ];
      const items = ordered
        .filter((l) => l.productId.trim().length > 0 && Number(l.quantity) > 0)
        .map((l) => ({
          // A kept line names its stored row and restates its variant and note,
          // so the revision keeps them (FR-034). `variantId` is not nullable in
          // the contract: a line without a variant omits the key.
          ...(l.id ? { id: l.id, lineNote: l.lineNote } : {}),
          // A line split off a stored one: the server copies what it carries.
          ...(!l.id && l.splitFromId ? { splitFromId: l.splitFromId } : {}),
          productId: l.productId.trim(),
          ...(l.variantId ? { variantId: l.variantId } : {}),
          quantity: Number(l.quantity),
          ...(l.agreedUnitPrice.trim().length > 0
            ? { agreedUnitPrice: Number(l.agreedUnitPrice) }
            : {}),
          ...(sendGroups ? { groupKey: l.groupKey !== null && known.has(l.groupKey) ? l.groupKey : null } : {}),
        }));
      if (items.length === 0) {
        setSaveError(t('rfq.detail.modify.error.atLeastOneLine'));
        setBusy(false);
        return false;
      }
      // A deadline the contract would refuse is refused here rather than
      // dropped from the payload: an operator who typed a number and got no
      // deadline would have been told nothing.
      const typedDays = expiresInDays.trim();
      if (isValidityDaysInvalid(typedDays)) {
        setSaveError(t('rfq.detail.validity.error.days'));
        setBusy(false);
        validityInputRef.current?.focus();
        return false;
      }
      const validityDaysPayload = unshared
        ? unsharedValidityDaysPayload(typedDays, initialDays)
        : typedDays !== ''
          ? Number(typedDays)
          : undefined;
      await apiClient.patch(
        `/api/v1/admin/quote-requests/${rfq.id}`,
        {
          headerNote: headerNote.trim().length > 0 ? headerNote.trim() : null,
          ...(sendGroups
            ? {
                groups: groups.map((group) => ({
                  key: group.key,
                  ...(group.id ? { id: group.id } : {}),
                  name: group.name.trim(),
                })),
              }
            : {}),
          items,
          // Absent means "leave the deadline as it is" — the same shape
          // `RfqCreatePage` sends, and what `adminPatchQuoteRequestSchema`
          // reads as untouched. On an unshared quote an emptied field sends
          // `null` (no deadline once shared).
          ...(validityDaysPayload !== undefined ? { expiresInDays: validityDaysPayload } : {}),
        },
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      await onSaved();
      return true;
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.modify.error.save'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (saveRef) saveRef.current = save;
  });

  const updateLine = (key: string, patch: Partial<ModifyLineDraft>): void => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  /** A blank line, at the end of the given section (`null` = ungrouped). */
  const addLine = (groupKey: string | null): void =>
    setLines((prev) => {
      const line: ModifyLineDraft = {
        key: newKey('line-'),
        groupKey,
        productId: '',
        variantId: null,
        lineNote: null,
        quantity: '1',
        agreedUnitPrice: '',
      };
      // The editor shows each line in its section, last in it.
      return [...prev, line];
    });

  // The stored lines by id: a kept draft line reads its reference and the
  // customer's proposal from the line it is, not from whichever line happens
  // to share its product.
  const originalById = new Map(rfq.items.map((it) => [it.id, it]));
  const currency = rfq.items[0]?.lineCurrency ?? 'PLN';

  /** A line's name: its stored product name, else its position (review fix N7). */
  const lineName = (l: ModifyLineDraft): string => {
    const storedId = l.id ?? l.splitFromId;
    const stored = storedId ? originalById.get(storedId) : undefined;
    return (stored && stored.productId === l.productId ? stored.productName : undefined) ??
      t('rfq.detail.modify.lineGroup', { number: lines.indexOf(l) + 1 });
  };

  // Feature 159 (research N-33) — the open split, and where its new line may go.
  const splitLine = splitting !== null ? lines.find((l) => l.key === splitting) : undefined;
  const knownGroupKeys = new Set(groups.map((group) => group.key));
  const confirmSplit = (split: { quantity: number; targetKey: string | null }): void => {
    if (!splitLine) return;
    setLines((prev) => [
      ...splitLineInto(prev, splitLine.key, split, {
        quantityOf: (l) => Number(l.quantity),
        setQuantity: (l, quantity) => ({ ...l, quantity: String(quantity) }),
        make: (source, quantity, groupKey) => ({
          key: newKey('line-'),
          groupKey,
          splitFromId: source.id ?? source.splitFromId,
          productId: source.productId,
          variantId: source.variantId,
          lineNote: source.lineNote,
          quantity: String(quantity),
          agreedUnitPrice: source.agreedUnitPrice,
          currentPrice: source.currentPrice,
        }),
      }),
    ]);
    setSplitting(null);
  };

  // One line's derived figures, shared by its row and its section's summary.
  const modifyLineView = (l: ModifyLineDraft) => {
    // A split-off line reads its proposal and reference from the line it came from.
    const storedId = l.id ?? l.splitFromId;
    const stored = storedId ? originalById.get(storedId) : undefined;
    const orig = stored && stored.productId === l.productId ? stored : undefined;
    const desired = orig ? proposalOf(orig) : null;
    const reference: ReferenceView = orig
      ? referenceViewOf(orig, currentPrices)
      : l.currentPrice === undefined
        ? { kind: 'pending' }
        : l.currentPrice === null
          ? { kind: 'none' }
          : { kind: 'current', price: l.currentPrice };
    const qtyNum = Number(l.quantity);
    const agreedNum = Number(l.agreedUnitPrice);
    const typedAgreed =
      l.agreedUnitPrice.trim().length > 0 && Number.isFinite(agreedNum) ? agreedNum : null;
    // The line value, `unit × quantity` rounded once (§10.18); a fractional
    // quantity being typed is not a line yet.
    const lineValue = (unit: number): number | null =>
      Number.isInteger(qtyNum) && qtyNum > 0 ? Number(lineAmountHalfUp(unit, qtyNum)) : null;
    const lineTotal = typedAgreed !== null ? lineValue(typedAgreed) : desired !== null ? lineValue(desired) : null;
    return { orig, desired, reference, qtyNum, typedAgreed, lineTotal };
  };

  // A plain grid (not <Table>, which wraps in an overflow-auto container that
  // would clip the product dropdown) so the picker's options overlay outside
  // the row instead of being trapped inside it. The fixed-width columns only
  // engage at md+ (where the header is visible); on narrower widths the row
  // stacks so the trailing actions column can't overflow and break the layout.
  // Issue #1542 (SALES-16) — seven columns: the reference and its difference share a cell.
  const gridCols =
    'md:grid-cols-[minmax(180px,1fr)_80px_120px_160px_100px_130px_auto]';

  // The deadline field's answers, all about the same date: what saving would
  // set, or — while the field is blank — what leaving it blank keeps. "Blank"
  // and "no deadline" are two of those answers and must not read as one.
  const now = new Date();
  const currentValidity = rfqValidity(rfq.expiresAt, now);
  const typedInput = parseValidityDays(expiresInDays);
  const previewDeadline = deadlineForDays(expiresInDays, now);
  const daysInvalid = typedInput.kind === 'invalid';
  // `specs/192-quote-request-draft-share/` (FR-031, FR-032) — not shared yet:
  // the days, counted from sharing, and no date; blank and 0 are no deadline.
  // Shared: 0 removes the deadline, it never ends validity now.
  const validityHelp = ((): string => {
    if (daysInvalid) return t('rfq.detail.validity.error.days');
    if (unshared) {
      const days = validityDeadlineDays(typedInput.kind === 'days' ? typedInput.days : null);
      return days !== null
        ? translatePlural(tGroups, language, 'validity.unshared.days', days, { days })
        : tGroups('validity.unshared.none');
    }
    if (previewDeadline !== null) {
      return t('rfq.detail.validity.help.preview', { date: formatDateTime(previewDeadline.toISOString(), language) });
    }
    if (typedInput.kind === 'days') return tGroups('validity.previewNone');
    if (currentValidity.kind === 'none') return t('rfq.detail.validity.help.keepNone');
    return t(
      currentValidity.kind === 'active' ? 'rfq.detail.validity.help.keepActive' : 'rfq.detail.validity.help.keepLapsed',
      { date: formatDateTime(currentValidity.expiresAt, language) },
    );
  })();

  return (
    // Issue #1542 (SALES-16) — no title that repeats the tab's: two sections under it, the
    // request's terms and its lines, inside the tab's one card (Common Region).
    <div className="space-y-(--section-gap)">
      <EditorSection title={t('rfq.detail.modify.section.terms')} contentClassName="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="modify-note">{t('rfq.detail.modify.headerNote')}</Label>
          <Textarea
            id="modify-note"
            value={headerNote}
            onChange={(e): void => setHeaderNote(e.target.value)}
            rows={2}
          />
        </div>
        {/* The validity deadline sits with the header note because both are
            properties of the request rather than of a line, and both are saved
            by the one "Save revision" button below — re-dating is part of
            re-quoting, not a second thing to remember. */}
        <div className="space-y-1.5">
          <Label htmlFor="modify-expires-in-days" className="flex items-center gap-1.5">
            <CalendarClock className="size-3.5 opacity-70" aria-hidden="true" />
            {unshared ? tGroups('validity.unshared.field') : t('rfq.detail.validity.field')}
          </Label>
          <Input
            id="modify-expires-in-days"
            ref={validityInputRef}
            type="number"
            min={0}
            max={QUOTE_VALIDITY_DAYS_MAX}
            step={1}
            inputMode="numeric"
            className="w-40 tabular-nums"
            value={expiresInDays}
            placeholder={t('rfq.detail.validity.placeholder')}
            aria-describedby="modify-expires-in-days-help"
            aria-invalid={daysInvalid || undefined}
            onChange={(e): void => setExpiresInDays(e.target.value)}
          />
          <p
            id="modify-expires-in-days-help"
            className={cn('text-xs', daysInvalid ? 'text-destructive' : 'text-muted-foreground')}
          >
            {validityHelp}
          </p>
        </div>
      </EditorSection>
      <EditorSection title={t('rfq.detail.modify.section.lines')} contentClassName="space-y-3">
        <div className="space-y-2">
          {/* Visual column heads only: every control in a line carries its own name. */}
          <div
            aria-hidden="true"
            data-testid="rfq-modify-columns"
            className={cn(
              'hidden gap-3 px-1 text-xs font-medium text-muted-foreground md:grid',
              gridCols,
            )}
          >
            <span>{t('rfq.detail.modify.product')}</span>
            <span>{t('rfq.detail.modify.quantity')}</span>
            <span>{t('rfq.detail.modify.agreedUnitPrice')}</span>
            <span>{t('rfq.detail.modify.referenceDifference')}</span>
            <span>{t('rfq.detail.reference.column.proposed')}</span>
            <span>{t('rfq.detail.modify.lineTotal')}</span>
            <span />
          </div>
          <LineGroupsEditor<ModifyLineDraft>
            groups={groups.map((group) => ({ key: group.key, name: group.name }))}
            lines={lines}
            disabled={busy}
            createGroupKey={(): string => newKey('group-')}
            labels={groupLabels}
            getLineLabel={(l): string => lineName(l)}
            onChange={(next): void => {
              const ids = new Map(groups.map((group) => [group.key, group.id]));
              setGroups(
                next.groups.map((group) => {
                  const id = ids.get(group.key);
                  return id ? { key: group.key, id, name: group.name } : { key: group.key, name: group.name };
                }),
              );
              setLines(next.lines);
            }}
            renderSummary={(sectionLines): ReactNode => (
              <SectionSummary
                text={summaryText(
                  sectionTotals(
                    sectionLines.map((l) => {
                      const view = modifyLineView(l);
                      return {
                        net: view.typedAgreed !== null && view.qtyNum > 0 ? view.typedAgreed * view.qtyNum : null,
                        reference: view.qtyNum > 0 ? referenceTotalOf(view.reference, view.qtyNum) : null,
                      };
                    }),
                    rfq.taxRate ?? 0,
                  ),
                  currency,
                )}
              />
            )}
            renderSectionFooter={(section): ReactNode =>
              section.kind === 'group' && section.key !== null ? (
                <Button variant="ghost" size="sm" onClick={(): void => addLine(section.key)}>
                  {tGroups('lineGroups.addProduct')}
                </Button>
              ) : null
            }
            renderLine={(l, slots): ReactNode => {
              const i = lines.indexOf(l);
              const { orig, desired, reference, qtyNum, typedAgreed, lineTotal } = modifyLineView(l);
              return (
                <div
                  role="group"
                  // A new or switched line has no stored name yet; it is still a
                  // named group, by its position (review fix N7).
                  aria-label={lineName(l)}
                  // Top-aligned, every cell at least one control tall (h-9) and centred in it: the
                  // minimum badge hangs under the quantity input without moving any cell (U4).
                  className={cn('grid grid-cols-1 items-start gap-3', gridCols)}
                >
                  <ProductPicker
                    mode="select"
                    ariaLabel={t('rfq.detail.modify.product')}
                    value={l.productId || null}
                    onChange={(v): void => {
                      // Switching products invalidates any prior agreed price; clear
                      // it and let the price-list value prefill for the new product.
                      // The line is no longer the stored row it was: drop its id
                      // and variant so the server treats it as a new line.
                      updateLine(l.key, {
                        id: undefined,
                        splitFromId: undefined,
                        productId: v ?? '',
                        variantId: null,
                        agreedUnitPrice: '',
                        currentPrice: undefined,
                      });
                      if (v) prefillAgreed(l.key, { productId: v, variantId: null, quantity: qtyNum });
                    }}
                  />
                  <div className="space-y-1">
                    <Input
                      type="number"
                      min={1}
                      max={LINE_QUANTITY_MAX}
                      aria-label={t('rfq.detail.modify.quantity')}
                      aria-describedby={orig?.minimumWarning ? `rfq-line-${i}-minimum` : undefined}
                      value={l.quantity}
                      onChange={(e): void => updateLine(l.key, { quantity: e.target.value })}
                      className="tabular-nums"
                    />
                    <MinimumWarningBadge
                      id={`rfq-line-${i}-minimum`}
                      warning={orig?.minimumWarning}
                      packagingUnitName={orig?.packagingUnitName}
                    />
                  </div>
                  <Input
                    type="number"
                    step="0.0001"
                    min={0}
                    aria-label={t('rfq.detail.modify.agreedUnitPrice')}
                    value={l.agreedUnitPrice}
                    onChange={(e): void => updateLine(l.key, { agreedUnitPrice: e.target.value })}
                    className="tabular-nums"
                  />
                  <div className="flex min-h-9 items-center text-sm" data-testid="rfq-modify-reference">
                    <ReferenceDifferenceCell
                      view={reference}
                      perBaseUnit={Boolean(orig?.packagingUnitName)}
                      price={typedAgreed}
                      currency={orig?.lineCurrency ?? currency}
                    />
                  </div>
                  <span className="flex min-h-9 items-center text-sm tabular-nums text-muted-foreground">
                    {desired !== null ? format.unitMoney(desired, currency) : '—'}
                  </span>
                  <span className="flex min-h-9 items-center text-sm font-medium tabular-nums">
                    {lineTotal !== null ? format.money(lineTotal, currency) : '—'}
                  </span>
                  <div className="flex items-center gap-1 md:mt-0.5">
                    {slots.handle}
                    {slots.moveMenu}
                    {l.productId && canSplitLine(qtyNum) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label={splitLabels.action({ name: lineName(l) })}
                        title={splitLabels.action({ name: lineName(l) })}
                        disabled={busy}
                        onClick={(): void => setSplitting(l.key)}
                      >
                        <Split aria-hidden="true" />
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(): void => setLines((prev) => prev.filter((other) => other.key !== l.key))}
                    >
                      {t('rfq.detail.modify.remove')}
                    </Button>
                  </div>
                </div>
              );
            }}
          />
        </div>
        {splitLine ? (
          <SplitLineDialog
            lineName={lineName(splitLine)}
            quantity={Number(splitLine.quantity)}
            targets={[
              ...groups.map((group) => ({ key: group.key, name: group.name.trim() || groupLabels.groupName })),
              { key: null, name: groupLabels.ungrouped },
            ]}
            defaultTargetKey={
              splitLine.groupKey !== null && knownGroupKeys.has(splitLine.groupKey) ? splitLine.groupKey : null
            }
            labels={splitLabels}
            onConfirm={confirmSplit}
            onClose={(): void => setSplitting(null)}
          />
        ) : null}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={(): void => addLine(null)}
          >
            <Plus aria-hidden="true" />
            {t('rfq.detail.modify.addLine')}
          </Button>
        </div>
      </EditorSection>
      {/* Issue #1449 (DS-19) — the one Save stays in view over a long list of lines. */}
      <StickyFormActions
        desktop="sticky"
        dirty={dirty}
        error={saveError}
        status={saveStatus}
        note={unshared ? tGroups('share.modify.note') : t('rfq.detail.modify.notifiesCustomer')}
        primary={
          <Button onClick={(): void => void save()} disabled={busy} aria-busy={busy || undefined}>
            {t('rfq.detail.modify.saveRevision')}
          </Button>
        }
      />
    </div>
  );
}

/**
 * The tabs alone, or the tabs and a sidebar beside them (issue #1452, UX audit
 * DS-20) — the grid of the Task detail screen. With no sidebar it adds no element,
 * so the screen is the single column it was. In DOM order the sidebar follows
 * the tabs, so the main content comes first on a narrow screen.
 */
function DetailSidebarLayout({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }): ReactNode {
  if (sidebar === null) return children;
  return (
    <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      {children}
      {sidebar}
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqDetail;
