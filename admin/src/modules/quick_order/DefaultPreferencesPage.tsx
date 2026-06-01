import { useState, type ReactNode } from 'react';
import { ApiError } from '@/lib/api-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { useTranslation } from '@/i18n/useTranslation';
import {
  adminGetPreference,
  adminUpsertPreference,
  type PreferenceScope,
} from './api/quick-order-client';

/**
 * DefaultPreferencesPage — feature 039 (US2 / FR-018).
 *
 * Lets an operator manage default ordering preferences for an organization or
 * a customer. The backend enforces scope authorization (platform admin → any;
 * salesperson → assigned organizations + their customers). Identifier fields
 * are entered directly, matching the existing admin pages.
 */
export function DefaultPreferencesPage(): ReactNode {
  const t = useTranslation('core');
  const [scope, setScope] = useState<PreferenceScope>('organization');
  const [scopeId, setScopeId] = useState('');
  const [payment, setPayment] = useState('');
  const [delivery, setDelivery] = useState('');
  const [billing, setBilling] = useState('');
  const [shipping, setShipping] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const label = (key: string, fallback: string): string => {
    const resolved = t(key);
    return resolved === key ? fallback : resolved;
  };

  async function load(): Promise<void> {
    if (!scopeId.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const row = await adminGetPreference(scope, scopeId.trim());
      setPayment(row?.defaultPaymentMethodId ?? '');
      setDelivery(row?.defaultDeliveryMethodId ?? '');
      setBilling(row?.defaultBillingAddressId ?? '');
      setShipping(row?.defaultShippingAddressId ?? '');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load preferences.');
    } finally {
      setBusy(false);
    }
  }

  async function save(): Promise<void> {
    if (!scopeId.trim()) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await adminUpsertPreference({
        scope,
        scopeId: scopeId.trim(),
        defaultPaymentMethodId: payment.trim() || null,
        defaultDeliveryMethodId: delivery.trim() || null,
        defaultBillingAddressId: billing.trim() || null,
        defaultShippingAddressId: shipping.trim() || null,
      });
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save preferences.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={label('quickOrder.preferences.title', 'Default ordering preferences')}
        description={label(
          'quickOrder.preferences.subtitle',
          'Manage default payment / delivery method and billing / shipping address for an organization or customer.',
        )}
      />

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {saved ? (
        <Alert>
          <AlertDescription>Preferences saved.</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{label('quickOrder.preferences.target', 'Target')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="scope">Scope</Label>
            <select
              id="scope"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={scope}
              onChange={(e) => setScope(e.target.value as PreferenceScope)}
            >
              <option value="organization">Organization</option>
              <option value="customer">Customer</option>
            </select>
          </div>
          <div>
            <Label htmlFor="scopeId">{scope === 'organization' ? 'Organization id' : 'Customer account id'}</Label>
            <Input id="scopeId" value={scopeId} onChange={(e) => setScopeId(e.target.value)} placeholder="uuid" />
          </div>
          <Button variant="outline" disabled={busy || !scopeId.trim()} onClick={() => void load()}>
            Load current
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{label('quickOrder.preferences.defaults', 'Defaults')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="payment">Default payment method id</Label>
            <Input id="payment" value={payment} onChange={(e) => setPayment(e.target.value)} placeholder="(none)" />
          </div>
          <div>
            <Label htmlFor="delivery">Default delivery method id</Label>
            <Input id="delivery" value={delivery} onChange={(e) => setDelivery(e.target.value)} placeholder="(none)" />
          </div>
          <div>
            <Label htmlFor="billing">Default billing address id</Label>
            <Input id="billing" value={billing} onChange={(e) => setBilling(e.target.value)} placeholder="(none)" />
          </div>
          <div>
            <Label htmlFor="shipping">Default shipping address id</Label>
            <Input id="shipping" value={shipping} onChange={(e) => setShipping(e.target.value)} placeholder="(none)" />
          </div>
          <Button disabled={busy || !scopeId.trim()} onClick={() => void save()}>
            Save preferences
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
