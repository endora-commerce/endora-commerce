import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import { Select } from '@/components/ui/select';
import { useTranslation } from '@/i18n/useTranslation';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  paymentMethodsClient,
  type AdminPaymentMethod,
  type OrderStatusOption,
} from './api/payment-methods-client';
import { resolveAdminPaymentMethodRenderer } from './renderers/registry';

const KINDS = ['bank_transfer', 'pickup', 'credit_limit', 'gateway'] as const;

export function PaymentMethodsPage(): ReactNode {
  const t = useTranslation('core');
  const { hasPermission } = useAuth();
  const [rows, setRows] = useState<AdminPaymentMethod[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [adapters, setAdapters] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  // The upsert form is a controlled sub-tree keyed on this target: `null` = a
  // blank "add" form; a row = an "edit" form seeded from that row. Bumping the
  // key remounts the form so it picks up fresh initial values.
  const [editing, setEditing] = useState<AdminPaymentMethod | null>(null);
  const [formNonce, setFormNonce] = useState(0);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [methods, statuses, adapterKeys] = await Promise.all([
        paymentMethodsClient.list(),
        paymentMethodsClient.orderStatuses(),
        paymentMethodsClient.adapters().catch(() => [] as string[]),
      ]);
      setRows(methods);
      setOrderStatuses(statuses);
      setAdapters(adapterKeys);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resetForm = useCallback((): void => {
    setEditing(null);
    setFormNonce((n) => n + 1);
  }, []);

  const handleUpsert = useCallback(
    async (input: UpsertFormValue): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
      try {
        await paymentMethodsClient.upsert(input.code, {
          code: input.code,
          name,
          kind: input.kind,
          ...(input.adapter ? { adapter: input.adapter } : {}),
          additionalPrice: Number.isFinite(input.additionalPrice) ? input.additionalPrice : 0,
          status: input.status,
          ...(input.statusOnPending ? { statusOnPending: input.statusOnPending } : {}),
          ...(input.statusOnSuccess ? { statusOnSuccess: input.statusOnSuccess } : {}),
          ...(input.statusOnFailure ? { statusOnFailure: input.statusOnFailure } : {}),
        });
        setInfo(t('legacyMethods.messages.saved', { code: input.code }));
        resetForm();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyMethods.errors.save'));
      }
    },
    [refresh, resetForm, t],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('legacyMethods.payment.deleteConfirm'))) return;
      try {
        await paymentMethodsClient.remove(id);
        if (editing?.id === id) resetForm();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyMethods.errors.delete'));
      }
    },
    [editing, refresh, resetForm, t],
  );

  const startEdit = useCallback((row: AdminPaymentMethod): void => {
    setError(null);
    setInfo(null);
    setEditing(row);
    // Bring the form (top of page) into view for a clear edit affordance.
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const showStripe = hasPermission('stripe:read');
  const showTpay = hasPermission('tpay:read');

  return (
    <>
      <PageHeader
        title={t('legacyMethods.payment.title')}
        description={t('legacyMethods.payment.description')}
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

      {showStripe || showTpay ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>{t('legacyMethods.integrations.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="mb-4 text-sm text-muted-foreground">
              {t('legacyMethods.integrations.description')}
            </p>
            {showStripe ? (
              <div className="flex items-center justify-between gap-4 rounded-md border p-4">
                <div>
                  <div className="font-medium">{t('legacyMethods.integrations.stripe.name')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('legacyMethods.integrations.stripe.description')}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings/stripe">
                    {t('legacyMethods.integrations.configure')}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : null}
            {showTpay ? (
              <div className="flex items-center justify-between gap-4 rounded-md border p-4">
                <div>
                  <div className="font-medium">{t('legacyMethods.integrations.tpay.name')}</div>
                  <div className="text-sm text-muted-foreground">
                    {t('legacyMethods.integrations.tpay.description')}
                  </div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/settings/tpay">
                    {t('legacyMethods.integrations.configure')}
                    <ArrowRight />
                  </Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>
            {editing
              ? t('legacyMethods.editTitle', { code: editing.code })
              : t('legacyMethods.formTitle')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <UpsertForm
            key={editing ? `edit-${editing.id}` : `new-${formNonce}`}
            initial={editing}
            adapters={adapters}
            orderStatuses={orderStatuses}
            onSubmit={handleUpsert}
            {...(editing ? { onCancel: resetForm } : {})}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('legacyMethods.payment.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('legacyMethods.columns.code')}</TableHead>
                  <TableHead>{t('legacyMethods.columns.name')}</TableHead>
                  <TableHead>{t('legacyMethods.columns.adapter')}</TableHead>
                  <TableHead>{t('legacyMethods.columns.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <code className="font-mono text-xs">{r.code}</code>
                    </TableCell>
                    <TableCell>{resolveAdminPaymentMethodRenderer(r.rendererKey)(r)}</TableCell>
                    <TableCell>
                      <code className="font-mono text-xs">{r.adapter}</code>
                      {r.additionalPrice > 0 ? (
                        <span className="text-muted-foreground"> (+{r.additionalPrice})</span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'active' ? 'success' : 'secondary'}>
                        {t(`legacyMethods.status.${r.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={(): void => startEdit(r)}
                        >
                          <Pencil />
                          {t('common.action.edit')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          type="button"
                          onClick={(): void => void handleDelete(r.id)}
                        >
                          <Trash2 />
                          {t('common.action.delete')}
                        </Button>
                      </div>
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

interface UpsertFormValue {
  code: string;
  nameEn: string;
  namePl: string;
  kind: AdminPaymentMethod['kind'];
  adapter: string;
  additionalPrice: number;
  status: 'active' | 'inactive';
  statusOnPending: string;
  statusOnSuccess: string;
  statusOnFailure: string;
}

function UpsertForm({
  initial,
  adapters,
  onSubmit,
  onCancel,
  orderStatuses,
}: {
  initial?: AdminPaymentMethod | null;
  adapters: string[];
  onSubmit: (input: UpsertFormValue) => Promise<void>;
  onCancel?: () => void;
  orderStatuses: OrderStatusOption[];
}): ReactNode {
  const t = useTranslation('core');
  const isEdit = Boolean(initial);
  const [code, setCode] = useState(initial?.code ?? '');
  const [nameEn, setNameEn] = useState(initial?.name['en-US'] ?? '');
  const [namePl, setNamePl] = useState(initial?.name['pl-PL'] ?? '');
  const [kind, setKind] = useState<AdminPaymentMethod['kind']>(initial?.kind ?? 'bank_transfer');
  const [adapter, setAdapter] = useState(initial?.adapter ?? '');
  const [additionalPrice, setAdditionalPrice] = useState(String(initial?.additionalPrice ?? '0'));
  const [status, setStatus] = useState<'active' | 'inactive'>(initial?.status ?? 'active');
  const [statusOnPending, setStatusOnPending] = useState(initial?.statusOnPending ?? '');
  const [statusOnSuccess, setStatusOnSuccess] = useState(initial?.statusOnSuccess ?? '');
  const [statusOnFailure, setStatusOnFailure] = useState(initial?.statusOnFailure ?? '');

  // Offer the known adapter keys, but never drop the row's current adapter even
  // if the registry list failed to load — so an edit never silently rebinds it.
  const adapterOptions = Array.from(
    new Set([...(adapter ? [adapter] : []), ...adapters]),
  );

  const statusSelect = (
    id: string,
    label: string,
    value: string,
    setValue: (v: string) => void,
  ): ReactNode => (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e): void => setValue(e.target.value)}>
        <option value="">—</option>
        {orderStatuses.map((s) => (
          <option key={s.code} value={s.code}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({
          code,
          nameEn,
          namePl,
          kind,
          adapter,
          additionalPrice: Number(additionalPrice),
          status,
          statusOnPending,
          statusOnSuccess,
          statusOnFailure,
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="pmcode">{t('legacyMethods.fields.code')}</Label>
          <Input
            id="pmcode"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            required
            disabled={isEdit}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pmkind">{t('legacyMethods.fields.kind')}</Label>
          <Select
            id="pmkind"
            value={kind}
            onChange={(e): void => setKind(e.target.value as AdminPaymentMethod['kind'])}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`legacyMethods.payment.kind.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pmadapter">{t('legacyMethods.fields.adapter')}</Label>
          <Select
            id="pmadapter"
            value={adapter}
            onChange={(e): void => setAdapter(e.target.value)}
          >
            {/* Empty = let the backend default the adapter to the selected kind. */}
            <option value="">{`— (${kind})`}</option>
            {adapterOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pmnameen">{t('legacyMethods.fields.nameEn')}</Label>
          <Input id="pmnameen" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pmnamepl">{t('legacyMethods.fields.namePl')}</Label>
          <Input id="pmnamepl" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pmprice">{t('legacyMethods.fields.additionalPrice')}</Label>
          <Input
            id="pmprice"
            type="number"
            min="0"
            step="0.01"
            value={additionalPrice}
            onChange={(e): void => setAdditionalPrice(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="pmstatus">{t('legacyMethods.fields.status')}</Label>
          <Select
            id="pmstatus"
            value={status}
            onChange={(e): void => setStatus(e.target.value as 'active' | 'inactive')}
          >
            <option value="active">{t('legacyMethods.status.active')}</option>
            <option value="inactive">{t('legacyMethods.status.inactive')}</option>
          </Select>
        </div>
        {statusSelect('pmsop', t('legacyMethods.fields.statusOnPending'), statusOnPending, setStatusOnPending)}
        {statusSelect('pmsos', t('legacyMethods.fields.statusOnSuccess'), statusOnSuccess, setStatusOnSuccess)}
        {statusSelect('pmsof', t('legacyMethods.fields.statusOnFailure'), statusOnFailure, setStatusOnFailure)}
      </div>
      <div className="flex gap-2">
        <Button type="submit">{t('common.action.save')}</Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t('common.action.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}
