import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { returnsClient } from './api/returns-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import type { ReturnCaseDetail, ReturnTransitionDto, SettlementPrefill } from '@b2b/contracts';

/** Returns / RMA case detail (feature 046, US2/US4/US5/US6). */
export function ReturnDetail(): ReactNode {
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
        <PageHeader title="Return case" />
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
            <CardTitle>Settlement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="resolution">Resolution</Label>
                <Select id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)}>
                  <option value="refund">Refund money</option>
                  <option value="credit">Credit toward future orders</option>
                  <option value="replacement">Replacement</option>
                  <option value="repair">Repair</option>
                </Select>
              </div>
              {resolution === 'refund' && (
                <div className="space-y-1">
                  <Label htmlFor="pm">Refund payment method id</Label>
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
                  <TableHead>Product</TableHead>
                  <TableHead>Max (paid)</TableHead>
                  <TableHead>Approved</TableHead>
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
            <Button
              size="sm"
              onClick={() =>
                void run(
                  () =>
                    returnsClient.settle(id, {
                      resolutionType: resolution,
                      lines: prefill.items.map((it) => ({
                        returnCaseItemId: it.returnCaseItemId,
                        approvedRefundAmount: approved[it.returnCaseItemId] ?? 0,
                      })),
                      ...(resolution === 'refund' && paymentMethodId ? { refundPaymentMethodId: paymentMethodId } : {}),
                      createCorrectiveInvoice: true,
                    }),
                  'Settled.',
                )
              }
            >
              Settle case
            </Button>
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
