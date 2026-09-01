import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import { useSurfaceVisibility } from '@/lib/surface-visibility';
import { CountryPicker } from '@endora-commerce/admin-kit/components';

interface AdminTax {
  id: string;
  code: string;
  name: string;
  rate: number;
  country: string | null;
  productType: string | null;
  appliesToVatStatuses: string[];
  isDefault: boolean;
  priority: number;
}

const PRODUCT_TYPES = ['simple', 'variant', 'grouped', 'virtual'] as const;
const VAT_STATUSES = ['vat_payer', 'vat_exempt', 'reverse_charge'] as const;

export function TaxesPage(): ReactNode {
  const t = useTranslation('core');
  /**
   * The screen's own gate (2026-08-28), on the codes its routes now enforce.
   *
   * `taxes` used to borrow `catalog:write` — on all four routes, the two reads
   * included — so this page had no permission of its own to check and the
   * sidebar entry beside it carried the catalogue's write code. Both moved
   * together; hiding the screen rather than letting it 403 is the treatment the
   * sidebar, the palette and the dashboard already apply to a denied
   * destination, and `AppShell.tsx`'s `PALETTE_ITEMS` comment argues it at
   * length. The module half is asked too, because the admin router carries no
   * guard of its own: a module the platform is not running must contribute no
   * surface at all (Constitution XVII item 5), and a permission gate alone
   * leaves this screen rendering and answering 503.
   *
   * `useSurfaceVisibility` is the predicate the sidebar, the palette and the
   * dashboard already share, so the two axes are one expression rather than two
   * that can drift.
   */
  const isVisible = useSurfaceVisibility();
  const canRead = isVisible({ module: 'taxes', requiredPermission: 'taxes:read' });
  /**
   * The write half, which is new rather than moved: until this change there was
   * no read-only role to have, because reading the table required the code that
   * rewrites it. Now there is, so the upsert form and the per-row delete are
   * hidden from it — hidden and not disabled, for the reason the screen itself
   * is, and hidden rather than left to 403 on submit.
   */
  const canWrite = isVisible({ module: 'taxes', requiredPermission: 'taxes:write' });
  const [rows, setRows] = useState<AdminTax[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // A page that renders nothing has no reason to ask the API a question it
    // will be refused.
    if (!canRead) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminTax[] }>('/api/v1/admin/taxes');
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('taxes.error.load'));
    } finally {
      setLoading(false);
    }
  }, [canRead, t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpsert = useCallback(
    async (input: AdminTax): Promise<void> => {
      try {
        await apiClient.put<{ data: AdminTax }>(
          `/api/v1/admin/taxes/${encodeURIComponent(input.code)}`,
          {
            code: input.code,
            name: input.name,
            rate: input.rate,
            country: input.country,
            productType: input.productType,
            appliesToVatStatuses: input.appliesToVatStatuses,
            isDefault: input.isDefault,
            priority: input.priority,
          },
        );
        setInfo(t('taxes.success.save', { code: input.code }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('taxes.error.save'));
      }
    },
    [refresh, t],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('taxes.deleteConfirm'))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/taxes/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('taxes.error.delete'));
      }
    },
    [refresh, t],
  );

  if (!canRead) {
    return (
      <Alert>
        <AlertDescription>{t('taxes.noPermission')}</AlertDescription>
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        title={t('taxes.page.title')}
        description={t('taxes.page.description')}
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

      {canWrite ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('taxes.upsert.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <UpsertForm onSubmit={handleUpsert} />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('taxes.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('taxes.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('taxes.column.code')}</TableHead>
                  <TableHead>{t('taxes.column.name')}</TableHead>
                  <TableHead>{t('taxes.column.rate')}</TableHead>
                  <TableHead>{t('taxes.column.country')}</TableHead>
                  <TableHead>{t('taxes.column.productType')}</TableHead>
                  <TableHead>{t('taxes.column.vatStatuses')}</TableHead>
                  <TableHead>{t('taxes.column.default')}</TableHead>
                  <TableHead>{t('taxes.column.priority')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{r.code}</code>
                    </TableCell>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="tabular-nums">{(r.rate * 100).toFixed(1)}%</TableCell>
                    <TableCell>{r.country ?? '—'}</TableCell>
                    <TableCell>{r.productType ?? '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.appliesToVatStatuses.join(', ') || '—'}
                    </TableCell>
                    <TableCell>
                      {r.isDefault ? <Badge variant="default">{t('taxes.badge.default')}</Badge> : null}
                    </TableCell>
                    <TableCell>{r.priority}</TableCell>
                    <TableCell>
                      {canWrite ? (
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          onClick={(): void => void handleDelete(r.id)}
                        >
                          <Trash2 />
                          {t('taxes.action.delete')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function UpsertForm({ onSubmit }: { onSubmit: (input: AdminTax) => Promise<void> }): ReactNode {
  const t = useTranslation('core');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rate, setRate] = useState('0.23');
  const [country, setCountry] = useState('');
  const [productType, setProductType] = useState<string>('');
  const [vatStatuses, setVatStatuses] = useState<Set<string>>(new Set());
  const [isDefault, setIsDefault] = useState(false);
  const [priority, setPriority] = useState('0');

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          id: '',
          code,
          name,
          rate: Number(rate),
          country: country || null,
          productType: productType || null,
          appliesToVatStatuses: Array.from(vatStatuses),
          isDefault,
          priority: Number(priority),
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tcode">{t('taxes.field.code')}</Label>
          <Input id="tcode" value={code} onChange={(e): void => setCode(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tname">{t('taxes.field.name')}</Label>
          <Input id="tname" value={name} onChange={(e): void => setName(e.target.value)} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="trate">{t('taxes.field.rate')}</Label>
          <Input
            id="trate"
            type="number"
            step="0.001"
            min="0"
            value={rate}
            onChange={(e): void => setRate(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tctry">{t('taxes.field.country')}</Label>
          <CountryPicker
            id="tctry"
            value={country}
            onChange={(e): void => setCountry(e.target.value)}
            includeBlank
            blankLabel={t('taxes.option.any')}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tptype">{t('taxes.field.productType')}</Label>
          <Select
            id="tptype"
            value={productType}
            onChange={(e): void => setProductType(e.target.value)}
          >
            <option value="">{t('taxes.option.any')}</option>
            {PRODUCT_TYPES.map((pt) => (
              <option key={pt} value={pt}>
                {pt}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tprio">{t('taxes.field.priority')}</Label>
          <Input
            id="tprio"
            type="number"
            value={priority}
            onChange={(e): void => setPriority(e.target.value)}
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>{t('taxes.field.vatStatuses')}</Label>
        <div className="flex flex-wrap gap-3">
          {VAT_STATUSES.map((v) => (
            <label key={v} className="inline-flex items-center gap-2 text-sm">
              <Checkbox
                checked={vatStatuses.has(v)}
                onChange={(e): void =>
                  setVatStatuses((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.add(v);
                    else next.delete(v);
                    return next;
                  })
                }
              />
              {v}
            </label>
          ))}
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <Checkbox
          checked={isDefault}
          onChange={(e): void => setIsDefault(e.target.checked)}
        />
        {t('taxes.field.isDefault')}
      </label>
      <div>
        <Button type="submit">{t('taxes.action.save')}</Button>
      </div>
    </form>
  );
}
