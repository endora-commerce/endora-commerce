import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ApiError, formatDateTime } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Label, Select, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';

import type {
  ReturnCaseDetail,
  ReturnTransitionDto,
  SettlementPrefill,
  SettlementResult,
} from '@endora-commerce/contracts';

/** Returns / RMA case detail (feature 046, US2/US4/US5/US6). */
export function ReturnDetail(): ReactNode {
  const t = useTranslation('core');
  const { id = '' } = useParams<{ id: string }>();
  const [rc, setRc] = useState<ReturnCaseDetail | null>(null);
  const [transitions, setTransitions] = useState<ReturnTransitionDto[]>([]);
  const [shipments, setShipments] = useState<Array<{ id: string; direction: string; status: string; externalReference: string | null }>>([]);
  const [prefill, setPrefill] = useState<SettlementPrefill | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [commentBody, setCommentBody] = useState('');
  const [commentVisible, setCommentVisible] = useState(true);
  const [commentNotify, setCommentNotify] = useState(false);

  const [resolution, setResolution] = useState('refund');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [approved, setApproved] = useState<Record<string, number>>({});
  // Issue #150 — a correction is asked for by default, as the screen always
  // did; the control exists because "not requested" is one of the three
  // outcomes below and an operator has to be able to reach it deliberately.
  const [createCorrectiveInvoice, setCreateCorrectiveInvoice] = useState(true);
  const [settlement, setSettlement] = useState<SettlementResult | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [detail, graph, ship] = await Promise.all([
        returnsClient.get(id),
        returnsClient.statuses(),
        returnsClient.shipments(id).catch(() => []),
      ]);
      setRc(detail);
      setTransitions(graph.transitions.filter((t) => t.fromStatusCode === detail.statusCode));
      setShipments(ship);
      if (detail.statusCode === 'received') {
        const pf = await returnsClient.settlementPrefill(id);
        setPrefill(pf);
        setApproved(Object.fromEntries(pf.items.map((it) => [it.returnCaseItemId, it.defaultRefundAmount])));
      } else {
        setPrefill(null);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load case.');
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>, ok: string): Promise<void> => {
      setError(null);
      setInfo(null);
      try {
        await fn();
        setInfo(ok);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Action failed.');
      }
    },
    [refresh],
  );

  if (!rc) {
    return (
      <div className="space-y-4">
        <PageHeader title={t('returns.detail.title')} />
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    );
  }

  const isNew = rc.statusCode === 'new';

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link to="/returns">
          <ArrowLeft className="size-4" /> Back to returns
        </Link>
      </Button>

      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {rc.rmaNumber ?? 'Return case'} <Badge variant="secondary">{rc.statusLabel}</Badge>
            <Badge variant="outline">{rc.kind}</Badge>
          </span>
        }
        description={`Order ${rc.orderId}`}
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {info && (
        <Alert>
          <AlertDescription>{info}</AlertDescription>
        </Alert>
      )}

      {/* Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          {isNew && (
            <Button size="sm" onClick={() => void run(() => returnsClient.authorize(id), 'Authorized.')}>
              Authorize (assign RMA)
            </Button>
          )}
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              const reason = window.prompt('Rejection reason');
              if (reason) void run(() => returnsClient.reject(id, reason), 'Rejected.');
            }}
          >
            Reject
          </Button>
          {transitions.map((t) => (
            <Button
              key={t.toStatusCode}
              variant="outline"
              size="sm"
              onClick={() => void run(() => returnsClient.transition(id, t.toStatusCode), `Moved to ${t.toStatusCode}.`)}
            >
              → {t.toStatusCode}
            </Button>
          ))}
        </CardContent>
      </Card>

      {/* Items */}
      <Card>
        <CardHeader>
          <CardTitle>Returned items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Default refund</TableHead>
                <TableHead>Approved</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rc.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>{it.productName}</TableCell>
                  <TableCell>{it.quantity}</TableCell>
                  <TableCell>{it.defaultRefundAmount.toFixed(2)}</TableCell>
                  <TableCell>{it.approvedRefundAmount.toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Settlement (when received) */}
      {prefill && (
        <Card>
          <CardHeader>
            <CardTitle>{t('returns.detail.settlement.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="resolution">{t('returns.detail.settlement.resolution')}</Label>
                <Select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  <option value="refund">{t('returns.detail.resolution.refund')}</option>
                  <option value="credit">{t('returns.detail.resolution.credit')}</option>
                  <option value="replacement">{t('returns.detail.resolution.replacement')}</option>
                  <option value="repair">{t('returns.detail.resolution.repair')}</option>
                </Select>
              </div>
              {resolution === 'refund' && (
                <div className="space-y-1">
                  <Label htmlFor="pm">{t('returns.detail.settlement.paymentMethodId')}</Label>
                  <input
                    id="pm"
                    className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={paymentMethodId}
                    onChange={(e) => setPaymentMethodId(e.target.value)}
                  />
                </div>
              )}
            </div>
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
                    <TableCell>{it.productName}</TableCell>
                    <TableCell>{it.defaultRefundAmount.toFixed(2)}</TableCell>
                    <TableCell>
                      <input
                        type="number"
                        step="0.01"
                        className="h-8 w-28 rounded-md border border-input bg-background px-2 text-sm"
                        value={approved[it.returnCaseItemId] ?? 0}
                        onChange={(e) =>
                          setApproved((prev) => ({ ...prev, [it.returnCaseItemId]: Number(e.target.value) }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <label className="flex items-center gap-2 text-sm" htmlFor="createCorrectiveInvoice">
              <Checkbox
                id="createCorrectiveInvoice"
                checked={createCorrectiveInvoice}
                onChange={(e) => setCreateCorrectiveInvoice(e.target.checked)}
              />
              {t('returns.detail.settlement.createCorrectiveInvoice')}
            </label>
            <Button
              size="sm"
              onClick={() =>
                void (async () => {
                  setError(null);
                  setInfo(null);
                  try {
                    const settled = await returnsClient.settle(id, {
                      resolutionType: resolution,
                      lines: prefill.items.map((it) => ({
                        returnCaseItemId: it.returnCaseItemId,
                        approvedRefundAmount: approved[it.returnCaseItemId] ?? 0,
                      })),
                      ...(resolution === 'refund' && paymentMethodId
                        ? { refundPaymentMethodId: paymentMethodId }
                        : {}),
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
                      setInfo(t('returns.detail.settlement.done'));
                    }
                    await refresh();
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
      <Card>
        <CardHeader>
          <CardTitle>Return shipments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void run(() => returnsClient.createShipment(id, 'inbound'), 'Inbound shipment recorded.')}
          >
            Record inbound shipment
          </Button>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Direction</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tracking</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shipments.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.direction}</TableCell>
                  <TableCell>{s.status}</TableCell>
                  <TableCell>{s.externalReference ?? '—'}</TableCell>
                  <TableCell>
                    {s.status === 'pending' && s.direction === 'inbound' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void run(() => returnsClient.receiveShipment(id, s.id), 'Received.')}
                      >
                        Mark received
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Comments */}
      <Card>
        <CardHeader>
          <CardTitle>Comments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            {rc.comments.map((c) => (
              <div key={c.id} className="rounded-md border p-2 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{c.authorKind}</span>
                  <span>{formatDateTime(c.createdAt)}</span>
                  {!c.isCustomerVisible && <Badge variant="outline">internal</Badge>}
                </div>
                <div>{c.body}</div>
              </div>
            ))}
            {rc.comments.length === 0 && <p className="text-sm text-muted-foreground">No comments.</p>}
          </div>
          <textarea
            className="min-h-[60px] w-full rounded-md border border-input bg-background p-2 text-sm"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Add a comment…"
          />
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={commentVisible} onChange={(e) => setCommentVisible(e.target.checked)} />
              Visible to customer
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={commentNotify} onChange={(e) => setCommentNotify(e.target.checked)} />
              Notify customer
            </label>
            <Button
              size="sm"
              disabled={!commentBody.trim()}
              onClick={() =>
                void run(async () => {
                  await returnsClient.addComment(id, commentBody.trim(), commentVisible, commentNotify);
                  setCommentBody('');
                }, 'Comment added.')
              }
            >
              Add comment
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
export default ReturnDetail;
