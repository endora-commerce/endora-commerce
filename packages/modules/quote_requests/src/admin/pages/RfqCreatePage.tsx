import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Button, Card, CardContent, CardHeader, CardTitle, Combobox, Input, Label, PageHeader, Textarea, type ComboboxOption } from '@endora-commerce/admin-kit/ui';
import { ProductPicker } from '@endora-commerce/admin-kit/components';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';

/**
 * Admin "create a Quote Request on behalf of a customer" (feature 008 US4).
 *
 * The backend endpoint `POST /api/v1/admin/quote-requests` already exists and
 * validates the org/customer/products; this page is the missing admin UI for
 * it. Customer search reuses `GET /api/v1/admin/customers`, whose rows carry
 * `organizationId`, so the (organization, customer) pair the endpoint requires
 * is derived from the single customer selection.
 */

interface AdminCustomerListItem {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  organizationId: string | null;
  organizationName: string | null;
}

interface LineRow {
  productId: string;
  quantity: number;
  agreedUnitPrice: string;
  lineNote: string;
}

const SEARCH_DEBOUNCE_MS = 250;

function customerLabel(c: AdminCustomerListItem): string {
  const name = `${c.firstName} ${c.lastName}`.trim();
  return name.length > 0 ? name : c.email;
}

/**
 * Debounced server-side customer picker that hands the full selected row back
 * to the parent (we need its `organizationId`, not just the id).
 */
function CustomerPicker(props: {
  value: AdminCustomerListItem | null;
  onChange: (next: AdminCustomerListItem | null) => void;
}): ReactNode {
  const t = useTranslation('core');
  const [options, setOptions] = useState<ComboboxOption<string>[]>([]);
  const [cache, setCache] = useState<Map<string, AdminCustomerListItem>>(() => new Map());
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seqRef = useRef(0);

  useEffect(
    () => (): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const runSearch = useCallback(async (query: string, seq: number): Promise<void> => {
    setSearching(true);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '20', status: 'active' });
      const trimmed = query.trim();
      if (trimmed.length > 0) params.set('q', trimmed);
      const res = await apiClient.get<{ data: AdminCustomerListItem[] }>(
        `/api/v1/admin/customers?${params.toString()}`,
      );
      if (seq !== seqRef.current) return;
      setCache((prev) => {
        const next = new Map(prev);
        for (const c of res.data) next.set(c.id, c);
        return next;
      });
      setOptions(
        res.data.map((c) => ({
          value: c.id,
          label: customerLabel(c),
          description: c.organizationName ? `${c.email} · ${c.organizationName}` : c.email,
        })),
      );
    } catch {
      if (seq !== seqRef.current) return;
      setOptions([]);
    } finally {
      if (seq === seqRef.current) setSearching(false);
    }
  }, []);

  const handleSearchChange = useCallback(
    (query: string): void => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      const seq = ++seqRef.current;
      timerRef.current = setTimeout(() => void runSearch(query, seq), SEARCH_DEBOUNCE_MS);
    },
    [runSearch],
  );

  return (
    <Combobox<string>
      id="customerAccountId"
      ariaLabel="customerAccountId"
      options={options}
      value={props.value?.id ?? null}
      selectedLabel={props.value ? customerLabel(props.value) : ''}
      onChange={(id): void => props.onChange(id ? cache.get(id) ?? null : null)}
      onSearchChange={handleSearchChange}
      manualFilter
      loading={searching}
      placeholder={t('rfqCreate.placeholder.customer')}
      emptyMessage={searching ? t('rfqCreate.loading') : t('rfqCreate.empty.customers')}
    />
  );
}

function emptyLine(): LineRow {
  return { productId: '', quantity: 1, agreedUnitPrice: '', lineNote: '' };
}

