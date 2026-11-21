import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FileText, Mail, ShieldOff, Store, UserRound } from 'lucide-react';
import { ApiError, apiBaseUrl, formatDateTime, formatMoney, useAuth } from '@endora-commerce/admin-kit/lib';
import { ConfirmDialog, RowActionMenu, RowActionMenuItem, RowActionMenuSeparator } from '@endora-commerce/admin-kit/components';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, InlineStatus, Input, Label, Select, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Textarea, useInlineStatus, type InlineStatusState } from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { returnsClient, type RefundPaymentMethodOption, type ReturnShipmentRow } from '../api/returns-client.js';
import { returnStatusName } from '../labels.js';
import { ResolutionRadioGroup } from '../components/ResolutionRadioGroup.js';
import { RejectReturnDialog } from '../components/RejectReturnDialog.js';
import { CONSUMER_WITHDRAWAL_PANEL_ID, ConsumerWithdrawalPanel } from './ConsumerWithdrawalPanel.js';

import type {
  ReturnCaseDetail,
  ReturnStatusDto,
  ReturnTransitionDto,
  SettlementPrefill,
  SettlementResult,
} from '@endora-commerce/contracts';

type Resolution = SettlementPrefill['defaultResolution'];
const RESOLUTIONS: readonly Resolution[] = ['refund', 'credit', 'replacement', 'repair'];

export interface RefundMethodChoice {
  id: string;
  label: string;
}

/**
 * The refund payment methods the settlement form offers, by name (issue #905):
 * the order's own method first and marked as such, then the rest by name. The
 * order's method stays on the list when the payment-method list does not hold
 * it, and so does a chosen id the list does not know, so the form never loses
 * the value it is about to send.
 */
export function refundMethodChoices(input: {
  methods: readonly RefundPaymentMethodOption[];
  orderMethodId: string | null;
  chosenId: string;
  language: string;
  orderMethodLabel: (name: string) => string;
  orderMethodUnnamedLabel: string;
}): RefundMethodChoice[] {
  const nameOf = (m: RefundPaymentMethodOption): string =>
    m.name[input.language] ?? m.name['en'] ?? Object.values(m.name)[0] ?? m.code;
  const others = input.methods
    .filter((m) => m.id !== input.orderMethodId)
    .map((m) => ({ id: m.id, label: nameOf(m) }))
    .sort((a, b) => a.label.localeCompare(b.label, input.language));
  const choices: RefundMethodChoice[] = [];
  if (input.orderMethodId) {
    const own = input.methods.find((m) => m.id === input.orderMethodId);
    choices.push({
      id: input.orderMethodId,
      label: own ? input.orderMethodLabel(nameOf(own)) : input.orderMethodUnnamedLabel,
    });
  }
  choices.push(...others);
  if (input.chosenId && !choices.some((c) => c.id === input.chosenId)) {
    choices.push({ id: input.chosenId, label: input.chosenId });
  }
  return choices;
}

/**
 * Who authorized the case and when (`specs/180-off-platform-complaints/` FR-A41 –
 * FR-A43): "{at} by {name}", "{at} by former administrator" for an id that resolves
 * to no administrator, "{at}, authorizer unknown" when none was recorded, or "Not
 * yet".
 */
export function authorizedText(
  rc: Pick<ReturnCaseDetail, 'authorizedAt' | 'authorizedBy'>,
  tr: (key: string, params?: Record<string, string | number>) => string,
): string {
  if (!rc.authorizedAt) return tr('detail.notAuthorized');
  const at = formatDateTime(rc.authorizedAt);
  if (!rc.authorizedBy?.adminUserId) return tr('detail.authorizedUnknown', { at });
  if (rc.authorizedBy.name === null) return tr('detail.authorizedByFormer', { at });
  return tr('detail.authorizedBy', { at, name: rc.authorizedBy.name });
}

