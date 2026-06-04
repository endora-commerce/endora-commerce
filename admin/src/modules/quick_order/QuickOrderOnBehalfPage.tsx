import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { CustomerPicker } from '@/components/customer-picker/CustomerPicker';
import { OrganizationPicker } from '@/components/organization-picker/OrganizationPicker';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import { FileDropzone } from '@/components/FileDropzone';
import {
  adminQuickOrderBuild,
  adminQuickOrderImport,
  type QuickOrderBuildResponse,
  type QuickOrderImportResponse,
  type QuickOrderTarget,
} from './api/quick-order-client';

/**
 * QuickOrderOnBehalfPage — feature 039 (US1 / FR-008).
 *
 * Lets an operator import a CSV / Excel file (or paste CSV) and build a Cart
 * or Quote Request on behalf of a chosen customer + organization. Identifier
 * fields are entered directly, matching the existing OrderCreatePage approach.
 */
export function QuickOrderOnBehalfPage(): ReactNode {
  const t = useTranslation('core');
  const [customerAccountId, setCustomerAccountId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<QuickOrderImportResponse | null>(null);
  const [result, setResult] = useState<QuickOrderBuildResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = (key: string, fallback: string): string => {
    const resolved = t(key);
    return resolved === key ? fallback : resolved;
  };

  async function runImport(input: {
    csv?: string;
    file?: { filename: string; contentBase64: string };
  }): Promise<void> {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await adminQuickOrderImport(input));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function build(target: QuickOrderTarget): Promise<void> {
    if (!preview || preview.recognized.length === 0) return;
    if (!customerAccountId.trim() || !organizationId.trim()) {
      setError('Enter a customer account id and organization id first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await adminQuickOrderBuild({
        target,
        onBehalfOf: {
          customerAccountId: customerAccountId.trim(),
          organizationId: organizationId.trim(),
        },
        items: preview.recognized.map((r) => ({
          productId: r.productId,
          variantId: r.variantId,
          quantity: r.quantity,
        })),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Build failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={label('quickOrder.onBehalf.title', 'Quick order on behalf')}
        description={label(
          'quickOrder.onBehalf.subtitle',
          'Import a CSV / Excel file and build a cart or quote request for a customer.',
        )}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <Alert>
          <AlertDescription>
            {result.target === 'cart'
              ? `Cart built: ${result.cartId}`
              : `Quote request created: ${result.quoteRequestId}`}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{label('quickOrder.onBehalf.customer', 'Customer')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="customerAccountId">Customer account</Label>
            <CustomerPicker
              id="customerAccountId"
              value={customerAccountId || null}
              onChange={(v) => setCustomerAccountId(v ?? '')}
            />
          </div>
          <div>
            <Label htmlFor="organizationId">Organization</Label>
            <OrganizationPicker
              id="organizationId"
              value={organizationId || null}
              onChange={(v) => setOrganizationId(v ?? '')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{label('quickOrder.onBehalf.import', 'Import')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FileDropzone
            onFile={(filename, contentBase64) => void runImport({ file: { filename, contentBase64 } })}
          />
          <div>
            <Label htmlFor="csv">…or paste CSV</Label>
            <Textarea
              id="csv"
              rows={6}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder={'sku,quantity\nEXAMPLE-SIMPLE-001,10'}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <Button disabled={busy || !csv.trim()} onClick={() => void runImport({ csv })}>
            Preview
          </Button>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {label('quickOrder.onBehalf.preview', 'Preview')} ({preview.summary.recognizedCount}{' '}
              recognised, {preview.summary.rejectedCount} rejected
              {preview.summary.truncated ? ', truncated' : ''})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.recognized.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Variant</TableHead>
                    <TableHead>Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.recognized.map((r) => (
                    <TableRow key={r.line}>
                      <TableCell>{r.line}</TableCell>
                      <TableCell>{r.sku}</TableCell>
                      <TableCell>{r.resolvedVariantSku ?? '—'}</TableCell>
                      <TableCell>{r.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No rows matched the catalog.</p>
            )}

            {preview.rejected.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Raw</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rejected.map((r) => (
                    <TableRow key={`r-${r.line}`}>
                      <TableCell>{r.line}</TableCell>
                      <TableCell>{r.reason}</TableCell>
                      <TableCell>
                        <code>{r.raw}</code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : null}

            {preview.recognized.length > 0 ? (
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => void build('cart')}>
                  Build cart
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void build('quote_request')}>
                  Build quote request
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
