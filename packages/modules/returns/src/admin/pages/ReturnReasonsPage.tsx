import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { ListChecks, Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  InlineStatus,
  Input,
  PageHeader,
  Select,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  useInlineStatus,
} from '@endora-commerce/admin-kit/ui';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';
import { localizedText } from '../labels.js';

import type { ReturnReasonDto } from '@endora-commerce/contracts';

const APPLIES_TO = ['both', 'return', 'complaint'] as const;

/** Managed return/complaint reasons (feature 046, US7; translated in #1472). */
export function ReturnReasonsPage(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  // `null` until the first answer, so the empty state does not flash while loading.
  const [rows, setRows] = useState<ReturnReasonDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [appliesTo, setAppliesTo] = useState<string>('both');
  const [weight, setWeight] = useState(100);
  const [busyId, setBusyId] = useState<string | null>(null);
  const status = useInlineStatus();

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setRows(await returnsClient.reasons());
    } catch (err) {
      setRows((prev) => prev ?? []);
      setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.loadFailed'));
    }
  }, [tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (fn: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      try {
        await fn();
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof ApiError ? err.envelope.error.message : tr('admin.actionFailed'));
        return false;
      }
    },
    [refresh, tr],
  );

  const nameOf = (r: ReturnReasonDto): string => localizedText(r.label, language, '—');

  const add = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!label.trim()) return;
    const ok = await run(() => returnsClient.createReason({ label: { en: label.trim() }, appliesTo, weight }));
    if (ok) {
      setLabel('');
      status.show(tr('reasons.added'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title={t('returns.reasons.title')} description={t('returns.reasons.description')} />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {rows !== null && (
        <Card>
          <CardContent>
            {rows.length === 0 ? (
              <EmptyState
                icon={<ListChecks size={20} />}
                title={tr('reasons.empty.title')}
                description={tr('reasons.empty.description')}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tr('reasons.col.label')}</TableHead>
                    <TableHead>{tr('reasons.col.appliesTo')}</TableHead>
                    <TableHead className="text-right">{tr('reasons.col.weight')}</TableHead>
                    <TableHead>{tr('reasons.col.active')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{nameOf(r)}</TableCell>
                      <TableCell>{tr(`reasons.appliesTo.${r.appliesTo}`)}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.weight}</TableCell>
                      <TableCell>
                        <Switch
                          checked={r.isActive}
                          busy={busyId === r.id}
                          aria-label={tr('reasons.activeLabel', { label: nameOf(r) })}
                          onCheckedChange={(next) => {
                            setBusyId(r.id);
                            void run(() => returnsClient.updateReason(r.id, { isActive: next })).finally(() =>
                              setBusyId(null),
                            );
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          aria-label={tr('reasons.delete', { label: nameOf(r) })}
                          onClick={() => void run(() => returnsClient.deleteReason(r.id))}
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr('reasons.newTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-start gap-4" onSubmit={(e) => void add(e)}>
            <FormField label={tr('reasons.field.label')} required className="w-72">
              <Input
                value={label}
                maxLength={200}
                onChange={(e) => {
                  setLabel(e.target.value);
                  status.clear();
                }}
              />
            </FormField>
            <FormField label={tr('reasons.field.appliesTo')} className="w-56">
              <Select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
                {APPLIES_TO.map((value) => (
                  <option key={value} value={value}>
                    {tr(`reasons.appliesTo.${value}`)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label={tr('reasons.field.weight')} hint={tr('reasons.field.weightHint')} className="w-80">
              <Input
                type="number"
                step="1"
                className="w-28"
                value={weight}
                onChange={(e) => setWeight(Number(e.target.value))}
              />
            </FormField>
            <div className="flex items-center gap-3 pt-6">
              <Button type="submit" size="sm" disabled={!label.trim()}>
                {tr('reasons.add')}
              </Button>
              <InlineStatus {...status.props} />
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
export default ReturnReasonsPage;
