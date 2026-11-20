import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { ApiError } from '@endora-commerce/admin-kit/lib';
import { Alert, AlertDescription, Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Label, PageHeader, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@endora-commerce/admin-kit/ui';
import { StatusTransitionGraph } from '@endora-commerce/admin-kit/components';
import { useTranslation, useTranslationContext } from '@endora-commerce/admin-kit/i18n';
import { returnsClient } from '../api/returns-client.js';

import type { ReturnNotificationHealth, ReturnStatusDto, ReturnTransitionDto } from '@endora-commerce/contracts';

/** Resolve the admin-facing label: default name → English → first → code. */
function statusLabel(s: Pick<ReturnStatusDto, 'code' | 'name' | 'defaultName'>): string {
  return s.defaultName || s.name['en'] || Object.values(s.name)[0] || s.code;
}

/**
 * The statuses whose entry sends a dedicated e-mail of its own, so they never send
 * the status e-mail (`specs/180-off-platform-complaints/` FR-A32). The API refuses
 * the flag there; the screen says why beside the control.
 */
const DEDICATED_EMAIL_STATUSES: ReadonlySet<string> = new Set(['authorized', 'rejected']);

/** Configurable return/complaint workflow (feature 046, US3). */
export function ReturnStatusesConfigPage(): ReactNode {
  const t = useTranslation('core');
  const tr = useTranslation('returns');
  const { language } = useTranslationContext();
  const [statuses, setStatuses] = useState<Array<ReturnStatusDto & { inUseCount: number }>>([]);
  const [transitions, setTransitions] = useState<ReturnTransitionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  // `specs/180-off-platform-complaints/` D-7 — where the new-case e-mail goes to nobody.
  const [health, setHealth] = useState<ReturnNotificationHealth | null>(null);
  const [channelNames, setChannelNames] = useState<Record<string, string>>({});

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

  useEffect(() => {
    let live = true;
    void returnsClient
      .notificationHealth()
      .then((answer) => {
        if (live) setHealth(answer);
      })
      .catch(() => undefined);
    // Best effort: an operator who may not read the channel list sees the ids instead.
    void returnsClient
      .salesChannels()
      .then((list) => {
        if (!live) return;
        setChannelNames(
          Object.fromEntries(
            (list.items ?? []).map((c) => [
              c.id,
              c.name[language] ?? c.name['en'] ?? Object.values(c.name)[0] ?? c.code,
            ]),
          ),
        );
      })
      .catch(() => undefined);
    return (): void => {
      live = false;
    };
  }, [language]);

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

  // FR-A30 — saved on change, optimistically, and put back with the error when the
  // write fails. The write is audited (FR-A52), so no confirmation is asked for.
  const setNotify = async (statusCode: string, notify: boolean): Promise<void> => {
    setError(null);
    setSaving(statusCode);
    setStatuses((prev) => prev.map((s) => (s.code === statusCode ? { ...s, notifyCustomerOnEntry: notify } : s)));
    try {
      await returnsClient.updateStatus(statusCode, { notifyCustomerOnEntry: notify });
    } catch (err) {
      setStatuses((prev) => prev.map((s) => (s.code === statusCode ? { ...s, notifyCustomerOnEntry: !notify } : s)));
      setError(err instanceof ApiError ? err.envelope.error.message : 'Action failed.');
    } finally {
      setSaving(null);
    }
  };

  // The returns transitions endpoint is a full-list replace, so we derive the
  // next set from the current one for the graph's add/remove callbacks.
  const addTransition = (fromCode: string, toCode: string): void => {
    if (!fromCode || !toCode || fromCode === toCode) return;
    if (transitions.some((x) => x.fromStatusCode === fromCode && x.toStatusCode === toCode)) return;
    const next = [
      ...transitions.map((x) => ({ fromStatusCode: x.fromStatusCode, toStatusCode: x.toStatusCode })),
      { fromStatusCode: fromCode, toStatusCode: toCode },
    ];
    void run(() => returnsClient.setTransitions(next));
  };

  const removeTransition = (fromCode: string, toCode: string): void => {
    const next = transitions
      .filter((x) => !(x.fromStatusCode === fromCode && x.toStatusCode === toCode))
      .map((x) => ({ fromStatusCode: x.fromStatusCode, toStatusCode: x.toStatusCode }));
    void run(() => returnsClient.setTransitions(next));
  };

  const missingChannels = health?.recipientsMissing.salesChannelIds ?? [];
  const recipientsAlert =
    missingChannels.length > 0
      ? tr('statusConfig.recipientsMissing.channels', {
          channels: missingChannels.map((id) => channelNames[id] ?? id).join(', '),
        })
      : health?.recipientsMissing.global
        ? tr('statusConfig.recipientsMissing.any')
        : null;

  return (
    <div className="space-y-4">
      <PageHeader title={t('returns.statuses.title')} description={t('returns.statuses.description')} />
      {recipientsAlert && (
        <Alert variant="warning">
          <AlertDescription>
            {recipientsAlert}{' '}
            <Link to="/settings?group=returns" className="underline underline-offset-2">
              {tr('statusConfig.recipientsMissing.link')}
            </Link>
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{tr('statusConfig.statuses')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{tr('statusConfig.col.code')}</TableHead>
                <TableHead>{tr('statusConfig.col.name')}</TableHead>
                <TableHead>{tr('statusConfig.col.flags')}</TableHead>
                <TableHead>{tr('statusConfig.notifyColumn')}</TableHead>
                <TableHead>{tr('statusConfig.col.inUse')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {statuses.map((s) => {
                const dedicated = DEDICATED_EMAIL_STATUSES.has(s.code);
                const reasonId = `notify-reason-${s.code}`;
                return (
                  <TableRow key={s.code} aria-busy={saving === s.code}>
                    <TableCell className="font-mono text-xs">{s.code}</TableCell>
                    <TableCell>{s.defaultName}</TableCell>
                    <TableCell className="flex gap-1">
                      {s.isInitial && <Badge variant="outline">{tr('statusConfig.flag.initial')}</Badge>}
                      {s.isTerminal && <Badge variant="outline">{tr('statusConfig.flag.terminal')}</Badge>}
                      {s.isSystem && <Badge variant="secondary">{tr('statusConfig.flag.system')}</Badge>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-start gap-2">
                        <Checkbox
                          className="mt-0.5"
                          aria-label={tr('statusConfig.notifyLabel', { status: statusLabel(s) })}
                          checked={dedicated ? false : s.notifyCustomerOnEntry}
                          disabled={dedicated || saving === s.code}
                          onChange={(e) => void setNotify(s.code, e.target.checked)}
                          {...(dedicated || s.isInitial ? { 'aria-describedby': reasonId } : {})}
                        />
                        {dedicated ? (
                          <span id={reasonId} className="text-xs text-muted-foreground">
                            {tr('statusConfig.notifyDedicated')}
                          </span>
                        ) : s.isInitial ? (
                          // D-2 — filing is not an entry into the initial status.
                          <span id={reasonId} className="text-xs text-muted-foreground">
                            {tr('statusConfig.notifyInitialHint')}
                          </span>
                        ) : null}
                      </div>
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
                );
              })}
            </TableBody>
          </Table>
          {/* FR-A33 — marking a status sends nothing for the cases already in it. */}
          <p className="text-xs text-muted-foreground">{tr('statusConfig.notifyExistingHint')}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="code">{tr('statusConfig.newCode')}</Label>
              <input id="code" className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={code} onChange={(e) => setCode(e.target.value)} placeholder="inspecting" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="name">{tr('statusConfig.newName')}</Label>
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
              {tr('statusConfig.addStatus')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('orderStatusConfig.transitions')}</CardTitle>
        </CardHeader>
        <CardContent>
          <StatusTransitionGraph
            statuses={statuses}
            transitions={transitions}
            statusLabel={statusLabel}
            onAdd={addTransition}
            onRemove={removeTransition}
          />
        </CardContent>
      </Card>
    </div>
  );
}
export default ReturnStatusesConfigPage;
