import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError, apiClient } from '@/lib/api-client';
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
import { CurrencyPicker } from '../dictionaries/components/CurrencyPicker';

interface AdminDeliveryMethod {
  id: string;
  code: string;
  name: Record<string, string>;
  cost: { amount: number; currency: string };
  status: 'active' | 'inactive';
}

export function DeliveryMethodsPage(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<AdminDeliveryMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<{ data: AdminDeliveryMethod[] }>(
        '/api/v1/admin/delivery-methods',
      );
      setRows(res.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleUpsert = useCallback(
    async (input: {
      code: string;
      nameEn: string;
      namePl: string;
      cost: number;
      currency: string;
      status: 'active' | 'inactive';
    }): Promise<void> => {
      const name: Record<string, string> = {};
      if (input.nameEn) name['en-US'] = input.nameEn;
      if (input.namePl) name['pl-PL'] = input.namePl;
      try {
        await apiClient.put<{ data: AdminDeliveryMethod }>(
          `/api/v1/admin/delivery-methods/${encodeURIComponent(input.code)}`,
          {
            code: input.code,
            name,
            cost: input.cost,
            currency: input.currency,
            status: input.status,
          },
        );
        setInfo(t('legacyMethods.messages.saved', { code: input.code }));
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyMethods.errors.save'));
      }
    },
    [refresh],
  );

  const handleDelete = useCallback(
    async (id: string): Promise<void> => {
      if (!confirm(t('legacyMethods.delivery.deleteConfirm'))) return;
      try {
        await apiClient.delete<void>(`/api/v1/admin/delivery-methods/${id}`);
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : t('legacyMethods.errors.delete'));
      }
    },
    [refresh],
  );

  return (
    <>
      <PageHeader
        title={t('legacyMethods.delivery.title')}
        description={t('legacyMethods.delivery.description')}
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
        <CardHeader>
          <CardTitle>{t('legacyMethods.formTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <UpsertForm onSubmit={handleUpsert} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('common.state.loading')}</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('legacyMethods.delivery.empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('legacyMethods.columns.code')}</TableHead>
                  <TableHead>{t('legacyMethods.columns.name')}</TableHead>
                  <TableHead>{t('legacyMethods.columns.cost')}</TableHead>
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
                    <TableCell>{r.name['en-US'] ?? Object.values(r.name)[0]}</TableCell>
                    <TableCell className="tabular-nums">
                      {r.cost.amount.toFixed(2)} {r.cost.currency}
                    </TableCell>
                    <TableCell>
                      <Badge variant={r.status === 'active' ? 'success' : 'secondary'}>
                        {t(`legacyMethods.status.${r.status}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="destructive"
                        size="sm"
                        type="button"
                        onClick={(): void => void handleDelete(r.id)}
                      >
                        <Trash2 />
                        {t('common.action.delete')}
                      </Button>
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

function UpsertForm({
  onSubmit,
}: {
  onSubmit: (input: {
    code: string;
    nameEn: string;
    namePl: string;
    cost: number;
    currency: string;
    status: 'active' | 'inactive';
  }) => Promise<void>;
}): ReactNode {
  const t = useTranslation('core');
  const [code, setCode] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [namePl, setNamePl] = useState('');
  const [cost, setCost] = useState('0');
  const [currency, setCurrency] = useState('PLN');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  return (
    <form
      className="space-y-4"
      onSubmit={(e: FormEvent): void => {
        e.preventDefault();
        void onSubmit({ code, nameEn, namePl, cost: Number(cost), currency, status });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="dcode">{t('legacyMethods.fields.code')}</Label>
          <Input
            id="dcode"
            value={code}
            onChange={(e): void => setCode(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dnameen">{t('legacyMethods.fields.nameEn')}</Label>
          <Input id="dnameen" value={nameEn} onChange={(e): void => setNameEn(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dnamepl">{t('legacyMethods.fields.namePl')}</Label>
          <Input id="dnamepl" value={namePl} onChange={(e): void => setNamePl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dcost">{t('legacyMethods.fields.cost')}</Label>
          <Input
            id="dcost"
            type="number"
            step="0.01"
            min="0"
            value={cost}
            onChange={(e): void => setCost(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dcur">{t('legacyMethods.fields.currency')}</Label>
          <CurrencyPicker
            id="dcur"
            value={currency}
            onChange={(e): void => setCurrency(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="dstatus">{t('legacyMethods.fields.status')}</Label>
          <Select
            id="dstatus"
            value={status}
            onChange={(e): void => setStatus(e.target.value as 'active' | 'inactive')}
          >
            <option value="active">{t('legacyMethods.status.active')}</option>
            <option value="inactive">{t('legacyMethods.status.inactive')}</option>
          </Select>
        </div>
      </div>
      <Button type="submit">{t('common.action.save')}</Button>
    </form>
  );
}