export function RfqCreatePage(): ReactNode {
  const t = useTranslation('core');
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<AdminCustomerListItem | null>(null);
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [headerNote, setHeaderNote] = useState('');
  const [expiresInDays, setExpiresInDays] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setLine = (i: number, patch: Partial<LineRow>): void =>
    setLines((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = (): void => setLines((prev) => [...prev, emptyLine()]);
  const removeRow = (i: number): void => setLines((prev) => prev.filter((_, idx) => idx !== i));

  // Pre-fill the agreed unit price from the selected customer's price lists.
  // Resolution depends on the (organization, customer, product, quantity)
  // tuple, so we re-resolve whenever any of them changes. Failures leave the
  // field for manual entry.
  const resolveAndFill = useCallback(
    async (
      index: number,
      productId: string,
      quantity: number,
      cust: AdminCustomerListItem | null,
    ): Promise<void> => {
      if (!productId.trim() || !cust?.organizationId) return;
      try {
        const params = new URLSearchParams({
          organizationId: cust.organizationId,
          customerAccountId: cust.id,
          quantity: String(quantity > 0 ? quantity : 1),
        });
        const res = await apiClient.get<{ data: { resolvedPrice: { amount: string } | null } }>(
          `/api/v1/admin/products/${productId.trim()}/resolved-price?${params.toString()}`,
        );
        const amount = res.data.resolvedPrice?.amount;
        if (amount != null) {
          setLines((prev) =>
            prev.map((row, idx) => (idx === index ? { ...row, agreedUnitPrice: amount } : row)),
          );
        }
      } catch {
        // Leave the field for manual entry when resolution is unavailable.
      }
    },
    [],
  );

  const handleCustomerChange = (next: AdminCustomerListItem | null): void => {
    setCustomer(next);
    // Re-price every line already carrying a product against the new customer.
    lines.forEach((row, idx) => {
      if (row.productId.trim()) void resolveAndFill(idx, row.productId, row.quantity, next);
    });
  };

  const validLines = lines.filter(
    (l) => l.productId.trim() && l.quantity > 0 && l.agreedUnitPrice.trim() !== '',
  );
  const hasOrg = Boolean(customer?.organizationId);
  const total = validLines.reduce(
    (sum, l) => sum + l.quantity * Number(l.agreedUnitPrice || 0),
    0,
  );
  const canSubmit = hasOrg && validLines.length > 0 && !busy;

  const submit = async (): Promise<void> => {
    if (!customer?.organizationId) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedExpiry = expiresInDays.trim();
      const res = await apiClient.post<{ data: { id: string } }>('/api/v1/admin/quote-requests', {
        organizationId: customer.organizationId,
        customerAccountId: customer.id,
        ...(headerNote.trim() ? { headerNote: headerNote.trim() } : {}),
        ...(trimmedExpiry !== '' ? { expiresInDays: Number(trimmedExpiry) } : {}),
        items: validLines.map((l) => ({
          productId: l.productId.trim(),
          quantity: l.quantity,
          agreedUnitPrice: Number(l.agreedUnitPrice),
          ...(l.lineNote.trim() ? { lineNote: l.lineNote.trim() } : {}),
        })),
      });
      navigate(`/quote-requests/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('rfqCreate.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('rfqCreate.title')}
        description={t('rfqCreate.description')}
        back={{ label: t('rfqCreate.back'), to: '/quote-requests' }}
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.customer')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="customerAccountId">{t('rfqCreate.field.customer')}</Label>
          <CustomerPicker value={customer} onChange={handleCustomerChange} />
          {customer && !hasOrg ? (
            <Alert variant="destructive">
              <AlertDescription>{t('rfqCreate.noOrgWarning')}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((row, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor={`product-${i}`}>{t('rfqCreate.field.product')}</Label>
                <ProductPicker
                  mode="select"
                  id={`product-${i}`}
                  ariaLabel={`product-${i}`}
                  value={row.productId === '' ? null : row.productId}
                  onChange={(next): void => {
                    const pid = next ?? '';
                    setLine(i, { productId: pid });
                    void resolveAndFill(i, pid, row.quantity, customer);
                  }}
                  placeholder={t('rfqCreate.placeholder.product')}
                />
              </div>
              <div className="w-20 space-y-1">
                <Label htmlFor={`qty-${i}`}>{t('rfqCreate.field.quantity')}</Label>
                <Input
                  id={`qty-${i}`}
                  aria-label={`qty-${i}`}
                  type="number"
                  min={1}
                  value={row.quantity}
                  onChange={(e): void => {
                    const q = Number(e.target.value);
                    setLine(i, { quantity: q });
                    void resolveAndFill(i, row.productId, q, customer);
                  }}
                />
              </div>
              <div className="w-32 space-y-1">
                <Label htmlFor={`price-${i}`}>{t('rfqCreate.field.agreedUnitPrice')}</Label>
                <Input
                  id={`price-${i}`}
                  aria-label={`price-${i}`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={row.agreedUnitPrice}
                  onChange={(e): void => setLine(i, { agreedUnitPrice: e.target.value })}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`remove-item-${i}`}
                disabled={lines.length === 1}
                onClick={(): void => removeRow(i)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus />
            {t('rfqCreate.addItem')}
          </Button>
          <div className="flex justify-end pt-2 text-sm font-medium">
            {t('rfqCreate.total')}: {total.toFixed(2)}
          </div>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('rfqCreate.section.options')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="headerNote">{t('rfqCreate.field.headerNote')}</Label>
            <Textarea
              id="headerNote"
              rows={3}
              value={headerNote}
              placeholder={t('rfqCreate.placeholder.headerNote')}
              onChange={(e): void => setHeaderNote(e.target.value)}
            />
          </div>
          <div className="w-40 space-y-1">
            <Label htmlFor="expiresInDays">{t('rfqCreate.field.expiresInDays')}</Label>
            <Input
              id="expiresInDays"
              type="number"
              min={0}
              value={expiresInDays}
              placeholder={t('rfqCreate.placeholder.expiresInDays')}
              onChange={(e): void => setExpiresInDays(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={!canSubmit} onClick={(): void => void submit()}>
          {busy ? t('rfqCreate.submitting') : t('rfqCreate.submit')}
        </Button>
      </div>
    </div>
  );
}

/**
 * The registry loads a route component through a dynamic-import factory and
 * reads its default export (feature 091, FR-013). The named export stays: it is
 * the spelling this module's own code and its tests use.
 */
export default RfqCreatePage;
