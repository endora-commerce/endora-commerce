import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Send, XCircle } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface AdminRfqItem {
  id: string;
  productId: string;
  productName: string;
  variantLabel: string | null;
  quantity: number;
  requesterNote: string | null;
  quotedUnitPrice: number | null;
  quotedDiscountPercent: number | null;
}

interface AdminRfqDetail {
  id: string;
  organizationId: string;
  customerAccountId: string;
  assignedAdminUserId?: string;
  status: string;
  requesterNote: string | null;
  items: AdminRfqItem[];
  quoteTerms: {
    leadTimeDays: number;
    validityDays: number;
    deliveryTerms: string | null;
    remarks: string | null;
  } | null;
  submittedAt: string | null;
  quotedAt: string | null;
  respondedAt: string | null;
  expiresAt: string | null;
  updatedAt: string;
}

interface QuoteLineDraft {
  unitPrice: string;
  discountPercent: string;
}

const QUOTABLE_STATUSES = ['submitted', 'in_review'];

export function RfqDetail(): ReactNode {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [rfq, setRfq] = useState<AdminRfqDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, QuoteLineDraft>>({});
  const [terms, setTerms] = useState({
    leadTimeDays: '7',
    validityDays: '14',
    deliveryTerms: '',
    remarks: '',
  });
  const [declineMessage, setDeclineMessage] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${id}`,
      );
      const found = res.data;
      setRfq(found);
      const draft: Record<string, QuoteLineDraft> = {};
      for (const it of found.items) {
        draft[it.id] = {
          unitPrice: it.quotedUnitPrice != null ? String(it.quotedUnitPrice) : '',
          discountPercent:
            it.quotedDiscountPercent != null ? String(it.quotedDiscountPercent) : '',
        };
      }
      setLines(draft);
      if (found.quoteTerms) {
        setTerms({
          leadTimeDays: String(found.quoteTerms.leadTimeDays),
          validityDays: String(found.quoteTerms.validityDays),
          deliveryTerms: found.quoteTerms.deliveryTerms ?? '',
          remarks: found.quoteTerms.remarks ?? '',
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.envelope.error.code === 'NOT_FOUND') {
        setRfq(null);
      } else {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load RFQ.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const canQuote = useMemo(() => rfq && QUOTABLE_STATUSES.includes(rfq.status), [rfq]);

  const handleClaim = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    setError(null);
    try {
      await apiClient.post<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${rfq.id}/claim`,
        {},
      );
      setInfo('Claimed.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Claim failed.');
    }
  }, [rfq, refresh]);

  const handleSendQuote = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    setError(null);
    setInfo(null);
    const itemsPayload: Array<{
      itemId: string;
      quotedUnitPrice: number;
      quotedDiscountPercent?: number;
    }> = [];
    for (const it of rfq.items) {
      const draft = lines[it.id];
      const unit = Number(draft?.unitPrice);
      if (!Number.isFinite(unit) || unit < 0) {
        setError(`Item "${it.productName}": unit price is required and must be ≥ 0.`);
        return;
      }
      const disc = draft?.discountPercent ? Number(draft.discountPercent) : null;
      if (disc != null && (!Number.isFinite(disc) || disc < 0 || disc > 100)) {
        setError(`Item "${it.productName}": discount must be 0..100.`);
        return;
      }
      itemsPayload.push({
        itemId: it.id,
        quotedUnitPrice: unit,
        ...(disc != null ? { quotedDiscountPercent: disc } : {}),
      });
    }
    const lead = Number(terms.leadTimeDays);
    const valid = Number(terms.validityDays);
    if (!Number.isFinite(lead) || lead < 0) {
      setError('Lead time must be 0 days or more.');
      return;
    }
    if (!Number.isFinite(valid) || valid < 1) {
      setError('Validity must be at least 1 day.');
      return;
    }
    try {
      await apiClient.post<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${rfq.id}/quote`,
        {
          items: itemsPayload,
          terms: {
            leadTimeDays: lead,
            validityDays: valid,
            ...(terms.deliveryTerms ? { deliveryTerms: terms.deliveryTerms } : {}),
            ...(terms.remarks ? { remarks: terms.remarks } : {}),
          },
        },
      );
      setInfo('Quote sent — buyer will see it on their RFQ.');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Send-quote failed.');
    }
  }, [rfq, lines, terms, refresh]);

  const handleDecline = useCallback(async (): Promise<void> => {
    if (!rfq) return;
    if (!declineMessage.trim()) {
      setError('Decline message is required.');
      return;
    }
    if (!confirm('Decline this RFQ? The buyer will see your message.')) return;
    try {
      await apiClient.post<{ data: AdminRfqDetail }>(
        `/api/v1/admin/quote-requests/${rfq.id}/decline`,
        { message: declineMessage },
      );
      setInfo('Declined.');
      setDeclineMessage('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Decline failed.');
    }
  }, [rfq, declineMessage, refresh]);

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!rfq) {
    return (
      <>
        <Alert variant="warning" className="mb-4">
          <AlertDescription>RFQ not found.</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={(): void => { navigate('/quote-requests'); }}>
          <ArrowLeft />
          Back to list
        </Button>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={`RFQ ${rfq.id.slice(0, 8)}`}
        description={
          <span className="inline-flex items-center gap-2">
            <Badge variant="secondary">{rfq.status}</Badge>
            {rfq.expiresAt ? <span>expires {formatDateTime(rfq.expiresAt)}</span> : null}
          </span>
        }
        actions={
          <Button asChild variant="outline">
            <Link to="/quote-requests">
              <ArrowLeft />
              Back
            </Link>
          </Button>
        }
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

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6 text-sm">
          <div>
            <div className="font-semibold">Buyer</div>
            <div className="font-mono text-xs text-muted-foreground">
              org {rfq.organizationId.slice(0, 8)} · user {rfq.customerAccountId.slice(0, 8)}
            </div>
          </div>
          <div>
            <div className="font-semibold">Assigned</div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="font-mono text-xs">
                {rfq.assignedAdminUserId ?? 'unassigned'}
              </span>
              {!rfq.assignedAdminUserId && QUOTABLE_STATUSES.includes(rfq.status) ? (
                <Button
                  size="sm"
                  type="button"
                  onClick={(): void => void handleClaim()}
                >
                  Claim
                </Button>
              ) : null}
            </div>
          </div>
          {rfq.requesterNote ? (
            <div>
              <div className="font-semibold">Requester note</div>
              <p className="text-muted-foreground">{rfq.requesterNote}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Items + quote</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead>Qty</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Discount %</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rfq.items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <div className="font-medium">{it.productName}</div>
                    {it.variantLabel ? (
                      <div className="text-xs text-muted-foreground">{it.variantLabel}</div>
                    ) : null}
                  </TableCell>
                  <TableCell>{it.quantity}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-28"
                      value={lines[it.id]?.unitPrice ?? ''}
                      onChange={(e): void =>
                        setLines((prev) => ({
                          ...prev,
                          [it.id]: {
                            unitPrice: e.target.value,
                            discountPercent: prev[it.id]?.discountPercent ?? '',
                          },
                        }))
                      }
                      disabled={!canQuote}
                    />
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      className="w-20"
                      value={lines[it.id]?.discountPercent ?? ''}
                      onChange={(e): void =>
                        setLines((prev) => ({
                          ...prev,
                          [it.id]: {
                            unitPrice: prev[it.id]?.unitPrice ?? '',
                            discountPercent: e.target.value,
                          },
                        }))
                      }
                      disabled={!canQuote}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {it.requesterNote ?? ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {canQuote ? (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Quote terms</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lead">Lead time (days)</Label>
                  <Input
                    id="lead"
                    type="number"
                    min="0"
                    value={terms.leadTimeDays}
                    onChange={(e): void =>
                      setTerms((t) => ({ ...t, leadTimeDays: e.target.value }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="valid">Validity (days)</Label>
                  <Input
                    id="valid"
                    type="number"
                    min="1"
                    value={terms.validityDays}
                    onChange={(e): void =>
                      setTerms((t) => ({ ...t, validityDays: e.target.value }))
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="dterms">Delivery terms (optional)</Label>
                <Input
                  id="dterms"
                  value={terms.deliveryTerms}
                  onChange={(e): void =>
                    setTerms((t) => ({ ...t, deliveryTerms: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="remarks">Remarks (optional)</Label>
                <Textarea
                  id="remarks"
                  rows={3}
                  value={terms.remarks}
                  onChange={(e): void => setTerms((t) => ({ ...t, remarks: e.target.value }))}
                />
              </div>
              <Button type="button" onClick={(): void => void handleSendQuote()}>
                <Send />
                Send quote
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Decline</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="dmsg">Message to the buyer</Label>
                <Textarea
                  id="dmsg"
                  rows={3}
                  value={declineMessage}
                  onChange={(e): void => setDeclineMessage(e.target.value)}
                />
              </div>
              <Button
                variant="destructive"
                type="button"
                onClick={(): void => void handleDecline()}
              >
                <XCircle />
                Decline RFQ
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}
    </>
  );
}
