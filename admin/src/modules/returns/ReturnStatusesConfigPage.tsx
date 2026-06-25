import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { returnsClient } from './api/returns-client';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PageHeader } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ReturnStatusDto, ReturnTransitionDto } from '@b2b/contracts';

/** Configurable return/complaint workflow (feature 046, US3). */
export function ReturnStatusesConfigPage(): ReactNode {
  const [statuses, setStatuses] = useState<Array<ReturnStatusDto & { inUseCount: number }>>([]);
  const [transitions, setTransitions] = useState<ReturnTransitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const refresh = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const graph = await returnsClient.statuses();
      setStatuses(graph.statuses);
      setTransitions(graph.transitions);
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

  const saveTransitionAdd = (): void => {
    if (!from || !to || from === to) return;
    const next = [...transitions.map((t) => ({ fromStatusCode: t.fromStatusCode, toStatusCode: t.toStatusCode })), { fromStatusCode: from, toStatusCode: to }];
    void run(() => returnsClient.setTransitions(next));
  };

  const removeTransition = (t: ReturnTransitionDto): void => {
    const next = transitions
      .filter((x) => !(x.fromStatusCode === t.fromStatusCode && x.toStatusCode === t.toStatusCode))
      .map((x) => ({ fromStatusCode: x.fromStatusCode, toStatusCode: x.toStatusCode }));
    void run(() => returnsClient.setTransitions(next));
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Return statuses" description="Configure the return/complaint lifecycle and transitions." />
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Statuses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>In use</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((s) => (
                <TableRow key={s.code}>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell>{s.defaultName}</TableCell>
                  <TableCell className="flex gap-1">
                    {s.isInitial && <Badge variant="outline">initial</Badge>}
                    {s.isTerminal && <Badge variant="outline">terminal</Badge>}
                    {s.isSystem && <Badge variant="secondary">system</Badge>}
                  </TableCell>
                  <TableCell>{s.inUseCount}</TableCell>
                  <TableCell>
                    {!s.isInitial && !s.isSystem && (
                      <Button variant="ghost" size="sm" onClick={() => void run(() => returnsClient.deleteStatus(s.code))}>
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="code">New status code</Label>
              <input id="code" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={code} onChange={(e) => setCode(e.target.value)} placeholder="inspecting" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">Name (EN)</Label>
              <input id="name" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Inspecting" />
            </div>
            <Button
              size="sm"
              disabled={!code.trim() || !name.trim()}
              onClick={() =>
                void run(async () => {
                  await returnsClient.createStatus({ code: code.trim(), name: { en: name.trim() }, defaultName: name.trim() });
                  setCode('');
                  setName('');
                })
              }
            >
              Add status
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Transitions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-1">
            {transitions.map((t) => (
              <Badge key={`${t.fromStatusCode}->${t.toStatusCode}`} variant="secondary" className="gap-1">
                {t.fromStatusCode} → {t.toStatusCode}
                <button type="button" className="ml-1" onClick={() => removeTransition(t)}>
                  ×
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="from">From</Label>
              <Select id="from" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">—</option>
                {statuses.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">To</Label>
              <Select id="to" value={to} onChange={(e) => setTo(e.target.value)}>
                <option value="">—</option>
                {statuses.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.code}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" variant="outline" onClick={saveTransitionAdd}>
              Add transition
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
