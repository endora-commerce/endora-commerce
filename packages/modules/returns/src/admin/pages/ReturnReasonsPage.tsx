import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, Select, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { useTranslation } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';

import type { ReturnReasonDto } from '@endora-commerce/contracts';

/** Managed return/complaint reasons (feature 046, US7). */
export function ReturnReasonsPage(): ReactNode {
  const t = useTranslation('core');
  const [rows, setRows] = useState<ReturnReasonDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [appliesTo, setAppliesTo] = useState('both');
  const [weight, setWeight] = useState(100);

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await returnsClient.reasons());
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
      <PageHeader title={t('returns.reasons.title')} description={t('returns.reasons.description')} />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Reasons</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Weight</TableHead>
                <TableHead>Active</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>{r.label['en'] ?? Object.values(r.label)[0] ?? '—'}</TableCell>
                  <TableCell>{r.appliesTo}</TableCell>
                  <TableCell>{r.weight}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void run(() => returnsClient.updateReason(r.id, { isActive: !r.isActive }))}
                    >
                      <Badge variant={r.isActive ? 'default' : 'secondary'}>{r.isActive ? 'active' : 'inactive'}</Badge>
                    </Button>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={() => void run(() => returnsClient.deleteReason(r.id))}>
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="label">Label (EN)</Label>
              <input id="label" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="applies">Applies to</Label>
              <Select id="applies" value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
                <option value="both">Both</option>
                <option value="return">Return</option>
                <option value="complaint">Complaint</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="weight">Weight</Label>
              <input id="weight" type="number" className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm" value={weight} onChange={(e) => setWeight(Number(e.target.value))} />
            </div>
            <Button
              size="sm"
              disabled={!label.trim()}
              onClick={() =>
                void run(async () => {
                  await returnsClient.createReason({ label: { en: label.trim() }, appliesTo, weight });
                  setLabel('');
                })
              }
            >
              Add reason
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
export default ReturnReasonsPage;
