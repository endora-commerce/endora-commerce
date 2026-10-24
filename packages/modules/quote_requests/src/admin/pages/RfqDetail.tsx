import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  CalendarClock,
  CalendarX,
  Check,
  ClipboardList,
  Copy,
  FileDown,
  FileText,
  History,
  PencilLine,
  Send,
  Split,
  XCircle,
} from 'lucide-react';
import type { AdminPrepareCustomerBasketResponse } from '@endora-commerce/contracts';
import { apiClient, ApiError, cn, formatDateTime, readReturnTo, useModulePresence } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, Input, Label, PageHeader, Section, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea } from '@endora-commerce/admin-kit/ui';
import {
  CustomFieldValuesPanel,
  LineGroupsEditor,
  ProductPicker,
  SplitLineDialog,
  canSplitLine,
  splitLineInto,
} from '@endora-commerce/admin-kit/components';
import { arrangeLineGroups, lineAmountHalfUp, roundAmountHalfUp, type LineGroup } from '@endora-commerce/contracts';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { AdminZone } from '@endora-commerce/admin-kit/zones';
import { deadlineForDays, isValidityDaysInvalid, rfqValidity } from '../validity.js';
import { useRfqNumberFormat } from '../number-format.js';
import type { ReferenceAmount } from '../reference-difference.js';
import {
  DifferenceCell,
  ReferenceCell,
  probeCustomerPrice,
  proposalOf,
  referencePriceOf,
  referenceViewOf,
  useCurrentPrices,
  type CurrentPrices,
  type ReferenceView,
} from '../reference-view.js';
import { RfqHistory } from './RfqHistory.js';
import {
  SectionSummary,
  sectionTotals,
  useQuoteLineGroupLabels,
  useQuoteSplitLineLabels,
  useSectionSummaryText,
} from '../line-groups.js';
import { quoteTotals } from '../quote-totals.js';
import { QuoteRequestPdfDialog, type QuoteRequestPdfMode } from '../components/QuoteRequestPdfDialog.js';

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
  taxId: string;
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
  const t = useTranslation('core');
  const format = useRfqNumberFormat();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const returnTo = readReturnTo(searchParams);
  const [rfq, setRfq] = useState<AdminRfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<RfqTab>('overview');
  // Feature 153 — the quote PDF dialog (download or send) and its outcome line.
  const tPdf = useTranslation('quote_requests');
  // Feature 159 — the Overview's section headings and summaries.
  const summaryText = useSectionSummaryText();
  const { isPresent } = useModulePresence();
  const [pdfMode, setPdfMode] = useState<QuoteRequestPdfMode | null>(null);
  const [pdfNotice, setPdfNotice] = useState<{ kind: 'success' | 'warning'; message: string } | null>(null);
  const [historyNonce, setHistoryNonce] = useState(0);
  // Bumped when the operator takes the "set a new deadline" shortcut out of the
  // lapsed banner, so the Modify tab opens with the deadline field focused
  // rather than at the top of a form the operator then has to scan.
  const [validityFocusNonce, setValidityFocusNonce] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${id}`,
      );
      setRfq(res.data);
    } catch (err) {
      // An unknown id and an out-of-scope request both answer 404 (feature
      // 146, C1); either is "not found" here, in the operator's language.
      if (err instanceof ApiError && err.status === 404) setError(t('rfq.detail.notFound'));
      else setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.error.load'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Feature 146 (FR-006) — the customer's current price for every line with no
  // stored reference, read by both Overview and Modify.
  const currentPrices = useCurrentPrices(rfq);


  const approve = async (): Promise<void> => {
    if (!rfq) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/approve`,
        {},
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      setInfo(t('rfq.detail.info.approved'));
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
    setInfo(null);
    try {
      const body = cancelReason.trim().length > 0 ? { reason: cancelReason.trim() } : {};
      await apiClient.post(
        `/api/v1/admin/quote-requests/${rfq.id}/cancel`,
        body,
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      setInfo(t('rfq.detail.info.canceled'));
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
    if (!window.confirm(t('rfq.detail.convert.confirm'))) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await apiClient.post<{ data: AdminPrepareCustomerBasketResponse }>(
        `/api/v1/admin/quote-requests/${rfq.id}/prepare-customer-basket`,
        {},
      );
      setInfo(t('rfq.detail.convert.success', { count: res.data.itemCount }));
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.convert.error'));
    } finally {
      setBusy(false);
    }
  };

  const copyId = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    const ref = rfq.businessId ?? rfq.id;
    try {
      await navigator.clipboard.writeText(ref);
      setInfo(t('rfq.detail.copied', { id: ref }));
    } catch {
      setError(t('rfq.detail.copyError'));
    }
  }, [rfq, t]);

  if (loading) return <p className="text-sm text-muted-foreground">{t('rfq.detail.loading')}</p>;

  if (!rfq)
    return (
      <Alert variant="destructive">
        <AlertDescription>{error ?? t('rfq.detail.notFound')}</AlertDescription>
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

  const openValidityEditor = (): void => {
    setTab('modify');
    setValidityFocusNonce((n) => n + 1);
  };

  // Action buttons live in the PageHeader's top-right slot — mirroring the
  // Order detail view — rather than in an in-body status row.
  //
  // Both are disabled past the deadline, because both can now only answer 410:
  // convert-to-order is refused outright, and approving moves a lapsed request
  // into `Approved`, which `modify` refuses — so the deadline could never be
  // moved afterwards and the quote would be unusable by either party. The
  // banner below carries the reason and the remedy; a disabled button cannot.
  const headerActions: ReactNode[] = [];
  if (rfq.status === 'Pending') {
    headerActions.push(
      <Button
        key="approve"
        variant="outline"
        size="sm"
        className="bg-card"
        onClick={(): void => void approve()}
        disabled={busy || validityLapsed}
      >
        <Check />
        {t('rfq.detail.approve')}
      </Button>,
    );
  }
  if (rfq.status === 'Approved') {
    headerActions.push(
      <Button
        key="convert"
        variant="outline"
        size="sm"
        className="bg-card"
        onClick={(): void => void convert()}
        disabled={busy || validityLapsed}
      >
        <FileText />
        {t('rfq.detail.convert.placeOrder')}
      </Button>,
    );
  }
  // Feature 153 — every state of the quote (owner answer Q3); only while the
  // document templates facility is present (FR-060), and the send only while
  // the transactional e-mails are too (FR-099).
  if (isPresent('document_templates')) {
    headerActions.push(
      <Button key="pdf-export" variant="outline" size="sm" className="bg-card" onClick={(): void => setPdfMode('download')} disabled={busy}>
        <FileDown />
        {tPdf('pdf.export')}
      </Button>,
    );
    if (isPresent('transactional_emails')) {
      headerActions.push(
        <Button key="pdf-send" variant="outline" size="sm" className="bg-card" onClick={(): void => setPdfMode('send')} disabled={busy}>
          <Send />
          {tPdf('pdf.send')}
        </Button>,
      );
    }
  }
  if (!isTerminal) {
    headerActions.push(
      <Button
        key="cancel"
        variant="outline"
        size="sm"
        className="bg-card border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={(): void => setCancelOpen(true)}
        disabled={busy}
      >
        <XCircle />
        {t('rfq.detail.cancelRfq')}
      </Button>,
    );
  }

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
              {rfq.status}
            </Badge>
            {rfq.awaitingCustomerRevisionAcceptance ? (
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
            {t('rfq.detail.meta.created', { date: formatDateTime(rfq.createdAt) })}
            {rfq.submittedAt
              ? ` · ${t('rfq.detail.meta.submitted', { date: formatDateTime(rfq.submittedAt) })}`
              : ''}
            {/* Three different sentences about three different dates: the
                status the expiry worker set, a deadline still ahead, and one
                already behind. The last used to render as "expires <date>",
                which reads as a promise the platform is no longer keeping. */}
            {rfq.expiredAt
              ? ` · ${t('rfq.detail.meta.expired', { date: formatDateTime(rfq.expiredAt) })}`
              : validity.kind === 'active'
                ? ` · ${t('rfq.detail.meta.expires', { date: formatDateTime(validity.expiresAt) })}`
                : validity.kind === 'lapsed'
                  ? ` · ${t('rfq.detail.meta.validityEnded', { date: formatDateTime(validity.expiresAt) })}`
                  : ''}{' '}
            <code className="font-mono text-xs">({rfq.id})</code>
          </span>
        }
        actions={headerActions.length > 0 ? headerActions : null}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {info ? (
        <Alert variant="success" className="mb-4">
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      ) : null}
      {pdfNotice ? (
        <Alert variant={pdfNotice.kind} className="mb-4">
          <AlertDescription>{pdfNotice.message}</AlertDescription>
        </Alert>
      ) : null}
      {pdfMode ? (
        <QuoteRequestPdfDialog
          quoteRequestId={rfq.id}
          mode={pdfMode}
          onClose={(): void => setPdfMode(null)}
          onDone={(outcome): void => {
            setPdfNotice(outcome);
            if (pdfMode === 'send') setHistoryNonce((n) => n + 1);
          }}
        />
      ) : null}

      {rfq.cancellationReason ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {t('rfq.detail.badge.cancelReason', { reason: rfq.cancellationReason })}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The lapsed deadline states its own consequence and its own remedy,
          because the two buttons it disables cannot: a disabled control is
          removed from the tab order and announces no reason. */}
      {validityLapsed && validity.kind === 'lapsed' ? (
        <Alert variant="warning" className="mb-4">
          <CalendarX className="size-4" aria-hidden="true" />
          <AlertDescription>
            <p className="font-medium">
              {t('rfq.detail.validity.lapsed.headline', {
                date: formatDateTime(validity.expiresAt),
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

      {/* `overflow-hidden` rounds the tab strip's corners, but it also clips the
          Modify tab's product-picker dropdown. Drop the clip while the Modify
          tab is active so the dropdown can overlay outside the card. */}
      <Card className={cn('mb-4', tab !== 'modify' && 'overflow-hidden')}>
        <div style={{ padding: '4px 4px 0', overflow: 'hidden' }}>
          <div className="b2b-tabs-scroll">
            <div className="b2b-tabs" role="tablist">
              <TabBtn
                id="overview"
                label={t('rfq.detail.tabs.overview')}
                icon={<ClipboardList size={14} />}
                active={tab}
                onChange={setTab}
              />
              {!isTerminal ? (
                <TabBtn
                  id="modify"
                  label={t('rfq.detail.tabs.modify')}
                  icon={<PencilLine size={14} />}
                  active={tab}
                  onChange={setTab}
                />
              ) : null}
              <TabBtn
                id="history"
                label={t('rfq.detail.tabs.history')}
                icon={<History size={14} />}
                active={tab}
                onChange={setTab}
              />
            </div>
          </div>
        </div>

        <CardContent className="divide-y divide-border pt-6 [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
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
                      <p className="text-muted-foreground">
                        {t('rfq.detail.org.taxId')}: <strong>{rfq.organization.taxId}</strong>
                      </p>
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
                            {proposal !== null ? format.amount(proposal) : '—'}
                          </TableCell>
                          <TableCell>
                            <DifferenceCell
                              price={proposal}
                              currency={it.lineCurrency}
                              reference={referencePriceOf(reference)}
                            />
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {it.agreedUnitPrice !== null ? format.amount(it.agreedUnitPrice) : '—'}
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

          {tab === 'modify' && !isTerminal ? (
            <ModifyCard
              rfq={rfq}
              currentPrices={currentPrices}
              onSaved={refresh}
              setError={setError}
              setInfo={setInfo}
              focusValidityNonce={validityFocusNonce}
            />
          ) : null}

          {tab === 'history' ? (
            <Section title={t('rfq.detail.history.title')}>
              <RfqHistory key={historyNonce} quoteRequestId={rfq.id} />
            </Section>
          ) : null}
        </CardContent>
      </Card>

      {/* Panels other modules add to this screen. The host knows none of them;
          with nobody contributing this renders nothing at all. */}
      {id ? <AdminZone name="quote_request.detail.after" props={{ quoteRequestId: id }} /> : null}

      {cancelOpen ? (
        <CancelDialog
          reason={cancelReason}
          onReasonChange={setCancelReason}
          onConfirm={(): void => void cancel()}
          onClose={(): void => setCancelOpen(false)}
          busy={busy}
        />
      ) : null}
    </>
  );
}

/**
 * Cancellation modal — captures the (optional) cancellation reason on an
 * overlay rather than stretching the status row, then confirms the cancel.
 */
function CancelDialog(props: {
  reason: string;
  onReasonChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
  busy: boolean;
}): ReactNode {
  const t = useTranslation('core');
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={props.onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e): void => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">{t('rfq.detail.cancelDialog.title')}</h2>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">{t('rfq.detail.cancelReason')}</Label>
          <Textarea
            id="cancel-reason"
            autoFocus
            value={props.reason}
            onChange={(e): void => props.onReasonChange(e.target.value)}
            placeholder={t('rfq.detail.cancelReasonPlaceholder')}
            rows={3}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={props.onClose} disabled={props.busy}>
            {t('rfq.detail.cancelDialog.dismiss')}
          </Button>
          <Button variant="destructive" onClick={props.onConfirm} disabled={props.busy}>
            <XCircle size={14} className="mr-1" /> {t('rfq.detail.cancelDialog.confirm')}
          </Button>
        </div>
      </div>
    </div>
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

function TabBtn(props: {
  id: RfqTab;
  label: string;
  icon: ReactNode;
  active: RfqTab;
  onChange: (id: RfqTab) => void;
}): ReactNode {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active === props.id}
      className={cn('b2b-tab', props.active === props.id && 'is-active')}
      onClick={(): void => props.onChange(props.id)}
    >
      {props.icon}
      {props.label}
    </button>
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
  return price !== null ? price.amount * quantity : null;
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
  setInfo,
  focusValidityNonce,
}: {
  rfq: AdminRfqDetail;
  /** The current prices `RfqDetail` asked for the lines with no stored reference. */
  currentPrices: CurrentPrices;
  onSaved: () => Promise<void>;
  setError: (msg: string | null) => void;
  setInfo: (msg: string | null) => void;
  /** Changes when the operator asked for the deadline field from elsewhere. */
  focusValidityNonce: number;
}): ReactNode {
  const t = useTranslation('core');
  const tGroups = useTranslation('quote_requests');
  const groupLabels = useQuoteLineGroupLabels();
  const splitLabels = useQuoteSplitLineLabels();
  const summaryText = useSectionSummaryText();
  const format = useRfqNumberFormat();
  const [headerNote, setHeaderNote] = useState(rfq.headerNote ?? '');
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
  // Blank means "leave the deadline where it is" — that is `expiresInDays`
  // being absent from the PATCH, which is what the contract reads as "do not
  // touch it". It is never prefilled: `expiresInDays` counts from *now*, so
  // any number put here on the operator's behalf would be this screen choosing
  // a date the customer is then held to.
  const [expiresInDays, setExpiresInDays] = useState('');
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
        agreedUnitPrice: definedPrice !== null ? roundAmountHalfUp(definedPrice) : '',
      };
    }),
  );
  const [busy, setBusy] = useState(false);

  // Prefill an empty agreed unit price with the price the request's customer
  // would pay on the request's channel (FR-007) — never the operator's own
  // storefront price — so the operator starts from that customer's price and
  // only edits the negotiated delta. Never clobbers a value already present (an
  // existing agreed price, or one the operator just typed). A failed probe
  // leaves the input empty (L2).
  const prefillAgreed = useCallback(
    (key: string, line: { productId: string; variantId: string | null; quantity: number }): void => {
      void probeCustomerPrice(rfq, line).then((price) => {
        setLines((prev) =>
          prev.map((l) =>
            l.key === key && l.productId === line.productId
              ? {
                  ...l,
                  currentPrice: price,
                  ...(price !== null && l.agreedUnitPrice.trim() === ''
                    ? { agreedUnitPrice: roundAmountHalfUp(price.amount) }
                    : {}),
                }
              : l,
          ),
        );
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
        prefillAgreed(it.id, { productId: it.productId, variantId: it.variantId ?? null, quantity: it.quantity });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Land the caret on the deadline field when the operator arrived here from
  // the lapsed banner: the remedy they asked for is the one control they
  // should not have to hunt for in this form (Fitts's Law).
  useEffect(() => {
    if (focusValidityNonce > 0) validityInputRef.current?.focus();
  }, [focusValidityNonce]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // Feature 159 — a group needs a name; the field says so too.
      if (groups.some((group) => group.name.trim() === '')) {
        setError(tGroups('lineGroups.nameRequired'));
        setBusy(false);
        return;
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
        setError(t('rfq.detail.modify.error.atLeastOneLine'));
        setBusy(false);
        return;
      }
      // A deadline the contract would refuse is refused here rather than
      // dropped from the payload: an operator who typed a number and got no
      // deadline would have been told nothing.
      const typedDays = expiresInDays.trim();
      if (isValidityDaysInvalid(typedDays, new Date())) {
        setError(t('rfq.detail.validity.error.days'));
        setBusy(false);
        validityInputRef.current?.focus();
        return;
      }
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
          // reads as untouched.
          ...(typedDays !== '' ? { expiresInDays: Number(typedDays) } : {}),
        },
        { headers: { 'If-Match': `"${rfq.version}"` } },
      );
      setInfo(t('rfq.detail.modify.info.saved'));
      await onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfq.detail.modify.error.save'));
    } finally {
      setBusy(false);
    }
  };

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
    const lineTotal =
      typedAgreed !== null && qtyNum > 0
        ? typedAgreed * qtyNum
        : desired !== null && qtyNum > 0
          ? desired * qtyNum
          : null;
    return { orig, desired, reference, qtyNum, typedAgreed, lineTotal };
  };

  // A plain grid (not <Table>, which wraps in an overflow-auto container that
  // would clip the product dropdown) so the picker's options overlay outside
  // the row instead of being trapped inside it. The fixed-width columns only
  // engage at md+ (where the header is visible); on narrower widths the row
  // stacks so the trailing actions column can't overflow and break the layout.
  const gridCols =
    'md:grid-cols-[minmax(180px,1fr)_80px_120px_130px_100px_120px_130px_auto]';

  // The deadline field's answers, all about the same date: what saving would
  // set, or — while the field is blank — what leaving it blank keeps. "Blank"
  // and "no deadline" are two of those answers and must not read as one.
  const now = new Date();
  const currentValidity = rfqValidity(rfq.expiresAt, now);
  const typedDays = expiresInDays.trim();
  const previewDeadline = deadlineForDays(expiresInDays, now);
  const daysInvalid = isValidityDaysInvalid(expiresInDays, now);
  const validityHelp = daysInvalid
    ? t('rfq.detail.validity.error.days')
    : previewDeadline !== null
      ? t(
          Number(typedDays) === 0
            ? 'rfq.detail.validity.help.previewImmediate'
            : 'rfq.detail.validity.help.preview',
          { date: formatDateTime(previewDeadline.toISOString()) },
        )
      : currentValidity.kind === 'none'
        ? t('rfq.detail.validity.help.keepNone')
        : t(
            currentValidity.kind === 'active'
              ? 'rfq.detail.validity.help.keepActive'
              : 'rfq.detail.validity.help.keepLapsed',
            { date: formatDateTime(currentValidity.expiresAt) },
          );

  return (
    <Section title={t('rfq.detail.modify.title')}>
      <div className="space-y-3">
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
            {t('rfq.detail.validity.field')}
          </Label>
          <Input
            id="modify-expires-in-days"
            ref={validityInputRef}
            type="number"
            min={0}
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
        <div className="space-y-2">
          <div
            className={cn(
              'hidden gap-3 px-1 text-xs font-medium text-muted-foreground md:grid',
              gridCols,
            )}
          >
            <span>{t('rfq.detail.modify.productId')}</span>
            <span>{t('rfq.detail.modify.quantity')}</span>
            <span>{t('rfq.detail.modify.agreedUnitPrice')}</span>
            <span>{t('rfq.detail.reference.column.reference')}</span>
            <span>{t('rfq.detail.reference.column.proposed')}</span>
            <span>{t('rfq.detail.reference.column.difference')}</span>
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
                    step="0.01"
                    min={0}
                    aria-label={t('rfq.detail.modify.agreedUnitPrice')}
                    value={l.agreedUnitPrice}
                    onChange={(e): void => updateLine(l.key, { agreedUnitPrice: e.target.value })}
                    className="tabular-nums"
                  />
                  <div className="flex min-h-9 items-center text-sm">
                    <ReferenceCell view={reference} perBaseUnit={Boolean(orig?.packagingUnitName)} />
                  </div>
                  <span className="flex min-h-9 items-center text-sm tabular-nums text-muted-foreground">
                    {desired !== null ? format.money(desired, currency) : '—'}
                  </span>
                  <div className="flex min-h-9 items-center text-sm">
                    <DifferenceCell
                      price={typedAgreed}
                      currency={orig?.lineCurrency ?? currency}
                      reference={referencePriceOf(reference)}
                    />
                  </div>
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
            {t('rfq.detail.modify.addLine')}
          </Button>
        </div>
        <div>
          <Button onClick={(): void => void save()} disabled={busy}>
            {t('rfq.detail.modify.saveRevision')}
          </Button>
        </div>
      </div>
    </Section>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqDetail;
