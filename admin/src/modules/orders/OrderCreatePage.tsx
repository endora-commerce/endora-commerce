import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';

interface ItemRow {
  productId: string;
  quantity: number;
}

/**
 * OrderCreatePage — feature 038 (US3).
 *
 * Lets a sales rep / admin build an order for a customer: pick the customer,
 * sales channel, payment + delivery method, delivery + billing address, and add
 * line items. On submit the backend creates the order on-behalf and notifies
 * the customer to pay it. (Identifier fields are entered directly here; rich
 * customer/address/method pickers are a follow-up enhancement.)
 */
export function OrderCreatePage(): ReactNode {
  const t = useTranslation('core');
  const navigate = useNavigate();

  const [customerAccountId, setCustomerAccountId] = useState('');
  const [salesChannelId, setSalesChannelId] = useState('');
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [deliveryAddressId, setDeliveryAddressId] = useState('');
  const [billingAddressId, setBillingAddressId] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [items, setItems] = useState<ItemRow[]>([{ productId: '', quantity: 1 }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setItem = (i: number, patch: Partial<ItemRow>): void =>
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const addRow = (): void => setItems((prev) => [...prev, { productId: '', quantity: 1 }]);
  const removeRow = (i: number): void => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const canSubmit =
    customerAccountId.trim() &&
    salesChannelId.trim() &&
    deliveryMethodId.trim() &&
    paymentMethodId.trim() &&
    deliveryAddressId.trim() &&
    billingAddressId.trim() &&
    items.some((it) => it.productId.trim() && it.quantity > 0);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await apiClient.post<{ data: { id: string } }>('/api/v1/admin/orders', {
        customerAccountId: customerAccountId.trim(),
        salesChannelId: salesChannelId.trim(),
        deliveryMethodId: deliveryMethodId.trim(),
        paymentMethodId: paymentMethodId.trim(),
        deliveryAddressId: deliveryAddressId.trim(),
        billingAddressId: billingAddressId.trim(),
        ...(customerNote.trim() ? { customerNote: customerNote.trim() } : {}),
        items: items
          .filter((it) => it.productId.trim() && it.quantity > 0)
          .map((it) => ({ productId: it.productId.trim(), quantity: it.quantity })),
      });
      navigate(`/orders/${res.data.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : t('orderCreate.error'));
    } finally {
      setBusy(false);
    }
  };

  const field = (id: string, label: string, value: string, onChange: (v: string) => void): ReactNode => (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <input
        id={id}
        aria-label={id}
        className="h-9 w-full rounded-md border px-3 text-sm"
        value={value}
        onChange={(e): void => onChange(e.target.value)}
      />
    </div>
  );

  return (
    <>
      <PageHeader
        title={t('orderCreate.title')}
        description={t('orderCreate.description')}
        actions={
          <Button asChild variant="outline">
            <Link to="/orders">
              <ArrowLeft />
              {t('common.action.back')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('orderCreate.section.parties')}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {field('customerAccountId', t('orderCreate.field.customer'), customerAccountId, setCustomerAccountId)}
          {field('salesChannelId', t('orderCreate.field.salesChannel'), salesChannelId, setSalesChannelId)}
          {field('paymentMethodId', t('orderCreate.field.paymentMethod'), paymentMethodId, setPaymentMethodId)}
          {field('deliveryMethodId', t('orderCreate.field.deliveryMethod'), deliveryMethodId, setDeliveryMethodId)}
          {field('deliveryAddressId', t('orderCreate.field.deliveryAddress'), deliveryAddressId, setDeliveryAddressId)}
          {field('billingAddressId', t('orderCreate.field.billingAddress'), billingAddressId, setBillingAddressId)}
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>{t('orderCreate.section.items')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {items.map((row, i) => (
            <div key={i} className="flex items-end gap-3">
              <div className="flex-1 space-y-1">
                <Label htmlFor={`product-${i}`}>{t('orderCreate.field.product')}</Label>
                <input
                  id={`product-${i}`}
                  aria-label={`product-${i}`}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={row.productId}
                  onChange={(e): void => setItem(i, { productId: e.target.value })}
                />
              </div>
              <div className="w-24 space-y-1">
                <Label htmlFor={`qty-${i}`}>{t('orderCreate.field.quantity')}</Label>
                <input
                  id={`qty-${i}`}
                  aria-label={`qty-${i}`}
                  type="number"
                  min={1}
                  className="h-9 w-full rounded-md border px-3 text-sm"
                  value={row.quantity}
                  onChange={(e): void => setItem(i, { quantity: Number(e.target.value) })}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`remove-item-${i}`}
                disabled={items.length === 1}
                onClick={(): void => removeRow(i)}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addRow}>
            <Plus />
            {t('orderCreate.addItem')}
          </Button>
        </CardContent>
      </Card>

      <Card className="mb-4">
        <CardContent className="space-y-3 pt-6">
          <div className="space-y-1">
            <Label htmlFor="customerNote">{t('orderCreate.field.note')}</Label>
            <textarea
              id="customerNote"
              aria-label="customerNote"
              className="min-h-20 w-full rounded-md border p-2 text-sm"
              value={customerNote}
              onChange={(e): void => setCustomerNote(e.target.value)}
            />
          </div>
          <Button disabled={!canSubmit || busy} onClick={(): void => void submit()}>
            {t('orderCreate.submit')}
          </Button>
        </CardContent>
      </Card>
    </>
  );
}