/** Returns / RMA case detail (feature 046, US2/US4/US5/US6). */
export function ReturnDetail(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  const consentHintId = useId();
  const refundWarningId = useId();
  const paymentMethodHintId = useId();
  const commentBoxId = useId();
  const commentVisibleId = useId();
  const commentNotifyId = useId();
  const commentNotifyHintId = useId();
  const { id = '' } = useParams<{ id: string }>();
  const [rc, setRc] = useState<ReturnCaseDetail | null>(null);
  const [transitions, setTransitions] = useState<ReturnTransitionDto[]>([]);
  // PO ruling on #945 (Q3): a terminal status of the configured graph closes the consent.
  const [statusIsTerminal, setStatusIsTerminal] = useState(false);
  const [shipments, setShipments] = useState<ReturnShipmentRow[]>([]);
  // Issue #1472 — transitions are named by their target status, in the operator's language.
  const [statuses, setStatuses] = useState<ReturnStatusDto[]>([]);
  // `undefined` while loading or for a case without an order; `null` when the order cannot be read.
  const [orderNumber, setOrderNumber] = useState<string | null | undefined>(undefined);
  const [prefill, setPrefill] = useState<SettlementPrefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The case could not be loaded and the API said nothing: the message is the screen's own,
  // translated at render so `refresh` does not depend on the bundle.
  const [loadFailed, setLoadFailed] = useState(false);
  // Issue #1472 (README rule from #1499): an action's result is an InlineStatus beside the
  // control that produced it; errors stay a banner. The settlement card and the reject dialog
  // go away with their result, so theirs is said beside the case's actions.
  const actionsStatus = useInlineStatus();
  const shipmentsStatus = useInlineStatus();
  const commentsStatus = useInlineStatus();
  // Issue #311 — the rejection reason is asked for in a dialog, not `window.prompt()`.
  const [rejecting, setRejecting] = useState(false);
  const rejectButtonRef = useRef<HTMLButtonElement>(null);

  const [commentBody, setCommentBody] = useState('');
  // `specs/180-off-platform-complaints/` D-16 — a new comment is internal until the
  // operator says otherwise: since FR-A20 a visible comment with *notify* is e-mailed.
  const [commentVisible, setCommentVisible] = useState(false);
  const [commentNotify, setCommentNotify] = useState(false);

  const [resolution, setResolution] = useState<Resolution>('refund');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  // `undefined` while loading, `null` when the list cannot be read (module off,
  // no permission): the field then falls back to the method's id.
  const [paymentMethods, setPaymentMethods] = useState<RefundPaymentMethodOption[] | null | undefined>(undefined);
  const [approved, setApproved] = useState<Record<string, number>>({});
  // Issue #876 — the delivery and surcharge a consumer's completing withdrawal
  // refunds. Only an amount the operator edited is sent (ruling Q2 on PR #965):
  // an omitted one settles at the default recomputed under the order's lock,
  // a sent one exactly as typed, 0 included.
  const [approvedCharges, setApprovedCharges] = useState<{ delivery?: number; surcharge?: number }>({});
  // Issue #150 — a correction is asked for by default, as the screen always
  // did; the control exists because "not requested" is one of the three
  // outcomes below and an operator has to be able to reach it deliberately.
  const [createCorrectiveInvoice, setCreateCorrectiveInvoice] = useState(true);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);
  // 180 FR-B33a — how an off-platform case was settled outside the platform.
  const [resolutionNote, setResolutionNote] = useState('');
  const [noteError, setNoteError] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const noteId = useId();
  const noteHintId = useId();
  const noteErrorId = useId();

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    setLoadFailed(false);
    try {
      const [detail, graph, ship] = await Promise.all([
        returnsClient.get(id),
        returnsClient.statuses(),
        returnsClient.shipments(id).catch(() => []),
      ]);
      setRc(detail);
      setTransitions(graph.transitions.filter((t) => t.fromStatusCode === detail.statusCode));
      setStatuses(graph.statuses);
      const terminal = graph.statuses.some((s) => s.code === detail.statusCode && s.isTerminal);
      setStatusIsTerminal(terminal);
      setShipments(ship);
      // 180 D-5 — an off-platform case is settled from its authorization until it
      // is closed, whether or not goods were received.
      const offPlatformOpen =
        detail.offPlatform === true && detail.authorizedAt != null && detail.resolutionType == null && !terminal;
      if (detail.statusCode === 'received' || offPlatformOpen) {
        const pf = await returnsClient.settlementPrefill(id);
        setPrefill(pf);
        // Feature 155 (owner ruling R1) — the stored approved amount, not the
        // amount paid: a complaint line that was not returnable at purchase is
        // stored at 0, so nothing is refunded for it unless the operator sets it.
        setApproved(Object.fromEntries(pf.items.map((it) => [it.returnCaseItemId, it.approvedRefundAmount])));
        setApprovedCharges({});
        // Issue #905 (design D1) — a refund to the order's own payment method.
        setResolution(pf.defaultResolution ?? 'refund');
        setPaymentMethodId(pf.defaultRefundPaymentMethodId ?? '');
      } else {
        setPrefill(null);
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.envelope.error.message);
      else setLoadFailed(true);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Issue #1472 — the order by its number. Best effort: the order belongs to `orders`.
  const orderId = rc?.orderId ?? null;
  useEffect(() => {
    if (!orderId) return undefined;
    let live = true;
    returnsClient
      .orderBusinessId(orderId)
      .then((number) => {
        if (live) setOrderNumber(number || null);
      })
      .catch(() => {
        if (live) setOrderNumber(null);
      });
    return (): void => {
      live = false;
    };
  }, [orderId]);

  useEffect(() => {
    let live = true;
    returnsClient
      .refundPaymentMethods()
      .then((list) => {
        if (live) setPaymentMethods(Array.isArray(list) && list.length > 0 ? list : null);
      })
      .catch(() => {
        if (live) setPaymentMethods(null);
      });
    return (): void => {
      live = false;
    };
  }, []);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string, status: InlineStatusState): Promise<void> => {
      setError(null);
      status.clear();
      try {
        await fn();
        await refresh();
        status.show(ok);
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('returns.detail.actionFailed'));
      }
    },
    [refresh, t],
  );

  if (!rc) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('returns.detail.title')} back={{ label: tr('detail.back'), to: '/returns' }} />
        {(error || loadFailed) && (
          <Alert variant="destructive">
            <AlertDescription>{error ?? tr('detail.loadFailed')}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const isNew = rc.statusCode === 'new';
  // Feature 155 (owner ruling R1) — complaint lines recorded not returnable at
  // purchase; they start with an approved refund of 0.
  const notReturnableItemIds = new Set(
    rc.items.filter((it) => it.returnableAtPurchase === false).map((it) => it.id),
  );
  // Issue #905 (design D1) — what a consumer withdrawal cannot settle as yet.
  const consentRequiredFor = new Set<string>(prefill?.consentRequiredFor ?? []);
  const orderMethodId = prefill?.defaultRefundPaymentMethodId ?? null;
  // Shown once another method is actually chosen — not while the field is empty.
  const refundMethodDiffers =
    rc.consumerWithdrawal === true &&
    resolution === 'refund' &&
    orderMethodId !== null &&
    paymentMethodId.trim() !== '' &&
    paymentMethodId.trim() !== orderMethodId;
  // While the list loads the order's own method is offered unnamed; when it
  // cannot be read the field takes an id instead.
  const methodChoices =
    paymentMethods === null
      ? null
      : refundMethodChoices({
          methods: paymentMethods ?? [],
          orderMethodId,
          chosenId: paymentMethodId,
          language,
          orderMethodLabel: (name) => tr('settlement.orderMethod', { name }),
          orderMethodUnnamedLabel: tr('settlement.orderMethodUnnamed'),
        });
  const notReturnableBadge = (
    <Badge variant="warning" className="ml-2">
      {t('returns.detail.notReturnableAtPurchase')}
    </Badge>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        back={{ label: tr('detail.back'), to: '/returns' }}
        title={
          <span className="flex items-center gap-2">
            {/* 180 FR-A44 — the RMA number, else the derived reference. */}
            {rc.rmaNumber ?? rc.reference} <Badge variant="secondary">{rc.statusLabel}</Badge>
            <Badge variant="outline">{t(`returns.kind.${rc.kind}`)}</Badge>
            {rc.consumerWithdrawal === true && <Badge variant="warning">{tr('consent.badge')}</Badge>}
            {rc.guest && (
              // 181 FR-063 — filed by a guest without an account; text and an icon.
              <Badge variant="outline" className="gap-1">
                <UserRound className="size-3" aria-hidden="true" />
                {tr('list.guest')}
              </Badge>
            )}
          </span>
        }
        description={
          rc.offPlatform ? (
            <span className="flex items-center gap-2">
              <Badge variant="outline" className="gap-1">
                <Store className="size-3" aria-hidden="true" />
                {tr('list.offPlatform')}
              </Badge>
              {tr('detail.noOrder')}
            </span>
          ) : rc.orderId ? (
            <Link to={`/orders/${rc.orderId}`} className="underline underline-offset-2">
              {orderNumber ? tr('detail.order', { number: orderNumber }) : tr('detail.orderUnnamed')}
            </Link>
          ) : null
        }
      />

      {(error || loadFailed) && (
        <Alert variant="destructive">
          <AlertDescription>{error ?? tr('detail.loadFailed')}</AlertDescription>
        </Alert>
      )}
      {/* Actions */}
      <Card data-actions-card="">
        <CardHeader>
          <CardTitle>{tr('detail.actions')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {isNew && (
            <Button size="sm" onClick={() => void run(() => returnsClient.authorize(id), tr('detail.authorizedInfo'), actionsStatus)}>
              {tr('detail.authorize')}
            </Button>
          )}
          <Button ref={rejectButtonRef} variant="destructive" size="sm" onClick={() => setRejecting(true)}>
            {tr('reject.action')}
          </Button>
          {transitions.map((transition) => {
            const target = statuses.find((s) => s.code === transition.toStatusCode);
            const status = target ? returnStatusName(target, language) : transition.toStatusCode;
            return (
              <Button
                key={transition.toStatusCode}
                variant="outline"
                size="sm"
                onClick={() =>
                  void run(
                    () => returnsClient.transition(id, transition.toStatusCode),
                    tr('detail.movedTo', { status }),
                    actionsStatus,
                  )
                }
              >
                {tr('detail.moveTo', { status })}
              </Button>
            );
          })}
          {rc.guest && !rc.personalDataErasedAt && (
            <GuestCaseActions
              rc={rc}
              onDone={async (message) => {
                setError(null);
                await refresh();
                actionsStatus.show(message);
              }}
            />
          )}
          <InlineStatus {...actionsStatus.props} />
        </CardContent>
      </Card>

      {rejecting && (
        <RejectReturnDialog
          returnFocusRef={rejectButtonRef}
          onClose={() => setRejecting(false)}
          onReject={async (reason) => {
            await returnsClient.reject(id, reason);
            setRejecting(false);
            setError(null);
            await refresh();
            actionsStatus.show(tr('reject.rejectedInfo'));
          }}
        />
      )}

      {rc.consumerWithdrawal === true && (
        <ConsumerWithdrawalPanel
          closed={statusIsTerminal}
          rc={rc}
          onChanged={refresh}
        />
      )}

      {/*
        The case (180 FR-A41, design review R-5.2): when it was filed and who
        authorized it, beside the time — "former administrator" for an id that no
        longer resolves (FR-A42), "unknown" when none was recorded (FR-A43).
      */}
      <Card>
        <CardHeader>
          <CardTitle>{tr('detail.caseCard')}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{tr('detail.submitted')}</dt>
            <dd>{formatDateTime(rc.submittedAt)}</dd>
            <dt className="text-muted-foreground">{tr('detail.authorized')}</dt>
            <dd>{authorizedText(rc, tr)}</dd>
            {rc.resolutionType === 'settled_outside' && (
              <>
                <dt className="text-muted-foreground">{tr('detail.settledOutsideNote')}</dt>
                <dd className="whitespace-pre-line">{rc.resolutionNote}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {rc.offPlatform && <PurchaseAndContact rc={rc} />}

      {/* Items */}
      <Card>
        <CardHeader>
          <CardTitle>{tr('detail.items')}</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('returns.detail.col.product')}</TableHead>
                <TableHead className="text-right">{tr('detail.col.qty')}</TableHead>
                <TableHead className="text-right">{tr('detail.col.defaultRefund')}</TableHead>
                <TableHead className="text-right">{t('returns.detail.col.approved')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rc.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    {it.productName}
                    {it.returnableAtPurchase === false ? notReturnableBadge : null}
                    <LineAttachments rc={rc} itemId={it.id} productName={it.productName} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(it.defaultRefundAmount, rc.currency)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(it.approvedRefundAmount, rc.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AttachmentsCard rc={rc} />
      {(rc.acceptedClauses ?? []).length > 0 && <AcceptedClausesCard rc={rc} />}

      {/* Settlement (when received) */}
      {prefill && (
        <Card>
          <CardHeader>
            <CardTitle>{t('returns.detail.settlement.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {rc.offPlatform && (
              // 180 FR-B33 — say why refunds are absent rather than hiding them silently.
              <p className="text-sm text-muted-foreground">{tr('settlement.offPlatformExplanation')}</p>
            )}
            <ResolutionRadioGroup
              name="resolution"
              legend={t('returns.detail.settlement.resolution')}
              options={rc.offPlatform ? prefill.resolutionOptions : RESOLUTIONS}
              value={resolution}
              onChange={(next) => {
                setResolution(next);
                setNoteError(false);
              }}
              label={(option) =>
                option === 'settled_outside' ? tr('settlement.settledOutside') : t(`returns.detail.resolution.${option}`)
              }
              closed={consentRequiredFor}
              closedReason={tr('consent.needsConsent')}
              {...(consentRequiredFor.size > 0 ? { describedBy: consentHintId } : {})}
            />
            {consentRequiredFor.size > 0 && (
              <p className="text-sm text-muted-foreground">
                <span id={consentHintId}>{tr('consent.requiredHint')}</span>{' '}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 align-baseline"
                  onClick={() => document.getElementById(CONSUMER_WITHDRAWAL_PANEL_ID)?.focus()}
                >
                  {tr('consent.goToPanel')}
                </Button>
              </p>
            )}
            {rc.offPlatform && resolution === 'settled_outside' && (
              <div className="space-y-1">
                <Label htmlFor={noteId}>{tr('settlement.note')}</Label>
                <Textarea
                  id={noteId}
                  ref={noteRef}
                  required
                  maxLength={2000}
                  value={resolutionNote}
                  onChange={(e) => {
                    setResolutionNote(e.target.value);
                    if (e.target.value.trim()) setNoteError(false);
                  }}
                  aria-invalid={noteError}
                  aria-describedby={[noteHintId, noteError ? noteErrorId : ''].filter(Boolean).join(' ')}
                />
                <p id={noteHintId} className="text-xs text-muted-foreground">
                  {tr('settlement.noteHint')} {resolutionNote.length} / 2000
                </p>
                {noteError && (
                  <p id={noteErrorId} className="text-sm text-destructive">
                    {tr('settlement.noteRequired')}
                  </p>
                )}
              </div>
            )}
            {!rc.offPlatform && resolution === 'refund' && (
              <div className="space-y-1">
                <Label htmlFor="pm">{t('returns.detail.settlement.paymentMethodId')}</Label>
                {methodChoices ? (
                  <Select
                    id="pm"
                    className="w-auto min-w-64"
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                    {...(refundMethodDiffers ? { 'aria-describedby': refundWarningId } : {})}
                  >
                    {paymentMethodId === '' && <option value="">{tr('settlement.chooseMethod')}</option>}
                    {methodChoices.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <>
                    <Input
                      id="pm"
                      className="w-96 max-w-full font-mono"
                      spellCheck={false}
                      autoComplete="off"
                      value={paymentMethodId}
                      onChange={(e) => setPaymentMethodId(e.target.value)}
                      aria-describedby={[paymentMethodHintId, refundMethodDiffers ? refundWarningId : '']
                        .filter(Boolean)
                        .join(' ')}
                    />
                    <p id={paymentMethodHintId} className="text-xs text-muted-foreground">
                      {tr('settlement.paymentMethodIdHint')}
                    </p>
                  </>
                )}
              </div>
            )}
            {refundMethodDiffers && (
              <Alert variant="warning" live="polite" id={refundWarningId}>
                <AlertDescription>{tr('settlement.refundMethodDiffers')}</AlertDescription>
              </Alert>
            )}
            {!rc.offPlatform && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('returns.detail.col.product')}</TableHead>
                  <TableHead>{t('returns.detail.settlement.maxPaid')}</TableHead>
                  <TableHead>{t('returns.detail.col.approved')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prefill.items.map((it) => (
                  <TableRow key={it.returnCaseItemId}>
                    <TableCell>
                      {it.productName}
                      {notReturnableItemIds.has(it.returnCaseItemId) ? notReturnableBadge : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatMoney(it.defaultRefundAmount, rc.currency)}</TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        aria-label={tr('settlement.approvedFor', { product: it.productName })}
                        className="h-8 w-28 px-2"
                        value={approved[it.returnCaseItemId] ?? 0}
                        onChange={(e) =>
                          setApproved((prev) => ({ ...prev, [it.returnCaseItemId]: Number(e.target.value) }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {/*
                  Issue #876 — a consumer's withdrawal that completes the order
                  refunds the delivery and the payment surcharge (Directive
                  2011/83 art. 13(1)). Shown only when there is something to
                  refund; lower it for a premium delivery (art. 13(2)).
                */}
                {(['delivery', 'surcharge'] as const).map((key) => {
                  const charge = prefill.charges?.[key];
                  if (!charge || charge.cap <= 0) return null;
                  const label =
                    key === 'delivery'
                      ? t('returns.detail.settlement.charge.delivery')
                      : t('returns.detail.settlement.charge.surcharge');
                  return (
                    <TableRow key={key}>
                      <TableCell>{label}</TableCell>
                      <TableCell className="tabular-nums">{formatMoney(charge.cap, rc.currency)}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          max={charge.cap}
                          aria-label={label}
                          className="h-8 w-28 px-2"
                          value={approvedCharges[key] ?? charge.approved}
                          onChange={(e) => setApprovedCharges((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            )}
            {!rc.offPlatform && prefill.charges ? (
              <p className="text-xs text-muted-foreground">{t('returns.detail.settlement.charge.hint')}</p>
            ) : null}
            {!rc.offPlatform && (
              <label className="flex items-center gap-2 text-sm" htmlFor="createCorrectiveInvoice">
                <Checkbox
                  id="createCorrectiveInvoice"
                  checked={createCorrectiveInvoice}
                  onChange={(e) => setCreateCorrectiveInvoice(e.target.checked)}
                />
                {t('returns.detail.settlement.createCorrectiveInvoice')}
              </label>
            )}
            <Button
              size="sm"
              onClick={() =>
                void (async () => {
                  setError(null);
                  actionsStatus.clear();
                  if (rc.offPlatform) {
                    // 180 FR-B33a — the button stays enabled and says why on click.
                    if (resolution === 'settled_outside' && !resolutionNote.trim()) {
                      setNoteError(true);
                      noteRef.current?.focus();
                      return;
                    }
                    try {
                      await returnsClient.settle(id, {
                        resolutionType: resolution,
                        lines: [],
                        ...(resolution === 'settled_outside' ? { resolutionNote: resolutionNote.trim() } : {}),
                      });
                      setResolutionNote('');
                      await refresh();
                      actionsStatus.show(t('returns.detail.settlement.done'));
                    } catch (err) {
                      setError(err instanceof ApiError ? err.envelope.error.message : t('returns.detail.actionFailed'));
                    }
                    return;
                  }
                  try {
                    const settled = await returnsClient.settle(id, {
                      resolutionType: resolution,
                      lines: prefill.items.map((it) => ({
                        returnCaseItemId: it.returnCaseItemId,
                        approvedRefundAmount: approved[it.returnCaseItemId] ?? 0,
                      })),
                      ...(resolution === 'refund' && paymentMethodId.trim()
                        ? { refundPaymentMethodId: paymentMethodId.trim() }
                        : {}),
                      ...(approvedCharges.delivery !== undefined ? { deliveryRefundAmount: approvedCharges.delivery } : {}),
                      ...(approvedCharges.surcharge !== undefined ? { surchargeRefundAmount: approvedCharges.surcharge } : {}),
                      createCorrectiveInvoice,
                    });
                    // Issue #150 — kept whatever the gateway said, because the
                    // corrective invoice is a separate answer: a settlement can
                    // succeed and still, correctly, produce no document.
                    setSettlement(settled);
                    if (settled.refund?.settlementState === 'failed') {
                      setError(
                        settled.refund.failureReason ?? t('returns.detail.settlement.gatewayRejected'),
                      );
                    } else {
                    }
                    await refresh();
                    if (settled.refund?.settlementState !== 'failed') actionsStatus.show(t('returns.detail.settlement.done'));
                  } catch (err) {
                    setError(
                      err instanceof ApiError
                        ? err.envelope.error.message
                        : t('returns.detail.actionFailed'),
                    );
                  }
                })()
              }
            >
              {t('returns.detail.settlement.settle')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/*
        What became of the corrective invoice (issue #150, then #156 / D-92).

        Three outcomes, all three legible. "Not due" is the one the product
        owner ruled on: a settled return on an order that was never invoiced
        deliberately produces no document, and a screen that says nothing makes
        that indistinguishable from a document that failed to appear.

        Two sources, in this order. The settlement just performed is the richer
        one — it carries the document's number — and it is the moment the
        operator can act on the answer. After a reload there is no settlement in
        this session, and the case detail carries the persisted three-way
        outcome (D-92): the `Refund` row used to hold the invoice id alone, so
        `null` meant "not due", "not requested" and "asked for, and we do not
        know" at once. The number is deliberately not read back — resolving it
        would mean reading `invoices` from this screen's endpoint, which must
        keep answering while that module is off — so the persisted `issued` case
        links by id.
      */}
      {(settlement || rc.correctiveInvoice) && (
        <Card>
          <CardHeader>
            <CardTitle>{t('returns.detail.correctiveInvoice.title')}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {settlement ? (
              settlement.correctiveInvoice === undefined ? (
                <p className="text-muted-foreground">
                  {t('returns.detail.correctiveInvoice.notRequested')}
                </p>
              ) : settlement.correctiveInvoice.issued ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t('returns.detail.correctiveInvoice.issued')}</Badge>
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/invoices/${settlement.correctiveInvoice.invoiceId}`}>
                      {settlement.correctiveInvoice.number}
                    </Link>
                  </Button>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {t(
                    `returns.detail.correctiveInvoice.notDue.${settlement.correctiveInvoice.reason}`,
                  )}
                </p>
              )
            ) : rc.correctiveInvoice?.outcome === 'issued' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{t('returns.detail.correctiveInvoice.issued')}</Badge>
                {rc.correctiveInvoice.invoiceId && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/invoices/${rc.correctiveInvoice.invoiceId}`}>
                      {t('returns.detail.correctiveInvoice.open')}
                    </Link>
                  </Button>
                )}
              </div>
            ) : rc.correctiveInvoice?.outcome === 'not_due' ? (
              <p className="text-muted-foreground">
                {t('returns.detail.correctiveInvoice.notDue.order_not_invoiced')}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {t('returns.detail.correctiveInvoice.notRequested')}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Shipments */}
      <Card data-shipments-card="">
        <CardHeader>
          <CardTitle>{tr('shipments.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {shipments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tr('shipments.none')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tr('shipments.col.direction')}</TableHead>
                  <TableHead>{tr('shipments.col.status')}</TableHead>
                  <TableHead>{tr('shipments.col.tracking')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shipments.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell>{tr(`shipments.direction.${s.direction}`)}</TableCell>
                    <TableCell>{tr(`shipments.status.${s.status}`)}</TableCell>
                    <TableCell>{s.externalReference ?? '—'}</TableCell>
                    <TableCell className="text-right">
                      {s.status === 'pending' && s.direction === 'inbound' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void run(() => returnsClient.receiveShipment(id, s.id), tr('shipments.received'), shipmentsStatus)}
                        >
                          {tr('shipments.markReceived')}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void run(() => returnsClient.createShipment(id, 'inbound'), tr('shipments.recorded'), shipmentsStatus)}
            >
              {tr('shipments.recordInbound')}
            </Button>
            <InlineStatus {...shipmentsStatus.props} />
          </div>
        </CardContent>
      </Card>

      {/* Comments (180 FR-A20, FR-A21; D-16, D-17; design review R-5.8) */}
      <Card>
        <CardHeader>
          <CardTitle>{tr('comments.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Issue #1437 (DS-03): rows divided by a rule, not a bordered box per comment. */}
          {rc.comments.length > 0 && (
            <ul className="divide-y">
              {rc.comments.map((c) => (
                <li key={c.id} className="space-y-1 py-2 text-sm first:pt-0">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{tr(`comments.author.${c.authorKind}`)}</span>
                    <span>{formatDateTime(c.createdAt)}</span>
                    {!c.isCustomerVisible && <Badge variant="outline">{tr('comments.internalBadge')}</Badge>}
                    {/* "requested", not "sent": delivery is asynchronous and may fail (FR-A50). */}
                    {c.notifyCustomer === true && (
                      <span className="inline-flex items-center gap-1">
                        <Mail className="size-3" aria-hidden="true" />
                        {tr('comments.emailRequested')}
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-line">{c.body}</div>
                </li>
              ))}
            </ul>
          )}
          {rc.comments.length === 0 && <p className="text-sm text-muted-foreground">{tr('comments.none')}</p>}
          <div className="space-y-1">
            <Label htmlFor={commentBoxId}>{tr('comments.newComment')}</Label>
            <Textarea
              id={commentBoxId}
              className="min-h-[60px]"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2" htmlFor={commentVisibleId}>
              <Checkbox
                id={commentVisibleId}
                checked={commentVisible}
                onChange={(e) => {
                  setCommentVisible(e.target.checked);
                  // An internal comment cannot be e-mailed (FR-A21); making it
                  // visible again does not ask for the e-mail again.
                  if (!e.target.checked) setCommentNotify(false);
                }}
              />
              {tr('comments.customerVisible')}
            </label>
            <label className="flex items-center gap-2" htmlFor={commentNotifyId}>
              <Checkbox
                id={commentNotifyId}
                checked={commentVisible && commentNotify}
                disabled={!commentVisible}
                onChange={(e) => setCommentNotify(e.target.checked)}
                {...(!commentVisible ? { 'aria-describedby': commentNotifyHintId } : {})}
              />
              {tr('comments.notifyCustomer')}
            </label>
            {!commentVisible && (
              <span id={commentNotifyHintId} className="text-xs text-muted-foreground">
                {tr('comments.notifyRequiresVisible')}
              </span>
            )}
            <Button
              size="sm"
              disabled={!commentBody.trim()}
              onClick={() => {
                const notify = commentVisible && commentNotify;
                void run(
                  async () => {
                    await returnsClient.addComment(id, commentBody.trim(), commentVisible, notify);
                    setCommentBody('');
                    setCommentNotify(false);
                  },
                  notify ? tr('comments.addedNotify') : tr('comments.added'),
                  commentsStatus,
                );
              }}
            >
              {tr('comments.add')}
            </Button>
            <InlineStatus {...commentsStatus.props} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
/**
 * 180 FR-B16, FR-B17, D-8 (design review R-5.3) — what the customer stated about a
 * purchase made elsewhere, how to reach them and where the goods go back. After erasure
 * the personal part says when it was erased, so an empty card is not mistaken for none.
 */
function PurchaseAndContact({ rc }: { rc: ReturnCaseDetail }): ReactNode {
  const tr = useTranslation('returns');
  const address = rc.returnAddress;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('detail.purchaseCard')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{tr('detail.purchaseDate')}</dt>
          <dd>{rc.purchase?.date ?? '—'}</dd>
          <dt className="text-muted-foreground">{tr('detail.purchaseNumber')}</dt>
          <dd>{rc.purchase?.proofNumber ?? '—'}</dd>
        </dl>
        {rc.guest && <GuestLines rc={rc} />}
        {rc.personalDataErasedAt ? (
          <Alert>
            <ShieldOff className="size-4" aria-hidden="true" />
            <AlertDescription>{tr('detail.erased', { date: formatDateTime(rc.personalDataErasedAt) })}</AlertDescription>
          </Alert>
        ) : (
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">{tr('detail.contact')}</dt>
            <dd>
              {rc.contact ? (
                <span className="flex flex-col">
                  <span>{rc.contact.name}</span>
                  <a className="underline underline-offset-2" href={`mailto:${rc.contact.email}`}>
                    {rc.contact.email}
                  </a>
                  {rc.contact.phone && (
                    <a className="underline underline-offset-2" href={`tel:${rc.contact.phone}`}>
                      {rc.contact.phone}
                    </a>
                  )}
                </span>
              ) : (
                '—'
              )}
            </dd>
            <dt className="text-muted-foreground">{tr('detail.returnAddress')}</dt>
            <dd className="whitespace-pre-line">
              {address
                ? [
                    address.name,
                    address.company,
                    address.street,
                    `${address.postalCode} ${address.city}`,
                    address.countryCode,
                    address.phone,
                  ]
                    .filter(Boolean)
                    .join('\n')
                : '—'}
            </dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * `specs/181-guest-complaints/` FR-063 (admin-api.md A6) — that the guest's address was
 * verified and when, how long the tracking link works, and when the personal data falls
 * due for erasure. The two dates are the backend's: `null` while the case is open.
 */
function GuestLines({ rc }: { rc: ReturnCaseDetail }): ReactNode {
  const tr = useTranslation('returns');
  return (
    <ul className="space-y-1 text-sm md:col-span-2">
      {rc.contactVerifiedAt && <li>{tr('detail.guest.verifiedEmail', { date: formatDateTime(rc.contactVerifiedAt) })}</li>}
      {!rc.personalDataErasedAt && (
        <>
          <li>
            {rc.trackingLinkValidUntil
              ? tr('detail.guest.linkValidUntil', { date: formatDateTime(rc.trackingLinkValidUntil) })
              : tr('detail.guest.linkWhileOpen')}
          </li>
          <li>
            {rc.guestDataErasureDueAt
              ? tr('detail.guest.erasureDue', { date: formatDateTime(rc.guestDataErasureDueAt) })
              : tr('detail.guest.erasureAfterClose')}
          </li>
        </>
      )}
    </ul>
  );
}

/**
 * `specs/181-guest-complaints/` (admin-api.md A3, A5, A6) — the guest case's two actions,
 * each behind a confirmation: *Send a new tracking link* (`returns:write`) and *Erase
 * personal data* (`returns:erase_personal_data`, irreversible, so the dialog opens on
 * *Cancel*). Shown only while the case still holds the guest's data.
 */
function GuestCaseActions({ rc, onDone }: { rc: ReturnCaseDetail; onDone: (message: string) => Promise<void> }): ReactNode {
  const tr = useTranslation('returns');
  const { hasPermission } = useAuth();
  const [asking, setAsking] = useState<'reissue' | 'erase' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canReissue = hasPermission('returns:write');
  const canErase = hasPermission('returns:erase_personal_data');
  if (!canReissue && !canErase) return null;

  const close = (): void => {
    setAsking(null);
    setError(null);
  };
  const confirm = async (): Promise<void> => {
    if (asking === null) return;
    setBusy(true);
    setError(null);
    try {
      if (asking === 'reissue') await returnsClient.reissueTrackingLink(rc.id);
      else await returnsClient.eraseGuestData(rc.id);
      const message = asking === 'reissue' ? tr('detail.guest.reissued') : tr('detail.guest.erasedInfo');
      setAsking(null);
      await onDone(message);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : tr('detail.guest.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {/* A labelled trigger: on a detail page an icon alone hides the only two guest actions
          (181 design review F-21); the irreversible item is set apart (F-20). */}
      <RowActionMenu label={tr('detail.guest.actions')} showLabel>
        {canReissue && <RowActionMenuItem onSelect={() => setAsking('reissue')}>{tr('detail.guest.reissue')}</RowActionMenuItem>}
        {canReissue && canErase && <RowActionMenuSeparator />}
        {canErase && (
          <RowActionMenuItem destructive onSelect={() => setAsking('erase')}>
            {tr('detail.guest.erase')}
          </RowActionMenuItem>
        )}
      </RowActionMenu>
      {asking === 'reissue' && (
        <ConfirmDialog
          title={tr('detail.guest.reissueConfirmTitle')}
          message={tr('detail.guest.reissueConfirm', { email: rc.contact?.email ?? '' })}
          confirmLabel={tr('detail.guest.reissueConfirmAction')}
          onConfirm={() => void confirm()}
          onCancel={close}
          busy={busy}
          error={error}
        />
      )}
      {asking === 'erase' && (
        <ConfirmDialog
          destructive
          title={tr('detail.guest.eraseConfirmTitle')}
          message={tr('detail.guest.eraseConfirm')}
          confirmLabel={tr('detail.guest.eraseConfirmAction')}
          onConfirm={() => void confirm()}
          onCancel={close}
          busy={busy}
          error={error}
        />
      )}
    </>
  );
}

const ATTACHMENT_GROUPS = ['proof_of_purchase', 'photo', 'other'] as const;

type CaseAttachment = ReturnCaseDetail['attachments'][number];

/** The files of the whole case: those tied to no line (`returnCaseItemId` null). */
function caseLevelAttachments(rc: ReturnCaseDetail): CaseAttachment[] {
  return (rc.attachments ?? []).filter((a) => a.returnCaseItemId == null);
}

/** One file, opened from the case's own guarded route. */
function AttachmentLink({ rc, attachment }: { rc: ReturnCaseDetail; attachment: CaseAttachment }): ReactNode {
  const tr = useTranslation('returns');
  return (
    <a
      className="underline underline-offset-2"
      href={`${apiBaseUrl}/api/v1/admin/returns/${rc.id}/attachments/${attachment.id}/file`}
      target="_blank"
      rel="noopener"
    >
      {tr('attachments.open', { filename: attachment.filename })}
    </a>
  );
}

/** A line's own files — the defect photos of that product — under its name in the items table. */
function LineAttachments({ rc, itemId, productName }: { rc: ReturnCaseDetail; itemId: string; productName: string }): ReactNode {
  const tr = useTranslation('returns');
  const files = (rc.attachments ?? []).filter((a) => a.returnCaseItemId === itemId);
  if (files.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1 text-sm" aria-label={tr('attachments.ofLine', { product: productName })}>
      {files.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2">
          <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
          <AttachmentLink rc={rc} attachment={a} />
          <span className="text-xs text-muted-foreground">{tr(`attachments.kind.${a.type}`)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 180 FR-B23, D-8 (design review R-5.5) — the case's files, by type, each opened from the
 * case's own route. A file tied to a line is shown with that line instead.
 */
function AttachmentsCard({ rc }: { rc: ReturnCaseDetail }): ReactNode {
  const tr = useTranslation('returns');
  const caseFiles = caseLevelAttachments(rc);
  const hasLineFiles = (rc.attachments ?? []).length > caseFiles.length;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('attachments.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {caseFiles.length === 0 ? (
          <p className="text-muted-foreground">
            {rc.personalDataErasedAt
              ? tr('attachments.erased', { date: formatDateTime(rc.personalDataErasedAt) })
              : hasLineFiles
                ? tr('attachments.allOnLines')
                : tr('attachments.none')}
          </p>
        ) : (
          ATTACHMENT_GROUPS.map((type) => {
            const files = caseFiles.filter((a) => a.type === type);
            if (files.length === 0) return null;
            return (
              <div key={type} className="space-y-1">
                <p className="font-medium">
                  {tr(`attachments.type.${type}`)} ({files.length})
                </p>
                <ul className="space-y-1">
                  {files.map((a) => (
                    <li key={a.id} className="flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground" aria-hidden="true" />
                      <AttachmentLink rc={rc} attachment={a} />
                      <span className="text-xs text-muted-foreground">
                        {tr('attachments.size', { size: (a.sizeBytes / 1024).toFixed(0) })} · {formatDateTime(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

/** 180 FR-B31 (design review R-5.6) — every clause shown, as the customer saw it. */
function AcceptedClausesCard({ rc }: { rc: ReturnCaseDetail }): ReactNode {
  const tr = useTranslation('returns');
  const language = rc.acceptedClauses[0]?.language ?? '';
  return (
    <Card>
      <CardHeader>
        <CardTitle>{tr('clauses.acceptedTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {rc.clausesAcceptedAt && (
          <p className="text-muted-foreground">
            {tr('clauses.acceptedAt', { at: formatDateTime(rc.clausesAcceptedAt), language })}
          </p>
        )}
        {/* Issue #1437 (DS-03): one disclosure row per clause, divided by a rule, not a box each. */}
        <div className="divide-y">
          {rc.acceptedClauses.map((c) => (
            <details key={`${c.clauseId}@${c.revision}`} className="py-2">
              <summary className="cursor-pointer">
                {tr('clauses.revisionOf', { label: c.label, revision: c.revision })}{' '}
                <Badge variant="outline">{tr(`clauses.mode.${c.mode}`)}</Badge>
              </summary>
              <div className="mt-2 max-h-64 overflow-y-auto whitespace-pre-line" tabIndex={0}>
                {c.text}
              </div>
              {c.linkUrl && (
                <a className="underline underline-offset-2" href={c.linkUrl} target="_blank" rel="noopener noreferrer">
                  {tr('clauses.fullTerms')}
                </a>
              )}
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default ReturnDetail;
