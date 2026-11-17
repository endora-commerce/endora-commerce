import { useState, type ReactNode } from 'react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Textarea, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, PageHeader } from '@endora-commerce/admin-kit/ui';
import { CustomerPicker, OrganizationPicker, FileDropzone } from '@endora-commerce/admin-kit/components';
import { RouteTabsZone } from '@endora-commerce/admin-kit/zones';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import {
  adminQuickOrderBuild,
  adminQuickOrderImport,
  type QuickOrderBuildRejectedLine,
  type QuickOrderBuildResponse,
  type QuickOrderImportResponse,
  type QuickOrderTarget,
  type RejectedQuickOrderItem,
} from '../api/quick-order-client.js';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/**
 * Feature 155 — a rejected row's reason. A buyer-style `below_minimum` row names
 * the minimum and the file total the verdict used (FR-011 (a)): "below the
 * minimum" alone would leave the operator to work out by how much.
 */
export function rejectionReasonLabel(row: RejectedQuickOrderItem, t: Translate): string {
  if (row.reason === 'below_minimum' && row.minimum !== undefined && row.productTotal !== undefined) {
    return t('onBehalf.reason.below_minimumDetail', { minimum: row.minimum, productTotal: row.productTotal });
  }
  return t(`onBehalf.reason.${row.reason}`);
}

/** Feature 155 (FR-011 (b)) — one line a cart build left out, with product and minimum. */
export function buildRejectionLabel(line: QuickOrderBuildRejectedLine, t: Translate): string {
  const key =
    line.kind === 'pieces'
      ? 'onBehalf.build.rejectedPieces'
      : line.packagingUnitName !== undefined
        ? 'onBehalf.build.rejectedUnits'
        : 'onBehalf.build.rejectedUnitsUnnamed';
  return t(key, {
    product: line.productName,
    quantity: line.quantity,
    minimum: line.minimum,
    ...(line.packagingUnitName !== undefined ? { unit: line.packagingUnitName } : {}),
  });
}

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

  // Counted off the rows rather than read from `summary.warningCount`, which is
  // optional: the note then cannot disagree with the badges below it.
  const warnedCount = preview?.recognized.filter((r) => r.warning).length ?? 0;

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

      <RouteTabsZone name="order.entry.tabs" props={{}} className="mb-4" />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {result ? (
        <Alert live="polite">
          <AlertDescription>
            {result.target === 'cart'
              ? t('onBehalf.success.cart', { id: result.cartId ?? '' })
              : t('onBehalf.success.quoteRequest', { id: result.quoteRequestId ?? '' })}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Feature 155 (FR-011 (b)) — the cart was built, but without these lines.
          Amber, not red: the build succeeded, and the remedy is the operator's
          (raise the quantity, or build a quote request instead). */}
      {result?.rejected && result.rejected.length > 0 ? (
        <Alert variant="warning" live="assertive">
          <AlertTitle>{t('onBehalf.build.rejectedTitle')}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-0.5 pl-5">
              {result.rejected.map((line) => (
                <li key={`${line.productId}:${line.variantId ?? ''}`}>{buildRejectionLabel(line, t)}</li>
              ))}
            </ul>
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
            {warnedCount > 0 ? (
              <Alert variant="warning">
                <AlertDescription>{t('onBehalf.minimum.note', { count: warnedCount })}</AlertDescription>
              </Alert>
            ) : null}
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
                      <TableCell>
                        <div className="tabular-nums">{r.quantity}</div>
                        {r.warning ? (
                          <>
                            <Badge variant="warning" className="mt-1">
                              <span>{t('onBehalf.minimum.badge', { minimum: r.warning.minimum })}</span>
                            </Badge>
                            {r.warning.productTotal !== r.quantity ? (
                              <div className="mt-0.5 text-xs text-muted-foreground">
                                {t('onBehalf.minimum.fileTotal', { productTotal: r.warning.productTotal })}
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </TableCell>
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
                      <TableCell>{rejectionReasonLabel(r, t)}</TableCell>
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

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default QuickOrderOnBehalfPage;
