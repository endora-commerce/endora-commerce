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
  const t = useTranslation('quick_order');
  const [customerAccountId, setCustomerAccountId] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<QuickOrderImportResponse | null>(null);
  const [result, setResult] = useState<QuickOrderBuildResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof ApiError ? err.message : t('onBehalf.error.import'));
    } finally {
      setBusy(false);
    }
  }

  async function build(target: QuickOrderTarget): Promise<void> {
    if (!preview || preview.recognized.length === 0) return;
    if (!customerAccountId.trim() || !organizationId.trim()) {
      setError(t('onBehalf.error.missingCustomer'));
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
      setError(err instanceof ApiError ? err.message : t('onBehalf.error.build'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('onBehalf.page.title')}
        description={t('onBehalf.page.description')}
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
              ? t('onBehalf.success.cart', { id: result.cartId ?? '' })
              : t('onBehalf.success.quoteRequest', { id: result.quoteRequestId ?? '' })}
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('onBehalf.customer.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="customerAccountId">{t('onBehalf.customer.account')}</Label>
            <CustomerPicker
              id="customerAccountId"
              value={customerAccountId || null}
              onChange={(v) => setCustomerAccountId(v ?? '')}
              placeholder={t('onBehalf.customer.accountPlaceholder')}
              emptyMessage={t('onBehalf.customer.accountEmpty')}
              ariaLabel={t('onBehalf.customer.account')}
            />
          </div>
          <div>
            <Label htmlFor="organizationId">{t('onBehalf.customer.organization')}</Label>
            <OrganizationPicker
              id="organizationId"
              value={organizationId || null}
              onChange={(v) => setOrganizationId(v ?? '')}
              placeholder={t('onBehalf.customer.organizationPlaceholder')}
              emptyMessage={t('onBehalf.customer.organizationEmpty')}
              ariaLabel={t('onBehalf.customer.organization')}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('onBehalf.import.title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <FileDropzone
            label={t('onBehalf.import.dropzone')}
            selectedLabel={(name) => t('onBehalf.import.selectedFile', { name })}
            onFile={(filename, contentBase64) => void runImport({ file: { filename, contentBase64 } })}
          />
          <div>
            <Label htmlFor="csv">{t('onBehalf.import.pasteLabel')}</Label>
            <Textarea
              id="csv"
              rows={6}
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              // Sample data, not prose — intentionally not translated.
              placeholder={'sku,quantity\nEXAMPLE-SIMPLE-001,10'}
              style={{ fontFamily: 'monospace' }}
            />
          </div>
          <Button disabled={busy || !csv.trim()} onClick={() => void runImport({ csv })}>
            {t('onBehalf.import.preview')}
          </Button>
        </CardContent>
      </Card>

      {preview ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('onBehalf.preview.title')} (
              {t('onBehalf.preview.summary', {
                recognized: preview.summary.recognizedCount,
                rejected: preview.summary.rejectedCount,
              })}
              {preview.summary.truncated ? `, ${t('onBehalf.preview.truncated')}` : ''})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview.recognized.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('onBehalf.column.line')}</TableHead>
                    <TableHead>{t('onBehalf.column.sku')}</TableHead>
                    <TableHead>{t('onBehalf.column.variant')}</TableHead>
                    <TableHead>{t('onBehalf.column.quantity')}</TableHead>
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
              <p className="text-sm text-muted-foreground">{t('onBehalf.preview.empty')}</p>
            )}

            {preview.rejected.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('onBehalf.column.line')}</TableHead>
                    <TableHead>{t('onBehalf.column.reason')}</TableHead>
                    <TableHead>{t('onBehalf.column.raw')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.rejected.map((r) => (
                    <TableRow key={`r-${r.line}`}>
                      <TableCell>{r.line}</TableCell>
                      <TableCell>{t(`onBehalf.reason.${r.reason}`)}</TableCell>
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
                  {t('onBehalf.action.buildCart')}
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => void build('quote_request')}>
                  {t('onBehalf.action.buildQuoteRequest')}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
