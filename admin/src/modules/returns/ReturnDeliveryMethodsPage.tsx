import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { returnsClient } from './api/returns-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTranslation } from '@/i18n/useTranslation';
import type { ReturnDeliveryMethodDto } from '@endora-commerce/contracts';

/** Allowed return delivery methods + cost (feature 046, US6). */
export function ReturnDeliveryMethodsPage(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<ReturnDeliveryMethodDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [deliveryMethodId, setDeliveryMethodId] = useState('');
  const [returnCost, setReturnCost] = useState(0);
  const [currency, setCurrency] = useState('PLN');

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await returnsClient.deliveryMethods());
    } catch (err) {
      setError(err instanceof ApiError ? err.envelope.error.message : 'Failed to load.');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<void> => {
      setError(null);
      try {
        await fn();
        await refresh();
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : 'Action failed.');
      }
    },
    [refresh],
  );

  return (
    <div className="space-y-4">
      <PageHeader title={t('returns.methods.title')} description={t('returns.methods.description')} />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Methods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Delivery method id</TableHead>
                <TableHead>Return cost</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">{r.deliveryMethodId}</TableCell>
                  <TableCell>{r.returnCost.toFixed(2)}</TableCell>
                  <TableCell>{r.currency}</TableCell>
                  <TableCell>
                    <Badge variant={r.isActive ? 'default' : 'secondary'}>{r.isActive ? 'active' : 'inactive'}</Badge>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => void run(() => returnsClient.deleteDeliveryMethod(r.id))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="dm">Delivery method id</Label>
              <input id="dm" className="h-9 w-80 rounded-md border border-input bg-background px-3 text-sm" value={deliveryMethodId} onChange={(e) => setDeliveryMethodId(e.target.value)} placeholder="uuid" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cost">Return cost</Label>
              <input id="cost" type="number" step="0.01" className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm" value={returnCost} onChange={(e) => setReturnCost(Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cur">Currency</Label>
              <input id="cur" className="h-9 w-20 rounded-md border border-input bg-background px-3 text-sm" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </div>
            <Button
              size="sm"
              disabled={!deliveryMethodId.trim()}
              onClick={() =>
                void run(async () => {
                  await returnsClient.createDeliveryMethod({ deliveryMethodId: deliveryMethodId.trim(), returnCost, currency });
                  setDeliveryMethodId('');
                })
              }
            >
              Add method
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
